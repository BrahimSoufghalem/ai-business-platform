# ADR-0002: Instagram as the First Pilot Channel

- **Status:** Accepted
- **Date:** 2026-09-21

## Decision

Instagram is the first external messaging channel targeted for the Pilot. The core platform remains channel-neutral, and development starts with an internal message envelope and test inbox before real Meta credentials or webhook traffic are enabled.

The first adapter increment uses the Instagram API with Instagram Login through the
versioned `graph.instagram.com` endpoint. The Graph version remains configurable so
upgrades can be reviewed and tested explicitly.

## Consequences

- All inbound messages are normalized into one idempotent `InboundMessageEnvelope`.
- Uniqueness is scoped by tenant, channel, and external message ID.
- Webhook signatures, timestamps, replay protection, token encryption, retries, and a dead-letter path are mandatory.
- A content ID may resolve a product only inside the same tenant and channel.
- Instagram-specific payloads and SDK types stay inside the integration adapter.
- The adapter is not activated until tenant isolation, conversations, orders, and human handoff pass their gates.

## Delivery Progress

Implemented:

- Raw-body `X-Hub-Signature-256` verification.
- Tenant-bound normalization of text and HTTPS media messages.
- Versioned outbound text delivery with bounded input, timeout, and redacted errors.
- Webhook subscription challenge verification.
- Owner-only tenant/account mapping with AES-256-GCM token encryption and audited
  rotation or deletion.
- Public subscription verification plus a size-bounded POST pre-parser that validates
  `X-Hub-Signature-256` against raw bytes before JSON parsing.
- Atomic idempotent creation of the Instagram customer, conversation, inbound message,
  audit event, and one durable agent-processing job.

Still required before live activation:

- Meta App credentials or secrets.
- Agent-job consumption, outbound retries, and dead-letter handling.
- Meta Sandbox validation, App Review, and Pilot Go/No-Go approval.
- Automated product recognition from media.

These require a separate reviewed change, Meta configuration, privacy review, and Pilot readiness approval.
