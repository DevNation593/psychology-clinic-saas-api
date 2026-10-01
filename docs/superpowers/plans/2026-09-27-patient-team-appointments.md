# Equipo tratante y citas multiespecialidad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Permitir que una sola ficha de paciente tenga varios profesionales tratantes y que cada cita use un profesional y una especialidad canónicos, conservando temporalmente los contratos heredados de psicología.

**Architecture:** La API incorpora una relación PatientProfessional y un resolvedor único de elegibilidad profesional. Equipo tratante, pacientes, usuarios y citas consumen ese núcleo dentro de transacciones serializables; los adaptadores heredados normalizan hacia el mismo flujo. La web usa contratos y cachés por tenant, presenta el equipo como una sección independiente y agenda mediante la cascada paciente → especialidad → profesional.

**Tech Stack:** NestJS 11, Prisma 6/PostgreSQL, Jest/Supertest, Next.js 14, React 18, TanStack Query 5, React Hook Form, Zod, Vitest y Testing Library.

**Spec:** docs/superpowers/specs/2026-09-27-patient-team-appointments-design.md

## Global Constraints

- Conservar una sola fila Patient por persona dentro del consultorio; no duplicar pacientes por especialidad.
- Cada ProfessionalProfile tiene exactamente una especialidad vigente; la elegibilidad se obtiene del perfil activo, nunca del rol por sí solo.
- ADMIN y ASISTENTE administran equipo y agenda. Un PROFESIONAL asignado puede referir a otro profesional, pero no retirar integrantes ni modificar citas de terceros.
- Un PROFESIONAL solo crea citas propias para pacientes cuyo equipo ya integra.
- Crear o reasignar una cita agrega o reactiva al nuevo profesional sin retirar al anterior.
- Retirar una asignación o desactivar capacidad clínica se bloquea mientras existan citas futuras distintas de CANCELLED.
- Toda lectura y escritura comprueba tenantId de ruta, actor, paciente y profesional.
- Mantener assignedPsychologistId, psychologistId y psychologist como adaptadores temporales; ningún flujo nuevo los usa como fuente canónica.
- Toda cita canónica nueva recibe professionalId + specialtyId; un payload exclusivamente heredado puede derivar la especialidad del perfil.
- No cambiar autorización, versionado ni auditoría de notas clínicas en esta etapa.
- No agregar dependencias de producción.
- API y web trabajan en sus worktrees codex/patient-team-appointments ya creados. Las rutas web/ de este documento son relativas al worktree web; las demás rutas son relativas al worktree API.
- Aplicar TDD: prueba roja, implementación mínima, prueba verde y commit por tarea.

---

### Task 1: Add the additive schema, guarded migration, and reconciliation command

**Files:**
- Modify: prisma/schema.prisma:139-175, 401-451, 478-518, 526-606, 660-710
- Create: prisma/migrations/20260928000000_patient_team_appointments/migration.sql
- Create: prisma/reconcile-patient-team-appointments.ts
- Create: prisma/verify-patient-team-migration.ts
- Modify: src/prisma/prisma.service.ts:52-87, 122-146
- Modify: package.json:8-25
- Create: test/patient-team-migration.spec.ts

**Interfaces:**
- Produces Prisma model PatientProfessional with unique patientId_professionalId.
- Produces nullable Appointment.professionalId and relations appointmentProfessional / professionalAppointments.
- Produces reconcilePatientTeamAppointments(prisma: PrismaClient | PrismaService): Promise<PatientTeamReconciliationSummary>.
- Produces verifyPatientTeamMigration(databaseUrl): Promise<PatientTeamMigrationVerificationSummary> for isolated fresh, upgrade and guard schemas.
- Leaves Appointment.psychologistId and Patient.assignedPsychologistId physically intact.

- [ ] **Step 1: Write the failing schema and migration contract test**

Create test/patient-team-migration.spec.ts with concrete assertions:

~~~ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const migration = readFileSync(
  join(
    __dirname,
    '../prisma/migrations/20260928000000_patient_team_appointments/migration.sql',
  ),
  'utf8',
);
const verifier = readFileSync(
  join(__dirname, '../prisma/verify-patient-team-migration.ts'),
  'utf8',
);
const prismaServiceSource = readFileSync(
  join(__dirname, '../src/prisma/prisma.service.ts'),
  'utf8',
);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8'),
) as { scripts: Record<string, string> };

const models = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Set(model.fields.map((field) => field.name)),
  ]),
);

describe('patient team appointment migration', () => {
  it('adds the canonical team and appointment fields without removing legacy fields', () => {
    expect([...(models.get('PatientProfessional') ?? [])]).toEqual(
      expect.arrayContaining([
        'id',
        'tenantId',
        'patientId',
        'professionalId',
        'assignedAt',
        'assignedById',
        'isActive',
        'createdAt',
        'updatedAt',
      ]),
    );
    expect([...(models.get('Appointment') ?? [])]).toEqual(
      expect.arrayContaining(['professionalId', 'psychologistId', 'specialtyId']),
    );
    expect([...(models.get('Patient') ?? [])]).toEqual(
      expect.arrayContaining(['assignedPsychologistId', 'professionalAssignments']),
    );
  });

  it('aborts cross-tenant or missing-profile data before backfill', () => {
    expect(migration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(migration).toMatch(/RAISE EXCEPTION 'PATIENT_TEAM_CROSS_TENANT'/);
    expect(migration).toMatch(/RAISE EXCEPTION 'APPOINTMENT_CROSS_TENANT'/);
    expect(migration).toMatch(/RAISE EXCEPTION 'PROFESSIONAL_PROFILE_REQUIRED'/);
  });

  it('preserves historical specialty and fills only null values', () => {
    expect(migration).toMatch(
      /"specialtyId"\s*=\s*COALESCE\(appointment\."specialtyId", profile\."specialtyId"\)/,
    );
    expect(migration).toMatch(/"professionalId"\s*=\s*appointment\."psychologistId"/);
    expect(migration).toMatch(/"professionalId" IS DISTINCT FROM appointment\."psychologistId"/);
  });

  it('provides an allowlisted isolated upgrade verifier', () => {
    expect(packageJson.scripts['prisma:verify-patient-team-migration']).toBe(
      'ts-node prisma/verify-patient-team-migration.ts',
    );
    expect(verifier).toMatch(/assertSpecialtyStageDatabaseSafety/);
    expect(verifier).toMatch(/patient_team_(fresh|upgrade|cross_tenant|missing_profile)_/);
    expect(verifier).toMatch(/DROP SCHEMA/);
  });

  it('registers the new delegate for RLS wrapping and test cleanup', () => {
    expect(prismaServiceSource.match(/'patientProfessional'/g)).toHaveLength(2);
  });
});
~~~

- [ ] **Step 2: Run the migration contract and confirm red**

Run:

~~~bash
npm test -- --runInBand test/patient-team-migration.spec.ts
~~~

Expected: FAIL because PatientProfessional, Appointment.professionalId and the migration file do not exist.

- [ ] **Step 3: Add the Prisma relations with explicit relation names**

Add this model and the reciprocal fields. Name both Appointment-to-User relations because Prisma cannot infer two relations to User.

~~~prisma
model PatientProfessional {
  id             String   @id @default(cuid())
  tenantId       String
  tenant         Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  patientId      String
  patient        Patient  @relation(fields: [patientId], references: [id], onDelete: Cascade)
  professionalId String
  professional   User     @relation("PatientTeamProfessional", fields: [professionalId], references: [id], onDelete: Restrict)
  assignedAt     DateTime @default(now())
  assignedById   String?
  assignedBy     User?    @relation("PatientTeamAssigner", fields: [assignedById], references: [id], onDelete: SetNull)
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([patientId, professionalId])
  @@index([tenantId, patientId, isActive])
  @@index([tenantId, professionalId, isActive])
}
~~~

Add reciprocal fields:

~~~prisma
// Tenant
patientProfessionals PatientProfessional[]

// Patient
professionalAssignments PatientProfessional[]

// User
professionalAppointments Appointment[]          @relation("AppointmentProfessional")
patientAssignments       PatientProfessional[]  @relation("PatientTeamProfessional")
patientAssignmentsMade   PatientProfessional[]  @relation("PatientTeamAssigner")
assignedAppointments     Appointment[]          @relation("LegacyAppointmentPsychologist")

// Appointment
psychologistId String
psychologist   User  @relation("LegacyAppointmentPsychologist", fields: [psychologistId], references: [id], onDelete: Restrict)
professionalId String?
professional   User? @relation("AppointmentProfessional", fields: [professionalId], references: [id], onDelete: Restrict)

@@index([professionalId])
@@index([tenantId, professionalId, startTime])
@@index([tenantId, patientId, professionalId, startTime])
~~~

Change only the default for future Appointment.title rows from “Sesión de terapia” to “Consulta”.

Add patientProfessional to PrismaService.bindRlsDelegates and to cleanDatabase immediately before appointment so tenant-context wrapping and repeatable E2E cleanup include the new table.

- [ ] **Step 4: Write the guarded SQL migration**

Wrap the complete migration in explicit BEGIN/COMMIT so any guard failure rolls back its DDL as well as backfill. The migration must:

1. create PatientProfessional and its foreign keys/indexes;
2. add nullable Appointment.professionalId and its foreign key/indexes;
3. alter the Appointment.title default to Consulta;
4. execute guards before any backfill;
5. insert deterministic legacy team rows;
6. fill appointment canonical columns;
7. abort if a canonical appointment column remains null.

Use these exact guard/backfill predicates:

~~~sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Patient" patient
    JOIN "User" professional ON professional."id" = patient."assignedPsychologistId"
    WHERE patient."assignedPsychologistId" IS NOT NULL
      AND patient."tenantId" <> professional."tenantId"
  ) THEN
    RAISE EXCEPTION 'PATIENT_TEAM_CROSS_TENANT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Appointment" appointment
    JOIN "Patient" patient ON patient."id" = appointment."patientId"
    JOIN "User" professional ON professional."id" = appointment."psychologistId"
    WHERE appointment."tenantId" <> patient."tenantId"
       OR appointment."tenantId" <> professional."tenantId"
  ) THEN
    RAISE EXCEPTION 'APPOINTMENT_CROSS_TENANT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "assignedPsychologistId" AS "professionalId"
      FROM "Patient"
      WHERE "assignedPsychologistId" IS NOT NULL
      UNION
      SELECT "psychologistId" FROM "Appointment"
    ) referenced
    LEFT JOIN "ProfessionalProfile" profile
      ON profile."userId" = referenced."professionalId"
    WHERE profile."userId" IS NULL
  ) THEN
    RAISE EXCEPTION 'PROFESSIONAL_PROFILE_REQUIRED';
  END IF;
