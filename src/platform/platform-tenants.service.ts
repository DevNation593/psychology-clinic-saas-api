import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlanType, Prisma, SubscriptionStatus, TenantType, UserRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import {
  SECTION_CATALOG,
  SectionDefinition,
  SectionKey,
  defaultSections,
  isPlanAllowedForTenantType,
  validateSections,
} from '../common/sections/section-catalog';
import { PrismaService } from '../prisma/prisma.service';
import {
  SpecialtyCatalogService,
  normalizeSpecialtyCodes,
} from '../specialties/specialty-catalog.service';
import { TenantSpecialtiesService } from '../specialties/tenant-specialties.service';
import { getPlanFeatureFlags, getPlanLimits } from '../subscription/subscription-pricing';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';

export interface PlatformTenantDetail {
  tenant: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    tenantType: TenantType;
    isActive: boolean;
    createdAt: Date;
  };
  master: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    mustChangePassword: boolean;
  } | null;
  subscription: {
    planType: PlanType;
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    currentPeriodStart: Date;
    currentPeriodEnd: Date | null;
    seatsPsychologistsMax: number;
    maxActivePatients: number;
    basePrice: number;
    currency: string;
  };
  usage: {
    seatsPsychologistsUsed: number;
    activePatientsCount: number;
    monthlyNotificationsSent: number;
  };
  specialties: { id: string; code: string; name: string }[];
  sections: { key: SectionKey; name: string; enabled: boolean }[];
}

const TRIAL_DAYS = 14;
const TRIAL_LIMITS: Record<TenantType, { seats: number; patients: number }> = {
  CLINIC: { seats: 3, patients: 20 },
  PERSONAL: { seats: 1, patients: 10 },
};

