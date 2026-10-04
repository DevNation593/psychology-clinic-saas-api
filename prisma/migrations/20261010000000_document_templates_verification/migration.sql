-- Verification code of a clinical document. New records receive one when they are created;
-- older ones, the first time their document is opened (the application generates it, so the
-- code never depends on a random function of the database).
ALTER TABLE "SpecialtyRecord" ADD COLUMN     "verificationCode" TEXT;

-- Text a clinic reuses in its certificates and consents.
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTemplate_tenantId_moduleKey_isActive_idx" ON "DocumentTemplate"("tenantId", "moduleKey", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_tenantId_moduleKey_name_key" ON "DocumentTemplate"("tenantId", "moduleKey", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialtyRecord_verificationCode_key" ON "SpecialtyRecord"("verificationCode");

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
