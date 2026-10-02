# Documentation map and final-state cutoff

**Documentation issue date:** 30 September 2026. **Implementation and testing evidence cutoff:** 30 September 2026, America/Lima. This index identifies current contracts and separates them from dated plans, audits, and partial-delivery reports. A dated report records evidence at its cutoff; it does not override current code, the latest user directive in `AGENTS.md`, or a later verified deployment.

## Final-delivery reports

- [Technical implementation report (PDF)](thesis/architecture-report/recap-agent-architecture-report.pdf) and [editable LaTeX source](thesis/architecture-report/recap-agent-architecture-report.tex): Spanish report in the established thesis format, issued **30 September 2026**, presenting architecture, measured approval rates and functional coverage. Evidence remains dated 30 September.
- [Chronological implementation activity report (PDF)](thesis/architecture-report/recap-agent-activity-report.pdf) and [editable LaTeX source](thesis/architecture-report/recap-agent-activity-report.tex): March–September implementation activities, in the same report template.
- [Testing and validation](testing.md): the current internal testing contract, measured scope and results; the evaluation framework is its operating guide.
- [Dated chronological activity evidence](thesis/final-activity-log-2026-09-30.md): the underlying September chronology and links to operational records.
- [Adding durable FAQ documents](knowledge-document-maintenance.md): internal add/preview/publish/delete helper, deterministic original-only source footers and cleanup ownership.
- [Implementation log](implementation-log.md): granular decisions, reasons, run identities, and deployment evidence. Entries are historical records and should not be rewritten to imply that an earlier hold was a later approval.
- [Documentation currency audit](documentation-audit-2026-09-30.md): active guides checked against current code and historical files classified.

## Current operating contracts

- [Project rules](../AGENTS.md): disclosure, model-written conversation, AWS profile, deployment, and selected-case evaluation requirements.
- [Channel integration](channel-integration.md): the Lambda request/response boundary, trusted sender phone, correlation, and adapter responsibilities.
- [Information flow](information-flow.md): typed customer tasks, authorization, source coverage, and the profile path. The final technical report captures the later complete-profile invariant.
- [Evaluation framework](evaluation-framework.md): case and artifact format. The selected-case rule in `AGENTS.md` supersedes historical full-suite suggestions.
- [Knowledge integration](knowledge-base-integration.md), [provider vector search](provider-vector-search.md), and [conversation coordination](conversation-turn-coordination.md): focused subsystem guides.
- [AWS authentication](aws-auth-setup.md) and [branch deployment](github-branch-deploys.md): operational setup. Historical setup/pending notes must be checked against actual configuration before execution.

## Historical evidence

The June partial-delivery `recap-agent-doc.tex`/PDF and [the June comprehensive document](thesis/recap-agent-comprehensive.md) are retained as historical snapshots. The architecture report at the path above has been updated in place. [The 29 September Markdown technical draft](thesis/final-technical-report-2026-09-29.md), the August [phone-access decision](phone-scoped-access-decision.md), the July [media guide](media-integration.md), and earlier demos/test reports are historical evidence, not current implementation guides. They contain old defaults or superseded behavior. `docs/plan/`, `docs/diagnostics/`, `analysis/`, `feedback/`, and prior test reports preserve decisions and raw findings at their dates; their future-tense tasks and old release holds are not a current release instruction. The lean-conversation [acceptance contract](plan/2026-09-09-lean-conversation/acceptance-contract.md) remains binding where it defines behavior, while dated work plans are historical execution records.

## Working-tree freeze boundary

At the start of this documentation work, `main` pointed to `cb871705b0a5344104d4843f97e68ff5df41b9d1`. The checkout already contained extensive uncommitted source, evaluation, prompt, and documentation changes plus untracked files. This pass preserves those edits and describes the working tree as reviewed for the 30 September issue; the exact deployed production ZIP and Lambda code identities are preserved in the implementation log and diagnostic records. The checkout is **not** represented as a clean Git release/tag, and the documentation cutoff does not claim that every local uncommitted byte was deployed.

The earlier [30 September source fingerprint](final-source-fingerprint-2026-09-30.json) records SHA-256 hashes for 887 source, test, prompt, evaluation, infrastructure, script, knowledge-base, and selected configuration files. It excludes secret/local/generated paths, analysis artifacts, and the documentation tree. A local snapshot archive under `.artifacts/final-freeze-2026-09-30/` preserves those project files plus the final documentation for recovery; its companion `.sha256` file verifies the archive. The [29 September fingerprint](final-source-fingerprint-2026-09-29.json) and archive remain historical snapshots. Neither archive is a Git commit or a deployed artifact.

## Final consolidation

The [final consolidation record](final-consolidation-2026-09-30.json) identifies the source and documentation snapshot at its September cutoff, repository checks and remaining limitations. It supersedes the earlier source fingerprint as the current working-tree inventory while preserving that fingerprint and archive as historical evidence. It is not a clean Git release or a production deployment. Current behavior coverage is 46 cases/329 hard assertions; the valid final development validation covers the seven repaired cases only.
