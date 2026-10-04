import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = {
    appointment: { groupBy: jest.fn() },
    encounter: { groupBy: jest.fn() },
    branch: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const service = new ReportsService(prisma as unknown as PrismaService);
  const october = { from: '2026-10-01T05:00:00.000Z', to: '2026-11-01T05:00:00.000Z' };
  const appointment = (
    branchId: string | null,
    psychologistId: string,
    status: string,
    n: number,
  ) => ({
    branchId,
    psychologistId,
    status,
    _count: { _all: n },
  });
  const encounter = (branchId: string | null, professionalId: string, type: string, n: number) => ({
    branchId,
    professionalId,
    encounterType: type,
    _count: { _all: n },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.appointment.groupBy.mockResolvedValue([]);
    prisma.encounter.groupBy.mockResolvedValue([]);
    prisma.branch.findMany.mockResolvedValue([
      { id: 'main', name: 'Sede principal', isMain: true, isActive: true },
      { id: 'north', name: 'Sede Norte', isMain: false, isActive: true },
    ]);
    prisma.user.findMany.mockResolvedValue([]);
  });

  it('counts appointments and encounters by branch and by professional', async () => {
    prisma.appointment.groupBy.mockResolvedValue([
      appointment('main', 'ana', 'COMPLETED', 4),
      appointment('main', 'ana', 'CANCELLED', 1),
      appointment('north', 'luis', 'SCHEDULED', 2),
      appointment(null, 'ana', 'NO_SHOW', 1),
    ]);
    prisma.encounter.groupBy.mockResolvedValue([
      encounter('main', 'ana', 'FIRST_VISIT', 3),
      encounter('main', 'ana', 'CONTROL', 1),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'luis', firstName: 'Luis', lastName: 'Mora' },
      { id: 'ana', firstName: 'Ana', lastName: 'Ruiz' },
    ]);

    const report = await service.activity('tenant-1', october);

    expect(report.totals).toEqual({
      appointments: 8,
      completed: 4,
      cancelled: 1,
      noShow: 1,
      encounters: 4,
    });
    expect(report.appointmentsByStatus).toEqual({
      COMPLETED: 4,
      CANCELLED: 1,
      SCHEDULED: 2,
      NO_SHOW: 1,
    });
    expect(report.encountersByType).toEqual({ FIRST_VISIT: 3, CONTROL: 1 });
    expect(report.branches).toEqual([
      expect.objectContaining({ branchId: 'main', appointments: 5, completed: 4, encounters: 4 }),
      expect.objectContaining({ branchId: 'north', appointments: 2, encounters: 0 }),
      expect.objectContaining({ branchId: null, name: 'Sin sede', appointments: 1, noShow: 1 }),
    ]);
    // The busiest professional comes first.
    expect(report.professionals).toEqual([
      expect.objectContaining({
        professionalId: 'ana',
        name: 'Ana Ruiz',
        appointments: 6,
        encounters: 4,
      }),
      expect.objectContaining({ professionalId: 'luis', name: 'Luis Mora', appointments: 2 }),
    ]);
  });

  it('reads only the tenant, the period and, when asked, one branch', async () => {
    const report = await service.activity('tenant-1', { ...october, branchId: 'north' });

    const period = { gte: new Date(october.from), lt: new Date(october.to) };
    expect(prisma.appointment.groupBy.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      startTime: period,
      branchId: 'north',
    });
    expect(prisma.encounter.groupBy.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      deletedAt: null,
      startedAt: period,
      branchId: 'north',
    });
    // A branch without activity is still listed, with zeros; the others are left out.
    expect(report.branches).toEqual([
      expect.objectContaining({ branchId: 'north', appointments: 0, encounters: 0 }),
    ]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['dates that are not dates', { from: 'ayer', to: 'hoy' }],
    ['an end before the start', { from: october.to, to: october.from }],
    ['an empty period', { from: october.from, to: october.from }],
    ['more than a year', { from: '2025-01-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' }],
  ])('refuses %s', async (_label, query) => {
    await expect(service.activity('tenant-1', query)).rejects.toMatchObject({
      status: 400,
      response: { code: 'REPORT_RANGE_INVALID' },
    });
    expect(prisma.appointment.groupBy).not.toHaveBeenCalled();
  });
});
