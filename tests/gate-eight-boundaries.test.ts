import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PurchaseInformation } from '../src/core/information';
import { redactArtifactText } from '../src/runtime/artifact-redaction';
import { projectCompletedPurchaseForModel } from '../src/runtime/purchase-reply-projector';
import { PromptLoader } from '../src/runtime/prompt-loader';

describe('eight-failure gate boundaries', () => {
  it('preserves decimal amounts through repeated redaction but strips OTPs', () => {
    const text = 'Monto 1042.81; código: 753994; otro 847261';
    const safe = redactArtifactText(text);
    expect(safe).toContain('1042.81');
    expect(safe).not.toContain('753994');
    expect(safe).not.toContain('847261');
    expect(redactArtifactText(safe)).toBe(safe);
  });
  it('does not imply a discrepancy when reported amount equals recorded total', () => {
    const result = {
      requestId: 'gate-eight', kind: 'purchase', status: 'completed', resource: 'orders',
      purchases: [{
        orderId: 'internal-only', paymentStatus: 'pending', shippingStatus: null,
        grandTotal: 63.85, paymentMethod: 'Transferencia', eventName: 'Evento A',
        eventDate: '2026-09-12', eventUrl: null, createdAt: null, items: [],
      }], carts: [], needsSelection: false, coverage: 'complete',
      referenceResolution: 'not_requested',
    } as never;
    const evidence = projectCompletedPurchaseForModel(result, {
      requestedAspects: ['summary', 'payment_status'],
      userReported: { amount: 63.85 },
    });
    expect(evidence).toMatchObject({
      outcome: { order: { amountMismatch: null } },
    });
  });
  it('reads authorized disclosure and omits missing selection fields', () => {
    const purchase: PurchaseInformation = {
      orderId: 'internal-only', paymentStatus: 'pending', shippingStatus: null,
      grandTotal: null, paymentMethod: null, eventName: null, eventDate: '2026-09-12',
      eventUrl: null, createdAt: null, items: [],
      amountDisclosure: { total: 120.5, paid: null, currency: null, currencySymbol: null, paymentMethod: 'Transferencia', presentation: 'recorded_method_no_currency' },
    };
    const result = {
      requestId: 'gate-eight', kind: 'purchase', status: 'completed', resource: 'orders',
      purchases: [purchase], carts: [], needsSelection: false, coverage: 'complete',
      referenceResolution: 'not_requested',
    } as never;
    const visible = JSON.stringify(projectCompletedPurchaseForModel(result, {
      requestedAspects: ['summary', 'payment_status'],
    }));
    expect(visible).toContain('120.5');
    expect(visible).not.toContain('internal-only');
  });
  it('keeps auth decision guidance out of the ordinary extractor bundle', async () => {
    const loader = new PromptLoader(path.resolve('prompts'));
    const ordinary = await loader.loadExtractorBundle();
    const auth = await loader.loadAuthControlBundle();
    expect(ordinary.filePaths).not.toContain('nodes/resolver_consultas_informativas/auth_control.txt');
    expect(auth.filePaths).toEqual(['nodes/resolver_consultas_informativas/auth_control.txt']);
    expect(auth.instructions).toContain('decline_authentication');
    expect(Buffer.byteLength(auth.instructions)).toBeLessThan(800);
  });
});
