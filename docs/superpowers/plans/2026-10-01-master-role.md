# Rol MASTER — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El dueño de cada consultorio pasa a tener rol `MASTER`; `PROFESIONAL` pierde acceso a los módulos de gestión de la cuenta; `ADMIN` queda en el enum sin permisos de consultorio.

**Architecture:** `MASTER` es un valor nuevo del enum `UserRole`. Una migración de datos promueve un usuario por consultorio y degrada el resto. La capa de roles del API pierde los alias (`CLIENTE`→`ADMIN`, `PSICOLOGO`→`PROFESIONAL`) y compara roles por igualdad; cada `@Roles`, servicio y guard del front sustituye `ADMIN`/`CLIENTE` por `MASTER`. El módulo de equipo solo asigna `PROFESIONAL` y `ASISTENTE`, y el `MASTER` es inmutable.

**Tech Stack:** API: NestJS 11, Prisma 6, PostgreSQL, Jest. Web: Next.js 14, React 18, Zod, Vitest + Testing Library.

**Spec:** `api/docs/superpowers/specs/2026-10-01-master-role-design.md`

## Global Constraints

- Hay dos repositorios git independientes: `api/` y `web/`. Ambos están en la rama `dev`. Antes de la Tarea 1 crea `feat/master-role` en `api/`; antes de la Tarea 5 crea `feat/master-role` en `web/`. Nunca hagas commit en `dev`.
- **No ejecutes `prisma migrate dev`, `prisma migrate deploy`, `prisma db push` ni `npm run prisma:seed`.** El `DATABASE_URL` de `api/.env` apunta a una base alojada en Supabase, no a una local. Las migraciones se escriben a mano como archivos SQL y solo se ejecuta `npx prisma generate`. Aplicarlas es un paso de despliegue del usuario.
- Los tests e2e y el verificador de migración solo corren contra la base desechable de `DATABASE_URL_TEST` (la valida `test/helpers/assert-e2e-database.ts`). Si no está configurada, repórtalo como "no ejecutado"; no los apuntes a otra base.
- `api/prisma/seed.ts` tiene cambios sin confirmar del usuario y `api/prisma/demo-specialty-scenarios.ts`, `api/prisma/seed-demo-specialties.ts`, `api/test/demo-specialty-seed.spec.ts`, `api/test/seed-demo-specialties.spec.ts` no están versionados. Edítalos cuando la tarea lo pida, pero **no los incluyas en ningún commit**; al terminar, informa que quedaron modificados sin confirmar.
- Valores de rol, literales: `MASTER`, `PROFESIONAL`, `ASISTENTE`, `SOPORTE`, `PACIENTE`, `ADMIN`. Tras este plan, `CLIENTE` y `PSICOLOGO` solo aparecen en `schema.prisma`, en migraciones SQL y en `prisma/verify-patient-team-migration.ts`.
- Asignables desde Equipo: solo `PROFESIONAL` y `ASISTENTE`.
- Códigos de error nuevos, literales: `ROLE_NOT_ASSIGNABLE` (400) y `MASTER_IMMUTABLE` (400).
- Etiqueta visible de `MASTER`: `Titular de la cuenta`. Texto para quien no es titular: `Contacta al titular de la cuenta`.
- Sustitución mecánica, sin ampliar permisos: `MASTER` ocupa el lugar de `ADMIN`/`CLIENTE`; `PROFESIONAL` el de `PSICOLOGO`. En particular, crear y editar notas clínicas y planes de sesión queda solo para `PROFESIONAL`.
- No se renombran rutas `/admin/*`, constantes `ROUTES.ADMIN_*`, campos `admin*` del onboarding ni códigos de error existentes que contienen `ADMIN_` (`ADMIN_SPECIALTY_NOT_SELECTED`, `ADMIN_CLINICAL_FIELDS_NOT_ALLOWED`).
- Mensajes de commit: Conventional Commits en inglés, terminados con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Desviaciones respecto al spec

1. **Cupos.** El spec dice que `PROFESIONAL` "cuenta siempre" para el cupo. El código cuenta perfiles profesionales activos sin mirar el rol (`ProfessionalProfilesService.countActiveProfiles`). No se cambia: un admin degradado a `PROFESIONAL` sin perfil no ocupa cupo, y el auditor no necesita la comprobación de "supera el límite del plan".
2. **DTO de usuarios.** El spec restringe el DTO a `PROFESIONAL | ASISTENTE`. Se mantiene `@IsEnum(UserRole)` y la restricción vive en el servicio, porque es la única forma de devolver el código `ROLE_NOT_ASSIGNABLE` (el `ValidationPipe` devolvería un 400 genérico) y porque editar al titular envía `role: 'MASTER'`.
3. **409 por segundo MASTER.** El índice único parcial lo impide en la base. No se añade traducción a 409 en el servicio: ninguna ruta del API puede escribir `MASTER` salvo la creación del consultorio, que crea el consultorio y su único usuario en la misma operación.
4. **RLS.** Se comprobó contra la base configurada: `pg_policies` está vacío. `app.current_user_role` no tiene efecto; solo se actualiza el literal `'CLIENTE'` en `patients.service.ts` por consistencia.

## Review Focus

1. Consultorio con varios admins, el más antiguo inactivo → debe quedar `MASTER` el activo más antiguo, no el inactivo. *(Tarea 1, verificador de migración.)*
2. El titular edita su propio perfil desde Equipo y el formulario envía `role: 'MASTER'` sin cambios → debe guardarse, no fallar con `ROLE_NOT_ASSIGNABLE` ni `MASTER_IMMUTABLE`. *(Tarea 3.)*
3. Un usuario con rol `ADMIN` dentro de un consultorio (uso futuro, o fila escrita a mano) → 403 en todos los endpoints con `@Roles` del consultorio y ningún menú de administración en el front. *(Tareas 2 y 5.)*
4. Un `PROFESIONAL` abre por URL directa `/admin/team`, `/admin/subscription` o `/admin/storage` → ve "Acceso restringido", no la pantalla ni un error del API. *(Tarea 6.)*
5. Soporte revoca el acceso (`revoke-access`) de un titular gestionado por proveedor → debe seguir funcionando; la inmutabilidad del `MASTER` aplica a actores del consultorio, no al flujo de proveedor. *(Tarea 3.)*

---

## Estructura de archivos

**API — crear**
- `prisma/migrations/20261001000000_add_master_role/migration.sql` — agrega el valor de enum.
- `prisma/migrations/20261001000100_backfill_master_role/migration.sql` — migra datos y crea el índice único.
- `prisma/audit-master-roles.ts` — audita una base ya migrada (uso en despliegue).
- `prisma/verify-master-role-migration.ts` — ejecuta la migración sobre un esquema temporal con datos de prueba.
- `test/master-role-migration.spec.ts` — tests del auditor y del punto de entrada del verificador.
- `src/common/roles/role-matrix.spec.ts` — fija la matriz de `@Roles` de todos los controladores.
- `test/master-role.e2e-spec.ts` — reglas del titular de extremo a extremo.

**API — modificar**
- `prisma/schema.prisma`, `package.json`
- `src/common/roles/role-compatibility.ts` (+ `.spec.ts`), `src/common/guards/roles.guard.spec.ts`
- Todos los `*.controller.ts` con `@Roles` y los servicios que comparan roles (lista en la Tarea 2)
- `src/users/users.service.ts`, `src/users/dto/user.dto.ts`, `src/users/users.team.spec.ts`
- Seeds, `test/helpers/create-test-tenant.ts` y documentación

**Web — crear**
- `src/components/layout/restricted-access.tsx` — aviso único de "Acceso restringido".
- `src/hooks/useCanManageAccount.ts` — `true` si el usuario actual es titular o soporte.

**Web — modificar**
- `src/types/index.ts`, `src/types/guards.ts`, `src/types/roles.test.ts`, `src/lib/constants.ts`
- `src/components/layout/sidebar.test.tsx`, páginas `/admin/*`, avisos de límites
- `src/lib/validations/schemas.ts`, `src/features/admin/team/*`

---

### Task 1: Enum, migración de datos y verificación

**Files:**
- Modify: `api/prisma/schema.prisma:17-25`
- Create: `api/prisma/migrations/20261001000000_add_master_role/migration.sql`
- Create: `api/prisma/migrations/20261001000100_backfill_master_role/migration.sql`
- Create: `api/prisma/audit-master-roles.ts`
- Create: `api/prisma/verify-master-role-migration.ts`
- Modify: `api/package.json` (scripts)
- Test: `api/test/master-role-migration.spec.ts`

**Interfaces:**
- Produces: `UserRole.MASTER` en `@prisma/client`; `auditMasterRoles(client): Promise<MasterRoleAudit>`; `hasBlockingIssues(audit): boolean`; scripts npm `prisma:audit-master-roles` y `prisma:verify-master-role-migration`.

- [ ] **Step 1: Crear la rama**

```bash
cd api && git checkout -b feat/master-role
```

- [ ] **Step 2: Escribir el test del auditor (falla)**

Crear `api/test/master-role-migration.spec.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { auditMasterRoles, hasBlockingIssues } from '../prisma/audit-master-roles';

type Row = { id: string; tenantId: string; role: string; professionalProfile?: unknown };

function fakeClient(tenantIds: string[], users: Row[]) {
  return {
    tenant: { findMany: async () => tenantIds.map((id) => ({ id })) },
    user: {
      findMany: async ({ where }: { where: { role: string | { in: string[] }; professionalProfile?: null } }) => {
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
      fakeClient(['t1'], [
        { id: 'u1', tenantId: 't1', role: 'MASTER' },
        { id: 'u2', tenantId: 't1', role: 'PROFESIONAL', professionalProfile: { id: 'p' } },
      ]) as never,
    );
    expect(audit).toEqual({
      tenantsWithoutMaster: [],
      tenantsWithMultipleMasters: [],
      legacyRoleUsers: [],
      tenantAdmins: [],
      professionalsWithoutProfile: [],
    });
    expect(hasBlockingIssues(audit)).toBe(false);
  });

  it('flags tenants with zero or several masters and leftover legacy or admin roles', async () => {
    const audit = await auditMasterRoles(
      fakeClient(['t1', 't2'], [
        { id: 'u1', tenantId: 't1', role: 'MASTER' },
        { id: 'u2', tenantId: 't1', role: 'MASTER' },
        { id: 'u3', tenantId: 't1', role: 'CLIENTE' },
        { id: 'u4', tenantId: 't2', role: 'PSICOLOGO' },
        { id: 'u5', tenantId: 't2', role: 'ADMIN' },
      ]) as never,
    );
    expect(audit.tenantsWithoutMaster).toEqual(['t2']);
    expect(audit.tenantsWithMultipleMasters).toEqual(['t1']);
    expect(audit.legacyRoleUsers).toEqual(['u3', 'u4']);
    expect(audit.tenantAdmins).toEqual(['u5']);
    expect(hasBlockingIssues(audit)).toBe(true);
  });

  it('lists professionals without a profile without blocking', async () => {
    const audit = await auditMasterRoles(
      fakeClient(['t1'], [
        { id: 'u1', tenantId: 't1', role: 'MASTER' },
        { id: 'u2', tenantId: 't1', role: 'PROFESIONAL' },
      ]) as never,
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
          DATABASE_URL_TEST: 'postgresql://secret-user:secret-password@127.0.0.1:1/psic_clinic_test',
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('Specialty stage requires the exact disposable database');
    expect(result.stdout).not.toContain('secret');
  });
});
```

- [ ] **Step 3: Ejecutar y confirmar que falla**

Run: `cd api && npm test -- test/master-role-migration.spec.ts`
Expected: FAIL — `Cannot find module '../prisma/audit-master-roles'`.

- [ ] **Step 4: Actualizar el enum en `schema.prisma`**

Reemplazar el bloque `enum UserRole` (líneas 17-25) por:

