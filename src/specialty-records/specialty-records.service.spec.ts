import { SpecialtyRecordsService } from './specialty-records.service';
import { ClinicalActor } from '../clinical-access/clinical-actor';
import { ClinicalAuditService } from '../clinical-access/clinical-audit.service';
import { ClinicalCipher } from '../clinical-access/clinical-cipher';
import { PrismaService } from '../prisma/prisma.service';

describe('SpecialtyRecordsService', () => {
  const plain = new ClinicalCipher();
  const nutritionist: ClinicalActor = {
    userId: 'nutritionist',
    role: 'PROFESIONAL',
    specialtyId: 'nutrition',
  };
  const psychologist: ClinicalActor = { ...nutritionist, userId: 'psy', specialtyId: 'psychology' };
  const dto = {
    specialtyCode: 'nutrition',
    moduleKey: 'nutrition.assessments',
    data: { weightKg: 70, heightCm: 170, bmi: 24.2 },
  };
  const record = (overrides = {}) => ({
    id: 'record-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    professionalId: 'nutritionist',
    specialtyId: 'nutrition',
    moduleKey: 'nutrition.assessments',
    appointmentId: null,
    recordDate: new Date('2026-10-01T10:00:00Z'),
    data: dto.data,
    notes: null,
    version: 1,
    deletedAt: null,
    ...overrides,
  });
  const db = {
    patient: { findFirst: jest.fn() },
    specialty: { findFirst: jest.fn() },
    tenantModule: { findFirst: jest.fn() },
    specialtyModule: { findFirst: jest.fn() },
    appointment: { findFirst: jest.fn() },
    specialtyRecord: { findMany: jest.fn(), create: jest.fn() },
    auditLog: { createMany: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn(), applyRlsContext: jest.fn() };
  const service = new SpecialtyRecordsService(
    prisma as unknown as PrismaService,
    new ClinicalAuditService(prisma as unknown as PrismaService, plain),
    plain,
  );
  const auditRows = () => db.auditLog.createMany.mock.calls.flatMap(([args]) => args.data);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
    db.patient.findFirst.mockResolvedValue({ id: 'patient-1' });
    db.specialty.findFirst.mockResolvedValue({ id: 'nutrition', code: 'NUTRITION' });
    db.tenantModule.findFirst.mockResolvedValue({ id: 'module' });
    db.specialtyModule.findFirst.mockResolvedValue({ id: 'specialty-module' });
    db.specialtyRecord.create.mockResolvedValue(record());
  });

  it('lets a professional of another specialty read live records and audits each read', async () => {
    db.specialtyRecord.findMany.mockResolvedValue([record(), record({ id: 'record-2' })]);

    await service.list('tenant-1', 'patient-1', psychologist);

    expect(db.specialtyRecord.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      deletedAt: null,
    });
    expect(auditRows()).toEqual([
      expect.objectContaining({
        action: 'READ',
        entity: 'SPECIALTY_RECORD',
        entityId: 'record-1',
        patientId: 'patient-1',
        userId: 'psy',
      }),
      expect.objectContaining({ action: 'READ', entityId: 'record-2', userId: 'psy' }),
    ]);
  });

  it('does not list records of a patient outside the tenant', async () => {
    db.patient.findFirst.mockResolvedValue(null);

    await expect(service.list('tenant-1', 'foreign', psychologist)).rejects.toMatchObject({
      status: 404,
    });
    expect(db.specialtyRecord.findMany).not.toHaveBeenCalled();
  });

  it('creates the record under the author and audits it with its content', async () => {
    await service.create('tenant-1', 'patient-1', nutritionist, dto);

    expect(db.specialtyRecord.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      professionalId: 'nutritionist',
      specialtyId: 'nutrition',
    });
    expect(auditRows()).toEqual([
      expect.objectContaining({
        action: 'CREATE',
        entity: 'SPECIALTY_RECORD',
        entityId: 'record-1',
        patientId: 'patient-1',
        userId: 'nutritionist',
        changes: { before: null, after: expect.objectContaining({ data: dto.data, version: 1 }) },
      }),
    ]);
  });

  it('refuses a record under a specialty that is not the author’s own', async () => {
    await expect(service.create('tenant-1', 'patient-1', psychologist, dto)).rejects.toMatchObject({
      status: 403,
      response: { code: 'CLINICAL_RECORD_FORBIDDEN' },
    });
    expect(db.specialtyRecord.create).not.toHaveBeenCalled();
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
  });
});
