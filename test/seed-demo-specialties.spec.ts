import { seedDemoSpecialties } from '../prisma/seed-demo-specialties';

type StoredRow = Record<string, any> & { id: string };

function createMemoryDatabase() {
  const rows = {
    users: [] as StoredRow[],
    patients: [] as StoredRow[],
    appointments: [] as StoredRow[],
    patientProfessionals: [] as StoredRow[],
    specialtyRecords: [] as StoredRow[],
  };

  const insert = (collection: StoredRow[], prefix: string, data: Record<string, any>) => {
    const row = { id: `${prefix}-${collection.length + 1}`, ...data };
    collection.push(row);
    return Promise.resolve(row);
  };

  return {
    rows,
    db: {
      user: {
        create: ({ data }: { data: Record<string, any> }) => insert(rows.users, 'user', data),
      },
      patient: {
        create: ({ data }: { data: Record<string, any> }) => insert(rows.patients, 'patient', data),
      },
      appointment: {
        create: ({ data }: { data: Record<string, any> }) =>
          insert(rows.appointments, 'appointment', data),
      },
      patientProfessional: {
        create: ({ data }: { data: Record<string, any> }) =>
          insert(rows.patientProfessionals, 'team', data),
      },
      specialtyRecord: {
        createMany: ({ data }: { data: Array<Record<string, any>> }) => {
          data.forEach((item) => {
            rows.specialtyRecords.push({
              id: `record-${rows.specialtyRecords.length + 1}`,
              ...item,
            });
          });
          return Promise.resolve({ count: data.length });
        },
      },
    },
  };
}

