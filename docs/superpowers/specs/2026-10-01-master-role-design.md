# Rol MASTER para la cuenta del consultorio

Fecha: 2026-10-01
Estado: pendiente de revisión

## Objetivo

El perfil que controla la cuenta de un consultorio deja de ser `ADMIN` y pasa a ser `MASTER`. Los demás perfiles clínicos del consultorio son `PROFESIONAL` y no acceden a los módulos de gestión de la cuenta. `ADMIN` permanece en el enum, reservado para un uso futuro, y no concede ningún acceso dentro de un consultorio.

## Decisiones acordadas

1. `MASTER` es un valor nuevo del enum `UserRole`, no un campo aparte.
2. Cada consultorio tiene exactamente un `MASTER`: quien creó la cuenta. No se puede crear, asignar ni transferir desde la aplicación.
3. Solo `MASTER` accede a Equipo, Suscripción, Almacenamiento, Configuración y Módulos clínicos (especialidades).
4. Solo `MASTER` puede eliminar pacientes, eliminar tareas y consultar la auditoría.
5. Facturación sigue disponible para `MASTER` y `PROFESIONAL`.
6. El `MASTER` puede atender pacientes igual que hoy el admin: perfil profesional opcional, agenda, pacientes, y ocupa cupo de profesional cuando tiene perfil activo.
7. Los roles heredados `CLIENTE` y `PSICOLOGO` se migran en datos y el código deja de referenciarlos. `ASISTENTE`, `SOPORTE` y `PACIENTE` no cambian.

## Fuera de alcance

- Definir para qué se usará `ADMIN`.
- Transferencia de titularidad entre usuarios.
- Renombrar las rutas `/admin/*` del front o los endpoints del API.
- Eliminar `CLIENTE` y `PSICOLOGO` del enum de Postgres.
- Ampliar permisos clínicos del titular (ver "Comportamiento que se conserva").

## Matriz de permisos resultante

| Módulo / acción | MASTER | PROFESIONAL | ASISTENTE | ADMIN | SOPORTE |
|---|---|---|---|---|---|
| Equipo (`users`) | Sí | No | No | No | Como hoy |
| Suscripción | Sí | No | No | No | Como hoy |
| Datos del consultorio (`tenants`) y configuración (`tenant-settings`) | Sí | No | No | No | Como hoy |
| Almacenamiento | Sí | No | No | No | Como hoy |
| Especialidades / módulos clínicos (activar, desactivar, configurar) | Sí | No | No | No | Como hoy |
| Auditoría | Sí | No | No | No | Como hoy |
| Eliminar paciente | Sí | No | No | No | Como hoy |
| Eliminar tarea | Sí | No | No | No | Como hoy |
| Facturación | Sí | Sí | No | No | Como hoy |
| Tareas (crear, listar, editar) | Sí | Sí | No | No | Como hoy |
| Registros de especialidad | Sí | Sí | No | No | Como hoy |
| Notas clínicas y planes de sesión: leer, eliminar | Sí | Sí | No | No | Como hoy |
| Notas clínicas y planes de sesión: crear, editar | No | Sí | No | No | Como hoy |
| Citas, pacientes (crear, listar, editar), equipo del paciente | Sí | Sí | Sí | No | Como hoy |

"Como hoy" significa que el tratamiento de `SOPORTE` en guards y controladores no se toca.

### Comportamiento que se conserva

La sustitución es mecánica: `MASTER` ocupa exactamente el lugar que hoy ocupan `ADMIN`/`CLIENTE`, y `PROFESIONAL` el de `PSICOLOGO`/`PROFESIONAL`. Nadie gana permisos.

Consecuencia a tener presente: hoy crear y editar notas clínicas y planes de sesión exige `@Roles('PSICOLOGO')`, por lo que un admin recibe 403 aunque atienda pacientes. Con este diseño el `MASTER` hereda esa misma restricción. Cambiarla es una ampliación de permisos y queda fuera de este spec.

## Datos

Nueva migración Prisma `add_master_role`, en dos pasos porque Postgres no permite usar un valor de enum recién agregado dentro de la misma transacción.

**Paso 1 — enum**

