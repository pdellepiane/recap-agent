# Lean-conversation work dispatch

## Current dispatch — September 14

Read [recheck-2026-09-14.md](recheck-2026-09-14.md) first. No newer full live run exists locally after31697069 (57/102). Repairs are present locally; fresh bounded offline run1543passed/5skipped, but integration and live acceptance remain open. Follow S0 → S2 → S3 → S1 → S4 → S5 → S6 → S7 → S8. The September11 matrix remains historical evidence, not a result from the repaired code. [Fresh evidence](recheck-2026-09-14-evidence.json).


## Latest audited gate and binding repair handoff — 2026-09-11

Read [latest-run-31697069-repair-plan.md](latest-run-31697069-repair-plan.md) and its [45-case matrix](latest-run-31697069-case-matrix.md) before implementing. Latest full gate: **57/102 passed,44 failed,1 error,0 skipped**. Acceptance remains red. This supersedes older “next task” summaries and withdrawn package assumptions. Packets C0,F1–F3,R1–R6,C1 define the decided changes, exclusive ownership, negative tests and release conditions. Historical completion notes below are retained as history, not current acceptance.


## Historical dispatch notes

The older dispatch sequence below is retained for provenance. Do not execute its stale next-task, duration or URL-only directions. The latest repair packets above and inbound-continuity-correction.md are binding.

## Binding correction: no package protocol

Read [inbound-continuity-correction.md](inbound-continuity-correction.md) first. Backend batching is invisible: Lambda keeps text + optional image. Earlier ordered-parts/package-schema implementation directions are withdrawn. No timer or batch state. Answer current requests, persist supplemental images quietly, and respond to later questions without repeating resolved explanations.

## Current execution contract

[lean-image-execution-contract.md](lean-image-execution-contract.md) is authoritative for implementation: five-day native image retention, existing mutex reuse, no description model pass, bounded profile enrichment, atomic file ownership and strict acceptance. Earlier 30-day retention is superseded for new uploads.

## Latest sync decisions

Read [batching-profile-sync.md](batching-profile-sync.md): backend owns eight-second batching; support all image/text orders within and across packages; image-only defaults to typed silence unless fulfilling an outstanding task. Expand relevant authorized profile details with bounded traversal and no age cutoff. Campaign implementation waits for docs.

## Superseding decision — base64 image continuity (2026-09-11)

Read [persistent-image-context.md](persistent-image-context.md) first. Backend URLs are optional. Base64 images will be uploaded to OpenAI Files, retained as plan references for 30 days, and used by the established owner across turns. Earlier directions to preserve base64 description behavior are superseded. Implementation remains pending.

## Current reconciliation — 2026-09-11

Read [progress-audit-2026-09-11.md](progress-audit-2026-09-11.md) first. Canonical gate is 48/89, with both product and evaluator defects. Customer-profile integration and host-withdrawal migration remain incomplete. Historical milestone counts below are not completion evidence.

## Latest binding amendment — URL images

Read [url-image-context.md](url-image-context.md) before implementing media changes. New URL inputs receive native owner-context attachment behavior and plan-stored references. Existing base64 behavior and nonpersistent handling remain unchanged for now. No new image/object storage. This amendment supersedes conflicting earlier media directions; implementation and acceptance remain pending.


Use this directory without needing the original chat. `plan.yaml` is the execution registry; `plan.md` explains the design; `acceptance-contract.md` defines unchanged E01–E12/R01–R11 requirements. Each unfinished task has a standalone packet under `tasks/` containing the required product context, ownership, exact entry points, steps, tests and handoff format. Read the packet for the assigned task, not every packet.

## Latest amendment — customer context

Read [customer-context.md](customer-context.md) for the new L4 customer snapshot design. Current label: Customer operations; internal planned ID: `customer_assistance`. Bounded parallel authorized reads feed a compact question-relevant model view; no fourth agent, extra profile LLM or universal full-data prompt. Registry revision 4 includes the latest source-progress audit. The earlier progress snapshot below is historical: deletion and telemetry work has since advanced, while complete gate acceptance remains open. Preserve current work and resolve predecessor evidence before dispatch.

## Historical progress snapshot

Audited 2026-09-10 against current source and local evaluation reports. Registry revision 3 contains 15 milestones: five completed, one in progress (L1 seam acceptance), nine pending. This is task bookkeeping, not an effort-weighted completion percentage. The reported 9/9 belongs to the separate production-promotion subset.

