import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/utils/phone.util';
import { OtpDeliveryError, OtpSendRequest, OtpSender } from './otp-sender';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  timeoutMs: number;
}

/** Delivers OTPs as SMS through the Twilio Programmable Messaging REST API. */
export class TwilioOtpSender implements OtpSender {
  readonly name = 'twilio';
  private readonly logger = new Logger('TwilioOtpSender');

  constructor(
    private readonly cfg: TwilioConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  fixedCode(): null {
    return null;
  }

  async send(req: OtpSendRequest): Promise<void> {
    const minutes = Math.max(1, Math.round(req.ttlSeconds / 60));
    const body = new URLSearchParams({
      To: req.phoneE164,
      From: this.cfg.fromNumber,
      Body: `${req.code} is your EmblemWay verification code. It expires in ${minutes} minutes. Do not share it with anyone.`,
    });
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        },
      );
    } catch (err) {
      throw new OtpDeliveryError(`Twilio request failed: ${(err as Error).name}`, true);
    }
    if (!res.ok) {
      // Twilio error bodies don't contain the code, but we still log only status.
      this.logger.warn(
        `Twilio rejected SMS to ${maskPhone(req.phoneE164)} with HTTP ${res.status}`,
      );
      throw new OtpDeliveryError(
        `Twilio responded with HTTP ${res.status}`,
        res.status >= 500 || res.status === 429,
      );
    }
  }
}
