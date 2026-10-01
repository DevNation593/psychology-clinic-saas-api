/*
  Warnings:

  - You are about to drop the column `slug` on the `Tenant` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Tenant_slug_idx";

-- DropIndex
DROP INDEX "Tenant_slug_key";

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "slug";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastActivityAt" TIMESTAMP(3);
