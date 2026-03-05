import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType, SubscriptionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

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
      // Psychologists (seats used)
      this.prisma.user.count({
        where: {
          tenantId,
          role: 'PSYCHOLOGIST',
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
    const planHierarchy: PlanType[] = ['TRIAL', 'BASIC', 'PRO', 'CUSTOM'];
    const currentIndex = planHierarchy.indexOf(subscription.planType);
    const newIndex = planHierarchy.indexOf(newPlan);

    if (newIndex <= currentIndex) {
      throw new BadRequestException('Esto no es una mejora. Use downgradePlan para degradaciones.');
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
    const planHierarchy: PlanType[] = ['TRIAL', 'BASIC', 'PRO', 'CUSTOM'];
    const currentIndex = planHierarchy.indexOf(subscription.planType);
    const newIndex = planHierarchy.indexOf(newPlan);

    if (newIndex >= currentIndex) {
      throw new BadRequestException('Esto no es una degradación. Use upgradePlan para mejoras.');
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
      where: { tenantId, role: 'PSYCHOLOGIST', isActive: true },
    });

    if (psychologistsCount > newPlanLimits.seatsIncluded) {
      errors.push(
        `Tiene ${psychologistsCount} psicólogos activos. El nuevo plan solo permite ${newPlanLimits.seatsIncluded}. Por favor desactive ${psychologistsCount - newPlanLimits.seatsIncluded} psicólogo(s).`,
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
        basePrice: new Decimal(0),
        pricePerSeat: new Decimal(0),
        seatsIncluded: 1,
        maxActivePatients: 10,
        storageGB: 0,
        monthlyNotificationsLimit: 100,
      },
      BASIC: {
        planType: 'BASIC' as PlanType,
        basePrice: new Decimal(49),
        pricePerSeat: new Decimal(15),
        seatsIncluded: 3,
        maxActivePatients: 100,
        storageGB: 0,
        monthlyNotificationsLimit: 500,
      },
      PRO: {
        planType: 'PRO' as PlanType,
        basePrice: new Decimal(149),
        pricePerSeat: new Decimal(12),
        seatsIncluded: 10,
        maxActivePatients: 500,
        storageGB: 1,
        monthlyNotificationsLimit: 2000,
      },
      CUSTOM: {
        planType: 'CUSTOM' as PlanType,
        basePrice: new Decimal(0),
        pricePerSeat: new Decimal(0),
        seatsIncluded: 999,
        maxActivePatients: 999999,
        storageGB: 100,
        monthlyNotificationsLimit: 999999,
      },
    };

    return plans[planType];
  }

  private getPlanFeatures(planType: PlanType) {
    const features = {
      TRIAL: {
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
      },
      BASIC: {
        featureClinicalNotes: true,
        featureClinicalNotesEncryption: false,
        featureAttachments: true,
        featureTasks: true,
        featurePsychologicalTests: false,
        featureWebPush: false,
        featureFCMPush: true,
        featureAdvancedAnalytics: false,
        featureVideoConsultation: false,
        featureCalendarSync: false,
        featureOnlineSchedulingWidget: true,
        featureCustomReports: false,
        featureAPIAccess: false,
        featureWhatsAppIntegration: false,
        featureSSO: false,
      },
      PRO: {
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
      },
      CUSTOM: {
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
      },
    };

    return features[planType];
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
