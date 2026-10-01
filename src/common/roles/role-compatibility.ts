export type CanonicalRole = 'ADMIN' | 'PROFESIONAL' | 'ASISTENTE' | 'SOPORTE' | 'PACIENTE';
export type CompatibleRole = CanonicalRole | 'CLIENTE' | 'PSICOLOGO';

const ROLE_ALIASES: Record<CompatibleRole, CanonicalRole> = {
  ADMIN: 'ADMIN',
  CLIENTE: 'ADMIN',
  PROFESIONAL: 'PROFESIONAL',
  PSICOLOGO: 'PROFESIONAL',
  ASISTENTE: 'ASISTENTE',
  SOPORTE: 'SOPORTE',
  PACIENTE: 'PACIENTE',
};

export function toCanonicalRole(role: string): CanonicalRole | undefined {
  return ROLE_ALIASES[role as CompatibleRole];
}

export function areRolesEquivalent(actual: string, required: string): boolean {
  const actualCanonical = toCanonicalRole(actual);
  const requiredCanonical = toCanonicalRole(required);
  return !!actualCanonical && actualCanonical === requiredCanonical;
}

export const isAdminRole = (role: string): boolean => toCanonicalRole(role) === 'ADMIN';
export const isProfessionalRole = (role: string): boolean =>
  toCanonicalRole(role) === 'PROFESIONAL';
