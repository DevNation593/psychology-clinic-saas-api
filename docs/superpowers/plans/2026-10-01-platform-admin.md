# Panel de control de plataforma — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un usuario `ADMIN` crea consultorios con su `MASTER`, les asigna secciones de la app, administra su plan y estado y confirma pagos desde un panel propio en `/platform`, sin acceso a los datos internos de ningún consultorio.

**Architecture:** El `ADMIN` pertenece a un consultorio reservado (`Tenant.isPlatform`). Los controladores del panel viven en `src/platform/` bajo `/platform/*` con `@PlatformRoute()`; fuera de ellos el `ADMIN` recibe `PLATFORM_ONLY`. Las secciones son filas `TenantModule` con clave `core.<sección>` que un `SectionGuard` global comprueba con `@RequireSection`. La web añade el grupo de rutas `(platform)` y oculta en el panel del consultorio lo que la sección apaga.

**Tech Stack:** API: NestJS 11, Prisma 6, PostgreSQL, Jest. Web: Next.js 14, React 18, React Query, Zustand, Zod, Vitest + Testing Library.

**Spec:** `api/docs/superpowers/specs/2026-10-01-platform-admin-design.md`

## Global Constraints

- Dos repositorios git independientes: `api/` y `web/`. Ambos ya están en la rama `feat/platform-admin`. No se hace push ni se cambia de rama.
- **No ejecutes `prisma migrate dev`, `prisma migrate deploy`, `prisma db push` ni `npm run prisma:seed`.** `DATABASE_URL` de `api/.env` apunta a una base alojada. Las migraciones se escriben a mano como SQL y solo se ejecuta `npx prisma generate`.
- `npx prisma generate` falla con `EPERM` si hay un servidor del API en marcha con el motor de Prisma abierto. Si ocurre, no cierres procesos: detente e informa.
- Los e2e y verificadores solo corren contra `DATABASE_URL_TEST` (lo valida `test/helpers/assert-e2e-database.ts`). Si no está configurada, repórtalo como "no ejecutado".
- Claves de sección, literales: `core.calendar`, `core.patients`, `core.tasks`, `core.clinicalNotes`, `core.specialties`, `core.billing`, `core.team`, `core.storage`.
- Códigos de error, literales: `PLATFORM_ONLY` (403), `PASSWORD_CHANGE_REQUIRED` (403), `SECTION_NOT_ENABLED` (403), `SECTION_MANAGED_BY_PLATFORM` (403), `SECTION_UNKNOWN` (400), `SECTION_DEPENDENCY` (400), `PLAN_TYPE_MISMATCH` (400), `PASSWORD_UNCHANGED` (400), `PLAN_BELOW_USAGE` (409). Se devuelven como `{ statusCode, code, message, ... }`, igual que `TENANT_SCOPE_VIOLATION`.
- Tras este plan, `SOPORTE` solo aparece en `schema.prisma`, en migraciones SQL, en `role-compatibility.ts` y en la etiqueta de `web/src/lib/constants.ts`.
- La contraseña temporal tiene mínimo 8 caracteres, no se recorta ni se normaliza, y nunca se escribe en logs, `AuditLog.changes`, caché de React Query ni `authStore`.
- Textos visibles en español. Nombre del menú: `Panel de control`. Texto de sección apagada: `Esta sección no está habilitada para tu consultorio`.
- Código, comentarios y commits en inglés. Commits: Conventional Commits terminados con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verificación del API: `npx jest <ruta>` para la tarea y `npx tsc --noEmit -p tsconfig.json` (`npm run lint` está roto, T-15). Web: `npx vitest run <ruta>`, `npm run type-check`, `npm run lint`.

## Desviaciones respecto al spec

1. **RLS.** El plan del rol MASTER comprobó que `pg_policies` está vacío en la base configurada. El panel usa `PrismaService` sin tratamiento especial. La comprobación de `pg_policies` se repite en el despliegue (Tarea 10, documentación).
2. **Cambio de contraseña existente.** La ruta real es `POST tenants/:tenantId/users/me/change-password`, no `PATCH`. Se conserva y también apaga `mustChangePassword`.
3. **Auditor del rol MASTER.** `prisma/audit-master-roles.ts` marca como bloqueo a todo `ADMIN` con consultorio y a todo consultorio sin `MASTER`. El consultorio de plataforma cumpliría ambos, así que el auditor pasa a ignorarlo (Tarea 2). El spec no lo menciona.
4. **Login del ADMIN en la web.** `useLogin` pide `GET /tenants/:tenantId` tras iniciar sesión; para el `ADMIN` eso devuelve `PLATFORM_ONLY`. La web omite esa petición para el `ADMIN` (Tarea 11).
5. **Auditoría del panel.** `AuditLogService` no tiene método de escritura. Se añade `PlatformAuditService` en `src/platform/`.

## Review Focus

1. El `ADMIN` inicia sesión en la web → entra a `/platform` sin error ni aviso, aunque no pueda leer su propio consultorio. *(Tarea 11.)*
2. El `ADMIN` suspende un consultorio ya suspendido, o reactiva uno activo → responde 200 con el estado actual, sin duplicar auditoría ni fallar. *(Tarea 7.)*
3. El correo del nuevo titular coincide con uno existente salvo por mayúsculas, o con el de un `ADMIN` → 409, no un segundo usuario. *(Tarea 6.)*
4. El titular abre una página mientras la consulta de secciones carga o falla → no ve "sección no habilitada" por un instante ni por un error de red; ve carga o el error con reintento. *(Tarea 12.)*
5. El titular tiene una sesión abierta cuando el `ADMIN` le restablece la contraseña → su siguiente petición recibe `PASSWORD_CHANGE_REQUIRED` y la web lo lleva a `/change-password`. *(Tareas 10 y 11.)*

---

## Estructura de archivos

**API, nuevos**

| Archivo | Responsabilidad |
|---|---|
| `src/common/sections/section-catalog.ts` | Catálogo, premarcado por plan, validación de claves y dependencias |
| `src/common/decorators/platform-route.decorator.ts` | `@PlatformRoute()` |
| `src/common/decorators/session-route.decorator.ts` | `@SessionRoute()` |
| `src/common/decorators/require-section.decorator.ts` | `@RequireSection(key)` |
| `src/common/guards/password-change.guard.ts` | 403 `PASSWORD_CHANGE_REQUIRED` |
| `src/common/guards/section.guard.ts` | 403 `SECTION_NOT_ENABLED` |
| `src/platform/platform.module.ts` | Módulo del panel |
| `src/platform/platform-tenants.controller.ts` + `platform-tenants.service.ts` | Alta, listado, ficha, cuenta, estado, secciones, contraseña |
| `src/platform/platform-subscription.service.ts` | Cambio de plan |
| `src/platform/platform-summary.controller.ts` + `platform-summary.service.ts` | Resumen |
| `src/platform/platform-payments.controller.ts` | Pagos |
| `src/platform/platform-legacy-access.controller.ts` | Endpoints heredados |
| `src/platform/platform-audit.service.ts` | Escritura de `AuditLog` del panel |
| `src/platform/dto/*.dto.ts` | DTOs del panel |
| `prisma/migrations/20261006000000_platform_admin_sections/migration.sql` | Esquema y relleno |
| `prisma/create-platform-admin.ts`, `prisma/audit-platform-sections.ts`, `prisma/verify-platform-sections.ts` | Scripts |

**API, eliminados:** `src/onboarding/` completo, `src/subscription/subscription-payments.controller.ts`, `src/users/provider-admin.controller.ts`.

**Web, nuevos**

| Archivo | Responsabilidad |
|---|---|
| `src/hooks/useSections.ts`, `src/components/layout/section-gate.tsx` | Secciones en el panel del consultorio |
| `src/app/change-password/page.tsx` | Cambio obligatorio |
| `src/app/(platform)/layout.tsx`, `src/components/layout/platform-sidebar.tsx` | Carcasa del panel |
| `src/app/(platform)/platform/page.tsx`, `tenants/page.tsx`, `tenants/new/page.tsx`, `tenants/[tenantId]/page.tsx`, `payments/page.tsx` | Páginas |
| `src/features/platform/*` | Componentes del panel |
| `src/hooks/usePlatform.ts` | Hooks de React Query del panel |

**Web, eliminados:** `src/features/onboarding/`.

---

## Parte A — API

### Task 1: Esquema, migración y catálogo de secciones

