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

After Meta validates the credentials, `PUT` also enables webhook notifications
for that account with
`POST https://graph.instagram.com/{version}/{accountId}/subscribed_apps?subscribed_fields=messages`
using the Instagram user access token. Instagram Login requires this per-account
step in addition to the app-level webhook field selection in the Meta App
Dashboard; without it Meta never delivers the account's events. A refused or
failed subscription rejects the connection, so every stored connection is
subscribed. Send `PUT` again to re-subscribe an existing account, for example
after changing webhook fields or re-issuing a token.

Set `INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY` to a secret 32-byte key encoded as
canonical base64. Generate it with `openssl rand -base64 32`, store it in the
deployment secret manager, and never commit it. Rotating an account token through
`PUT` creates a new IV and authentication tag.

## Webhook API

Meta callback URL:

```text
https://<api-host>/api/webhooks/instagram
```

- `GET` performs the Meta subscription challenge using
  `INSTAGRAM_VERIFY_TOKEN`.
- `POST` requires `Content-Type: application/json` and a valid
  `X-Hub-Signature-256`.
- A Fastify pre-parser reads a bounded raw byte stream and verifies the HMAC
  before the JSON parser runs.
- `INSTAGRAM_WEBHOOK_MAX_BYTES` defaults to 262,144 bytes and cannot exceed
  1 MiB.
- A security-definer database lookup resolves the signed Instagram account ID to
  one active tenant. The request body cannot supply a tenant ID.

After validation, each normalized envelope is persisted atomically:

- the Instagram-scoped sender ID resolves or creates one tenant customer;
- one Instagram thread resolves or creates one conversation;
- the external message ID and a content fingerprint make retries idempotent;
- the message and audit event are written once;
- one durable `agent_reply` processing job is queued for each new message;
- replayed webhooks create no duplicate customer, conversation, message, audit event,
  or job.

The HTTP response reports new, replayed, and queued counts.

## Automated Agent Processing

The long-lived worker now polls a protected internal API endpoint for durable
`agent_reply` jobs. The API:

- claims one due job with a worker-owned, ten-minute lease;
- runs the existing grounded customer agent as the provisioned
  `service:customer-agent-worker` principal;
- grants that principal only the existing `agent` tenant role;
- writes service-authored audit events rather than impersonating a human user;
- completes the job after the idempotent reply is stored;
- schedules capped retries for transient failures and dead-letters permanent or
  exhausted failures.

The internal endpoint requires `INTERNAL_WORKER_TOKEN` in `X-Worker-Token`.
Use a random value of at least 32 bytes, keep the same value in the API and worker
secret managers, and never expose it to the browser. `API_INTERNAL_BASE_URL` tells
the worker where to reach the API. Production URLs must use HTTPS.

## Durable Outbound Delivery

Every outbound message inserted into an Instagram conversation is added
automatically to `instagram_delivery_jobs`. The worker:

- claims one due job with `FOR UPDATE SKIP LOCKED`;
- reclaims a lease after five minutes if a worker stops unexpectedly;
- decrypts the tenant-bound token only for the provider call;
- retries network errors, timeouts, HTTP 408/429/5xx, and documented transient Meta
  codes with capped exponential backoff;
- immediately dead-letters invalid credentials, payloads, recipients, and permanent
  provider failures;
- stops after the persisted per-job attempt limit;
- stores only redacted error codes and writes delivery, retry, and dead-letter audit
  events.

Run the delivery worker as a separate long-lived process:

```bash
pnpm --filter @ai-business/worker build
pnpm --filter @ai-business/worker start
```

It requires `DATABASE_URL`, `API_INTERNAL_BASE_URL`, `INTERNAL_WORKER_TOKEN`,
`INSTAGRAM_APP_SECRET`, `INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY`, and the matching
`INSTAGRAM_CREDENTIAL_KEY_VERSION`. `WORKER_ID` is optional.

## Meta Contract

- API host: `https://graph.instagram.com`.
- Default version: `v26.0`, overridden only through reviewed configuration.
- Send endpoint: `/{instagram-account-id}/messages`.
- Recipient: the customer's Instagram-scoped ID (IGSID).
- Required permissions: `instagram_business_basic` and
  `instagram_business_manage_messages`.
- Initial subscribed webhook field: `messages`. Add reactions or seen events only
  when the product uses them.
- Webhook delivery requires both the app-level field selection in the App
  Dashboard and the per-account `subscribed_apps` call performed on connect.
- Meta only delivers notifications for real users when the app is Live; serving
  accounts the app does not own additionally requires Advanced Access and
  business verification.

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

1. Configure a Meta test app, subscribe `messages`, and run sandbox cases for
   inbound text, outbound reply, duplicate delivery, invalid signature, expired
   token, and human handoff.
2. Complete Meta App Review, privacy review, and the Pilot Go/No-Go checklist before
   connecting a real store.

## Package Verification

```bash
pnpm --filter @ai-business/integrations lint
pnpm --filter @ai-business/integrations typecheck
pnpm --filter @ai-business/integrations test
pnpm --filter @ai-business/integrations build
pnpm --filter @ai-business/worker test
pnpm --filter @ai-business/worker build
TEST_DATABASE_URL=postgresql://... pnpm --filter @ai-business/api test:integration
```
