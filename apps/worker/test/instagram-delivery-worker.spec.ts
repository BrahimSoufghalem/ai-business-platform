import { describe, expect, it, vi } from 'vitest';
import { InstagramDeliveryError, type InstagramAdapter } from '@ai-business/integrations';
import type {
  ClaimedInstagramDelivery,
  InstagramDeliveryQueue,
} from '../src/instagram-delivery-queue.js';
import { InstagramDeliveryWorker } from '../src/instagram-delivery-worker.js';

const job: ClaimedInstagramDelivery = {
  jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  recipientId: '99112233',
  content: 'المنتج متوفر.',
  attempts: 1,
  maxAttempts: 5,
  correlationId: 'correlation-1',
  account: {
    id: '17841400000000000',
    status: 'active',
    encryptedToken: {
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'tag',
      keyVersion: 1,
      fingerprint: '0123456789abcdef',
    },
  },
};

function setup(
  claimed: ClaimedInstagramDelivery | null,
  deliver: InstagramAdapter['deliver'] = vi.fn().mockResolvedValue({
    externalMessageId: 'meta-message-1',
    acceptedAt: '2026-09-21T12:00:00.000Z',
  }),
) {
  const queue: InstagramDeliveryQueue = {
    claim: vi.fn().mockResolvedValue(claimed),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue('pending'),
  };
  const adapter: InstagramAdapter = {
    channel: 'instagram',
    deliver,
    verifyWebhookSignature: vi.fn().mockResolvedValue(true),
    normalizeInbound: vi.fn().mockResolvedValue([]),
  };
  const worker = new InstagramDeliveryWorker({
    workerId: 'worker:test',
    queue,
    credentialVault: { decrypt: vi.fn().mockReturnValue('access-token-123') },
    appSecret: 'instagram-app-secret-123456',
    adapterFactory: vi.fn().mockReturnValue(adapter),
    policy: { now: () => new Date('2026-09-21T12:00:00.000Z') },
  });
  return { worker, queue, deliver };
}

describe('InstagramDeliveryWorker', () => {
  it('returns idle when no delivery is due', async () => {
    const { worker, queue } = setup(null);
    await expect(worker.processNext()).resolves.toBe('idle');
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it('completes a successfully delivered message', async () => {
    const { worker, queue, deliver } = setup(job);
    await expect(worker.processNext()).resolves.toBe('delivered');
    expect(deliver).toHaveBeenCalledWith('99112233', { text: 'المنتج متوفر.' });
    expect(queue.complete).toHaveBeenCalledWith(job.jobId, 'worker:test', 'meta-message-1');
  });

  it('persists a retry for a transient provider failure', async () => {
    const deliver = vi
      .fn<InstagramAdapter['deliver']>()
      .mockRejectedValue(new InstagramDeliveryError(503, null, null));
    const { worker, queue } = setup(job, deliver);

    await expect(worker.processNext()).resolves.toBe('retry');
    expect(queue.fail).toHaveBeenCalledWith(
      job.jobId,
      'worker:test',
      'http_503',
      '2026-09-21T12:00:30.000Z',
    );
  });

  it('dead-letters an unavailable tenant connection without a provider call', async () => {
    const unavailable = { ...job, account: null };
    const { worker, queue, deliver } = setup(unavailable);

    await expect(worker.processNext()).resolves.toBe('dead');
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.fail).toHaveBeenCalledWith(
      job.jobId,
      'worker:test',
      'connection_unavailable',
      null,
    );
  });

  it('dead-letters a permanent provider failure', async () => {
    const deliver = vi
      .fn<InstagramAdapter['deliver']>()
      .mockRejectedValue(new InstagramDeliveryError(400, 100, 'OAuthException'));
    const { worker, queue } = setup(job, deliver);

    await expect(worker.processNext()).resolves.toBe('dead');
    expect(queue.fail).toHaveBeenCalledWith(job.jobId, 'worker:test', 'http_400_code_100', null);
  });
});
