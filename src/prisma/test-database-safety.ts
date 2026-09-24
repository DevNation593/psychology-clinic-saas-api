const TEST_DATABASE_SEGMENT = /(^|[-_])test($|[-_])/i;

export function assertTestDatabaseSafety(
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = process.env.DATABASE_URL,
): void {
  let databaseName = '';

  if (databaseUrl) {
    try {
      databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    } catch {
      databaseName = '';
    }
  }

  if (nodeEnv !== 'test' || !TEST_DATABASE_SEGMENT.test(databaseName)) {
    throw new Error('Refusing to clean a non-test database');
  }
}
