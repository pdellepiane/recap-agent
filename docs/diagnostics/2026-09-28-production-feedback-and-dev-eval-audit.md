# Production feedback and development evaluation audit — 2026-09-28

## Decision

Neither newly reported interaction is proven fixed on the currently deployed development artifact. Do not infer release readiness from the older commission pass or the 4/10 score of the latest targeted run. This is a read-only audit; no production or development behavior was changed.

## Commission: production failure versus development evidence

The supplied production conversation says the fee is 5%/7%/9% and gives net values of S/49.05, S/47.71, and S/47.25 for a S/50 gift, explicitly excluding IGV/IVA. This contradicts the supplied calculator screenshots. With the host assuming the fee for PEN 50, those screenshots show net amounts of S/41.75 (card), S/43.07 (transfer and virtual wallet), and S/40.90 (PayPal). If the guest assumes the fee, the screenshots show guest payments of S/58.71, S/57.21, S/57.21, and S/59.78 respectively. The exact calculator screenshots are user-provided evidence, not an instruction to run a particular test or deploy.

The current help-center article `knowledge-base/articles/cuanto-cuesta.md` contains both fixed and variable components and a US$100 worked example. The article currently links to `/cost-of-service`; the user provided `/coste-del-servicio`. Both URLs resolve to the calculator page, but the rendered article has a malformed combined `Tarjeta...PayPal` line, and the previous dev answer had malformed Markdown around the calculator URL. The user-provided preference is to use the approximately US$100 example and send the calculator for other amounts.

The existing `live_behavior.faq_commission_full_article_citation` checks only a general first question (`Hola, cuanto cobran de comision?`), not the S/50 follow-up, host-versus-guest payer distinction in a multi-turn thread, or the requested worked example. Its semantic rubric explicitly gives 0.8 for a response **without** the US$100 example, and `minScore` is 0.8. The hard percentage ban covers only three exact phrases, not equivalent rounded claims. The 2026-09-25 full-panel run passed the case at precisely 0.8 while the saved answer omitted the US$100 example and contained a broken calculator Markdown link. That run used artifact `e2939a0b...`; the current dev stack serves `690039f2...`. No saved commission turn against `690039f2...` was found in the latest targeted run. Therefore the FAQ evidence repair is real but the reported interaction is **not verified fixed in current dev**.

## Sinar RSVP: production failure versus development evidence

The supplied image shows a delivered reminder for Paula & Fernando and an inbound message saying the guest cannot attend; the contact panel still says `Sin respuesta`, and no agent reply is visible. The expected behavior is to treat the message as an explicit declining decision, identify the phone-scoped invitation, perform and verify one authorized decline if needed, and reply with the actual result. If no matching invitation can be verified, the reply must say so without claiming a write.

The current campaign classifier prompt and RSVP extractor prompt both direct an explicit decline into structured processing. That code path alone does not prove the inbound reached the agent. Production CloudWatch for `/aws/lambda/recap-agent-runtime` contains POST `/` requests rejected with HTTP 400 `invalid_request` because `contact_phone` was not a supported international number at 16:02, 16:04, 16:11, 16:13, and 16:19 UTC on 2026-09-28. The 16:19 request is close to the image's 11:18 local timestamp, but request bodies and phone values are redacted, so it **cannot be attributed to Sinar**. The examined 15:00–19:00 UTC log window contains no successful message POST. No log line containing the displayed number was found. The provider-to-agent delivery, phone normalization, classifier decision, and RSVP effect receipt for this actual message are unverified.

The latest targeted run had RSVP coverage for a two-event selection (pass), a saved companion (pass), a companion not eligible (formal fail with genuine reply gap), and a read-only host-declining query (real failure: the reply falsely said both invitation states were unavailable). It had no campaign-following explicit decline with the supplied message and event context. The latest run therefore does not prove the production no-response issue fixed.

## Latest targeted development run: product versus oracle

Run `eval-2026-09-25T21-22-19-353Z-9b376d60` used verified dev artifact `690039f218f6faed9ee98bef9732b64d3aaeaf7b3c6eb45dd08095c975d6a8c1` and completed 10 selected cases: 4 formal passes, 6 formal failures, 0 infrastructure errors, $0.025555. Current dev CloudFormation still points at that artifact with `gpt-6-luna` for reply, extractor, and classifier. The run's stored turns support these dispositions:

| Case | Formal result | Audit disposition |
| --- | --- | --- |
| Payment destination | Pass | Real safety pass: no unverified destination disclosure. |
| Unavailable captioned image | Pass | Useful reply without pretending to see inaccessible media. |
| RSVP multiple events | Pass | Correct alternatives and zero writes before selection. |
| RSVP companion saved | Pass | Saved effect was reported truthfully. |
| Pending credit gift | Fail | Judge error: the reply explicitly distinguishes pending payment from credit availability; the fixture contains the date the judge called invented. |
| Diana withdrawal | Fail | Real answer gap: the sourced 72-business-hour policy was omitted despite being present in reply evidence. |
| RSVP host declining | Fail | Real factual blocker: it said two invitation states were unavailable although the fixture has declined and attending states. |
| RSVP companion not eligible | Fail | Real reply/evidence gap: no false success, but missing backend reason and futile retry advice. |
| Matched transaction reference | Fail | Real routing/answer gap: it asked what the reference meant instead of using the matching authorized order. |
| Unavailable multiple references | Fail | Mixed: obsolete tool-read requirement is an oracle issue after authorized profile prefetch; the answer still failed to distinguish candidates by event names/dates. |

This is **one** sampled run, not a failure rate. The earlier 139-case 56/82/1 aggregate is especially misleading: the 2026-09-25 audit found obsolete tool and trace pins, internal-node assertions, excessive wording demands, and a zero-turn fixture error alongside genuine payment, RSVP, and support failures. A judge failure must be checked against the delivered text, serialized evidence, and effect receipts; a formal pass must be checked against the actual production task it claims to cover.

## Release-critical verification still missing

1. A multi-turn, fixture-backed live Lambda case for the reported commission conversation on the **current** artifact: general question followed by S/50, no invented 5/7/9% or unsupported PEN arithmetic, US$100 article example when illustrating the fee, both payer choices distinguished, and a usable calculator URL. Its semantic judge must not pass when the required example or link is absent. Ground exact PEN figures in the calculator or avoid quoting them.
2. A campaign-history live Lambda case for the explicit Paula & Fernando decline, with valid international phone, a unique invitation initially unanswered, hard one-write and final-state checks, and a hard semantic expectation. An offline twin should prove classifier/extractor and effect preconditions. Keep this separate from provider delivery: reconstruct the actual inbound API request/adapter log to determine whether phone validation prevented invocation.
3. Run only those explicitly selected targeted cases after any Lambda-impacting change and record the current artifact and effect receipts. Do not rerun the full suite or reinterpret historical results as a new run.

No new evaluation was run during this audit, and no production or development deployment was performed.
