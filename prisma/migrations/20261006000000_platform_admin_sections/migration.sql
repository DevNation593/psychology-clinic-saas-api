ALTER TABLE "Tenant" ADD COLUMN "isPlatform" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Tenant_isPlatform_key" ON "Tenant" ("isPlatform") WHERE "isPlatform" = true;

-- Sections reproduce what each clinic sees today. Existing rows are left untouched.
INSERT INTO "TenantModule" ("id", "tenantId", "moduleKey", "enabled", "createdAt", "updatedAt")
SELECT 'section_' || md5(t."id" || ':' || s."key"), t."id", s."key",
       CASE s."key"
         WHEN 'core.tasks' THEN COALESCE(sub."featureTasks", false)
         WHEN 'core.clinicalNotes' THEN COALESCE(sub."featureClinicalNotes", true)
         WHEN 'core.team' THEN t."tenantType" = 'CLINIC'
         ELSE true
       END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES ('core.calendar'), ('core.patients'), ('core.tasks'), ('core.clinicalNotes'),
                   ('core.specialties'), ('core.billing'), ('core.team'), ('core.storage')) AS s("key")
LEFT JOIN "TenantSubscription" sub ON sub."tenantId" = t."id"
WHERE t."isPlatform" = false
ON CONFLICT ("tenantId", "moduleKey") DO NOTHING;

-- SOPORTE lost every permission; its accounts are closed.
UPDATE "RefreshToken" SET "isRevoked" = true
WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'SOPORTE');
UPDATE "User" SET "isActive" = false WHERE "role" = 'SOPORTE';
