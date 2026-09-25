import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PromptLoader } from '../src/runtime/prompt-loader';
import { selectReplyModules } from '../src/runtime/model-request-projector';

describe('purchase prompt policy', () => {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

  it('selects one payment destination boundary for both purchase and FAQ work', async () => {
    const fs = await import('node:fs/promises');
    const file = 'nodes/resolver_consultas_informativas/payment_disclosure.txt';
    const rule = await fs.readFile(path.resolve(process.cwd(), 'prompts', file), 'utf8');
    expect(rule).toContain('compra identificada y pendiente');
    for (const task of ['purchase', 'faq_policy'] as const) {
      const selected = selectReplyModules({
        stage: 'reply', owner: 'customer_assistance', establishedDomain: null,
        tasks: [task], hasPlanningDetail: false, hasSupportContinuity: false,
      });
      expect(selected.flatMap((module) => module.files).filter((entry) => entry === file)).toHaveLength(1);
    }
  });

  it('keeps payment-destination classification in the information extractor', async () => {
    const bundle = await loader.loadExtractorBundle();

    expect(bundle.instructions).toContain(
      'Pedir datos para pagar una compra o regalo es `purchase` con `destination_account`',
    );
    expect(bundle.instructions).toContain('`destination_account`');
  });

  it('does not load payment destination guidance for unrelated RSVP work', () => {
    const selected = selectReplyModules({
      stage: 'reply', owner: 'customer_assistance', establishedDomain: null,
      tasks: ['rsvp'], hasPlanningDetail: false, hasSupportContinuity: false,
    });
    expect(selected.flatMap((module) => module.files)).not.toContain(
      'nodes/resolver_consultas_informativas/payment_disclosure.txt',
    );
  });
});
