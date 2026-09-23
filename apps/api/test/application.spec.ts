import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/application.js';

describe('API application factory', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:1/not-used';
    app = await createApplication({ enableShutdownHooks: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots the shared listener/serverless application and exposes liveness', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/api/health/live',
        headers: { 'x-correlation-id': 'deploy-smoke-1' },
      });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-correlation-id']).toBe('deploy-smoke-1');
    expect(response.json()).toMatchObject({ service: 'api', status: 'ok' });
  });
});