**Files:**
- Modify: `api/prisma/schema.prisma` (`Tenant`, `User`, comentarios de `UserRole`)
- Create: `api/prisma/migrations/20261006000000_platform_admin_sections/migration.sql`
- Create: `api/src/common/sections/section-catalog.ts`
- Test: `api/src/common/sections/section-catalog.spec.ts`

**Interfaces:**
- Produces:

```ts
export const SECTION_KEYS: readonly ['core.calendar','core.patients','core.tasks','core.clinicalNotes','core.specialties','core.billing','core.team','core.storage'];
export type SectionKey = (typeof SECTION_KEYS)[number];
export interface SectionDefinition { key: SectionKey; name: string; requires: SectionKey[] }
export const SECTION_CATALOG: readonly SectionDefinition[];
export function isSectionKey(value: string): value is SectionKey;
export function defaultSections(planType: PlanType, tenantType: TenantType): SectionKey[];
/** Deduplicates; throws BadRequestException SECTION_UNKNOWN { section } or SECTION_DEPENDENCY { section, requires }. */
export function validateSections(keys: string[]): SectionKey[];
export function isPlanAllowedForTenantType(planType: PlanType, tenantType: TenantType): boolean;
```

- [ ] **Step 1: Write the failing tests** in `section-catalog.spec.ts`

```ts
it('names the eight sections', () => {
  expect(SECTION_CATALOG.map((s) => s.name)).toEqual([
    'Calendario', 'Pacientes', 'Tareas', 'Notas clínicas', 'Módulos clínicos', 'Facturación', 'Equipo', 'Almacenamiento',
  ]);
});
it('preselects everything but tasks and team for a personal trial', () => {
  expect(defaultSections('TRIAL', 'PERSONAL')).toEqual([
    'core.calendar', 'core.patients', 'core.clinicalNotes', 'core.specialties', 'core.billing', 'core.storage',
  ]);
});
it('adds team for clinics and tasks for paid plans', () => {
  expect(defaultSections('TRIAL', 'CLINIC')).toContain('core.team');
  expect(defaultSections('TRIAL', 'CLINIC')).not.toContain('core.tasks');
  expect(defaultSections('CLINIC_BASIC', 'CLINIC')).toEqual([...SECTION_KEYS]);
  expect(defaultSections('PERSONAL_PRO', 'PERSONAL')).not.toContain('core.team');
});
it('rejects unknown keys', () => {
  expect(() => validateSections(['core.nope'])).toThrow(expect.objectContaining({
    response: expect.objectContaining({ code: 'SECTION_UNKNOWN', section: 'core.nope' }),
  }));
});
it.each(['core.calendar', 'core.tasks', 'core.clinicalNotes', 'core.specialties'])('%s requires patients', (key) => {
  expect(() => validateSections([key])).toThrow(expect.objectContaining({
    response: expect.objectContaining({ code: 'SECTION_DEPENDENCY', section: key, requires: ['core.patients'] }),
  }));
});
it('accepts an empty list and removes duplicates', () => {
  expect(validateSections([])).toEqual([]);
  expect(validateSections(['core.billing', 'core.billing'])).toEqual(['core.billing']);
});
it('matches plans to tenant types', () => {
  expect(isPlanAllowedForTenantType('TRIAL', 'PERSONAL')).toBe(true);
  expect(isPlanAllowedForTenantType('TRIAL', 'CLINIC')).toBe(true);
  expect(isPlanAllowedForTenantType('PERSONAL_PRO', 'CLINIC')).toBe(false);
  expect(isPlanAllowedForTenantType('CLINIC_ENTERPRISE', 'PERSONAL')).toBe(false);
});
```

- [ ] **Step 2: Run** `npx jest src/common/sections` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `section-catalog.ts`.** `core.tasks` se premarca cuando `getPlanIncludedModules(planType)` (de `subscription-pricing.ts`) incluye `'tasks'`; `core.team` cuando `tenantType === 'CLINIC'`. `defaultSections` devuelve las claves en el orden de `SECTION_KEYS`.

- [ ] **Step 4: Run** `npx jest src/common/sections` — Expected: PASS.

- [ ] **Step 5: Edit `schema.prisma`.** Añade `isPlatform Boolean @default(false)` a `Tenant` y `mustChangePassword Boolean @default(false)` a `User`. Comentario de `ADMIN`: `// Administrador de la plataforma. Solo accede al panel de control.`; de `SOPORTE`: `// Obsoleto: sus funciones pasaron a ADMIN.`

- [ ] **Step 6: Write `migration.sql`** con este contenido exacto:

```sql
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
```

