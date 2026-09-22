import { describe, expect, it } from 'vitest';
import {
  adjustInventorySchema,
  balanceQuerySchema,
  receiveInventorySchema,
  reserveInventorySchema,
} from '../src/inventory/inventory.schemas.js';

const locationId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';

describe('inventory API schemas', () => {
  it('coerces balance filters and keeps integer quantities', () => {
    expect(balanceQuerySchema.parse({ lowStock: 'true', limit: '25' })).toMatchObject({
      lowStock: true,
      limit: 25,
    });
    expect(
      receiveInventorySchema.parse({
        locationId,
        variantId,
        quantity: 3,
        idempotencyKey: 'receive-0001',
      }).quantity,
    ).toBe(3);
  });

  it('requires references as a pair', () => {
    expect(() =>
      receiveInventorySchema.parse({
        locationId,
        variantId,
        quantity: 1,
        referenceType: 'purchase_order',
        idempotencyKey: 'receive-0002',
      }),
    ).toThrow();
  });

  it('requires a non-zero adjustment with a reason', () => {
    expect(() =>
      adjustInventorySchema.parse({
        locationId,
        variantId,
        quantityDelta: 0,
        reason: 'Cycle count',
        idempotencyKey: 'adjust-0001',
      }),
    ).toThrow();
    expect(() =>
      adjustInventorySchema.parse({
        locationId,
        variantId,
        quantityDelta: -1,
        idempotencyKey: 'adjust-0002',
      }),
    ).toThrow();
  });

  it('parses a reservation expiry as a Date', () => {
    const parsed = reserveInventorySchema.parse({
      locationId,
      variantId,
      quantity: 1,
      referenceType: 'draft_order',
      referenceId: 'draft-1',
      expiresAt: '2026-09-22T20:00:00+01:00',
      idempotencyKey: 'reserve-0001',
    });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });
});
