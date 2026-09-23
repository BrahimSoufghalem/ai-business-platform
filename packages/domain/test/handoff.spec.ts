import { describe, expect, it } from 'vitest';
import { classifyCustomerAgentHandoff } from '../src/index.js';

describe('handoff reason classification', () => {
  it.each([
    ['explicit_handoff', 'explicit_customer_request'],
    ['unsafe_input', 'safety_risk'],
    ['tool_failed', 'tool_failure'],
    ['pricing_policy_handoff', 'pricing_policy'],
    ['multi_item_order_change', 'order_exception'],
    ['missing_evidence:price', 'low_confidence'],
    [null, 'unsupported_request'],
  ] as const)('maps %s to %s', (reason, expected) => {
    expect(classifyCustomerAgentHandoff(reason)).toBe(expected);
  });
});
