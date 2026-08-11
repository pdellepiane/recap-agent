import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PromptLoader } from '../src/runtime/prompt-loader';

describe('purchase prompt policy', () => {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

  it('loads the payment-destination and physical-shipping rules exactly once on the information route', async () => {
    const bundle = await loader.loadNodeBundle('resolver_consultas_informativas');
    const destinationRule =
      'Solo muestra un destino de Yape o transferencia si una compra completada tiene `paymentStatus=pending`';
    const shippingRule =
      'Solo menciona envío o entrega física si la compra proyectada tiene `shippingStatus`';

    expect(bundle.instructions.split(destinationRule)).toHaveLength(2);
    expect(bundle.instructions.split(shippingRule)).toHaveLength(2);
  });

  it('keeps payment-destination classification in the information extractor', async () => {
    const bundle = await loader.loadExtractorBundle();

    expect(bundle.instructions).toContain(
      'Pedir el destino de Yape o transferencia es `purchase`, no FAQ',
    );
    expect(bundle.instructions).toContain('`payment_details` y `destination_account`');
  });
});
