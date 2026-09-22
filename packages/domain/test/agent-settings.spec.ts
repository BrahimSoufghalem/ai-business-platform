import { describe, expect, it } from 'vitest';
import { normalizeAgentSettings } from '../src/index.js';

describe('safe agent settings', () => {
  it('normalizes only allow-listed language and tone fields plus plain notes', () => {
    expect(
      normalizeAgentSettings({
        language: 'ar',
        tone: 'friendly',
        handoffNotes: '  حوّل الشكاوى إلى موظف.  ',
      }),
    ).toEqual({
      language: 'ar',
      tone: 'friendly',
      handoffNotes: 'حوّل الشكاوى إلى موظف.',
    });
  });

  it('rejects control characters', () => {
    expect(() =>
      normalizeAgentSettings({
        language: 'en',
        tone: 'professional',
        handoffNotes: 'unsafe\u0000text',
      }),
    ).toThrow('control');
  });

  it('rejects language and tone values outside the allow-list at runtime', () => {
    expect(() =>
      normalizeAgentSettings({
        language: 'es' as 'ar',
        tone: 'friendly',
        handoffNotes: '',
      }),
    ).toThrow('language');
    expect(() =>
      normalizeAgentSettings({
        language: 'ar',
        tone: 'aggressive' as 'friendly',
        handoffNotes: '',
      }),
    ).toThrow('tone');
  });
});
