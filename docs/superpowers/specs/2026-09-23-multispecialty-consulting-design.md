# Diseño de consultorios multiespecialidad

**Estado:** Aprobado para planificación

**Fecha:** 2026-09-23

**Repositorios afectados:** `api` y `web`

## Contexto

La plataforma nació como un SaaS para psicología. El catálogo actual incluye Psicología, Nutrición, Fisioterapia y Odontología, pero usuarios, cupos, pacientes, citas y gran parte de la interfaz todavía usan conceptos exclusivos de psicología. Los módulos no psicológicos se reducen a formularios genéricos con campos de texto duplicados entre API y web.

El producto se orientará a consultorios que pueden habilitar varias especialidades. Cada profesional pertenece a una sola especialidad, mientras que un paciente puede ser atendido por profesionales de distintas especialidades dentro del mismo consultorio. Los profesionales del consultorio compartirán el historial clínico del paciente bajo reglas explícitas de autorización y auditoría.

## Objetivos

- Convertir el dominio de psicología en un dominio clínico multiespecialidad sin perder datos existentes.
- Mantener una única ficha demográfica por paciente dentro de cada consultorio.
- Permitir varios profesionales y especialidades por consultorio, con una especialidad por profesional.
- Permitir que un paciente tenga varios profesionales tratantes, incluso de distintas especialidades.
- Compartir el historial clínico entre los profesionales autorizados del mismo consultorio.
- Separar los permisos administrativos de la capacidad para prestar atención clínica.
- Definir los módulos clínicos una sola vez en la API y validarlos en el servidor.
- Completar los módulos de Psicología, Nutrición, Fisioterapia y Odontología.
- Conservar compatibilidad temporal con los contratos centrados en psicología para desplegar API y web de forma segura.

## Fuera de alcance

- Implementar especialidades adicionales en esta primera entrega.
- Compartir información entre consultorios diferentes.
- Crear el portal clínico del paciente.
- Permitir que los consultorios diseñen definiciones clínicas arbitrarias.
- Modificar la aplicación móvil, salvo mantener compatibilidad temporal con los contratos de API que consume.
- Integrar prescripción electrónica, laboratorios o aseguradoras.

## Terminología

- **Consultorio:** tenant que agrupa configuración, usuarios, especialidades y pacientes.
- **Especialidad de catálogo:** especialidad disponible en la plataforma.
- **Especialidad habilitada:** especialidad que un consultorio seleccionó para operar.
- **Perfil profesional:** capacidad clínica asociada a una cuenta de usuario.
- **Equipo tratante:** profesionales asignados a un paciente.
- **Registro especializado:** dato clínico estructurado generado por un módulo de especialidad.
- **Línea clínica:** vista cronológica consolidada de notas, citas y registros especializados.

## Modelo de dominio

```text
Consultorio
├── especialidades habilitadas
├── usuarios
│   ├── permisos de acceso
│   └── perfil profesional opcional
│       └── una especialidad habilitada
└── pacientes
    ├── equipo tratante con varios profesionales
    ├── citas de diferentes especialidades
    └── historial clínico compartido
```

### Usuario y perfil profesional

`User` seguirá representando identidad, autenticación y permisos. La capacidad clínica se moverá a un `ProfessionalProfile` opcional con relación uno a uno mediante `userId` como clave primaria y foránea. El perfil contendrá:

- `userId`
- `specialtyId`
- `professionalTitle`
- `licenseNumber`
- `bio`
- `isActive`
- marcas de creación y actualización

Una cuenta con rol administrativo puede tener o no un perfil profesional. Si lo tiene, puede atender pacientes bajo una única especialidad. Un administrador sin perfil profesional puede administrar el sistema, pero no consultar contenido clínico.

Los roles canónicos serán:

- `ADMIN`
- `PROFESIONAL`
- `ASISTENTE`
- `SOPORTE`
- `PACIENTE`

Durante la transición, `CLIENTE` será un alias heredado de `ADMIN` y `PSICOLOGO` será un alias heredado de `PROFESIONAL`. La base de datos se migrará a los valores canónicos después de que la web acepte ambos conjuntos.

Los cupos del plan contarán perfiles profesionales activos, no usuarios con un rol específico. Un administrador con perfil profesional activo consume un cupo; un administrador exclusivamente operativo no lo consume.

