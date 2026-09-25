# Canonical Roles and Professional Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir roles canónicos y un perfil profesional con una sola especialidad, migrar de forma compatible los profesionales existentes y hacer que los cupos se calculen por perfiles profesionales activos.

**Architecture:** `User` conserva identidad, autenticación y rol; el nuevo `ProfessionalProfile` uno-a-uno concentra capacidad clínica, especialidad vigente y datos profesionales. API y web aceptan simultáneamente roles canónicos y heredados durante una versión, mientras los campos y la relación `ProfessionalSpecialty` existentes permanecen legibles. Esta etapa se apila sobre las ramas `codex/platform-stabilization`; pacientes, citas, equipo tratante e historial clínico compartido permanecen fuera de alcance.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 15, Jest/Supertest, Next.js 14, React 18, TypeScript, Vitest y Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-multispecialty-consulting-design.md`

## Global Constraints

- Trabajar en `api/.worktrees/professional-profiles` y `web/.worktrees/professional-profiles`; no agregar commits nuevos a los PR de estabilización #22 y #17.
- Seguir TDD: prueba roja observable, cambio mínimo, prueba verde y commit pequeño por tarea.
- Conservar `CLIENTE` como alias de `ADMIN` y `PSICOLOGO` como alias de `PROFESIONAL` durante toda esta etapa.
- No cambiar todavía filas existentes de `User.role`, ni eliminar `User.professionalTitle`, `User.licenseNumber` o `ProfessionalSpecialty`.
- Todo perfil clínico tiene exactamente una especialidad habilitada en su consultorio; `ADMIN` puede tener perfil opcional y `PROFESIONAL` debe tenerlo.
- Los cupos cuentan `ProfessionalProfile.isActive = true`, incluidos administradores clínicos; invitaciones profesionales continúan reservando cupo como en el contrato vigente.
- No renombrar aún `psychologistId`, `assignedPsychologistId`, tablas clínicas ni campos históricos.
- Usar exclusivamente bases descartables cuyo nombre contenga un segmento `test`; nunca ejecutar seed, limpieza o migraciones experimentales contra `psic_clinic_dev`.
- Conservar contratos heredados en las respuestas y añadir contratos canónicos de forma aditiva.
- Antes de modificar el esquema, versionar y verificar la cadena histórica de migraciones que actualmente está ignorada.

---

### Task 1: Restore and verify the canonical Prisma migration chain

**Files:**

- Modify: `api/.gitignore`
- Create: `api/prisma/migrations/20260307231530_v2/migration.sql`
- Create: `api/prisma/migrations/20260923013330_add_session_inactivity_remove_slug/migration.sql`
- Create: `api/prisma/migrations/20260923013800_make_activity_timestamp_required/migration.sql`
- Create: `api/prisma/migrations/20260923023809_add_specialties_and_modules/migration.sql`
- Create: `api/prisma/migrations/20260923030000_add_billing_invoices/migration.sql`
- Create: `api/prisma/migrations/20260923034130_add_faktur_billing_settings/migration.sql`
- Create: `api/prisma/migrations/20260923034251_add_faktur_api_url/migration.sql`
- Create: `api/prisma/migrations/20260923040020_add_specialty_records/migration.sql`
- Create: `api/prisma/migrations/20260923042602_add_specialty_and_invoice_limits/migration.sql`
- Create: `api/prisma/migrations/20260923044131_add_invoice_issuer/migration.sql`
- Test: fresh PostgreSQL migration deploy and schema diff

**Interfaces:**

- Consumes: the audited local SQL history under the main `api/prisma/migrations` checkout.
- Produces: a versioned migration chain that exactly reconstructs `prisma/schema.prisma` and can receive the new migration in Task 3.

- [ ] **Step 1: Capture the current failure**

Run from the API worktree:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_history_test'
npx prisma migrate deploy --schema prisma/schema.prisma
```

Expected: Prisma reports zero executable migrations because only `migration_lock.toml` exists in this worktree.

- [ ] **Step 2: Stop ignoring migration SQL**

Remove only this line from `api/.gitignore`:

```gitignore
prisma/migrations/**/migration.sql
```

Keep `/.worktrees/` ignored.

- [ ] **Step 3: Mechanically copy the audited migration files**

From `api/.worktrees/professional-profiles`, copy only the ten named `migration.sql` files from `../../prisma/migrations` into the matching local directories. Do not edit their contents during the copy.

Verify the copied files with SHA-256:

