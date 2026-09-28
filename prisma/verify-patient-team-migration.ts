import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertSpecialtyStageDatabaseSafety } from '../test/helpers/assert-e2e-database';
import { reconcilePatientTeamAppointments } from './reconcile-patient-team-appointments';

const targetMigration = '20260928000000_patient_team_appointments';
const schemaPattern = /^patient_team_(fresh|upgrade|cross_tenant|missing_profile)_[a-f0-9]+$/;

export type PatientTeamMigrationVerificationSummary = {
  freshSchema: true;
  upgradedAssignments: number;
  upgradedAppointments: number;
  historicalSpecialtiesPreserved: number;
  rejectedCrossTenantFixture: true;
  rejectedMissingProfileFixture: true;
};

type CountRow = { count: bigint };
type AssignmentRow = { patientId: string; professionalId: string; isActive: boolean };
type AppointmentRow = { id: string; professionalId: string | null; specialtyId: string | null };

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
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function copyMigrations(destination: string, includeTarget: boolean): void {
  const source = join(__dirname, 'migrations');
  const target = join(destination, 'migrations');
  mkdirSync(target, { recursive: true });
  copyFileSync(join(source, 'migration_lock.toml'), join(target, 'migration_lock.toml'));
  for (const name of readdirSync(source)
    .filter((item) => /^\d+_/.test(item))
    .sort()) {
    if (name === targetMigration && !includeTarget) continue;
    cpSync(join(source, name), join(target, name), { recursive: true });
  }
}

async function addTenant(client: PrismaClient, id: string): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "Tenant" ("id", "name", "email", "updatedAt")
    VALUES (${id}, ${id}, ${`${id}@example.test`}, CURRENT_TIMESTAMP)
  `;
}

async function addUser(
  client: PrismaClient,
  id: string,
  tenantId: string,
  active = true,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "User" ("id", "tenantId", "email", "password", "firstName", "lastName", "role", "isActive", "updatedAt")
    VALUES (${id}, ${tenantId}, ${`${id}@example.test`}, 'fixture', 'Fixture', 'Professional',
      'PSICOLOGO'::"UserRole", ${active}, CURRENT_TIMESTAMP)
  `;
}

async function addProfile(
  client: PrismaClient,
  userId: string,
  specialtyId = 'legacy_psychology_specialty',
  active = true,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "ProfessionalProfile" ("userId", "specialtyId", "isActive", "updatedAt")
    VALUES (${userId}, ${specialtyId}, ${active}, CURRENT_TIMESTAMP)
  `;
}

async function addPatient(
  client: PrismaClient,
  id: string,
  tenantId: string,
  userId: string,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "Patient" ("id", "tenantId", "firstName", "lastName", "assignedPsychologistId", "updatedAt")
    VALUES (${id}, ${tenantId}, 'Fixture', 'Patient', ${userId}, CURRENT_TIMESTAMP)
  `;
}

