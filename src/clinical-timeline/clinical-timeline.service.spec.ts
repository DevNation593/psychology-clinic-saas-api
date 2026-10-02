import { ClinicalTimelineService } from './clinical-timeline.service';
import { ClinicalActor } from '../clinical-access/clinical-actor';
import { ClinicalAuditService } from '../clinical-access/clinical-audit.service';
import { ClinicalCipher } from '../clinical-access/clinical-cipher';
import { PrismaService } from '../prisma/prisma.service';

describe('ClinicalTimelineService', () => {
  const plain = new ClinicalCipher();
  const actor: ClinicalActor = { userId: 'reader', role: 'PROFESIONAL', specialtyId: 'psychology' };
  const person = { id: 'pro', firstName: 'Ana', lastName: 'López' };
  const specialty = { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición' };
  const prisma = {
    patient: { findFirst: jest.fn() },
    appointment: { findMany: jest.fn() },
    clinicalNote: { findMany: jest.fn() },
    specialtyRecord: { findMany: jest.fn() },
    auditLog: { createMany: jest.fn() },
  };
  const service = new ClinicalTimelineService(
    prisma as unknown as PrismaService,
    new ClinicalAuditService(prisma as unknown as PrismaService, plain),
    plain,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.patient.findFirst.mockResolvedValue({ id: 'patient-1' });
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'appointment-1',
        title: 'Consulta',
        startTime: new Date('2026-09-10T10:00:00Z'),
        professional: null,
        psychologist: person,
        specialty,
      },
    ]);
    prisma.clinicalNote.findMany.mockResolvedValue([
      {
        id: 'note-1',
        content: 'Nota',
        sessionDate: new Date('2026-09-20T10:00:00Z'),
        psychologist: person,
        specialty: null,
      },
    ]);
    prisma.specialtyRecord.findMany.mockResolvedValue([
      {
        id: 'record-1',
        data: { bmi: 24 },
        recordDate: new Date('2026-09-15T10:00:00Z'),
        professional: person,
        specialty,
      },
    ]);
  });

  it('merges the three sources newest first and audits the clinical records read', async () => {
    const timeline = await service.getTimeline('tenant-1', 'patient-1', actor, {});

    expect(timeline.map(({ type, id }) => [type, id])).toEqual([
      ['CLINICAL_NOTE', 'note-1'],
      ['SPECIALTY_RECORD', 'record-1'],
      ['APPOINTMENT', 'appointment-1'],
    ]);
    expect(timeline[2].professional).toEqual(person);
    expect(prisma.auditLog.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ action: 'READ', entity: 'CLINICAL_NOTE', entityId: 'note-1' }),
      expect.objectContaining({ action: 'READ', entity: 'SPECIALTY_RECORD', entityId: 'record-1' }),
    ]);
  });

  it('scopes every source to the tenant and patient and leaves out removed records', async () => {
    await service.getTimeline('tenant-1', 'patient-1', actor, {
      specialtyId: 'nutrition',
      professionalId: 'pro',
      from: '2026-09-01T00:00:00.000Z',
    });

    const range = { gte: new Date('2026-09-01T00:00:00.000Z') };
    expect(prisma.clinicalNote.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      deletedAt: null,
      specialtyId: 'nutrition',
      psychologistId: 'pro',
      sessionDate: range,
    });
    expect(prisma.specialtyRecord.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      deletedAt: null,
      specialtyId: 'nutrition',
      professionalId: 'pro',
      recordDate: range,
    });
    expect(prisma.appointment.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      startTime: range,
    });
  });

  it('queries only the requested type', async () => {
    const timeline = await service.getTimeline('tenant-1', 'patient-1', actor, {
      type: 'SPECIALTY_RECORD',
    });

    expect(timeline.map(({ type }) => type)).toEqual(['SPECIALTY_RECORD']);
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(prisma.clinicalNote.findMany).not.toHaveBeenCalled();
  });

  it('rejects a patient of another tenant before reading anything', async () => {
    prisma.patient.findFirst.mockResolvedValue(null);

    await expect(service.getTimeline('tenant-1', 'foreign', actor, {})).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.clinicalNote.findMany).not.toHaveBeenCalled();
  });
});
