# Live hard-contract fixes

Development validation is green: **7/7 targeted cases passed**, **47/47 hard assertions**, zero failures, errors or skips. This is the previously failing seven-case subset. The complete 46-case panel was not rerun on the new artifact.

## Changes

- Recall and thanks preserve the pending purchase question without replaying its old OTP action, reauthenticating or requesting human takeover. The offline twin includes a failed read and an expired session.
- A fresh self attendance confirmation does not inherit an unresolved companion decision. Event-selection-only continuations still preserve explicit companion consent. The live Marta case records one attempted and successful RSVP write.
- Six later-turn count expectations now require zero new writes; each original action turn retains its write assertion. The duplicate-write negative control remains mandatory.

The live case reduction remains **92 → 46 (50% deleted)**. No semantic judges were restored or failed behavior contracts relaxed.

## Evidence

Run: `eval-2026-10-01T02-10-25-180Z-7b62f29a`. Artifact SHA-256: `66bd5408f2c4a6185419544c797b2a7e8ab982bc195f8f8199682871207db328`. Deployment identity is equal before and after the run. Targeted run cost: **$0.025571**, judge cost $0. Including the interrupted infrastructure run, validation cost was **$0.038378**, below the $1 budget.

The earlier run `eval-2026-10-01T00-41-27-299Z-cf39e330` remains invalid and unmodified: four passes and three infrastructure errors, without a post-run deployment identity. AWS access was restored using the required profile. CloudWatch proved the timed-out invocation had already completed before revalidation. No semantic failures were retried and the frozen panel was not expanded.

## Local verification and limits

51 focused offline checks pass, as do type checking and lint. Both new product regressions fail with their fixes removed. The broader information-flow diagnostic has 42 pre-existing failures; comparison shows no newly introduced failures. Their names remain visible in the [machine-readable evidence](2026-09-30-live-hard-contract-fixes.json). No full offline green claim is made.

The RSVP extractor module shrank from 1,011 to 990 UTF-8 instruction bytes. Per-call serialized instruction and input bytes are recorded in the same evidence file. All authorized customer information remains available.
