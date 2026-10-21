/**
 * WP2 — support outcome signature and repeat counter.
 *
 * One purchase turn leaves one signature. The signature hashes the tuple
 * (result kind, status, sorted order ids, payment statuses, reference
 * resolution, coverage) over a canonical JSON string, so two turns that
 * produced the same money evidence share a signature and any change in that
 * evidence breaks it.
 *
 * The three unresolved money shapes proven by the WP0 turn table are explicit
 * result kinds, never inferred from message text: a customer reference that
 * matches no record, an empty purchase read on a turn that carried a receipt
 * image or media, and a declined record while the guest reported a successful
 * payment. The reported payment is an explicit typed input supplied by the
 * caller.
 */
import crypto from 'node:crypto';

import type { CustomerContextSnapshot } from './customer-context';

/**
 * Result kind of one purchase turn.
 *
 * - `resolved`: the money evidence of the turn is consistent.
 * - `reference_unavailable`: a customer reference matched no record.
 * - `empty_read_with_receipt`: the purchase read returned nothing on a turn
 *   that carried a receipt image or media.
 * - `declined_vs_reported_success`: the record says declined while the guest
 *   reported a successful payment.
 * - `no_purchase_evidence`: the turn carried no purchase evidence at all.
 */
export const supportOutcomeResultKinds = [
  'resolved',
  'reference_unavailable',
  'empty_read_with_receipt',
  'declined_vs_reported_success',
  'no_purchase_evidence',
] as const;

export type SupportOutcomeResultKind = (typeof supportOutcomeResultKinds)[number];

/** Result kinds whose money evidence stays unresolved. */
export const unresolvedSupportOutcomeResultKinds = [
  'reference_unavailable',
  'empty_read_with_receipt',
  'declined_vs_reported_success',
] as const;

export type UnresolvedSupportOutcomeResultKind =
  (typeof unresolvedSupportOutcomeResultKinds)[number];

/**
 * Payment the guest reported for this turn. Supplied by the caller as typed
 * evidence; the runtime never detects it from the message text.
 */
export type PriorReportedPayment = {
  readonly amount: number | null;
  readonly currency: string | null;
  readonly method: string | null;
  readonly claimedSuccess: boolean;
};

/** How a customer reference resolved on this turn. */
export type SupportReferenceResolution = 'matched' | 'unavailable' | 'none';

/** The hashed tuple. Every component is a fact, never an interpretation. */
export type SupportOutcomeComponents = {
  readonly resultKind: SupportOutcomeResultKind;
  readonly status: string;
  readonly orderIds: readonly string[];
  readonly paymentStatuses: readonly string[];
  readonly referenceResolution: SupportReferenceResolution;
  readonly coverage: string;
};

export type SupportOutcomeSignature = {
  /** Short, stable hex digest of the canonical component tuple. */
  readonly signature: string;
  /** True when the money evidence of the turn stayed unresolved. */
  readonly unresolvedMoney: boolean;
  readonly components: SupportOutcomeComponents;
};

/** Short stable hex prefix of the sha256 digest. */
const SIGNATURE_HEX_LENGTH = 16;

export function isUnresolvedSupportOutcome(kind: SupportOutcomeResultKind): boolean {
  return (unresolvedSupportOutcomeResultKinds as readonly string[]).includes(kind);
}

/**
 * Classify the result kind of a purchase turn from typed facts only.
 *
 * Precedence: the money conflict first (a declined record against a reported
 * successful payment), then an unmatchable customer reference, then an empty
 * read on a turn that carried a receipt, then a turn with no purchase
 * evidence, and finally a resolved turn.
 */
export function classifySupportOutcomeResultKind(args: {
  readonly orderIds: readonly string[];
  readonly paymentStatuses: readonly string[];
  readonly referenceResolution: SupportReferenceResolution;
  readonly turnCarriedReceiptMedia: boolean;
  readonly priorReportedPayment: PriorReportedPayment | null;
}): SupportOutcomeResultKind {
  const declined = args.paymentStatuses.some(
    (status) => status.trim().toLowerCase() === 'declined',
  );
  if (declined && args.priorReportedPayment?.claimedSuccess === true) {
    return 'declined_vs_reported_success';
  }
  if (args.referenceResolution === 'unavailable') {
    return 'reference_unavailable';
  }
  if (args.orderIds.length === 0) {
    return args.turnCarriedReceiptMedia
      ? 'empty_read_with_receipt'
      : 'no_purchase_evidence';
  }
  return 'resolved';
}

