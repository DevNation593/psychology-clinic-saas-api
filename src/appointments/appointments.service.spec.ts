import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService professional role compatibility', () => {
  const tenantId = 'tenant-1';
  const appointmentInput = {
    patientId: 'patient-1',
    psychologistId: 'professional-1',
    startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    duration: 60,
  };
  const prisma = {
    patient: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    tenantSettings: { findUnique: jest.fn() },
    appointment: { findMany: jest.fn(), create: jest.fn() },
  };
  let service: AppointmentsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.patient.findFirst.mockResolvedValue({ id: 'patient-1', tenantId });
    prisma.user.findFirst.mockImplementation(async ({ where }) => {
      const user = {
        id: 'professional-1',
        tenantId,
        role: 'PROFESIONAL',
        isActive: true,
      };
      const allowedRoles: string[] = where.role?.in ?? [where.role];
      return user.id === where.id &&
        user.tenantId === where.tenantId &&
        user.isActive === where.isActive &&
        allowedRoles.includes(user.role)
        ? user
        : null;
    });
    prisma.tenantSettings.findUnique.mockResolvedValue({
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
      workingHoursStart: '00:00',
      workingHoursEnd: '23:59',
    });
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.appointment.create.mockResolvedValue({ id: 'appointment-1' });
    service = new AppointmentsService(prisma as unknown as PrismaService);
  });

  it('accepts an active canonical PROFESIONAL in the same tenant', async () => {
    await expect(service.create(tenantId, appointmentInput)).resolves.toMatchObject({
      id: 'appointment-1',
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'professional-1',
        tenantId,
        role: { in: ['PSICOLOGO', 'PROFESIONAL'] },
        isActive: true,
      },
    });
  });

  it.each([
    ['another role', { role: 'ADMIN', tenantId, isActive: true }],
    ['another tenant', { role: 'PROFESIONAL', tenantId: 'tenant-2', isActive: true }],
    ['an inactive professional', { role: 'PROFESIONAL', tenantId, isActive: false }],
  ])('rejects %s', async (_description, candidate) => {
    prisma.user.findFirst.mockImplementation(async ({ where }) => {
      const allowedRoles: string[] = where.role?.in ?? [where.role];
      return candidate.tenantId === where.tenantId &&
        candidate.isActive === where.isActive &&
        allowedRoles.includes(candidate.role)
        ? { id: where.id }
        : null;
    });

    await expect(service.create(tenantId, appointmentInput)).rejects.toThrow(NotFoundException);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });
});
