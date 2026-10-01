-- AlterTable
ALTER TABLE "BillingSettings" ADD COLUMN     "apiUrl" TEXT,
ADD COLUMN     "invoicePath" TEXT NOT NULL DEFAULT '/invoices';
