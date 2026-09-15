# Adversarial implementation review — 2026-09-10

Verdict: meaningful implementation progress; broad acceptance is not established. Scope: current shared worktree at base bdb4a88ac3b3c4fe424a2663fa4f79c6d5f6f157, source inspection, local retained run reports, focused offline tests and a negative probe. No new deployment or live evaluation; current production behavior was not reverified. Preserve ongoing edits. Findings describe acceptance gaps, not evidence of intentional gaming.

## 1. High: output-origin checks can accept inconsistent declared evidence

`src/audit/output-origin.ts:55` validates status, version, nonempty hashes and empty mismatch fields, but does not compare candidate and delivered hashes. A direct local probe with status verified, transport-v1, candidate hash a×64, delivered hash b×64 and no mismatches returned `{valid:true}`. Thus this helper cannot itself establish equality.

More importantly, `src/evals/targets/live-lambda.ts:229` independently hashes the delivered message but trusts the declared candidate hash/status; it does not retrieve independently captured model output. `src/evals/runner.ts:333` rejects missing origin globally, but mismatch/generation_failed checks occur only on turns selected for semantic scoring (`:680` and scorer branch). A mismatch on another turn is not a universal case-level rejection. R01/R11 require stronger evidence and per-turn enforcement.

Required falsification tests: inconsistent candidate/delivered hashes; forged verified status; unknown transformation; mismatch on an unjudged intermediate turn; model call followed by replacement. Drive mutants through actual live-target/finalization code, not only helper assertions. Distinguish raw model output from documented transformed candidate bytes when defining hash equality; do not incorrectly require raw formatting to equal rendered formatting.

## 2. High: E10 completeness assertions are not part of live acceptance

`assertCompleteTransportAccounting` is defined in `src/audit/openai-transport-capture.ts:99`; source search found no production/live runner caller. It is exercised by tests. Live wire schemas now default omitted request arrays to empty; the log explains that detailed arrays are deliberately removed from the public envelope. Compact public traces are reasonable, but aggregate counts cannot prove all requests were accounted for.

Required proof: reconcile the run's private per-request manifest against independent transport observations, expected stages and aggregates through the actual acceptance entrypoint. Missing private detail must yield incomplete accounting, not an implicit pass. Keep sensitive bodies private; no need to enlarge model context or public response envelopes. Test omitted schema bytes and a dropped retry/tool-loop request through that acceptance path. A passing unit assertion on an artificial metrics object is insufficient for R03/E10/R11.

## 3. High: progress labels and validation policy are inconsistent

`plan.yaml` marks acceptance-evidence and several deletion families completed while their notes describe offline-only validation or pending paired reruns. The latest retained full report found is `eval-2026-09-10T16-37-22-533Z-618372bf`: 82/84, zero errors, two failures. Later inspected reports are targeted diagnostics and include failures; no full passing report for the latest worktree was established.

The log's “leanness directive” narrows repeated full-suite testing and records owner exceptions. Preserve that history; do not call the exceptions unauthorized. However, the latest supplied AGENTS.md explicitly requires a full post-deployment behavior gate for behavior changes. The registry, packets, log and current governing instructions need reconciliation. A waived release/process decision never converts a hard failure to a pass.

Align progress using separate implementation, offline verification, deployed-candidate and strict acceptance states. Do not restore old bytes or start a new dev gate while another task owns deployment. Evaluator changes need the documented reviewed revised-contract comparison, or an explicit recorded limitation; no apples-to-oranges improvement claim.

## 4. Medium: model-written language is improved but not universal

The inspected legacy purchase/RSVP replacement symbols have been removed, and transport/origin modules exist: these are genuine changes. But `agent-service.ts:7109–7133` still returns canned escalation and conversation-health sentences; live callers exist at `:579`, `:626` and `:1223`. Capability outcome renderers also retain sentence dictionaries. This matches the still-pending support/capability family; it disproves any claim that the entire runtime already meets the model-written invariant.

Finish the pending migration using typed outcomes and actual model composition, preserving auth and receipts. Never pass a canned answer to the model and call that model ownership. Verify two different valid outputs survive the same state and test failed/unknown handoff outcomes.

## 5. Medium: three-owner execution and customer snapshot are still design work

No planned persistent owner discriminator was found in the inspected core plan schema; L3/L4/L5 remain pending. Existing concurrent information reads and per-turn caches support the proposed snapshot, but do not establish the three-owner architecture or a reusable customer profile. No matched end-to-end latency/request reduction measurement was established. Customer home/shipping address support remains unverified; event place/country data is not equivalent.

Keep the approved target: Planning, General information (FAQ), Customer operations. Purchases/RSVP/auth/support are capability slices, not more owners. Snapshot loading must reuse existing reads, remain authorization-scoped, expose task-relevant facts, and invalidate after actions. Test actual latency/call/byte savings with relevant-fact preservation before claiming simplification.

## Verification performed

Focused tests: five files, 19 tests passed — acceptance-contract-mutations, model-output-origin, openai-transport-capture, live-behavior-coverage and semantic-judge. A separate inconsistent-hash negative probe was accepted as valid by the origin helper. Passing current tests therefore does not falsify the identified gaps.

No inference of malicious reward hacking: the main risk is accepting convenient proxies (completed labels, token presence, aggregate counters, selected-turn checks or successful retries) as the stronger evidence the contract requires. Historical exceptions and failed runs must remain visible. Confidence is high in the cited code/probe findings, moderate in overall progress because the shared worktree is active, and insufficient for a current release certification.

## Delegation boundary

Assign a separate audit/reconciliation task before broad new architecture work. It should reproduce or refute these findings through real entrypoints, pin current evidence, distinguish implementation from acceptance, and recommend the smallest corrections. No production change, no canned workaround, no threshold relaxation, no unrelated refactor. Runtime fixes require explicit file/development ownership so ongoing work is preserved. This report does not authorize deployment or mutate runtime behavior.
