# Diseño de catálogo, onboarding multiespecialidad y administración del equipo

**Fecha:** 2026-09-25
**Estado:** aprobado para planificación
**Depende de:** `2026-09-23-multispecialty-consulting-design.md` y la etapa de roles canónicos/perfiles profesionales
**Ramas base:** API y web `codex/professional-profiles`

## Contexto

La etapa anterior introdujo roles canónicos compatibles y un `ProfessionalProfile` opcional, uno a uno con `User`, que concentra la capacidad clínica y una única especialidad vigente. La plataforma ya contiene `Specialty`, `TenantSpecialty`, `SubscriptionSpecialty`, `SpecialtyModule` y `TenantModule`, pero sus flujos todavía no forman un producto coherente:

- no existe un endpoint separado para consultar el catálogo global;
- la página administrativa solo recibe especialidades ya habilitadas y, por tanto, no puede agregar otra del catálogo;
- reemplazar especialidades incrementa o decrementa el precio actual y no es idempotente frente a otras personalizaciones;
- `TenantSpecialty` y `SubscriptionSpecialty` pueden quedar desincronizados;
- los módulos pueden habilitarse sin comprobar de forma explícita que su especialidad esté activa;
- el onboarding web intenta crear una cuenta sin autenticación, mientras la API reserva el alta existente para `SOPORTE`;
- el onboarding no crea especialidades ni el perfil clínico opcional del administrador;
- el controlador de usuarios no expone la creación de miembros que el servicio ya soporta;
- un trial de consultorio se interpreta como plan personal para administrar equipo;
- profesionales nuevos quedan sometidos a aprobación del proveedor, aunque el administrador debe controlar su consultorio.

Esta etapa completa catálogo, onboarding y administración del equipo. Pacientes, equipo tratante, agenda e historial clínico compartido pertenecen a etapas posteriores.

## Objetivos

- Exponer un catálogo global activo, de solo lectura, utilizable antes de iniciar sesión.
- Crear un consultorio completo mediante un único comando transaccional de onboarding.
- Permitir que el administrador elija una o más especialidades y, opcionalmente, atienda bajo una sola de ellas.
- Reemplazar de forma segura e idempotente las especialidades habilitadas de un consultorio.
- Mantener sincronizados especialidades, módulos y selección facturable.
- Calcular el precio mensual desde fuentes canónicas, sin aplicar incrementos acumulativos.
- Permitir que el administrador cree y gestione miembros del equipo sin aprobación ordinaria de `SOPORTE`.
- Conservar compatibilidad con roles, campos y endpoints heredados durante la ventana de transición.

## Fuera de alcance

- Crear `PatientProfessional` o administrar el equipo tratante de un paciente.
- Renombrar `psychologistId`, `assignedPsychologistId` u otras referencias clínicas heredadas.
- Cambiar las validaciones de citas por especialidad; corresponde a la etapa 4.
- Implementar autorización clínica compartida, versionado o auditoría clínica; corresponde a la etapa 5.
- Crear definiciones dinámicas de formularios clínicos; corresponde a la etapa 6.
- Permitir edición del catálogo global desde la web.
- Cobrar por un proveedor de pagos externo. Se calculará y persistirá el precio canónico, pero no se emitirá un cargo.
- Publicar el flujo heredado de invitación/activación por `tenantId + userId`. Esta etapa usará creación directa con contraseña inicial; una invitación por correo futura deberá emplear token aleatorio, con hash y expiración.

## Enfoques considerados

### 1. Orquestación transaccional compatible — seleccionado

Se conservan los modelos actuales y se crean servicios de dominio pequeños para catálogo, selección y precio. El onboarding coordina esos servicios dentro de una transacción. Los endpoints heredados continúan como adaptadores temporales.

Ventajas:

- menor riesgo de migración;
- software desplegable al finalizar la etapa;
- compatibilidad con los datos y clientes actuales;
- permite retirar contratos heredados en etapas posteriores.

Costo:

- durante una versión se mantienen escrituras espejo en `ProfessionalSpecialty` y compatibilidad de roles.

### 2. Onboarding compuesto desde la web — descartado

La web podría crear el tenant, iniciar sesión y llamar después a especialidades, módulos y perfil. Se descarta porque un fallo intermedio deja consultorios incompletos y hace difícil reintentar sin duplicar precio o datos.

### 3. Sustitución inmediata del esquema de suscripción y especialidades — descartado

Crear nuevas tablas de catálogo, versiones de precio y órdenes de compra permitiría un dominio comercial más rico. Se descarta en esta etapa porque amplía el alcance y no es necesario para cumplir las reglas aprobadas.

