# Prompt Audit Rubric — State-Machine-Driven Conversational Agent

Status: Aug 2026, bounded research. Grading standard for T4 (docs/prompt-audit/2026-08-system-prompt-audit.md). English, ASCII.

---

## 1. Source List (6 sources, max 10)

| # | Source | URL | Date | One-line relevance |
|---|--------|-----|------|-------------------|
| S1 | OpenAI — Prompt Engineering Guide | https://developers.openai.com/api/docs/guides/prompt-engineering | Accessed Aug 2026 | Canonical vendor rules: role/scope, code-managed prompts, pinned snapshots, eval before ship; basis for minimization and contracts. |
| S2 | OpenAI — Structured Outputs | https://developers.openai.com/api/docs/guides/structured-outputs | Accessed Aug 2026 | Schema-constrained generation (json_schema strict) vs JSON mode; guarantees shape, does not guarantee semantics. |
| S3 | Anthropic — Effective Context Engineering for AI Agents | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 2025-09-29 | Defines context engineering as curating smallest high-signal token set; four levers (system prompts, tools, examples, history) and Goldilocks altitude. |
| S4 | Anthropic — The new rules of context engineering for Claude 5 | https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models | 2026-07-24 | Evidence that removing >80% of system prompt held accuracy; shifts: progressive disclosure, tool-design over examples, single location for rules. |
| S5 | Google — Prompt Design Strategies (Gemini API) | https://ai.google.dev/gemini-api/docs/prompting-strategies | Accessed Aug 2026 | Iterative, test-driven prompt design; clear/specific instructions, components and ordering, failure checklist (conflicts, underspecification, injection). |
| S6 | OpenAI — Agents SDK: Context Management (Python/JS) | https://openai.github.io/openai-agents-python/context/ | Accessed Aug 2026 | RunContextWrapper pattern: local typed state vs LLM-visible context; dynamic instructions and is_enabled tool filtering per turn (state-conditioned, tool-surface projection). |

Notes: S1/S2/S5/S6 are evergreen vendor guides without fixed publish dates; treated as current Aug 2026. S3/S4 are dated long-form engineering guidance. All criteria below cite one primary source; S1-S6 together cover every rubric theme.

---

## 2. Rubric — 10 Checkable Criteria Grouped by Theme

Scoring unit: one prompt file (e.g., prompts/nodes/<node>/system.txt) in the context of the node(s) and transition(s) that consume it, and the model call type (classifier / extraction / reply). Each criterion is pass/partial/fail with evidence. Themes map to the required set in the task brief.

### A. Prompt minimization / minimum disclosure

**R01 — Smallest typed state per call**
- Pass standard: The call sends only the typed state, evidence, and policy needed to produce the required decision or response for this node/transition; no dump of unrelated history or global context.
- Audit check: Rebuild the serialized request for the node and call type; list every top-level block; any block not needed for the decision/response is a fail; measure instruction/input bytes and compare to baseline [S3][S6].
- Sources: S3 (smallest high-signal set), S6 (local vs LLM-visible context), S1 (plan for context window).

**R02 — No speculative or future-branch instructions**
- Pass standard: No instruction describes a result type, route, error mode, or field that cannot occur in this node/transition; future branches are not pre-explained.
- Audit check: Enumerate all conditional branches mentioned in the prompt text; mark any branch unreachable from the current typed state as a violation [S3][S1].
- Sources: S3 (minimality), S1 (pin snapshot, specific instructions).

### B. State-conditioned prompting

**R03 — Dynamic typed evidence replaces conditional/global rules**
- Pass standard: Where the runtime already knows the branch, a deterministic typed discriminator (e.g., rsvp_phone_evidence.state = resolved_single | needs_event_selection | unavailable) selects a single prompt section; no broad if-this-then-that prose enumerating all branches.
- Audit check: For each node with >=2 typed outcomes, verify that prompt assembly is a deterministic section selection on the discriminator (code path in agent-service.ts / openai-agent-runtime.ts), and that the shared template contains no paragraph covering multiple states at once; exemplar: resolved_single carries no candidate array and no selection instruction [S6][S4].
- Sources: S6 (dynamic instructions callback), S4 (progressive disclosure, delegate to judgment, delete overconstraining rules), S3 (altitude).

