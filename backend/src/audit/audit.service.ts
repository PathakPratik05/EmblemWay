import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  ipAddress?: string;
  /** Never include OTPs, tokens or precise coordinates here. */
  metadata?: Record<string, unknown>;
}

const FORBIDDEN_METADATA_KEYS = /otp|code|token|password|secret|latitude|longitude|phone/i;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes an audit record. Failures are logged but never break the business operation. */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          action: entry.action,
          actorUserId: entry.actorUserId ?? null,
          actorRole: entry.actorRole ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId,
          requestId: entry.requestId,
          ipAddress: entry.ipAddress,
          metadata: entry.metadata
            ? (sanitize(entry.metadata) as Prisma.InputJsonValue)
            : undefined,
        },
      });
    } catch (err) {
      if (tx) throw err; // inside a transaction the caller decides
      this.logger.warn(`Failed to write audit log ${entry.action}: ${(err as Error).message}`);
    }
  }
}

export function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = FORBIDDEN_METADATA_KEYS.test(k) ? '[redacted]' : v;
  }
  return out;
}
