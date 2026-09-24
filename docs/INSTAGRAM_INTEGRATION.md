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

Store each tenant's Instagram account ID and access token together. Encrypt the token
at rest, expose it only to the worker that sends messages, and record only a
non-secret credential reference in application logs. App secret and verification
token remain application-level secrets.

## Remaining Activation Work

1. Add the encrypted tenant/account credential mapping and owner-only connection
   workflow.
2. Add `GET` subscription verification and signed `POST` webhook routes.
3. Persist normalized messages idempotently, acknowledge the webhook quickly, and
   enqueue agent processing.
4. Add outbound delivery jobs with bounded retries, rate-limit handling, and a
   dead-letter queue.
5. Configure a Meta test app, subscribe `messages`, and run sandbox cases for
   inbound text, outbound reply, duplicate delivery, invalid signature, expired
   token, and human handoff.
6. Complete Meta App Review, privacy review, and the Pilot Go/No-Go checklist before
   connecting a real store.

## Package Verification

```bash
pnpm --filter @ai-business/integrations lint
pnpm --filter @ai-business/integrations typecheck
pnpm --filter @ai-business/integrations test
pnpm --filter @ai-business/integrations build
```
