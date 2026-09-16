import { describe, expect, it } from 'vitest';
import { parseHostWithdrawalPolicy } from '../src/runtime/host-withdrawal-policy';
import type { KnowledgeEvidence } from '../src/core/information';

const article = (text: string, filename = 'atc-template-new-solicitud-de-fondos.md'): KnowledgeEvidence => ({
  fileId: 'policy', filename, score: 0.9, text,
});
const policyText = 'Origen: plantilla de atención al cliente de ATC/Notion. Canal: Chat. Estado: Vigente. Tipo: Informativa. Actualización: Listo.\nLas solicitudes se procesan en hasta 72 horas hábiles, de lunes a viernes entre 9:00 a.m. y 6:00 p.m.';
const legacyPolicyText = 'template_status: "Vigente"\nLas solicitudes se procesan en hasta 72 horas hábiles, de lunes a viernes entre 9:00 a.m. y 6:00 p.m.';

describe('host withdrawal policy boundary', () => {
  it('projects just the verified processing window, not the article or operational facts', () => {
    const result = parseHostWithdrawalPolicy([article(`${policyText}\nCuenta secreta 123. Segunda transferencia USD5. Tarjeta 14 días. Tu retiro llega mañana.`)]);
    expect(result.policy).toEqual({ maxBusinessHours: 72 });
    expect(result.evidence[0]?.text).toBe('Plazo general de procesamiento: hasta 72 horas hábiles.');
    expect(JSON.stringify(result)).not.toMatch(/123|USD5|14 días|mañana|9:00/u);
  });
  it('rejects unrelated articles even when their numeric window matches', () => {
    expect(parseHostWithdrawalPolicy([article(policyText, 'gift-payment-validation.md')]).policy).toBeNull();
    expect(parseHostWithdrawalPolicy([article(policyText, 'atc-template-error-en-transferencia-de-fondos.md')]).policy).toBeNull();
  });
  it('fails closed for absent, stale, malformed, and conflicting policy evidence', () => {
    for (const evidence of [[], [article('72 horas hábiles')],
      [article(policyText.replace('Vigente', 'Archivado'))],
      [article(policyText), article(policyText.replace('72', '48'))]]) {
      expect(parseHostWithdrawalPolicy(evidence)).toEqual({ policy: null, evidence: [] });
    }
  });
  it('uses a changed supported value instead of hardcoding 72', () => {
    expect(parseHostWithdrawalPolicy([article(policyText.replace('72', '48'))]).policy)
      .toEqual({ maxBusinessHours: 48 });
  });
  it('still parses legacy indexed files carrying frontmatter provenance', () => {
    expect(parseHostWithdrawalPolicy([article(legacyPolicyText)]).policy)
      .toEqual({ maxBusinessHours: 72 });
  });
});
