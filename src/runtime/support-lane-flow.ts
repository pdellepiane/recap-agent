/**
 * WP3 — the deterministic support-lane inputs.
 *
 * On the customer-assistance lane the extractor does not run, so the
 * information requests are built from typed state: the plan's pending
 * requests, the last completed request and the phone-scoped purchase thread.
 * The composer also emits a sidecar beside the message: the order ids the
 * answer relies on and the payment the guest reported.
 *
 * The sidecar is evidence, never prose. It never rewrites the message, it
 * never blocks the delivery and it is validated against the authorized
 * profile before it is used.
 */
import { z } from 'zod';

import type { ExtractedInformationRequest, InformationTaskResult } from '../core/information';
import type { PlanSnapshot } from '../core/plan';
import type { RouterRoute } from './decisions-router-questions';
import { checkReplyNarrativeClaims } from './reply-evidence-projector';
import type { PriorReportedPayment } from './support-outcome';

/** An empty associated-event lookup can be answered with public search guidance.
 * Keep its source status intact: this is not a found event or an outage recovery.
 */
export function isPublicEventSearchMiss(result: InformationTaskResult): boolean {
  return result.kind === 'associated_event' && result.status === 'failed' &&
    result.failureKind === 'not_found';
}

/**
 * The payment the client reported, as the model states it.
 *
 * The description binds the field to the customer's claim: the record's own
 * payment never belongs here.
 */
export const reportedPaymentSchema = z.object({
  amount: z.number().nonnegative().nullable().describe(
    'The amount the client reported, in the currency the client used. Null when the client named no amount.',
  ),
  currency: z.string().nullable().describe(
    'The currency of the reported amount, as the client stated it. Null when unknown.',
  ),
  method: z.string().nullable().describe(
    'The payment method the client reported (for example a wallet or a transfer). Null when the client named no method.',
  ),
  claimed_success: z.boolean().describe(
    'True when the client stated that the payment succeeded. False when the client reported a pending, failed or uncertain payment.',
  ),
});

/**
 * The compose sidecar fields, beside the structured message. All three are
 * required in the model output so the model always states which records the
 * answer relies on, whether it carries a reported payment and whether it
 * claims a registered human handoff.
 *
 * The descriptions are the contract the model reads. They bind the payment
 * field to the CUSTOMER's claim, never to the record's own payment: a
 * backend payment reported as the customer's claim would manufacture a
 * "declined against a reported success" conflict that never happened.
 */
export const supportReplySidecarSchema = z.object({
  cited_order_ids: z.array(z.string()).describe(
    'The order ids this answer relies on, copied verbatim from the order ids of the authorized profile. Empty when the answer relies on no order.',
  ),
  reported_payment: reportedPaymentSchema.nullable().describe(
    'The payment the CLIENT reported in this turn (for example a transfer the client says they made). This is NOT the payment of the record in the profile. Null when the client reported no payment.',
  ),
  request_outcome: z.enum(['answered', 'needs_input', 'unresolved', 'withdrawn']).describe(
    'Outcome of THIS request after the actual evidence and this reply: answered only when the reply fully answers it, including public-search guidance after an associated-event not_found; needs_input when one missing customer datum blocks it; unresolved when reconciliation or an unexecuted operation remains; withdrawn only when the customer explicitly withdrew it. A public FAQ answer or event fact is independent of other requests money.',
  ),
  financial_reconciliation_required: z.boolean().describe(
    'True only when THIS request disputes a payment, amount, missing transfer or balance requiring reconciliation. Pending status alone is not a dispute. Other purchases do not make this request disputed.',
  ),
  claimed_handoff: z.boolean().describe(
    'True only when the reply states that a human handoff or a manual review was registered. False when no such success is claimed.',
  ),
});

/** The sidecar the runtime hands back to the turn flow. */
export type SupportReplySidecar = {
  readonly citedOrderIds: readonly string[];
  readonly reportedPayment: PriorReportedPayment | null;
  /**
   * The model's own claim that the turn registered a human handoff or a
   * manual review. A claim needs an in-turn gateway success receipt; the
   * claim is never taken on trust.
   */
  readonly claimedHandoff: boolean;
  readonly requestOutcome: 'answered' | 'needs_input' | 'unresolved' | 'withdrawn';
  readonly financialReconciliationRequired: boolean;
};