- [ ] **Step 7: Run** `npx prisma generate` y `npx tsc --noEmit -p tsconfig.json` — Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261006000000_platform_admin_sections src/common/sections
git commit -m "feat(api): add the platform tenant flag, forced password change and the section catalog"
```

---

### Task 2: Scripts de plataforma, auditor y seed

**Files:**
- Create: `api/prisma/create-platform-admin.ts`, `api/prisma/audit-platform-sections.ts`, `api/prisma/verify-platform-sections.ts`
- Modify: `api/prisma/audit-master-roles.ts`, `api/prisma/seed.ts`, `api/package.json`
- Test: `api/test/platform-sections-migration.spec.ts`, `api/test/master-role-migration.spec.ts`

**Interfaces:**
- Consumes: `SECTION_KEYS` (Tarea 1).
- Produces:

```ts
// audit-platform-sections.ts
export interface PlatformSectionsAudit {
  tenantsWithMissingSections: string[];   // tenant ids
  platformTenants: string[];              // ids; more than one is a blocker
  adminsOutsidePlatform: string[];        // user ids
  activeSupportUsers: string[];           // user ids
}
export function auditPlatformSections(client: Pick<PrismaClient, 'tenant' | 'user' | 'tenantModule'>): Promise<PlatformSectionsAudit>;
export function hasBlockingIssues(audit: PlatformSectionsAudit): boolean;
// create-platform-admin.ts
export function createPlatformAdmin(client: PrismaClient, input: { email: string; password: string; firstName: string; lastName: string }): Promise<{ tenantId: string; userId: string }>;
```

- [ ] **Step 1: Write the failing tests** en `platform-sections-migration.spec.ts`, con un cliente falso como el de `master-role-migration.spec.ts`:

```ts
it('reports a clean database as non-blocking', ...)           // 1 tenant with 8 rows, 1 platform tenant with an ADMIN
it('flags a clinic with fewer than eight section rows', ...)   // tenantsWithMissingSections: ['t1']
it('ignores the platform tenant when counting sections', ...)  // platform tenant has 0 rows, no finding
it('flags a second platform tenant', ...)                      // platformTenants.length === 2 → blocking
it('flags an ADMIN outside the platform tenant', ...)
it('flags an active SOPORTE user and ignores inactive ones', ...)
it('exposes isPlatform and mustChangePassword in the generated client', () => {
  const model = (name: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
  expect(model('Tenant').fields.map((f) => f.name)).toContain('isPlatform');
  expect(model('User').fields.map((f) => f.name)).toContain('mustChangePassword');
});
```

Y en `master-role-migration.spec.ts`:

```ts
it('ignores the platform tenant and its ADMIN users', ...) // tenantsWithoutMaster: [], tenantAdmins: []
```

- [ ] **Step 2: Run** `npx jest test/platform-sections-migration.spec.ts test/master-role-migration.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `audit-platform-sections.ts` y `verify-platform-sections.ts`.** El verificador sigue el patrón de `verify-master-role-migration.ts`: imprime el resultado en JSON y termina con código 1 si `hasBlockingIssues`.

- [ ] **Step 4: Modify `audit-master-roles.ts`** para excluir consultorios con `isPlatform: true` de `tenantsWithoutMaster`/`tenantsWithoutClinicUsers` y a sus usuarios de `tenantAdmins`.

- [ ] **Step 5: Implement `create-platform-admin.ts`.** Lee `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_FIRST_NAME`, `PLATFORM_ADMIN_LAST_NAME`; falla con mensaje claro si falta alguna o si la contraseña tiene menos de 8 caracteres. Reutiliza el consultorio con `isPlatform: true` o lo crea con `name: 'Plataforma'`, `email` = el del admin, `onboardingCompleted: true`, sin `TenantSettings` ni `TenantSubscription`. Falla si ya existe un usuario con ese correo (comparación sin distinguir mayúsculas). Usuario: `role: 'ADMIN'`, `isActive: true`, `emailVerified: true`, `mustChangePassword: false`, contraseña con bcrypt a 10 rondas.

- [ ] **Step 6: Add scripts a `package.json`:** `"platform:create-admin": "ts-node prisma/create-platform-admin.ts"` y `"prisma:verify-platform-sections": "ts-node prisma/verify-platform-sections.ts"`.

- [ ] **Step 7: Modify `seed.ts`.** Crea el consultorio de plataforma con un `ADMIN` (`admin@plataforma.test`, la contraseña de demo del seed) mediante `createPlatformAdmin`, y para cada consultorio de demostración crea las ocho filas de sección con `defaultSections(planType, tenantType)`, sin duplicar las `core.*` que el seed ya inserta.

- [ ] **Step 8: Run** `npx jest test/platform-sections-migration.spec.ts test/master-role-migration.spec.ts test/demo-specialty-seed.spec.ts test/seed-demo-specialties.spec.ts` y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS.

- [ ] **Step 9: Commit** `feat(api): add platform admin bootstrap and section verification scripts`

---

### Task 3: Reglas de acceso de plataforma y cambio obligatorio de contraseña

**Files:**
- Create: `api/src/common/decorators/platform-route.decorator.ts`, `session-route.decorator.ts`, `api/src/common/guards/password-change.guard.ts`
- Modify: `api/src/common/decorators/current-user.decorator.ts`, `api/src/auth/strategies/jwt.strategy.ts`, `api/src/common/guards/tenant.guard.ts`, `subscription.guard.ts`, `feature.guard.ts`, `api/src/auth/auth.module.ts`, `api/src/auth/auth.controller.ts`
- Test: `api/src/common/guards/tenant.guard.spec.ts`, `subscription.guard.spec.ts`, `feature.guard.spec.ts`, `password-change.guard.spec.ts`

**Interfaces:**
- Produces:

```ts
export const PLATFORM_ROUTE_KEY = 'platformRoute';   export const PlatformRoute = () => SetMetadata(PLATFORM_ROUTE_KEY, true);
export const SESSION_ROUTE_KEY = 'sessionRoute';     export const SessionRoute = () => SetMetadata(SESSION_ROUTE_KEY, true);
export interface AuthUser { userId: string; tenantId: string; email: string; role: string; isPlatformTenant: boolean; mustChangePassword: boolean }
```

- Orden de guards en `auth.module.ts`: `JwtAuthGuard`, `PasswordChangeGuard`, `TenantGuard`, `RolesGuard`, `SubscriptionGuard`, `FeatureGuard`.

- [ ] **Step 1: Write the failing tests**

`tenant.guard.spec.ts`:

```ts
it('lets a platform ADMIN into a platform route with another tenant id in the params', ...)
it.each(['MASTER', 'PROFESIONAL', 'ASISTENTE', 'SOPORTE'])('rejects %s on a platform route', ...)       // ForbiddenException
it('rejects an ADMIN whose tenant is not the platform tenant on a platform route', ...)
it('rejects an ADMIN outside the platform with PLATFORM_ONLY', ...)                                     // response.code === 'PLATFORM_ONLY'
it('lets an ADMIN through a session route', ...)
it('no longer lets SOPORTE reach another tenant', ...)                                                   // TENANT_SCOPE_VIOLATION
```

`subscription.guard.spec.ts` y `feature.guard.spec.ts`:

```ts
it('applies the subscription rules to SOPORTE', ...)            // no bypass
it('skips the check on a platform route', ...)                   // prisma never queried
it('skips the check on a session route', ...)        // a past-due clinic can still log out and change the password
```

`password-change.guard.spec.ts`:

```ts
it('lets a user without the flag through', ...)
it('blocks a flagged user with PASSWORD_CHANGE_REQUIRED', ...)   // 403, response.code
it('lets a flagged user reach a session route', ...)
it('lets public routes through', ...)
```

- [ ] **Step 2: Run** `npx jest src/common/guards` — Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `JwtStrategy.validate` añade `isPlatformTenant: user.tenant.isPlatform` y `mustChangePassword: user.mustChangePassword` al objeto devuelto.
  - `TenantGuard`: elimina el bloque de `SOPORTE`. Tras la comprobación de `user.tenantId`: en ruta de plataforma exige `role === 'ADMIN' && isPlatformTenant`, fija `request.tenantId = user.tenantId` y el contexto RLS, y devuelve `true` sin comparar `params.tenantId` ni `body.tenantId`. Fuera de ella, si `role === 'ADMIN'` y la ruta no es de sesión, lanza 403 `{ code: 'PLATFORM_ONLY', message: 'Esta cuenta solo tiene acceso al panel de control.' }`.
  - `SubscriptionGuard` y `FeatureGuard`: eliminan el bloque de `SOPORTE` y devuelven `true` en ruta de plataforma y en ruta de sesión.
  - `PasswordChangeGuard`: mensaje `Debes cambiar tu contraseña temporal antes de continuar.`
  - `auth.controller.ts`: `@SessionRoute()` en `logout` y `logoutAll`.

- [ ] **Step 4: Run** `npx jest src/common/guards src/auth` y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS. Los specs que construyen un `AuthUser` a mano se completan con los dos campos nuevos.

- [ ] **Step 5: Commit** `feat(api): confine ADMIN to platform routes and drop the SOPORTE bypasses`

---

### Task 4: `POST /auth/change-password` y el indicador en la sesión

**Files:**
- Modify: `api/src/auth/auth.service.ts`, `api/src/auth/auth.controller.ts`, `api/src/auth/dto/auth.dto.ts`, `api/src/users/users.service.ts`
- Test: `api/src/auth/auth.change-password.spec.ts`, `api/src/users/users.service.spec.ts`, `api/src/auth/auth.password-reset.spec.ts`

**Interfaces:**
- Consumes: `SessionRoute`, `AuthUser` (Tarea 3).
- Produces: `AuthService.changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<void>`; `AuthResponseDto.user.mustChangePassword: boolean`; DTO `ChangeOwnPasswordDto { currentPassword: string; newPassword: string /* MinLength(8) */ }`.

- [ ] **Step 1: Write the failing tests**

```ts
// auth.change-password.spec.ts
it('stores the new hash and clears mustChangePassword', ...)
it('rejects a wrong current password with 401', ...)
it('rejects a new password equal to the current one with PASSWORD_UNCHANGED', ...)   // 400
it('returns mustChangePassword in the login response', ...)
it('returns mustChangePassword in the refresh response', ...)
// users.service.spec.ts
it('clears mustChangePassword when the user changes the password from the profile', ...)
// auth.password-reset.spec.ts
it('clears mustChangePassword after a reset by e-mail', ...)
```

- [ ] **Step 2: Run** `npx jest src/auth src/users/users.service.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** `POST /auth/change-password` lleva `@SessionRoute()`, `@HttpCode(200)` y usa `@CurrentUser()`. `changeOwnPassword`, `UsersService.changePassword` y `resetPassword` escriben `mustChangePassword: false` junto con el nuevo hash. `login` y `refreshTokens` incluyen `mustChangePassword` en `user`.

- [ ] **Step 4: Run** los mismos comandos y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): add self-service password change that clears the temporary password flag`

---

### Task 5: Aplicación de secciones en el consultorio

**Files:**
- Create: `api/src/common/decorators/require-section.decorator.ts`, `api/src/common/guards/section.guard.ts`
- Modify: `api/src/auth/auth.module.ts`, `api/src/common/guards/feature.guard.ts`, los controladores de la tabla, `api/src/specialties/tenant-specialties.service.ts`
- Test: `api/src/common/guards/section.guard.spec.ts`, `api/src/common/sections/section-matrix.spec.ts`, `api/src/common/guards/feature.guard.spec.ts`, `api/src/specialties/tenant-specialties.service.spec.ts`

**Interfaces:**
- Consumes: `SectionKey` (Tarea 1), `PLATFORM_ROUTE_KEY` (Tarea 3).
- Produces: `REQUIRE_SECTION_KEY = 'requireSection'`, `RequireSection(key: SectionKey)`. `SectionGuard` se registra después de `FeatureGuard`.

| Clave | Dónde va `@RequireSection` |
|---|---|
| `core.calendar` | clase `AppointmentsController` |
| `core.patients` | clases `PatientsController`, `PatientTeamController` |
| `core.tasks` | clase `TasksController` (sustituye a `@RequireFeature('tasks')`) |
| `core.clinicalNotes` | clases `ClinicalNotesController`, `ClinicalTimelineController` (sustituye a `@RequireFeature('clinicalNotes')`), `NextSessionPlansController` |
| `core.specialties` | clase `SpecialtyRecordsController`; handlers `setSpecialties`, `setSpecialtiesLegacy`, `updateModule` de `SpecialtiesController` |
| `core.billing` | clase `BillingController` |
| `core.team` | handlers `create`, `update`, `deactivate`, `activate` de `UsersController` |

- [ ] **Step 1: Write the failing tests**

`section.guard.spec.ts`:

```ts
it('passes when the route requires no section', ...)                 // prisma not queried
it('passes when the section row is enabled', ...)
it('rejects a disabled section with SECTION_NOT_ENABLED', ...)       // 403, response { code, section: 'core.tasks' }
it('rejects when the tenant has no row for the section', ...)
it('skips platform routes', ...)
```

`section-matrix.spec.ts` (mismo estilo que `role-matrix.spec.ts`, leyendo metadatos con `Reflect.getMetadata(REQUIRE_SECTION_KEY, ...)`): una fila por cada entrada de la tabla anterior, más:

```ts
it.each(['findAll', 'findOne', 'updateSelf', 'uploadAvatar', 'changePassword'])('UsersController.%s requires no section', ...)
it.each(['listSpecialties', 'listModules'])('SpecialtiesController.%s requires no section', ...)
```

`feature.guard.spec.ts`:

```ts
it('ignores core.* rows and decides webPush from the subscription flag', ...)
```

`tenant-specialties.service.spec.ts`:

```ts
it('rejects changing a core.* key with SECTION_MANAGED_BY_PLATFORM', ...)        // 403, before any query
it('never deletes or creates core.* rows when the specialty selection changes', ...)
```

- [ ] **Step 2: Run** `npx jest src/common src/specialties` — Expected: FAIL.

- [ ] **Step 3: Implement.** `SectionGuard` usa `tenantModule.findUnique({ where: { tenantId_moduleKey } })`; mensaje `Esta sección no está habilitada para tu consultorio.`. `FeatureGuard` consulta solo `moduleKey: requiredFeature` (sin el prefijo `core.`). En `tenant-specialties.service.ts`, `updateModule` rechaza claves que empiecen por `core.` y `applySelection` filtra esas claves de `removeKeys` y `addKeys`.

- [ ] **Step 4: Run** `npx jest src` y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): enforce the sections assigned to each clinic`

---

### Task 6: Alta de consultorio desde el panel y cierre del registro público

**Files:**
- Create: `api/src/platform/platform.module.ts`, `platform-tenants.controller.ts`, `platform-tenants.service.ts`, `platform-audit.service.ts`, `dto/create-platform-tenant.dto.ts`
- Delete: `api/src/onboarding/` (controlador, servicio, módulo, DTO y specs)
- Modify: `api/src/app.module.ts`, `api/src/tenants/tenants.controller.ts`, `tenants.service.ts`, `tenants.module.ts`, `dto/tenant.dto.ts`, `api/test/helpers/create-test-tenant.ts`
- Test: `api/src/platform/platform-tenants.service.spec.ts`

**Interfaces:**
- Consumes: `defaultSections`, `validateSections`, `isPlanAllowedForTenantType`, `SECTION_CATALOG` (Tarea 1); `PlatformRoute` (Tarea 3).
- Produces:

```ts
export class CreatePlatformTenantDto {
  name: string; email: string; phone?: string; address?: string;
  tenantType: TenantType; timezone: string; locale: string;
  masterFirstName: string; masterLastName: string; masterEmail: string;
  temporaryPassword: string;        // MinLength(8), not trimmed
  planType: PlanType;
  specialtyCodes: string[];         // ArrayMinSize(1)
  sections?: string[];
}
export interface PlatformTenantDetail {
  tenant: { id: string; name: string; email: string; phone: string | null; address: string | null; tenantType: TenantType; isActive: boolean; createdAt: Date };
  master: { id: string; firstName: string; lastName: string; email: string; mustChangePassword: boolean } | null;
  subscription: { planType: PlanType; status: SubscriptionStatus; trialEndsAt: Date | null; currentPeriodStart: Date; currentPeriodEnd: Date | null; seatsPsychologistsMax: number; maxActivePatients: number; basePrice: number; currency: string };
  usage: { seatsPsychologistsUsed: number; activePatientsCount: number; monthlyNotificationsSent: number };
  specialties: { id: string; code: string; name: string }[];
  sections: { key: SectionKey; name: string; enabled: boolean }[];
}
class PlatformTenantsService {
  create(dto: CreatePlatformTenantDto, actorId: string): Promise<PlatformTenantDetail>;
  findOne(tenantId: string): Promise<PlatformTenantDetail>;   // 404 if missing or isPlatform
  getSectionCatalog(): { sections: SectionDefinition[]; defaults: { planType: PlanType; tenantType: TenantType; sections: SectionKey[] }[] };
}
class PlatformAuditService {
  record(input: { tenantId: string; actorId: string; entity: 'TENANT' | 'USER'; entityId: string; reason?: string; changes?: { before: unknown; after: unknown } }): Promise<void>;
}
```

- Rutas: `POST /platform/tenants`, `GET /platform/tenants/:tenantId`, `GET /platform/section-catalog`. Controlador con `@PlatformRoute()` y `@Roles('ADMIN')` a nivel de clase.
- `createTestTenant(deps: { tenants: PlatformTenantsService; prisma: PrismaService }, sequence: number)` conserva nombre y devuelve un objeto con `id` del consultorio para no romper a sus llamadores; crea un consultorio `CLINIC` en `TRIAL` con la especialidad `PSYCHOLOGY`, las ocho secciones activas y pone `mustChangePassword: false` al titular tras crearlo.

- [ ] **Step 1: Write the failing tests** en `platform-tenants.service.spec.ts`

```ts
it('creates tenant, settings, subscription, master and eight section rows in one transaction', ...)
it('creates the master with role MASTER, mustChangePassword true and no professional profile', ...)   // seatsPsychologistsUsed: 0
it('uses the plan defaults when sections are omitted', ...)            // TRIAL + CLINIC → tasks disabled, team enabled
it('stores the explicit section list and disables the rest', ...)
it('rejects an unknown section and an unmet dependency before writing', ...)
it('rejects a plan that does not match the tenant type with PLAN_TYPE_MISMATCH', ...)
it('starts a TRIAL as TRIALING with a 14 day trial and trial seats', ...)   // CLINIC: 3 seats / 20 patients; PERSONAL: 1 / 10
it('starts a paid plan ACTIVE with a one month period, no payment and a SUBSCRIPTION_ACTIVATED event by the actor', ...)
it('rejects a master e-mail that exists with different casing', ...)   // ConflictException
it('rejects a master e-mail that belongs to a platform ADMIN', ...)
it('never stores or returns the temporary password in clear text', ...)
it('answers 404 for the platform tenant and for an unknown id', ...)
it('builds the catalog defaults for every plan and tenant type that match', ...)
```

- [ ] **Step 2: Run** `npx jest src/platform` — Expected: FAIL.

- [ ] **Step 3: Implement `PlatformTenantsService.create`** moviendo el cuerpo de `OnboardingService.create`: misma transacción serializable, mismo `pg_advisory_xact_lock` por correo, mismo bucle de reintento `P2034` y traducción de `P2002`. Cambios respecto al original: `tenantType` del DTO; sin campos `adminProvidesCare`; suscripción según el plan (`getPlanLimits`, `getPlanFeatureFlags`); `mustChangePassword: true`; filas de sección con `createMany`. `findOne` y `getSectionCatalog` según las interfaces.

- [ ] **Step 4: Remove the public paths.** Borra `src/onboarding/`, quita `OnboardingModule` de `app.module.ts`, quita el handler `create` de `TenantsController`, `TenantsService.create` y `CreateTenantDto`, y la dependencia de `AuthModule` en `tenants.module.ts` si queda sin uso. Registra `PlatformModule` en `app.module.ts`.

- [ ] **Step 5: Update `create-test-tenant.ts`** y cada e2e que lo usa o que llama a `POST /onboarding/tenants` (`tenant-isolation`, `specialty-onboarding-team`, `master-role`, `professional-profiles`, `patient-team-appointments`, `patient-invoicing`, `clinical-records`, `password-reset`, `subscription-billing`, `task-reminders`) para obtener `PlatformTenantsService` de la app de pruebas. `specialty-onboarding-team.e2e-spec.ts` pasa a crear por `POST /platform/tenants` con un `ADMIN`.

- [ ] **Step 6: Run** `npx jest src test --testPathIgnorePatterns e2e` y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS. Los e2e solo compilan; se ejecutan si existe `DATABASE_URL_TEST`.

- [ ] **Step 7: Commit** `feat(api): create clinics from the platform panel and close public sign-up`

---

### Task 7: Listado, cuenta, estado, secciones y contraseña del titular

**Files:**
- Modify: `api/src/platform/platform-tenants.controller.ts`, `platform-tenants.service.ts`
- Create: `api/src/platform/dto/platform-tenant.dto.ts`
- Test: `api/src/platform/platform-tenants.service.spec.ts`

**Interfaces:**
- Consumes: `PlatformTenantDetail`, `PlatformAuditService` (Tarea 6).
- Produces:

```ts
export class ListPlatformTenantsQueryDto { search?: string; planType?: PlanType; status?: SubscriptionStatus; isActive?: boolean; page = 1; pageSize = 20 /* Max(100) */ }
export interface PlatformTenantRow {
  id: string; name: string; tenantType: TenantType; isActive: boolean; createdAt: Date;
  master: { firstName: string; lastName: string; email: string } | null;
  planType: PlanType | null; status: SubscriptionStatus | null;
  seatsPsychologistsUsed: number; seatsPsychologistsMax: number; activePatientsCount: number; maxActivePatients: number;
}
class PlatformTenantsService {
  list(query: ListPlatformTenantsQueryDto): Promise<{ items: PlatformTenantRow[]; total: number; page: number; pageSize: number }>;
  updateAccount(tenantId: string, dto: { name?: string; email?: string; phone?: string; address?: string }, actorId: string): Promise<PlatformTenantDetail>;
  suspend(tenantId: string, reason: string, actorId: string): Promise<PlatformTenantDetail>;
  reactivate(tenantId: string, actorId: string): Promise<PlatformTenantDetail>;
  setSections(tenantId: string, sections: string[], actorId: string): Promise<PlatformTenantDetail>;
  resetMasterPassword(tenantId: string, temporaryPassword: string, actorId: string): Promise<void>;
}
```

- Rutas: `GET /platform/tenants`, `PATCH /platform/tenants/:tenantId`, `POST …/suspend` (`{ reason }`), `POST …/reactivate`, `PUT …/sections` (`{ sections }`), `POST …/master/reset-password` (`{ temporaryPassword }`). Los `POST` responden 200.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists clinics newest first and never the platform tenant', ...)
it('searches by clinic name, clinic e-mail and master name without case', ...)
it('filters by plan, subscription status and active flag', ...)
it('caps pageSize at 100', ...)
it('returns only counters, never patients or appointments', ...)                 // the select has no relation to clinical models
it('updates the account data and audits before and after', ...)
it('suspends: sets isActive false, revokes every refresh token of the clinic and audits the reason', ...)
it('returns the current state without a second audit row when suspending a suspended clinic', ...)
it('reactivates, and does nothing when the clinic is already active', ...)
it('replaces the section list: listed keys enabled, the others disabled, rows never deleted', ...)
it('rejects SECTION_UNKNOWN and SECTION_DEPENDENCY without changing any row', ...)
it('resets the master password: new hash, mustChangePassword true, refresh tokens revoked, audit without the password', ...)
it('answers 404 on every method for the platform tenant', ...)
```

