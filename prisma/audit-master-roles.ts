import { PrismaClient } from '@prisma/client';

export type MasterRoleAudit = {
  tenantsWithoutMaster: string[];
  tenantsWithoutClinicUsers: string[];
  tenantsWithMultipleMasters: string[];
  legacyRoleUsers: string[];
  tenantAdmins: string[];
  professionalsWithoutProfile: string[];
};

type AuditClient = Pick<PrismaClient, 'tenant' | 'user'>;

export async function auditMasterRoles(client: AuditClient): Promise<MasterRoleAudit> {
  const tenants = await client.tenant.findMany({ select: { id: true } });
  const masters = await client.user.findMany({
    where: { role: 'MASTER' },
    select: { id: true, tenantId: true },
  });
  const mastersPerTenant = new Map<string, number>();
  for (const master of masters) {
    mastersPerTenant.set(master.tenantId, (mastersPerTenant.get(master.tenantId) ?? 0) + 1);
  }
  const legacy = await client.user.findMany({
    where: { role: { in: ['CLIENTE', 'PSICOLOGO'] } },
    select: { id: true, tenantId: true },
  });
  const admins = await client.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, tenantId: true },
  });
  const withoutProfile = await client.user.findMany({
    where: { role: 'PROFESIONAL', professionalProfile: null },
    select: { id: true, tenantId: true },
  });

  const clinicUsers = await client.user.findMany({
    where: { role: { in: ['PROFESIONAL', 'ASISTENTE', 'ADMIN'] } },
    select: { id: true, tenantId: true },
  });
  const tenantsWithClinicUsers = new Set(clinicUsers.map((user) => user.tenantId));
  const withoutMaster = tenants.filter((t) => !mastersPerTenant.has(t.id));

  return {
    // Only tenants that actually have clinic users need a MASTER; support or empty tenants do not.
    tenantsWithoutMaster: withoutMaster.filter((t) => tenantsWithClinicUsers.has(t.id)).map((t) => t.id),
    tenantsWithoutClinicUsers: withoutMaster
      .filter((t) => !tenantsWithClinicUsers.has(t.id))
      .map((t) => t.id),
    tenantsWithMultipleMasters: tenants
      .filter((t) => (mastersPerTenant.get(t.id) ?? 0) > 1)
      .map((t) => t.id),
    legacyRoleUsers: legacy.map((user) => user.id),
    tenantAdmins: admins.map((user) => user.id),
    professionalsWithoutProfile: withoutProfile.map((user) => user.id),
  };
}

/** Professionals without a profile need a manual fix by the account holder; they do not block. */
export function hasBlockingIssues(audit: MasterRoleAudit): boolean {
  return (
    audit.tenantsWithoutMaster.length > 0 ||
    audit.tenantsWithMultipleMasters.length > 0 ||
    audit.legacyRoleUsers.length > 0 ||
    audit.tenantAdmins.length > 0
  );
}

if (require.main === module) {
  const client = new PrismaClient();
  auditMasterRoles(client)
    .then((audit) => {
      console.log(JSON.stringify(audit, null, 2));
      if (hasBlockingIssues(audit)) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => client.$disconnect());
}