END $$;

INSERT INTO "PatientProfessional" (
  "id", "tenantId", "patientId", "professionalId", "assignedAt",
  "assignedById", "isActive", "createdAt", "updatedAt"
)
SELECT
  'legacy_' || md5(patient."id" || ':' || professional."id"),
  patient."tenantId",
  patient."id",
  professional."id",
  CURRENT_TIMESTAMP,
  NULL,
  professional."isActive" AND profile."isActive",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Patient" patient
JOIN "User" professional ON professional."id" = patient."assignedPsychologistId"
JOIN "ProfessionalProfile" profile ON profile."userId" = professional."id"
ON CONFLICT ("patientId", "professionalId") DO NOTHING;

UPDATE "Appointment" appointment
SET
  "professionalId" = appointment."psychologistId",
  "specialtyId" = COALESCE(appointment."specialtyId", profile."specialtyId")
FROM "ProfessionalProfile" profile
WHERE profile."userId" = appointment."psychologistId"
  AND (
    appointment."professionalId" IS DISTINCT FROM appointment."psychologistId"
    OR appointment."specialtyId" IS NULL
  );
~~~

- [ ] **Step 5: Add the idempotent catch-up reconciler**

Export this public contract from prisma/reconcile-patient-team-appointments.ts:

~~~ts
export type PatientTeamReconciliationSummary = {
  assignmentsBefore: number;
  assignmentsAfter: number;
  appointmentsRepaired: number;
  unresolvedAppointments: number;
};

export async function reconcilePatientTeamAppointments(
  prisma: PrismaClient | PrismaService,
): Promise<PatientTeamReconciliationSummary>;
~~~

Inside one Prisma TransactionIsolationLevel.Serializable transaction with at most three total attempts on P2034:

- query and throw PATIENT_TEAM_CROSS_TENANT, APPOINTMENT_CROSS_TENANT or PROFESSIONAL_PROFILE_REQUIRED before writes;
- execute the same INSERT ... ON CONFLICT DO NOTHING for legacy patient pointers;
- execute the same set-based appointment UPDATE, repairing a professionalId that differs from psychologistId and filling only a null specialtyId;
- count remaining appointments whose professionalId/specialtyId is null or whose mirrored professional identifiers differ;
- throw APPOINTMENT_RECONCILIATION_INCOMPLETE when that count is nonzero;
- return before/after/repaired counts.

The command entry point must disconnect in finally and set process.exitCode = 1 after logging only the functional error message.

Add:

~~~json
"prisma:reconcile-patient-team": "ts-node prisma/reconcile-patient-team-appointments.ts",
"prisma:verify-patient-team-migration": "ts-node prisma/verify-patient-team-migration.ts"
~~~

- [ ] **Step 6: Add an isolated real-database migration verifier**

Export:

~~~ts
export type PatientTeamMigrationVerificationSummary = {
  freshSchema: true;
  upgradedAssignments: number;
  upgradedAppointments: number;
  historicalSpecialtiesPreserved: number;
  rejectedCrossTenantFixture: true;
  rejectedMissingProfileFixture: true;
};

export async function verifyPatientTeamMigration(
  databaseUrl: string | undefined = process.env.DATABASE_URL_TEST,
): Promise<PatientTeamMigrationVerificationSummary>;
~~~

The verifier must call assertSpecialtyStageDatabaseSafety on the unchanged base URL before opening a connection or invoking Prisma. It creates only internally generated schemas matching `patient_team_(fresh|upgrade|cross_tenant|missing_profile)_[a-f0-9]+`, never accepts a schema name from input, and drops each generated schema in finally after checking the same regex again.

Use mkdtemp plus the local Prisma CLI entry point resolved from the installed package. Copy schema.prisma and migration directories into the temporary tree; invoke the CLI with process.execPath and a DATABASE_URL whose schema query is the generated schema. Do not invoke a shell or interpolate database commands.

Run these four concrete scenarios:

1. fresh: copy every migration, deploy into an empty schema and assert PatientProfessional plus Appointment.professionalId exist;
2. upgrade: deploy every migration before 20260928000000_patient_team_appointments, insert one active legacy pointer, one inactive legacy pointer, one appointment with null specialty and one appointment with a pre-existing historical specialty, then copy/deploy the target migration and assert assignment activity, canonical IDs, filled null specialty and preserved historical specialty;
3. cross_tenant: deploy prior migrations, insert a patient pointer and appointment whose referenced professional belongs to another tenant, deploy the target migration and require PATIENT_TEAM_CROSS_TENANT or APPOINTMENT_CROSS_TENANT before any backfill row exists;
4. missing_profile: deploy prior migrations, reference a same-tenant user without ProfessionalProfile, deploy the target migration and require PROFESSIONAL_PROFILE_REQUIRED before any backfill row exists.

Every fixture uses fixed IDs scoped to its unique schema. Query assertions use raw parameterized reads, return only counts/IDs, and disconnect all clients in finally. Remove only the mkdtemp directory created by this process.

- [ ] **Step 7: Generate Prisma and make the migration contract green**

Run:

~~~bash
npx prisma generate
npx prisma validate
npm test -- --runInBand test/patient-team-migration.spec.ts
~~~

Expected: Prisma generation and validation succeed; the migration suite passes.

- [ ] **Step 8: Commit the data foundation**

~~~bash
git add prisma/schema.prisma prisma/migrations/20260928000000_patient_team_appointments prisma/reconcile-patient-team-appointments.ts prisma/verify-patient-team-migration.ts src/prisma/prisma.service.ts package.json test/patient-team-migration.spec.ts
git commit -m "feat(api): add patient team data model"
~~~

---

### Task 2: Resolve eligible professionals from active profiles

**Files:**
- Create: src/patient-team/patient-team.types.ts
- Create: src/patient-team/professional-eligibility.service.ts
- Create: src/patient-team/professional-eligibility.service.spec.ts
- Create: src/patient-team/patient-team.module.ts

**Interfaces:**
- Produces TeamActor = Pick<AuthUser, 'userId' | 'tenantId' | 'role'>.
- Produces ProfessionalEligibilityService.resolve(db, tenantId, professionalId, expectedSpecialtyId?): Promise<EligibleProfessional>.
- Produces ProfessionalEligibilityService.list(db, tenantId, specialtyId?): Promise<EligibleProfessional[]>.
- EligibleProfessional contains user identity plus one active ProfessionalProfile and Specialty.

- [ ] **Step 1: Write failing eligibility tests**

Use a Prisma mock with user.findFirst, tenantSpecialty.findUnique and user.findMany. Cover these exact cases:

~~~ts
it('accepts an ADMIN with an active professional profile', async () => {
  db.user.findFirst.mockResolvedValue(
    professional({
      role: 'ADMIN',
      professionalProfile: profile({ specialtyId: 'nutrition' }),
    }),
  );
  db.tenantSpecialty.findUnique.mockResolvedValue({
    tenantId: 'tenant-1',
    specialtyId: 'nutrition',
  });

  await expect(
    service.resolve(db, 'tenant-1', 'admin-clinical', 'nutrition'),
  ).resolves.toMatchObject({
    id: 'admin-clinical',
    professionalProfile: { specialtyId: 'nutrition' },
  });
});

it('does not infer clinical capacity from PROFESIONAL role alone', async () => {
  db.user.findFirst.mockResolvedValue(
    professional({ role: 'PROFESIONAL', professionalProfile: null }),
  );
  await expect(
    service.resolve(db, 'tenant-1', 'professional-1'),
  ).rejects.toMatchObject({
    status: 403,
    response: { code: 'PROFESSIONAL_NOT_AUTHORIZED' },
  });
});

it('rejects a requested specialty that differs from the profile', async () => {
  db.user.findFirst.mockResolvedValue(
    professional({ professionalProfile: profile({ specialtyId: 'psychology' }) }),
  );
  db.tenantSpecialty.findUnique.mockResolvedValue({
    tenantId: 'tenant-1',
    specialtyId: 'psychology',
  });
  await expect(
    service.resolve(db, 'tenant-1', 'professional-1', 'nutrition'),
  ).rejects.toMatchObject({
    status: 422,
    response: { code: 'PROFESSIONAL_SPECIALTY_MISMATCH' },
  });
});
~~~

Also assert that another-tenant or missing users become 404, inactive accounts/profiles become 403, and a profile specialty absent from TenantSpecialty becomes 409 SPECIALTY_NOT_ENABLED.

- [ ] **Step 2: Run the focused suite and confirm red**

Run:

~~~bash
npm test -- --runInBand src/patient-team/professional-eligibility.service.spec.ts
~~~

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Define the shared types**

~~~ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type TeamDb = PrismaService | Prisma.TransactionClient;
export type TeamActor = Pick<AuthUser, 'userId' | 'tenantId' | 'role'>;

export const eligibleProfessionalSelect = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  isActive: true,
  professionalProfile: {
    include: { specialty: true },
  },
} satisfies Prisma.UserSelect;

export type EligibleProfessional = Prisma.UserGetPayload<{
  select: typeof eligibleProfessionalSelect;
}>;
~~~

- [ ] **Step 4: Implement server-authoritative eligibility**

resolve must query by id + tenantId, then enforce in this order:

~~~ts
if (!user) throw new NotFoundException('Profesional no encontrado');
if (!user.isActive || !user.professionalProfile?.isActive) {
  throw new ForbiddenException({
    statusCode: 403,
    code: 'PROFESSIONAL_NOT_AUTHORIZED',
    message: 'La cuenta no tiene capacidad clínica activa.',
  });
}

const enabled = await db.tenantSpecialty.findUnique({
  where: {
    tenantId_specialtyId: {
      tenantId,
      specialtyId: user.professionalProfile.specialtyId,
    },
  },
});
if (!enabled || !user.professionalProfile.specialty.isActive) {
  throw new ConflictException({
    statusCode: 409,
    code: 'SPECIALTY_NOT_ENABLED',
    message: 'La especialidad no está habilitada para este consultorio.',
  });
}
if (
  expectedSpecialtyId &&
  expectedSpecialtyId !== user.professionalProfile.specialtyId
) {
  throw new UnprocessableEntityException({
    statusCode: 422,
    code: 'PROFESSIONAL_SPECIALTY_MISMATCH',
    message: 'La especialidad no coincide con el perfil profesional.',
  });
}
~~~

list must select only active accounts with active profiles, active catalog specialties and an existing TenantSpecialty row for tenantId. Sort by specialty.name, lastName, firstName. Never filter by User.role.

