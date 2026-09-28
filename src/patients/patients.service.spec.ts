import { Prisma } from '@prisma/client';
import { PatientTeamService } from '../patient-team/patient-team.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto } from './dto/patient.dto';
import { PatientsService } from './patients.service';

describe('PatientsService legacy assignment compatibility', () => {
  const patient = {
    id: 'patient-1',
    tenantId: 'tenant-1',
    firstName: 'Ana',
    lastName: 'Paz',
    assignedPsychologistId: 'professional-1',
  };
  const subscription = {
    tenantId: 'tenant-1',
    status: 'ACTIVE',
    activePatientsCount: 0,
    maxActivePatients: 10,
    planType: 'PRO',
  };
  const tx = {
    patient: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    tenantSubscription: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    patientProfessional: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    applyRlsContext: jest.fn(),
  };
  const team = { ensureActive: jest.fn(), remove: jest.fn() };
  const service = new PatientsService(
    prisma as unknown as PrismaService,
    team as unknown as PatientTeamService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    tx.patient.create.mockResolvedValue(patient);
    tx.patient.findFirst.mockResolvedValue(patient);
    tx.patient.update.mockResolvedValue(patient);
    tx.tenantSubscription.findUnique.mockResolvedValue(subscription);
    tx.tenantSubscription.updateMany.mockResolvedValue({ count: 1 });
  });

  const createInput = (overrides: Partial<CreatePatientDto> = {}): CreatePatientDto => ({
    firstName: 'Ana',
    lastName: 'Paz',
    ...overrides,
  });

  it('creates the same patient and activates its legacy assignee in one serializable transaction', async () => {
    const result = await service.create(
      'tenant-1',
      createInput({ assignedPsychologistId: 'professional-1' }),
      'admin-1',
      'ADMIN',
    );

    expect(result).toBe(patient);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.applyRlsContext).toHaveBeenCalledWith(tx, {
      tenantId: 'tenant-1',
      userId: 'admin-1',
      role: 'ADMIN',
    });
    expect(tx.patient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        assignedPsychologistId: 'professional-1',
      }),
    });
    expect(team.ensureActive).toHaveBeenCalledWith(tx, {
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      professionalId: 'professional-1',
      assignedById: 'admin-1',
    });
    expect(team.remove).not.toHaveBeenCalled();
  });

  it('keeps an unassigned create free of team writes', async () => {
    await service.create('tenant-1', createInput(), 'admin-1', 'ADMIN');
    expect(team.ensureActive).not.toHaveBeenCalled();
  });

  it('clears only the legacy pointer when update explicitly supplies null', async () => {
    await service.update(
      'tenant-1',
      'patient-1',
      { assignedPsychologistId: null },
      'assistant-1',
      'ASISTENTE',
    );

    expect(tx.patient.update).toHaveBeenCalledWith({
      where: { id: 'patient-1' },
      data: expect.objectContaining({ assignedPsychologistId: null }),
    });
    expect(team.ensureActive).not.toHaveBeenCalled();
    expect(team.remove).not.toHaveBeenCalled();
    expect(tx.patientProfessional.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the pointer and team untouched when update omits the legacy field', async () => {
    await service.update('tenant-1', 'patient-1', { firstName: 'Anita' }, 'admin-1', 'ADMIN');

    const data = tx.patient.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ firstName: 'Anita' }));
    expect(data).not.toHaveProperty('assignedPsychologistId');
    expect(team.ensureActive).not.toHaveBeenCalled();
    expect(team.remove).not.toHaveBeenCalled();
    expect(tx.patientProfessional.updateMany).not.toHaveBeenCalled();
  });

  it('updates the legacy pointer and reactivates only the selected team member', async () => {
    const result = await service.update(
      'tenant-1',
      'patient-1',
      { assignedPsychologistId: 'professional-2' },
      'professional-1',
      'PROFESIONAL',
    );

    expect(result).toBe(patient);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.applyRlsContext).toHaveBeenCalledWith(tx, {
      tenantId: 'tenant-1',
      userId: 'professional-1',
      role: 'PROFESIONAL',
    });
    expect(tx.patient.findFirst).toHaveBeenCalledWith({
      where: { id: 'patient-1', tenantId: 'tenant-1', deletedAt: null },
    });
    expect(tx.patient.update).toHaveBeenCalledWith({
      where: { id: 'patient-1' },
      data: expect.objectContaining({ assignedPsychologistId: 'professional-2' }),
    });
    expect(team.ensureActive).toHaveBeenCalledWith(tx, {
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      professionalId: 'professional-2',
      assignedById: 'professional-1',
    });
    expect(team.remove).not.toHaveBeenCalled();
    expect(tx.patientProfessional.updateMany).not.toHaveBeenCalled();
  });
});
