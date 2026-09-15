import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { projectCompletedPurchaseForModel } from '../src/runtime/purchase-reply-projector';

describe('offline twins wave C5 provenance batch', () => {
  it('reply projection contains no customerTransactionNumber or payment-identifier fields', () => {
    const purchase = {
      orderId: 'ORD-1',
      customerTransactionNumber: '12345',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 80,
      paymentMethod: 'Yape',
      eventName: 'Samuel Josue',
      eventDate: '2026-08-29',
      eventUrl: null,
      createdAt: '2026-08-29',
      items: [{ giftName: 'Regalo', quantity: 1, amount: 80, rowTotal: 80, type: 'product' }],
      payment: { method: 'Yape', amount: 80, paidAt: null },
      amountDisclosure: { total: 80, paid: null, currency: null, paymentMethod: 'Yape', presentation: 'recorded_method_no_currency' as const },
      currency: null,
    } as unknown as never;
    const projected = projectCompletedPurchaseForModel({
      requestId: 'c5', kind: 'purchase', status: 'completed', resource: 'gift_purchases',
      purchases: [purchase], carts: [], needsSelection: false, coverage: 'complete',
      referenceResolution: 'not_requested',
    } as never, { requestedAspects: ['summary', 'payment_status'] });
    expect(JSON.stringify(projected)).not.toContain('customerTransactionNumber');
    expect(JSON.stringify(projected)).not.toContain('paymentId');
    expect(JSON.stringify(projected)).not.toContain('voucher.png');
    expect(JSON.stringify(projected)).not.toContain('orderId');
  });

  it('constancia anchor has no COD naming and no date/time enumeration but keeps never-deny', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'src/runtime/agent-service.ts'), 'utf8');
    expect(content).toContain('Nunca afirmes que no existe constancia o comprobante; no comentes fecha u hora de pago salvo que la persona lo pregunte.');
    expect(content).not.toContain('La referencia COD permanece en el registro');
    expect(content).not.toContain('solo la moneda y la fecha/hora local permanecen sin confirmar');
  });

  it('combined payment-report advisory is removed; pending facts stay projected', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'src/runtime/agent-service.ts'), 'utf8');
    // Unconditional advisory notes are removed: typed facts travel on the
    // projected result and the node response contract owns presentation.
    expect(content).not.toContain('El monto que la persona dice haber pagado es un dato aportado por ella');
    expect(content).not.toContain('hasPendingPurchaseForProvenance');
    expect(content).not.toContain('hasAmountMismatchForProvenance');
    expect(content).not.toContain('hasPendingValidationWindow');
    // The pending summary still gets its facts from the projection.
    const purchase = {
      orderId: 'ORD-1',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 80,
      paymentMethod: 'Yape',
      eventName: 'Samuel Josue',
      eventDate: '2026-08-29',
      eventUrl: null,
      createdAt: '2026-08-29',
      items: [],
      paymentValidationExpectation: { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' },
      amountDisclosure: { total: 80, paid: null, currency: null, paymentMethod: 'Yape', presentation: 'recorded_method_no_currency' as const },
      currency: null,
    } as unknown as never;
    const projected = projectCompletedPurchaseForModel({
      requestId: 'c5', kind: 'purchase', status: 'completed', resource: 'orders',
      purchases: [purchase], carts: [], needsSelection: false, coverage: 'complete',
      referenceResolution: 'not_requested',
    } as never, { requestedAspects: ['summary', 'payment_status', 'validation_window'] });
    const first = (projected as unknown as { outcome: { recordType: string; order: { paymentStatus: string | null; amount: { total: number | null } | null; validationWindow?: { maxBusinessHours: number } | null } } }).outcome;
    expect(first?.recordType).toBe('order');
    expect(first?.order.paymentStatus).toBe('pending');
    expect(first?.order.amount?.total).toBe(80);
    expect(first?.order.validationWindow?.maxBusinessHours).toBe(72);
  });

  it('support note strengthened clause and no-menu continuation per branch taken (no verbatim field)', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'prompts/extractors/information.txt'), 'utf8');
    expect(content).toContain('Conserva literalmente el nombre del evento citado');
    expect(content).toContain('continúa el problema con el siguiente paso necesario');
    // Verify no verbatim event/context name field added (extractor has 7B margin - no new field)
    const extractionSchema = fs.readFileSync(path.resolve(process.cwd(), 'src/runtime/extraction-schemas.ts'), 'utf8');
    expect(extractionSchema).not.toContain('verbatim');
    expect(extractionSchema).not.toContain('eventContextName');
  });
});
