import { describe, expect, it } from 'vitest';
import type { AiSchema } from '../src/index.js';
import { PromptRegistry, redactAiTelemetry, ToolRegistry } from '../src/index.js';

const passthroughSchema: AiSchema<Record<string, unknown>> = {
  safeParse(value) {
    return typeof value === 'object' && value !== null
      ? { success: true as const, data: value as Record<string, unknown> }
      : { success: false as const, error: new Error('invalid') };
  },
};

describe('AI registries and telemetry redaction', () => {
  it('keeps prompt versions immutable', () => {
    const registry = new PromptRegistry();
    registry.register({
      id: 'reply',
      task: 'compose',
      version: 'v1',
      systemInstruction: 'Return a concise reply.',
    });
    expect(registry.get('compose', 'v1').id).toBe('reply');
    expect(() =>
      registry.register({
        id: 'replacement',
        task: 'compose',
        version: 'v1',
        systemInstruction: 'Replace the previous prompt.',
      }),
    ).toThrow('immutable');
  });

  it('exposes only tools allowed for the current intent and explicit allow-list', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'read_product',
      description: 'Read one product.',
      kind: 'read',
      allowedIntents: ['product_discovery'],
      inputSchema: passthroughSchema,
      outputSchema: passthroughSchema,
      inputJsonSchema: { type: 'object' },
      async execute(input) {
        return input;
      },
    });
    registry.register({
      name: 'confirm_order',
      description: 'Confirm an approved order.',
      kind: 'command',
      allowedIntents: ['order_confirmation'],
      inputSchema: passthroughSchema,
      outputSchema: passthroughSchema,
      inputJsonSchema: { type: 'object' },
      async execute(input) {
        return input;
      },
    });
    expect(registry.descriptors('product_discovery').map((tool) => tool.name)).toEqual([
      'read_product',
    ]);
    expect(registry.descriptors('product_discovery', ['confirm_order'])).toEqual([]);
  });

  it('redacts nested credentials, contact data, bearer tokens, and cycles', () => {
    const value: Record<string, unknown> = {
      authorization: 'Bearer top-secret',
      nested: {
        email: 'user@example.test',
        message: 'Call +213 555 12 34 56 using Bearer another-secret.',
      },
    };
    value.self = value;
    expect(redactAiTelemetry(value)).toEqual({
      authorization: '[REDACTED]',
      nested: {
        email: '[REDACTED]',
        message: 'Call [REDACTED] using [REDACTED].',
      },
      self: '[CIRCULAR]',
    });
  });

  it('does not mistake UUIDs or monetary values for phone numbers', () => {
    expect(
      redactAiTelemetry({
        productId: '10000000-0000-4000-8000-000000000004',
        amount: '125000.00 DZD',
      }),
    ).toEqual({
      productId: '10000000-0000-4000-8000-000000000004',
      amount: '125000.00 DZD',
    });
  });
});
