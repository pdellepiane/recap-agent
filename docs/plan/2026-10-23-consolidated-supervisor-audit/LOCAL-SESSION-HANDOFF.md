> Completed locally on October 23, 2026 (America/Lima): development deployment and the single final focused check are finished. Read [FINAL-LOCAL-RESULT.md](FINAL-LOCAL-RESULT.md) for full Spanish transcripts, timings, receipts and retained failures. Four targeted hard-assertion cases passed; payment language still has findings. Original working tree preserved; production and review lock unchanged. The remaining-execution instructions below are historical and must not be replayed as authorization for another paid run.

# Local session handoff: final development deployment and WhatsApp check

This is the current entry point. Read this file before acting on older status notes.

## User goal and existing authorization

The user wants the assistant to sound like a helpful customer-service person on WhatsApp, without repetitive caveats, evidence narration or dead ends. Implementations and offline validation are finished for the current candidate. The remaining work is to deploy **development**, perform **one final focused live/supervised check**, and show the actual exchanges and response times. The user wants completion, not another audit or open-ended redesign.

The user explicitly authorized fixes, development deployment, targeted live cases and supervised conversations, and subsequently authorized atomic commits and a push. Do not ask for those permissions again. **Production deployment is not authorized.** Do not run an unfiltered paid evaluation, expand the panel, retry a semantic failure to improve the score, introduce a semantic judge, approve the prompt review lock to clear CI, hardcode customer replies, or replace model-written Spanish with canned fallback prose.

The original screenshots are from production, not the modified development version. A fixture reenactment is not evidence of a real customer backend payment or actual WhatsApp network delivery.

## Where the work is, and how to obtain it safely

Repository: `https://github.com/pdellepiane/recap-agent`, branch `main`.

Pushed and independently verified remote head before this documentation update:

- `a8c31281` — Document WhatsApp support cases and acceptance criteria.
- `f72535893a43b7443258aac6f7bc82577d2dd8ef` — Fix support conversations and bind prompt contracts to runtime requests.

The second commit contains the coupled runtime, prompts, SDK upgrade, tests, fixtures, coverage, audit mechanism and handoff documents. The first contains the earlier case-analysis documents. All 142 changed/new files were byte-compared against the original working directory after committing. The isolated commit checkout was clean.

The cloud session could edit workspace files but could not write the original `.git/index.lock`. It therefore cloned the complete local history into `/tmp/recap-agent-final-atomic`, copied the changed/new files, committed there and pushed normally to `origin/main`. Push fast-forwarded remote `e6f9381f` to `f7253589`, including the intervening existing local commits. No force push, history rewrite, workflow dispatch or deployment was performed. The original workspace was deliberately preserved, including its old HEAD and dirty/untracked files. The two commits are real remote Git commits, not merely a patch or a claim of synchronization.

On the user's PC, inspect `git status`, branch and HEAD first. Do not blindly pull over a dirty checkout, reset it, discard files or apply `working-tree.patch`. That patch is an older audit snapshot and is superseded by the commits. If local changes are identical to the pushed files, establish that before reconciling. A fresh sibling checkout of `origin/main` is a safe way to run the final work while preserving unrelated local changes. Existing ignored `.env` files and local AWS credentials are not in Git; use the existing authorized local configuration without printing secrets. Confirm `f7253589` is an ancestor of the checkout you use.

## Latest changes, and why

### Natural language and final follow-up repairs

See `final-language-fix.md` for the last implementation pass.

