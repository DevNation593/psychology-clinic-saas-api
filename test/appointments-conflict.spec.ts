import { AppointmentsService } from '../src/appointments/appointments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProfessionalEligibilityService } from '../src/patient-team/professional-eligibility.service';
import { PatientTeamService } from '../src/patient-team/patient-team.service';

describe('Appointments conflict and scheduling regressions', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');
  const startTime = '2026-09-29T13:00:00.000Z';
  const actor = { tenantId: 'tenant-1', userId: 'admin-1', role: 'ADMIN' };
  const input = {
    patientId: 'patient-1',
    professionalId: 'professional-1',
    specialtyId: 'nutrition',
    startTime,
    duration: 60,
  };
  const db = {
    patient: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    tenantSettings: { findUnique: jest.fn() },
    appointment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = { ...db, $transaction: jest.fn(), applyRlsContext: jest.fn() };
  const eligibility = { resolve: jest.fn() };
  const team = { ensureActive: jest.fn() };
  let service: AppointmentsService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
    db.patient.findFirst.mockResolvedValue({ id: 'patient-1', tenantId: 'tenant-1' });
    db.user.findFirst.mockResolvedValue({
      id: 'professional-1',
      tenantId: 'tenant-1',
      role: 'PROFESIONAL',
      isActive: true,
    });
    db.tenantSettings.findUnique.mockResolvedValue({
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
      workingHoursStart: '00:00',
      workingHoursEnd: '23:59',
    });
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue({
      id: 'appointment-1',
      ...input,
      tenantId: 'tenant-1',
      psychologistId: 'professional-1',
      startTime: new Date(startTime),
      endTime: new Date('2026-09-29T14:00:00.000Z'),
      status: 'SCHEDULED',
    });
    db.appointment.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
    db.appointment.update.mockImplementation(async ({ data }) => ({
      id: 'appointment-1',
      ...input,
      ...data,
    }));
    eligibility.resolve.mockResolvedValue({
      id: 'professional-1',
      professionalProfile: { specialtyId: 'nutrition' },
    });
    service = new (AppointmentsService as any)(
      prisma as unknown as PrismaService,
      eligibility as unknown as ProfessionalEligibilityService,
      team as unknown as PatientTeamService,
    );
  });
  afterEach(() => jest.useRealTimers());

  const create = (overrides: Record<string, unknown> = {}) =>
    (service as any).create('tenant-1', { ...input, ...overrides }, actor);

  it('creates when no overlap exists and uses canonical plus legacy conflict branches', async () => {
    await expect(create()).resolves.toMatchObject({ id: 'new' });
    const where = db.appointment.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 'tenant-1', status: { not: 'CANCELLED' } });
    expect(where.AND).toEqual([
      {
        OR: [
          { professionalId: 'professional-1' },
          { professionalId: null, psychologistId: 'professional-1' },
        ],
      },
      {
        OR: [
          { startTime: { lte: new Date(startTime) }, endTime: { gt: new Date(startTime) } },
          {
            startTime: { lt: new Date('2026-09-29T14:00:00.000Z') },
            endTime: { gte: new Date('2026-09-29T14:00:00.000Z') },
          },
          {
            startTime: { gte: new Date(startTime) },
            endTime: { lte: new Date('2026-09-29T14:00:00.000Z') },
          },
        ],
      },
    ]);
  });

  it('returns stable code, temporary error alias and safe conflict details on overlap', async () => {
    db.appointment.findMany.mockResolvedValue([
      {
        id: 'existing',
        startTime: new Date(startTime),
        endTime: new Date('2026-09-29T14:00:00.000Z'),
        patient: { firstName: 'Pat', lastName: 'Smith' },
        clinicalNotes: [{ content: 'secret' }],
      },
    ]);
    await expect(create()).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        code: 'APPOINTMENT_CONFLICT',
        error: 'APPOINTMENT_CONFLICT',
        details: { conflicts: [{ id: 'existing', patient: 'Pat Smith' }] },
      },
    });
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it('allows back-to-back appointments', async () => {
    db.appointment.findMany.mockResolvedValue([]);
    await expect(create()).resolves.toMatchObject({ id: 'new' });
  });

  it('keeps tenant working-day and working-hour restrictions', async () => {
    db.tenantSettings.findUnique.mockResolvedValue({
      workingDays: ['MONDAY'],
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00',
    });
    await expect(create()).rejects.toMatchObject({ status: 400 });
    expect(db.appointment.create).not.toHaveBeenCalled();
    db.tenantSettings.findUnique.mockResolvedValue({
      workingDays: ['TUESDAY'],
      workingHoursStart: '14:00',
      workingHoursEnd: '17:00',
    });
    await expect(create()).rejects.toMatchObject({ status: 400 });
  });

  it('excludes its own appointment when a time is updated', async () => {
    await (service as any).update(
      'tenant-1',
      'appointment-1',
      { startTime: '2026-09-29T14:00:00.000Z' },
      actor,
    );
    expect(db.appointment.findMany.mock.calls[0][0].where.id).toEqual({ not: 'appointment-1' });
  });
});
