import { sleep } from '../../common/utils/time.util';
import { MapsProviderError } from '../maps.types';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

/** Exponential backoff with full jitter; only retries errors marked retryable. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const base = opts.baseDelayMs ?? 250;
  const cap = opts.maxDelayMs ?? 4000;
  const wait = opts.sleepFn ?? sleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      const retryable = err instanceof MapsProviderError ? err.retryable : false;
      if (!retryable || attempt >= opts.maxRetries) throw err;
      const delay = Math.random() * Math.min(cap, base * 2 ** attempt);
      await wait(delay);
    }
  }
}
