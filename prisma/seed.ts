import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Clean up existing data
  console.log('🧹 Cleaning up existing data...');
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

  // Create Tenant 1: "Clínica Bienestar"
  console.log('🏢 Creating Tenant 1: Clínica Bienestar...');
  const tenant1 = await prisma.tenant.create({
    data: {
      name: 'Clínica Bienestar',
      slug: 'clinica-bienestar',
      email: 'contacto@clinicabienestar.com',
      phone: '+52 555 100 2000',
      isActive: true,
      onboardingCompleted: true,
    },
  });

  // Create Tenant Settings
  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant1.id,
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      workingHoursStart: '09:00',
      workingHoursEnd: '18:00',
      defaultAppointmentDuration: 60,
      reminderEnabled: true,
      reminderRules: ['24h', '2h'],
    },
  });

  // Create Subscription (PRO plan) for Tenant 1
  const sub1StartDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // Started 60 days ago
  const sub1 = await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant1.id,
      planType: 'PRO',
      status: 'ACTIVE',
      startDate: sub1StartDate,
      endDate: new Date(sub1StartDate.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year from start
      trialEndsAt: new Date(sub1StartDate.getTime() + 14 * 24 * 60 * 60 * 1000), // Trial ended 46 days ago
      currentPeriodStart: new Date(Date.now() - 0 * 24 * 60 * 60 * 1000), // Current billing period started today
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Ends in 30 days
      basePrice: 149.00,
      pricePerSeat: 29.00,
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
      featureOnlineSchedulingWidget: false,
      featureCustomReports: true,
      featureAPIAccess: false,
      featureWhatsAppIntegration: false,
      featureSSO: false,
      activePatientsCount: 3,
      storageUsedBytes: BigInt(524288000), // ~500MB
      monthlyNotificationsSent: 127,
      lastNotificationReset: new Date(Date.now() - 0 * 24 * 60 * 60 * 1000),
    },
  });

  // Subscription Events for Tenant 1
  console.log('📊 Creating subscription events for Clínica Bienestar...');
  await prisma.subscriptionEvent.createMany({
    data: [
      {
        tenantId: tenant1.id,
        eventType: 'TRIAL_STARTED',
        newPlan: 'TRIAL',
        newStatus: 'TRIALING',
        reason: 'Registro inicial de la clínica',
        createdAt: sub1StartDate,
      },
      {
        tenantId: tenant1.id,
        eventType: 'TRIAL_ENDED',
        previousPlan: 'TRIAL',
        previousStatus: 'TRIALING',
        reason: 'Periodo de prueba de 14 días finalizado',
        createdAt: new Date(sub1StartDate.getTime() + 14 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        eventType: 'PLAN_UPGRADED',
        previousPlan: 'TRIAL',
        newPlan: 'BASIC',
        previousStatus: 'TRIALING',
        newStatus: 'ACTIVE',
        reason: 'Upgrade a plan BASIC tras finalizar trial',
        createdAt: new Date(sub1StartDate.getTime() + 14 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        eventType: 'SUBSCRIPTION_ACTIVATED',
        newPlan: 'BASIC',
        newStatus: 'ACTIVE',
        reason: 'Primer pago procesado exitosamente',
        createdAt: new Date(sub1StartDate.getTime() + 14 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        eventType: 'PAYMENT_SUCCEEDED',
        newPlan: 'BASIC',
        newStatus: 'ACTIVE',
        reason: 'Pago mensual procesado - $49.00 USD',
        metadata: { amount: 49.00, currency: 'USD', paymentMethod: 'card_visa_4242' },
        createdAt: new Date(sub1StartDate.getTime() + 14 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        eventType: 'PLAN_UPGRADED',
        previousPlan: 'BASIC',
        newPlan: 'PRO',
        previousStatus: 'ACTIVE',
        newStatus: 'ACTIVE',
        reason: 'Upgrade a plan PRO para acceder a notas clínicas encriptadas y analíticas avanzadas',
        createdAt: new Date(sub1StartDate.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        eventType: 'PAYMENT_SUCCEEDED',
        newPlan: 'PRO',
        newStatus: 'ACTIVE',
        reason: 'Pago mensual procesado - $149.00 USD + $58.00 (2 seats extra)',
        metadata: { amount: 207.00, currency: 'USD', seats: 2, paymentMethod: 'card_visa_4242' },
        createdAt: new Date(sub1StartDate.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        eventType: 'SEATS_INCREASED',
        newPlan: 'PRO',
        newStatus: 'ACTIVE',
        reason: 'Se agregó 1 asiento adicional para psicólogo',
        metadata: { previousSeats: 1, newSeats: 2 },
        createdAt: new Date(sub1StartDate.getTime() + 35 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        eventType: 'PAYMENT_SUCCEEDED',
        newPlan: 'PRO',
        newStatus: 'ACTIVE',
        reason: 'Pago mensual procesado - $207.00 USD',
        metadata: { amount: 207.00, currency: 'USD', seats: 2, paymentMethod: 'card_visa_4242' },
        createdAt: new Date(Date.now() - 0 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  // Usage Metrics for Tenant 1 (last 2 months)
  console.log('📈 Creating usage metrics for Clínica Bienestar...');
  await prisma.usageMetrics.createMany({
    data: [
      {
        tenantId: tenant1.id,
        periodStart: new Date(sub1StartDate.getTime() + 14 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(sub1StartDate.getTime() + 44 * 24 * 60 * 60 * 1000),
        seatsPsychologistsUsed: 1,
        activePatientsCount: 2,
        storageUsedGB: 0.12,
        notificationsSent: 45,
        appointmentsCreated: 18,
        clinicalNotesCreated: 12,
        tasksCreated: 5,
        estimatedCost: 49.00,
        recordedAt: new Date(sub1StartDate.getTime() + 44 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId: tenant1.id,
        periodStart: new Date(sub1StartDate.getTime() + 44 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(Date.now()),
        seatsPsychologistsUsed: 2,
        activePatientsCount: 3,
        storageUsedGB: 0.49,
        notificationsSent: 127,
        appointmentsCreated: 32,
        clinicalNotesCreated: 24,
        tasksCreated: 8,
        estimatedCost: 207.00,
        recordedAt: new Date(Date.now()),
      },
    ],
  });

  // Create Users for Tenant 1
  console.log('👤 Creating users for Clínica Bienestar...');
  const hashedPassword = await bcrypt.hash('Password123!', 10);

  const admin1 = await prisma.user.create({
    data: {
      tenantId: tenant1.id,
      email: 'admin@clinicabienestar.com',
      password: hashedPassword,
      firstName: 'Carlos',
      lastName: 'Rodríguez',
      phone: '+52 555 100 2001',
      role: 'TENANT_ADMIN',
      isActive: true,
    },
  });

  const psychologist1 = await prisma.user.create({
    data: {
      tenantId: tenant1.id,
      email: 'dra.martinez@clinicabienestar.com',
      password: hashedPassword,
      firstName: 'María',
      lastName: 'Martínez',
      phone: '+52 555 100 2002',
      role: 'PSYCHOLOGIST',
      isActive: true,
    },
  });

  const psychologist2 = await prisma.user.create({
    data: {
      tenantId: tenant1.id,
      email: 'dr.lopez@clinicabienestar.com',
      password: hashedPassword,
      firstName: 'Javier',
      lastName: 'López',
      phone: '+52 555 100 2003',
      role: 'PSYCHOLOGIST',
      isActive: true,
    },
  });

  const assistant1 = await prisma.user.create({
    data: {
      tenantId: tenant1.id,
      email: 'asistente@clinicabienestar.com',
      password: hashedPassword,
      firstName: 'Ana',
      lastName: 'García',
      phone: '+52 555 100 2004',
      role: 'ASSISTANT',
      isActive: true,
    },
  });

  // Create Patients for Tenant 1
  console.log('🩺 Creating patients for Clínica Bienestar...');
  const patient1 = await prisma.patient.create({
    data: {
      tenantId: tenant1.id,
      firstName: 'Pedro',
      lastName: 'Sánchez',
      email: 'pedro.sanchez@email.com',
      phone: '+52 555 200 3001',
      dateOfBirth: new Date('1985-06-15'),
      address: 'Calle Principal 123, CDMX',
      emergencyContact: 'Laura Sánchez',
      emergencyPhone: '+52 555 200 3002',
    },
  });

  const patient2 = await prisma.patient.create({
    data: {
      tenantId: tenant1.id,
      firstName: 'Sofía',
      lastName: 'Hernández',
      email: 'sofia.hernandez@email.com',
      phone: '+52 555 200 3003',
      dateOfBirth: new Date('1992-03-22'),
      address: 'Av. Reforma 456, CDMX',
      emergencyContact: 'Roberto Hernández',
      emergencyPhone: '+52 555 200 3004',
      allergies: 'Ninguna conocida',
      currentMedication: 'Sertralina 50mg',
    },
  });

  const patient3 = await prisma.patient.create({
    data: {
      tenantId: tenant1.id,
      firstName: 'Luis',
      lastName: 'Gómez',
      email: 'luis.gomez@email.com',
      phone: '+52 555 200 3005',
      dateOfBirth: new Date('1978-11-08'),
      address: 'Col. Roma 789, CDMX',
      emergencyContact: 'Carmen Gómez',
      emergencyPhone: '+52 555 200 3006',
    },
  });

  // Create Appointments for Tenant 1
  console.log('📅 Creating appointments for Clínica Bienestar...');
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await prisma.appointment.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient1.id,
      psychologistId: psychologist1.id,
      title: 'Sesión de seguimiento',
      startTime: new Date(tomorrow.setHours(10, 0, 0, 0)),
      endTime: new Date(tomorrow.setHours(11, 0, 0, 0)),
      duration: 60,
      location: 'Consultorio 1',
      isOnline: false,
      status: 'SCHEDULED',
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient2.id,
      psychologistId: psychologist1.id,
      title: 'Terapia cognitivo-conductual',
      startTime: new Date(tomorrow.setHours(15, 0, 0, 0)),
      endTime: new Date(tomorrow.setHours(16, 0, 0, 0)),
      duration: 60,
      location: 'Online',
      isOnline: true,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      status: 'CONFIRMED',
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient3.id,
      psychologistId: psychologist2.id,
      title: 'Primera consulta',
      startTime: new Date(nextWeek.setHours(11, 0, 0, 0)),
      endTime: new Date(nextWeek.setHours(12, 0, 0, 0)),
      duration: 60,
      location: 'Consultorio 2',
      isOnline: false,
      status: 'SCHEDULED',
    },
  });

  // Create Clinical Notes
  console.log('📝 Creating clinical notes...');
  const pastAppointment = await prisma.appointment.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient1.id,
      psychologistId: psychologist1.id,
      title: 'Sesión completada',
      startTime: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
      endTime: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      duration: 60,
      location: 'Consultorio 1',
      isOnline: false,
      status: 'COMPLETED',
    },
  });

  await prisma.clinicalNote.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient1.id,
      psychologistId: psychologist1.id,
      appointmentId: pastAppointment.id,
      content:
        'Paciente refiere mejoría significativa en síntomas de ansiedad. Maneja mejor las técnicas de respiración. Se observa mayor confianza en situaciones sociales.',
      diagnosis: 'Trastorno de ansiedad generalizada (F41.1)',
      treatment:
        'Continuar con TCC. Reforzar técnicas de exposición gradual.',
      observations: 'Programar sesión de seguimiento en 2 semanas.',
      sessionDuration: 60,
    },
  });

  // Create Tasks
  console.log('✅ Creating tasks...');
  await prisma.task.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient2.id,
      createdById: admin1.id,
      assignedToId: psychologist1.id,
      title: 'Revisar resultados de evaluación',
      description: 'Analizar cuestionario Beck completado por la paciente',
      priority: 'HIGH',
      dueDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
      status: 'PENDING',
    },
  });

  await prisma.task.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient3.id,
      createdById: admin1.id,
      assignedToId: psychologist2.id,
      title: 'Preparar material para primera sesión',
      description: 'Revisar historial médico y preparar ejercicios',
      priority: 'MEDIUM',
      dueDate: new Date(nextWeek.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day before appointment
      status: 'PENDING',
    },
  });

  // Create Next Session Plans
  console.log('📋 Creating session plans...');
  await prisma.nextSessionPlan.create({
    data: {
      tenantId: tenant1.id,
      patientId: patient1.id,
      psychologistId: psychologist1.id,
      objectives: 'Trabajar en exposición gradual a situaciones sociales',
      techniques:
        'Reestructuración cognitiva, role-playing, registro de pensamientos',
      homework:
        'Llevar diario de situaciones sociales y pensamientos automáticos',
      notes:
        'Considerar incluir técnicas de mindfulness en próximas sesiones',
    },
  });

  // Create Tenant 2: "Centro Psicológico Integral"
  console.log('🏢 Creating Tenant 2: Centro Psicológico Integral...');
  const tenant2 = await prisma.tenant.create({
    data: {
      name: 'Centro Psicológico Integral',
      slug: 'centro-integral',
      email: 'info@centrointegral.com',
      phone: '+52 555 300 4000',
      isActive: true,
      onboardingCompleted: false,
    },
  });

  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant2.id,
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
      workingHoursStart: '08:00',
      workingHoursEnd: '20:00',
      defaultAppointmentDuration: 50,
      reminderEnabled: true,
      reminderRules: ['48h', '24h', '2h'],
    },
  });

  // Create Subscription (BASIC plan - recently started, still in trial) for Tenant 2
  const sub2StartDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // Started 5 days ago
  const sub2 = await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant2.id,
      planType: 'TRIAL',
      status: 'TRIALING',
      startDate: sub2StartDate,
      trialEndsAt: new Date(sub2StartDate.getTime() + 14 * 24 * 60 * 60 * 1000), // Trial ends in 9 days
      currentPeriodStart: sub2StartDate,
      currentPeriodEnd: new Date(sub2StartDate.getTime() + 14 * 24 * 60 * 60 * 1000),
      basePrice: 0,
      pricePerSeat: 0,
      currency: 'USD',
      seatsPsychologistsMax: 1,
      seatsPsychologistsUsed: 1,
      maxActivePatients: 10,
      storageGB: 0,
      monthlyNotificationsLimit: 100,
      featureClinicalNotes: true,
      featureClinicalNotesEncryption: false,
      featureAttachments: false,
      featureTasks: false,
      featurePsychologicalTests: false,
      featureWebPush: false,
      featureFCMPush: false,
      featureAdvancedAnalytics: false,
      featureVideoConsultation: false,
      featureCalendarSync: false,
      featureOnlineSchedulingWidget: false,
      featureCustomReports: false,
      featureAPIAccess: false,
      featureWhatsAppIntegration: false,
      featureSSO: false,
      activePatientsCount: 0,
      storageUsedBytes: BigInt(0),
      monthlyNotificationsSent: 3,
      lastNotificationReset: sub2StartDate,
      // Scheduled upgrade to BASIC when trial ends
      scheduledPlanChange: 'BASIC',
      scheduledPlanChangeAt: new Date(sub2StartDate.getTime() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  // Subscription Events for Tenant 2
  console.log('📊 Creating subscription events for Centro Psicológico Integral...');
  await prisma.subscriptionEvent.createMany({
    data: [
      {
        tenantId: tenant2.id,
        eventType: 'TRIAL_STARTED',
        newPlan: 'TRIAL',
        newStatus: 'TRIALING',
        reason: 'Registro inicial del centro - periodo de prueba de 14 días',
        createdAt: sub2StartDate,
      },
    ],
  });

  // Usage Metrics for Tenant 2
  console.log('📈 Creating usage metrics for Centro Psicológico Integral...');
  await prisma.usageMetrics.create({
    data: {
      tenantId: tenant2.id,
      periodStart: sub2StartDate,
      periodEnd: new Date(Date.now()),
      seatsPsychologistsUsed: 1,
      activePatientsCount: 0,
      storageUsedGB: 0,
      notificationsSent: 3,
      appointmentsCreated: 0,
      clinicalNotesCreated: 0,
      tasksCreated: 0,
      estimatedCost: 0,
      recordedAt: new Date(Date.now()),
    },
  });

  const admin2 = await prisma.user.create({
    data: {
      tenantId: tenant2.id,
      email: 'admin@centrointegral.com',
      password: hashedPassword,
      firstName: 'Laura',
      lastName: 'Fernández',
      phone: '+52 555 300 4001',
      role: 'TENANT_ADMIN',
      isActive: true,
    },
  });

  const psychologist3 = await prisma.user.create({
    data: {
      tenantId: tenant2.id,
      email: 'dra.torres@centrointegral.com',
      password: hashedPassword,
      firstName: 'Elena',
      lastName: 'Torres',
      phone: '+52 555 300 4002',
      role: 'PSYCHOLOGIST',
      isActive: true,
    },
  });

  console.log('✅ Seed completed successfully!');
  console.log('\n📊 Summary:');
  console.log('  - 2 Tenants created');
  console.log('  - 2 Subscriptions (Tenant 1: PRO/ACTIVE, Tenant 2: TRIAL/TRIALING)');
  console.log('  - 10 Subscription Events');
  console.log('  - 3 Usage Metrics snapshots');
  console.log('  - 6 Users created (2 admins, 3 psychologists, 1 assistant)');
  console.log('  - 3 Patients created');
  console.log('  - 4 Appointments created');
  console.log('  - 1 Clinical Note created');
  console.log('  - 2 Tasks created');
  console.log('  - 1 Next Session Plan created');
  console.log('\n🔑 Test Credentials (all tenants):');
  console.log('  Password: Password123!');
  console.log('\n📧 Tenant 1 - Clínica Bienestar (Plan PRO - Activo):');
  console.log('  Admin: admin@clinicabienestar.com');
  console.log('  Psychologist 1: dra.martinez@clinicabienestar.com');
  console.log('  Psychologist 2: dr.lopez@clinicabienestar.com');
  console.log('  Assistant: asistente@clinicabienestar.com');
  console.log('\n📧 Tenant 2 - Centro Psicológico Integral (Trial - 9 días restantes):');
  console.log('  Admin: admin@centrointegral.com');
  console.log('  Psychologist: dra.torres@centrointegral.com');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
