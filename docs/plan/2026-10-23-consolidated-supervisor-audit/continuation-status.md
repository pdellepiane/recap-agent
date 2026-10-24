> Latest user-authorized outcome: source `61969c85` was promoted to production on October 23, 2026, after six targeted development cases passed. Public-search follow-up supervision failed and remains open. See [production result](../2026-10-23-payment-prompt-repair/production-result.md). The review lock remains unapproved; earlier deployment boundaries below are historical.

## Completed local continuation — October 23, 2026 (America/Lima)

The development deployment and single final focused check are complete. See [FINAL-LOCAL-RESULT.md](FINAL-LOCAL-RESULT.md) for exact Spanish conversations, timings, effects, failures and cost. Source `2866333a`; deployed ZIP SHA-256 `f5161f93b625901aca62d1bf8d6bbafc5a4b3ffd26ae484d0896add7bc187408`; Lambda hash verified before paid calls and again after supervision. Original local HEAD and all 143 changed/untracked files remain intact in the original checkout.

Targeted run `eval-2026-10-24T01-27-46-207Z-0772f6e3`: 4/4 hard-assertion cases passed once, concurrency 1, zero judges. Nine supervised turns: payment PASS WITH FINDINGS, public search PASS, withdrawal/gift policy PASS. The payment live case still inferred a balance from a pending total; supervised payment still used hypothetical acknowledgment, stiff handoff wording and null structured reported-payment state. Those defects remain open. No semantic retries or follow-on fixes were run. New usage estimate USD0.016656; cumulative recorded USD0.120045. Prompt freshness remains failed/pending; lock unchanged. Production remains undeployed.

The historical status below predates this final run and is preserved as historical evidence. It does not authorize a full panel or another improvement cycle.

---

# Continuation status — 23 October 2026

**Superseded candidate:** [final-language-fix.md](final-language-fix.md) records newer local wording and follow-up repairs, passing offline checks and the session restriction blocking their deployment. The deployment and live evidence below apply to the earlier artifact only.

Implementation, offline validation and development deployment are complete. The final targeted six-case panel passed 6 of 6. Four supervised conversations ran against the final artifact; three passed or passed with findings and one failed with a new open defect. Production was not changed. All pre-existing working-tree changes and untracked analysis were preserved; no commit was made.

## What changed

| Area | Result | Detail |
| --- | --- | --- |
| Extraction | Instructions, operation advertisements and the actual output schema share one typed projection. Unsupported requested operations remain expressible; execution remains authorized separately. | [Extraction implementation](extraction-implementation.md) |
| Actual request contracts | Exact module/file/instruction matching, nested schema and enum bindings, invariant ownership, positive/negative applicability, tool manifests and mutation tests. A 64-state mixed-capability matrix exercises production construction. | [Contract and coverage implementation](implementation-contract-coverage-note.md) |
| Request lifecycle | Stable retained-request identity, outcome-backed settlement, request-scoped payment reports, and retained handoff receipts prevent an unrelated answer from reactivating the older refund. | [Support implementation](support-implementation-note.md) |
| FAQ and public guidance | Withdrawal and gift-fee topics are distinct; no-hours FAQ completion works; public figures/links are permitted without private authorization; failed sources remain failed. Fresh FAQ/event tasks have a reachable structured information route. | [Reply implementation](reply-lane-implementation.md) |
| Financial provenance | Pending order total is distinct from received funds or verified balance. Thank-you actor guidance loads only when a thank-you record exists, and does not establish a platform notification. | Actual-request tests and separately registered live coverage |
| Explicit pause | The actual runtime and existing regressions deliberately retire explicit pause. Production schema/intents now match that behavior rather than advertising an action the runtime discards. Final close remains distinct from automatic persistence. | Dynamic policy and schema-bound actual-request tests |
| Inventory and review | Production, audit-only, explicit archive and true orphan classifications replace artificial consumers. The existing pending review lock remains unchanged and unapproved. | Contract/freshness tests |
| Decisions router | The client uses the SDK's native `decisions` resource on GA (`openai@7.43.0`, `@openai/agents@0.21.0`). Every choice question carries 2–255 options; with no retained request, `same_open_request` is omitted and read as `new`. The human-help receipt is forwarded so a confirmed takeover is visible to the policy. | Router client, question binding and lane tests |