- The shared reply core now asks for direct, short, natural WhatsApp Spanish. Normally two or three sentences: answer and a useful next step if needed. Avoid report-like phrases such as “el registro disponible” and “no permite confirmar”, evidence narration, repeated greetings, redundant totals and recycled policy paragraphs.
- Pending payment: state the purchase total as a total, distinguish it from received funds and verified balance, and offer review. When the customer says she already paid, acknowledge it and offer review instead of repeating uncertainty. Do not announce a handoff before a real receipt exists.
- Public event search: direct the person to the public search URL without making phone association or an invitation code a requirement. Additional search details are not automatically a reason for takeover. A source `not_found` remains a source miss, but an actually delivered, answered public-search orientation can settle the conversational request. The next clarification no longer escalates merely because the lookup found nothing.
- Fees: answer the current topic. A specific gift amount should lead to the service simulator rather than refusal or a formula dump. Do not calculate withdrawal net amounts, invent a conversion, or imply the gift simulator computes withdrawal conversions. Ask whether this is the first transfer when relevant; otherwise offer team clarification for an unpublished exact equivalent.
- Handoff messages normally use one or two sentences about the actual outcome. If the SDK throws `ModelBehaviorError`, regenerate the same side-effect-free composition once, with identical facts and schema. The persisted takeover does not execute again. Transport failures, guardrails and unsupported-handoff claims are not retried. A second schema failure still yields a typed failure; this is bounded recovery, not a guarantee of prose under every provider failure. Retry evidence records failed-attempt token usage as unavailable.

Main final-pass files: `prompts/shared/reply_core.txt`, the information reply `response_contract.txt`, `public_event_search.txt`, `commission.txt`, `withdrawal_fee.txt`, the handoff `response_contract.txt`, router `route.txt` and `request_settled.txt`, `src/runtime/support-lane-flow.ts`, `src/runtime/agent-service.ts`, and their regression tests.

### Earlier consolidated implementation included in the same candidate

- Actual extraction schema, instruction projection and capability context share one construction boundary. Requested unavailable operations remain expressible without authorizing execution. Provider operations, selection and inspection have separate scoped modules. Removed stale `destination_account` guidance.
- The runtime had deliberately retired explicit pause; extraction schema/intents now match that fact. Final close remains distinct from automatic persistence. Do not reintroduce explicit pause as a side task.
- OTP, campaign and continuity guidance moved into tracked conditional extraction modules instead of hidden instruction-bearing runtime strings.
- Typed fee topics distinguish gift commission, host withdrawal and mixed questions. General withdrawal FAQ completion does not require processing-hour evidence. Raw operational examples are excluded from public fee grounding; verified public fee evidence remains available.
- Public figures and links are allowed when sourced; private accounts/payment destinations still require appropriate purchase authorization. Image guidance no longer blocks public search/calculator links. Partial results preserve both ready records and failed sources.
- Open requests have stable retained identities, request-scoped reported-payment/reconciliation evidence, and settlement based on actual execution plus delivered reply outcome. An unrelated factual answer does not reactivate a parked refund. Retained takeover receipts prevent duplicate escalation.
- Structured `information_flow` recovers FAQ/event work after the router without an extra classifier. Receipt/image handling retains its existing guarded route. Thank-you provenance guidance is scoped to real thank-you evidence and never proves a platform notification.
- Native GA Decisions client uses `openai@7.43.0` and `@openai/agents@0.21.0`. Choice questions have 2–255 options; zero retained requests omit the one-option `same_open_request` question and interpret it as `new`. Confirmed human-help receipts reach router policy.
- Actual request contracts validate exact selected modules/files/instructions, nested schema paths/enums, tools, invariant ownership and applicability. Mutation tests and a 64-state mixed-capability matrix exercise construction. Inventory distinguishes production, audit-only, archive and orphan files without fabricated consumers.
- Freshness fingerprints invalidate old semantic review approvals when prompts or covered dependencies change. This is structural enforcement plus review invalidation, not proof that arbitrary prose is semantically correct. `evals/prompt-review-lock.json` remains pending and unapproved.
- Coverage schema has explicit working-tree source evidence and separate historical entries for `34051051` and `02d23684`. Synthetic fixture phones are validated by the supervised probe.

Detailed lane notes: `extraction-implementation.md`, `support-implementation-note.md`, `reply-lane-implementation.md`, `implementation-contract-coverage-note.md`. Some opening status sentences in older notes still say “uncommitted”; those are historical lane status, superseded by the pushed commits above.

## Customer cases and non-negotiable facts

### October 20 feedback