async function addAppointment(
  client: PrismaClient,
  id: string,
  tenantId: string,
  patientId: string,
  userId: string,
  specialtyId: string | null,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "Appointment" ("id", "tenantId", "patientId", "psychologistId", "specialtyId",
      "startTime", "endTime", "duration", "updatedAt")
    VALUES (${id}, ${tenantId}, ${patientId}, ${userId}, ${specialtyId},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour', 60, CURRENT_TIMESTAMP)
  `;
}

export async function verifyPatientTeamMigration(
  databaseUrl: string | undefined = process.env.DATABASE_URL_TEST,
): Promise<PatientTeamMigrationVerificationSummary> {
  assertSpecialtyStageDatabaseSafety(databaseUrl);
  const baseUrl = databaseUrl!;
  const temporary = mkdtempSync(join(tmpdir(), 'patient-team-migration-'));
  const schemaDir = join(temporary, 'prisma');
  mkdirSync(schemaDir);
  const schemaPath = join(schemaDir, 'schema.prisma');
  copyFileSync(join(__dirname, 'schema.prisma'), schemaPath);
  const administrator = clientFor(baseUrl);
  const result: PatientTeamMigrationVerificationSummary = {
    freshSchema: true,
    upgradedAssignments: 0,
    upgradedAppointments: 0,
    historicalSpecialtiesPreserved: 0,
    rejectedCrossTenantFixture: true,
    rejectedMissingProfileFixture: true,
  };

  try {
    for (const scenario of ['fresh', 'upgrade', 'cross_tenant', 'missing_profile'] as const) {
      const schema = `patient_team_${scenario}_${randomBytes(8).toString('hex')}`;
      if (!schemaPattern.test(schema)) throw new Error('Invalid generated schema');
      const scopedUrl = urlForSchema(baseUrl, schema);
      const client = clientFor(scopedUrl);
      try {
        await administrator.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        // Migration directories are staged per scenario so upgrade paths really deploy the target last.
        rmSync(join(schemaDir, 'migrations'), { recursive: true, force: true });
        copyMigrations(schemaDir, scenario === 'fresh');
        const initial = deploy(schemaPath, scopedUrl);
        if (
          !initial.includes('All migrations have been successfully applied') &&
          !initial.includes('Your database is now in sync')
        ) {
          throw new Error(`Prior migrations failed in ${scenario}`);
        }

        if (scenario === 'fresh') {
          const tables = await client.$queryRaw<CountRow[]>`
            SELECT COUNT(*)::bigint AS count FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'PatientProfessional'
          `;
          const columns = await client.$queryRaw<CountRow[]>`
            SELECT COUNT(*)::bigint AS count FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'Appointment' AND column_name = 'professionalId'
          `;
          if (tables[0].count !== 1n || columns[0].count !== 1n)
            throw new Error('Fresh schema lacks canonical data model');
          continue;
        }

        await addTenant(client, 'tenant_a');
        if (scenario === 'cross_tenant') await addTenant(client, 'tenant_b');

        if (scenario === 'upgrade') {
          await addUser(client, 'active_user', 'tenant_a');
          await addUser(client, 'inactive_user', 'tenant_a', false);
          await addProfile(client, 'active_user');
          await addProfile(client, 'inactive_user', 'legacy_psychology_specialty', false);
          await addPatient(client, 'active_patient', 'tenant_a', 'active_user');
          await addPatient(client, 'inactive_patient', 'tenant_a', 'inactive_user');
          await client.$executeRaw`
            INSERT INTO "Specialty" ("id", "code", "name", "updatedAt")
            VALUES ('historical_specialty', 'HISTORICAL', 'Historical', CURRENT_TIMESTAMP)
          `;
          await addAppointment(
            client,
            'null_specialty_appointment',
            'tenant_a',
            'active_patient',
            'active_user',
            null,
          );
          await addAppointment(
            client,
            'historical_appointment',
            'tenant_a',
            'active_patient',
            'active_user',
            'historical_specialty',
          );
        } else {
          const userTenant = scenario === 'cross_tenant' ? 'tenant_b' : 'tenant_a';
          await addUser(client, 'referenced_user', userTenant);
          if (scenario === 'cross_tenant') await addProfile(client, 'referenced_user');
          await addPatient(client, 'referencing_patient', 'tenant_a', 'referenced_user');
          await addAppointment(
            client,
            'referencing_appointment',
            'tenant_a',
            'referencing_patient',
            'referenced_user',
            null,
          );
        }

        copyMigrations(schemaDir, true);
        const upgradeOutput = deploy(schemaPath, scopedUrl);
        if (scenario === 'upgrade') {
          if (!upgradeOutput.includes('All migrations have been successfully applied')) {
            throw new Error('Upgrade migration failed');
          }
          const assignments = await client.$queryRaw<AssignmentRow[]>`
            SELECT "patientId", "professionalId", "isActive" FROM "PatientProfessional" ORDER BY "patientId"
          `;
          const appointments = await client.$queryRaw<AppointmentRow[]>`
            SELECT "id", "professionalId", "specialtyId" FROM "Appointment" ORDER BY "id"
          `;
          if (
            assignments.length !== 2 ||
            assignments.find((row) => row.patientId === 'active_patient')?.isActive !== true ||
            assignments.find((row) => row.patientId === 'inactive_patient')?.isActive !== false ||
            assignments.find((row) => row.patientId === 'active_patient')?.professionalId !==
              'active_user' ||
            appointments.length !== 2 ||
            appointments.some((row) => row.professionalId !== 'active_user') ||
            appointments.find((row) => row.id === 'null_specialty_appointment')?.specialtyId !==
              'legacy_psychology_specialty' ||
            appointments.find((row) => row.id === 'historical_appointment')?.specialtyId !==
              'historical_specialty'
          ) {
            throw new Error('Upgrade backfill did not preserve canonical data');
          }
          result.upgradedAssignments = assignments.length;
          result.upgradedAppointments = appointments.length;
          result.historicalSpecialtiesPreserved = 1;

          // Exercise the exported catch-up behavior against the upgraded schema.
          await client.$executeRaw`DELETE FROM "PatientProfessional" WHERE "patientId" = 'inactive_patient'`;
          await client.$executeRaw`
            UPDATE "Appointment" SET "professionalId" = NULL, "specialtyId" = NULL
            WHERE "id" = 'null_specialty_appointment'
          `;
          const repaired = await reconcilePatientTeamAppointments(client);
          const repeated = await reconcilePatientTeamAppointments(client);
          const repairedAppointment = await client.$queryRaw<AppointmentRow[]>`
            SELECT "id", "professionalId", "specialtyId" FROM "Appointment"
            WHERE "id" = 'null_specialty_appointment'
          `;
          if (
            repaired.assignmentsBefore !== 1 ||
            repaired.assignmentsAfter !== 2 ||
            repaired.appointmentsRepaired !== 1 ||
            repaired.unresolvedAppointments !== 0 ||
            repeated.assignmentsBefore !== 2 ||
            repeated.assignmentsAfter !== 2 ||
            repeated.appointmentsRepaired !== 0 ||
            repeated.unresolvedAppointments !== 0 ||
            repairedAppointment[0]?.professionalId !== 'active_user' ||
            repairedAppointment[0]?.specialtyId !== 'legacy_psychology_specialty'
          ) {
            throw new Error('Catch-up reconciliation was not idempotent');
          }
        } else {
          const expected =
            scenario === 'cross_tenant'
              ? /PATIENT_TEAM_CROSS_TENANT|APPOINTMENT_CROSS_TENANT/
              : /PROFESSIONAL_PROFILE_REQUIRED/;
          if (!expected.test(upgradeOutput))
            throw new Error(`Guard did not reject ${scenario} fixture`);
          const tables = await client.$queryRaw<CountRow[]>`
            SELECT COUNT(*)::bigint AS count FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'PatientProfessional'
          `;
          const appointments = await client.$queryRaw<CountRow[]>`
            SELECT COUNT(*)::bigint AS count FROM "Appointment"
          `;
          if (tables[0].count !== 0n || appointments[0].count !== 1n) {
            throw new Error(`Guard did not roll back ${scenario} migration`);
          }
        }
      } finally {
        await client.$disconnect();
        if (!schemaPattern.test(schema)) throw new Error('Invalid generated schema on cleanup');
        await administrator.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    }
    return result;
  } finally {
    await administrator.$disconnect();
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  verifyPatientTeamMigration()
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
