import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { grantablePermissions, Permission, rolePermissions } from './permission-catalog';

export interface PermissionSubject {
  userId: string;
  tenantId: string;
  role: string;
}

/**
 * Answers whether a user has a permission: the role's, unless it was withdrawn from them, or
 * one given to them beyond the role. The account holder is never restricted.
 */
@Injectable()
export class PermissionChecker {
  constructor(private readonly prisma: PrismaService) {}

  async isWithdrawn(user: PermissionSubject, permission: Permission): Promise<boolean> {
    if (user.role === 'MASTER') return false;
    const withdrawn = await this.prisma.userPermission.findFirst({
      where: { userId: user.userId, tenantId: user.tenantId, permission, granted: false },
      select: { id: true },
    });
    return withdrawn !== null;
  }

  /** Whether the permission was given to a user whose role lacks it but can receive it. */
  async isGranted(user: PermissionSubject, permission: Permission): Promise<boolean> {
    if (!grantablePermissions(user.role).includes(permission)) return false;
    const granted = await this.prisma.userPermission.findFirst({
      where: { userId: user.userId, tenantId: user.tenantId, permission, granted: true },
      select: { id: true },
    });
    return granted !== null;
  }

  /** Throws PERMISSION_DENIED (403) when the user does not have the permission. */
  async assertAllowed(user: PermissionSubject, permission: Permission): Promise<void> {
    if (user.role === 'MASTER') return;

    if (!rolePermissions(user.role).includes(permission)) {
      if (await this.isGranted(user, permission)) return;
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Tu cuenta no tiene este permiso. El titular del consultorio puede concederlo.',
        permission,
      });
    }
    if (await this.isWithdrawn(user, permission)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'El titular del consultorio retiró este permiso de tu cuenta.',
        permission,
      });
    }
  }
}
