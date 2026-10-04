# Notificaciones: avisos de tareas, preferencias y Web Push

**Fecha:** 2026-10-01 · **Tareas:** T-08 y T-09

## Canales

| Canal | Destino | Requiere |
| --- | --- | --- |
| En la aplicación | Lista de notificaciones (web y móvil) | Nada; siempre se crea |
| FCM | App móvil | `FCM_*` y el token registrado con `POST /notifications/fcm-token` |
| Web Push | Navegadores suscritos | `VAPID_*` y el módulo `webPush` del plan |

`NotificationsService.notify` crea **una** notificación en la aplicación y, si el usuario no desactivó el push, la entrega por FCM y por Web Push. Un fallo de entrega no borra ni falla la notificación.

## Preferencias (por usuario, en el servidor)

`GET` y `PUT /tenants/:tenantId/notifications/preferences`

| Campo | Por defecto | Efecto |
| --- | --- | --- |
| `pushEnabled` | `true` | En `false`, las notificaciones quedan solo en la aplicación |
| `appointmentReminders` | `true` | En `false`, no se crea el recordatorio de cita |
| `taskDueReminders` | `true` | En `false`, no se crea el aviso de tarea |
| `morningDigest` | `false` | En `true`, recibe el resumen diario |

Además, `reminderEnabled` de la configuración del consultorio apaga los recordatorios para todos.

## Avisos de tareas

`TaskRemindersService` corre cada 15 minutos por cron (no necesita Redis):

- **Tarea próxima a vencer:** tareas abiertas (`PENDING`, `IN_PROGRESS`) que vencen en las próximas 24 horas, de consultorios activos con suscripción `ACTIVE` o `TRIALING`.
- **Destinatario:** la persona asignada; si no hay, quien creó la tarea. Debe estar activa.
- **Una sola vez:** cada aviso lleva `dedupeKey = task-due:<tarea>:<usuario>:<vencimiento>` y hay un índice único `(tenantId, dedupeKey)`. Repetir la ejecución, o correrla en varias instancias, no duplica. Si se cambia la fecha de vencimiento, se avisa de nuevo.
- **Resumen de la mañana:** a las 7:00 en la zona horaria del consultorio, con el número de citas y de tareas por vencer del día. No se envía si no hay nada. Clave: `digest:<usuario>:<fecha local>`.

Los valores (24 horas, 7:00) están en `TASK_REMINDER_RULES`.

Los recordatorios de **citas** siguen en la cola de Bull y solo corren con Redis.

## Web Push

Implementado sin dependencias nuevas en `src/notifications/web-push/`: cifrado `aes128gcm` (RFC 8291) y cabecera VAPID (RFC 8292). La prueba reproduce el mensaje de ejemplo del RFC 8291.

| Ruta | Uso |
| --- | --- |
| `GET  /notifications/web-push/public-key` | `{ enabled, publicKey }`; la web se suscribe con esa clave |
| `POST /notifications/web-push/subscriptions` | Cuerpo: `PushSubscription.toJSON()` (endpoint **y** claves). Requiere el módulo `webPush` |
| `DELETE /notifications/web-push/subscriptions` | `{ endpoint }` — deja de enviar a ese navegador |

- Un usuario puede tener varios navegadores (`PushSubscription`, uno por endpoint).
- Solo se aceptan endpoints de los servicios de push de los navegadores (Google, Mozilla, Microsoft, Apple): la API hace peticiones a esa URL y no debe poder apuntarse a cualquier destino.
- Si el servicio responde 404 o 410, la suscripción se borra.
- El navegador ya no usa `fcm-token`: antes guardaba su endpoint en el campo del token del móvil y lo pisaba.

### Configuración

```bash
npm run webpush:generate-keys
```

```
VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:soporte@tudominio.com
```

Sin estas variables Web Push queda apagado y `public-key` responde `enabled: false`. Cambiar el par de claves invalida las suscripciones existentes: los navegadores deben volver a suscribirse.

## Pendiente de verificar

- [ ] Recibir una notificación real en Chrome, Firefox y Safari, y comprobar que tras darse de baja ya no llega.
- [ ] Ejecutar `test/task-reminders.e2e-spec.ts` contra la base de pruebas.
- [ ] Probar en el móvil que las preferencias se guardan y se respetan.