```prisma
enum UserRole {
  CLIENTE // Obsoleto: migrado a MASTER. Se conserva porque Postgres no permite quitar valores de un enum.
  PSICOLOGO // Obsoleto: migrado a PROFESIONAL.
  ADMIN // Reservado para uso futuro. No concede acceso dentro de un consultorio.
  PROFESIONAL
  ASISTENTE
  SOPORTE // Soporte técnico con acceso a todos los módulos
  PACIENTE // Paciente de un cliente
  MASTER // Titular de la cuenta del consultorio. Uno por tenant (índice parcial User_tenantId_master_key).
}
```

- [ ] **Step 5: Escribir las dos migraciones**

`api/prisma/migrations/20261001000000_add_master_role/migration.sql`:

```sql
-- Separate migration: Postgres cannot use a new enum value in the transaction that adds it.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MASTER';
```

`api/prisma/migrations/20261001000100_backfill_master_role/migration.sql`:

```sql
-- One MASTER per tenant: active accounts first, then the oldest.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "tenantId"
    ORDER BY "isActive" DESC, "createdAt" ASC, "id" ASC
  ) AS position
  FROM "User"
  WHERE "role" IN ('ADMIN', 'CLIENTE')
)
UPDATE "User" AS account
SET "role" = 'MASTER'
FROM ranked
WHERE account."id" = ranked."id" AND ranked.position = 1;

-- Remaining administrators and every legacy psychologist become professionals.
UPDATE "User"
SET "role" = 'PROFESIONAL'
WHERE "role" IN ('ADMIN', 'CLIENTE', 'PSICOLOGO');

-- Prisma cannot express partial indexes; this one lives only in SQL.
CREATE UNIQUE INDEX "User_tenantId_master_key" ON "User" ("tenantId") WHERE "role" = 'MASTER';
```

- [ ] **Step 6: Regenerar el cliente**

Run: `cd api && npx prisma generate`
Expected: `Generated Prisma Client`. No se conecta a la base.

- [ ] **Step 7: Escribir el auditor**

Crear `api/prisma/audit-master-roles.ts`:

```ts
import { PrismaClient } from '@prisma/client';

export type MasterRoleAudit = {
  tenantsWithoutMaster: string[];
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

  return {
    tenantsWithoutMaster: tenants.filter((t) => !mastersPerTenant.has(t.id)).map((t) => t.id),
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
```

- [ ] **Step 8: Escribir el verificador de migración**

Crear `api/prisma/verify-master-role-migration.ts`. Sigue el patrón de `prisma/verify-patient-team-migration.ts`: despliega las migraciones previas en un esquema temporal, inserta datos antiguos, despliega las dos nuevas y comprueba el resultado.

```ts
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertSpecialtyStageDatabaseSafety } from '../test/helpers/assert-e2e-database';
import { auditMasterRoles, hasBlockingIssues } from './audit-master-roles';

const targetMigrations = ['20261001000000_add_master_role', '20261001000100_backfill_master_role'];
const schemaPattern = /^master_role_[a-f0-9]+$/;

type RoleRow = { id: string; role: string };

function clientFor(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

function urlForSchema(baseUrl: string, schema: string): string {
  const parsed = new URL(baseUrl);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

function deploy(schemaPath: string, url: string): string {
  const cli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: join(schemaPath, '..', '..'),
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.error) throw new Error(`Prisma migration process failed: ${result.error.message}`);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (
    !output.includes('All migrations have been successfully applied') &&
    !output.includes('Your database is now in sync')
  ) {
    // Credentials are stripped before the output reaches a log.
    throw new Error(
      `Migration deploy failed\n${output.replace(/(postgres(?:ql)?:\/\/)[^@\s/]*@/gi, '$1***@').trim().slice(-2000)}`,
    );
  }
  return output;
}

function copyMigrations(destination: string, includeTargets: boolean): void {
  const source = join(__dirname, 'migrations');
  const target = join(destination, 'migrations');
  mkdirSync(target, { recursive: true });
  copyFileSync(join(source, 'migration_lock.toml'), join(target, 'migration_lock.toml'));
  for (const name of readdirSync(source)
    .filter((item) => /^\d+_/.test(item))
    .sort()) {
    if (targetMigrations.includes(name) && !includeTargets) continue;
    cpSync(join(source, name), join(target, name), { recursive: true });
  }
}

async function addUser(
  client: PrismaClient,
  id: string,
  tenantId: string,
  role: string,
  createdAt: string,
  active = true,
): Promise<void> {
  await client.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "tenantId", "email", "password", "firstName", "lastName", "role", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'fixture', 'Fixture', 'User', $4::"UserRole", $5, $6::timestamp, CURRENT_TIMESTAMP)`,
    id,
    tenantId,
    `${id}@example.test`,
    role,
    active,
    createdAt,
  );
}

