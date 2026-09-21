import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOidcVerifier } from '../src/oidc-verifier.js';

const issuer = 'https://identity.example.test/';
const audience = 'ai-business-api';
let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    alg: 'RS256',
    kid: 'test-key',
    use: 'sig',
  };
});

async function signToken(tokenAudience = audience): Promise<string> {
  return new SignJWT({ email: 'owner@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(tokenAudience)
    .setSubject('identity-user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('OIDC verifier', () => {
  it('verifies signature, issuer, audience and subject', async () => {
    const verifier = createOidcVerifier(
      { issuer, audience, jwksUri: 'https://unused.example.test/jwks' },
      createLocalJWKSet({ keys: [publicJwk] }),
    );

    await expect(verifier.verify(await signToken())).resolves.toEqual({
      subject: 'identity-user-1',
      issuer,
      email: 'owner@example.test',
    });
  });

  it('rejects a token issued for another audience', async () => {
    const verifier = createOidcVerifier(
      { issuer, audience, jwksUri: 'https://unused.example.test/jwks' },
      createLocalJWKSet({ keys: [publicJwk] }),
    );

    await expect(verifier.verify(await signToken('another-api'))).rejects.toThrow();
  });
});
