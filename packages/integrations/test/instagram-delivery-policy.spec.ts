import { describe, expect, it, vi } from 'vitest';
import type { InstagramAdapter } from '../src/index.js';
import {
  attemptInstagramDelivery,
  InstagramConfigurationError,
  InstagramDeliveryError,
} from '../src/index.js';

function adapter(deliver: InstagramAdapter['deliver']): InstagramAdapter {
  return {
    channel: 'instagram',
    deliver,
    verifyWebhookSignature: vi.fn().mockResolvedValue(true),
    normalizeInbound: vi.fn().mockResolvedValue([]),
  };
}

const attempt = {
  conversationId: '99112233',
  text: 'المنتج متوفر.',
  attempts: 0,
  maxAttempts: 5,
} as const;

describe('attemptInstagramDelivery', () => {
  it('returns a delivered disposition after one provider call', async () => {
    const deliver = vi.fn<InstagramAdapter['deliver']>().mockResolvedValue({
      externalMessageId: 'meta-message-1',
      acceptedAt: '2026-09-21T12:00:00.000Z',
    });

    await expect(attemptInstagramDelivery(adapter(deliver), attempt)).resolves.toEqual({
      status: 'delivered',
      attempts: 1,
      result: {
        externalMessageId: 'meta-message-1',
        acceptedAt: '2026-09-21T12:00:00.000Z',
      },
    });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, 4, 'http_429_code_4'],
    [503, null, 'http_503'],
    [400, 613, 'http_400_code_613'],
  ])('schedules a durable retry for transient HTTP %s', async (status, code, errorCode) => {
    const deliver = vi
      .fn<InstagramAdapter['deliver']>()
      .mockRejectedValue(new InstagramDeliveryError(status, code, 'provider'));

    await expect(
      attemptInstagramDelivery(adapter(deliver), attempt, {
        now: () => new Date('2026-09-21T12:00:00.000Z'),
      }),
    ).resolves.toEqual({
      status: 'retry',
      attempts: 1,
      availableAt: '2026-09-21T12:00:30.000Z',
      delayMs: 30_000,
      errorCode,
    });
  });

  it('applies capped exponential backoff', async () => {
    const deliver = vi
      .fn<InstagramAdapter['deliver']>()
      .mockRejectedValue(new InstagramDeliveryError(500, null, null));

    await expect(
      attemptInstagramDelivery(
        adapter(deliver),
        { ...attempt, attempts: 3 },
        {
          now: () => new Date('2026-09-21T12:00:00.000Z'),
          baseDelayMs: 30_000,
          maxDelayMs: 100_000,
        },
      ),
    ).resolves.toMatchObject({
      status: 'retry',
      attempts: 4,
      availableAt: '2026-09-21T12:01:40.000Z',
      delayMs: 100_000,
    });
  });

  it('dead-letters permanent failures without exposing their message', async () => {
    const secret = 'private-access-token';
    const deliver = vi
      .fn<InstagramAdapter['deliver']>()
      .mockRejectedValue(new InstagramConfigurationError(`Invalid ${secret}`));

    const result = await attemptInstagramDelivery(adapter(deliver), attempt);

    expect(result).toEqual({
      status: 'dead',
      attempts: 1,
      errorCode: 'configuration_error',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('dead-letters a transient failure after the final allowed attempt', async () => {
    const deliver = vi
      .fn<InstagramAdapter['deliver']>()
      .mockRejectedValue(new InstagramDeliveryError(503, null, null));

    await expect(
      attemptInstagramDelivery(adapter(deliver), { ...attempt, attempts: 4 }),
    ).resolves.toEqual({
      status: 'dead',
      attempts: 5,
      errorCode: 'http_503',
    });
  });

  it('dead-letters permanent provider errors immediately', async () => {
    const deliver = vi
      .fn<InstagramAdapter['deliver']>()
      .mockRejectedValue(new InstagramDeliveryError(400, 100, 'OAuthException'));

    await expect(attemptInstagramDelivery(adapter(deliver), attempt)).resolves.toEqual({
      status: 'dead',
      attempts: 1,
      errorCode: 'http_400_code_100',
    });
  });
});
