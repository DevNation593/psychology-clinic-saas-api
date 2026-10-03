# Panel de control de plataforma (rol ADMIN)

Fecha: 2026-10-01
Estado: pendiente de revisión
Repos: `api/` y `web/`, rama `feat/platform-admin` en ambos

## Objetivo

Dar al proveedor del servicio un panel propio, accesible solo con el rol `ADMIN`, desde el que se crean los consultorios con su usuario `MASTER`, se decide qué secciones de la app usa cada consultorio, se administra su plan y estado, y se confirman los pagos de suscripción.

Éxito: un `ADMIN` crea un consultorio desde el panel, entrega una contraseña temporal al titular, y ese titular entra, cambia su contraseña y ve únicamente las secciones que el `ADMIN` le asignó. Nadie más puede crear consultorios y el `ADMIN` nunca ve datos internos de un consultorio.

## Decisiones acordadas

1. El panel es exclusivo del rol `ADMIN`. Ningún otro rol entra.
2. "Módulos que usan los clientes" son **secciones de la app**: Calendario, Pacientes, Tareas, Notas clínicas, Módulos clínicos, Facturación, Equipo y Almacenamiento. Dashboard, Suscripción y Configuración están siempre activas.
3. Solo el `ADMIN` crea consultorios. El registro público se cierra.
4. `ADMIN` absorbe los poderes de plataforma de `SOPORTE`. `SOPORTE` queda sin ningún poder.
5. El `ADMIN` no accede a datos internos de los consultorios (pacientes, citas, notas, facturas). Solo datos de la cuenta, plan, pagos, secciones y contadores de uso.
6. El titular recibe una contraseña temporal escrita por el `ADMIN` y debe cambiarla en su primer inicio de sesión.
7. El plan premarca las secciones al crear el consultorio; después solo cuenta lo que el `ADMIN` dejó marcado. Cambiar de plan no toca las secciones.
8. Módulos del panel en esta entrega: Resumen, Consultorios, Pagos de suscripción.
9. El `ADMIN` vive en un consultorio reservado "Plataforma" (`Tenant.isPlatform`).
10. Las secciones se guardan en la tabla existente `TenantModule` con claves `core.<sección>`.

## Fuera de alcance

- Gestión de cuentas `ADMIN` desde el panel: se crean por script.
- App móvil: recibe los 403 del API pero no oculta menús.
- Que los recordatorios automáticos de citas y tareas respeten las secciones.
- API de archivos (T-10): la sección Almacenamiento solo oculta su pantalla.
- Pantalla para los endpoints heredados de acceso gestionado por el proveedor.
- Cargar los datos de contacto del sitio público (T-12); ver "Despliegue".
- Quitar `SOPORTE` del enum de Postgres.

## Datos

Migración `20261006000000_platform_admin_sections`.

### Esquema

- `Tenant.isPlatform Boolean @default(false)`.
- Índice único parcial, a lo sumo un consultorio de plataforma:

```sql
CREATE UNIQUE INDEX "Tenant_isPlatform_key" ON "Tenant" ("isPlatform") WHERE "isPlatform" = true;
```

- `User.mustChangePassword Boolean @default(false)`.
- Sin tabla nueva para secciones: filas de `TenantModule` con `moduleKey` en `core.calendar`, `core.patients`, `core.tasks`, `core.clinicalNotes`, `core.specialties`, `core.billing`, `core.team`, `core.storage`.
- `schema.prisma`: el comentario de `ADMIN` pasa a "Administrador de la plataforma. Solo accede al panel de control."; el de `SOPORTE` pasa a "Obsoleto: sus funciones pasaron a ADMIN."

### Catálogo de secciones

Un solo archivo, `src/common/sections/section-catalog.ts`, define para cada sección: clave, nombre, de cuáles depende y la regla que la premarca.

