import { describe, expect, it } from 'vitest';

import type {
  CartInformation,
  PurchaseAspect,
  PurchaseInformation,
} from '../src/core/information';
import {
  projectCompletedPurchaseForModel,
  projectPurchaseBalanceLimitation,
  projectPurchaseReplyForModel,
  selectPurchaseReplyOutcome,
} from '../src/runtime/purchase-reply-projector';

function order(overrides: Partial<PurchaseInformation> = {}): PurchaseInformation {
  return {
    orderId: 'order-alex-pending-250',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 250,
    paymentMethod: 'Yape_o_Plin',
    eventName: 'Luis Raul and Carmen del Rosario',
    eventDate: '2026-09-15',
    eventUrl: null,
    createdAt: '2026-08-28 10:00:00',
    items: [],
    ...overrides,
  };
}

function cart(overrides: Partial<CartInformation> = {}): CartInformation {
  return {
    cartId: 'cart-alex-001',
    status: 'active',
    wasAbandoned: false,
    eventId: 2001,
    eventName: 'Luis Raul and Carmen del Rosario',
    eventDate: '2026-09-15',
    subtotal: 250,
    giftsQuantity: 1,
    createdAt: '2026-08-28 09:00:00',
    items: [],
    ...overrides,
  };
}

function aspects(...values: PurchaseAspect[]): PurchaseAspect[] {
  return values;
}

describe('S09 purchase reply projector keeps carts distinct from orders', () => {
  it('projects a cart-only outcome with its own record type and no order amount or status', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [],
      carts: [cart()],
      needsSelection: false,
      coverage: 'partial',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('cart_only');
    if (outcome.kind !== 'cart_only') return;
    expect(outcome.cart.recordType).toBe('cart');
    expect(outcome.cart).not.toHaveProperty('grandTotal');
    // C1: the cart carries explicit nulls (never order values) for payment
    // state and amount so the reply keeps them on the order record.
    expect(outcome.cart.paymentStatus).toBeNull();
    expect(outcome.cart.amount).toBeNull();
    expect(outcome.cart).not.toHaveProperty('subtotal');
    expect(outcome.cart).not.toHaveProperty('amountDisclosure');
  });

  it('keeps same-event order and cart distinct without attaching order amount or status to the cart', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order()],
      carts: [cart()],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_plus_cart');
    if (outcome.kind !== 'order_plus_cart') return;
    expect(outcome.order.recordType).toBe('order');
    expect(outcome.cart.recordType).toBe('cart');
    expect(outcome.cart).not.toHaveProperty('grandTotal');
    // C1: explicit nulls keep order payment state and amount off the cart.
    expect(outcome.cart.paymentStatus).toBeNull();
    expect(outcome.cart.amount).toBeNull();
    expect(outcome.order.paymentStatus).toBe('pending');
  });
});

describe('S09 reported amounts never become settlement evidence', () => {
  it('records a disputed amount as user-reported without overwriting the trusted total', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ grandTotal: 63.85 })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: { amount: 60 },
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.amount?.total).toBe(63.85);
    expect(outcome.order.amountMismatch?.reported).toBe(60);
    expect(outcome.order.amountMismatch?.recorded).toBe(63.85);
    expect(outcome.order.userReported.amount).toBe(60);
  });

  it('keeps a shortfall report pending without approval or a computed balance', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ orderId: 'order-maria-pending-63', grandTotal: 63.85, paymentStatus: 'pending' })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: { amount: 3.85 },
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.paymentStatus).toBe('pending');
    expect(outcome.order.amount?.total).toBe(63.85);
    expect(outcome.order).not.toHaveProperty('balance');
  });
});

