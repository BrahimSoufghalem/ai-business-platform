import { describe, expect, it } from 'vitest';
import {
  InvalidConversationTransitionError,
  assertConversationTransition,
  canTransitionConversation,
} from '../src/index.js';

describe('conversation lifecycle', () => {
  it('supports escalation, claiming, closing, and reopening', () => {
    expect(canTransitionConversation('bot', 'needs_human')).toBe(true);
    expect(canTransitionConversation('needs_human', 'human')).toBe(true);
    expect(canTransitionConversation('human', 'closed')).toBe(true);
    expect(canTransitionConversation('closed', 'needs_human')).toBe(true);
  });

  it('rejects no-op and unsupported transitions', () => {
    expect(() => assertConversationTransition('human', 'human')).toThrow(
      InvalidConversationTransitionError,
    );
    expect(() => assertConversationTransition('closed', 'human')).toThrow(
      InvalidConversationTransitionError,
    );
  });
});
