import { assertE2eDatabaseSafety } from './helpers/assert-e2e-database';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

assertE2eDatabaseSafety(testDatabaseUrl);

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
// The suites issue many requests from one address within seconds; the production
// rate limit (per handler) would reject them with 429 and hide the behaviour under test.
process.env.THROTTLE_LIMIT = '10000';
// A throwaway key so the suites exercise the same encrypted path as production.
process.env.CLINICAL_ENCRYPTION_KEYS = `e2e:${Buffer.alloc(32, 7).toString('base64')}`;