```text
20260307231530_v2                                      5022dfae137ba87ff637405f1537af873510cf10a47bf36dd3a9e6b7df3b78a7
20260923013330_add_session_inactivity_remove_slug      83c3690b036967cda61ee30e3dcc439fea5b16bfc588a94b92e686164f0e3fcc
20260923013800_make_activity_timestamp_required        42aae6029ab61aa2d082cc85a0945c769bf7859ffe55732be7b24ddcd631192e
20260923023809_add_specialties_and_modules              b688cb8ddc70ef17eabdb31fde34b26fd1adfcea5c3e5ac1a801d9747ca47d74
20260923030000_add_billing_invoices                     ef94f9fd86c7f06c57a3e8b83857d2b9349cbb8c21f95f478c7334a6b941371e
20260923034130_add_faktur_billing_settings              476b0fff5ff484fa6684bb63e24477428c319c95b16e7b83c7be410a5f1dad59
20260923034251_add_faktur_api_url                       6c34625d98341ed27aceaf0c536e67dc77ea66706999180722383e6ee06e4245
20260923040020_add_specialty_records                    e1af37f65d5f0ecf85775f020246e2050eb68a937aaa544fea05ff75089def5a
20260923042602_add_specialty_and_invoice_limits         b2a4df62e4aa939ec9a64749739943b6c143a6310fb3a14398e6ed4fe461f59c
20260923044131_add_invoice_issuer                       83675a15dd28651316f876ec8389403df2b440647248a764a55041e8ed8ec290
```

Run:

```powershell
Get-ChildItem -LiteralPath 'prisma\migrations' -Directory |
  Sort-Object Name |
  ForEach-Object {
    Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $_.FullName 'migration.sql')
  }
```

- [ ] **Step 4: Prove the restored history recreates the current schema**

Create the exact disposable database if absent, then run:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_history_test'
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: ten migrations apply and the diff prints `No difference detected.` with exit code 0.

Drop only `psic_clinic_history_test` after verification.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore prisma/migrations
git commit -m "chore(api): restore prisma migration history"
```

---

### Task 2: Add canonical role compatibility in the API

**Files:**

- Create: `api/src/common/roles/role-compatibility.ts`
- Create: `api/src/common/roles/role-compatibility.spec.ts`
- Create: `api/src/common/guards/roles.guard.spec.ts`
- Modify: `api/src/common/guards/roles.guard.ts`

**Interfaces:**

- Consumes: role strings from JWTs, DTOs and `@Roles()` metadata.
- Produces: `CanonicalRole`, `toCanonicalRole`, `areRolesEquivalent`, `isAdminRole` and `isProfessionalRole` for later tasks.

- [ ] **Step 1: Write the failing role compatibility tests**

Create `role-compatibility.spec.ts` with these exact expectations:

```typescript
import {
  areRolesEquivalent,
  isAdminRole,
  isProfessionalRole,
  toCanonicalRole,
} from './role-compatibility';