export async function verifyMasterRoleMigration(
  databaseUrl: string | undefined = process.env.DATABASE_URL_TEST,
): Promise<{ migratedUsers: number; rejectedSecondMaster: true }> {
  assertSpecialtyStageDatabaseSafety(databaseUrl);
  const baseUrl = databaseUrl!;
  const temporary = mkdtempSync(join(tmpdir(), 'master-role-migration-'));
  const schemaDir = join(temporary, 'prisma');
  mkdirSync(schemaDir);
  const schemaPath = join(schemaDir, 'schema.prisma');
  copyFileSync(join(__dirname, 'schema.prisma'), schemaPath);
  const administrator = clientFor(baseUrl);
  const schema = `master_role_${randomBytes(8).toString('hex')}`;
  if (!schemaPattern.test(schema)) throw new Error('Invalid generated schema');
  const client = clientFor(urlForSchema(baseUrl, schema));

  try {
    await administrator.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    copyMigrations(schemaDir, false);
    deploy(schemaPath, urlForSchema(baseUrl, schema));

    for (const tenantId of ['tenant_a', 'tenant_b']) {
      await client.$executeRawUnsafe(
        `INSERT INTO "Tenant" ("id", "name", "email", "updatedAt") VALUES ($1, $1, $2, CURRENT_TIMESTAMP)`,
        tenantId,
        `${tenantId}@example.test`,
      );
    }
    // tenant_a: the oldest administrator wins; the newer one and the psychologist are demoted.
    await addUser(client, 'a_admin_old', 'tenant_a', 'ADMIN', '2026-01-01');
    await addUser(client, 'a_cliente_new', 'tenant_a', 'CLIENTE', '2026-02-01');
    await addUser(client, 'a_psicologo', 'tenant_a', 'PSICOLOGO', '2026-01-15');
    await addUser(client, 'a_asistente', 'tenant_a', 'ASISTENTE', '2026-01-10');
    // tenant_b: an inactive administrator is older than the active one; the active one wins.
    await addUser(client, 'b_admin_inactive_old', 'tenant_b', 'ADMIN', '2026-01-01', false);
    await addUser(client, 'b_admin_active_new', 'tenant_b', 'ADMIN', '2026-03-01');

    rmSync(join(schemaDir, 'migrations'), { recursive: true, force: true });
    copyMigrations(schemaDir, true);
    deploy(schemaPath, urlForSchema(baseUrl, schema));

    const rows = await client.$queryRawUnsafe<RoleRow[]>(
      `SELECT "id", "role"::text AS role FROM "User" ORDER BY "id"`,
    );
    const actual = Object.fromEntries(rows.map((row) => [row.id, row.role]));
    const expected = {
      a_admin_old: 'MASTER',
      a_asistente: 'ASISTENTE',
      a_cliente_new: 'PROFESIONAL',
      a_psicologo: 'PROFESIONAL',
      b_admin_active_new: 'MASTER',
      b_admin_inactive_old: 'PROFESIONAL',
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Backfill produced unexpected roles: ${JSON.stringify(actual)}`);
    }

    let rejected = false;
    try {
      await addUser(client, 'a_second_master', 'tenant_a', 'MASTER', '2026-04-01');
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('A second MASTER was accepted for the same tenant');

    const audit = await auditMasterRoles(client);
    if (hasBlockingIssues(audit)) {
      throw new Error(`Audit found blocking issues: ${JSON.stringify(audit)}`);
    }
    const demoted = ['a_cliente_new', 'a_psicologo', 'b_admin_inactive_old'];
    if (JSON.stringify([...audit.professionalsWithoutProfile].sort()) !== JSON.stringify(demoted)) {
      throw new Error('Audit did not list the demoted users lacking a professional profile');
    }
    return { migratedUsers: rows.length, rejectedSecondMaster: true };
  } finally {
    await client.$disconnect();
    if (!schemaPattern.test(schema)) throw new Error('Invalid generated schema on cleanup');
    await administrator.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await administrator.$disconnect();
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  verifyMasterRoleMigration()
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
```

- [ ] **Step 9: Registrar los scripts npm**

En `api/package.json`, dentro de `"scripts"`, después de `"prisma:verify-patient-team-migration"` (añade la coma a esa línea):

```json
    "prisma:audit-master-roles": "ts-node prisma/audit-master-roles.ts",
    "prisma:verify-master-role-migration": "ts-node prisma/verify-master-role-migration.ts"
```

- [ ] **Step 10: Ejecutar el test**

Run: `cd api && npm test -- test/master-role-migration.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 11: Ejecutar el verificador contra la base desechable**

Run: `cd api && npm run prisma:verify-master-role-migration`
Expected: `{"migratedUsers":6,"rejectedSecondMaster":true}`.
Si `DATABASE_URL_TEST` no está configurada, el comando termina con `Specialty stage requires the exact disposable database`: anótalo como "no ejecutado" en tu reporte y continúa. No lo apuntes a otra base.

- [ ] **Step 12: Commit**

```bash
cd api
git add prisma/schema.prisma prisma/migrations/20261001000000_add_master_role prisma/migrations/20261001000100_backfill_master_role prisma/audit-master-roles.ts prisma/verify-master-role-migration.ts test/master-role-migration.spec.ts package.json
git commit -m "feat(api): add MASTER role enum value and data backfill"
```

---

### Task 2: Capa de roles, controladores y servicios del API

Sustitución mecánica en todo `api/src` y `api/test`. Al terminar, la suite unitaria completa pasa y las reglas del módulo de equipo siguen siendo las de antes, con `MASTER` donde decía `ADMIN` (las reglas nuevas llegan en la Tarea 3).

**Files:**
- Modify: `api/src/common/roles/role-compatibility.ts`
- Modify: `api/src/common/roles/role-compatibility.spec.ts`
- Modify: `api/src/common/guards/roles.guard.spec.ts`
- Create: `api/src/common/roles/role-matrix.spec.ts`
- Modify (sustitución): todos los archivos de `api/src` y `api/test` que contengan literales de rol
- Modify (a mano tras la sustitución): `api/src/billing/billing.service.ts:29`, `api/src/users/users.service.ts`, `api/src/users/dto/user.dto.ts:80`

**Interfaces:**
- Consumes: `UserRole.MASTER` (Tarea 1).
- Produces, en `src/common/roles/role-compatibility.ts`:
  - `type CanonicalRole = 'MASTER' | 'PROFESIONAL' | 'ASISTENTE' | 'SOPORTE' | 'PACIENTE' | 'ADMIN'`
  - `toCanonicalRole(role: string): CanonicalRole | undefined`
  - `areRolesEquivalent(actual: string, required: string): boolean`
  - `isMasterRole(role: string): boolean`
  - `isProfessionalRole(role: string): boolean`
  - `isAdminRole` deja de existir.

- [ ] **Step 1: Reescribir los tests de la capa de roles (fallan)**

Reemplazar todo `api/src/common/roles/role-compatibility.spec.ts`:

```ts
import {
  areRolesEquivalent,
  isMasterRole,
  isProfessionalRole,
  toCanonicalRole,
} from './role-compatibility';

describe('role compatibility', () => {
  it.each(['MASTER', 'PROFESIONAL', 'ASISTENTE', 'SOPORTE', 'PACIENTE', 'ADMIN'] as const)(
    'keeps %s as a canonical role',
    (role) => {
      expect(toCanonicalRole(role)).toBe(role);
    },
  );

  it.each(['CLIENTE', 'PSICOLOGO', 'OTRO', ''])('does not resolve %s', (role) => {
    expect(toCanonicalRole(role)).toBeUndefined();
  });

  it('compares roles by identity, without aliases', () => {
    expect(areRolesEquivalent('MASTER', 'MASTER')).toBe(true);
    expect(areRolesEquivalent('ADMIN', 'MASTER')).toBe(false);
    expect(areRolesEquivalent('CLIENTE', 'MASTER')).toBe(false);
    expect(areRolesEquivalent('PSICOLOGO', 'PROFESIONAL')).toBe(false);
    expect(areRolesEquivalent('CLIENTE', 'CLIENTE')).toBe(false);
  });

  it('classifies the account holder and professionals', () => {
    expect(isMasterRole('MASTER')).toBe(true);
    expect(isMasterRole('ADMIN')).toBe(false);
    expect(isMasterRole('CLIENTE')).toBe(false);
    expect(isProfessionalRole('PROFESIONAL')).toBe(true);
    expect(isProfessionalRole('PSICOLOGO')).toBe(false);
    expect(isProfessionalRole('MASTER')).toBe(false);
  });
});
```

En `api/src/common/guards/roles.guard.spec.ts`, reemplazar el bloque `describe('RolesGuard', ...)` completo (líneas 24-54) por:

```ts
describe('RolesGuard', () => {
  it.each([
    ['MASTER', ['MASTER']],
    ['PROFESIONAL', ['MASTER', 'PROFESIONAL']],
    ['ASISTENTE', ['MASTER', 'ASISTENTE', 'PROFESIONAL']],
  ])('allows %s when metadata requires %j', (actual, required) => {
    const { guard, context } = setup(actual, required);
    expect(guard.canActivate(context)).toBe(true);
  });

  it.each(['PROFESIONAL', 'ASISTENTE', 'ADMIN', 'CLIENTE', 'PSICOLOGO', 'SOPORTE', 'PACIENTE'])(
    'rejects %s when metadata requires MASTER',
    (actual) => {
      const { guard, context } = setup(actual, ['MASTER']);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it.each(['ADMIN', 'CLIENTE', 'PSICOLOGO'])(
    'rejects %s on clinical endpoints open to the whole clinic team',
    (actual) => {
      const { guard, context } = setup(actual, ['MASTER', 'ASISTENTE', 'PROFESIONAL']);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it('allows SOPORTE when explicitly declared in metadata', () => {
    const { guard, context } = setup('SOPORTE', ['MASTER', 'SOPORTE']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a public route without a user', () => {
    const { guard, context } = setup(undefined, ['MASTER'], true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a route without role metadata', () => {
    const { guard, context } = setup(undefined);
    expect(guard.canActivate(context)).toBe(true);
  });
});
```

- [ ] **Step 2: Escribir el test de la matriz de controladores (falla)**

Crear `api/src/common/roles/role-matrix.spec.ts`:

```ts
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppointmentsController } from '../../appointments/appointments.controller';
import { AuditLogController } from '../../audit-log/audit-log.controller';
import { BillingController } from '../../billing/billing.controller';
import { ClinicalNotesController } from '../../clinical-notes/clinical-notes.controller';
import { NextSessionPlansController } from '../../next-session-plans/next-session-plans.controller';
import { PatientTeamController } from '../../patient-team/patient-team.controller';
import { PatientsController } from '../../patients/patients.controller';
import { SpecialtiesController } from '../../specialties/specialties.controller';
import { SpecialtyRecordsController } from '../../specialty-records/specialty-records.controller';
import { SubscriptionController } from '../../subscription/subscription.controller';
import { TasksController } from '../../tasks/tasks.controller';
import { TenantSettingsController } from '../../tenant-settings/tenant-settings.controller';
import { TenantsController } from '../../tenants/tenants.controller';
import { UsersController } from '../../users/users.controller';

type Controller = { name: string; prototype: Record<string, unknown> };

const MASTER = ['MASTER'];
const CLINICAL = ['MASTER', 'PROFESIONAL'];
const TEAM = ['MASTER', 'ASISTENTE', 'PROFESIONAL'];

function handlerRoles(controller: Controller, handler: string): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, controller.prototype[handler] as object);
}

function classRoles(controller: Controller): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, controller);
}

describe('role matrix', () => {
  it.each([
    [UsersController, 'create', MASTER],
    [UsersController, 'update', MASTER],
    [UsersController, 'deactivate', MASTER],
    [UsersController, 'activate', MASTER],
    [SubscriptionController, 'upgradePlan', MASTER],
    [SubscriptionController, 'downgradePlan', MASTER],
    [SubscriptionController, 'customizeFeatures', MASTER],
    [TenantsController, 'update', MASTER],
    [TenantsController, 'completeOnboarding', MASTER],
    [TenantSettingsController, 'update', MASTER],
    [SpecialtiesController, 'setSpecialties', MASTER],
    [SpecialtiesController, 'setSpecialtiesLegacy', MASTER],
    [SpecialtiesController, 'updateModule', MASTER],
    [PatientsController, 'remove', MASTER],
    [TasksController, 'remove', MASTER],
    [BillingController, 'createInvoice', CLINICAL],
    [BillingController, 'listInvoices', CLINICAL],
    [BillingController, 'getInvoice', CLINICAL],
    [TasksController, 'create', CLINICAL],
    [TasksController, 'update', CLINICAL],
    [SpecialtyRecordsController, 'create', CLINICAL],
    [ClinicalNotesController, 'findAll', CLINICAL],
    [ClinicalNotesController, 'findOne', CLINICAL],
    [ClinicalNotesController, 'remove', CLINICAL],
    [NextSessionPlansController, 'findAll', CLINICAL],
    [NextSessionPlansController, 'findByPatient', CLINICAL],
    [NextSessionPlansController, 'remove', CLINICAL],
    [ClinicalNotesController, 'create', ['PROFESIONAL']],
    [ClinicalNotesController, 'update', ['PROFESIONAL']],
    [NextSessionPlansController, 'create', ['PROFESIONAL']],
    [NextSessionPlansController, 'update', ['PROFESIONAL']],
    [PatientsController, 'create', TEAM],
    [PatientsController, 'update', TEAM],
  ] as [Controller, string, string[]][])('%p.%s requires %j', (controller, handler, expected) => {
    expect(handlerRoles(controller, handler)).toEqual(expected);
  });

  it.each([
    [AuditLogController, MASTER],
    [AppointmentsController, TEAM],
    [PatientTeamController, TEAM],
  ] as [Controller, string[]][])('%p requires %j on every handler', (controller, expected) => {
    expect(classRoles(controller)).toEqual(expected);
  });

  const controllers: Controller[] = [
    AppointmentsController,
    AuditLogController,
    BillingController,
    ClinicalNotesController,
    NextSessionPlansController,
    PatientTeamController,
    PatientsController,
    SpecialtiesController,
    SpecialtyRecordsController,
    SubscriptionController,
    TasksController,
    TenantSettingsController,
    TenantsController,
    UsersController,
  ];

  // ADMIN is reserved for future use and the legacy names no longer resolve.
  it.each(controllers)('%p grants nothing to ADMIN, CLIENTE or PSICOLOGO', (controller) => {
    const declared = [
      ...(classRoles(controller) ?? []),
      ...Object.getOwnPropertyNames(controller.prototype).flatMap(
        (handler) => handlerRoles(controller, handler) ?? [],
      ),
    ];
    expect(declared).not.toEqual(expect.arrayContaining(['ADMIN']));
    expect(declared).not.toEqual(expect.arrayContaining(['CLIENTE']));
    expect(declared).not.toEqual(expect.arrayContaining(['PSICOLOGO']));
  });
});
```

- [ ] **Step 3: Ejecutar y confirmar que fallan**

Run: `cd api && npm test -- src/common/roles src/common/guards/roles.guard.spec.ts`
Expected: FAIL — `isMasterRole` no existe y la matriz encuentra `ADMIN`/`CLIENTE`/`PSICOLOGO`.

- [ ] **Step 4: Reescribir la capa de roles**

Reemplazar todo `api/src/common/roles/role-compatibility.ts`:

```ts
export type CanonicalRole = 'MASTER' | 'PROFESIONAL' | 'ASISTENTE' | 'SOPORTE' | 'PACIENTE' | 'ADMIN';

const CANONICAL_ROLES: readonly string[] = [
  'MASTER',
  'PROFESIONAL',
  'ASISTENTE',
  'SOPORTE',
  'PACIENTE',
  'ADMIN',
];

/** CLIENTE and PSICOLOGO were migrated away; they resolve to nothing so they match no guard. */
export function toCanonicalRole(role: string): CanonicalRole | undefined {
  return CANONICAL_ROLES.includes(role) ? (role as CanonicalRole) : undefined;
}

export function areRolesEquivalent(actual: string, required: string): boolean {
  const actualCanonical = toCanonicalRole(actual);
  return !!actualCanonical && actualCanonical === toCanonicalRole(required);
}

export const isMasterRole = (role: string): boolean => role === 'MASTER';
export const isProfessionalRole = (role: string): boolean => role === 'PROFESIONAL';
```

- [ ] **Step 5: Sustitución mecánica de literales**

Ejecutar desde `api/` (Git Bash). Solo toca literales de rol entre comillas simples y miembros de `UserRole`; no afecta a identificadores como `ADMIN_SPECIALTY_NOT_SELECTED` ni `adminEmail`.

```bash
cd api
grep -rlE "'(ADMIN|CLIENTE|PSICOLOGO)'|UserRole\.(ADMIN|CLIENTE|PSICOLOGO)|isAdminRole" src test prisma/seed.ts prisma/seed-demo-specialties.ts prisma/demo-specialty-scenarios.ts prisma/reconcile-patient-team-appointments.ts \
  | grep -vE "role-compatibility|roles\.guard\.spec|role-matrix\.spec|master-role-migration\.spec" \
  | xargs sed -i -E "s/'(ADMIN|CLIENTE)'/'MASTER'/g; s/'PSICOLOGO'/'PROFESIONAL'/g; s/UserRole\.(ADMIN|CLIENTE)/UserRole.MASTER/g; s/UserRole\.PSICOLOGO/UserRole.PROFESIONAL/g; s/isAdminRole/isMasterRole/g"
```

`prisma/verify-patient-team-migration.ts` queda fuera a propósito: inserta `'PSICOLOGO'` en un esquema anterior a esta migración.

- [ ] **Step 6: Arreglos a mano tras la sustitución**

1. `api/src/billing/billing.service.ts:29` queda con valores repetidos. Dejarlo así:

```ts
        role: { in: ['MASTER', 'PROFESIONAL'] },
```

2. `api/src/users/users.service.ts`, método `findAll`: el filtro por rol ya no expande alias. Reemplazar el bloque `if (filters?.role) { ... }` por:

```ts
    if (filters?.role) where.role = filters.role as UserRole;
```

3. `api/src/users/users.service.ts`, en `updateInTransaction`, el conteo de otros titulares queda con valores repetidos. Dejarlo así:

```ts
          role: UserRole.MASTER,
```

4. `api/src/users/users.service.ts`, método `listPendingPsychologists`:

```ts
        role: UserRole.PROFESIONAL,
```

5. `api/src/users/dto/user.dto.ts:80`: el ejemplo de Swagger no debe sugerir `MASTER`:

```ts
  @ApiProperty({ enum: UserRole, example: 'PROFESIONAL' })
```

6. Comentarios y textos de Swagger que digan "Admin only", "CLIENTE" o "Psychologist only" en los controladores tocados: cambiar a "Master only" / "Professional only". Ejemplos: `users.controller.ts` (cuatro `summary`), `clinical-notes.controller.ts:19`, comentarios de `clinical-notes.service.ts:81,129,153,182` y `users.service.ts:593`.

- [ ] **Step 7: Revisar los tests sustituidos**

La sustitución convierte tests que probaban alias en duplicados. Recorre el resultado:

```bash
cd api && git diff --stat -- src test
```

En cada `*.spec.ts` modificado:
- En tablas `it.each` con filas que ahora son idénticas (por ejemplo `['MASTER', 'MASTER']` dos veces), deja una sola fila.
- Un test cuyo título habla de "legacy", "alias", "CLIENTE" o "PSICOLOGO" y que ahora repite otro test del mismo archivo: elimínalo. Si no hay otro que cubra el caso, corrige solo el título.
- No cambies aserciones de comportamiento.

- [ ] **Step 8: Comprobar que no quedan literales antiguos**

```bash
cd api && grep -rnE "'(CLIENTE|PSICOLOGO)'|UserRole\.(CLIENTE|PSICOLOGO|ADMIN)|isAdminRole" src test
```

Expected: solo coincidencias en `src/common/roles/role-compatibility.spec.ts`, `src/common/guards/roles.guard.spec.ts`, `src/common/roles/role-matrix.spec.ts` y `test/master-role-migration.spec.ts`.

```bash
cd api && grep -rnE "'ADMIN'" src test
```

Expected: solo en esos mismos cuatro archivos y en `src/common/roles/role-compatibility.ts`.

- [ ] **Step 9: Compilar y ejecutar toda la suite unitaria**

Run: `cd api && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: compila sin errores; todos los tests pasan.
Si un spec falla porque esperaba que `ADMIN` y `MASTER` fueran equivalentes, corrige el test para usar `MASTER`; no reintroduzcas alias.

- [ ] **Step 10: Commit**

No incluyas los archivos de seed (ver Global Constraints).

```bash
cd api
git add src test/*.spec.ts test/*.e2e-spec.ts test/helpers
git reset -q -- test/demo-specialty-seed.spec.ts test/seed-demo-specialties.spec.ts
git status --short
git commit -m "feat(api): replace ADMIN and legacy roles with MASTER across guards and services"
```

Confirma en `git status --short` que `prisma/seed.ts` sigue como ` M` y los archivos demo como `??`.

---

### Task 3: Reglas del titular en el módulo de equipo

**Files:**
- Modify: `api/src/users/users.service.ts` (`createOrInvite` y `updateInTransaction`)
- Test: `api/src/users/users.team.spec.ts`

**Interfaces:**
- Consumes: `isMasterRole`, `isProfessionalRole` (Tarea 2).
- Produces: errores `400 { code: 'ROLE_NOT_ASSIGNABLE' }` y `400 { code: 'MASTER_IMMUTABLE' }`. Desaparecen `TEAM_ROLE_NOT_ALLOWED`, `CANNOT_DEMOTE_SELF` y `LAST_ACTIVE_ADMIN_REQUIRED`.

- [ ] **Step 1: Escribir los tests nuevos (fallan)**

En `api/src/users/users.team.spec.ts`:

a) Elimina los tests existentes que esperan `TEAM_ROLE_NOT_ALLOWED`, `CANNOT_DEMOTE_SELF` o `LAST_ACTIVE_ADMIN_REQUIRED` (localízalos con `grep -n "TEAM_ROLE_NOT_ALLOWED\|CANNOT_DEMOTE_SELF\|LAST_ACTIVE_ADMIN_REQUIRED" src/users/users.team.spec.ts`), y cualquier test que cree o promueva un miembro a `MASTER` esperando éxito.

b) Añade al final del `describe('UsersService clinic team control', ...)`, antes de su cierre, usando los helpers `seed`, `member` y `professional` ya definidos en el archivo:

```ts
  describe('account holder rules', () => {
    it.each(['MASTER', 'ADMIN', 'CLIENTE', 'PSICOLOGO', 'SOPORTE', 'PACIENTE'])(
      'rejects creating a %s member',
      async (role) => {
        seed({ role: 'MASTER' });
        await expect(
          service.createForTenant('tenant-1', member({ role }) as never, 'user-1'),
        ).rejects.toMatchObject({ response: { code: 'ROLE_NOT_ASSIGNABLE' } });
        expect(users).toHaveLength(1);
      },
    );

    it.each(['MASTER', 'ADMIN', 'CLIENTE', 'PSICOLOGO'])(
      'rejects changing an assistant to %s',
      async (role) => {
        seed({ role: 'MASTER' });
        const assistant = seed({ role: 'ASISTENTE' });
        await expect(
          service.update('tenant-1', assistant.id, { role } as never, 'user-1'),
        ).rejects.toMatchObject({ response: { code: 'ROLE_NOT_ASSIGNABLE' } });
        expect(assistant.role).toBe('ASISTENTE');
      },
    );

    it.each(['PROFESIONAL', 'ASISTENTE'])('rejects changing the master to %s', async (role) => {
      const master = seed({ role: 'MASTER' });
      seed({ role: 'ASISTENTE' });
      await expect(
        service.update('tenant-1', master.id, { role } as never, 'user-2'),
      ).rejects.toMatchObject({ response: { code: 'MASTER_IMMUTABLE' } });
      expect(master.role).toBe('MASTER');
    });

    it('rejects deactivating the master, by the master or by anyone else in the clinic', async () => {
      const master = seed({ role: 'MASTER' });
      await expect(service.deactivate('tenant-1', master.id, master.id)).rejects.toMatchObject({
        response: { code: 'MASTER_IMMUTABLE' },
      });
      await expect(service.deactivate('tenant-1', master.id, 'someone-else')).rejects.toMatchObject({
        response: { code: 'MASTER_IMMUTABLE' },
      });
      expect(master.isActive).toBe(true);
    });

    // The team form always sends the current role back, even when only the name changed.
    it('lets the master edit personal data while resending the unchanged MASTER role', async () => {
      const master = seed({ role: 'MASTER' });
      await expect(
        service.update(
          'tenant-1',
          master.id,
          { role: 'MASTER', firstName: 'Nuevo' } as never,
          master.id,
        ),
      ).resolves.toBeDefined();
    });

    // Provider-managed access is granted and revoked by support, outside the clinic's team rules.
    it('lets the provider flow revoke access of a provider-managed master', async () => {
      const master = seed({ role: 'MASTER', managedByProvider: true });
      await expect(service.revokePsychologistAccess('tenant-1', master.id)).resolves.toEqual({
        message: 'Acceso del usuario revocado exitosamente',
      });
    });
  });
```

- [ ] **Step 2: Ejecutar y confirmar que fallan**

Run: `cd api && npm test -- src/users/users.team.spec.ts -t "account holder rules"`
Expected: FAIL — crear `MASTER` se acepta hoy y los códigos nuevos no existen.

- [ ] **Step 3: Implementar las reglas**

En `api/src/users/users.service.ts`:

a) Debajo de `selfUserSelect` (antes de `@Injectable()`), añadir:

```ts
const ASSIGNABLE_TEAM_ROLES: readonly UserRole[] = [UserRole.PROFESIONAL, UserRole.ASISTENTE];

const roleNotAssignable = () =>
  new BadRequestException({
    statusCode: 400,
    code: 'ROLE_NOT_ASSIGNABLE',
    message: 'Solo se pueden asignar los roles Profesional o Asistente.',
  });
```

b) En `createOrInvite`, reemplazar el primer `if` (el que lanza `TEAM_ROLE_NOT_ALLOWED`) por:

