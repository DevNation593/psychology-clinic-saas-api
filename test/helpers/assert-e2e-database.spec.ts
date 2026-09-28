import { assertE2eDatabaseSafety, assertSpecialtyStageDatabaseSafety } from './assert-e2e-database';

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

describe('exact specialty-stage database safety', () => {
  it('accepts only the exact specialty-stage target', () => {
    expect(() =>
      assertSpecialtyStageDatabaseSafety(connection + 'psic_clinic_specialty_stage_test'),
    ).not.toThrow();
  });

  it.each([
    'psic_clinic_test',
    'psic_clinic_profiles_fresh_test',
    'psic_clinic_specialty_stage_test_shadow',
    'psic_clinic_specialty_stage_test2',
    'other_psic_clinic_specialty_stage_test',
    'psic_clinic',
    'postgres',
  ])('rejects %s in exact stage mode', (name) => {
    expect(() => assertSpecialtyStageDatabaseSafety(connection + name)).toThrow(
      'Specialty stage requires the exact disposable database',
    );
  });

  it.each([
    '',
    '?schema=public',
    '?connection_limit=5',
    '?schema=public&connection_limit=5&sslmode=require',
  ])('accepts only the default/public schema with safe query %s', (suffix) => {
    expect(() =>
      assertSpecialtyStageDatabaseSafety(connection + 'psic_clinic_specialty_stage_test' + suffix),
    ).not.toThrow();
  });

  it.each([
    '?schema=other',
    '?schema=',
    '?schema=PUBLIC',
    '?schema=public&schema=other',
    '?schema=public&schema=public',
    '?Schema=public',
    '?options=-csearch_path%3Dother',
    '#fragment',
    '#',
    '?schema=public#fragment',
  ])('rejects non-public, ambiguous or fragmented suffix %s', (suffix) => {
    expect(() =>
      assertSpecialtyStageDatabaseSafety(connection + 'psic_clinic_specialty_stage_test' + suffix),
    ).toThrow('Specialty stage requires the exact disposable database');
  });
});
