import { describe, expect, it } from 'vitest';
import {
  confirmDraftOrderSchema,
  createDraftOrderSchema,
  transitionOrderSchema,
  updateDraftOrderSchema,
} from '../src/orders/order.schemas.js';

const variantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';

describe('order API schemas', () => {
  it('normalizes customer contact and Algeria address defaults', () => {
    const parsed = createDraftOrderSchema.parse({
      customerName: 'Customer One',
      customerPhone: '+213 555 12 34 56',
      shippingAddress: { line1: '10 Main Street', city: 'Algiers' },
      items: [{ variantId, locationId, quantity: 2 }],
    });
    expect(parsed.customerPhone).toBe('+213555123456');
    expect(parsed.shippingAddress?.countryCode).toBe('DZ');
  });

  it('requires an actual update and explicit approval', () => {
    expect(() => updateDraftOrderSchema.parse({ expectedVersion: 1 })).toThrow();
    expect(() =>
      confirmDraftOrderSchema.parse({
        expectedVersion: 2,
        customerApproved: false,
        approvalSource: 'customer_message',
        idempotencyKey: 'confirm-draft-1',
      }),
    ).toThrow();
  });

  it('restricts operational transition targets', () => {
    expect(
      transitionOrderSchema.parse({
        targetStatus: 'preparing',
        idempotencyKey: 'prepare-order-1',
      }).targetStatus,
    ).toBe('preparing');
    expect(() =>
      transitionOrderSchema.parse({
        targetStatus: 'cancelled',
        idempotencyKey: 'cancel-through-wrong-route',
      }),
    ).toThrow();
  });
});
