# Batch3 Feedback Fix Plan

## Scope

Investigate `feedback/batch3/dump.md`, `feedback/batch3/Feedback del asistente - Gaby.pdf`, `feedback/batch3/images/`, and DynamoDB runtime logs to produce an actionable, code-referenced fix plan for the assistant feedback in batch 3.

The plan classifies issues into:

- Objective mistakes or failures that should be fixed directly.
- Tone changes that should be handled by a system-wide assistant personality prompt included in every flow.
- Ambiguous or product-policy changes that need one-by-one approval before implementation.

## Current Status

- Investigated on 2026-06-19.
- DynamoDB validation succeeded after reauthentication using `AWS_PROFILE=se-dev`.
- Runtime perf logs validate turn-by-turn state, intent, tool, and plan evidence. They do not store outbound assistant text, so exact wording issues are validated from the PDF and screenshots.
- Main deliverable: [fix-plan.md](fix-plan.md).

## Durable Files

- [fix-plan.md](fix-plan.md)
- [findings.md](findings.md)
- [how-to-repeat.md](how-to-repeat.md)
- [sources.md](sources.md)
- [Latest dated note](dates/2026-06-19.md)