describe('role compatibility', () => {
  it.each([
    ['CLIENTE', 'ADMIN'],
    ['ADMIN', 'ADMIN'],
    ['PSICOLOGO', 'PROFESIONAL'],
    ['PROFESIONAL', 'PROFESIONAL'],
    ['ASISTENTE', 'ASISTENTE'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(toCanonicalRole(input)).toBe(expected);
  });

  it('treats legacy and canonical aliases as equivalent', () => {
    expect(areRolesEquivalent('ADMIN', 'CLIENTE')).toBe(true);
    expect(areRolesEquivalent('PSICOLOGO', 'PROFESIONAL')).toBe(true);
    expect(areRolesEquivalent('ASISTENTE', 'PROFESIONAL')).toBe(false);
  });

  it('classifies administrative and professional aliases', () => {
    expect(isAdminRole('CLIENTE')).toBe(true);
    expect(isAdminRole('ADMIN')).toBe(true);
    expect(isProfessionalRole('PSICOLOGO')).toBe(true);
    expect(isProfessionalRole('PROFESIONAL')).toBe(true);
  });
});
```

Run:

```powershell
npm test -- src/common/roles/role-compatibility.spec.ts --runInBand
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the compatibility module**

Create `role-compatibility.ts`:

```typescript
export type CanonicalRole = 'ADMIN' | 'PROFESIONAL' | 'ASISTENTE' | 'SOPORTE' | 'PACIENTE';
export type CompatibleRole = CanonicalRole | 'CLIENTE' | 'PSICOLOGO';

const ROLE_ALIASES: Record<CompatibleRole, CanonicalRole> = {
  ADMIN: 'ADMIN',
  CLIENTE: 'ADMIN',
  PROFESIONAL: 'PROFESIONAL',
  PSICOLOGO: 'PROFESIONAL',
  ASISTENTE: 'ASISTENTE',
  SOPORTE: 'SOPORTE',
  PACIENTE: 'PACIENTE',
};

export function toCanonicalRole(role: string): CanonicalRole | undefined {
  return ROLE_ALIASES[role as CompatibleRole];
}

export function areRolesEquivalent(actual: string, required: string): boolean {
  const actualCanonical = toCanonicalRole(actual);
  const requiredCanonical = toCanonicalRole(required);
  return !!actualCanonical && actualCanonical === requiredCanonical;
}

export const isAdminRole = (role: string): boolean => toCanonicalRole(role) === 'ADMIN';
export const isProfessionalRole = (role: string): boolean =>
  toCanonicalRole(role) === 'PROFESIONAL';
```

- [ ] **Step 3: Write guard tests before changing the guard**

In `roles.guard.spec.ts`, mock `Reflector.getAllAndOverride` and `ExecutionContext` and cover:

1. `ADMIN` satisfies metadata `CLIENTE`.
2. `CLIENTE` satisfies metadata `ADMIN`.
3. `PROFESIONAL` satisfies metadata `PSICOLOGO`.
4. `PSICOLOGO` satisfies metadata `PROFESIONAL`.
5. `SOPORTE` does not satisfy `ADMIN` unless `SOPORTE` is explicitly present.
6. Public routes and routes without role metadata remain allowed.

Run the guard test and confirm case 1 fails with the current exact-string comparison and case 5 fails because of the global support bypass.

- [ ] **Step 4: Use explicit alias comparison and remove the implicit support bypass**

In `RolesGuard`, replace the bypass and equality block with:

```typescript
const hasRole = requiredRoles.some((role) => areRolesEquivalent(user.role, role));

if (!hasRole) {
  throw new ForbiddenException(`Required roles: ${requiredRoles.join(', ')}`);
}
```

Import `areRolesEquivalent`. Provider administration endpoints already declare `SOPORTE`; do not add it to clinical endpoints.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- src/common/roles/role-compatibility.spec.ts src/common/guards/roles.guard.spec.ts --runInBand
npm test -- --runInBand
npm run lint
git add src/common/roles src/common/guards
git commit -m "feat(api): support canonical role aliases"
```

---

### Task 3: Add and backfill ProfessionalProfile safely

**Files:**

- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260924153000_add_canonical_roles_professional_profiles/migration.sql`
- Modify: `api/src/prisma/prisma.service.ts`
- Modify: `api/prisma/seed.ts`
- Test: disposable pre-migration PostgreSQL database and Prisma schema diff

**Interfaces:**

- Consumes: `User`, `Specialty`, `TenantSpecialty`, `ProfessionalSpecialty` and historical clinical author references.
- Produces: Prisma model `ProfessionalProfile` with one row per clinically capable user and one current `specialtyId`.

- [ ] **Step 1: Establish a red legacy migration fixture**

Before changing the schema, create `psic_clinic_profiles_backfill_test`, deploy Task 1's ten migrations and run the existing seed against it:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_profiles_backfill_test'
npx prisma migrate deploy --schema prisma/schema.prisma
npm run prisma:seed
```

Query `to_regclass('public."ProfessionalProfile"')` and confirm it returns null. Record these pre-migration counts:

```sql
SELECT COUNT(*) FROM "User" WHERE "role" = 'PSICOLOGO';
SELECT COUNT(DISTINCT "userId") FROM "ProfessionalSpecialty";
```

- [ ] **Step 2: Extend the Prisma schema additively**

Add canonical values without removing legacy values:

```prisma
enum UserRole {
  CLIENTE
  PSICOLOGO
  ADMIN
  PROFESIONAL
  ASISTENTE
  SOPORTE
  PACIENTE
}
```

Add `professionalProfile ProfessionalProfile?` to `User`, `professionalProfiles ProfessionalProfile[]` to `Specialty`, and:

```prisma
model ProfessionalProfile {
  userId            String    @id
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  specialtyId       String
  specialty         Specialty @relation(fields: [specialtyId], references: [id], onDelete: Restrict)
  professionalTitle String?
  licenseNumber     String?
  bio               String?
  isActive          Boolean   @default(true)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([specialtyId, isActive])
}
```

Do not remove the legacy fields or relation.

- [ ] **Step 3: Create the data-preserving SQL migration**

The migration must perform these operations in order:

```sql
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROFESIONAL';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ASISTENTE';

DO $$
BEGIN
  IF EXISTS (
    SELECT "userId"
    FROM "ProfessionalSpecialty"
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ProfessionalProfile migration requires at most one ProfessionalSpecialty per user';
  END IF;
END $$;

INSERT INTO "Specialty" (
  "id", "code", "name", "description", "isActive", "createdAt", "updatedAt"
)
VALUES (
  'legacy_psychology_specialty',
  'PSYCHOLOGY',
  'Psicología',
  'Atención psicológica y psicoterapia.',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "ProfessionalProfile" (
  "userId" TEXT NOT NULL,
  "specialtyId" TEXT NOT NULL,
  "professionalTitle" TEXT,
  "licenseNumber" TEXT,
  "bio" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProfessionalProfile_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "ProfessionalProfile_specialtyId_isActive_idx"
  ON "ProfessionalProfile"("specialtyId", "isActive");

ALTER TABLE "ProfessionalProfile"
  ADD CONSTRAINT "ProfessionalProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfessionalProfile"
  ADD CONSTRAINT "ProfessionalProfile_specialtyId_fkey"
  FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    WITH "HistoricalSpecialty" AS (
      SELECT "psychologistId" AS "userId", "specialtyId" FROM "ClinicalNote"
      UNION ALL
      SELECT "psychologistId" AS "userId", "specialtyId" FROM "NextSessionPlan"
      UNION ALL
      SELECT "professionalId" AS "userId", "specialtyId" FROM "SpecialtyRecord"
    )
    SELECT history."userId"
    FROM "HistoricalSpecialty" history
    LEFT JOIN "ProfessionalSpecialty" current_specialty
      ON current_specialty."userId" = history."userId"
    WHERE current_specialty."userId" IS NULL
      AND history."specialtyId" IS NOT NULL
    GROUP BY history."userId"
    HAVING COUNT(DISTINCT history."specialtyId") > 1
  ) THEN
    RAISE EXCEPTION 'Cannot infer one current specialty for a legacy clinical author';
  END IF;
END $$;

WITH
"Psychology" AS (
  SELECT "id" FROM "Specialty" WHERE "code" = 'PSYCHOLOGY'
),
"ClinicalAuthors" AS (
  SELECT "psychologistId" AS "userId" FROM "ClinicalNote"
  UNION
  SELECT "psychologistId" AS "userId" FROM "NextSessionPlan"
  UNION
  SELECT "professionalId" AS "userId" FROM "SpecialtyRecord"
),
"HistoricalSpecialty" AS (
  SELECT "psychologistId" AS "userId", "specialtyId"
  FROM "ClinicalNote"
  WHERE "specialtyId" IS NOT NULL
  UNION ALL
  SELECT "psychologistId" AS "userId", "specialtyId"
  FROM "NextSessionPlan"
  WHERE "specialtyId" IS NOT NULL
  UNION ALL
  SELECT "professionalId" AS "userId", "specialtyId"
  FROM "SpecialtyRecord"
),
"InferredHistoricalSpecialty" AS (
  SELECT "userId", MIN("specialtyId") AS "specialtyId"
  FROM "HistoricalSpecialty"
  GROUP BY "userId"
)
INSERT INTO "ProfessionalProfile" (
  "userId",
  "specialtyId",
  "professionalTitle",
  "licenseNumber",
  "bio",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  app_user."id",
  COALESCE(
    current_specialty."specialtyId",
    inferred_specialty."specialtyId",
    psychology."id"
  ),
  app_user."professionalTitle",
  app_user."licenseNumber",
  NULL,
  app_user."isActive",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" app_user
CROSS JOIN "Psychology" psychology
LEFT JOIN "ProfessionalSpecialty" current_specialty
  ON current_specialty."userId" = app_user."id"
LEFT JOIN "InferredHistoricalSpecialty" inferred_specialty
  ON inferred_specialty."userId" = app_user."id"
LEFT JOIN "ClinicalAuthors" clinical_author
  ON clinical_author."userId" = app_user."id"
WHERE app_user."role" = 'PSICOLOGO'
   OR current_specialty."userId" IS NOT NULL
   OR clinical_author."userId" IS NOT NULL
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "TenantSpecialty" ("tenantId", "specialtyId", "createdAt")
SELECT app_user."tenantId", profile."specialtyId", CURRENT_TIMESTAMP
FROM "ProfessionalProfile" profile
JOIN "User" app_user ON app_user."id" = profile."userId"
ON CONFLICT ("tenantId", "specialtyId") DO NOTHING;
```

This implements the exact precedence: sole current relation, sole inferable historical specialty, then `PSYCHOLOGY`. It refuses ambiguous clinical authors before writing any profile.

- [ ] **Step 4: Bind and clean the new Prisma delegate**

Add `professionalProfile` to `PrismaService.bindRlsDelegates()` and place it before `user` in `cleanDatabase()` so the child row is removed first.

- [ ] **Step 5: Update seed data to use one current specialty**

Create each demo professional with a nested `professionalProfile` matching its sole `ProfessionalSpecialty`. Change the demo assistant from `PSICOLOGO` to `ASISTENTE` and do not create a profile for that account. Historical `SpecialtyRecord.specialtyId` may differ from the current profile because history is immutable.

Use this nested shape beside the compatibility relation:

```typescript
professionalProfile: {
  create: {
    specialtyId: catalog.psychology.id,
    professionalTitle: 'Psicóloga clínica',
    isActive: true,
  },
},
professionalSpecialties: {
  create: { specialtyId: catalog.psychology.id, isPrimary: true },
},
```

- [ ] **Step 6: Apply the new migration to the legacy fixture**

Regenerate Prisma, then deploy only the newly pending migration to `psic_clinic_profiles_backfill_test`:

```powershell
npm run prisma:generate
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_profiles_backfill_test'
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: the original professional count equals the number of backfilled profiles for legacy professionals, every profile has one specialty, every profile specialty is enabled for its user's tenant, and Prisma reports no schema difference.

Drop only `psic_clinic_profiles_backfill_test` after verification.

- [ ] **Step 7: Verify and commit**

```powershell
npm test -- --runInBand
npm run lint
npm run build
git add prisma src/prisma
git commit -m "feat(api): add professional profile model"
```

---

### Task 4: Enforce professional profile and seat rules in user management

**Files:**

- Create: `api/src/professional-profiles/professional-profiles.module.ts`
- Create: `api/src/professional-profiles/professional-profiles.service.ts`
- Create: `api/src/professional-profiles/professional-profiles.service.spec.ts`
- Create: `api/src/professional-profiles/dto/professional-profile.dto.ts`
- Modify: `api/src/users/users.module.ts`
- Modify: `api/src/users/dto/user.dto.ts`
- Modify: `api/src/users/users.service.ts`
- Modify: `api/src/users/users.controller.ts`
- Modify: `api/src/users/provider-admin.controller.ts`
- Modify: `api/test/users-seat-enforcement.spec.ts`

**Interfaces:**

- Consumes: canonical/legacy role helpers, enabled tenant specialties and `TenantSubscription.seatsPsychologistsMax`.
- Produces: additive `professionalProfile` input/output, exact functional error codes and seat accounting based on active profiles.

- [ ] **Step 1: Write failing service tests for profile rules**

Cover these cases in `professional-profiles.service.spec.ts`:

1. `PROFESIONAL` and `PSICOLOGO` without profile throw status 422 with code `PROFESSIONAL_SPECIALTY_REQUIRED`.
2. `ADMIN` and `CLIENTE` accept an optional profile.
3. `ASISTENTE`, `SOPORTE` and `PACIENTE` reject a profile.
4. A specialty outside `TenantSpecialty` throws 409 with code `SPECIALTY_NOT_ENABLED`.
5. An active profile at the seat limit throws 409 with code `PROFESSIONAL_SEAT_LIMIT_REACHED`.
6. An inactive profile does not consume a seat.
7. `countActiveProfiles(tenantId)` counts active profiles regardless of the user's role.
8. Changing specialty with a future appointment under the current specialty throws 409 with code `SPECIALTY_IN_USE`.

Run the test and confirm it fails because the service does not exist.

- [ ] **Step 2: Define the canonical profile DTO**

Create:

```typescript
export class ProfessionalProfileInputDto {
  @IsString()
  @IsNotEmpty()
  specialtyId: string;

  @IsString()
  @IsOptional()
  professionalTitle?: string;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

In `CreateUserDto`, use `@IsEnum(UserRole)` for all seven database roles, add an optional nested `professionalProfile`, add canonical `specialtyId` for flat compatibility, and retain deprecated `specialtyIds` with `@ArrayMaxSize(1)`. Build `UpdateUserDto` with `PartialType(OmitType(CreateUserDto, ['tenantId', 'password'] as const))` so tenant and password cannot be patched through the user endpoint.

- [ ] **Step 3: Implement ProfessionalProfilesService**

Implement the core rules with typed Prisma transaction support:

```typescript
type ProfileDb = PrismaService | Prisma.TransactionClient;

validateRoleProfile(role: string, input?: ProfessionalProfileInputDto): void {
  if (isProfessionalRole(role) && !input) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      code: 'PROFESSIONAL_SPECIALTY_REQUIRED',
      message: 'El profesional debe tener exactamente una especialidad.',
    });
  }

  if (!isProfessionalRole(role) && !isAdminRole(role) && input) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      code: 'PROFESSIONAL_PROFILE_NOT_ALLOWED',
      message: 'El rol seleccionado no admite un perfil profesional.',
    });
  }
}

