import { describe, expect, it } from 'vitest';
import {
  alertQuerySchema,
  dashboardQuerySchema,
  traceCorrelationIdSchema,
} from '../src/operations/operations.schemas.js';

describe('operations API schemas', () => {
  it('bounds dashboard and alert windows', () => {
    expect(dashboardQuerySchema.parse({})).toEqual({ range: '30d' });
    expect(alertQuerySchema.parse({ range: '7d', limit: '12' })).toEqual({
      range: '7d',
      limit: 12,
    });
    expect(dashboardQuerySchema.safeParse({ range: '365d' }).success).toBe(false);
    expect(alertQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
  });

  it('accepts safe correlation IDs only', () => {
    expect(traceCorrelationIdSchema.parse('pilot-order_123')).toBe('pilot-order_123');
    expect(traceCorrelationIdSchema.safeParse('contains spaces').success).toBe(false);
    expect(traceCorrelationIdSchema.safeParse('../escape').success).toBe(false);
  });
});
