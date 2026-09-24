# Instagram Integration

## Current Stage

The first live-channel increment is implemented in `@ai-business/integrations`.
`InstagramLiveAdapter` provides:

- constant-time verification of the webhook subscription token;
- HMAC-SHA256 validation of the exact raw webhook body through
  `X-Hub-Signature-256`;
- tenant-bound normalization of supported Instagram text and HTTPS media events;
- rejection of echoes, deleted or unsupported messages, invalid identifiers, unsafe
  media URLs, and oversized batches;
- versioned outbound text delivery to the Instagram Messaging API;
- bounded timeouts and provider errors that never include access tokens or provider
  error messages.

This code does **not** enable live traffic by itself.

The tenant connection layer is also implemented:

- one Instagram professional account can belong to only one tenant;
- only the tenant owner can create, inspect, rotate, or delete a connection;
- access tokens use AES-256-GCM encryption with tenant ID, account ID, and key
  version as authenticated data;
- API responses and audit events expose only the token fingerprint and account ID,
  never token plaintext;
- deleting a connection deletes its encrypted credential.

## Tenant Connection API

All routes require an authenticated tenant owner:

- `GET /api/tenants/:tenantId/integrations/instagram`
- `PUT /api/tenants/:tenantId/integrations/instagram`
- `DELETE /api/tenants/:tenantId/integrations/instagram`

The `PUT` body is:

```json
{
  "accountId": "17841400000000000",
  "accessToken": "entered-through-a-secure-secret-control"
}
```

Set `INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY` to a secret 32-byte key encoded as
canonical base64. Generate it with `openssl rand -base64 32`, store it in the
deployment secret manager, and never commit it. Rotating an account token through
`PUT` creates a new IV and authentication tag.

## Meta Contract

- API host: `https://graph.instagram.com`.
- Default version: `v26.0`, overridden only through reviewed configuration.
- Send endpoint: `/{instagram-account-id}/messages`.
- Recipient: the customer's Instagram-scoped ID (IGSID).
- Required permissions: `instagram_business_basic` and
  `instagram_business_manage_messages`.
- Initial subscribed webhook field: `messages`. Add reactions or seen events only
  when the product uses them.

References:

- [Instagram Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- [Instagram Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks)
- [Meta webhook signatures](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks)
- [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog/)

## Security Boundary

The API route must capture raw request bytes before JSON parsing and reject the
request unless `InstagramLiveAdapter.verifyWebhookSignature` succeeds. The tenant ID
must be resolved from an internal mapping of the webhook account ID; it must never
come from the webhook body or a client-supplied header.

Each tenant's Instagram account ID and access token are stored together. The token is
encrypted at rest, while application logs and audit events record only non-secret
diagnostics. App secret, verification token, and encryption key remain
application-level secrets.

## Remaining Activation Work

1. Add `GET` subscription verification and signed `POST` webhook routes.
2. Persist normalized messages idempotently, acknowledge the webhook quickly, and
   enqueue agent processing.
3. Add outbound delivery jobs with bounded retries, rate-limit handling, and a
   dead-letter queue.
4. Configure a Meta test app, subscribe `messages`, and run sandbox cases for
   inbound text, outbound reply, duplicate delivery, invalid signature, expired
   token, and human handoff.
5. Complete Meta App Review, privacy review, and the Pilot Go/No-Go checklist before
   connecting a real store.

## Package Verification

```bash
pnpm --filter @ai-business/integrations lint
pnpm --filter @ai-business/integrations typecheck
pnpm --filter @ai-business/integrations test
pnpm --filter @ai-business/integrations build
```
