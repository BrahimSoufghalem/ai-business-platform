import type { DeliveryResult, InstagramAdapter } from './index.js';
import {
  InstagramConfigurationError,
  InstagramDeliveryError,
  InstagramPayloadError,
} from './instagram-adapter.js';

const DEFAULT_BASE_DELAY_MS = 30_000;
const DEFAULT_MAX_DELAY_MS = 30 * 60_000;
const TRANSIENT_PROVIDER_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export interface InstagramDeliveryAttempt {
  readonly conversationId: string;
  readonly text: string;
  /** Attempts already persisted before this call. */
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface InstagramDeliveryPolicyOptions {
  readonly now?: () => Date;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export type InstagramDeliveryDisposition =
  | {
      readonly status: 'delivered';
      readonly attempts: number;
      readonly result: DeliveryResult;
    }
  | {
      readonly status: 'retry';
      readonly attempts: number;
      readonly availableAt: string;
      readonly delayMs: number;
      readonly errorCode: string;
    }
  | {
      readonly status: 'dead';
      readonly attempts: number;
      readonly errorCode: string;
    };

interface FailureClassification {
  readonly retryable: boolean;
  readonly code: string;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function sanitizeProviderCode(error: InstagramDeliveryError): string {
  if (error.providerCode === null) return `http_${error.status}`;
  return `http_${error.status}_code_${error.providerCode}`;
}

export function classifyInstagramDeliveryFailure(error: unknown): FailureClassification {
  if (error instanceof InstagramDeliveryError) {
    if (error.status === 0) {
      return {
        retryable: true,
        code: error.providerType === 'timeout' ? 'timeout' : 'network_error',
      };
    }
    return {
      retryable:
        error.status === 408 ||
        error.status === 429 ||
        error.status >= 500 ||
        (error.providerCode !== null && TRANSIENT_PROVIDER_CODES.has(error.providerCode)),
      code: sanitizeProviderCode(error),
    };
  }
  if (error instanceof InstagramConfigurationError) {
    return { retryable: false, code: 'configuration_error' };
  }
  if (error instanceof InstagramPayloadError) {
    return { retryable: false, code: 'payload_error' };
  }
  return { retryable: false, code: 'unexpected_error' };
}

/**
 * Performs exactly one provider call. The caller persists the returned disposition,
 * so retries survive restarts and never block a worker with an in-memory loop.
 */
export async function attemptInstagramDelivery(
  adapter: InstagramAdapter,
  attempt: InstagramDeliveryAttempt,
  options: InstagramDeliveryPolicyOptions = {},
): Promise<InstagramDeliveryDisposition> {
  if (!Number.isSafeInteger(attempt.attempts) || attempt.attempts < 0) {
    throw new RangeError('attempts must be a non-negative integer.');
  }
  assertPositiveInteger(attempt.maxAttempts, 'maxAttempts');
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  assertPositiveInteger(baseDelayMs, 'baseDelayMs');
  assertPositiveInteger(maxDelayMs, 'maxDelayMs');
  if (baseDelayMs > maxDelayMs) {
    throw new RangeError('baseDelayMs must not exceed maxDelayMs.');
  }

  const attempts = attempt.attempts + 1;
  try {
    const result = await adapter.deliver(attempt.conversationId, { text: attempt.text });
    return { status: 'delivered', attempts, result };
  } catch (error) {
    const classification = classifyInstagramDeliveryFailure(error);
    if (!classification.retryable || attempts >= attempt.maxAttempts) {
      return { status: 'dead', attempts, errorCode: classification.code };
    }

    const delayMs = Math.min(baseDelayMs * 2 ** Math.min(attempts - 1, 30), maxDelayMs);
    const now = options.now?.() ?? new Date();
    return {
      status: 'retry',
      attempts,
      delayMs,
      availableAt: new Date(now.getTime() + delayMs).toISOString(),
      errorCode: classification.code,
    };
  }
}