## Decisiones funcionales

### Autoservicio y responsabilidad administrativa

El alta ordinaria será autoservicio. `SOPORTE` no aprobará profesionales ni administrará el equipo cotidiano de un consultorio. El administrador controla cuentas, roles, acceso y capacidad clínica dentro de los límites de la suscripción.

El endpoint administrativo existente para crear tenants se conserva para compatibilidad y operaciones del proveedor. El autoservicio utilizará un contrato público separado, evitando convertir una operación privilegiada en pública por accidente.

### Tipo de tenant

El onboarding público crea un tenant `CLINIC`. Un consultorio con una sola persona sigue siendo válido y puede crecer después. Los tenants `PERSONAL` existentes continúan funcionando, pero no reciben administración de equipo múltiple mediante esta etapa.

Un trial perteneciente a un tenant `CLINIC` sí puede usar el equipo hasta `seatsPsychologistsMax`; la elegibilidad no se inferirá únicamente de que `planType` sea `TRIAL`.

### Administrador clínico opcional

El administrador se crea con rol canónico `ADMIN`.

- Si `adminProvidesCare = false`, no se crea `ProfessionalProfile` y no consume cupo profesional.
- Si `adminProvidesCare = true`, `adminSpecialtyCode` es obligatorio, debe pertenecer a `specialtyCodes` y se crea un perfil activo con esa especialidad.
- Se mantiene la escritura compatible de `ProfessionalSpecialty` con una sola relación primaria.
- Título, licencia y biografía se guardan en el perfil; título y licencia se reflejan temporalmente en `User`.

### Creación del equipo

La etapa expondrá creación directa de usuarios autenticada y restringida a administradores. El administrador define una contraseña inicial que cumple la política vigente. La respuesta nunca devuelve el hash ni la contraseña.

- `PROFESIONAL` requiere un perfil con exactamente una especialidad habilitada.
- `ADMIN` puede tener o no perfil profesional.
- `ASISTENTE` no puede recibir perfil profesional.
- `SOPORTE` y `PACIENTE` no pueden crearse desde la administración del consultorio.
- Activar un perfil profesional valida y reserva cupo en la misma transacción.
- Desactivar solo el perfil conserva la cuenta para tareas no clínicas y libera el cupo.
- Desactivar la cuenta impide el acceso y hace que su perfil deje de contar como activo, sin borrar historial.
- Un administrador no puede desactivar su propia cuenta ni eliminar o desactivar al último administrador activo.

Las filas heredadas con `managedByProvider = true` se migrarán a `false` para cuentas de consultorio. Los endpoints del proveedor se conservarán temporalmente, pero no participarán en el flujo ordinario ni recibirán nuevas cuentas.

## Arquitectura API

### Catálogo global

Se agregará:

```text
GET /api/v1/specialties
```

Será público, de solo lectura y estará sujeto al limitador global existente. Devolverá únicamente especialidades con `isActive = true`, ordenadas por nombre, con sus módulos ordenados por `moduleKey`.

La respuesta será:

```ts
type CatalogSpecialty = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  modules: Array<{
    id: string;
    moduleKey: string;
  }>;
};
```

No aceptará `tenantId` y no revelará configuración ni uso de ningún consultorio.

### Onboarding público

Se agregará:

```text
POST /api/v1/onboarding/tenants
```

Contrato de entrada:

```ts
type CreateClinicOnboardingInput = {
  clinicName: string;
  contactEmail: string;
  contactPhone?: string;
  address?: string;
  timezone: string;
  locale: string;
  specialtyCodes: string[]; // al menos una, sin duplicados después de normalizar
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  adminProvidesCare: boolean;
  adminSpecialtyCode?: string;
  adminProfessionalTitle?: string;
  adminLicenseNumber?: string;
  adminBio?: string;
};
```

La API normalizará códigos con `trim().toUpperCase()`. Rechazará catálogo inactivo o inexistente, lista vacía, especialidad clínica fuera de la selección y metadatos clínicos contradictorios.

La contraseña se transforma antes de abrir la transacción. Una única transacción serializable crea:

1. `Tenant` de tipo `CLINIC` y `onboardingCompleted = true`;
2. `TenantSettings` con zona horaria y locale solicitados;
3. `TenantSubscription` trial con límites para consultorio;
4. usuario administrador `ADMIN`;
5. `TenantSpecialty` para toda la selección;
6. `SubscriptionSpecialty` para la misma selección;
7. `TenantModule` habilitado para cada módulo derivado, sin duplicados;
8. perfil profesional y relación heredada primaria cuando el administrador atiende;
9. conteo de cupos y precio mensual canónicos.