1. Francesca, pending total/payment dispute: the purchase total is **PEN161.20**. The outbound notice suggested a possible **PEN11.20** balance, but the total alone does not verify that balance or received PEN150. Never call the total a received payment. Do not keep repeating settlement caveats. Offer a useful review path and execute only with actual handoff semantics.
2. Bonnie, unassociated guest looking for an event: names supplied in the production screenshot were Alexandra Toledo and Alejandro Castillo. Give `https://sinenvolturas.com/buscar`; do not keep asking for association/names or invent venue, time or admission details. The synthetic fixture deliberately uses test names; it is not a lookup of the real wedding.
3. Withdrawal cost question: answer supported public policy. The published source says first transfer free, later transfers US$5 or equivalent. Do not hardcode Claudia's uncertain PEN20 estimate. Gift/service commissions are a separate topic. Use `https://sinenvolturas.com/coste-del-servicio` for supported gift/service calculations; do not calculate amounts yourself or claim it is a withdrawal-conversion calculator.

### Earlier dossier A–D

A Wilfredo: receipt/no purchase match; B Luis Miguel: unavailable COD reference and notification/thanks provenance; C Mirta: approved PEN87.36 versus gift value PEN79, then refund; D Silvia: declined card record versus customer-reported Plin payment. Preserve the distinct money labels, sources, customer claims and real handoff outcomes.

Verbatim source transcription and fixture/live-case mapping: `analysis/2026-10-19-whatsapp-behavior-cases/transcription.md`, `sources.md`, `implementation/FINAL-ENTRYPOINT.md`, and original `docs/plan/2026-09-09-lean-conversation/supervisor-handoff-2026-10-23.md`. The 12 original CRM screenshots were in `~/Downloads`; the three later WhatsApp screenshots and `image.png` may also exist there. Read the transcription and manifests rather than assuming those images are present in a new clone.

## Validation already completed for the final source

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- Full `npx vitest run --maxWorkers=2 --minWorkers=1`: **217 files passed, 1,761 tests passed, one existing skip**.
- Final affected subset after the final prompt edit: **148 passed, one skip**, five files (`owner-b-decision-2-prompt-economy`, `prompt-contracts`, `runtime-actual-request`, `whatsapp-dossier-twins`, `agent-service-information-flow`).
- Build passed; all **139 prompt text files** in the bundle matched source bytes.
- No byte ceiling was increased, review approval manufactured or financial/output-origin guard removed.
- Freshness gate remains blocked by pending semantic reviews and drift. This is expected and must be reported, not silently bypassed or “fixed” with approvals.

The final public-search twin uses the actual synthetic fixture and scripted router with `requestSettled=false`, proving the empty lookup can settle only through actual outcome/delivery. Its negative control keeps a true source outage pending even if the composer claims answered. Schema-recovery twins cover success on the second composition, exhausted recovery, timeout and guardrail, while asserting one takeover and identical evidence.

An earlier full run retained a prompt-economy failure; the core was simplified and wording assertions reconciled, then the final full suite passed. Do not quote the earlier failed run as the final result or hide it. The staged archive `working-tree.patch` contains normal patch context whitespace; three pre-existing new provider prompt files have extra EOF blank lines. They were preserved byte-for-byte rather than changing the validated artifact to satisfy a whitespace-only archive check.

Ignored diagnostic logs and ZIPs under `.artifacts/` are **not pushed**. Test/build results are recorded in committed notes/metadata. A fresh local session may need to rebuild rather than expecting those files from Git.

## Artifact and actual deployment state

Final source archive built in the cloud workspace:

- Path: `.artifacts/final-whatsapp-language-2026-10-23.zip`.
- SHA-256: `a054effc4de3373c2f21530246bb707efeff1bf530413b954379bda31af66f27`.
- Corresponding Lambda CodeSha256: `oFTv/E3jNzwvIVMCRrtwfv7/G/UwQTuVQ3m9oxr2byc=`.
- **Not deployed. No new paid calls or final live check ran for this source.**

`artifacts/final-language-build.json` describes the build before committing, so its `sourceCommit=8b69c341` and working-tree wording are historical build provenance. Exact source bytes were subsequently committed in `f7253589`. Do not rewrite that record as though the cloud artifact was built from a clean checkout of the later commit.

If the exact ignored ZIP is present locally, verify its hash before use. Otherwise build a fresh ZIP from the committed candidate, record its new hash, and compare that hash to the deployed CodeSha256. ZIP timestamps can change the hash even when source is identical. Never assign the old digest to a newly built ZIP or deploy an older similarly named archive.