- [ ] **Step 5: Export the resolver through PatientTeamModule**

~~~ts
@Module({
  providers: [ProfessionalEligibilityService],
  exports: [ProfessionalEligibilityService],
})
export class PatientTeamModule {}
~~~

- [ ] **Step 6: Run tests and commit**

Run:

~~~bash
npm test -- --runInBand src/patient-team/professional-eligibility.service.spec.ts
npm run build
~~~

Expected: focused tests and build pass.

~~~bash
git add src/patient-team
git commit -m "feat(api): resolve eligible clinic professionals"
~~~

---

### Task 3: Add the treating-team API and transactional domain service

**Files:**
- Create: src/patient-team/patient-team.service.ts
- Create: src/patient-team/patient-team.service.spec.ts
- Create: src/patient-team/patient-team.controller.ts
- Create: src/patient-team/patient-team.controller.spec.ts
- Modify: src/patient-team/patient-team.module.ts
- Modify: src/common/guards/tenant.guard.ts
- Create: src/common/guards/tenant.guard.spec.ts
- Modify: src/app.module.ts:12-32, 60-82

**Interfaces:**
- Produces PatientTeamService.list(tenantId, patientId, actor).
- Produces PatientTeamService.listEligible(tenantId, patientId, specialtyId, actor).
- Produces PatientTeamService.assign(tenantId, patientId, professionalId, actor).
- Produces PatientTeamService.remove(tenantId, patientId, professionalId, actor).
- Produces ensureActive(tx, { tenantId, patientId, professionalId, assignedById }): Promise<PatientProfessional>.
- Produces assertActiveMembership(db, tenantId, patientId, professionalId): Promise<void>.
- Produces lifecycle methods consumed by Task 5.
- Tenant route/body mismatches return the stable 403 code TENANT_SCOPE_VIOLATION.

- [ ] **Step 1: Write failing service tests for permissions and idempotency**

Create cases with admin, assistant, assigned professional and unassigned professional actors:

~~~ts
it('lets an assigned professional refer another eligible professional', async () => {
  db.patientProfessional.findUnique
    .mockResolvedValueOnce(activeAssignment({ professionalId: 'actor' }))
    .mockResolvedValueOnce(null);
  eligibility.resolve.mockResolvedValue(eligible({ id: 'target' }));
  db.patientProfessional.create.mockResolvedValue(
    activeAssignment({ professionalId: 'target', assignedById: 'actor' }),
  );

  await service.assign('tenant-1', 'patient-1', 'target', professionalActor);

  expect(db.patientProfessional.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      professionalId: 'target',
      assignedById: 'actor',
      isActive: true,
    }),
    include: expect.any(Object),
  });
});

it('rejects referral from a professional outside the patient team', async () => {
  db.patientProfessional.findUnique.mockResolvedValue(null);
  await expect(
    service.assign('tenant-1', 'patient-1', 'target', professionalActor),
  ).rejects.toMatchObject({
    status: 403,
    response: { code: 'TEAM_ASSIGNMENT_FORBIDDEN' },
  });
  expect(eligibility.resolve).not.toHaveBeenCalled();
});

it('keeps assignedAt and assignedById unchanged for an already active row', async () => {
  const row = activeAssignment({
    assignedAt: new Date('2026-01-01T00:00:00Z'),
    assignedById: 'original-actor',
  });
  db.patientProfessional.findUnique.mockResolvedValue(row);
  await expect(
    service.assign('tenant-1', 'patient-1', 'target', adminActor),
  ).resolves.toEqual(expect.objectContaining(row));
  expect(db.patientProfessional.update).not.toHaveBeenCalled();
});
~~~

Add tests for inactive-row reactivation resetting assignedAt/assignedById, ADMIN/ASISTENTE assignment, professional removal returning TEAM_ASSIGNMENT_FORBIDDEN, and cross-tenant patient returning 404.

In src/common/guards/tenant.guard.spec.ts, assert that a route tenant mismatch and a body tenant mismatch both throw a ForbiddenException whose response includes code TENANT_SCOPE_VIOLATION, while a matching tenant still initializes the RLS context.

- [ ] **Step 2: Write failing removal tests**

~~~ts
it('blocks removal and returns safe future appointment details', async () => {
  db.appointment.findMany.mockResolvedValue([
    {
      id: 'appointment-1',
      startTime: new Date('2026-10-01T15:00:00Z'),
      status: 'SCHEDULED',
      title: 'Consulta',
      specialty: { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición' },
    },
  ]);

  await expect(
    service.remove('tenant-1', 'patient-1', 'professional-1', adminActor),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      code: 'PROFESSIONAL_HAS_FUTURE_APPOINTMENTS',
      details: {
        appointments: [
          expect.objectContaining({ id: 'appointment-1', status: 'SCHEDULED' }),
        ],
      },
    },
  });
  expect(db.patientProfessional.update).not.toHaveBeenCalled();
});
~~~

Also verify CANCELLED rows do not block, an already inactive row is returned unchanged, and removing the legacy pointer chooses the oldest remaining active assignment by assignedAt then id.

- [ ] **Step 3: Run service tests and confirm red**

Run:

~~~bash
npm test -- --runInBand src/patient-team/patient-team.service.spec.ts src/common/guards/tenant.guard.spec.ts
~~~

Expected: FAIL because PatientTeamService does not exist and TenantGuard does not return the stable scope code.

- [ ] **Step 4: Implement actor and patient authorization**

Use toCanonicalRole. Every public PatientTeamService method first rejects actor.tenantId !== tenantId with TENANT_SCOPE_VIOLATION; this protects direct service consumers in addition to the HTTP guard. ADMIN and ASISTENTE pass administrative checks. A PROFESIONAL must have an active PatientProfessional row for the patient and an active profile/account. Every forbidden team mutation throws:

~~~ts
throw new ForbiddenException({
  statusCode: 403,
  code: 'TEAM_ASSIGNMENT_FORBIDDEN',
  message: 'No tienes permiso para modificar este equipo tratante.',
});
~~~

Patient lookup is always:

~~~ts
const patient = await db.patient.findFirst({
  where: { id: patientId, tenantId, deletedAt: null },
  select: { id: true, tenantId: true, assignedPsychologistId: true },
});
if (!patient) throw new NotFoundException('Paciente no encontrado');
~~~

Update TenantGuard to preserve its current messages and add the same stable envelope to both param and body mismatch branches:

~~~ts
throw new ForbiddenException({
  statusCode: 403,
  code: 'TENANT_SCOPE_VIOLATION',
  message: 'Acceso denegado: El tenant no coincide',
});
~~~

Use “Acceso denegado: No puede crear recursos para otro tenant” as message in the body-mismatch branch, preserving its current copy.

- [ ] **Step 5: Implement idempotent assignment and legacy-pointer maintenance**

assign wraps actor authorization, patient lookup and ensureActive in runSerializableTransaction(prisma, tenantId, actor.userId, callback). ensureActive accepts that transaction client so appointment flows can reuse it without nesting. It must resolve eligibility, import randomUUID from node:crypto, then use one conflict-safe SQL statement. Do not catch P2002 inside a PostgreSQL transaction because the transaction is already aborted after that error.

~~~ts
const assignmentId = randomUUID();
const assignedAt = new Date();
await db.$executeRaw`
  INSERT INTO "PatientProfessional" (
    "id", "tenantId", "patientId", "professionalId", "assignedAt",
    "assignedById", "isActive", "createdAt", "updatedAt"
  ) VALUES (
    ${assignmentId}, ${tenantId}, ${patientId}, ${professionalId}, ${assignedAt},
    ${assignedById}, TRUE, ${assignedAt}, ${assignedAt}
  )
  ON CONFLICT ("patientId", "professionalId") DO UPDATE
  SET
    "isActive" = TRUE,
    "assignedAt" = EXCLUDED."assignedAt",
    "assignedById" = EXCLUDED."assignedById",
    "updatedAt" = EXCLUDED."updatedAt"
  WHERE "PatientProfessional"."isActive" = FALSE
`;

const assignment = await db.patientProfessional.findUniqueOrThrow({
  where: { patientId_professionalId: { patientId, professionalId } },
  include: patientTeamInclude,
});

await db.patient.updateMany({
  where: { id: patientId, tenantId, assignedPsychologistId: null },
  data: { assignedPsychologistId: professionalId },
});
return assignment;
~~~

The conditional conflict clause leaves assignedAt and assignedById untouched for an active row, renews both for an inactive row, and cannot produce a uniqueness exception during concurrent assignment. The conditional patient update also runs for an already-active or concurrently-created assignment, so every successful canonical add may restore an empty legacy pointer without replacing a non-null one.

- [ ] **Step 6: Implement listing, candidates, and removal**

list returns active and inactive rows ordered by isActive desc, specialty.name, professional.lastName and professional.firstName. Map the Prisma profile to the public flat contract:

~~~ts
private toTeamMember(row: PatientProfessionalWithRelations) {
  const profile = row.professional.professionalProfile;
  return {
    id: row.id,
    patientId: row.patientId,
    professionalId: row.professionalId,
    assignedAt: row.assignedAt,
    assignedBy: row.assignedBy,
    isActive:
      row.isActive &&
      row.professional.isActive &&
      profile?.isActive === true &&
      profile.specialty.isActive,
    professional: {
      id: row.professional.id,
      firstName: row.professional.firstName,
      lastName: row.professional.lastName,
      professionalTitle:
        profile?.professionalTitle ?? row.professional.professionalTitle,
      licenseNumber: profile?.licenseNumber ?? row.professional.licenseNumber,
      specialty: profile?.specialty ?? null,
    },
  };
}
~~~

An active assignment with a missing/inactive profile is an invariant violation and must not be returned as active. An inactive historical row whose profile was deleted remains visible with specialty null and sorts after named specialties; this is the only nullable-specialty team response.

listEligible maps ProfessionalEligibilityService.list to the same flat professional projection and adds:

~~~ts
isAssigned: assignmentsByProfessionalId.get(user.id)?.isActive === true
~~~

remove runs in runSerializableTransaction, checks ADMIN/ASISTENTE, queries future appointments using canonical reference with legacy fallback, and updates isActive false. Use this predicate:

~~~ts
where: {
  tenantId,
  patientId,
  startTime: { gt: new Date() },
  status: { not: 'CANCELLED' },
  OR: [
    { professionalId },
    { professionalId: null, psychologistId: professionalId },
  ],
}
~~~