### C. Route / outcome-specific prompt sections mapped to state-machine nodes/transitions

**R04 — Route-specific sections, no broad conditional guidance**
- Pass standard: Each state-machine node and its outgoing transitions consume only their route-specific prompt section(s); shared sections contain only invariants that cannot be projected as typed state.
- Audit check: Build the inventory mapping file -> node -> transitions (from T3); for every node, assert that the prompt file does not contain guidance for a different node's route, and that shared prompts are short and invariant-only [S4][S3].
- Sources: S4 (route-specific progressive disclosure), S3 (system prompt = standing constraints only, task-specific logic in task assembly).

### D. Tool-surface projection

**R05 — Only relevant tools exposed per call/node**
- Pass standard: The tool set visible to the model in this call is the minimal set relevant to the node's job; irrelevant tools are filtered via deterministic is_enabled / toolFilter logic, not via prompt prose telling the model to ignore them.
- Audit check: List the tools attached for the call; for each tool, justify relevance to the node or mark it as should-be-filtered; verify filtering is via code (isEnabled/toolFilter on RunContext), not via instruction [S6][S3].
- Sources: S6 (ToolContext, isEnabled, tool_filter), S3 (tools as efficiency contract).

### E. Evidence-grounded generation

**R06 — Grounding rules, no fabricated data**
- Pass standard: Every factual claim the model may emit is tied to an explicit evidence span or typed result; the prompt states what counts as evidence, what does not, and the required citation/quote behavior.
- Audit check: Highlight every sentence in the prompt that authorizes a factual statement; verify it references a named evidence field; search the prompt for absence-of-evidence is not evidence-of-absence handling; run a probe with empty evidence and confirm the rendered reply does not hallucinate [S1][S5].
- Sources: S1 (include relevant context, RAG grounding), S5 (ground responses in quotes, structure document metadata with XML).

**R07 — Explicit unavailable-state handling**
- Pass standard: The prompt defines the exact behavior when required evidence is missing or unavailable (state = unavailable or equivalent), including the honest message and the forbidden actions (no guess, no placeholder, no auth escalation not required by the transition).
- Audit check: For each node, locate the unavailable / needs_input branch; confirm the prompt contains a dedicated unavailable section with an explicit truthful response template and a never-do list [S5][S3].
- Sources: S5 (underspecified task checklist), S3 (Goldilocks altitude, explicit invariants).

### F. Structured output contracts and extraction schemas

**R08 — Structured output contracts are schema-constrained and versioned**
- Pass standard: Any extraction or function output consumed downstream is governed by a checked JSON Schema / Zod / Pydantic contract with strict mode, enums for closed sets, null modeled honestly, and a version or discriminator where the schema evolves; prompt shape + schema together define the contract.
- Audit check: For each extractor prompt, locate its schema file; verify strict:true (or equivalent), enums for closed values, required vs nullable modeling, and that the prompt does not ask for a shape contradicting the schema; check schema file is co-versioned with the prompt in git [S2][S1].
- Sources: S2 (Structured Outputs vs JSON mode, supported subset, refusals), S1 (version prompts in code, typed inputs).

### G. Eval-driven prompt regression

**R09 — Size and relevance gates plus semantic judges with offline twins**
- Pass standard: Every behavior-affecting prompt change has a measured instruction/input byte delta, a relevance regression proving branch-irrelevant content absent and required content present per branch, and a live judge-gated case with hard structural assertions plus a deterministic offline twin where verifiable without a model.
- Audit check: For each changed prompt, confirm buildRequestMetrics byte before/after recorded, relevance test exists and asserts absence of irrelevant guidance (e.g., resolved_single payload carries no multi-invitation enumeration) and presence of required disclosure, and evals/live-behavior-coverage.yaml entry has hard structural + text_semantic requireJudge:true plus twin test [S1][S4].
- Sources: S1 (build eval suites, measure prompt behavior, pin snapshots), S4 (evaluation-driven prompt trimming showed leaner prompts improved scores and cut tokens).

