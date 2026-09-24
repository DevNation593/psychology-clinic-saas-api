-- CreateTable
CREATE TABLE "SpecialtyRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "moduleKey" TEXT NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialtyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialtyRecord_tenantId_patientId_recordDate_idx" ON "SpecialtyRecord"("tenantId", "patientId", "recordDate");

-- CreateIndex
CREATE INDEX "SpecialtyRecord_tenantId_specialtyId_moduleKey_idx" ON "SpecialtyRecord"("tenantId", "specialtyId", "moduleKey");

-- CreateIndex
CREATE INDEX "SpecialtyRecord_appointmentId_idx" ON "SpecialtyRecord"("appointmentId");

-- AddForeignKey
ALTER TABLE "SpecialtyRecord" ADD CONSTRAINT "SpecialtyRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialtyRecord" ADD CONSTRAINT "SpecialtyRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialtyRecord" ADD CONSTRAINT "SpecialtyRecord_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialtyRecord" ADD CONSTRAINT "SpecialtyRecord_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialtyRecord" ADD CONSTRAINT "SpecialtyRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
