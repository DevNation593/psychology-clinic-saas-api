import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformAuditInput {
  tenantId: string;
  actorId: string;
  entity: 'TENANT' | 'USER';
  entityId: string;
  reason?: string;
  changes?: { before: unknown; after: unknown };
}

/** Writes the audit trail of actions a platform ADMIN performs on a clinic. */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: PlatformAuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'UPDATE',
        entity: input.entity,
        entityId: input.entityId,
        reason: input.reason,
        changes: input.changes as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
