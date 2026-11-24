import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { sleep } from '../common/utils/time.util';

export type Tx = Prisma.TransactionClient;

/** Postgres error codes worth retrying: serialization failure and deadlock. */
const RETRYABLE_PG_CODES = new Set(['40001', '40P01']);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run a transaction and transparently retry on deadlocks / serialization failures
   * (with jittered exponential backoff). All work inside `fn` must be idempotent per attempt.
   */
  async withTransaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opts: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxRetries?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const maxRetries = opts.maxRetries ?? 3;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.$transaction(fn, {
          isolationLevel: opts.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: opts.timeoutMs ?? 15_000,
          maxWait: 5_000,
        });
      } catch (err) {
        if (attempt >= maxRetries || !isRetryableTxError(err)) throw err;
        const backoff = 50 * 2 ** attempt + Math.floor(Math.random() * 50);
        this.logger.warn(
          `Retrying transaction after retryable error (attempt ${attempt + 1}): ${describe(err)}`,
        );
        await sleep(backoff);
      }
    }
  }

  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}

export function isRetryableTxError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2034') return true; // write conflict or deadlock
    const pgCode = (err.meta as { code?: string } | undefined)?.code;
    if (pgCode && RETRYABLE_PG_CODES.has(pgCode)) return true;
    return /deadlock detected|could not serialize/i.test(err.message);
  }
  if (err instanceof Error)
    return /deadlock detected|could not serialize access/i.test(err.message);
  return false;
}

function describe(err: unknown): string {
  return err instanceof Error ? (err.message.split('\n').slice(-1)[0] ?? err.name) : String(err);
}
