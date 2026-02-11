import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';

@Injectable()
export class TenantSettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get tenant settings
   */
  async findOne(tenantId: string) {
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      throw new NotFoundException('Tenant settings not found');
    }

    return settings;
  }

  /**
   * Update tenant settings
   */
  async update(tenantId: string, updateDto: UpdateTenantSettingsDto) {
    // Check settings exist
    const existing = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Tenant settings not found');
    }

    // Validate working hours order if both provided
    const start = updateDto.workingHoursStart ?? existing.workingHoursStart;
    const end = updateDto.workingHoursEnd ?? existing.workingHoursEnd;

    if (start >= end) {
      throw new BadRequestException(
        'workingHoursEnd must be after workingHoursStart',
      );
    }

    // Validate working days values
    const validDays = [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ];
    if (updateDto.workingDays) {
      const invalidDays = updateDto.workingDays.filter(
        (d) => !validDays.includes(d),
      );
      if (invalidDays.length > 0) {
        throw new BadRequestException(
          `Invalid working days: ${invalidDays.join(', ')}. Valid values: ${validDays.join(', ')}`,
        );
      }
    }

    const updated = await this.prisma.tenantSettings.update({
      where: { tenantId },
      data: updateDto,
    });

    return updated;
  }
}
