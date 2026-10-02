import { describe, expect, it } from 'vitest';

import type { PurchaseInformation } from '../src/core/information';
import { projectPurchaseEvidenceItems } from '../src/runtime/information-orchestrator';

function purchase(overrides: Partial<PurchaseInformation> = {}): PurchaseInformation {
  return {
    orderId: 'ORD-001',
    paymentStatus: 'approved',
    shippingStatus: 'enroute',
    grandTotal: 3173.81,
    paymentMethod: 'Transferencia',
    eventName: 'Baby Shower Catalina',
    eventDate: '2026-09-12',
    eventUrl: null,
    createdAt: '2026-08-22',
    items: [],
    ...overrides,
  };
}

describe('purchase evidence emission', () => {
  it('projects one typed purchaseFact per purchase', () => {
    const [entry] = projectPurchaseEvidenceItems([purchase({
      customerTransactionNumber: 'COD123',
      items: [{
        giftName: 'Sábanas',
        quantity: 1,
        amount: 150,
        rowTotal: 150,
        type: 'se_store',
        fulfillment: { kind: 'physical', chosenBy: null, giftShipmentApplicable: true },
      }],
    })]);

    expect(entry).toMatchObject({
      fileId: '',
      filename: '',
      score: 0,
      purchaseFact: {
        eventLabel: 'Baby Shower Catalina',
        total: 3173.81,
        currency: null,
        currencySymbol: null,
        paymentMethod: 'Transferencia',
        paymentStatus: 'approved',
        shippingStatus: 'enroute',
        eventDate: '2026-09-12',
        createdAt: '2026-08-22',
        referencePresent: true,
        items: [{
          name: 'Sábanas',
          quantity: 1,
          amount: 150,
          rowTotal: 150,
          fulfillment: 'physical',
        }],
      },
    });
    expect(entry?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps public dedications and redacts private dedication messages', () => {
    const [pub, priv] = projectPurchaseEvidenceItems([
      purchase({ dedication: { message: 'Felicidades', isPrivate: false, sendPhysical: true, physicalStatus: 'preparing' } }),
      purchase({ orderId: 'ORD-002', dedication: { message: 'Secreto', isPrivate: true, sendPhysical: false, physicalStatus: null } }),
    ]);

    expect(pub?.purchaseFact?.dedication).toEqual({
      message: 'Felicidades',
      sendPhysical: true,
      physicalStatus: 'preparing',
    });
    expect(priv?.purchaseFact?.dedication).toEqual({
      message: null,
      sendPhysical: false,
      physicalStatus: null,
    });
  });

  it('returns no evidence without purchases', () => {
    expect(projectPurchaseEvidenceItems([])).toEqual([]);
  });

  it('hashes stably per order identity', () => {
    const [first, repeat] = projectPurchaseEvidenceItems([purchase(), purchase()]);
    const [other] = projectPurchaseEvidenceItems([purchase({ orderId: 'ORD-002' })]);
    expect(first?.contentHash).toBe(repeat?.contentHash);
    expect(first?.contentHash).not.toBe(other?.contentHash);
  });
});
