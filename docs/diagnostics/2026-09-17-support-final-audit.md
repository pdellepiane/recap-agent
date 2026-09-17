# Support release audit — 2026-09-17

## Evidence, not the earlier status interpretation

Candidate under diagnosis: bd0d13d9, run eval-2026-09-17T17-30-06-728Z-678705ad, dev wpXkX8iFQsQxzlAuYJhn9zvsImXPHPuFS1qkSixJXxA=.

The failed overlapping reply was retrieved directly from OpenAI response resp_03d5fece3f11c2cd006aac23b7986487d29a499364983d93e4. Its actual input includes the prior answer about card rejection, the two user-reported references, no pending requests, no information results and no handoff outcome. The lock waited 11224ms over 37 attempts. The model had the card context; a missing repeated card noun in an acknowledgment is not proof of context loss. The retrieved history status was empty while recent_messages contained the recovered outbound answer; do not interpret that status alone as missing model context.

The failed reply said the query remained pending review. The sequential case that passed also said the inquiry remained pending while we review the payment problem. Neither detail turn executed a review or handoff: traces show conversation read/log and delivery classification only. The difference in scores does not establish that the sequential reply was more truthful.

## Root contribution and minimal correction

The runtime marked every provide_detail/report_issue/defer_submission as support_query_open irrespective of real pending work. Summary text and the scoped support module reinforced an open-case presumption. That is deterministic business-state invention, not neutral evidence. Commit 6fb3a888 removes that field, removes the unsupported status from summary notes and replaces the scoped assumption with factual guidance. Names remain user-reported; real pending requests still resume tools. No extra calls, state, classifier, response template or rewrite layer. Existing shared style examples may also encourage process narration, but their causal contribution is not proven and this release does not expand into a global style rewrite.

Concurrent oracle v5 and sequential v3 accept a concise acknowledgment following an already answered question. They retain no-reask, no identity substitution, no unauthorized lookup/effect and no ungrounded review/escalation. They retain their 0.9 semantic thresholds. Existing run results remain unchanged. Inspect all five delivered turns manually, including sequential turn 1 not independently judged by the existing fixture.

The scoped prompt shrinks 711 to 666 UTF-8 bytes. Substituting the edited module in the retrieved exact instructions yields 6153 to 6108 bytes. Serialized-input tests prove the synthetic status is absent. No additional context payload is introduced.

## Separate promotion blocker discovered

Production only had recap-agent-dynamo; its plans-table actions were GetItem, PutItem and DeleteItem. PlansTransactAccess was development-only, although the candidate executes saveFenced and RSVP intent/outcome transactions with ConditionCheck. Commit 40d05ad0 grants the existing narrowly scoped policy in both environments and orders Lambda after that policy. Fixture access remains development-only. Without this correction, a passing development gate would not establish production operability.

Production rollback CodeSha: 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=.
Rollback artifact: lambda/e829975950e99ebf7680c17f7e6ace3e5a01a625279a238e3003c0f0c7903616.zip, verified present (6,986,725 bytes).
Original stack, function configuration and template are captured privately under .artifacts/release-support-2026-09-17/.

## Release boundaries

Full offline suite: 198 files, 2120 passed, 5 historical skips, 0 failed. Typecheck clean. Two documented pre-existing lint errors remain in openai-agent-runtime.ts. No new lint finding in the changes. Coverage registry points at real implementation 6fb3a888.

One live invocation for the two complete support threads; no semantic retries, no full-suite rerun. Release requires delivered useful initial card help, no re-asking an already known issue, grounded acknowledgment on subsequent turns, correct identities, and no unauthorized or fabricated action. Both formal results and manual all-turn evidence are recorded. An informational acknowledgment need not repeat already delivered advice.

Earlier payment, RSVP attribution, image-404 and OTP-send fixes retain their targeted evidence from run 5adfa64e; this does not mean the final artifact has passed the full suite. Planning quality and documented wording/oracle limitations remain. Production promotion, if performed, uses the exact current development artifact and retained production bindings, with the production-only transaction permission gap closed. Report the release as targeted validation, never a green full gate.

Additional old-red spot check from full run d92b78c3: host-set-declining reply distinguished two identically named invitations by their different dates and asked which was intended; no write or attendance confirmation. Its missed per-candidate statuses are an extra-turn/completeness limitation, not evidence of identity mixing. Missing-event reply said it could not find an associated invitation and asked the event name; this is weaker availability wording than the desired unavailable-evidence explanation, but does not assert a verified attendance state or perform an action. These remain documented support-quality limitations, not silently converted formal passes. Historical current-campaign/declined case correctly kept the current pending order and failed on omitted 72-hour wording only.

## Final targeted result and release decision

Run eval-2026-09-17T17-47-19-986Z-a4710abc: 2 complete threads / 5 delivered turns, 1 pass / 1 fail / 0 errors / 0 skips, zero structural failures; 48.432s, 3 judge calls, 0 retries. Model gpt-5.6-luna. Sequential replies answer the card question then acknowledge Roger and the event without invented review. Concurrent initial answer gives relevant card help; its detail reply preserves Roger Abanto, Baby Shower Catalina and the rejected-payment topic, but adds an unnecessary question about what to review. The judge correctly identifies avoidable friction. It does not demonstrate a lost topic or require the user to restate which problem occurred; the reply explicitly identifies it. This remains a formal semantic failure and a support-quality limitation, accepted for this targeted production release under the user's instruction to push. No rescoring, oracle edit or second spend after seeing the result.

All five turns inspected: no false review/action, identity substitution, unauthorized lookup, RSVP/handoff effect, or blank delivery. Follow-up turns use only conversation read/log/classification; first turns use knowledge_base_search. Concurrent lock waits 14267ms/49 attempts. Read-only retrieval of the new reply response resp_0e0fc9cef55c16fc006aac27c3fd0487d2824dfb8209f9704a confirms the actual prompt no longer has support_query_open and contains the corrected scoped guidance; actual instructions are 6108 bytes.

Candidate ZIP SHA256 66891e9e71b951a91806fb239670050ae5d9e387b0bdb97092e927d6dd929946, Lambda CodeSha ZokennG5UakYBvsjlnAFCuXZ44ewvblwkukn1t2SmUY=. Code source 40d05ad0; run source 695ad062 adds only the audit document. The run manifest lacks deploymentBefore and labels artifact provenance unverified; this is a harness-recording gap, not silently repaired. Independent configuration reads at run start and after it match this exact ZIP digest; manifest deploymentAfter also matches, with LastModified 17:46:34Z, before run start 17:47:20Z. No code changes during the run. Original raw manifest preserved. Production uses that exact ZIP without rebuilding.

Production template diff reviewed: added development-only fixture resources/config (absent in production), plans-table transaction policy in production, and dependency ordering. No production table replacement, credential rebinding, model change or provider sync. Production update requested via the existing CloudFormation deployment workflow, with original artifact/config/template captured for rollback. Outcome to be appended after verification.
