import { describe, expect, it } from 'vitest';

import { projectCompletedPurchaseForModel } from '../src/runtime/purchase-reply-projector';

describe('F4 reported pending order evidence', () => {
  it('keeps the registry total and user report as separate model facts', () => {
    const result = {
      requestId: 'purchase-f4',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [{
        orderId: 'order-f4',
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: 63.85,
        paymentMethod: 'Transferencia',
        eventName: 'Isa and Lu',
        eventDate: '2026-09-20',
        eventUrl: null,
        createdAt: '2026-09-03 09:00:00',
        items: [],
      }],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
    } as never;
    const evidence = projectCompletedPurchaseForModel(result, {
      requestedAspects: ['summary', 'payment_status'],
      referenceAuthorized: false,
      userReported: { amount: 3.85 },
    });
    expect(evidence).toMatchObject({
      outcome_kind: 'order_unique',
      permitted_next_action: 'await_validation',
      outcome: {
        recordType: 'order',
        order: {
          paymentStatus: 'pending',
          amount: { total: 63.85 },
          amountMismatch: { reported: 3.85, recorded: 63.85 },
        },
      },
    });
  });
});
