import { Logger } from '@nestjs/common';
import { CircuitBreaker } from '../resilience/circuit-breaker';
import { withRetry } from '../resilience/retry.util';
import { MapsProviderError } from '../maps.types';

export interface GoogleHttpOptions {
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface GoogleRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * HTTP transport shared by all Google Maps Platform providers: per-attempt timeout,
 * retries with exponential backoff for transient errors, a circuit breaker per API,
 * and mapping of Google error statuses to MapsProviderError kinds.
 * The API key is sent in a header and never logged.
 */
export class GoogleHttpClient {
  private readonly logger = new Logger('GoogleHttpClient');
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: GoogleHttpOptions,
    readonly breaker = new CircuitBreaker(5, 30_000),
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T>(req: GoogleRequest, label: string): Promise<T> {
    if (!this.breaker.canRequest()) {
      throw new MapsProviderError(
        'UNAVAILABLE',
        `${label}: provider circuit open after repeated failures`,
      );
    }
    try {
      const result = await withRetry((attempt) => this.once<T>(req, label, attempt), {
        maxRetries: this.opts.maxRetries,
        sleepFn: this.opts.sleepFn,
      });
      this.breaker.recordSuccess();
      return result;
    } catch (err) {
      if (
        err instanceof MapsProviderError &&
        (err.kind === 'UNAVAILABLE' || err.kind === 'TIMEOUT')
      ) {
        this.breaker.recordFailure();
      }
      throw err;
    }
  }

  private async once<T>(req: GoogleRequest, label: string, attempt: number): Promise<T> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(req.url, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', ...req.headers },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (err) {
      const name = (err as Error).name;
      const kind = name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE';
      this.logger.warn(
        { label, attempt, kind, ms: Date.now() - started },
        'Google API network failure',
      );
      throw new MapsProviderError(
        kind,
        `${label}: ${kind === 'TIMEOUT' ? 'request timed out' : 'network error'}`,
      );
    }
    const text = await res.text();
    const ms = Date.now() - started;
    if (res.ok) {
      this.logger.debug({ label, attempt, status: res.status, ms }, 'Google API call');
      try {
        return (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new MapsProviderError('UNAVAILABLE', `${label}: malformed JSON response`, res.status);
      }
    }
    const googleStatus = extractGoogleStatus(text);
    this.logger.warn(
      { label, attempt, status: res.status, googleStatus, ms },
      'Google API error response',
    );
    throw new MapsProviderError(
      mapHttpStatus(res.status, googleStatus),
      `${label}: HTTP ${res.status}${googleStatus ? ` ${googleStatus}` : ''}`,
      res.status,
    );
  }
}

export function mapHttpStatus(status: number, googleStatus?: string): MapsProviderError['kind'] {
  if (status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') return 'QUOTA';
  if (status === 404 || googleStatus === 'NOT_FOUND') return 'NOT_FOUND';
  if (status >= 500) return 'UNAVAILABLE';
  // 401/403: key invalid / API not enabled / restrictions - a configuration problem, not retryable.
  return 'REJECTED';
}

function extractGoogleStatus(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { status?: string } };
    return parsed.error?.status;
  } catch {
    return undefined;
  }
}