- [ ] **Step 2: Run** `npx jest src/platform` — Expected: FAIL.

- [ ] **Step 3: Implement.** `setSections` hace `upsert` de las ocho claves en una transacción. La auditoría de secciones guarda en `changes` las listas de claves activas antes y después.

- [ ] **Step 4: Run** `npx jest src/platform` y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): manage clinic accounts, status, sections and master password from the panel`

---

### Task 8: Cambio de plan desde el panel

**Files:**
- Create: `api/src/platform/platform-subscription.service.ts`, `api/src/platform/dto/change-plan.dto.ts`
- Modify: `api/src/platform/platform-tenants.controller.ts`, `platform.module.ts`
- Test: `api/src/platform/platform-subscription.service.spec.ts`

**Interfaces:**
- Consumes: `PlatformTenantsService.findOne`, `isPlanAllowedForTenantType`.
- Produces: `ChangePlanDto { planType: PlanType; seatsPsychologistsMax?: number /* Min(1) */; maxActivePatients?: number /* Min(1) */; reason: string /* IsNotEmpty */ }`; `PlatformSubscriptionService.changePlan(tenantId: string, dto: ChangePlanDto, actorId: string): Promise<PlatformTenantDetail>`. Ruta `PATCH /platform/tenants/:tenantId/subscription`.

- [ ] **Step 1: Write the failing tests**

```ts
it('applies the limits, prices and feature flags of the new plan at once', ...)
it('lets explicit seats and patient limits override the plan values', ...)
it('rejects with PLAN_BELOW_USAGE and details when seats in use exceed the new limit', ...)   // 409, details { seatsPsychologistsUsed, seatsPsychologistsMax }
it('rejects with PLAN_BELOW_USAGE when active patients exceed the new limit', ...)
it('rejects PLAN_TYPE_MISMATCH', ...)
it('moves TRIAL to a paid plan as ACTIVE with a one month period', ...)
it('clears a scheduled plan change and cancels pending upgrade payments', ...)                // status CANCELED
it('records PLAN_UPGRADED or PLAN_DOWNGRADED with the reason and the actor', ...)            // by basePrice comparison
it('records SEATS_INCREASED or SEATS_DECREASED when only the seats change', ...)
it('does not touch any TenantModule row', ...)
it('creates no SubscriptionPayment', ...)
```

- [ ] **Step 2: Run** `npx jest src/platform/platform-subscription.service.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** con `runSerializableTransaction` (`src/prisma/serializable-transaction.ts`). Mejora o degradación se decide comparando `getPlanLimits(nuevo).basePrice` con el del plan actual.

