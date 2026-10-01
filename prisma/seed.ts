import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  assertSeedTopology,
  buildCanonicalSeedRelations,
  DEMO_SEED_TOPOLOGY,
  resolvePrimaryProfessionalId,
  type SeedPatientKey,
  type SeedProfessionalKey,
  type SeedSpecialtyKey,
} from './seed-topology';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';

type SpecialtyCatalog = Record<SeedSpecialtyKey, { id: string }>;

async function seedSpecialtyCatalog(): Promise<SpecialtyCatalog> {
  const specialties = await Promise.all([
    prisma.specialty.upsert({
      where: { code: 'PSYCHOLOGY' },
      update: { name: 'Psicología', isActive: true },
      create: {
        code: 'PSYCHOLOGY',
        name: 'Psicología',
        description: 'Atención psicológica y psicoterapia.',
      },
    }),
    prisma.specialty.upsert({
      where: { code: 'NUTRITION' },
      update: { name: 'Nutrición', isActive: true },
      create: {
        code: 'NUTRITION',
        name: 'Nutrición',
        description: 'Evaluación nutricional y planes alimenticios.',
      },
    }),
    prisma.specialty.upsert({
      where: { code: 'PHYSIOTHERAPY' },
      update: { name: 'Fisioterapia', isActive: true },
      create: {
        code: 'PHYSIOTHERAPY',
        name: 'Fisioterapia',
        description: 'Evaluación funcional y rehabilitación.',
      },
    }),
    prisma.specialty.upsert({
      where: { code: 'DENTISTRY' },
      update: { name: 'Odontología', isActive: true },
      create: {
        code: 'DENTISTRY',
        name: 'Odontología',
        description: 'Prevención y atención odontológica.',
      },
    }),
  ]);

  const [psychology, nutrition, physiotherapy, dentistry] = specialties;
  await prisma.specialtyModule.createMany({
    data: [
      { specialtyId: psychology.id, moduleKey: 'psychology.session-notes' },
      { specialtyId: psychology.id, moduleKey: 'psychology.assessments' },
      { specialtyId: nutrition.id, moduleKey: 'nutrition.assessments' },
      { specialtyId: nutrition.id, moduleKey: 'nutrition.diet-plans' },
      { specialtyId: physiotherapy.id, moduleKey: 'physiotherapy.evolution' },
      { specialtyId: physiotherapy.id, moduleKey: 'physiotherapy.exercise-plans' },
      { specialtyId: dentistry.id, moduleKey: 'dentistry.treatments' },
      { specialtyId: dentistry.id, moduleKey: 'dentistry.odontogram' },
    ],
    skipDuplicates: true,
  });

  await prisma.planSpecialty.createMany({
    data: specialties.flatMap((specialty) => [
      { planType: 'TRIAL', specialtyId: specialty.id },
      { planType: 'PERSONAL_BASIC', specialtyId: specialty.id },
      { planType: 'PERSONAL_PRO', specialtyId: specialty.id },
      { planType: 'CLINIC_BASIC', specialtyId: specialty.id },
      { planType: 'CLINIC_PRO', specialtyId: specialty.id },
      { planType: 'CLINIC_ENTERPRISE', specialtyId: specialty.id },
    ]),
    skipDuplicates: true,
  });

  return { psychology, nutrition, physiotherapy, dentistry };
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function clearDatabase() {
  await prisma.specialtyRecord.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.billingSettings.deleteMany();
  await prisma.tenantModule.deleteMany();
  await prisma.subscriptionSpecialty.deleteMany();
  await prisma.planSpecialty.deleteMany();
  await prisma.specialtyModule.deleteMany();
  await prisma.professionalSpecialty.deleteMany();
  await prisma.professionalProfile.deleteMany();
  await prisma.tenantSpecialty.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.nextSessionPlan.deleteMany();
  await prisma.task.deleteMany();
  await prisma.clinicalNote.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.patientProfessional.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.subscriptionEvent.deleteMany();
  await prisma.usageMetrics.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenantSettings.deleteMany();
  await prisma.tenantSubscription.deleteMany();
  await prisma.tenant.deleteMany();
}

async function seedMainTenant(hashedPassword: string, catalog: SpecialtyCatalog) {
  const professionalDefinition = (key: SeedProfessionalKey) =>
    DEMO_SEED_TOPOLOGY.professionals.find((professional) => professional.key === key)!;
  const adminDefinition = professionalDefinition('clinicAdmin');
  const psychologyDefinition = professionalDefinition('psychology');
  const nutritionDefinition = professionalDefinition('nutrition');
  const physiotherapyDefinition = professionalDefinition('physiotherapy');

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Consultorio Integral',
      email: 'contacto@demopsicologia.com',
      phone: '+593999000001',
      address: 'Av. Principal 123, Quito',
      legalName: 'Demo Consultorio Integral S.A.',
      taxIdentificationType: 'RUC',
      taxIdentificationNumber: '1790012345001',
      tenantType: 'CLINIC',
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
      defaultAppointmentDuration: 60,
      allowDoubleBooking: false,
      reminderEnabled: true,
      reminderRules: ['24h', '2h'],
      timezone: 'America/Guayaquil',
      locale: 'es-EC',
    },
  });

  const subscription = await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planType: 'CLINIC_PRO',
      status: 'ACTIVE',
      startDate: daysFromNow(-45),
      currentPeriodStart: daysFromNow(-5),
      currentPeriodEnd: daysFromNow(25),
      basePrice: 214,
      pricePerSeat: 29,
      currency: 'USD',
      seatsPsychologistsMax: 10,
      seatsPsychologistsUsed: 4,
      maxActivePatients: 500,
      storageGB: 5,
      monthlyNotificationsLimit: 5000,
      includedSpecialties: 4,
      specialtyPrice: 15,
      monthlyElectronicInvoicesLimit: 50,
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

  await prisma.billingSettings.create({
    data: {
      tenantId: tenant.id,
      provider: 'FAKTUR',
      apiUrl: 'https://api.faktur.ec',
      invoicePath: '/invoices',
      environment: 'TEST',
      establishment: '001',
      emissionPoint: '001',
      nextSequential: 1,
      businessName: 'Demo Consultorio Integral S.A.',
      businessAddress: 'Av. Principal 123, Quito',
      isEnabled: false,
    },
  });

  await prisma.tenantSpecialty.createMany({
    data: [
      { tenantId: tenant.id, specialtyId: catalog.psychology.id },
      { tenantId: tenant.id, specialtyId: catalog.nutrition.id },
      { tenantId: tenant.id, specialtyId: catalog.physiotherapy.id },
      { tenantId: tenant.id, specialtyId: catalog.dentistry.id },
    ],
  });

  await prisma.subscriptionSpecialty.createMany({
    data: [
      { tenantSubscriptionId: subscription.id, specialtyId: catalog.psychology.id },
      { tenantSubscriptionId: subscription.id, specialtyId: catalog.nutrition.id },
      { tenantSubscriptionId: subscription.id, specialtyId: catalog.physiotherapy.id },
      { tenantSubscriptionId: subscription.id, specialtyId: catalog.dentistry.id },
    ],
  });

  await prisma.tenantModule.createMany({
    data: [
      { tenantId: tenant.id, moduleKey: 'core.clinicalNotes' },
      { tenantId: tenant.id, moduleKey: 'core.tasks' },
      { tenantId: tenant.id, moduleKey: 'core.team' },
      { tenantId: tenant.id, moduleKey: 'psychology.session-notes' },
      { tenantId: tenant.id, moduleKey: 'psychology.assessments' },
      { tenantId: tenant.id, moduleKey: 'nutrition.assessments' },
      { tenantId: tenant.id, moduleKey: 'nutrition.diet-plans' },
      { tenantId: tenant.id, moduleKey: 'physiotherapy.evolution' },
      { tenantId: tenant.id, moduleKey: 'physiotherapy.exercise-plans' },
      { tenantId: tenant.id, moduleKey: 'dentistry.treatments' },
      { tenantId: tenant.id, moduleKey: 'dentistry.odontogram' },
    ],
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin.demo@psic.com',
      password: hashedPassword,
      firstName: 'Daniela',
      lastName: 'Mendoza',
      phone: '+593999000010',
      role: adminDefinition.role,
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-45),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Daniela%20Mendoza',
      professionalTitle: 'Odontóloga y administradora',
      professionalProfile: {
        create: {
          specialtyId: catalog[adminDefinition.specialtyKey].id,
          professionalTitle: 'Odontóloga y administradora',
          isActive: true,
        },
      },
      professionalSpecialties: {
        create: {
          specialtyId: catalog[adminDefinition.specialtyKey].id,
          isPrimary: true,
        },
      },
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
      role: psychologyDefinition.role,
      managedByProvider: true,
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-40),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Ana%20Vega',
      professionalTitle: 'Psicóloga clínica',
      professionalProfile: {
        create: {
          specialtyId: catalog[psychologyDefinition.specialtyKey].id,
          professionalTitle: 'Psicóloga clínica',
          isActive: true,
        },
      },
      professionalSpecialties: {
        create: { specialtyId: catalog[psychologyDefinition.specialtyKey].id, isPrimary: true },
      },
    },
  });

  const psych2 = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'nutri.luis@psic.com',
      password: hashedPassword,
      firstName: 'Luis',
      lastName: 'Paredes',
      phone: '+593999000012',
      role: nutritionDefinition.role,
      managedByProvider: true,
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-30),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Luis%20Paredes',
      professionalTitle: 'Nutricionista',
      professionalProfile: {
        create: {
          specialtyId: catalog[nutritionDefinition.specialtyKey].id,
          professionalTitle: 'Nutricionista',
          isActive: true,
        },
      },
      professionalSpecialties: {
        create: { specialtyId: catalog[nutritionDefinition.specialtyKey].id, isPrimary: true },
      },
    },
  });

  const physiotherapist = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'fisio.sofia@psic.com',
      password: hashedPassword,
      firstName: 'Sofía',
      lastName: 'Cedeño',
      phone: '+593999000014',
      role: physiotherapyDefinition.role,
      managedByProvider: true,
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-25),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Sofia%20Cedeno',
      professionalTitle: 'Fisioterapeuta',
      professionalProfile: {
        create: {
          specialtyId: catalog[physiotherapyDefinition.specialtyKey].id,
          professionalTitle: 'Fisioterapeuta',
          isActive: true,
        },
      },
      professionalSpecialties: {
        create: {
          specialtyId: catalog[physiotherapyDefinition.specialtyKey].id,
          isPrimary: true,
        },
      },
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
      role: 'ASISTENTE',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-20),
      avatarUrl: 'https://api.dicebear.com/8.x/initials/svg?seed=Mariana%20Rojas',
    },
  });

  const professionalIds: Partial<Record<SeedProfessionalKey, string>> = {
    clinicAdmin: admin.id,
    psychology: psych1.id,
    nutrition: psych2.id,
    physiotherapy: physiotherapist.id,
  };
  const primaryProfessionalId = (patientKey: SeedPatientKey) =>
    resolvePrimaryProfessionalId(DEMO_SEED_TOPOLOGY, patientKey, professionalIds);

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
      assignedPsychologistId: primaryProfessionalId('valeria'),
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
      assignedPsychologistId: primaryProfessionalId('jorge'),
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
      assignedPsychologistId: primaryProfessionalId('camila'),
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
      assignedPsychologistId: primaryProfessionalId('andres'),
    },
  });

  const canonicalRelations = buildCanonicalSeedRelations(
    DEMO_SEED_TOPOLOGY,
    {
      tenants: { clinic: tenant.id },
      professionals: professionalIds,
      patients: {
        valeria: patient1.id,
        jorge: patient2.id,
        camila: patient3.id,
        andres: patient4.id,
      },
      specialties: {
        psychology: catalog.psychology.id,
        nutrition: catalog.nutrition.id,
        physiotherapy: catalog.physiotherapy.id,
        dentistry: catalog.dentistry.id,
      },
      assigners: { clinic: admin.id },
    },
    'clinic',
  );

  await prisma.patientProfessional.createMany({ data: canonicalRelations.memberships });

  const completedAppointment = await prisma.appointment.create({
    data: {
      ...canonicalRelations.appointments['valeria-psychology'],
      title: 'Sesion de seguimiento ansiedad',
      description: 'Revision de avances y ajuste de tecnicas',
      startTime: daysFromNow(-3),
      endTime: new Date(daysFromNow(-3).getTime() + 60 * 60 * 1000),
      duration: 60,
      status: 'COMPLETED',
      location: 'Consultorio 2',
      isOnline: false,
    },
  });

  await prisma.appointment.create({
    data: {
      ...canonicalRelations.appointments['jorge-psychology'],
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
      ...canonicalRelations.appointments['camila-nutrition'],
      title: 'Evaluacion inicial',
      startTime: daysFromNow(2),
      endTime: new Date(daysFromNow(2).getTime() + 60 * 60 * 1000),
      duration: 60,
      status: 'SCHEDULED',
      location: 'Consultorio 1',
      isOnline: false,
    },
  });

  await prisma.appointment.create({
    data: {
      ...canonicalRelations.appointments['andres-dentistry'],
      title: 'Control odontológico cancelado',
      startTime: daysFromNow(-1),
      endTime: new Date(daysFromNow(-1).getTime() + 60 * 60 * 1000),
      duration: 60,
      status: 'CANCELLED',
      cancellationReason: 'Paciente reprogramo por viaje',
      cancelledAt: daysFromNow(-1),
      cancelledBy: assistant.id,
      location: 'Consultorio 3',
      isOnline: false,
    },
  });

  await prisma.appointment.create({
    data: {
      ...canonicalRelations.appointments['valeria-nutrition'],
      title: 'Valoración nutricional',
      description: 'Evaluación de hábitos y objetivos alimenticios',
      startTime: daysFromNow(3),
      endTime: new Date(daysFromNow(3).getTime() + 45 * 60 * 1000),
      duration: 45,
      status: 'SCHEDULED',
      location: 'Consultorio 1',
      isOnline: false,
    },
  });

  await prisma.appointment.create({
    data: {
      ...canonicalRelations.appointments['camila-physiotherapy'],
      title: 'Evaluación funcional',
      startTime: daysFromNow(4),
      endTime: new Date(daysFromNow(4).getTime() + 60 * 60 * 1000),
      duration: 60,
      status: 'CONFIRMED',
      location: 'Sala de rehabilitación',
      isOnline: false,
    },
  });

  await prisma.clinicalNote.create({
    data: {
      tenantId: tenant.id,
      patientId: patient1.id,
      psychologistId: psych1.id,
      specialtyId: catalog.psychology.id,
      appointmentId: completedAppointment.id,
      content:
        'Paciente muestra menor evitacion social. Se reforzaron tecnicas de respiracion y registro de pensamientos automaticos.',
      diagnosis: 'Trastorno de ansiedad social',
      treatment: 'Terapia cognitivo conductual con exposicion gradual.',
      observations: 'Mantener frecuencia semanal por 4 sesiones adicionales.',
      sessionDate: daysFromNow(-3),
      sessionDuration: 60,
    },
  });

  await prisma.specialtyRecord.createMany({
    data: [
      {
        tenantId: tenant.id,
        patientId: patient1.id,
        professionalId: psych1.id,
        specialtyId: catalog.psychology.id,
        moduleKey: 'psychology.assessments',
        data: {
          testName: 'PHQ-9',
          score: 8,
          interpretation: 'Síntomas depresivos leves; continuar seguimiento.',
        },
        notes: 'Repetir evaluación en cuatro semanas.',
        recordDate: daysFromNow(-3),
      },
      {
        tenantId: tenant.id,
        patientId: patient3.id,
        professionalId: psych2.id,
        specialtyId: catalog.nutrition.id,
        moduleKey: 'nutrition.assessments',
        data: {
          weightKg: 68,
          heightCm: 165,
          bmi: 25,
          dietaryGoals: 'Mejorar composición corporal.',
        },
        notes: 'Control nutricional mensual.',
      },
      {
        tenantId: tenant.id,
        patientId: patient4.id,
        professionalId: physiotherapist.id,
        specialtyId: catalog.physiotherapy.id,
        moduleKey: 'physiotherapy.evolution',
        data: {
          painLevel: 4,
          mobility: 'Flexión de rodilla limitada',
          progress: 'Mejora funcional moderada.',
        },
        notes: 'Continuar ejercicios de movilidad.',
      },
      {
        tenantId: tenant.id,
        patientId: patient4.id,
        professionalId: admin.id,
        specialtyId: catalog.dentistry.id,
        moduleKey: 'dentistry.treatments',
        data: {
          procedure: 'Profilaxis y valoración preventiva',
          tooth: 'General',
          result: 'Sin hallazgos urgentes',
        },
        notes: 'Programar control semestral.',
      },
    ],
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
        assignedToId: physiotherapist.id,
        title: 'Actualizar plan de rehabilitación',
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
      specialtyId: catalog.psychology.id,
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
        newPlan: 'CLINIC_BASIC',
        newStatus: 'ACTIVE',
        reason: 'Fin de trial y activacion inicial',
        createdAt: daysFromNow(-31),
      },
      {
        tenantId: tenant.id,
        eventType: 'PLAN_UPGRADED',
        previousPlan: 'CLINIC_BASIC',
        newPlan: 'CLINIC_PRO',
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
        seatsPsychologistsUsed: 4,
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
        seatsPsychologistsUsed: 4,
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
      physiotherapist,
      assistant,
    },
  };
}

