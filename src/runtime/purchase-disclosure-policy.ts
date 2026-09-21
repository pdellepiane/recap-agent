import type {
  HostCreditFulfillmentPolicy,
  PendingPaymentValidationExpectation,
  PurchaseInformation,
  PurchaseItem,
  PurchaseItemFulfillment,
} from '../core/information';

const physicalItemTypeValues = new Set([
  'physical',
  'physical_product',
  'product',
  'producto',
  'producto_fisico',
  // Backend gift-store code: a physical gift that ships.
  'se_store',
]);

export function pendingPaymentValidationExpectation(
  purchase: PurchaseInformation,
): PendingPaymentValidationExpectation | null {
  if (purchase.paymentStatus?.trim().toLocaleLowerCase('en') !== 'pending') return null;
  const method = `${purchase.paymentMethod ?? ''} ${purchase.payment?.method ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en');
  if (!method) return null;
  if (method.includes('card') || method.includes('tarjeta') || method.includes('visa') ||
    method.includes('mastercard') || method.includes('niubiz') || method.includes('payu')) {
    return null;
  }
  // This is deliberately allow-listed to the methods covered by the indexed
  // validation article. An unknown method must not inherit a generic window.
  const indexedMethod = method.includes('transfer') || method.includes('yape') ||
    method.includes('plin') || method.includes('paypal');
  if (!indexedMethod) return null;
  return { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' };
}

function normalizeItemType(rawType: string | null | undefined): string | null {
  const normalized = rawType
    ?.trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[\s-]+/gu, '_');
  return normalized && normalized.length > 0 ? normalized : null;
}

/**
 * Single pure per-item fulfillment mapper. Classification is per item from
 * the explicit backend enum only; gift names never imply a type.
 *
 * - se_store and the observed physical aliases map to physical/null/true.
 * - credit maps to host_credit/host/false: the hosts chose account credit,
 *   so no gift shipment applies. This is a host choice, not proof that any
 *   payment posted.
 * - Unrecognized, missing or blank codes map to unknown/null/null: unknown
 *   fulfillment, never silently credit or physical.
 *
 * No fact named credited=true is derived from type. A physical-sounding
 * name with credit stays credit; a physical item stays physical even when
 * shippingStatus is null.
 */
export function mapItemFulfillment(
  rawType: string | null | undefined,
): PurchaseItemFulfillment {
  const itemType = normalizeItemType(rawType);
  if (itemType === 'credit') {
    return { kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false };
  }
  if (itemType !== null && physicalItemTypeValues.has(itemType)) {
    return { kind: 'physical', chosenBy: null, giftShipmentApplicable: true };
  }
  return { kind: 'unknown', chosenBy: null, giftShipmentApplicable: null };
}

/**
 * Derives the scoped host-credit policy from nonconflicting item evidence:
 * present only when at least one item maps to host_credit. A conflicted
 * order (no authoritative list) must not carry an order-wide assertion, so
 * callers pass the canonical list or nothing.
 */
export function creditFulfillmentPolicyForItems(
  items: readonly PurchaseItem[],
): HostCreditFulfillmentPolicy | undefined {
  const hasHostCredit = items.some(
    (item) => mapItemFulfillment(item.type).kind === 'host_credit',
  );
  return hasHostCredit
    ? { chosenBy: 'host', mechanism: 'host_account_credit' }
    : undefined;
}

export function hasPhysicalFulfillment(
  purchase: PurchaseInformation,
): boolean {
  if (purchase.dedication?.sendPhysical === true) {
    return true;
  }

  return purchase.items.some(
    (item) => mapItemFulfillment(item.type).kind === 'physical',
  );
}