Ante cualquier error no queda ningún recurso parcial. El conflicto de correo mantiene el contrato `409`. La respuesta incluye tenant, administrador seguro, especialidades, módulos y resumen de precio; no incluye contraseña.

La web iniciará sesión después con el contrato de autenticación existente. Un fallo de red al iniciar sesión no repite el alta: el consultorio ya creado puede ingresar normalmente.

### Especialidades del tenant

Contratos:

```text
GET  /api/v1/tenants/:tenantId/specialties
PUT  /api/v1/tenants/:tenantId/specialties
POST /api/v1/tenants/:tenantId/specialties  # adaptador temporal al PUT
```

`GET` conserva el significado de especialidades habilitadas. `PUT` recibe `{ specialtyCodes: string[] }`, exige al menos una y reemplaza toda la selección. Solo un administrador del mismo tenant puede cambiarla.

Antes de retirar una especialidad se comprueba:

- que no tenga `ProfessionalProfile.isActive = true` perteneciente a un usuario activo del tenant;
- que no tenga citas futuras en estados distintos de `CANCELLED`;
- que todas las referencias consultadas pertenezcan al tenant de la ruta.

Los bloqueos usan `409` con códigos estables:

- `SPECIALTY_IN_USE_BY_ACTIVE_PROFESSIONAL`;
- `SPECIALTY_HAS_FUTURE_APPOINTMENTS`.

Dentro de una transacción serializable, la operación:

1. reemplaza `TenantSpecialty`;
2. reemplaza `SubscriptionSpecialty` con exactamente los mismos identificadores;
3. crea habilitados los módulos nuevos;
4. elimina `TenantModule` que ya no pertenece a ninguna especialidad seleccionada;
5. conserva todos los registros clínicos históricos, porque sus referencias apuntan al catálogo global;
6. recalcula el precio completo desde valores canónicos;
7. devuelve el estado final, incluso cuando la solicitud no produjo cambios.

Repetir la misma solicitud produce el mismo conjunto de filas y el mismo precio.

### Módulos del tenant

Contratos existentes:

```text
GET   /api/v1/tenants/:tenantId/modules
PATCH /api/v1/tenants/:tenantId/modules/:moduleKey
```

`PATCH` seguirá aceptando `{ enabled: boolean }`, pero verificará que `moduleKey` pertenezca al menos a una especialidad actualmente seleccionada. No se podrá habilitar un módulo ajeno o perteneciente solo a una especialidad inactiva. El administrador podrá deshabilitar módulos válidos individualmente.

Al volver a agregar una especialidad, sus módulos se recrean habilitados. Esto no modifica `SpecialtyRecord` históricos, cuyo `moduleKey` permanece intacto.

### Precio canónico

Las constantes de planes, módulos incluidos, precios de add-ons, especialidades incluidas y precio unitario se moverán a un módulo puro compartido por `SubscriptionService`, onboarding y selección de especialidades.

El total mensual se calcula como:

```text
precio base canónico del plan
+ módulos comerciales seleccionados que no están incluidos
+ max(0, especialidades seleccionadas - especialidades incluidas) * precio por especialidad
```

No se usará `increment` ni `decrement` sobre `basePrice`. Cambiar módulos, plan o especialidades invocará el mismo cálculo para que una personalización no borre el costo de otra.

La respuesta de selección incluirá:

```ts
type SpecialtySelectionResult = {
  tenantId: string;
  specialties: CatalogSpecialty[];
  modules: Array<{ moduleKey: string; enabled: boolean }>;
  pricing: {
    includedSpecialties: number;
    selectedSpecialties: number;
    billableSpecialties: number;
    specialtyUnitPrice: number;
    basePlanPrice: number;
    featureAddonsPrice: number;
    specialtyAddonsPrice: number;
    totalMonthly: number;
    currency: string;
  };
};
```

### Administración del equipo

Se agregará al controlador existente:

```text
POST /api/v1/tenants/:tenantId/users
```

El DTO no acepta `tenantId`; se toma de la ruta. Tampoco acepta `managedByProvider`, campos de auditoría ni identificadores internos.

El servicio determinará acceso al equipo usando conjuntamente:

- `Tenant.tenantType = CLINIC`;
- suscripción `ACTIVE` o `TRIALING`;
- cupo profesional disponible cuando el perfil quedará activo.

El tipo `TRIAL` no será tratado por sí solo como plan personal. Crear o reactivar un profesional y actualizar el conteo de cupos seguirá siendo serializable y resistente a concurrencia.