### Especialidad del profesional

Cada `ProfessionalProfile` tendrá exactamente una especialidad. La API rechazará un perfil sin especialidad o con una especialidad que no esté habilitada en el consultorio.

El administrador podrá cambiar la especialidad vigente del profesional únicamente cuando no existan citas futuras asociadas a la especialidad anterior. Los registros y citas históricas conservarán su `specialtyId` original.

La relación muchos-a-muchos `ProfessionalSpecialty` será reemplazada gradualmente por `ProfessionalProfile.specialtyId`. Durante la migración se conservará la especialidad primaria; los datos inconsistentes con más de una especialidad se detendrán y reportarán antes de aplicar la restricción final.

### Paciente y equipo tratante

La estructura demográfica actual de `Patient` se conservará. No se crearán copias del paciente por especialidad.

La asignación única `assignedPsychologistId` se sustituirá por `PatientProfessional`, con:

- `tenantId`
- `patientId`
- `professionalId`
- `assignedAt`
- `assignedById`
- `isActive`

La clave única será `patientId + professionalId`. El `tenantId` permitirá aplicar y comprobar aislamiento de forma directa. La especialidad se obtendrá del perfil profesional y no se duplicará en esta relación.

### Citas

`Appointment.psychologistId` evolucionará a `professionalId`. Cada cita almacenará también `specialtyId` como dato histórico. Al crear o reasignar una cita, la API comprobará que:

- paciente y profesional pertenecen al mismo consultorio;
- el perfil profesional está activo;
- la especialidad está habilitada;
- `specialtyId` coincide con la especialidad vigente del profesional;
- no existe conflicto de horario para el profesional.

La web seleccionará primero la especialidad y filtrará después los profesionales disponibles.

### Registros clínicos

Se conservarán los dos conceptos actuales:

- `ClinicalNote` para notas clínicas narrativas.
- `SpecialtyRecord` para información estructurada de un módulo.

Ambos incluirán `professionalId`, `specialtyId`, `version`, `deletedAt` y marcas de auditoría. `SpecialtyRecord` conservará además `moduleKey`, `schemaVersion` y `data`.

La línea clínica combinará citas, notas clínicas y registros especializados en orden cronológico. Permitirá filtrar por especialidad, profesional, tipo de registro y rango de fechas.

No habrá eliminación física de información clínica desde la aplicación. Una corrección conservará la versión anterior en la auditoría, incrementará `version` y exigirá un motivo. Una eliminación funcional marcará `deletedAt`, autor y motivo.

## Autorización y privacidad

| Perfil | Capacidades clínicas |
|---|---|
| Administrador sin perfil profesional | Administra consultorio, equipo, agenda, facturación y especialidades; no lee contenido clínico. |
| Administrador con perfil profesional | Conserva capacidades administrativas y actúa clínicamente bajo su especialidad. |
| Profesional | Lee el historial compartido; crea registros bajo su especialidad; modifica únicamente registros propios. |
| Asistente | Gestiona datos demográficos, equipo tratante y citas; no lee contenido clínico. |
| Soporte | Opera funciones técnicas autorizadas; no accede de forma ordinaria al contenido clínico. |
| Paciente | No recibe acceso clínico en esta entrega. |

Reglas obligatorias:

- Toda consulta se limita al `tenantId` autenticado.
- Solo una cuenta con perfil profesional activo puede leer contenido clínico.
- Un profesional puede leer registros de otras especialidades del mismo consultorio.
- Un profesional solo crea registros con su propio `professionalId` y `specialtyId`.
- Solo el autor modifica o elimina funcionalmente un registro; ningún usuario sobrescribe registros de terceros.
- El acceso de soporte a metadatos operativos no incluye el cuerpo de notas ni el JSON clínico.
- Lecturas, creaciones, correcciones y eliminaciones funcionales quedan en un log de auditoría inmutable.

El log almacenará actor, tenant, paciente, entidad, acción, fecha, dirección IP, agente de usuario y, para cambios, instantáneas completas anterior y posterior. Las respuestas de auditoría ocultarán datos clínicos a perfiles sin autorización clínica.

## Catálogo y habilitación de especialidades

La API diferenciará el catálogo global de la selección de cada consultorio:

- `GET /api/v1/specialties`: catálogo activo completo.
- `GET /api/v1/tenants/:tenantId/specialties`: especialidades habilitadas por el consultorio.
- `PUT /api/v1/tenants/:tenantId/specialties`: reemplazo explícito de la selección.
- `GET /api/v1/tenants/:tenantId/modules`: módulos habilitados derivados de la selección.

El endpoint `POST` existente se mantendrá como adaptador temporal hacia la operación `PUT`.

La selección conservará las reglas comerciales actuales de la suscripción. La API sincronizará `TenantSpecialty` y `SubscriptionSpecialty`, calculará cuántas especialidades están incluidas y cuántas son cobrables y recalculará el precio resultante desde valores canónicos para que repetir la misma solicitud sea idempotente. La respuesta incluirá especialidades seleccionadas, módulos resultantes y un resumen con cupo incluido, cantidad cobrable, precio unitario y nuevo precio base.

Los módulos de una especialidad seleccionada se crearán habilitados. El administrador podrá deshabilitar módulos individuales, pero no podrá habilitar un módulo cuya especialidad no esté activa. Volver a habilitar una especialidad restaurará sus módulos sin alterar registros históricos.

Durante el onboarding se seleccionará al menos una especialidad. El alta recibirá `specialtyCodes`, `adminProvidesCare` y, cuando corresponda, `adminSpecialtyCode`. La creación transaccional incluirá tenant, configuración, suscripción, usuario administrador, especialidades habilitadas y perfil profesional del administrador.

No se podrá deshabilitar una especialidad si tiene profesionales activos o citas futuras. Los registros históricos conservarán la relación con la especialidad aunque posteriormente se deshabilite.

## Definiciones de módulos clínicos

La API será la fuente canónica de las definiciones. Un `ClinicalModuleDefinition` versionado contendrá:

- `moduleKey`
- `specialtyCode`
- `name`
- `description`
- `schemaVersion`
- `renderer`: `FORM` u `ODONTOGRAM`
- secciones y campos ordenados
- tipo de campo: texto, texto largo, número, fecha, selección, selección múltiple o lista estructurada
- unidad, obligatoriedad, límites y opciones

La API expondrá las definiciones habilitadas y validará cada carga antes de persistirla. La web renderizará formularios simples desde la definición y utilizará un componente específico para el odontograma. Las definiciones estarán versionadas en código y no serán editables por el tenant en esta entrega.

El registro persistirá `schemaVersion`; por ello, la web podrá representar datos históricos aun cuando una definición evolucione.

## Alcance clínico de la primera entrega

### Psicología

- Notas de sesión narrativas con motivo, observaciones, intervención, evolución y recomendaciones.
- Evaluaciones psicológicas con instrumento, fecha de aplicación, puntaje, escala e interpretación.
- Planificación terapéutica con objetivos, intervenciones, progreso y próximos pasos.

Las notas y planes actuales se migrarán o adaptarán sin duplicar información.

### Nutrición

- Evaluación antropométrica con peso, altura, IMC calculado por el servidor, perímetro de cintura y porcentaje de grasa opcional.
- Historia alimentaria con alergias, intolerancias, restricciones, hábitos y objetivos.
- Plan nutricional con calorías diarias y una lista estructurada de comidas, horarios, alimentos e indicaciones.
- Evolución antropométrica representable cronológicamente.

Las reglas numéricas mínimas serán: peso entre 1 y 500 kg, altura entre 30 y 250 cm, perímetro positivo y porcentajes entre 0 y 100.

### Fisioterapia

- Valoración funcional con diagnóstico funcional, dolor de 0 a 10, movilidad, rangos articulares y fuerza de 0 a 5.
- Evolución de sesión con estado subjetivo, hallazgos objetivos, intervención, respuesta y dolor antes/después.
- Plan de ejercicios estructurado con nombre, instrucciones, series, repeticiones o duración y frecuencia.

### Odontología

- Odontograma con dentición temporal o permanente, identificación FDI de pieza y estado por superficie.
- Estados iniciales: sano, caries, restauración, ausente, corona, endodoncia indicada, extracción indicada e implante.
- Plan de tratamiento con pieza opcional, procedimiento, prioridad, estado y observaciones.
- Evolución odontológica asociable a una cita y a un elemento del plan.

## Flujos de usuario

### Onboarding

