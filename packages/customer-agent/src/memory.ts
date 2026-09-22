import type { CustomerAgentMemory, CustomerAgentMessage } from './contracts.js';
import { boundedUntrustedText } from './safety.js';

export interface CustomerAgentMemoryOptions {
  readonly maximumMessages?: number;
  readonly maximumCharacters?: number;
  readonly maximumCharactersPerMessage?: number;
}

export function buildCustomerAgentMemory(
  messages: readonly CustomerAgentMessage[],
  options: CustomerAgentMemoryOptions = {},
): CustomerAgentMemory {
  const maximumMessages = options.maximumMessages ?? 8;
  const maximumCharacters = options.maximumCharacters ?? 4_000;
  const maximumCharactersPerMessage = options.maximumCharactersPerMessage ?? 700;
  if (
    !Number.isSafeInteger(maximumMessages) ||
    maximumMessages < 1 ||
    maximumMessages > 30 ||
    !Number.isSafeInteger(maximumCharacters) ||
    maximumCharacters < 200 ||
    maximumCharacters > 20_000 ||
    !Number.isSafeInteger(maximumCharactersPerMessage) ||
    maximumCharactersPerMessage < 50 ||
    maximumCharactersPerMessage > 2_000
  ) {
    throw new Error('Customer memory limits are invalid.');
  }

  const eligible = messages.filter(
    (message) =>
      message.direction !== 'internal' &&
      (message.senderType === 'customer' || message.senderType === 'bot'),
  );
  const selected: { role: 'customer' | 'assistant'; content: string }[] = [];
  let usedCharacters = 0;
  for (const message of [...eligible].reverse()) {
    if (selected.length >= maximumMessages || usedCharacters >= maximumCharacters) break;
    const remaining = maximumCharacters - usedCharacters;
    const content = boundedUntrustedText(
      message.content,
      Math.min(maximumCharactersPerMessage, remaining),
    );
    if (content.length === 0) continue;
    selected.push({
      role: message.senderType === 'customer' ? 'customer' : 'assistant',
      content,
    });
    usedCharacters += content.length;
  }
  selected.reverse();
  const summary = selected
    .slice(-4)
    .map((message) => `${message.role}: ${message.content}`)
    .join(' | ')
    .slice(0, 1_200);
  return {
    summary,
    recentMessages: selected,
    truncated: selected.length < eligible.length,
  };
}