async function seedSecondaryTenant(hashedPassword: string, catalog: SpecialtyCatalog) {
  const professionalDefinition = DEMO_SEED_TOPOLOGY.professionals.find(
    (professional) => professional.key === 'personalPsychology',
  )!;
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Consultorio Personal',
      email: 'contacto@demopersonal.com',
      phone: '+593999200001',
      tenantType: 'PERSONAL',
      legalName: 'Demo Consultorio Personal',
      taxIdentificationType: 'RUC',
      taxIdentificationNumber: '1790012345002',
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

  const subscription = await prisma.tenantSubscription.create({
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
      includedSpecialties: 1,
      specialtyPrice: 15,
      monthlyElectronicInvoicesLimit: 50,
      featureClinicalNotes: true,
      featureAttachments: false,
      featureTasks: false,
      activePatientsCount: 1,
      storageUsedBytes: BigInt(50 * 1024 * 1024),
      monthlyNotificationsSent: 8,
      lastNotificationReset: daysFromNow(-4),
      scheduledPlanChange: 'PERSONAL_BASIC',
      scheduledPlanChangeAt: daysFromNow(10),
    },
  });

  await prisma.billingSettings.create({
    data: {
      tenantId: tenant.id,
      provider: 'FAKTUR',
      apiUrl: 'https://api.faktur.ec',
      invoicePath: '/invoices',
      environment: 'TEST',
      establishment: '001',
      emissionPoint: '001',
      nextSequential: 1,
      businessName: 'Demo Consultorio Personal',
      isEnabled: false,
    },
  });

  await prisma.tenantSpecialty.create({
    data: { tenantId: tenant.id, specialtyId: catalog.psychology.id },
  });
  await prisma.subscriptionSpecialty.create({
    data: { tenantSubscriptionId: subscription.id, specialtyId: catalog.psychology.id },
  });
  await prisma.tenantModule.createMany({
    data: [
      { tenantId: tenant.id, moduleKey: 'core.clinicalNotes' },
      { tenantId: tenant.id, moduleKey: 'psychology.session-notes' },
    ],
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin.trial@psic.com',
      password: hashedPassword,
      firstName: 'Carla',
      lastName: 'Noboa',
      role: 'ADMIN',
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
      role: professionalDefinition.role,
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-4),
      professionalTitle: 'Psicólogo clínico',
      professionalProfile: {
        create: {
          specialtyId: catalog[professionalDefinition.specialtyKey].id,
          professionalTitle: 'Psicólogo clínico',
          isActive: true,
        },
      },
      professionalSpecialties: {
        create: {
          specialtyId: catalog[professionalDefinition.specialtyKey].id,
          isPrimary: true,
        },
      },
    },
  });

  const professionalIds: Partial<Record<SeedProfessionalKey, string>> = {
    personalPsychology: psych.id,
  };
  const patient = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Priscila',
      lastName: 'Viteri',
      email: 'priscila.viteri@email.com',
      phone: '+593999200010',
      assignedPsychologistId: resolvePrimaryProfessionalId(
        DEMO_SEED_TOPOLOGY,
        'priscila',
        professionalIds,
      ),
    },
  });

  const canonicalRelations = buildCanonicalSeedRelations(
    DEMO_SEED_TOPOLOGY,
    {
      tenants: { personal: tenant.id },
      professionals: professionalIds,
      patients: { priscila: patient.id },
      specialties: { psychology: catalog.psychology.id },
      assigners: { personal: admin.id },
    },
    'personal',
  );
  await prisma.patientProfessional.createMany({ data: canonicalRelations.memberships });

  return { tenant, admin, psych, patient };
}

