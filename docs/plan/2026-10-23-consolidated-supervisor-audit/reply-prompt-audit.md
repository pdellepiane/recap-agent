# Reply, shared, and node prompt audit

Read-only audit of the moving working tree on 2026-10-23. No runtime or prompt edits were made by this audit. Findings distinguish production composition from retained static files; they are not fresh live-behavior results.

## Production assembly is different from the static prompt inventory

`OpenAiAgentRuntime.buildReplyRequestSpec` selects `selectReplyModules`, deduplicates their files with `moduleFilesFor`, and calls `loadModuleFilesBundle`. It does not load `nodePromptManifest[node].files`. `loadNodeBundle` is called by `src/audit/prompt-audit.ts`, `static-prompt-comparison.ts`, `prompt-branch-measurement.ts`, and tests, not by production reply construction. Consequently most node `system.txt`, `response_contract.txt`, and `tool_policy.txt` files are audit-only. Handoff system/response files are an exception because `reply_handoff_outcome` explicitly selects them. RSVP outcome-specific files are another explicitly selected subset.

This is a maintenance correctness defect: a green static audit or an edit to the informative-node response contract does not establish that production used those instructions. Do not restore all legacy node bundles globally; move binding invariants to typed state or a narrowly selected production module, and classify remaining files explicitly as archived documentation.

## Findings

| Priority | Finding | Evidence and implication |
| --- | --- | --- |
| High | Public FAQ receives a blanket prohibition on figures | `reply_faq_policy` in `prompt-manifest.ts` selects `payment_disclosure.txt`: “la FAQ no autoriza cifras ni cuentas.” A normal FAQ cost answer, including the separately supported withdrawal fee, needs published figures. Restrict this invariant to payment destination/account disclosure; source-backed public fees remain valid. |
| High | Withdrawal and gift commission guidance is still selected by one article identity | `verifiedCommissionArticle` recognizes `cuanto-cuesta.md`, which includes both services; `deriveReplyCompilerContext` then adds `faq_commission`. The working-tree `commission.txt` directs any amount calculation to the calculator. Source identity cannot select a topic when one source contains both. Use a structured question topic and keep supported gift calculator routing separate from withdrawal policy. |
| High | Image guidance conflicts with public links | Active `image_limits.txt` ends “No reveles enlaces, parámetros de acceso ni credenciales.” On a mixed image + FAQ/public-event turn this prohibits the calculator/search URL another selected module requires. Restrict nondisclosure to secret or private access links; public verified resources should remain usable. |
| Medium | Planning-wide flow discipline conflates final closure with pause | Active `reply_planning_owner` loads `flow_discipline.txt` on every planning node. It says “Si el usuario quiere pausar o cerrar, confirma guardado temporal sin pedir más datos.” Final `finish_plan` may require missing contact/date or have confirmed quotation receipts. The legacy close node contract describes the distinction, but is not production-loaded. Derive the reply from typed pause/close/precondition/receipt outcomes. |
| Medium | Unrelated planning instructions remain globally attached within the owner | `reply_planning_owner` always adds domain scope, domain knowledge, flow discipline, and question strategy. Thus receipt/close/pause replies carry initial interview collection and supplier-search instructions. Select by actual typed planning outcome or operation, rather than owner alone. |
| Medium | Purchase partial-failure guidance misses completed partial results | `deriveReplyCompilerContext` sets `hasPartialPurchaseFailure` only when the entire purchase result has `status=failed` plus failed `sourceCoverage`. A completed result with usable purchases and a failed source does not select the dedicated partial-failure module. Test both representations and derive applicability from source outcomes independently of aggregate status. |
| Medium | Broad no-repetition invariant lacks a new-evidence exception | Active `shared/reply_core.txt` prohibits repeating a limitation as new; the audit-only informative contract has the clearer exception for newly arrived evidence. Typed latest outcome/new facts should decide whether updated limitations or failure outcomes matter, especially on repeated failed handoff attempts. |

## Source facts and boundaries

The checked-in `cuanto-cuesta.md` states first transfer free, then US$5 or equivalent per additional transfer. `donde-va-el-dinero.md` independently describes first transfer without a deduction and subsequent $5. Neither provides a fixed PEN20 rate. The latter checked-in article does not contain the processing-hours sentence required by `parseHostWithdrawalPolicy`; missing hours must remain absent rather than inferred from gift-payment validation articles. This is a source freshness/availability observation, not a proposal to invent a processing window.

The working-tree public-search module is appropriately conditional on an associated-event empty/not-found result. It gives `/buscar` as a next step, does not claim a matching published event, does not grant private access, and does not permit RSVP mutation. Its interaction with image restrictions and router settlement still needs explicit mixed-task tests.

## Automated freshness mechanism beyond byte budgets

1. Generate the authoritative instruction inventory from actual `buildExtractionRequestSpec` and `buildReplyRequestSpec` calls over a typed branch matrix. Record module IDs, file hashes, schema version/hash, executable tools, and fact-group provenance. Static legacy loader output must be labeled separately.
2. Require every tracked prompt file to have an explicit status: production consumer and applicable branch, or archived/non-runtime purpose. Fail for unclassified or orphan files. This prevents fixing a prompt the runtime never loads.
3. Add a machine-readable dependency contract to modules: typed evidence paths and enum values read, permitted tool names, applicable task/outcome, and required source identity. Validate paths against exported schemas/types and tool manifests; fail on renamed or impossible fields/tools.
4. Test positive and negative applicability, including pairwise mixed tasks: FAQ fees + no purchases, withdrawal policy vs gift commission, public search + image, handoff + completed FAQ, completed partial purchase, and planning pause vs final close. Assert modules, evidence, tools, and real effects rather than expected conversational wording.
5. Invalidate the branch contract when a dependent schema/tool/source hash changes and require an explicit review record. For knowledge articles, store source URL, fetched-at, content digest, extracted fact provenance and incomplete-source status. Keep unknown policy facts unknown.
6. Retain byte budgets as a resource check, but report added/deleted instruction content and branch relevance. A shorter request is not proof of freshness, consistency, or behavior correctness.

No AWS, model, or paid live calls were made by this audit.
