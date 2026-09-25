import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TenantType, UserRole } from '@prisma/client';
import { CreateUserDto, InviteUserDto, UpdateUserDto } from './dto/user.dto';
import { AuthService } from '../auth/auth.service';
import { isAdminRole, isProfessionalRole } from '../common/roles/role-compatibility';
import { ProfessionalProfilesService } from '../professional-profiles/professional-profiles.service';
import { ProfessionalProfileInputDto } from '../professional-profiles/dto/professional-profile.dto';

const professionalFields = {
  professionalTitle: true,
  licenseNumber: true,
  professionalSpecialties: { include: { specialty: true } },
  professionalProfile: { include: { specialty: true } },
} satisfies Prisma.UserSelect;

const userSelect = {
  id: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  managedByProvider: true,
  emailVerified: true,
  invitedAt: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  ...professionalFields,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private profiles: ProfessionalProfilesService,
  ) {}

  private resolveProfileInput(
    dto: CreateUserDto | UpdateUserDto,
  ): ProfessionalProfileInputDto | undefined {
    const specialtyId =
      dto.professionalProfile?.specialtyId ?? dto.specialtyId ?? dto.specialtyIds?.[0];
    if (!specialtyId) return undefined;
    return {
      specialtyId,
      professionalTitle: dto.professionalProfile?.professionalTitle ?? dto.professionalTitle,
      licenseNumber: dto.professionalProfile?.licenseNumber ?? dto.licenseNumber,
      bio: dto.professionalProfile?.bio,
      isActive: dto.professionalProfile?.isActive ?? true,
    };
  }

  private async mutate<T>(
    tenantId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    userId?: string,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.prisma.applyRlsContext(tx, { tenantId, userId });
            return operation(tx);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2034') throw error;
        if (attempt >= 2) {
          throw new ConflictException({
            statusCode: 409,
            code: 'PROFESSIONAL_SEAT_LIMIT_REACHED',
            message: 'Se alcanzó el límite de profesionales activos del plan.',
          });
        }
      }
    }
  }

  async create(dto: CreateUserDto, createdBy: string) {
    return this.createOrInvite(dto, createdBy, false);
  }

  async invite(tenantId: string, dto: InviteUserDto, invitedBy: string) {
    const user = await this.createOrInvite({ ...dto, tenantId }, invitedBy, true);
    await this.sendInvitationEmail(tenantId, user.id, user.email);
    return user;
  }

  private async createOrInvite(dto: CreateUserDto, actorId: string, invitation: boolean) {
    const { tenantId, email, password, role } = dto;
    await this.ensureClinicPlan(tenantId);
    const profile = this.resolveProfileInput(dto);
    if (invitation && profile) profile.isActive = true;
    this.profiles.validateRoleProfile(role, profile);
    const hashedPassword = await this.authService.hashPassword(
      password ?? Math.random().toString(36).slice(-12),
    );

    return this.mutate(
      tenantId,
      async (tx) => {
        const existing = await tx.user.findUnique({
          where: { tenantId_email: { tenantId, email } },
        });
        if (existing) throw new ConflictException('Este email ya está registrado en esta clínica');
        if (profile) {
          await this.profiles.assertSpecialtyEnabled(tenantId, profile.specialtyId, tx);
          if (profile.isActive) await this.checkSeatAvailability(tenantId, tx);
        }
        const tenant = isProfessionalRole(role)
          ? await tx.tenant.findUnique({ where: { id: tenantId } })
          : null;
        const managedByProvider =
          isProfessionalRole(role) && tenant?.tenantType === TenantType.CLINIC;
        const user = await tx.user.create({
          data: {
            tenantId,
            email,
            password: hashedPassword,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            role,
            professionalTitle: profile?.professionalTitle ?? dto.professionalTitle,
            licenseNumber: profile?.licenseNumber ?? dto.licenseNumber,
            professionalProfile: profile ? { create: profile } : undefined,
            professionalSpecialties: profile
              ? { create: { specialtyId: profile.specialtyId, isPrimary: true } }
              : undefined,
            isActive: !invitation && !managedByProvider,
            managedByProvider,
            emailVerified: !invitation && !!password,
            activatedAt: !invitation && password && !managedByProvider ? new Date() : null,
            invitedAt: invitation ? new Date() : undefined,
            invitedBy: invitation ? actorId : undefined,
          },
          select: userSelect,
        });
        await this.profiles.syncStoredSeatCount(tenantId, tx);
        // Strip defensively for adapters that return extra fields.
        const { password: _, ...safe } = user as typeof user & { password?: string };
        return safe;
      },
      actorId,
    );
  }

  private async ensureClinicPlan(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new ForbiddenException('No se encontró suscripción para esta clínica');
    }

    const personalPlans = ['TRIAL', 'PERSONAL_BASIC', 'PERSONAL_PRO'];
    if (personalPlans.includes(subscription.planType)) {
      throw new ForbiddenException({
        error: 'TEAM_NOT_AVAILABLE',
        message:
          'El módulo de equipo no está disponible en planes individuales. Actualiza a un plan de clínica para gestionar múltiples usuarios.',
        currentPlan: subscription.planType,
        upgradeUrl: `/tenants/${tenantId}/subscription/upgrade?reason=team`,
      });
    }
  }

  private async checkSeatAvailability(tenantId: string, tx: Prisma.TransactionClient) {
    await this.profiles.assertSeatAvailable(tenantId, tx);
    const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
    if (subscription && subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
      throw new ForbiddenException({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'No se pueden invitar usuarios. Tu suscripción no está activa.',
        status: subscription.status,
      });
    }
  }

  async findAll(tenantId: string, filters?: { role?: string; isActive?: boolean }) {
    const where: Prisma.UserWhereInput = { tenantId };
    if (filters?.role) {
      where.role = isProfessionalRole(filters.role)
        ? { in: [UserRole.PSICOLOGO, UserRole.PROFESIONAL] }
        : isAdminRole(filters.role)
          ? { in: [UserRole.CLIENTE, UserRole.ADMIN] }
          : (filters.role as UserRole);
    }
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    return this.prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: 'desc' } });
  }

  async findOne(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async update(tenantId: string, userId: string, dto: UpdateUserDto) {
    return this.mutate(tenantId, (tx) => this.updateInTransaction(tx, tenantId, userId, dto));
  }

  private async updateInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: UpdateUserDto,
    extra: Pick<Prisma.UserUpdateInput, 'password' | 'emailVerified' | 'activatedAt'> = {},
    accessFlow?: 'provider' | 'activation',
  ) {
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId },
      include: { professionalProfile: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (accessFlow === 'provider' && !user.managedByProvider)
      throw new BadRequestException('Este usuario no es gestionado por el proveedor');
    const current = user.professionalProfile;
    const remove = dto.professionalProfile === null;
    const input = this.resolveProfileInput(dto);
    const profile = remove
      ? undefined
      : (input ??
        (current
          ? {
              specialtyId: current.specialtyId,
              professionalTitle: dto.professionalTitle ?? current.professionalTitle ?? undefined,
              licenseNumber: dto.licenseNumber ?? current.licenseNumber ?? undefined,
              bio: current.bio ?? undefined,
              isActive: current.isActive,
            }
          : undefined));
    if (profile) {
      // Metadata/specialty edits preserve activity unless explicitly changed.
      profile.isActive =
        dto.isActive === false
          ? false
          : (dto.professionalProfile?.isActive ??
            (dto.isActive === true ? true : (current?.isActive ?? true)));
      if (current) {
        profile.professionalTitle ??= current.professionalTitle ?? undefined;
        profile.licenseNumber ??= current.licenseNumber ?? undefined;
        profile.bio ??= current.bio ?? undefined;
      }
    }
    const activatesUser = !user.isActive && (dto.isActive ?? user.isActive);
    const activatesProfile = !current?.isActive && profile?.isActive;
    if (
      user.managedByProvider &&
      accessFlow !== 'provider' &&
      (accessFlow === 'activation' || (!user.isActive && (activatesUser || activatesProfile)))
    ) {
      throw new ForbiddenException('El acceso de este usuario debe ser concedido por el proveedor');
    }
    this.profiles.validateRoleProfile(dto.role ?? user.role, profile);
    if (profile) {
      if (!current || profile.specialtyId !== current.specialtyId) {
        await this.profiles.assertSpecialtyEnabled(tenantId, profile.specialtyId, tx);
        await this.profiles.assertSpecialtyChangeAllowed(tenantId, userId, profile.specialtyId, tx);
      }
      if (profile.isActive && !current?.isActive) await this.checkSeatAvailability(tenantId, tx);
    }
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role,
        isActive: dto.isActive,
        professionalTitle: remove ? null : (profile?.professionalTitle ?? dto.professionalTitle),
        licenseNumber: remove ? null : (profile?.licenseNumber ?? dto.licenseNumber),
        professionalProfile: profile
          ? { upsert: { create: profile, update: profile } }
          : remove && current
            ? { delete: true }
            : undefined,
        professionalSpecialties: profile
          ? { deleteMany: {}, create: { specialtyId: profile.specialtyId, isPrimary: true } }
          : remove
            ? { deleteMany: {} }
            : undefined,
        ...extra,
      },
      select: userSelect,
    });
    await this.profiles.syncStoredSeatCount(tenantId, tx);
    const { password: _, ...safe } = updated as typeof updated & { password?: string };
    return safe;
  }

  async deactivate(tenantId: string, userId: string) {
    await this.update(tenantId, userId, { isActive: false });
    return { message: 'Usuario desactivado exitosamente' };
  }

  async activate(tenantId: string, userId: string, password: string) {
    const hashedPassword = await this.authService.hashPassword(password);
    return this.mutate(tenantId, (tx) =>
      this.updateInTransaction(
        tx,
        tenantId,
        userId,
        { isActive: true },
        { password: hashedPassword, emailVerified: true, activatedAt: new Date() },
        'activation',
      ),
    );
  }

  /**
   * Change user's own password
   * Verifies current password before updating
   */
  async changePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Verify current password
    const bcrypt = await import('bcrypt');
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new BadRequestException('La contraseña actual es incorrecta');
    }

    // Hash and update new password
    const hashedNewPassword = await this.authService.hashPassword(newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    return { message: 'Contraseña cambiada exitosamente' };
  }

  async uploadAvatar(
    tenantId: string,
    userId: string,
    currentUserId: string,
    currentUserRole: string,
    file: any,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Only the same user, CLIENTE (admin) or SOPORTE can change the avatar.
    if (
      currentUserRole !== 'SOPORTE' &&
      !isAdminRole(currentUserRole) &&
      currentUserId !== userId
    ) {
      throw new ForbiddenException('Solo puedes actualizar tu propio avatar');
    }

    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Solo se permiten archivos de imagen');
    }

    const avatarUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
        ...professionalFields,
        id: true,
        tenantId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async grantPsychologistAccess(tenantId: string, userId: string) {
    await this.mutate(tenantId, (tx) =>
      this.updateInTransaction(
        tx,
        tenantId,
        userId,
        { isActive: true },
        { activatedAt: new Date() },
        'provider',
      ),
    );
    return { message: 'Acceso concedido exitosamente' };
  }

  async revokePsychologistAccess(tenantId: string, userId: string) {
    await this.mutate(tenantId, (tx) =>
      this.updateInTransaction(tx, tenantId, userId, { isActive: false }, {}, 'provider'),
    );
    return { message: 'Acceso del usuario revocado exitosamente' };
  }

  async listPendingPsychologists() {
    return this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.PSICOLOGO, UserRole.PROFESIONAL] },
        managedByProvider: true,
        isActive: false,
      },
      select: { ...userSelect, tenant: { select: { name: true, tenantType: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async sendInvitationEmail(tenantId: string, userId: string, email: string) {
    const apiUrl = process.env.EMAIL_API_URL;
    const apiKey = process.env.EMAIL_API_KEY;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const activationLink = `${frontendUrl}/activate?tenantId=${tenantId}&userId=${userId}`;

    if (!apiUrl) {
      this.logger.warn(
        `EMAIL_API_URL is not configured. Invitation for ${email} not sent. Activation link: ${activationLink}`,
      );
      return;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          to: email,
          template: 'user-invitation',
          subject: 'Has sido invitado a Psychology Clinic SaaS',
          variables: {
            activationLink,
            tenantId,
            userId,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Invitation email failed for ${email}. Status ${response.status}. Body: ${errorBody}`,
        );
      }
    } catch (error) {
      this.logger.error(`Invitation email request failed for ${email}`, error as any);
    }
  }
}
