# Facturación a pacientes — diseño

Fecha: 2026-10-01 · Repositorios: api y web · Ramas: `feat/patient-invoicing` (desde `dev`) en cada uno

## Objetivo

Hoy el módulo de facturación emite el comprobante a nombre del propio
consultorio: la API copia el nombre, el correo y la identificación fiscal del
consultorio como datos del cliente, y no hay forma de indicar otro receptor. La
ficha del paciente no tiene datos fiscales y la factura no guarda a qué paciente
corresponde.

El módulo debe servir para cobrar a pacientes: al emitir se elige un paciente y
el comprobante sale a nombre de quien paga, que puede ser el paciente o un
tercero (padre o madre de un menor, una empresa, una aseguradora).

Éxito: un administrador o profesional elige un paciente, ve los datos del
receptor ya cargados, emite, y el comprobante sale con esos datos; la factura
queda ligada al paciente y visible en su ficha. El emisor (datos del consultorio
y configuración de Faktur) no cambia.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Receptor | El paciente o un tercero. Los datos de facturación viven en la ficha del paciente y pueden ajustarse para una factura concreta |
| Vínculo | La factura se liga al paciente. No se liga a una cita |
| Flujo actual | Se reemplaza: toda factura nueva requiere paciente. Las ya emitidas a nombre del consultorio se conservan sin cambios |
| Almacenamiento del receptor | Campos en `Patient`, no una tabla aparte de pagadores |
| Quién factura | Sin cambio: administradores y profesionales, a cualquier paciente del consultorio |

## Modelo de datos

Una migración aditiva, `add_patient_invoicing`. No modifica ni elimina datos.

`Patient`, cinco columnas nuevas, todas opcionales:

| Columna | Contenido |
|---|---|
| `billingName` | Nombre o razón social del receptor |
| `billingTaxIdType` | `CEDULA`, `RUC` o `PASSPORT` (mismos valores que usa el consultorio) |
| `billingTaxId` | Número de identificación |
| `billingEmail` | Correo al que llega el comprobante |
| `billingAddress` | Dirección del receptor |

`Invoice`:

- `patientId` opcional, relación con `Patient`, `onDelete: SetNull`. Las facturas
  existentes quedan con `patientId` nulo.
- `customerAddress` opcional: copia de la dirección del receptor.
- Índice `(tenantId, patientId, createdAt)`.

La factura conserva su copia de los datos del receptor (`customerName`,
`customerEmail`, `customerTaxIdType`, `customerTaxId`, `customerAddress`) tomada
al emitir. Editar la ficha del paciente después no altera facturas ya creadas.

`subscriptionId` deja de asignarse en las facturas nuevas: una factura a un
paciente no es una factura de la suscripción del consultorio. La columna se
mantiene para las existentes.

## API

### Emitir — `POST /tenants/:tenantId/billing/invoices`

Cuerpo:

| Campo | Regla |
|---|---|
| `patientId` | Obligatorio |
| `subtotal`, `tax`, `description`, `idempotencyKey` | Sin cambio |
| `customer` | Opcional. Objeto con `name`, `taxIdType`, `taxId`, `email`, `address`; cada campo opcional |
| `saveCustomerToPatient` | Opcional, booleano, por defecto `false` |

Resolución del receptor, campo por campo, en este orden:

1. El valor de `customer` de la petición, si viene.
2. El dato de facturación guardado en el paciente.
3. Solo para nombre y correo: el nombre completo y el correo del paciente.

No hay valor por defecto para la identificación: debe venir de la petición o de
la ficha. La dirección es opcional.

Validaciones, todas antes de crear la factura y antes de llamar a Faktur:

- El paciente existe, pertenece al consultorio y no está archivado
  (`deletedAt` nulo). Si no: 404 `Paciente no encontrado`.
- Nombre de al menos 2 caracteres, correo con formato válido, tipo de
  identificación entre los tres admitidos y número con el formato de su tipo:
  cédula 10 dígitos, RUC 13 dígitos, pasaporte de 5 a 20 caracteres
  alfanuméricos. No se valida el dígito verificador.
- Si falta o es inválido algún dato del receptor: 422 con código
  `INVOICE_CUSTOMER_INCOMPLETE` y la lista de campos en `details.fields`.

Con `saveCustomerToPatient` verdadero, los datos resueltos del receptor se
guardan en la ficha del paciente en la misma transacción que crea la factura.
Si la emisión en Faktur falla después, los datos guardados se conservan: son
válidos aunque el comprobante no haya salido.

Idempotencia: una petición repetida con la misma clave devuelve la factura
existente sin revalidar ni volver a guardar datos en la ficha.