async assertSpecialtyEnabled(
  tenantId: string,
  specialtyId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db: ProfileDb = tx ?? this.prisma;
  const enabled = await db.tenantSpecialty.findUnique({
    where: { tenantId_specialtyId: { tenantId, specialtyId } },
  });

  if (!enabled) {
    throw new ConflictException({
      statusCode: 409,
      code: 'SPECIALTY_NOT_ENABLED',
      message: 'La especialidad no está habilitada para este consultorio.',
    });
  }
}

async countActiveProfiles(tenantId: string, tx?: Prisma.TransactionClient): Promise<number> {
  const db: ProfileDb = tx ?? this.prisma;
  return db.professionalProfile.count({
    where: { isActive: true, user: { tenantId } },
  });
}

async assertSeatAvailable(tenantId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const db: ProfileDb = tx ?? this.prisma;
  const [subscription, used] = await Promise.all([
    db.tenantSubscription.findUnique({ where: { tenantId } }),
    this.countActiveProfiles(tenantId, tx),
  ]);

  if (!subscription || used >= subscription.seatsPsychologistsMax) {
    throw new ConflictException({
      statusCode: 409,
      code: 'PROFESSIONAL_SEAT_LIMIT_REACHED',
      message: 'Se alcanzó el límite de profesionales activos del plan.',
      details: { used, limit: subscription?.seatsPsychologistsMax ?? 0 },
    });
  }
}

