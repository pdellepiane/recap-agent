# ATC response-template audit

Audit date: 2 October 2026. This internal record does not revise the September issue dates or historical validation results in the reader-facing PDFs.

## Finding

The previous ingestion pipeline did not extract facts. It selected the `Chat, WS y RRSS` section, removed bracketed strings, and copied the remaining full reply under a “verified policy facts” heading. The upload used `source=notion_customer_service_templates` and `source_kind=response_sample`. Runtime search mixed those passages with official FAQ evidence without a source filter. A high similarity score could therefore promote an example outcome into current evidence. Bracket removal also damaged Markdown links; it was neither factual review nor safe semantic normalization.

All 27 active templates were inspected, alongside the export inventory of 54 rows, 30 chat-ready rows and three deprecated chat templates. No assertion is made that a particular prior bad answer was caused by a template without its stored model request. The implementation provides a plausible contamination path; the exported text proves that case-specific assertions were eligible for ingestion.

## Source precedence and decision

1. Authorized customer state supplies individual records, balances, order status, events and provenance.
2. Confirmed operation outcomes and receipts establish actions and their effects.
3. Official FAQ articles supply public policy and procedures, without establishing individual outcomes.
4. Separately published internal documents may supplement public knowledge within their explicit scope. Raw ATC replies supply no conversational evidence.

No raw template is retained as a heuristic, and no keyword-based extraction attempts to decide which sentences are safe. A future guidance document must be reviewed separately, identify the applicable situation and policy source, and omit complete replies, customer outcomes, payment destinations, assumed investigations, unverified promises and identity-collection scripts. Such guidance cannot settle a case or override customer state or official policy.

## Complete active-template review

Every row below is excluded from model retrieval. Original exports remain unchanged and available for audit.

| Template | Reason / potential future review |
| --- | --- |
| NEW - Solicitud de fondos | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| NEW - Qué es Sin Envolturas? Cómo funciona? | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Error en regalo | Claims recorded order, missing payment and amount due without backend evidence. |
| Errores web | Claims a case was reported and the team is already investigating. |
| Error en transferencia de fondos | Assigns a specific failure reason and requests identity documents. |
| Respuesta - Error en transferencia de fondos | Promises processing today and bank receipt tomorrow. |
| Rechazo PayU | Supplies payment destinations and identity-document requests outside a verified order. |
| No Infracción de TyC | Claims a completed review of the customer website. |
| Voucher de regalo | Assumes voucher receipt and promises future confirmation emails. |
| NEW - Comisión de regalos | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| NEW - Cómo crear una cuenta | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| NEW - Cómo hacer un regalo? | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Reactivación de cuenta | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Evitar cambio de URL de la lista | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Regalo en validación - Anfitriones | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Registro manual de regalos | Prescribes collection of personal fields without current-task authorization. |
| Cuentas Sin Envolturas | Contains payment destinations; a retrieved template cannot authorize disclosure. |
| Mensaje de validación | Claims successful validation and an imminent email. |
| Cuenta extranjera u otro titular | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Depósito a cuenta de anfitriones | Claims examination of a receipt and identifies its recipient. |
| Cambio de fecha | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Cómo hacer dedicatoria | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Cuándo llega mi regalo | Treats all gifts as monetary and funds as available, ignoring physical items and states. |
| Web oculta | General policy/procedure mixed with a complete reply; only a separately reviewed, sourced fact or applicability note could be reused. |
| Rechazo PayU - Anfitrión | Claims emails were already sent and requests guest identifiers. |
| Error en regalo - Anfitrión | Claims contact attempts, payment investigation and future adjustment/validation. |
| Saludo | Provides a canned greeting and redundant identity collection. |

The adjacent JSON inventory records each title, response SHA-256 and byte count. It intentionally does not duplicate the raw case replies or payment destinations.

## Implemented correction

- Removed the raw-response Markdown formatter/writer and generation/sync scripts, including their package commands.
- Added source/source-kind filters before vector ranking so tagged samples cannot displace FAQ results.
- Independently rejected returned sample attributes and legacy `atc-template-` filenames before evidence construction or article expansion. This checks document identity, not conversational intent.
- Applied the legacy filename exclusion to fixture retrieval as well.
- Preserved official FAQ expansion/citation, helper documents and the existing canonical customer-state projection. No model instruction was appended; changed instruction bytes are zero and rejected sample text contributes zero input bytes.

The existing indexed files are preserved as historical material. The development runtime excludes them; no production promotion or destructive bulk deletion is performed. At audit completion, production still required promotion of the tested artifact; that later user-authorized promotion is recorded below.

The withdrawal-specific parser also trusted one ATC filename and hid other FAQ evidence. It now requires a validated full official withdrawal article for any numeric processing window; absent that window, the available FAQ evidence remains visible. The current official withdrawal article does not establish 72 hours. Its previous mandatory live assertion was unsupported and has been replaced with an honest-outcome control; handoff/effect/access controls remain.

## Validation

Final focused deterministic validation: 113 checks pass across nine files, including mandatory coverage linkage; one existing check is skipped. Type checking and scoped lint pass. Controls include tagged samples with innocuous filenames, untagged legacy filenames, generic response-sample attributes, higher-ranked false outcomes, official FAQ preservation, helper preservation and fixture exclusion. These are objective evidence-boundary checks, not a semantic quality score.

Development artifact and the explicitly selected live result are recorded in the implementation log after execution. No full live panel is run.

The first selected development run completed six turns but failed 1/11 hard assertions: the deterministic source citation was missing. It did not expose an ATC sample. Trace evidence showed a first-ranked official commission article at score 0.799831, below the secondary 0.8 article-expansion threshold. The correction preserves complete verified article provenance when this recognized source ranks first, while keeping snapshot hash, live-batch, canonical URL and bounded expansion checks. An offline regression reproduces the observed scores. Historical failed evidence is retained in the implementation log.

Final development validation: selected FAQ commission case passed 1/1, with 11/11 hard assertions across six turns, on artifact `12651d9c561b5469c7c6682373546da32f9e10cb87283499efa49c65dd0a17fd`. Run `eval-2026-10-02T15-53-40-385Z-0cb1afbe`, cost USD 0.005484. Retrieved evidence contains zero raw ATC samples. The adjacent `2026-10-02-atc-validation.json` records filenames, serialized request-byte measurements and the prior failed run identity. No full live panel or production promotion was performed.

## Subsequent production promotion

The user subsequently authorized production deployment and repository push. The exact tested development artifact was promoted successfully on 2 October. Production CodeSha256 and all three model parameters match development; existing production credentials and configuration were preserved. Fail-closed request/authentication smoke checks pass with tracking IDs. The source exclusion now applies to production as well. See `2026-10-02-production-promotion.json` and the implementation log for release and rollback identities.
