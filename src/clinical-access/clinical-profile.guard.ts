import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalActor } from './clinical-actor';

/**
 * Clinical content is readable only by accounts with an active professional profile
 * in the tenant, whatever their role. Runs after the global JWT, tenant and role guards.
 */
@Injectable()
export class ClinicalProfileGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const profile = user?.userId
      ? await this.prisma.professionalProfile.findFirst({
          where: {
            userId: user.userId,
            isActive: true,
            user: { tenantId: user.tenantId, isActive: true },
          },
          select: { specialtyId: true },
        })
      : null;

    if (!profile) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PROFESSIONAL_NOT_AUTHORIZED',
        message: 'Se requiere un perfil profesional activo para acceder al contenido clínico.',
      });
    }

    const userAgent = request.headers?.['user-agent'];
    const actor: ClinicalActor = {
      userId: user.userId,
      role: user.role,
      specialtyId: profile.specialtyId,
      ipAddress: request.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    };
    request.clinicalActor = actor;

    return true;
  }
}
