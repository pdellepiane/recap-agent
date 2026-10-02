import { describe, expect, it } from 'vitest';
import type { InformationTaskResult } from '../src/core/information';
import {
  unsupportedCommissionNumericClaims,
  verifiedCommissionArticle,
} from '../src/runtime/commission-grounding';

const article = 'Si el regalo es US$100, el invitado paga $105 y el anfitrión recibe $95. Tarjeta: 3.59% y 0.50 en soles.';

describe('commission numeric grounding', () => {
  it('allows only source, user-stated or verified quote values', () => {
    const base = { articleText: article, userMessage: '¿Y si aporta S/50?' };
    expect(unsupportedCommissionNumericClaims({
      ...base,
      reply: 'Con el ejemplo de US$100, el invitado paga $105 y recibes $95. Para S/50 usa la calculadora.',
    })).toEqual([]);
    expect(unsupportedCommissionNumericClaims({
      ...base,
      reply: 'Con S/50 recibirías S/49.05; la comisión es 5%, 7% o 9%.',
    }).map((claim) => claim.written)).toEqual(['S/49.05', '5%', '7%', '9%']);
    expect(unsupportedCommissionNumericClaims({
      ...base,
      reply: 'La calculadora verificó S/43.07.',
      verifiedCalculatorQuote: 'S/43.07',
    })).toEqual([]);
  });

  it('flags cross-currency, unlabelled, and derived numeric claims', () => {
    // Cross-currency amounts and derived rounded percentages.
    const crossed = unsupportedCommissionNumericClaims({
      articleText: article,
      userMessage: 'Aporto S/50',
      reply: 'Recibes S/95 o 5% menos.',
    });
    expect(crossed.map((claim) => `${claim.unit}:${claim.value}`)).toEqual(['PEN:95', 'PERCENT:5']);
    // Unlabelled precise decimals.
    const unlabelled = unsupportedCommissionNumericClaims({
      articleText: article,
      userMessage: 'Aporto S/50',
      reply: 'Recibirías 49,05.',
    });
    expect(unlabelled.map((claim) => `${claim.unit}:${claim.value}`)).toEqual(['UNLABELED_DECIMAL:49.05']);
    // Saved dev calculations and alternate PEN spellings.
    const derived = unsupportedCommissionNumericClaims({
      articleText: article,
      userMessage: '¿Cuál es la comisión de 50 soles?',
      reply: 'Los variables suman 3,25% de S/50: S/1,63. Recibirías S/.48,37 o PEN 48.37; en soles 48,37.',
    });
    expect(derived.map((claim) => `${claim.unit}:${claim.value}`)).toEqual([
      'PEN:1.63', 'PEN:48.37', 'PEN:48.37', 'PEN:48.37', 'PERCENT:3.25',
    ]);
  });

  it('activates only for completed FAQ results with canonical article identity', () => {
    const completed = {
      kind: 'faq', status: 'completed', requestId: 'faq-1',
      evidence: [{ fileId: 'f1', filename: 'cost.md', text: article, score: 1 }],
      citationUrl: 'https://sinenvolturas.tawk.help/article/cuanto-cuesta',
    } as InformationTaskResult;
    expect(verifiedCommissionArticle([completed])).toBe(completed);
    expect(verifiedCommissionArticle([{
      ...completed,
      citationUrl: null,
      evidence: [{ fileId: 'f1', filename: 'cuanto-cuesta-invitados.md', text: article, score: 0.84 }],
    } as InformationTaskResult])).not.toBeNull();
    expect(verifiedCommissionArticle([{ ...completed, citationUrl: 'https://example.com/cost' } as InformationTaskResult])).toBeNull();
    expect(verifiedCommissionArticle([{ ...completed, evidence: [] } as InformationTaskResult])).toBeNull();
  });
});
