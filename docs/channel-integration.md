# Channel Integration and Telemetry Contract

This document describes how channel-agnostic the current implementation is, what is channel-specific today, and how to add a new consumer-facing channel that keeps runtime telemetry for feedback analysis.

## Channel-Agnostic by Design

The core orchestration path is channel-agnostic:

- `AgentService` processes normalized inbound messages and does not contain transport-specific code.
- `PlanStore`, runtime extraction and reply generation, provider gateway orchestration, and decision-flow transitions are independent of transport.
- The plan identity key includes `(channel, externalUserId)`, so multiple channels can coexist without state collision.
- Turn traces and performance records are generated from runtime execution, not from any channel UI behavior.

The channel identifier is treated as data:

- inbound payload sets `channel` (or falls back to `DEFAULT_INBOUND_CHANNEL`);
- the same runtime logic executes for any channel value;
- persistence and telemetry are tied to that channel value.

## Current HTTP Contract (Lambda Function URL)

Inbound request body currently supports:

- `text`
- `user_id`
- `channel` (optional)
- `message_id` (optional)
- `received_at` (optional)
- `client_mode` (optional; `cli` or `channel`)

Outbound response policy is intentionally split:

- `client_mode=cli`:
  - returns debug envelope (`trace`, `perf`) in addition to user-facing reply fields.
- default or `client_mode=channel`:
  - returns user-facing fields only (`message`, `conversation_id`, `plan_id`, `current_node`).

This keeps consumer channels clean while preserving deep diagnostics for development tools.

## Telemetry Contract (All Channels)

Regardless of what a channel exposes to end users, every turn still records telemetry server-side:

- `TurnTrace` is produced on every successful runtime turn.
- A normalized perf record is persisted to the perf DynamoDB table with:
  - timing breakdowns,
  - token usage snapshot,
  - tool-call and provider-result counts,
  - derived metrics (cache hit rate, extraction-to-compose ratio),
  - hashed external user identifier,
  - TTL for low-cost retention.

Important distinction:

- **Storage and analysis surface:** always on for all channels.
- **Client response surface:** intentionally restricted by `client_mode`.

This is what enables pairing non-technical user feedback with hard runtime data even when the user never sees debug details.

## Building a New Consumer Channel

Use this flow for a production-facing channel (for example, WhatsApp webhook, web chat backend, mobile backend):

1. **Create a channel adapter**
   - Normalize channel-native inbound payload to `{ text, user_id, channel, message_id, received_at }`.
   - Set `client_mode` to `channel`.
2. **Send normalized request to Lambda runtime**
   - Use existing Function URL contract (or future API Gateway route with same payload shape).
3. **Render only the `message` field to the user**
   - Ignore debug fields by contract (they are omitted in `channel` mode anyway).
4. **Capture feedback in your channel system**
   - Store user feedback with at least `(channel, external_user_id, approximate timestamp, optional message_id)`.
5. **Correlate feedback to runtime telemetry**
   - Query perf records by channel + hashed user key and time range.
   - Join with plan snapshots or other persisted artifacts as needed.

## Minimal Adapter Checklist

Before considering a channel adapter complete:

- [ ] uses stable channel identifier string
- [ ] always passes `user_id`
- [ ] always passes `message_id` (or deterministic fallback)
- [ ] always passes `received_at`
- [ ] sets `client_mode=channel`
- [ ] returns only user-facing reply content to consumers
- [ ] records enough channel-side metadata to map feedback back to telemetry

## Cost and Scale Notes (Current Target: <= 100 users)

Current telemetry architecture is intentionally low-cost:

- DynamoDB PAY_PER_REQUEST for sparse, bursty traffic.
- TTL cleanup (`PERF_RETENTION_DAYS`) to cap storage growth.
- Small record envelope derived from existing trace, no extra model calls.

At this scale, this is typically cheaper and simpler than introducing a dedicated analytics pipeline.

## What Is Still Channel-Specific

The following should remain in channel adapters, not in core runtime:

- webhook signatures and auth
- retry semantics and idempotency keys
- channel formatting quirks and message templates
- user identity mapping rules
- delivery status callbacks

Keeping those concerns outside `src/runtime` preserves channel-agnostic core behavior.
