import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';

describe('offline twins wave C5 provenance batch', () => {
  it('reply projection contains no customerTransactionNumber or payment-identifier fields', () => {
    const runtimePath = path.resolve(process.cwd(), 'src/runtime/openai-agent-runtime.ts');
    const runtimeContent = fs.readFileSync(runtimePath, 'utf8');
    expect(runtimeContent).toContain('delete sanitized.customerTransactionNumber');
    expect(runtimeContent).toContain('Backend no longer returns COD reference');

    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test',
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
      replyProviderLimit: 5,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 5,
      promptLoader: {
        loadExtractorBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
        loadNodeBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
      } as never,
      providerGateway: {} as never,
    });
    const projectPurchase = (runtime as unknown as { projectPurchaseForReply: (p: unknown) => Record<string, unknown> }).projectPurchaseForReply.bind(runtime);
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const projected = projectPurchase(purchase as never);
    expect(projected).not.toHaveProperty('customerTransactionNumber');
    expect(JSON.stringify(projected)).not.toContain('customerTransactionNumber');
    expect(projected).not.toHaveProperty('payment');
    expect(projected).not.toHaveProperty('declineCode');
    expect(projected).not.toHaveProperty('adminComment');
  });

  it('constancia anchor has no COD naming and no date/time enumeration but keeps never-deny', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'src/runtime/agent-service.ts'), 'utf8');
    expect(content).toContain('Nunca afirmes que no existe constancia o comprobante; no comentes fecha u hora de pago salvo que la persona lo pregunte.');
    expect(content).not.toContain('La referencia COD permanece en el registro');
    expect(content).not.toContain('solo la moneda y la fecha/hora local permanecen sin confirmar');
  });

  it('combined payment-report fragment fires only on amount-mismatch condition and is absent otherwise', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'src/runtime/agent-service.ts'), 'utf8');
    const fragment = 'El monto que la persona dice haber pagado es un dato aportado por ella; no lo presentes como monto del registro. Reconoce el reporte; la orden sigue pendiente; un comprobante en imagen no permite confirmar la recepcion; la validacion puede tardar hasta 72 horas habiles; no afirmes aprobacion ni niegues la recepcion.';
    expect(content).toContain(fragment);
    expect(content).toContain('hasPendingPurchaseForProvenance');
    expect(content).toContain('hasAmountMismatchForProvenance');
    expect(content).toContain('if (hasPendingPurchaseForProvenance && hasAmountMismatchForProvenance)');
    // Ensure fragment appears exactly once (ONE combined fragment)
    const occurrences = content.split(fragment).length - 1;
    expect(occurrences).toBe(1);
  });

  it('support note strengthened clause and no-menu continuation per branch taken (no verbatim field)', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'prompts/extractors/information.txt'), 'utf8');
    expect(content).toContain('cita el nombre del evento o contexto tal como aparece en el mensaje');
    expect(content).toContain('Continúa resolviendo el problema ya planteado con el siguiente paso necesario');
    // Verify no verbatim event/context name field added (extractor has 7B margin - no new field)
    const extractionSchema = fs.readFileSync(path.resolve(process.cwd(), 'src/runtime/extraction-schemas.ts'), 'utf8');
    expect(extractionSchema).not.toContain('verbatim');
    expect(extractionSchema).not.toContain('eventContextName');
  });
});
