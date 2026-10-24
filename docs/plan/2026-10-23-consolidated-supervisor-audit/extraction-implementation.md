# Extraction composition implementation — 23 October 2026

This continuation preserves the pre-existing working tree. The changes below are uncommitted and are not a deployment or live-behavior verdict.

## Responsibility and schema repairs

- Extraction captures explicit requested actions, including unsupported operations. Runtime authorization remains separate. The operation advertisement now comes from the same requested-operation schema enum; the unused candidate-operation/domain inputs were removed rather than retained as a compatibility layer.
- The production extraction request exposes its exact output schema, projection and compiler context. `extract()` uses that schema object instead of independently rebuilding it after instruction selection.
- Module applicability reads the exact capability profile used for that schema. Information, RSVP, planning, contact, provider operations, provider selection, provider inspection, final close instructions disappear when their output fields are absent; retired explicit pause remains absent.
- Provider operations, shortlist selection and inspection have separate tracked modules. The existing runtime deliberately retires explicit pause (verified in its reducer and regression tests), so production schema/intents no longer advertise the discarded operation. Final close remains separately capability-bound. The stale global pause prohibition was removed from final-close guidance.
- The removed `destination_account` selector is no longer advertised as extractor output. A payment-destination question remains a purchase request whose query preserves what was asked.
- Extraction no longer loads reply-oriented shared record instructions. Its own record interpretation module describes payment/order/report provenance and source coverage when customer context is present. All authorized profile records and fields remain in the input.
- Extraction is a current-turn delta; the runtime preserves absent stored values. Credential non-propagation has one invariant owner in the base module. RSVP consent remains owned by the RSVP module rather than duplicated in record interpretation.
- OTP continuation, campaign interpretation and unanchored-follow-up guidance moved out of TypeScript input strings into tracked conditional instruction files. Runtime input sections now carry their typed facts. The existing conditional image-reference file is preserved.
- Planning event/category enum lists are supplied by the actual schema instead of maintained as a second prose enumeration.
- Reply specs also expose their exact compiler context so contract checks can use the fee-enriched production context rather than reconstructing a weaker public approximation.

## Contract evidence

`tests/schema-bound-actual-extraction.test.ts` builds real production specs across 64 mixed capability/plan states. It checks the exact schema bindings, actual instruction files and executable tools through the contract validator. It also proves unsupported requests remain expressible, retired pause and unavailable final-close guidance remain absent, and field-specific instruction files match schema availability.

The complete customer-context serialized test preserves an approximately 19,906-byte profile unchanged. The measured support extraction is 5,981 instruction bytes and 21,735 input bytes. The original 6,000-byte instruction limit was retained. The earlier first-turn input-only 1,249-byte comparison was replaced with the actual missing-continuation and no-hidden-guidance contract: the schema-correct operation advertisement changes that input's facts, so it is no longer the identical baseline fact set.

A focused run of extraction schema, actual capability matrix, instruction economy and complete-profile tests passed: 4 files / 46 tests. This is targeted offline evidence only. Integration results, pending review status, deployment and live evidence belong in `continuation-status.md` after the final checks.
