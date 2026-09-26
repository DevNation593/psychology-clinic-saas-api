# Specialty Catalog, Onboarding, and Team Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar la tercera etapa multiespecialidad con catálogo público, onboarding atómico, selección idempotente de especialidades y administración del equipo bajo control del consultorio.

**Architecture:** La API conserva el esquema actual, separa catálogo global de configuración por tenant y centraliza el precio en funciones puras compartidas por onboarding, suscripción y especialidades. La web consume contratos explícitos y divide los tres flujos grandes en componentes comprobables de forma aislada. Los endpoints y campos heredados continúan como adaptadores durante una versión.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Jest/Supertest, Next.js 14, React 18, TanStack Query, React Hook Form, Zod, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-specialty-onboarding-team-design.md`

## Global Constraints

- Apilar API y web sobre sus ramas `codex/professional-profiles`; no modificar los PR #23 ni #18.
- El onboarding público crea un tenant `CLINIC`, exige al menos una especialidad y termina en una sola transacción serializable.
- `ADMIN` puede tener perfil profesional opcional; `PROFESIONAL` requiere exactamente una especialidad habilitada; `ASISTENTE` no puede tener perfil.
- El administrador del consultorio controla el equipo. No crear nuevas cuentas con `managedByProvider = true`.
- La creación directa de un miembro exige contraseña inicial; no conectar la interfaz nueva al flujo inseguro de activación por `tenantId + userId`.
- El cuerpo nunca decide `tenantId`; los endpoints autenticados lo reciben por ruta y lo validan con `TenantGuard`.
- Mantener compatibilidad de lectura para `CLIENTE`/`PSICOLOGO`, `ProfessionalSpecialty` y el `POST` heredado de especialidades.
- No cambiar pacientes, equipo tratante, `psychologistId`, agenda ni autorización clínica en esta etapa.
- Ninguna reconciliación elimina citas, notas, `SpecialtyRecord` ni otras filas clínicas históricas.
- Cada tarea se implementa con ciclo rojo-verde, revisión de alcance y un commit enfocado.

## Execution Setup

- API ya está aislada en `api/.worktrees/specialty-onboarding-team`, rama `codex/specialty-onboarding-team`, base `0fe1c5dc7a301f3614ac7f09be841290dcdc863c`.
- Antes de la primera tarea web, crear `web/.worktrees/specialty-onboarding-team` en la rama `codex/specialty-onboarding-team` desde `codex/professional-profiles` (`33824f74720b34b5b0ec6a8db0810f42a82c9198`).
- En cada worktree ejecutar la instalación del lockfile, generar Prisma en API y verificar la línea base antes de editar.
- Mantener rangos de revisión separados para API y web; nunca generar un paquete de diff suponiendo un único Git root.

---

### Task 1: Extract canonical subscription pricing and preserve every add-on

**Files:**
- Create: `api/src/subscription/subscription-pricing.ts`
- Test: `api/src/subscription/subscription-pricing.spec.ts`
- Modify: `api/src/subscription/subscription.service.ts`
- Test: `api/test/subscription-professional-seats.spec.ts`

**Interfaces:**
- Produces: `getPlanLimits(planType)`, `getPlanIncludedModules(planType)`, `getPlanFeatureFlags(planType)`, `getSelectedModules(subscription)` and `calculateSubscriptionPrice(input)`.
- `calculateSubscriptionPrice` returns `{ basePlanPrice, featureAddonsPrice, specialtyAddonsPrice, totalMonthly, includedSpecialties, selectedSpecialties, billableSpecialties, specialtyUnitPrice }` as numbers in USD.
- Consumed by Tasks 3 and 4.

- [ ] **Step 1: Write failing pure pricing tests**

```ts
import { calculateSubscriptionPrice } from './subscription-pricing';

