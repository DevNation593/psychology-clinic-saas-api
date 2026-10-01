import { assertTestDatabaseSafety } from './test-database-safety';

describe('assertTestDatabaseSafety', () => {
  it.each(['postgresql', 'postgres'])(
    'accepts an explicit test database using the %s protocol while NODE_ENV is test',
    (protocol) => {
      expect(() =>
        assertTestDatabaseSafety(
          'test',
          `${protocol}://postgres:postgres@localhost:5432/psic_clinic_test`,
        ),
      ).not.toThrow();
    },
  );

  it.each([
    ['development', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'],
    ['production', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_dev'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_dev/_test'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_dev/../psic_clinic_test'],
    [
      'test',
      'postgresql://postgres:postgres@localhost:5432/psic_clinic_dev/%2e%2e/psic_clinic_test',
    ],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test/'],
    ['test', 'postgresql://postgres:postgres@localhost:5432//psic_clinic_test'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic%2Ftest'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic%5Ctest'],
    ['test', 'postgresql:psic_clinic_test'],
    ['test', 'postgresql:/psic_clinic_test'],
    ['test', 'postgresql:///psic_clinic_test'],
    ['test', 'http://localhost/psic_clinic_test'],
    ['test', undefined],
    ['test', 'not-a-url'],
  ])('rejects unsafe configuration: %s %s', (nodeEnv, databaseUrl) => {
    expect(() => assertTestDatabaseSafety(nodeEnv, databaseUrl)).toThrow(
      'Refusing to clean a non-test database',
    );
  });
});