| Sección | Clave | Depende de | Premarcada en |
|---|---|---|---|
| Calendario | `core.calendar` | Pacientes | Todos los planes |
| Pacientes | `core.patients` | — | Todos los planes |
| Tareas | `core.tasks` | Pacientes | Planes cuyo `getPlanIncludedModules` incluye `tasks` (todos menos `TRIAL`) |
| Notas clínicas | `core.clinicalNotes` | Pacientes | Todos los planes |
| Módulos clínicos | `core.specialties` | Pacientes | Todos los planes |
| Facturación | `core.billing` | — | Todos los planes |
| Equipo | `core.team` | — | Consultorios de tipo `CLINIC` |
| Almacenamiento | `core.storage` | — | Todos los planes |

Las reglas de premarcado reproducen lo que hoy ve cada consultorio.

### Relleno de consultorios existentes

Para cada consultorio que no sea de plataforma, la migración inserta las filas de sección que falten, reproduciendo lo que el consultorio ve hoy. Las filas que ya existan no se modifican.

- `core.tasks`: `enabled` = `TenantSubscription.featureTasks`.
- `core.clinicalNotes`: `enabled` = `TenantSubscription.featureClinicalNotes`.
- `core.team`: `enabled` = `tenantType = 'CLINIC'`.
- Las otras cinco: `enabled = true`.
- Consultorio sin suscripción: las ocho quedan según las reglas anteriores tomando `false` para Tareas y `true` para Notas clínicas.

### Cuentas SOPORTE

La migración pone `isActive = false` a todo usuario con rol `SOPORTE` y revoca sus tokens de refresco.

### Scripts

- `prisma/create-platform-admin.ts` (`npm run platform:create-admin`): crea el consultorio "Plataforma" si no existe y un usuario `ADMIN` en él. Lee `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_FIRST_NAME` y `PLATFORM_ADMIN_LAST_NAME` del entorno. Falla si el correo ya existe. El consultorio de plataforma no tiene `TenantSettings`, `TenantSubscription` ni secciones.
- `prisma/verify-platform-sections.ts` (`npm run prisma:verify-platform-sections`): termina con código distinto de cero si algún consultorio que no es de plataforma tiene menos de ocho filas de sección, si hay más de un consultorio de plataforma, si existe un `ADMIN` fuera del consultorio de plataforma, o si queda un `SOPORTE` activo.
- `seed.ts`: crea el consultorio de plataforma con un `ADMIN` de desarrollo y las ocho secciones de cada consultorio de demostración.

## API

### Reglas de acceso

**`@PlatformRoute()`** (decorador de clase, `src/common/decorators/platform-route.decorator.ts`).

- `TenantGuard`: en una ruta de plataforma exige `role === 'ADMIN'` y que el consultorio del usuario sea de plataforma; si no, 403. No compara `:tenantId` con el consultorio del usuario. Fija el contexto RLS con el consultorio del `ADMIN`.
- `TenantGuard`: fuera de una ruta de plataforma, un usuario `ADMIN` recibe 403 `PLATFORM_ONLY`, salvo en las rutas de sesión, marcadas `@SessionRoute()`: `POST /auth/logout`, `POST /auth/logout-all` y `POST /auth/change-password`.
- `SubscriptionGuard`, `FeatureGuard` y `SectionGuard`: no aplican en rutas de plataforma ni en las marcadas `@SessionRoute()`.
- `JwtStrategy.validate` devuelve además `isPlatformTenant` y `mustChangePassword`, leídos de la base de datos en cada petición.

**SOPORTE.** Se eliminan sus excepciones en `TenantGuard`, `SubscriptionGuard` y `FeatureGuard`. Ningún `@Roles('SOPORTE')` permanece en el código.

**Cambio obligatorio de contraseña.** Nuevo guard global `PasswordChangeGuard`, registrado después de `JwtAuthGuard`: si `mustChangePassword` es verdadero responde 403 `PASSWORD_CHANGE_REQUIRED` en toda ruta que no sea pública ni esté marcada `@SessionRoute()` (las tres rutas de sesión anteriores).