/**
 * WP3 — the deterministic lane gate.
 *
 * The Decisions router owns the customer-assistance lane only. A turn that
 * carries an in-flight obligation outside that lane (an established
 * planning thread, an active RSVP state, a pending authentication flow)
 * flows exactly as today: the classifier preflight and the extractor own
 * it. The gate reads typed plan state only — never the customer message.
 *
 * A fresh plan with no obligation is a customer-assistance turn, so the
 * customer-assistance conversations reach the router.
 */
export function isCustomerAssistanceTurn(plan: PlanSnapshot): boolean {
  if (hasPlanningObligation(plan)) return false;
  if (hasRsvpObligation(plan)) return false;
  if (hasAuthenticationObligation(plan)) return false;
  return true;
}

/** An established planning thread: providers, a need or open missing fields. */
function hasPlanningObligation(plan: PlanSnapshot): boolean {
  return plan.provider_needs.length > 0 ||
    plan.active_need_category !== null ||
    plan.recommended_providers.length > 0 ||
    plan.selected_provider_ids.length > 0 ||
    plan.missing_fields.length > 0 ||
    plan.event_type !== null ||
    plan.vendor_category !== null;
}

/** An RSVP obligation: the thread is resolving an attendance. */
function hasRsvpObligation(plan: PlanSnapshot): boolean {
  return plan.rsvp_state.status !== 'none' ||
    plan.rsvp_state.pending_action !== null;
}

/** A pending authentication flow: the thread is waiting for a credential. */
function hasAuthenticationObligation(plan: PlanSnapshot): boolean {
  return plan.user_auth.status === 'code_requested' ||
    plan.user_auth.status === 'failed' ||
    plan.user_auth.status === 'email_not_found' ||
    plan.user_auth.awaiting_phone_confirmation;
}

/**
 * WP3 — the deterministic query of the phone-scoped purchase discovery. It
 * names the task, never the answer: the model writes the reply from the
 * records.
 */
export const SUPPORT_LANE_PURCHASE_DISCOVERY_QUERY =
  'Estado de tus compras y regalos.';

/**
 * The router routes that answer from the authorized records. A suppressed
 * acknowledgement and an escalation read nothing: the first delivers
 * nothing and the second hands the thread over. A clarification reads
 * nothing either: the complete profile already reaches the reply, and a
 * purchase-specific read would turn the clarification into a purchase
 * answer.
 */
export const supportLaneRecordRoutes: readonly RouterRoute[] = [
  'answer_with_records',
  'offer_human',
];

/**
 * The deterministic information requests of a support-lane turn.
 *
 * The pending requests of the plan are the merge base (see
 * `mergeInformationRequests`); this list only adds what the lane reads:
 *
 * - the last-completed replay, so the thread continues on the same task;
 * - the purchase discovery, for a phone-scoped turn on a route that answers
 *   from the records. The discovery carries no order id: it reads the
 *   complete authorized set, and the complete profile reaches the reply
 *   through the customer context. The discovery is NOT gated on a prior
 *   purchase thread: the router already decided the turn is answered from
 *   the records, and the read outcome must reach the turn's evidence even
 *   when the backend holds no purchase at all.
 *
 * No model-chosen request and no model-extracted customer reference travel
 * here: the guest lane carries no `increment_id`, so a customer code cannot
 * be matched there by construction.
 */
export function supportLaneInformationRequests(args: {
  readonly plan: PlanSnapshot;
  readonly route: RouterRoute;
  readonly phoneScoped: boolean;
}): ExtractedInformationRequest[] {
  const requests: ExtractedInformationRequest[] = [];
  const lastCompleted = args.plan.information_state.last_completed_request;
  if (lastCompleted?.kind === 'purchase') {
    // Thread replay without an id filter and without an auth continuation:
    // the discovery below reads the complete authorized set.
    requests.push({ ...lastCompleted, orderId: null, authAction: 'none' });
  }
  if (lastCompleted?.kind === 'associated_event') {
    requests.push({ ...lastCompleted, authAction: 'none' });
  }
  if (args.phoneScoped && supportLaneRecordRoutes.includes(args.route)) {
    requests.push({
      kind: 'purchase',
      resource: 'purchase_discovery',
      query: SUPPORT_LANE_PURCHASE_DISCOVERY_QUERY,
      orderId: null,
      authAction: 'none',
    });
  }
  return requests;
}

