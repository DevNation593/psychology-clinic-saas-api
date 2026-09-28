# Diseño de equipo tratante y citas multiespecialidad

**Fecha:** 2026-09-27
**Estado:** aprobado para implementación
**Depende de:** `2026-09-23-multispecialty-consulting-design.md` y la etapa de catálogo, onboarding y administración del equipo
**Ramas de trabajo:** API y web `codex/patient-team-appointments`
**Bases verificadas:** API `647037981ff86be378ca5acb14d542955c191a72`; web `f02b3bd1c8a28b8b31054936a65c9ecdd6fb5cb4`

## Contexto

El sistema ya permite que un consultorio habilite varias especialidades y que cada cuenta con capacidad clínica tenga un único `ProfessionalProfile`. Sin embargo, pacientes y citas todavía conservan el modelo original de psicología:

- `Patient.assignedPsychologistId` solo permite una persona tratante;
- `Appointment.psychologistId` es la referencia obligatoria al profesional;
- `Appointment.specialtyId` es opcional y no se valida contra el perfil profesional;
- el alta y la edición de pacientes presentan un único selector de “Psicólogo asignado”;
- la agenda filtra usuarios por rol en vez de usar el perfil profesional activo y su especialidad;
- los permisos actuales no representan correctamente a administradores clínicos ni asistentes;
- crear una cita no incorpora de forma explícita al profesional al equipo tratante del paciente.

Esta etapa introduce el equipo tratante múltiple y convierte la agenda a contratos canónicos de profesional y especialidad. Se conserva una sola ficha demográfica de `Patient`, aunque la persona reciba atención de distintas especialidades. La transición será compatible: los campos centrados en psicología seguirán disponibles temporalmente mientras API y web migran.

## Objetivos

- Mantener una única ficha de paciente por consultorio.
- Permitir que un paciente tenga varios profesionales tratantes, de una o varias especialidades.
- Registrar quién realizó cada asignación nueva o reactivación.
- Incorporar automáticamente al equipo tratante al profesional de una cita creada o reasignada.
- Impedir que se desactive una asignación mientras existan citas futuras no canceladas entre ese paciente y ese profesional.
- Exigir que toda cita nueva conserve un profesional y una especialidad histórica coherentes.
- Permitir que administradores y asistentes gestionen equipo tratante y agenda.
- Permitir referencias entre profesionales, sin permitir que un profesional retire a terceros del equipo.
- Sustituir la terminología visible de psicólogo por profesional en las superficies afectadas.
- Desplegar el cambio sin romper clientes o datos que todavía usan `assignedPsychologistId` o `psychologistId`.

## Fuera de alcance

- Cambiar la estructura demográfica existente de `Patient` o crear un paciente por especialidad.
- Implementar autorización clínica compartida, versionado, auditoría inmutable o línea clínica; corresponde a la etapa 5.
- Cambiar `ClinicalNote` o `NextSessionPlan` a referencias canónicas; se conservarán compatibles hasta sus etapas clínicas.
- Crear definiciones dinámicas o renderizadores de módulos clínicos; corresponde a la etapa 6.
- Completar formularios verticales de Psicología, Nutrición, Fisioterapia u Odontología.
- Eliminar físicamente `Patient.assignedPsychologistId`, `Appointment.psychologistId` o sus relaciones heredadas.
- Rediseñar toda la página de detalle del paciente. Solo se extraerán las áreas de equipo tratante y citas necesarias para esta etapa.
- Cambiar la política general de acceso al contenido de notas clínicas.

## Enfoques considerados

### 1. Migración aditiva con adaptadores de compatibilidad — seleccionado

Se agregan `PatientProfessional` y `Appointment.professionalId`, se rellenan desde los datos actuales y la API normaliza contratos heredados y canónicos hacia un único flujo de dominio. Durante la ventana de transición se escriben las referencias compatibles y se devuelven alias heredados.

Ventajas:

