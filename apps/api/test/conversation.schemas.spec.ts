import { describe, expect, it } from 'vitest';
import {
  conversationMessageSchema,
  createConversationSchema,
  updateConversationLinksSchema,
} from '../src/conversations/conversation.schemas.js';

const customerId = '11111111-1111-4111-8111-111111111111';

describe('conversation API schemas', () => {
  it('supports the internal test channel and defaults status to bot', () => {
    const parsed = createConversationSchema.parse({
      customerId,
      channel: 'internal',
      initialMessage: {
        direction: 'inbound',
        senderType: 'customer',
        externalId: 'internal-message-1',
        content: 'Hello',
      },
    });
    expect(parsed.status).toBe('bot');
    expect(parsed.initialMessage?.metadata).toEqual({});
  });

  it('requires message content and at least one link update', () => {
    expect(() =>
      conversationMessageSchema.parse({
        direction: 'inbound',
        senderType: 'customer',
        content: ' ',
      }),
    ).toThrow();
    expect(() => updateConversationLinksSchema.parse({ expectedVersion: 1 })).toThrow();
  });
});
