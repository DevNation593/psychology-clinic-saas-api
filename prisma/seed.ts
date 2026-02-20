import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function clearDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.nextSessionPlan.deleteMany();
  await prisma.task.deleteMany();
  await prisma.clinicalNote.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.subscriptionEvent.deleteMany();
  await prisma.usageMetrics.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenantSettings.deleteMany();
  await prisma.tenantSubscription.deleteMany();
  await prisma.tenant.deleteMany();
}

async function seedMainTenant(hashedPassword: string) {
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Psicologia Integral',
      slug: 'demo-psicologia',
      email: 'contacto@demopsicologia.com',
      phone: '+593999000001',
      address: 'Av. Principal 123, Quito',
      isActive: true,
      onboardingCompleted: true,
    },
  });

  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant.id,
      workingHoursStart: '08:30',
      workingHoursEnd: '18:30',
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      defaultAppointmentDuration: 50,
      allowDoubleBooking: false,
      reminderEnabled: true,
      reminderRules: ['24h', '2h'],
      timezone: 'America/Guayaquil',
      locale: 'es-EC',
    },
  });

  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planType: 'PRO',
      status: 'ACTIVE',
      startDate: daysFromNow(-45),
      currentPeriodStart: daysFromNow(-5),
      currentPeriodEnd: daysFromNow(25),
      basePrice: 149,
      pricePerSeat: 29,
      currency: 'USD',
      seatsPsychologistsMax: 10,
      seatsPsychologistsUsed: 2,
      maxActivePatients: 500,
      storageGB: 5,
      monthlyNotificationsLimit: 5000,
      featureClinicalNotes: true,
      featureClinicalNotesEncryption: true,
      featureAttachments: true,
      featureTasks: true,
      featurePsychologicalTests: true,
      featureWebPush: true,
      featureFCMPush: true,
      featureAdvancedAnalytics: true,
      featureVideoConsultation: true,
      featureCalendarSync: true,
      featureOnlineSchedulingWidget: true,
      featureCustomReports: true,
      featureAPIAccess: true,
      featureWhatsAppIntegration: false,
      featureSSO: false,
      activePatientsCount: 4,
      storageUsedBytes: BigInt(850 * 1024 * 1024),
      monthlyNotificationsSent: 97,
      lastNotificationReset: daysFromNow(-5),
    },
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin.demo@psic.com',
      password: hashedPassword,
      firstName: 'Daniela',
      lastName: 'Mendoza',
      phone: '+593999000010',
      role: 'TENANT_ADMIN',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-45),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Daniela%20Mendoza',
    },
  });

  const psych1 = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'psic.ana@psic.com',
      password: hashedPassword,
      firstName: 'Ana',
      lastName: 'Vega',
      phone: '+593999000011',
      role: 'PSYCHOLOGIST',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-40),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Ana%20Vega',
    },
  });

  const psych2 = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'psic.luis@psic.com',
      password: hashedPassword,
      firstName: 'Luis',
      lastName: 'Paredes',
      phone: '+593999000012',
      role: 'PSYCHOLOGIST',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-30),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Luis%20Paredes',
    },
  });

  const assistant = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'asistente.demo@psic.com',
      password: hashedPassword,
      firstName: 'Mariana',
      lastName: 'Rojas',
      phone: '+593999000013',
      role: 'ASSISTANT',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-20),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Mariana%20Rojas',
    },
  });

  const patient1 = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Valeria',
      lastName: 'Ortega',
      email: 'valeria.ortega@email.com',
      phone: '+593999100001',
      dateOfBirth: new Date('1994-04-12'),
      gender: 'FEMALE',
      address: 'La Carolina, Quito',
      emergencyContactName: 'Paula Ortega',
      emergencyContactPhone: '+593999100002',
      assignedPsychologistId: psych1.id,
      notes: 'Paciente con seguimiento semanal por ansiedad social.',
    },
  });

  const patient2 = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Jorge',
      lastName: 'Salazar',
      email: 'jorge.salazar@email.com',
      phone: '+593999100003',
      dateOfBirth: new Date('1988-09-02'),
      gender: 'MALE',
      emergencyContactName: 'Rosa Salazar',
      emergencyContactPhone: '+593999100004',
      assignedPsychologistId: psych1.id,
      currentMedication: 'Escitalopram 10mg',
    },
  });

  const patient3 = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Camila',
      lastName: 'Naranjo',
      phone: '+593999100005',
      dateOfBirth: new Date('2001-11-20'),
      gender: 'FEMALE',
      assignedPsychologistId: psych2.id,
    },
  });

  const patient4 = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Andres',
      lastName: 'Mora',
      email: 'andres.mora@email.com',
      phone: '+593999100006',
      dateOfBirth: new Date('1979-06-18'),
      gender: 'MALE',
      assignedPsychologistId: psych2.id,
    },
  });

  const completedAppointment = await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      patientId: patient1.id,
      psychologistId: psych1.id,
      title: 'Sesion de seguimiento ansiedad',
      description: 'Revision de avances y ajuste de tecnicas',
      startTime: daysFromNow(-3),
      endTime: new Date(daysFromNow(-3).getTime() + 50 * 60 * 1000),
      duration: 50,
      status: 'COMPLETED',
      location: 'Consultorio 2',
      isOnline: false,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      patientId: patient2.id,
      psychologistId: psych1.id,
      title: 'TCC - gestion de estres',
      startTime: daysFromNow(1),
      endTime: new Date(daysFromNow(1).getTime() + 60 * 60 * 1000),
      duration: 60,
      status: 'CONFIRMED',
      isOnline: true,
      meetingUrl: 'https://meet.example.com/demo-psic-001',
      location: 'Online',
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      patientId: patient3.id,
      psychologistId: psych2.id,
      title: 'Evaluacion inicial',
      startTime: daysFromNow(2),
      endTime: new Date(daysFromNow(2).getTime() + 50 * 60 * 1000),
      duration: 50,
      status: 'SCHEDULED',
      location: 'Consultorio 1',
      isOnline: false,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      patientId: patient4.id,
      psychologistId: psych2.id,
      title: 'Consulta cancelada',
      startTime: daysFromNow(-1),
      endTime: new Date(daysFromNow(-1).getTime() + 50 * 60 * 1000),
      duration: 50,
      status: 'CANCELLED',
      cancellationReason: 'Paciente reprogramo por viaje',
      cancelledAt: daysFromNow(-1),
      cancelledBy: assistant.id,
      location: 'Consultorio 3',
      isOnline: false,
    },
  });

  await prisma.clinicalNote.create({
    data: {
      tenantId: tenant.id,
      patientId: patient1.id,
      psychologistId: psych1.id,
      appointmentId: completedAppointment.id,
      content:
        'Paciente muestra menor evitacion social. Se reforzaron tecnicas de respiracion y registro de pensamientos automaticos.',
      diagnosis: 'Trastorno de ansiedad social',
      treatment: 'Terapia cognitivo conductual con exposicion gradual.',
      observations: 'Mantener frecuencia semanal por 4 sesiones adicionales.',
      sessionDate: daysFromNow(-3),
      sessionDuration: 50,
    },
  });

  await prisma.task.createMany({
    data: [
      {
        tenantId: tenant.id,
        patientId: patient2.id,
        createdById: admin.id,
        assignedToId: psych1.id,
        title: 'Revisar cuestionario PHQ-9',
        description: 'Analizar variacion respecto a la ultima medicion.',
        status: 'PENDING',
        priority: 'HIGH',
        dueDate: daysFromNow(1),
      },
      {
        tenantId: tenant.id,
        patientId: patient3.id,
        createdById: admin.id,
        assignedToId: psych2.id,
        title: 'Preparar plan de primera intervencion',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        dueDate: daysFromNow(2),
      },
      {
        tenantId: tenant.id,
        patientId: patient4.id,
        createdById: admin.id,
        assignedToId: psych2.id,
        title: 'Actualizar historia de medicacion',
        status: 'COMPLETED',
        priority: 'LOW',
        completedAt: daysFromNow(-2),
      },
      {
        tenantId: tenant.id,
        patientId: patient1.id,
        createdById: admin.id,
        assignedToId: psych1.id,
        title: 'Enviar material de psicoeducacion',
        status: 'PENDING',
        priority: 'URGENT',
        dueDate: daysFromNow(-1),
      },
    ],
  });

  await prisma.nextSessionPlan.create({
    data: {
      tenantId: tenant.id,
      patientId: patient1.id,
      psychologistId: psych1.id,
      objectives: 'Consolidar exposicion en contextos laborales.',
      techniques: 'Reestructuracion cognitiva y role-play.',
      homework: 'Registro ABC 3 veces por semana.',
      notes: 'Evaluar reduccion de evitacion en proxima sesion.',
    },
  });

  await prisma.notificationLog.createMany({
    data: [
      {
        tenantId: tenant.id,
        userId: admin.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        status: 'SENT',
        title: 'Bienvenido al entorno demo',
        body: 'La base de datos fue sembrada correctamente.',
        sentAt: daysFromNow(-1),
      },
      {
        tenantId: tenant.id,
        userId: psych1.id,
        type: 'APPOINTMENT_REMINDER',
        status: 'PENDING',
        title: 'Recordatorio de cita',
        body: 'Tienes una cita confirmada para manana.',
      },
      {
        tenantId: tenant.id,
        userId: psych1.id,
        type: 'TASK_DUE_SOON',
        status: 'READ',
        title: 'Tarea proxima a vencer',
        body: 'Revisar cuestionario PHQ-9 vence pronto.',
        readAt: daysFromNow(-1),
        sentAt: daysFromNow(-2),
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        tenantId: tenant.id,
        userId: psych1.id,
        action: 'CREATE',
        entity: 'CLINICAL_NOTE',
        entityId: completedAppointment.id,
        changes: { createdFrom: 'seed' },
      },
      {
        tenantId: tenant.id,
        userId: admin.id,
        action: 'UPDATE',
        entity: 'PATIENT',
        entityId: patient2.id,
        changes: { field: 'currentMedication', value: 'Escitalopram 10mg' },
      },
    ],
  });

  await prisma.subscriptionEvent.createMany({
    data: [
      {
        tenantId: tenant.id,
        eventType: 'TRIAL_ENDED',
        previousPlan: 'TRIAL',
        previousStatus: 'TRIALING',
        newPlan: 'BASIC',
        newStatus: 'ACTIVE',
        reason: 'Fin de trial y activacion inicial',
        createdAt: daysFromNow(-31),
      },
      {
        tenantId: tenant.id,
        eventType: 'PLAN_UPGRADED',
        previousPlan: 'BASIC',
        newPlan: 'PRO',
        previousStatus: 'ACTIVE',
        newStatus: 'ACTIVE',
        reason: 'Upgrade para habilitar analiticas avanzadas',
        createdAt: daysFromNow(-20),
      },
    ],
  });

  await prisma.usageMetrics.createMany({
    data: [
      {
        tenantId: tenant.id,
        periodStart: daysFromNow(-30),
        periodEnd: daysFromNow(-1),
        seatsPsychologistsUsed: 2,
        activePatientsCount: 4,
        storageUsedGB: 0.63,
        notificationsSent: 61,
        appointmentsCreated: 18,
        clinicalNotesCreated: 7,
        tasksCreated: 9,
        estimatedCost: 207,
        recordedAt: daysFromNow(-1),
      },
      {
        tenantId: tenant.id,
        periodStart: daysFromNow(-1),
        periodEnd: daysFromNow(29),
        seatsPsychologistsUsed: 2,
        activePatientsCount: 4,
        storageUsedGB: 0.81,
        notificationsSent: 97,
        appointmentsCreated: 6,
        clinicalNotesCreated: 3,
        tasksCreated: 4,
        estimatedCost: 207,
        recordedAt: new Date(),
      },
    ],
  });

  return {
    tenant,
    users: {
      admin,
      psych1,
      psych2,
      assistant,
    },
  };
}

