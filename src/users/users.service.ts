import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, InviteUserDto, UpdateUserDto } from './dto/user.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
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

    // TODO: Send invitation email with activation link

    const { password: _, ...userWithoutPassword } = user;
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

    // Prevent role changes that would violate seat limits
    if (updateUserDto.role && updateUserDto.role !== user.role) {
      // If changing TO PSYCHOLOGIST, check seats
      if (updateUserDto.role === 'PSYCHOLOGIST') {
        await this.checkSeatAvailability(tenantId);
      }

      // Update seat count in transaction
      await this.prisma.$transaction(async (tx) => {
        // If changing FROM PSYCHOLOGIST, decrement
        if (user.role === 'PSYCHOLOGIST') {
          await tx.tenantSubscription.update({
            where: { tenantId },
            data: { seatsPsychologistsUsed: { decrement: 1 } },
          });
        }

        // If changing TO PSYCHOLOGIST, increment
        if (updateUserDto.role === 'PSYCHOLOGIST') {
          await tx.tenantSubscription.update({
            where: { tenantId },
            data: { seatsPsychologistsUsed: { increment: 1 } },
          });
        }
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateUserDto,
      select: {
        id: true,
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

    return updated;
  }

  async deactivate(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Deactivate user and free up seat if PSYCHOLOGIST
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      // Free up seat if PSYCHOLOGIST
      if (user.role === 'PSYCHOLOGIST') {
        await tx.tenantSubscription.update({
          where: { tenantId },
          data: { seatsPsychologistsUsed: { decrement: 1 } },
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

    // Re-check seat availability if PSYCHOLOGIST
    if (user.role === 'PSYCHOLOGIST') {
      await this.checkSeatAvailability(tenantId);
    }

    const hashedPassword = await this.authService.hashPassword(password);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        isActive: true,
        emailVerified: true,
        activatedAt: new Date(),
      },
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
}
