import { createHmac } from 'node:crypto';
import { parseTenantId } from '@ai-business/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  InstagramConfigurationError,
  InstagramDeliveryError,
  InstagramLiveAdapter,
  verifyInstagramWebhookChallenge,
} from '../src/instagram-adapter.js';

const appSecret = 'instagram-test-app-secret-123456';
const accessToken = 'instagram-test-access-token';
const accountId = '17841400000000000';
const tenantId = parseTenantId('11111111-1111-4111-8111-111111111111');

function adapter(overrides: Partial<ConstructorParameters<typeof InstagramLiveAdapter>[0]> = {}) {
  return new InstagramLiveAdapter({
    appSecret,
    accessToken,
    accountId,
    ...overrides,
  });
}

describe('InstagramLiveAdapter', () => {
  it('validates the exact raw webhook bytes with X-Hub-Signature-256', async () => {
    const rawBody = Buffer.from('{"message":"مرحبا"}', 'utf8');
    const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

    await expect(adapter().verifyWebhookSignature(rawBody, signature)).resolves.toBe(true);
    await expect(
      adapter().verifyWebhookSignature(Buffer.from('{"message":"tampered"}'), signature),
    ).resolves.toBe(false);
    await expect(adapter().verifyWebhookSignature(rawBody, 'invalid')).resolves.toBe(false);
  });

  it('verifies the Meta subscription challenge without exposing the token', () => {
    expect(
      verifyInstagramWebhookChallenge(
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'verify-token',
          'hub.challenge': 'challenge-123',
        },
        'verify-token',
      ),
    ).toBe('challenge-123');
    expect(
      verifyInstagramWebhookChallenge(
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': 'challenge-123',
        },
        'verify-token',
      ),
    ).toBeNull();
  });

  it('normalizes text and HTTPS media while ignoring echoes and another account', async () => {
    const result = await adapter().normalizeInbound(
      {
        object: 'instagram',
        entry: [
          {
            id: accountId,
            messaging: [
              {
                sender: { id: '99112233' },
                recipient: { id: accountId },
                timestamp: 1_790_000_000_000,
                message: {
                  mid: 'ig-mid-1',
                  text: ' هل المنتج متوفر؟ ',
                  attachments: [
                    { type: 'image', payload: { url: 'https://cdn.example.test/item.jpg' } },
                    { type: 'image', payload: { url: 'http://unsafe.example.test/item.jpg' } },
                  ],
                },
              },
              {
                sender: { id: accountId },
                recipient: { id: '99112233' },
                timestamp: 1_790_000_000_100,
                message: { mid: 'ig-echo', text: 'echo', is_echo: true },
              },
            ],
          },
          {
            id: '17841499999999999',
            messaging: [
              {
                sender: { id: '4455' },
                timestamp: 1_790_000_000_000,
                message: { mid: 'other-account', text: 'ignore' },
              },
            ],
          },
        ],
      },
      tenantId,
    );

    expect(result).toEqual([
      {
        tenantId,
        channel: 'instagram',
        externalMessageId: 'ig-mid-1',
        externalConversationId: '99112233',
        senderId: '99112233',
        receivedAt: new Date(1_790_000_000_000).toISOString(),
        text: 'هل المنتج متوفر؟',
        mediaUrls: ['https://cdn.example.test/item.jpg'],
      },
    ]);
  });

  it('sends a text reply through the versioned Instagram endpoint', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ recipient_id: '99112233', message_id: 'meta-message-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await adapter({
      fetchImplementation,
      now: () => new Date('2026-09-21T12:00:00.000Z'),
    }).deliver('99112233', { text: 'المنتج متوفر.' });

    expect(result).toEqual({
      externalMessageId: 'meta-message-1',
      acceptedAt: '2026-09-21T12:00:00.000Z',
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `https://graph.instagram.com/v26.0/${accountId}/messages`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: '99112233' },
          message: { text: 'المنتج متوفر.' },
        }),
      }),
    );
  });

  it('supports inbound-only configuration but blocks outbound delivery without a token', async () => {
    const inboundOnly = new InstagramLiveAdapter({ appSecret, accountId });

    await expect(
      inboundOnly.deliver('99112233', { text: 'This must not be sent.' }),
    ).rejects.toBeInstanceOf(InstagramConfigurationError);
  });

  it('returns a redacted provider error', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: `Invalid token ${accessToken}`,
            type: 'OAuthException',
            code: 190,
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const error = await adapter({ fetchImplementation })
      .deliver('99112233', { text: 'test' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramDeliveryError);
    expect(String(error)).not.toContain(accessToken);
  });
});