After deactivation, when the removed professional equals patient.assignedPsychologistId, find the oldest remaining active assignment ordered by assignedAt asc then id asc and set the pointer to that professionalId or null. An already-inactive row still performs the future-appointment consistency check, repairs that legacy pointer if necessary, and returns without changing assignment timestamps.

- [ ] **Step 7: Add the four HTTP routes and controller tests**

Controller:

~~~ts
@ApiTags('patient-team')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'ASISTENTE', 'PROFESIONAL')
@Controller('tenants/:tenantId/patients/:patientId/team')
export class PatientTeamController {
  @Get()
  list(@Param('tenantId') tenantId: string, @Param('patientId') patientId: string,
       @CurrentUser() actor: AuthUser) {
    return this.service.list(tenantId, patientId, actor);
  }

  @Get('eligible')
  listEligible(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @Query('specialtyId') specialtyId: string | undefined,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.listEligible(tenantId, patientId, specialtyId, actor);
  }

  @Put(':professionalId')
  assign(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @Param('professionalId') professionalId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.assign(tenantId, patientId, professionalId, actor);
  }

  @Delete(':professionalId')
  remove(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @Param('professionalId') professionalId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.remove(tenantId, patientId, professionalId, actor);
  }
}
~~~

Controller tests must assert route methods forward tenantId, patientId, professionalId and the full actor, and that DELETE is not restricted by a decorator that would bypass the stable service error for PROFESIONAL.

- [ ] **Step 8: Register the module, run focused tests, and commit**

PatientTeamModule declares controller and both services, exports PatientTeamService and ProfessionalEligibilityService. AppModule imports PatientTeamModule.

Run:

~~~bash
npm test -- --runInBand src/patient-team src/common/guards/tenant.guard.spec.ts
npm run build
~~~

Expected: all patient-team tests and build pass.

~~~bash
git add src/patient-team src/common/guards/tenant.guard.ts src/common/guards/tenant.guard.spec.ts src/app.module.ts
git commit -m "feat(api): add patient treating team"
~~~

---

### Task 4: Bridge legacy patient assignment writes into the team

**Files:**
- Create: src/patients/patients.service.spec.ts
- Modify: src/patients/patients.service.ts:1-225
- Modify: src/patients/patients.controller.ts:1-66
- Modify: src/patients/patients.module.ts
- Modify: src/patients/dto/patient.dto.ts:60-69

**Interfaces:**
- PatientsService.create keeps its current arguments and activates a canonical team row when assignedPsychologistId is non-null.
- PatientsService.update becomes update(tenantId, patientId, dto, actorId, actorRole).
- A null legacy pointer clears only Patient.assignedPsychologistId.
- Patient responses continue to expose assignedPsychologist.

- [ ] **Step 1: Write failing compatibility tests**

~~~ts
it('creates the patient and canonical assignment in one transaction', async () => {
  db.patient.create.mockResolvedValue({
    id: 'patient-1',
    tenantId: 'tenant-1',
    assignedPsychologistId: 'professional-1',
  });

  await service.create(
    'tenant-1',
    patientInput({ assignedPsychologistId: 'professional-1' }),
    'admin-1',
    'ADMIN',
  );

  expect(team.ensureActive).toHaveBeenCalledWith(
    tx,
    {
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      professionalId: 'professional-1',
      assignedById: 'admin-1',
    },
  );
});

it('clearing the legacy pointer does not deactivate any team row', async () => {
  await service.update(
    'tenant-1',
    'patient-1',
    { assignedPsychologistId: null as unknown as string },
    'assistant-1',
    'ASISTENTE',
  );
  expect(db.patient.update).toHaveBeenCalledWith({
    where: { id: 'patient-1' },
    data: expect.objectContaining({ assignedPsychologistId: null }),
  });
  expect(team.remove).not.toHaveBeenCalled();
  expect(db.patientProfessional.updateMany).not.toHaveBeenCalled();
});
~~~

Also test that an omitted field leaves the legacy pointer untouched and that a non-null update reactivates without removing existing professionals.

- [ ] **Step 2: Run the patient service suite and confirm red**

Run:

~~~bash
npm test -- --runInBand src/patients/patients.service.spec.ts
~~~

Expected: FAIL because PatientsService does not inject PatientTeamService and update lacks actor arguments.

- [ ] **Step 3: Extract the legacy pointer before patient writes**

Keep normalization, but separate the pointer:

~~~ts
const sanitized = this.sanitizeCreatePayload(dto);
const assignedPsychologistId = sanitized.assignedPsychologistId;
const patient = await tx.patient.create({
  data: { ...sanitized, tenantId },
});
if (assignedPsychologistId) {
  await this.patientTeam.ensureActive(tx, {
    tenantId,
    patientId: patient.id,
    professionalId: assignedPsychologistId,
    assignedById: actorId,
  });
}
~~~

The update path runs in a transaction with RLS context. If the field is undefined, do nothing to pointer/team. If it is null, update only the pointer. If it is a string, update the pointer and call ensureActive. Never call remove from this compatibility adapter.

- [ ] **Step 4: Align patient controller roles and actor forwarding**

Use canonical decorators:

~~~ts
@Roles('ADMIN', 'ASISTENTE', 'PROFESIONAL')
@Post()

@Roles('ADMIN', 'ASISTENTE', 'PROFESIONAL')
@Patch(':patientId')
async update(
  @Param('tenantId') tenantId: string,
  @Param('patientId') patientId: string,
  @Body() dto: UpdatePatientDto,
  @CurrentUser() actor: AuthUser,
) {
  return this.patientsService.update(
    tenantId,
    patientId,
    dto,
    actor.userId,
    actor.role,
  );
}
~~~

Keep DELETE restricted to ADMIN. Mark assignedPsychologistId in Swagger as a deprecated compatibility field whose non-null value adds a team member.

- [ ] **Step 5: Import PatientTeamModule and make tests green**

Run:

~~~bash
npm test -- --runInBand src/patients/patients.service.spec.ts src/users/users.controller.spec.ts
npm run build
~~~

Expected: patient compatibility tests, affected controller tests and build pass.

- [ ] **Step 6: Commit the patient adapter**

~~~bash
git add src/patients
git commit -m "feat(api): bridge legacy patient assignments"
~~~

---

### Task 5: Protect professional deactivation and deactivate treating assignments

**Files:**
- Modify: src/patient-team/patient-team.service.ts
- Modify: src/patient-team/patient-team.service.spec.ts
- Modify: src/users/users.service.ts:263-501
- Modify: src/users/users.team.spec.ts
- Modify: src/users/users.module.ts

**Interfaces:**
- PatientTeamService.assertNoFutureAppointmentsForProfessional(tx, tenantId, professionalId): Promise<void>.
- PatientTeamService.deactivateAllForProfessional(tx, tenantId, professionalId): Promise<number>.
- UsersService calls both when an active account/profile loses clinical capacity.

- [ ] **Step 1: Write failing lifecycle tests**

Add to users.team.spec.ts:

~~~ts
it('blocks profile deactivation while the professional has future appointments', async () => {
  patientTeam.assertNoFutureAppointmentsForProfessional.mockRejectedValue(
    new ConflictException({
      statusCode: 409,
      code: 'PROFESSIONAL_HAS_FUTURE_APPOINTMENTS',
      message: 'Cancela o reasigna las citas futuras.',
    }),
  );

  await expect(
    service.update(
      'tenant-1',
      'professional-1',
      { professionalProfile: { specialtyId: 'psychology', isActive: false } },
      'admin-1',
    ),
  ).rejects.toMatchObject({
    response: { code: 'PROFESSIONAL_HAS_FUTURE_APPOINTMENTS' },
  });
  expect(tx.user.update).not.toHaveBeenCalled();
});

it('deactivates every treating assignment in the same successful transaction', async () => {
  await service.update(
    'tenant-1',
    'professional-1',
    { isActive: false },
    'admin-1',
  );
  expect(
    patientTeam.assertNoFutureAppointmentsForProfessional,
  ).toHaveBeenCalledWith(tx, 'tenant-1', 'professional-1');
  expect(patientTeam.deactivateAllForProfessional).toHaveBeenCalledWith(
    tx,
    'tenant-1',
    'professional-1',
  );
});
~~~

Add cases for profile removal, role change to ASISTENTE, and reactivation not changing old PatientProfessional rows.

- [ ] **Step 2: Run lifecycle tests and confirm red**

Run:

~~~bash
npm test -- --runInBand src/users/users.team.spec.ts
~~~

Expected: FAIL because UsersService has no patient-team lifecycle dependency.

- [ ] **Step 3: Implement tenant-wide future-appointment protection**

In PatientTeamService query future appointments with tenantId, startTime greater than now, status not CANCELLED and canonical/legacy professional fallback. Throw PROFESSIONAL_HAS_FUTURE_APPOINTMENTS with details.appointments containing id, patientId, startTime, status, title and specialty.

deactivateAllForProfessional must use:

~~~ts
const result = await tx.patientProfessional.updateMany({
  where: { tenantId, professionalId, isActive: true },
  data: { isActive: false },
});
return result.count;
~~~

- [ ] **Step 4: Detect loss of effective clinical capacity before the user update**

In updateInTransaction compute:

~~~ts
const nextRole = dto.role ?? user.role;
const nextAccountActive = dto.isActive ?? user.isActive;
const nextProfileActive = profile?.isActive === true;
const supportedClinicalRole =
  isAdminRole(nextRole) || isProfessionalRole(nextRole);
const hadClinicalCapacity =
  user.isActive && current?.isActive === true;
const willHaveClinicalCapacity =
  nextAccountActive && nextProfileActive && supportedClinicalRole;
const losesClinicalCapacity =
  hadClinicalCapacity && !willHaveClinicalCapacity;

if (losesClinicalCapacity) {
  await this.patientTeam.assertNoFutureAppointmentsForProfessional(
    tx,
    tenantId,
    userId,
  );
}
~~~

After tx.user.update succeeds, call deactivateAllForProfessional only when losesClinicalCapacity. Do not reactivate assignments when capacity returns.

- [ ] **Step 5: Import PatientTeamModule and run focused regression tests**

Run:

~~~bash
npm test -- --runInBand src/users/users.team.spec.ts src/patient-team/patient-team.service.spec.ts test/users-seat-enforcement.spec.ts
npm run build
~~~

Expected: all focused suites and build pass.

- [ ] **Step 6: Commit the lifecycle integration**

~~~bash
git add src/users src/patient-team
git commit -m "feat(api): protect professional deactivation"
~~~

---

### Task 6: Make appointments canonical, specialty-aware, and permissioned

