import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, InviteUserDto, UpdateUserDto, ActivateUserDto, ChangePasswordDto } from './dto/user.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('TENANT_ADMIN')
  @Post()
  @ApiOperation({
    summary: 'Create user with password - Admin only',
    description: 'Enforces seat limits for PSYCHOLOGIST role',
  })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({
    status: 403,
    description: 'Seat limit reached',
    schema: {
      example: {
        statusCode: 403,
        error: 'SEAT_LIMIT_REACHED',
        message: 'Seat limit reached. Current plan allows 1 psychologist(s). Please upgrade your plan.',
        details: {
          seatsPsychologistsMax: 1,
          seatsPsychologistsUsed: 1,
          planType: 'BASIC',
        },
      },
    },
  })
  async create(
    @Param('tenantId') tenantId: string,
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.create({ ...createUserDto, tenantId }, user.userId);
  }

  @Roles('TENANT_ADMIN')
  @Post('invite')
  @ApiOperation({
    summary: 'Invite user (without password) - Admin only',
    description: 'Sends invitation email. User sets password on activation. Enforces seat limits.',
  })
  @ApiResponse({ status: 201, description: 'User invited successfully' })
  @ApiResponse({ status: 403, description: 'Seat limit reached' })
  async invite(
    @Param('tenantId') tenantId: string,
    @Body() inviteUserDto: InviteUserDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.invite(tenantId, inviteUserDto, user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all users in tenant' })
  @ApiQuery({ name: 'role', required: false, enum: ['TENANT_ADMIN', 'PSYCHOLOGIST', 'ASSISTANT'] })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Users list' })
  async findAll(
    @Param('tenantId') tenantId: string,
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
  ) {
    const filters: any = {};
    if (role) filters.role = role;
    if (isActive !== undefined) filters.isActive = isActive === 'true';

    return this.usersService.findAll(tenantId, filters);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.usersService.findOne(tenantId, userId);
  }

  @Roles('TENANT_ADMIN')
  @Patch(':userId')
  @ApiOperation({ summary: 'Update user - Admin only' })
  @ApiResponse({ status: 200, description: 'User updated' })
  async update(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(tenantId, userId, updateUserDto);
  }

  @Roles('TENANT_ADMIN')
  @Delete(':userId')
  @ApiOperation({ summary: 'Deactivate user - Admin only (soft delete)' })
  @ApiResponse({ status: 200, description: 'User deactivated and seat freed' })
  async deactivate(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.usersService.deactivate(tenantId, userId);
  }

  @Post(':userId/activate')
  @ApiOperation({ summary: 'Activate invited user (set password)' })
  @ApiResponse({ status: 200, description: 'User activated' })
  async activate(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() activateUserDto: ActivateUserDto,
  ) {
    return this.usersService.activate(tenantId, userId, activateUserDto.password);
  }

  @Post('me/change-password')
  @ApiOperation({
    summary: 'Change own password',
    description: 'Authenticated user changes their own password by providing current and new password.',
  })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  async changePassword(
    @Param('tenantId') tenantId: string,
    @Body() changePasswordDto: ChangePasswordDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.changePassword(
      tenantId,
      user.userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }
}
