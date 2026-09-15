# Event identity and host-set attendance: corrected audit

Date: 2026-09-14. Supersedes the hasResponded requirement in recheck-5e846b. Runtime unchanged by this audit.

## Corrected domain meaning

The host may change attendance policy/state without the guest having personally responded. Therefore hasResponded=false and willAttend=true is valid. The prior requirement to reject that combination is withdrawn. Keep verification simple: one authorized mutation followed by one fresh read; same event ID, same guest ID, requested willAttend value observed. A boolean false is equally a real attendance value, not missingness. Null willAttend remains unknown/pending as the actual source supports. hasResponded alone must not override a boolean willAttend or prove who changed it. Preserve existing timeout non-attribution and unavailable companion evidence; do not add another confirmation step.

Current AgentService.rsvpInvitationState gives hasResponded precedence and consequently contradicts the verifier for host-set records. Fix the read projection so every surface reports the same authoritative attendance. Do not undo the working write/read check.

## Expanded evidence: identity risks reproduced locally

`event-identity-probes-2026-09-14.json` records five synthetic probes of current runtime helpers. These are actual executable source probes, not production incidents or full-service proofs.

1. **Pending event overrides explicitly named event.** selectRsvpInvitation with invitations A/B, stored awaiting_action for A and current eventReference B returns A. It evaluates stored pending guest before explicit event reference. This can select the wrong mutation target even though later write/read checks correctly verify that wrong target.
2. **Explicit non-match falls back to the only invitation.** Same selector with only A and explicit reference B returns A. “Only accessible event” does not mean “the event requested.”
3. **Information reads have the same non-match problem.** InformationOrchestrator.selectGuestEvent returns the sole event before checking eventHint; requesting B with only A returns A. This is a separate read path, so fixing RSVP selection alone is insufficient.
4. **Name-only merge combines different identities and dates.** reconcileRsvpPhoneEvidence receives A with missing event ID, guest11, shared event name and September20 date; associated B has event2, guest22, the same name and no date. Output becomes event2/guest22/B attendance with A's September20 date. The fallback date belongs to an unproven identity. sameRsvpEvent allows this because one ID is missing. projectRsvpPhoneEvidenceForReply reuses that comparator and deserves the same correction.
5. **Host-set attendance displays pending.** rsvpInvitationState(false,true) returns pending. This contradicts the corrected domain semantics, not the write verifier.

Additional source risk: lookupRsvpPhoneEvidence selects the first matching associated summary with find; multiple matching names should not silently pick the first enrichment candidate. The information path uses a unique-match filter when multiple events exist, which is preferable, but its one-event early return still ignores explicit mismatch.

## Narrow decisions for the implementer

No new agent, state enum, generic reconciliation engine, or conversational phrase list.

### I1 — Honor the requested event before a pending event

Files: src/runtime/agent-service.ts (selectRsvpInvitation and lookupRsvpPhoneEvidence), src/runtime/information-orchestrator.ts (selectGuestEvent), existing event-selection tests.

A current explicit structured event reference must first resolve against authorized candidates. A unique compatible candidate wins; multiple/no matches must not fall back to an old pending or sole unrelated event. A current extracted guest ID must be a member of the authorized candidates and compatible with the current explicit event reference; disagreement is unresolved evidence, not permission to pick either. Stored pending identity is usable only when the current user request does not switch targets. Preserve semantic extraction and existing grounded entity matching; do not add keyword routing.

Return available facts for the requested event after relevant permitted reads. If it cannot be identified, ask one specific distinction only if needed. Do not present another event's details as the requested event. For lookup enrichment replace first-match with unique-compatible-match, retaining existing bounded reads. Do not retrieve every unrelated event to avoid a question.

### I2 — Bind details to identity

Files: sameRsvpEvent, reconcileRsvpPhoneEvidence, projectRsvpPhoneEvidenceForReply in agent-service.ts; event detail projection tests.

Match established event IDs; for attendance also preserve guest identity. Two records sharing a name are not sufficient proof for merging. When one event ID is absent, keep records separate unless an existing authoritative linkage explicitly establishes the same event/guest; do not fill B's missing date/location/state from A. Do not discard A: it remains accessible evidence or a candidate. When a same-ID source supplies refreshed values, use the fresh detail for that ID and retain missing fields only from records already proven to share identity. An unavailable date stays unavailable rather than borrowed. Existing bounded typed projections suffice.