- permite desplegar API antes que web;
- conserva datos y clientes existentes;
- separa la migración funcional de la posterior eliminación física de campos;
- permite verificar reconciliación y aislamiento antes de endurecer restricciones.

Costo:

- hay dos nombres para la referencia profesional durante una versión de compatibilidad;
- las columnas canónicas permanecen físicamente opcionales durante el despliegue gradual, aunque la API las exige para toda escritura nueva.

### 2. Corte inmediato a campos canónicos — descartado

Hacer obligatorios `professionalId` y `specialtyId` y retirar los campos heredados en una sola migración simplificaría el estado final. Se descarta porque una versión anterior de la API o web dejaría de funcionar durante el despliegue y porque impediría reconciliar datos antes de aplicar restricciones finales.

### 3. Un paciente distinto por especialidad — descartado

Duplicar la ficha por especialidad conservaría asignaciones simples, pero fragmentaría datos demográficos e historial, produciría inconsistencias y contradice la regla aprobada de una única estructura de paciente compartida.

## Modelo de dominio

### `PatientProfessional`

La relación canónica del equipo tratante será:

```prisma
model PatientProfessional {
  id             String   @id @default(cuid())
  tenantId       String
  patientId      String
  professionalId String
  assignedAt     DateTime @default(now())
  assignedById   String?
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([patientId, professionalId])
  @@index([tenantId, patientId, isActive])
  @@index([tenantId, professionalId, isActive])
}
```

Las relaciones apuntarán a `Tenant`, `Patient`, al `User` que actúa como profesional y al `User` asignador. `assignedById` será obligatorio en operaciones nuevas a nivel de servicio, pero permanecerá nullable en base de datos para no inventar un actor al migrar asignaciones históricas que no guardaron esa procedencia.

La combinación `patientId + professionalId` es única porque ambos identificadores ya son globalmente únicos. `tenantId` se conserva de forma explícita para consultas e invariantes de aislamiento. La API nunca confiará solo en la unicidad: comprobará que paciente, profesional, actor y fila de asignación pertenezcan al tenant autenticado.

Una asignación no se borra físicamente. Retirarla establece `isActive = false`. Agregar una combinación inexistente la crea; agregar una combinación inactiva la reactiva, renueva `assignedAt` y `assignedById`; agregar una combinación ya activa es idempotente y no altera su procedencia.

La especialidad no se duplica en esta tabla. Para estado actual se obtiene de `ProfessionalProfile.specialtyId`. Los registros y citas históricas conservan por separado la especialidad vigente al momento de su creación. Si un perfil se elimina por completo, su asignación histórica ya inactiva se conserva y devuelve `specialty: null`; la interfaz la agrupa como “Sin especialidad vigente”. Una asignación activa o un candidato elegible nunca puede tener especialidad nula.

### Compatibilidad de `Patient.assignedPsychologistId`

El campo heredado se conserva durante esta etapa y deja de ser la fuente canónica del equipo:

- una escritura heredada con un identificador no nulo crea o reactiva la asignación correspondiente;
- esa escritura no desactiva a ningún otro integrante del equipo;
- una escritura heredada con `null` limpia únicamente el puntero heredado y no modifica asignaciones canónicas;
- al agregar canónicamente un integrante, la API solo llena el puntero heredado si estaba vacío;
- al retirar al integrante señalado por el puntero heredado, la API selecciona de forma determinista la asignación activa más antigua restante o deja el campo en `null`;
- las respuestas de paciente conservan `assignedPsychologist` como alias temporal, pero los clientes nuevos consultan `team`.

Así se mantiene el funcionamiento de clientes anteriores sin volver a imponer una sola persona tratante.

### `Appointment`

Se agrega una relación canónica nullable durante la transición:

```prisma
professionalId String?
professional   User? @relation(/* nombre de relación explícito */)
```

`psychologistId` y su relación permanecen. Toda escritura realizada por la API nueva guarda el mismo identificador en `professionalId` y `psychologistId`. `specialtyId` también permanece físicamente nullable para un despliegue compatible, pero será obligatorio a nivel de dominio para citas nuevas y para cualquier reasignación.