describe('S09 purchase facts reach the reply model', () => {
  it('keeps every unresolved record factual without calling the first one unique', () => {
    const purchases = [
      order({ orderId: 'older', eventName: 'Aniversario Lucia', paymentStatus: 'approved' }),
      order({ orderId: 'newer', eventName: 'Boda Nueva', paymentStatus: 'pending' }),
    ];
    const outcome = selectPurchaseReplyOutcome({
      purchases,
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: { amount: 340.44 },
    });
    expect(outcome.kind).toBe('order_set');
    if (outcome.kind !== 'order_set') return;
    expect(outcome.orders.every((candidate) =>
      candidate.amountMismatch === null && candidate.userReported.amount === null
    )).toBe(true);
    expect(projectPurchaseReplyForModel(outcome)).toMatchObject({
      recordType: 'order_set',
      orders: [
        { eventName: 'Aniversario Lucia', paymentStatus: 'approved' },
        { eventName: 'Boda Nueva', paymentStatus: 'pending' },
      ],
    });
    const completed = projectCompletedPurchaseForModel({
      requestId: 'multi-record', kind: 'purchase', status: 'completed', resource: 'gift_purchases',
      purchases, carts: [], needsSelection: false, coverage: 'complete',
    }, {
      requestedAspects: aspects('summary', 'payment_status'),
    });
    expect(completed).toMatchObject({
      outcome_kind: 'order_set',
      permitted_next_action: 'none',
      reference_status: { candidate_count: 2 },
      missing_inputs: [],
    });
    const fourth = projectCompletedPurchaseForModel({
      requestId: 'four-records', kind: 'purchase', status: 'completed', resource: 'gift_purchases',
      purchases: [
        ...purchases,
        order({ orderId: 'third', eventName: 'Boda Tres' }),
        order({ orderId: 'fourth', eventName: 'Boda Cuatro' }),
      ],
      carts: [], needsSelection: false, coverage: 'complete',
    }, { requestedAspects: aspects('summary') });
    expect(fourth).toMatchObject({
      reference_status: { candidate_count: 4 },
      outcome: { recordType: 'order_set', orders: [{}, {}, {}, { eventName: 'Boda Cuatro' }] },
    });
  });

  it('selects a unique record without inventing a reference', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ customerTransactionNumber: null })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'unavailable',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: true,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.transactionReference).toBeNull();
    expect(projectPurchaseReplyForModel(outcome)).toMatchObject({
      recordType: 'order',
      order: { paymentStatus: 'pending' },
    });
  });

  it('keeps candidate resolution and reference status as structured facts', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        order({ orderId: 'order-martha-01', eventName: 'Evento Familiar Norte' }),
        order({ orderId: 'order-martha-02', eventName: null }),
      ],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'unavailable',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('selection');
    const result = {
      requestId: 'purchase-1',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [
        order({ eventName: 'Evento Familiar Norte' }),
        order({ eventName: null }),
      ],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'unavailable',
      requestedCustomerTransactionNumber: 'COD-missing',
    } as never;
    const evidence = projectCompletedPurchaseForModel(result, {
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
    });
    expect(evidence).toMatchObject({
      outcome_kind: 'selection',
      reference_status: {
        requested: true,
        resolution: 'unavailable',
        authorized: false,
        candidate_count: 2,
      },
      permitted_next_action: 'select_purchase',
    });
    const disclosures = evidence.disclosures as { denied: unknown[] };
    const missingInputs = evidence.missing_inputs as unknown[];
    expect(disclosures.denied).toEqual(
      expect.arrayContaining(['transaction_reference', 'internal_identifiers']),
    );
    expect(missingInputs).toEqual(expect.arrayContaining(['purchase_selection']));
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('order-martha-01');
  });

  it('keeps a cart separate from an order and preserves reported amount provenance', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ grandTotal: 63.85 })],
      carts: [cart()],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: { amount: 60 },
    });
    expect(outcome.kind).toBe('order_plus_cart');
    if (outcome.kind !== 'order_plus_cart') return;
    expect(outcome.order.amount?.total).toBe(63.85);
    expect(outcome.order.amountMismatch).toEqual({ reported: 60, recorded: 63.85 });
    expect(outcome.cart.recordType).toBe('cart');
    const modelInput = projectPurchaseReplyForModel(outcome);
    expect(modelInput).toMatchObject({
      recordType: 'order_plus_cart',
      order: { amountMismatch: { reported: 60, recorded: 63.85 } },
      cart: { recordType: 'cart' },
    });
  });

  it('omits withheld currency and internal payment data from model facts', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({
        payment: {
          method: 'Transferencia',
          amount: 63.85,
          paidAt: '2026-08-28 12:00:00',
          paymentId: 'pay-1',
          destinationAccount: { holder: 'h', bank: 'b', number: 'n', cci: 'c', type: 't' },
          voucherImage: 'voucher.png',
        },
        currency: null,
      })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: true,
      userReported: { currency: 'USD', paidAt: '2026-08-28 12:00:00' },
    });
    const serialized = JSON.stringify(projectPurchaseReplyForModel(outcome));
    expect(serialized).not.toContain('pay-1');
    expect(serialized).not.toContain('voucher.png');
    expect(serialized).not.toContain('destinationAccount');
    expect(serialized).toContain('USD');
    expect(serialized).toContain('2026-08-28 12:00:00');
  });

  it('projects conflict and empty outcomes without a fabricated status', () => {
    const conflict = selectPurchaseReplyOutcome({
      purchases: [order()], carts: [], needsSelection: false,
      coverage: 'inconsistent', referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'), referenceAuthorized: false, userReported: {},
    });
    const empty = selectPurchaseReplyOutcome({
      purchases: [], carts: [], needsSelection: false,
      coverage: 'complete', referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'), referenceAuthorized: false, userReported: {},
    });
    expect(projectPurchaseReplyForModel(conflict)).toEqual({ recordType: 'conflict' });
    expect(projectPurchaseReplyForModel(empty)).toEqual({ recordType: 'empty' });
  });

  it('permits no next action on an empty receipt-boundary read, never team support', () => {
    // A visible receipt amount with zero backend records cannot prove
    // approval and must not imply team support on its own.
    const result = {
      requestId: 'purchase-approval-empty',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
    } as never;
    const evidence = projectCompletedPurchaseForModel(result, {
      requestedAspects: aspects('payment_status'),
      referenceAuthorized: false,
      userReported: { amount: 250 },
    });
    expect(evidence).toMatchObject({
      outcome_kind: 'empty',
      permitted_next_action: 'none',
    });
  });
});

