-- No explicit BEGIN/COMMIT: Prisma sends this script as one multi-statement query, which
-- PostgreSQL already runs atomically. An explicit transaction would leave the connection
-- aborted after a guard fails and hide the guard code behind a generic error.

CREATE TABLE "PatientProfessional" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedById" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientProfessional_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientProfessional_patientId_professionalId_key"
  ON "PatientProfessional"("patientId", "professionalId");
CREATE INDEX "PatientProfessional_tenantId_patientId_isActive_idx"
  ON "PatientProfessional"("tenantId", "patientId", "isActive");
CREATE INDEX "PatientProfessional_tenantId_professionalId_isActive_idx"
  ON "PatientProfessional"("tenantId", "professionalId", "isActive");

ALTER TABLE "PatientProfessional" ADD CONSTRAINT "PatientProfessional_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientProfessional" ADD CONSTRAINT "PatientProfessional_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientProfessional" ADD CONSTRAINT "PatientProfessional_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientProfessional" ADD CONSTRAINT "PatientProfessional_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "Appointment" ALTER COLUMN "title" SET DEFAULT 'Consulta';
CREATE INDEX "Appointment_professionalId_idx" ON "Appointment"("professionalId");
CREATE INDEX "Appointment_tenantId_professionalId_startTime_idx"
  ON "Appointment"("tenantId", "professionalId", "startTime");
CREATE INDEX "Appointment_tenantId_patientId_professionalId_startTime_idx"
  ON "Appointment"("tenantId", "patientId", "professionalId", "startTime");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Patient" patient
    JOIN "User" professional ON professional."id" = patient."assignedPsychologistId"
    WHERE patient."assignedPsychologistId" IS NOT NULL
      AND patient."tenantId" <> professional."tenantId"
  ) THEN
    RAISE EXCEPTION 'PATIENT_TEAM_CROSS_TENANT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Appointment" appointment
    JOIN "Patient" patient ON patient."id" = appointment."patientId"
    JOIN "User" professional ON professional."id" = appointment."psychologistId"
    WHERE appointment."tenantId" <> patient."tenantId"
       OR appointment."tenantId" <> professional."tenantId"
  ) THEN
    RAISE EXCEPTION 'APPOINTMENT_CROSS_TENANT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "assignedPsychologistId" AS "professionalId"
      FROM "Patient"
      WHERE "assignedPsychologistId" IS NOT NULL
      UNION
      SELECT "psychologistId" FROM "Appointment"
    ) referenced
    LEFT JOIN "ProfessionalProfile" profile
      ON profile."userId" = referenced."professionalId"
    WHERE profile."userId" IS NULL
  ) THEN
    RAISE EXCEPTION 'PROFESSIONAL_PROFILE_REQUIRED';
  END IF;
END $$;

INSERT INTO "PatientProfessional" (
  "id", "tenantId", "patientId", "professionalId", "assignedAt",
  "assignedById", "isActive", "createdAt", "updatedAt"
)
SELECT
  'legacy_' || md5(patient."id" || ':' || professional."id"),
  patient."tenantId",
  patient."id",
  professional."id",
  CURRENT_TIMESTAMP,
  NULL,
  professional."isActive" AND profile."isActive",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Patient" patient
JOIN "User" professional ON professional."id" = patient."assignedPsychologistId"
JOIN "ProfessionalProfile" profile ON profile."userId" = professional."id"
ON CONFLICT ("patientId", "professionalId") DO NOTHING;

UPDATE "Appointment" appointment
SET
  "professionalId" = appointment."psychologistId",
  "specialtyId" = COALESCE(appointment."specialtyId", profile."specialtyId")
FROM "ProfessionalProfile" profile
WHERE profile."userId" = appointment."psychologistId"
  AND (
    appointment."professionalId" IS DISTINCT FROM appointment."psychologistId"
    OR appointment."specialtyId" IS NULL
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Appointment"
    WHERE "professionalId" IS NULL OR "specialtyId" IS NULL
  ) THEN
    RAISE EXCEPTION 'APPOINTMENT_RECONCILIATION_INCOMPLETE';
  END IF;
END $$;
