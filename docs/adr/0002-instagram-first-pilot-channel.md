# ADR-0002: Instagram as the First Pilot Channel

- **Status:** Accepted
- **Date:** 2026-09-21

## Decision

Instagram is the first external messaging channel targeted for the Pilot. The core platform remains channel-neutral, and development starts with an internal message envelope and test inbox before real Meta credentials or webhook traffic are enabled.

## Consequences

- All inbound messages are normalized into one idempotent `InboundMessageEnvelope`.
- Uniqueness is scoped by tenant, channel, and external message ID.
- Webhook signatures, timestamps, replay protection, token encryption, retries, and a dead-letter path are mandatory.
- A content ID may resolve a product only inside the same tenant and channel.
- Instagram-specific payloads and SDK types stay inside the integration adapter.
- The adapter is not activated until tenant isolation, conversations, orders, and human handoff pass their gates.

## Not Included in the Bootstrap

- Meta App credentials or secrets.
- Live webhook subscription.
- Sending messages to real customers.
- Automated product recognition from media.

These require a separate reviewed change, Meta configuration, privacy review, and Pilot readiness approval.