- [ ] **Step 4: Run** el mismo comando y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): change a clinic plan and limits from the panel`

---

### Task 9: Resumen, pagos y endpoints heredados

**Files:**
- Create: `api/src/platform/platform-summary.controller.ts`, `platform-summary.service.ts`, `platform-payments.controller.ts`, `platform-legacy-access.controller.ts`
- Delete: `api/src/subscription/subscription-payments.controller.ts`, `api/src/users/provider-admin.controller.ts`
- Modify: `api/src/subscription/subscription.module.ts`, `api/src/users/users.module.ts`, `api/src/users/users.controller.ts` (quita `grantAccess`, `revokeAccess`), `api/src/platform/platform.module.ts`, `api/src/common/roles/role-matrix.spec.ts`
- Test: `api/src/platform/platform-summary.service.spec.ts`, `api/src/common/roles/role-matrix.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface PlatformSummary {
  tenants: { active: number; suspended: number };
  subscriptions: { trialing: number; active: number; pastDue: number; blocked: number };   // blocked = UNPAID + CANCELED + INCOMPLETE
  pendingPayments: { count: number; amount: number; currency: string };
  trialsEndingSoon: { id: string; name: string; trialEndsAt: Date }[];                     // next 7 days, soonest first
  recentTenants: { id: string; name: string; planType: PlanType | null; createdAt: Date }[]; // 10 newest
}
class PlatformSummaryService { getSummary(now?: Date): Promise<PlatformSummary> }
```

- Rutas: `GET /platform/summary`; `GET /platform/subscription-payments`, `POST /platform/subscription-payments/:paymentId/confirm`, `POST …/reject` (mismos DTOs y llamadas a `SubscriptionBillingService` que el controlador eliminado); `GET /platform/legacy-access/pending`, `POST /platform/legacy-access/:tenantId/:userId/grant`, `POST …/revoke` (llaman a `listPendingPsychologists`, `grantPsychologistAccess`, `revokePsychologistAccess`). `SubscriptionModule` y `UsersModule` exportan los servicios que `PlatformModule` importa.

- [ ] **Step 1: Write the failing tests**

`platform-summary.service.spec.ts`:

```ts
it('counts active and suspended clinics without the platform tenant', ...)
it('groups subscriptions by status and folds UNPAID, CANCELED and INCOMPLETE into blocked', ...)
it('sums pending payments', ...)                              // { count: 2, amount: 258, currency: 'USD' }
it('lists trials ending within seven days, soonest first, and no expired ones', ...)
it('lists the ten newest clinics', ...)
it('returns zeros and empty lists on an empty platform', ...)
```

`role-matrix.spec.ts`: sustituye la fila de `SubscriptionPaymentsController` por

```ts
[PlatformTenantsController, ['ADMIN']], [PlatformSummaryController, ['ADMIN']],
[PlatformPaymentsController, ['ADMIN']], [PlatformLegacyAccessController, ['ADMIN']],
```

y añade:

```ts
it('no handler in the API requires SOPORTE', ...)
it.each(platformControllers)('%p is a platform route', ...)   // Reflect.getMetadata(PLATFORM_ROUTE_KEY, controller) === true
```

- [ ] **Step 2: Run** `npx jest src/platform src/common/roles` — Expected: FAIL.

- [ ] **Step 3: Implement** los controladores y el servicio; elimina los archivos y handlers indicados.

- [ ] **Step 4: Run** `npx jest src` y `npx tsc --noEmit -p tsconfig.json` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): add the platform summary and move payments and legacy access under ADMIN`