/**
 * Components of a purchase turn, read from the canonical customer-context
 * snapshot.
 *
 * `referenceResolution` is not part of the snapshot: the caller supplies the
 * resolution reported by the purchase request. `coverage` is the projection
 * completeness plus the per-source coverage statuses.
 */
export function supportOutcomeComponentsFromSnapshot(args: {
  readonly snapshot: CustomerContextSnapshot;
  readonly referenceResolution: SupportReferenceResolution;
  readonly turnCarriedReceiptMedia: boolean;
  readonly priorReportedPayment: PriorReportedPayment | null;
}): SupportOutcomeComponents {
  const purchases = args.snapshot.purchasesCarts.purchases;
  const orderIds = purchases.map((purchase) => purchase.orderId);
  const paymentStatuses = purchases.map(
    (purchase) => purchase.paymentStatus ?? 'unknown',
  );
  return {
    resultKind: classifySupportOutcomeResultKind({
      orderIds,
      paymentStatuses,
      referenceResolution: args.referenceResolution,
      turnCarriedReceiptMedia: args.turnCarriedReceiptMedia,
      priorReportedPayment: args.priorReportedPayment,
    }),
    status: args.snapshot.purchasesCarts.status,
    orderIds: [...orderIds].sort(),
    paymentStatuses: [...paymentStatuses].sort(),
    referenceResolution: args.referenceResolution,
    coverage: coverageKey(args.snapshot),
  };
}

/** Hash the component tuple into a short, stable signature. */
export function computeSupportOutcomeSignature(
  components: SupportOutcomeComponents,
): SupportOutcomeSignature {
  const canonical = JSON.stringify([
    components.resultKind,
    components.status,
    [...components.orderIds].sort(),
    [...components.paymentStatuses].sort(),
    components.referenceResolution,
    components.coverage,
  ]);
  return {
    signature: crypto
      .createHash('sha256')
      .update(canonical, 'utf8')
      .digest('hex')
      .slice(0, SIGNATURE_HEX_LENGTH),
    unresolvedMoney: isUnresolvedSupportOutcome(components.resultKind),
    components,
  };
}

/**
 * Prior-turn limitation memory. Resolved facts must never be suppressed by
 * this unresolved-money-only gate, even when their signatures repeat.
 */
export function deriveSupportLimitationMemory(args: {
  readonly priorSignature: string | null;
  readonly priorRepeatCount: number;
  readonly signature: SupportOutcomeSignature;
}): { limitationAlreadyStated: boolean; priorLimitationTurns: number } {
  const sameSignature = args.priorSignature !== null &&
    args.priorSignature === args.signature.signature;
  const limitationAlreadyStated = sameSignature && args.signature.unresolvedMoney;
  return {
    limitationAlreadyStated,
    priorLimitationTurns: limitationAlreadyStated ? args.priorRepeatCount : 0,
  };
}

/**
 * The caller computes the incoming count before merging. The same signature
 * grows the streak; a different signature restarts it at one.
 */
export function nextSupportOutcomeRepeatCount(args: {
  readonly currentSignature: string | null;
  readonly currentRepeatCount: number;
  readonly nextSignature: string | null;
}): number {
  if (args.nextSignature === null) {
    return Math.max(0, args.currentRepeatCount);
  }
  if (args.currentSignature !== null && args.currentSignature === args.nextSignature) {
    return Math.max(0, args.currentRepeatCount) + 1;
  }
  return 1;
}

function coverageKey(snapshot: CustomerContextSnapshot): string {
  const completeness = snapshot.purchasesCarts.completeness ?? 'unknown';
  const sourceCoverage = (snapshot.purchasesCarts.sourceCoverage ?? [])
    .map((entry) => `${entry.source}:${entry.status}:${entry.count}`)
    .sort()
    .join(',');
  return sourceCoverage.length > 0
    ? `${completeness}|${sourceCoverage}`
    : completeness;
}
