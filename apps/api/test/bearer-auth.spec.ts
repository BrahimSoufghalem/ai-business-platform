import { describe, expect, it } from 'vitest';
import { extractBearerToken, selectCorrelationId } from '../src/auth/bearer-auth.guard.js';

describe('Bearer authentication helpers', () => {
  it('extracts an RFC-style Bearer token', () => {
    expect(extractBearerToken('Bearer signed.token.value')).toBe('signed.token.value');
  });

  it('rejects malformed authorization headers', () => {
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken(['Bearer one', 'Bearer two'])).toBeNull();
  });

  it('preserves a safe correlation ID and replaces unsafe input', () => {
    expect(selectCorrelationId('request-123')).toBe('request-123');
    expect(selectCorrelationId('contains spaces')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
