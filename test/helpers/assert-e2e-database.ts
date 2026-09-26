import { assertTestDatabaseSafety } from '../../src/prisma/test-database-safety';

const allowedDatabaseNames = new Set([
  'psic_clinic_test',
  'psic_clinic_profiles_fresh_test',
  'psic_clinic_specialty_stage_test',
]);

export function assertE2eDatabaseSafety(databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error('E2E requires a dedicated allowlisted test database');

  // Match the raw URL path so URL normalization cannot hide extra path segments.
  const databaseSegment = databaseUrl.match(
    /^postgres(?:ql)?:\/\/[^/?#]+\/([^/?#]+)(?:\?[^#]*)?(?:#.*)?$/i,
  )?.[1];
  if (!databaseSegment || !allowedDatabaseNames.has(databaseSegment)) {
    throw new Error('E2E requires a dedicated allowlisted test database');
  }
  assertTestDatabaseSafety('test', databaseUrl);
}
