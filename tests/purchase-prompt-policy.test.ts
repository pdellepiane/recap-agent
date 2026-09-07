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
      'Pedir el destino de Yape o transferencia es `purchase` con `destination_account`',
    );
    expect(bundle.instructions).toContain('`destination_account`');
  });

  it('keeps S09 cart and reported-amount rules scoped to the information node without global payment expansion', async () => {
    const fs = await import('node:fs/promises');
    const bundle = await loader.loadNodeBundle('resolver_consultas_informativas');
    const rule = 'Carrito y pedido son registros distintos';
    expect(bundle.instructions.split(rule)).toHaveLength(2);
    expect(bundle.instructions).toContain('nunca reemplaza el total registrado');
    const shared = await fs.readFile(
      path.resolve(process.cwd(), 'prompts/shared/domain_knowledge.txt'),
      'utf8',
    );
    expect(shared).not.toContain('Carrito y pedido');
    expect(shared).not.toContain('total registrado');
  });
});
