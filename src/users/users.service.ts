import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, InviteUserDto, UpdateUserDto } from './dto/user.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  /**
   * Create a new user (with password) - Used by admins
   * Enforces seat limits for PSYCHOLOGIST role
   */
  async create(createUserDto: CreateUserDto, createdBy: string) {
    const { tenantId, email, password, role, ...userData } = createUserDto;

    // Check if email already exists in this tenant
    const existingUser = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use in this tenant');
    }

    // SEAT ENFORCEMENT: Check if we can add a PSYCHOLOGIST
    if (role === 'PSYCHOLOGIST') {
      await this.checkSeatAvailability(tenantId);
    }

    // Hash password
    const hashedPassword = password
      ? await this.authService.hashPassword(password)
      : await this.authService.hashPassword(Math.random().toString(36).slice(-12));

    // Create user in transaction
    const user = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId, userId: createdBy });

      const newUser = await tx.user.create({
        data: {
          tenantId,
          email,
          password: hashedPassword,
          firstName: userData.firstName,
          lastName: userData.lastName,
          phone: userData.phone,
          role,
          isActive: true,
          emailVerified: password ? true : false,
          activatedAt: password ? new Date() : null,
        },
      });

      // Increment seat count if PSYCHOLOGIST
      if (role === 'PSYCHOLOGIST') {
        await tx.tenantSubscription.update({
          where: { tenantId },
          data: { seatsPsychologistsUsed: { increment: 1 } },
        });
      }

      return newUser;
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * Invite a user (without password) - Sends invite, user sets password later
   * Enforces seat limits for PSYCHOLOGIST role
   */
  async invite(tenantId: string, inviteUserDto: InviteUserDto, invitedBy: string) {
    const { email, role, ...userData } = inviteUserDto;

    // Check if email already exists in this tenant
    const existingUser = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use in this tenant');
    }

    // SEAT ENFORCEMENT: Check if we can add a PSYCHOLOGIST
    if (role === 'PSYCHOLOGIST') {
      await this.checkSeatAvailability(tenantId);
    }

    // Generate temporary password
    const tempPassword = await this.authService.hashPassword(Math.random().toString(36).slice(-12));

    // Create user in transaction
    const user = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId, userId: invitedBy });

      const newUser = await tx.user.create({
        data: {
          tenantId,
          email,
          password: tempPassword,
          firstName: userData.firstName,
          lastName: userData.lastName,
          phone: userData.phone,
          role,
          isActive: false,
          emailVerified: false,
          invitedAt: new Date(),
          invitedBy,
        },
      });

      // Increment seat count if PSYCHOLOGIST
      if (role === 'PSYCHOLOGIST') {
        await tx.tenantSubscription.update({
          where: { tenantId },
          data: { seatsPsychologistsUsed: { increment: 1 } },
        });
      }

      return newUser;
    });

    const { password: _, ...userWithoutPassword } = user;
    await this.sendInvitationEmail(tenantId, userWithoutPassword.id, userWithoutPassword.email);
    return userWithoutPassword;
  }

  /**
   * Check if tenant has available seats for PSYCHOLOGIST role
   * Throws error if limit reached
   */
  private async checkSeatAvailability(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new ForbiddenException('No subscription found for this tenant');
    }

    // Check subscription status
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
      throw new ForbiddenException({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'Cannot invite users. Your subscription is not active.',
        status: subscription.status,
      });
    }

    // Check seat limit
    if (subscription.seatsPsychologistsUsed >= subscription.seatsPsychologistsMax) {
      throw new ForbiddenException({
        error: 'SEAT_LIMIT_REACHED',
        message: `Seat limit reached. Current plan (${subscription.planType}) allows ${subscription.seatsPsychologistsMax} psychologist(s). Please upgrade your plan.`,
        details: {
          seatsPsychologistsMax: subscription.seatsPsychologistsMax,
          seatsPsychologistsUsed: subscription.seatsPsychologistsUsed,
          planType: subscription.planType,
          upgradeUrl: `/tenants/${tenantId}/subscription/upgrade`,
        },
      });
    }
  }

  async findAll(tenantId: string, filters?: { role?: string; isActive?: boolean }) {
    const where: any = { tenantId };

    if (filters?.role) {
      where.role = filters.role;
    }

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
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
        invitedAt: true,
        activatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }

  async findOne(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
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
        invitedAt: true,
        activatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(tenantId: string, userId: string, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const nextRole = updateUserDto.role || user.role;
    const nextIsActive = updateUserDto.isActive ?? user.isActive;
    const currentUsesSeat = user.role === 'PSYCHOLOGIST' && user.isActive;
    const nextUsesSeat = nextRole === 'PSYCHOLOGIST' && nextIsActive;

    if (!currentUsesSeat && nextUsesSeat) {
      await this.checkSeatAvailability(tenantId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId });

      if (currentUsesSeat !== nextUsesSeat) {
        if (!currentUsesSeat && nextUsesSeat) {
          await tx.tenantSubscription.update({
            where: { tenantId },
            data: { seatsPsychologistsUsed: { increment: 1 } },
          });
        } else if (currentUsesSeat && !nextUsesSeat) {
          await tx.tenantSubscription.updateMany({
            where: {
              tenantId,
              seatsPsychologistsUsed: { gt: 0 },
            },
            data: {
              seatsPsychologistsUsed: {
                decrement: 1,
              },
            },
          });
        }
      }

      return tx.user.update({
        where: { id: userId },
        data: updateUserDto,
        select: {
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
    });

    return updated;
  }

  async deactivate(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      return { message: 'User already inactive' };
    }

    // Deactivate user and free up seat if active PSYCHOLOGIST
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId });

      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      if (user.role === 'PSYCHOLOGIST') {
        await tx.tenantSubscription.updateMany({
          where: {
            tenantId,
            seatsPsychologistsUsed: { gt: 0 },
          },
          data: {
            seatsPsychologistsUsed: {
              decrement: 1,
            },
          },
        });
      }
    });

    return { message: 'User deactivated successfully' };
  }

  async activate(tenantId: string, userId: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const hashedPassword = await this.authService.hashPassword(password);

    // Invited psychologists already reserve a seat at invitation time.
    const seatReservedAtInvite =
      user.role === 'PSYCHOLOGIST' && !!user.invitedAt && !user.activatedAt;
    const needsSeatNow = user.role === 'PSYCHOLOGIST' && !user.isActive && !seatReservedAtInvite;

    if (needsSeatNow) {
      await this.checkSeatAvailability(tenantId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId });

      if (needsSeatNow) {
        await tx.tenantSubscription.update({
          where: { tenantId },
          data: {
            seatsPsychologistsUsed: {
              increment: 1,
            },
          },
        });
      }

      return tx.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          isActive: true,
          emailVerified: true,
          activatedAt: new Date(),
        },
      });
    });

    const { password: _, ...userWithoutPassword } = updated;
    return userWithoutPassword;
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
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const bcrypt = await import('bcrypt');
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash and update new password
    const hashedNewPassword = await this.authService.hashPassword(newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    return { message: 'Password changed successfully' };
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
      throw new NotFoundException('User not found');
    }

    // Only tenant admins or the same user can change the avatar.
    if (currentUserRole !== 'TENANT_ADMIN' && currentUserId !== userId) {
      throw new ForbiddenException('You can only update your own avatar');
    }

    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }

    const avatarUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
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
          subject: 'You have been invited to Psychology Clinic SaaS',
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