@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly catalog: SpecialtyCatalogService,
    private readonly tenantSpecialties: TenantSpecialtiesService,
  ) {}

  async create(dto: CreatePlatformTenantDto, actorId: string): Promise<PlatformTenantDetail> {
    const specialtyCodes = normalizeSpecialtyCodes(dto.specialtyCodes);
    if (specialtyCodes.length === 0) {
      throw new BadRequestException({
        code: 'SPECIALTY_SELECTION_REQUIRED',
        message: 'Selecciona al menos una especialidad.',
      });
    }
    if (specialtyCodes.length !== dto.specialtyCodes.length) {
      throw new BadRequestException({
        code: 'SPECIALTY_SELECTION_DUPLICATE',
        message: 'Cada especialidad debe aparecer una sola vez.',
      });
    }
    if (!isPlanAllowedForTenantType(dto.planType, dto.tenantType)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PLAN_TYPE_MISMATCH',
        message: 'El plan no corresponde al tipo de consultorio.',
      });
    }
    const enabledSections = new Set<string>(
      dto.sections ? validateSections(dto.sections) : defaultSections(dto.planType, dto.tenantType),
    );

    const masterEmail = dto.masterEmail.trim().toLowerCase();
    const password = await this.auth.hashPassword(dto.temporaryPassword);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // User.email is unique per tenant only. Serialize creations for the same normalized
            // email before checking it globally (this also covers platform ADMIN accounts).
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${masterEmail}))`;
            const existing = await tx.user.findFirst({
              where: { email: { equals: masterEmail, mode: 'insensitive' } },
              select: { id: true },
            });
            if (existing) throw new ConflictException('El correo electrónico ya está en uso');

            const tenant = await tx.tenant.create({
              data: {
                name: dto.name.trim(),
                email: dto.email.trim().toLowerCase(),
                phone: dto.phone?.trim(),
                address: dto.address?.trim(),
                tenantType: dto.tenantType,
                onboardingCompleted: true,
              },
              select: { id: true },
            });
            await this.prisma.applyRlsContext(tx, { tenantId: tenant.id });
            await tx.tenantSettings.create({
              data: {
                tenantId: tenant.id,
                timezone: dto.timezone.trim(),
                locale: dto.locale.trim(),
              },
            });

            const limits = getPlanLimits(dto.planType);
            const isTrial = dto.planType === PlanType.TRIAL;
            const now = new Date();
            const periodEnd = new Date(now);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            const subscription = await tx.tenantSubscription.create({
              data: {
                tenantId: tenant.id,
                planType: dto.planType,
                status: isTrial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
                trialEndsAt: isTrial
                  ? new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
                  : null,
                currentPeriodStart: now,
                currentPeriodEnd: isTrial ? null : periodEnd,
                basePrice: limits.basePrice,
                pricePerSeat: limits.pricePerSeat,
                seatsPsychologistsMax: isTrial
                  ? TRIAL_LIMITS[dto.tenantType].seats
                  : limits.seatsIncluded,
                seatsPsychologistsUsed: 0,
                maxActivePatients: isTrial
                  ? TRIAL_LIMITS[dto.tenantType].patients
                  : limits.maxActivePatients,
                storageGB: limits.storageGB,
                monthlyNotificationsLimit: limits.monthlyNotificationsLimit,
                includedSpecialties: limits.includedSpecialties,
                specialtyPrice: limits.specialtyPrice,
                monthlyElectronicInvoicesLimit: limits.monthlyElectronicInvoicesLimit,
                ...getPlanFeatureFlags(dto.planType),
              },
            });
            if (!isTrial) {
              await tx.subscriptionEvent.create({
                data: {
                  tenantId: tenant.id,
                  eventType: 'SUBSCRIPTION_ACTIVATED',
                  newPlan: dto.planType,
                  newStatus: SubscriptionStatus.ACTIVE,
                  triggeredByUserId: actorId,
                },
              });
            }
            await tx.tenantModule.createMany({
              data: SECTION_CATALOG.map(({ key }) => ({
                tenantId: tenant.id,
                moduleKey: key,
                enabled: enabledSections.has(key),
              })),
            });

            const specialties = await this.catalog.resolveActiveCodes(specialtyCodes, tx);
            await tx.user.create({
              data: {
                tenantId: tenant.id,
                email: masterEmail,
                password,
                firstName: dto.masterFirstName.trim(),
                lastName: dto.masterLastName.trim(),
                role: UserRole.MASTER,
                isActive: true,
                emailVerified: true,
                activatedAt: new Date(),
                mustChangePassword: true,
                managedByProvider: false,
              },
              select: { id: true },
            });
            await this.tenantSpecialties.applySelection(tx, {
              tenantId: tenant.id,
              subscription,
              specialties,
            });
            return this.loadDetail(tx, tenant.id);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if ((error as { code?: string }).code === 'P2034' && attempt < 2) continue;
        if ((error as { code?: string }).code === 'P2002') {
          const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
          const fields = Array.isArray(target) ? target : [target];
          if (fields.some((field) => field?.toLowerCase().includes('email'))) {
            throw new ConflictException('El correo electrónico ya está en uso');
          }
          if (fields.some((field) => field?.toLowerCase().includes('slug'))) {
            throw new ConflictException('El identificador del consultorio ya está en uso');
          }
        }
        throw error;
      }
    }
  }

  findOne(tenantId: string): Promise<PlatformTenantDetail> {
    return this.loadDetail(this.prisma, tenantId);
  }

  getSectionCatalog(): {
    sections: SectionDefinition[];
    defaults: { planType: PlanType; tenantType: TenantType; sections: SectionKey[] }[];
  } {
    const defaults: { planType: PlanType; tenantType: TenantType; sections: SectionKey[] }[] = [];
    for (const planType of Object.values(PlanType)) {
      for (const tenantType of Object.values(TenantType)) {
        if (isPlanAllowedForTenantType(planType, tenantType)) {
          defaults.push({ planType, tenantType, sections: defaultSections(planType, tenantType) });
        }
      }
    }
    return { sections: SECTION_CATALOG.map((section) => ({ ...section })), defaults };
  }

  private async loadDetail(
    client: Pick<Prisma.TransactionClient, 'tenant'>,
    tenantId: string,
  ): Promise<PlatformTenantDetail> {
    const row = await client.tenant.findFirst({
      where: { id: tenantId, isPlatform: false },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        tenantType: true,
        isActive: true,
        createdAt: true,
        subscription: {
          select: {
            planType: true,
            status: true,
            trialEndsAt: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            seatsPsychologistsMax: true,
            seatsPsychologistsUsed: true,
            maxActivePatients: true,
            activePatientsCount: true,
            monthlyNotificationsSent: true,
            basePrice: true,
            currency: true,
          },
        },
        users: {
          where: { role: UserRole.MASTER },
          take: 1,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            mustChangePassword: true,
          },
        },
        specialties: {
          select: { specialty: { select: { id: true, code: true, name: true } } },
        },
        enabledModules: {
          where: { moduleKey: { startsWith: 'core.' } },
          select: { moduleKey: true, enabled: true },
        },
      },
    });
    if (!row || !row.subscription) throw new NotFoundException('Consultorio no encontrado');

    const { subscription } = row;
    const enabledByKey = new Map(row.enabledModules.map((m) => [m.moduleKey, m.enabled]));
    return {
      tenant: {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        tenantType: row.tenantType,
        isActive: row.isActive,
        createdAt: row.createdAt,
      },
      master: row.users[0] ?? null,
      subscription: {
        planType: subscription.planType,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        seatsPsychologistsMax: subscription.seatsPsychologistsMax,
        maxActivePatients: subscription.maxActivePatients,
        basePrice: Number(subscription.basePrice),
        currency: subscription.currency,
      },
      usage: {
        seatsPsychologistsUsed: subscription.seatsPsychologistsUsed,
        activePatientsCount: subscription.activePatientsCount,
        monthlyNotificationsSent: subscription.monthlyNotificationsSent,
      },
      specialties: row.specialties.map(({ specialty }) => specialty),
      sections: SECTION_CATALOG.map(({ key, name }) => ({
        key,
        name,
        enabled: enabledByKey.get(key) === true,
      })),
    };
  }
}
