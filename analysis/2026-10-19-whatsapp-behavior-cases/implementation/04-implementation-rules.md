# 04 — Implementation Rules (repo law, distilled from AGENTS.md)

These override generic instincts. Full text: repo-root AGENTS.md.

## Behavior invariants

- Every delivered sentence is model-generated for that turn. No
  canned replies, template fallbacks, or post-generation text
  replacement — including errors and escalation messages.
- Evidence carries facts, provenance, missing inputs, and real
  outcomes — never a prewritten answer.
- Deterministic code validates schema, authorization, IDs, and
  receipts. It never infers conversational intent by keyword or
  exact-string matching. Flow decisions come from structured
  model output (here: the Decisions router) + typed evidence.
- Build the complete authorized customer profile independently
  of extractor-selected routes; preserve every authorized record
  with provenance. No first-N truncation, no aspect-based deletion.
- Prompt context is a constrained resource: project the smallest
  typed state/evidence per call. Adding a prompt rule requires
  first trying typed state; measure serialized bytes of changed
  model calls.

## Engineering

- TypeScript strict; explicit `any` banned in src, tests, scripts.
  Use `unknown`, explicit domain types, centralized typed config.
- Prompts live as git-tracked text under `prompts/`, mapped to
  flow nodes. Conversational prompt content stays in Spanish;
  code/comments/docs in English.
- No backward-compatibility shims. Clean breaks preferred.
- CloudFormation for infra. AWS CLI/SDK only via profile `se-dev`,
  region `us-east-1`; mutating scripts fail closed unless STS
  account is 684516060775. Refresh login with
  `aws login --profile se-signin` if expired.
- Atomic single-responsibility commits, short explanations.
- Every code/prompt change logged in docs/implementation-log.md
  with reason and decision.

## Validation law (from 2026-09-23 directives)

- Every interaction-derived behavior gets a live case in
  `live_behavior_regression` reconstructing full context (not an
  isolated phrase), with hard objective assertions, plus a
  deterministic offline twin where possible.
- Every behavior-changing feature/fix gets its OWN entry in
  evals/live-behavior-coverage.yaml, even if it reuses a case.
  Run tests/live-behavior-coverage.test.ts before handoff.
- After any Lambda-impacting change, redeploy the Lambda in
  development before validating.
- Behavioral validation: explicitly selected targeted cases only,
  `npm run eval:behavior-live -- --case <id> ...`. Never run an
  unfiltered/full live gate. Report targeted results as targeted;
  keep all failures visible; record run/artifact ids in the log.
- Run the repo's own tests for touched areas before claiming
  done. A failing existing test is a contract to satisfy, not
  an artifact to delete or skip.

## Scope discipline for this package

- Do not fix campaign-side messages (Silvia's auto-message is
  sent outside this runtime).
- Do not build a settlement/claim store, proactive re-check
  messages, or a COD backend field. Unmatchable evidence
  escalates; that is the designed behavior.
- Do not extend the merged-compose pattern to planning/RSVP/
  close/auth lanes in this package.
- Do not expose credentials, OTPs, tokens, or raw private
  payloads in traces, tests, or logs.
