import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/health/health.controller.js';
import type { DatabaseService } from '../src/database/database.service.js';

describe('HealthController', () => {
  it('reports the API as live', () => {
    const database = { client: vi.fn() } as unknown as DatabaseService;
    const result = new HealthController(database).liveness();

    expect(result.service).toBe('api');
    expect(result.status).toBe('ok');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it('reports readiness only when the database responds', async () => {
    const healthy = {
      client: vi.fn(async () => [{ ready: 1 }]),
    } as unknown as DatabaseService;
    await expect(new HealthController(healthy).readiness()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'ok' },
    });

    const unavailable = {
      client: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    } as unknown as DatabaseService;
    await expect(new HealthController(unavailable).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