```sql
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MASTER';
```

**Paso 2 — datos e índice** (migración separada, inmediatamente posterior)

1. Por cada `tenantId`, entre los usuarios con rol `ADMIN` o `CLIENTE`, elegir uno como `MASTER` con este orden: activos antes que inactivos, luego `createdAt` ascendente, luego `id` ascendente.
2. El resto de usuarios `ADMIN` o `CLIENTE` con `tenantId` no nulo pasa a `PROFESIONAL`.
3. Todos los `PSICOLOGO` pasan a `PROFESIONAL`.
4. Crear índice único parcial que garantiza un solo titular por consultorio:

```sql
CREATE UNIQUE INDEX "User_tenantId_master_key"
  ON "User" ("tenantId") WHERE role = 'MASTER';
```

El nombre real de la tabla y de las columnas se toma de `schema.prisma` (`@@map`) al escribir la migración. Usuarios `ADMIN`/`CLIENTE` sin `tenantId`, si existieran, no se modifican.

`schema.prisma`: se agrega `MASTER` a `UserRole` con comentario; `ADMIN` se comenta como reservado; `CLIENTE` y `PSICOLOGO` se comentan como obsoletos.

**Script de verificación** `prisma/verify-master-role-migration.ts`, siguiendo el patrón de `verify-patient-team-migration.ts`. Termina con código distinto de cero si encuentra:

- consultorios con cero o más de un `MASTER`;
- usuarios con rol `CLIENTE` o `PSICOLOGO`;
- usuarios `ADMIN` con `tenantId` no nulo.

Y lista, sin fallar, los casos que requieren acción manual del titular:

- usuarios `PROFESIONAL` sin perfil profesional.

La migración no inventa perfiles profesionales ni desactiva usuarios. Un `PROFESIONAL` sin perfil sigue pudiendo iniciar sesión; el titular completa su perfil o lo pasa a `ASISTENTE` desde Equipo.

**Seeds y utilidades**: `seed.ts`, `seed-demo-specialties.ts`, `demo-specialty-scenarios.ts` y `test/helpers/create-test-tenant.ts` crean al dueño como `MASTER` y dejan de usar `CLIENTE`/`PSICOLOGO`/`ADMIN`.

## API

### Capa de roles (`src/common/roles/role-compatibility.ts`)

- `CanonicalRole = 'MASTER' | 'PROFESIONAL' | 'ASISTENTE' | 'SOPORTE' | 'PACIENTE' | 'ADMIN'`.
- Se elimina `CompatibleRole` y la tabla de alias. `toCanonicalRole` devuelve el rol si es canónico y `undefined` en otro caso (incluidos `CLIENTE` y `PSICOLOGO`).
- `isAdminRole` se elimina y se reemplaza por `isMasterRole`. `isProfessionalRole` compara solo con `PROFESIONAL`.
- `RolesGuard` no cambia: sigue usando `areRolesEquivalent`, que ahora es igualdad entre roles canónicos.

Efecto buscado: un token con `ADMIN`, `CLIENTE` o `PSICOLOGO` no satisface ningún `@Roles` del consultorio.

### Controladores

| Archivo | Hoy | Queda |
|---|---|---|
| `audit-log.controller.ts` | `CLIENTE` | `MASTER` |
| `subscription.controller.ts` | `CLIENTE` | `MASTER` |
| `tenants.controller.ts` (endpoints de consultorio) | `CLIENTE` | `MASTER` |
| `tenant-settings.controller.ts` | `CLIENTE` | `MASTER` |
| `users.controller.ts` (gestión de equipo) | `ADMIN` | `MASTER` |
| `specialties.controller.ts` | `ADMIN` | `MASTER` |
| `patients.controller.ts` (eliminar) | `ADMIN` | `MASTER` |
| `tasks.controller.ts` (eliminar) | `CLIENTE` | `MASTER` |
| `billing.controller.ts` | `CLIENTE`, `PSICOLOGO` | `MASTER`, `PROFESIONAL` |
| `tasks.controller.ts` (resto) | `CLIENTE`, `PSICOLOGO` | `MASTER`, `PROFESIONAL` |
| `specialty-records.controller.ts` | `CLIENTE`, `PSICOLOGO` | `MASTER`, `PROFESIONAL` |
| `clinical-notes.controller.ts`, `next-session-plans.controller.ts` (leer, eliminar) | `CLIENTE`, `PSICOLOGO` | `MASTER`, `PROFESIONAL` |
| `clinical-notes.controller.ts`, `next-session-plans.controller.ts` (crear, editar) | `PSICOLOGO` | `PROFESIONAL` |
| `appointments.controller.ts`, `patient-team.controller.ts`, `patients.controller.ts` (resto) | `ADMIN`, `ASISTENTE`, `PROFESIONAL` | `MASTER`, `ASISTENTE`, `PROFESIONAL` |

