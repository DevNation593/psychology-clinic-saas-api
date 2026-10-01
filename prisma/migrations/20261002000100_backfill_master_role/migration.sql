-- One MASTER per tenant: active accounts first, then the oldest.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "tenantId"
    ORDER BY "isActive" DESC, "createdAt" ASC, "id" ASC
  ) AS position
  FROM "User"
  WHERE "role" IN ('ADMIN', 'CLIENTE')
)
UPDATE "User" AS account
SET "role" = 'MASTER'
FROM ranked
WHERE account."id" = ranked."id" AND ranked.position = 1;

-- Remaining administrators and every legacy psychologist become professionals.
UPDATE "User"
SET "role" = 'PROFESIONAL'
WHERE "role" IN ('ADMIN', 'CLIENTE', 'PSICOLOGO');

-- Prisma cannot express partial indexes; this one lives only in SQL.
CREATE UNIQUE INDEX "User_tenantId_master_key" ON "User" ("tenantId") WHERE "role" = 'MASTER';