La cita conserva su `specialtyId` como dato histórico. Cambiar posteriormente la especialidad del perfil no reescribe citas pasadas. El valor por defecto visible para nuevas citas será neutral, por ejemplo “Consulta”; no se modificarán títulos históricos.

Se agregarán índices canónicos equivalentes a los actuales, especialmente `(tenantId, professionalId, startTime)` y los necesarios para buscar citas futuras por paciente y profesional.

## Invariantes

Una asignación activa exige que:

- paciente y profesional pertenezcan al tenant de la ruta y de la identidad autenticada;
- el paciente no esté eliminado;
- la cuenta profesional esté activa;
- exista un `ProfessionalProfile` activo;
- la especialidad del perfil esté activa en catálogo y habilitada para el consultorio.

Para conservar esa invariante, desactivar la cuenta, desactivar o retirar su perfil profesional o cambiarla a un rol sin capacidad clínica también comprobará citas futuras no canceladas en todo el tenant. Si existen, la operación se bloquea hasta cancelarlas o reasignarlas. Si no existen, todas sus asignaciones activas se desactivan dentro de la misma transacción. Reactivar posteriormente la cuenta o el perfil no reactiva equipos antiguos de forma implícita.

Una cita nueva o reasignada exige además que:

- `professionalId` y `specialtyId` estén resueltos;
- `specialtyId` coincida con `ProfessionalProfile.specialtyId`;
- no exista conflicto de horario para el profesional en citas no canceladas;
- el intervalo y la duración cumplan las reglas actuales;
- la asignación activa al equipo tratante exista al confirmar la transacción.

Una actualización que no cambie profesional, especialidad ni intervalo conserva los datos históricos sin revalidarlos contra una especialidad actual que pudo cambiar. Reasignar, cambiar especialidad o mover una cita a un nuevo intervalo sí valida el estado profesional vigente.

Reasignar una cita incorpora o reactiva al profesional nuevo, pero no retira automáticamente al profesional anterior. Su salida del equipo siempre será una acción explícita sujeta al bloqueo de citas futuras.

## Arquitectura API

### Servicio compartido de elegibilidad

Equipo tratante y agenda usarán la misma lógica de dominio para resolver un profesional elegible. La resolución se basa en `ProfessionalProfile`, no en el rol de `User`, por lo que incluye tanto cuentas `PROFESIONAL` como administradores que atienden y tienen un perfil activo.

La resolución comprobará tenant, cuenta activa, perfil activo, especialidad habilitada y, cuando se proporciona, coincidencia de `specialtyId`. No se aceptará una cuenta solo porque conserve el rol heredado `PSICOLOGO`.

### Contratos de equipo tratante

Se agregarán los siguientes contratos bajo el prefijo global `/api/v1`:

```text
GET    /tenants/:tenantId/patients/:patientId/team
GET    /tenants/:tenantId/patients/:patientId/team/eligible?specialtyId=:specialtyId
PUT    /tenants/:tenantId/patients/:patientId/team/:professionalId
DELETE /tenants/:tenantId/patients/:patientId/team/:professionalId
```

`GET /team` devuelve asignaciones activas e inactivas, ordenadas primero por estado, luego por especialidad y nombre. Cada elemento incluye únicamente metadatos operativos:

```ts
type PatientTeamMember = {
  id: string;
  patientId: string;
  professionalId: string;
  assignedAt: string;
  assignedBy: { id: string; firstName: string; lastName: string } | null;
  isActive: boolean;
  professional: {
    id: string;
    firstName: string;
    lastName: string;
    professionalTitle: string | null;
    licenseNumber: string | null;
    specialty: { id: string; code: string; name: string } | null;
  };
};
```

