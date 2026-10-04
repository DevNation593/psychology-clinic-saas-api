import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  effectivePermissions,
  grantablePermissions,
  isPermission,
  PERMISSION_CATALOG,
  rolePermissions,
} from '../common/permissions/permission-catalog';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every permission the user's role has or can receive, and whether the user has it. */
  async describe(tenantId: string, userId: string) {
    const user = await this.findUser(tenantId, userId);
    const { revoked, granted } = await this.overridesOf(tenantId, userId);
    const byRole = rolePermissions(user.role);
    const grantable = grantablePermissions(user.role);
    const effective = effectivePermissions(user.role, revoked, granted);

    return {
      userId,
      role: user.role,
      restrictable: user.role !== 'MASTER',
      effective,
      permissions: PERMISSION_CATALOG.filter(
        (entry) => byRole.includes(entry.key) || grantable.includes(entry.key),
      ).map(({ key, group, label }) => ({
        key,
        group,
        label,
        allowed: effective.includes(key),
        // 'role': the role has it and it can be withdrawn. 'grant': the role lacks it and it
        // can be given to this user.
        source: byRole.includes(key) ? ('role' as const) : ('grant' as const),
      })),
    };
  }

  /**
   * Replaces what was withdrawn from a user and what was given to them. A withdrawn permission
   * must be one the role has; a granted one, one the role can receive.
   */
  async replace(
    tenantId: string,
    userId: string,
    actorId: string,
    revoked: string[],
    granted: string[] = [],
  ) {
    const user = await this.findUser(tenantId, userId);
    if (user.role === 'MASTER') {
      throw new ConflictException({
        statusCode: 409,
        code: 'PERMISSIONS_NOT_RESTRICTABLE',
        message: 'El titular de la cuenta conserva siempre todos los permisos.',
      });
    }

    const byRole = rolePermissions(user.role) as string[];
    const grantable = grantablePermissions(user.role) as string[];
    const unique = [...new Set(revoked)];
    const uniqueGranted = [...new Set(granted)];
    const invalid = (message: string) =>
      new BadRequestException({ statusCode: 400, code: 'PERMISSION_INVALID', message });

    const unknown = [...unique, ...uniqueGranted].find((permission) => !isPermission(permission));
    if (unknown !== undefined) throw invalid(`Permiso desconocido: ${unknown}`);
    const outsideRole = unique.find((permission) => !byRole.includes(permission));
    if (outsideRole !== undefined) {
      throw invalid(`El rol del usuario no tiene el permiso ${outsideRole}`);
    }
    const notGrantable = uniqueGranted.find((permission) => !grantable.includes(permission));
    if (notGrantable !== undefined) {
      throw invalid(`El permiso ${notGrantable} no se puede conceder a este rol`);
    }

    const rows = [
      ...unique.map((permission) => ({ permission, granted: false })),
      ...uniqueGranted.map((permission) => ({ permission, granted: true })),
    ];
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx);
      await tx.userPermission.deleteMany({ where: { tenantId, userId } });
      if (rows.length > 0) {
        await tx.userPermission.createMany({
          data: rows.map((row) => ({ tenantId, userId, createdById: actorId, ...row })),
        });
      }
    });

    return this.describe(tenantId, userId);
  }

  private async findUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  private async overridesOf(tenantId: string, userId: string) {
    const rows = await this.prisma.userPermission.findMany({
      where: { tenantId, userId },
      select: { permission: true, granted: true },
    });
    const of = (granted: boolean) =>
      rows.filter((row) => row.granted === granted).map(({ permission }) => permission);
    return { revoked: of(false), granted: of(true) };
  }
}
