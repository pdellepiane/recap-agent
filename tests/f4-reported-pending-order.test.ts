import { describe, expect, it } from 'vitest';

import {
  renderReportedPendingInitial,
  renderReportedShortfallPending,
  shouldRenderReportedPendingOrder,
} from '../src/runtime/purchase-reply-projector';

describe('F4 reported-amount pending order keeps registry totals distinct', () => {
  it('matches a single pending transfer order with a reported amount and no currency', () => {
    expect(
      shouldRenderReportedPendingOrder({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Transferencia',
        currency: null,
        cartCount: 1,
        needsSelection: false,
        reportedAmount: 63.85,
      }),
    ).toBe(true);
  });

  it('does not match without a user-reported amount', () => {
    expect(
      shouldRenderReportedPendingOrder({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Transferencia',
        currency: null,
        cartCount: 1,
        needsSelection: false,
        reportedAmount: null,
      }),
    ).toBe(false);
  });

  it('initial reply names the pending order with the trusted total and keeps the report as a report', () => {
    const text = renderReportedPendingInitial({
      eventName: 'Isa and Lu',
      total: 63.85,
      paymentMethod: 'Transferencia',
      reportedAmount: 63.85,
    });
    expect(text).toContain('pedido');
    expect(text).toContain('Isa and Lu');
    expect(text).toContain('pendiente');
    expect(text).toContain('63.85');
    expect(text).not.toContain('72 horas');
    expect(text).not.toContain('saldo');
    expect(text).not.toContain('AMORCITOS');
  });

  it('continued reply keeps the order pending with the transfer window and no approval or balance', () => {
    const text = renderReportedShortfallPending({
      eventName: 'Isa and Lu',
      paymentMethod: 'Transferencia',
      reportedAmount: 3.85,
    });
    expect(text).toContain('pendiente');
    expect(text).toContain('72 horas');
    expect(text.toLocaleLowerCase('es')).toContain('transferencia');
    expect(text).not.toContain('aprobado');
    expect(text).not.toContain('saldo');
    expect(text).not.toContain('AMORCITOS');
  });
});