```ts
    if (!ASSIGNABLE_TEAM_ROLES.includes(role)) throw roleNotAssignable();
```

c) En `updateInTransaction`, reemplazar estos tres bloques consecutivos —el `if (dto.role && !isMasterRole(dto.role) && ...)` que lanza `TEAM_ROLE_NOT_ALLOWED`, el que lanza `CANNOT_DEMOTE_SELF` y el que lanza `LAST_ACTIVE_ADMIN_REQUIRED` (incluido su `tx.user.count`)— por un único bloque, colocado **antes** del `if` que lanza `CANNOT_DEACTIVATE_SELF`:

```ts
    if (isMasterRole(user.role)) {
      // Support manages provider access outside the clinic's own team rules.
      const changesRole = !!dto.role && dto.role !== user.role;
      if (accessFlow !== 'provider' && (changesRole || dto.isActive === false)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MASTER_IMMUTABLE',
          message: 'El titular de la cuenta no puede cambiar de rol ni desactivarse.',
        });
      }
    } else if (dto.role && !ASSIGNABLE_TEAM_ROLES.includes(dto.role)) {
      throw roleNotAssignable();
    }
```

El resto del método no cambia: `willHaveClinicalCapacity` ya usa `isMasterRole(nextRole) || isProfessionalRole(nextRole)` tras la Tarea 2.

- [ ] **Step 4: Ejecutar los tests del módulo**

Run: `cd api && npm test -- src/users`
Expected: PASS. Si falla algún test antiguo que creaba un segundo administrador como preparación, cambia ese usuario a `seed({ role: 'MASTER' })` (ya existente) o a `PROFESIONAL`, según lo que el test necesite.

- [ ] **Step 5: Comprobar que no quedan códigos retirados**

```bash
cd api && grep -rnE "TEAM_ROLE_NOT_ALLOWED|CANNOT_DEMOTE_SELF|LAST_ACTIVE_ADMIN_REQUIRED" src test
```

Expected: sin resultados.

- [ ] **Step 6: Suite completa y commit**

Run: `cd api && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: PASS.

```bash
cd api
git add src/users
git commit -m "feat(api): make the MASTER immutable and restrict assignable team roles"
```

---

### Task 4: E2E, seeds y documentación del API

**Files:**
- Create: `api/test/master-role.e2e-spec.ts`
- Modify: `api/prisma/seed.ts`, `api/prisma/seed-demo-specialties.ts`, `api/prisma/demo-specialty-scenarios.ts` (ya sustituidos en la Tarea 2; aquí se revisan)
- Modify: `api/docs/API_ENDPOINTS.md`, `api/docs/ARCHITECTURE.md`, `api/PROJECT_SUMMARY.md`
- Modify: `postman/Psychology-Clinic-SaaS-PROD.postman_collection.json` (carpeta raíz del proyecto, fuera de ambos repos)

**Interfaces:**
- Consumes: `createTestTenant`, `TEST_PASSWORD` de `test/helpers/create-test-tenant.ts`; reglas de la Tarea 3.

- [ ] **Step 1: Escribir el test e2e**

Crear `api/test/master-role.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TenantsService } from './../src/tenants/tenants.service';
import { createTestTenant, TEST_PASSWORD } from './helpers/create-test-tenant';

jest.setTimeout(30000);