---

### Task 10: E2E del panel y documentación del API

**Files:**
- Create: `api/test/platform-admin.e2e-spec.ts`
- Modify: `api/docs/API_ENDPOINTS.md`, `api/docs/ARCHITECTURE.md`, `api/docs/SUBSCRIPTION_BILLING.md`, `api/docs/DEPLOYMENT.md`, `api/.env.example`, `postman/Psychology-Clinic-SaaS-PROD.postman_collection.json`

**Interfaces:**
- Consumes: todas las rutas de las Tareas 3 a 9; `createPlatformAdmin` (Tarea 2).

- [ ] **Step 1: Write `platform-admin.e2e-spec.ts`** con un solo flujo ordenado; cada paso es un `it`:

```ts
it('lets the ADMIN create a clinic with tasks disabled', ...)                        // 201, sections core.tasks enabled false
it('blocks the new master with PASSWORD_CHANGE_REQUIRED', ...)                       // GET patients → 403
it('lets the master change the password and list patients', ...)                     // 200
it('answers SECTION_NOT_ENABLED on tasks', ...)
it('opens tasks after the ADMIN enables the section', ...)
it.each(['patients', 'appointments', 'clinical-notes'])('answers PLATFORM_ONLY when the ADMIN asks for %s of the clinic', ...)
it('rejects the master on /platform/tenants with 403', ...)
it('blocks the master with PASSWORD_CHANGE_REQUIRED right after the ADMIN resets the password', ...)   // same access token
it('cuts the master off when the clinic is suspended and restores access on reactivation', ...)        // 401 then 200
it.each([['POST', '/onboarding/tenants'], ['POST', '/tenants']])('%s %s no longer exists', ...)       // 404
```

- [ ] **Step 2: Run** `npm run test:e2e -- platform-admin` — Expected: PASS si `DATABASE_URL_TEST` está configurada. Si no, comprueba que compila con `npx tsc --noEmit -p tsconfig.json` e informa "e2e no ejecutado".

- [ ] **Step 3: Update the docs.**
  - `API_ENDPOINTS.md`: sección "Plataforma" con cada ruta de `/platform/*`, `POST /auth/change-password` y la tabla de errores del spec; elimina `/onboarding/tenants`, `POST /tenants`, `/subscription-payments`, `/admin/psychologists/*`.
  - `ARCHITECTURE.md`: consultorio de plataforma, orden de guards, secciones `core.*`.
  - `SUBSCRIPTION_BILLING.md`: los pagos los confirma el `ADMIN` en `/platform/subscription-payments`.
  - `DEPLOYMENT.md`: los siete pasos de despliegue del spec, el requisito previo de `site.ts` y, antes de aplicar la migración, `SELECT * FROM pg_policies;` debe devolver cero filas.
  - `.env.example`: las cuatro variables `PLATFORM_ADMIN_*` con comentario de que solo las lee `npm run platform:create-admin`.
  - Postman: carpeta "Platform" y eliminación de las rutas retiradas.

- [ ] **Step 4: Commit** `test(api): cover the platform panel end to end and document it`

---

## Parte B — Web

### Task 11: Contratos, redirección por rol y cambio obligatorio de contraseña

**Files:**
- Modify: `web/src/types/index.ts`, `web/src/types/guards.ts`, `web/src/lib/constants.ts`, `web/src/lib/api/endpoints.ts`, `web/src/lib/api/client.ts`, `web/src/hooks/useAuth.ts`, `web/src/hooks/useCanManageAccount.ts`, `web/src/app/(dashboard)/layout.tsx`, `web/src/features/admin/specialties/specialty-manager.tsx`
- Create: `web/src/app/change-password/page.tsx`, `web/src/lib/post-login-route.ts`
- Test: `web/src/types/roles.test.ts`, `web/src/lib/post-login-route.test.ts`, `web/src/lib/api/client.test.ts`, `web/src/app/change-password/change-password.test.tsx`, `web/src/app/(dashboard)/dashboard-layout.test.tsx`

**Interfaces:**
- Produces:

```ts
// types
interface User { /* … */ mustChangePassword?: boolean }
type SectionKey = 'core.calendar' | 'core.patients' | 'core.tasks' | 'core.clinicalNotes' | 'core.specialties' | 'core.billing' | 'core.team' | 'core.storage';
// guards
export function isPlatformAdmin(user: Pick<User, 'role'>): boolean;
// post-login-route.ts
export function postLoginRoute(user: Pick<User, 'role' | 'mustChangePassword'>): string;   // '/change-password' | '/platform' | '/dashboard'
// constants
ROUTES.PLATFORM = '/platform'; ROUTES.PLATFORM_TENANTS = '/platform/tenants'; ROUTES.PLATFORM_TENANT_NEW = '/platform/tenants/new';
ROUTES.PLATFORM_TENANT_DETAIL = (id: string) => `/platform/tenants/${id}`; ROUTES.PLATFORM_PAYMENTS = '/platform/payments'; ROUTES.CHANGE_PASSWORD = '/change-password';
// endpoints
authApi.changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// roles.test.ts
it('recognises only ADMIN as platform admin', ...)
it('gives SOPORTE no management permission', ...)     // canManageUsers, canManageSubscription, canDeletePatient → false
// post-login-route.test.ts
it('sends a user with a temporary password to /change-password whatever the role', ...)
it('sends ADMIN to /platform and everyone else to /dashboard', ...)
// client.test.ts
it('redirects to /change-password on a 403 PASSWORD_CHANGE_REQUIRED and still rejects', ...)
it('does not redirect when already on /change-password', ...)
// change-password.test.tsx
it('requires the confirmation to match and at least 8 characters', ...)
it('rejects a new password equal to the current one', ...)
it('clears the flag in the store and goes to the route of the role after saving', ...)
it('shows the API message when the current password is wrong', ...)
// dashboard-layout.test.tsx
it('sends an ADMIN to /platform', ...)
it('sends a user with a temporary password to /change-password', ...)
// useAuth
it('does not request the tenant when an ADMIN logs in and reports no error', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/types src/lib src/app/change-password "src/app/(dashboard)/dashboard-layout.test.tsx" src/hooks` — Expected: FAIL.

- [ ] **Step 3: Implement.** `useLogin` omite `tenantsApi.get` cuando `isPlatformAdmin(user)` y redirige con `postLoginRoute(user)`. `normalizeUser` conserva `mustChangePassword`. El comentario de `useCanManageAccount` pasa a mencionar solo al titular. La página de cambio de contraseña usa `react-hook-form` + zod como `reset-password`, ofrece "Cerrar sesión" y, sin sesión, redirige a `/login`.

- [ ] **Step 4: Run** el mismo comando, `npm run type-check` y `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): route users by role and force the temporary password change`

---

### Task 12: Secciones en el panel del consultorio

**Files:**
- Create: `web/src/hooks/useSections.ts`, `web/src/components/layout/section-gate.tsx`
- Modify: `web/src/components/layout/sidebar.tsx`, `web/src/app/(dashboard)/calendar/page.tsx`, `patients/page.tsx`, `patients/[id]/page.tsx`, `tasks/page.tsx`, `admin/specialties/page.tsx`, `admin/billing/page.tsx`, `admin/team/page.tsx`, `admin/storage/page.tsx`, `dashboard/page.tsx`, `web/src/components/dashboard/usage-widgets.tsx`
- Test: `web/src/hooks/useSections.test.tsx`, `web/src/components/layout/section-gate.test.tsx`, `web/src/components/layout/sidebar.test.tsx`, `web/src/app/(dashboard)/patients/patient-detail-team.test.tsx`

