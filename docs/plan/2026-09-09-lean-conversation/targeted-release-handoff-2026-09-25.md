# Targeted development evaluation and exact-artifact production promotion

## Scope and immutable candidate

This handoff evaluates the customer-support corrections committed as `e8f6d3fe`, `654f01a3`, and `299ef95f`. The offline RSVP test correction `d51acfef` and the live-oracle revisions in this handoff do not change Lambda bytes. Development serves artifact SHA-256 `690039f218f6faed9ee98bef9732b64d3aaeaf7b3c6eb45dd08095c975d6a8c1`, Lambda CodeSha256 `aQA58hj2+u2e6YvvlzK2TTqur3s8brRd0ICVyXXWqME=`, from stack `recap-agent-runtime-dev`. Production has not been promoted. The source tree has other unrelated dirty paths; **the artifact hash, not HEAD, identifies the candidate**. Do not rebuild the candidate, redeploy development, change model settings, run the full suite, or silently repair a case during this evaluation.

The RSVP offline correction is justified by two intentional same-turn reads: complete authorized profile preparation before extraction, followed by a fresh phone-scoped RSVP read before a reply or mutation. The RSVP-specific user-event and phone-event reads overlap. The four former failures asserted one total phone-event read and missed the profile read; they now test the actual two-read order. `tests/agent-service-rsvp.test.ts` passes 36/36 and TypeScript typecheck passes. This correction is evaluator-only and does not invalidate the deployed artifact.

## Preflight (read-only, no model calls)

1. Confirm `se-dev` in `us-east-1` resolves STS account `684516060775`; if expired, run `aws login --profile se-signin` and retry. Never use another profile.
2. Record current development and production stack parameters, Lambda CodeSha256, and state in `docs/implementation-log.md`. Confirm the development `CodeS3Key` equals `lambda/690039f218f6faed9ee98bef9732b64d3aaeaf7b3c6eb45dd08095c975d6a8c1.zip`, the Lambda CodeSha256 above, and the three development OpenAI model parameters are `gpt-6-luna`. Confirm production's original `CodeS3Key`, three model parameters, CodeSha256, and secret ARNs for rollback.
3. Run `npm run typecheck` and `npm run test -- --run tests/agent-service-rsvp.test.ts tests/rsvp-verified-effect.test.ts tests/complete-customer-context-serialized.test.ts tests/purchase-prompt-policy.test.ts tests/faq-prompt-economy.test.ts tests/live-behavior-coverage.test.ts tests/fixture-migration-25.test.ts`. The offline RSVP file must be 36/36; any new failure in the selected files stops the release. Do not broaden to the known stale full offline suite.
4. Resolve precisely the ten case IDs below with the catalog loader before network work. Freeze their YAML and fixture hashes and record them beside the candidate artifact hash. This step must not alter any fixture or oracle.

## One bounded live invocation

Run exactly one development `eval:behavior-live` invocation, with these ten explicit IDs and `--case-concurrency 2 --judge-concurrency 1 --label final-support-690039f2`:

```sh
npm run eval:behavior-live -- \
  --case live_behavior.payment_destination_requires_pending_purchase \
  --case live_behavior.customer_transaction_reference_matched \
  --case live_behavior.customer_transaction_reference_unavailable_multiple \
  --case live_behavior.host_withdrawal_diana_policy_and_support \
  --case live_behavior.rsvp_plus_one_multiple_events_requires_selection \
  --case live_behavior.rsvp_plus_one_uses_phone_scoped_mutation \
  --case live_behavior.rsvp_plus_one_not_eligible_no_false_success \
  --case live_behavior.rsvp_host_set_declining_consistent \
  --case live_behavior.image_unavailable_captioned \
  --case live_behavior.gift_credit_pending_payment_stays_pending \
  --case-concurrency 2 --judge-concurrency 1 --label final-support-690039f2
```

The paid budget is **one invocation, ten selected cases, at most US$0.10 observed total**. Progress prints the measured running cost. If it crosses US$0.10, interrupt further work, preserve partial artifacts, and do not start another run. Do not retry a semantic failure, substitute cases, resume an interrupted run as a gate, or invoke the unfiltered suite. Do not treat an earlier run as evidence for these artifact/oracle bytes.

## Trace-based adjudication

Inspect each case's delivered text, extraction summary, complete tool trace, fixture effects, source coverage, and judge evidence. Do not infer correctness from the aggregate score alone. Record one row per case: executed turns, product pass/fail, oracle issue if any, effect counts, authorized-source grounding, and concise evidence path. These are the binding behaviors:

