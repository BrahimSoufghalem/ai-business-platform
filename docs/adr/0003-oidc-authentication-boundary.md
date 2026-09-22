# ADR-0003: OIDC Authentication Boundary

- **Status:** Accepted
- **Date:** 2026-09-21

## Decision

Authentication uses standard OIDC access tokens. The API verifies token signature, issuer, audience, expiry, and subject against a configured JWKS endpoint. The initial implementation remains provider-neutral so a managed provider or a self-hosted OIDC service can be selected later without changing domain code.

The verified `sub` claim identifies the user. A candidate tenant may come from the route or active workspace selection, but it is never trusted by itself. Every tenant-scoped database transaction sets both the verified identity subject and tenant ID, and PostgreSQL RLS confirms an active membership before returning or writing rows.

## Consequences

- No password storage or custom password-reset flow in the application.
- Tenant membership is application data, not an unchecked JWT claim.
- Health endpoints remain public; business endpoints require a verified identity.
- Provisioning the first tenant and owner uses a separate reviewed flow.
- Service-to-service actors require a later ADR and cannot reuse a user tenant session.

## Required Configuration

- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_JWKS_URI`

No real tokens, client secrets, or provider credentials belong in the repository.
