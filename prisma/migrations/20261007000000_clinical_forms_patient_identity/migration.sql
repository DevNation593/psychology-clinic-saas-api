-- Additive only: existing records keep schemaVersion 1 (the pre-definition format) and
-- existing patients keep a NULL identification, which the unique index ignores.

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "identificationType" TEXT,
ADD COLUMN "identificationNumber" TEXT,
ADD COLUMN "maritalStatus" TEXT,
ADD COLUMN "occupation" TEXT,
ADD COLUMN "nationality" TEXT,
ADD COLUMN "bloodType" TEXT,
ADD COLUMN "disability" TEXT,
ADD COLUMN "insuranceProvider" TEXT,
ADD COLUMN "insurancePolicyNumber" TEXT,
ADD COLUMN "guardianName" TEXT,
ADD COLUMN "guardianRelationship" TEXT,
ADD COLUMN "guardianIdentification" TEXT,
ADD COLUMN "guardianPhone" TEXT;

-- AlterTable
ALTER TABLE "SpecialtyRecord" ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "formDefinitionId" TEXT;

-- CreateTable
CREATE TABLE "FormDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "specialtyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormDefinitionVersion" (
    "id" TEXT NOT NULL,
    "formDefinitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schema" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormDefinitionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Patient_tenantId_identificationNumber_idx" ON "Patient"("tenantId", "identificationNumber");

-- One live patient per identification in a tenant. Prisma cannot express a partial index.
CREATE UNIQUE INDEX "Patient_tenantId_identification_key" ON "Patient"("tenantId", "identificationType", "identificationNumber") WHERE "identificationNumber" IS NOT NULL AND "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "SpecialtyRecord_formDefinitionId_idx" ON "SpecialtyRecord"("formDefinitionId");

-- CreateIndex
CREATE INDEX "FormDefinition_tenantId_isActive_idx" ON "FormDefinition"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FormDefinition_tenantId_name_key" ON "FormDefinition"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FormDefinitionVersion_formDefinitionId_version_key" ON "FormDefinitionVersion"("formDefinitionId", "version");

-- AddForeignKey
ALTER TABLE "SpecialtyRecord" ADD CONSTRAINT "SpecialtyRecord_formDefinitionId_fkey" FOREIGN KEY ("formDefinitionId") REFERENCES "FormDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDefinition" ADD CONSTRAINT "FormDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDefinition" ADD CONSTRAINT "FormDefinition_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDefinitionVersion" ADD CONSTRAINT "FormDefinitionVersion_formDefinitionId_fkey" FOREIGN KEY ("formDefinitionId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The modules added with the clinical definitions, for the specialties already in the catalog.
INSERT INTO "SpecialtyModule" ("id", "specialtyId", "moduleKey", "createdAt")
SELECT 'sm_' || md5(s."id" || ':' || m.module_key), s."id", m.module_key, CURRENT_TIMESTAMP
FROM (VALUES
    ('PSYCHOLOGY', 'psychology.mental-exam'),
    ('PSYCHOLOGY', 'psychology.treatment-plan'),
    ('PSYCHOLOGY', 'psychology.phq9'),
    ('PSYCHOLOGY', 'psychology.gad7'),
    ('NUTRITION', 'nutrition.food-history'),
    ('PHYSIOTHERAPY', 'physiotherapy.assessment'),
    ('DENTISTRY', 'dentistry.evolution')
) AS m(specialty_code, module_key)
JOIN "Specialty" s ON s."code" = m.specialty_code
ON CONFLICT ("specialtyId", "moduleKey") DO NOTHING;

-- Enabled for every clinic that already has the owning specialty, like any module of it.
INSERT INTO "TenantModule" ("id", "tenantId", "moduleKey", "enabled", "createdAt", "updatedAt")
SELECT 'tm_' || md5(ts."tenantId" || ':' || sm."moduleKey"), ts."tenantId", sm."moduleKey", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TenantSpecialty" ts
JOIN "SpecialtyModule" sm ON sm."specialtyId" = ts."specialtyId"
WHERE sm."moduleKey" IN (
    'psychology.mental-exam',
    'psychology.treatment-plan',
    'psychology.phq9',
    'psychology.gad7',
    'nutrition.food-history',
    'physiotherapy.assessment',
    'dentistry.evolution'
)
ON CONFLICT ("tenantId", "moduleKey") DO NOTHING;
