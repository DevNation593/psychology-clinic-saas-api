import { assertE2eDatabaseSafety } from './assert-e2e-database';

const connection = 'postgresql://postgres:postgres@localhost:5432/';

describe('E2E database safety', () => {
  it.each([
    'psic_clinic_test',
    'psic_clinic_profiles_fresh_test',
    'psic_clinic_specialty_stage_test',
  ])('accepts only the exact disposable database %s', (name) =>
    expect(() => assertE2eDatabaseSafety(connection + name)).not.toThrow(),
  );

  it.each([
    'psic_clinic_specialty_stage_test_shadow',
    'psic_clinic_specialty_stage_test2',
    'other_psic_clinic_specialty_stage_test',
    'psic_clinic',
    'psic_clinic_dev',
    'psic_clinic_prod',
    'postgres',
    'psic_clinic_test_shadow',
    'psic_clinic_dev/../psic_clinic_specialty_stage_test',
    'psic_clinic%5Fspecialty_stage_test',
  ])('rejects %s', (name) => {
    expect(() => assertE2eDatabaseSafety(connection + name)).toThrow(
      'E2E requires a dedicated allowlisted test database',
    );
  });
});