`GET /team/eligible` devuelve una proyección estrecha de cuentas y perfiles activos, incluyendo administradores clínicos. Acepta el filtro opcional `specialtyId`, indica si cada persona ya está asignada y no devuelve permisos, hashes ni campos clínicos. El endpoint está ligado al paciente para poder aplicar la regla de referencia del actor y reutilizarse después de seleccionar paciente en la agenda.

`PUT /team/:professionalId` no necesita cuerpo. Crea, reactiva o devuelve idempotentemente la asignación. La identidad autenticada se guarda como `assignedById` en altas y reactivaciones.

`DELETE /team/:professionalId` realiza una desactivación lógica. Antes consulta citas de ese paciente con ese profesional cuyo `startTime` sea futuro y cuyo estado sea distinto de `CANCELLED`. Si existen, responde `409 PROFESSIONAL_HAS_FUTURE_APPOINTMENTS` e incluye en `details.appointments` una lista operativa con identificador, fecha, estado, título y especialidad para que puedan cancelarse o reasignarse. No incluye notas ni contenido clínico.

Eliminar una asignación ya inactiva es idempotente cuando no existe una inconsistencia de citas futuras. Las operaciones que cambian estado se ejecutan en transacción serializable con reintentos acotados ante conflictos de serialización.

### Contratos de citas

Los endpoints existentes se conservan:

```text
POST  /tenants/:tenantId/appointments
GET   /tenants/:tenantId/appointments
GET   /tenants/:tenantId/appointments/:appointmentId
PATCH /tenants/:tenantId/appointments/:appointmentId
POST  /tenants/:tenantId/appointments/:appointmentId/cancel
```

El contrato canónico de creación será:

```ts
type CreateAppointmentInput = {
  patientId: string;
  professionalId: string;
  specialtyId: string;
  title?: string;
  description?: string;
  startTime: string;
  duration: number;
  location?: string;
  isOnline?: boolean;
  meetingUrl?: string;
};
```

`UpdateAppointmentInput` mantiene estos campos opcionales y el estado actual. Si cambia el profesional, la especialidad debe enviarse o resolverse explícitamente como parte de la misma actualización.

La creación y las actualizaciones que afectan asignación u horario se ejecutan en una transacción serializable:

1. cargar paciente y profesional dentro del tenant;
2. resolver perfil y especialidad habilitada;
3. comprobar la coincidencia profesional-especialidad;
4. calcular el intervalo y detectar conflictos sobre `professionalId`;
5. crear o reactivar idempotentemente `PatientProfessional` cuando sea necesario;
6. escribir cita y campos heredados/canónicos;
7. devolver la representación normalizada.

La actualización de una cita excluye su propio identificador al detectar conflictos. Los reintentos por serialización vuelven a ejecutar todas las validaciones, evitando carreras entre creación de citas, reasignación y retirada del equipo.

`GET /appointments` acepta los filtros canónicos `professionalId`, `specialtyId`, `patientId`, `status`, `from` y `to`. Durante la compatibilidad también acepta `psychologistId`. Si ambos identificadores se envían y difieren, la solicitud se rechaza como inválida.

Las respuestas incluyen:

- `professionalId` y `professional` como campos canónicos;
- `psychologistId` y `psychologist` como alias temporales del mismo usuario;
- `specialtyId` y la proyección de `specialty`;
- el resto de propiedades actuales.

### Normalización de entradas heredadas

Durante una versión de compatibilidad:

- `psychologistId` se acepta en creación, actualización y filtros;
- si llega solo `psychologistId`, se normaliza a `professionalId`;
- una creación o reasignación heredada sin `specialtyId` la deriva del `ProfessionalProfile` vigente y la persiste;
- una creación canónica con `professionalId` exige `specialtyId` explícito;
- si llegan identificadores canónico y heredado, deben ser iguales;
- todos los caminos terminan en el mismo servicio y las mismas validaciones;
- el conflicto horario devuelve `code: APPOINTMENT_CONFLICT` y conserva temporalmente `error: APPOINTMENT_CONFLICT` como alias para clientes existentes.