async function seedOwnerTenant(hashedPassword: string) {
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Proveedor del Sistema',
      email: 'admin@psic.com',
      phone: '+593999000000',
      legalName: 'Proveedor del Sistema S.A.',
      taxIdentificationType: 'RUC',
      taxIdentificationNumber: '1790012345003',
      tenantType: 'CLINIC',
      isActive: true,
      onboardingCompleted: true,
    },
  });

  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant.id,
      workingHoursStart: '08:00',
      workingHoursEnd: '18:00',
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      defaultAppointmentDuration: 60,
      reminderEnabled: false,
      timezone: 'America/Guayaquil',
      locale: 'es-EC',
    },
  });

  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planType: 'CLINIC_ENTERPRISE',
      status: 'ACTIVE',
      startDate: daysFromNow(-90),
      currentPeriodStart: daysFromNow(-5),
      currentPeriodEnd: daysFromNow(25),
      basePrice: 0,
      pricePerSeat: 0,
      currency: 'USD',
      seatsPsychologistsMax: 9999,
      seatsPsychologistsUsed: 0,
      maxActivePatients: 99999,
      storageGB: 100,
      monthlyNotificationsLimit: 99999,
      includedSpecialties: 999,
      specialtyPrice: 15,
      monthlyElectronicInvoicesLimit: 50,
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
      featureWhatsAppIntegration: true,
      featureSSO: true,
      activePatientsCount: 0,
      storageUsedBytes: BigInt(0),
      monthlyNotificationsSent: 0,
      lastNotificationReset: daysFromNow(-5),
    },
  });

  await prisma.billingSettings.create({
    data: {
      tenantId: tenant.id,
      provider: 'FAKTUR',
      apiUrl: 'https://api.faktur.ec',
      invoicePath: '/invoices',
      environment: 'TEST',
      establishment: '001',
      emissionPoint: '001',
      nextSequential: 1,
      businessName: 'Proveedor del Sistema S.A.',
      isEnabled: false,
    },
  });

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'owner@psic.com',
      password: hashedPassword,
      firstName: 'Sistema',
      lastName: 'Proveedor',
      role: 'SOPORTE',
      isActive: true,
      emailVerified: true,
      activatedAt: daysFromNow(-90),
    },
  });

  return { tenant, owner };
}