The published withdrawal policy is usable evidence; no fixed PEN20 fee or fresh currency conversion was introduced. The gift/service calculator is not represented as a verified withdrawal-conversion tool. Public search guidance makes no claim that a particular event was found or published.

## Validation obtained

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npx vitest run --maxWorkers=2 --minWorkers=1` | **217 files passed; 1,755 tests passed; one existing skip** |
| Final frozen-case/fixture, coverage and actual-contract subset | Pass, including the new zero-request binding and 2–255 choice invariants |
| `git diff --check` | Pass |
| Fresh build | Pass, `.artifacts/decisions-ga-router-r2-build` |
| Build prompt copy versus source | Exact byte match for every tracked prompt text file |
| `npm run audit:prompt-freshness` | **Blocked as intended**: current prompts, old pending reviews and dependency/prompt drift remain visible. No approvals were manufactured. |
| Development identity/deployment | Verified `se-dev` / `us-east-1` / account `684516060775`; final artifact deployed with router enabled |
| Targeted live panel (final artifact) | **6 passed / 0 failed**, zero judges, USD 0.012434 |
| Supervised conversations (final artifact) | 4 conversations / 11 turns; 1 PASS, 2 PASS WITH FINDINGS, 1 FAIL |

The first full integration run retained six failures (including the duplicated coverage schema and stale input-string assertions). These were repaired and the complete suite rerun. The withdrawal operational-example leak was fixed while retaining its original negative assertions; verified public fee-plus-hours evidence has separate positive coverage. No byte ceiling was increased to clear the tests. One later full-suite run had a transient failure at `tests/agent-service-information-flow.test.ts:688`; it passed on rerun with no code change.

Resource evidence is secondary to those contracts. The complete customer-profile test preserved a 19,906-byte authorized profile and measured extraction instructions/input at 5,981/21,735 bytes. Router inputs measured 2,943 bytes ordinary and 6,928 heavy. Relevant failed runs were kept visible; there was no paid semantic retry.

Raw local logs are under `.artifacts/consolidated-supervisor-validation/`. They are local diagnostic artifacts; the deployed identity and live runs below are the runtime evidence.

## Exact candidate artifact

See [build identity](artifacts/continuation-build.json) for the earlier candidate and [final build identity](artifacts/decisions-ga-router-build.json) for the deployed artifact. The final artifact is:

- ZIP: `.artifacts/decisions-ga-router-2026-10-23-r2.zip`.
- SHA-256: `a38b7f5a4554110e6c4c7419a3f508a6a7df67f8e7a808f04e9158e103154fdf`.
- Deployed Lambda `CodeSha256`: `o4t/WkVUEQ5sTHQZo/UIpqffZ/jnqAjwTpFY4QMVT98=`.
- Function: `recap-agent-runtime-dev`, `DEPLOYMENT_ENV=development`, `AGENT_FEATURE_DECISIONS_ROUTER=true`.
- Last modified: `2026-10-23T22:07:12Z`.

The first deployed artifact was `.artifacts/decisions-ga-router-2026-10-23.zip`, SHA-256 `72806d04eb1ae5b341a6efaa50776bea17e47d3b2e2d52952330d7af61612b1c`, Lambda `CodeSha256` `coBtBOsa5bNBpu+qUHdr6hfkfTsuLVKVIzDXr2FhKxw=`. It is retained only as the artifact the first targeted run exercised; it is superseded.

## Development deployment and live validation

### First artifact: router rejected every request

The first targeted run, `eval-2026-10-23T21-57-21-539Z-b487ce75`, passed 3 of 6 cases and cost USD 0.014260. CloudWatch showed every router call returning HTTP 400 in 44–49 ms, so every turn silently fell back to the classifier and extractor. GA requires 2–255 choices per choice question; with zero retained requests the binding emitted only `new`.

Three failures remained after that diagnosis: `host_receipt_fact_in_judge_evidence` answered the refund demand instead of escalating; `question_after_takeover_is_answered` marked the unrelated date question as the same open request and soft-paused; `pending_total_dispute_is_reviewed` failed only on `161.20` versus `161,20`.

### Final artifact: targeted panel 6/6

The final run, `eval-2026-10-23T22-07-57-263Z-e7cf88a8`, passed **6 of 6** cases, cost USD 0.012434, and used zero judges. The refund demand escalated once; the post-takeover date question was answered without a second handoff; the pending total dispute escalated once and preserved the parked request.

The earlier full panel run `eval-2026-10-23T21-27-05-005Z-23782365` remains visible at 9 of 15 passed, 6 failed, USD 0.068251. It ran on the pre-GA `consolidated-supervisor` artifact (`76d21632…`), not on either Decisions GA artifact. **The other nine panel cases were last verified there and were not rerun after the GA migration or the prompt revision.** The 6/6 result covers only the six previously failing cases.

### Supervised conversations

Four synthetic objectives from the frozen manifest ran against the final artifact, 11 turns total (within the 16-turn ceiling), zero judges and no panel expansion. Ledgers:

| Objective | Verdict | Finding |
| --- | --- | --- |
| `partial-payment-review` | PASS WITH FINDINGS | L7 on turns 1–2: the customer is told the payment is pending but not what she can do next. |
| `public-search-without-association` | **FAIL** | Turn 2 escalated a public-search clarification as `router_escalation:unresolved_request_repeated`; the escalation reply failed schema validation (`ModelBehaviorError`) and the customer received no message. |
| `withdrawal-and-gift-policy` | PASS WITH FINDINGS | L7 on turn 3: the refusal to compute a net amount omitted the simulator pointer. |
| `return-to-parked-refund` | PASS | One confirmed handoff, authorized date answer, parked-refund soft pause without a second handoff. |

The public-search failure is a new open defect. A public search that returned `not_found` is a completed answer, not an unresolved request that should escalate on the next follow-up, and the typed failure path delivered no prose. The one-turn live case `live_behavior.unassociated_event_has_public_search` covers only turn 1. No retry or new live case was run; the finding needs a behaviour change and a follow-up regression.

### Spend

- Earlier full panel: USD 0.068251.
- First targeted run: USD 0.014260.
- Final targeted run: USD 0.012434.
- Live evaluation subtotal: USD 0.094945.
- Supervision priced from recorded token usage with `evals/studies/pricing-2026-09-25.json`: USD 0.008444. The probe does not report a dollar cost.
- Total live spend: USD 0.103389 against the operator-selected USD 1 ceiling.

## Access and identity

The earlier `Operation not permitted` failure while opening the local AWS login cache was resolved by refreshing the `se-signin` login. `se-dev` STS then confirmed account `684516060775` and user `arn:aws:iam::684516060775:user/Leo` in `us-east-1`. No credential material was copied or printed. Production was not touched.

## Remaining work, explicitly open

1. Fix the public-search follow-up: a `not_found` public search must remain an answered request, and the next clarification must not escalate; the escalation composition failure must not deliver silence. Add a deterministic twin and a follow-up live case when the behaviour changes.
2. Address the two L7 findings (pending payment next step, calculator pointer after a refusal to compute a net amount), or record an explicit acceptance.
3. Rerun the other nine frozen panel cases on the final artifact if a full-panel claim is required; they were not rerun after the GA migration or the prompt revision.
4. Complete genuine semantic review before approving any review-lock entry. Passing structural tests or regenerating a hash does not supply that approval.
5. Production promotion remains out of scope and unperformed.

The final artifact passed the six previously failing targeted cases and three of four supervised conversations. The public-search follow-up failed. No current result establishes that the production screenshots' failures cannot recur.