**Secciones.** Decorador `@RequireSection(key)` y guard global `SectionGuard`: busca la fila `TenantModule` del consultorio del usuario con esa clave; si no existe o `enabled` es falso, responde 403 `SECTION_NOT_ENABLED` con `{ section }`. Reemplaza a `@RequireFeature('tasks')` y `@RequireFeature('clinicalNotes')`. `@RequireFeature('webPush')` no cambia. `FeatureGuard` deja de consultar claves `core.*`.

| Sección | Controladores o handlers con `@RequireSection` |
|---|---|
| `core.calendar` | `appointments.controller.ts` |
| `core.patients` | `patients.controller.ts`, `patient-team.controller.ts` |
| `core.tasks` | `tasks.controller.ts` |
| `core.clinicalNotes` | `clinical-notes.controller.ts`, `clinical-timeline.controller.ts`, `next-session-plans.controller.ts` |
| `core.specialties` | `specialty-records.controller.ts`; en `specialties.controller.ts` solo los handlers que modifican especialidades o módulos |
| `core.billing` | `billing.controller.ts` |
| `core.team` | En `users.controller.ts`: crear, invitar, editar, desactivar y activar miembros |
| `core.storage` | Ninguno |

No llevan `@RequireSection`: listar miembros y leer un usuario, el perfil propio y el avatar, y la lectura de módulos y especialidades del consultorio.

**Claves `core.*` y el titular.** `tenant-specialties.service.ts` rechaza con 403 `SECTION_MANAGED_BY_PLATFORM` cualquier intento de cambiar una clave que empiece por `core.` desde `PATCH specialties/modules/:moduleKey`, y `applySelection` nunca crea ni borra claves `core.*`.

### Módulo `src/platform/`

`PlatformModule` con tres controladores, todos `@PlatformRoute()` y `@Roles('ADMIN')`.

**`platform-summary.controller.ts`**

| Ruta | Respuesta |
|---|---|
| `GET /platform/summary` | `tenants: { active, suspended }`, `subscriptions: { trialing, active, pastDue, blocked }` (`blocked` = `UNPAID` + `CANCELED` + `INCOMPLETE`), `pendingPayments: { count, amount, currency }`, `trialsEndingSoon` (lista, vencen en 7 días), `recentTenants` (10 más recientes). |

**`platform-tenants.controller.ts`**

| Ruta | Qué hace |
|---|---|
| `GET /platform/tenants` | Lista paginada (`page`, `pageSize` ≤ 100) con `search` (nombre del consultorio, correo o nombre del titular), `planType`, `status` y `isActive`. Por fila: `id`, `name`, `tenantType`, `isActive`, `createdAt`, titular (`firstName`, `lastName`, `email`), `planType`, `status`, `seatsPsychologistsUsed`/`Max`, `activePatientsCount`/`maxActivePatients`. |
| `GET /platform/tenants/:tenantId` | Ficha: datos de la cuenta, titular, suscripción, contadores de uso (`seatsPsychologistsUsed`, `activePatientsCount`, `monthlyNotificationsSent`), especialidades y las ocho secciones con su estado. |
| `POST /platform/tenants` | Alta. Ver "Alta de consultorio". |
| `PATCH /platform/tenants/:tenantId` | Edita `name`, `email`, `phone`, `address`. |
| `PATCH /platform/tenants/:tenantId/subscription` | Cambia `planType`, `seatsPsychologistsMax`, `maxActivePatients`; `reason` obligatorio. Ver "Cambio de plan". |
| `POST /platform/tenants/:tenantId/suspend` | `reason` obligatorio. `Tenant.isActive = false` y revoca los tokens de refresco de todos sus usuarios. |
| `POST /platform/tenants/:tenantId/reactivate` | `Tenant.isActive = true`. |
| `PUT /platform/tenants/:tenantId/sections` | Cuerpo `{ sections: string[] }`: las claves que quedan activas; las demás quedan con `enabled = false`. Valida claves y dependencias. |
| `POST /platform/tenants/:tenantId/master/reset-password` | Cuerpo `{ temporaryPassword }`. Guarda el hash, pone `mustChangePassword = true` y revoca los tokens de refresco del titular. |
| `GET /platform/section-catalog` | Las ocho secciones (clave, nombre, dependencias) y, por cada plan y tipo de consultorio, las claves premarcadas. |

