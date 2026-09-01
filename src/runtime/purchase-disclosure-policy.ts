import type {
  PendingPaymentValidationExpectation,
  PurchaseInformation,
} from '../core/information';

const physicalItemTypeValues = new Set([
  'physical',
  'physical_product',
  'product',
  'producto',
  'producto_fisico',
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

export function hasPhysicalFulfillment(
  purchase: PurchaseInformation,
): boolean {
  if (purchase.dedication?.sendPhysical === true) {
    return true;
  }

  return purchase.items.some((item) => {
    const itemType = item.type
      ?.trim()
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/[\s-]+/gu, '_');
    return itemType ? physicalItemTypeValues.has(itemType) : false;
  });
}
