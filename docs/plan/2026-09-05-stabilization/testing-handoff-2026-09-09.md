# Development testing handoff — 2026-09-09

Status: deployment candidate, not behavior-validated. The user requested deployment now and testing later; the live gate is deliberately deferred, not waived or passed.

## Candidate identity

- Branch: `dev`, working-tree changes based on `452d8df7`.
- Artifact SHA-256: `0f084c01b7d1111d1a74dc62301bfd82461374bbcaf674fa45509a35371d2530`.
- Target: `recap-agent-runtime-dev`, AWS account `684516060775`, profile `se-dev`, region `us-east-1`.
- Production artifact reported by the user remains `650f6c017d5fe8b00cdf19f7fe1c766a73cde5d6528e226d8067689f5f935b3e`; this deployment does not promote the new candidate.
- Local reproducibility snapshot: `.artifacts/testing-2026-09-09/` contains the tracked source/test patch, two new prompts, and the prior focused test report. The source changes remain uncommitted. Retain the content-addressed deployment ZIP; do not identify this candidate by Git HEAD alone.

## Changes available for testing

Auth rejection/refusal takes precedence over ordinary support acknowledgement. Protected-query handoff records success only after a successful gateway effect and uses distinct requested, failed, and unknown replies. Purchase selection reads authorized `amountDisclosure`; conflicting missing-currency prose is removed. Extractor guidance preserves explicit event context. Trace summaries use strict version validation and bounded collections, with human-takeover results and purchase counts retained and operational notes omitted.

These are incomplete repairs under evaluation, not a claim that every item in `debug-2026-09-08.md` is resolved. Image/currency support from the earlier artifact is included.

## Known blockers before acceptance

The last focused run passed 74 tests and failed 7. Typecheck passed. Six failures concern old email-recovery or repeated-query expectations in `tests/agent-service-information-flow.test.ts`; reconcile each with the human-first policy and independently assert authorization clearance, retained pending context, and real handoff outcome. Do not simply delete assertions. The seventh is the initial-information extractor prompt-size gate: 10,550 bytes against a ceiling of 10,300; reduce irrelevant guidance rather than raising the ceiling.

Remaining implementation review: reject forged versioned summaries for unknown tools; redact the newly stored handoff receipt in exported plans; preserve handoff deduplication through plan reset; add integrated failure/unknown/retry regressions; finish the diagnostic packets and judge-input digests specified in the debugging report. Behavior coverage registration and current-artifact live acceptance remain outstanding.

## Execution order for the testing session

1. Verify the deployed `CodeS3Key` matches the candidate above. If runtime or prompts change, deploy development again and record the new digest before live tests.
2. Resolve the seven local failures and add the missing invariant tests and separate coverage registry entries. Run:

   ```sh
   npm run typecheck
   npm run lint
   npx vitest run tests/agent-service-information-flow.test.ts tests/artifact-redaction.test.ts tests/trace-agent-visibility.test.ts tests/f3-purchase-continuity.test.ts tests/prompt-audit.test.ts tests/live-behavior-coverage.test.ts
   ```

3. Run the full required live suite, using configured development credentials without printing them:

   ```sh
   AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live
   ```

4. Review complete transcripts and stored state for the cases below. Record the run directory, artifact, structural failures and semantic scores in `docs/implementation-log.md`. A skipped case, missing judge, error or failed hard expectation is a failed gate.

## Manual and live regression checklist

| Scenario | Required observation |
|---|---|
| Wrong phone account with an active protected request | Clear rejected authorization before support acknowledgement; no automatic email/OTP recovery; preserve question for human help. |
| Explicit refusal of verification | Close protected access without another authentication prompt or protected disclosure. |
| OTP non-delivery / failed or uncertain handoff | No OTP loop; at most the permitted single attempt; no claim of requested help on failure; unknown outcome is not retried automatically. |
| Mailbox report, detail, and deferral | Maintain support context without interpreting every report as an explicit human-transfer request. |
| Carina purchase clarification | Preserve explicit campaign/event anchor across turns; select by grounded evidence; disclose only authorized amount fields. |
| Multiple purchases / Joaquin | One grounded selection question, authorized candidate amounts, no unsupported dedication-change claim. |
| Pending purchase with absent currency | No invented currency or unsolicited missing-currency caveat; validation timing only with provenance. |
| Customer transaction code | Freeze matched-reference and unavailable-reference worlds separately; unique-order status may be answered without claiming a fabricated code match. |
| Trace export | Lambda → live target → report preserves summary counts/status; no phone, token, image bytes or private receipt; triple projection is stable. |
| Image-only, captioned image, and both media errors | Retain caption; resend/text fallback for unavailable/oversized media; never treat a receipt image as payment verification. |
| Four purchase currency endpoints | Normalize backend code/symbol when present; do not infer currency from symbol alone or convert amounts. |

Use isolated evaluation identities or a designated development test contact. Do not replay customer messages into production. Production acceptance remains separate from this development testing candidate.
