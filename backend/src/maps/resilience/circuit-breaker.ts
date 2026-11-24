/**
 * Minimal circuit breaker. After `threshold` consecutive failures the circuit opens for
 * `cooldownMs`; during that window calls fail fast instead of hammering a down provider.
 * One trial call is allowed when the cooldown ends (half-open).
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    if (this.openedAt === null) return 'CLOSED';
    return this.now() - this.openedAt >= this.cooldownMs ? 'HALF_OPEN' : 'OPEN';
  }

  canRequest(): boolean {
    return this.state !== 'OPEN';
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.threshold)
      this.openedAt = this.now();
  }
}
