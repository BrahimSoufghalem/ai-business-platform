import { describe, expect, it } from 'vitest';
import {
  SlidingWindowRateLimiter,
  normalizeRateLimitPath,
} from '../src/observability/rate-limit.guard.js';

describe('pilot rate limiting', () => {
  it('limits one normalized route within a sliding window and recovers', () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(1_000, () => now);
    expect(limiter.consume('member:POST:/agent-reply', 2)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume('member:POST:/agent-reply', 2)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume('member:POST:/agent-reply', 2)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    now = 2_001;
    expect(limiter.consume('member:POST:/agent-reply', 2)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it('normalizes identifiers without preserving query values', () => {
    expect(
      normalizeRateLimitPath(
        '/api/tenants/12121212-1212-4121-8121-121212121212/orders/42?token=secret',
      ),
    ).toBe('/api/tenants/:id/orders/:id');
  });
});