### I3 — Consistent attendance semantics

Files: rsvpInvitationState and any duplicate attendance mapping discovered by references; tests covering ordinary read and verified write.

willAttend boolean takes precedence for displayed attendance. hasResponded remains metadata about guest response, not a confirmation requirement. If willAttend is null, do not invent attendance. Add host-policy cases for true and false with hasResponded=false, asserting consistency across current profile, verification outcome and reply evidence. Keep all prose model-generated.

## Validation matrix — prove facts stay attached, not exact wording

Use the existing service integration harness and git-tracked live_behavior_regression cases. Every new behavioral fix needs its own coverage entry at implementation time. Do not fabricate an implementing commit for audit-only work.

- A pending, user explicitly switches to B: only B may be selected/read/changed; A remains unchanged.
- Only A accessible, user names B: no A-as-B answer, zero mutation; missing target disclosed naturally.
- Two events with identical names, different IDs/guests/dates: never combine; ask the distinguishing fact only when the actual request cannot resolve the target.
- A lacks ID and B lacks date: no synthesized B date from A. Add the exact probe above as a service regression.
- One event has ceremony at10:00/locationX and reception at18:00/locationY: answer the specifically requested moment without blending. Do not treat event start time as every moment's time.
- User asks event B's time after A's date, then returns to A: preserve both complete event fact sets and answer from the requested one.
- Host-set willAttend=true/false with hasResponded=false: display the authoritative value consistently; do not say the guest personally submitted it unless evidenced.
- Old receipt replay after a host change: no new write and no overwrite of fresh attendance with historical outcome.

Structural assertions must check actual selected/read/mutated IDs and unchanged other records. Semantic judges check that event name/date/time/place/attendance belong to the same grounded entity and requested moment. A matching write/read receipt is necessary but cannot prove the original entity selection was correct. No hardcoded wording, forced global event summaries, or mandatory questions after every lookup.

## Scope of assurance

Earlier full-run event/RSVP artifacts were reviewed as historical evidence, including ambiguous selection, state queries, companion failures and combined event/purchase answers. They are not current-candidate release proof. Latest failing Tito still demonstrates resolved-event versus unresolved-question contradiction; latest hour-only purchase answer includes the correct payment timestamp but unnecessary global disclosures, not evidence of another event's timestamp. No blanket claim that all details are isolated is justified while the reproduced selection/merge paths remain.

Targeted live read-only scenarios are being run against current dev as a control. Passing familiar two-event cases will not invalidate the adversarial missing-ID and stale-pending probes. Complete the matrix through actual service paths and the full candidate gate before claiming event isolation. Preserve all old artifacts and the host-policy correction in the audit history.


## Completed live control run

`eval-2026-09-14T23-12-55-303Z-7fc6d87f`: three cases executed, two passed, one failed, zero errors/skips. Account checked as684516060775 using se-dev/us-east-1 before the run. No deployment or runtime change.

- event_context_long_thread PASS: birthday September21 at19:00; wedding September20 at18:00; explicit return to birthday19:00; no-change acknowledgement. Four separate invocations preserve event identity in this sample.
- rsvp_tia_niur_old_target_wins PASS: birthday September21 at19:00 followed by wedding September20 at18:00. No observed date/time mixing.
- rsvp_ambiguous_event_requires_grounded_selection FAIL: reply asks which of the two named events; does not choose either or claim a write. Failures are selection_attempts0 vs1 and omitted candidate dates. This is not demonstrated event mixing. Inspect whether the attempt counter governs a real retry/escalation behavior before removing its assertion; date omission is primarily disambiguation completeness here because names already differ. For identical names, a distinguishing date or other grounded attribute becomes necessary. Never fix by mandating the same date/name paragraph on every question.

These passing familiar scenarios and failing-but-distinguishing response provide bounded reassurance about current live behavior. They do not exercise stale pending A/current explicit B or missing-ID same-name merging. Those exact adversarial contexts must be implemented as service and live regressions by I1/I2 before a stronger assurance is warranted. No full release gate was run.