Last **recorded**, not freshly re-read, development deployment is the earlier candidate:

- Function `recap-agent-runtime-dev`, `DEPLOYMENT_ENV=development`, router enabled.
- ZIP SHA-256 `a38b7f5a4554110e6c4c7419a3f508a6a7df67f8e7a808f04e9158e103154fdf`.
- Lambda CodeSha256 `o4t/WkVUEQ5sTHQZo/UIpqffZ/jnqAjwTpFY4QMVT98=`.
- Last recorded modification `2026-10-23T22:07:12Z`.

Re-read current AWS state; another local agent could have changed development since then. No production state was modified by the final correction or commits/push.

## Why deployment stopped in the cloud session

`aws sts get-caller-identity --profile se-dev --region us-east-1` failed before any mutation because the session could not read the existing local AWS login cache: `Operation not permitted`. Automatic approval review rejected elevated identity verification under that session policy. This was not evidence of expired credentials. No credential material was copied or printed.

User says `se-dev` is authenticated locally. Verify it in the local session. Use **only** profile `se-dev`, region `us-east-1`, account **684516060775**; fail closed on mismatch. If actually expired, `aws login --profile se-signin` refreshes the backing login. Do not repeat the cloud diagnosis as if it proved that the user's authentication is broken.

## Historical live evidence — do not overclaim

All following results belong to earlier artifacts, not the final language candidate:

- Pre-GA full selected panel: `eval-2026-10-23T21-27-05-005Z-23782365`, **9/15 pass**, USD0.068251.
- First GA artifact: `eval-2026-10-23T21-57-21-539Z-b487ce75`, **3/6 pass**, USD0.014260. Router calls failed HTTP400 because a question had one choice, so fallback classification masked the router failure. The 2–255 choice fix addressed this.
- GA r2: `eval-2026-10-23T22-07-57-263Z-e7cf88a8`, **6/6 pass**, USD0.012434, zero judges. These were the six previously failing cases; **the other nine were not rerun on GA r2 or the later prompt revision**.
- Four supervised conversations on GA r2: partial payment PASS WITH FINDINGS (no next step on turns1–2), public search FAIL (follow-up incorrectly escalated and schema failure delivered no message), withdrawal/gift policy PASS WITH FINDINGS (withdrawal net answer dead end), parked refund PASS (one handoff, unrelated date answered, return soft-paused).

Ledgers: `evals/e2e-supervision/ledgers/2026-10-23-supervision-{partial-payment-review,public-search,withdrawal-and-gift-policy,return-to-parked-refund}.md`. Keep the failed originals; do not edit them to look as if the latest candidate passed.

Observed old probe wall times: payment2.7–4.4s; initial public search8.6s; withdrawal/fee questions8.5–9.7s. Extraction alone took about3.9–5.8s in slow flows. These include probe overhead and are not WhatsApp delivery latency. The final language fixes have **no measured speedup yet**. Do not promise faster performance based only on fewer words.

Previous recorded live evaluation spend USD0.094945 plus supervision priced USD0.008444 = **USD0.103389** against the original USD1 operator ceiling. Probe costs require recorded token usage/pricing; absence of reported cost is not zero cost.

## Exact remaining execution, in order

1. Reconcile local checkout safely and read this handoff plus `evals/e2e-supervision/SKILL.md`. Read the current protocol/rubric as needed. The skill/README's old SDK warning about raw-fetch and never upgrading is historical and superseded by the committed, validated native GA migration above. Do not downgrade the SDK or restore the old router client.
2. Verify local `se-dev` identity and account. Inspect current development function hash and router flag before deployment; record that state.
3. Use the existing validated source. If local bytes differ, inspect and reconcile rather than deploying an unreviewed mixture. Do not restart the audit. If source changes become necessary, test the affected behavior and record them before the single final run. Do not claim previous tests validate additional edits.
4. Build outside `dist/` (historically root-owned): `BUILD_OUTPUT_DIR=.artifacts/final-local-language-build npm run build`. Package that directory as a fresh ZIP, record SHA-256/base64 and source commit, and verify all prompt copies match source.
5. Deploy development with the repository script: `DEPLOYMENT_ENV=development AGENT_FEATURE_DECISIONS_ROUTER=true DEPLOY_ARTIFACT_PATH=<zip> DEPLOY_ARTIFACT_SHA256=<actual-new-sha> npm run deploy`. Profile/account checks in the script remain enabled. Never select production.
6. Re-read Lambda CodeSha256, DEPLOYMENT_ENV and AGENT_FEATURE_DECISIONS_ROUTER. Verify exact hash and expected configuration before any paid case. Preserve the previous artifact identity for rollback; do not initiate a rollback without a reason.
7. Perform the final check frozen in `final-language-check.json`: **four cases, concurrency1, one execution per case, zero judges, no semantic retry**. Additional operator ceiling **USD0.25**, within the original USD1. The CLI reports cost but does not enforce dollar admission; supervise that bound.

