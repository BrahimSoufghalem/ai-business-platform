import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InstagramCredentialError,
  InstagramCredentialVault,
} from '../src/instagram-credential-vault.js';

const key = randomBytes(32).toString('base64');
const token = 'IGQVJ-test-access-token-123456789';
const boundary = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  accountId: '17841400000000000',
};

describe('InstagramCredentialVault', () => {
  it('encrypts and decrypts an access token without storing its plaintext', () => {
    const vault = new InstagramCredentialVault(key);
    const encrypted = vault.encrypt(boundary, token);

    expect(encrypted.ciphertext).not.toContain(token);
    expect(encrypted.fingerprint).toMatch(/^[a-f0-9]{16}$/u);
    expect(vault.decrypt(boundary, encrypted)).toBe(token);
  });

  it('binds a token to its tenant and Instagram account', () => {
    const vault = new InstagramCredentialVault(key);
    const encrypted = vault.encrypt(boundary, token);

    expect(() =>
      vault.decrypt({ ...boundary, tenantId: '22222222-2222-4222-8222-222222222222' }, encrypted),
    ).toThrow(InstagramCredentialError);
    expect(() => vault.decrypt({ ...boundary, accountId: '17841499999999999' }, encrypted)).toThrow(
      InstagramCredentialError,
    );
  });

  it('rejects decryption with another key', () => {
    const encrypted = new InstagramCredentialVault(key).encrypt(boundary, token);
    const otherVault = new InstagramCredentialVault(randomBytes(32).toString('base64'));

    expect(() => otherVault.decrypt(boundary, encrypted)).toThrow(InstagramCredentialError);
  });

  it('requires a canonical 32-byte base64 encryption key', () => {
    expect(() => new InstagramCredentialVault('not-a-key')).toThrow(InstagramCredentialError);
    expect(() => new InstagramCredentialVault(randomBytes(31).toString('base64'))).toThrow(
      InstagramCredentialError,
    );
  });
});
