# Architecture Documentation

## System Overview

The Psychology Clinic SaaS is a **multi-tenant** backend system designed to manage psychology clinics with:

- **Complete tenant isolation** (each clinic is a separate tenant)
- **Subscription-based seat licensing** (pay per psychologist)
- **Role-based access control** (TENANT_ADMIN, PSYCHOLOGIST, ASSISTANT)
- **Clinical compliance** (audit logging, restricted access)
- **Automated workflows** (appointment reminders, notifications)

## Core Architectural Patterns

### 1. Multi-Tenancy Model

**Strategy**: Row-Level Tenant Isolation

Every entity includes a `tenantId` foreign key. All queries are automatically scoped to the current user's tenant.

```typescript
// TenantGuard enforces isolation
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = request.user;
    const tenantIdFromParams = request.params?.tenantId;
    
    // Validate tenant access
    if (tenantIdFromParams !== user.tenantId) {
      throw new ForbiddenException('Access denied: Tenant mismatch');
    }
    
    return true;
  }
}
```

**Benefits**:
- ✅ Simple to implement and reason about
- ✅ Good performance (single database)
- ✅ Easy to backup/restore per tenant
- ✅ Clear data boundaries

**Trade-offs**:
- ⚠️ Need careful query filtering (always include tenantId)
- ⚠️ Shared database resources (can't isolate compute per tenant)
- ⚠️ Schema changes affect all tenants

### 2. Authentication & Authorization

**JWT Strategy with Refresh Token Rotation**

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ 1. Login (email/password)
       v
┌─────────────────────┐
│   Auth Service      │
│  - Verify password  │
│  - Generate tokens  │
└──────┬──────────────┘
       │
       v
┌──────────────────────────┐
│  Access Token (15min)    │  ← Short-lived, for API calls
│  Refresh Token (7 days)  │  ← Long-lived, for renewal
└──────────────────────────┘
       │
       │ 2. API Request (with access token)
       v
┌─────────────────────┐
│  JwtAuthGuard       │
│  - Validate token   │
│  - Extract user     │
└──────┬──────────────┘
       │
       v
┌─────────────────────┐
│  TenantGuard        │
│  - Check tenantId   │
└──────┬──────────────┘
       │
       v
┌─────────────────────┐
│  RolesGuard         │
│  - Check role       │
└──────┬──────────────┘
       │
       v
   Execute endpoint
```

**Refresh Token Rotation**:
- Each refresh generates a new token pair
- Old refresh token is immediately revoked
- Tokens belong to a "family" (tracked by `familyId`)
- If a revoked token is used → entire family is revoked (security breach detected)

### 3. Subscription & Seat Management

**Seat Enforcement Flow**:

```
User (TENANT_ADMIN) → Create PSYCHOLOGIST
                          ↓
              Check TenantSubscription
                          ↓
        ┌─────────────────┴─────────────────┐
        │                                   │
   seatsPsychologistsUsed               seatsPsychologistsUsed
   < seatsPsychologistsMax              >= seatsPsychologistsMax
        │                                   │
        v                                   v
   Create user                         Throw 403
   Increment seatsPsychologistsUsed    SEAT_LIMIT_REACHED
```

**Key Implementation**:

```typescript
private async checkSeatAvailability(tenantId: string) {
  const subscription = await this.prisma.tenantSubscription.findUnique({
    where: { tenantId },
  });

  if (subscription.seatsPsychologistsUsed >= subscription.seatsPsychologistsMax) {
    throw new ForbiddenException({
      error: 'SEAT_LIMIT_REACHED',
      message: `Seat limit reached. Current plan allows ${subscription.seatsPsychologistsMax} psychologist(s).`,
      details: { ... }
    });
  }
}
```

**Seat Tracking**:
- Only `PSYCHOLOGIST` role counts
- `TENANT_ADMIN` and `ASSISTANT` are free
- Deactivating a psychologist frees up a seat
- Changing role from/to PSYCHOLOGIST updates count

### 4. Appointment Conflict Detection

**Algorithm**:

```typescript
// Check if new appointment overlaps with existing ones
const conflicts = await prisma.appointment.findMany({
  where: {
    tenantId,
    psychologistId,
    status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    OR: [
      // New starts during existing
      { startTime: { lte: newStart }, endTime: { gt: newStart } },
      // New ends during existing
      { startTime: { lt: newEnd }, endTime: { gte: newEnd } },
      // New contains existing
      { startTime: { gte: newStart }, endTime: { lte: newEnd } },
    ],
  },
});

if (conflicts.length > 0) {
  throw new ConflictException({ conflicts });
}
```

**Visualization**:

```
Existing:  |-------|
New:            |-------|  ❌ Overlaps

Existing:  |-------|
New:               |-------|  ✅ Back-to-back OK

Existing:     |-------|
New:       |-------------|  ❌ Contains existing
```

### 5. Clinical Notes Security & Audit

**Access Control**:
- Psychologists can only read/write their own notes
- TENANT_ADMIN can override (compliance requirement)
- Every access is logged in AuditLog

**Audit Trail**:

```typescript
await this.prisma.auditLog.create({
  data: {
    tenantId,
    userId,
    action: 'READ', // CREATE, READ, UPDATE, DELETE
    entity: 'CLINICAL_NOTE',
    entityId: noteId,
    changes: { ... }, // Before/after values
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  },
});
```

**Encryption at Rest** (Optional):

```typescript
// Before saving
const encryptedContent = encryptionService.encrypt(note.content);

// After reading
const decryptedContent = encryptionService.decrypt(note.content);
```

Uses AES-256-GCM with:
- Random IV per encryption
- Authentication tag for integrity
- Key derivation from `ENCRYPTION_KEY` env var

### 6. Background Jobs (BullMQ)

**Architecture**:

```
┌────────────────────┐
│  Scheduler Service │  (Cron: every 15 min)
└─────────┬──────────┘
          │
          v
┌──────────────────┐
│  BullMQ Queue    │  (Redis-backed)
│  "reminders"     │
└─────────┬────────┘
          │
          v
┌──────────────────────┐
│  Reminder Processor  │
│  - Find appointments │
│  - Send notifications│
│  - Track sent status │
└──────────────────────┘
```

**Reminder Logic**:

```typescript
// For each tenant with reminderEnabled
for (const hoursBefore of [24, 2]) {
  // Find appointments starting in ~hoursBefore hours
  const startTimeFrom = now + hoursBefore * 60min - 30min;
  const startTimeTo = now + hoursBefore * 60min + 30min;
  
  const appointments = find({
    startTime: { gte: startTimeFrom, lte: startTimeTo },
    reminderSent24h: hoursBefore === 24 ? false : undefined,
    reminderSent2h: hoursBefore === 2 ? false : undefined,
  });
  
  for (const appt of appointments) {
    sendNotification(appt);
    markReminderSent(appt, hoursBefore);
  }
}
```

**Job Configuration**:

```typescript
await queue.add('check-appointments', {}, {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000, // 5s, 25s, 125s
  },
});
```

### 7. Notifications (In-App + FCM)

**Dual Notification Strategy**:

1. **In-App**: Always stored in `NotificationLog`
2. **Push**: Optionally sent via FCM (if configured)

```typescript
// Create in-app notification
await prisma.notificationLog.create({ ... });

