-- CreateTable
CREATE TABLE "BillingSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'FAKTUR',
    "apiKey" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "establishment" TEXT,
    "emissionPoint" TEXT,
    "nextSequential" INTEGER NOT NULL DEFAULT 1,
    "businessName" TEXT,
    "businessAddress" TEXT,
    "specialTaxpayer" BOOLEAN NOT NULL DEFAULT false,
    "accountingRequired" BOOLEAN NOT NULL DEFAULT false,
    "withholdingAgent" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSettings_tenantId_key" ON "BillingSettings"("tenantId");

-- CreateIndex
CREATE INDEX "BillingSettings_tenantId_isEnabled_idx" ON "BillingSettings"("tenantId", "isEnabled");

-- AddForeignKey
ALTER TABLE "BillingSettings" ADD CONSTRAINT "BillingSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
