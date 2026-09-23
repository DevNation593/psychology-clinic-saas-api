import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string; // userId
  email: string;
  tenantId: string;
  role: string;
}

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // Verify user still exists and is active
    const user = await this.prisma.withRlsContext(
      {
        tenantId: payload.tenantId,
        userId: payload.sub,
        role: payload.role,
      },
      () =>
        this.prisma.user.findUnique({
          where: { id: payload.sub },
          include: { tenant: true },
        }),
    );

    if (!user || !user.isActive || !user.tenant.isActive) {
      throw new UnauthorizedException('User or tenant is inactive');
    }

    if (user.lastActivityAt && Date.now() - user.lastActivityAt.getTime() > INACTIVITY_TIMEOUT_MS) {
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

    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
    };
  }
}
