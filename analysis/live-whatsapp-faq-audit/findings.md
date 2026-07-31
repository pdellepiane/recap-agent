# Findings

## Current Understanding

- The retained performance table contains 35 WhatsApp turns routed to
  `consultar_faq` between 2026-06-27 and 2026-07-21.
- Twenty-four of the 35 turns concern gifts, purchases, payments, delivery,
  withdrawals, or transaction discrepancies. This count was manually reviewed
  from the redacted previews; it is not a runtime keyword classifier.
- The runtime has no dedicated gift, sales, payment, withdrawal, or claim tool.
  `consultar_faq` can only search reference documents. Guest-event lookup
  exposes limited read-only order summaries, but it cannot verify or modify a
  transaction. Operational answers in these areas were therefore unsupported.
- Ten native WhatsApp message identifiers were processed twice. Those ten
  excess records are 28.6% of all retained question records. Several duplicate
  pairs produced materially different answers to the same message.
- All 35 records have an empty assistant quality-flag list. Existing quality
  checks did not detect unsupported operational claims, contradiction between
  duplicate answers, or ambiguous short-fragment interpretation.
- `file_search` ran on 34 of 35 turns. Retrieval did not prevent invented
  causes or contradictory procedures because the prompt asked the model to turn
  reference content into operational support.
- A live sequence from 2026-07-18 routed “Podría darme El dato” and then “El
  horario” as independent turns. The assistant interpreted the second fragment
  as business hours instead of asking whether the user meant the event
  schedule. The existing multi-message burst design directly addresses this
  failure mode.
- CloudWatch shows status `200` and successful delivery for the representative
  ambiguous and transaction turns. The 2026-07-21 discrepancy response took
  approximately 26.5 seconds but still completed normally. This points to
  classifier/reply behavior, not a Lambda exception or timeout.
- CloudWatch retention is seven days. DynamoDB is the only retained source for
  older question previews and trace metadata during this audit.

## Decisions

- Gift, sales, payment, withdrawal, balance, order, and claim questions must
  state that the conversation can directly provide event information only and
  offer a human handoff. The assistant must not diagnose an operation.
- Verification-code guidance must explain why the code is required, where to
  find it, and that images cannot currently be read.
- Email normalization may remove whitespace immediately adjacent to `@`.
  It must not add, remove, or guess other characters.
- User-visible output must use Spanish equivalents for common service terms.
  Internal typed identifiers and canonical provider-category values remain
  unchanged.
- Burst persistence remains outside the durable event plan. Individual messages
  will be retained temporarily in the adapter burst store so misunderstood
  bursts can be replayed and used to improve wording and behavior. Native
  message identifiers also provide deduplication.
- Natural-language questions about images are not evidence that an image was
  sent. The channel adapter must forward the native WhatsApp media descriptor
  (`id`, registered `mime_type`, SHA-256 digest, and media class). DynamoDB and
  CloudWatch record safe derived metadata so an actual image turn can be
  distinguished from a text-only capability question.
- Each new performance turn carries a bounded, versioned feedback snapshot with
  hashed correlation, input shape and ingress timing, routing confidence and
  explicit ambiguity state, clarification presence, decision source, model/tool
  stages, output-complexity counts, existing quality flags, and known
  Spanish-policy-term warnings. Raw bodies and media remain in their
  authoritative external stores rather than being copied into the analytical
  snapshot.
- A later demonstration reproduced the schedule error when the extractor
  described the missing context in `assumptions` but returned confidence
  `0.55`, just above the former `0.50` cutoff. Ambiguity is now an explicit
  typed extraction decision, and the runtime preserves it as exactly one
  validated clarification question.
