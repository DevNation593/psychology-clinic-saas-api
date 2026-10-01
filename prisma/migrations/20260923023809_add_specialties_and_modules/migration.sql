-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "specialtyId" TEXT;

-- AlterTable
ALTER TABLE "ClinicalNote" ADD COLUMN     "specialtyId" TEXT;

-- AlterTable
ALTER TABLE "NextSessionPlan" ADD COLUMN     "specialtyId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "professionalTitle" TEXT;

-- CreateTable
CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSpecialty" (
    "tenantId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantSpecialty_pkey" PRIMARY KEY ("tenantId","specialtyId")
);

-- CreateTable
CREATE TABLE "ProfessionalSpecialty" (
    "userId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalSpecialty_pkey" PRIMARY KEY ("userId","specialtyId")
);

-- CreateTable
CREATE TABLE "SpecialtyModule" (
    "id" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialtyModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSpecialty" (
    "id" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanSpecialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionSpecialty" (
    "tenantSubscriptionId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionSpecialty_pkey" PRIMARY KEY ("tenantSubscriptionId","specialtyId")
);

-- CreateTable
CREATE TABLE "TenantModule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_code_key" ON "Specialty"("code");

-- CreateIndex
CREATE INDEX "TenantSpecialty_specialtyId_idx" ON "TenantSpecialty"("specialtyId");

-- CreateIndex
CREATE INDEX "ProfessionalSpecialty_specialtyId_idx" ON "ProfessionalSpecialty"("specialtyId");

-- CreateIndex
CREATE INDEX "SpecialtyModule_moduleKey_idx" ON "SpecialtyModule"("moduleKey");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialtyModule_specialtyId_moduleKey_key" ON "SpecialtyModule"("specialtyId", "moduleKey");

-- CreateIndex
CREATE INDEX "PlanSpecialty_specialtyId_idx" ON "PlanSpecialty"("specialtyId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSpecialty_planType_specialtyId_key" ON "PlanSpecialty"("planType", "specialtyId");

-- CreateIndex
CREATE INDEX "SubscriptionSpecialty_specialtyId_idx" ON "SubscriptionSpecialty"("specialtyId");

-- CreateIndex
CREATE INDEX "TenantModule_moduleKey_idx" ON "TenantModule"("moduleKey");

-- CreateIndex
CREATE UNIQUE INDEX "TenantModule_tenantId_moduleKey_key" ON "TenantModule"("tenantId", "moduleKey");

-- AddForeignKey
ALTER TABLE "TenantSpecialty" ADD CONSTRAINT "TenantSpecialty_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSpecialty" ADD CONSTRAINT "TenantSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalSpecialty" ADD CONSTRAINT "ProfessionalSpecialty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalSpecialty" ADD CONSTRAINT "ProfessionalSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialtyModule" ADD CONSTRAINT "SpecialtyModule_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSpecialty" ADD CONSTRAINT "PlanSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionSpecialty" ADD CONSTRAINT "SubscriptionSpecialty_tenantSubscriptionId_fkey" FOREIGN KEY ("tenantSubscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionSpecialty" ADD CONSTRAINT "SubscriptionSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextSessionPlan" ADD CONSTRAINT "NextSessionPlan_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
