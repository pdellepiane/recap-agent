import type {
  CartInformation,
  InformationTaskResult,
  PurchaseInformation,
  PurchasePartition,
} from '../core/information';

export type PurchaseRecordSource = 'orders' | 'gift_purchases' | 'event';

export type FieldProvenance = {
  source: PurchaseRecordSource;
  partition: PurchasePartition;
};

export type ReconcileOutcome =
  | {
    status: 'ok';
    orderId: string;
    canonical: PurchaseInformation;
    provenance: Record<string, FieldProvenance>;
    conflictingFields: [];
  }
  | {
    status: 'conflict';
    orderId: string;
    canonical: PurchaseInformation;
    provenance: Record<string, FieldProvenance>;
    conflictingFields: string[];
  };

const COMPARED_FIELDS = [
  'paymentStatus',
  'customerTransactionNumber',
  'shippingStatus',
  'grandTotal',
  'paymentMethod',
  'eventName',
  'eventDate',
  'createdAt',
] as const;

type ComparedField = (typeof COMPARED_FIELDS)[number];

function fieldValue(record: PurchaseInformation, field: ComparedField): unknown {
  switch (field) {
    case 'paymentStatus':
      return record.paymentStatus;
    case 'customerTransactionNumber':
      return record.customerTransactionNumber ?? null;
    case 'shippingStatus':
      return record.shippingStatus;
    case 'grandTotal':
      return record.grandTotal;
    case 'paymentMethod':
      return record.paymentMethod;
    case 'eventName':
      return record.eventName;
    case 'eventDate':
      return record.eventDate;
    case 'createdAt':
      return record.createdAt;
    default:
      return null;
  }
}

