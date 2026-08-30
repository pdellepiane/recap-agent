# T5r Review Note - Reviewer gate on the T5 change set before deploy 2

Plan: plan-2026-08-27-rsvp-projection-prompt-audit. Task: T5r (wave 5). Review mode: high. Scope: changed.
Reviewed tree: main at 9824f59f. T5 change set: 9 commits since (excluding) 71a04063.
Date: 2026-08-30. Reviewer: T5r (read-only; this note is the only artifact written).

## Verdict

WARNING - T7 may proceed. Zero blocking findings. Seven warning-level findings recorded below,
none of which weakens a gate, weakens a live case, or removes load-bearing 13-case-gate behavior.

## Change set reviewed

| Commit | Content |
|---|---|
| ced76260 | docs/log: T6 gate attempt 15 record + registry placeholder fix a1b2c3d4 -> d81c760b (T12-fix A+B record) |
| 6e3f489b | M1: historical min-disclosure projection parity in src/audit/prompt-branch-measurement.ts + parity tests |
| dc2322d6 | F4: delete 24 dead prompts/nodes/*/transition_policy.txt files |
| 6411cc7e | F2: resolver_consultas_informativas OTP/email dedupe across system.txt and response_contract.txt |
| b45ee992 | F3: remove forbids of unattached tools in 5 tool_policy.txt files |
| 008d0b50 | F6: consolidate duplicate corporate-reception rule in response_classifier.txt |
| d6bb8f08 | F5: remove 3 information-route bullets from shared/domain_scope.txt |
| 5e0698f5 | RSVP tightening: remove 5 duplicated lines from responder_invitacion/response_contract.txt |
| 9824f59f | registry: 4 new behavior-change entries + T5 log block with after-table |

Diff footprint: 40 files, 260 insertions, 115 deletions. No runtime (src/runtime, src/core) changes,
no infra/template.yaml changes, no extractors/ changes, no .continues-handoff.md change, no new
dependencies.

## Criteria assessment (handoff C1-C7)

### C1 - Deleted files provably unloaded: PASS

Ran the loader-reference check independently, not from the report:

- src/runtime/prompt-loader.ts loads only from explicit lists: conversationPromptFilesForNode,
  nodePromptManifest, extractorPromptFiles(ForCapabilities), responseClassifierPromptFiles. It uses
  fs.readFile per listed path; there is no directory scan anywhere in the loader.
- src/runtime/prompt-manifest.ts buildNodeFiles (lines 139-145) wires exactly system.txt,
  response_contract.txt, tool_policy.txt per node; conversationSharedPromptFiles and
  conversationPlanningPromptFiles (lines 4-26) list only shared/*.txt. No transition_policy reference.
- Repo-wide grep for "transition_policy" across src/, tests/, evals/, scripts/ matches only
  src/audit/prompt-inventory.ts, which merely labels on-disk orphans (its orphan branch simply no
  longer triggers once the files are gone).
- Inventory integrity re-proven by tests: prompt inventory totalFiles 128 -> 104, unmappedFiles []
  (tests/prompt-audit.test.ts, green in the re-run below).
- All 24 deleted files match the T4 F4 list (docs/prompt-audit/2026-08-system-prompt-audit.md:171-174).

Deletion is safe. Zero loader references existed.

### C2 - Removed prompt lines are redundant; nothing load-bearing removed: PASS

Every removed line was cross-checked against current HEAD content:

F4 (24 transition_policy files): never sent to any model (not in any manifest); duplicates of live
rules elsewhere per T4 evidence. Zero runtime bytes.

F2 (resolver OTP/email, commit 6411cc7e): each rule now lives exactly once.
- otp_sent/otp_resent guidance: retained in response_contract.txt min-disclosure block, including
  "no puedes leer imagenes ni capturas" and the "no uses la palabra texto" clause (required by live
  case live_behavior.otp_sent_explains_image_limitation).
- otp_pending guidance: retained in response_contract.txt min-disclosure block.
- otp_invalid block: untouched in contract; never had a twin in system.
- email_required rule with the protected verbatim quote requirement ("la informacion de tu cuenta",
  anti-generic-substitution clauses): retained in system.txt line 10.
- bandeja rule: retained in system.txt line 13.

F3 (tool forbids, commit b45ee992): manifest cross-check confirms every forbidden tool was
unattached at its node - entrevista / aclarar_pedir_faltante / refinar_criterios allowedTools are
[list_categories, get_category_by_slug, list_locations] (forbade search_providers_*), 
buscar_proveedores allowedTools are the four search/get_relevant tools (forbade
list_categories/list_locations), recomendar allowedTools are [get_provider_detail,
get_related_providers, list_provider_reviews] (forbade new searches). resolveDynamicTools only
narrows. Attached-tool usage rules and the dynamic "Herramientas autorizadas" line retained.

F6 (classifier, commit 008d0b50): the deleted restatement's mandatory mapping is still derivable:
priority item 2 (response_classifier.txt line 33) mandates suppress_automated_response with
automation_confidence high for generic brand reception after outbound contact; line 23 states the
runtime only accepts suppress_automated_response with automation_confidence high and reason
automated_response; the unique anti-clause ("no devuelvas respond solo porque esa plantilla termina
con una pregunta generica") was folded verbatim into line 17.

F5 (domain_scope split, commit d6bb8f08): see dedicated section below.

RSVP tightening (commit 5e0698f5): see dedicated section below.

### C3 - No new global rules; Spanish; Minimum Disclosure; net byte reduction: PASS

- Every prompt change in the range is a deletion or an intra-line merge. No line was added to any
  shared/* file; domain_scope.txt only lost lines; no new conditional or keyword-matching logic was
  introduced anywhere (no keyword/exact-string flow matching added; verified in the diffs).
- Conversational content is Spanish throughout; English tokens are typed enum/field names only.
- Net byte reduction measured independently with the M1-corrected tooling: ran
  measureHistoricalBranches(78ae24e) and measureCurrentBranches on HEAD:
  instructionBytes 353784 -> 343668 = -10116 across 38 branches, matching the log's after-table to
  the byte (docs/implementation-log.md:7431). extractor:rsvp +1114 is pre-existing T12 growth, not
  in the T5 range (git diff 71a04063..HEAD -- prompts/extractors/ is empty); excluding it the batch
  itself is -11230.
- Per-branch deltas from my run match the log exactly: 22 planning branches -481 each (4 of them
  plus tool deltas: aclarar -589, entrevista -602, refinar -638, recomendar -530, buscar -559),
  resolver -524, classifier -256, RSVP +215 x3 (justified, down from +1541), extractor:rsvp +1114
  (pre-existing).
- Static compare gate: 732995 -> 339708 (53.65% reduction), green, matching the log.

### C4 - M1 parity correctness and test failure without the fix: PASS (proven empirically)

- src/audit/prompt-branch-measurement.ts now applies projectMinDisclosure to historical git-show
  content via buildBundleFromContents with a default empty reason set; the current side measures
  through the live PromptLoader with no context (empty reasons). Both sides are projected with the
  same (empty) reason set. The -1284 B resolver artifact is explained and eliminated: historical
  anchor for resolver measures 13459 (14743 raw minus the 563+721 min-disclosure blocks).
- Falsification test: in a throwaway worktree at 9824f59f with
  src/audit/prompt-branch-measurement.ts reverted to the pre-fix version (71a04063), both parity
  tests FAIL: test 1 "expected 14743 to be 13459"; test 2 bound "expected 2175 to be less than
  1193". The parity test therefore fails without the fix. Worktree removed afterwards; the repo was
  never modified.
- resolver_consultas_informativas prompt files are byte-identical to 78ae24e except the intentional
  F2 dedupe (-524 net on the empty-reason projection), so the after-table is honest.

### C5 - Registry: PASS with one warning (W2)

- Placeholder fix verified: tighten-rsvp-party-detection-precision implementedBy is d81c760b
  (evals/live-behavior-coverage.yaml:280); git merge-base --is-ancestor confirms d81c760b reachable
  from HEAD. All four new implementedBy SHAs (6411cc7e, 008d0b50, d6bb8f08, 5e0698f5) are reachable
  ancestors on the T5 chain.
- Four new entries (lines 287-298), each with its own id per the one-entry-per-remediation rule.
- All five referenced live case IDs are members of the mandatory suite
  evals/suites/live_behavior_regression.yaml; all referenced case files exist under evals/cases/
  with hard structural expectations plus hard text_semantic requireJudge:true expectations.
- tests/live-behavior-coverage.test.ts green (re-run standalone).
- Warning W2: the F6 entry's live case is not exact coverage of the changed rule (see findings).

### C6 - Local gates credible: PASS (all re-run independently)

| Gate | Reported | My re-run |
|---|---|---|
| Unit suite | 593 passed | 593 passed / 83 files, 0 failed |
| typecheck | clean | clean |
| lint | clean | clean |
| audit:prompts | 0 violations | 0 violations |
| audit:prompts:compare | 53.65% green | 732995 -> 339708, 53.65% |
| live-behavior-coverage.test.ts | green | 1/1 green |
| After-table in log | claimed | present and byte-accurate (independent measurement matches) |

### C7 - No deploys, no live runs, no handoff touch, atomic commits, log entries: PASS with note (W6)

- No commit in the range touches infra/, template.yaml, or deploy scripts. ced76260 only RECORDS the
  pre-existing T12-fix redeploy 59011bb8 (T6 gate attempt 15, 13/13) in the log; T5 itself performed
  no deploy (log states "No deploys per constraints").
- No live eval runs were produced by T5 (no .eval-runs changes; the referenced gate-1 green artifact
  eval-2026-08-30T21-38-12-064Z-bc4720b5 predates the batch).
- .continues-handoff.md untouched (empty diff for the path across the range).
- Commits are single-responsibility and correctly ordered (tooling fix first, then F4/F2/F3/F6/F5,
  then RSVP tightening, then registry+log).
- Note W6: per-change log entries were appended in two commits (ced76260, 9824f59f) rather than one
  append per change commit. The log content itself is complete (every change has reason, decision,
  evidence) and append-only; the plan's per-write ordering rule targeted concurrent appenders
  (wave 2), while T5 is a single wave-4 worker, so there is no correctness impact.

## Special attention item 1 - RSVP prompt tightening vs the 13 live-passing behaviors

Removed from response_contract.txt (5 lines) and their homes at HEAD
(prompts/nodes/responder_invitacion/):

| Removed contract line | Retained home |
|---|---|
| Tone/closing, do-not-repeat state, no internal terminology | system.txt line 7 (cierre libre de saludo/deseo, PROHIBIDO repetir confirmacion/estado/nombre/fecha/pregunta) and line 13 (no valores internos) |
| Tissue bounded per variant (EXACTAMENTE UNA frase; offer-variant fragment-only; PROHIBIDO nueva pregunta; sin "RSVP") | system.txt line 7, which carries strictly more detail incl. the valid/invalid tissue example ("Que disfrutes mucho la celebracion!") |
| Pending question (F8) | system.txt lines 9-10 (informa estado pendiente; pregunta si desea confirmar) |
| Varios eventos enumeration, single question | system.txt line 6 (presenta candidatos con nombre y fecha y formula una sola pregunta) |
| Unavailable: never claim stored confirmation, offer human verification | system.txt line 8 (verbatim-equivalent) |

Live-behavior survival checks against the 13-case gate:
- Fragment composition: "fragmento solo es valido" retained (system line 7); offer-variant
  fragment-only rule retained (rsvp_declined_state_offers_one_change depends on it).
- Tissue rules: fully retained with example (rsvp_confirmed_state_is_reported, cristian case).
- Handoff: code-composed since T10-fix-4/T11 (deterministic disclosure fragment + wiring); the
  removed lines never referenced handoff; contract retains "ofrece el siguiente paso indicado por la
  nota operativa" (line 6).
- No-RSVP vocabulary: "nunca uses la palabra RSVP" retained (system line 7) plus contract line
  "No incluyas palabras comunes en ingles".
- Party detection: runtime code (commit d81c760b), untouched by T5; no removed line related to
  multi-person handling.
- Pending/enumeration/unavailable behaviors remain gated by gate-2's 12-case RSVP re-validation
  (missing_action, ambiguous_event, trusted_phone cover the three non-registered removed lines).

Conclusion: every removed line is redundant with a retained system.txt rule or typed evidence; the
gate's judge-sensitive semantics (fragment-only replies, one-sentence tissue, offer variant) are
carried by system.txt and code-owned fragments, not by the deleted contract duplicates.

## Special attention item 2 - domain_scope split consumer evidence

The 3 removed bullets (account events, recent orders, gift purchase details, each with
WhatsApp-first/email-OTP auth preamble) were shipped to 22 planning-node reply bundles. Consumer
evidence that no planning node relied on them:

1. No planning node can execute information capabilities: planning allowedTools in
   src/runtime/prompt-manifest.ts contain only search/quote/detail/review tools; order/purchase/
   event lookups are runtime capabilities executed by the information route, not model tool calls.
2. The classifier routes information queries to resolver_consultas_informativas; live proof is the
   registered hard assertion delia-enters-information (to: resolver_consultas_informativas) in the
   purchase_delia case.
3. resolver_consultas_informativas/system.txt retains equivalent coverage: line 3 declares the
   sources (eventos asociados a la cuenta, compras u ordenes autenticadas), lines 7-8 carry the
   WhatsApp-first auth with email+code fallback, lines 18-21 carry gift/purchase status detail and
   the modification/retreat exclusions.
4. domain_scope.txt is not loaded by responder_invitacion or resolver (not in planningNodes set),
   so the RSVP and information branches were never consumers.

Nuance W5: the registered coverage case is a fresh-turn information request, not literally a
mid-plan one as T4 worded it. Structurally equivalent for the routing proof (routing is classifier
and code owned, not domain_scope prose), so accepted as a warning only.

## Special attention item 3 - Deletion safety (see C1)

Independently verified: no manifest entry, no dynamic directory load, no test fixture, and no
runtime code referenced any of the 24 deleted files. The only repository references were the audit
inventory's orphan-labeling logic, which tolerates absence (proven by the green 104-file inventory
test).

## Special attention item 4 - Registry entries point at reachable commits and real coverage

All implementedBy SHAs verified reachable via merge-base; all liveCaseIds verified present in the
suite manifest and backed by existing case files with hard structural + requireJudge text_semantic
expectations; coverage test green. One exact-coverage caveat recorded as W2.

## Findings (all warnings; no blocking)

W1. F1 not implemented - documented deviation from a T4 final decision.
    Severity: warning. Evidence: docs/implementation-log.md:7450-7455 ("No per-state RSVP loader
    wiring (F1) - superseded by hybrid fragment tightening") vs
    docs/prompt-audit/2026-08-system-prompt-audit.md:138-147 (F1 decision: route-specific section
    with per-state section selection in assembly). Impact: the audit's only fail-grade finding
    (R03: resolved_single still receives selection guidance) remains open; the +215/branch RSVP
    payload still ships all three states' prose to every state. Mitigation: behavior-preservative
    direction (guidance retained, duplicates removed), explicitly logged, gate 2 re-validates all
    13 RSVP cases. Action for orchestrator: acknowledge the deviation in the plan ledger (F1 =
    deferred, not done); optionally queue F1 for a follow-up batch. Not deploy-blocking.

W2. F6 registry entry is not exact coverage of the changed rule.
    Severity: warning. Evidence: evals/live-behavior-coverage.yaml:290-292 maps
    consolidate-classifier-corporate-reception to live_behavior.rsvp_missing_action_requires_explicit_decision,
    an RSVP case that traverses the classifier but exercises none of the corporate-reception
    evidence; plan decision requires exact coverage when reusing an existing case. Impact: a
    regression specific to the merged reception rule would not fail gate 2. Mitigation: the F6 diff
    is provably semantics-preserving (mandatory mapping retained via priority item 2 and line 23;
    anti-clause folded verbatim), so live risk is low. Action: add a dedicated corporate-reception
    live case in a follow-up, or record the accepted residual risk in the log before T8.

W3. Parity test 2 overclaims and carries a dead fixture.
    Severity: warning (test hygiene). Evidence: tests/prompt-branch-measurement.test.ts:60-68
    writes nodes/test_node files that are never measured; the "via loader" half of the name is
    covered by test 1 instead. Impact: none on correctness (test 1 carries the parity proof and
    both tests fail without the fix). Action: drop the unused fixture or actually measure the
    loader side in a follow-up.

W4. Duplicated min-disclosure projection logic.
    Severity: warning (over-engineering). Evidence: src/audit/prompt-branch-measurement.ts:56-66
    re-implements the regex projection of src/runtime/prompt-loader.ts:98-112 instead of importing
    it. Impact: drift risk between audit measurement and runtime projection. Action: export the
    projection from prompt-loader and reuse it in a follow-up (not in this batch; T3/T5 ownership
    separated the files).

W5. F5 coverage case is fresh-turn, not mid-plan.
    Severity: warning (nuance). Evidence: evals/cases/live-behavior-purchase-delia-phone-orders.yaml:8-12
    (single fresh turn) vs T4's requested "live case exercising a mid-plan information request".
    Impact: routing proof is valid (routing is classifier/code owned); mid-plan planning-node
    behavior after the domain_scope shrink is covered only structurally (no information tools
    attached to planning nodes). Action: acceptable as-is; note for T8 cumulative review.

W6. Log entries appended in two commits instead of one per change commit.
    Severity: warning (process). Evidence: only 9824f59f and ced76260 touch
    docs/implementation-log.md in the range. Impact: none (log is complete, append-only; no
    concurrent appenders in wave 4). Action: none required; keep per-change appends for future
    batches.

W7. Cosmetic prose discrepancy in the T4 artifact (not T5): the audit report and log say
    "21 planning nodes"; the planning set and measurements cover 22 reply branches (-481 each).
    Severity: cosmetic. Action: none for T7.

## Security review

No new secrets, endpoints, transport, or auth surfaces. Guardrail-bearing prompt rules verified
retained after consolidation: the protected verbatim quote requirement for email_required
(system.txt line 10), the inbox/brand-assumption rule (line 13), the no-technical-terms rule
(line 15), and the classifier suppression mapping (lines 23, 33). No keyword/exact-string flow
matching introduced. No new dependencies. Audit tooling change is offline-only (git show of a
pinned ref; no runtime exposure).

## Over-engineering pass

The batch is deletion-dominated and lean. Only W4 (duplicated projection helper) and W3 (dead test
fixture) qualify; both are follow-up-worthy, not batch-blocking. No unrequested abstractions, no
new dependencies, no boilerplate.

## Bottom line

C1-C7 all pass; C5 and C7 carry minor warnings; the batch direction is strictly reductionary
(-10116 B measured, matching the log to the byte), behavior-preservative by construction, and
independently re-gated. T7 may proceed with the planned gate-2 subset (12 RSVP re-validation cases
plus the four newly registered entry IDs' cases). Findings W1 and W2 should be acknowledged by the
orchestrator in the plan ledger; neither blocks the deploy.