**Interfaces:**
- Consumes: `SectionKey` (Tarea 11), `useTenantModules()` existente.
- Produces:

```ts
export function useSections(): { isEnabled: (key: SectionKey) => boolean; isLoading: boolean; isError: boolean; refetch: () => void };
export function SectionGate(props: { section: SectionKey; children: React.ReactNode }): JSX.Element | null;
```

- `SectionGate`: mientras carga no renderiza nada; con error muestra `Alert` "No se pudieron cargar las secciones" con botón "Reintentar"; con la sección apagada muestra `Alert` de advertencia con título "Sección no disponible" y el texto de Global Constraints; activa, renderiza `children`.

- [ ] **Step 1: Write the failing tests**

```ts
// useSections.test.tsx
it('reports a section enabled only when its row exists and is enabled', ...)
it('reports every section disabled while loading', ...)
// section-gate.test.tsx
it('renders nothing while the sections load', ...)
it('shows the retry alert, not the disabled notice, when the request fails', ...)
it('shows the disabled notice when the section is off', ...)
it('renders the children when the section is on', ...)
// sidebar.test.tsx
it.each([['Calendario', 'core.calendar'], ['Pacientes', 'core.patients'], ['Tareas', 'core.tasks'], ['Módulos clínicos', 'core.specialties'],
         ['Facturación', 'core.billing'], ['Equipo', 'core.team'], ['Almacenamiento', 'core.storage']])('hides %s when %s is off', ...)
it('always shows Dashboard, Suscripción and Configuración to the account holder', ...)
it('shows Equipo to a personal clinic when core.team is on', ...)        // no isClinicPlan fallback
// patient-detail-team.test.tsx
it.each([['Historia Clínica', 'core.clinicalNotes'], ['Especialidades', 'core.specialties'], ['Tareas', 'core.tasks'], ['Facturas', 'core.billing']])('hides the %s tab when %s is off', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/hooks/useSections.test.tsx src/components/layout "src/app/(dashboard)/patients"` — Expected: FAIL.

- [ ] **Step 3: Implement.** Cada página de la lista envuelve su contenido en `<SectionGate>` después de la comprobación de rol existente. En `patients/[id]/page.tsx` la pestaña `appointments` depende de `core.calendar`, y `clinical` y `session-plan` de `core.clinicalNotes`. `dashboard/page.tsx` oculta los bloques y accesos de citas (`core.calendar`), tareas (`core.tasks`), pacientes (`core.patients`) y equipo (`core.team`); `usage-widgets.tsx`, el de almacenamiento (`core.storage`).

- [ ] **Step 4: Run** `npm test`, `npm run type-check`, `npm run lint` — Expected: PASS. Los tests existentes que renderizan estas páginas simulan `useTenantModules` con las ocho secciones activas.

- [ ] **Step 5: Commit** `feat(web): show only the sections enabled for the clinic`

---

### Task 13: Carcasa del panel, resumen y listado de consultorios

**Files:**
- Create: `web/src/app/(platform)/layout.tsx`, `web/src/components/layout/platform-sidebar.tsx`, `web/src/app/(platform)/platform/page.tsx`, `web/src/app/(platform)/platform/tenants/page.tsx`, `web/src/features/platform/platform-summary.tsx`, `web/src/features/platform/tenants-table.tsx`, `web/src/features/platform/labels.ts`, `web/src/hooks/usePlatform.ts`
- Modify: `web/src/types/index.ts`, `web/src/lib/constants.ts`, `web/src/lib/api/endpoints.ts`
- Test: `web/src/app/(platform)/platform-layout.test.tsx`, `web/src/features/platform/platform-summary.test.tsx`, `web/src/features/platform/tenants-table.test.tsx`

**Interfaces:**
- Consumes: `isPlatformAdmin`, `ROUTES.PLATFORM*` (Tarea 11).
- Produces: tipos `PlatformSummary`, `PlatformTenantRow`, `PlatformTenantDetail`, `SectionCatalog`, `CreatePlatformTenantInput` con la misma forma que las interfaces del API (Tareas 6, 7 y 9; fechas como `string`); `platformApi` con `getSummary`, `listTenants(params)`, `getTenant(id)`, `getSectionCatalog()`; hooks `usePlatformSummary()`, `usePlatformTenants(params)`, `usePlatformTenant(id)`, `useSectionCatalog()`; claves `QUERY_KEYS.PLATFORM_SUMMARY`, `PLATFORM_TENANTS`, `PLATFORM_TENANT(id)`, `PLATFORM_SECTION_CATALOG`, `PLATFORM_PAYMENTS`; `labels.ts` exporta `PLAN_LABELS: Record<ApiPlanType, string>` y `SUBSCRIPTION_STATUS_LABELS`.

- Etiquetas de estado: `TRIALING` "En prueba", `ACTIVE` "Al día", `PAST_DUE` "Vencido", `UNPAID`/`CANCELED`/`INCOMPLETE` "Bloqueado"; consultorio con `isActive: false` "Suspendido".

- [ ] **Step 1: Write the failing tests**

```ts
// platform-layout.test.tsx
it('sends a visitor without session to /login', ...)
it.each([UserRole.MASTER, UserRole.PROFESIONAL, UserRole.ASISTENTE, UserRole.SOPORTE])('sends %s to /dashboard', ...)
it('sends an ADMIN with a temporary password to /change-password', ...)
it('renders the Panel de control menu with Resumen, Consultorios and Pagos for an ADMIN', ...)
// platform-summary.test.tsx
it('shows the four clinic counters and the pending payments with their amount', ...)
it('links the pending payments card to /platform/payments', ...)
it('shows an empty state when there are no clinics', ...)
it('shows the error with a retry button when the request fails', ...)
// tenants-table.test.tsx
it('renders one row per clinic with master, plan, status and usage', ...)
it('labels an inactive clinic as Suspendido', ...)
it('sends search, plan and status filters to the query and resets to page 1', ...)
it('links each row to its detail and offers Nuevo consultorio', ...)
```

- [ ] **Step 2: Run** `npx vitest run "src/app/(platform)" src/features/platform` — Expected: FAIL.

- [ ] **Step 3: Implement.** El layout replica el de `(dashboard)` con `PlatformSidebar` y `Header`, sin `NotificationsPanel` ni banners de suscripción. La búsqueda de la tabla se aplica con 300 ms de espera.

- [ ] **Step 4: Run** el mismo comando, `npm run type-check`, `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): add the platform panel shell, summary and clinic list`

---

### Task 14: Alta de consultorio

**Files:**
- Create: `web/src/app/(platform)/platform/tenants/new/page.tsx`, `web/src/features/platform/create-tenant-form.tsx`, `web/src/features/platform/section-checklist.tsx`, `web/src/features/platform/temporary-password-notice.tsx`, `web/src/features/platform/generate-password.ts`
- Modify: `web/src/lib/validations/schemas.ts`, `web/src/lib/api/endpoints.ts`, `web/src/hooks/usePlatform.ts`
- Test: `web/src/features/platform/create-tenant-form.test.tsx`, `section-checklist.test.tsx`, `generate-password.test.ts`

**Interfaces:**
- Consumes: `useSectionCatalog()`, `SectionCatalog`, `PlatformTenantDetail` (Tarea 13); `useSpecialtyCatalog()` existente.
- Produces:

```ts
export function generatePassword(): string;   // 16 chars from crypto.getRandomValues, with upper, lower and digit
export function SectionChecklist(props: { catalog: SectionCatalog['sections']; value: SectionKey[]; onChange: (next: SectionKey[]) => void; disabled?: boolean }): JSX.Element;
export function TemporaryPasswordNotice(props: { email: string; password: string; onDone: () => void }): JSX.Element;
export const createPlatformTenantSchema: z.ZodType<CreatePlatformTenantInput>;
platformApi.createTenant(input: CreatePlatformTenantInput): Promise<PlatformTenantDetail>;
useCreatePlatformTenant(): UseMutationResult<PlatformTenantDetail, ApiError, CreatePlatformTenantInput>;
```

- Valores por defecto: `tenantType: 'CLINIC'`, `planType: 'TRIAL'`, `timezone: 'America/Guayaquil'`, `locale: 'es'`.

- [ ] **Step 1: Write the failing tests**