describe('S09 time-only answers carry time evidence without amount-driven caveats', () => {
  it('projects paymentAt with no amount block for a payment_details-only question', () => {
    const timed = order({
      payment: { method: 'Yape', amount: 250, paidAt: '2026-08-30 21:31:00' },
    });
    const outcome = selectPurchaseReplyOutcome({
      purchases: [timed],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('payment_details'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    // Relevant time evidence only: the recorded hour travels, the total
    // the question never asked for stays out so no balance/currency
    // caveat is invited.
    expect(outcome.order.paymentAt).toBe('2026-08-30 21:31:00');
    expect(outcome.order.amount).toBeNull();
  });

  it('omits unknown-currency negative evidence when no amount is disclosed', () => {
    const timed = order({
      currency: null,
      currencySymbol: null,
      payment: { method: 'Yape', amount: 250, paidAt: '2026-08-30 21:31:00' },
    });
    const outcome = selectPurchaseReplyOutcome({
      purchases: [timed],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('payment_details'),
      referenceAuthorized: false,
      userReported: {},
    });
    const projected = projectPurchaseReplyForModel(outcome) as {
      recordType: string;
      order: Record<string, unknown>;
    };
    expect(projected.recordType).toBe('order');
    expect(projected.order.currencyAvailability).toBe('unknown');
    expect('currency_unknown' in projected.order).toBe(false);
  });
});

describe('S09 compact purchase balance limitation', () => {
  function singleOutcome(record: PurchaseInformation) {
    return selectPurchaseReplyOutcome({
      purchases: [record],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
  }

  it('marks unknown paid and unverifiable remaining without computing a balance', () => {
    const limitation = projectPurchaseBalanceLimitation(
      singleOutcome(order({ orderId: 'order-luis-227', grandTotal: 227.76, currency: null })),
      'order-luis-227',
    );
    expect(limitation).toEqual({
      orderId: 'order-luis-227',
      total: 227.76,
      totalAvailability: 'available',
      paid: null,
      paidAvailability: 'unknown',
      remaining: null,
      remainingVerifiable: false,
      currency: null,
      currencyAvailability: 'unknown',
      userReported: { amount: null, currency: null, paidAt: null },
    });
  });

  it('passes explicit paid amounts through, including zero, without collision', () => {
    const limitation = projectPurchaseBalanceLimitation(
      singleOutcome(order({
        orderId: 'order-zero-paid',
        grandTotal: 227.76,
        currency: 'PEN',
        payment: { method: 'Yape', amount: 0, paidAt: '2026-08-30 21:31:00' },
      })),
      'order-zero-paid',
    );
    expect(limitation?.paid).toBe(0);
    expect(limitation?.paidAvailability).toBe('available');
    expect(limitation?.remaining).toBeNull();
    expect(limitation?.remainingVerifiable).toBe(false);
    expect(limitation?.currency).toBe('PEN');
    expect(limitation?.currencyAvailability).toBe('available');
  });

  it('keeps user-reported amounts out of recorded paid and total', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ orderId: 'order-reported', grandTotal: 227.76 })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: { amount: 227.76 },
    });
    const limitation = projectPurchaseBalanceLimitation(outcome, 'order-reported');
    expect(limitation?.total).toBe(227.76);
    expect(limitation?.paid).toBeNull();
    expect(limitation?.paidAvailability).toBe('unknown');
    expect(limitation?.userReported.amount).toBe(227.76);
  });

  it('returns null for non-single-order outcomes and missing order ids', () => {
    const selection = selectPurchaseReplyOutcome({
      purchases: [order({ orderId: 'a' }), order({ orderId: 'b' })],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(projectPurchaseBalanceLimitation(selection, 'a')).toBeNull();
    const empty = selectPurchaseReplyOutcome({
      purchases: [],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(projectPurchaseBalanceLimitation(empty, 'a')).toBeNull();
    expect(projectPurchaseBalanceLimitation(singleOutcome(order()), null)).toBeNull();
    expect(projectPurchaseBalanceLimitation(singleOutcome(order()), '  ')).toBeNull();
  });
});
