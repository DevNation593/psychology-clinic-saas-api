const TEST_DATABASE_SEGMENT = /(^|[-_])test($|[-_])/i;
const POSTGRESQL_URL_WITH_SINGLE_DATABASE_SEGMENT =
  /^postgres(?:ql)?:\/\/[^/?#]+\/([^/?#]+)(?:\?[^#]*)?(?:#.*)?$/i;

export function assertTestDatabaseSafety(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): void {
  let databaseName = '';
  let isUnambiguousPostgresqlUrl = false;

  if (databaseUrl) {
    try {
      const parsedUrl = new URL(databaseUrl);
      const databaseSegmentMatch = databaseUrl.match(POSTGRESQL_URL_WITH_SINGLE_DATABASE_SEGMENT);

      if (
        ['postgres:', 'postgresql:'].includes(parsedUrl.protocol) &&
        parsedUrl.host &&
        databaseSegmentMatch?.[1]
      ) {
        databaseName = decodeURIComponent(databaseSegmentMatch[1]);
        isUnambiguousPostgresqlUrl = !/[\\/]/.test(databaseName);
      }
    } catch {
      databaseName = '';
    }
  }

  if (
    nodeEnv !== 'test' ||
    !isUnambiguousPostgresqlUrl ||
    !TEST_DATABASE_SEGMENT.test(databaseName)
  ) {
    throw new Error('Refusing to clean a non-test database');
  }
}