describe('Master role (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let masterId: string;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    await prisma.cleanDatabase();
    const tenant = await createTestTenant(app.get<TenantsService>(TenantsService), 1);
    tenantId = tenant.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin+1@tenant.test', password: TEST_PASSWORD })
      .expect(200);
    token = login.body.accessToken;

    const owner = await prisma.user.findFirstOrThrow({ where: { tenantId } });
    masterId = owner.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the clinic owner as the only MASTER', async () => {
    const owners = await prisma.user.findMany({ where: { tenantId }, select: { role: true } });
    expect(owners).toEqual([{ role: 'MASTER' }]);
  });

  it.each(['MASTER', 'ADMIN'])('refuses to create a %s team member', async (role) => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantId}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: `extra-${role.toLowerCase()}@tenant.test`,
        password: TEST_PASSWORD,
        firstName: 'Extra',
        lastName: 'User',
        role,
      })
      .expect(400);
    expect(response.body.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('refuses to deactivate the MASTER', async () => {
    const response = await request(app.getHttpServer())
      .delete(`/api/v1/tenants/${tenantId}/users/${masterId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(response.body.code).toBe('MASTER_IMMUTABLE');
  });

  it('refuses to demote the MASTER', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tenants/${tenantId}/users/${masterId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ASISTENTE' })
      .expect(400);
    expect(response.body.code).toBe('MASTER_IMMUTABLE');
  });

  it('rejects a second MASTER at the database level', async () => {
    await expect(
      prisma.user.create({
        data: {
          tenantId,
          email: 'second-master@tenant.test',
          password: 'not-a-real-hash',
          firstName: 'Second',
          lastName: 'Master',
          role: 'MASTER',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
```

- [ ] **Step 2: Ejecutar los e2e**

Run: `cd api && npm run test:e2e`
Expected: PASS en `master-role.e2e-spec.ts` y en el resto de suites e2e.
Requiere la base desechable con las migraciones nuevas aplicadas. Si `test/setup-e2e.ts` rechaza la base o no hay `DATABASE_URL_TEST`, anótalo como "no ejecutado" en tu reporte; no cambies la configuración.
Si otra suite e2e falla porque crea miembros con rol administrador o espera `LAST_ACTIVE_ADMIN_REQUIRED`, actualiza ese test: el miembro pasa a `PROFESIONAL` o `ASISTENTE`, y las aserciones sobre el último administrador se reemplazan por `MASTER_IMMUTABLE`.

- [ ] **Step 3: Revisar los seeds**

```bash
cd api && grep -nE "role:" prisma/seed.ts prisma/seed-demo-specialties.ts prisma/demo-specialty-scenarios.ts
```

Comprueba, para cada consultorio que crean los seeds, que hay exactamente un usuario `MASTER`. Si un seed crea dos usuarios `MASTER` para el mismo consultorio (antes: un `CLIENTE` y un `ADMIN`), cambia el segundo a `PROFESIONAL` y, si no tiene `professionalProfile`, a `ASISTENTE`. En `prisma/demo-specialty-scenarios.ts:5`, el tipo queda:

```ts
export type DemoProfessionalRole = 'PROFESIONAL';
```

Run: `cd api && npm test -- test/demo-specialty-seed.spec.ts test/seed-demo-specialties.spec.ts`
Expected: PASS.

- [ ] **Step 4: Actualizar la documentación**

En `api/docs/API_ENDPOINTS.md`, `api/docs/ARCHITECTURE.md` y `api/PROJECT_SUMMARY.md`, y en `postman/Psychology-Clinic-SaaS-PROD.postman_collection.json`:

```bash
cd api && grep -nE "\b(ADMIN|CLIENTE|PSICOLOGO)\b" docs/API_ENDPOINTS.md docs/ARCHITECTURE.md PROJECT_SUMMARY.md ../postman/Psychology-Clinic-SaaS-PROD.postman_collection.json
```

En cada coincidencia que nombre un rol: `ADMIN`/`CLIENTE` → `MASTER`, `PSICOLOGO` → `PROFESIONAL`. En `docs/ARCHITECTURE.md`, en la sección que describe los roles, añade este párrafo:

```markdown
`MASTER` es el titular de la cuenta del consultorio: hay exactamente uno por tenant (índice único parcial `User_tenantId_master_key`), lo crea el onboarding y no puede cambiar de rol ni desactivarse. `ADMIN` permanece en el enum reservado para uso futuro y no concede acceso dentro de un consultorio. `CLIENTE` y `PSICOLOGO` son valores obsoletos sin usuarios.
```

No modifiques los specs ni planes antiguos bajo `docs/superpowers/`.

- [ ] **Step 5: Commit**

```bash
cd api
git add test/master-role.e2e-spec.ts docs/API_ENDPOINTS.md docs/ARCHITECTURE.md PROJECT_SUMMARY.md
git status --short
git commit -m "test(api): cover MASTER rules end to end and document the role"
```

El archivo de Postman está fuera del repositorio `api/`: queda modificado en disco sin commit. Los seeds tampoco se confirman (Global Constraints).

---

### Task 5: Tipos, guards y sustitución mecánica en Web

**Files:**
- Modify: `web/src/types/index.ts:5-9,422,438,447,828`
- Modify: `web/src/types/guards.ts:17-72`
- Modify: `web/src/lib/constants.ts:226-234`
- Modify: `web/src/types/roles.test.ts`
- Modify (sustitución): todo `web/src` que use literales de rol, `isAdminRole` o `toCanonicalRole`

**Interfaces:**
- Produces, en `@/types`: `UserRole.MASTER`; `type TenantTeamRole = UserRole.MASTER | UserRole.PROFESIONAL | UserRole.ASISTENTE`; `type AssignableTeamRole = UserRole.PROFESIONAL | UserRole.ASISTENTE`.
- Produces, en `@/types/guards`: `isMasterRole(role: UserRole): boolean`, `isProfessionalRole(role: UserRole): boolean`, `canManageUsers(user)`, `canManageSubscription(user)`, `canDeletePatient(user)`, `canAccessClinicalNotes(user)`, `canAddPatientTeamMember(user)`, `canRemovePatientTeamMember(user)`, `canEditAppointment(user, appointment)`. `isAdminRole` y `toCanonicalRole` dejan de existir.

- [ ] **Step 1: Crear la rama**

```bash
cd web && git checkout -b feat/master-role
```

- [ ] **Step 2: Reescribir el test de roles (falla)**

Reemplazar todo `web/src/types/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROLE_LABELS } from '@/lib/constants';
import { UserRole, type Appointment, type User } from './index';
import {
  canAccessClinicalNotes,
  canAddPatientTeamMember,
  canDeletePatient,
  canEditAppointment,
  canManageSubscription,
  canManageUsers,
  canRemovePatientTeamMember,
  hasActiveProfessionalProfile,
  isMasterRole,
  isProfessionalRole,
} from './guards';

const userWith = (role: UserRole) => ({ id: 'user-1', role }) as User;
const ALL_ROLES = Object.values(UserRole);

describe('role families', () => {
  it('has no legacy roles', () => {
    expect(ALL_ROLES.sort()).toEqual(
      ['ADMIN', 'ASISTENTE', 'MASTER', 'PACIENTE', 'PROFESIONAL', 'SOPORTE'].sort(),
    );
  });

  it('classifies only MASTER as the account holder', () => {
    expect(ALL_ROLES.filter(isMasterRole)).toEqual([UserRole.MASTER]);
  });

  it('classifies only PROFESIONAL as professional', () => {
    expect(ALL_ROLES.filter(isProfessionalRole)).toEqual([UserRole.PROFESIONAL]);
  });

  it('labels every role', () => {
    expect(ROLE_LABELS).toEqual({
      MASTER: 'Titular de la cuenta',
      ADMIN: 'Administrador',
      PROFESIONAL: 'Profesional',
      ASISTENTE: 'Asistente',
      SOPORTE: 'Soporte',
      PACIENTE: 'Paciente',
    });
  });

  it('recognizes an active profile regardless of role', () => {
    const master = { role: UserRole.MASTER, professionalProfile: { isActive: true } } as User;
    expect(hasActiveProfessionalProfile(master)).toBe(true);
    expect(
      hasActiveProfessionalProfile({
        ...master,
        professionalProfile: { ...master.professionalProfile!, isActive: false },
      }),
    ).toBe(false);
    expect(hasActiveProfessionalProfile({ ...master, professionalProfile: undefined })).toBe(false);
  });
});

describe('permission matrix', () => {
  const allowed = (guard: (user: User) => boolean) =>
    ALL_ROLES.filter((role) => guard(userWith(role))).sort();

  it.each([
    ['canManageUsers', canManageUsers],
    ['canManageSubscription', canManageSubscription],
    ['canDeletePatient', canDeletePatient],
  ] as const)('%s is limited to the account holder and support', (_name, guard) => {
    expect(allowed(guard)).toEqual([UserRole.MASTER, UserRole.SOPORTE].sort());
  });

  it('opens clinical notes to the account holder, professionals and support', () => {
    expect(allowed(canAccessClinicalNotes)).toEqual(
      [UserRole.MASTER, UserRole.PROFESIONAL, UserRole.SOPORTE].sort(),
    );
  });

  it('lets the clinic team add patient team members', () => {
    expect(allowed(canAddPatientTeamMember)).toEqual(
      [UserRole.MASTER, UserRole.ASISTENTE, UserRole.PROFESIONAL].sort(),
    );
  });

  it('lets only the account holder and assistants remove patient team members', () => {
    expect(allowed(canRemovePatientTeamMember)).toEqual(
      [UserRole.MASTER, UserRole.ASISTENTE].sort(),
    );
  });

  it('lets a professional edit only their own appointments', () => {
    const own = { professionalId: 'user-1' } as Appointment;
    const other = { professionalId: 'user-2' } as Appointment;
    expect(canEditAppointment(userWith(UserRole.PROFESIONAL), own)).toBe(true);
    expect(canEditAppointment(userWith(UserRole.PROFESIONAL), other)).toBe(false);
    expect(canEditAppointment(userWith(UserRole.MASTER), other)).toBe(true);
    expect(canEditAppointment(userWith(UserRole.ASISTENTE), other)).toBe(true);
  });

  // ADMIN is reserved for future use: inside a clinic it unlocks nothing.
  it('grants nothing to ADMIN', () => {
    const admin = userWith(UserRole.ADMIN);
    const guards = [
      canManageUsers,
      canManageSubscription,
      canDeletePatient,
      canAccessClinicalNotes,
      canAddPatientTeamMember,
      canRemovePatientTeamMember,
    ];
    expect(guards.map((guard) => guard(admin))).toEqual(guards.map(() => false));
    expect(canEditAppointment(admin, { professionalId: 'user-1' } as Appointment)).toBe(false);
  });
});
```

- [ ] **Step 3: Ejecutar y confirmar que falla**

Run: `cd web && npx vitest run src/types/roles.test.ts`
Expected: FAIL — `isMasterRole` no se exporta desde `./guards`.

- [ ] **Step 4: Actualizar tipos y constantes**

`web/src/types/index.ts` — en el enum `UserRole` (línea 5), elimina las líneas `CLIENTE` y `PSICOLOGO` y añade `MASTER` como primer miembro. El enum queda con exactamente estos seis miembros:

```ts
export enum UserRole {
  MASTER = 'MASTER',
  ADMIN = 'ADMIN',
  PROFESIONAL = 'PROFESIONAL',
  ASISTENTE = 'ASISTENTE',
  SOPORTE = 'SOPORTE',
  PACIENTE = 'PACIENTE',
}
```

Línea 422, reemplazar `TenantTeamRole` por:

```ts
/** Roles that appear in the clinic team list. */
export type TenantTeamRole = UserRole.MASTER | UserRole.PROFESIONAL | UserRole.ASISTENTE;
/** Roles the account holder can give to a team member. MASTER is never assignable. */
export type AssignableTeamRole = UserRole.PROFESIONAL | UserRole.ASISTENTE;
```

En `CreateTenantUserInput` (línea 438): `role: AssignableTeamRole;`. `UpdateTenantUserInput` (línea 447) conserva `role?: TenantTeamRole;` porque editar al titular reenvía `MASTER`.

Línea 828 (usuario devuelto por el onboarding): `role: UserRole.MASTER;`.

`web/src/lib/constants.ts`, reemplazar `ROLE_LABELS`:

```ts
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.MASTER]: 'Titular de la cuenta',
  [UserRole.ADMIN]: 'Administrador',
  [UserRole.PROFESIONAL]: 'Profesional',
  [UserRole.ASISTENTE]: 'Asistente',
  [UserRole.SOPORTE]: 'Soporte',
  [UserRole.PACIENTE]: 'Paciente',
};
```

- [ ] **Step 5: Reescribir los guards de rol**

En `web/src/types/guards.ts`, reemplazar desde `export function isUserRole` hasta el final de `canDeletePatient` (líneas 17-72) por:

```ts
export function isUserRole(value: string): value is UserRole {
  return Object.values(UserRole).includes(value as UserRole);
}

/** The account holder: the single user that controls the clinic's account. */
export function isMasterRole(role: UserRole): boolean {
  return role === UserRole.MASTER;
}

export function isProfessionalRole(role: UserRole): boolean {
  return role === UserRole.PROFESIONAL;
}

export function canAddPatientTeamMember(user: User): boolean {
  return (
    user.role === UserRole.MASTER ||
    user.role === UserRole.ASISTENTE ||
    user.role === UserRole.PROFESIONAL
  );
}

export function canRemovePatientTeamMember(user: User): boolean {
  return user.role === UserRole.MASTER || user.role === UserRole.ASISTENTE;
}

export function hasActiveProfessionalProfile(user: User): boolean {
  return user.professionalProfile?.isActive === true;
}

export function canAccessClinicalNotes(user: User): boolean {
  return isMasterRole(user.role) || isProfessionalRole(user.role) || user.role === UserRole.SOPORTE;
}

export function canManageUsers(user: User): boolean {
  return isMasterRole(user.role) || user.role === UserRole.SOPORTE;
}

export function canManageSubscription(user: User): boolean {
  return isMasterRole(user.role) || user.role === UserRole.SOPORTE;
}

export function canEditAppointment(
  user: User,
  appointment: Pick<Appointment, 'professionalId'>,
): boolean {
  if (user.role === UserRole.MASTER || user.role === UserRole.ASISTENTE) return true;
  return user.role === UserRole.PROFESIONAL && appointment.professionalId === user.id;
}

export function canDeletePatient(user: User): boolean {
  return isMasterRole(user.role) || user.role === UserRole.SOPORTE;
}
```

- [ ] **Step 6: Sustitución mecánica en el resto de `src`**

Desde `web/` (Git Bash):

```bash
cd web
grep -rlE "'(ADMIN|CLIENTE|PSICOLOGO)'|UserRole\.(ADMIN|CLIENTE|PSICOLOGO)|isAdminRole|toCanonicalRole" src \
  | grep -vE "src/types/(index|guards|roles\.test)\.ts|src/lib/constants\.ts" \
  | xargs sed -i -E "s/'(ADMIN|CLIENTE)'/'MASTER'/g; s/'PSICOLOGO'/'PROFESIONAL'/g; s/UserRole\.(ADMIN|CLIENTE)/UserRole.MASTER/g; s/UserRole\.PSICOLOGO/UserRole.PROFESIONAL/g; s/isAdminRole/isMasterRole/g; s/toCanonicalRole\(([^()]+)\)/\1/g"
```

La última regla convierte `toCanonicalRole(actor.role)` en `actor.role`.

- [ ] **Step 7: Arreglos a mano tras la sustitución**

1. Imports: quita `toCanonicalRole` de las listas de importación donde quedó sin uso. Archivos: `src/features/tasks/task-assignees.ts`, `src/features/calendar/appointment-dialog.tsx`, `src/features/patients/patient-team-tab.tsx`, `src/app/(dashboard)/tasks/page.tsx`, `src/features/admin/team/team-manager.tsx`, `src/features/admin/team/team-member-dialog.tsx`, y los tests que lo importaban. Si la importación queda vacía, elimina la línea.
2. `src/features/admin/team/team-manager.tsx:31-37`, el conjunto queda con duplicados. Dejarlo así:

```ts
const TEAM_USER_ROLES = new Set<UserRole>([
  UserRole.MASTER,
  UserRole.PROFESIONAL,
  UserRole.ASISTENTE,
]);
```

3. `src/lib/validations/schemas.ts:144`, la lista queda con duplicados. Dejarlo así (la Tarea 7 vuelve a tocar este archivo):

```ts
  if (data.role === UserRole.PROFESIONAL && !data.professionalProfile) {
```

4. `src/components/layout/sidebar.test.tsx`: las tablas `it.each` quedan con duplicados. Dejar las dos del primer `describe` así:

```ts
  it.each([UserRole.MASTER, UserRole.SOPORTE])('is shown to %s', async (role) => {
```

```ts
  it.each([UserRole.ASISTENTE, UserRole.PROFESIONAL, UserRole.ADMIN])('is hidden from %s', async (role) => {
```

5. Igual que en el API: en cada `*.test.ts(x)` modificado, elimina filas duplicadas de `it.each` y tests que solo probaban alias heredados.

- [ ] **Step 8: Comprobar que no quedan nombres antiguos**

```bash
cd web && grep -rnE "UserRole\.(CLIENTE|PSICOLOGO)|'(CLIENTE|PSICOLOGO)'|isAdminRole|toCanonicalRole" src
```

Expected: sin resultados.

- [ ] **Step 9: Tipos, lint y tests**

Run: `cd web && npm run type-check && npm run lint && npm test`
Expected: todo en verde. En este punto el diálogo de equipo todavía ofrece el rol del titular como opción asignable; se corrige en la Tarea 7.

- [ ] **Step 10: Commit**

```bash
cd web
git add src
git commit -m "feat(web): introduce the MASTER role and drop legacy role aliases"
```

---

### Task 6: Navegación, bloqueo por URL y avisos de límites

**Files:**
- Create: `web/src/components/layout/restricted-access.tsx`
- Create: `web/src/hooks/useCanManageAccount.ts`
- Modify: `web/src/app/(dashboard)/admin/team/page.tsx`
- Modify: `web/src/app/(dashboard)/admin/subscription/page.tsx:493`
- Modify: `web/src/app/(dashboard)/admin/storage/page.tsx:326`
- Modify: `web/src/app/(dashboard)/admin/specialties/page.tsx`
- Modify: `web/src/features/subscription/feature-locked-notice.tsx:44`
- Modify: `web/src/features/subscription/seat-limit-modal.tsx`, `patient-limit-modal.tsx`, `storage-limit-modal.tsx`, `feature-locked-modal.tsx`
- Modify: `web/src/components/dashboard/usage-widgets.tsx`, `web/src/components/layout/subscription-banners.tsx`
- Test: `web/src/components/layout/sidebar.test.tsx`, `web/src/components/layout/restricted-access.test.tsx`, `web/src/app/(dashboard)/admin/admin-pages-access.test.tsx`

**Interfaces:**
- Consumes: `canManageUsers`, `canManageSubscription`, `isMasterRole` (Tarea 5).
- Produces:
  - `RestrictedAccess(): JSX.Element` en `@/components/layout/restricted-access` — aviso con título `Acceso restringido`.
  - `useCanManageAccount(): boolean` en `@/hooks/useCanManageAccount`.

- [ ] **Step 1: Tests del menú (fallan parcialmente)**

En `web/src/components/layout/sidebar.test.tsx`, añadir al final del archivo:

```ts
describe('Sidebar administration section', () => {
  const adminLinks = ['Equipo', 'Suscripción', 'Almacenamiento', 'Configuración'];

  it('shows every administration entry to the account holder', async () => {
    renderSidebar();
    for (const name of adminLinks) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
  });

  it.each([UserRole.PROFESIONAL, UserRole.ASISTENTE, UserRole.ADMIN])(
    'hides the whole section from %s',
    async (role) => {
      useAuthStore.setState({ user: { ...admin, role } });
      renderSidebar();
      expect(await screen.findByRole('link', { name: 'Pacientes' })).toBeInTheDocument();
      for (const name of [...adminLinks, 'Módulos clínicos']) {
        expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
      }
      expect(screen.queryByText('Administración')).not.toBeInTheDocument();
    },
  );

  // ADMIN is reserved: it is neither the account holder nor a professional.
  it('hides billing from ADMIN', async () => {
    useAuthStore.setState({ user: { ...admin, role: UserRole.ADMIN } });
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'Pacientes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Facturación' })).not.toBeInTheDocument();
  });
});
```

Run: `cd web && npx vitest run src/components/layout/sidebar.test.tsx`
Expected: PASS. El menú ya depende de los guards reescritos en la Tarea 5; estos tests fijan el comportamiento. Si alguno falla, corrige `sidebar.tsx` para que cada entrada use `canManageUsers`/`canManageSubscription` (administración y módulos clínicos) e `isMasterRole || isProfessionalRole` (facturación).

- [ ] **Step 2: Test del aviso y de las páginas (fallan)**

Crear `web/src/components/layout/restricted-access.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RestrictedAccess } from './restricted-access';

describe('RestrictedAccess', () => {
  it('tells the user who can open the page', () => {
    render(<RestrictedAccess />);
    expect(screen.getByText('Acceso restringido')).toBeInTheDocument();
    expect(
      screen.getByText('Solo el titular de la cuenta puede acceder a esta sección.'),
    ).toBeInTheDocument();
  });
});
```

Crear `web/src/app/(dashboard)/admin/admin-pages-access.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { TenantType, UserRole, type Tenant, type User } from '@/types';
import SpecialtiesPage from './specialties/page';
import StorageManagementPage from './storage/page';
import SubscriptionPage from './subscription/page';
import TeamPage from './team/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));

const professional = {
  id: 'user-1',
  email: 'pro@example.com',
  firstName: 'Ana',
  lastName: 'Vega',
  role: UserRole.PROFESIONAL,
  tenantId: 'tenant-a',
} as User;

function renderPage(Page: () => JSX.Element | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    user: professional,
    tenant: { id: 'tenant-a', name: 'tenant-a', tenantType: TenantType.CLINIC } as Tenant,
  });
});

describe('administration pages opened by URL', () => {
  it.each([
    ['team', TeamPage],
    ['subscription', SubscriptionPage],
    ['storage', StorageManagementPage],
    ['specialties', SpecialtiesPage],
  ] as const)('%s shows the restricted notice to a professional', (_name, Page) => {
    renderPage(Page);
    expect(screen.getByText('Acceso restringido')).toBeInTheDocument();
  });

  it.each([UserRole.ASISTENTE, UserRole.ADMIN])('team is restricted for %s', (role) => {
    useAuthStore.setState({ user: { ...professional, role } });
    renderPage(TeamPage);
    expect(screen.getByText('Acceso restringido')).toBeInTheDocument();
  });
});
```

Run: `cd web && npx vitest run src/components/layout/restricted-access.test.tsx "src/app/(dashboard)/admin/admin-pages-access.test.tsx"`
Expected: FAIL — `./restricted-access` no existe.

- [ ] **Step 3: Crear el aviso y el hook**

`web/src/components/layout/restricted-access.tsx`:

```tsx
import { Alert } from '@/components/ui/alert';

/** Shown when an administration page is opened by someone who is not the account holder. */
export function RestrictedAccess() {
  return (
    <Alert variant="warning" title="Acceso restringido">
      Solo el titular de la cuenta puede acceder a esta sección.
    </Alert>
  );
}
```

`web/src/hooks/useCanManageAccount.ts`:

```ts
import { useAuthStore } from '@/store/authStore';
import { canManageSubscription } from '@/types/guards';

/** True for the account holder and support: the only ones who can open the administration pages. */
export function useCanManageAccount(): boolean {
  const user = useAuthStore((state) => state.user);
  return !!user && canManageSubscription(user);
}
```

- [ ] **Step 4: Bloquear las páginas**

`web/src/app/(dashboard)/admin/team/page.tsx`, reemplazar todo:

```tsx
'use client';

import { RestrictedAccess } from '@/components/layout/restricted-access';
import { TeamManager } from '@/features/admin/team/team-manager';
import { useCanManageAccount } from '@/hooks/useCanManageAccount';
import { useAuthStore } from '@/store/authStore';

export default function TeamPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = useCanManageAccount();
  if (!user) return null;
  // The menu entry is hidden for other roles; this covers direct navigation.
  if (!canManage) return <RestrictedAccess />;
  return <TeamManager />;
}
```

`web/src/app/(dashboard)/admin/specialties/page.tsx`, reemplazar todo:

```tsx
'use client';

import { RestrictedAccess } from '@/components/layout/restricted-access';
import { SpecialtyManager } from '@/features/admin/specialties/specialty-manager';
import { useCanManageAccount } from '@/hooks/useCanManageAccount';
import { useAuthStore } from '@/store/authStore';

export default function SpecialtiesPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = useCanManageAccount();
  if (!user) return null;
  // The menu entry is hidden for other roles; this covers direct navigation.
  if (!canManage) return <RestrictedAccess />;
  return <SpecialtyManager />;
}
```

`subscription/page.tsx` y `storage/page.tsx` tienen muchos hooks. Para no romper las reglas de hooks, renombra el componente actual y envuélvelo. En `web/src/app/(dashboard)/admin/subscription/page.tsx`:

1. Cambia la línea 493 `export default function SubscriptionPage() {` por `function SubscriptionPageContent() {`.
2. Añade al final del archivo:

```tsx
export default function SubscriptionPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = useCanManageAccount();
  if (!user) return null;
  // The menu entry is hidden for other roles; this covers direct navigation.
  if (!canManage) return <RestrictedAccess />;
  return <SubscriptionPageContent />;
}
```

3. Añade los imports que falten:

```tsx
import { RestrictedAccess } from '@/components/layout/restricted-access';
import { useCanManageAccount } from '@/hooks/useCanManageAccount';
```

En `web/src/app/(dashboard)/admin/storage/page.tsx` haz lo mismo: la línea 326 `export default function StorageManagementPage() {` pasa a `function StorageManagementPageContent() {`, y al final:

```tsx
export default function StorageManagementPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = useCanManageAccount();
  if (!user) return null;
  // The menu entry is hidden for other roles; this covers direct navigation.
  if (!canManage) return <RestrictedAccess />;
  return <StorageManagementPageContent />;
}
```

con estos imports (añade `useAuthStore` solo si el archivo no lo importa ya):

```tsx
import { RestrictedAccess } from '@/components/layout/restricted-access';
import { useCanManageAccount } from '@/hooks/useCanManageAccount';
import { useAuthStore } from '@/store/authStore';
```

`web/src/app/(dashboard)/admin/settings/page.tsx` no cambia: ya redirige a `/dashboard` con `canManageUsers`.

- [ ] **Step 5: Ejecutar los tests de páginas**

Run: `cd web && npx vitest run src/components/layout "src/app/(dashboard)/admin" src/features/admin/specialties`
Expected: PASS. `src/features/admin/specialties/specialties-page.test.tsx` comprobaba el texto anterior ("Solo los administradores pueden gestionar los módulos clínicos."): actualiza esa aserción a `Solo el titular de la cuenta puede acceder a esta sección.`

- [ ] **Step 6: Avisos de límites y banners**

Quien no es titular no puede abrir `/admin/subscription` ni `/admin/storage`, así que los botones que llevan allí se sustituyen por un texto.

a) `web/src/features/subscription/feature-locked-notice.tsx:44`, cambiar el texto:

```tsx
            : 'Contacta al titular de la cuenta para activar este módulo.'}
```

b) `web/src/features/subscription/seat-limit-modal.tsx`:

Añadir el import:

```tsx
import { useCanManageAccount } from '@/hooks/useCanManageAccount';
```

Dentro del componente, tras `const { data: subscription } = useSubscription();`:

```tsx
  const canManage = useCanManageAccount();
```

Reemplazar el contenido de `<DialogFooter>` (líneas 104-133) por:

```tsx
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>

          {!canManage && (
            <p className="text-sm text-muted-foreground">Contacta al titular de la cuenta.</p>
          )}

          {canManage && currentTier === PlanTier.BASIC && (
            <>
              <Button variant="secondary" onClick={() => {
                onOpenChange(false);
                router.push(ROUTES.ADMIN_SUBSCRIPTION);
              }}>
                Ver Planes
              </Button>

              <Button onClick={handleUpgrade} className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Actualizar a PRO
              </Button>
            </>
          )}

          {canManage && currentTier === PlanTier.PROFESSIONAL && (
            <Button onClick={() => {
              onOpenChange(false);
              router.push(`${ROUTES.ADMIN_SUBSCRIPTION}?action=contact`);
            }} className="gap-2">
              Contactar Ventas
            </Button>
          )}
        </DialogFooter>
```

c) Aplica el mismo patrón en los archivos restantes. En cada uno: importa `useCanManageAccount`, declara `const canManage = useCanManageAccount();` junto a los demás hooks del componente, envuelve en `{canManage && (...)}` cada botón cuyo `onClick` llame a `router.push` con `ROUTES.ADMIN_SUBSCRIPTION` o `ROUTES.ADMIN_STORAGE`, y añade junto a ellos, una sola vez por componente:

```tsx
          {!canManage && (
            <p className="text-sm text-muted-foreground">Contacta al titular de la cuenta.</p>
          )}
```

Localiza los botones con:

```bash
cd web && grep -nE "ROUTES\.ADMIN_(SUBSCRIPTION|STORAGE)" src/features/subscription/patient-limit-modal.tsx src/features/subscription/storage-limit-modal.tsx src/features/subscription/feature-locked-modal.tsx src/components/dashboard/usage-widgets.tsx src/components/layout/subscription-banners.tsx
```

Coincidencias esperadas: `patient-limit-modal.tsx` (2), `storage-limit-modal.tsx` (3), `feature-locked-modal.tsx` (2), `usage-widgets.tsx` (5), `subscription-banners.tsx` (4). Si un `router.push` está dentro de una función `handle…`, envuelve el botón que la usa.

En `usage-widgets.tsx` y `subscription-banners.tsx`, si un componente recibe la acción como prop (por ejemplo `onUpgrade={handleUpgrade}`), pasa `undefined` cuando `!canManage` (`onUpgrade={canManage ? handleUpgrade : undefined}`) y comprueba que el componente hijo no renderiza el botón sin esa prop; si lo renderiza igualmente, añade allí la condición.

d) `web/src/features/admin/team/team-manager.tsx:259`, cambiar el texto del aviso de solo lectura:

