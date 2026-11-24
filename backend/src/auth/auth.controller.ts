import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthUser,
  CurrentUser,
  Public,
  ReqMeta,
  RequestMeta,
} from '../common/decorators/auth.decorators';
import { AuthService } from './auth.service';
import { AdminLoginDto, RefreshTokenDto, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a one-time verification code to a mobile number' })
  requestOtp(@Body() dto: RequestOtpDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.requestOtp(dto, meta);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the code; logs in or registers (first/last name required for new accounts)',
  })
  verifyOtp(@Body() dto: VerifyOtpDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.verifyOtp(dto, meta);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token and obtain a new access token' })
  refresh(@Body() dto: RefreshTokenDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(dto, meta);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.auth.logout(user.userId, user.sessionId, meta);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return { revokedSessions: await this.auth.logoutAll(user.userId, meta) };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin dashboard login (email + password)' })
  adminLogin(@Body() dto: AdminLoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.adminLogin(dto, meta);
  }
}
