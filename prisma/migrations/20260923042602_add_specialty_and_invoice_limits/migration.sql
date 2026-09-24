-- AlterTable
ALTER TABLE "TenantSubscription" ADD COLUMN     "includedSpecialties" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastInvoiceReset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "monthlyElectronicInvoicesLimit" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "monthlyElectronicInvoicesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "specialtyPrice" DECIMAL(10,2) NOT NULL DEFAULT 15;