```tsx
        <Alert title="Vista de solo lectura" description="Solo el titular de la cuenta puede modificar el equipo." />
```

- [ ] **Step 7: Test de un aviso de límite**

Crear `web/src/features/subscription/seat-limit-modal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { PlanTier, UserRole, type User } from '@/types';
import { SeatLimitModal } from './seat-limit-modal';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    data: { plan: { planType: PlanTier.BASIC, limits: { maxPsychologists: 1 } } },
  }),
}));

const userWith = (role: UserRole) => ({ id: 'user-1', role }) as User;

describe('SeatLimitModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the upgrade to the account holder', () => {
    useAuthStore.setState({ user: userWith(UserRole.MASTER) });
    render(<SeatLimitModal open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Actualizar a PRO' })).toBeInTheDocument();
    expect(screen.queryByText('Contacta al titular de la cuenta.')).not.toBeInTheDocument();
  });

  it('points a professional to the account holder instead of the plans page', () => {
    useAuthStore.setState({ user: userWith(UserRole.PROFESIONAL) });
    render(<SeatLimitModal open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Contacta al titular de la cuenta.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actualizar a PRO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver Planes' })).not.toBeInTheDocument();
  });
});
```

Run: `cd web && npx vitest run src/features/subscription`
Expected: PASS. Si `feature-locked-notice.test.ts` comprobaba el texto antiguo, actualízalo al nuevo.