/**
 * Normalize the model-reported sidecar.
 *
 * The sidecar is validated, never trusted: unknown shapes become the neutral
 * sidecar instead of an error, and the message is never touched.
 */
export function supportReplySidecarFromOutput(output: unknown): SupportReplySidecar {
  if (typeof output !== 'object' || output === null) {
    return { citedOrderIds: [], reportedPayment: null, claimedHandoff: false, requestOutcome: 'unresolved', financialReconciliationRequired: false };
  }
  const record = output as Record<string, unknown>;
  return {
    citedOrderIds: normalizeCitedOrderIds(record.cited_order_ids),
    reportedPayment: normalizeReportedPayment(record.reported_payment),
    claimedHandoff: record.claimed_handoff === true,
    requestOutcome: record.request_outcome === 'answered' || record.request_outcome === 'needs_input' || record.request_outcome === 'withdrawn'
      ? record.request_outcome : 'unresolved',
    financialReconciliationRequired: record.financial_reconciliation_required === true,
  };
}

/**
 * The operation a support-lane success claim is about: the human handoff
 * (and the manual review it stands for).
 */
export const SUPPORT_LANE_HANDOFF_OPERATION = 'human.takeover.write';

/**
 * WP5 — the claim gate of a support-lane reply.
 *
 * A claim of a successful human handoff (or of a manual review standing for
 * one) needs an in-turn gateway success receipt AND an allowed operation.
 * The claim is checked, never taken on trust: the reply prose is the model's,
 * but the effect it may assert is the runtime's.
 */
export function checkSupportLaneHandoffClaim(args: {
  readonly claimedHandoff: boolean;
  readonly receiptPresent: boolean;
  readonly operationAllowed: boolean;
}): 'ok' | 'fallback' {
  return checkReplyNarrativeClaims([{
    operation: SUPPORT_LANE_HANDOFF_OPERATION,
    claimsSuccess: args.claimedHandoff,
    receiptPresent: args.receiptPresent,
    operationAllowed: args.operationAllowed,
  }]);
}

/**
 * Keep only the cited order ids that belong to the authorized profile.
 *
 * A violation is DROPPED: the surviving ids are the intersection with the
 * profile set. The ids never rewrite the message and never block it.
 */
export function validateCitedOrderIds(args: {
  readonly cited: readonly string[];
  readonly profileOrderIds: readonly string[];
}): {
  readonly citedOrderIds: readonly string[];
  readonly droppedOrderIds: readonly string[];
} {
  const profile = new Set(args.profileOrderIds);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of args.cited) {
    if (profile.has(id)) {
      if (!kept.includes(id)) {
        kept.push(id);
      }
      continue;
    }
    if (!dropped.includes(id)) {
      dropped.push(id);
    }
  }
  return { citedOrderIds: kept, droppedOrderIds: dropped };
}

function normalizeCitedOrderIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0 || ids.includes(trimmed)) {
      continue;
    }
    ids.push(trimmed);
  }
  return ids;
}

function normalizeReportedPayment(value: unknown): PriorReportedPayment | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const amount = typeof record.amount === 'number' && Number.isFinite(record.amount)
    ? record.amount
    : null;
  const currency = typeof record.currency === 'string' && record.currency.trim().length > 0
    ? record.currency.trim()
    : null;
  const method = typeof record.method === 'string' && record.method.trim().length > 0
    ? record.method.trim()
    : null;
  const claimedSuccess = record.claimed_success === true;
  if (amount === null && currency === null && method === null && !claimedSuccess) {
    return null;
  }
  return { amount, currency, method, claimedSuccess };
}