// Send push notification (if FCM configured)
if (firebaseApp && user.fcmToken) {
  await firebaseApp.messaging().send({
    token: user.fcmToken,
    notification: { title, body },
    data: { ... },
  });
}
```

**FCM Setup**:
- Requires Firebase service account credentials
- Frontend registers FCM token on login
- Token stored in user profile
- Notifications sent to all active user devices

## Data Flow Examples

### Creating a Tenant (Signup)

```
POST /tenants
   │
   ├─> Validate input (DTO)
   │
   ├─> Check slug uniqueness
   │
   ├─> Transaction:
   │   ├─> Create Tenant
   │   ├─> Create TenantSettings (defaults)
   │   ├─> Create TenantSubscription (TRIAL, 1 seat)
   │   └─> Create Admin User (TENANT_ADMIN)
   │
   └─> Return tenant + subscription details
```

### Creating a User (Invite Flow)

```
POST /tenants/:id/users/invite
   │
   ├─> [JwtAuthGuard] Verify token
   │
   ├─> [TenantGuard] Verify tenantId matches
   │
   ├─> [RolesGuard] Verify role = TENANT_ADMIN
   │
   ├─> If role = PSYCHOLOGIST:
   │   └─> Check seat availability
   │
   ├─> Transaction:
   │   ├─> Create User (isActive=false)
   │   └─> Increment seatsPsychologistsUsed
   │
   ├─> Send invitation email (TODO)
   │
   └─> Return user (without password)