async function seedSecondaryTenant(hashedPassword: string) {
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Centro en Trial',
      slug: 'demo-trial',
      email: 'contacto@demotrial.com',
      phone: '+593999200001',
      isActive: true,
      onboardingCompleted: false,
    },
  });

  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant.id,
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00',
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      defaultAppointmentDuration: 60,
      reminderEnabled: true,
      reminderRules: ['24h'],
      timezone: 'America/Guayaquil',
      locale: 'es-EC',
    },
  });

  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planType: 'TRIAL',
      status: 'TRIALING',
      startDate: daysFromNow(-4),
      trialEndsAt: daysFromNow(10),
      currentPeriodStart: daysFromNow(-4),
      currentPeriodEnd: daysFromNow(10),
      basePrice: 0,
      pricePerSeat: 0,
      currency: 'USD',
      seatsPsychologistsMax: 1,
      seatsPsychologistsUsed: 1,
      maxActivePatients: 10,
      storageGB: 0,
      monthlyNotificationsLimit: 100,
      featureClinicalNotes: true,
      featureAttachments: false,
      featureTasks: false,
      activePatientsCount: 1,
      storageUsedBytes: BigInt(50 * 1024 * 1024),
      monthlyNotificationsSent: 8,
      lastNotificationReset: daysFromNow(-4),
      scheduledPlanChange: 'BASIC',
      scheduledPlanChangeAt: daysFromNow(10),
    },
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin.trial@psic.com',
      password: hashedPassword,
      firstName: 'Carla',
      lastName: 'Noboa',
      role: 'TENANT_ADMIN',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-4),
    },
  });

  const psych = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'psic.trial@psic.com',
      password: hashedPassword,
      firstName: 'Miguel',
      lastName: 'Arias',
      role: 'PSYCHOLOGIST',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-4),
    },
  });

  await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Priscila',
      lastName: 'Viteri',
      email: 'priscila.viteri@email.com',
      phone: '+593999200010',
      assignedPsychologistId: psych.id,
    },
  });

  return { tenant, admin };
}

async function main() {
  console.log('🌱 Starting deterministic demo seed...');
  await clearDatabase();

  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
  const mainTenant = await seedMainTenant(hashedPassword);
  const trialTenant = await seedSecondaryTenant(hashedPassword);

  console.log('✅ Seed completed successfully.');
  console.log('');
  console.log('Login credentials (all users):');
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log('');
  console.log(`Main tenant: ${mainTenant.tenant.name} (${mainTenant.tenant.slug})`);
  console.log('  admin.demo@psic.com (TENANT_ADMIN)');
  console.log('  psic.ana@psic.com (PSYCHOLOGIST)');
  console.log('  psic.luis@psic.com (PSYCHOLOGIST)');
  console.log('  asistente.demo@psic.com (ASSISTANT)');
  console.log('');
  console.log(`Trial tenant: ${trialTenant.tenant.name} (${trialTenant.tenant.slug})`);
  console.log('  admin.trial@psic.com (TENANT_ADMIN)');
  console.log('  psic.trial@psic.com (PSYCHOLOGIST)');
}

main()
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
