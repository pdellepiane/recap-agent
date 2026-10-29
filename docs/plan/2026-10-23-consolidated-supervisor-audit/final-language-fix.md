# Final WhatsApp language correction — 2026-10-23 (Lima)

The user requested natural customer-service replies, repair of the remaining follow-ups, development deployment and one final focused check. Production is not authorized. These working-tree changes are newer than deployed candidate `a38b7f5a`; the older supervision ledgers do not validate them.

## Changes and verification

- Replaced the shared reply core with concise WhatsApp guidance: answer first, no evidence narration, repeated caveats, greetings or redundant amounts. Authorized facts and effect receipts remain authoritative.
- Pending payment: identify the total as the total, then offer review instead of listing uncertainties. A customer reporting payment gets acknowledgment and an offer of review. No invented balance or handoff before its receipt.
- Public search: give the public link without requiring phone association or invitation code. An actual associated-event `not_found` remains a source miss, but a delivered, answered public-search orientation can settle the conversational request. It no longer leaves an unfinished lookup that triggers takeover on the next clarification. Outages, authorization failures, purchase misses and other pending work do not receive this exception.
- Fees: stay on the current topic. For a specific gift amount, lead with the service simulator rather than refusal or the entire formula. Do not calculate withdrawal net amounts, invent conversions or direct withdrawal conversions to the gift simulator. Ask whether it is the first transfer when relevant; offer human clarification for an exact unpublished equivalent.
- Handoff replies normally use one or two sentences about the real outcome. For SDK `ModelBehaviorError`, retry the same side-effect-free composition once with the same facts and schema; never repeat the persisted takeover. Guardrail, transport and claim-validation failures are not retried. If both compositions fail, preserve the typed failure. This is bounded recovery, not guaranteed prose under every provider failure. Trace the retry and mark failed-attempt token usage unavailable.

Regression tests:

- `tests/agent-service-information-flow.test.ts`: two-turn public-search twin using the real synthetic fixture and scripted router. It deliberately keeps `requestSettled=false` so settlement must come from delivery and the actual source outcome. Empty lookup plus answered orientation settles; the next clarification sends a reply without takeover. A source outage stays pending even when the composer claims answered.
- `tests/whatsapp-dossier-twins.test.ts`: schema failure followed by success, two schema failures, timeout and guardrail failure. Assertions cover retry bounds, identical evidence, one real handoff and persisted handoff state.
- Existing shared-core wording assertions now match the replacement wording. No byte ceiling, financial guard, origin guard or review approval was relaxed. Pending review lock unchanged.

Offline: typecheck and lint pass; full suite **217 files passed, 1,761 tests passed, one existing skip**. The earlier full run retained one failing prompt-economy assertion; the core was simplified and the final full run passed. Prompt freshness remains blocked by pending semantic reviews. The final artifact identity and prompt/source byte comparison are in `artifacts/final-language-build.json`.

## Deployment blocker

Development deployment did not run. STS through `se-dev` failed before any mutation because this session cannot read `/Users/leonardocandio/.aws/login/cache/…json` (`Operation not permitted`). Automatic approval review rejected elevated identity verification under the session policy. No credential content was read, copied or printed. This does not establish login expiration. No new paid call ran; no latency or live-language improvement is claimed.

## Exact remaining final check

`final-language-check.json` freezes four existing live cases, once each, then three improvised supervised conversations, at most four turns each, zero judges and no semantic retry. Additional ceiling USD0.25 remains within the earlier USD1 ceiling (recorded prior spend USD0.103389). Keep the earlier failed transcripts.

In a session with access to the existing AWS login:

1. Verify `aws sts get-caller-identity --profile se-dev --region us-east-1`; stop unless account is `684516060775`.
2. Deploy the artifact and digest from `artifacts/final-language-build.json` with the existing script: `DEPLOYMENT_ENV=development AGENT_FEATURE_DECISIONS_ROUTER=true DEPLOY_ARTIFACT_PATH=… DEPLOY_ARTIFACT_SHA256=… npm run deploy`.
3. Re-read the development Lambda CodeSha256 and router flag; verify the artifact before running cases.
4. Run only the four manifest IDs via `npm run eval:behavior-live -- --case <id>`. Never run the unfiltered gate or rerun a semantic failure.
5. Follow `evals/e2e-supervision/SKILL.md`: reset each full synthetic partition, use the mandatory matching fixture and phone, fresh run/case/session IDs, and improvise each next user message from the actual reply. Retain all delivered replies, timing, receipt facts and L1–L11 verdicts. Stop at the manifest bounds.
6. Show the actual exchanges. Prompt changes and offline twins do not establish better live language or speed. Production stays untouched.