**Files:**
- Modify: src/appointments/dto/appointment.dto.ts
- Modify: src/appointments/appointments.controller.ts
- Modify: src/appointments/appointments.service.ts
- Modify: src/appointments/appointments.module.ts
- Replace: src/appointments/appointments.service.spec.ts
- Modify: test/appointments-conflict.spec.ts

**Interfaces:**
- CreateAppointmentDto accepts professionalId?, psychologistId?, specialtyId? and validates the required combination in the service.
- ListAppointmentsQueryDto accepts professionalId, psychologistId, specialtyId, patientId, status, from and to.
- AppointmentsService methods receive TeamActor for create/list/get/update/cancel.
- Every response returns professionalId/professional plus matching psychologistId/psychologist aliases.

- [ ] **Step 1: Write failing DTO/normalization tests**

Cover canonical, legacy and contradictory inputs:

~~~ts
it('writes canonical and legacy IDs from a canonical request', async () => {
  await service.create(
    'tenant-1',
    {
      patientId: 'patient-1',
      professionalId: 'professional-1',
      specialtyId: 'nutrition',
      startTime: futureIso,
      duration: 60,
    },
    adminActor,
  );

  expect(tx.appointment.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      professionalId: 'professional-1',
      psychologistId: 'professional-1',
      specialtyId: 'nutrition',
    }),
    include: expect.any(Object),
  });
});

it('derives specialty only for a legacy-only request', async () => {
  eligibility.resolve.mockResolvedValue(
    eligible({ id: 'professional-1', specialtyId: 'psychology' }),
  );
  await service.create(
    'tenant-1',
    {
      patientId: 'patient-1',
      psychologistId: 'professional-1',
      startTime: futureIso,
      duration: 60,
    },
    adminActor,
  );
  expect(tx.appointment.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ specialtyId: 'psychology' }),
    include: expect.any(Object),
  });
});

it('rejects conflicting canonical and legacy professional IDs', async () => {
  await expect(
    service.create(
      'tenant-1',
      {
        patientId: 'patient-1',
        professionalId: 'one',
        psychologistId: 'two',
        specialtyId: 'psychology',
        startTime: futureIso,
        duration: 60,
      },
      adminActor,
    ),
  ).rejects.toMatchObject({ status: 400 });
});
~~~

Also test canonical input without specialty returns 422, responses fallback from psychologist when professional is null, aliases always match, list rejects differing professionalId/psychologistId filters, and either filter matches canonical rows plus rows whose professionalId is still null.

- [ ] **Step 2: Write failing authorization and transaction tests**

Test:

- ADMIN and ASISTENTE can create/reassign any eligible professional;
- PROFESIONAL can create only for self and only with active patient membership;
- PROFESIONAL cannot change professionalId, patientId or cancel/update a third-party appointment;
- an assigned professional can read appointments for that patient;
- an unassigned professional receives 403;
- create/reassign calls PatientTeamService.ensureActive in the same transaction;
- reassignment never deactivates the previous professional;
- serialized retry re-runs conflict and team checks.

Use this key assertion:

~~~ts
expect(team.ensureActive).toHaveBeenCalledWith(tx, {
  tenantId: 'tenant-1',
  patientId: 'patient-1',
  professionalId: 'nutrition-1',
  assignedById: 'assistant-1',
});
~~~

- [ ] **Step 3: Run appointment suites and confirm red**

Run:

~~~bash
npm test -- --runInBand src/appointments/appointments.service.spec.ts test/appointments-conflict.spec.ts
~~~

Expected: FAIL because the current service only accepts psychologistId and has no actor-aware authorization.

- [ ] **Step 4: Define canonical and compatible DTOs**

~~~ts
export class CreateAppointmentDto {
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @IsString()
  @IsOptional()
  professionalId?: string;

  @IsString()
  @IsOptional()
  psychologistId?: string;

  @IsString()
  @IsOptional()
  specialtyId?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsNotEmpty()
  startTime: string;

  @IsInt()
  @Min(15)
  @Max(240)
  duration: number;

  @IsString()
  @IsOptional()
  location?: string;

  @IsBoolean()
  @IsOptional()
  isOnline?: boolean;

  @IsString()
  @IsOptional()
  meetingUrl?: string;
}

export class ListAppointmentsQueryDto {
  @IsString() @IsOptional() professionalId?: string;
  @IsString() @IsOptional() psychologistId?: string;
  @IsString() @IsOptional() specialtyId?: string;
  @IsString() @IsOptional() patientId?: string;
  @IsEnum(AppointmentStatus) @IsOptional() status?: AppointmentStatus;
  @IsDateString() @IsOptional() from?: string;
  @IsDateString() @IsOptional() to?: string;
}
~~~

UpdateAppointmentDto remains PartialType(CreateAppointmentDto) plus optional AppointmentStatus.

- [ ] **Step 5: Pass the authenticated actor through every endpoint**

At controller class level use:

~~~ts
@Roles('ADMIN', 'ASISTENTE', 'PROFESIONAL')
~~~

Pass CurrentUser actor into create, findAll, findOne, update and cancel. Bind ListAppointmentsQueryDto with @Query() so whitelist/transform applies.

- [ ] **Step 6: Implement one professional-reference normalizer**

~~~ts
private normalizeProfessionalReference(input: {
  professionalId?: string;
  psychologistId?: string;
  specialtyId?: string;
}) {
  if (
    input.professionalId &&
    input.psychologistId &&
    input.professionalId !== input.psychologistId
  ) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'PROFESSIONAL_REFERENCE_MISMATCH',
      message: 'professionalId y psychologistId deben identificar a la misma persona.',
    });
  }
  const professionalId = input.professionalId ?? input.psychologistId;
  if (!professionalId) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      code: 'PROFESSIONAL_REQUIRED',
      message: 'Selecciona un profesional.',
    });
  }
  return {
    professionalId,
    specialtyId: input.specialtyId,
    legacyOnly: !input.professionalId && !!input.psychologistId,
  };
}
~~~

After eligibility.resolve, require specialtyId for canonical input; derive it from the profile only when legacyOnly is true. Reuse an optional form for list filters: reject differing aliases, otherwise filter with OR [{ professionalId }, { professionalId: null, psychologistId: professionalId }] and apply specialtyId independently.

- [ ] **Step 7: Move create/update into serializable transactions**

Use runSerializableTransaction(prisma, tenantId, actor.userId, callback). Inside callback:

1. load patient by id + tenantId + deletedAt null;
2. authorize actor;
3. resolve professional and specialty;
4. validate working hours;
5. detect conflict;
6. ensure team assignment;
7. write professionalId, psychologistId and specialtyId;
8. map the response aliases.

For update, normalize only identifiers present in the DTO, merge them with the stored appointment, then compute patientChanged, professionalChanged, specialtyChanged and intervalChanged by value. Sending unchanged canonical identifiers with a title/description edit must not trigger current-profile revalidation. A legacy-only professional reassignment derives its specialty; a canonical professional reassignment requires specialtyId in the same request.

Conflict lookup must use:

~~~ts
where: {
  tenantId,
  status: { not: 'CANCELLED' },
  id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
  AND: [
    {
      OR: [
        { professionalId },
        { professionalId: null, psychologistId: professionalId },
      ],
    },
    {
      OR: [
        { startTime: { lte: start }, endTime: { gt: start } },
        { startTime: { lt: end }, endTime: { gte: end } },
        { startTime: { gte: start }, endTime: { lte: end } },
      ],
    },
  ],
}
~~~

Throw APPOINTMENT_CONFLICT with both code and temporary error aliases and details.conflicts.

- [ ] **Step 8: Enforce read/update/cancel scopes**

For PROFESIONAL list queries add an OR scope for own canonical/legacy appointments or patients with an active assignment for actor.userId. Compose that scope and the optional professional filter as separate entries in where.AND so neither OR overwrites the other. findOne applies the same authorization after a tenant-scoped load.

For update:

- for PROFESIONAL, reject changes to patientId, professionalId or specialtyId; require ownership plus active membership on the existing patient before changing time or other editable fields;
- revalidate current eligibility when professional, specialty or interval changes;
- preserve historical specialty for title/description-only updates;
- call ensureActive for the resulting patient/professional pair;
- never deactivate the prior pair.

For cancel, ADMIN/ASISTENTE may cancel any tenant appointment; PROFESIONAL may cancel only its own.

Remove clinicalNotes from appointment findOne includes so scheduling endpoints never expose note bodies.

- [ ] **Step 9: Normalize every appointment response**

~~~ts
private normalizeAppointment<T extends AppointmentWithRelations>(row: T) {
  const professional = row.professional ?? row.psychologist;
  const professionalId = row.professionalId ?? row.psychologistId;
  return {
    ...row,
    professionalId,
    professional,
    psychologistId: professionalId,
    psychologist: professional,
  };
}
~~~

Use the mapper for create, list, get, update and cancel. Keep reminder-worker internals compatible through psychologist.

- [ ] **Step 10: Run appointment tests, full unit regression, and commit**

Run:

~~~bash
npm test -- --runInBand src/appointments/appointments.service.spec.ts test/appointments-conflict.spec.ts src/patient-team
npm test -- --runInBand
npm run build
~~~

Expected: focused suites, all API unit suites and build pass.

~~~bash
git add src/appointments
git commit -m "feat(api): make appointments specialty aware"
~~~

---

### Task 7: Prove API permissions, compatibility, migration catch-up, and tenant isolation E2E

