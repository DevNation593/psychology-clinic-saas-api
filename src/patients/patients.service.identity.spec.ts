import { PatientTeamService } from '../patient-team/patient-team.service';
import { PrismaService } from '../prisma/prisma.service';
import { PatientsService } from './patients.service';

describe('PatientsService identification and guardian', () => {
  const stored = {
    id: 'patient-1',
    tenantId: 'tenant-1',
    firstName: 'Ana',
    lastName: 'Paz',
    dateOfBirth: new Date('2015-05-01T00:00:00.000Z'),
    guardianName: null,
    identificationType: 'CEDULA',
    identificationNumber: '1712345678',
  };
  const tx = {
    patient: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    tenantSubscription: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    applyRlsContext: jest.fn(),
    patient: { findMany: jest.fn() },
  };
  const team = { ensureActive: jest.fn(), assertActiveMembership: jest.fn(), remove: jest.fn() };
  const service = new PatientsService(
    prisma as unknown as PrismaService,
    team as unknown as PatientTeamService,
  );
  const create = (dto: Record<string, unknown>) =>
    service.create('tenant-1', { firstName: 'Ana', lastName: 'Paz', ...dto }, 'user-1', 'MASTER');
  const update = (dto: Record<string, unknown>) =>
    service.update('tenant-1', 'patient-1', dto, 'user-1', 'MASTER');

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    tx.patient.create.mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data }));
    tx.patient.update.mockImplementation(({ data }) => Promise.resolve({ ...stored, ...data }));
    tx.tenantSubscription.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      activePatientsCount: 0,
      maxActivePatients: 10,
      planType: 'CLINIC_PRO',
    });
    tx.tenantSubscription.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('create', () => {
    it('stores the normalized identification and the trimmed demographic fields', async () => {
      tx.patient.findFirst.mockResolvedValue(null);

      await create({
        identificationType: 'cedula',
        identificationNumber: '171234567-8',
        occupation: '  Docente ',
        nationality: ' ',
      });

      expect(tx.patient.findFirst.mock.calls[0][0].where).toEqual({
        tenantId: 'tenant-1',
        identificationType: 'CEDULA',
        identificationNumber: '1712345678',
        deletedAt: null,
      });
      expect(tx.patient.create.mock.calls[0][0].data).toMatchObject({
        identificationType: 'CEDULA',
        identificationNumber: '1712345678',
        occupation: 'Docente',
        nationality: null,
      });
    });

    it('refuses an identification another live patient of the clinic already has', async () => {
      tx.patient.findFirst.mockResolvedValue({ id: 'other' });

      await expect(
        create({ identificationType: 'CEDULA', identificationNumber: '1712345678' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'PATIENT_IDENTIFICATION_TAKEN' },
      });
      expect(tx.patient.create).not.toHaveBeenCalled();
    });

    it('does not look for duplicates when the patient has no identification', async () => {
      await create({});

      expect(tx.patient.findFirst).not.toHaveBeenCalled();
      expect(tx.patient.create.mock.calls[0][0].data).toMatchObject({
        identificationType: null,
        identificationNumber: null,
      });
    });

    it('requires a legal guardian for a minor', async () => {
      await expect(create({ dateOfBirth: '2015-05-01' })).rejects.toMatchObject({
        status: 422,
        response: { code: 'PATIENT_GUARDIAN_REQUIRED' },
      });
      expect(tx.patient.create).not.toHaveBeenCalled();

      await create({ dateOfBirth: '2015-05-01', guardianName: 'María Pérez' });
      expect(tx.patient.create.mock.calls[0][0].data.guardianName).toBe('María Pérez');
    });
  });

  describe('update', () => {
    it('ignores the patient itself when checking that the identification is free', async () => {
      tx.patient.findFirst.mockResolvedValueOnce(stored).mockResolvedValueOnce(null);

      await update({ identificationNumber: '1798765432' });

      expect(tx.patient.findFirst.mock.calls[1][0].where).toEqual({
        tenantId: 'tenant-1',
        identificationType: 'CEDULA',
        identificationNumber: '1798765432',
        deletedAt: null,
        id: { not: 'patient-1' },
      });
      expect(tx.patient.update.mock.calls[0][0].data).toMatchObject({
        identificationType: 'CEDULA',
        identificationNumber: '1798765432',
      });
    });

    it('answers 409 when the new identification belongs to another patient', async () => {
      tx.patient.findFirst.mockResolvedValueOnce(stored).mockResolvedValueOnce({ id: 'other' });

      await expect(update({ identificationNumber: '1798765432' })).rejects.toMatchObject({
        status: 409,
      });
      expect(tx.patient.update).not.toHaveBeenCalled();
    });

    it('leaves the identification untouched when the request does not mention it', async () => {
      tx.patient.findFirst.mockResolvedValue(stored);

      await update({ occupation: 'Estudiante' });

      const { data } = tx.patient.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('identificationType');
      expect(data).not.toHaveProperty('identificationNumber');
      expect(tx.patient.findFirst).toHaveBeenCalledTimes(1);
    });

    it('lets a minor registered without a guardian have other fields edited', async () => {
      tx.patient.findFirst.mockResolvedValue(stored);

      await expect(update({ phone: '0991234567' })).resolves.toBeDefined();
    });

    it('requires the guardian once the request touches the birth date or the guardian', async () => {
      tx.patient.findFirst.mockResolvedValue(stored);

      await expect(update({ dateOfBirth: '2016-01-01' })).rejects.toMatchObject({
        status: 422,
        response: { code: 'PATIENT_GUARDIAN_REQUIRED' },
      });
      await expect(update({ guardianName: '' })).rejects.toMatchObject({ status: 422 });
      await expect(update({ guardianName: 'María Pérez' })).resolves.toBeDefined();
      await expect(update({ dateOfBirth: '1990-01-01' })).resolves.toBeDefined();
    });
  });

  it('searches by name, e-mail, phone and normalized identification', async () => {
    prisma.patient.findMany.mockResolvedValue([]);

    await service.findAll('tenant-1', '171234567-8');

    expect(prisma.patient.findMany.mock.calls[0][0].where.OR).toEqual([
      { firstName: { contains: '171234567-8', mode: 'insensitive' } },
      { lastName: { contains: '171234567-8', mode: 'insensitive' } },
      { email: { contains: '171234567-8', mode: 'insensitive' } },
      { phone: { contains: '171234567-8' } },
      { identificationNumber: { contains: '1712345678' } },
    ]);
  });
});
