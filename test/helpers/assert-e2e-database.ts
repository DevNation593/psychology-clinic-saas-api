import { assertTestDatabaseSafety } from '../../src/prisma/test-database-safety';

const allowedDatabaseNames = new Set([
  'psic_clinic_test',
  'psic_clinic_profiles_fresh_test',
  'psic_clinic_specialty_stage_test',
]);

const SPECIALTY_STAGE_DATABASE = 'psic_clinic_specialty_stage_test';

function rawDatabaseName(databaseUrl: string): string | undefined {
  return databaseUrl.match(/^postgres(?:ql)?:\/\/[^/?#]+\/([^/?#]+)(?:\?[^#]*)?(?:#.*)?$/i)?.[1];
}

export function assertE2eDatabaseSafety(databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error('E2E requires a dedicated allowlisted test database');

  // Match the raw URL path so URL normalization cannot hide extra path segments.
  const databaseSegment = rawDatabaseName(databaseUrl);
  if (!databaseSegment || !allowedDatabaseNames.has(databaseSegment)) {
    throw new Error('E2E requires a dedicated allowlisted test database');
  }
  assertTestDatabaseSafety('test', databaseUrl);
}

export function assertSpecialtyStageDatabaseSafety(databaseUrl: string | undefined): void {
  try {
    assertE2eDatabaseSafety(databaseUrl);
  } catch {
    throw new Error('Specialty stage requires the exact disposable database');
  }
  if (rawDatabaseName(databaseUrl!) !== SPECIALTY_STAGE_DATABASE) {
    throw new Error('Specialty stage requires the exact disposable database');
  }
}
