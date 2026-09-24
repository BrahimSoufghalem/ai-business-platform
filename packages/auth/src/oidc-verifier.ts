import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface OidcVerifierConfig {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly jwksUri: string;
}

export interface VerifiedIdentity {
  readonly subject: string;
  readonly issuer: string;
  readonly email?: string;
  /** Internal service identities are constructed only after trusted worker authentication. */
  readonly actorType?: 'user' | 'service';
}

export interface IdentityVerifier {
  verify(accessToken: string): Promise<VerifiedIdentity>;
}

export function createOidcVerifier(
  config: OidcVerifierConfig,
  keyResolver: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUri)),
): IdentityVerifier {
  if (config.issuer.trim().length === 0) {
    throw new Error('OIDC issuer is required.');
  }
  if (config.jwksUri.trim().length === 0) {
    throw new Error('OIDC JWKS URI is required.');
  }

  return {
    async verify(accessToken: string): Promise<VerifiedIdentity> {
      if (accessToken.trim().length === 0) {
        throw new Error('Access token is required.');
      }

      const { payload } = await jwtVerify(accessToken, keyResolver, {
        issuer: config.issuer,
        audience: [...(Array.isArray(config.audience) ? config.audience : [config.audience])],
      });

      if (!payload.sub) {
        throw new Error('Verified token does not contain a subject.');
      }

      return {
        subject: payload.sub,
        issuer: config.issuer,
        ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      };
    },
  };
}
