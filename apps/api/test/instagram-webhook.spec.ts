import { createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/application.js';

const appSecret = 'instagram-webhook-app-secret-123456';
const verifyToken = 'instagram-webhook-verify-token-123456';

function signature(rawBody: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

describe('Instagram webhook boundary', () => {
  let app: NestFastifyApplication;
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const name of [
      'DATABASE_URL',
      'INSTAGRAM_APP_SECRET',
      'INSTAGRAM_VERIFY_TOKEN',
      'INSTAGRAM_WEBHOOK_MAX_BYTES',
    ]) {
      previousEnvironment[name] = process.env[name];
    }
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:1/not-used';
    process.env.INSTAGRAM_APP_SECRET = appSecret;
    process.env.INSTAGRAM_VERIFY_TOKEN = verifyToken;
    process.env.INSTAGRAM_WEBHOOK_MAX_BYTES = '1024';
    app = await createApplication({ enableShutdownHooks: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('completes the Meta subscription challenge', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('challenge-123');
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('rejects an invalid subscription token', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x',
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an invalid signature before parsing malformed JSON', async () => {
    const rawBody = '{"malformed":';
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/webhooks/instagram',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
        },
        payload: rawBody,
      });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      statusCode: 401,
      message: 'Instagram webhook signature is invalid.',
    });
  });

  it('parses JSON only after a valid signature', async () => {
    const rawBody = '{"malformed":';
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/webhooks/instagram',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature(rawBody),
        },
        payload: rawBody,
      });

    expect(response.statusCode).toBe(400);
  });

  it('rejects oversized bodies before JSON parsing', async () => {
    const rawBody = JSON.stringify({ value: 'x'.repeat(1_100) });
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/webhooks/instagram',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature(rawBody),
        },
        payload: rawBody,
      });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      statusCode: 413,
      message: 'Instagram webhook body is too large.',
    });
  });
});
