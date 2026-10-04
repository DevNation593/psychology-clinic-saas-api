import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RefreshTokenDto,
  AuthResponseDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangeOwnPasswordDto,
} from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { SessionRoute } from '../common/decorators/session-route.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

// Brute-force limit for the public auth endpoints. AUTH_THROTTLE_LIMIT is only set by the e2e
// setup, whose suites sign in many users from one address within a minute.
const AUTH_THROTTLE = {
  default: { limit: Number(process.env.AUTH_THROTTLE_LIMIT) || 5, ttl: 60000 },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refreshTokens(refreshTokenDto.refreshToken);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({ status: 200, description: 'Password reset requested' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(forgotPasswordDto.email);
    return { message: 'If the account exists, a reset link has been sent' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using reset token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    await this.authService.resetPassword(resetPasswordDto.token, resetPasswordDto.password);
    return { message: 'Password reset successful' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @SessionRoute()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout current session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@CurrentUser() user: any, @Body() body: { refreshToken: string }) {
    await this.authService.logout(user.userId, body.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @SessionRoute()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout from all sessions' })
  @ApiResponse({ status: 200, description: 'Logged out from all devices' })
  async logoutAll(@CurrentUser() user: any) {
    await this.authService.logoutAll(user.userId);
    return { message: 'Logged out from all devices' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @SessionRoute()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the password of the current user' })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'New password equals the current one' })
  @ApiResponse({ status: 401, description: 'Current password is wrong' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangeOwnPasswordDto) {
    await this.authService.changeOwnPassword(user.userId, dto.currentPassword, dto.newPassword);
    return { message: 'Password changed successfully' };
  }
}
