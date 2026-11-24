import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigService } from '../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { MockOtpSender } from './otp/mock-otp.sender';
import { OTP_SENDER, OtpSender } from './otp/otp-sender';
import { OtpService } from './otp/otp.service';
import { TwilioOtpSender } from './otp/twilio-otp.sender';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtAuthGuard,
    RolesGuard,
    {
      provide: OTP_SENDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): OtpSender => {
        if (config.get('OTP_PROVIDER') === 'twilio') {
          return new TwilioOtpSender({
            accountSid: config.get('TWILIO_ACCOUNT_SID')!,
            authToken: config.get('TWILIO_AUTH_TOKEN')!,
            fromNumber: config.get('TWILIO_FROM_NUMBER')!,
            timeoutMs: 10_000,
          });
        }
        if (config.isProductionLike)
          throw new Error('Mock OTP provider is not allowed in production');
        return new MockOtpSender(config.get('MOCK_OTP_CODE')!);
      },
    },
  ],
  exports: [TokenService, OtpService, JwtAuthGuard, RolesGuard, OTP_SENDER],
})
export class AuthModule {}