Sin cambio: comprobaciones del emisor y de la configuración del consultorio,
límite mensual, reserva y devolución del secuencial, manejo de errores de Faktur.
La dirección enviada a Faktur pasa a ser la del receptor, no la del consultorio.

### Consultar

- `GET /tenants/:tenantId/billing/invoices` incluye `patient`
  (`id`, `firstName`, `lastName`) y acepta el filtro opcional `patientId`.
- `GET /tenants/:tenantId/billing/invoices/:invoiceId` incluye `patient`.
- Para una factura sin paciente, `patient` es `null`.

### Pacientes

Crear y editar paciente aceptan los cinco campos de facturación con las mismas
reglas de formato; enviar cadena vacía o `null` borra el dato. Si se envía tipo
sin número o número sin tipo: 400. Las respuestas de paciente incluyen los cinco
campos. No hay permisos nuevos: los ven y editan los roles que ya ven y editan
la ficha.

## Web

### Facturación (`/admin/billing`)

- Selector de paciente obligatorio como primer campo.
- Al elegir paciente aparece el bloque **Facturar a**, con nombre, tipo y número
  de identificación, correo y dirección, rellenado desde la ficha (con el nombre
  y correo del paciente como valor inicial si no hay datos de facturación).
- Los campos son editables para esa factura. Casilla **Guardar en la ficha del
  paciente**, marcada por defecto cuando el paciente aún no tiene identificación
  guardada y desmarcada en caso contrario.
- El botón de emitir se habilita solo con paciente, descripción, montos válidos
  y receptor completo. Los errores de formato se muestran junto a cada campo.
- Si la API responde `INVOICE_CUSTOMER_INCOMPLETE`, se indica qué datos faltan.
- Historial: columnas **Paciente** y **Facturado a**. Las facturas antiguas sin
  paciente muestran "—" en Paciente.
- Se retira la nota de que el comprobante se emite a nombre del consultorio.
- Cambiar de paciente recarga el bloque **Facturar a** y descarta lo editado.

### Ficha del paciente

- Crear y editar: sección **Datos de facturación** con los cinco campos y el
  botón **Usar los datos del paciente**, que copia nombre, correo y dirección.
- Detalle: sección **Facturas** con las facturas del paciente (fecha,
  descripción, total, estado, enlaces a PDF y XML). Visible para los roles que
  hoy ven Facturación en el menú: administradores y profesionales.

## Manejo de errores

- Paciente de otro consultorio o archivado: 404, sin revelar si existe.
- Datos del receptor incompletos: 422 con los campos, sin crear factura ni
  consumir secuencial.
- Fallo de Faktur: igual que hoy; la factura queda `FAILED` con el motivo y
  ligada al paciente.
- Paciente archivado después de facturar: sus facturas siguen en el historial
  con el nombre del paciente.

## Pruebas

API, unitarias del servicio:

- Paciente inexistente, de otro consultorio y archivado.
- Resolución del receptor: desde la ficha, desde la petición, mezcla de ambos, y
  nombre y correo por defecto del paciente.
- Receptor incompleto por cada campo, y formatos inválidos por tipo de
  identificación; ninguna llega a Faktur ni reserva secuencial.
- Tercero como receptor: la factura lleva los datos del tercero y el `patientId`
  del paciente.
- `saveCustomerToPatient`: guarda cuando es verdadero, no toca la ficha cuando es
  falso, y conserva lo guardado si Faktur falla.
- La copia en la factura no cambia al editar la ficha.
- Idempotencia con paciente.
- Listado con `patient` y filtro por `patientId`; factura antigua con `patient`
  nulo.
- DTO de paciente: formatos, borrado con vacío, tipo sin número.

API, E2E con Faktur simulado: emitir a un paciente con datos guardados, emitir a
un tercero guardando en la ficha, rechazo por datos incompletos, y aislamiento
entre consultorios.

Web: formulario (selección de paciente, relleno, edición, casilla, validación,
error de la API), historial con y sin paciente, sección de la ficha y lista de
facturas del paciente.

Verificación final en cada repositorio: lint, tipos, pruebas completas y build;
en la API, además, el CI con la base desechable.

## Fuera de alcance

- Ligar la factura a una cita.
- Emitir a "consumidor final" sin identificación.
- Varios conceptos por factura.
- Notas de crédito y anulación.
- Reutilizar un mismo pagador entre varios pacientes.
- Validar el dígito verificador de cédula y RUC.
- Restringir a un profesional a facturar solo a los pacientes que atiende.

## Entrega

Dos PR hacia `dev`: primero la API, después la web. La web nueva depende de la
API nueva. La migración debe aplicarse con `prisma migrate deploy` en cada base
desplegada antes de publicar la API.
