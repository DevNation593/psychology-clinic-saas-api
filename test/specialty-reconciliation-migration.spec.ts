import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const sql = readFileSync(
  join(
    __dirname,
    '../prisma/migrations/20260925203000_reconcile_specialty_team_ownership/migration.sql',
  ),
  'utf8',
);
const models = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Set(model.fields.map((field) => field.name)),
  ]),
);

describe('specialty reconciliation migration', () => {
  it('writes only selection, module, ownership and seat tables using real schema columns', () => {
    const targets = [...sql.matchAll(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+"([A-Za-z]+)"/gi)].map(
      (match) => match[1],
    );
    expect(targets.sort()).toEqual(
      [
        'SubscriptionSpecialty',
        'SubscriptionSpecialty',
        'TenantModule',
        'TenantSubscription',
        'User',
      ].sort(),
    );

    for (const match of sql.matchAll(/INSERT INTO\s+"([A-Za-z]+)"\s*\(([^)]+)\)/gi)) {
      const fields = models.get(match[1]);
      expect(fields).toBeDefined();
      for (const column of match[2].matchAll(/"([A-Za-z]+)"/g))
        expect(fields!.has(column[1])).toBe(true);
    }
    for (const match of sql.matchAll(/UPDATE\s+"([A-Za-z]+)"\s+\w+\s+SET\s+"([A-Za-z]+)"/gi)) {
      expect(models.get(match[1])?.has(match[2])).toBe(true);
    }
  });

  it('counts only effective active professionals for each tenant', () => {
    const seatUpdate = sql.slice(sql.indexOf('UPDATE "TenantSubscription"'));
    expect(seatUpdate).toMatch(/account\."tenantId"\s*=\s*subscription\."tenantId"/);
    expect(seatUpdate).toMatch(/account\."isActive"\s*=\s*true/);
    expect(seatUpdate).toMatch(/profile\."isActive"\s*=\s*true/);
  });

  it('derives module IDs from tenant and key and keeps existing module state on conflict', () => {
    const moduleInsert = sql.slice(
      sql.indexOf('INSERT INTO "TenantModule"'),
      sql.indexOf('UPDATE "User"'),
    );
    expect(moduleInsert).toMatch(
      /md5\(selected\."tenantId"\s*\|\|\s*':'\s*\|\|\s*module\."moduleKey"\)/,
    );
    expect(moduleInsert).toMatch(/ON CONFLICT\s*\("tenantId",\s*"moduleKey"\)\s*DO NOTHING/);
    expect(moduleInsert).toMatch(/specialty\."isActive"\s*=\s*true/);
  });
});
