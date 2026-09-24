import { assertTestDatabaseSafety } from './test-database-safety';

describe('assertTestDatabaseSafety', () => {
  it('accepts an explicit test database while NODE_ENV is test', () => {
    expect(() =>
      assertTestDatabaseSafety(
        'test',
        'postgresql://postgres:postgres@localhost:5432/psic_clinic_test',
      ),
    ).not.toThrow();
  });

  it.each([
    ['development', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'],
    ['production', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_dev'],
    ['test', undefined],
    ['test', 'not-a-url'],
  ])('rejects unsafe configuration: %s %s', (nodeEnv, databaseUrl) => {
    expect(() => assertTestDatabaseSafety(nodeEnv, databaseUrl)).toThrow(
      'Refusing to clean a non-test database',
    );
  });
});
