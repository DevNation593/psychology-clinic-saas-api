import { PrismaClient } from '@prisma/client';
import { SECTION_KEYS } from '../src/common/sections/section-catalog';

export interface PlatformSectionsAudit {
  tenantsWithMissingSections: string[];
  platformTenants: string[];
  adminsOutsidePlatform: string[];
  activeSupportUsers: string[];
}

type AuditClient = Pick<PrismaClient, 'tenant' | 'user' | 'tenantModule'>;

export async function auditPlatformSections(client: AuditClient): Promise<PlatformSectionsAudit> {
  const tenants = await client.tenant.findMany({ select: { id: true, isPlatform: true } });
  const platformIds = new Set(tenants.filter((t) => t.isPlatform).map((t) => t.id));

  const rows = await client.tenantModule.findMany({
    where: { moduleKey: { in: [...SECTION_KEYS] } },
    select: { tenantId: true, moduleKey: true },
  });
  const sectionsPerTenant = new Map<string, Set<string>>();
  for (const row of rows) {
    const keys = sectionsPerTenant.get(row.tenantId) ?? new Set<string>();
    keys.add(row.moduleKey);
    sectionsPerTenant.set(row.tenantId, keys);
  }

  const admins = await client.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, tenantId: true },
  });
  const support = await client.user.findMany({
    where: { role: 'SOPORTE', isActive: true },
    select: { id: true },
  });

  return {
    // The platform tenant is not a clinic and carries no section rows.
    tenantsWithMissingSections: tenants
      .filter((t) => !t.isPlatform)
      .filter((t) => (sectionsPerTenant.get(t.id)?.size ?? 0) < SECTION_KEYS.length)
      .map((t) => t.id),
    platformTenants: [...platformIds],
    adminsOutsidePlatform: admins.filter((u) => !platformIds.has(u.tenantId)).map((u) => u.id),
    activeSupportUsers: support.map((u) => u.id),
  };
}

export function hasBlockingIssues(audit: PlatformSectionsAudit): boolean {
  return (
    audit.tenantsWithMissingSections.length > 0 ||
    audit.platformTenants.length > 1 ||
    audit.adminsOutsidePlatform.length > 0 ||
    audit.activeSupportUsers.length > 0
  );
}
