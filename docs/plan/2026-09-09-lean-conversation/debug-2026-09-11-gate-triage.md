# Gate triage brief — dev run d2141705 (2026-09-11, RED 48/89)

For a fresh debugging agent. Read this plus the predecessor handoffs before touching code.

## State

- Repo: /Users/leonardocandio/Work/thesis/recap-agent, branch dev, HEAD bdb4a88a (dirty worktree, do not reset/stash/commit others' edits).
- Dev candidate: artifact 22cb686c…fc, Lambda CodeSha256 IstobBn2IwQprqxN52S7OPxYvHT5Ya+snEAqgrcxdPw= (2026-09-11T12:36:04Z). End-of-run digest identical: exact-candidate acceptance valid.
- Prod (frozen e8299759): 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY= — do not touch.
- Canonical run: .eval-runs/eval-2026-09-11T12-47-51-929Z-d2141705/ (report.json/md, results.jsonl, 89 artifacts).
- Failure list: /private/var/folders/74/37z4glqn2gn41cm59zml7qvc0000gn/T/opencode/dev-gate-failures.txt (41 fails, 0 errored, 0 skipped).
- Full evidence: docs/implementation-log.md tail (2026-09-11 dev validation entry) + evaluation-manifest.md gate section.
- Governing rules: root AGENTS.md (model-written invariant, no canned replies, no keyword routing, no threshold/hard-to-soft/blacklist/judged-turn changes, keep all original cases, retain every run). Single writer on shared runtime files; serialize with coordinator.

## Failure batches (suspected owner in parens)

A. Origin-gate fails (acceptance-evidence/runtime): customer_transaction_reference_matched + unavailable_multiple, host_withdrawal ×3 (diana second axis, general, pending), otp_sent_explains_image_limitation, wedding_planner_location, token_fresh_multifront (all `Output-origin status mismatch`); receipt_payment_thread thanks-turn, jose_campaign_ack, owner_customer_payment_relevance (`Missing wire-delivered candidate evidence`); repeated_otp 0.939 (all 10 expectations pass, turn-2 empty output trips origin gate). First question for each: product bug (empty/suppressed output, missing candidate capture) or over-strict gate? Fix product first; gate changes need separate reviewed evaluator change + baseline/candidate rerun.
B. RSVP reporting (l2-rsvp/L4): rsvp_cristian, rsvp_confirmed, rsvp_jose (`fragment-attending-polarity-event-date-no-change` text_contains), rsvp_declined (declining-offers question), rsvp_cinthya, rsvp_multi_person, rsvp_plus_one, roberto_reminder, purchase_pending_transfer_continuity.
C. OTP-handoff truthfulness (l2-support model guidance): otp_terminal_handoff_failed/unavailable/unknown/missing_phone — model omits rubric-required explicit statements (e.g. help not requested now, unknown coordination, pending preserved). Evidence is projected; wording is model's. Fix guidance, never canned sentences.
D. Host-withdrawal (l2-support leftover): diana/general/pending — menu-like offers, generic reset; note handleHostWithdrawalInformation fixed path was kept in L5 as l2-support scope.
E. Images: base64 fallbacks image_too_large/image_unavailable_captioned (text_contains + semantic ask for smaller image/text); URL slice: image_url_describe_dice (vision miscounts dice), image_url_receipt_payment_thread (missing pending-validation statement), image_url_unavailable_evidence (tool_usage missing image_url_context).
F. Owners (L4): owner_planning_to_faq_single_transfer (FAQ price answered with livestream/gifts + handoff), owner_customer_payment_relevance (see A).
G. Purchase grounding (l2-purchase/L4): pending_balance_luis (states amount owed, omits 72h Yape window), purchase_currency_pen_symbol (misses PEN S/), purchase_joaquin, purchase_martha, active_cart_alex (mixes pending-order payment state into cart), phone_purchase_missing, purchase_delia-class issues if present.
H. Semantic regressions (L3): ambiguous_confirmation_adversarial (INVENTS two providers instead of concise clarification — possible L3 over-correction), spanish_only (keeps `catering`/`baby shower`), authentication_refusal (missing explicit no-more-email/code + close), token_seeded_contact_correction/selection_defer_close.

## Suggested start (batch A first)

Pick ONE case, e.g. repeated_otp_failure_preserves_gift_query (score 0.939, everything passes except turn-2 origin mismatch on empty output): open its artifact dir in the run folder, check what turn 2 delivered vs what output_origin recorded, and decide product-vs-gate. That answer patterns-matches the other 10 origin fails. Then move to batch E (new URL slice, smallest scope) before the broad semantic batches.

## What counts as a fix

Typed evidence/projection change + offline twin + preserved live expectations; focused tests + typecheck + lint green; no rubric/threshold/case edits to make red green (separate reviewed change if evaluator is wrong); record hashes + run IDs in implementation-log.md.

## Round 2 — run 9edcb9ac (2026-09-11, 57/94, RED)

Candidate: artifact 64ffcfe5…74fe, Lambda ZP/P5… (15:18:32Z). Full evidence in the 2026-09-11 step-E implementation-log entry + `.eval-runs/eval-2026-09-11T15-20-33-244Z-9edcb9ac/`. Old run d2141705 (48/89) ran the OLD contract; this run is candidate-under-REVISED-contract — compare turns, never rescore. Baseline rerun under the revised contract is outstanding.

Movement on the original 89: 48 → 54 (17 fixed, 11 regressed, 24 still failing). Additive image_file_* cases: 3/5 pass (captioned, explicit, unrelated); file_delayed + file_malformed fail.

### Start here: the 11 regressions (they passed before — smallest diffs)

1. **phone_purchase_rejection / phone_rejection — fixture `handoff.write` 0/1.** A real effect bug (expected a write, got none), not an oracle dispute. Suspect executor/auth path. Highest-signal single case: open its artifacts in both runs, find which turn should have written and what precondition failed.
2. **s01 / s08 amount-disclosure.** Previously-passing disclosure behavior broke — diff the two runs' receipts/projections turn by turn; likely step-C currency fallback over-corrected.
3. **Three pre-existing image cases stuck at `contacto_inicial` + missing `image_inspect`.** Expected consequence of the retired inspect flow — but verify routing first: if production genuinely misroutes a live image turn, fix routing; if the oracle encodes the RETIRED flow, do not coach production back. Prepare old-vs-new oracle text for the R05 change and leave failing honestly (coordinator-owned).
4. **paolo / trusted_phone / tito / maria_jose / transaction_code score drops.** Diff d2141705 vs 9edcb9ac artifacts per case; find which step-C/D projection change moved each score and restore.

### Coordinator-owned residuals (do not fix in production)

- `rsvp_declined` deterministic-phrase `text_contains` oracle (contradicts model-owned wording; R05 change pending).
- s17/url inspect-flow oracles + dice translucency wording (explicit-detail vs concise-vision tradeoff; R05 change pending).
- Errored `image_url_unavailable_evidence` (0.40, latency 0) — unclassified, no retry per no-targeted-rerun rule; needs a fresh full run to classify.

### Still failing (24, genuine backlog)

OTP-handoff wording (unavailable/missing_phone), host-withdrawal followups, image fallbacks (too_large/unavailable_captioned/readable/continuity/captioned), receipt_thread, owner_payment, luis, martha, pending_transfer, cinthya, multi_person, spanish_only, wedding_planner + multifront (origin-mismatch aftermath), defer_close, adversarial_selection, jose_greeting + otp_image + receipt missing-wire cases. Work through the step-C evidence map in the log; each needs candidate-visible proof before assigning a projector.


## Round 2 usability reassessment

See round2-usability-audit.md for a review of all 37 nonpassing cases. The “24 genuine backlog” label above is provisional, not validated. Several style/oracle failures are usable; identity rejection, image continuity/access and blank planning deliveries are actual product failures. Corrections: provider names and Martha order labels exist in artifact/fixture evidence; URL-unavailable already records HTTP 500 caused by image 404. No score or rubric was changed.
