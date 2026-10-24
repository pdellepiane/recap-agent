# Consolidated Plan — WhatsApp Behavior Cases (Final, reconciled 2026-10-21)

**Delegation package: [implementation/](implementation/README.md).**
**Phase B entry point: [implementation/FINAL-ENTRYPOINT.md](implementation/FINAL-ENTRYPOINT.md)**
— authoritative for all remaining work. This file is the summary;
where it differs from 00–04, FINAL-ENTRYPOINT wins.

Status: Phase A (Decisions routing) IMPLEMENTED and deployed to
development 2026-10-21. Phase B (reply language) PLANNED, not
implemented. No Phase B code has been changed.

## 1. Cases and trace recheck (unchanged, verified)

4 cases: A Wilfredo 51997460648 (Yape receipt, settlement latency),
B Luis Miguel 51989176370 (COD309553, guest lane has no
`increment_id` — unmatchable by construction), C Mirta Lopez
51992405363 (refund loop; runtime conversation 2026-10-17, not
10-19), D Silvia Morales 51959609348 (Plin vs declined card).
32 runtime turns traced (A7 B9 C12 D4); backend state at
conversation time vs today established per turn — see
[00-context-cases-traces.md](implementation/00-context-cases-traces.md)
and `artifacts/turn-table-2026-10-20.md`.

Root causes confirmed: escalation signals fired and were
suppressed (sticky purchase-thread latch); capability-blocked
tasks routed to the zero-tool FAQ node; derivation offers were
prose with no typed state; a separate extraction call cost
~8 s/turn on a lane where 1 of ~20 fields changed behavior.

## 2. Phase A — implemented (2026-10-21)

Decisions API router owns the customer-assistance lane behind
`AGENT_FEATURE_DECISIONS_ROUTER=true` (isolated raw-fetch client;
installed SDK cannot call /v1/decisions). Extractor no longer
runs on this lane; support turns run {router, reply}. Deterministic
policy owns thresholds, repeat-signature backstop, dedupe, and
takeover effects. Supervised transcripts:
`artifacts/supervised-transcripts-2026-10-21.md` (C/D/E on the
router lane, 3.1–5.6 s/turn vs 9.2–28.2 s classifier path).
Structural twins and fixtures in `tests/whatsapp-dossier-twins.
test.ts`, `evals/fixtures/purchase-*.json`. Language supervision
harness: `evals/e2e-supervision/` (objectives A–E, rubric L1–L9,
4 ledgers). Reported green at handoff: typecheck, lint,
209 files / 1599 tests.

Correction carried from the audit: `payment_proof.verify` is
intentionally available as model-mediated review (existing
tests + implementation log), NOT a manifest bug. The earlier
WP1 instruction to mark it `not_implemented` is revoked.

## 3. Phase B — the remaining defect is language

Phase A fixed WHERE turns go. The replies still turn users away
through five mechanisms (evidence: 32 dossier turns + supervised
conversations): uncertainty as the main clause repeated across
turns; verdict + handoff announced in two frames (open defect
D2 in `evals/e2e-supervision/ledgers/2026-10-21-obj-d-silvia-
transfer.md`); capability confession without transfer; dead-end
next steps ("contacta a soporte" from inside support); and
repetition without memory — no typed fact tells the model a
limitation was already stated.

Handoff assumption audit (full table in FINAL-ENTRYPOINT §1):
OBJ-A/OBJ-B have no qualified ledger; supervised conversations
run 2–3 turns vs the 4–12-turn originals; one ledger's turn 1
ran the classifier fallback and is invalid as router evidence;
OBJ-E's dual-PASS hides nondeterminism; plan-reset completeness
(turn lock, session focus) is unproven.

## 4. Phase B — decisions (final; implementer takes none)

Directives D1–D5 (FINAL-ENTRYPOINT §3): escalation replies have
ONE frame (facts → derivation+receipt → guest action; the
unresolved part is transferred, never announced as a second
"no puedo confirmar" verdict); a limitation is stated once per
conversation; never instruct the guest to contact support from
inside support; capability statements must transfer ownership;
length follows resolution state and explicit brevity requests.

Prompt modifications P1–P4, verbatim blocks in FINAL-ENTRYPOINT
§4: append to `prompts/nodes/solicitar_agente_humano/
response_contract.txt` (single-frame block), `.../system.txt`
(limitationAlreadyStated opening rule), `prompts/nodes/
resolver_consultas_informativas/response_contract.txt`
(no re-opening, no bare capability confession, no
contact-support resolution, brevity ≤2 sentences), and one
sentence to `prompts/shared/reply_core.txt`. No other prompt
text changes; directives constrain structure, model still
writes every sentence.

Only runtime change: typed limitation memory —
`limitationAlreadyStated: boolean` + `priorLimitationTurns:
number`, derived deterministically from the outcome signature,
projected into compose evidence on FAQ and solicitar nodes,
with unit + prompt-audit tests (FINAL-ENTRYPOINT §5).

New rubric check L10 (no repeated limitation) and new
end-to-end objectives F–O (FINAL-ENTRYPOINT §6): persistent
guest ≥5 turns (F), correction (G), post-handoff new question
(H), handoff failure/unknown (I), happy-path false-escalation
guard (J), notification question (K), brevity (L),
wrong-recipient transfer (M), de-escalation (N), 5×
repeatability distribution (O).

## 5. Remaining work (WP-L1..L6, 27–43 agent-hours)

WP-L1 supervision validity (router-validity line in ledgers,
proven plan reset, missing OBJ-A/OBJ-B ledgers) → WP-L2 typed
limitation memory → WP-L3 prompt blocks P1–P4 + L10 → WP-L4
redeploy + D2/OBJ-C re-run closing the open defect → WP-L5
fixtures + objectives F–O + ledgers → WP-L6 structural layer
for effect-assertable findings only + registry + log.
Ordering constraints and done-criteria: FINAL-ENTRYPOINT §7.

## 6. Acceptance (merged, objective)

Phase A (reported met at handoff): offline suite green;
support turns show {router, reply} stages; targeted live
cases only, never the unfiltered gate.
Phase B (FINAL-ENTRYPOINT §9): D2 re-run passes L1 single
frame; OBJ-F ≥5 turns with no limitation delivered twice
(L10); OBJ-A/B ledgers exist with router-validity lines;
OBJ-O distribution recorded with any L1/L2 FAIL reopening the
package; typecheck/lint/full offline suite green; every
behavior change has its own coverage-registry entry, targeted
eval, and implementation-log entry.

## 7. File map

- [implementation/README.md](implementation/README.md) — package orientation
- [implementation/00-context-cases-traces.md](implementation/00-context-cases-traces.md) — cases, traces, backend then-vs-now
- [implementation/01-architecture-decisions.md](implementation/01-architecture-decisions.md) — Phase A design record (implemented)
- [implementation/02-workpackages.md](implementation/02-workpackages.md) — Phase A work record (implemented)
- [implementation/03-acceptance-tests.md](implementation/03-acceptance-tests.md) — Phase A acceptance (twins A–E live on in the harness)
- [implementation/04-implementation-rules.md](implementation/04-implementation-rules.md) — repo law for all phases
- [implementation/FINAL-ENTRYPOINT.md](implementation/FINAL-ENTRYPOINT.md) — **Phase B delegation entry point (start here)**
- `evals/e2e-supervision/` — supervision skill, objectives, rubric, ledgers
- `artifacts/turn-table-2026-10-20.md`, `artifacts/supervised-transcripts-2026-10-21.md` — trace evidence
