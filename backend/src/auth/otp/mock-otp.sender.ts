import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/utils/phone.util';
import { OtpSendRequest, OtpSender } from './otp-sender';

/**
 * DEVELOPMENT / TEST ONLY. Delivers nothing; the expected code is MOCK_OTP_CODE.
 * Environment validation refuses this provider when NODE_ENV is staging or production.
 */
export class MockOtpSender implements OtpSender {
  readonly name = 'mock';
  private readonly logger = new Logger('MockOtpSender');
  /** Visible to tests to assert delivery happened - never exposed over HTTP. */
  readonly deliveries: Array<{ phoneE164: string; at: Date }> = [];

  constructor(private readonly code: string) {}

  fixedCode(): string {
    return this.code;
  }

  async send(req: OtpSendRequest): Promise<void> {
    this.deliveries.push({ phoneE164: req.phoneE164, at: new Date() });
    // The code itself is intentionally NOT logged.
    this.logger.log(
      `Mock OTP issued for ${maskPhone(req.phoneE164)} (use the configured MOCK_OTP_CODE)`,
    );
  }
}
