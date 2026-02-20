import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { LoginDto, AuthResponseDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const { email, password } = loginDto;

    const users = await this.prisma.user.findMany({
      where: {
        email,
        isActive: true,
        tenant: { isActive: true },
      },
      include: { tenant: true },
    });

    if (users.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const matchingUsers: typeof users = [];
    for (const candidate of users) {
      const isPasswordValid = await bcrypt.compare(password, candidate.password);
      if (isPasswordValid) {
        matchingUsers.push(candidate);
      }
    }

    if (matchingUsers.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (matchingUsers.length > 1) {
      // Deterministic fallback for legacy data with duplicate email+password across tenants.
      matchingUsers.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    const user = matchingUsers[0];

    // Generate tokens
    const tokens = await this.generateTokens(user);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    try {
      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      return this.prisma.withRlsContext(
        {
          tenantId: payload.tenantId,
          userId: payload.sub,
          role: payload.role,
        },
        async () => {
          // Find refresh token in database
          const storedToken = await this.prisma.refreshToken.findUnique({
            where: { token: refreshToken },
            include: { user: { include: { tenant: true } } },
          });

          if (!storedToken || storedToken.isRevoked) {
            // Token reuse detected - revoke entire token family
            if (storedToken?.familyId) {
              await this.revokeTokenFamily(storedToken.familyId);
            }
            throw new UnauthorizedException('Invalid refresh token');
          }

          // Check expiration
          if (new Date() > storedToken.expiresAt) {
            throw new UnauthorizedException('Refresh token expired');
          }

          const user = storedToken.user;

          if (!user.isActive || !user.tenant.isActive) {
            throw new UnauthorizedException('User or tenant is inactive');
          }

          // Revoke old refresh token
          await this.prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: { isRevoked: true },
          });

          // Generate new tokens with same family
          const tokens = await this.generateTokens(user, storedToken.familyId);

          return {
            ...tokens,
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role,
              tenantId: user.tenantId,
            },
          };
        },
      );
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    // Revoke the specific refresh token
    await this.prisma.refreshToken.updateMany({
      where: { userId, token: refreshToken },
      data: { isRevoked: true },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    // Revoke all refresh tokens for user
    await this.prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    // Avoid email enumeration: always return success.
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
    });

    if (!user) {
      return;
    }

    const token = this.jwtService.sign(
      {
        sub: user.id,
        tenantId: user.tenantId,
        type: 'password-reset',
      },
      {
        secret: this.configService.get<string>('JWT_RESET_SECRET') || this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>('JWT_RESET_EXPIRATION') || '1h',
      },
    );

    // Integrate with your email provider in production.
    // Logging keeps the flow testable in development environments.
    // eslint-disable-next-line no-console
    console.log(`[Auth] Password reset token generated for ${email}: ${token}`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_RESET_SECRET') || this.configService.get<string>('JWT_ACCESS_SECRET'),
      }) as { sub: string; tenantId: string; type?: string };

      if (payload.type !== 'password-reset') {
        throw new BadRequestException('Invalid reset token');
      }

      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, tenantId: payload.tenantId, isActive: true },
      });

      if (!user) {
        throw new BadRequestException('Invalid reset token');
      }

      const hashedPassword = await this.hashPassword(newPassword);

      await this.prisma.withRlsContext(
        {
          tenantId: payload.tenantId,
          userId: payload.sub,
        },
        async () => {
          await this.prisma.$transaction(async (tx) => {
            await this.prisma.applyRlsContext(tx);

            await tx.user.update({
              where: { id: user.id },
              data: { password: hashedPassword },
            });

            // Invalidate all active sessions after password reset.
            await tx.refreshToken.updateMany({
              where: { userId: user.id, isRevoked: false },
              data: { isRevoked: true },
            });
          });
        },
      );
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  private async generateTokens(user: any, familyId?: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d',
    });

    // Store refresh token with family tracking
    const tokenFamilyId = familyId || uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        familyId: tokenFamilyId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private async revokeTokenFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRevoked: true },
    });
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}
