# Agent complexity and silent handoffs

Evidence-backed architecture audit, 2026-09-09. Investigation only; no runtime or prompt changes.

The architecture has avoidable complexity in shared semantic extraction, overlapping decision ownership, and prompt assembly. A small set of persistent specialists is a credible simplification, provided it replaces those layers and preserves deterministic authorization and effects. An agent-count change alone does not address the observed failures.

Read [findings](findings.md), [scenario analysis](scenarios.md), [sources](sources.md), [reproduction steps](how-to-repeat.md), and the [dated audit](dates/2026-09-09.md).