Toda ruta con `:tenantId` responde 404 si el consultorio no existe o es el de plataforma. Los listados y el resumen excluyen el consultorio de plataforma.

**`platform-payments.controller.ts`**: `GET /platform/subscription-payments`, `POST /platform/subscription-payments/:paymentId/confirm`, `POST /platform/subscription-payments/:paymentId/reject`. Misma lógica de `SubscriptionBillingService`; el listado añade el nombre del consultorio. `subscription-payments.controller.ts` se elimina.

### Alta de consultorio

La lógica de `OnboardingService.create` pasa a `PlatformTenantsService.create`. `OnboardingController`, su DTO y `OnboardingModule` se eliminan; el endpoint público `POST /onboarding/tenants` deja de existir. `POST /tenants` y `TenantsService.create` también se eliminan.

Cuerpo:

- Consultorio: `name`, `email`, `phone?`, `address?`, `tenantType` (`PERSONAL` | `CLINIC`), `timezone`, `locale`.
- Titular: `masterFirstName`, `masterLastName`, `masterEmail`, `temporaryPassword` (mínimo 8 caracteres).
- `planType`.
- `specialtyCodes` (al menos una).
- `sections?`: claves activas. Si se omite, se usan las premarcadas del catálogo para ese plan y tipo.

Reglas:

- Una sola transacción serializable, con el bloqueo por correo y los reintentos que ya tiene el onboarding.
- El correo del titular es único en toda la plataforma: 409 si ya existe.
- El plan debe corresponder al tipo: `PERSONAL_*` solo con `PERSONAL`, `CLINIC_*` solo con `CLINIC`, `TRIAL` con ambos. Si no, 400 `PLAN_TYPE_MISMATCH`.
- Suscripción: límites y banderas de `getPlanLimits` y `getPlanFeatureFlags` del plan elegido. `TRIAL`: estado `TRIALING`, `trialEndsAt` a 14 días, con los cupos de prueba actuales (clínica: 3 profesionales y 20 pacientes; personal: 1 y 10). Plan de pago: estado `ACTIVE`, `currentPeriodStart` ahora y `currentPeriodEnd` a un mes, sin `SubscriptionPayment`; se registra un `SubscriptionEvent` `SUBSCRIPTION_ACTIVATED` con el `ADMIN` como autor.
- Titular: rol `MASTER`, `isActive`, `emailVerified`, `mustChangePassword = true`, sin perfil profesional. `seatsPsychologistsUsed = 0`.
- Especialidades: `TenantSpecialtiesService.applySelection`, como hoy.
- Secciones: se crean las ocho filas, con `enabled` según la lista.
- `onboardingCompleted = true`.

La respuesta devuelve el consultorio, el titular (sin contraseña), la suscripción y las secciones.

### Cambio de plan desde el panel

