import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { PatientsModule } from './patients/patients.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ClinicalNotesModule } from './clinical-notes/clinical-notes.module';
import { TasksModule } from './tasks/tasks.module';
import { NextSessionPlansModule } from './next-session-plans/next-session-plans.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { SchedulerModule } from './common/scheduler/scheduler.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { TenantSettingsModule } from './tenant-settings/tenant-settings.module';

const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL) || 60000,
        limit: parseInt(process.env.THROTTLE_LIMIT) || 10,
      },
    ]),

    // BullMQ for background jobs (requires Redis)
    ...(isRedisEnabled
      ? [
          BullModule.forRoot({
            redis: {
              host: process.env.REDIS_HOST || 'localhost',
              port: parseInt(process.env.REDIS_PORT) || 6379,
              password: process.env.REDIS_PASSWORD || undefined,
            },
          }),
        ]
      : []),

    // Prisma database
    PrismaModule,

    // Scheduler for background jobs (requires Redis)
    ...(isRedisEnabled ? [SchedulerModule] : []),

    // Feature modules
    AuthModule,
    TenantsModule,
    UsersModule,
    PatientsModule,
    AppointmentsModule,
    ClinicalNotesModule,
    TasksModule,
    NextSessionPlansModule,
    NotificationsModule,
    AuditLogModule,
    SubscriptionModule,
    TenantSettingsModule,
  ],
})
export class AppModule {}
