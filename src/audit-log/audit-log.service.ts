import { Injectable } from '@nestjs/common';
import { AuditLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CLINICAL_AUDIT_ENTITIES } from '../clinical-access/clinical-audit.service';
import { ClinicalCryptoService } from '../clinical-access/clinical-crypto.service';

const userSelect = { id: true, firstName: true, lastName: true, email: true } as const;

@Injectable()
export class AuditLogService {
  constructor(
    private prisma: PrismaService,
    private readonly crypto: ClinicalCryptoService,
  ) {}

  async findAll(
    tenantId: string,
    viewerId: string,
    filters?: {
      entity?: string;
      entityId?: string;
      userId?: string;
      action?: string;
      from?: string;
      to?: string;
    },
  ) {
    const where: any = { tenantId };

    if (filters?.entity) {
      where.entity = filters.entity;
    }

    if (filters?.entityId) {
      where.entityId = filters.entityId;
    }

    if (filters?.userId) {
      where.userId = filters.userId;
    }

    if (filters?.action) {
      where.action = filters.action;
    }

    if (filters?.from || filters?.to) {
      where.createdAt = {};
      if (filters.from) {
        where.createdAt.gte = new Date(filters.from);
      }
      if (filters.to) {
        where.createdAt.lte = new Date(filters.to);
      }
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      include: { user: { select: userSelect } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return this.hideClinicalContent(tenantId, viewerId, logs);
  }

  async findByEntity(tenantId: string, viewerId: string, entity: string, entityId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        entity: entity as any,
        entityId,
      },
      include: { user: { select: userSelect } },
      orderBy: { createdAt: 'desc' },
    });

    return this.hideClinicalContent(tenantId, viewerId, logs);
  }

  /**
   * Clinical entries carry before/after snapshots of the record. A viewer without an active
   * professional profile still sees who did what and when, but not the clinical content.
   */
  private async hideClinicalContent<T extends AuditLog>(
    tenantId: string,
    viewerId: string,
    logs: T[],
  ): Promise<(T & { contentRedacted: boolean })[]> {
    const profile = await this.prisma.professionalProfile.findFirst({
      where: { userId: viewerId, isActive: true, user: { tenantId, isActive: true } },
      select: { userId: true },
    });

    return logs.map((log) => {
      if (!CLINICAL_AUDIT_ENTITIES.includes(log.entity)) {
        return { ...log, contentRedacted: false };
      }
      if (!profile) {
        return { ...log, changes: null, reason: null, contentRedacted: true };
      }
      return {
        ...log,
        changes: this.crypto.decryptJson(tenantId, log.changes),
        reason: log.reason === null ? null : this.crypto.decrypt(tenantId, log.reason),
        contentRedacted: false,
      };
    });
  }
}
