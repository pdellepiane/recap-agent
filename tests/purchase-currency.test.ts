import { describe, expect, it } from 'vitest';

import type { PurchaseInformation } from '../src/core/information';
import { normalizePurchaseCurrency } from '../src/runtime/purchase-currency';
import {
  projectPurchaseReplyForModel,
  selectPurchaseReplyOutcome,
} from '../src/runtime/purchase-reply-projector';

describe('normalizePurchaseCurrency', () => {
  it('normalizes the PEN / S/ pair from the purchase endpoints', () => {
    expect(normalizePurchaseCurrency({
      currency: null,
      currency_code: 'PEN',
      currency_symbol: 'S/',
    })).toEqual({ currency: 'PEN', currencySymbol: 'S/', currencyConflict: false });
  });

  it('normalizes the USD / $ pair', () => {
    expect(normalizePurchaseCurrency({
      currency_code: 'usd',
      currency_symbol: '$',
    })).toEqual({ currency: 'USD', currencySymbol: '$', currencyConflict: false });
  });

  it('keeps the legacy currency field when the new fields are absent', () => {
    expect(normalizePurchaseCurrency({ currency: 'PEN' })).toEqual({
      currency: 'PEN',
      currencySymbol: null,
      currencyConflict: false,
    });
  });

  it('prefers currency_code over a matching legacy currency', () => {
    expect(normalizePurchaseCurrency({
      currency: 'pen',
      currency_code: 'PEN',
      currency_symbol: 'S/',
    })).toEqual({ currency: 'PEN', currencySymbol: 'S/', currencyConflict: false });
  });

  it('withholds the currency claim on conflict while retaining the evidence', () => {
    expect(normalizePurchaseCurrency({
      currency: 'USD',
      currency_code: 'PEN',
      currency_symbol: 'S/',
    })).toEqual({ currency: null, currencySymbol: 'S/', currencyConflict: true });
  });

  it('keeps a symbol-only row without inventing a code', () => {
    expect(normalizePurchaseCurrency({ currency_symbol: 'S/' })).toEqual({
      currency: null,
      currencySymbol: 'S/',
      currencyConflict: false,
    });
  });

  it('stays neutral when every currency field is missing or blank', () => {
    expect(normalizePurchaseCurrency({})).toEqual({
      currency: null,
      currencySymbol: null,
      currencyConflict: false,
    });
    expect(normalizePurchaseCurrency({
      currency: '  ',
      currency_code: '',
      currency_symbol: null,
    })).toEqual({ currency: null, currencySymbol: null, currencyConflict: false });
  });
});

function purchaseWithMoney(money: {
  currency: string | null;
  currencySymbol?: string | null;
  currencyConflict?: boolean;
}): PurchaseInformation {
  return {
    orderId: 'ORD-000880',
    paymentStatus: 'approved',
    shippingStatus: null,
    grandTotal: 250,
    paymentMethod: 'Visa',
    eventName: 'Boda Laura & Marcos',
    eventDate: '15/09/2026',
    eventUrl: null,
    createdAt: '2026-07-10',
    items: [],
    currency: money.currency,
    currencySymbol: money.currencySymbol ?? null,
    currencyConflict: money.currencyConflict ?? false,
  };
}

function modelOrder(purchase: PurchaseInformation): Record<string, unknown> {
  const outcome = selectPurchaseReplyOutcome({
    purchases: [purchase],
    carts: [],
    needsSelection: false,
    coverage: 'complete',
    referenceResolution: 'not_requested',
    requestedAspects: ['summary'],
    referenceAuthorized: false,
    userReported: {},
  });
  if (outcome.kind !== 'order_unique') throw new Error(`unexpected outcome ${outcome.kind}`);
  return projectPurchaseReplyForModel(outcome);
}

describe('purchase currency display metadata', () => {
  it('projects the PEN code with its S/ symbol for the model reply', () => {
    const view = modelOrder(purchaseWithMoney({ currency: 'PEN', currencySymbol: 'S/' })) as {
      order: { currency: string; currencySymbol: string; amount: { currency: string; currencySymbol: string } };
    };
    expect(view.order.currency).toBe('PEN');
    expect(view.order.currencySymbol).toBe('S/');
    expect(view.order.amount.currency).toBe('PEN');
    expect(view.order.amount.currencySymbol).toBe('S/');
  });

  it('omits absent currency without a caveat', () => {
    const view = modelOrder(purchaseWithMoney({ currency: null })) as {
      order: Record<string, unknown>;
    };
    expect(view.order).not.toHaveProperty('currency');
    expect(view.order).not.toHaveProperty('currencySymbol');
  });

  it('withholds a conflicted symbol instead of using it in place of the code', () => {
    const view = modelOrder(
      purchaseWithMoney({ currency: null, currencySymbol: 'S/', currencyConflict: true }),
    ) as { order: Record<string, unknown> };
    expect(view.order).not.toHaveProperty('currency');
    expect(view.order).not.toHaveProperty('currencySymbol');
  });
});
