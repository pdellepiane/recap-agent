# Wait-aware reply package — 2026-09-17

## Objective

Stop back-to-back duplicate replies when rapid user messages queue behind an answering turn. When a turn waited on the conversation lease behind a turn that just sent a reply, the reply builder receives that fact as typed evidence plus one prominent directive: do not repeat sent content; extend only with genuinely new information from the new message; otherwise answer very briefly by reference. Never silence, never a canned template.

Non-goals: semaphore, priority queue, FIFO ordering guarantees, adapter burst-coalescing, send-path idempotency (TurnOutcomeLedger wiring), global style rewrite. Those are separate projects; this package does not block them.

## Evidence and diagnosis

- Prev-prod incident (Gerardo Cordova thread): three guest texts ~8s apart produced three near-identical confirmation replies plus a follow-up. Distinct WhatsApp IDs mean no shared dedup key exists anywhere in the path.
- `runWithConversationTurnLease` (src/storage/conversation-turn-coordinator.ts) already poll-waits inside a bounded window and emits per-acquire `attempts` / `wait_ms` telemetry — but that signal never reaches reply composition.
- `finalizeLastOutboundRecord` (src/runtime/agent-service.ts) persists `last_outbound_context` metadata that could identify the preceding reply; nothing reads it on the reply path.
- Outbound send lives in the external adapter with no enforced idempotency; out of scope here.

## Binding decisions

1. Keep the per-conversation mutex. No semaphore (permits plan-write races), no priority queue (no starvation with bounded waits; Dynamo conditional-put cannot do fair queuing anyway).
2. The wait fact travels as typed evidence (waited milliseconds, acquire attempts, prior reply identity/timestamp/summary), never as prose. Model sentences stay model-authored.
3. The directive loads only when the evidence is present, keeping stable prompt prefixes and cache keys for all other turns.
4. Recency bound: the no-repeat behavior applies only when the preceding reply is fresh (constant, e.g. 10 minutes, in typed config). An identical question after a long gap answers normally.
5. Floor behaviors, both hard: a substantive new question always gets a delivered answer (silence is a delivery failure, per precedent); the short form references the prior answer but is composed fresh each turn — no fixed "already answered" sentence, no phrase blacklist.
6. Adapter 503-retries re-enter as fresh requests with no wait signal; this package does not cover them. Server-side evidence only.

## Ownership

Single implementation lane (the touched files overlap, so no parallel split):

- src/storage/conversation-turn-coordinator.ts (expose waited/attempts on the leased result; no behavior change to acquire/release semantics)
- src/lambda/handler.ts (thread the wait fact + prior-outbound read into the turn; no intake contract change)
- src/runtime/agent-service.ts (carry into reply composition; read last-outbound metadata)
- src/runtime/openai-agent-runtime.ts or reply-evidence projector (project the typed evidence + conditional directive module)
- prompts/: one scoped directive block, loaded only with the evidence present
- tests: extend the existing turn-lease, reply-request, and continuity suites in place; no new harness

Coordinator integrates, verifies serialized inputs, commits.

## Required offline proof (existing suites, extended in place)

- Waited turn (attempts > 1, fresh prior reply): serialized reply input contains the wait evidence + directive, and the composed evidence set carries no repeated prior facts; execution counts unchanged.
- No-wait turn: byte-identical requests before/after (no prompt/cache drift).
- Stale prior reply (beyond recency bound): normal full answer, no suppression.
- Substantive new question on a waited turn: delivered answer present (never silence), short and referencing.
- Discrimination: the same fixtures fail on the pre-change tree (evidence absent) and pass with it.

## Budget and stop rules

Offline implementation and validation only. No deployment, live models, paid calls, or commits by the worker; coordinator commits. No second-pass architecture, no global response scripts, no router/executor changes. If the wait fact cannot be plumbed without changing acquire semantics or the intake contract, stop and report the exact blocker instead of redesigning.

## Resume capsule

Triple-send root cause is N independent turns with no shared dedup key, not a retry glitch. Fix = server-side wait-awareness (typed evidence + conditional directive + recency bound + silence/template floors), not locks/semaphores/queues. Adapter coalescing and ledger wiring remain separate future work.
