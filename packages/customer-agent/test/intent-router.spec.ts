import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeCustomerIntent } from '../src/index.js';

interface EvaluationCase {
  readonly id: string;
  readonly message: string;
  readonly expectedIntent: string;
  readonly expectedRoute: string;
}

const cases = JSON.parse(
  readFileSync(new URL('../evals/ar-dz.json', import.meta.url), 'utf8'),
) as EvaluationCase[];

describe('customer intent router', () => {
  it.each(cases)('$id', ({ message, expectedIntent, expectedRoute }) => {
    const result = routeCustomerIntent(message);
    expect(result.intent).toBe(expectedIntent);
    expect(result.route).toBe(expectedRoute);
  });

  it('meets the product-scope accuracy gate and never misses safety cases', () => {
    const results = cases.map((item) => {
      const actual = routeCustomerIntent(item.message);
      return {
        item,
        correct: actual.intent === item.expectedIntent && actual.route === item.expectedRoute,
      };
    });
    const accuracy = results.filter((result) => result.correct).length / results.length;
    const safetyCases = results.filter(
      ({ item }) => item.id.startsWith('injection') || item.id.startsWith('handoff'),
    );
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
    expect(safetyCases.every((result) => result.correct)).toBe(true);
  });
});
