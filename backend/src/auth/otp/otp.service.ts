import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { generateNumericCode, hmacSha256, safeEqualHex } from '../../common/utils/crypto.util';
import { maskPhone } from '../../common/utils/phone.util';
import { addSeconds } from '../../common/utils/time.util';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_SENDER, OtpDeliveryError, OtpSender } from './otp-sender';

export interface OtpChallenge {
  requestId: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  codeLength: number;
}

/** Hard cap on failed verifications per phone per hour across all codes (anti brute-force). */
const MAX_FAILED_VERIFICATIONS_PER_HOUR = 10;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  private hash(requestId: string, code: string): string {
    // Binding the hash to the request id means a leaked hash can't be replayed for another challenge.
    return hmacSha256(this.config.get('HASH_PEPPER'), `otp:${requestId}:${code}`);
  }

  async request(
    phoneE164: string,
    ipAddress: string | undefined,
    now = new Date(),
  ): Promise<OtpChallenge> {
    const hourAgo = new Date(now.getTime() - 3_600_000);

    const latest = await this.prisma.otpVerification.findFirst({
      where: { phoneE164, consumedAt: null, supersededAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.resendAvailableAt > now) {
      const wait = Math.ceil((latest.resendAvailableAt.getTime() - now.getTime()) / 1000);
      throw AppError.tooMany(
        `Please wait ${wait}s before requesting another code`,
        ErrorCode.OTP_RESEND_COOLDOWN,
        wait,
      );
    }

    const [sendsForPhone, sendsForIp] = await Promise.all([
      this.prisma.otpVerification.count({ where: { phoneE164, createdAt: { gte: hourAgo } } }),
      ipAddress
        ? this.prisma.otpVerification.count({ where: { ipAddress, createdAt: { gte: hourAgo } } })
        : Promise.resolve(0),
    ]);
    if (
      sendsForPhone >= this.config.get('OTP_MAX_SENDS_PER_HOUR') ||
      sendsForIp >= this.config.get('OTP_MAX_SENDS_PER_IP_PER_HOUR')
    ) {
      throw AppError.tooMany(
        'Too many verification codes requested. Try again later.',
        ErrorCode.OTP_SEND_LIMIT,
        3600,
      );
    }

    const length = this.config.get('OTP_LENGTH');
    const code = this.sender.fixedCode() ?? generateNumericCode(length);
    const ttl = this.config.get('OTP_TTL_SECONDS');
    const expiresAt = addSeconds(now, ttl);
    const resendAvailableAt = addSeconds(now, this.config.get('OTP_RESEND_COOLDOWN_SECONDS'));

    const created = await this.prisma.$transaction(async (tx) => {
      // Any previous outstanding code for this number stops working immediately.
      await tx.otpVerification.updateMany({
        where: { phoneE164, consumedAt: null, supersededAt: null },
        data: { supersededAt: now },
      });
      const row = await tx.otpVerification.create({
        data: {
          phoneE164,
          codeHash: '0'.repeat(64), // replaced below once the id is known
          maxAttempts: this.config.get('OTP_MAX_ATTEMPTS'),
          expiresAt,
          resendAvailableAt,
          ipAddress,
          provider: this.sender.name,
          createdAt: now,
        },
      });
      return tx.otpVerification.update({
        where: { id: row.id },
        data: { codeHash: this.hash(row.id, code) },
      });
    });

    try {
      await this.sender.send({ phoneE164, code, ttlSeconds: ttl });
    } catch (err) {
      // Don't leave a usable challenge behind if delivery failed.
      await this.prisma.otpVerification.update({
        where: { id: created.id },
        data: { supersededAt: new Date() },
      });
      const retryable = err instanceof OtpDeliveryError ? err.retryable : true;
      this.logger.warn(`OTP delivery to ${maskPhone(phoneE164)} failed (retryable=${retryable})`);
      throw new AppError(
        ErrorCode.OTP_DELIVERY_FAILED,
        'We could not send the verification code. Please try again.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { requestId: created.id, expiresAt, resendAvailableAt, codeLength: length };
  }

  /**
   * Validates a code WITHOUT consuming it. Failed attempts are counted atomically and the
   * challenge locks after OTP_MAX_ATTEMPTS. Call `consume` once the caller has decided to
   * accept the login - this prevents both replay and losing a valid code on a recoverable error.
   */
  async check(
    requestId: string,
    code: string,
    now = new Date(),
  ): Promise<{ otpId: string; phoneE164: string }> {
    const otp = await this.prisma.otpVerification.findUnique({ where: { id: requestId } });
    if (!otp)
      throw new AppError(
        ErrorCode.OTP_INVALID,
        'Invalid or unknown verification request',
        HttpStatus.BAD_REQUEST,
      );
    if (otp.consumedAt)
      throw new AppError(
        ErrorCode.OTP_ALREADY_USED,
        'This code has already been used',
        HttpStatus.BAD_REQUEST,
      );
    if (otp.supersededAt)
      throw new AppError(
        ErrorCode.OTP_EXPIRED,
        'A newer code was requested. Use the latest code.',
        HttpStatus.BAD_REQUEST,
      );
    if (otp.lockedAt || otp.attempts >= otp.maxAttempts) {
      throw new AppError(
        ErrorCode.OTP_LOCKED,
        'Too many incorrect attempts. Request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (otp.expiresAt <= now)
      throw new AppError(
        ErrorCode.OTP_EXPIRED,
        'This code has expired. Request a new one.',
        HttpStatus.BAD_REQUEST,
      );

    const hourAgo = new Date(now.getTime() - 3_600_000);
    const failedRecently = await this.prisma.otpVerification.aggregate({
      where: { phoneE164: otp.phoneE164, createdAt: { gte: hourAgo } },
      _sum: { attempts: true },
    });
    if ((failedRecently._sum.attempts ?? 0) >= MAX_FAILED_VERIFICATIONS_PER_HOUR) {
      throw AppError.tooMany(
        'Too many incorrect attempts. Try again later.',
        ErrorCode.OTP_LOCKED,
        3600,
      );
    }

    const normalized = code.trim();
    if (!/^\d+$/.test(normalized) || !safeEqualHex(this.hash(otp.id, normalized), otp.codeHash)) {
      // Atomic increment guarded by the attempt ceiling (safe under concurrent guesses).
      const updated = await this.prisma.$queryRaw<
        Array<{ attempts: number; max_attempts: number }>
      >`
        UPDATE otp_verifications
           SET attempts = attempts + 1,
               locked_at = CASE WHEN attempts + 1 >= max_attempts THEN now() ELSE locked_at END
         WHERE id = ${otp.id}::uuid AND attempts < max_attempts AND consumed_at IS NULL
     RETURNING attempts, max_attempts`;
      const row = updated[0];
      const remaining = row ? Math.max(0, row.max_attempts - row.attempts) : 0;
      if (remaining === 0) {
        throw new AppError(
          ErrorCode.OTP_LOCKED,
          'Too many incorrect attempts. Request a new code.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new AppError(
        ErrorCode.OTP_INVALID,
        'Incorrect verification code',
        HttpStatus.BAD_REQUEST,
        { remainingAttempts: remaining },
      );
    }
    return { otpId: otp.id, phoneE164: otp.phoneE164 };
  }

  /** Marks the code as used. Exactly one caller can win (prevents replay / double login). */
  async consume(otpId: string, now = new Date()): Promise<void> {
    const res = await this.prisma.otpVerification.updateMany({
      where: {
        id: otpId,
        consumedAt: null,
        lockedAt: null,
        supersededAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (res.count !== 1)
      throw new AppError(
        ErrorCode.OTP_ALREADY_USED,
        'This code has already been used',
        HttpStatus.BAD_REQUEST,
      );
  }

  /** Retention: OTP rows are useless after a day; remove them. */
  async purgeOlderThan(cutoff: Date): Promise<number> {
    const res = await this.prisma.otpVerification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return res.count;
  }
}
