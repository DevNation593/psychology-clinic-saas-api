import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PatientTeamService } from './patient-team.service';
import { ProfessionalEligibilityService } from './professional-eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { TeamActor, TeamDb } from './patient-team.types';

describe('PatientTeamService', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const original = new Date('2026-01-01T00:00:00Z');
  const actor: TeamActor = { tenantId: 'tenant-1', userId: 'actor', role: 'MASTER' };
  const specialty = { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición', isActive: true };
  const professional = (overrides = {}) => ({
    id: 'target',
    tenantId: 'tenant-1',
    firstName: 'Ana',
    lastName: 'López',
    isActive: true,
    professionalTitle: 'Legacy title',
    licenseNumber: 'legacy-license',
    professionalProfile: {
      isActive: true,
      specialtyId: 'nutrition',
      specialty,
      professionalTitle: 'Nutricionista',
      licenseNumber: 'license',
    },
    ...overrides,
  });
  const assignment = (overrides = {}) => ({
    id: 'assignment',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    professionalId: 'target',
    assignedAt: original,
    assignedById: 'original-actor',
    isActive: true,
    createdAt: original,
    updatedAt: original,
    assignedBy: { id: 'original-actor', firstName: 'Pat', lastName: 'Admin' },
    professional: professional(),
    ...overrides,
  });
  const db = {
    patient: { findFirst: jest.fn(), updateMany: jest.fn() },
    patientProfessional: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    appointment: { findMany: jest.fn() },
    tenantSpecialty: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const prisma = { ...db, $transaction: jest.fn(), applyRlsContext: jest.fn() };
  const eligibility = { resolve: jest.fn(), list: jest.fn() };
  const service = new PatientTeamService(
    prisma as unknown as PrismaService,
    eligibility as unknown as ProfessionalEligibilityService,
  );
  const teamDb = db as unknown as TeamDb;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
    db.patient.findFirst.mockResolvedValue({
      id: 'patient-1',
      tenantId: 'tenant-1',
      assignedPsychologistId: 'target',
    });
    db.patientProfessional.findUnique.mockResolvedValue(assignment());
    db.patientProfessional.findUniqueOrThrow.mockResolvedValue(assignment());
    db.patientProfessional.findFirst.mockResolvedValue(null);
    db.patientProfessional.findMany.mockResolvedValue([]);
    db.patientProfessional.update.mockResolvedValue(assignment({ isActive: false }));
    db.patientProfessional.updateMany.mockResolvedValue({ count: 2 });
    db.appointment.findMany.mockResolvedValue([]);
    db.tenantSpecialty.findMany.mockResolvedValue([{ specialtyId: 'nutrition' }]);
    eligibility.resolve.mockResolvedValue(professional());
    eligibility.list.mockResolvedValue([professional()]);
  });
  afterEach(() => jest.useRealTimers());

  const call = (method: string, who = actor) => {
    if (method === 'list') return service.list('tenant-1', 'patient-1', who);
    if (method === 'listEligible')
      return service.listEligible('tenant-1', 'patient-1', undefined, who);
    if (method === 'assign') return service.assign('tenant-1', 'patient-1', 'target', who);
    return service.remove('tenant-1', 'patient-1', 'target', who);
  };
  const forbidden = {
    status: 403,
    response: {
      statusCode: 403,
      code: 'TEAM_ASSIGNMENT_FORBIDDEN',
      message: 'No tienes permiso para modificar este equipo tratante.',
    },
  };

  it.each(['list', 'listEligible', 'assign', 'remove'])(
    '%s rejects actor scope before any database work',
    async (method) => {
      await expect(call(method, { ...actor, tenantId: 'tenant-2' })).rejects.toMatchObject({
        status: 403,
        response: { statusCode: 403, code: 'TENANT_SCOPE_VIOLATION' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(db.patient.findFirst).not.toHaveBeenCalled();
      expect(eligibility.resolve).not.toHaveBeenCalled();
    },
  );

  it.each(['list', 'listEligible', 'assign', 'remove'])(
    '%s hides a missing, deleted or cross-tenant patient',
    async (method) => {
      db.patient.findFirst.mockResolvedValue(null);
      await expect(call(method)).rejects.toMatchObject({
        status: 404,
        message: 'Paciente no encontrado',
      });
      expect(db.patient.findFirst).toHaveBeenCalledWith({
        where: { id: 'patient-1', tenantId: 'tenant-1', deletedAt: null },
        select: { id: true, tenantId: true, assignedPsychologistId: true },
      });
      expect(eligibility.resolve).not.toHaveBeenCalled();
      expect(db.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it.each(['list', 'listEligible', 'assign', 'remove'])(
    '%s rejects unsupported roles',
    async (method) => {
      await expect(call(method, { ...actor, role: 'SOPORTE' })).rejects.toMatchObject(forbidden);
      expect(eligibility.resolve).not.toHaveBeenCalled();
    },
  );

  it.each(['PROFESIONAL'])(
    'lets an unassigned %s read the team of a patient in their clinic',
    async (role) => {
      db.patientProfessional.findUnique.mockResolvedValue(null);
      db.patientProfessional.findMany.mockResolvedValue([assignment()]);
      db.tenantSpecialty.findMany.mockResolvedValue([{ specialtyId: 'nutrition' }]);

      const team = await call('list', { ...actor, role });

      expect(team).toEqual([expect.objectContaining({ professionalId: 'target', isActive: true })]);
      expect(db.patientProfessional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1', patientId: 'patient-1' } }),
      );
    },
  );

  it.each(['listEligible', 'assign'])(
    '%s rejects an unassigned professional before resolving eligibility',
    async (method) => {
      db.patientProfessional.findUnique.mockResolvedValue(null);
      await expect(call(method, { ...actor, role: 'PROFESIONAL' })).rejects.toMatchObject(
        forbidden,
      );
      expect(eligibility.resolve).not.toHaveBeenCalled();
      expect(eligibility.list).not.toHaveBeenCalled();
      expect(db.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['inactive', { isActive: false }],
    ['cross-tenant', { tenantId: 'tenant-2' }],
  ])('rejects %s actor membership', async (_label, overrides) => {
    db.patientProfessional.findUnique.mockResolvedValue(assignment(overrides));
    await expect(call('assign', { ...actor, role: 'PROFESIONAL' })).rejects.toMatchObject(
      forbidden,
    );
    expect(eligibility.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ['clinical capacity', new ForbiddenException({ code: 'PROFESSIONAL_NOT_AUTHORIZED' })],
    ['specialty', new ConflictException({ code: 'SPECIALTY_NOT_ENABLED' })],
    ['account', new NotFoundException('Profesional no encontrado')],
  ])(
    'rejects assigned actor with unavailable %s using stable team error',
    async (_label, error) => {
      eligibility.resolve.mockRejectedValue(error);
      await expect(call('assign', { ...actor, role: 'PROFESIONAL' })).rejects.toMatchObject(
        forbidden,
      );
      expect(eligibility.resolve).toHaveBeenCalledTimes(1);
      expect(eligibility.resolve).toHaveBeenCalledWith(db, 'tenant-1', 'actor');
      expect(db.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it('does not turn infrastructure failures into permission errors', async () => {
    const failure = new Error('database disconnected');
    eligibility.resolve.mockRejectedValue(failure);
    await expect(call('assign', { ...actor, role: 'PROFESIONAL' })).rejects.toBe(failure);
  });

  it.each(['MASTER', 'ASISTENTE', 'PROFESIONAL'])(
    'allows authorized %s assignment with serializable RLS transaction',
    async (role) => {
      await call('assign', { ...actor, role });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(prisma.applyRlsContext).toHaveBeenCalledWith(db, {
        tenantId: 'tenant-1',
        userId: 'actor',
      });
      expect(eligibility.resolve).toHaveBeenLastCalledWith(db, 'tenant-1', 'target');
      expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['PROFESIONAL'])('forbids %s removal before target checks', async (role) => {
    await expect(call('remove', { ...actor, role })).rejects.toMatchObject(forbidden);
    expect(db.appointment.findMany).not.toHaveBeenCalled();
    expect(eligibility.resolve).not.toHaveBeenCalled();
  });

  it('uses one parameterized conditional conflict statement and restores only a null legacy pointer', async () => {
    await call('assign');
    const [parts, ...values] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = parts.join('?').replace(/\s+/g, ' ');
    expect(sql).toContain('INSERT INTO "PatientProfessional"');
    expect(sql).toContain('ON CONFLICT ("patientId", "professionalId") DO UPDATE');
    expect(sql).toContain('"assignedAt" = EXCLUDED."assignedAt"');
    expect(sql).toContain('"assignedById" = EXCLUDED."assignedById"');
    expect(sql).toContain('WHERE "PatientProfessional"."isActive" = FALSE');
    expect(values).toEqual([
      expect.any(String),
      'tenant-1',
      'patient-1',
      'target',
      now,
      'actor',
      now,
      now,
    ]);
    expect(db.patientProfessional.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { patientId_professionalId: { patientId: 'patient-1', professionalId: 'target' } },
      include: expect.objectContaining({
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        professional: expect.objectContaining({ select: expect.any(Object) }),
      }),
    });
    expect(db.patient.updateMany).toHaveBeenCalledWith({
      where: { id: 'patient-1', tenantId: 'tenant-1', assignedPsychologistId: null },
      data: { assignedPsychologistId: 'target' },
    });
    expect(db.patientProfessional.update).not.toHaveBeenCalled();
  });

  it('preserves active assignment provenance and exposes a safe flat response', async () => {
    await expect(call('assign')).resolves.toEqual({
      id: 'assignment',
      patientId: 'patient-1',
      professionalId: 'target',
      assignedAt: original,
      assignedBy: { id: 'original-actor', firstName: 'Pat', lastName: 'Admin' },
      isActive: true,
      professional: {
        id: 'target',
        firstName: 'Ana',
        lastName: 'López',
        professionalTitle: 'Nutricionista',
        licenseNumber: 'license',
        specialty: { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición' },
      },
    });
  });

  it('returns reactivated assignment with renewed provenance from the conflict statement', async () => {
    db.patientProfessional.findUniqueOrThrow.mockResolvedValue(
      assignment({
        assignedAt: now,
        assignedById: 'actor',
        assignedBy: { id: 'actor', firstName: 'New', lastName: 'Admin' },
      }),
    );
    await expect(call('assign')).resolves.toMatchObject({
      assignedAt: now,
      assignedBy: { id: 'actor' },
      isActive: true,
    });
  });

  it('does not catch a uniqueness error inside the transaction', async () => {
    const error = { code: 'P2002' };
    db.$executeRaw.mockRejectedValue(error);
    await expect(call('assign')).rejects.toBe(error);
    expect(db.patientProfessional.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('retries serialization failures with eligibility checks inside the retried transaction', async () => {
    db.$executeRaw.mockRejectedValueOnce({ code: 'P2034' }).mockResolvedValueOnce(1);
    await call('assign');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(eligibility.resolve).toHaveBeenCalledTimes(2);
  });

  it('ensureActive reuses the supplied transaction and returns the canonical row', async () => {
    await expect(
      service.ensureActive(teamDb as Prisma.TransactionClient, {
        tenantId: 'tenant-1',
        patientId: 'patient-1',
        professionalId: 'target',
        assignedById: 'actor',
      }),
    ).resolves.toMatchObject({ assignedById: 'original-actor', tenantId: 'tenant-1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(eligibility.resolve).toHaveBeenCalledWith(db, 'tenant-1', 'target');
  });

  it('propagates target eligibility errors before any writes', async () => {
    const error = new ForbiddenException({ code: 'PROFESSIONAL_NOT_AUTHORIZED' });
    eligibility.resolve.mockRejectedValue(error);
    await expect(call('assign')).rejects.toBe(error);
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.patient.updateMany).not.toHaveBeenCalled();
  });

  it('lists history safely and sorts effective activity, specialty, surname and first name with null specialty last', async () => {
    db.patientProfessional.findMany.mockResolvedValue([
      assignment({
        id: 'deleted',
        isActive: false,
        professional: professional({ professionalProfile: null }),
      }),
      assignment({
        id: 'inactive-profile',
        professional: professional({
          professionalProfile: { ...professional().professionalProfile, isActive: false },
        }),
      }),
      assignment({ id: 'z' }),
      assignment({ id: 'a', professional: professional({ lastName: 'Alba' }) }),
      assignment({ id: 'b', professional: professional({ lastName: 'Alba', firstName: 'Bea' }) }),
    ]);
    const result = await service.list('tenant-1', 'patient-1', actor);
    expect(result.map((row) => row.id)).toEqual(['a', 'b', 'z', 'inactive-profile', 'deleted']);
    expect(result[3].isActive).toBe(false);
    expect(result[4]).toMatchObject({
      isActive: false,
      professional: {
        specialty: null,
        professionalTitle: 'Legacy title',
        licenseNumber: 'legacy-license',
      },
    });
    expect(db.patientProfessional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1', patientId: 'patient-1' } }),
    );
  });

  it.each([
    ['missing profile', { professionalProfile: null }],
    ['inactive account', { isActive: false }],
    [
      'inactive catalog',
      {
        professionalProfile: {
          ...professional().professionalProfile,
          specialty: { ...specialty, isActive: false },
        },
      },
    ],
  ])('never exposes an active row with %s as active', async (_label, overrides) => {
    db.patientProfessional.findMany.mockResolvedValue([
      assignment({ professional: professional(overrides) }),
    ]);
    await expect(service.list('tenant-1', 'patient-1', actor)).resolves.toEqual([
      expect.objectContaining({ isActive: false }),
    ]);
  });

  it('does not expose a disabled tenant specialty as an active assignment', async () => {
    db.tenantSpecialty.findMany.mockResolvedValue([]);
    db.patientProfessional.findMany.mockResolvedValue([assignment()]);
    await expect(service.list('tenant-1', 'patient-1', actor)).resolves.toEqual([
      expect.objectContaining({ isActive: false }),
    ]);
    expect(db.tenantSpecialty.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      select: { specialtyId: true },
    });
  });

  it('lists eligible flat candidates with canonical assignment state and requested specialty', async () => {
    eligibility.list.mockResolvedValue([
      professional(),
      professional({ id: 'new-admin', role: 'MASTER' }),
    ]);
    db.patientProfessional.findMany.mockResolvedValue([assignment()]);
    const result = await service.listEligible('tenant-1', 'patient-1', 'nutrition', actor);
    expect(eligibility.list).toHaveBeenCalledWith(prisma, 'tenant-1', 'nutrition');
    expect(result).toEqual([
      {
        id: 'target',
        firstName: 'Ana',
        lastName: 'López',
        professionalTitle: 'Nutricionista',
        licenseNumber: 'license',
        specialty: { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición' },
        isAssigned: true,
      },
      {
        id: 'new-admin',
        firstName: 'Ana',
        lastName: 'López',
        professionalTitle: 'Nutricionista',
        licenseNumber: 'license',
        specialty: { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición' },
        isAssigned: false,
      },
    ]);
  });

  it('does not label inactive historical membership assigned for an eligible candidate', async () => {
    db.patientProfessional.findMany.mockResolvedValue([assignment({ isActive: false })]);
    await expect(service.listEligible('tenant-1', 'patient-1', undefined, actor)).resolves.toEqual([
      expect.objectContaining({ isAssigned: false }),
    ]);
  });

  const appointment = {
    id: 'appointment',
    patientId: 'patient-1',
    startTime: new Date('2026-10-01'),
    status: 'SCHEDULED',
    title: 'Consulta',
    specialty: { id: 'nutrition', code: 'NUTRITION', name: 'Nutrición' },
  };

  it.each([true, false])(
    'blocks removal of active=%s assignment with safe future appointment details',
    async (isActive) => {
      db.patientProfessional.findUnique.mockResolvedValue(assignment({ isActive }));
      db.appointment.findMany.mockResolvedValue([appointment]);
      await expect(call('remove')).rejects.toMatchObject({
        status: 409,
        response: {
          statusCode: 409,
          code: 'PROFESSIONAL_HAS_FUTURE_APPOINTMENTS',
          details: { appointments: [appointment] },
        },
      });
      expect(db.appointment.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          patientId: 'patient-1',
          startTime: { gt: now },
          status: { not: 'CANCELLED' },
          OR: [{ professionalId: 'target' }, { professionalId: null, psychologistId: 'target' }],
        },
        select: {
          id: true,
          patientId: true,
          startTime: true,
          status: true,
          title: true,
          specialty: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      });
      expect(db.patientProfessional.update).not.toHaveBeenCalled();
      expect(db.patient.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each(['MASTER', 'ASISTENTE'])(
    'allows %s removal after appointments were cancelled or reassigned',
    async (role) => {
      await expect(call('remove', { ...actor, role })).resolves.toMatchObject({ isActive: false });
      expect(db.patientProfessional.update).toHaveBeenCalledWith({
        where: { id: 'assignment', tenantId: 'tenant-1' },
        data: { isActive: false },
        include: expect.any(Object),
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    },
  );

  it.each([true, false])(
    'repairs the legacy pointer deterministically when removed assignment active=%s',
    async (isActive) => {
      db.patientProfessional.findUnique.mockResolvedValue(assignment({ isActive }));
      db.patientProfessional.findFirst.mockResolvedValue({ professionalId: 'oldest' });
      await expect(call('remove')).resolves.toMatchObject({
        isActive: false,
        assignedAt: original,
        assignedBy: { id: 'original-actor' },
      });
      expect(db.patientProfessional.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          patientId: 'patient-1',
          isActive: true,
          professionalId: { not: 'target' },
        },
        orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
        select: { professionalId: true },
      });
      expect(db.patient.updateMany).toHaveBeenCalledWith({
        where: { id: 'patient-1', tenantId: 'tenant-1', assignedPsychologistId: 'target' },
        data: { assignedPsychologistId: 'oldest' },
      });
      if (!isActive) expect(db.patientProfessional.update).not.toHaveBeenCalled();
    },
  );

  it('clears the legacy pointer when no active assignment remains', async () => {
    await call('remove');
    expect(db.patient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedPsychologistId: null } }),
    );
  });

  it('does not alter an unrelated non-null legacy pointer', async () => {
    db.patient.findFirst.mockResolvedValue({
      id: 'patient-1',
      tenantId: 'tenant-1',
      assignedPsychologistId: 'someone-else',
    });
    await call('remove');
    expect(db.patient.updateMany).not.toHaveBeenCalled();
    expect(db.patientProfessional.findFirst).not.toHaveBeenCalled();
  });

  it.each([null, assignment({ tenantId: 'tenant-2' })])(
    'hides missing or cross-tenant assignments on removal',
    async (row) => {
      db.patientProfessional.findUnique.mockResolvedValue(row);
      await expect(call('remove')).rejects.toMatchObject({ status: 404 });
      expect(db.appointment.findMany).not.toHaveBeenCalled();
    },
  );

  it('checks active membership and current profile with the transaction client', async () => {
    await expect(
      service.assertActiveMembership(teamDb, 'tenant-1', 'patient-1', 'actor'),
    ).resolves.toBeUndefined();
    expect(db.patientProfessional.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId_professionalId: { patientId: 'patient-1', professionalId: 'actor' } },
      }),
    );
    expect(eligibility.resolve).toHaveBeenCalledWith(db, 'tenant-1', 'actor');
  });

  it('provides tenant-wide future appointment protection for lifecycle consumers', async () => {
    db.appointment.findMany.mockResolvedValue([appointment]);
    await expect(
      service.assertNoFutureAppointmentsForProfessional(teamDb, 'tenant-1', 'target'),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'PROFESSIONAL_HAS_FUTURE_APPOINTMENTS',
        details: { appointments: [appointment] },
      },
    });
    expect(db.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          startTime: { gt: now },
          status: { not: 'CANCELLED' },
          OR: [{ professionalId: 'target' }, { professionalId: null, psychologistId: 'target' }],
        },
      }),
    );
  });

  it('deactivates only active assignments in the scoped transaction and returns their count', async () => {
    await expect(service.deactivateAllForProfessional(teamDb, 'tenant-1', 'target')).resolves.toBe(
      2,
    );
    expect(db.patientProfessional.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', professionalId: 'target', isActive: true },
      data: { isActive: false },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
