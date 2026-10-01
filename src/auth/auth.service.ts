import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { LoginDto, AuthResponseDto } from './dto/auth.dto';
import { getInactivityTimeoutMs } from './session-inactivity';

type JwtExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
      include: { tenant: true, professionalProfile: { include: { specialty: true } } },
    });

    if (users.length === 0) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const matchingUsers: typeof users = [];
    for (const candidate of users) {
      const isPasswordValid = await bcrypt.compare(password, candidate.password);
      if (isPasswordValid) {
        matchingUsers.push(candidate);
      }
    }

    if (matchingUsers.length === 0) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (matchingUsers.length > 1) {
      // Deterministic fallback for legacy data with duplicate email+password across tenants.
      matchingUsers.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    const user = matchingUsers[0];

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActivityAt: new Date() },
    });

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
        professionalProfile: user.professionalProfile ?? undefined,
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
            include: {
              user: {
                include: { tenant: true, professionalProfile: { include: { specialty: true } } },
              },
            },
          });

          if (!storedToken || storedToken.isRevoked) {
            // Token reuse detected - revoke entire token family
            if (storedToken?.familyId) {
              await this.revokeTokenFamily(storedToken.familyId);
            }
            throw new UnauthorizedException('Token de actualización inválido');
          }

          // Check expiration
          if (new Date() > storedToken.expiresAt) {
            throw new UnauthorizedException('El token de actualización ha expirado');
          }

          const user = storedToken.user;

          if (!user.isActive || !user.tenant.isActive) {
            throw new UnauthorizedException('Usuario o tenant inactivo');
          }

          if (
            user.lastActivityAt &&
            Date.now() - user.lastActivityAt.getTime() > getInactivityTimeoutMs()
          ) {
            await this.prisma.refreshToken.updateMany({
              where: { userId: user.id, isRevoked: false },
              data: { isRevoked: true },
            });
            throw new UnauthorizedException('La sesión expiró por inactividad');
          }

          await this.prisma.user.update({
            where: { id: user.id },
            data: { lastActivityAt: new Date() },
          });

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
              professionalProfile: user.professionalProfile ?? undefined,
            },
          };
        },
      );
    } catch (error) {
      throw new UnauthorizedException('Token de actualización inválido');
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
      where: { email, isActive: true, tenant: { isActive: true } },
      // Deterministic choice when the same email exists in several tenants.
      orderBy: { updatedAt: 'desc' },
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
        secret: this.getResetSecret(user.password),
        expiresIn: (this.configService.get<string>('JWT_RESET_EXPIRATION') || '1h') as JwtExpiresIn,
      },
    );

    // Integrate with your email provider in production.
    // The token grants account access, so it is only logged outside production
    // to keep the flow testable in development environments.
    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      this.logger.debug(`Password reset token generated for ${email}: ${token}`);
    } else {
      this.logger.warn(
        `Password reset requested for user ${user.id} but no email provider is configured`,
      );
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      const unverified = this.jwtService.decode(token) as {
        sub?: string;
        tenantId?: string;
      } | null;

      if (!unverified?.sub || !unverified.tenantId) {
        throw new BadRequestException('Token de restablecimiento inválido');
      }

      const user = await this.prisma.user.findFirst({
        where: { id: unverified.sub, tenantId: unverified.tenantId, isActive: true },
      });

      if (!user) {
        throw new BadRequestException('Token de restablecimiento inválido');
      }

      // The current password hash is part of the signing secret, so the token
      // stops being valid as soon as the password changes (single use).
      const payload = this.jwtService.verify(token, {
        secret: this.getResetSecret(user.password),
      }) as { sub: string; tenantId: string; type?: string };

      if (payload.type !== 'password-reset') {
        throw new BadRequestException('Token de restablecimiento inválido');
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
      throw new BadRequestException('Token de restablecimiento inválido o expirado');
    }
  }

  private getResetSecret(passwordHash: string): string {
    const baseSecret =
      this.configService.get<string>('JWT_RESET_SECRET') ||
      this.configService.get<string>('JWT_ACCESS_SECRET');
    return `${baseSecret}:${passwordHash}`;
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
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '15m') as JwtExpiresIn,
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, jti: randomUUID() },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRATION') ||
          '7d') as JwtExpiresIn,
      },
    );

    // Store refresh token with family tracking
    const tokenFamilyId = familyId || randomUUID();
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
