-- Additive only: existing patients and invoices are left untouched.

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "billingName" TEXT,
ADD COLUMN "billingTaxIdType" TEXT,
ADD COLUMN "billingTaxId" TEXT,
ADD COLUMN "billingEmail" TEXT,
ADD COLUMN "billingAddress" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "patientId" TEXT,
ADD COLUMN "customerAddress" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_tenantId_patientId_createdAt_idx" ON "Invoice"("tenantId", "patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
