import { assertTestDatabaseSafety } from '../src/prisma/test-database-safety';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;

assertTestDatabaseSafety(process.env.NODE_ENV, process.env.DATABASE_URL);
