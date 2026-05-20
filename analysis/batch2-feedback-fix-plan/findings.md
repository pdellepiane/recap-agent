# Findings

## Current Understanding

- The batch maps to 24 screenshots in filename sort order. A generated visual index exists at `analysis/batch2-feedback-fix-plan/artifacts/contact-sheet-2026-05-20.jpeg`.
- The dominant failure is close-flow state management, not only copy. `src/runtime/agent-service.ts:387-468` blocks close on unselected shortlists before robustly applying same-turn provider selections or specific need declines.
- The red schema error is likely caused by mutable close schema resolution in `src/runtime/openai-agent-runtime.ts:104-119`, `src/runtime/openai-agent-runtime.ts:161-166`, and `src/runtime/openai-agent-runtime.ts:669-698` while `finish_plan` mutates plan lifecycle in `src/runtime/finish-plan-tool.ts:114-122`.
- Contact request copy can leak raw internal fields because `contactRequestMessageSchema` accepts arbitrary strings and `message-renderer.ts` only maps `full_name`, `email`, and `phone`.
- Phone validation is too weak: `src/runtime/agent-service.ts:2604-2607` accepts 6-15 digits, which allows incomplete Peru mobile numbers like the screenshot example.
- Vector/hybrid provider search can bypass locality filtering: API results use `selectProvidersForPlan()` but vector and hybrid paths in `src/runtime/sinenvolturas-gateway.ts:210-245` return vector-enriched providers directly.
- FAQ/scope issues need KB-backed copy updates, especially support contact and gift/product claim answers.
- Revision note from 2026-05-20: critical plan actions must not depend on exact word matching. The fix plan now requires structured extraction, Zod-validated action/result schemas, and deterministic service transitions for selection, deferral, close, abandonment, and contact validation. Exact string matching is only acceptable for non-critical hints after a structured intent/action already exists.
- DynamoDB perf validation on 2026-05-20 found matching traces under channel `web_chat` and `sha256("954779067")`, with 44 turns on 2026-05-15. These traces confirmed close blocking, brittle provider operation resolution, incomplete phone acceptance, contact clarification rerouting to provider search, selection erasure after "ninguna", and the Rebel post-error reselection loop.

## Current Plan

- Use [fix-plan.md](fix-plan.md) as the actionable implementation plan.
- Workstreams A and B should be fixed before the other sections because they can corrupt or confuse persisted state.