- Completed: historical baseline re-pin, contract/inventory freeze, duplicate-close debug fix, recorded frozen-artifact promotion, and `dev-followup` (implementation deployed; target close case passes 0.8998 hardGate true on valid run 618372bf; the owner gate exception 2026-09-10 records the strict gate open on two unrelated oscillating failures).
- In progress: L1 seam acceptance (seam shipped; complete acceptance evidence remains open).
- Next executable implementation: `acceptance-evidence` (E10–E12 request accounting, delivered-output provenance, judge controls). Its predecessor `dev-followup` is complete under the owner exception; the two residual failures (`purchase_confirmation_carina_request_survives_normalization`, `token_seeded_selection_defer_close`) stay explicit for the later l2-close/l3-semantic gates.
- Newly assigned work: `acceptance-evidence` owns previously unassigned request accounting, delivered-output provenance and judge controls (E10–E12). They are not assumed implemented simply because they appear in the contract.
- Source still contains `enforcePurchaseReplyDeterministic`, RSVP `deterministicReplyText`, clarification/contact rewrites, and metrics that count only instruction/input bytes and retain the last response ID. L2–L5 remain unfinished. `selectSupportAcknowledgmentMessage` is already absent; do not assign its deletion again.
- Last verified production release is `e8299759` / `6CmXWVDp…`. Current development candidate is artifact `5924e4d7…` / Lambda `WSTk1/jZ…` (2026-09-10T15:36:36Z); valid full gate `618372bf` is 82/84 with the close repeat case passing (0.8998 hardGate true) and two unrelated residual semantic failures retained. Preserve the owner exception as a release decision, not a changed score. Recheck hashes at dispatch; another task may have changed the checkout or deployment.

## Approved owner architecture

Exactly three persistent owners:

1. **Planning** — event needs, provider search/refinement/selection and quote completion.
2. **General information (FAQ)** — public policy, how-to and general information.
3. **Customer assistance** — person-specific purchases/orders/carts, guest/host information, RSVP, authentication, support and escalation, including accountless customers.

Customer assistance is the replacement name for “user operations.” Its capability slices receive only relevant context/tools; they are not separate agents. Initial selection is transient, not a fourth owner. Existing-owner continuations have no extra router call. A policy lookup within an active task is a normal knowledge read; genuine topic changes can transfer silently, at most once per turn. Only the recipient produces the final response and executes its effects. No keyword routing, fixed response text, global rule accumulation or second memory store.

## Dispatch order and ownership

The ready-work order is explicit:

`dev-followup → acceptance-evidence → l1-seam-gate → l2-purchase → l2-close → l2-support-capability → l2-rsvp → l2-clarification-media-auth → l3-semantic → l4-ownership → l5-simplify`

Wave numbers are descriptive; dependencies control dispatch. This ordering prevents concurrent mutation of the large shared runtime and evaluator files. The coordinator grants one writer the listed files and exclusive development deployment use. Do not run a live gate while another task changes its Lambda artifact. Read-only review can run alongside independent work. No deployment or runtime changes are authorized by merely reading a task packet; the coordinator must actually assign ready work.

Before dispatch, inspect current `git status`, HEAD and the predecessor handoff. Preserve others' dirty changes, including S11 fixtures/tests and runtime work. Do not reset, overwrite, stash away or commit another task's edits. If a required artifact is unavailable, retrieve it from the documented private/run location or report the missing evidence; never invent it. Keep customer payloads in private audit storage.

Suggested assignment text:

> Execute task `<task-id>` using `docs/plan/2026-09-09-lean-conversation/tasks/<task-id>.md`. You own only its listed implementation scope plus required registry/log evidence. You are not alone in this checkout: preserve others' edits and incorporate the predecessor handoff. Predecessors: `<verified task IDs and evidence>`. Exclusive writer/development deployment ownership is assigned to you until your handoff. Do not spawn further agents. Follow the packet's acceptance gates; return actual artifacts and unresolved failures, not a self-certified success summary.

If write/deployment ownership cannot be granted, assign read-only review explicitly instead of using that implementation assignment.

## What counts as done

An implementer must return changed files and old/new production callers, focused/full test results, wire request metrics, model-output comparisons, relevant negative controls, source/contract/deployment hashes, and every live run ID. A reviewer inspects the diff and harness artifacts. A text summary, response ID, token usage or targeted pass alone cannot mark the task complete.

Keep all original 83 cases plus the added six-turn close regression; later additions expand the suite without dropping historical cases. Hard structural and required semantic failures, errors, skips, missing receipts and missing provenance remain explicit failures/incomplete acceptance. No phrase blacklist or canned reply may repair the repeat-submission claim. No automatic production promotion; the previous owner exception applies to the artifact already promoted.

For evaluator repairs, preserve the original oracle/results, explain the independently established contradiction, review the evaluator change separately, and compare baseline/candidate under the same revised contract. For holdouts prepared in the same writable workspace, say “robustness tests”; do not claim independent validation.
