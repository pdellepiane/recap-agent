import type { PurchaseInformation } from '../core/information';

const physicalItemTypeValues = new Set([
  'physical',
  'physical_product',
  'product',
  'producto',
  'producto_fisico',
]);

export function canDisclosePaymentDestination(
  purchase: PurchaseInformation,
): boolean {
  return purchase.paymentStatus?.trim().toLocaleLowerCase('en') === 'pending';
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