- [ ] **Step 8: Verificación y commit**

Run: `cd web && npm run type-check && npm run lint && npm test`
Expected: todo en verde.

```bash
cd web
git add src
git commit -m "feat(web): restrict administration pages and upgrade prompts to the account holder"
```

---

### Task 7: Equipo en Web — diálogo, lista y validación

**Files:**
- Modify: `web/src/lib/validations/schemas.ts:127-159`
- Modify: `web/src/features/admin/team/team-member-dialog.tsx`
- Modify: `web/src/features/admin/team/team-manager.tsx:350-401`
- Test: `web/src/features/admin/team/team-member-dialog.test.tsx`, `web/src/features/admin/team/team-manager.test.tsx`, `web/src/lib/validations/onboarding.test.ts` o el test de esquemas que ya cubra `tenantTeamMemberSchema`

**Interfaces:**
- Consumes: `AssignableTeamRole`, `TenantTeamRole`, `isMasterRole`, `ROLE_LABELS` (Tarea 5).
- Produces: `tenantTeamMemberSchema` acepta solo `PROFESIONAL | ASISTENTE`; `tenantTeamMemberUpdateSchema` acepta además `MASTER`.

- [ ] **Step 1: Tests del diálogo (fallan)**

En `web/src/features/admin/team/team-member-dialog.test.tsx`:

a) Elimina los tests que seleccionan el rol del titular en el alta (los que llaman `chooseRole(UserRole.MASTER)` sin pasar `member`) y los que comprueban la transición de rol hacia o desde administrador.

b) Añade dentro del `describe('TeamMemberDialog', ...)`:

```tsx
  it('offers only Profesional and Asistente when adding a member', () => {
    renderDialog();
    const options = Array.from(
      (screen.getByLabelText('Rol') as HTMLSelectElement).options,
    ).map((option) => option.value);
    expect(options).toEqual([UserRole.PROFESIONAL, UserRole.ASISTENTE]);
    expect(screen.queryByLabelText('También atiende pacientes')).not.toBeInTheDocument();
  });

  it('defaults a new member to Profesional', () => {
    renderDialog();
    expect(screen.getByLabelText('Rol')).toHaveValue(UserRole.PROFESIONAL);
  });

  const master = {
    id: 'master-1',
    email: 'titular@example.com',
    firstName: 'Tina',
    lastName: 'Titular',
    role: UserRole.MASTER,
    tenantId: 'tenant-1',
    isActive: true,
  } as User;

  it('shows the account holder role as fixed text, without a role selector', () => {
    renderDialog({ member: master });
    expect(screen.queryByLabelText('Rol')).not.toBeInTheDocument();
    expect(screen.getByText('Titular de la cuenta')).toBeInTheDocument();
    expect(screen.getByLabelText('También atiende pacientes')).not.toBeChecked();
  });

  it('keeps the MASTER role when the account holder edits their name', async () => {
    const { onSubmit } = renderDialog({ member: master });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ role: UserRole.MASTER, firstName: 'Nueva' });
  });

  it('requires a specialty when the account holder starts seeing patients', async () => {
    const { onSubmit } = renderDialog({ member: master });
    fireEvent.click(screen.getByLabelText('También atiende pacientes'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona una especialidad');
    expect(onSubmit).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Tests de la lista (fallan)**

En `web/src/features/admin/team/team-manager.test.tsx`, localiza cómo el archivo prepara la lista de usuarios y el usuario actual (`grep -n "usersApi\|useAuthStore.setState" src/features/admin/team/team-manager.test.tsx`) y añade, con ese mismo mecanismo, un `describe` nuevo. El usuario actual es el titular y la lista contiene al titular y a un asistente:

```tsx
describe('TeamManager account holder row', () => {
  const holder = {
    id: 'master-1',
    email: 'titular@example.com',
    firstName: 'Tina',
    lastName: 'Titular',
    role: UserRole.MASTER,
    tenantId: 'tenant-a',
    isActive: true,
  } as User;
  const assistant = {
    id: 'assistant-1',
    email: 'asistente@example.com',
    firstName: 'Abel',
    lastName: 'Asistente',
    role: UserRole.ASISTENTE,
    tenantId: 'tenant-a',
    isActive: true,
  } as User;

  it('labels the account holder and offers no deactivation for that row', async () => {
    // Arrange with the file's existing helpers: current user = holder, list = [holder, assistant].
    await renderTeamWith({ currentUser: holder, users: [holder, assistant] });

    expect(await screen.findByText('Titular de la cuenta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Tina Titular' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Desactivar cuenta de Tina Titular' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Desactivar cuenta de Abel Asistente' }),
    ).toBeInTheDocument();
  });
});
```

`renderTeamWith` es un ayudante local que debes escribir en este mismo test a partir de la preparación que ya usan los demás tests del archivo: fija `useAuthStore.setState({ user: currentUser, tenant })`, hace que el mock de `usersApi.list` resuelva `users`, y renderiza `<TeamManager />` dentro del `QueryClientProvider`. No dupliques mocks de módulo: reutiliza los `vi.mock` existentes.

- [ ] **Step 3: Ejecutar y confirmar que fallan**

Run: `cd web && npx vitest run src/features/admin/team`
Expected: FAIL — el selector aún ofrece el rol del titular y la fila del titular tiene botón de desactivar.

- [ ] **Step 4: Esquemas de validación**

En `web/src/lib/validations/schemas.ts`, reemplazar desde `const tenantTeamMemberFields = {` hasta `export type TenantTeamMemberFormData` (líneas 127-161) por:

```ts
const tenantTeamMemberBaseFields = {
  email: onboardingEmail,
  firstName: z.string().trim().min(1, 'Ingresa el nombre'),
  lastName: z.string().trim().min(1, 'Ingresa el apellido'),
  phone: z.string().trim().optional(),
  professionalProfile: teamProfileSchema.optional(),
};

const assignableTeamRole = z.union([
  z.literal(UserRole.PROFESIONAL),
  z.literal(UserRole.ASISTENTE),
]);

function refineTenantTeamMember(
  data: { role: UserRole; professionalProfile?: { specialtyId: string } },
  context: z.RefinementCtx,
) {
  if (data.role === UserRole.PROFESIONAL && !data.professionalProfile) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['professionalProfile'], message: 'Selecciona una especialidad' });
  }
  if (data.role === UserRole.ASISTENTE && data.professionalProfile) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['professionalProfile'], message: 'El asistente no puede tener perfil clínico' });
  }
}

