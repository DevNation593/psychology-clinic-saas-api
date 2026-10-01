import {
  assertSeedTopology,
  buildCanonicalSeedRelations,
  DEMO_SEED_TOPOLOGY,
  resolvePrimaryProfessionalId,
  type SeedTopology,
} from '../prisma/seed-topology';

function mutableTopology(): SeedTopology {
  return structuredClone(DEMO_SEED_TOPOLOGY) as SeedTopology;
}

describe('demo seed topology', () => {
  it('models shared multidisciplinary care with a clinical administrator', () => {
    expect(() => assertSeedTopology(DEMO_SEED_TOPOLOGY)).not.toThrow();

    expect(DEMO_SEED_TOPOLOGY.professionals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'clinicAdmin',
          tenantKey: 'clinic',
          role: 'ADMIN',
          specialtyKey: 'dentistry',
        }),
        expect.objectContaining({
          key: 'psychology',
          tenantKey: 'clinic',
          role: 'PROFESIONAL',
          specialtyKey: 'psychology',
        }),
        expect.objectContaining({
          key: 'nutrition',
          tenantKey: 'clinic',
          role: 'PROFESIONAL',
          specialtyKey: 'nutrition',
        }),
        expect.objectContaining({
          key: 'physiotherapy',
          tenantKey: 'clinic',
          role: 'PROFESIONAL',
          specialtyKey: 'physiotherapy',
        }),
      ]),
    );

    expect(
      DEMO_SEED_TOPOLOGY.memberships
        .filter(({ tenantKey, patientKey }) => tenantKey === 'clinic' && patientKey === 'valeria')
        .map(({ professionalKey }) => professionalKey)
        .sort(),
    ).toEqual(['nutrition', 'psychology']);

    expect(DEMO_SEED_TOPOLOGY.appointments).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('resolves canonical database identities for memberships and appointments', () => {
    const ids = {
      tenants: { clinic: 'tenant-clinic', personal: 'tenant-personal' },
      professionals: {
        clinicAdmin: 'user-admin',
        psychology: 'user-psychology',
        nutrition: 'user-nutrition',
        physiotherapy: 'user-physiotherapy',
        personalPsychology: 'user-personal-psychology',
      },
      patients: {
        valeria: 'patient-valeria',
        jorge: 'patient-jorge',
        camila: 'patient-camila',
        andres: 'patient-andres',
        priscila: 'patient-priscila',
      },
      specialties: {
        psychology: 'specialty-psychology',
        nutrition: 'specialty-nutrition',
        physiotherapy: 'specialty-physiotherapy',
        dentistry: 'specialty-dentistry',
      },
      assigners: { clinic: 'user-admin', personal: 'user-personal-admin' },
    };

    expect(resolvePrimaryProfessionalId(DEMO_SEED_TOPOLOGY, 'valeria', ids.professionals)).toBe(
      'user-psychology',
    );

    const relations = buildCanonicalSeedRelations(DEMO_SEED_TOPOLOGY, ids);
    expect(relations.memberships).toHaveLength(8);
    expect(relations.memberships).toContainEqual({
      tenantId: 'tenant-clinic',
      patientId: 'patient-valeria',
      professionalId: 'user-nutrition',
      assignedById: 'user-admin',
      isActive: true,
    });
    expect(relations.appointments['valeria-nutrition']).toEqual({
      tenantId: 'tenant-clinic',
      patientId: 'patient-valeria',
      professionalId: 'user-nutrition',
      psychologistId: 'user-nutrition',
      specialtyId: 'specialty-nutrition',
    });
    expect(relations.appointments['andres-dentistry']).toEqual({
      tenantId: 'tenant-clinic',
      patientId: 'patient-andres',
      professionalId: 'user-admin',
      psychologistId: 'user-admin',
      specialtyId: 'specialty-dentistry',
    });

    const clinicOnly = buildCanonicalSeedRelations(DEMO_SEED_TOPOLOGY, ids, 'clinic');
    expect(clinicOnly.memberships).toHaveLength(7);
    expect(clinicOnly.memberships).not.toContainEqual(
      expect.objectContaining({ tenantId: 'tenant-personal' }),
    );
  });

  it('rejects unresolved database ids before producing Prisma rows', () => {
    const ids = {
      tenants: { clinic: 'tenant-clinic' },
      professionals: {
        clinicAdmin: 'user-admin',
        psychology: 'user-psychology',
        physiotherapy: 'user-physiotherapy',
      },
      patients: {
        valeria: 'patient-valeria',
        jorge: 'patient-jorge',
        camila: 'patient-camila',
        andres: 'patient-andres',
      },
      specialties: {
        psychology: 'specialty-psychology',
        nutrition: 'specialty-nutrition',
        physiotherapy: 'specialty-physiotherapy',
        dentistry: 'specialty-dentistry',
      },
      assigners: { clinic: 'user-admin' },
    };

    expect(() => buildCanonicalSeedRelations(DEMO_SEED_TOPOLOGY, ids, 'clinic')).toThrow(
      'SEED_ID_NOT_RESOLVED:professional:nutrition',
    );
  });

  it('rejects two specialties for the same professional key', () => {
    const topology = mutableTopology();
    topology.professionals.push({
      key: 'psychology',
      tenantKey: 'clinic',
      role: 'PROFESIONAL',
      specialtyKey: 'nutrition',
    });

    expect(() => assertSeedTopology(topology)).toThrow('SEED_DUPLICATE_PROFESSIONAL:psychology');
  });

  it('rejects duplicate and cross-tenant patient memberships', () => {
    const duplicate = mutableTopology();
    duplicate.memberships.push({ ...duplicate.memberships[0] });
    expect(() => assertSeedTopology(duplicate)).toThrow(
      'SEED_DUPLICATE_MEMBERSHIP:clinic:valeria:psychology',
    );

    const crossTenant = mutableTopology();
    crossTenant.memberships.push({
      tenantKey: 'clinic',
      patientKey: 'valeria',
      professionalKey: 'personalPsychology',
    });
    expect(() => assertSeedTopology(crossTenant)).toThrow(
      'SEED_CROSS_TENANT_MEMBERSHIP:clinic:valeria:personalPsychology',
    );
  });

  it('rejects a legacy primary professional outside the patient team', () => {
    const topology = mutableTopology();
    const jorge = topology.patients.find((patient) => patient.key === 'jorge')!;
    jorge.primaryProfessionalKey = 'nutrition';

    expect(() => assertSeedTopology(topology)).toThrow(
      'SEED_PRIMARY_PROFESSIONAL_NOT_ASSIGNED:jorge:nutrition',
    );
  });

  it('rejects appointments outside the team or with a mismatched specialty', () => {
    const missingMembership = mutableTopology();
    missingMembership.appointments.push({
      key: 'andres-psychology',
      tenantKey: 'clinic',
      patientKey: 'andres',
      professionalKey: 'psychology',
      specialtyKey: 'psychology',
    });
    expect(() => assertSeedTopology(missingMembership)).toThrow(
      'SEED_APPOINTMENT_PROFESSIONAL_NOT_ASSIGNED:andres-psychology',
    );

    const specialtyMismatch = mutableTopology();
    specialtyMismatch.appointments[0].specialtyKey = 'nutrition';
    expect(() => assertSeedTopology(specialtyMismatch)).toThrow(
      'SEED_APPOINTMENT_SPECIALTY_MISMATCH:valeria-psychology',
    );
  });
});