async assertSpecialtyChangeAllowed(
  tenantId: string,
  userId: string,
  nextSpecialtyId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db: ProfileDb = tx ?? this.prisma;
  const current = await db.professionalProfile.findUnique({ where: { userId } });
  if (!current || current.specialtyId === nextSpecialtyId) {
    return;
  }

  const futureAppointments = await db.appointment.count({
    where: {
      tenantId,
      psychologistId: userId,
      specialtyId: current.specialtyId,
      startTime: { gte: new Date() },
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
    },
  });

  if (futureAppointments > 0) {
    throw new ConflictException({
      statusCode: 409,
      code: 'SPECIALTY_IN_USE',
      message: 'No se puede cambiar la especialidad mientras existan citas futuras.',
    });
  }
}

async syncStoredSeatCount(tenantId: string, tx: Prisma.TransactionClient): Promise<number> {
  const used = await this.countActiveProfiles(tenantId, tx);
  await tx.tenantSubscription.update({
    where: { tenantId },
    data: { seatsPsychologistsUsed: used },
  });
  return used;
}
```

Import `Prisma` from `@prisma/client` and the role predicates from Task 2. `assertSeatAvailable` reads the live count, not the stored counter.

- [ ] **Step 4: Make user creation and invitation write both contracts**

Normalize inputs with this precedence:

1. `professionalProfile.specialtyId`
2. flat canonical `specialtyId`
3. the sole legacy `specialtyIds[0]`

Use one normalizer in `UsersService`:

```typescript
private resolveProfileInput(dto: CreateUserDto | UpdateUserDto) {
  const specialtyId =
    dto.professionalProfile?.specialtyId ?? dto.specialtyId ?? dto.specialtyIds?.[0];

  if (!specialtyId) {
    return undefined;
  }

  return {
    specialtyId,
    professionalTitle:
      dto.professionalProfile?.professionalTitle ?? dto.professionalTitle,
    licenseNumber: dto.professionalProfile?.licenseNumber ?? dto.licenseNumber,
    bio: dto.professionalProfile?.bio,
    isActive: dto.professionalProfile?.isActive ?? true,
  };
}
```

Within the existing transaction, create both contracts:

```typescript
professionalProfile: profile
  ? {
      create: {
        specialtyId: profile.specialtyId,
        professionalTitle: profile.professionalTitle,
        licenseNumber: profile.licenseNumber,
        bio: profile.bio,
        isActive: profile.isActive,
      },
    }
  : undefined,
