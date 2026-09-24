import { describe, expect, it } from 'vitest';
import { connectInstagramAccountSchema } from '../src/integrations/instagram-connection.schemas.js';

describe('Instagram connection schemas', () => {
  it('accepts a professional account ID and access token', () => {
    expect(
      connectInstagramAccountSchema.parse({
        accountId: '17841400000000000',
        accessToken: 'IGQVJ-test-token-123456789',
      }),
    ).toEqual({
      accountId: '17841400000000000',
      accessToken: 'IGQVJ-test-token-123456789',
    });
  });

  it('rejects non-numeric account IDs and token whitespace', () => {
    expect(
      connectInstagramAccountSchema.safeParse({
        accountId: 'instagram-account',
        accessToken: 'IGQVJ-test-token-123456789',
      }).success,
    ).toBe(false);
    expect(
      connectInstagramAccountSchema.safeParse({
        accountId: '17841400000000000',
        accessToken: ' IGQVJ-test-token-123456789 ',
      }).success,
    ).toBe(false);
  });
});
