import { describe, expect, it } from 'vitest';

import type {
  CartInformation,
  PurchaseAspect,
  PurchaseInformation,
} from '../src/core/information';
import {
  checkPurchaseNarrativeClaims,
  projectPurchaseReplyForModel,
  renderPurchaseReplyDeterministic,
  resolvePurchaseReplyText,
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
    expect(outcome.cart).not.toHaveProperty('paymentStatus');
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
    expect(outcome.cart).not.toHaveProperty('paymentStatus');
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

describe('S09 unique records render directly while multiples require selection', () => {
  it('states a unique record directly when customer-reference metadata is unavailable', () => {
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
    const text = renderPurchaseReplyDeterministic(outcome);
    expect(text).not.toMatch(/codigo|vincular|elija|opciones/iu);
  });

  it('requires selection across multiples with compact candidates and no invented events', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        order({ orderId: 'order-martha-01', eventName: 'Evento Familiar Norte' }),
        order({ orderId: 'order-martha-02', eventName: null }),
      ],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('selection');
    if (outcome.kind !== 'selection') return;
    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.candidates[1]?.eventName).toBeNull();
    const text = renderPurchaseReplyDeterministic(outcome);
    expect(text).toMatch(/cual/iu);
  });

  it('discloses a transaction reference only when the source supplies it and access is authorized', () => {
    const supplied = selectPurchaseReplyOutcome({
      purchases: [order({ customerTransactionNumber: '100000901' })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'matched',
      requestedAspects: aspects('summary'),
      referenceAuthorized: true,
      userReported: {},
    });
    expect(supplied.kind).toBe('order_unique');
    if (supplied.kind !== 'order_unique') return;
    expect(supplied.order.transactionReference).toBe('100000901');
    const denied = selectPurchaseReplyOutcome({
      purchases: [order({ customerTransactionNumber: '100000901' })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'matched',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(denied.kind).toBe('order_unique');
    if (denied.kind !== 'order_unique') return;
    expect(denied.order.transactionReference).toBeNull();
  });
});

describe('S09 model input carries only trusted associations and requested fields', () => {
  it('omits payment method from an approved summary unless requested and never adds currency caveats', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ paymentStatus: 'approved', currency: null })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    const input = projectPurchaseReplyForModel(outcome);
    expect(JSON.stringify(input)).not.toContain('Yape_o_Plin');
    expect(JSON.stringify(input)).not.toMatch(/currency/i);
  });

  it('excludes internal identifiers and bank or voucher data from model input', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        order({
          payment: {
            method: 'Transferencia',
            amount: 63.85,
            paidAt: '2026-08-28 12:00:00',
            paymentId: 'pay-1',
            destinationAccount: { holder: 'h', bank: 'b', number: 'n', cci: 'c', type: 't' },
            voucherImage: 'voucher.png',
          },
        }),
      ],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: true,
      userReported: {},
    });
    const serialized = JSON.stringify(projectPurchaseReplyForModel(outcome));
    expect(serialized).not.toContain('order-alex-pending-250');
    expect(serialized).not.toContain('pay-1');
    expect(serialized).not.toContain('voucher.png');
    expect(serialized).not.toContain('destinationAccount');
  });
});

describe('S09 time and currency corrections stay user-reported with server-local time', () => {
  it('preserves server timestamps verbatim and marks corrections as unverifiable user reports', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ currency: null, createdAt: '2026-08-30 14:00:00' })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: { currency: 'USD', paidAt: '2026-08-30 21:31:00' },
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.createdAt).toBe('2026-08-30 14:00:00');
    expect(outcome.order.currency).toBeNull();
    expect(outcome.order.userReported.currency).toBe('USD');
    expect(outcome.order.userReported.paidAt).toBe('2026-08-30 21:31:00');
    const text = renderPurchaseReplyDeterministic(outcome);
    expect(text).not.toContain('USD');
  });
});

describe('S09 deterministic rendering with a structured claim contract', () => {
  it('renders conflict coverage without a confident status', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order()],
      carts: [],
      needsSelection: false,
      coverage: 'inconsistent',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('conflict');
    const text = renderPurchaseReplyDeterministic(outcome);
    expect(text).not.toMatch(/aprobado|pendiente/iu);
  });

  it('falls back to the deterministic renderer when narrative claims lack evidence', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ paymentStatus: 'pending' })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: { amount: 60 },
    });
    expect(checkPurchaseNarrativeClaims(outcome, {
      claimsSettledTotal: true,
      settledFromUserReport: true,
      claimsSuccess: false,
      receiptPresent: false,
    })).toBe('fallback');
    expect(checkPurchaseNarrativeClaims(outcome, {
      claimsSettledTotal: false,
      settledFromUserReport: false,
      claimsSuccess: true,
      receiptPresent: false,
    })).toBe('fallback');
    const resolved = resolvePurchaseReplyText(outcome, 'Tu pago ya quedo aprobado.', {
      claimsSettledTotal: false,
      settledFromUserReport: false,
      claimsSuccess: true,
      receiptPresent: false,
    });
    expect(resolved).toBe(renderPurchaseReplyDeterministic(outcome));
  });

  it('keeps a valid narrative without a corrective model call', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ paymentStatus: 'pending' })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(checkPurchaseNarrativeClaims(outcome, {
      claimsSettledTotal: false,
      settledFromUserReport: false,
      claimsSuccess: false,
      receiptPresent: false,
    })).toBe('ok');
    expect(resolvePurchaseReplyText(outcome, 'Tu regalo sigue pendiente.', {
      claimsSettledTotal: false,
      settledFromUserReport: false,
      claimsSuccess: false,
      receiptPresent: false,
    })).toBe('Tu regalo sigue pendiente.');
  });
});
