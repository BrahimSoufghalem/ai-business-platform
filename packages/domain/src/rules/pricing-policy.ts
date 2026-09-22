import { normalizeMoneyAmount } from '../catalog/product-catalog.js';

export type MinimumPriceRule =
  | { readonly type: 'fixed'; readonly amount: string }
  | { readonly type: 'percentage_of_list'; readonly percentage: number };

export interface PricingPolicy {
  readonly currency: string;
  readonly negotiable: boolean;
  readonly minimumPrice: MinimumPriceRule;
  readonly maxDiscountPercent: number;
  readonly escalation: {
    readonly belowMinimum: 'counter' | 'handoff' | 'reject';
    readonly whenNotNegotiable: 'handoff' | 'reject';
    readonly maxCounterOffers: number;
  };
}

export interface PublishedRuleReference {
  readonly ruleSetId: string;
  readonly ruleVersionId: string;
  readonly version: number;
}

export type PriceDecisionOutcome = 'accept' | 'counter' | 'handoff' | 'reject';

export interface PriceDecision {
  readonly rule: PublishedRuleReference;
  readonly currency: string;
  readonly listPrice: string;
  readonly requestedPrice: string;
  readonly minimumPrice: string;
  readonly maxDiscountPrice: string;
  readonly lowestAllowedPrice: string;
  readonly decidedPrice: string | null;
  readonly outcome: PriceDecisionOutcome;
  readonly reason:
    | 'at_or_above_list'
    | 'within_policy'
    | 'below_minimum_counter'
    | 'below_minimum_handoff'
    | 'below_minimum_reject'
    | 'not_negotiable_handoff'
    | 'not_negotiable_reject';
}

const maximumMinorAmount = 99_999_999_999_999n;

function toMinor(value: string): bigint {
  const normalized = normalizeMoneyAmount(value);
  const [whole = '0', fraction = '00'] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function fromMinor(value: bigint): string {
  if (value < 0n || value > maximumMinorAmount) {
    throw new Error('Calculated price is outside the supported range.');
  }
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function percentageFloor(listPriceMinor: bigint, percentage: number): bigint {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('Price percentages must be between 0 and 100.');
  }
  const basisPoints = BigInt(Math.round(percentage * 100));
  return (listPriceMinor * basisPoints + 9_999n) / 10_000n;
}

export function normalizePricingPolicy(policy: PricingPolicy): PricingPolicy {
  const currency = policy.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('Pricing policy currency must be a 3-letter ISO code.');
  }
  if (typeof policy.negotiable !== 'boolean') {
    throw new Error('Negotiable must be a boolean.');
  }
  if (policy.minimumPrice.type !== 'fixed' && policy.minimumPrice.type !== 'percentage_of_list') {
    throw new Error('Minimum price type is not supported.');
  }
  if (!['counter', 'handoff', 'reject'].includes(policy.escalation.belowMinimum)) {
    throw new Error('Below-minimum escalation is not supported.');
  }
  if (!['handoff', 'reject'].includes(policy.escalation.whenNotNegotiable)) {
    throw new Error('Non-negotiable escalation is not supported.');
  }
  if (
    !Number.isFinite(policy.maxDiscountPercent) ||
    policy.maxDiscountPercent < 0 ||
    policy.maxDiscountPercent > 100
  ) {
    throw new Error('Maximum discount must be between 0 and 100 percent.');
  }
  if (
    !Number.isSafeInteger(policy.escalation.maxCounterOffers) ||
    policy.escalation.maxCounterOffers < 0 ||
    policy.escalation.maxCounterOffers > 10
  ) {
    throw new Error('Maximum counter offers must be an integer from 0 to 10.');
  }
  const minimumPrice =
    policy.minimumPrice.type === 'fixed'
      ? {
          type: 'fixed' as const,
          amount: normalizeMoneyAmount(policy.minimumPrice.amount),
        }
      : {
          type: 'percentage_of_list' as const,
          percentage: policy.minimumPrice.percentage,
        };
  if (
    minimumPrice.type === 'percentage_of_list' &&
    (!Number.isFinite(minimumPrice.percentage) ||
      minimumPrice.percentage < 0 ||
      minimumPrice.percentage > 100)
  ) {
    throw new Error('Minimum price percentage must be between 0 and 100.');
  }
  return {
    currency,
    negotiable: policy.negotiable,
    minimumPrice,
    maxDiscountPercent: Math.round(policy.maxDiscountPercent * 100) / 100,
    escalation: { ...policy.escalation },
  };
}

export function evaluatePriceDecision(
  policyInput: PricingPolicy,
  reference: PublishedRuleReference,
  input: {
    readonly currency: string;
    readonly listPrice: string;
    readonly requestedPrice: string;
  },
): PriceDecision {
  if (
    !reference.ruleSetId ||
    !reference.ruleVersionId ||
    !Number.isSafeInteger(reference.version) ||
    reference.version <= 0
  ) {
    throw new Error('A published rule version reference is required.');
  }
  const policy = normalizePricingPolicy(policyInput);
  const currency = input.currency.trim().toUpperCase();
  if (currency !== policy.currency) {
    throw new Error('Price decision currency does not match the published rule.');
  }
  const listPrice = normalizeMoneyAmount(input.listPrice);
  const requestedPrice = normalizeMoneyAmount(input.requestedPrice);
  const listMinor = toMinor(listPrice);
  const requestedMinor = toMinor(requestedPrice);
  const minimumMinor =
    policy.minimumPrice.type === 'fixed'
      ? toMinor(policy.minimumPrice.amount)
      : percentageFloor(listMinor, policy.minimumPrice.percentage);
  if (minimumMinor > listMinor) {
    throw new Error('Published minimum price cannot exceed this product list price.');
  }
  const maxDiscountPriceMinor = percentageFloor(listMinor, 100 - policy.maxDiscountPercent);
  const lowestAllowedMinor =
    minimumMinor > maxDiscountPriceMinor ? minimumMinor : maxDiscountPriceMinor;
  const common = {
    rule: reference,
    currency,
    listPrice,
    requestedPrice,
    minimumPrice: fromMinor(minimumMinor),
    maxDiscountPrice: fromMinor(maxDiscountPriceMinor),
    lowestAllowedPrice: fromMinor(lowestAllowedMinor),
  } as const;

  if (requestedMinor >= listMinor) {
    return {
      ...common,
      decidedPrice: listPrice,
      outcome: 'accept',
      reason: 'at_or_above_list',
    };
  }
  if (!policy.negotiable) {
    const handoff = policy.escalation.whenNotNegotiable === 'handoff';
    return {
      ...common,
      decidedPrice: null,
      outcome: handoff ? 'handoff' : 'reject',
      reason: handoff ? 'not_negotiable_handoff' : 'not_negotiable_reject',
    };
  }
  if (requestedMinor >= lowestAllowedMinor) {
    return {
      ...common,
      decidedPrice: requestedPrice,
      outcome: 'accept',
      reason: 'within_policy',
    };
  }
  if (policy.escalation.belowMinimum === 'counter') {
    return {
      ...common,
      decidedPrice: fromMinor(lowestAllowedMinor),
      outcome: 'counter',
      reason: 'below_minimum_counter',
    };
  }
  const handoff = policy.escalation.belowMinimum === 'handoff';
  return {
    ...common,
    decidedPrice: null,
    outcome: handoff ? 'handoff' : 'reject',
    reason: handoff ? 'below_minimum_handoff' : 'below_minimum_reject',
  };
}
