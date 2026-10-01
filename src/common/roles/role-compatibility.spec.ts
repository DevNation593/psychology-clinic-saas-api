import {
  areRolesEquivalent,
  isAdminRole,
  isProfessionalRole,
  toCanonicalRole,
} from './role-compatibility';

describe('role compatibility', () => {
  it.each([
    ['CLIENTE', 'ADMIN'],
    ['ADMIN', 'ADMIN'],
    ['PSICOLOGO', 'PROFESIONAL'],
    ['PROFESIONAL', 'PROFESIONAL'],
    ['ASISTENTE', 'ASISTENTE'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(toCanonicalRole(input)).toBe(expected);
  });

  it('treats legacy and canonical aliases as equivalent', () => {
    expect(areRolesEquivalent('ADMIN', 'CLIENTE')).toBe(true);
    expect(areRolesEquivalent('PSICOLOGO', 'PROFESIONAL')).toBe(true);
    expect(areRolesEquivalent('ASISTENTE', 'PROFESIONAL')).toBe(false);
  });

  it('classifies administrative and professional aliases', () => {
    expect(isAdminRole('CLIENTE')).toBe(true);
    expect(isAdminRole('ADMIN')).toBe(true);
    expect(isProfessionalRole('PSICOLOGO')).toBe(true);
    expect(isProfessionalRole('PROFESIONAL')).toBe(true);
  });
});
