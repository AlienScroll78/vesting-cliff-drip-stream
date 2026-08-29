/**
 * backend/src/horizonCircuitBreaker.ts
 *
 * Self-contained circuit breaker for Horizon RPC calls.
 *
 * State machine:
 *
 *   CLOSED ──(≥ threshold consecutive failures)──► OPEN
 *   OPEN   ──(halfOpenAfterMs elapsed)          ──► HALF-OPEN
 *   HALF-OPEN ──(probe succeeds)               ──► CLOSED
 *   HALF-OPEN ──(probe fails)                  ──► OPEN  (reset timer)
 *
 * Configuration (defaults match task requirements):
 *   threshold       – 5 consecutive failures before opening  (default: 5)
 *   halfOpenAfterMs – wait before probing in half-open state (default: 30 000)
 *
 * Usage:
 *
 *   import { horizonCircuitBreaker } from './horizonCircuitBreaker';
 *
 *   const result = await horizonCircuitBreaker.execute(
 *     () => horizonGet(baseUrl, path),
 *   );
 *   // throws CircuitOpenError immediately when circuit is open
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens. Default: 5 */
  threshold?: number;
  /** Milliseconds to wait in OPEN state before probing (half-open). Default: 30 000 */
  halfOpenAfterMs?: number;
}

/** Thrown immediately when the circuit is open and no probe is allowed yet. */
export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open — Horizon is unavailable');
    this.name = 'CircuitOpenError';
  }
}

// ── CircuitBreaker class ──────────────────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;

  private readonly threshold: number;
  private readonly halfOpenAfterMs: number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold       = opts.threshold       ?? 5;
    this.halfOpenAfterMs = opts.halfOpenAfterMs ?? 30_000;
  }

  // ── State access ────────────────────────────────────────────────────────────

  getState(): CircuitState {
    // Lazily transition OPEN → HALF-OPEN when the timeout has elapsed.
    if (
      this.state === 'open' &&
      Date.now() - this.openedAt >= this.halfOpenAfterMs
    ) {
      this.state = 'half-open';
    }
    return this.state;
  }

  // ── Execute ─────────────────────────────────────────────────────────────────

  /**
   * Execute `fn` through the circuit breaker.
   *
   * - CLOSED:    Calls `fn`. On failure increments counter; opens if threshold met.
   * - OPEN:      Throws `CircuitOpenError` immediately without calling `fn`.
   * - HALF-OPEN: Calls `fn` as a probe. On success → CLOSED. On failure → OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'open') {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  // ── Internal state transitions ──────────────────────────────────────────────

  private onSuccess(): void {
    // Any success from CLOSED or HALF-OPEN resets to CLOSED.
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures++;

    if (
      this.state === 'half-open' ||
      this.consecutiveFailures >= this.threshold
    ) {
      this.state    = 'open';
      this.openedAt = Date.now();
      // Reset counter so the next half-open probe counts from zero.
      this.consecutiveFailures = 0;
    }
  }

  // ── Test / admin helpers ────────────────────────────────────────────────────

  /** Force-reset the breaker to CLOSED with zero failures. Useful in tests. */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  /** Force-open the breaker (useful in tests / admin operations). */
  forceOpen(): void {
    this.state    = 'open';
    this.openedAt = Date.now();
    this.consecutiveFailures = 0;
  }

  /** Expose internal counters for testing and observability. */
  getStats(): {
    state: CircuitState;
    consecutiveFailures: number;
    openedAt: number;
    threshold: number;
    halfOpenAfterMs: number;
  } {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      threshold: this.threshold,
      halfOpenAfterMs: this.halfOpenAfterMs,
    };
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────────

/**
 * Shared circuit breaker instance used by horizonGet.
 *
 * Configuration via environment variables:
 *   HORIZON_CB_THRESHOLD        – failure threshold before opening (default: 5)
 *   HORIZON_CB_HALF_OPEN_MS     – ms before half-open probe (default: 30 000)
 */
export const horizonCircuitBreaker = new CircuitBreaker({
  threshold:       parseInt(process.env.HORIZON_CB_THRESHOLD    ?? '5',      10),
  halfOpenAfterMs: parseInt(process.env.HORIZON_CB_HALF_OPEN_MS ?? '30000',  10),
});
