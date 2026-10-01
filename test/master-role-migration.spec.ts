import { spawnSync } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { auditMasterRoles, hasBlockingIssues } from '../prisma/audit-master-roles';

type Row = { id: string; tenantId: string; role: string; professionalProfile?: unknown };

function fakeClient(tenantIds: string[], users: Row[]) {
  return {
    tenant: { findMany: async () => tenantIds.map((id) => ({ id })) },
    user: {
      findMany: async ({
        where,
      }: {
        where: { role: string | { in: string[] }; professionalProfile?: null };
      }) => {
        const roles = typeof where.role === 'string' ? [where.role] : where.role.in;
        return users.filter(
          (user) =>
            roles.includes(user.role) &&
            (where.professionalProfile === undefined || !user.professionalProfile),
        );
      },
    },
  };
}

describe('master role migration', () => {
  it('exposes MASTER in the generated client', () => {
    const roles = Prisma.dmmf.datamodel.enums.find((item) => item.name === 'UserRole');
    expect(roles?.values.map((value) => value.name)).toContain('MASTER');
  });

  it('reports a clean database as non-blocking', async () => {
    const audit = await auditMasterRoles(
      fakeClient(
        ['t1'],
        [
          { id: 'u1', tenantId: 't1', role: 'MASTER' },
          { id: 'u2', tenantId: 't1', role: 'PROFESIONAL', professionalProfile: { id: 'p' } },
        ],
      ) as never,
    );
    expect(audit).toEqual({
      tenantsWithoutMaster: [],
      tenantsWithoutClinicUsers: [],
      tenantsWithMultipleMasters: [],
      legacyRoleUsers: [],
      tenantAdmins: [],
      professionalsWithoutProfile: [],
    });
    expect(hasBlockingIssues(audit)).toBe(false);
  });

  it('flags tenants with zero or several masters and leftover legacy or admin roles', async () => {
    const audit = await auditMasterRoles(
      fakeClient(
        ['t1', 't2'],
        [
          { id: 'u1', tenantId: 't1', role: 'MASTER' },
          { id: 'u2', tenantId: 't1', role: 'MASTER' },
          { id: 'u3', tenantId: 't1', role: 'CLIENTE' },
          { id: 'u4', tenantId: 't2', role: 'PSICOLOGO' },
          { id: 'u5', tenantId: 't2', role: 'ADMIN' },
        ],
      ) as never,
    );
    expect(audit.tenantsWithoutMaster).toEqual(['t2']);
    expect(audit.tenantsWithMultipleMasters).toEqual(['t1']);
    expect(audit.legacyRoleUsers).toEqual(['u3', 'u4']);
    expect(audit.tenantAdmins).toEqual(['u5']);
    expect(hasBlockingIssues(audit)).toBe(true);
  });

  it('treats a support-only tenant as informational, not blocking', async () => {
    const audit = await auditMasterRoles(
      fakeClient(
        ['t1', 'support'],
        [
          { id: 'u1', tenantId: 't1', role: 'MASTER' },
          { id: 'u2', tenantId: 'support', role: 'SOPORTE' },
        ],
      ) as never,
    );
    expect(audit.tenantsWithoutMaster).toEqual([]);
    expect(audit.tenantsWithoutClinicUsers).toEqual(['support']);
    expect(hasBlockingIssues(audit)).toBe(false);
  });

  it('treats a tenant with zero users as informational, not blocking', async () => {
    const audit = await auditMasterRoles(
      fakeClient(['t1', 'empty'], [{ id: 'u1', tenantId: 't1', role: 'MASTER' }]) as never,
    );
    expect(audit.tenantsWithoutClinicUsers).toEqual(['empty']);
    expect(hasBlockingIssues(audit)).toBe(false);
  });

  it('blocks a tenant with only professionals and no master', async () => {
    const audit = await auditMasterRoles(
      fakeClient(
        ['t1'],
        [{ id: 'u1', tenantId: 't1', role: 'PROFESIONAL', professionalProfile: { id: 'p' } }],
      ) as never,
    );
    expect(audit.tenantsWithoutMaster).toEqual(['t1']);
    expect(audit.tenantsWithoutClinicUsers).toEqual([]);
    expect(hasBlockingIssues(audit)).toBe(true);
  });

  it('lists professionals without a profile without blocking', async () => {
    const audit = await auditMasterRoles(
      fakeClient(
        ['t1'],
        [
          { id: 'u1', tenantId: 't1', role: 'MASTER' },
          { id: 'u2', tenantId: 't1', role: 'PROFESIONAL' },
        ],
      ) as never,
    );
    expect(audit.professionalsWithoutProfile).toEqual(['u2']);
    expect(hasBlockingIssues(audit)).toBe(false);
  });

  // A guard moved after the connection would surface a connection error instead.
  it('runs the npm verifier entry point and rejects an unsafe base URL without disclosing it', () => {
    const result = spawnSync(
      process.execPath,
      [process.env.npm_execpath!, 'run', '--silent', 'prisma:verify-master-role-migration'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          DATABASE_URL_TEST:
            'postgresql://secret-user:secret-password@127.0.0.1:1/psic_clinic_test',
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('Specialty stage requires the exact disposable database');
    expect(result.stdout).not.toContain('secret');
  });
});
