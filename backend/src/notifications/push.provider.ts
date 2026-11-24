import { Logger } from '@nestjs/common';
import type { App } from 'firebase-admin/app';

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  delivered: number;
  failed: number;
  /** Tokens the provider reported as permanently invalid - callers should delete them. */
  invalidTokens: string[];
  skipped: boolean;
}

export interface PushProvider {
  readonly name: string;
  readonly configured: boolean;
  send(tokens: string[], msg: PushMessage): Promise<PushResult>;
}

/** Used when PUSH_PROVIDER=none: notifications are stored in-app only. */
export class NoopPushProvider implements PushProvider {
  readonly name = 'none';
  readonly configured = false;
  async send(): Promise<PushResult> {
    return { delivered: 0, failed: 0, invalidTokens: [], skipped: true };
  }
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Firebase Cloud Messaging via the Firebase Admin SDK (HTTP v1 API). */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  readonly configured = true;
  private readonly logger = new Logger('FcmPushProvider');
  private app: App | null = null;

  constructor(private readonly serviceAccountBase64: string) {}

  private async getApp(): Promise<App> {
    if (this.app) return this.app;
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const credentials = JSON.parse(
      Buffer.from(this.serviceAccountBase64, 'base64').toString('utf8'),
    ) as Record<string, string>;
    this.app =
      getApps().find((a) => a.name === 'emblemway') ??
      initializeApp({ credential: cert(credentials) }, 'emblemway');
    return this.app;
  }

  async send(tokens: string[], msg: PushMessage): Promise<PushResult> {
    if (tokens.length === 0) return { delivered: 0, failed: 0, invalidTokens: [], skipped: false };
    const { getMessaging } = await import('firebase-admin/messaging');
    const messaging = getMessaging(await this.getApp());
    const res = await messaging.sendEachForMulticast({
      tokens: tokens.slice(0, 500),
      notification: { title: msg.title, body: msg.body },
      data: msg.data,
      android: { priority: 'high', notification: { channelId: 'emblemway-default' } },
    });
    const invalidTokens: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success && r.error && INVALID_TOKEN_CODES.has(r.error.code))
        invalidTokens.push(tokens[i]!);
    });
    if (res.failureCount > 0)
      this.logger.warn(`FCM: ${res.failureCount} of ${tokens.length} deliveries failed`);
    return { delivered: res.successCount, failed: res.failureCount, invalidTokens, skipped: false };
  }
}
