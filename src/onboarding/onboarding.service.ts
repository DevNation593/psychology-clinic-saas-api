import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PlanType, Prisma, TenantType, UserRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SpecialtyCatalogService,
  normalizeSpecialtyCodes,
} from '../specialties/specialty-catalog.service';
import { TenantSpecialtiesService } from '../specialties/tenant-specialties.service';
import { getPlanFeatureFlags, getPlanLimits } from '../subscription/subscription-pricing';
import { CreateClinicOnboardingDto } from './dto/create-clinic-onboarding.dto';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly catalog: SpecialtyCatalogService,
    private readonly tenantSpecialties: TenantSpecialtiesService,
  ) {}

  async create(dto: CreateClinicOnboardingDto) {
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
    const adminSpecialtyCode = dto.adminSpecialtyCode?.trim().toUpperCase();
    if (
      dto.adminProvidesCare &&
      (!adminSpecialtyCode || !specialtyCodes.includes(adminSpecialtyCode))
    ) {
      throw new BadRequestException({
        code: 'ADMIN_SPECIALTY_NOT_SELECTED',
        message: 'Selecciona una especialidad habilitada para el administrador.',
      });
    }
    if (
      !dto.adminProvidesCare &&
      (dto.adminSpecialtyCode !== undefined ||
        dto.adminProfessionalTitle !== undefined ||
        dto.adminLicenseNumber !== undefined ||
        dto.adminBio !== undefined)
    ) {
      throw new BadRequestException({
        code: 'ADMIN_CLINICAL_FIELDS_NOT_ALLOWED',
        message: 'Los datos clínicos requieren que el administrador atienda pacientes.',
      });
    }

    const adminEmail = dto.adminEmail.trim().toLowerCase();
    const password = await this.auth.hashPassword(dto.adminPassword);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // User.email is unique per tenant only. Serialize public registrations for the same
            // normalized email before checking it globally, including concurrent requests.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${adminEmail}))`;
            const existing = await tx.user.findFirst({
              where: { email: adminEmail },
              select: { id: true },
            });
            if (existing) throw new ConflictException('El correo electrónico ya está en uso');

            const tenant = await tx.tenant.create({
              data: {
                name: dto.clinicName.trim(),
                email: dto.contactEmail.trim().toLowerCase(),
                phone: dto.contactPhone?.trim(),
                address: dto.address?.trim(),
                tenantType: TenantType.CLINIC,
                onboardingCompleted: true,
              },
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                address: true,
                tenantType: true,
                onboardingCompleted: true,
              },
            });
            await this.prisma.applyRlsContext(tx, { tenantId: tenant.id });
            await tx.tenantSettings.create({
              data: {
                tenantId: tenant.id,
                timezone: dto.timezone.trim(),
                locale: dto.locale.trim(),
              },
            });

            const trial = getPlanLimits(PlanType.TRIAL);
            const subscription = await tx.tenantSubscription.create({
              data: {
                tenantId: tenant.id,
                planType: PlanType.TRIAL,
                status: 'TRIALING',
                trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                basePrice: trial.basePrice,
                pricePerSeat: trial.pricePerSeat,
                seatsPsychologistsMax: 3,
                seatsPsychologistsUsed: dto.adminProvidesCare ? 1 : 0,
                maxActivePatients: 20,
                storageGB: trial.storageGB,
                monthlyNotificationsLimit: trial.monthlyNotificationsLimit,
                includedSpecialties: trial.includedSpecialties,
                specialtyPrice: trial.specialtyPrice,
                monthlyElectronicInvoicesLimit: trial.monthlyElectronicInvoicesLimit,
                ...getPlanFeatureFlags(PlanType.TRIAL),
              },
            });
            const specialties = await this.catalog.resolveActiveCodes(specialtyCodes, tx);
            const adminSpecialty = dto.adminProvidesCare
              ? specialties.find((specialty) => specialty.code === adminSpecialtyCode)!
              : null;
            const admin = await tx.user.create({
              data: {
                tenantId: tenant.id,
                email: adminEmail,
                password,
                firstName: dto.adminFirstName.trim(),
                lastName: dto.adminLastName.trim(),
                role: UserRole.ADMIN,
                isActive: true,
                emailVerified: true,
                activatedAt: new Date(),
                managedByProvider: false,
                ...(adminSpecialty
                  ? {
                      professionalTitle: dto.adminProfessionalTitle?.trim(),
                      licenseNumber: dto.adminLicenseNumber?.trim(),
                      professionalProfile: {
                        create: {
                          specialtyId: adminSpecialty.id,
                          professionalTitle: dto.adminProfessionalTitle?.trim(),
                          licenseNumber: dto.adminLicenseNumber?.trim(),
                          bio: dto.adminBio?.trim(),
                          isActive: true,
                        },
                      },
                      professionalSpecialties: {
                        create: { specialtyId: adminSpecialty.id, isPrimary: true },
                      },
                    }
                  : {}),
              },
              select: {
                id: true,
                tenantId: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                professionalProfile: {
                  select: {
                    isActive: true,
                    specialty: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            });
            const selected = await this.tenantSpecialties.applySelection(tx, {
              tenantId: tenant.id,
              subscription,
              specialties,
            });
            return {
              tenant,
              admin,
              specialties: selected.specialties,
              modules: selected.modules,
              pricing: selected.pricing,
            };
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
}