```

### Appointment Reminder Worker

```
Every 15 minutes:
   │
   ├─> Query active tenants with reminderEnabled
   │
   ├─> For each tenant:
   │   ├─> Get reminder rules (e.g., ["24h", "2h"])
   │   │
   │   ├─> For each rule:
   │   │   ├─> Find appointments starting in ~rule hours
   │   │   ├─> Filter out already-sent reminders
   │   │   │
   │   │   ├─> For each appointment:
   │   │   │   ├─> Create in-app notification
   │   │   │   ├─> Send FCM push (if configured)
   │   │   │   └─> Mark reminderSent24h/2h = true
   │   │   │
   │   │   └─> Log success/failure
   │   │
   │   └─> Next tenant
   │
   └─> Report total sent
```

## Database Design Principles

### Normalization
- 3NF (Third Normal Form)
- Clear foreign key relationships
- Proper indexing on foreign keys and query columns

### Soft Deletes
- `deletedAt` timestamp for Patient (compliance)
- Keeps historical data intact
- Easy to restore

### Timestamps
- `createdAt` and `updatedAt` on all entities
- Audit trail support
- Query by date ranges

### Enums
- TypeScript types match Prisma enums
- Validated at runtime (class-validator)
- Type-safe in code

## Performance Considerations

### Database Optimization
- ✅ Indexes on foreign keys (tenantId, userId, patientId, etc.)
- ✅ Composite indexes for common queries (tenantId + startTime)
- ✅ Pagination on list endpoints (default limit: 50-100)
- ⚠️ N+1 queries prevented with Prisma includes

### Caching Strategy (Future)
- Redis cache for:
  - Tenant settings (TTL: 1 hour)
  - User profiles (TTL: 15 minutes)
  - Subscription limits (TTL: 5 minutes)
- Cache invalidation on updates

### Rate Limiting
- Global: 60 requests / minute
- Auth endpoints: 5 requests / minute
- Prevents brute-force attacks

## Scalability Path

### Horizontal Scaling
1. **API Servers**: Stateless → easy to add more instances
2. **Database**: Read replicas for reports/analytics
3. **Redis**: Redis Cluster for job queue distribution
4. **Background Workers**: Multiple worker instances processing jobs

### Vertical Scaling
- Increase database resources (CPU, RAM)
- Optimize queries with EXPLAIN ANALYZE
- Add materialized views for complex reports

### Monitoring
- Application Performance Monitoring (APM): DataDog, New Relic
- Log aggregation: ELK Stack, Grafana Loki
- Metrics: Prometheus + Grafana
- Health checks: `/health` endpoint

## Security Checklist

- ✅ JWT with refresh token rotation
- ✅ Password hashing (bcrypt, 10 rounds)
- ✅ Tenant isolation (enforced at guard level)
- ✅ Role-based access control
- ✅ Rate limiting on auth
- ✅ Input validation (class-validator)
- ✅ SQL injection prevention (Prisma parameterized queries)
- ✅ Audit logging for sensitive operations
- ⚠️ HTTPS required in production
- ⚠️ CORS configured (whitelist origins)
- ⚠️ Helmet.js for security headers (recommended)

## Compliance & GDPR

### Data Privacy
- Patient data belongs to tenant
- Tenant admins can export/delete all data
- Soft deletes preserve audit trail
- Encryption at rest option for clinical notes

### Audit Trail
- All clinical note accesses logged
- Immutable audit log (no deletes)
- Queryable by admin
- Retention policy (configurable)

### Right to be Forgotten
- Soft delete patient → marks deletedAt
- Hard delete (admin action) → removes from database
- Cascading deletes configured in Prisma schema

---

**Last Updated**: 2024-12-15
