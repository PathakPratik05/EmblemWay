export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpSendRequest {
  phoneE164: string;
  code: string;
  ttlSeconds: number;
}

/**
 * Delivery channel for one-time passwords. Implementations must never log the code.
 * EmblemWay generates, hashes and verifies codes itself; providers only deliver them.
 */
export interface OtpSender {
  readonly name: string;
  /**
   * Development-only: a fixed code the provider expects. Real providers return null,
   * which makes the OTP service generate a cryptographically random code.
   */
  fixedCode(): string | null;
  send(req: OtpSendRequest): Promise<void>;
}

export class OtpDeliveryError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OtpDeliveryError';
  }
}