function isAuthoritative(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function valuesDiffer(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function detectConflictingFields(
  left: PurchaseInformation,
  right: PurchaseInformation,
): string[] {
  const conflicts: string[] = [];
  for (const field of COMPARED_FIELDS) {
    const leftValue = fieldValue(left, field);
    const rightValue = fieldValue(right, field);
    if (isAuthoritative(leftValue) && isAuthoritative(rightValue) && valuesDiffer(leftValue, rightValue)) {
      conflicts.push(field);
    }
  }
  const leftItems = left.items.length > 0 ? left.items : null;
  const rightItems = right.items.length > 0 ? right.items : null;
  if (isAuthoritative(leftItems) && isAuthoritative(rightItems) && valuesDiffer(leftItems, rightItems)) {
    conflicts.push('items');
  }
  return conflicts;
}

const SOURCE_PRIORITY: Record<PurchaseRecordSource, number> = {
  orders: 0,
  event: 1,
  gift_purchases: 2,
};

function mergeAgreeingRecords(
  preferred: PurchaseInformation,
  fallback: PurchaseInformation,
): PurchaseInformation {
  return {
    ...fallback,
    ...preferred,
    eventId: preferred.eventId ?? fallback.eventId ?? null,
    currency: preferred.currency ?? fallback.currency ?? null,
    paymentStatus: preferred.paymentStatus ?? fallback.paymentStatus,
    customerTransactionNumber:
      preferred.customerTransactionNumber ?? fallback.customerTransactionNumber,
    shippingStatus: preferred.shippingStatus ?? fallback.shippingStatus,
    grandTotal: preferred.grandTotal ?? fallback.grandTotal,
    paymentMethod: preferred.paymentMethod ?? fallback.paymentMethod,
    eventName: preferred.eventName ?? fallback.eventName,
    eventDate: preferred.eventDate ?? fallback.eventDate,
    eventUrl: preferred.eventUrl ?? fallback.eventUrl,
    createdAt: preferred.createdAt ?? fallback.createdAt,
    items: preferred.items.length > 0 ? preferred.items : fallback.items,
    payment: preferred.payment ?? fallback.payment,
    paymentValidationExpectation:
      preferred.paymentValidationExpectation ?? fallback.paymentValidationExpectation ?? null,
    declineCode: preferred.declineCode ?? fallback.declineCode,
    adminComment: preferred.adminComment ?? fallback.adminComment,
    dedication: preferred.dedication ?? fallback.dedication,
    thanks: preferred.thanks ?? fallback.thanks,
    isThanked: preferred.isThanked ?? fallback.isThanked,
  };
}

function provenanceFor(
  canonical: PurchaseInformation,
  preferredSource: PurchaseRecordSource,
  preferredPartition: PurchasePartition,
  fallbackSource: PurchaseRecordSource,
  fallbackPartition: PurchasePartition,
  preferred: PurchaseInformation,
): Record<string, FieldProvenance> {
  const provenance: Record<string, FieldProvenance> = {};
  const pick = (field: ComparedField): FieldProvenance => {
    const preferredValue = fieldValue(preferred, field);
    if (isAuthoritative(preferredValue)) {
      return { source: preferredSource, partition: preferredPartition };
    }
    return { source: fallbackSource, partition: fallbackPartition };
  };
  for (const field of COMPARED_FIELDS) {
    provenance[field] = pick(field);
  }
  provenance['orderId'] = { source: preferredSource, partition: preferredPartition };
  provenance['partition'] = { source: preferredSource, partition: canonical.partition ?? preferredPartition };
  return provenance;
}

export function reconcileTwoRecords(
  current: PurchaseInformation,
  currentSource: PurchaseRecordSource,
  currentPartition: PurchasePartition,
  incoming: PurchaseInformation,
  incomingSource: PurchaseRecordSource,
  incomingPartition: PurchasePartition,
): ReconcileOutcome {
  const conflictingFields = detectConflictingFields(current, incoming);
  const incomingWins = SOURCE_PRIORITY[incomingSource] >= SOURCE_PRIORITY[currentSource];
  const preferred = incomingWins ? incoming : current;
  const fallback = incomingWins ? current : incoming;
  const preferredSource = incomingWins ? incomingSource : currentSource;
  const fallbackSource = incomingWins ? currentSource : incomingSource;
  const preferredPartition = incomingWins ? incomingPartition : currentPartition;
  const fallbackPartition = incomingWins ? currentPartition : incomingPartition;
  if (conflictingFields.length === 0) {
    const canonical = mergeAgreeingRecords(preferred, fallback);
    return {
      status: 'ok',
      orderId: incoming.orderId,
      canonical,
      provenance: provenanceFor(canonical, preferredSource, preferredPartition, fallbackSource, fallbackPartition, preferred),
      conflictingFields: [],
    };
  }
  const merged = mergeAgreeingRecords(preferred, fallback);
  const nulled: PurchaseInformation = { ...merged };
  for (const field of conflictingFields) {
    if (field === 'paymentStatus') nulled.paymentStatus = null;
    if (field === 'grandTotal') nulled.grandTotal = null;
    if (field === 'paymentMethod') nulled.paymentMethod = null;
    if (field === 'customerTransactionNumber') nulled.customerTransactionNumber = null;
    if (field === 'shippingStatus') nulled.shippingStatus = null;
    if (field === 'eventName') nulled.eventName = null;
    if (field === 'eventDate') nulled.eventDate = null;
    if (field === 'createdAt') nulled.createdAt = null;
    if (field === 'items') nulled.items = [];
  }
  if (conflictingFields.includes('paymentStatus') || conflictingFields.includes('grandTotal')) {
    nulled.amountDisclosure = null;
  }
  return {
    status: 'conflict',
    orderId: incoming.orderId,
    canonical: nulled,
    provenance: provenanceFor(nulled, preferredSource, preferredPartition, fallbackSource, fallbackPartition, preferred),
    conflictingFields,
  };
}

export function partitionHasConflict(
  pending: PurchaseInformation[],
  completed: PurchaseInformation[],
): Set<string> {
  const pendingIds = new Set(pending.map((purchase) => purchase.orderId));
  const conflicts = new Set<string>();
  for (const purchase of completed) {
    if (pendingIds.has(purchase.orderId)) {
      conflicts.add(purchase.orderId);
    }
  }
  return conflicts;
}

export function selectPurchaseRecords(
  purchases: PurchaseInformation[],
): { purchases: PurchaseInformation[]; needsSelection: boolean } {
  return { purchases, needsSelection: purchases.length > 1 };
}

export function selectCartRecords(
  carts: CartInformation[],
): { carts: CartInformation[] } {
  return { carts };
}

export function isReportedSettlementEvidence(value: unknown): boolean {
  void value;
  return false;
}

/**
 * Shared approval-boundary predicate: single owner of the receipt-amount ≠
 * approval rule. A status_or_proof_review ambiguity asks which of two
 * invented tasks was intended, but the established record already settles
 * it: a completed purchase outcome (even an empty one) shows whether any
 * purchase stands approved, and a visible receipt alone never proves
 * approval. A scoped attempted read that found nothing settles it when
 * retained receipt context is present; when no purchase read executed at
 * all, the established receipt boundary still settles it — the reply
 * answers from receipt guidance instead of asking which task was meant.
 * Typed evidence only; the ambiguity questionKey guard stays at the call
 * sites in agent-service and openai-agent-runtime.
 */
export function isApprovalBoundaryAnsweredByRecord(args: {
  informationResults: readonly InformationTaskResult[];
  receiptContext: boolean;
}): boolean {
  const purchaseResults = args.informationResults.filter(
    (result): result is InformationTaskResult & { kind: 'purchase' } =>
      result.kind === 'purchase',
  );
  if (purchaseResults.some((result) => result.status === 'completed')) {
    return true;
  }
  if (!args.receiptContext) {
    return false;
  }
  if (purchaseResults.length === 0) {
    return true;
  }
  return purchaseResults.some(
    (result) =>
      result.status === 'failed' &&
      result.failureKind === 'not_found' &&
      (result.accessMethod === 'trusted_phone_purchase' ||
        result.accessMethod === 'trusted_phone_guest'),
  );
}

export function preserveServerTimestamp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

export function resolveTransactionReference(
  purchase: PurchaseInformation,
  accessAuthorized: boolean,
): string | null {
  if (!accessAuthorized) return null;
  const reference = purchase.customerTransactionNumber?.trim();
  return reference ? reference : null;
}

export function resolveAgainstStaleNote(
  backend: PurchaseInformation,
  staleNote: unknown,
): PurchaseInformation {
  void staleNote;
  return backend;
}