Los endpoints `@Roles('SOPORTE')` no cambian.

### Servicios

Toda comparación con `'ADMIN'`, `'CLIENTE'`, `UserRole.ADMIN`, `UserRole.CLIENTE` o `isAdminRole` pasa a `MASTER` / `isMasterRole`; toda referencia a `PSICOLOGO` desaparece. Archivos afectados: `users.service.ts`, `patient-team.service.ts`, `appointments.service.ts`, `clinical-notes.service.ts`, `professional-profiles.service.ts`, `patients.service.ts`, `tenants.service.ts`, `billing.service.ts`, `onboarding.service.ts`, y cualquier otro que aparezca al buscar esos literales en `src/`.

Puntos concretos:

- `onboarding.service.ts`: el dueño se crea con `UserRole.MASTER`.
- `tenants.service.ts`: la creación de consultorio por soporte crea al dueño como `MASTER`.
- `patients.service.ts` y `billing.service.ts`: las búsquedas del dueño del consultorio filtran por `MASTER`; las listas `in [...]` quedan en `['MASTER', 'PROFESIONAL']`.

### Reglas del módulo de equipo (`users.service.ts`)

- Crear miembro: solo `PROFESIONAL` o `ASISTENTE`. Cualquier otro rol responde 400 con código `ROLE_NOT_ASSIGNABLE`.
- Editar miembro: no se puede asignar `MASTER` ni `ADMIN` como rol destino (`ROLE_NOT_ASSIGNABLE`).
- El usuario `MASTER` no puede cambiar de rol ni desactivarse, lo intente él mismo u otro actor del consultorio: 400 con código `MASTER_IMMUTABLE`. Sí se pueden editar sus datos personales y su perfil profesional.
- Las reglas actuales de "último admin activo" y "no auto-degradarse" se eliminan: quedan cubiertas por la inmutabilidad del `MASTER`.
- Los filtros de listado por rol dejan de expandir alias.
- Conteo de cupos: no cambia. El cupo lo ocupa cada perfil profesional activo, sin importar el rol; un usuario sin perfil no ocupa cupo.

### DTOs

- `users/dto/user.dto.ts`: el rol aceptado al crear/editar se restringe a `PROFESIONAL | ASISTENTE`; el ejemplo de Swagger pasa a `PROFESIONAL`.
- `auth.dto.ts`, `tenant.dto.ts`, `appointment.dto.ts`: se actualizan ejemplos y descripciones que mencionen `ADMIN`/`CLIENTE`.

### Sesiones existentes

`jwt.strategy.ts` ya devuelve el rol leído de la base de datos en cada petición, no el del payload, así que los tokens emitidos antes de la migración funcionan con el rol nuevo sin cerrar sesión. No requiere cambios en los guards.

Un ajuste: la estrategia abre el contexto RLS con `payload.role` (`app.current_user_role`). El repositorio no contiene ninguna política que lea ese valor, por lo que hoy no tiene efecto, pero un token antiguo lo fijaría a `ADMIN`/`CLIENTE`. Antes de desplegar se confirma en la base de datos (`pg_policies`) que ninguna política creada fuera de las migraciones compara `app.current_user_role` con un nombre de rol; si existe alguna, se actualiza en la misma migración de datos.

## Web

### Tipos y constantes

