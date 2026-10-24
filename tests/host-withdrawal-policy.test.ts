import { describe, expect, it } from 'vitest';
import { parseHostWithdrawalPolicy, verifiedPublicWithdrawalEvidence } from '../src/runtime/host-withdrawal-policy';
import type { KnowledgeEvidence } from '../src/core/information';

const article = (text: string): KnowledgeEvidence => ({
  fileId: 'policy', filename: 'donde-va-el-dinero.md', score: 0.9, text,
  fullArticle: true, sourceUrl: 'https://sinenvolturas.tawk.help/article/donde-va-el-dinero',
});
const policyText = 'Las solicitudes se procesan en hasta 72 horas hábiles.';

describe('host withdrawal policy boundary', () => {
  it('preserves only complete canonical public fee articles when hours coexist with fee questions', () => {
    const official = article('First transfer free; further transfers USD5.');
    expect(verifiedPublicWithdrawalEvidence([
      official,
      { ...official, filename: 'raw-operations.md', sourceUrl: undefined },
      { ...official, sourceUrl: 'https://example.test/donde-va-el-dinero' },
      { ...official, fullArticle: false },
    ])).toEqual([official]);
  });
  it('projects only an explicit window from a validated official article', () => {
    const result = parseHostWithdrawalPolicy([article(`${policyText}\nTu retiro llega mañana.`)]);
    expect(result.policy).toEqual({ maxBusinessHours: 72 });
    expect(result.evidence[0]?.text).toBe('Plazo general de procesamiento: hasta 72 horas hábiles.');
    expect(JSON.stringify(result)).not.toContain('mañana');
  });

  it('rejects raw ATC responses and unvalidated or unrelated article projections', () => {
    for (const evidence of [
      { ...article(policyText), filename: 'atc-template-new-solicitud-de-fondos.md' },
      { ...article(policyText), fullArticle: false },
      { ...article(policyText), sourceUrl: 'https://example.com/article/donde-va-el-dinero' },
      { ...article(policyText), filename: 'validación-de-regalos-por-transferencia-y-yape.md' },
    ]) expect(parseHostWithdrawalPolicy([evidence])).toEqual({ policy: null, evidence: [] });
  });

  it('fails closed for missing or conflicting processing windows', () => {
    for (const evidence of [[], [article('El dinero se transfiere cuando se solicita.')],
      [article(policyText), article(policyText.replace('72', '48'))]]) {
      expect(parseHostWithdrawalPolicy(evidence)).toEqual({ policy: null, evidence: [] });
    }
  });

  it('reads an explicitly supported changed window instead of hardcoding 72', () => {
    expect(parseHostWithdrawalPolicy([article(policyText.replace('72', '48'))]).policy)
      .toEqual({ maxBusinessHours: 48 });
  });
});
