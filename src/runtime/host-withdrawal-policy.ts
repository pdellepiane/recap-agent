import type { KnowledgeEvidence } from '../core/information';

export const hostWithdrawalPolicyQuery =
  'Plazo solicitud de transferencia de fondos al anfitrión: días hábiles hasta recibir el retiro en la cuenta bancaria';

/** Validate policy content from the audited article, never from operational examples. */
export function parseHostWithdrawalPolicy(evidence: KnowledgeEvidence[]): {
  policy: { maxBusinessHours: number } | null;
  evidence: KnowledgeEvidence[];
} {
  const candidates = evidence.filter((entry) =>
    entry.filename === 'atc-template-new-solicitud-de-fondos.md');
  const facts = candidates.flatMap((entry) => {
    const normalized = entry.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (!/template_status:\s*["']?vigente\b/u.test(normalized)) return [];
    const matches = [...normalized.matchAll(/las solicitudes se procesan en hasta\s+(\d+)\s*horas\s+habiles/gu)];
    return matches.map((match) => ({ hours: Number(match[1]), entry }));
  });
  const hours = new Set(facts.map((fact) => fact.hours));
  if (hours.size !== 1 || facts.length === 0) return { policy: null, evidence: [] };
  const fact = facts[0];
  if (!fact || !Number.isSafeInteger(fact.hours) || fact.hours <= 0) {
    return { policy: null, evidence: [] };
  }
  return {
    policy: { maxBusinessHours: fact.hours },
    evidence: [{ ...fact.entry, text: `Plazo general de procesamiento: hasta ${fact.hours} horas hábiles.` }],
  };
}