### H. Anti-patterns

**R10 — No contradictions, duplication, bloat, or dead instructions**
- Pass standard: No prompt contains contradictory rules, duplicated invariants across prompts that should live in one place, bloat beyond 150-300 words of non-evidence prose without justification, or instructions for unreachable branches.
- Audit check: Run a cross-prompt duplicate scan for invariant sentences appearing in >1 file that should be typed state; run a contradiction scan (ALWAYS/NEVER vs decision rules, overlapping directives); count words outside evidence blocks; flag any section whose branch never fires in the state machine [S4][S5].
- Sources: S4 (single location for each rule, delete repeats, 150-300 word heuristic via Liu et al. cited therein), S5 (conflicting internal references, typos, fluffy descriptions).

---

## 3. Mapping Table — Rubric Criterion -> Minimum Disclosure Convention Clause (AGENTS.md)

AGENTS.md Minimum Disclosure has five clauses (MD1-MD5):

- MD1: Treat prompt context as constrained runtime resource; project smallest typed state, evidence, policy, tool surface.
- MD2: Do not send instructions for impossible/irrelevant result types, routes, tools, fields, failure modes; dynamic state-machine evidence must replace broad conditional guidance where runtime knows the branch.
- MD3: Prefer route- and outcome-specific sections selected deterministically; keep shared prompts short, non-conflicting, invariant-only.
- MD4: When adding a prompt rule, first encode invariant in typed runtime state / deterministic evidence; add size/relevance regression; never solve uncertainty by appending a global rule.
- MD5: Measure serialized instruction/input bytes for changed model calls; behavior fix incomplete if it needlessly increases size or reintroduces duplication/conflict.

| Criterion | Clause(s) operationalized | How it operationalizes the clause |
|-----------|---------------------------|-----------------------------------|
| R01 Smallest typed state | MD1, MD5 | Directly measures MD1; MD5 is the gate that enforces it. |
| R02 No speculative instructions | MD2 | Checks that no instruction covers a branch the typed state already excludes. |
| R03 Dynamic evidence replaces conditionals | MD2 (primary), MD1 | Replaces prose if/else with a typed discriminator and deterministic section selection. |
| R04 Route-specific sections | MD3 (primary), MD2 | Enforces per-node sections; shared = invariants only. |
| R05 Tool-surface projection | MD1, MD2 | Projects minimal tool surface via code, not prose. |
| R06 Grounding, no fabrication | MD1 (evidence) | Evidence is part of smallest typed state; grounding rule is the policy. |
| R07 Unavailable handling | MD1, MD2, MD4 | Typed unavailable state + explicit honest section instead of a global fallback rule. |
| R08 Structured contracts | MD1 (typed config), MD4 | Schemas are typed config centralized; prompt shape is validated, not guessed. |
| R09 Eval regression | MD4, MD5 | Size/relevance regression + byte measurement per changed call. |
| R10 Anti-patterns | MD3, MD4, MD5 | Single location for invariants, no duplication/contradiction, no bloat, no dead branches. |

---

## 4. Scoring Method for T4 (per prompt file / node)

### 4.1 Unit of grading

One row = one prompt file (or file+section) evaluated for one node and one call type (classifier / extraction / reply). A node with multiple call types produces multiple rows. The per-node score aggregates its rows. The overall report aggregates nodes.

### 4.2 Criterion-level verdict

For each of R01-R10, assign one of:

