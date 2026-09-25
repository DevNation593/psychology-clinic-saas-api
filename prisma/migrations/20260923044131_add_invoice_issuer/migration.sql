/*
  Warnings:

  - Added the required column `issuerId` to the `Invoice` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "issuerId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Invoice_tenantId_issuerId_createdAt_idx" ON "Invoice"("tenantId", "issuerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