describe('calculateSubscriptionPrice', () => {
  it('preserves commercial add-ons while charging specialties above the included count', () => {
    expect(
      calculateSubscriptionPrice({
        planType: 'CLINIC_BASIC',
        selectedModules: ['clinicalNotes', 'attachments', 'advancedAnalytics'],
        specialtyCount: 4,
        specialtyUnitPrice: 15,
      }),
    ).toEqual({
      basePlanPrice: 99,
      featureAddonsPrice: 10,
      specialtyAddonsPrice: 30,
      totalMonthly: 139,
      includedSpecialties: 2,
      selectedSpecialties: 4,
      billableSpecialties: 2,
      specialtyUnitPrice: 15,
    });
  });

  it('returns the same total every time for the same input', () => {
    const input = {
      planType: 'TRIAL' as const,
      selectedModules: ['clinicalNotes'] as const,
      specialtyCount: 2,
      specialtyUnitPrice: 15,
    };
    expect(calculateSubscriptionPrice(input)).toEqual({
      basePlanPrice: 0,
      featureAddonsPrice: 0,
      specialtyAddonsPrice: 15,
      totalMonthly: 15,
      includedSpecialties: 1,
      selectedSpecialties: 2,
      billableSpecialties: 1,
      specialtyUnitPrice: 15,
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npm test -- --runInBand src/subscription/subscription-pricing.spec.ts`

Expected: FAIL because `subscription-pricing.ts` does not exist.

- [ ] **Step 3: Move the existing plan constants and implement the pure API**

Move the existing `MODULE_PRICING`, `PLAN_INCLUDED_MODULES`, `PLAN_SPECIALTY_LIMITS`, `SPECIALTY_PRICE_PER_MONTH`, plan-limit records and feature-key mapping out of `subscription.service.ts` without changing their values. Export this exact calculation:

```ts
export type SubscriptionPriceInput = {
  planType: PlanType;
  selectedModules: readonly ModuleName[];
  specialtyCount: number;
  specialtyUnitPrice?: number;
};

export function calculateSubscriptionPrice(
  input: SubscriptionPriceInput,
): SubscriptionPriceBreakdown {
  const limits = getPlanLimits(input.planType);
  const includedModules = new Set(getPlanIncludedModules(input.planType));
  const featureAddonsPrice = [...new Set(input.selectedModules)]
    .filter((module) => !includedModules.has(module))
    .reduce((total, module) => total + MODULE_PRICING[module], 0);
  const includedSpecialties = limits.includedSpecialties;
  const selectedSpecialties = input.specialtyCount;
  const billableSpecialties = Math.max(0, selectedSpecialties - includedSpecialties);
  const specialtyUnitPrice = input.specialtyUnitPrice ?? SPECIALTY_PRICE_PER_MONTH;
  const specialtyAddonsPrice = billableSpecialties * specialtyUnitPrice;
  const basePlanPrice = Number(limits.basePrice);

  return {
    basePlanPrice,
    featureAddonsPrice,
    specialtyAddonsPrice,
    totalMonthly: basePlanPrice + featureAddonsPrice + specialtyAddonsPrice,
    includedSpecialties,
    selectedSpecialties,
    billableSpecialties,
    specialtyUnitPrice,
  };
}
```

`getSelectedModules(subscription)` must inspect the existing feature booleans using the same `moduleToDbKey` mapping; it always includes `clinicalNotes` when that flag is true.

- [ ] **Step 4: Write the failing subscription-service regression test**

Extend `subscription-professional-seats.spec.ts` with a subscription on `CLINIC_BASIC`, four selected specialties and `advancedAnalytics` enabled. Call `customizeFeatures` and assert the hand-calculated breakdown:

```ts
expect(updated.basePrice.toNumber()).toBe(139);
expect(result.pricing).toMatchObject({
  featureAddonsPrice: 10,
  specialtyAddonsPrice: 30,
  totalMonthly: 139,
});
```

- [ ] **Step 5: Make subscription mutations use the canonical calculator**

Run the focused test first and confirm it fails because the service currently drops specialty cost. Then, in `customizeFeatures`, count `tenantSpecialty`, calculate from the requested modules and write `new Decimal(pricing.totalMonthly)`. In `upgradePlan`, count specialties, use the new plan's included modules and write the calculated total. Replace private helper calls with imports from `subscription-pricing.ts`.

- [ ] **Step 6: Run focused and full unit tests**

Run: `npm test -- --runInBand src/subscription/subscription-pricing.spec.ts test/subscription-professional-seats.spec.ts`

Expected: PASS.

Run: `npm test -- --runInBand`

Expected: 13 existing suites plus the new pricing suite pass; only the existing optional test remains skipped.

- [ ] **Step 7: Commit**

```bash
git add src/subscription/subscription-pricing.ts src/subscription/subscription-pricing.spec.ts src/subscription/subscription.service.ts test/subscription-professional-seats.spec.ts
git commit -m "refactor(api): centralize subscription pricing"
```

---

### Task 2: Separate the public specialty catalog from tenant configuration

**Files:**
- Create: `api/src/specialties/specialty-catalog.controller.ts`
- Test: `api/src/specialties/specialty-catalog.controller.spec.ts`
- Create: `api/src/specialties/specialty-catalog.service.ts`
- Test: `api/src/specialties/specialty-catalog.service.spec.ts`
- Modify: `api/src/specialties/specialties.module.ts`
- Modify: `api/src/specialties/specialties.controller.ts`
- Modify: `api/src/specialties/specialties.service.ts`

**Interfaces:**
- Produces: `SpecialtyCatalogService.listActive(client?)` and `resolveActiveCodes(codes, client?)`.
- `resolveActiveCodes` returns normalized, unique specialties in request order or throws `{ code: 'SPECIALTY_NOT_AVAILABLE' }`.
- Produces public `GET /specialties`; tenant `GET /tenants/:tenantId/specialties` remains unchanged.

- [ ] **Step 1: Write failing catalog service tests**

```ts
it('returns only active specialties with sorted modules', async () => {
  prisma.specialty.findMany.mockResolvedValue([{ id: 'psy', code: 'PSYCHOLOGY' }]);
  await expect(service.listActive()).resolves.toEqual([
    { id: 'psy', code: 'PSYCHOLOGY' },
  ]);
  expect(prisma.specialty.findMany).toHaveBeenCalledWith({
    where: { isActive: true },
    include: { modules: { orderBy: { moduleKey: 'asc' } } },
    orderBy: { name: 'asc' },
  });
});

it('normalizes codes and rejects a missing or inactive catalog item', async () => {
  prisma.specialty.findMany.mockResolvedValue([{ id: 'psy', code: 'PSYCHOLOGY' }]);
  await expect(
    service.resolveActiveCodes([' psychology ', 'NUTRITION']),
  ).rejects.toMatchObject({ response: { code: 'SPECIALTY_NOT_AVAILABLE' } });
});
```

- [ ] **Step 2: Run the service test and confirm red**

Run: `npm test -- --runInBand src/specialties/specialty-catalog.service.spec.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement catalog normalization and lookup**

```ts
export function normalizeSpecialtyCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
}

async resolveActiveCodes(codes: readonly string[], client = this.prisma) {
  const normalized = normalizeSpecialtyCodes(codes);
  if (normalized.length === 0) {
    throw new BadRequestException({
      code: 'SPECIALTY_SELECTION_REQUIRED',
      message: 'Selecciona al menos una especialidad.',
    });
  }
  const rows = await client.specialty.findMany({
    where: { code: { in: normalized }, isActive: true },
    include: { modules: { orderBy: { moduleKey: 'asc' } } },
  });
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const missing = normalized.find((code) => !byCode.has(code));
  if (missing) {
    throw new NotFoundException({
      code: 'SPECIALTY_NOT_AVAILABLE',
      message: `La especialidad ${missing} no existe o está inactiva.`,
    });
  }
  return normalized.map((code) => byCode.get(code)!);
}
```

- [ ] **Step 4: Write the failing controller visibility test**

Use a Nest testing module with the real controller and mocked service. Assert `GET /specialties` returns the service result, then use `Reflector.get(IS_PUBLIC_KEY, SpecialtyCatalogController.prototype.list)` to assert `true` and the same lookup on `SpecialtiesController.prototype.setSpecialties` to assert `undefined`. This catches accidentally making the tenant mutation public without reproducing framework guard tests.

Run: `npm test -- --runInBand src/specialties/specialty-catalog.controller.spec.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 5: Add the public controller without weakening tenant routes**

```ts
@ApiTags('specialties')
@Controller('specialties')
export class SpecialtyCatalogController {
  constructor(private readonly catalog: SpecialtyCatalogService) {}

  @Public()
  @Get()
  list() {
    return this.catalog.listActive();
  }
}
```

Register this controller alongside the existing tenant controller. Remove catalog responsibility from `SpecialtiesService`; retain its current tenant list/module methods until Task 3 replaces their mutation internals.

- [ ] **Step 6: Run the specialty suite**

Run: `npm test -- --runInBand src/specialties`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/specialties
git commit -m "feat(api): expose public specialty catalog"
```

---

### Task 3: Replace tenant specialties safely and idempotently

**Files:**
- Create: `api/src/specialties/tenant-specialties.service.ts`
- Test: `api/src/specialties/tenant-specialties.service.spec.ts`
- Test: `api/src/specialties/specialties.controller.spec.ts`
- Create: `api/prisma/migrations/20260925203000_reconcile_specialty_team_ownership/migration.sql`
- Modify: `api/src/specialties/specialties.controller.ts`
- Modify: `api/src/specialties/specialties.module.ts`
- Modify: `api/src/specialties/specialties.service.ts`
- Modify: `api/src/specialties/dto/update-specialties.dto.ts`

**Interfaces:**
- Produces: `TenantSpecialtiesService.replace(tenantId, specialtyCodes, actorId)`.
- Produces: `applySelection(tx, { tenantId, subscription, specialties })` for Task 4 onboarding.
- Produces `SpecialtySelectionResult` exactly as defined in the spec.
- `SpecialtiesService.setForTenant` becomes a compatibility delegate to `replace`.

- [ ] **Step 1: Write failing dependency and idempotency tests**

```ts
it('blocks removing a specialty used by an effective active professional', async () => {
  prisma.professionalProfile.findFirst.mockResolvedValue({ userId: 'professional-1' });
  await expect(service.replace('tenant-1', ['NUTRITION'], 'admin-1')).rejects.toMatchObject({
    status: 409,
    response: { code: 'SPECIALTY_IN_USE_BY_ACTIVE_PROFESSIONAL' },
  });
});

it('ignores cancelled future appointments but blocks scheduled ones', async () => {
  prisma.professionalProfile.findFirst.mockResolvedValue(null);
  prisma.appointment.findFirst.mockResolvedValue({ id: 'appointment-1' });
  await expect(service.replace('tenant-1', ['NUTRITION'], 'admin-1')).rejects.toMatchObject({
    response: { code: 'SPECIALTY_HAS_FUTURE_APPOINTMENTS' },
  });
  expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
    where: expect.objectContaining({
      tenantId: 'tenant-1',
      status: { not: 'CANCELLED' },
      startTime: { gt: expect.any(Date) },
    }),
  });
});

it('replaces both join tables and writes an absolute price', async () => {
  const first = await service.replace('tenant-1', ['PSYCHOLOGY', 'NUTRITION'], 'admin-1');
  const second = await service.replace('tenant-1', ['PSYCHOLOGY', 'NUTRITION'], 'admin-1');
  expect(second).toEqual(first);
  expect(subscriptionUpdate.data.basePrice.toNumber()).toBe(first.pricing.totalMonthly);
});

it('rejects enabling a module that has no selected specialty owner', async () => {
  prisma.tenantSpecialty.findFirst.mockResolvedValue(null);
  await expect(service.updateModule('tenant-1', 'nutrition.assessment', true))
    .rejects.toMatchObject({
      response: { code: 'MODULE_SPECIALTY_NOT_ENABLED' },
    });
  expect(prisma.tenantModule.create).not.toHaveBeenCalled();
  expect(prisma.tenantModule.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing controller tests for canonical and compatibility routes**

Create a Nest test app with `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Send the same valid body to `PUT /tenants/tenant-1/specialties` and legacy `POST /tenants/tenant-1/specialties`; assert both call `replace('tenant-1', ['PSYCHOLOGY'], 'admin-1')` and return the same service result. Assert an empty list returns `400` before the service is called.

- [ ] **Step 3: Run the new tests and confirm red**

Run: `npm test -- --runInBand src/specialties/tenant-specialties.service.spec.ts src/specialties/specialties.controller.spec.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement removal checks and transactional reconciliation**

Use `Prisma.TransactionIsolationLevel.Serializable`. For each removed specialty, query:

```ts
const activeProfessional = await tx.professionalProfile.findFirst({
  where: {
    specialtyId,
    isActive: true,
    user: { tenantId, isActive: true },
  },
  select: { userId: true },
});

const futureAppointment = await tx.appointment.findFirst({
  where: {
    tenantId,
    specialtyId,
    startTime: { gt: now },
    status: { not: 'CANCELLED' },
  },
  select: { id: true },
});
```

Inside `applySelection`, delete and recreate `TenantSpecialty` and `SubscriptionSpecialty`, deduplicate module keys, create missing `TenantModule` enabled, remove keys no longer derivable, calculate selected commercial modules from the subscription and update `basePrice` with the absolute total.

Return specialties in request order, modules ordered by key and the canonical pricing object.

- [ ] **Step 5: Enforce module ownership**

Change module update to verify a selected specialty owns the key:

```ts
const owner = await this.prisma.tenantSpecialty.findFirst({
  where: {
    tenantId,
    specialty: { modules: { some: { moduleKey } } },
  },
  select: { specialtyId: true },
});
if (!owner) {
  throw new ConflictException({
    code: 'MODULE_SPECIALTY_NOT_ENABLED',
    message: 'El módulo requiere una especialidad habilitada.',
  });
}
```

Then update the existing `TenantModule`; when enabling a missing but valid key, create it with `enabled: true`.

- [ ] **Step 6: Add `PUT` and keep `POST` as an adapter**

Both handlers call the same controller method/service and require `@Roles('ADMIN')`. The DTO must trim through `@Transform`, enforce `ArrayMinSize(1)` and reject non-string elements. Do not mark either route public.

- [ ] **Step 7: Add the data reconciliation migration**

The SQL must:

```sql
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

UPDATE "User" account
SET "managedByProvider" = false
FROM "Tenant" tenant
WHERE account."tenantId" = tenant."id"
  AND tenant."tenantType" = 'CLINIC'
  AND account."managedByProvider" = true;
```

Insert missing tenant modules with deterministic text IDs (`'reconcile_' || md5(tenantId || ':' || moduleKey)`), `enabled = true`, and current timestamps. Update `seatsPsychologistsUsed` from active profiles joined to active users. Do not delete clinical records or specialty catalog rows.

- [ ] **Step 8: Run specialty, pricing and migration checks**

Run: `npm test -- --runInBand src/specialties src/subscription/subscription-pricing.spec.ts`

Expected: PASS.

Run: `npx prisma validate`

Expected: schema valid.

- [ ] **Step 9: Commit**

```bash
git add src/specialties prisma/migrations/20260925203000_reconcile_specialty_team_ownership/migration.sql
git commit -m "feat(api): reconcile tenant specialty selection"
```

---

### Task 4: Create the clinic atomically through a public onboarding command

**Files:**
- Create: `api/src/onboarding/onboarding.module.ts`
- Create: `api/src/onboarding/onboarding.controller.ts`
- Create: `api/src/onboarding/onboarding.service.ts`
- Create: `api/src/onboarding/dto/create-clinic-onboarding.dto.ts`
- Test: `api/src/onboarding/onboarding.service.spec.ts`
- Test: `api/src/onboarding/onboarding.controller.spec.ts`
- Modify: `api/src/app.module.ts`
- Modify: `api/src/specialties/specialties.module.ts`

**Interfaces:**
- Produces public `POST /onboarding/tenants`.
- Consumes `SpecialtyCatalogService.resolveActiveCodes`, `TenantSpecialtiesService.applySelection`, `AuthService.hashPassword` and pricing helpers.
- Returns `{ tenant, admin, specialties, modules, pricing }` with no password.

- [ ] **Step 1: Write failing DTO/service tests for both administrator modes**

```ts
it('creates a non-clinical administrator without consuming a professional seat', async () => {
  const result = await service.create(input({ adminProvidesCare: false }));
  expect(result.admin).toMatchObject({ role: 'ADMIN', professionalProfile: null });
  expect(result.tenant).toMatchObject({ tenantType: 'CLINIC', onboardingCompleted: true });
  expect(createdSubscription.seatsPsychologistsUsed).toBe(0);
});

it('requires the clinical administrator specialty to be selected', async () => {
  await expect(
    service.create(input({
      specialtyCodes: ['PSYCHOLOGY'],
      adminProvidesCare: true,
      adminSpecialtyCode: 'NUTRITION',
    })),
  ).rejects.toMatchObject({
    response: { code: 'ADMIN_SPECIALTY_NOT_SELECTED' },
  });
});

it('rolls back tenant creation when specialty provisioning fails', async () => {
  tenantSpecialties.applySelection.mockRejectedValue(new Error('provision failed'));
  await expect(service.create(input())).rejects.toThrow('provision failed');
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});
```

In `onboarding.controller.spec.ts`, also write the failing HTTP/metadata test before implementation: a valid request reaches `OnboardingService.create`, `Reflector.get(IS_PUBLIC_KEY, OnboardingController.prototype.create)` is `true`, and `Reflector.get(IS_PUBLIC_KEY, TenantsController.prototype.create)` remains `undefined`.

- [ ] **Step 2: Run onboarding tests and confirm red**

Run: `npm test -- --runInBand src/onboarding`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement conditional validation explicitly**

Use `ValidateIf` for clinical fields and also enforce cross-field selection in the service. The DTO fields and names must match the spec exactly. Normalize `specialtyCodes` and `adminSpecialtyCode` before lookup; use the existing password minimum and email validators.

```ts
@ValidateIf((dto: CreateClinicOnboardingDto) => dto.adminProvidesCare)
@IsString()
@IsNotEmpty()
adminSpecialtyCode?: string;

@IsArray()
@ArrayMinSize(1)
@IsString({ each: true })
specialtyCodes: string[];
```

- [ ] **Step 4: Implement one serializable transaction**

Hash before opening the transaction, reject an existing admin email, then create tenant, settings, trial subscription and admin. Use `role: UserRole.ADMIN`, `tenantType: TenantType.CLINIC`, `onboardingCompleted: true`, trial seats `3`, included specialties `1`, and specialty unit price `15`.

When clinical, create both:

```ts
professionalProfile: {
  create: {
    specialtyId: adminSpecialty.id,
    professionalTitle: dto.adminProfessionalTitle,
    licenseNumber: dto.adminLicenseNumber,
    bio: dto.adminBio,
    isActive: true,
  },
},
professionalSpecialties: {
  create: { specialtyId: adminSpecialty.id, isPrimary: true },
},
```

Call `applyRlsContext` after the tenant exists, then `applySelection` with the same transaction. Update the stored seat count to `1` or `0`. Select safe administrator fields only.

- [ ] **Step 5: Add a separate public controller**

```ts
@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @Post('tenants')
  create(@Body() dto: CreateClinicOnboardingDto) {
    return this.onboarding.create(dto);
  }
}
```

Keep `POST /tenants` support-only and unchanged.

- [ ] **Step 6: Verify controller visibility and transaction tests**

Run: `npm test -- --runInBand src/onboarding`

Expected: PASS, including that the onboarding handler is public and the support tenant handler is not.

- [ ] **Step 7: Commit**

```bash
git add src/onboarding src/app.module.ts src/specialties/specialties.module.ts
git commit -m "feat(api): add atomic clinic onboarding"
```

---

### Task 5: Give clinic administrators safe team control

**Files:**
- Modify: `api/src/users/dto/user.dto.ts`
- Modify: `api/src/users/users.controller.ts`
- Modify: `api/src/users/users.service.ts`
- Test: `api/src/users/users.controller.spec.ts`
- Test: `api/src/users/users.team.spec.ts`
- Modify: `api/src/users/provider-admin.controller.ts`

**Interfaces:**
- Produces authenticated `POST /tenants/:tenantId/users` with a body that cannot contain `tenantId`.
- `UsersService.createForTenant(tenantId, dto, actorId)` creates an active direct account.
- Administrative update/deactivate methods receive `actorId` and enforce self/last-admin rules.

- [ ] **Step 1: Write failing controller tests for route authority and body whitelisting**

```ts
it('lets ADMIN create a tenant member and derives tenantId from the route', async () => {
  await request(app.getHttpServer())
    .post('/tenants/tenant-1/users')
    .set('x-test-role', 'ADMIN')
    .set('x-test-user-id', 'admin-1')
    .send({
      email: 'professional@example.com',
      password: 'Password123!',
      firstName: 'Ana',
      lastName: 'Vega',
      role: 'PROFESIONAL',
      professionalProfile: { specialtyId: 'specialty-1' },
    })
    .expect(201);
  expect(usersService.createForTenant).toHaveBeenCalledWith(
    'tenant-1',
    expect.not.objectContaining({ tenantId: expect.anything() }),
    'admin-1',
  );
});

it('rejects tenantId and managedByProvider in the body', async () => {
  await request(app.getHttpServer())
    .post('/tenants/tenant-1/users')
    .set('x-test-role', 'ADMIN')
    .send({
      email: 'assistant@example.com',
      password: 'Password123!',
      firstName: 'Alex',
      lastName: 'Ríos',
      role: 'ASISTENTE',
      tenantId: 'other',
      managedByProvider: false,
    })
    .expect(400);
});
```

- [ ] **Step 2: Write failing service rules**

Cover these exact cases in `users.team.spec.ts`:

```ts
it.each(['SOPORTE', 'PACIENTE'])('rejects tenant-created role %s', async (role) => {
  await expect(service.createForTenant('tenant-1', member({ role }), 'admin-1'))
    .rejects.toMatchObject({ status: 400 });
});

it('allows CLINIC TRIAL while honoring seatsPsychologistsMax', async () => {
  tenant.tenantType = 'CLINIC';
  subscription.planType = 'TRIAL';
  subscription.status = 'TRIALING';
  await expect(service.createForTenant('tenant-1', professional(), 'admin-1'))
    .resolves.toMatchObject({ managedByProvider: false, isActive: true });
});

it('prevents self-deactivation', async () => {
  await expect(service.deactivate('tenant-1', 'admin-1', 'admin-1'))
    .rejects.toMatchObject({ response: { code: 'CANNOT_DEACTIVATE_SELF' } });
});

it('prevents removing the last effective admin', async () => {
  await expect(service.update('tenant-1', 'admin-2', { role: 'ASISTENTE' }, 'admin-1'))
    .rejects.toMatchObject({ response: { code: 'LAST_ACTIVE_ADMIN_REQUIRED' } });
});
```

- [ ] **Step 3: Run focused tests and confirm red**

Run: `npm test -- --runInBand src/users/users.controller.spec.ts src/users/users.team.spec.ts`

Expected: FAIL on missing route and methods.

- [ ] **Step 4: Add the tenant-scoped DTO and route**

Create `CreateTenantUserDto` by omitting `tenantId` from `CreateUserDto`. Require `password` for this direct-create DTO. Add:

```ts
@Roles('ADMIN')
@Post()
create(
  @Param('tenantId') tenantId: string,
  @Body() dto: CreateTenantUserDto,
  @CurrentUser() actor: { userId: string },
) {
  return this.usersService.createForTenant(tenantId, dto, actor.userId);
}
```

Place `@Post()` before `@Get(':userId')` and keep `PATCH me` before dynamic PATCH.

- [ ] **Step 5: Replace plan-name and provider gates with tenant ownership rules**

Inside the existing serializable mutation, load tenant and subscription. Throw `TEAM_NOT_AVAILABLE` unless tenant is `CLINIC` and subscription is `ACTIVE` or `TRIALING`. Allow only admin/professional/assistant role families. Set:

```ts
isActive: true,
managedByProvider: false,
emailVerified: true,
activatedAt: new Date(),
```

Retain profile validation and seat locking. Do not call the email invitation method.

Keep `UsersService.create(dto, actorId)` as an internal compatibility wrapper for existing fixtures and services: remove `tenantId` from its DTO copy and delegate to `createForTenant(dto.tenantId, tenantDto, actorId)`. No HTTP controller may accept that legacy DTO.

- [ ] **Step 6: Enforce administrator invariants in the same transaction**

Pass `actorId` from controller update/deactivate calls. Before an action that deactivates an admin or changes its role away from the admin family, count other active admin-family users in the tenant. Throw the stable errors from the spec. Use `isAdminRole` so legacy `CLIENTE` counts.

The check must happen before the write and under the same serializable transaction.

- [ ] **Step 7: Keep provider endpoints only as legacy adapters**

Do not create provider-managed rows. Provider grant/revoke methods may continue to operate only when an old row is still marked `managedByProvider`; update their summaries to say “legacy provider-managed account”. The migration from Task 3 makes ordinary clinic rows administrator-managed.

- [ ] **Step 8: Run user, seat and full unit suites**

Run: `npm test -- --runInBand src/users test/users-seat-enforcement.spec.ts test/professional-profiles.e2e-spec.ts`

Expected: PASS after updating direct method calls with an actor ID where required.

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/users test/users-seat-enforcement.spec.ts test/professional-profiles.e2e-spec.ts
git commit -m "feat(api): let clinic admins manage teams"
```

---

### Task 6: Prove the complete API flow and migration on a fresh database

**Files:**
- Create: `api/test/specialty-onboarding-team.e2e-spec.ts`
- Modify: `api/test/setup-e2e.ts`
- Modify: `api/test/helpers/create-test-tenant.ts`

**Interfaces:**
- Verifies public HTTP contracts, authenticated tenant mutations and direct team creation.
- Adds only the exact disposable database `psic_clinic_specialty_stage_test` to the E2E safety allowlist.

- [ ] **Step 1: Add the exact test-database allowlist case**

Extend the existing exact-name check with `psic_clinic_specialty_stage_test`. Add a safety unit assertion that `psic_clinic_specialty_stage_test_shadow`, development and production names still fail.

- [ ] **Step 2: Write the E2E journey**

Build the Nest app with the production prefix and validation pipe, then create deterministic Psychology and Nutrition catalog/module fixtures before the first request:

```ts
app.setGlobalPrefix('api/v1');
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));

await prisma.specialty.upsert({
  where: { code: 'PSYCHOLOGY' },
  update: { isActive: true },
  create: { code: 'PSYCHOLOGY', name: 'Psicología', isActive: true },
});
await prisma.specialty.upsert({
  where: { code: 'NUTRITION' },
  update: { isActive: true },
  create: { code: 'NUTRITION', name: 'Nutrición', isActive: true },
});
```

Create the required `SpecialtyModule` fixtures with `upsert` as well. The suite must use HTTP for public/onboarding/admin routes and assert:

```ts
const catalog = await request(server).get('/api/v1/specialties').expect(200);
expect(catalog.body.map((item: { code: string }) => item.code))
  .toEqual(expect.arrayContaining(['PSYCHOLOGY', 'NUTRITION']));

const created = await request(server)
  .post('/api/v1/onboarding/tenants')
  .send(onboardingPayload)
  .expect(201);
expect(created.body).not.toHaveProperty('admin.password');
expect(created.body.admin.professionalProfile.specialty.code).toBe('PSYCHOLOGY');

const login = await request(server)
  .post('/api/v1/auth/login')
  .send({ email: onboardingPayload.adminEmail, password: onboardingPayload.adminPassword })
  .expect(201);
```

Use the access token to:

- repeat the same `PUT` twice and compare pricing/row counts;
- reject removal while the admin profile is active;
- disable the admin profile, add Nutrition, and create a Nutrition professional;
- reject a specialty belonging only to another tenant;
- reject self-deactivation and cross-tenant updates.

Add a real transaction rollback assertion by spying only `TenantSpecialtiesService.applySelection` to throw after tenant/admin writes have been issued, calling `OnboardingService.create`, restoring the spy, and querying Prisma to prove neither the tenant contact email nor admin email exists outside the failed transaction.

- [ ] **Step 3: Run the focused suite against the standard exact test database**

Run: `npm run test:e2e -- --runInBand test/specialty-onboarding-team.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 4: Verify the full migration chain on a disposable fresh database**

Create exactly `psic_clinic_specialty_stage_test`, point `DATABASE_URL` to it, run:

```bash
npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
npm run test:e2e -- --runInBand
```

Expected: every migration applied, status current, diff exit `0`, all E2E suites pass. Drop exactly that disposable database after verifying its resolved name; retain development and `psic_clinic_test`.

- [ ] **Step 5: Run API lint and build**

Run: `npm run lint`

Expected: zero errors; existing warning baseline may remain unchanged.

Run: `npm run build`

Expected: Prisma generation and Nest build succeed.

- [ ] **Step 6: Commit**

```bash
git add test
git commit -m "test(api): cover specialty onboarding and team flow"
```

---

### Task 7: Add explicit web contracts, endpoint clients, and query hooks

**Files:**
- Modify: `web/src/types/index.ts`
- Modify: `web/src/lib/constants.ts`
- Modify: `web/src/lib/api/endpoints.ts`
- Modify: `web/src/lib/validations/schemas.ts`
- Create: `web/src/hooks/useSpecialties.ts`
- Test: `web/src/hooks/useSpecialties.test.tsx`
- Test: `web/src/lib/validations/onboarding.test.ts`

**Interfaces:**
- Produces `specialtyCatalogApi`, `tenantSpecialtiesApi`, `tenantModulesApi` and `onboardingApi`.
- Produces hooks `useSpecialtyCatalog`, `useTenantSpecialties`, `useReplaceTenantSpecialties`, `useTenantModules`, `useSetTenantModule`.
- Produces `clinicOnboardingSchema` and `tenantTeamMemberSchema` for Tasks 8 and 10.

- [ ] **Step 1: Create the web worktree and verify its baseline**

From the web repository, verify `.worktrees` is ignored, then create the branch/worktree from `codex/professional-profiles`. Run `npm install`, `npm run lint`, `npm run type-check`, `npm test` and `npm run build` before editing.

Expected baseline: lint/type-check/build pass and 18 tests pass.

- [ ] **Step 2: Write failing schema and hook tests**

```ts
it('requires a selected admin specialty only when the admin provides care', () => {
  expect(clinicOnboardingSchema.safeParse(base({ adminProvidesCare: false })).success).toBe(true);
  expect(clinicOnboardingSchema.safeParse(base({
    adminProvidesCare: true,
    adminSpecialtyCode: undefined,
  })).success).toBe(false);
  expect(clinicOnboardingSchema.safeParse(base({
    specialtyCodes: ['PSYCHOLOGY'],
    adminProvidesCare: true,
    adminSpecialtyCode: 'NUTRITION',
  })).success).toBe(false);
});

it('requires one specialty for a professional team member', () => {
  expect(tenantTeamMemberSchema.safeParse(member({
    role: UserRole.PROFESIONAL,
    professionalProfile: undefined,
  })).success).toBe(false);
});
```

In `useSpecialties.test.tsx`, render each mutation hook with a real `QueryClient`, mock only the HTTP client boundary, seed cached tenant-specialty/module/subscription/usage data, execute the mutation and assert those queries become invalidated. The test must fail because the hooks do not exist, not because the provider is missing.

- [ ] **Step 3: Define transport types without overloading existing `Specialty`**

Add exact types:

```ts
export interface SpecialtyCatalogItem extends Specialty {
  modules: SpecialtyModule[];
}

export interface SpecialtyPricingSummary {
  includedSpecialties: number;
  selectedSpecialties: number;
  billableSpecialties: number;
  specialtyUnitPrice: number;
  basePlanPrice: number;
  featureAddonsPrice: number;
  specialtyAddonsPrice: number;
  totalMonthly: number;
  currency: string;
}

export interface SpecialtySelectionResult {
  tenantId: string;
  specialties: SpecialtyCatalogItem[];
  modules: TenantModule[];
  pricing: SpecialtyPricingSummary;
}

export interface ClinicOnboardingResult {
  tenant: Tenant;
  admin: User;
  specialties: SpecialtyCatalogItem[];
  modules: TenantModule[];
  pricing: SpecialtyPricingSummary;
}
```

Add the onboarding input fields exactly as the API DTO. Extend normalized `Subscription` with optional specialty pricing metadata derived from raw `includedSpecialties`, `specialtyPrice` and `specialties.length` for the pre-save preview.

- [ ] **Step 4: Implement separated clients and use `PUT`**

```ts
export const specialtyCatalogApi = {
  list: () => apiClient.get<SpecialtyCatalogItem[]>(API_ENDPOINTS.SPECIALTY_CATALOG),
};

export const tenantSpecialtiesApi = {
  list: () => apiClient.get<Specialty[]>(API_ENDPOINTS.TENANT_SPECIALTIES(getTenantId())),
  replace: (specialtyCodes: string[]) =>
    apiClient.put<SpecialtySelectionResult>(
      API_ENDPOINTS.TENANT_SPECIALTIES(getTenantId()),
      { specialtyCodes },
    ),
};

export const tenantModulesApi = {
  list: () => apiClient.get<TenantModule[]>(API_ENDPOINTS.TENANT_MODULES(getTenantId())),
  setEnabled: (moduleKey: string, enabled: boolean) =>
    apiClient.patch<TenantModule>(
      API_ENDPOINTS.TENANT_MODULE(getTenantId(), moduleKey),
      { enabled },
    ),
};

export const onboardingApi = {
  createClinic: (input: CreateClinicOnboardingInput) =>
    apiClient.post<ClinicOnboardingResult>(API_ENDPOINTS.CLINIC_ONBOARDING, input),
};
```

Keep the old `specialtiesApi` export as a compatibility façade until all current consumers migrate; its `setForTenant` delegates to `tenantSpecialtiesApi.replace`.

- [ ] **Step 5: Implement the hooks and pass their invalidation tests**

`useReplaceTenantSpecialties` must invalidate tenant specialties, modules, subscription, usage and tenant queries. `useSetTenantModule` invalidates modules. Use a real `QueryClient` and mocked endpoint functions, following `useProfile.test.tsx`.

Run: `npm test -- src/hooks/useSpecialties.test.tsx src/lib/validations/onboarding.test.ts`

Expected: PASS.

- [ ] **Step 6: Run type-check and commit**

Run: `npm run type-check`

Expected: PASS.

```bash
git add src/types/index.ts src/lib/constants.ts src/lib/api/endpoints.ts src/lib/validations/schemas.ts src/hooks/useSpecialties.ts src/hooks/useSpecialties.test.tsx src/lib/validations/onboarding.test.ts
git commit -m "feat(web): add specialty onboarding contracts"
```

---

### Task 8: Replace the onboarding placeholder with the multiespecialty wizard

**Files:**
- Create: `web/src/features/onboarding/onboarding-wizard.tsx`
- Test: `web/src/features/onboarding/onboarding-wizard.test.tsx`
- Modify: `web/src/app/onboarding/page.tsx`

**Interfaces:**
- Consumes `useSpecialtyCatalog`, `onboardingApi.createClinic`, `authApi.login` and `clinicOnboardingSchema`.
- Page becomes a thin wrapper rendering `OnboardingWizard`.

- [ ] **Step 1: Write failing UI tests for conditional flow and final payload**

Mock catalog with Psychology and Nutrition. Test:

```ts
it('does not send clinical fields for a non-clinical administrator', async () => {
  renderWizard();
  await completeClinicStep();
  await selectSpecialties(['PSYCHOLOGY']);
  await completeAdminStep({ adminProvidesCare: false });
  await confirmCreation();
  expect(onboardingApi.createClinic).toHaveBeenCalledWith(
    expect.objectContaining({
      specialtyCodes: ['PSYCHOLOGY'],
      adminProvidesCare: false,
    }),
  );
  expect(onboardingApi.createClinic.mock.calls[0][0]).not.toHaveProperty('adminSpecialtyCode');
});

it('offers only selected specialties to a clinical administrator', async () => {
  renderWizard();
  await selectSpecialties(['NUTRITION']);
  await chooseProvidesCare();
  expect(screen.getByRole('option', { name: 'Nutrición' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Psicología' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component test and confirm red**

Run: `npm test -- src/features/onboarding/onboarding-wizard.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Build one validated form with four visible steps**

Use one `useForm<ClinicOnboardingFormData>` so values do not need lossy merging. Step validation uses `trigger` with exact field lists:

- clinic: `clinicName`, `contactEmail`, `contactPhone`, `timezone`, `locale`;
- specialties: `specialtyCodes`;
- admin: identity/password, `adminProvidesCare` and conditional professional fields;
- confirmation: read-only summary and final submit.

Use catalog query loading/error states. A checkbox selection must never allow advancing with an empty list.

- [ ] **Step 4: Submit once, then authenticate**

On final submit:

```ts
const payload = clinicOnboardingSchema.parse(values);
await onboardingApi.createClinic(payload);
const session = await authApi.login({
  email: payload.adminEmail,
  password: payload.adminPassword,
});
apiClient.setTokens(session.accessToken, session.refreshToken);
const tenant = await tenantsApi.get(session.user.tenantId);
setAuth(session.user, tenant);
router.replace('/dashboard');
```

Do not call the old `complete-onboarding` endpoint. Do not retry tenant creation automatically after it succeeds; if login fails, show that the clinic was created and direct the user to login.

- [ ] **Step 5: Make the page a wrapper and pass tests**

```tsx
import { OnboardingWizard } from '@/features/onboarding/onboarding-wizard';

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
```

Run: `npm test -- src/features/onboarding/onboarding-wizard.test.tsx`

Expected: PASS.

Run: `npm run type-check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/onboarding src/app/onboarding/page.tsx
git commit -m "feat(web): add multiespecialty onboarding wizard"
```

---

### Task 9: Let administrators add/remove specialties and control modules

**Files:**
- Create: `web/src/features/admin/specialties/specialty-manager.tsx`
- Test: `web/src/features/admin/specialties/specialty-manager.test.tsx`
- Modify: `web/src/app/(dashboard)/admin/specialties/page.tsx`

**Interfaces:**
- Consumes the Task 7 specialty hooks and normalized subscription pricing metadata.
- Page becomes a thin admin wrapper.

- [ ] **Step 1: Write failing manager tests**

Cover:

```ts
it('renders catalog entries that are not yet enabled', () => {
  renderManager({ catalog: [psychology, nutrition], enabled: [psychology] });
  expect(screen.getByText('Nutrición')).toBeInTheDocument();
  expect(screen.getByText('Inactiva')).toBeInTheDocument();
});

it('keeps the attempted selection when the API blocks removal', async () => {
  replace.mockRejectedValue({
    code: 'SPECIALTY_IN_USE_BY_ACTIVE_PROFESSIONAL',
    message: 'La especialidad tiene profesionales activos.',
  });
  renderManager({ catalog: [psychology, nutrition], enabled: [psychology, nutrition] });
  await user.click(screen.getByRole('button', { name: /Psicología/ }));
  await user.click(screen.getByRole('button', { name: 'Guardar especialidades' }));
  expect(screen.getByText('La especialidad tiene profesionales activos.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Psicología/ })).toHaveAttribute('aria-pressed', 'false');
});

it('shows and toggles modules only for selected specialties', async () => {
  renderManager({ catalog: [psychology, nutrition], enabled: [psychology] });
  expect(screen.getByRole('checkbox', { name: 'psychology.assessments' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'nutrition.assessments' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: 'psychology.assessments' }));
  expect(setModuleEnabled).toHaveBeenCalledWith({
    moduleKey: 'psychology.assessments',
    enabled: false,
  });
});
```

- [ ] **Step 2: Run the test and confirm red**

Run: `npm test -- src/features/admin/specialties/specialty-manager.test.tsx`

Expected: FAIL because the manager does not exist.

- [ ] **Step 3: Implement independent catalog, selection and module states**

Initialize selected codes only after both catalog and tenant selection resolve. Do not overwrite local edits during background refetch. Render every catalog item with `aria-pressed` and prevent saving zero specialties.

Calculate the preview with:

```ts
const billable = Math.max(0, selectedCodes.length - includedSpecialties);
const specialtyAddonsPrice = billable * specialtyUnitPrice;
```

Label the preview as estimated; replace it with the authoritative `pricing` returned after save.

- [ ] **Step 4: Render module switches only for selected specialty modules**

Map catalog module keys to tenant module state. Each switch calls `useSetTenantModule`; disable it while pending and restore server state after error. Do not expose keys belonging only to unselected specialties.

- [ ] **Step 5: Preserve server errors and refresh dependent queries**

Show `ApiError.message` in an `Alert`. Do not reset selection on error. On success, adopt `result.specialties.map(code)`, display canonical price and rely on Task 7 invalidations.

- [ ] **Step 6: Pass tests, lint the file and commit**

Run: `npm test -- src/features/admin/specialties/specialty-manager.test.tsx`

Run: `npm run lint`

Expected: PASS with zero warnings.

```bash
git add src/features/admin/specialties 'src/app/(dashboard)/admin/specialties/page.tsx'
git commit -m "feat(web): manage tenant specialties and modules"
```

---

### Task 10: Add direct team creation and separate account/clinical state

**Files:**
- Create: `web/src/features/admin/team/team-member-dialog.tsx`
- Create: `web/src/features/admin/team/team-manager.tsx`
- Test: `web/src/features/admin/team/team-member-dialog.test.tsx`
- Test: `web/src/features/admin/team/team-manager.test.tsx`
- Modify: `web/src/app/(dashboard)/admin/team/page.tsx`
- Modify: `web/src/lib/api/endpoints.ts`
- Modify: `web/src/types/index.ts`

**Interfaces:**
- Consumes enabled tenant specialties, `usersApi.create/update/delete` and `tenantTeamMemberSchema`.
- `usersApi.create` accepts `CreateTenantUserInput` with required password and no `tenantId`.

- [ ] **Step 1: Write failing role-conditional form tests**

```ts
it('requires specialty for PROFESIONAL and sends one profile', async () => {
  renderDialog({ specialties: [psychology] });
  await fillIdentityAndPassword();
  await user.selectOptions(screen.getByLabelText('Rol'), 'PROFESIONAL');
  await user.click(screen.getByRole('button', { name: 'Crear miembro' }));
  expect(screen.getByText('Selecciona una especialidad')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Especialidad'), psychology.id);
  await user.click(screen.getByRole('button', { name: 'Crear miembro' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    role: UserRole.PROFESIONAL,
    professionalProfile: { specialtyId: psychology.id, isActive: true },
  }));
});

it('never sends a professional profile for ASISTENTE', async () => {
  renderDialog({ specialties: [psychology] });
  await chooseRole('ASISTENTE');
  await submitValidMember();
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('professionalProfile');
});
```

- [ ] **Step 2: Write failing manager action tests**

Verify that disabling clinical care calls PATCH with `professionalProfile.isActive = false`, while deactivating account uses DELETE. Verify server error `LAST_ACTIVE_ADMIN_REQUIRED` remains visible and does not remove the row.

- [ ] **Step 3: Run tests and confirm red**

Run: `npm test -- src/features/admin/team`

Expected: FAIL because components do not exist.

- [ ] **Step 4: Tighten user transport types**

```ts
export type CreateTenantUserInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: UserRole.ADMIN | UserRole.PROFESIONAL | UserRole.ASISTENTE;
  professionalProfile?: {
    specialtyId: string;
    professionalTitle?: string;
    licenseNumber?: string;
    bio?: string;
    isActive: boolean;
  };
};
```

Make `usersApi.create` accept only this type. Add a narrower `UpdateTenantUserInput` without password unless the API explicitly supports it. Never add `tenantId` or `managedByProvider` to either payload.

- [ ] **Step 5: Implement dialog and manager**

Use the existing `Dialog`, `Select`, inputs and badges. For an admin, expose “También atiende pacientes”; when false omit the profile. For a professional, force the profile active at creation. For an assistant, clear all professional fields when role changes.

The manager table shows:

- name/email;
- role;
- specialty or “Sin perfil clínico”;
- account badge active/inactive;
- clinical badge active/inactive/not applicable;
- edit, toggle clinical state and deactivate/reactivate actions allowed by API.

Do not use `managedByProvider` to disable ordinary actions.

- [ ] **Step 6: Wire query invalidation and seat display**

After create/update/deactivate, invalidate users, subscription and usage keys. Continue counting effective active profiles with `countActiveProfessionalProfiles`. Render the API usage limit when available; do not infer capacity from one paginated page.

- [ ] **Step 7: Pass tests and commit**

Run: `npm test -- src/features/admin/team`

Run: `npm run type-check`

Expected: PASS.

```bash
git add src/features/admin/team 'src/app/(dashboard)/admin/team/page.tsx' src/lib/api/endpoints.ts src/types/index.ts
git commit -m "feat(web): let admins manage clinic teams"
```

---

### Task 11: Verify both branches and compatibility boundaries

**Files:**
- Modify only if a verification failure demonstrates a defect in Stage 3.

**Interfaces:**
- Consumes all prior tasks.
- Produces clean API and web heads ready for independent review/PRs.

- [ ] **Step 1: Run API static and unit verification from the API worktree**

```bash
npm run lint
npm test -- --runInBand
npm run build
git diff --check codex/professional-profiles...HEAD
```

Expected: zero lint errors, all unit suites pass, build passes and diff check is empty.

- [ ] **Step 2: Run complete API E2E against an exact disposable database**

Run the full E2E suite with `DATABASE_URL` resolving exactly to `psic_clinic_specialty_stage_test`. Verify the safety precheck output before test cleanup. Expected: all suites pass; the database is dropped only after exact-name verification.

- [ ] **Step 3: Run web verification from the web worktree**

```bash
npm run lint
npm run type-check
npm test
npm run build
git diff --check codex/professional-profiles...HEAD
```

Expected: zero warnings/errors, all tests pass, 21 or more pages build successfully, diff check empty.

- [ ] **Step 4: Audit compatibility explicitly**

Use searches and focused HTTP tests to confirm:

- legacy `POST /tenants/:tenantId/specialties` and new `PUT` return equivalent results;
- legacy roles remain accepted by role-family helpers;
- no `tenantId` can enter team creation through the body;
- no new account is `managedByProvider = true`;
- no patient, appointment or clinical-record foreign key changed;
- public metadata exists only on catalog/onboarding endpoints added by this stage;
- onboarding/admin responses contain no password.

- [ ] **Step 5: Request independent code review for each repository**

Package API diff from its recorded base to API head and web diff from its recorded base to web head. Require reviewers to report only Critical/Important findings with file/line evidence. Fix accepted findings using TDD and rerun the smallest relevant suite plus the full verification matrix.

- [ ] **Step 6: Record final heads and hand off integration**

Confirm both worktrees are clean and both branches descend from their exact profile-stage bases. Record commit SHAs, test counts, migration result and any explicitly deferred minor issue. Then use the finishing-development-branch workflow to push/create PRs or retain branches according to the user's integration choice.