/** New members can only be professionals or assistants. */
export const tenantTeamMemberSchema = z.object({
  ...tenantTeamMemberBaseFields,
  role: assignableTeamRole,
  password: z.string().min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`),
}).strict().superRefine(refineTenantTeamMember);

/** Editing also accepts MASTER, because the account holder's own row resends its role. */
export const tenantTeamMemberUpdateSchema = z.object({
  ...tenantTeamMemberBaseFields,
  role: z.union([z.literal(UserRole.MASTER), assignableTeamRole]),
}).strict().superRefine(refineTenantTeamMember);

export type TenantTeamMemberFormData = z.infer<typeof tenantTeamMemberSchema>;
```

Añade estos casos al test que ya cubre los esquemas de equipo (búscalo con `grep -rln "tenantTeamMemberSchema" src --include=*.test.ts*`; si ninguno lo cubre, crea `web/src/lib/validations/team-member.test.ts` con este contenido completo):

```ts
import { describe, expect, it } from 'vitest';
import { UserRole } from '@/types';
import { tenantTeamMemberSchema, tenantTeamMemberUpdateSchema } from './schemas';

const base = { email: 'ana@example.com', firstName: 'Ana', lastName: 'Vega' };

describe('team member schemas', () => {
  it.each([UserRole.MASTER, UserRole.ADMIN, UserRole.SOPORTE])(
    'rejects creating a %s member',
    (role) => {
      const result = tenantTeamMemberSchema.safeParse({ ...base, password: 'Secret123', role });
      expect(result.success).toBe(false);
    },
  );

  it('accepts creating an assistant', () => {
    const result = tenantTeamMemberSchema.safeParse({
      ...base,
      password: 'Secret123',
      role: UserRole.ASISTENTE,
    });
    expect(result.success).toBe(true);
  });

  it('accepts editing the account holder with or without a clinical profile', () => {
    expect(tenantTeamMemberUpdateSchema.safeParse({ ...base, role: UserRole.MASTER }).success).toBe(true);
    expect(
      tenantTeamMemberUpdateSchema.safeParse({
        ...base,
        role: UserRole.MASTER,
        professionalProfile: { specialtyId: 'specialty-1', isActive: true },
      }).success,
    ).toBe(true);
  });

  it('rejects editing a member into ADMIN', () => {
    expect(tenantTeamMemberUpdateSchema.safeParse({ ...base, role: UserRole.ADMIN }).success).toBe(false);
  });
});
```

- [ ] **Step 5: Diálogo de miembro**

En `web/src/features/admin/team/team-member-dialog.tsx`:

a) Imports: reemplazar la línea de guards y añadir `ROLE_LABELS`:

```tsx
import { ROLE_LABELS } from '@/lib/constants';
import { isMasterRole } from '@/types/guards';
```

y en la lista de tipos importados de `@/types` añadir `type AssignableTeamRole`.

b) `FormValues`: renombrar `adminProvidesCare` a `masterProvidesCare` en el tipo, en `EMPTY_FORM` y en todos sus usos del archivo.

c) `EMPTY_FORM`: el rol inicial pasa a profesional:

```tsx
  role: UserRole.PROFESIONAL,
```

d) `getInitialValues`: las dos líneas afectadas quedan así:

```tsx
    role: member.role as TenantTeamRole,
```

```tsx
    masterProvidesCare: isMasterRole(member.role) && !!profile,
```

e) Dentro del componente, tras `const isSaving = pending || submitting;`:

```tsx
  const isMaster = !!member && isMasterRole(member.role);
```

f) `profileIsRequired`:

```tsx
  const profileIsRequired = values.role === UserRole.PROFESIONAL ||
    (isMaster && values.masterProvidesCare);
```

g) En `setValue`, la comparación de clave pasa a `key === 'role' || key === 'masterProvidesCare'`.

h) Reemplazar `handleRoleChange` completo por:

```tsx
  const handleRoleChange = (role: AssignableTeamRole) => {
    setValues((current) =>
      role === UserRole.ASISTENTE
        ? { ...current, role, specialtyId: '', professionalTitle: '', licenseNumber: '', bio: '' }
        : { ...current, role },
    );
    setFieldErrors({});
    setServerError(null);
  };
```

i) Reemplazar el bloque del selector de rol (el `<div className="space-y-2">` que contiene `<label htmlFor="team-member-role"`) por:

```tsx
          {isMaster ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">Rol</p>
              <p className="text-sm">{ROLE_LABELS[UserRole.MASTER]}</p>
              <p className="text-xs text-muted-foreground">
                El rol del titular de la cuenta no se puede cambiar.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="team-member-role" className="text-sm font-medium">Rol</label>
              <select
                id="team-member-role"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={values.role}
                onChange={(event) => handleRoleChange(event.target.value as AssignableTeamRole)}
                disabled={isSaving}
                aria-describedby="team-member-role-description"
              >
                <option value={UserRole.PROFESIONAL}>Profesional</option>
                <option value={UserRole.ASISTENTE}>Asistente</option>
              </select>
              <p id="team-member-role-description" className="text-xs text-muted-foreground">
                Los perfiles clínicos requieren una especialidad habilitada para el consultorio.
              </p>
            </div>
          )}
```

j) El bloque del checkbox "También atiende pacientes": cambiar su condición de `{values.role === UserRole.MASTER && (` a `{isMaster && (`, y su texto de ayuda a:

```tsx
                  Habilita un perfil clínico para el titular de la cuenta.
```

k) En `handleSubmit`, la rama de alta construye el payload con `role: parsed.role` (tipo `AssignableTeamRole` gracias al esquema) y la de edición con `role: parsed.role` (tipo `TenantTeamRole`). No requieren cambios de código; confirma que `npm run type-check` pasa.

- [ ] **Step 6: Fila del titular en la lista**

En `web/src/features/admin/team/team-manager.tsx`:

a) Dentro del `users.map`, las dos líneas que calculaban la etiqueta (`const canonicalRole = ...` y `const roleLabel = ...`) quedan en una:

```tsx
                    const roleLabel = ROLE_LABELS[user.role] ?? String(user.role);
                    const isHolder = isMasterRole(user.role);
```

b) El bloque que alterna desactivar/reactivar (`{user.isActive ? (` … `)}` dentro de `canManage`) se envuelve para excluir al titular:

```tsx
                                {!isHolder && (user.isActive ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    aria-label={`Desactivar cuenta de ${name}`}
                                    onClick={() => deactivateAccount(user)}
                                    disabled={isMutationPending}
                                  >
                                    <UserX className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    aria-label={`Reactivar cuenta de ${name}`}
                                    onClick={() => reactivateAccount(user)}
                                    disabled={isMutationPending}
                                  >
                                    <UserCheck className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                ))}
```

El botón de editar y el de atención clínica se mantienen para el titular.

- [ ] **Step 7: Ejecutar los tests del módulo**

Run: `cd web && npx vitest run src/features/admin/team src/lib/validations`
Expected: PASS.

- [ ] **Step 8: Verificación completa y documentación**

Run: `cd web && npm run type-check && npm run lint && npm test`
Expected: todo en verde.

Actualiza la documentación del front:

```bash
cd web && grep -nE "\b(ADMIN|CLIENTE|PSICOLOGO)\b" docs/ROUTE_MAP.md docs/SUBSCRIPTION_MODEL.md docs/SUBSCRIPTION_IMPLEMENTATION.md docs/GETTING_STARTED.md docs/DOCUMENTATION.md docs/DELIVERABLES.md docs/IMPLEMENTATION_SUMMARY.md README.md
```

En cada coincidencia que nombre un rol: `ADMIN`/`CLIENTE` → `MASTER`, `PSICOLOGO` → `PROFESIONAL`. En `docs/ROUTE_MAP.md`, las rutas `/admin/team`, `/admin/subscription`, `/admin/storage`, `/admin/settings` y `/admin/specialties` quedan como "solo MASTER (y SOPORTE)"; `/admin/billing` como "MASTER y PROFESIONAL". No toques nombres de rutas ni `docs/superpowers/`.

- [ ] **Step 9: Verificación en el navegador**

Solo si hay un API local levantado contra una base con las migraciones aplicadas. Arranca el front con la configuración de `.claude/launch.json` (créala si no existe: `runtimeExecutable: "npm"`, `runtimeArgs: ["run", "dev"]`, `port: 4200`) y comprueba, iniciando sesión con usuarios de prueba de los seeds:

1. Titular: ve Módulos clínicos, Equipo, Suscripción, Almacenamiento y Configuración; en Equipo su fila dice "Titular de la cuenta" y no tiene botón de desactivar; "Agregar miembro" ofrece solo Profesional y Asistente.
2. Profesional: no ve la sección Administración ni Módulos clínicos; sí ve Facturación; abrir `/admin/team` muestra "Acceso restringido".

Si no hay entorno local disponible, anótalo como "no verificado en navegador" en tu reporte.

- [ ] **Step 10: Commit**

```bash
cd web
git add src docs README.md
git commit -m "feat(web): limit team roles to professional and assistant and lock the account holder row"
```

---

## Despliegue (lo ejecuta el usuario, no el implementador)

Requiere ventana de mantenimiento: con la migración aplicada, el API antiguo falla al leer al titular (su cliente Prisma no conoce `MASTER`); con el API nuevo sin migrar, los titulares reciben 403.

0. Antes de producción, contra una base desechable (`DATABASE_URL_TEST`): `npm run prisma:verify-master-role-migration` y `npm run test:e2e`. Nunca se han ejecutado.
1. Respaldar la base de datos y detener el API antiguo.
2. En `api/`: `npx prisma migrate deploy` (aplica `20261002000000_add_master_role` y `20261002000100_backfill_master_role`), y arrancar el API nuevo.
3. En `api/`: `npm run prisma:audit-master-roles`. Código de salida 0 = sin bloqueos. Revisar `professionalsWithoutProfile`: son antiguos administradores o psicólogos que quedaron como `PROFESIONAL` sin perfil clínico; el titular les completa el perfil o los pasa a Asistente desde Equipo.
4. Desplegar `web` junto con `api`: un front antiguo no reconoce `MASTER` y dejaría al titular sin menú de administración.
5. Reversión: restaurar el respaldo. La migración de datos no es reversible por sí sola.
