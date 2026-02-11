# API Endpoints Reference

Base URL: `http://localhost:3000/api/v1`

## Authentication

All endpoints except `/auth/login`, `/auth/refresh`, and `POST /tenants` require Bearer token authentication.

```
Authorization: Bearer <access_token>
```

## Quick Start Flow

### 1. Create Tenant (Signup)

```bash
POST /tenants
Content-Type: application/json

{
  "name": "Mi Clínica",
  "slug": "mi-clinica",
  "email": "contacto@miclinica.com",
  "phone": "+52 555 123 4567",
  "adminFirstName": "Juan",
  "adminLastName": "Pérez",
  "adminEmail": "admin@miclinica.com",
  "adminPassword": "SecurePass123!"
}
```

Response creates:
- Tenant
- Tenant settings (default working hours)
- Subscription (TRIAL, 14 days, 1 seat)
- Admin user (TENANT_ADMIN role)

### 2. Login

```bash
POST /auth/login
Content-Type: application/json

{
  "email": "admin@miclinica.com",
  "password": "SecurePass123!"
}
```

Response:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "...",
    "email": "admin@miclinica.com",
    "firstName": "Juan",
    "lastName": "Pérez",
    "role": "TENANT_ADMIN",
    "tenantId": "..."
  }
}
```

### 3. Invite Psychologist

```bash
POST /tenants/{tenantId}/users/invite
Authorization: Bearer <token>
Content-Type: application/json

{
  "email": "doctora@miclinica.com",
  "firstName": "María",
  "lastName": "González",
  "phone": "+52 555 987 6543",
  "role": "PSYCHOLOGIST"
}
```

**If seat limit reached:**
```json
{
  "statusCode": 403,
  "error": "SEAT_LIMIT_REACHED",
  "message": "Seat limit reached. Current plan allows 1 psychologist(s). Please upgrade your plan.",
  "details": {
    "seatsPsychologistsMax": 1,
    "seatsPsychologistsUsed": 1,
    "planType": "BASIC"
  }
}
```

### 4. Create Patient

```bash
POST /tenants/{tenantId}/patients
Authorization: Bearer <token>
Content-Type: application/json

{
  "firstName": "Pedro",
  "lastName": "Martínez",
  "email": "pedro@email.com",
  "phone": "+52 555 111 2222",
  "dateOfBirth": "1985-06-15",
  "emergencyContact": "Ana Martínez",
  "emergencyPhone": "+52 555 333 4444"
}
```

### 5. Create Appointment (with Conflict Detection)

```bash
POST /tenants/{tenantId}/appointments
Authorization: Bearer <token>
Content-Type: application/json

{
  "patientId": "patient-id",
  "psychologistId": "psychologist-user-id",
  "title": "Sesión de terapia cognitivo-conductual",
  "startTime": "2024-03-15T10:00:00Z",
  "duration": 60,
  "location": "Consultorio 1",
  "isOnline": false
}
```

**Success Response:**
```json
{
  "id": "appointment-id",
  "startTime": "2024-03-15T10:00:00Z",
  "endTime": "2024-03-15T11:00:00Z",
  "status": "SCHEDULED",
  "patient": {
    "id": "...",
    "firstName": "Pedro",
    "lastName": "Martínez"
  },
  "psychologist": {
    "id": "...",
    "firstName": "María",
    "lastName": "González"
  }
}
```

**Conflict Response:**
```json
{
  "statusCode": 409,
  "error": "APPOINTMENT_CONFLICT",
  "message": "This time slot conflicts with existing appointment(s)",
  "conflicts": [
    {
      "id": "existing-appointment-id",
      "patient": "Juan Pérez",
      "startTime": "2024-03-15T09:30:00Z",
      "endTime": "2024-03-15T10:30:00Z"
    }
  ]
}
```

### 6. Create Clinical Note (with Audit Log)

```bash
POST /tenants/{tenantId}/clinical-notes
Authorization: Bearer <token>
Content-Type: application/json

