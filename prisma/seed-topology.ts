export type SeedTenantKey = 'clinic' | 'personal';
export type SeedSpecialtyKey = 'psychology' | 'nutrition' | 'physiotherapy' | 'dentistry';
export type SeedProfessionalKey =
  | 'clinicAdmin'
  | 'psychology'
  | 'nutrition'
  | 'physiotherapy'
  | 'personalPsychology';
export type SeedPatientKey = 'valeria' | 'jorge' | 'camila' | 'andres' | 'priscila';

export interface SeedProfessionalDefinition {
  key: SeedProfessionalKey;
  tenantKey: SeedTenantKey;
  role: 'ADMIN' | 'PROFESIONAL';
  specialtyKey: SeedSpecialtyKey;
}

export interface SeedPatientDefinition {
  key: SeedPatientKey;
  tenantKey: SeedTenantKey;
  primaryProfessionalKey: SeedProfessionalKey;
}

export interface SeedMembershipDefinition {
  tenantKey: SeedTenantKey;
  patientKey: SeedPatientKey;
  professionalKey: SeedProfessionalKey;
}

export interface SeedAppointmentDefinition extends SeedMembershipDefinition {
  key: string;
  specialtyKey: SeedSpecialtyKey;
}

export interface SeedTopology {
  professionals: SeedProfessionalDefinition[];
  patients: SeedPatientDefinition[];
  memberships: SeedMembershipDefinition[];
  appointments: SeedAppointmentDefinition[];
}

export interface SeedResolvedIds {
  tenants: Partial<Record<SeedTenantKey, string>>;
  professionals: Partial<Record<SeedProfessionalKey, string>>;
  patients: Partial<Record<SeedPatientKey, string>>;
  specialties: Partial<Record<SeedSpecialtyKey, string>>;
  assigners: Partial<Record<SeedTenantKey, string>>;
}

export interface CanonicalSeedRelations {
  memberships: Array<{
    tenantId: string;
    patientId: string;
    professionalId: string;
    assignedById: string;
    isActive: true;
  }>;
  appointments: Record<
    string,
    {
      tenantId: string;
      patientId: string;
      professionalId: string;
      psychologistId: string;
      specialtyId: string;
    }
  >;
}

export const DEMO_SEED_TOPOLOGY: SeedTopology = {
  professionals: [
    {
      key: 'clinicAdmin',
      tenantKey: 'clinic',
      role: 'ADMIN',
      specialtyKey: 'dentistry',
    },
    {
      key: 'psychology',
      tenantKey: 'clinic',
      role: 'PROFESIONAL',
      specialtyKey: 'psychology',
    },
    {
      key: 'nutrition',
      tenantKey: 'clinic',
      role: 'PROFESIONAL',
      specialtyKey: 'nutrition',
    },
    {
      key: 'physiotherapy',
      tenantKey: 'clinic',
      role: 'PROFESIONAL',
      specialtyKey: 'physiotherapy',
    },
    {
      key: 'personalPsychology',
      tenantKey: 'personal',
      role: 'PROFESIONAL',
      specialtyKey: 'psychology',
    },
  ],
  patients: [
    {
      key: 'valeria',
      tenantKey: 'clinic',
      primaryProfessionalKey: 'psychology',
    },
    {
      key: 'jorge',
      tenantKey: 'clinic',
      primaryProfessionalKey: 'psychology',
    },
    {
      key: 'camila',
      tenantKey: 'clinic',
      primaryProfessionalKey: 'nutrition',
    },
    {
      key: 'andres',
      tenantKey: 'clinic',
      primaryProfessionalKey: 'physiotherapy',
    },
    {
      key: 'priscila',
      tenantKey: 'personal',
      primaryProfessionalKey: 'personalPsychology',
    },
  ],
  memberships: [
    { tenantKey: 'clinic', patientKey: 'valeria', professionalKey: 'psychology' },
    { tenantKey: 'clinic', patientKey: 'valeria', professionalKey: 'nutrition' },
    { tenantKey: 'clinic', patientKey: 'jorge', professionalKey: 'psychology' },
    { tenantKey: 'clinic', patientKey: 'camila', professionalKey: 'nutrition' },
    { tenantKey: 'clinic', patientKey: 'camila', professionalKey: 'physiotherapy' },
    { tenantKey: 'clinic', patientKey: 'andres', professionalKey: 'physiotherapy' },
    { tenantKey: 'clinic', patientKey: 'andres', professionalKey: 'clinicAdmin' },
    {
      tenantKey: 'personal',
      patientKey: 'priscila',
      professionalKey: 'personalPsychology',
    },
  ],
  appointments: [
    {
      key: 'valeria-psychology',
      tenantKey: 'clinic',
      patientKey: 'valeria',
      professionalKey: 'psychology',
      specialtyKey: 'psychology',
    },
    {
      key: 'valeria-nutrition',
      tenantKey: 'clinic',
      patientKey: 'valeria',
      professionalKey: 'nutrition',
      specialtyKey: 'nutrition',
    },
    {
      key: 'jorge-psychology',
      tenantKey: 'clinic',
      patientKey: 'jorge',
      professionalKey: 'psychology',
      specialtyKey: 'psychology',
    },
    {
      key: 'camila-nutrition',
      tenantKey: 'clinic',
      patientKey: 'camila',
      professionalKey: 'nutrition',
      specialtyKey: 'nutrition',
    },
    {
      key: 'camila-physiotherapy',
      tenantKey: 'clinic',
      patientKey: 'camila',
      professionalKey: 'physiotherapy',
      specialtyKey: 'physiotherapy',
    },
    {
      key: 'andres-dentistry',
      tenantKey: 'clinic',
      patientKey: 'andres',
      professionalKey: 'clinicAdmin',
      specialtyKey: 'dentistry',
    },
  ],
};