- Se aplica al instante y sin `SubscriptionPayment`.
- Recalcula límites, precios y banderas con `getPlanLimits` y `getPlanFeatureFlags`; los valores `seatsPsychologistsMax` y `maxActivePatients` del cuerpo, si vienen, sustituyen a los del plan.
- Si `seatsPsychologistsUsed` o `activePatientsCount` superan los nuevos límites: 409 `PLAN_BELOW_USAGE` con los valores en `details`, sin cambios.
- Valida la correspondencia plan–tipo (`PLAN_TYPE_MISMATCH`).
- Si el plan cambia: cancela un `scheduledPlanChange` pendiente y los pagos `PENDING` de mejora del consultorio (pasan a `CANCELED`).
- Si el plan no cambia: solo se modifican cupos y máximo de pacientes; estado, período y fin de prueba quedan intactos, y no se cancelan pagos. Un cambio sin ninguna diferencia responde 400 `PLAN_UNCHANGED`. Un cambio solo del máximo de pacientes, que no genera `SubscriptionEvent`, queda en `AuditLog` con el motivo y el `ADMIN`.
- Pasar de `TRIAL` a un plan de pago deja el estado en `ACTIVE` con un período de un mes.
- Registra un `SubscriptionEvent` (`PLAN_UPGRADED` o `PLAN_DOWNGRADED`; `SEATS_INCREASED`/`SEATS_DECREASED` si solo cambian cupos) con `reason` y el `ADMIN` como autor.
- No modifica las secciones.

### Secciones desde el panel

- Clave que no está en el catálogo: 400 `SECTION_UNKNOWN`.
- Sección activa cuya dependencia no lo está: 400 `SECTION_DEPENDENCY` con `{ section, requires }`.
- Apagar una sección no borra datos.

### Autenticación

- `POST /auth/change-password` (`{ currentPassword, newPassword }`, marcada `@SessionRoute()`): valida la contraseña actual, exige que la nueva sea distinta y de al menos 8 caracteres, guarda el hash y pone `mustChangePassword = false`. `PATCH users/:tenantId/change-password` y `POST /auth/reset-password` también apagan el indicador.
- La respuesta de login y de refresco incluye `user.mustChangePassword`.

### Endpoints heredados

`provider-admin.controller.ts` pasa a `src/platform/platform-legacy-access.controller.ts` con rutas `/platform/legacy-access/pending`, `/platform/legacy-access/:tenantId/:userId/grant` y `/revoke`, rol `ADMIN`. Los handlers `grant-access` y `revoke-access` de `users.controller.ts` se eliminan.

### Auditoría

Suspender, reactivar, editar la cuenta, cambiar secciones y restablecer la contraseña del titular escriben un `AuditLog` con `tenantId` del consultorio afectado, `userId` del `ADMIN`, entidad `TENANT` (o `USER` para la contraseña), acción `UPDATE`, `reason` cuando existe y `changes` con el antes y el después. La contraseña nunca se guarda en `changes`. El cambio de plan queda en `SubscriptionEvent`.

### Errores

| Situación | Respuesta |
|---|---|
| Usuario que no es `ADMIN` en `/platform/*` | 403 |
| `ADMIN` fuera del panel | 403 `PLATFORM_ONLY` |
| Usuario con contraseña temporal | 403 `PASSWORD_CHANGE_REQUIRED` |
| Sección apagada o sin fila | 403 `SECTION_NOT_ENABLED` |
| Titular cambia una clave `core.*` | 403 `SECTION_MANAGED_BY_PLATFORM` |
| Correo del titular ya usado | 409 |
| Clave de sección desconocida | 400 `SECTION_UNKNOWN` |
| Dependencia de sección no satisfecha | 400 `SECTION_DEPENDENCY` |
| Plan que no corresponde al tipo | 400 `PLAN_TYPE_MISMATCH` |
| Plan por debajo del uso actual | 409 `PLAN_BELOW_USAGE` |
| Consultorio inexistente o de plataforma | 404 |
| Nueva contraseña igual a la actual | 400 `PASSWORD_UNCHANGED` |
| Cambio de plan sin ninguna diferencia | 400 `PLAN_UNCHANGED` |

### Punto a verificar al escribir el plan