professionalSpecialties: profile
  ? { create: { specialtyId: profile.specialtyId, isPrimary: true } }
  : undefined,
```

Mirror title/license into `User`, check the seat before an active profile, and call `syncStoredSeatCount` before commit. Invitations reserve a seat by retaining `profile.isActive = true` while login activation is pending. Execute mutations that acquire or release seats with:

```typescript
this.prisma.$transaction(
  async (tx) => {
    // validate, write user/profile compatibility rows, then synchronize the counter
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
);
```

Retry Prisma error `P2034` at most twice, then return `PROFESSIONAL_SEAT_LIMIT_REACHED`; this prevents two concurrent requests from taking the final seat.

- [ ] **Step 5: Make updates and deactivation profile-aware**

For role/profile updates:

- reject removal of the profile from a professional role;
- validate a changed specialty against `TenantSpecialty`;
- call `assertSpecialtyChangeAllowed` before changing the current specialty;
- preserve one legacy `ProfessionalSpecialty` through delete-and-create inside the transaction;
- deactivate the profile when the user is deactivated or provider access is revoked;
- reactivate only after checking the live limit;
- synchronize `seatsPsychologistsUsed` after each transition.

Return users with:

```typescript
professionalProfile: {
  include: {
    specialty: true,
  },
}
```

Keep legacy professional fields in the response.

- [ ] **Step 6: Make role filters alias-aware**

When `findAll` receives either professional alias, query `role IN (PSICOLOGO, PROFESIONAL)`. Do the same for administrative aliases. This preserves current web queries while allowing canonical clients.

- [ ] **Step 7: Update seat tests and verify**

Replace role-based counter assertions in `users-seat-enforcement.spec.ts` with profile-based cases:

- active `PROFESIONAL` profile consumes one seat;
- active `ADMIN` profile consumes one seat;
- `ADMIN` without profile consumes none;
- `ASISTENTE` consumes none;
- seat-limit error exposes `PROFESSIONAL_SEAT_LIMIT_REACHED`.

Run:

```powershell
npm test -- src/professional-profiles/professional-profiles.service.spec.ts test/users-seat-enforcement.spec.ts --runInBand
npm test -- --runInBand
npm run lint
npm run build
git add src/professional-profiles src/users test/users-seat-enforcement.spec.ts
git commit -m "feat(api): enforce professional profile seats"
```

---

### Task 5: Expose profile-aware auth and subscription contracts

**Files:**

- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/auth/dto/auth.dto.ts`
- Modify: `api/src/subscription/subscription.service.ts`
- Create: `api/test/subscription-professional-seats.spec.ts`
- Create: `api/test/professional-profiles.e2e-spec.ts`
- Modify: `api/test/setup-e2e.ts`

**Interfaces:**

- Consumes: `ProfessionalProfile` and canonical role compatibility from prior tasks.
- Produces: auth/user payloads with optional profile and usage/downgrade decisions based on live active profiles.

- [ ] **Step 1: Write failing subscription tests**

Mock `professionalProfile.count` and assert:

1. `getUsageMetrics` uses the profile count even when no `PSICOLOGO` users exist.
2. An active administrator profile appears in `usage.seats.used`.
3. `validateDowngrade` rejects a target whose professional-seat limit is below the profile count.
4. No subscription path calls `user.count({ role: PSICOLOGO })` for seat decisions.

Run the test and confirm the current role-based implementation fails.

- [ ] **Step 2: Replace role-based seat counts**

In `SubscriptionService`, replace every seat decision using `user.count` plus `PSICOLOGO` with:

```typescript
this.prisma.professionalProfile.count({
  where: { isActive: true, user: { tenantId } },
});
```

Keep `usage.seats` and legacy database field names unchanged for compatibility. Use neutral user-facing messages such as `profesionales activos`.

- [ ] **Step 3: Add professional profile to authentication payloads**

Include `professionalProfile.specialty` in login and refresh-token user loads. Add this optional shape to `AuthResponseDto` while preserving all current fields. JWT payloads retain the persisted role value during the compatibility window.

- [ ] **Step 4: Add a database-backed transition E2E**

In `professional-profiles.e2e-spec.ts`, use `TenantsService` and `UsersService` directly from the Nest testing module and cover:

1. A legacy `PSICOLOGO` created with one enabled specialty returns one profile.
2. A canonical `PROFESIONAL` returns the same response shape.
3. A `CLIENTE` administrator can receive an optional active profile and consumes a seat.
4. An administrator without profile does not consume a seat.
5. A specialty belonging to another tenant is rejected.
6. List filters by `PSICOLOGO` and `PROFESIONAL` both return legacy and canonical professionals.
7. Two concurrent activations competing for the final seat produce one success and one `PROFESSIONAL_SEAT_LIMIT_REACHED` response.

Use the existing guarded `psic_clinic_test` setup; never clean another database.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- test/subscription-professional-seats.spec.ts --runInBand
$env:NODE_ENV = 'test'
$env:DATABASE_URL_TEST = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'
$env:DATABASE_URL = $env:DATABASE_URL_TEST
$env:JWT_ACCESS_SECRET = 'profiles-e2e-access-secret'
$env:JWT_REFRESH_SECRET = 'profiles-e2e-refresh-secret'
npm run test:e2e -- --runInBand
npm run lint
npm run build
git add src/auth src/subscription test
git commit -m "feat(api): expose profile-aware usage contracts"
```

---

### Task 6: Make the web accept canonical roles and professional profiles

**Files:**

- Modify: `web/src/types/index.ts`
- Modify: `web/src/types/guards.ts`
- Create: `web/src/types/roles.test.ts`
- Create: `web/src/lib/professional-profiles.ts`
- Create: `web/src/lib/professional-profiles.test.ts`
- Modify: `web/src/lib/constants.ts`
- Modify: `web/src/lib/api/endpoints.ts`
- Modify: `web/src/lib/validations/schemas.ts`
- Modify: `web/src/components/layout/sidebar.tsx`
- Modify: `web/src/app/(dashboard)/admin/team/page.tsx`
- Modify: `web/src/app/(dashboard)/admin/specialties/page.tsx`
- Modify: `web/src/app/(dashboard)/admin/billing/page.tsx`
- Modify: `web/src/app/(dashboard)/profile/page.tsx`
- Modify: `web/src/components/dashboard/usage-widgets.tsx`
- Modify: `web/src/features/subscription/seat-limit-modal.tsx`
- Modify: `web/src/hooks/useLimits.tsx`

**Interfaces:**

- Consumes: additive API user/auth profile shape and unchanged `usage.seats` payload.
- Produces: role-family helpers, neutral professional-seat labels and UI compatible with both role generations.

- [ ] **Step 1: Write failing web role tests**

In `roles.test.ts`, assert that:

- `CLIENTE` and `ADMIN` are administrative;
- `PSICOLOGO` and `PROFESIONAL` are professional;
- `ASISTENTE` is neither;
- role labels are `Administrador`, `Profesional`, `Asistente`, `Soporte` and `Paciente` for canonical roles;
- legacy labels remain available.

Run:

```powershell
npm test -- src/types/roles.test.ts
```

Expected: FAIL because canonical enum members and helpers do not exist.

- [ ] **Step 2: Extend web types additively**

Add `ADMIN`, `PROFESIONAL` and `ASISTENTE` to `UserRole`. Define:

```typescript
export interface ProfessionalProfile {
  userId: string;
  specialtyId: string;
  specialty: Specialty;
  professionalTitle?: string;
  licenseNumber?: string;
  bio?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

Add `professionalProfile?: ProfessionalProfile` to `User`. Keep `professionalTitle`, `licenseNumber` and `professionalSpecialties` during compatibility.

- [ ] **Step 3: Centralize role-family checks**

Add `isAdminRole`, `isProfessionalRole`, `toCanonicalRole` and `hasActiveProfessionalProfile` to `types/guards.ts`. Replace direct role equality in the listed UI files with these helpers. Do not alter clinical-read authorization yet; that is implemented in the later clinical-authorization stage.

- [ ] **Step 4: Test and implement professional seat counting**

Create a pure helper:

```typescript
export function countActiveProfessionalProfiles(users: User[]): number {
  return users.filter((user) => user.professionalProfile?.isActive === true).length;
}
```

Test an active administrator profile, an active professional profile, an administrator without profile and an inactive profile. Update the team page to use this helper and replace `psicólogos` with `profesionales` in seat messaging.

- [ ] **Step 5: Preserve API compatibility in forms and normalizers**

Allow both role generations in validation schemas. Add optional `professionalProfile` and canonical `specialtyId` to user input types while retaining the legacy fields. In subscription normalization, expose a canonical `users.professionals` view and retain `users.psychologists` as a deprecated alias pointing to the same values.

- [ ] **Step 6: Verify and commit**

```powershell
npm test -- src/types/roles.test.ts src/lib/professional-profiles.test.ts
npm test
npm run lint
npm run type-check
npm run build
git add src
git commit -m "feat(web): support canonical professional profiles"
```

---

### Task 7: Verify migration compatibility and both stacked branches

**Files:**

- Modify if commands changed: `api/README.md`
- Modify if commands changed: `web/README.md`
- Test: all API and web quality gates

**Interfaces:**

- Consumes: all prior task outputs.
- Produces: two clean, reviewable stacked branches ready for PRs after the stabilization PRs merge.

- [ ] **Step 1: Verify API from a clean disposable database**

Create `psic_clinic_profiles_fresh_test`, then run:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_profiles_fresh_test'
$env:DATABASE_URL_TEST = $env:DATABASE_URL
$env:NODE_ENV = 'test'
$env:JWT_ACCESS_SECRET = 'profiles-final-access-secret'
$env:JWT_REFRESH_SECRET = 'profiles-final-refresh-secret'
npm ci
npm run prisma:generate
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Expected: migration diff empty, lint exits 0, every unit/E2E test passes and build succeeds. Drop only `psic_clinic_profiles_fresh_test` afterward.

- [ ] **Step 2: Verify the web from its lockfile**

```powershell
npm ci
npm run lint
npm run type-check
npm test
npm run build
```

Expected: zero lint warnings, typecheck success, all Vitest files pass and production build succeeds.

- [ ] **Step 3: Verify compatibility contracts manually**

Confirm from API responses and tests:

- legacy `CLIENTE` and canonical `ADMIN` receive the same administrative authorization;
- legacy `PSICOLOGO` and canonical `PROFESIONAL` receive the same role-family authorization;
- `SOPORTE` no longer bypasses unrelated role requirements;
- profiles always reference one enabled tenant specialty;
- active administrator profiles consume a seat;
- administrators without profile and assistants do not consume a seat;
- legacy professional fields and `ProfessionalSpecialty` remain readable;
- no patient, appointment or clinical-record foreign key was renamed.

- [ ] **Step 4: Check branch cleanliness and stacked ancestry**

```powershell
git status --short --branch
git diff --check
git merge-base --is-ancestor codex/platform-stabilization codex/professional-profiles
```

Run in both repositories. Expected: clean branches and exit code 0 for ancestry.

- [ ] **Step 5: Record exact verification results**

Add only command/results documentation that is needed for another developer to reproduce the migration and tests. Commit documentation separately:

```powershell
git add README.md docs
git commit -m "docs: document professional profile migration"
```
