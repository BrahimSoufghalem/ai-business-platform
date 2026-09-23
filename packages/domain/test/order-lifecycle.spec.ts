import { describe, expect, it } from 'vitest';
import {
  InvalidOrderTransitionError,
  assertOrderTransition,
  calculateOrderTotals,
  calculateQuotedOrderTotals,
  canTransitionOrder,
} from '../src/index.js';

describe('order lifecycle', () => {
  it('allows the operational path and rejects skipped or terminal transitions', () => {
    expect(canTransitionOrder('new', 'confirmed')).toBe(true);
    expect(canTransitionOrder('confirmed', 'preparing')).toBe(true);
    expect(canTransitionOrder('preparing', 'shipped')).toBe(true);
    expect(canTransitionOrder('shipped', 'delivered')).toBe(true);
    expect(canTransitionOrder('confirmed', 'cancelled')).toBe(true);

    expect(() => assertOrderTransition('confirmed', 'delivered')).toThrow(
      InvalidOrderTransitionError,
    );
    expect(() => assertOrderTransition('delivered', 'cancelled')).toThrow(
      InvalidOrderTransitionError,
    );
  });

  it('calculates decimal totals using exact minor-unit arithmetic', () => {
    expect(
      calculateOrderTotals(
        [
          { unitPrice: '0.10', quantity: 3 },
          { unitPrice: '1250.5', quantity: 2 },
        ],
        { discountAmount: '0.20', shippingAmount: '400' },
      ),
    ).toEqual({
      lines: [
        { unitPrice: '0.10', quantity: 3, lineTotal: '0.30' },
        { unitPrice: '1250.50', quantity: 2, lineTotal: '2501.00' },
      ],
      subtotal: '2501.30',
      discountAmount: '0.20',
      shippingAmount: '400.00',
      total: '2901.10',
    });
  });

  it('rejects invalid quantities and discounts larger than the subtotal', () => {
    expect(() => calculateOrderTotals([{ unitPrice: '10', quantity: 0 }])).toThrow(
      'positive integers',
    );
    expect(() =>
      calculateOrderTotals([{ unitPrice: '10', quantity: 1 }], {
        discountAmount: '10.01',
      }),
    ).toThrow('cannot exceed');
  });

  it('derives negotiated discounts from list and final unit prices', () => {
    expect(
      calculateQuotedOrderTotals(
        [
          { listPrice: '100.00', unitPrice: '90.00', quantity: 2 },
          { listPrice: '50.00', unitPrice: '50.00', quantity: 1 },
        ],
        { shippingAmount: '5.00' },
      ),
    ).toEqual({
      lines: [
        { listPrice: '100.00', unitPrice: '90.00', quantity: 2, lineTotal: '180.00' },
        { listPrice: '50.00', unitPrice: '50.00', quantity: 1, lineTotal: '50.00' },
      ],
      subtotal: '250.00',
      discountAmount: '20.00',
      shippingAmount: '5.00',
      total: '235.00',
    });
    expect(() =>
      calculateQuotedOrderTotals([{ listPrice: '100.00', unitPrice: '101.00', quantity: 1 }]),
    ).toThrow('cannot exceed');
  });
});
