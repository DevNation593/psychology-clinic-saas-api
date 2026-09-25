ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROFESIONAL';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ASISTENTE';

DO $$
BEGIN
  IF EXISTS (
    SELECT "userId"
    FROM "ProfessionalSpecialty"
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ProfessionalProfile migration requires at most one ProfessionalSpecialty per user';
  END IF;
END $$;

INSERT INTO "Specialty" (
  "id", "code", "name", "description", "isActive", "createdAt", "updatedAt"
)
VALUES (
  'legacy_psychology_specialty',
  'PSYCHOLOGY',
  'Psicología',
  'Atención psicológica y psicoterapia.',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "ProfessionalProfile" (
  "userId" TEXT NOT NULL,
  "specialtyId" TEXT NOT NULL,
  "professionalTitle" TEXT,
  "licenseNumber" TEXT,
  "bio" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProfessionalProfile_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "ProfessionalProfile_specialtyId_isActive_idx"
  ON "ProfessionalProfile"("specialtyId", "isActive");

ALTER TABLE "ProfessionalProfile"
  ADD CONSTRAINT "ProfessionalProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfessionalProfile"
  ADD CONSTRAINT "ProfessionalProfile_specialtyId_fkey"
  FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    WITH "HistoricalSpecialty" AS (
      SELECT "psychologistId" AS "userId", "specialtyId" FROM "ClinicalNote"
      UNION ALL
      SELECT "psychologistId" AS "userId", "specialtyId" FROM "NextSessionPlan"
      UNION ALL
      SELECT "professionalId" AS "userId", "specialtyId" FROM "SpecialtyRecord"
    )
    SELECT history."userId"
    FROM "HistoricalSpecialty" history
    LEFT JOIN "ProfessionalSpecialty" current_specialty
      ON current_specialty."userId" = history."userId"
    WHERE current_specialty."userId" IS NULL
      AND history."specialtyId" IS NOT NULL
    GROUP BY history."userId"
    HAVING COUNT(DISTINCT history."specialtyId") > 1
  ) THEN
    RAISE EXCEPTION 'Cannot infer one current specialty for a legacy clinical author';
  END IF;
END $$;

WITH
"Psychology" AS (
  SELECT "id" FROM "Specialty" WHERE "code" = 'PSYCHOLOGY'
),
"ClinicalAuthors" AS (
  SELECT "psychologistId" AS "userId" FROM "ClinicalNote"
  UNION
  SELECT "psychologistId" AS "userId" FROM "NextSessionPlan"
  UNION
  SELECT "professionalId" AS "userId" FROM "SpecialtyRecord"
),
"HistoricalSpecialty" AS (
  SELECT "psychologistId" AS "userId", "specialtyId"
  FROM "ClinicalNote"
  WHERE "specialtyId" IS NOT NULL
  UNION ALL
  SELECT "psychologistId" AS "userId", "specialtyId"
  FROM "NextSessionPlan"
  WHERE "specialtyId" IS NOT NULL
  UNION ALL
  SELECT "professionalId" AS "userId", "specialtyId"
  FROM "SpecialtyRecord"
),
"InferredHistoricalSpecialty" AS (
  SELECT "userId", MIN("specialtyId") AS "specialtyId"
  FROM "HistoricalSpecialty"
  GROUP BY "userId"
)
INSERT INTO "ProfessionalProfile" (
  "userId",
  "specialtyId",
  "professionalTitle",
  "licenseNumber",
  "bio",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  app_user."id",
  COALESCE(
    current_specialty."specialtyId",
    inferred_specialty."specialtyId",
    psychology."id"
  ),
  app_user."professionalTitle",
  app_user."licenseNumber",
  NULL,
  app_user."isActive",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" app_user
CROSS JOIN "Psychology" psychology
LEFT JOIN "ProfessionalSpecialty" current_specialty
  ON current_specialty."userId" = app_user."id"
LEFT JOIN "InferredHistoricalSpecialty" inferred_specialty
  ON inferred_specialty."userId" = app_user."id"
LEFT JOIN "ClinicalAuthors" clinical_author
  ON clinical_author."userId" = app_user."id"
WHERE app_user."role" = 'PSICOLOGO'
   OR current_specialty."userId" IS NOT NULL
   OR clinical_author."userId" IS NOT NULL
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "TenantSpecialty" ("tenantId", "specialtyId", "createdAt")
SELECT app_user."tenantId", profile."specialtyId", CURRENT_TIMESTAMP
FROM "ProfessionalProfile" profile
JOIN "User" app_user ON app_user."id" = profile."userId"
ON CONFLICT ("tenantId", "specialtyId") DO NOTHING;