- pass: Criterion satisfied; evidence shows no violation.
- partial: Criterion mostly satisfied but with a bounded residual (e.g., one duplicated invariant line, one speculative sentence, bytes increased but individually justified). Requires a remediation decision (keep-with-reason).
- fail: Material violation (e.g., broad multi-branch paragraph where typed state exists, irrelevant tool exposed, fabricated disclosure, missing unavailable section, contradiction).

Rules:
- Grade is not essayistic: verdict must be justified by a quoted evidence span (prompt line or rendered payload) and, where applicable, a byte count.
- If a criterion is not applicable to a row (e.g., R08 on a reply prompt with no extraction), mark N/A and exclude from denominator; record why.
- Any fail on R06, R07, or R08 is a finding that must have a remediation decision.

### 4.3 Node-level and overall score

- Node-level: Count pass / partial / fail across applicable criteria. Suggested roll-up: node passes if zero fails and at most one partial; node needs fix if >=1 fail or >=2 partials. Report raw counts; do not hide with averages.
- Overall: Sum across all nodes/files. Report pass rate per criterion and overall fail count. Also report net byte direction (sum of per-call deltas) and per-branch relevance pass/fail.

Example row (illustrative, not grading a real file here):

| File | Node | Call type | R01 | R02 | R03 | ... | R10 | Byte delta | Evidence ref | Decision |
|------|------|-----------|-----|-----|-----|-----|-----|------------|--------------|----------|
| prompts/nodes/responder_invitacion/system.txt | responder_invitacion | reply | pass | pass | pass | ... | pass | -22 instruction bytes vs 78ae24e | Evidence: single-branch section on rsvp_phone_evidence.state | keep |

### 4.4 Evidence the auditor must record per finding (mandatory)

For every non-pass (partial or fail), and for every pass where the criterion is load-bearing (R03/R05/R09), record:

1. Location: prompt file path, node name, transition(s) consuming it, call type.
2. Evidence span: exact quoted lines from the prompt (or rendered serialized payload excerpt) showing the violation or compliance, with line or block reference.
3. Bytes: serialized instructionBytes / inputBytes for the call before (78ae24e baseline via git show) and after (current), or N/A if not a changed call; cite buildRequestMetrics fields.
4. Category: one of duplicate / conflict / irrelevant / underspecified / bloat / dead-branch / grounding-gap / schema-gap.
5. Remediation decision (exactly one): typed-state replacement | route-specific section | deletion | keep-with-reason (with reason string).
6. Eval linkage: if behavior-affecting, the live case ID and offline twin test path; otherwise state not behavior-affecting.

For the whole audit, the report must also record:

- Complete inventory table (every prompts/ file -> node -> transitions) proving zero unmapped files (from T3).
- Per-call-type byte table (classifier / extraction / reply) per branch/node with before values anchored at 78ae24e and after values (from T3 extended audit:prompts tooling); any increase individually justified; net direction stated.
- Per-branch relevance proof: for branch-conditioned evidence (exemplar: resolved_single vs needs_event_selection vs unavailable), demonstration that a payload for one branch does not contain guidance/content for the other branches.

### 4.5 Pass/fail of the audit itself

The audit is usable as a grading standard only if every row above is filled. A row with verbal assessment but no quoted evidence, no byte anchor, or no remediation decision is incomplete. Findings that would require RSVP redesign or reopening paths closed in 78ae24e are flagged out of scope per plan decisions, not silently skipped.

---

## 5. Usage Notes

- This rubric grades prompts; it does not prescribe runtime redesign (per T2 constraints). Where a criterion can only be satisfied by a runtime change (e.g., projecting a new typed state), the remediation decision is typed-state replacement, not a prompt patch.
- Conversational prompt content is Spanish; this rubric and the T4 report are English. Audit evidence quotes remain in their original language.
- Byte measurement reuses src/audit/prompt-audit-cli.ts (auditPromptBundles) and src/audit/static-prompt-comparison-cli.ts (audit:prompts:compare) plus buildRequestMetrics; no parallel harness.
