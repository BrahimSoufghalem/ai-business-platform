export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly resetAfterMs: number;
  readonly now?: () => number;
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

export class AiCircuitBreaker {
  readonly #states = new Map<string, CircuitState>();
  readonly #failureThreshold: number;
  readonly #resetAfterMs: number;
  readonly #now: () => number;

  constructor(options: CircuitBreakerOptions) {
    if (!Number.isSafeInteger(options.failureThreshold) || options.failureThreshold < 1) {
      throw new Error('Circuit breaker failure threshold must be a positive integer.');
    }
    if (!Number.isSafeInteger(options.resetAfterMs) || options.resetAfterMs < 100) {
      throw new Error('Circuit breaker reset window must be at least 100 milliseconds.');
    }
    this.#failureThreshold = options.failureThreshold;
    this.#resetAfterMs = options.resetAfterMs;
    this.#now = options.now ?? Date.now;
  }

  canRequest(key: string): boolean {
    const state = this.#states.get(key);
    if (!state?.openedAt) return true;
    if (this.#now() - state.openedAt < this.#resetAfterMs) return false;
    state.failures = 0;
    state.openedAt = null;
    return true;
  }

  recordSuccess(key: string): void {
    this.#states.delete(key);
  }

  recordFailure(key: string): void {
    const state = this.#states.get(key) ?? { failures: 0, openedAt: null };
    state.failures += 1;
    if (state.failures >= this.#failureThreshold) state.openedAt = this.#now();
    this.#states.set(key, state);
  }

  state(key: string): 'closed' | 'open' {
    return this.canRequest(key) ? 'closed' : 'open';
  }
}