Explicit case IDs:

- `live_behavior.pending_total_dispute_is_reviewed`
- `live_behavior.unassociated_event_has_public_search`
- `live_behavior.withdrawal_fee_policy_and_calculator`
- `live_behavior.question_after_takeover_is_answered`

Run only those IDs with the supported `npm run eval:behavior-live -- --case <id>` interface; the manifest contains exact case hashes. Never run the command without filters. The one-turn public-search case alone does not prove the follow-up fix; supervision below is required.

8. Run **three supervised conversations, max4 turns each /12 total**, from these fixtures and exact synthetic phones:

| Fixture | Phone | Objective |
| --- | --- | --- |
| `purchase-partial-payment-review` | `51900000420` | Plain explanation of total, useful offer of review, acceptance executes once, no invented paid amount/balance. |
| `public-event-unassociated` | `51900000421` | Public-search guidance, then follow up without code and with more details; no inappropriate takeover, silence, OTP or fabricated event. |
| `withdrawal-fee-policy` | `51900000422` | Explain withdrawal fee, then concrete gift amount and withdrawal net; no new arithmetic and a useful correctly scoped next step. |

Do not run them against real customer records. Before each conversation, stop concurrent turns and reset the **whole** `whatsapp#<phone>` partition, not only PLAN. Save before/after results and confirm remaining0. Use the existing reset script with `--profile se-dev --region us-east-1 --table recap-agent-runtime-dev-plans --channel whatsapp --phone <phone>`, first `--dry-run`, then `--yes`. Keep the probe `--user-id` equal to that phone (no leading `+`); contact phone may use `+`. Fresh run/case/session IDs avoid mixing fixture histories.

Every probe invocation must supply `--scenario <fixture>` and the matching seeded phone. The scenario is the barrier preventing calls to real customer data. Never remove it. Use `scripts/supervised-probe.mjs` and the command protocol in the skill. Write the next guest message yourself based on the actual previous reply, not a stored script. Read delivered text, delivery action, stages/timing/tokens, request state, takeover receipt and effects. Qualify L1–L11 manually; do not delegate a semantic judge. Retain failures and stop at the bound. Legitimate parked-thread silence differs from a composition failure that dropped a reply.

9. Write new ledgers and final evidence containing candidate source/hash/config, selected run IDs, hard expectations, actual full Spanish exchanges, timings, cost/usage limitations, failures and human verdicts. Keep the older evidence unchanged. Show the user the actual reenactments, particularly public-search turn2 and payment next-step language. If a WhatsApp-style image is used, label it as a visualization of the recorded synthetic development conversation, not a screenshot of actual customer delivery. Do not invent improved replies as though observed.
10. Update continuation-status/implementation-log with the exact final result, commit atomically and push the result if within this continuation's authorized work. Report pass/failure honestly. **Do not deploy production, clear the pending review lock, expand to the other nine cases, or launch another improvement cycle just to get green.** If the final check fails, preserve and report the concrete failure; no result establishes that every possible failure is handled.

## What remains uncertain

Naturalness and speed of the final candidate are unverified live. The public-search follow-up is proved deterministically offline but still needs actual model supervision. Bounded schema recovery can still exhaust; it does not guarantee delivery during persistent provider failure. The final focused check is not a full-suite live validation, and genuine semantic prompt review is still pending. The user should see exactly that scope before any later production decision.