Las consultas del panel leen y escriben filas de otros consultorios. `SubscriptionBillingService.listAll` y `confirmPayment` ya lo hacen hoy. Antes de implementar se confirma cómo interactúan `withRlsContext`/`applyRlsContext` y las políticas RLS existentes con lecturas entre consultorios, y el servicio del panel usa el mismo mecanismo que esos métodos.

## Web

### Tipos, guards y cliente

- `types/index.ts`: `User.mustChangePassword`; tipos del panel (`PlatformSummary`, `PlatformTenantRow`, `PlatformTenantDetail`, `SectionCatalog`, `CreatePlatformTenantInput`).
- `types/guards.ts`: `isPlatformAdmin(user) = user.role === UserRole.ADMIN`. `canManageUsers`, `canManageSubscription`, `canDeletePatient` y `specialty-manager.tsx` dejan de aceptar `SOPORTE`.
- `lib/constants.ts`: rutas `PLATFORM`, `PLATFORM_TENANTS`, `PLATFORM_TENANT_NEW`, `PLATFORM_TENANT_DETAIL(id)`, `PLATFORM_PAYMENTS`, `CHANGE_PASSWORD`; endpoints y claves de consulta del panel; etiqueta de `SOPORTE` se conserva solo para mostrar cuentas antiguas.
- `lib/api/endpoints.ts`: `platformApi` y `authApi.changePassword`. Se elimina `onboardingApi` (`CLINIC_ONBOARDING`).
- `lib/api/client.ts`: ante 403 `PASSWORD_CHANGE_REQUIRED` redirige a `/change-password`.

### Redirección por rol

- Login: `mustChangePassword` → `/change-password`; `ADMIN` → `/platform`; el resto → `/dashboard`.
- `(dashboard)/layout.tsx`: `ADMIN` → `/platform`; `mustChangePassword` → `/change-password`.
- `(platform)/layout.tsx`: sin sesión → `/login`; rol distinto de `ADMIN` → `/dashboard`; `mustChangePassword` → `/change-password`.

### Cambio de contraseña

`src/app/change-password/page.tsx`: contraseña actual, nueva y confirmación. Al guardar actualiza el usuario en `authStore` y redirige según el rol. Ofrece cerrar sesión.

### Secciones en el panel del consultorio

- `hooks/useSections.ts`: `useSections()` sobre `useTenantModules()`; devuelve `isEnabled(key)` y el estado de carga. Mientras carga, las secciones se tratan como apagadas.
- `sidebar.tsx`: cada elemento se muestra solo si su sección está activa, además de las reglas de rol actuales. Equipo pasa a depender únicamente de `core.team` (se elimina la alternativa `isClinicPlan`).
- Páginas `/calendar`, `/patients`, `/patients/[id]`, `/tasks`, `/admin/specialties`, `/admin/billing`, `/admin/team`, `/admin/storage`: con la sección apagada muestran el componente `restricted-access` existente con el texto "Esta sección no está habilitada para tu consultorio".
- `dashboard/page.tsx` y `usage-widgets.tsx`: ocultan los bloques de citas, tareas, pacientes y almacenamiento de secciones apagadas.
- `patients/[id]/page.tsx`: oculta las pestañas de Historia Clínica, Especialidades, tareas y facturas según la sección.

### Panel de plataforma

Grupo de rutas `src/app/(platform)/` con `layout.tsx` y `PlatformSidebar` ("Panel de control": Resumen, Consultorios, Pagos). Reutiliza `Header` y los componentes de `components/ui`. Código en `src/features/platform/` y hooks en `src/hooks/usePlatform.ts`.

| Ruta | Pantalla |
|---|---|
| `/platform` | Resumen: tarjetas de consultorios activos, en prueba, vencidos y suspendidos; pagos pendientes con monto y enlace; pruebas que vencen en 7 días; últimas altas. |
| `/platform/tenants` | Tabla con búsqueda, filtros por plan y estado, paginación y botón "Nuevo consultorio". |
| `/platform/tenants/new` | Formulario de alta. |
| `/platform/tenants/[tenantId]` | Ficha con bloques Cuenta, Titular, Plan y límites, Secciones, Estado y Uso. |
| `/platform/payments` | Tabla de pagos filtrada por estado; pendientes por defecto. |

