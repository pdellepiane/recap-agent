# 03 — Acceptance Tests (objective; no semantic judges)

Rules for all cases below: hard assertions on authorization,
effects, backend facts, failure outcomes, and receipts only.
No style/vocabulary pins, no prompt-byte budgets as pass criteria
(byte gates below are perf assertions on stage metrics, allowed),
no mandatory read-tool calls beyond the takeover effect itself.
Every live case goes in `live_behavior_regression` with a
deterministic offline twin where behavior is model-independent.

## Offline twins (fixture replays of stored evidence)

### Twin A — Wilfredo (settlement latency + repeat backstop)
Fixture: 7 turns, purchase reads empty/complete, Yape receipt
image turn 1, carts 470893/471454 in profile.
Assert: escalation (route human_escalation + request_human_
takeover called + gateway receipt) no later than the turn where
repeatCount reaches 2; no turn asserts global purchase absence
after the receipt turn; stages contain no extraction.

### Twin B — Luis (COD + frustration escalation)
Fixture: 9 turns, profile with 4 approved purchases incl.
Michi & Chino US$ 86.45, referencePresent=false everywhere,
COD309553 in turn 4 message/image.
Assert: no COD-denial outcome (referenceResolution=unavailable
never composes an answer turn twice); purchase facts for
Michi & Chino answered from profile; escalation at the
"propia página" objection turn (needs_human_now or loop_risk
trigger); takeover receipt present.

### Twin C — Mirta (derivation truth + host receipt)
Fixture: 12 turns, approved S/ 87.36, item S/ 79 host_credit,
thanksPresent=true, refund demands turns 4–12.
Assert: escalation by turn 6; turns 4–5 variant (derivation
offered then accepted) executes takeover on the accept turn;
judge evidence contains host-receipt fact (WP4); amounts in
evidence labeled charged_total=87.36, gift_value=79.

### Twin D — Silvia (terse loop; backstop only)
Fixture: 4 turns, declined card record only, Plin receipt
S/ 391.87 image turn 1, classifier health progressing x4.
Assert: escalation via repeatCount backstop by turn 3 despite
progressing health; no extraction stage; takeover receipt.

### Twin E — Multi-purchase ambiguity (guardrail for merged compose)
Fixture: profile with ≥2 purchases, ask ambiguous between them,
router route=ask_clarification.
Assert: composed sidecar citedOrderIds empty or matches the
clarification target set; no purchase-specific backend claim
(orderId-keyed fact) in the turn's evidence assertions.

## Live cases (one registry entry per behavior change)

Register separately in evals/live-behavior-coverage.yaml:
1. decisions-router-escalates-frustrated-purchase-support (C)
2. repeat-signature-backstop-escalates-terse-loop (D)
3. cod-unavailable-never-denies-twice (B)
4. receipt-without-backend-purchase-escalates (A)
5. derivation-accept-executes-takeover (C variant)
6. host-receipt-fact-in-judge-evidence (C, WP4)

## Commands (exact)

```bash
npm run typecheck && npm run lint
npx vitest run tests/live-behavior-coverage.test.ts
npm test   # full offline suite before deploy
npm run eval:behavior-live -- --case live_behavior.<case_id>
```

Targeted cases only. Never run an unfiltered/full live gate.
Do not retry semantic failures or broaden the panel without a
new user instruction (repo law).

## Perf gates (from perf records on replayed/live turns)

- Support-lane turns: model stages ⊆ {router, reply}; escalate
  turns show the takeover effect and no extraction stage.
- Per-turn total model input bytes on this lane below the
  measured two-call baseline (~50 KB, Luis COD turn:
  18,213 + 32,276 + classifier).
- Escalated-turn latency below the 13,023 ms Luis baseline.
- 0 of 32 replayed turns end in the FAQ node with
  capability_blocked >= 0.80 or repeatCount >= 2 unresolved.

## Failure handling in validation

Any failing assertion is a real contract failure: fix the
implementation, never weaken, skip, or rewrite the test to fit.
Pre-existing failures must be proven by re-running the same
test on the untouched base commit.