export function assertSeedTopology(topology: SeedTopology): void {
  const professionals = new Map<SeedProfessionalKey, SeedProfessionalDefinition>();
  for (const professional of topology.professionals) {
    if (professionals.has(professional.key)) {
      throw new Error(`SEED_DUPLICATE_PROFESSIONAL:${professional.key}`);
    }
    professionals.set(professional.key, professional);
  }

  const patients = new Map<SeedPatientKey, SeedPatientDefinition>();
  for (const patient of topology.patients) patients.set(patient.key, patient);

  const membershipKeys = new Set<string>();
  for (const membership of topology.memberships) {
    const key = `${membership.tenantKey}:${membership.patientKey}:${membership.professionalKey}`;
    if (membershipKeys.has(key)) throw new Error(`SEED_DUPLICATE_MEMBERSHIP:${key}`);

    const patient = patients.get(membership.patientKey);
    const professional = professionals.get(membership.professionalKey);
    if (
      !patient ||
      !professional ||
      patient.tenantKey !== membership.tenantKey ||
      professional.tenantKey !== membership.tenantKey
    ) {
      throw new Error(`SEED_CROSS_TENANT_MEMBERSHIP:${key}`);
    }
    membershipKeys.add(key);
  }

  for (const patient of topology.patients) {
    const primaryMembershipKey = `${patient.tenantKey}:${patient.key}:${patient.primaryProfessionalKey}`;
    if (!membershipKeys.has(primaryMembershipKey)) {
      throw new Error(
        `SEED_PRIMARY_PROFESSIONAL_NOT_ASSIGNED:${patient.key}:${patient.primaryProfessionalKey}`,
      );
    }
  }

  for (const appointment of topology.appointments) {
    const membershipKey = `${appointment.tenantKey}:${appointment.patientKey}:${appointment.professionalKey}`;
    if (!membershipKeys.has(membershipKey)) {
      throw new Error(`SEED_APPOINTMENT_PROFESSIONAL_NOT_ASSIGNED:${appointment.key}`);
    }

    const professional = professionals.get(appointment.professionalKey);
    if (professional?.specialtyKey !== appointment.specialtyKey) {
      throw new Error(`SEED_APPOINTMENT_SPECIALTY_MISMATCH:${appointment.key}`);
    }
  }
}

export function resolvePrimaryProfessionalId(
  topology: SeedTopology,
  patientKey: SeedPatientKey,
  professionalIds: Partial<Record<SeedProfessionalKey, string>>,
): string {
  const patient = topology.patients.find((candidate) => candidate.key === patientKey);
  if (!patient) throw new Error(`SEED_PATIENT_NOT_FOUND:${patientKey}`);
  return requiredSeedId(
    'professional',
    patient.primaryProfessionalKey,
    professionalIds[patient.primaryProfessionalKey],
  );
}

function requiredSeedId(kind: string, key: string, value: string | undefined): string {
  if (!value) throw new Error(`SEED_ID_NOT_RESOLVED:${kind}:${key}`);
  return value;
}

export function buildCanonicalSeedRelations(
  topology: SeedTopology,
  ids: SeedResolvedIds,
  tenantKey?: SeedTenantKey,
): CanonicalSeedRelations {
  assertSeedTopology(topology);
  const memberships = tenantKey
    ? topology.memberships.filter((membership) => membership.tenantKey === tenantKey)
    : topology.memberships;
  const appointments = tenantKey
    ? topology.appointments.filter((appointment) => appointment.tenantKey === tenantKey)
    : topology.appointments;

  return {
    memberships: memberships.map((membership) => ({
      tenantId: requiredSeedId('tenant', membership.tenantKey, ids.tenants[membership.tenantKey]),
      patientId: requiredSeedId(
        'patient',
        membership.patientKey,
        ids.patients[membership.patientKey],
      ),
      professionalId: requiredSeedId(
        'professional',
        membership.professionalKey,
        ids.professionals[membership.professionalKey],
      ),
      assignedById: requiredSeedId(
        'assigner',
        membership.tenantKey,
        ids.assigners[membership.tenantKey],
      ),
      isActive: true,
    })),
    appointments: Object.fromEntries(
      appointments.map((appointment) => {
        const professionalId = requiredSeedId(
          'professional',
          appointment.professionalKey,
          ids.professionals[appointment.professionalKey],
        );
        return [
          appointment.key,
          {
            tenantId: requiredSeedId(
              'tenant',
              appointment.tenantKey,
              ids.tenants[appointment.tenantKey],
            ),
            patientId: requiredSeedId(
              'patient',
              appointment.patientKey,
              ids.patients[appointment.patientKey],
            ),
            professionalId,
            psychologistId: professionalId,
            specialtyId: requiredSeedId(
              'specialty',
              appointment.specialtyKey,
              ids.specialties[appointment.specialtyKey],
            ),
          },
        ];
      }),
    ),
  };
}
