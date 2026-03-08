import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType, SubscriptionStatus, TenantType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ModuleName } from './dto/customize-features.dto';

// Pricing per module (USD/month)
const MODULE_PRICING: Record<ModuleName, number> = {
  clinicalNotes: 0,         // included in all plans
  clinicalNotesEncryption: 5,
  attachments: 3,
  tasks: 3,
  psychologicalTests: 8,
  webPush: 2,
  fcmPush: 2,
  advancedAnalytics: 10,
  videoConsultation: 12,
  calendarSync: 4,
  onlineSchedulingWidget: 5,
  customReports: 8,
  apiAccess: 15,
  whatsAppIntegration: 10,
  sso: 20,
};

// Modules included free in each plan (no extra charge)
const PLAN_INCLUDED_MODULES: Record<string, ModuleName[]> = {
  TRIAL: ['clinicalNotes'],
  PERSONAL_BASIC: ['clinicalNotes', 'attachments', 'tasks', 'fcmPush', 'onlineSchedulingWidget'],
  PERSONAL_PRO: [
    'clinicalNotes', 'clinicalNotesEncryption', 'attachments', 'tasks',
    'psychologicalTests', 'webPush', 'fcmPush', 'advancedAnalytics',
    'videoConsultation', 'calendarSync', 'onlineSchedulingWidget', 'customReports',
  ],
  CLINIC_BASIC: ['clinicalNotes', 'attachments', 'tasks', 'fcmPush', 'onlineSchedulingWidget'],
  CLINIC_PRO: [
    'clinicalNotes', 'clinicalNotesEncryption', 'attachments', 'tasks',
    'psychologicalTests', 'webPush', 'fcmPush', 'advancedAnalytics',
    'videoConsultation', 'calendarSync', 'onlineSchedulingWidget', 'customReports', 'apiAccess',
  ],
  CLINIC_ENTERPRISE: [
    'clinicalNotes', 'clinicalNotesEncryption', 'attachments', 'tasks',
    'psychologicalTests', 'webPush', 'fcmPush', 'advancedAnalytics',
    'videoConsultation', 'calendarSync', 'onlineSchedulingWidget', 'customReports',
    'apiAccess', 'whatsAppIntegration', 'sso',
  ],
};

// All available module names matching DB column pattern
const ALL_MODULES: ModuleName[] = [
  'clinicalNotes', 'clinicalNotesEncryption', 'attachments', 'tasks',
  'psychologicalTests', 'webPush', 'fcmPush', 'advancedAnalytics',
  'videoConsultation', 'calendarSync', 'onlineSchedulingWidget', 'customReports',
  'apiAccess', 'whatsAppIntegration', 'sso',
];