**Formulario de alta** (validado con un esquema zod en `lib/validations/schemas.ts`):

1. Consultorio: nombre, correo, teléfono, dirección, tipo, zona horaria.
2. Titular: nombre, apellido, correo, contraseña temporal con botones "Generar" y "Mostrar".
3. Plan: los del catálogo del API que corresponden al tipo elegido.
4. Especialidades: al menos una.
5. Secciones: ocho casillas. Al elegir plan o tipo se premarcan las del catálogo. Si el `ADMIN` ya cambió alguna casilla a mano, al cambiar de plan se pregunta antes de reemplazar su selección. Marcar una sección marca Pacientes si depende de ella; desmarcar Pacientes desmarca las que dependen de ella.

Tras crear, una pantalla de confirmación muestra el correo del titular y la contraseña temporal una sola vez, con botón de copiar. La contraseña no se guarda en el estado global ni en la caché de consultas.

**Ficha del consultorio**

- Cuenta: editar datos de contacto.
- Titular: nombre y correo; "Restablecer contraseña" con el mismo patrón de mostrar una vez.
- Plan y límites: plan, cupos, máximo de pacientes y fechas del período; "Editar" abre un diálogo que exige motivo y muestra `PLAN_BELOW_USAGE` si ocurre.
- Secciones: ocho casillas con "Guardar cambios".
- Estado: "Suspender" (confirmación y motivo) o "Reactivar".
- Uso: profesionales, pacientes activos y notificaciones del mes.

**Pagos**: por fila, consultorio, tipo de cobro, plan, monto y fecha. "Confirmar" pide la referencia y "Rechazar" el motivo, ambos con diálogo de confirmación.

Todas las pantallas tienen estados de carga, vacío y error con reintento, y muestran el mensaje del API con el mecanismo del módulo de equipo.

### Cierre del registro público

- `src/app/onboarding/page.tsx` redirige a `/contacto`. Se eliminan `features/onboarding/` y los tipos y esquemas de onboarding que queden sin uso.
- Los botones del sitio público que llevan a `/onboarding` pasan a "Solicitar demo" y apuntan a `/contacto`.
- `src/app/activate` no cambia.

## Pruebas

**API, unitarias**

- `tenant.guard.spec.ts`: `ADMIN` del consultorio de plataforma entra a una ruta de plataforma; `ADMIN` de un consultorio normal, `MASTER`, `PROFESIONAL`, `ASISTENTE` y `SOPORTE` reciben 403; `ADMIN` fuera del panel recibe `PLATFORM_ONLY` salvo en rutas `@SessionRoute()`; `SOPORTE` ya no accede a otro consultorio.
- `subscription.guard.spec.ts` y `feature.guard.spec.ts`: sin excepción para `SOPORTE`; el `ADMIN` pasa en rutas de plataforma sin suscripción.
- `password-change.guard.spec.ts`: bloquea todo salvo rutas públicas y de sesión.
- `section.guard.spec.ts`: sección activa pasa; apagada y sin fila responden `SECTION_NOT_ENABLED`.
- `section-catalog.spec.ts`: premarcado por plan y tipo; dependencias.
- `platform-tenants.service.spec.ts`: alta completa; correo duplicado; secciones por defecto y explícitas; `SECTION_UNKNOWN`; `SECTION_DEPENDENCY`; `PLAN_TYPE_MISMATCH`; plan de pago nace `ACTIVE`; cambio de plan y `PLAN_BELOW_USAGE`; suspender revoca tokens; reactivar; restablecer contraseña; el consultorio de plataforma responde 404 y no aparece en listados.
- `platform-summary.service.spec.ts`: totales y exclusión del consultorio de plataforma.
- `tenant-specialties.service.spec.ts`: `SECTION_MANAGED_BY_PLATFORM`; `applySelection` no toca claves `core.*`.
- `auth`: `change-password` apaga `mustChangePassword`; `PASSWORD_UNCHANGED`; el login devuelve el indicador.
- `role-matrix.spec.ts`: los controladores de plataforma exigen `ADMIN` en cada handler; ningún handler exige `SOPORTE`.