Los endpoints de actualización existentes admitirán la edición administrativa de rol permitido, datos básicos, especialidad y estado del perfil. Las reglas del último administrador se evaluarán dentro de la transacción para evitar dos desactivaciones concurrentes.

## Arquitectura web

### Cliente y tipos

Se separarán tres clientes:

- `specialtyCatalogApi.list()` para el catálogo público;
- `tenantSpecialtiesApi.get()/replace()` para la selección autenticada;
- `tenantModulesApi.list()/setEnabled()` para módulos del tenant.

Los tipos representarán por separado catálogo, selección y resumen de precio. El `POST` heredado no será usado por la web nueva.

### Wizard de onboarding

El flujo tendrá cuatro estados visibles:

1. datos del consultorio;
2. selección de una o más especialidades desde el catálogo público;
3. cuenta del administrador y pregunta “¿También atenderás pacientes?”;
4. confirmación, creación, inicio de sesión y redirección.

Cuando el administrador atenderá, la interfaz muestra únicamente las especialidades seleccionadas y solicita una. Título, licencia y biografía son opcionales. Cuando no atenderá, esos campos no se envían.

El botón final realiza una sola mutación de onboarding. Los pasos anteriores solo mantienen estado local validado; no crean recursos parciales. Al completar, se guardan tokens y tenant usando el flujo de autenticación existente.

### Administración de especialidades

La página obtendrá en paralelo el catálogo global, la selección del tenant y sus módulos. Mostrará todas las especialidades activas, diferenciando seleccionada, no seleccionada y bloqueada por una respuesta del servidor.

Antes de guardar se mostrará una vista previa local de cantidad incluida y adicional. La API sigue siendo la autoridad del precio final. Tras guardar se invalidan especialidades, módulos, suscripción y métricas de uso.

Los módulos de especialidades activas tendrán interruptores individuales. Un error de dependencia o uso mostrará el mensaje y código devueltos por la API sin retirar optimistamente la especialidad.

### Administración del equipo

La página de equipo agregará creación y edición mediante componentes separados del listado principal. El formulario:

- permite `ADMIN`, `PROFESIONAL` y `ASISTENTE`;
- exige contraseña inicial al crear;
- exige especialidad para `PROFESIONAL`;
- ofrece perfil clínico opcional para `ADMIN`;
- no ofrece perfil para `ASISTENTE`;
- lista solo especialidades habilitadas;
- muestra por separado acceso de cuenta y actividad clínica;
- permite desactivar/reactivar el perfil y la cuenta según las reglas del servidor.

La tabla mostrará especialidad, rol, estado de cuenta, estado clínico y consumo de cupos. Las acciones se deshabilitan durante la mutación y siempre refrescan usuarios, suscripción y métricas después de una respuesta exitosa.

## Compatibilidad y migración

La migración de esta etapa será aditiva y de reconciliación:

1. conservará los modelos y claves actuales;
2. insertará `SubscriptionSpecialty` faltantes a partir de `TenantSpecialty`;
3. eliminará selecciones de suscripción que no correspondan al mismo tenant;
4. creará módulos faltantes derivados de especialidades habilitadas sin alterar registros clínicos;
5. cambiará a `false` `managedByProvider` para usuarios de tenants `CLINIC` gestionados actualmente por el proveedor;
6. recalculará conteos de perfiles profesionales efectivos;
7. no renombrará columnas clínicas heredadas.

Antes de aplicar cambios destructivos de reconciliación, la migración abortará si detecta una relación de suscripción que no puede asociarse inequívocamente a su tenant. Se verificará la cadena completa en una base vacía y se comparará el esquema Prisma al terminar.

Los contratos temporales conservados son:

- roles `CLIENTE`/`PSICOLOGO` equivalentes a `ADMIN`/`PROFESIONAL`;
- `POST /tenants/:tenantId/specialties` delegado a la operación de reemplazo;
- lectura y escritura espejo de `ProfessionalSpecialty` mientras permanezca en el esquema;
- endpoints administrativos del proveedor, sin nuevas cuentas ordinarias asociadas a ellos.

## Manejo de errores

Además de los contratos existentes, la etapa utilizará códigos estables:

| Código | HTTP | Situación |
|---|---:|---|
| `SPECIALTY_SELECTION_REQUIRED` | 400 | El consultorio intenta quedar sin especialidades. |
| `SPECIALTY_NOT_AVAILABLE` | 404 | Código inexistente o inactivo. |
| `ADMIN_SPECIALTY_NOT_SELECTED` | 400 | El administrador clínico eligió una especialidad fuera de la selección. |
| `SPECIALTY_IN_USE_BY_ACTIVE_PROFESSIONAL` | 409 | Se intenta retirar una especialidad con profesionales activos. |
| `SPECIALTY_HAS_FUTURE_APPOINTMENTS` | 409 | Se intenta retirar una especialidad con citas futuras vigentes. |
| `MODULE_SPECIALTY_NOT_ENABLED` | 409 | Se intenta habilitar un módulo sin especialidad activa. |
| `TEAM_NOT_AVAILABLE` | 403 | El tenant no es `CLINIC` o la suscripción no está operativa. |
| `PROFESSIONAL_SEAT_LIMIT_REACHED` | 409 | No existe cupo para activar otro perfil. |
| `CANNOT_DEACTIVATE_SELF` | 409 | El administrador intenta desactivar su propia cuenta. |
| `LAST_ACTIVE_ADMIN_REQUIRED` | 409 | La acción dejaría al consultorio sin administrador activo. |

Los mensajes serán aptos para presentar al usuario y no expondrán consultas, precios internos no aplicables ni datos de otros tenants.

## Seguridad y aislamiento

- Solo catálogo y onboarding son públicos.
- El limitador global se aplica a ambos; no se añade una excepción de rate limit.
- Todos los endpoints con `:tenantId` siguen pasando por autenticación y `TenantGuard`.
- Las mutaciones de especialidades, módulos y equipo requieren rol administrativo equivalente.
- El tenant efectivo siempre proviene de la ruta y del contexto autenticado, nunca del cuerpo.
- Todas las consultas de dependencias incluyen `tenantId` cuando el modelo lo permite.
- Las contraseñas se validan y transforman con el servicio de autenticación existente.
- Ninguna respuesta de usuario incluye `password`.
- El flujo inseguro de activación por identificadores no se conecta a la nueva interfaz.

## Estrategia de pruebas

### API unitarias

- catálogo: solo activos, orden y módulos;
- DTO de onboarding: matriz de administrador clínico/no clínico;
- onboarding: creación completa, rollback ante cada dependencia inválida y ausencia de secretos;
- selección: normalización, reemplazo, sincronización e idempotencia;
- selección: bloqueo por perfil activo y cita futura, permitiendo historial o cita cancelada;
- módulos: deshabilitación válida y rechazo de habilitación sin especialidad;
- precio: plan base, add-ons comerciales y especialidades adicionales en combinaciones independientes;
- equipo: roles permitidos, especialidad obligatoria, trial de clínica, cupos y último administrador;
- concurrencia: dos activaciones para el último cupo y dos desactivaciones del último par de administradores.

### API E2E

- consultar catálogo sin token;
- completar onboarding, iniciar sesión y comprobar tenant, especialidades, módulos y perfil opcional;
- reemplazar especialidades dos veces y obtener exactamente el mismo precio;
- crear un profesional desde una sesión administrativa y rechazar una especialidad de otro tenant;
- confirmar que un administrador de un tenant no puede modificar otro;
- desplegar todas las migraciones en una base desechable y comprobar `migrate diff` vacío.

### Web

- esquemas condicionales del wizard;
- payload exacto del onboarding con y sin perfil clínico;
- selección completa del catálogo y presentación de precio;
- conservación visual de la selección cuando la API devuelve un bloqueo;
- formularios de equipo por rol y especialidad;
- refresco de usuarios, suscripción y uso después de mutaciones;
- lint, type-check, pruebas de componentes y build de producción.

## Criterios de aceptación

- Un visitante puede consultar el catálogo activo sin autenticarse.
- Un nuevo consultorio selecciona al menos una especialidad y se crea por completo con una sola solicitud.
- El administrador puede operar sin perfil profesional o atender bajo exactamente una especialidad seleccionada.
- Repetir una selección de especialidades no duplica filas ni cambia el precio.
- `TenantSpecialty` y `SubscriptionSpecialty` contienen la misma selección por consultorio.
- El precio conserva simultáneamente add-ons comerciales y especialidades adicionales.
- No se puede retirar una especialidad usada por profesionales activos o citas futuras vigentes.
- No se puede habilitar un módulo cuya especialidad no esté activa.
- Un administrador de consultorio puede crear y gestionar profesionales sin aprobación ordinaria de soporte.
- Un trial de tipo `CLINIC` permite administrar equipo hasta su límite de cupos.
- El consultorio nunca queda sin un administrador activo.
- Los tenants personales y contratos heredados continúan siendo legibles durante la transición.
- No se modifica la estructura actual de pacientes, citas o registros clínicos en esta etapa.