- `types/index.ts`: se agrega `UserRole.MASTER`. `TenantTeamRole = UserRole.MASTER | UserRole.PROFESIONAL | UserRole.ASISTENTE` para lectura; el tipo de rol asignable en formularios es `UserRole.PROFESIONAL | UserRole.ASISTENTE`. El contrato de onboarding (`role: UserRole.ADMIN`) pasa a `UserRole.MASTER`. `CLIENTE` y `PSICOLOGO` se eliminan del enum del front.
- `lib/constants.ts`: etiqueta `MASTER` = "Titular de la cuenta"; `ADMIN` = "Administrador" se conserva; se eliminan las de `CLIENTE` y `PSICOLOGO`.

### Guards (`types/guards.ts`)

- `isAdminRole` se reemplaza por `isMasterRole(role) = role === UserRole.MASTER`.
- `isProfessionalRole(role) = role === UserRole.PROFESIONAL`.
- `toCanonicalRole` se elimina; sus usos pasan a comparar el rol directamente.
- `canManageUsers`, `canManageSubscription`, `canDeletePatient`: `MASTER` o `SOPORTE`.
- `canAccessClinicalNotes`: `MASTER`, `PROFESIONAL` o `SOPORTE`.
- `canAddPatientTeamMember`: `MASTER`, `ASISTENTE`, `PROFESIONAL`. `canRemovePatientTeamMember` y la rama sin restricción de `canEditAppointment`: `MASTER`, `ASISTENTE`.

### Navegación y páginas

- `sidebar.tsx`: Módulos clínicos, Equipo, Suscripción, Almacenamiento y Configuración se muestran solo con `canManageUsers`/`canManageSubscription` (es decir, `MASTER` o `SOPORTE`). Facturación: `MASTER` o `PROFESIONAL`.
- Bloqueo por URL: `/admin/team`, `/admin/subscription`, `/admin/storage`, `/admin/settings` y `/admin/specialties` muestran el estado de "sin acceso" ya usado en `admin/settings/page.tsx` cuando el usuario no cumple el guard. Hoy `settings` y `specialties` ya lo hacen; se agrega a `team`, `subscription` y `storage`.
- `admin/billing/page.tsx`, `patients/[id]/page.tsx`, `specialty-manager.tsx`, `team-manager.tsx`: `isAdminRole` pasa a `isMasterRole`.
- Avisos de límites y banners de suscripción (`feature-locked-notice`, modales de cupo, pacientes y almacenamiento, `usage-widgets`, `subscription-banners`): el botón que lleva a `/admin/subscription` o `/admin/storage` solo se muestra si `canManageSubscription`; para el resto se muestra el texto "Contacta al titular de la cuenta".

### Equipo

- `team-member-dialog.tsx`: el selector de rol ofrece solo Profesional y Asistente. Al editar al `MASTER`, el rol se muestra como texto fijo "Titular de la cuenta" y el interruptor "también atiende pacientes" (`adminProvidesCare`, renombrado a `masterProvidesCare`) sigue disponible solo en ese caso.
- `team-manager.tsx`: el `MASTER` aparece en la lista con su etiqueta, sin acciones de cambiar rol ni desactivar. La lista de roles visibles pasa a `MASTER`, `PROFESIONAL`, `ASISTENTE`.
- `lib/validations/schemas.ts`: el esquema de miembro acepta `PROFESIONAL | ASISTENTE` para alta, y `MASTER` solo en edición del titular; el perfil profesional es obligatorio para `PROFESIONAL` y para `MASTER` cuando `masterProvidesCare` es verdadero.

## Manejo de errores

| Situación | Respuesta |
|---|---|
| Rol insuficiente en un endpoint | 403 del `RolesGuard`, como hoy |
| Alta o edición con rol `MASTER`, `ADMIN`, `CLIENTE`, `PSICOLOGO`, `SOPORTE` o `PACIENTE` | 400 `ROLE_NOT_ASSIGNABLE` |
| Cambiar el rol o desactivar al `MASTER` | 400 `MASTER_IMMUTABLE` |
| Segundo `MASTER` en un consultorio (carrera o escritura directa) | El índice único lo rechaza; el servicio lo traduce a 409 |

El front muestra el mensaje del API con el mecanismo de errores ya existente en el módulo de equipo.

## Pruebas

