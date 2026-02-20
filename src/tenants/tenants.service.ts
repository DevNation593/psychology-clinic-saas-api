import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  async create(createTenantDto: CreateTenantDto) {
    const { slug, email, adminEmail, adminPassword, adminFirstName, adminLastName, ...tenantData } =
      createTenantDto;

    // Check if slug already exists
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (existingTenant) {
      throw new ConflictException('Tenant with this slug already exists');
    }

    // Check if admin email already exists
    const existingUser = await this.prisma.user.findFirst({
      where: { email: adminEmail },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    // Hash password
    const hashedPassword = await this.authService.hashPassword(adminPassword);

    // Create tenant with admin user and subscription in a transaction
    const tenant = await this.prisma.$transaction(async (tx) => {
      // Create tenant
      const newTenant = await tx.tenant.create({
        data: {
          ...tenantData,
          slug,
          email,
        },
      });

      await this.prisma.applyRlsContext(tx, { tenantId: newTenant.id });

      // Create tenant settings
      await tx.tenantSettings.create({
        data: {
          tenantId: newTenant.id,
        },
      });

      // Create tenant subscription (trial mode)
      await tx.tenantSubscription.create({
        data: {
          tenantId: newTenant.id,
          planType: 'TRIAL',
          status: 'TRIALING',
          seatsPsychologistsMax: 1,
          seatsPsychologistsUsed: 0,
          maxActivePatients: 10,
          storageGB: 0,
          monthlyNotificationsLimit: 100,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
          featureClinicalNotes: true,
          featureAttachments: false,
          featureTasks: false,
        },
      });

      // Create admin user
      await tx.user.create({
        data: {
          tenantId: newTenant.id,
          email: adminEmail,
          password: hashedPassword,
          firstName: adminFirstName,
          lastName: adminLastName,
          role: 'TENANT_ADMIN',
          isActive: true,
          emailVerified: true,
          activatedAt: new Date(),
        },
      });

      return newTenant;
    });

    return this.findOne(tenant.id);
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        settings: true,
        subscription: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  async findBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        settings: true,
        subscription: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  async update(id: string, updateTenantDto: UpdateTenantDto) {
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: updateTenantDto,
      include: {
        settings: true,
        subscription: true,
      },
    });

    return tenant;
  }

  async completeOnboarding(id: string) {
    return this.prisma.tenant.update({
      where: { id },
      data: { onboardingCompleted: true },
    });
  }

  async getSubscription(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    return subscription;
  }

  async updateSubscription(tenantId: string, data: any) {
    return this.prisma.tenantSubscription.update({
      where: { tenantId },
      data,
    });
  }
}
