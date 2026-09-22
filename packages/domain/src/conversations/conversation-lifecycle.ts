export type ConversationStatus = 'bot' | 'needs_human' | 'human' | 'closed';

const transitions: Readonly<Record<ConversationStatus, ReadonlySet<ConversationStatus>>> = {
  bot: new Set(['needs_human', 'human', 'closed']),
  needs_human: new Set(['bot', 'human', 'closed']),
  human: new Set(['bot', 'needs_human', 'closed']),
  closed: new Set(['bot', 'needs_human']),
};

export class InvalidConversationTransitionError extends Error {
  constructor(
    readonly from: ConversationStatus,
    readonly to: ConversationStatus,
  ) {
    super(`Conversation cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidConversationTransitionError';
  }
}

export function canTransitionConversation(
  from: ConversationStatus,
  to: ConversationStatus,
): boolean {
  return transitions[from].has(to);
}

export function assertConversationTransition(
  from: ConversationStatus,
  to: ConversationStatus,
): void {
  if (!canTransitionConversation(from, to)) {
    throw new InvalidConversationTransitionError(from, to);
  }
}
