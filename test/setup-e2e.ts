import { assertTestDatabaseSafety } from '../src/prisma/test-database-safety';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

// E2E suites clean their database, so accept only these dedicated guarded names.
const allowedTestDatabases = ['/psic_clinic_test', '/psic_clinic_profiles_fresh_test'];
if (!testDatabaseUrl || !allowedTestDatabases.includes(new URL(testDatabaseUrl).pathname)) {
  throw new Error('E2E requires a dedicated allowlisted test database');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;

assertTestDatabaseSafety(process.env.NODE_ENV, process.env.DATABASE_URL);
