import { assertE2eDatabaseSafety } from './helpers/assert-e2e-database';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

assertE2eDatabaseSafety(testDatabaseUrl);

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