No existirán dos implementaciones independientes para citas heredadas y canónicas.

## Autorización

Los roles se expresarán de forma canónica; el mecanismo de compatibilidad existente seguirá reconociendo `CLIENTE` como administrador heredado y `PSICOLOGO` como profesional heredado.

| Operación | ADMIN | ASISTENTE | PROFESIONAL |
|---|---:|---:|---:|
| Ver equipo del paciente | Sí | Sí | Solo si integra activamente ese equipo |
| Ver profesionales elegibles | Sí | Sí | Solo para un paciente cuyo equipo integra activamente |
| Agregar o reactivar integrante | Sí | Sí | Sí, como referencia desde un equipo que ya integra |
| Retirar integrante | Sí | Sí | No |
| Ver agenda | Toda la del tenant | Toda la del tenant | Propia y de pacientes cuyo equipo integra |
| Crear cita | Para cualquier profesional elegible | Para cualquier profesional elegible | Solo para sí mismo y para un paciente cuyo equipo ya integra |
| Modificar o cancelar cita | Cualquiera del tenant | Cualquiera del tenant | Solo las propias |
| Reasignar cita a otra persona | Sí | Sí | No |

Un profesional que refiere o crea una cita propia debe tener cuenta activa, perfil activo y una asignación activa al paciente. No puede agregarse a sí mismo, referir ni crear una cita desde un paciente ajeno para obtener acceso. La autorización se evalúa después de comprobar que la identidad autenticada pertenece al tenant de la ruta. El alta automática por cita cubre las citas creadas o reasignadas por administración y asistencia; un profesional nuevo debe ser asignado o referido antes de agendar por cuenta propia.

Los administradores conservan sus capacidades administrativas aunque no tengan perfil profesional. Solo aparecen como opción de atención si sí tienen un perfil activo. Los asistentes administran metadatos demográficos, equipo y agenda, pero esta etapa no les concede acceso al cuerpo de notas clínicas.

Los controladores de pacientes afectados se alinearán con los roles canónicos para que `ASISTENTE` pueda operar ficha demográfica y equipo; el borrado lógico del paciente continúa reservado a administración.

## Errores funcionales

Las respuestas nuevas y modificadas usan el sobre `{ statusCode, code, message, details? }`.

| Código | HTTP | Uso |
|---|---:|---|
| `PROFESSIONAL_SPECIALTY_MISMATCH` | 422 | La especialidad enviada no coincide con el perfil vigente. |
| `PROFESSIONAL_HAS_FUTURE_APPOINTMENTS` | 409 | No se puede retirar al integrante hasta cancelar o reasignar sus citas futuras con el paciente. |
| `TEAM_ASSIGNMENT_FORBIDDEN` | 403 | El actor no puede agregar, reactivar o retirar esa asignación. |
| `SPECIALTY_NOT_ENABLED` | 409 | La especialidad no está habilitada para el tenant. |
| `PROFESSIONAL_NOT_AUTHORIZED` | 403 | La cuenta no tiene capacidad clínica activa o intenta operar una cita ajena. |
| `APPOINTMENT_CONFLICT` | 409 | El profesional ya tiene una cita no cancelada que se solapa. |
| `TENANT_SCOPE_VIOLATION` | 403 | Una referencia no pertenece al tenant autenticado. |

Recursos inexistentes dentro del alcance visible devuelven `404`; la API no revelará si un identificador pertenece a otro consultorio. Los detalles de error solo contendrán metadatos necesarios para resolver la operación.

## Experiencia web

### Ficha de paciente

Los formularios de alta y edición eliminan el selector único “Psicólogo asignado”. Conservan la estructura demográfica actual y no requieren elegir especialidad al crear el paciente.

El detalle incorpora una sección o pestaña independiente “Equipo tratante”. La implementación extraerá componentes y hooks enfocados para esta sección sin reescribir toda la página existente. La vista:

- agrupa integrantes por especialidad;
- agrupa perfiles históricos eliminados bajo “Sin especialidad vigente”;
- muestra nombre, título, estado y fecha de asignación;
- distingue integrantes activos de históricos/inactivos;
- permite filtrar candidatos por especialidad;
- incluye administradores clínicos porque consume perfiles, no roles;
- permite agregar o reactivar según los permisos del usuario;
- muestra retirada solo a administradores y asistentes;
- espera la confirmación del servidor antes de retirar y no usa actualización optimista;
- si la retirada se bloquea, lista las citas futuras devueltas para que el usuario las abra, cancele o reasigne.

La interfaz explicará que una cita con un profesional no asignado lo incorpora automáticamente al equipo.

### Agenda

El formulario de cita sigue la secuencia:

1. paciente;
2. especialidad habilitada;
3. profesional activo filtrado por esa especialidad;
4. fecha, hora y demás detalles.

Al cambiar paciente o especialidad se limpia una selección profesional que ya no sea válida. El envío usa `professionalId + specialtyId`. Los mensajes para conflicto, perfil/especialidad incompatible y especialidad deshabilitada se basan en `code`, no en el texto de `message`.

Las pantallas, filtros, etiquetas y valores predeterminados afectados usarán “profesional”, “especialidad”, “equipo tratante” y “consulta/cita”. El adaptador de respuestas seguirá aceptando `psychologist` mientras la API mantenga el alias.

### Estado y caché

Se crearán tipos y clientes canónicos para equipo tratante, candidatos y citas. Las claves de React Query incluirán siempre `tenantId` y, según corresponda, `patientId`, `specialtyId` y filtros de agenda. Después de agregar, retirar, crear, reasignar o cancelar se invalidarán tanto equipo como agenda del tenant/paciente afectado.

Los controles de agregar y retirar tendrán etiqueta accesible, foco visible y estado deshabilitado durante la mutación. Los errores permanecerán visibles y asociados a la acción que falló.

## Migración y despliegue

La entrega será aditiva y se aplicará en este orden:

1. Crear `PatientProfessional`, relaciones e índices.
2. Agregar `Appointment.professionalId` nullable y sus índices, sin retirar `psychologistId`.
3. Ejecutar guardas de migración que aborten ante pacientes, profesionales, citas o especialidades cruzadas entre tenants, perfiles profesionales faltantes o referencias huérfanas.
4. Insertar una fila de equipo por cada `Patient.assignedPsychologistId` no nulo. Las cuentas inactivas se conservan como asignaciones inactivas; `assignedById` queda nulo porque el dato histórico no existe.
5. Rellenar `Appointment.professionalId = psychologistId` después de validar pertenencia. Conservar un `specialtyId` histórico ya presente; cuando sea nulo, obtenerlo de `ProfessionalProfile.specialtyId`.
6. Desplegar la API compatible, que lee el campo canónico con fallback heredado y realiza escritura espejo.
7. Ejecutar un relleno incremental idempotente para cualquier escritura heredada ocurrida durante el despliegue y, a continuación, una reconciliación que compruebe conteos, campos canónicos completos, igualdad de identificadores espejados y ausencia de referencias entre tenants.
8. Desplegar la web canónica.
9. Observar errores de normalización, conflictos y filas sin reconciliar durante la ventana de compatibilidad.
10. En una migración posterior y separada, retirar aliases/escrituras heredadas y hacer obligatorias las columnas canónicas cuando no queden clientes antiguos.

La migración no inventará actores ni cambiará títulos históricos. Si una cita existente contiene una especialidad histórica, se conserva incluso si el perfil actual del profesional cambió; únicamente los datos faltantes se completan desde el perfil vigente.

La migración y el reconciliador deben ser seguros frente a reejecución de verificaciones. Cualquier inconsistencia detiene el despliegue con identificadores operativos suficientes para corregirla, sin omitir silenciosamente filas.

## Estrategia de pruebas

### API unitaria

