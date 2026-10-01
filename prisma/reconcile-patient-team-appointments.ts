import { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';

export type PatientTeamReconciliationSummary = {
  assignmentsBefore: number;
  assignmentsAfter: number;
  appointmentsRepaired: number;
  unresolvedAppointments: number;
};

type CountRow = { count: bigint };

export async function reconcilePatientTeamAppointments(
  prisma: PrismaClient | PrismaService,
): Promise<PatientTeamReconciliationSummary> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const crossTenantPatients = await tx.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Patient" patient
          JOIN "User" professional ON professional."id" = patient."assignedPsychologistId"
          WHERE patient."assignedPsychologistId" IS NOT NULL
            AND patient."tenantId" <> professional."tenantId"
        `;
          if (crossTenantPatients[0].count > 0n) throw new Error('PATIENT_TEAM_CROSS_TENANT');

          const crossTenantAppointments = await tx.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Appointment" appointment
          JOIN "Patient" patient ON patient."id" = appointment."patientId"
          JOIN "User" professional ON professional."id" = appointment."psychologistId"
          WHERE appointment."tenantId" <> patient."tenantId"
             OR appointment."tenantId" <> professional."tenantId"
        `;
          if (crossTenantAppointments[0].count > 0n) throw new Error('APPOINTMENT_CROSS_TENANT');

          const missingProfiles = await tx.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM (
            SELECT "assignedPsychologistId" AS "professionalId" FROM "Patient"
            WHERE "assignedPsychologistId" IS NOT NULL
            UNION
            SELECT "psychologistId" FROM "Appointment"
          ) referenced
          LEFT JOIN "ProfessionalProfile" profile ON profile."userId" = referenced."professionalId"
          WHERE profile."userId" IS NULL
        `;
          if (missingProfiles[0].count > 0n) throw new Error('PROFESSIONAL_PROFILE_REQUIRED');

          const before = await tx.patientProfessional.count();
          await tx.$executeRaw`
          INSERT INTO "PatientProfessional" (
            "id", "tenantId", "patientId", "professionalId", "assignedAt",
            "assignedById", "isActive", "createdAt", "updatedAt"
          )
          SELECT 'legacy_' || md5(patient."id" || ':' || professional."id"),
            patient."tenantId", patient."id", professional."id", CURRENT_TIMESTAMP,
            NULL, professional."isActive" AND profile."isActive", CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          FROM "Patient" patient
          JOIN "User" professional ON professional."id" = patient."assignedPsychologistId"
          JOIN "ProfessionalProfile" profile ON profile."userId" = professional."id"
          ON CONFLICT ("patientId", "professionalId") DO NOTHING
        `;
          const repaired = await tx.$executeRaw`
          UPDATE "Appointment" appointment
          SET "professionalId" = appointment."psychologistId",
              "specialtyId" = COALESCE(appointment."specialtyId", profile."specialtyId")
          FROM "ProfessionalProfile" profile
          WHERE profile."userId" = appointment."psychologistId"
            AND (appointment."professionalId" IS DISTINCT FROM appointment."psychologistId"
                 OR appointment."specialtyId" IS NULL)
        `;
          const unresolved = await tx.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count FROM "Appointment"
          WHERE "professionalId" IS NULL OR "specialtyId" IS NULL
             OR "professionalId" IS DISTINCT FROM "psychologistId"
        `;
          const unresolvedAppointments = Number(unresolved[0].count);
          if (unresolvedAppointments !== 0)
            throw new Error('APPOINTMENT_RECONCILIATION_INCOMPLETE');

          return {
            assignmentsBefore: before,
            assignmentsAfter: await tx.patientProfessional.count(),
            appointmentsRepaired: repaired,
            unresolvedAppointments,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('APPOINTMENT_RECONCILIATION_INCOMPLETE');
}

if (require.main === module) {
  const prisma = new PrismaClient();
  reconcilePatientTeamAppointments(prisma)
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