**API, e2e** (`test/platform-admin.e2e-spec.ts`)

1. El `ADMIN` crea un consultorio con Tareas apagada.
2. El titular inicia sesión y recibe `PASSWORD_CHANGE_REQUIRED` al listar pacientes.
3. Cambia su contraseña y lista pacientes.
4. Recibe `SECTION_NOT_ENABLED` en tareas.
5. El `ADMIN` activa Tareas y el titular accede.
6. El `ADMIN` recibe `PLATFORM_ONLY` al pedir pacientes, citas y notas de ese consultorio.
7. El `ADMIN` suspende y el titular pierde acceso; reactiva y lo recupera.
8. `POST /onboarding/tenants` y `POST /tenants` responden 404.

Los e2e existentes que crean consultorios por el onboarding público o actúan como `SOPORTE` (`tenant-isolation`, `specialty-onboarding-team`, `master-role`, `subscription-billing`) pasan a usar `test/helpers/create-test-tenant.ts`, que crea las ocho secciones, y un `ADMIN` de plataforma.

**Migración**: prueba del relleno sobre consultorios `TRIAL`, de pago, `PERSONAL` y `CLINIC`, con y sin filas `core.*` previas, y de la desactivación de `SOPORTE`.

**Web**

- `roles.test.ts`: `isPlatformAdmin`; `SOPORTE` sin permisos de gestión.
- Layouts: redirecciones entre `/platform`, `/dashboard` y `/change-password` por rol y por contraseña temporal.
- `sidebar.test.tsx` y páginas del consultorio: elementos y páginas con sección apagada.
- `patient-detail`: pestañas ocultas por sección.
- Formulario de alta: premarcado por plan y tipo, dependencia de Pacientes, aviso al reemplazar una selección manual, contraseña mostrada una sola vez.
- Ficha y pagos: diálogos de confirmación y errores del API.
- `change-password`: validación y redirección por rol.

## Despliegue

Requiere ventana de mantenimiento. API y web se despliegan juntos: un front antiguo ofrecería el registro público contra un endpoint que ya no existe.

Requisito previo: cargar en `web/src/content/site.ts` un WhatsApp o correo de contacto reales (T-12). Sin ellos el formulario de demo no se muestra y, con el registro cerrado, el sitio público queda sin ninguna vía de captación.

1. Respaldar la base de datos.
2. Detener el API.
3. `npx prisma migrate deploy`. Esta migración se apila sobre `20261003000000`, `20261004000000` y `20261005000000`, que tampoco se han aplicado nunca.
4. Arrancar el API nuevo.
5. `npm run platform:create-admin`.
6. `npm run prisma:verify-platform-sections`. Código 0 = sin bloqueos.
7. Desplegar la web.

Reversión: restaurar el respaldo.

Antes de producción, ejecutar una vez contra una base desechable (`DATABASE_URL_TEST`): la migración, el script de verificación y `npm run test:e2e`.

## Documentación a actualizar

`api/docs/API_ENDPOINTS.md`, `api/docs/ARCHITECTURE.md`, `api/docs/SUBSCRIPTION_BILLING.md` (quién confirma los pagos), `api/docs/DEPLOYMENT.md`, `web/docs/ROUTE_MAP.md`, la colección de Postman y `TAREAS_PENDIENTES.md` (la "pantalla de soporte" pendiente de T-05 queda cubierta por Pagos).
