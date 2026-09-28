import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { PatientTeamService } from '../patient-team/patient-team.service';
import { ProfessionalEligibilityService } from '../patient-team/professional-eligibility.service';
import { TeamActor } from '../patient-team/patient-team.types';
import { AppointmentsController } from './appointments.controller';
import { CreateAppointmentDto, ListAppointmentsQueryDto } from './dto/appointment.dto';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService canonical appointments', () => {
  const tenantId = 'tenant-1';
  const now = new Date('2026-09-28T12:00:00.000Z');
  const startTime = '2026-09-29T13:00:00.000Z';
  const admin: TeamActor = { tenantId, userId: 'admin-1', role: 'ADMIN' };
  const assistant: TeamActor = { tenantId, userId: 'assistant-1', role: 'ASISTENTE' };
  const clinician: TeamActor = { tenantId, userId: 'professional-1', role: 'PROFESIONAL' };
  const specialty = { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición', isActive: true };
  const professional = (id = 'professional-1', specialtyId = 'nutrition') => ({
    id,
    tenantId,
    firstName: 'Ana',
    lastName: 'López',
    email: 'ana@example.test',
    role: 'PROFESIONAL',
    isActive: true,
    professionalProfile: {
      isActive: true,
      specialtyId,
      specialty: { ...specialty, id: specialtyId },
      professionalTitle: 'Nutricionista',
      licenseNumber: '123',
    },
  });
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'appointment-1',
    tenantId,
    patientId: 'patient-1',
    professionalId: 'professional-1',
    psychologistId: 'professional-1',
    specialtyId: 'nutrition',
    startTime: new Date(startTime),
    endTime: new Date('2026-09-29T14:00:00.000Z'),
    duration: 60,
    status: 'SCHEDULED',
    title: 'Consulta',
    description: null,
    patient: { id: 'patient-1', firstName: 'Pat', lastName: 'Smith' },
    professional: professional(),
    psychologist: professional(),
    specialty,
    ...overrides,
  });
  const createInput = (overrides: Record<string, unknown> = {}) => ({
    patientId: 'patient-1',
    professionalId: 'professional-1',
    specialtyId: 'nutrition',
    startTime,
    duration: 60,
    ...overrides,
  });
  const db = {
    patient: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    patientProfessional: { findUnique: jest.fn() },
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
  const team = { assertActiveMembership: jest.fn(), ensureActive: jest.fn(), remove: jest.fn() };
  let service: AppointmentsService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
    db.patient.findFirst.mockResolvedValue({ id: 'patient-1', tenantId, deletedAt: null });
    db.user.findFirst.mockResolvedValue(professional());
    db.patientProfessional.findUnique.mockResolvedValue({ tenantId, isActive: true });
    db.tenantSettings.findUnique.mockResolvedValue({
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
      workingHoursStart: '00:00',
      workingHoursEnd: '23:59',
    });
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue(row());
    db.appointment.create.mockImplementation(async ({ data }) => row(data));
    db.appointment.update.mockImplementation(async ({ data }) => row(data));
    eligibility.resolve.mockImplementation(async (_db, _tenant, id) => professional(id));
    team.ensureActive.mockResolvedValue({ id: 'assignment-1' });
    service = new (AppointmentsService as any)(
      prisma as unknown as PrismaService,
      eligibility as unknown as ProfessionalEligibilityService,
      team as unknown as PatientTeamService,
    );
  });
  afterEach(() => jest.useRealTimers());

  const create = (input: Record<string, unknown>, actor: TeamActor = admin) =>
    (service as any).create(tenantId, input, actor);
  const update = (input: Record<string, unknown>, actor: TeamActor = admin) =>
    (service as any).update(tenantId, 'appointment-1', input, actor);
  const list = (filters: Record<string, unknown> = {}, actor: TeamActor = admin) =>
    (service as any).findAll(tenantId, filters, actor);
  const get = (actor: TeamActor = admin) =>
    (service as any).findOne(tenantId, 'appointment-1', actor);
  const cancel = (actor: TeamActor = admin) =>
    (service as any).cancel(tenantId, 'appointment-1', 'Patient request', actor);

  it('accepts canonical and legacy DTO fields and rejects noninteger duration', () => {
    expect(validateSync(plainToInstance(CreateAppointmentDto, createInput()))).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(
          CreateAppointmentDto,
          createInput({
            professionalId: undefined,
            psychologistId: 'professional-1',
            specialtyId: undefined,
          }),
        ),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(plainToInstance(CreateAppointmentDto, createInput({ duration: 60.5 }))),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(ListAppointmentsQueryDto, {
          professionalId: 'professional-1',
          specialtyId: 'nutrition',
        }),
      ),
    ).toHaveLength(0);
  });

  it.each(['create', 'list', 'get', 'update', 'cancel'])(
    '%s rejects another tenant before database work',
    async (method) => {
      const other = { ...admin, tenantId: 'tenant-2' };
      const action = {
        create: () => create(createInput(), other),
        list: () => list({}, other),
        get: () => get(other),
        update: () => update({ title: 'New' }, other),
        cancel: () => cancel(other),
      }[method];
      await expect(action!()).rejects.toMatchObject({
        status: 403,
        response: { code: 'TENANT_SCOPE_VIOLATION' },
      });
      expect(db.patient.findFirst).not.toHaveBeenCalled();
      expect(db.appointment.findFirst).not.toHaveBeenCalled();
      expect(db.appointment.findMany).not.toHaveBeenCalled();
    },
  );

  it('writes matching canonical and legacy IDs and team assignment in the same transaction', async () => {
    const result = await create(createInput(), assistant);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(db.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'patient-1', tenantId, deletedAt: null },
      }),
    );
    expect(eligibility.resolve).toHaveBeenCalledWith(db, tenantId, 'professional-1', 'nutrition');
    expect(team.ensureActive).toHaveBeenCalledWith(db, {
      tenantId,
      patientId: 'patient-1',
      professionalId: 'professional-1',
      assignedById: 'assistant-1',
    });
    expect(db.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          professionalId: 'professional-1',
          psychologistId: 'professional-1',
          specialtyId: 'nutrition',
        }),
      }),
    );
    expect(result).toMatchObject({
      professionalId: 'professional-1',
      psychologistId: 'professional-1',
    });
    expect(result.professional).toEqual(result.psychologist);
  });

  it('derives specialty only from a legacy-only professional reference', async () => {
    await create(
      createInput({
        professionalId: undefined,
        psychologistId: 'professional-1',
        specialtyId: undefined,
      }),
    );
    expect(db.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          professionalId: 'professional-1',
          psychologistId: 'professional-1',
          specialtyId: 'nutrition',
        }),
      }),
    );
  });

  it('resolves professional eligibility before reporting a missing canonical specialty', async () => {
    await expect(create(createInput({ specialtyId: undefined }))).rejects.toMatchObject({
      status: 422,
      response: { code: 'SPECIALTY_REQUIRED' },
    });
    expect(eligibility.resolve).toHaveBeenCalledWith(db, tenantId, 'professional-1', undefined);
  });

  it.each([
    [
      createInput({ professionalId: 'one', psychologistId: 'two' }),
      400,
      'PROFESSIONAL_REFERENCE_MISMATCH',
    ],
    [createInput({ professionalId: undefined }), 422, 'PROFESSIONAL_REQUIRED'],
    [createInput({ specialtyId: undefined }), 422, 'SPECIALTY_REQUIRED'],
  ])('rejects invalid professional/specialty reference %#', async (input, status, code) => {
    await expect(create(input)).rejects.toMatchObject({ status, response: { code } });
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it('rejects a deleted or foreign-tenant patient without writing', async () => {
    db.patient.findFirst.mockResolvedValue(null);
    await expect(create(createInput())).rejects.toMatchObject({ status: 404 });
    expect(team.ensureActive).not.toHaveBeenCalled();
  });

  it('rechecks the existing patient tenant and deletion state before an update', async () => {
    db.patient.findFirst.mockResolvedValue(null);
    await expect(update({ title: 'Changed' })).rejects.toMatchObject({ status: 404 });
    expect(db.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'patient-1', tenantId, deletedAt: null },
      }),
    );
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it.each([admin, assistant])(
    'administrative actors can reassign an eligible professional',
    async (actor) => {
      await update({ professionalId: 'professional-2', specialtyId: 'nutrition' }, actor);
      expect(team.ensureActive).toHaveBeenCalledWith(db, {
        tenantId,
        patientId: 'patient-1',
        professionalId: 'professional-2',
        assignedById: actor.userId,
      });
      expect(db.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            professionalId: 'professional-2',
            psychologistId: 'professional-2',
            specialtyId: 'nutrition',
          }),
        }),
      );
      expect(team.remove).not.toHaveBeenCalled();
    },
  );

  it('requires an explicit specialty for canonical reassignment', async () => {
    await expect(update({ professionalId: 'professional-2' })).rejects.toMatchObject({
      status: 422,
      response: { code: 'SPECIALTY_REQUIRED' },
    });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it('rejects a null specialty on canonical reassignment', async () => {
    await expect(
      update({ professionalId: 'professional-2', specialtyId: null }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'SPECIALTY_REQUIRED' },
    });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it('derives specialty for legacy-only reassignment', async () => {
    await update({ psychologistId: 'professional-2' });
    expect(db.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          professionalId: 'professional-2',
          psychologistId: 'professional-2',
          specialtyId: 'nutrition',
        }),
      }),
    );
  });

  it('rejects contradictory identifiers on reassignment before writing', async () => {
    await expect(
      update({
        professionalId: 'professional-2',
        psychologistId: 'professional-3',
        specialtyId: 'nutrition',
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'PROFESSIONAL_REFERENCE_MISMATCH' } });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it('preserves historical specialty for title-only edits with unchanged identifiers', async () => {
    db.appointment.findFirst.mockResolvedValue(row({ specialtyId: 'historic-specialty' }));
    db.appointment.update.mockImplementation(async ({ data }) =>
      row({ specialtyId: 'historic-specialty', ...data }),
    );
    const result = await update({
      title: 'Follow-up',
      professionalId: 'professional-1',
      specialtyId: 'historic-specialty',
    });
    expect(eligibility.resolve).not.toHaveBeenCalled();
    expect(result.specialtyId).toBe('historic-specialty');
    expect(db.appointment.update.mock.calls[0][0].data).not.toHaveProperty('specialtyId');
  });

  it('does not revalidate current profile for a description-only edit', async () => {
    db.appointment.findFirst.mockResolvedValue(row({ specialtyId: 'historic-specialty' }));
    await update({ description: 'New note' });
    expect(eligibility.resolve).not.toHaveBeenCalled();
    expect(team.ensureActive).not.toHaveBeenCalled();
    expect(db.appointment.update.mock.calls[0][0].data).toEqual({ description: 'New note' });
  });

  it('revalidates eligibility when the appointment interval changes', async () => {
    await update({ startTime: '2026-09-29T15:00:00.000Z' });
    expect(eligibility.resolve).toHaveBeenCalledWith(db, tenantId, 'professional-1', 'nutrition');
    expect(db.appointment.findMany).toHaveBeenCalledTimes(1);
  });

  it('propagates a specialty mismatch from authoritative eligibility', async () => {
    eligibility.resolve.mockRejectedValue({
      status: 422,
      response: { code: 'PROFESSIONAL_SPECIALTY_MISMATCH' },
    });
    await expect(create(createInput())).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROFESSIONAL_SPECIALTY_MISMATCH' },
    });
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it('requires active membership before a professional creates for self', async () => {
    await create(createInput(), clinician);
    expect(team.assertActiveMembership).toHaveBeenCalledWith(
      db,
      tenantId,
      'patient-1',
      'professional-1',
    );
    expect(team.ensureActive).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ assignedById: clinician.userId }),
    );
  });

  it('rejects a professional creating for another professional', async () => {
    await expect(
      create(createInput({ professionalId: 'professional-2' }), clinician),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it('rejects a professional without active membership before eligibility lookup', async () => {
    team.assertActiveMembership.mockRejectedValue({ status: 403 });
    await expect(create(createInput(), clinician)).rejects.toMatchObject({ status: 403 });
    expect(eligibility.resolve).not.toHaveBeenCalled();
  });

  it('allows a team member to read another professional appointment for that patient', async () => {
    db.appointment.findFirst.mockResolvedValue(
      row({ professionalId: 'professional-2', psychologistId: 'professional-2' }),
    );
    await expect(get(clinician)).resolves.toMatchObject({ id: 'appointment-1' });
    expect(team.assertActiveMembership).toHaveBeenCalledWith(
      prisma,
      tenantId,
      'patient-1',
      'professional-1',
    );
  });

  it('allows an owner to read without a team assignment', async () => {
    await expect(get(clinician)).resolves.toMatchObject({ id: 'appointment-1' });
    expect(team.assertActiveMembership).not.toHaveBeenCalled();
  });

  it('returns 403 for a professional not assigned to the patient', async () => {
    db.appointment.findFirst.mockResolvedValue(
      row({ professionalId: 'professional-2', psychologistId: 'professional-2' }),
    );
    team.assertActiveMembership.mockRejectedValue({ status: 403 });
    await expect(get(clinician)).rejects.toMatchObject({ status: 403 });
  });

  it('allows only the owner to update or cancel an appointment', async () => {
    db.appointment.findFirst.mockResolvedValue(
      row({ professionalId: 'professional-2', psychologistId: 'professional-2' }),
    );
    await expect(update({ title: 'Changed' }, clinician)).rejects.toMatchObject({ status: 403 });
    await expect(cancel(clinician)).rejects.toMatchObject({ status: 403 });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it.each([
    { patientId: 'patient-2' },
    { professionalId: 'professional-2', specialtyId: 'nutrition' },
    { specialtyId: 'psychology' },
  ])('rejects a professional changing patient, professional or specialty', async (change) => {
    await expect(update(change, clinician)).rejects.toMatchObject({ status: 403 });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it('requires active patient membership before a professional edits own appointment', async () => {
    team.assertActiveMembership.mockRejectedValue({ status: 403 });
    await expect(update({ title: 'Changed' }, clinician)).rejects.toMatchObject({ status: 403 });
  });

  it('composes actor and professional filters independently with legacy fallback', async () => {
    await list({ professionalId: 'professional-2', specialtyId: 'nutrition' }, clinician);
    const where = db.appointment.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId, specialtyId: 'nutrition' });
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { professionalId: 'professional-2' },
            { professionalId: null, psychologistId: 'professional-2' },
          ],
        },
        expect.objectContaining({
          OR: expect.arrayContaining([
            { professionalId: 'professional-1' },
            { professionalId: null, psychologistId: 'professional-1' },
          ]),
        }),
      ]),
    );
  });

  it('rejects contradictory professional filters', async () => {
    await expect(list({ professionalId: 'one', psychologistId: 'two' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'PROFESSIONAL_REFERENCE_MISMATCH' },
    });
  });

  it('applies a legacy-only professional filter to canonical and unmigrated rows', async () => {
    await list({ psychologistId: 'professional-2' });
    expect(db.appointment.findMany.mock.calls[0][0].where.AND).toContainEqual({
      OR: [
        { professionalId: 'professional-2' },
        { professionalId: null, psychologistId: 'professional-2' },
      ],
    });
  });

  it('returns normalized legacy appointment aliases and excludes clinical notes', async () => {
    db.appointment.findFirst.mockResolvedValue(row({ professionalId: null, professional: null }));
    const result = await get();
    expect(result.professionalId).toBe('professional-1');
    expect(result.psychologistId).toBe('professional-1');
    expect(result.professional).toEqual(result.psychologist);
    expect(db.appointment.findFirst.mock.calls[0][0].include).not.toHaveProperty('clinicalNotes');
  });

  it('normalizes list and cancellation responses', async () => {
    db.appointment.findMany.mockResolvedValue([row({ professionalId: null, professional: null })]);
    const items = await list();
    expect(items[0]).toMatchObject({
      professionalId: 'professional-1',
      psychologistId: 'professional-1',
    });
    db.appointment.update.mockResolvedValue(
      row({ professionalId: null, professional: null, status: 'CANCELLED' }),
    );
    const cancelled = await cancel(assistant);
    expect(cancelled).toMatchObject({
      professionalId: 'professional-1',
      psychologistId: 'professional-1',
      status: 'CANCELLED',
    });
    expect(db.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelledBy: 'assistant-1',
          cancellationReason: 'Patient request',
        }),
      }),
    );
  });

  it('rechecks team and conflict on each serialization retry', async () => {
    prisma.$transaction
      .mockImplementationOnce(async (callback) => {
        await callback(db);
        throw { code: 'P2034' };
      })
      .mockImplementationOnce((callback) => callback(db));
    await create(createInput());
    expect(db.patient.findFirst).toHaveBeenCalledTimes(2);
    expect(eligibility.resolve).toHaveBeenCalledTimes(2);
    expect(db.appointment.findMany).toHaveBeenCalledTimes(2);
    expect(team.ensureActive).toHaveBeenCalledTimes(2);
    expect(db.appointment.create).toHaveBeenCalledTimes(2);
  });

  it('keeps reminder records using the psychologist relation', async () => {
    db.appointment.findMany.mockResolvedValue([
      row({
        reminderSent24h: false,
        reminderSent2h: false,
        startTime: new Date('2026-09-29T12:00:00.000Z'),
      }),
    ]);
    const reminders = await service.findAppointmentsNeedingReminders([24]);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].appointment.psychologist).toMatchObject({ id: 'professional-1' });
    expect(db.appointment.findMany.mock.calls[0][0].include.psychologist).toBe(true);
  });
});

describe('AppointmentsController actor forwarding', () => {
  it('forwards the authenticated actor to every endpoint', async () => {
    const actor = {
      userId: 'assistant-1',
      tenantId: 'tenant-1',
      role: 'ASISTENTE',
      email: 'a@example.test',
    };
    const service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    };
    const controller = new AppointmentsController(service as unknown as AppointmentsService);
    await (controller as any).create('tenant-1', {} as any, actor);
    await (controller as any).findAll('tenant-1', {} as any, actor);
    await (controller as any).findOne('tenant-1', 'appointment-1', actor);
    await (controller as any).update('tenant-1', 'appointment-1', {} as any, actor);
    await (controller as any).cancel('tenant-1', 'appointment-1', { reason: 'x' }, actor);
    expect(service.create).toHaveBeenCalledWith('tenant-1', {}, actor);
    expect(service.findAll).toHaveBeenCalledWith('tenant-1', {}, actor);
    expect(service.findOne).toHaveBeenCalledWith('tenant-1', 'appointment-1', actor);
    expect(service.update).toHaveBeenCalledWith('tenant-1', 'appointment-1', {}, actor);
    expect(service.cancel).toHaveBeenCalledWith('tenant-1', 'appointment-1', 'x', actor);
  });
});