**API, unitarias**

- `role-compatibility.spec.ts`: `MASTER` es canónico; `CLIENTE` y `PSICOLOGO` ya no resuelven; `ADMIN` no equivale a `MASTER`.
- `roles.guard.spec.ts`: `ADMIN`, `CLIENTE` y `PSICOLOGO` reciben 403 frente a `@Roles('MASTER')` y `@Roles('PROFESIONAL')`.
- `users.service.spec.ts`, `users.team.spec.ts`, `users.controller.spec.ts`: alta solo de `PROFESIONAL`/`ASISTENTE`; `ROLE_NOT_ASSIGNABLE`; `MASTER_IMMUTABLE`; el `MASTER` puede editar su perfil profesional.
- Resto de specs que usan `ADMIN`/`CLIENTE`/`PSICOLOGO` como actor: se actualizan a `MASTER`/`PROFESIONAL` conservando sus aserciones.

**API, e2e**

- Nuevo `test/master-role.e2e-spec.ts`: un `PROFESIONAL` recibe 403 en cada endpoint solo-`MASTER` de la tabla de controladores; un usuario `ADMIN` del consultorio recibe 403 en todos los endpoints de consultorio; el onboarding crea un `MASTER`.
- `tenant-isolation`, `specialty-onboarding-team`, `professional-profiles`, `patient-team-appointments`, `users-seat-enforcement`, `subscription-professional-seats`: actualizados al rol nuevo.
- Prueba de la migración de datos sobre un consultorio con dos admins y un `PSICOLOGO`: queda un `MASTER` (el más antiguo activo), el otro pasa a `PROFESIONAL`, y el script de verificación lo lista como "sin perfil profesional".

**Web**

- `roles.test.ts`, `guards`: matriz de permisos por rol, incluido `ADMIN` sin acceso.
- `sidebar.test.tsx`: `PROFESIONAL` ve Facturación y no ve Módulos clínicos ni la sección Administración; `MASTER` ve todo.
- `team-member-dialog.test.tsx`, `team-manager.test.tsx`: sin opción Administrador; el titular sin acciones de rol ni desactivación.
- Páginas `/admin/*`: estado "sin acceso" para `PROFESIONAL` en las cinco rutas restringidas.
- Resto de tests que usan `ADMIN`/`CLIENTE`/`PSICOLOGO`: actualizados.

## Despliegue

El cambio requiere una ventana de mantenimiento: ningún orden sin corte es seguro. Con la migración aplicada y el API antiguo en marcha, el cliente Prisma antiguo no conoce el valor `MASTER` y falla al leer al titular en cada petición; con el API nuevo y la base sin migrar, los titulares siguen siendo `ADMIN`/`CLIENTE` y reciben 403 en todo.

Antes de producción, ejecutar una vez contra una base desechable (`DATABASE_URL_TEST`): `npm run prisma:verify-master-role-migration` y `npm run test:e2e`. Ese SQL y esos e2e no se han ejecutado nunca.

1. Respaldar la base de datos.
2. Detener el API antiguo (o ponerlo en mantenimiento).
3. Aplicar las dos migraciones: `npx prisma migrate deploy`.
4. Arrancar el API nuevo.
5. Ejecutar `npm run prisma:audit-master-roles`. Código 0 = sin bloqueos. Revisar `professionalsWithoutProfile`: el titular completa su perfil, los pasa a Asistente o los desactiva desde Equipo.
6. Desplegar web.

API y web se despliegan juntos: un front antiguo contra el API nuevo mostraría el menú de administración vacío para el titular, porque no reconoce `MASTER`.

Reversión: restaurar el respaldo. La migración de datos no es reversible por sí sola, porque tras ella no se distingue qué `PROFESIONAL` era antes `ADMIN`, `CLIENTE` o `PSICOLOGO`.

## Documentación a actualizar

`api/docs/API_ENDPOINTS.md`, `api/docs/ARCHITECTURE.md`, `web/docs/ROUTE_MAP.md`, `web/docs/SUBSCRIPTION_MODEL.md` y la colección de Postman, en lo que mencionen los roles `ADMIN`, `CLIENTE` o `PSICOLOGO`.
