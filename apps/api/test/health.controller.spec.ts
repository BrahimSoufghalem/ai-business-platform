import { describe, expect, it } from 'vitest';
import { HealthController } from '../src/health/health.controller.js';

describe('HealthController', () => {
  it('reports the API as live', () => {
    const result = new HealthController().liveness();

    expect(result.service).toBe('api');
    expect(result.status).toBe('ok');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