| Case | Required observable behavior |
| --- | --- |
| Payment destination | No Yape phone/account/CCI or claim of a found pending purchase when this fixture has none. |
| Matched transaction reference | Answer only from the matching event A order, without opaque IDs or unrelated event B facts. |
| Unavailable multiple references | Do not claim a code match; distinguish both authorized orders and ask one focused selection question. |
| Diana withdrawal | Retain the host withdrawal topic, answer the source-backed general policy, make one actual human handoff, never claim an individual withdrawal status, and do not repeat the handoff on the final turn. Phone-scoped profile prefetch reads are allowed. |
| RSVP multiple events | Present the real alternatives without merging guests or dates; zero RSVP writes before selection. |
| RSVP companion saved | Backend `saved=true` yields a truthful companion confirmation, exactly one authorized write, with no contradictory inability claim. |
| RSVP companion not eligible | Backend `saved=false` is reported honestly, with no false success or duplicate write. |
| Host declining | Preserve the specific event/guest identity and the backend attendance state; no cross-event answer or unauthorized mutation. |
| Unavailable image | Deliver a useful reply from available context without pretending to read the image or asking the customer for an image or URL. |
| Pending credit gift | Keep the hosts' account-credit choice separate from pending payment; no settlement, balance, shipping, or recipient-purpose invention. |

A case is a **real blocker** if the delivered response or effects violate authorization, identity, payment/RSVP state, destination disclosure, support action truth, required delivery, or the user's actual question. A judge-only failure may be adjudicated as an oracle defect only when the saved answer and fixture/tool facts prove the required behavior; quote the conflicting rubric clause and trace evidence. Internal node names, incidental read counts from authorized profile prefetch, exact wording, and optional extra context are not independent product blockers. A missing candidate turn, transport error, 429 before candidate delivery, or uninspectable effect ledger is **unresolved**, never a pass. If a judge 429 occurs after a complete delivered turn, inspect the same saved turn manually against every factual and effect requirement and label the waiver explicitly; no second paid judge call.

## Promotion decision and execution

Promote only if all ten cases have inspectable delivered turns, there are **zero real blockers and zero unresolved cases**, and any formal failures have documented evidence-backed oracle or judge-availability adjudications. Do not demand 10/10 formal green when the evidence establishes a stale oracle; do not waive a real product contradiction to meet a date. If criteria fail, stop with the exact blocker and no production change. There is no additional full gate or baseline-comparison requirement for this bounded release decision.

For a qualified candidate, download **only** `s3://recap-agent-artifacts-684516060775-us-east-1/lambda/690039f218f6faed9ee98bef9732b64d3aaeaf7b3c6eb45dd08095c975d6a8c1.zip` with `AWS_PROFILE=se-dev AWS_REGION=us-east-1` to a private local path. Verify its SHA-256 equals the full artifact hash above. Preserve the pre-promotion production stack/CodeSha/model snapshot. Promote without rebuilding through the existing CloudFormation deploy script using `DEPLOYMENT_ENV=production`, `DEPLOY_ARTIFACT_PATH=<verified zip>`, `DEPLOY_ARTIFACT_SHA256=690039f218f6faed9ee98bef9732b64d3aaeaf7b3c6eb45dd08095c975d6a8c1`, `OPENAI_MODEL=gpt-6-luna`, `OPENAI_EXTRACTOR_MODEL=gpt-6-luna`, `OPENAI_RESPONSE_CLASSIFIER_MODEL=gpt-6-luna`, `AWS_PROFILE=se-dev`, and `AWS_REGION=us-east-1`. The script must fail closed unless development still serves the same S3 key and CodeSha256 and production model parity can be established.

After CloudFormation completes, verify production `UPDATE_COMPLETE`, Lambda `Active` / `Successful`, CodeSha256 exactly `aQA58hj2+u2e6YvvlzK2TTqur3s8brRd0ICVyXXWqME=`, production `CodeS3Key` exactly the tested key, and all three Lambda model environment variables equal `gpt-6-luna`. Perform a read-only URL health check that does not invoke the model. If any post-promotion identity or health check fails, restore the captured original production artifact/model parameters through the existing CloudFormation stack, verify the original CodeSha256, and report the incident; never claim promotion succeeded merely because the deploy command exited zero. Append run ID, exact case disposition, measured cost, production before/after identities, and any waiver/rollback to `docs/implementation-log.md`.
