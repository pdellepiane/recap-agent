#!/usr/bin/env node
/**
 * Owner C (C1) adjudication ledger builder.
 *
 * Builds the 138-row ledger for the immutable frozen run
 * eval-2026-09-22T21-54-01-651Z-54da3f5a from report.json, manifest.json,
 * and per-case artifacts WITHOUT rescoring: every score and status is
 * copied from the frozen report. Each failed expectation carries an
 * inspected classification:
 * - product-fact-effect: wrong fact, invented detail, false/missing effect.
 * - product-helpfulness: omission, wrong question, verbosity, weak next step.
 * - oracle-fixture: the contract or fixture is defective (trace-proven).
 * - planning-accepted: planning-flow gap with zero effects and no
 *   invented/wrong-entity facts; may be waived only by an explicit later
 *   release decision, never silently.
 *
 * Usage: node scripts/build-adjudication-ledger.mjs
 * Output: evals/ledgers/eval-2026-09-22T21-54-01-651Z-54da3f5a.json
 */

import fs from 'node:fs';
import path from 'node:path';

const RUN_ID = 'eval-2026-09-22T21-54-01-651Z-54da3f5a';
const PFE = 'product-fact-effect';
const PH = 'product-helpfulness';
const OF = 'oracle-fixture';
const PA = 'planning-accepted';

/**
 * Adjudication map: `${caseId}::${expectationId}` -> classification entry.
 * contract: 'kept' or 'revised-to-v<N>' naming the new YAML contract.
 */
