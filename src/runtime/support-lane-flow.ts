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

import type {
  ExtractedInformationRequest,
  PendingInformationRequest,
} from '../core/information';
import type { PlanSnapshot } from '../core/plan';
import type { RouterRoute } from './decisions-router-questions';
import type { PriorReportedPayment } from './support-outcome';

/** Model-reported payment evidence. Facts only, never reply prose. */
export const reportedPaymentSchema = z.object({
  amount: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  method: z.string().nullable(),
  claimed_success: z.boolean(),
});

/**
 * The compose sidecar fields, beside the structured message. Both are
 * required in the model output so the model always states which records the
 * answer relies on and whether it carries a reported payment.
 */
export const supportReplySidecarSchema = z.object({
  cited_order_ids: z.array(z.string()),
  reported_payment: reportedPaymentSchema.nullable(),
});

/** The sidecar the runtime hands back to the turn flow. */
export type SupportReplySidecar = {
  readonly citedOrderIds: readonly string[];
  readonly reportedPayment: PriorReportedPayment | null;
};

/**
 * Deterministic query of the phone-scoped purchase discovery. It names the
 * task, never the answer: the model writes the reply from the records.
 */
export const SUPPORT_LANE_PURCHASE_DISCOVERY_QUERY =
  'Estado de tus compras y regalos.';

/**
 * The router routes that answer from the authorized records. A suppressed
 * acknowledgement and an escalation read nothing: the first delivers
 * nothing and the second hands the thread over.
 */
export const supportLaneRecordRoutes: readonly RouterRoute[] = [
  'answer_with_records',
  'ask_clarification',
  'offer_human',
];

/**
 * The deterministic information requests of a support-lane turn.
 *
 * The pending requests of the plan are the merge base (see
 * `mergeInformationRequests`); this list only adds what the lane reads:
 *
 * - the last-completed replay, so the thread continues on the same task;
 * - the purchase discovery, for a phone-scoped purchase thread on a route
 *   that answers from the records. The discovery carries no order id: it
 *   reads the complete authorized set, and the complete profile reaches the
 *   reply through the customer context.
 *
 * No model-chosen request and no model-extracted customer reference travel
 * here: the guest lane carries no `increment_id`, so a customer code cannot
 * be matched there by construction.
 */
export function supportLaneInformationRequests(args: {
  readonly plan: PlanSnapshot;
  readonly route: RouterRoute;
  readonly purchaseThreadActive: boolean;
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
  if (
    args.purchaseThreadActive &&
    args.phoneScoped &&
    supportLaneRecordRoutes.includes(args.route)
  ) {
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
 * Merge the deterministic requests with the plan's pending requests using
 * the established merge rules. The pending list stays the base, so a live
 * pending request keeps its id, its selector and its request id.
 */
export function mergeSupportLaneRequests(args: {
  readonly pending: readonly PendingInformationRequest[];
  readonly deterministic: readonly ExtractedInformationRequest[];
  readonly merge: (
    pending: PendingInformationRequest[],
    extracted: ExtractedInformationRequest[],
  ) => PendingInformationRequest[];
}): PendingInformationRequest[] {
  return args.merge([...args.pending], [...args.deterministic]);
}

/**
 * Normalize the model-reported sidecar.
 *
 * The sidecar is validated, never trusted: unknown shapes become the neutral
 * sidecar instead of an error, and the message is never touched.
 */
export function supportReplySidecarFromOutput(output: unknown): SupportReplySidecar {
  if (typeof output !== 'object' || output === null) {
    return { citedOrderIds: [], reportedPayment: null };
  }
  const record = output as Record<string, unknown>;
  return {
    citedOrderIds: normalizeCitedOrderIds(record.cited_order_ids),
    reportedPayment: normalizeReportedPayment(record.reported_payment),
  };
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