**Files:**
- Create: test/patient-team-appointments.e2e-spec.ts
- Modify: .github/workflows/ci.yml
- Modify only if the new suite exposes a defect: src/patient-team/*, src/appointments/*, src/patients/*, src/users/*

**Interfaces:**
- Consumes the public HTTP contracts from Tasks 3, 4 and 6.
- Calls reconcilePatientTeamAppointments from Task 1 against a disposable database.
- Produces end-to-end evidence for canonical and legacy paths.

- [ ] **Step 1: Build the E2E fixture**

Follow the existing specialty-onboarding-team.e2e-spec.ts setup:

~~~ts
beforeAll(async () => {
  assertSpecialtyStageDatabaseSafety(process.env.DATABASE_URL_TEST);
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  prisma = app.get(PrismaService);
  await prisma.cleanDatabase();
});
~~~

Create one tenant with PSYCHOLOGY and NUTRITION, an ADMIN, an ASISTENTE, one professional per specialty, and a second tenant. Login each actor and retain tokens. Use unique emails from randomUUID.

- [ ] **Step 2: Add the team-permission E2E case**

The case must:

1. create one patient;
2. assign Psychology as ADMIN;
3. repeat PUT and assert only one database row;
4. login as the assigned Psychology professional;
5. refer Nutrition successfully;
6. assert the professional receives 403 TEAM_ASSIGNMENT_FORBIDDEN on DELETE;
7. assert an unassigned professional cannot list/refer for the patient;
8. assert an ASISTENTE can list and remove when no future appointment exists;
9. assert a different tenant in the route returns 403 TENANT_SCOPE_VIOLATION;
10. assert another-tenant patient/professional IDs under the actor's own route return 404 without leaking ownership and create no rows.

Use concrete response checks:

~~~ts
expect(team.body).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      professionalId: psychologyId,
      isActive: true,
      professional: {
        id: psychologyId,
        specialty: expect.objectContaining({ code: 'PSYCHOLOGY' }),
      },
    }),
    expect.objectContaining({
      professionalId: nutritionId,
      isActive: true,
      professional: {
        id: nutritionId,
        specialty: expect.objectContaining({ code: 'NUTRITION' }),
      },
    }),
  ]),
);
expect(await prisma.patient.count({ where: { tenantId } })).toBe(1);
~~~

- [ ] **Step 3: Add canonical appointment and removal-block E2E**

As ASISTENTE, create a Nutrition appointment using professionalId + specialtyId. Assert canonical/legacy aliases match and the team row is active. Then:

- create an overlapping appointment and expect 409 APPOINTMENT_CONFLICT;
- send the Psychology specialty with Nutrition professional and expect 422 PROFESSIONAL_SPECIALTY_MISMATCH;
- try DELETE team member and expect 409 with details.appointments;
- reassign the appointment to Psychology and assert Nutrition remains an active team row;
- remove Nutrition after reassignment;
- cancel the Psychology appointment and then remove Psychology.

- [ ] **Step 4: Add professional appointment-scope E2E**

Verify:

- assigned professional creates an own appointment;
- unassigned professional cannot create one to self;
- professional cannot create/reassign to a colleague;
- professional can update/cancel its own appointment;
- professional cannot update/cancel a colleague appointment;
- ADMIN and ASISTENTE can perform those operations.

- [ ] **Step 5: Add legacy contract E2E**

Create through psychologistId without specialtyId and assert:

~~~ts
expect(response.body).toMatchObject({
  professionalId,
  psychologistId: professionalId,
  specialtyId: profileSpecialtyId,
  professional: { id: professionalId },
  psychologist: { id: professionalId },
});
~~~

Update Patient.assignedPsychologistId twice with different professionals and assert two active PatientProfessional rows remain. Set the pointer to null and assert both rows stay active.

- [ ] **Step 6: Add concurrency E2E**

Issue two simultaneous PUT assignments for the same patient/professional and assert both responses are successful while the unique pair count remains one:

~~~ts
const assignmentResponses = await Promise.all([
  request(server).put(teamUrl).set('Authorization', bearer),
  request(server).put(teamUrl).set('Authorization', bearer),
]);
expect(assignmentResponses.map((response) => response.status).sort()).toEqual([200, 200]);
expect(
  await prisma.patientProfessional.count({
    where: { patientId, professionalId },
  }),
).toBe(1);
~~~

Issue two simultaneous appointment POST requests for the same professional and interval. Assert the statuses sort to [201, 409] and the rejected response code is APPOINTMENT_CONFLICT.

Race one future appointment creation against DELETE of the same team member. Accept DELETE status 200 or 409 according to serialization order, but require appointment creation status 201 and final PatientProfessional.isActive true. This proves that a successful appointment can never leave an inactive treating assignment.

- [ ] **Step 7: Add catch-up reconciliation E2E**

Insert a legacy patient pointer, an appointment with professionalId/specialtyId null and a second appointment whose professionalId differs from psychologistId directly through Prisma. Invoke reconcilePatientTeamAppointments(prisma), then assert:

~~~ts
expect(summary.unresolvedAppointments).toBe(0);
expect(
  await prisma.patientProfessional.findUnique({
    where: {
      patientId_professionalId: { patientId, professionalId },
    },
  }),
).toMatchObject({ tenantId, isActive: true, assignedById: null });
expect(
  await prisma.appointment.findUnique({ where: { id: appointmentId } }),
).toMatchObject({
  professionalId,
  specialtyId: profileSpecialtyId,
  psychologistId: professionalId,
});
~~~

Assert the second appointment now has professionalId equal to psychologistId while its non-null historical specialtyId is unchanged.

Create a temporary cross-tenant legacy pointer, expect PATIENT_TEAM_CROSS_TENANT before writes, then delete that fixture in finally.

- [ ] **Step 8: Verify migration paths and run the new E2E suite against the exact disposable database**

Use DATABASE_URL_TEST resolving exactly to psic_clinic_specialty_stage_test:

~~~powershell
npm run prisma:verify-patient-team-migration
npx ts-node -e "import { assertSpecialtyStageDatabaseSafety } from './test/helpers/assert-e2e-database'; assertSpecialtyStageDatabaseSafety(process.env.DATABASE_URL_TEST);"
$env:DATABASE_URL = $env:DATABASE_URL_TEST
npx prisma migrate deploy
npm run test:e2e -- --runInBand test/patient-team-appointments.e2e-spec.ts
~~~

Expected: fresh/upgrade/guard migration scenarios and the new E2E suite pass; the safety precheck accepts only the exact disposable database.

Add a CI step named “Verify patient-team migration upgrade” immediately after Prisma client generation and before the normal public-schema migration:

~~~yaml
- name: Verify patient-team migration upgrade
  run: npm run prisma:verify-patient-team-migration
~~~

- [ ] **Step 9: Run all API tests and commit**

Run:

~~~bash
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run lint
npm run build
~~~

Expected: all unit/E2E suites, lint and build pass.

~~~bash
git add test/patient-team-appointments.e2e-spec.ts .github/workflows/ci.yml src/patient-team src/appointments src/patients src/users
git commit -m "test(api): cover patient team appointment flows"
~~~

If no production fix was needed, the commit contains only the E2E file.

---

### Task 8: Add tenant-scoped web contracts, adapters, and hooks

**Files:**
- Modify: web/src/types/index.ts:398-570
- Modify: web/src/lib/constants.ts:70-105, 147-175
- Modify: web/src/lib/validations/schemas.ts:155-205
- Modify: web/src/lib/api/endpoints.ts:1-45, 560-605
- Create: web/src/lib/api/patient-team-api.test.ts
- Create: web/src/hooks/useTenantScope.ts
- Create: web/src/hooks/usePatientTeam.ts
- Create: web/src/hooks/usePatientTeam.test.tsx
- Modify: web/src/hooks/usePatients.ts
- Modify: web/src/hooks/useAppointments.ts
- Create: web/src/hooks/patient-appointment-hooks.test.tsx
- Create: web/src/lib/validations/patient-appointment.test.ts

**Interfaces:**
- Produces PatientTeamMember, EligiblePatientProfessional, PatientInput, AppointmentCreateInput, AppointmentUpdateInput and AppointmentFilters.
- Produces patientTeamApi.list/listEligible/assign/remove with explicit tenantId.
- Produces usePatientTeam, useEligiblePatientProfessionals, useAssignPatientProfessional and useRemovePatientProfessional.
- Existing appointment consumers receive normalized professional fields even from legacy responses.

- [ ] **Step 1: Write failing transport-boundary tests**

~~~ts
it('uses patient-scoped treating-team paths and an encoded professional segment', async () => {
  await patientTeamApi.list('tenant-1', 'patient-1');
  await patientTeamApi.listEligible('tenant-1', 'patient-1', 'nutrition');
  await patientTeamApi.assign('tenant-1', 'patient-1', 'professional/1');
  await patientTeamApi.remove('tenant-1', 'patient-1', 'professional/1');

  expect(http.get).toHaveBeenCalledWith(
    '/tenants/tenant-1/patients/patient-1/team',
  );
  expect(http.get).toHaveBeenCalledWith(
    '/tenants/tenant-1/patients/patient-1/team/eligible',
    { params: { specialtyId: 'nutrition' } },
  );
  expect(http.put).toHaveBeenCalledWith(
    '/tenants/tenant-1/patients/patient-1/team/professional%2F1',
  );
  expect(http.delete).toHaveBeenCalledWith(
    '/tenants/tenant-1/patients/patient-1/team/professional%2F1',
  );
});

it('normalizes a legacy appointment response to canonical professional fields', async () => {
  http.get.mockResolvedValue({
    id: 'appointment-1',
    psychologistId: 'professional-1',
    psychologist: { id: 'professional-1', firstName: 'Ana', lastName: 'Paz' },
    specialtyId: 'psychology',
  });
  await expect(
    appointmentsApi.get('appointment-1', 'tenant-1'),
  ).resolves.toMatchObject({
    professionalId: 'professional-1',
    professional: { id: 'professional-1' },
    psychologistId: 'professional-1',
  });
});
~~~

- [ ] **Step 2: Write failing hook isolation/invalidation tests**

Use a real QueryClient. Assert tenant A and tenant B use different keys. After assign/remove/create/reassign/cancel, assert only the affected tenant/patient team and appointment keys are invalidated.

Key expectations:

~~~ts
expect(client.getQueryData(['patient-team', 'tenant-1', 'patient-1'])).toEqual(teamA);
expect(client.getQueryData(['patient-team', 'tenant-2', 'patient-1'])).toEqual(teamB);
expect(client.getQueryState(['patient-team', 'tenant-2', 'patient-1'])?.isInvalidated)
  .toBe(false);
~~~

- [ ] **Step 3: Write failing validation tests**

~~~ts
it('keeps demographics independent from treating-team assignment', () => {
  const result = patientSchema.parse({
    firstName: 'Ana',
    lastName: 'Paz',
    assignedPsychologistId: 'legacy-user',
  });
  expect(result).not.toHaveProperty('assignedPsychologistId');
});

it('requires patient, specialty and professional for a canonical appointment', () => {
  expect(
    appointmentSchema.safeParse({
      patientId: 'patient-1',
      specialtyId: '',
      professionalId: '',
      title: 'Consulta',
      startTime: '2026-10-01T10:00',
      duration: 60,
      isOnline: false,
    }).success,
  ).toBe(false);
});
~~~

- [ ] **Step 4: Run new web tests and confirm red**

Run:

~~~bash
npm test -- src/lib/api/patient-team-api.test.ts src/hooks/usePatientTeam.test.tsx src/hooks/patient-appointment-hooks.test.tsx src/lib/validations/patient-appointment.test.ts
~~~

Expected: FAIL because canonical types, clients, keys and hooks do not exist.

- [ ] **Step 5: Define canonical web types**

~~~ts
export interface PatientTeamMember {
  id: string;
  patientId: string;
  professionalId: string;
  assignedAt: string;
  assignedBy: Pick<User, 'id' | 'firstName' | 'lastName'> | null;
  isActive: boolean;
  professional: Pick<
    User,
    'id' | 'firstName' | 'lastName' | 'professionalTitle' | 'licenseNumber'
  > & { specialty: Specialty | null };
}

export type EligiblePatientProfessional = Omit<
  PatientTeamMember['professional'],
  'specialty'
> & {
  specialty: Specialty;
  isAssigned: boolean;
};

export type PatientInput = Pick<
  Patient,
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'dateOfBirth'
  | 'gender'
  | 'address'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'notes'
>;

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  patient: Patient;
  professionalId: string;
  professional: User;
  specialtyId: string;
  specialty: Specialty;
  psychologistId: string;
  psychologist: User;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  duration: number;
  status: AppointmentStatus;
  location?: string;
  isOnline: boolean;
  meetingUrl?: string;
  notes?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentCreateInput {
  patientId: string;
  professionalId: string;
  specialtyId: string;
  title: string;
  description?: string;
  startTime: string;
  duration: number;
  isOnline: boolean;
  meetingUrl?: string;
  location?: string;
}

export type AppointmentUpdateInput =
  Partial<AppointmentCreateInput> & { status?: AppointmentStatus };

export interface AppointmentFilters {
  professionalId?: string;
  specialtyId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  from?: string;
  to?: string;
}
~~~

Keep Patient.assignedPsychologistId/assignedPsychologist optional only as response compatibility aliases.

- [ ] **Step 6: Add endpoints and response normalization**

Add API_ENDPOINTS.PATIENT_TEAM and PATIENT_TEAM_ELIGIBLE. Add a normalizeAppointment function at the HTTP boundary and map list/get/create/update/cancel responses through it.

All patientsApi and appointmentsApi methods accept an optional explicit tenantId as their final argument. Hooks always pass the captured tenant; direct legacy callers may continue using the auth-store fallback.

- [ ] **Step 7: Add tenant-scoped query keys and hooks**

~~~ts
PATIENTS_SCOPED: (tenantId: string, filters?: unknown) =>
  ['patients', 'tenant', tenantId, filters] as const,
PATIENT_DETAIL_SCOPED: (tenantId: string, patientId: string) =>
  ['patients', 'tenant', tenantId, patientId] as const,
PATIENT_TEAM: (tenantId: string, patientId: string) =>
  ['patient-team', tenantId, patientId] as const,
PATIENT_TEAM_ELIGIBLE: (
  tenantId: string,
  patientId: string,
  specialtyId?: string,
) => ['patient-team', tenantId, patientId, 'eligible', specialtyId] as const,
APPOINTMENTS_SCOPED: (tenantId: string, filters?: unknown) =>
  ['appointments', 'tenant', tenantId, filters] as const,
~~~

useTenantScope exports useTenantId() and requireTenantId(). Team hooks disable reads until tenantId and patientId exist. Appointment/patient hooks migrate to scoped keys.

Mutation invalidation:

- assign/remove invalidates team + eligible + scoped appointments for that tenant;
- create invalidates scoped appointments + team for variables.patientId;
- update invalidates appointment detail + scoped appointments + old/new patient team when supplied;
- cancel accepts { id, patientId, reason }, invalidates detail + scoped appointments + that patient's team;
- never invalidate another tenant’s scoped key.

- [ ] **Step 8: Update schemas and make focused tests green**

Remove assignedPsychologistId from patientSchema. Replace psychologistId with professionalId and specialtyId in appointmentSchema and use neutral messages.

Run:

~~~bash
npm test -- src/lib/api/patient-team-api.test.ts src/hooks/usePatientTeam.test.tsx src/hooks/patient-appointment-hooks.test.tsx src/lib/validations/patient-appointment.test.ts
npm run type-check
~~~

Expected: focused tests and type-check pass.

- [ ] **Step 9: Commit the web contracts**

~~~bash
git add src/types/index.ts src/lib/constants.ts src/lib/validations/schemas.ts src/lib/api/endpoints.ts src/lib/api/patient-team-api.test.ts src/hooks
git commit -m "feat(web): add patient team appointment contracts"
~~~

---

### Task 9: Remove the single-assignee patient UI and add the treating-team tab

**Files:**
- Create: web/src/features/patients/patient-team-tab.tsx
- Create: web/src/features/patients/patient-team-tab.test.tsx
- Create: web/src/app/(dashboard)/patients/patient-forms.test.tsx
- Modify: web/src/app/(dashboard)/patients/new/page.tsx
- Modify: web/src/app/(dashboard)/patients/[id]/edit/page.tsx
- Modify: web/src/app/(dashboard)/patients/[id]/page.tsx:1-360
- Modify: web/src/types/guards.ts

**Interfaces:**
- Produces PatientTeamTab({ patientId }: { patientId: string }).
- Consumes Task 8 team hooks and tenant specialties.
- Patient detail adds tab id team and removes the single assigned-psychologist card.

- [ ] **Step 1: Write failing patient-form regression tests**

Mock Next navigation and patient hooks, render NewPatientPage and EditPatientPage, then assert:

~~~ts
expect(screen.queryByLabelText(/Psicólogo.*Asignado/i)).not.toBeInTheDocument();
expect(screen.queryByText('Asignación')).not.toBeInTheDocument();
expect(usersApi.list).not.toHaveBeenCalled();
~~~

For edit, provide a legacy assignedPsychologistId in the patient fixture and assert submit does not send that field when only demographics change.

- [ ] **Step 2: Write failing team-tab interaction tests**

Cover these exact behaviors:

~~~ts
it('groups active and inactive members by specialty', async () => {
  renderTeamTab({
    actor: admin,
    team: [activePsychology, inactiveNutrition, inactiveWithoutProfile],
  });
  expect(await screen.findByRole('heading', { name: 'Psicología' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Nutrición' })).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Sin especialidad vigente' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Activo')).toBeInTheDocument();
  expect(screen.getByText('Inactivo')).toBeInTheDocument();
});

it('lets a professional refer but never renders remove actions', async () => {
  renderTeamTab({ actor: assignedProfessional, team: [activePsychology] });
  await user.selectOptions(screen.getByLabelText('Especialidad'), 'nutrition');
  await user.selectOptions(screen.getByLabelText('Profesional'), 'nutrition-1');
  await user.click(screen.getByRole('button', { name: 'Agregar al equipo' }));
  expect(assign).toHaveBeenCalledWith('nutrition-1');
  expect(screen.queryByRole('button', { name: /Retirar/ })).not.toBeInTheDocument();
});

it('keeps the row and lists future appointments after a blocked removal', async () => {
  remove.mockRejectedValue({
    code: 'PROFESSIONAL_HAS_FUTURE_APPOINTMENTS',
    message: 'Cancela o reasigna las citas futuras.',
    details: {
      appointments: [
        {
          id: 'appointment-1',
          startTime: '2026-10-01T15:00:00Z',
          title: 'Consulta',
          status: 'SCHEDULED',
        },
      ],
    },
  });
  renderTeamTab({ actor: assistant, team: [activeNutrition] });
  await removeMember('nutrition-1');
  expect(await screen.findByText('Consulta')).toBeInTheDocument();
  expect(screen.getByText('Nutricionista Uno')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Abrir cita' }))
    .toHaveAttribute('href', '/calendar?appointmentId=appointment-1');
});
~~~

Also assert clinical administrators appear in candidates, the specialty filter drives the eligible hook, buttons are disabled while pending, and read errors expose a retry action.

- [ ] **Step 3: Run the component tests and confirm red**

Run:

~~~bash
npm test -- src/features/patients/patient-team-tab.test.tsx "src/app/(dashboard)/patients/patient-forms.test.tsx"
~~~

Expected: FAIL because PatientTeamTab does not exist and forms still query psychologists.

- [ ] **Step 4: Remove the legacy selector from new/edit forms**

Delete usersApi/useQuery/UserRole imports and the psychologist queries. Remove assignedPsychologistId from form reset and JSX. Submit only PatientFormData from the new schema.

Do not alter the other demographics or extract a broad shared patient form in this task.

- [ ] **Step 5: Implement the team tab**

PatientTeamTab:

- loads usePatientTeam(patientId) and useTenantSpecialties();
- groups rows by professional.specialty?.id and places null historical specialties under “Sin especialidad vigente”;
- renders active rows before inactive rows with assignedAt and assignedBy;
- filters useEligiblePatientProfessionals(patientId, specialtyId);
- keeps administrators with profiles because it displays returned candidates without role filtering;
- enables add for ADMIN, ASISTENTE and PROFESIONAL;
- enables remove only for canonical ADMIN and ASISTENTE; legacy CLIENTE reaches ADMIN through toCanonicalRole;
- uses AlertDialog for confirmation;
- waits for server success before cache-driven removal;
- parses ApiError.details.appointments into safe rows and links.

Use aria-label values “Agregar al equipo”, “Retirar Nombre Apellido” and “Reintentar equipo tratante”.

- [ ] **Step 6: Wire the tab into the patient detail page**

Change:

~~~ts
type TabId =
  | 'overview'
  | 'team'
  | 'clinical'
  | 'specialties'
  | 'appointments'
  | 'tasks'
  | 'session-plan';
~~~

Add { id: 'team', label: 'Equipo tratante', icon: Users } after General and render PatientTeamTab. Remove only the “Psicólogo Asignado” card from OverviewTab. Leave clinical sections untouched.

- [ ] **Step 7: Add explicit UI permission helpers**

~~~ts
export function canAddPatientTeamMember(user: User): boolean {
  const role = toCanonicalRole(user.role);
  return [UserRole.ADMIN, UserRole.ASISTENTE, UserRole.PROFESIONAL].includes(role);
}

export function canRemovePatientTeamMember(user: User): boolean {
  const role = toCanonicalRole(user.role);
  return role === UserRole.ADMIN || role === UserRole.ASISTENTE;
}
~~~

These helpers affect presentation only; server authorization remains authoritative.

- [ ] **Step 8: Run focused tests, type-check, and commit**

Run:

~~~bash
npm test -- src/features/patients/patient-team-tab.test.tsx "src/app/(dashboard)/patients/patient-forms.test.tsx"
npm run type-check
~~~

Expected: focused tests and type-check pass.

~~~bash
git add src/features/patients "src/app/(dashboard)/patients" src/types/guards.ts
git commit -m "feat(web): manage patient treating teams"
~~~

---

### Task 10: Schedule, edit, reassign, and cancel by specialty/professional

**Files:**
- Create: web/src/features/calendar/appointment-dialog.test.tsx
- Create: web/src/features/calendar/appointment-details-dialog.tsx
- Create: web/src/features/calendar/appointment-details-dialog.test.tsx
- Create: web/src/features/calendar/appointment-errors.ts
- Modify: web/src/features/calendar/appointment-dialog.tsx
- Modify: web/src/features/calendar/calendar-view.tsx
- Modify: web/src/app/(dashboard)/calendar/page.tsx
- Modify: web/src/app/(dashboard)/patients/[id]/page.tsx:670-735, 1235-1260
- Modify: web/src/types/guards.ts
- Modify: web/src/hooks/useAppointments.ts

**Interfaces:**
- AppointmentDialog accepts appointment?: Appointment | null and initialDate?: Date | null.
- AppointmentDetailsDialog emits onEdit and invokes canonical cancel.
- CalendarView accepts canEdit?: (appointment: Appointment) => boolean.
- getAppointmentErrorMessage(error) maps stable API codes to Spanish UI copy.

- [ ] **Step 1: Write failing create/edit cascade tests**

~~~ts
it('loads professionals only after patient and specialty are selected', async () => {
  renderDialog();
  expect(eligibleHook).toHaveBeenLastCalledWith('', '');
  await user.selectOptions(screen.getByLabelText('Paciente'), 'patient-1');
  await user.selectOptions(screen.getByLabelText('Especialidad'), 'nutrition');
  expect(eligibleHook).toHaveBeenLastCalledWith('patient-1', 'nutrition');
  expect(await screen.findByRole('option', { name: 'Noa Nutrición' }))
    .toBeInTheDocument();
});

it('clears a professional when specialty changes', async () => {
  renderDialog();
  await choosePatientSpecialtyProfessional('patient-1', 'nutrition', 'nutrition-1');
  await user.selectOptions(screen.getByLabelText('Especialidad'), 'psychology');
  expect(screen.getByLabelText('Profesional')).toHaveValue('');
});

it('submits professionalId and specialtyId without psychologistId', async () => {
  renderDialog();
  await completeAppointment({
    patientId: 'patient-1',
    specialtyId: 'nutrition',
    professionalId: 'nutrition-1',
  });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      patientId: 'patient-1',
      specialtyId: 'nutrition',
      professionalId: 'nutrition-1',
    }),
    expect.any(Object),
  );
  expect(create.mock.calls[0][0]).not.toHaveProperty('psychologistId');
});
~~~

Add an edit fixture and assert changing professional submits an update with the matching specialty.

Add a historical edit fixture whose current professional is absent from eligible results. Assert the dialog keeps that professional and specialty as disabled current options, does not clear them during initial hydration, and a title-only save does not replace either identifier.

- [ ] **Step 2: Write failing permission, cancel, and error-code tests**

Test:

- ADMIN/ASISTENTE may edit/cancel any appointment;
- PROFESIONAL sees controls only when appointment.professionalId equals user.id;
- calendar drag/resize is disabled for appointments the actor cannot edit;
- cancelling invalidates appointment queries;
- APPOINTMENT_CONFLICT, PROFESSIONAL_SPECIALTY_MISMATCH and SPECIALTY_NOT_ENABLED render deterministic Spanish messages;
- opening /calendar?appointmentId=appointment-1 selects that appointment after its list loads.

Error map:

~~~ts
const messages: Record<string, string> = {
  APPOINTMENT_CONFLICT: 'El profesional ya tiene una cita en ese horario.',
  PROFESSIONAL_SPECIALTY_MISMATCH:
    'El profesional no pertenece a la especialidad seleccionada.',
  SPECIALTY_NOT_ENABLED:
    'La especialidad ya no está habilitada en el consultorio.',
  PROFESSIONAL_NOT_AUTHORIZED:
    'El profesional ya no está disponible para atención.',
};
~~~

- [ ] **Step 3: Run calendar component tests and confirm red**

Run:

~~~bash
npm test -- src/features/calendar/appointment-dialog.test.tsx src/features/calendar/appointment-details-dialog.test.tsx
~~~

Expected: FAIL because the dialog still uses psychologist role filtering and no details component exists.

- [ ] **Step 4: Convert AppointmentDialog to the canonical cascade**

Use usePatients, useTenantSpecialties and useEligiblePatientProfessionals. Watch patientId and specialtyId; reset professionalId only after a user-initiated parent change invalidates it, not during edit-form hydration. For an existing appointment whose professional or specialty is no longer eligible, append disabled “actual/histórico” options so unchanged metadata remains editable. For a PROFESIONAL actor, display only the candidate whose id equals actor.id. ADMIN/ASISTENTE see all returned candidates.

The form order is patient, specialty, professional, date/time and details. Use “Consulta” as the title default/placeholder and “Cita en línea” for modality; remove psychology-only labels from this scheduling component. Add visible copy:

> Si aún no integra el equipo tratante, el profesional será agregado automáticamente al crear o reasignar la cita.

On create call useCreateAppointment. On edit call useUpdateAppointment(appointment.id). Keep the dialog open and values intact on server error.

- [ ] **Step 5: Extract appointment details with edit/cancel actions**

AppointmentDetailsDialog displays patient, canonical professional, specialty, dates, status and modality. It never reads psychologist directly.

Use canEditAppointment(user, appointment):

~~~ts
export function canEditAppointment(
  user: User,
  appointment: Pick<Appointment, 'professionalId'>,
): boolean {
  const role = toCanonicalRole(user.role);
  if (role === UserRole.ADMIN || role === UserRole.ASISTENTE) return true;
  return role === UserRole.PROFESIONAL && appointment.professionalId === user.id;
}
~~~

Cancel requires a non-empty reason, calls useCancelAppointment with appointment.id, appointment.patientId and the reason, and closes only after success.

- [ ] **Step 6: Make calendar interactions permission-aware**

CalendarView adds editable to each generated event from canEdit(appointment), rather than setting one global editable=true. CalendarPage passes the actor-aware helper, uses useAppointments instead of a direct global-key query, and uses useUpdateAppointment for drag/resize.

Read appointmentId from useSearchParams. Once scoped appointments load, select the matching row and clear no state for an unknown ID.

- [ ] **Step 7: Update patient appointment cards to canonical terminology**

Render appointment.professional and appointment.specialty. Remove “Dr.” as a universal prefix; use professional.professionalTitle when present, otherwise the full name. Keep clinical-note terminology unchanged.

- [ ] **Step 8: Run focused and full web tests**

Run:

~~~bash
npm test -- src/features/calendar src/features/patients/patient-team-tab.test.tsx
npm test
npm run type-check
~~~

Expected: calendar-focused tests, all web tests and type-check pass.

- [ ] **Step 9: Commit the agenda UI**

~~~bash
git add src/features/calendar "src/app/(dashboard)/calendar" "src/app/(dashboard)/patients/[id]/page.tsx" src/types/guards.ts src/hooks/useAppointments.ts
git commit -m "feat(web): schedule by specialty and professional"
~~~

---

### Task 11: Verify both repositories and prepare independent review

**Files:**
- Modify only when a verification failure demonstrates a defect in this stage.

**Interfaces:**
- Consumes every prior task.
- Produces clean API and web heads ready for review and separate pull requests.

- [ ] **Step 1: Verify the API schema and migration from a fresh disposable database**

Run against the exact allowlisted disposable PostgreSQL database. The verifier creates and removes isolated schemas, so it proves both an empty install and a real legacy upgrade without resetting the shared public test schema:

~~~powershell
npm run prisma:verify-patient-team-migration
npx prisma validate
npx prisma generate
npx ts-node -e "import { assertSpecialtyStageDatabaseSafety } from './test/helpers/assert-e2e-database'; assertSpecialtyStageDatabaseSafety(process.env.DATABASE_URL_TEST);"
$env:DATABASE_URL = $env:DATABASE_URL_TEST
npx prisma migrate deploy
npm run prisma:reconcile-patient-team
~~~

Expected: isolated fresh/upgrade/guard verification, validation, generation and public-schema deploy succeed; reconciliation reports zero unresolved appointments.

- [ ] **Step 2: Run the complete API quality matrix**

~~~bash
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
git diff --check 647037981ff86be378ca5acb14d542955c191a72...HEAD
~~~

Expected: zero lint errors, every unit/E2E suite passes, build passes and diff check is empty.

- [ ] **Step 3: Run the complete web quality matrix**

~~~bash
npm run lint
npm run type-check
npm test
npm run build
git diff --check f02b3bd1c8a28b8b31054936a65c9ecdd6fb5cb4...HEAD
~~~

Expected: zero lint/type errors, all Vitest files pass, production build passes and diff check is empty.

- [ ] **Step 4: Audit compatibility and scope boundaries**

Run targeted searches:

~~~bash
rg "assignedPsychologistId|psychologistId|psychologist" src prisma test
rg "assignedPsychologistId|psychologistId|Psicólogo|Psicóloga" web/src/features/calendar web/src/features/patients "web/src/app/(dashboard)/patients"
rg "clinicalNotes" src/appointments
~~~

Expected:

- API legacy names remain only in explicit adapters, legacy relations/tests, reminder compatibility and untouched clinical modules;
- patient forms, treating-team UI and calendar creation/edit flows contain no legacy assignment payloads or psychology-only labels;
- appointments endpoints do not return clinicalNotes;
- no Stage 5 audit/version/timeline implementation entered the diff.

- [ ] **Step 5: Inspect migration reconciliation invariants**

Record database counts for:

- legacy non-null patient pointers versus corresponding PatientProfessional rows;
- Appointment rows versus non-null professionalId/specialtyId rows;
- professionalId = psychologistId for all compatibility-window appointments;
- zero PatientProfessional/Appointment cross-tenant joins;
- zero duplicate patientId + professionalId pairs.

Expected: all counts reconcile exactly and every violation query returns zero rows.

- [ ] **Step 6: Request independent code review for each repository**

Use the requesting-code-review skill. Review API from 647037981ff86be378ca5acb14d542955c191a72 to API HEAD and web from f02b3bd1c8a28b8b31054936a65c9ecdd6fb5cb4 to web HEAD. Require Critical/Important findings with file/line evidence. Fix accepted findings through a failing regression test, then rerun the smallest relevant suite and the complete matrix.

- [ ] **Step 7: Record final heads and hand off integration**

Confirm both worktrees are clean, record commit SHAs, test counts, migration/reconciliation result and any explicitly deferred minor issue. Then use the finishing-a-development-branch skill to offer push + pull requests, local merge, branch retention or discard according to the user’s choice.