const ADJUDICATIONS = {
  'live_behavior.active_cart_checkout_continuity_alex::active-cart-not-flattened': {
    classification: PH,
    contract: 'kept',
    note: 'Confirmed cart context but did not advance the pending checkout need.',
  },
  'live_behavior.ambiguous_confirmation_adversarial_selection::adversarial-clarifies-without-choosing': {
    classification: PFE,
    contract: 'kept',
    note: 'Stayed in recomendar instead of clarifying; part of the provider-misidentification failure.',
  },
  'live_behavior.ambiguous_confirmation_adversarial_selection::adversarial-no-selection-persisted': {
    classification: PFE,
    contract: 'kept',
    note: 'provider_needs subset not satisfied; no proof a selection was avoided for the right reason.',
  },
  'live_behavior.ambiguous_confirmation_adversarial_selection::adversarial-no-provider-effects-or-close': {
    classification: PFE,
    contract: 'kept',
    note: 'Called search_providers_from_plan and get_provider_detail while the contract forbids provider effects on this turn.',
  },
  'live_behavior.ambiguous_confirmation_adversarial_selection::adversarial-ambiguity-response-is-a-focused-clarification': {
    classification: PFE,
    contract: 'kept',
    note: 'Repeated an extensive provider list with unsupported info and misidentified the two visible shortlist providers. Not planning-accepted: entity misattribution.',
  },
  'live_behavior.ambiguous_confirmation_clarifies::ambiguity-response-is-a-focused-clarification': {
    classification: PA,
    contract: 'kept',
    note: 'Asked for a WhatsApp number instead of clarifying provider/action. Planning-flow gap with zero mutation effects and no invented facts; release may waive explicitly.',
  },
  'live_behavior.campaign_scope_carryover_override_handoff::scope-carryover-answers-campaign-event': {
    classification: PFE,
    contract: 'kept',
    note: '"Se entrega como credito" implies posted/available credit, unconfirmed by evidence. Owner A credit-posting boundary.',
  },
  'live_behavior.continuity_question_needs_image::needs-image-first-turn-clarifies': {
    classification: PH,
    contract: 'kept',
    note: 'Asked for WhatsApp verification instead of the receipt image or the pending amount.',
  },
  'live_behavior.continuity_voucher_then_thanks::voucher-receipt-brief-and-honest': {
    classification: PH,
    contract: 'kept',
    note: 'Correctly denied approval but added an unrequested clarification question instead of one brief receipt.',
  },
  'live_behavior.customer_transaction_reference_unavailable_multiple::multiple-asks-grounded-selection': {
    classification: PFE,
    contract: 'kept',
    note: 'Showed creation date 3 Sep instead of event date 2026-09-12 and omitted both event labels.',
  },
  'live_behavior.gift_credit_pending_payment_stays_pending::pending-policy-and-state-coexist': {
    classification: PH,
    contract: 'kept',
    note: 'Pending state correct but omitted the required credit-destination fact (hosts account credit).',
  },
  'live_behavior.gift_credit_states_host_choice_no_shipment::credit-host-choice-no-shipment': {
    classification: PFE,
    contract: 'kept',
    note: '"Lo eligen y gestionan desde alli" implies discretionary host management of the credit, which the record does not establish.',
  },
  'live_behavior.gift_mixed_order_distinguishes_items::mixed-gift-evidence-in-trace': {
    classification: OF,
    contract: 'revised-to-v4',
    note: 'Oracle defect: T0 shipping-question pin demanded paymentStatus approved while the trace carries authorized gift evidence (150/80 items, complete coverage) with paymentStatus null.',
  },
  'live_behavior.gift_mixed_order_distinguishes_items::mixed-order-wide-distinguishes': {
    classification: PFE,
    contract: 'kept',
    note: '"Se envian fisicamente" implies confirmed dispatch for the sheets; only no-delivery-date was supported. Real reply-grounding defect.',
  },
  'live_behavior.gift_sestore_unknown_shipping_offers_support::sestore-physical-without-invented-detail': {
    classification: PH,
    contract: 'kept',
    note: 'No invented shipment detail, but the required human-support offer is missing.',
  },
  'live_behavior.gift_shipping_limitation_accepted_handoff_once::handoff-limitation-offers-support': {
    classification: PFE,
    contract: 'kept',
    note: 'Missing human offer plus unconfirmed "se enviara" claim. T0 only; accepted-handoff T1/T2 behavior unchanged.',
  },
  'live_behavior.gift_unknown_type_preserves_uncertainty::unknown-preserves-uncertainty': {
    classification: PH,
    contract: 'kept',
    note: 'Uncertainty preserved with no invented facts, but no useful next step offered.',
  },
  'live_behavior.host_withdrawal_diana_policy_and_support::acknowledges-role-without-generic-reset': {
    classification: PH,
    contract: 'kept',
    note: 'Correct role recognition plus a prohibited provider menu that restarts the interaction.',
  },
  'live_behavior.host_withdrawal_diana_policy_and_support::later-event-message-stays-with-human-team': {
    classification: PH,
    contract: 'kept',
    note: 'Dropped the required event name (Diana y Fernando) on the continued support turn.',
  },
  'live_behavior.image_distractor_history_preserves_current_question::distractor-image-silent-persist-reason': {
    classification: OF,
    contract: 'revised-to-v3',
    note: 'Oracle defect: T0 silence pin contradicts the superseding receipt-context doctrine (byte-identical readable receipt must be answered per captionless v5); trace ran bounded reconciliation correctly.',
  },
  'live_behavior.image_multiple_pending_orders_no_select::multi-order-image-no-auto-select': {
    classification: PH,
    contract: 'kept',
    note: 'No approval claimed, but no selection question and no explicit pending-validation statement.',
  },
  'live_behavior.image_non_receipt_payment_claim::non-receipt-not-treated-as-proof': {
    classification: PFE,
    contract: 'kept',
    note: 'Treated a non-receipt image as showing a deposit. Real receipt/approval confusion.',
  },
  'live_behavior.image_readable_captionless::image-receipt-no-compatible-record': {
    classification: PH,
    contract: 'kept',
    note: 'Correct no-compatible-record state but omitted the visible S/ 149.90 amount, half the required T0 answer.',
  },
  'live_behavior.image_readable_captionless::image-delayed-question-answered': {
    classification: OF,
    contract: 'revised-to-v6',
    note: 'Oracle defect: T1 asks only how much the image says; the reply gave verified 149.90 with commerce/date and no approval claim, yet failed for omitting operation/card transcription.',
  },
  'live_behavior.image_too_large_fallback::too-large-guidance-in-spanish': {
    classification: PH,
    contract: 'kept',
    note: 'Never explained the image could not be received because of size; missing limitation delivery.',
  },
  'live_behavior.image_url_describe_dice::url-image-dice-described': {
    classification: PH,
    contract: 'kept',
    note: 'Four dice counted; one color rendered "amarillo verdoso" instead of yellow. Minor perceptual wording; pixels unavailable to prove the oracle wrong.',
  },
  'live_behavior.image_url_receipt_payment_thread::receipt-url-uses-native-context': {
    classification: PFE,
    contract: 'kept',
    note: 'image_url_context was in the scoped T1 surface and never called; no trace evidence of native-media availability, so the pin stands as a missing evidence fetch.',
  },
  'live_behavior.image_url_receipt_payment_thread::receipt-url-supports-without-proof': {
    classification: PFE,
    contract: 'kept',
    note: 'Unsolicited "muestra un deposito" description of a non-receipt fixture plus repeated validation lecture. T0 also shows the 227.76 full-due false balance (Owner A release blocker, ungraded in this case).',
  },
  'live_behavior.mailbox_issue_deferral_and_clarification_preserve_support::greeting-allows-brief-context-without-plan': {
    classification: PH,
    contract: 'kept',
    note: 'Greeting introduced a prohibited plan-building offer on the first turn.',
  },
  'live_behavior.mailbox_issue_deferral_and_clarification_preserve_support::acknowledge-deferral-without-inventing-referent': {
    classification: PH,
    contract: 'kept',
    note: 'Did not acknowledge the deferred send; assumed a storage-space fix for the ambiguous referent.',
  },
  'live_behavior.otp_sent_explains_image_limitation::post-send-image-guidance': {
    classification: PFE,
    contract: 'kept',
    note: 'Claimed a global inability to read images, explicitly prohibited and false.',
  },
  'live_behavior.otp_terminal_handoff_unknown::unknown-handoff-truthful-turn0': {
    classification: PH,
    contract: 'kept',
    note: 'Never explicitly stated a human-help attempt was made; "espera al equipo" suggests unmanaged future review.',
  },
  'live_behavior.otp_terminal_handoff_unknown::unknown-handoff-truthful-turn1': {
    classification: PH,
    contract: 'kept',
    note: 'Truthful pending state but omits the required explicit attempted-handoff statement.',
  },
  'live_behavior.otp_terminal_handoff_unknown::unknown-handoff-truthful-turn2': {
    classification: PH,
    contract: 'kept',
    note: 'Truthful pending state but omits the required explicit attempted-handoff statement.',
  },
  'live_behavior.owner_planning_to_faq_single_transfer::faq-reply-answers-general-question': {
    classification: PFE,
    contract: 'kept',
    note: 'Invented unsupported prices including USD$49 instead of stating no price is available.',
  },
  'live_behavior.phone_confirmation_unclear_requires_yes_or_no::does-not-repeat-retired-confirmation': {
    classification: PFE,
    contract: 'kept',
    note: 'Requested text/image (prohibited) and introduced unevidenced names plus a white-dress claim.',
  },
  'live_behavior.phone_purchase_missing_hands_off_once::scoped-lookup-and-handoff': {
    classification: OF,
    contract: 'revised-to-v2',
    note: 'Oracle defect: demanded request_human_takeover at T0 although the user text contains no handoff request or acceptance; an offer is not a requested effect.',
  },
  'live_behavior.phone_purchase_missing_hands_off_once::manual-help-requested': {
    classification: OF,
    contract: 'revised-to-v2',
    note: 'Oracle defect: demanded auto-escalation status requested for an unrequested handoff; offer-first doctrine keeps T0 at none.',
  },
  'live_behavior.phone_purchase_missing_hands_off_once::scoped-missing-data-handoff-not-account-login': {
    classification: OF,
    contract: 'revised-to-v2',
    note: 'Oracle defect: rubric required "help was requested" language for an unrequested handoff; the offer wording was correct behavior.',
  },
  'live_behavior.phone_purchase_missing_hands_off_once::scoped-lookup-not-found-outcome': {
    classification: OF,
    contract: 'kept',
    note: 'Fixture/executor gap: gift source failed so the summary is invalid_response, never a clean not_found. Contract kept pending the executor/fixture fix; a failed source must not become absence.',
  },
  'live_behavior.phone_purchase_missing_hands_off_once::missing-purchase-handoff-effect': {
    classification: OF,
    contract: 'revised-to-v2',
    note: 'Oracle defect: demanded a handoff.write 1/1/0 effect for an unrequested handoff; no unrequested write is the correct T0 behavior.',
  },
  'live_behavior.provider_reference_cheaper_option::cheaper-reference-response': {
    classification: PFE,
    contract: 'kept',
    note: 'Invented S/ 3,500 and S/ 4,000 amounts absent from evidence plus an unnecessary phone ask. Not planning-accepted: invented amounts.',
  },
  'live_behavior.provider_reference_miraflores_option::miraflores-reference-response': {
    classification: PFE,
    contract: 'kept',
    note: 'Introduced an ungrounded inconsistency about the option card and failed to confirm the Miraflores selection.',
  },
  'live_behavior.purchase_confirmation_carina_request_survives_normalization::ambiguous-request-clarifies-before-lookup': {
    classification: PFE,
    contract: 'kept',
    note: 'capability_decision unsupported instead of clarify; the operation ambiguity was never surfaced.',
  },
  'live_behavior.purchase_confirmation_carina_request_survives_normalization::ambiguous-request-does-not-choose-an-operation': {
    classification: PFE,
    contract: 'kept',
    note: 'requested_operation confirmation_document.send chosen instead of null; runtime picked an operation for an ambiguous request.',
  },
  'live_behavior.purchase_confirmation_carina_request_survives_normalization::ambiguous-request-no-external-call': {
    classification: PFE,
    contract: 'kept',
    note: 'Called lookup_guest_orders_by_phone on the ambiguous T0 turn that must not call out.',
  },
  'live_behavior.purchase_confirmation_carina_request_survives_normalization::asks-one-status-or-document-question': {
    classification: PFE,
    contract: 'kept',
    note: 'Asked which purchase instead of status-vs-document, and named the prohibited old Micaela and Gonzalo purchase.',
  },
  'live_behavior.purchase_confirmation_carina_request_survives_normalization::clarified-request-looks-up-current-order': {
    classification: PFE,
    contract: 'kept',
    note: 'Missing lookup_guest_orders_by_phone on the clarified turn that requires it.',
  },
  'live_behavior.purchase_confirmation_carina_request_survives_normalization::repeated-request-retains-operation-ambiguity': {
    classification: PFE,
    contract: 'kept',
    note: 'Repeated a which-gift clarification instead of resolving status-vs-document ambiguity.',
  },
  'live_behavior.purchase_current_pending_over_old_approved::current-purchase-uses-phone-orders': {
    classification: OF,
    contract: 'revised-to-v3',
    note: 'Oracle defect: demanded the orders-lookup label while the trace read the same record via the gift lookup (Samuel Josue, pending, complete coverage) and answered grounded.',
  },
  'live_behavior.purchase_delia_status_by_phone::delia-uses-order-summary-only': {
    classification: OF,
    contract: 'revised-to-v5',
    note: 'Oracle defect: demanded the orders-lookup label and banned the gift lookup while the trace read the same approved record via the gift lookup with complete coverage and answered grounded.',
  },
  'live_behavior.purchase_explicit_time_alternatives::explicit-time-keeps-recorded-hour': {
    classification: PH,
    contract: 'kept',
    note: 'Correct recorded hour 21:31 but omitted unknown-timezone and added unsolicited date/status.',
  },
  'live_behavior.purchase_joaquin_dedication_selection::joaquin-is-asked-to-select-one-purchase': {
    classification: PH,
    contract: 'kept',
    note: 'Two purchases distinguished, but no clear selection question and an unconfirmed support-handoff promise.',
  },
  'live_behavior.purchase_kiara_pending_by_phone::kiara-uses-order-summary-only': {
    classification: OF,
    contract: 'revised-to-v3',
    note: 'Oracle defect: banned the gift lookup while the trace read both authorized sources with per-source complete coverage and answered grounded.',
  },
  'live_behavior.purchase_martha_accountless_selection::martha-uses-phone-orders-without-auth': {
    classification: OF,
    contract: 'revised-to-v5',
    note: 'Oracle defect: demanded the orders-lookup label and banned the gift lookup while the trace read both records via the gift lookup with complete coverage and answered grounded.',
  },
  'live_behavior.purchase_pending_transfer_continuity::currency-time-claims-remain-grounded': {
    classification: PFE,
    contract: 'kept',
    note: 'Presented the user-supplied 30 Aug 9:31pm time as a record fact; it is unverifiable in the backend.',
  },
  'live_behavior.receipt_dual_same_amount_asks::dual-amount-asks-one-discriminator': {
    classification: PH,
    contract: 'kept',
    note: 'Both S/ 340.44 records preserved without selection, but no discriminator question asked.',
  },
  'live_behavior.receipt_explicit_older_target_wins::older-target-uses-explicit-record': {
    classification: PH,
    contract: 'kept',
    note: 'Explicit older record used correctly, but the required 72h validation window was omitted.',
  },
  'live_behavior.receipt_text_pending_then_receipt_alone::receipt-alone-explains-state': {
    classification: PH,
    contract: 'kept',
    note: 'Pending state and receipt/approval distinction correct, but the required 72h window was omitted.',
  },
  'live_behavior.repeated_otp_failure_preserves_gift_query::turn0-auth-episode-ended-handoff-confirmed': {
    classification: PH,
    contract: 'kept',
    note: 'Effect fired (handoff.write passed) but the reply only implies it via "revision del equipo" instead of stating human help was requested.',
  },
  'live_behavior.rsvp_ambiguous_event_requires_grounded_selection::remains-in-rsvp-node': {
    classification: PH,
    contract: 'kept',
    note: 'Routed responder_invitacion->entrevista instead of staying in the RSVP node.',
  },
  'live_behavior.rsvp_ambiguous_event_requires_grounded_selection::asks-which-persisted-event': {
    classification: PH,
    contract: 'kept',
    note: 'Asked which event without choosing, but omitted both required event dates.',
  },
  'live_behavior.rsvp_cristian_phone_enriched_confirmation::cristian-enters-rsvp': {
    classification: PH,
    contract: 'kept',
    note: 'Never entered the RSVP node (contacto_inicial->deteccion_intencion).',
  },
  'live_behavior.rsvp_cristian_phone_enriched_confirmation::cristian-reconciles-both-phone-reads': {
    classification: PFE,
    contract: 'kept',
    note: 'Missing all three RSVP evidence reads; the confirmation had no invitation/event evidence.',
  },
  'live_behavior.rsvp_explicit_mutation_targets_requested_event::turn0-answers-ana-facts': {
    classification: PFE,
    contract: 'kept',
    note: 'Wrong hour (1pm instead of recorded 18:00) for Boda Ana y Luis. Real fact defect; T1 mutation itself targeted correctly.',
  },
  'live_behavior.rsvp_guest_and_plus_one_combined_saved::combined-saved': {
    classification: PFE,
    contract: 'kept',
    note: 'Reply is self-contradictory: affirms the companion saved, then hedges "no pudo verificarse" against the saved receipt. No waiver: post-write fields unavailable in the artifact beyond the judge evidence (plus_one.saved true).',
  },
  'live_behavior.rsvp_host_set_declining_consistent::declining-reported-for-named-event': {
    classification: PH,
    contract: 'kept',
    note: 'Bounded two-event clarification asked, but invitation states per event omitted.',
  },
  'live_behavior.rsvp_missing_action_requires_explicit_decision::asks-for-explicit-rsvp-decision': {
    classification: PH,
    contract: 'kept',
    note: 'Explicit decision invited without mutating, but current not-attending state not stated.',
  },
  'live_behavior.rsvp_missing_event_identity_is_unavailable::incomplete-evidence-is-not-no-invitation': {
    classification: PH,
    contract: 'kept',
    note: '"No pude localizar una invitacion" suggests absence when the event was unidentifiable; no retry or human-help offer.',
  },
  'live_behavior.rsvp_plus_one_not_eligible_no_false_success::not-eligible-reported-honestly': {
    classification: PH,
    contract: 'kept',
    note: 'No-false-success held, but never clearly stated the companion response was not saved nor offered human help.',
  },
  'live_behavior.rsvp_plus_one_uses_phone_scoped_mutation::saved-outcome-only': {
    classification: PFE,
    contract: 'kept',
    note: 'Affirms the companion saved, then contradicts the saved receipt with "no fue posible verificar". No waiver without post-write proof.',
  },
  'live_behavior.rsvp_tia_niur_ambiguous_clarifies::ambiguous-enters-rsvp-node': {
    classification: PH,
    contract: 'kept',
    note: 'Never entered the RSVP node (contacto_inicial->contacto_inicial).',
  },
  'live_behavior.rsvp_tia_niur_ambiguous_clarifies::ambiguous-asks-bounded-selection': {
    classification: PH,
    contract: 'kept',
    note: 'Single bounded question asked, but neither candidate event nor dates named.',
  },
  'live_behavior.rsvp_trusted_phone_reports_no_pending::enters-rsvp-node': {
    classification: PH,
    contract: 'kept',
    note: 'Never entered the RSVP node (contacto_inicial->contacto_inicial).',
  },
  'live_behavior.rsvp_trusted_phone_reports_no_pending::reads-user-level-invitations-without-auth': {
    classification: PFE,
    contract: 'kept',
    note: 'Missing lookup_rsvp_invitations; the completed query returned no invitations yet the reply asked anyway.',
  },
  'live_behavior.rsvp_trusted_phone_reports_no_pending::records-rsvp-route': {
    classification: PH,
    contract: 'kept',
    note: 'route_kind contextual_clarification instead of rsvp.',
  },
  'live_behavior.rsvp_trusted_phone_reports_no_pending::reports-no-associated-invitation-outcome': {
    classification: PH,
    contract: 'kept',
    note: 'Asked an unnecessary clarification instead of reporting no invitation for the current number.',
  },
  'live_behavior.s01_frozen_kiara_pending_replay::s01-frozen-uses-order-summary-only': {
    classification: OF,
    contract: 'revised-to-v4',
    note: 'Oracle defect: demanded the orders-lookup label and banned the gift lookup while the trace read the same frozen record via the gift lookup with complete coverage and answered grounded. Frozen world unchanged.',
  },
  'live_behavior.s08_kiara_approved_replay::s08-approved-uses-order-summary-only': {
    classification: OF,
    contract: 'revised-to-v6',
    note: 'Oracle defect: banned the gift lookup while the trace read both authorized sources with per-source complete coverage and answered grounded. Frozen world unchanged.',
  },
  'live_behavior.s4-injected-renderer-prose-fails::s4-genuine-card-correct': {
    classification: PFE,
    contract: 'kept',
    note: 'Attributed the selection to another provider, contradicting the Opcion Esencial evidence.',
  },
  'live_behavior.spanish_only_mixed_language_request::correct-behavior-and-spanish-only': {
    classification: PA,
    contract: 'kept',
    note: 'Facts grounded and Spanish-only held; only a concrete next step for the email-link request is missing. Zero effects; release may waive explicitly.',
  },
  'live_behavior.support_detail_continuity::support-details-do-not-reset-or-rename': {
    classification: PH,
    contract: 'kept',
    note: 'Repeated names without maintaining the card-payment issue. Real support-continuity defect (Owner B).',
  },
  'live_behavior.tito_numbered_name_and_post_rsvp_closure::post-rsvp-comment-preserves-attendance-with-one-acknowledgement': {
    classification: PH,
    contract: 'kept',
    note: 'Multiple thanks sentences instead of one brief mention, plus an unbacked "bonita" claim.',
  },
  'live_behavior.wait_followup_no_repeat::turn1-short-no-repeat': {
    classification: PH,
    contract: 'kept',
    note: 'Concise no-reconfirm reply, but restated confirmation date/time against the no-repeat contract.',
  },
  'live_behavior.wait_followup_no_repeat::turn2-short-no-repeat': {
    classification: PFE,
    contract: 'kept',
    note: '"Quedo registrada" claims a new registration for an already-registered confirmation. False-effect language.',
  },
  'live_behavior.wedding_planner_location_completes_search::final-response-advances-without-an-empty-extra-step': {
    classification: PFE,
    contract: 'kept',
    note: 'Real search options presented, but with invented prices, service descriptions, and promo terms. Not planning-accepted: invented facts.',
  },
  'live_feedback.token_fresh_multifront_stays_multi_need::correct-multifront-behavior': {
    classification: PFE,
    contract: 'kept',
    note: 'Five needs kept in one plan correctly, but with invented ratings, reference prices, and venue details. Not planning-accepted: invented facts.',
  },
};