```ts
// generate-password.test.ts
it('returns 16 characters with upper case, lower case and a digit', ...)
it('returns a different value on each call', ...)
// section-checklist.test.tsx
it('checks Pacientes when a section that depends on it is checked', ...)
it('unchecks the dependent sections when Pacientes is unchecked', ...)
// create-tenant-form.test.tsx
it('preselects the sections of the plan and tenant type from the catalog', ...)
it('offers only the plans that match the tenant type', ...)               // PERSONAL: TRIAL, PERSONAL_BASIC, PERSONAL_PRO
it('updates the preselection when the plan changes and no box was touched', ...)
it('asks before replacing a selection the admin edited by hand', ...)     // confirm dialog; cancel keeps the manual selection
it('requires at least one specialty and an 8 character password', ...)
it('fills the password field with Generar and reveals it with Mostrar', ...)
it('submits the exact payload of CreatePlatformTenantInput', ...)
it('shows the master e-mail and the password once, then goes to the clinic detail', ...)
it('keeps the password out of the query cache', ...)                       // queryClient.getQueryCache() has no entry containing it
it('shows the API message on a 409 and keeps the form values', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/features/platform` — Expected: FAIL.

- [ ] **Step 3: Implement.** La contraseña que se muestra tras crear es la que el `ADMIN` escribió, guardada en estado local del formulario; "Listo" la descarta y navega a `ROUTES.PLATFORM_TENANT_DETAIL(id)`. `useCreatePlatformTenant` invalida `PLATFORM_TENANTS` y `PLATFORM_SUMMARY`.

- [ ] **Step 4: Run** el mismo comando, `npm run type-check`, `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): create clinics with their account holder from the panel`

---

### Task 15: Ficha del consultorio

**Files:**
- Create: `web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx`, `web/src/features/platform/tenant-detail.tsx`, `tenant-account-card.tsx`, `tenant-master-card.tsx`, `tenant-plan-card.tsx`, `tenant-sections-card.tsx`, `tenant-status-card.tsx`
- Modify: `web/src/lib/api/endpoints.ts`, `web/src/hooks/usePlatform.ts`, `web/src/lib/validations/schemas.ts`
- Test: `web/src/features/platform/tenant-detail.test.tsx`

**Interfaces:**
- Consumes: `usePlatformTenant`, `SectionChecklist`, `TemporaryPasswordNotice`, `generatePassword`, `PLAN_LABELS`.
- Produces: `platformApi.updateTenant(id, input)`, `changePlan(id, { planType, seatsPsychologistsMax?, maxActivePatients?, reason })`, `suspendTenant(id, reason)`, `reactivateTenant(id)`, `setSections(id, sections)`, `resetMasterPassword(id, temporaryPassword)`; hooks `useUpdatePlatformTenant`, `useChangeTenantPlan`, `useSuspendTenant`, `useReactivateTenant`, `useSetTenantSections`, `useResetMasterPassword`. Cada mutación invalida `PLATFORM_TENANT(id)`, `PLATFORM_TENANTS` y `PLATFORM_SUMMARY`; `resetMasterPassword` no escribe nada en caché.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows account, master, plan, sections, status and usage', ...)
it('saves the account data', ...)
it('requires a reason to change the plan and sends the new limits', ...)
it('shows the PLAN_BELOW_USAGE message and leaves the plan unchanged', ...)
it('enables Guardar cambios only when the section selection differs and sends the full list', ...)
it('asks for confirmation and a reason before suspending', ...)
it('offers Reactivar instead of Suspender for a suspended clinic', ...)
it('resets the master password and shows it once', ...)
it('shows a not-found state for an unknown clinic', ...)                  // 404 from the API
it('shows only the three usage counters', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/features/platform/tenant-detail.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** una tarjeta por bloque; los diálogos usan el componente `Dialog` de `components/ui`.

- [ ] **Step 4: Run** el mismo comando, `npm run type-check`, `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): manage a clinic account, plan, sections and status`

---

### Task 16: Pagos de suscripción

**Files:**
- Create: `web/src/app/(platform)/platform/payments/page.tsx`, `web/src/features/platform/payments-table.tsx`
- Modify: `web/src/types/index.ts`, `web/src/lib/api/endpoints.ts`, `web/src/hooks/usePlatform.ts`
- Test: `web/src/features/platform/payments-table.test.tsx`

**Interfaces:**
- Consumes: tipo `SubscriptionPayment` existente; `PLAN_LABELS`.
- Produces: `PlatformPayment = SubscriptionPayment & { tenant: { id: string; name: string; email: string } }`; `platformApi.listPayments(status?)`, `confirmPayment(id, { reference: string; note?: string })`, `rejectPayment(id, reason: string)`; hooks `usePlatformPayments(status)`, `useConfirmPayment()`, `useRejectPayment()` que invalidan `PLATFORM_PAYMENTS` y `PLATFORM_SUMMARY`.

- Etiquetas: `PLAN_UPGRADE` "Mejora de plan", `RENEWAL` "Renovación"; estados `PENDING` "Pendiente", `CONFIRMED` "Confirmado", `REJECTED` "Rechazado", `CANCELED` "Cancelado", `EXPIRED` "Vencido".

- [ ] **Step 1: Write the failing tests**

```ts
it('lists pending payments by default with clinic, kind, plan, amount and date', ...)
it('requests another status when the filter changes', ...)
it('requires a reference to confirm and sends it', ...)
it('requires a reason to reject and sends it', ...)
it('offers no actions on a payment that is not pending', ...)
it('links the clinic name to its detail', ...)
it('shows the API message when the reference already confirmed another payment', ...)
it('shows an empty state when there are no payments', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/features/platform/payments-table.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** el mismo comando, `npm run type-check`, `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): confirm and reject subscription payments from the panel`

---

### Task 17: Cierre del registro público y documentación

**Files:**
- Modify: `web/src/app/onboarding/page.tsx`, `web/src/lib/api/endpoints.ts`, `web/src/lib/constants.ts`, `web/src/types/index.ts`, `web/src/lib/validations/schemas.ts`, `web/src/app/robots.ts`, `web/docs/ROUTE_MAP.md`, `TAREAS_PENDIENTES.md` (raíz, fuera de ambos repos)
- Delete: `web/src/features/onboarding/`
- Test: `web/src/app/onboarding/onboarding-redirect.test.tsx`, `web/src/types/onboarding-contracts.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.

- [ ] **Step 1: Write the failing test**

```ts
it('redirects /onboarding to /contacto', ...)   // next/navigation redirect called with '/contacto'
```

- [ ] **Step 2: Run** `npx vitest run src/app/onboarding` — Expected: FAIL.

- [ ] **Step 3: Implement.** `onboarding/page.tsx` llama a `redirect('/contacto')`. Elimina `features/onboarding/`, `onboardingApi`, `tenantsApi.create`, `API_ENDPOINTS.CLINIC_ONBOARDING` y `TENANT_CREATE`, y los tipos y esquemas de onboarding que queden sin referencias (compruébalo con `npm run type-check`); borra o reduce `onboarding-contracts.test.ts` en consecuencia. Busca en `src/app/(marketing)` y `src/content/site.ts` cualquier enlace o texto que invite a crear una cuenta y cámbialo a "Solicitar demo" con destino `/contacto`.

- [ ] **Step 4: Update the docs.** `ROUTE_MAP.md`: rutas `/platform/*` y `/change-password`, `/onboarding` como redirección. `TAREAS_PENDIENTES.md`: en T-05, la "pantalla de soporte" queda cubierta por `/platform/payments`; en T-12, nota de que con el registro cerrado los datos de contacto son requisito de despliegue; nueva entrada para aplicar la migración `20261006000000_platform_admin_sections` y ejecutar `platform-admin.e2e-spec.ts`.

- [ ] **Step 5: Run** `npm test`, `npm run type-check`, `npm run lint`, `npm run build` — Expected: PASS.

- [ ] **Step 6: Commit** en `web/`: `feat(web): close public sign-up and document the platform panel`. `TAREAS_PENDIENTES.md` no pertenece a ningún repositorio: se edita y se informa, sin commit.

---

## Verificación final

- [ ] `api/`: `npx jest` y `npx tsc --noEmit -p tsconfig.json` sin fallos.
- [ ] `web/`: `npm test`, `npm run type-check`, `npm run lint`, `npm run build` sin fallos.
- [ ] `grep -rn "SOPORTE" api/src web/src` solo devuelve `role-compatibility.ts` y su spec, la etiqueta de `constants.ts`, el enum de `types/index.ts` y los tests que comprueban que `SOPORTE` no tiene acceso.
- [ ] Informe de lo no ejecutado: migración, `prisma:verify-platform-sections`, e2e y comprobación en navegador, con el motivo.
