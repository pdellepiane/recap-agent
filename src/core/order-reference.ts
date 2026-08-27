export type ParsedOrderReference =
  | {
      kind: 'customer_transaction';
      transactionNumber: string;
    }
  | {
      kind: 'backend_order_id';
      orderId: string;
    };

/**
 * Parses an order reference after the conversational extractor has already
 * classified the turn as a purchase request. Customer-facing transaction
 * codes use COD plus digits, while the Agent API currently filters by its
 * opaque internal order id.
 */
export function parseOrderReference(value: string | null | undefined): ParsedOrderReference | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const customerMatch = /^(?:COD[\s_-]*)?(\d+)$/iu.exec(trimmed);
  const transactionNumber = customerMatch?.[1];
  if (transactionNumber) {
    return {
      kind: 'customer_transaction',
      transactionNumber,
    };
  }
  return {
    kind: 'backend_order_id',
    orderId: trimmed,
  };
}

export function normalizeExtractedOrderReference(
  value: string | null | undefined,
): string | null {
  const parsed = parseOrderReference(value);
  if (!parsed) {
    return null;
  }
  return parsed.kind === 'customer_transaction'
    ? parsed.transactionNumber
    : parsed.orderId;
}

export function normalizeBackendCustomerTransactionNumber(
  value: string | number | null | undefined,
): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  const parsed = parseOrderReference(value);
  return parsed?.kind === 'customer_transaction'
    ? parsed.transactionNumber
    : null;
}