function moduleToDbKey(mod: ModuleName): string {
  return `feature${mod.charAt(0).toUpperCase()}${mod.slice(1)}`;
}

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}

  // ========================================
  // GET CURRENT SUBSCRIPTION
  // ========================================
  async getCurrentSubscription(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: {
        tenant: {
          select: {
            name: true,
            slug: true,
            email: true,
          },
        },
      },
    });

    if (!subscription) {
      throw new BadRequestException('No se encontró suscripción para este tenant');
    }

    // Calculate remaining trial days
    const trialDaysRemaining = subscription.trialEndsAt
      ? Math.max(
          0,
          Math.ceil((subscription.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        )
      : 0;

    // Calculate billing cycle days
    const billingCycleDaysRemaining = subscription.currentPeriodEnd
      ? Math.max(
          0,
          Math.ceil((subscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        )
      : 0;

    return {
      subscription: {
        id: subscription.id,
        planType: subscription.planType,
        status: subscription.status,
        basePrice: subscription.basePrice,
        pricePerSeat: subscription.pricePerSeat,
        currency: subscription.currency,

        // Dates
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        trialEndsAt: subscription.trialEndsAt,
        trialDaysRemaining,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        billingCycleDaysRemaining,

        // Seats
        seatsPsychologistsMax: subscription.seatsPsychologistsMax,
        seatsPsychologistsUsed: subscription.seatsPsychologistsUsed,
        seatsAvailable: subscription.seatsPsychologistsMax - subscription.seatsPsychologistsUsed,

        // Limits
        limits: {
          maxActivePatients: subscription.maxActivePatients,
          storageGB: subscription.storageGB,
          monthlyNotifications: subscription.monthlyNotificationsLimit,
        },

        // Features
        features: this.extractFeatures(subscription),

        // Scheduled changes
        scheduledChange: subscription.scheduledPlanChange
          ? {
              newPlan: subscription.scheduledPlanChange,
              effectiveDate: subscription.scheduledPlanChangeAt,
            }
          : null,
      },
      tenant: subscription.tenant,
    };
  }

  // ========================================
  // GET USAGE METRICS
  // ========================================
  async getUsageMetrics(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new BadRequestException('Suscripción no encontrada');
    }

    // Get real-time counts
    const [
      psychologistsCount,
      activePatientsCount,
      notificationsThisMonth,
      appointmentsThisMonth,
      clinicalNotesTotal,
    ] = await Promise.all([
      // Users (seats used)
      this.prisma.user.count({
        where: {
          tenantId,
          role: 'PSICOLOGO',
          isActive: true,
        },
      }),

      // Active patients
      this.prisma.patient.count({
        where: {
          tenantId,
          deletedAt: null,
        },
      }),

      // Notifications sent this month
      this.prisma.notificationLog.count({
        where: {
          tenantId,
          createdAt: {
            gte: this.getStartOfMonth(),
          },
        },
      }),

      // Appointments created this month
      this.prisma.appointment.count({
        where: {
          tenantId,
          createdAt: {
            gte: this.getStartOfMonth(),
          },
        },
      }),

      // Total clinical notes
      this.prisma.clinicalNote.count({
        where: { tenantId },
      }),
    ]);

    const storageUsedGB = Number(subscription.storageUsedBytes) / (1024 * 1024 * 1024);

    return {
      period: {
        start: subscription.currentPeriodStart,
        end: subscription.currentPeriodEnd,
      },

      usage: {
        // Seats
        seats: {
          used: psychologistsCount,
          limit: subscription.seatsPsychologistsMax,
          percentage: (psychologistsCount / subscription.seatsPsychologistsMax) * 100,
          available: subscription.seatsPsychologistsMax - psychologistsCount,
        },

        // Patients
        patients: {
          active: activePatientsCount,
          limit: subscription.maxActivePatients,
          percentage: (activePatientsCount / subscription.maxActivePatients) * 100,
          available: subscription.maxActivePatients - activePatientsCount,
        },

        // Storage
        storage: {
          usedGB: parseFloat(storageUsedGB.toFixed(2)),
          limitGB: subscription.storageGB,
          percentage:
            subscription.storageGB > 0 ? (storageUsedGB / subscription.storageGB) * 100 : 0,
          availableGB:
            subscription.storageGB > 0
              ? parseFloat((subscription.storageGB - storageUsedGB).toFixed(2))
              : 0,
        },

        // Notifications
        notifications: {
          sentThisMonth: notificationsThisMonth,
          limit: subscription.monthlyNotificationsLimit,
          percentage: (notificationsThisMonth / subscription.monthlyNotificationsLimit) * 100,
          available: subscription.monthlyNotificationsLimit - notificationsThisMonth,
          resetDate: this.getStartOfNextMonth(),
        },
      },

      activity: {
        appointmentsThisMonth,
        totalClinicalNotes: clinicalNotesTotal,
      },

      // Warnings
      warnings: this.generateUsageWarnings({
        psychologistsCount,
        seatsPsychologistsMax: subscription.seatsPsychologistsMax,
        activePatientsCount,
        maxActivePatients: subscription.maxActivePatients,
        storageUsedGB,
        storageGB: subscription.storageGB,
        notificationsThisMonth,
        monthlyNotificationsLimit: subscription.monthlyNotificationsLimit,
      }),
    };
  }

  // ========================================
  // UPGRADE PLAN
  // ========================================
  async upgradePlan(tenantId: string, userId: string, newPlan: PlanType) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new BadRequestException('Suscripción no encontrada');
    }

    // Validate upgrade path
    const planHierarchy: PlanType[] = [
      'TRIAL',
      'PERSONAL_BASIC',
      'PERSONAL_PRO',
      'CLINIC_BASIC',
      'CLINIC_PRO',
      'CLINIC_ENTERPRISE',
    ];
    const currentIndex = planHierarchy.indexOf(subscription.planType);
    const newIndex = planHierarchy.indexOf(newPlan);

    if (newIndex <= currentIndex) {
      throw new BadRequestException('Esto no es una mejora. Use downgradePlan para degradaciones.');
    }

    // Validate tenant type compatibility
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const isPersonalPlan = newPlan.startsWith('PERSONAL_');
    const isClinicPlan = newPlan.startsWith('CLINIC_');

    if (isPersonalPlan && tenant?.tenantType === 'CLINIC') {
      throw new BadRequestException('No se puede cambiar a un plan personal en una cuenta de clínica.');
    }
    if (isClinicPlan && tenant?.tenantType === 'PERSONAL') {
      // Auto-upgrade tenant type to CLINIC when moving to clinic plan
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { tenantType: 'CLINIC' },
      });
    }

    // Get new plan limits
    const newPlanLimits = this.getPlanLimits(newPlan);

    // Calculate prorated pricing
    const proratedAmount = await this.calculateProratedCharge(
      subscription,
      Number(newPlanLimits.basePrice),
    );

    // Update subscription (immediate effect)
    const updatedSubscription = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId, userId });

      const updated = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          planType: newPlan,
          status: 'ACTIVE',
          basePrice: newPlanLimits.basePrice,
          pricePerSeat: newPlanLimits.pricePerSeat,
          seatsPsychologistsMax: newPlanLimits.seatsIncluded,
          maxActivePatients: newPlanLimits.maxActivePatients,
          storageGB: newPlanLimits.storageGB,
          monthlyNotificationsLimit: newPlanLimits.monthlyNotificationsLimit,

          // Update feature flags
          ...this.getPlanFeatures(newPlan),

          // Clear scheduled changes
          scheduledPlanChange: null,
          scheduledPlanChangeAt: null,
        },
      });

      // Log event
      await tx.subscriptionEvent.create({
        data: {
          tenantId,
          eventType: 'PLAN_UPGRADED',
          previousPlan: subscription.planType,
          newPlan,
          metadata: {
            proratedAmount,
            immediateEffect: true,
          },
          triggeredByUserId: userId,
        },
      });

      return updated;
    });

    return {
      success: true,
      subscription: updatedSubscription,
      billing: {
        proratedCharge: proratedAmount,
        nextBillingDate: updatedSubscription.currentPeriodEnd,
      },
      message: `Actualizado exitosamente a ${newPlan}. Todas las funcionalidades están ahora disponibles.`,
    };
  }

  // ========================================
  // DOWNGRADE PLAN
  // ========================================
  async downgradePlan(tenantId: string, userId: string, newPlan: PlanType) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new BadRequestException('Suscripción no encontrada');
    }

    // Validate downgrade path
    const planHierarchy: PlanType[] = [
      'TRIAL',
      'PERSONAL_BASIC',
      'PERSONAL_PRO',
      'CLINIC_BASIC',
      'CLINIC_PRO',
      'CLINIC_ENTERPRISE',
    ];
    const currentIndex = planHierarchy.indexOf(subscription.planType);
    const newIndex = planHierarchy.indexOf(newPlan);

    if (newIndex >= currentIndex) {
      throw new BadRequestException('Esto no es una degradación. Use upgradePlan para mejoras.');
    }

    // Validate tenant type compatibility
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const isPersonalPlan = newPlan.startsWith('PERSONAL_');

    if (isPersonalPlan && tenant?.tenantType === 'CLINIC') {
      throw new BadRequestException('No se puede degradar a un plan personal en una cuenta de clínica con múltiples psicólogos. Primero desactive los psicólogos adicionales.');
    }

    // Get new plan limits
    const newPlanLimits = this.getPlanLimits(newPlan);

    // Run pre-flight validations
    const validations = await this.validateDowngrade(tenantId, newPlanLimits);

    if (!validations.canDowngrade) {
      throw new ForbiddenException({
        error: 'DOWNGRADE_BLOCKED',
        message: 'No se puede degradar: Por favor resuelva los siguientes problemas primero',
        validations: validations.errors,
      });
    }

    // Schedule downgrade for end of billing period
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId, userId });

      const result = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          scheduledPlanChange: newPlan,
          scheduledPlanChangeAt: subscription.currentPeriodEnd,
        },
      });

      // Log event
      await tx.subscriptionEvent.create({
        data: {
          tenantId,
          eventType: 'PLAN_DOWNGRADED',
          previousPlan: subscription.planType,
          newPlan,
          metadata: {
            effectiveDate: subscription.currentPeriodEnd,
            warnings: validations.warnings,
          },
          triggeredByUserId: userId,
        },
      });

      return result;
    });

    return {
      success: true,
      effectiveDate: subscription.currentPeriodEnd,
      daysUntilChange: subscription.currentPeriodEnd
        ? Math.ceil((subscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0,
      currentPlan: subscription.planType,
      newPlan,
      warnings: validations.warnings,
      message: `Degradación programada para ${subscription.currentPeriodEnd?.toLocaleDateString()}. Puede cancelar este cambio en cualquier momento antes de esa fecha.`,
    };
  }

  // ========================================
  // CHECK FEATURE ACCESS
  // ========================================
  async checkFeatureAccess(tenantId: string, feature: string): Promise<boolean> {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription || (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING')) {
      return false;
    }

    const featureKey =
      `feature${feature.charAt(0).toUpperCase()}${feature.slice(1)}` as keyof typeof subscription;
    return subscription[featureKey] === true;
  }

  // ========================================
  // CHECK USAGE LIMIT
  // ========================================
  // CUSTOMIZE FEATURES (module selection)
  // ========================================
  async customizeFeatures(tenantId: string, userId: string, selectedModules: ModuleName[]) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new BadRequestException('Suscripción no encontrada');
    }

    if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
      throw new ForbiddenException('Solo puede personalizar módulos con una suscripción activa.');
    }

    // clinicalNotes is always required
    if (!selectedModules.includes('clinicalNotes')) {
      selectedModules = ['clinicalNotes', ...selectedModules];
    }

    const planKey = this.resolvePlanKey(subscription.planType);
    const includedModules = PLAN_INCLUDED_MODULES[planKey] || [];

    // Calculate addon cost (only for modules not included in the plan)
    let addonsCost = 0;
    const addonsDetail: { module: string; price: number }[] = [];
    for (const mod of selectedModules) {
      if (!includedModules.includes(mod)) {
        const price = MODULE_PRICING[mod];
        addonsCost += price;
        addonsDetail.push({ module: mod, price });
      }
    }

    // Build feature flags update object
    const featureFlags: Record<string, boolean> = {};
    for (const mod of ALL_MODULES) {
      featureFlags[moduleToDbKey(mod)] = selectedModules.includes(mod);
    }

    const basePlanLimits = this.getPlanLimits(subscription.planType);
    const newTotalPrice = Number(basePlanLimits.basePrice) + addonsCost;

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId, userId });

      const result = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          ...featureFlags,
          basePrice: new Decimal(newTotalPrice),
        },
      });

      await tx.subscriptionEvent.create({
        data: {
          tenantId,
          eventType: 'FEATURE_ENABLED',
          previousPlan: subscription.planType,
          newPlan: subscription.planType,
          metadata: {
            selectedModules,
            addons: addonsDetail,
            addonsCost,
            totalPrice: newTotalPrice,
          },
          triggeredByUserId: userId,
        },
      });

      return result;
    });

    return {
      success: true,
      plan: subscription.planType,
      selectedModules,
      includedInPlan: includedModules,
      addons: addonsDetail,
      pricing: {
        basePlanPrice: Number(basePlanLimits.basePrice),
        addonsCost,
        totalMonthly: newTotalPrice,
        currency: subscription.currency,
      },
      features: this.extractFeatures(updated),
    };
  }

  // ========================================
  // GET PLANS CATALOG
  // ========================================
  getAvailablePlans(tenantType?: TenantType) {
    const allPlans = [
      'TRIAL', 'PERSONAL_BASIC', 'PERSONAL_PRO',
      'CLINIC_BASIC', 'CLINIC_PRO', 'CLINIC_ENTERPRISE',
    ] as PlanType[];

    const plans = allPlans
      .filter((p) => {
        if (!tenantType) return true;
        if (tenantType === 'PERSONAL') return p === 'TRIAL' || p.startsWith('PERSONAL_');
        return p === 'TRIAL' || p.startsWith('CLINIC_');
      })
      .map((planType) => {
        const limits = this.getPlanLimits(planType);
        const includedModules = PLAN_INCLUDED_MODULES[planType] || [];
        return {
          planType,
          basePrice: Number(limits.basePrice),
          pricePerSeat: Number(limits.pricePerSeat),
          seatsIncluded: limits.seatsIncluded,
          maxActivePatients: limits.maxActivePatients,
          storageGB: limits.storageGB,
          monthlyNotificationsLimit: limits.monthlyNotificationsLimit,
          includedModules,
          availableAddons: ALL_MODULES
            .filter((m) => !includedModules.includes(m))
            .map((m) => ({ module: m, pricePerMonth: MODULE_PRICING[m] })),
        };
      });

    return { plans, modulePricing: MODULE_PRICING };
  }

  // ========================================
  // CHECK USAGE LIMIT
  // ========================================
  async checkUsageLimit(
    tenantId: string,
    limitType: 'patients' | 'notifications' | 'storage',
    incrementBy: number = 1,
  ): Promise<{ allowed: boolean; reason?: string; current?: number; limit?: number }> {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      return { allowed: false, reason: 'Suscripción no encontrada' };
    }

    switch (limitType) {
      case 'patients':
        const currentPatients = await this.prisma.patient.count({
          where: { tenantId, deletedAt: null },
        });
        if (currentPatients + incrementBy > subscription.maxActivePatients) {
          return {
            allowed: false,
            reason: `Límite de pacientes alcanzado (${subscription.maxActivePatients})`,
            current: currentPatients,
            limit: subscription.maxActivePatients,
          };
        }
        break;

      case 'notifications':
        if (
          subscription.monthlyNotificationsSent + incrementBy >
          subscription.monthlyNotificationsLimit
        ) {
          return {
            allowed: false,
            reason: `Límite de notificaciones mensuales alcanzado (${subscription.monthlyNotificationsLimit})`,
            current: subscription.monthlyNotificationsSent,
            limit: subscription.monthlyNotificationsLimit,
          };
        }
        break;

      case 'storage':
        const storageUsedGB = Number(subscription.storageUsedBytes) / (1024 * 1024 * 1024);
        const incrementGB = incrementBy / (1024 * 1024 * 1024);
        if (storageUsedGB + incrementGB > subscription.storageGB) {
          return {
            allowed: false,
            reason: `Límite de almacenamiento alcanzado (${subscription.storageGB} GB)`,
            current: parseFloat(storageUsedGB.toFixed(2)),
            limit: subscription.storageGB,
          };
        }
        break;
    }

    return { allowed: true };
  }

  // ========================================
  // INCREMENT USAGE
  // ========================================
  async incrementUsage(tenantId: string, metric: 'notifications' | 'storage', amount: number) {
    if (metric === 'notifications') {
      await this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: {
          monthlyNotificationsSent: { increment: amount },
        },
      });
    } else if (metric === 'storage') {
      await this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: {
          storageUsedBytes: { increment: amount },
        },
      });
    }
  }

  // ========================================
  // VALIDATE DOWNGRADE
  // ========================================
  private async validateDowngrade(tenantId: string, newPlanLimits: any) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check seats
    const psychologistsCount = await this.prisma.user.count({
      where: { tenantId, role: 'PSICOLOGO', isActive: true },
    });

    if (psychologistsCount > newPlanLimits.seatsIncluded) {
      errors.push(
        `Tiene ${psychologistsCount} usuarios activos. El nuevo plan solo permite ${newPlanLimits.seatsIncluded}. Por favor desactive ${psychologistsCount - newPlanLimits.seatsIncluded} usuario(s).`,
      );
    }

    // Check patients
    const activePatientsCount = await this.prisma.patient.count({
      where: { tenantId, deletedAt: null },
    });

    if (activePatientsCount > newPlanLimits.maxActivePatients) {
      errors.push(
        `Tiene ${activePatientsCount} pacientes activos. El nuevo plan solo permite ${newPlanLimits.maxActivePatients}.`,
      );
    }

    // Check storage
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (subscription) {
      const storageUsedGB = Number(subscription.storageUsedBytes) / (1024 * 1024 * 1024);

      if (storageUsedGB > newPlanLimits.storageGB) {
        errors.push(
          `Su uso de almacenamiento (${storageUsedGB.toFixed(2)} GB) excede el límite del nuevo plan (${newPlanLimits.storageGB} GB).`,
        );
      }

      // Generate warnings about feature loss
      const newFeatures = this.getPlanFeatures(newPlanLimits.planType);

      if (subscription.featureAdvancedAnalytics && !newFeatures.featureAdvancedAnalytics) {
        warnings.push('Perderá acceso a Analíticas Avanzadas');
      }
      if (subscription.featureVideoConsultation && !newFeatures.featureVideoConsultation) {
        warnings.push('La integración de Video Consulta será deshabilitada');
      }
      if (
        subscription.featureClinicalNotesEncryption &&
        !newFeatures.featureClinicalNotesEncryption
      ) {
        warnings.push(
          'El cifrado de notas clínicas será deshabilitado (las notas existentes permanecen cifradas)',
        );
      }
    }

    return {
      canDowngrade: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  private getPlanLimits(planType: PlanType) {
    const plans = {
      TRIAL: {
        planType: 'TRIAL' as PlanType,
        tenantType: 'PERSONAL' as TenantType,
        basePrice: new Decimal(0),
        pricePerSeat: new Decimal(0),
        seatsIncluded: 1,
        maxActivePatients: 10,
        storageGB: 0,
        monthlyNotificationsLimit: 100,
      },
      PERSONAL_BASIC: {
        planType: 'PERSONAL_BASIC' as PlanType,
        tenantType: 'PERSONAL' as TenantType,
        basePrice: new Decimal(29),
        pricePerSeat: new Decimal(0),
        seatsIncluded: 1,
        maxActivePatients: 50,
        storageGB: 0,
        monthlyNotificationsLimit: 300,
      },
      PERSONAL_PRO: {
        planType: 'PERSONAL_PRO' as PlanType,
        tenantType: 'PERSONAL' as TenantType,
        basePrice: new Decimal(59),
        pricePerSeat: new Decimal(0),
        seatsIncluded: 1,
        maxActivePatients: 200,
        storageGB: 1,
        monthlyNotificationsLimit: 1000,
      },
      CLINIC_BASIC: {
        planType: 'CLINIC_BASIC' as PlanType,
        tenantType: 'CLINIC' as TenantType,
        basePrice: new Decimal(99),
        pricePerSeat: new Decimal(15),
        seatsIncluded: 3,
        maxActivePatients: 150,
        storageGB: 1,
        monthlyNotificationsLimit: 500,
      },
      CLINIC_PRO: {
        planType: 'CLINIC_PRO' as PlanType,
        tenantType: 'CLINIC' as TenantType,
        basePrice: new Decimal(199),
        pricePerSeat: new Decimal(12),
        seatsIncluded: 10,
        maxActivePatients: 500,
        storageGB: 5,
        monthlyNotificationsLimit: 2000,
      },
      CLINIC_ENTERPRISE: {
        planType: 'CLINIC_ENTERPRISE' as PlanType,
        tenantType: 'CLINIC' as TenantType,
        basePrice: new Decimal(0),
        pricePerSeat: new Decimal(0),
        seatsIncluded: 999,
        maxActivePatients: 999999,
        storageGB: 100,
        monthlyNotificationsLimit: 999999,
      },
    };

    const resolvedPlan = this.resolvePlanKey(planType);

    return plans[resolvedPlan as keyof typeof plans];
  }

  private getPlanFeatures(planType: PlanType) {
    const planKey = this.resolvePlanKey(planType);
    const includedModules = PLAN_INCLUDED_MODULES[planKey] || [];

    const features: Record<string, boolean> = {};
    for (const mod of ALL_MODULES) {
      features[moduleToDbKey(mod)] = includedModules.includes(mod);
    }
    return features;
  }

  private resolvePlanKey(planType: PlanType): string {
    const legacyMap: Record<string, PlanType> = {
      BASIC: 'CLINIC_BASIC',
      PRO: 'CLINIC_PRO',
      CUSTOM: 'CLINIC_ENTERPRISE',
    };
    return legacyMap[planType] || planType;
  }

  private extractFeatures(subscription: any) {
    return {
      clinicalNotes: subscription.featureClinicalNotes,
      clinicalNotesEncryption: subscription.featureClinicalNotesEncryption,
      attachments: subscription.featureAttachments,
      tasks: subscription.featureTasks,
      psychologicalTests: subscription.featurePsychologicalTests,
      webPush: subscription.featureWebPush,
      fcmPush: subscription.featureFCMPush,
      advancedAnalytics: subscription.featureAdvancedAnalytics,
      videoConsultation: subscription.featureVideoConsultation,
      calendarSync: subscription.featureCalendarSync,
      onlineSchedulingWidget: subscription.featureOnlineSchedulingWidget,
      customReports: subscription.featureCustomReports,
      apiAccess: subscription.featureAPIAccess,
      whatsAppIntegration: subscription.featureWhatsAppIntegration,
      sso: subscription.featureSSO,
    };
  }

  private generateUsageWarnings(metrics: any) {
    const warnings: string[] = [];

    if (metrics.psychologistsCount / metrics.seatsPsychologistsMax >= 0.8) {
      warnings.push('Se está acercando al límite de asientos para psicólogos');
    }

    if (metrics.activePatientsCount / metrics.maxActivePatients >= 0.9) {
      warnings.push('Se está acercando al límite de pacientes');
    }

    if (metrics.storageGB > 0 && metrics.storageUsedGB / metrics.storageGB >= 0.85) {
      warnings.push('Se está acercando al límite de almacenamiento');
    }

    if (metrics.notificationsThisMonth / metrics.monthlyNotificationsLimit >= 0.9) {
      warnings.push('Se está acercando al límite mensual de notificaciones');
    }

    return warnings;
  }

  private async calculateProratedCharge(
    currentSubscription: any,
    newBasePrice: number,
  ): Promise<number> {
    const now = new Date();
    const periodStart = currentSubscription.currentPeriodStart;
    const periodEnd = currentSubscription.currentPeriodEnd;

    if (!periodEnd) return newBasePrice;

    const totalDays = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24),
    );
    const daysRemaining = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const unusedCredit = (Number(currentSubscription.basePrice) / totalDays) * daysRemaining;
    const newCharge = (newBasePrice / totalDays) * daysRemaining;

    return Math.max(0, newCharge - unusedCredit);
  }

  private getStartOfMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  private getStartOfNextMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
}