{
  "patientId": "patient-id",
  "appointmentId": "appointment-id",
  "content": "Paciente refiere mejoría en síntomas de ansiedad. Se observa mejor manejo de técnicas de relajación.",
  "diagnosis": "Trastorno de ansiedad generalizada (F41.1)",
  "treatment": "Continuar con TCC, énfasis en exposición gradual",
  "observations": "Programar seguimiento en 2 semanas",
  "sessionDuration": 60
}
```

This automatically creates an audit log entry tracking the creation.

### 7. Create Next Session Plan

```bash
POST /tenants/{tenantId}/next-session-plans
Authorization: Bearer <token>
Content-Type: application/json

{
  "patientId": "patient-id",
  "objectives": "Trabajar exposición gradual a situaciones sociales",
  "techniques": "Reestructuración cognitiva, role-playing",
  "homework": "Registro de pensamientos automáticos en situaciones sociales",
  "notes": "Considerar incluir técnicas de mindfulness"
}
```

## Filtering & Querying

### List Appointments with Filters

```bash
GET /tenants/{tenantId}/appointments?psychologistId=user-id&status=SCHEDULED&from=2024-03-01T00:00:00Z&to=2024-03-31T23:59:59Z
```

### Search Patients

```bash
GET /tenants/{tenantId}/patients?search=pedro
```

### List Users by Role

```bash
GET /tenants/{tenantId}/users?role=PSYCHOLOGIST&isActive=true
```

### Get Unread Notifications

```bash
GET /tenants/{tenantId}/notifications?unreadOnly=true
```

### Query Audit Logs

```bash
GET /tenants/{tenantId}/audit-logs?entity=CLINICAL_NOTE&userId=psychologist-id&from=2024-03-01&to=2024-03-31
```

## Working with Reminders

Reminders are sent automatically based on tenant settings.

### Tenant Reminder Configuration

Default rules: `["24h", "2h"]`

This means reminders are sent:
- 24 hours before appointment
- 2 hours before appointment

Configured in `TenantSettings.reminderRules`

## Role-Based Access

### TENANT_ADMIN Can:
- ✅ Create/invite users (with seat limits)
- ✅ Update tenant settings
- ✅ View all clinical notes
- ✅ Delete clinical notes
- ✅ Access audit logs
- ✅ Manage subscriptions

### PSYCHOLOGIST Can:
- ✅ Create patients
- ✅ Create appointments
- ✅ Create clinical notes (own)
- ✅ Read own clinical notes
- ✅ Create/update session plans
- ✅ Manage tasks

### ASSISTANT Can:
- ✅ Create patients
- ✅ Create/update appointments
- ✅ Manage tasks
- ❌ Cannot create clinical notes
- ❌ Cannot read clinical notes

## Error Handling

### Common Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Validation failed |
| 401 | Unauthorized | Invalid/expired token |
| 403 | Forbidden | Insufficient permissions or tenant mismatch |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate resource or business rule violation |
| 429 | Too Many Requests | Rate limit exceeded |

### Seat Limit Error

```json
{
  "statusCode": 403,
  "error": "SEAT_LIMIT_REACHED",
  "message": "Seat limit reached. Current plan allows X psychologist(s). Please upgrade your plan.",
  "details": {
    "seatsPsychologistsMax": 1,
    "seatsPsychologistsUsed": 1,
    "planType": "BASIC"
  }
}
```

### Appointment Conflict Error

```json
{
  "statusCode": 409,
  "error": "APPOINTMENT_CONFLICT",
  "message": "This time slot conflicts with existing appointment(s)",
  "conflicts": [...]
}
```

## Testing Endpoints

Use the Swagger UI for interactive testing:

```
http://localhost:3000/api/v1/docs
```

Or use cURL/Postman/Insomnia with the examples above.