1. La web obtiene el catálogo global.
2. El consultorio selecciona una o más especialidades.
3. El administrador indica si atenderá pacientes.
4. Si atenderá, selecciona exactamente una especialidad de las habilitadas e ingresa sus datos profesionales.
5. La API crea todos los recursos en una transacción.
6. La sesión se inicia y muestra el consultorio con sus módulos disponibles.

### Gestión del equipo

1. El administrador crea un usuario profesional.
2. Selecciona una especialidad habilitada e ingresa título y licencia.
3. La API valida el cupo del plan y crea usuario y perfil profesional juntos.
4. El administrador puede activar o desactivar el perfil sin borrar su historial.

### Paciente y equipo tratante

1. Se crea o edita la ficha demográfica existente.
2. El administrador, asistente o profesional autorizado agrega miembros al equipo tratante.
3. La web agrupa el equipo por especialidad.
4. Retirar un profesional desactiva la asignación, pero conserva citas y registros históricos.

### Agenda

1. Se selecciona paciente y especialidad.
2. La web muestra profesionales activos de esa especialidad.
3. La API valida pertenencia, disponibilidad y consistencia de especialidad.
4. La cita conserva profesional y especialidad como datos históricos.

### Atención clínica

1. El profesional abre la línea clínica compartida del paciente.
2. Puede leer registros de todas las especialidades del consultorio.
3. Para crear un registro, la web solo ofrece módulos de su propia especialidad.
4. La API obtiene la definición, valida tipos y límites y guarda la versión utilizada.
5. La auditoría registra la operación.

## Componentes afectados

### API

- Prisma: roles, `ProfessionalProfile`, `PatientProfessional`, referencias profesionales, versionado y borrado lógico.
- Tenants/onboarding: creación transaccional con especialidades y perfil opcional.
- Users: creación y actualización de profesionales con una especialidad.
- Subscription: conteo de perfiles profesionales activos.
- Specialties: catálogo global y habilitación segura por tenant.
- Appointments: profesional genérico y especialidad histórica.
- Clinical notes y specialty records: permisos, versiones y auditoría.
- Nuevo registro de definiciones y validador de módulos clínicos.
- Timeline clínica consolidada.

### Web

- Tipos y normalizadores compatibles con roles y campos heredados.
- Onboarding con selección de especialidades y perfil clínico del administrador.
- Equipo con especialidad obligatoria y estado del perfil profesional.
- Paciente con equipo tratante múltiple.
- Agenda filtrada por especialidad y profesional.
- Línea clínica compartida con filtros.
- Renderizador de formularios definidos por API.
- Odontograma especializado.
- Terminología neutral: profesional, consultorio, equipo tratante y cupos profesionales.

La página actual de detalle del paciente se dividirá en componentes enfocados para ficha general, equipo tratante, línea clínica, citas y módulos especializados.

## Descomposición de la implementación

Este diseño es el marco de una evolución coordinada, no un cambio monolítico. Se ejecutará mediante planes secuenciales que dejen software desplegable y verificable al terminar cada etapa:

1. Restaurar las garantías de calidad existentes: lint, pruebas E2E de API y base de pruebas web.
2. Introducir roles canónicos, `ProfessionalProfile`, migración de profesionales y conteo de cupos.
3. Separar catálogo global, especialidades del tenant, onboarding y administración del equipo.
4. Migrar equipo tratante, citas y terminología de psicólogo a profesional.
5. Implementar autorización clínica compartida, versionado, auditoría y línea clínica.
6. Crear el registro de definiciones, validador API y renderizador web de módulos.
7. Completar Psicología sobre el nuevo núcleo.
8. Completar Nutrición como entrega vertical.
9. Completar Fisioterapia como entrega vertical.
10. Completar Odontología y su odontograma como entrega vertical.

Cada etapa conservará compatibilidad con la anterior hasta que sus migraciones y pruebas hayan sido verificadas. Las especialidades nuevas tendrán posteriormente su propio diseño y plan vertical.

## Contratos de error

La API utilizará un sobre consistente con `statusCode`, `code`, `message` y `details` opcional. Los códigos funcionales serán:

