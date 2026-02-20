import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiProperty,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsString, IsNotEmpty } from 'class-validator';

class RegisterFcmTokenDto {
  @ApiProperty({ example: 'fcm-token-from-firebase-sdk', description: 'FCM device token' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get user notifications' })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Notifications list' })
  async getUserNotifications(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: any,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.getUserNotifications(
      tenantId,
      user.userId,
      unreadOnly === 'true',
    );
  }

  @Post('fcm-token')
  @ApiOperation({
    summary: 'Register FCM token for push notifications',
    description:
      'Frontend sends the FCM token obtained from Firebase SDK after user grants notification permission.',
  })
  @ApiResponse({ status: 201, description: 'FCM token registered' })
  async registerFcmToken(
    @Param('tenantId') tenantId: string,
    @Body() dto: RegisterFcmTokenDto,
    @CurrentUser() user: any,
  ) {
    return this.notificationsService.registerFcmToken(tenantId, user.userId, dto.token);
  }

  @Delete('fcm-token')
  @ApiOperation({
    summary: 'Remove FCM token (logout / disable push)',
    description: 'Call this on logout to stop receiving push notifications on this device.',
  })
  @ApiResponse({ status: 200, description: 'FCM token removed' })
  async removeFcmToken(@Param('tenantId') tenantId: string, @CurrentUser() user: any) {
    return this.notificationsService.removeFcmToken(tenantId, user.userId);
  }

  @Post(':notificationId/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsRead(
    @Param('tenantId') tenantId: string,
    @Param('notificationId') notificationId: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationsService.markAsRead(tenantId, notificationId, user.userId);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  async markAllAsRead(@Param('tenantId') tenantId: string, @CurrentUser() user: any) {
    return this.notificationsService.markAllAsRead(tenantId, user.userId);
  }
}
