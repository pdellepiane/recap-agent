# Sources

These sources record analysis provenance. Internal project, Notion, and AWS
inspection sources support the report's technical reconstruction, but they are
not formal bibliography items. The rendered report bibliography is limited to
public official documentation and academic sources.

| Name | Path or URL | Type | Date Checked | Why It Matters | Caveats |
| --- | --- | --- | --- | --- | --- |
| Repository implementation | `src/`, `prompts/`, `infra/`, `tests/`, `evals/` | files | 2026-06-22 | Authoritative implementation evidence for the architecture report. | The report body intentionally avoids direct code/file references. |
| Implementation log | `docs/implementation-log.md` | file | 2026-06-22 | Captures reasons, decisions, validations, and evolution of implementation changes. | File was already modified before this work; edits were preserved and appended. |
| Operational docs | `README.md`, `docs/*.md` | files | 2026-06-22 | Provides channel, evaluation, KB, vector search, deployment, and auth context. | Some docs contain older absolute paths or dates; implementation and AWS were treated as authoritative where current behavior matters. |
| Analysis dossiers | `analysis/*` | files | 2026-06-22 | Provides audited evidence on provider data quality, endpoint readiness, venue search, and feedback fixes. | Dossiers are date-specific and should be cited with their audit dates. |
| Notion Project Charter | Notion page `323d5d10-94a6-80a0-9225-f7db2cd0ed9e` | Notion page | 2026-06-22 | Defines thesis/product objective, scope, stakeholders, and success criteria. | Internal workspace source. |
| Notion Flujo conversacional | Notion page `32cd5d10-94a6-8065-841b-e1fba5c6ac48` | Notion page | 2026-06-22 | Defines the intended conversational flow and state-driven behavior. | Internal workspace source. |
| Notion Agent Builder decision | Notion page `328d5d10-94a6-8010-afca-c5cd6f8fb85a` | Notion page | 2026-06-22 | Documents the decision to use OpenAI for orchestration but keep a project-owned adapter/runtime layer. | Internal workspace source. |
| Notion architecture design | Notion page `32cd5d10-94a6-80ee-9e5f-d35964a1571e` | Notion page | 2026-06-22 | Documents the shift from assumed OpenAI-hosted integration to channel/adapter/orchestration layering. | Internal workspace source. |
| AWS runtime stack | `aws cloudformation describe-stacks --stack-name recap-agent-runtime` | AWS CloudFormation | 2026-06-22 | Confirms live development runtime parameters, outputs, state, vector-store IDs, and feature flags. | Requires `AWS_PROFILE=se-dev`. |
| AWS provider sync stack | `aws cloudformation describe-stacks --stack-name recap-agent-provider-sync-dev` | AWS CloudFormation | 2026-06-22 | Confirms deployed provider sync and provider vector store. | Requires `AWS_PROFILE=se-dev`. |
| AWS knowledge sync stack | `aws cloudformation describe-stacks --stack-name recap-agent-knowledge-sync-dev` | AWS CloudFormation | 2026-06-22 | Confirms deployed FAQ/KB sync and knowledge vector store. | Requires `AWS_PROFILE=se-dev`. |
| Sullivan report template | `/Users/leonardocandio/Downloads/LaTeXTemplates_sullivan-business-report_v1.0` | local template | 2026-06-22 | Supplies the requested LaTeX report template and assets. | Local copied class was made portable for the installed TinyTeX package set. |
| UNAM technical-report guide | `https://www.ingenieria.unam.mx/especializacion/egreso/Como_redactar_un_informr_tecnico.pdf` | public PDF | 2026-06-22 | Supports the report's emphasis on precision, concision, clarity, structure, figures, references, and revision. | Public guide has no visible publication date in the PDF. |
| AWS official documentation | AWS Lambda, DynamoDB, Secrets Manager, CloudWatch, EventBridge, S3, CloudFormation docs | public documentation | 2026-06-22 | Supports service-level architecture claims in the formal bibliography. | Documentation pages are living references; access date is recorded in BibTeX. |
| OpenAI official documentation | OpenAI Agents SDK and Retrieval docs | public documentation | 2026-06-22 | Supports agent-orchestration and vector-store/retrieval claims in the formal bibliography. | Documentation pages are living references; access date is recorded in BibTeX. |
| AF.csv academic export | `/Users/leonardocandio/Downloads/AF.csv` | reference export | 2026-06-22 | Provides academic context sources for conversational recommender systems, production agents, and RAG-style dialogue systems. | Only selected public academic entries were promoted to formal bibliography. |
