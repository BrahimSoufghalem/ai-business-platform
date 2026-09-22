import { describe, expect, it } from 'vitest';
import { evaluatePriceDecision, normalizePricingPolicy } from '../src/index.js';

const reference = {
  ruleSetId: 'rule-set-1',
  ruleVersionId: 'rule-version-4',
  version: 4,
};

const policy = normalizePricingPolicy({
  currency: 'dzd',
  negotiable: true,
  minimumPrice: { type: 'percentage_of_list', percentage: 85 },
  maxDiscountPercent: 10,
  escalation: {
    belowMinimum: 'counter',
    whenNotNegotiable: 'reject',
    maxCounterOffers: 2,
  },
});

describe('typed pricing policy', () => {
  it('accepts an offer inside the published limits and includes its version reference', () => {
    expect(
      evaluatePriceDecision(policy, reference, {
        currency: 'DZD',
        listPrice: '100000',
        requestedPrice: '92000',
      }),
    ).toEqual({
      rule: reference,
      currency: 'DZD',
      listPrice: '100000.00',
      requestedPrice: '92000.00',
      minimumPrice: '85000.00',
      maxDiscountPrice: '90000.00',
      lowestAllowedPrice: '90000.00',
      decidedPrice: '92000.00',
      outcome: 'accept',
      reason: 'within_policy',
    });
  });

  it('counters below the stricter floor and never drops the rule reference', () => {
    const decision = evaluatePriceDecision(policy, reference, {
      currency: 'DZD',
      listPrice: '999.99',
      requestedPrice: '800',
    });
    expect(decision.outcome).toBe('counter');
    expect(decision.decidedPrice).toBe('900.00');
    expect(decision.rule).toEqual(reference);
  });

  it('rejects an invalid currency, missing reference, or unsafe policy bounds', () => {
    expect(() =>
      evaluatePriceDecision(
        policy,
        { ...reference, version: 0 },
        {
          currency: 'DZD',
          listPrice: '100',
          requestedPrice: '90',
        },
      ),
    ).toThrow('published rule');
    expect(() =>
      evaluatePriceDecision(policy, reference, {
        currency: 'USD',
        listPrice: '100',
        requestedPrice: '90',
      }),
    ).toThrow('currency');
    expect(() => normalizePricingPolicy({ ...policy, maxDiscountPercent: 101 })).toThrow();
    expect(() =>
      normalizePricingPolicy({
        ...policy,
        escalation: {
          ...policy.escalation,
          belowMinimum: 'execute_code' as 'counter',
        },
      }),
    ).toThrow('escalation');
  });
});
