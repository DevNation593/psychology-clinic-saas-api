import { assertTestDatabaseSafety } from '../../src/prisma/test-database-safety';

const allowedDatabaseNames = new Set([
  'psic_clinic_test',
  'psic_clinic_profiles_fresh_test',
  'psic_clinic_specialty_stage_test',
]);

const SPECIALTY_STAGE_DATABASE = 'psic_clinic_specialty_stage_test';
const STAGE_CONNECTION_PARAMETERS = new Set([
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'sslmode',
]);

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
  const unsafeStage = () => new Error('Specialty stage requires the exact disposable database');
  try {
    assertE2eDatabaseSafety(databaseUrl);
  } catch {
    throw unsafeStage();
  }
  if (rawDatabaseName(databaseUrl!) !== SPECIALTY_STAGE_DATABASE) {
    throw unsafeStage();
  }

  const parsed = new URL(databaseUrl!);
  // URL.hash is empty for a trailing '#'; reject the marker itself as well.
  if (databaseUrl!.includes('#')) throw unsafeStage();
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1 || (schemas.length === 1 && schemas[0] !== 'public')) {
    throw unsafeStage();
  }
  const seen = new Set<string>();
  for (const [name, value] of parsed.searchParams) {
    if (seen.has(name)) throw unsafeStage();
    seen.add(name);
    if (name !== 'schema' && (!STAGE_CONNECTION_PARAMETERS.has(name) || value === '')) {
      throw unsafeStage();
    }
  }
}