- alta, reactivación e idempotencia de asignaciones;
- procedencia del asignador en alta y reactivación;
- permisos de administrador, asistente y referencia profesional;
- rechazo de profesional no asignado que intenta referir;
- rechazo de retirada por parte de profesional;
- bloqueo de retirada con citas futuras no canceladas y detalles seguros;
- retirada permitida después de cancelar o reasignar;
- elegibilidad basada en perfil, incluyendo administrador clínico y excluyendo perfiles/cuentas inactivos;
- bloqueo de desactivación de cuenta/perfil con citas futuras y desactivación transaccional de sus equipos cuando ya no existen;
- coincidencia de tenant y especialidad;
- creación y reasignación de cita con alta automática en el equipo;
- conflicto horario usando `professionalId`;
- actualización propia frente a cita de terceros;
- normalización de `psychologistId`, conflicto entre aliases y escritura espejo;
- preservación de especialidad histórica en actualizaciones que no cambian asignación.

### API de integración y E2E

- recorrido administrador: paciente, equipo multiespecialidad, citas y retirada;
- recorrido asistente equivalente sin acceso clínico;
- recorrido profesional: referencia permitida, retirada y reasignación denegadas, edición/cancelación solo propia;
- dos profesionales de especialidades distintas sobre una sola ficha de paciente;
- paciente/profesional/especialidad de otro tenant rechazados sin fuga de existencia;
- transacciones concurrentes de cita, conflicto y retirada sin duplicar asignaciones;
- contratos canónicos y heredados produciendo la misma representación;
- respuestas con `professional` y alias `psychologist` coherentes.

### Migración

- esquema desde base vacía;
- actualización desde un fixture con asignaciones y citas heredadas;
- conteo uno a uno de asignaciones heredadas migradas;
- citas con especialidad nula completadas desde el perfil;
- especialidad histórica existente preservada;
- abortar ante referencia cruzada, perfil faltante o referencia huérfana;
- reconciliación sin campos canónicos faltantes ni identificadores divergentes.

### Web

- formularios de paciente sin selector único heredado;
- agrupación del equipo por especialidad y estados activo/inactivo;
- permisos visibles por rol;
- filtro de candidatos y presencia de administradores clínicos;
- alta/reactivación y retirada confirmada por servidor;
- presentación accionable del bloqueo por citas futuras;
- cascada paciente → especialidad → profesional en el formulario de cita;
- payload canónico y normalización de respuesta heredada;
- invalidación de caché aislada por tenant y paciente;
- mensajes por código funcional y controles accesibles.

### Verificación completa

- pruebas unitarias, de integración y E2E de API;
- pruebas Vitest de web;
- lint, comprobación de tipos y build en ambos repositorios;
- generación y validación de Prisma;
- comprobación de migraciones en una base PostgreSQL nueva y una base de actualización.

## Criterios de aceptación

- Una ficha de paciente admite simultáneamente profesionales de distintas especialidades.
- Toda asignación nueva o reactivada registra al actor y no produce duplicados.
- Administradores y asistentes administran el equipo; un profesional asignado puede referir a otro, pero no retirar integrantes.
- Crear o reasignar una cita incorpora automáticamente al profesional nuevo sin retirar al anterior.
- No puede retirarse a un profesional con citas futuras no canceladas para ese paciente.
- Toda cita nueva persiste profesional y especialidad coincidentes y detecta conflictos sobre el profesional canónico.
- Un administrador con perfil clínico aparece como profesional elegible; uno sin perfil no aparece.
- La web ya no obliga a escoger un único psicólogo en la ficha demográfica.
- Agenda y equipo muestran terminología neutral y envían contratos canónicos.
- Los clientes heredados con `assignedPsychologistId` y `psychologistId` continúan funcionando durante la ventana definida.
- La migración conserva todas las asignaciones y citas válidas y aborta ante cruces de tenant o referencias imposibles de reconciliar.
- Las suites, lint, tipos, builds y verificaciones de migración pasan antes de abrir los pull requests.
