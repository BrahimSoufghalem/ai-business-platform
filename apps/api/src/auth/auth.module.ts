import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createOidcVerifier, type IdentityVerifier } from '@ai-business/auth';
import { IDENTITY_VERIFIER } from './auth.constants.js';
import { BearerAuthGuard } from './bearer-auth.guard.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for authenticated routes.`);
  return value;
}

function createEnvironmentIdentityVerifier(): IdentityVerifier {
  let configured: IdentityVerifier | undefined;

  return {
    verify(accessToken: string) {
      configured ??= createOidcVerifier({
        issuer: requiredEnvironment('AUTH_ISSUER'),
        audience: requiredEnvironment('AUTH_AUDIENCE'),
        jwksUri: requiredEnvironment('AUTH_JWKS_URI'),
      });
      return configured.verify(accessToken);
    },
  };
}

@Module({
  providers: [
    { provide: IDENTITY_VERIFIER, useFactory: createEnvironmentIdentityVerifier },
    { provide: APP_GUARD, useClass: BearerAuthGuard },
  ],
  exports: [IDENTITY_VERIFIER],
})
export class AuthModule {}