async function main() {
  console.log('🌱 Starting deterministic demo seed...');
  assertSeedTopology(DEMO_SEED_TOPOLOGY);
  await clearDatabase();

  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
  const specialtyCatalog = await seedSpecialtyCatalog();
  const ownerTenant = await seedOwnerTenant(hashedPassword);
  const mainTenant = await seedMainTenant(hashedPassword, specialtyCatalog);
  const personalTenant = await seedSecondaryTenant(hashedPassword, specialtyCatalog);

  console.log('✅ Seed completed successfully.');
  console.log('');
  console.log('Login credentials (all users):');
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log('');
  console.log(`Owner tenant: ${ownerTenant.tenant.name}`);
  console.log('  owner@psic.com (SOPORTE)');
  console.log('');
  console.log(`Clinic tenant: ${mainTenant.tenant.name}`);
  console.log('  admin.demo@psic.com (ADMIN / Odontología)');
  console.log('  psic.ana@psic.com (PROFESIONAL / Psicología)');
  console.log('  nutri.luis@psic.com (PROFESIONAL / Nutrición)');
  console.log('  fisio.sofia@psic.com (PROFESIONAL / Fisioterapia)');
  console.log('  asistente.demo@psic.com (ASISTENTE)');
  console.log('');
  console.log(`Personal tenant: ${personalTenant.tenant.name}`);
  console.log('  admin.trial@psic.com (ADMIN)');
  console.log('  psic.trial@psic.com (PROFESIONAL / Psicología)');
}

main()
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