- `SPECIALTY_NOT_ENABLED` — 409
- `SPECIALTY_IN_USE` — 409
- `PROFESSIONAL_SPECIALTY_REQUIRED` — 422
- `PROFESSIONAL_NOT_AUTHORIZED` — 403
- `PROFESSIONAL_SEAT_LIMIT_REACHED` — 409
- `APPOINTMENT_CONFLICT` — 409
- `CLINICAL_RECORD_INVALID` — 422
- `CLINICAL_RECORD_FORBIDDEN` — 403
- `TENANT_SCOPE_VIOLATION` — 403
- `CLINICAL_RECORD_NOT_FOUND` — 404

La web traducirá estos códigos a mensajes contextualizados y no dependerá de comparar textos enviados por la API.

## Migración y despliegue

La transición se dividirá en pasos compatibles:

1. Actualizar la web para aceptar roles y campos tanto heredados como canónicos.
2. Agregar modelos y columnas nuevas como opcionales, sin retirar las anteriores.
3. Crear Psicología en tenants que tengan usuarios o datos psicológicos y todavía no tengan especialidad habilitada.
4. Crear un perfil profesional de Psicología para cada usuario `PSICOLOGO` existente.
5. Copiar título, licencia, biografía y demás datos profesionales actuales desde `User` al perfil correspondiente.
6. Crear perfil profesional para administradores existentes que ya figuren como autores clínicos.
7. Migrar asignaciones de pacientes a `PatientProfessional`.
8. Copiar referencias de citas y registros a `professionalId` y `specialtyId`.
9. Sincronizar `SubscriptionSpecialty` con las especialidades habilitadas y verificar el precio calculado.
10. Desplegar la API con lectura de campos nuevos y adaptación de campos heredados.
11. Desplegar la web usando los contratos canónicos.
12. Validar conteos, referencias huérfanas, aislamiento por tenant y acceso clínico.
13. Hacer obligatorias las restricciones nuevas y retirar escrituras sobre campos heredados.

Los campos y valores heredados permanecerán legibles durante una versión de compatibilidad. Su eliminación física será una migración posterior y separada.

## Estrategia de pruebas

### API

- Pruebas unitarias para reglas de especialidad, cupos, permisos y validación de módulos.
- Pruebas de integración con base de datos para relaciones y migración.
- Pruebas E2E de onboarding, equipo, agenda y línea clínica.
- Pruebas negativas de acceso entre tenants.
- Pruebas de lectura compartida entre especialidades y edición exclusiva del autor.
- Pruebas de administrador con y sin perfil profesional.
- Pruebas de bloqueo al deshabilitar especialidades en uso.
- Pruebas de idempotencia y cálculo de especialidades incluidas y cobrables.
- Pruebas de compatibilidad de contratos heredados.

### Web

- Configurar pruebas de componentes y hooks con Vitest y Testing Library.
- Cubrir selección de especialidades, creación de profesionales, equipo tratante y formularios dinámicos.
- Cubrir estados de permisos y códigos funcionales de error.
- Añadir flujos E2E con Playwright para onboarding, cita multiespecialidad y registro clínico compartido.

### Verificación de migración

- Comparar conteos de usuarios clínicos antes y después.
- Confirmar que todas las citas y registros existentes conservan autor y tenant.
- Confirmar que cada perfil profesional tiene exactamente una especialidad.
- Confirmar que no existen asignaciones cruzadas entre tenants.
- Confirmar que notas y registros eliminados funcionalmente siguen auditables.

## Criterios de aceptación

- Un consultorio nuevo debe seleccionar al menos una especialidad durante el onboarding.
- Un administrador puede operar sin perfil profesional o atender con una única especialidad.
- Todo profesional activo tiene exactamente una especialidad habilitada por su consultorio.
- Los cupos contabilizan perfiles profesionales activos, incluidos administradores clínicos.
- Un paciente mantiene una sola ficha y puede tener profesionales de varias especialidades.
- Una cita solo puede asignarse a un profesional activo de la especialidad seleccionada.
- Un profesional puede leer el historial clínico completo del paciente dentro del consultorio.
- Un profesional solo puede crear registros bajo su propia especialidad y modificar los de su autoría.
- Todos los accesos clínicos relevantes quedan auditados.
- Psicología, Nutrición, Fisioterapia y Odontología disponen de los módulos definidos en este documento con validación de servidor.
- Los datos actuales se conservan y los contratos heredados funcionan durante la ventana de compatibilidad.
- Las pruebas unitarias, de integración, E2E, lint, tipos y build pasan en ambos repositorios antes de retirar compatibilidad.
