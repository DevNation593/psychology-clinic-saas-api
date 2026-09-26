-- Stop if a selected specialty cannot be associated with exactly one subscription.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TenantSpecialty" selected
    LEFT JOIN "TenantSubscription" subscription ON subscription."tenantId" = selected."tenantId"
    WHERE subscription."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile specialty selection without a tenant subscription';
  END IF;
END $$;

INSERT INTO "SubscriptionSpecialty" ("tenantSubscriptionId", "specialtyId", "createdAt")
SELECT subscription."id", selected."specialtyId", CURRENT_TIMESTAMP
FROM "TenantSpecialty" selected
JOIN "TenantSubscription" subscription ON subscription."tenantId" = selected."tenantId"
ON CONFLICT ("tenantSubscriptionId", "specialtyId") DO NOTHING;

DELETE FROM "SubscriptionSpecialty" billed
USING "TenantSubscription" subscription
WHERE billed."tenantSubscriptionId" = subscription."id"
  AND NOT EXISTS (
    SELECT 1 FROM "TenantSpecialty" selected
    WHERE selected."tenantId" = subscription."tenantId"
      AND selected."specialtyId" = billed."specialtyId"
  );

INSERT INTO "TenantModule" ("id", "tenantId", "moduleKey", "enabled", "createdAt", "updatedAt")
SELECT 'reconcile_' || md5(selected."tenantId" || ':' || module."moduleKey"),
       selected."tenantId", module."moduleKey", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TenantSpecialty" selected
JOIN "Specialty" specialty ON specialty."id" = selected."specialtyId" AND specialty."isActive" = true
JOIN "SpecialtyModule" module ON module."specialtyId" = specialty."id"
ON CONFLICT ("tenantId", "moduleKey") DO NOTHING;

UPDATE "User" account
SET "managedByProvider" = false
FROM "Tenant" tenant
WHERE account."tenantId" = tenant."id"
  AND tenant."tenantType" = 'CLINIC'
  AND account."managedByProvider" = true;

UPDATE "TenantSubscription" subscription
SET "seatsPsychologistsUsed" = (
  SELECT COUNT(*)::integer
  FROM "ProfessionalProfile" profile
  JOIN "User" account ON account."id" = profile."userId"
  WHERE account."tenantId" = subscription."tenantId"
    AND account."isActive" = true
    AND profile."isActive" = true
);
