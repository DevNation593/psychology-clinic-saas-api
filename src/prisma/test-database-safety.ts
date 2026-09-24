const TEST_DATABASE_SEGMENT = /(^|[-_])test($|[-_])/i;

export function assertTestDatabaseSafety(
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = process.env.DATABASE_URL,
): void {
  let databaseName = '';
  let isPostgresqlUrl = false;

  if (databaseUrl) {
    try {
      const parsedUrl = new URL(databaseUrl);
      isPostgresqlUrl = ['postgres:', 'postgresql:'].includes(parsedUrl.protocol);
      databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
    } catch {
      databaseName = '';
    }
  }

  if (nodeEnv !== 'test' || !isPostgresqlUrl || !TEST_DATABASE_SEGMENT.test(databaseName)) {
    throw new Error('Refusing to clean a non-test database');
  }
}
