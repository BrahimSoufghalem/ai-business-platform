import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/application.js';

describe('API application factory', () => {
  let app: NestFastifyApplication;
  const webOrigin = 'https://web.example.test';
  let previousWebOrigin: string | undefined;

  beforeAll(async () => {
    previousWebOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = `${webOrigin}/`;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:1/not-used';
    app = await createApplication({ enableShutdownHooks: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousWebOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousWebOrigin;
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

  it.each(['PUT', 'DELETE'])('allows %s cross-origin API preflight requests', async (method) => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'OPTIONS',
        url: '/api/tenants/00000000-0000-4000-8000-000000000000/integrations/instagram',
        headers: {
          origin: webOrigin,
          'access-control-request-method': method,
          'access-control-request-headers': 'authorization,content-type,x-correlation-id',
        },
      });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(webOrigin);
    expect(response.headers['access-control-allow-methods']).toContain(method);
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers['access-control-expose-headers']).toBe('X-Correlation-Id');
  });
});
