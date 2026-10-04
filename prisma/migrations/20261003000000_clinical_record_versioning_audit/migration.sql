-- Additive only: existing notes and records become version 1 and stay visible.

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE IF NOT EXISTS 'SPECIALTY_RECORD';

-- AlterTable
ALTER TABLE "ClinicalNote" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT,
ADD COLUMN "deletionReason" TEXT;

-- AlterTable
ALTER TABLE "SpecialtyRecord" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT,
ADD COLUMN "deletionReason" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "patientId" TEXT,
ADD COLUMN "reason" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_patientId_idx" ON "AuditLog"("tenantId", "patientId");
