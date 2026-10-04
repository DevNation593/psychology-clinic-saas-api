import { BadRequestException, Injectable } from '@nestjs/common';
import { AppointmentStatus, EncounterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A report covers at most a year, so that a typo in a date cannot read the whole history. */
export const MAX_REPORT_DAYS = 366;

export interface ActivityReportQuery {
  from: string;
  to: string;
  branchId?: string;
}

export interface ActivityCounts {
  /** Appointments that start in the period, whatever their status. */
  appointments: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Encounters started in the period, open or closed. */
  encounters: number;
}

const emptyCounts = (): ActivityCounts => ({
  appointments: 0,
  completed: 0,
  cancelled: 0,
  noShow: 0,
  encounters: 0,
});

const invalidRange = (message: string) =>
  new BadRequestException({ statusCode: 400, code: 'REPORT_RANGE_INVALID', message });

/**
 * Activity of the clinic by branch and by professional. It counts appointments and encounters
 * and reads nothing of their content, so it needs no clinical profile.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async activity(tenantId: string, query: ActivityReportQuery) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw invalidRange('Las fechas del reporte no son válidas.');
    }
    if (to <= from) throw invalidRange('La fecha final debe ser posterior a la inicial.');
    if (to.getTime() - from.getTime() > MAX_REPORT_DAYS * DAY_MS) {
      throw invalidRange('El reporte cubre como máximo un año.');
    }

    const branchFilter = query.branchId ? { branchId: query.branchId } : {};
    const appointmentWhere = { tenantId, startTime: { gte: from, lt: to }, ...branchFilter };
    const encounterWhere = {
      tenantId,
      deletedAt: null,
      startedAt: { gte: from, lt: to },
      ...branchFilter,
    };

    const [appointments, encounters, branches] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['branchId', 'psychologistId', 'status'],
        where: appointmentWhere,
        _count: { _all: true },
      }),
      this.prisma.encounter.groupBy({
        by: ['branchId', 'professionalId', 'encounterType'],
        where: encounterWhere,
        _count: { _all: true },
      }),
      this.prisma.branch.findMany({
        where: { tenantId },
        select: { id: true, name: true, isMain: true, isActive: true },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      }),
    ]);

    const totals = emptyCounts();
    const byBranch = new Map<string | null, ActivityCounts>();
    const byProfessional = new Map<string, ActivityCounts>();
    const byStatus: Partial<Record<AppointmentStatus, number>> = {};
    const byType: Partial<Record<EncounterType, number>> = {};
    const countsOf = <K>(map: Map<K, ActivityCounts>, key: K) => {
      if (!map.has(key)) map.set(key, emptyCounts());
      return map.get(key)!;
    };

    for (const row of appointments) {
      const count = row._count._all;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + count;
      for (const counts of [
        totals,
        countsOf(byBranch, row.branchId),
        countsOf(byProfessional, row.psychologistId),
      ]) {
        counts.appointments += count;
        if (row.status === 'COMPLETED') counts.completed += count;
        if (row.status === 'CANCELLED') counts.cancelled += count;
        if (row.status === 'NO_SHOW') counts.noShow += count;
      }
    }
    for (const row of encounters) {
      const count = row._count._all;
      byType[row.encounterType] = (byType[row.encounterType] ?? 0) + count;
      for (const counts of [
        totals,
        countsOf(byBranch, row.branchId),
        countsOf(byProfessional, row.professionalId),
      ]) {
        counts.encounters += count;
      }
    }

    const professionals = byProfessional.size
      ? await this.prisma.user.findMany({
          where: { tenantId, id: { in: [...byProfessional.keys()] } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];

    const listed = branches.filter((branch) => !query.branchId || branch.id === query.branchId);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      branchId: query.branchId ?? null,
      totals,
      appointmentsByStatus: byStatus,
      encountersByType: byType,
      branches: [
        ...listed.map((branch) => ({
          branchId: branch.id as string | null,
          name: branch.name,
          isActive: branch.isActive,
          ...(byBranch.get(branch.id) ?? emptyCounts()),
        })),
        // Appointments from before the clinic had branches carry none.
        ...(byBranch.has(null)
          ? [{ branchId: null, name: 'Sin sede', isActive: true, ...byBranch.get(null)! }]
          : []),
      ],
      professionals: professionals
        .map((user) => ({
          professionalId: user.id,
          name: `${user.firstName} ${user.lastName}`.trim(),
          ...byProfessional.get(user.id)!,
        }))
        .sort((a, b) => b.appointments + b.encounters - (a.appointments + a.encounters)),
    };
  }
}
