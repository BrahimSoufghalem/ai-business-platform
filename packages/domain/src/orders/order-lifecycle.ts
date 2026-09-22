import { normalizeMoneyAmount } from '../catalog/product-catalog.js';

export type OrderStatus = 'new' | 'confirmed' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';

export type DraftOrderStatus = 'draft' | 'awaiting_confirmation' | 'confirmed' | 'cancelled';

const transitions: Readonly<Record<OrderStatus, ReadonlySet<OrderStatus>>> = {
  new: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['preparing', 'cancelled']),
  preparing: new Set(['shipped', 'cancelled']),
  shipped: new Set(['delivered']),
  delivered: new Set(),
  cancelled: new Set(),
};

const maximumMinorAmount = 99_999_999_999_999n;

export class InvalidOrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Order cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidOrderTransitionError';
  }
}

export interface OrderLineAmountInput {
  readonly unitPrice: string;
  readonly quantity: number;
}

export interface CalculatedOrderLine {
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
}

export interface CalculatedOrderTotals {
  readonly lines: readonly CalculatedOrderLine[];
  readonly subtotal: string;
  readonly discountAmount: string;
  readonly shippingAmount: string;
  readonly total: string;
}

function toMinorAmount(value: string): bigint {
  const normalized = normalizeMoneyAmount(value);
  const [whole = '0', fraction = '00'] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function fromMinorAmount(value: bigint): string {
  if (value < 0n || value > maximumMinorAmount) {
    throw new Error('Calculated money amount is outside the supported range.');
  }
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].has(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}

export function calculateOrderTotals(
  lines: readonly OrderLineAmountInput[],
  options: {
    readonly discountAmount?: string;
    readonly shippingAmount?: string;
  } = {},
): CalculatedOrderTotals {
  if (lines.length === 0) throw new Error('An order must contain at least one item.');

  let subtotalMinor = 0n;
  const calculatedLines = lines.map((line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('Order quantities must be positive integers.');
    }
    const unitPrice = normalizeMoneyAmount(line.unitPrice);
    const lineTotalMinor = toMinorAmount(unitPrice) * BigInt(line.quantity);
    const lineTotal = fromMinorAmount(lineTotalMinor);
    subtotalMinor += lineTotalMinor;
    if (subtotalMinor > maximumMinorAmount) {
      throw new Error('Order subtotal is outside the supported range.');
    }
    return { unitPrice, quantity: line.quantity, lineTotal };
  });

  const discountMinor = toMinorAmount(options.discountAmount ?? '0');
  const shippingMinor = toMinorAmount(options.shippingAmount ?? '0');
  if (discountMinor > subtotalMinor) {
    throw new Error('Order discount cannot exceed the subtotal.');
  }
  const totalMinor = subtotalMinor - discountMinor + shippingMinor;

  return {
    lines: calculatedLines,
    subtotal: fromMinorAmount(subtotalMinor),
    discountAmount: fromMinorAmount(discountMinor),
    shippingAmount: fromMinorAmount(shippingMinor),
    total: fromMinorAmount(totalMinor),
  };
}