describe('seedDemoSpecialties', () => {
  it('persists a correctly linked demo case for every specialty', async () => {
    const { db, rows } = createMemoryDatabase();
    const result = await seedDemoSpecialties(
      db as unknown as Parameters<typeof seedDemoSpecialties>[0],
      {
        tenantId: 'tenant-demo',
        hashedPassword: 'hashed-password',
        assignedById: 'admin-demo',
        specialtyIds: {
          psychology: 'specialty-psychology',
          nutrition: 'specialty-nutrition',
          physiotherapy: 'specialty-physiotherapy',
          dentistry: 'specialty-dentistry',
        },
        referenceDate: new Date('2026-10-01T12:00:00.000Z'),
      },
    );

    expect(
      rows.users.map(({ email, role, professionalProfile, professionalSpecialties }) => ({
        email,
        role,
        profileSpecialtyId: professionalProfile.create.specialtyId,
        primarySpecialtyId: professionalSpecialties.create.specialtyId,
      })),
    ).toEqual([
      {
        email: 'psic.ana@psic.com',
        role: 'PROFESIONAL',
        profileSpecialtyId: 'specialty-psychology',
        primarySpecialtyId: 'specialty-psychology',
      },
      {
        email: 'nutri.luis@psic.com',
        role: 'PROFESIONAL',
        profileSpecialtyId: 'specialty-nutrition',
        primarySpecialtyId: 'specialty-nutrition',
      },
      {
        email: 'fisio.sofia@psic.com',
        role: 'PROFESIONAL',
        profileSpecialtyId: 'specialty-physiotherapy',
        primarySpecialtyId: 'specialty-physiotherapy',
      },
      {
        email: 'odonto.carlos@psic.com',
        role: 'PROFESIONAL',
        profileSpecialtyId: 'specialty-dentistry',
        primarySpecialtyId: 'specialty-dentistry',
      },
    ]);

    expect(
      rows.patients.map(({ id, assignedPsychologistId }) => ({ id, assignedPsychologistId })),
    ).toEqual([
      { id: 'patient-1', assignedPsychologistId: 'user-1' },
      { id: 'patient-2', assignedPsychologistId: 'user-2' },
      { id: 'patient-3', assignedPsychologistId: 'user-3' },
      { id: 'patient-4', assignedPsychologistId: 'user-4' },
    ]);
    expect(rows.patientProfessionals).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-demo',
        patientId: 'patient-1',
        professionalId: 'user-1',
        assignedById: 'admin-demo',
      }),
      expect.objectContaining({ patientId: 'patient-2', professionalId: 'user-2' }),
      expect.objectContaining({ patientId: 'patient-3', professionalId: 'user-3' }),
      expect.objectContaining({ patientId: 'patient-4', professionalId: 'user-4' }),
    ]);
    expect(
      rows.appointments.map(
        ({
          id,
          patientId,
          psychologistId,
          professionalId,
          specialtyId,
          startTime,
          endTime,
          duration,
          status,
        }) => ({
          id,
          patientId,
          psychologistId,
          professionalId,
          specialtyId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          duration,
          status,
        }),
      ),
    ).toEqual([
      {
        id: 'appointment-1',
        patientId: 'patient-1',
        psychologistId: 'user-1',
        professionalId: 'user-1',
        specialtyId: 'specialty-psychology',
        startTime: '2026-09-28T12:00:00.000Z',
        endTime: '2026-09-28T13:00:00.000Z',
        duration: 60,
        status: 'COMPLETED',
      },
      {
        id: 'appointment-2',
        patientId: 'patient-2',
        psychologistId: 'user-2',
        professionalId: 'user-2',
        specialtyId: 'specialty-nutrition',
        startTime: '2026-10-03T12:00:00.000Z',
        endTime: '2026-10-03T13:00:00.000Z',
        duration: 60,
        status: 'SCHEDULED',
      },
      {
        id: 'appointment-3',
        patientId: 'patient-3',
        psychologistId: 'user-3',
        professionalId: 'user-3',
        specialtyId: 'specialty-physiotherapy',
        startTime: '2026-10-02T12:00:00.000Z',
        endTime: '2026-10-02T12:45:00.000Z',
        duration: 45,
        status: 'CONFIRMED',
      },
      {
        id: 'appointment-4',
        patientId: 'patient-4',
        psychologistId: 'user-4',
        professionalId: 'user-4',
        specialtyId: 'specialty-dentistry',
        startTime: '2026-10-04T12:00:00.000Z',
        endTime: '2026-10-04T12:45:00.000Z',
        duration: 45,
        status: 'SCHEDULED',
      },
    ]);
    expect(
      rows.specialtyRecords.map(
        ({
          tenantId,
          patientId,
          professionalId,
          specialtyId,
          appointmentId,
          moduleKey,
          recordDate,
        }) => ({
          tenantId,
          patientId,
          professionalId,
          specialtyId,
          appointmentId,
          moduleKey,
          recordDate: recordDate?.toISOString(),
        }),
      ),
    ).toEqual([
      {
        tenantId: 'tenant-demo',
        patientId: 'patient-1',
        professionalId: 'user-1',
        specialtyId: 'specialty-psychology',
        appointmentId: 'appointment-1',
        moduleKey: 'psychology.assessments',
        recordDate: '2026-09-28T12:00:00.000Z',
      },
      {
        tenantId: 'tenant-demo',
        patientId: 'patient-2',
        professionalId: 'user-2',
        specialtyId: 'specialty-nutrition',
        appointmentId: undefined,
        moduleKey: 'nutrition.assessments',
        recordDate: '2026-10-01T12:00:00.000Z',
      },
      {
        tenantId: 'tenant-demo',
        patientId: 'patient-2',
        professionalId: 'user-2',
        specialtyId: 'specialty-nutrition',
        appointmentId: undefined,
        moduleKey: 'nutrition.diet-plans',
        recordDate: '2026-10-01T12:00:00.000Z',
      },
      {
        tenantId: 'tenant-demo',
        patientId: 'patient-3',
        professionalId: 'user-3',
        specialtyId: 'specialty-physiotherapy',
        appointmentId: undefined,
        moduleKey: 'physiotherapy.evolution',
        recordDate: '2026-09-29T12:00:00.000Z',
      },
      {
        tenantId: 'tenant-demo',
        patientId: 'patient-3',
        professionalId: 'user-3',
        specialtyId: 'specialty-physiotherapy',
        appointmentId: undefined,
        moduleKey: 'physiotherapy.exercise-plans',
        recordDate: '2026-10-01T12:00:00.000Z',
      },
      {
        tenantId: 'tenant-demo',
        patientId: 'patient-4',
        professionalId: 'user-4',
        specialtyId: 'specialty-dentistry',
        appointmentId: undefined,
        moduleKey: 'dentistry.treatments',
        recordDate: '2026-09-30T12:00:00.000Z',
      },
      {
        tenantId: 'tenant-demo',
        patientId: 'patient-4',
        professionalId: 'user-4',
        specialtyId: 'specialty-dentistry',
        appointmentId: undefined,
        moduleKey: 'dentistry.odontogram',
        recordDate: '2026-10-01T12:00:00.000Z',
      },
    ]);
    expect(
      Object.fromEntries(
        Object.entries(result).map(([key, value]) => [
          key,
          {
            professionalId: value.professional.id,
            patientId: value.patient.id,
            appointmentId: value.appointment.id,
          },
        ]),
      ),
    ).toEqual({
      psychology: {
        professionalId: 'user-1',
        patientId: 'patient-1',
        appointmentId: 'appointment-1',
      },
      nutrition: {
        professionalId: 'user-2',
        patientId: 'patient-2',
        appointmentId: 'appointment-2',
      },
      physiotherapy: {
        professionalId: 'user-3',
        patientId: 'patient-3',
        appointmentId: 'appointment-3',
      },
      dentistry: {
        professionalId: 'user-4',
        patientId: 'patient-4',
        appointmentId: 'appointment-4',
      },
    });
  });
});
