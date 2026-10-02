# Cobro y ciclo de vida de la suscripción

**Fecha:** 2026-10-01 · **Tareas:** T-05 y T-06

## Decisión

No hay proveedor de cobro integrado. El cobro es **manual con aprobación explícita**: el consultorio solicita, paga por fuera (transferencia, depósito) y soporte confirma el pago con su referencia. **Ningún plan de pago se habilita al solicitarlo**; solo al confirmarse su pago.

El diseño deja el punto de entrada listo para un proveedor: su webhook llamaría a `SubscriptionBillingService.confirmPayment` con `provider` propio y el identificador del evento como `reference`. La idempotencia ya está resuelta en ese método.

## Pagos (`SubscriptionPayment`)

| Tipo | Lo crea | Efecto al confirmarse |
| --- | --- | --- |
| `PLAN_UPGRADE` | El titular, con `POST /tenants/:tenantId/subscription/upgrade` | Activa el plan solicitado y deja la suscripción `ACTIVE` |
| `RENEWAL` | El proceso programado, 7 días antes del fin del período | Extiende el período un mes y deja la suscripción `ACTIVE` |

Estados: `PENDING` → `CONFIRMED` · `REJECTED` · `CANCELED` (reemplazada por una solicitud más reciente) · `EXPIRED` (mejora sin pagar tras 7 días).

Importe de una mejora: la diferencia prorrateada por los días que quedan si hay un período pagado en curso; un mes completo si viene de prueba o de un período vencido. En ese segundo caso el mes pagado empieza el día de la confirmación.

### Endpoints

| Ruta | Rol | Uso |
| --- | --- | --- |
| `POST /tenants/:tenantId/subscription/upgrade` | MASTER | Registra la solicitud; responde `status: PENDING_PAYMENT` y el pago |
| `GET /tenants/:tenantId/subscription/payments` | MASTER | Pagos del consultorio, incluidos los pendientes |
| `GET /subscription-payments?status=PENDING` | SOPORTE | Pagos de todos los consultorios |
| `POST /subscription-payments/:paymentId/confirm` | SOPORTE | `{ reference, note? }` — aplica el pago |
| `POST /subscription-payments/:paymentId/reject` | SOPORTE | `{ reason }` — cierra la solicitud sin cambios |

### Idempotencia

- Confirmar dos veces con la misma referencia devuelve `alreadyConfirmed: true` y no vuelve a tocar la suscripción.
- Una referencia confirma un solo pago: índice único `(provider, providerReference)`; el segundo intento responde `409 PAYMENT_REFERENCE_ALREADY_USED`.
- Un pago que no está `PENDING` responde `409 PAYMENT_NOT_PENDING`.
- Si el plan del consultorio cambió desde la solicitud y ya no es una mejora: `409 PAYMENT_NO_LONGER_APPLICABLE`.
- La confirmación corre en una transacción serializable.

## Proceso programado

`SubscriptionLifecycleService` se ejecuta cada hora (ya no depende de Redis) y hace, en este orden:

1. **Degradaciones programadas vencidas.** Aplica `scheduledPlanChange` cuando llega `scheduledPlanChangeAt`. Si el uso actual ya no cabe en el plan nuevo, cancela la degradación y registra el evento `LIMIT_REACHED` con el motivo.
2. **Solicitudes de mejora vencidas** → `EXPIRED`.
3. **Renovaciones.** Emite un pago `RENEWAL` por consultorio y período. Si hay una degradación programada para el inicio de ese período, cobra el precio del plan nuevo.
4. **Fin de prueba o de período sin pago** → `PAST_DUE` (solo lectura).
5. **7 días después** → `UNPAID` (acceso bloqueado).

Cada paso reclama su fila con una actualización condicional (o un índice único), de modo que repetir la ejecución, o correrla en dos instancias a la vez, no aplica nada dos veces.

Los planes con precio 0 fuera de la prueba (el plan personalizado) no vencen solos: los gestiona soporte.

Un consultorio `PAST_DUE` o `UNPAID` sigue pudiendo usar las rutas de suscripción para ver su estado y solicitar un plan (`@AllowInactiveSubscription`).

Los plazos están en `BILLING_RULES` (`src/subscription/subscription-billing.rules.ts`).

## Lo que no cubre

- **Módulos adicionales y especialidades extra** se siguen habilitando al seleccionarlos y suben el precio mensual; se cobran en la siguiente renovación, sin prorrateo ni pago previo.
- **Avisos al consultorio** (correo de renovación emitida, pago confirmado, vencimiento): dependen del servicio de correo (T-07).
- **Pantalla de soporte** para confirmar pagos: hoy se hace por API.
- **Instrucciones de pago** (cuenta bancaria, a quién enviar el comprobante): la web muestra un texto genérico.
- **Facturación anual:** no existe en la API; se retiró del panel.

## Precios (T-06)

La única fuente de precios y límites es `subscription-pricing.ts`, servida por `GET /tenants/:tenantId/subscription/plans`.

- El panel de la web lee ese endpoint; ya no tiene precios escritos.
- El sitio público es estático. `docs/plan-catalog.contract.json` es la forma publicada del catálogo: `test/plan-catalog-contract.spec.ts` falla si el código deja de coincidir con ella, y la web compara su copia con el sitio público y con el panel.

Para cambiar un precio o límite:

```bash
npm run contract:plan-catalog
```

y copiar `docs/plan-catalog.contract.json` a `web/src/features/subscription/plan-catalog.contract.json`. Las pruebas de la web indican qué valores del sitio público hay que actualizar.
