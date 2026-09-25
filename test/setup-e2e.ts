import { assertTestDatabaseSafety } from '../src/prisma/test-database-safety';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

// E2E suites clean their database, so accept only the dedicated guarded name.
if (!testDatabaseUrl || new URL(testDatabaseUrl).pathname !== '/psic_clinic_test') {
  throw new Error('E2E requires the dedicated psic_clinic_test database');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;

assertTestDatabaseSafety(process.env.NODE_ENV, process.env.DATABASE_URL);