const CASE_NOTES = {
  'live_behavior.image_url_receipt_payment_thread':
    'T0 shows the known false-balance release blocker (227.76 stated fully due from unknown paid); T0 is ungraded in this case and owned by Owner A.',
  'live_behavior.phone_purchase_missing_hands_off_once':
    'Four of five failures are oracle defects revised to v2 (offer-first doctrine); the not-found trace pin reflects a fixture/executor gap and is kept.',
};

const ALLOWED_CLASSIFICATIONS = new Set([PFE, PH, OF, PA]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const root = process.cwd();
  const runDir = path.join(root, '.eval-runs', `${RUN_ID}`);
  const report = readJson(path.join(runDir, 'report.json'));
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  const orderedIds = manifest.cases.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.length !== 138) {
    throw new Error(`Frozen manifest must order exactly 138 cases, got ${orderedIds?.length}.`);
  }
  const resultsById = new Map(report.results.map((row) => [row.caseId, row]));
  const rows = [];
  const usedKeys = new Set();
  for (const caseId of orderedIds) {
    const row = resultsById.get(caseId);
    if (!row) {
      throw new Error(`Frozen report is missing case ${caseId}.`);
    }
    const artifact = readJson(path.join(runDir, 'artifacts', 'live_lambda', `${caseId}.json`));
    const turns = (artifact.turns ?? []).map((turn) => ({
      turnIndex: turn.turnIndex,
      inputText: turn.input?.text ?? null,
      deliveredText: turn.deliveredText ?? turn.outputText ?? null,
      toolsCalled: turn.trace?.tools_called ?? [],
    }));
    const failedExpectations = [];
    for (const expectation of row.expectationResults ?? []) {
      if (expectation.passed !== false) {
        continue;
      }
      const key = `${caseId}::${expectation.id}`;
      const adjudication = ADJUDICATIONS[key];
      if (!adjudication) {
        throw new Error(`Missing adjudication for failed expectation ${key}.`);
      }
      if (!ALLOWED_CLASSIFICATIONS.has(adjudication.classification)) {
        throw new Error(`Invalid classification for ${key}.`);
      }
      usedKeys.add(key);
      failedExpectations.push({
        id: expectation.id,
        type: expectation.type,
        severity: expectation.severity,
        score: expectation.score ?? null,
        message: expectation.message ?? null,
        classification: adjudication.classification,
        contract: adjudication.contract,
        note: adjudication.note,
      });
    }
    rows.push({
      caseId,
      suite: row.suite,
      status: row.status,
      finalScore: row.finalScore,
      hardGatePassed: row.hardGatePassed,
      totalToolCalls: row.totalToolCalls,
      turns,
      failedExpectations,
      note: CASE_NOTES[caseId] ?? null,
    });
  }
  for (const key of Object.keys(ADJUDICATIONS)) {
    if (!usedKeys.has(key)) {
      throw new Error(`Stale adjudication with no matching failed expectation: ${key}.`);
    }
  }
  const ledger = {
    schemaVersion: 1,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    counts: {
      rows: rows.length,
      passed: rows.filter((row) => row.status === 'passed').length,
      failed: rows.filter((row) => row.status === 'failed').length,
      failedExpectations: rows.reduce((sum, row) => sum + row.failedExpectations.length, 0),
    },
    classifications: [PFE, PH, OF, PA],
    rows,
  };
  const outDir = path.join(root, 'evals', 'ledgers');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${RUN_ID}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Wrote ${rows.length} ledger rows to ${path.relative(root, outPath)}`);
}

main();
