import type { ProviderSummary } from '../core/provider';
import type {
  ProviderNeedSubQuery,
  ProviderSubQueryCandidate,
  ProviderSubQueryResult,
} from '../core/provider-sub-query';
import { normalizeToProviderCategory } from '../core/provider-category';
import type { ProviderFitCriteria, ScoredProviderSummary } from './provider-fit';
import {
  isProviderEligibleForCriteria,
  rankProvidersForCriteria,
} from './provider-fit';

const MIN_STRONG_MATCH_SCORE = 40;

export function createSubQueryFitCriteria(args: {
  baseCriteria: ProviderFitCriteria;
  subQuery: ProviderNeedSubQuery;
}): ProviderFitCriteria {
  return {
    ...args.baseCriteria,
    needCategory: args.subQuery.label,
    mustHave: dedupeStrings([
      ...args.baseCriteria.mustHave,
      ...args.subQuery.mustHave,
      args.subQuery.label,
    ]),
    shouldAvoid: dedupeStrings([
      ...args.baseCriteria.shouldAvoid,
      ...args.subQuery.shouldAvoid,
    ]),
    rankingNotes: [
      args.baseCriteria.rankingNotes,
      `Prioriza evidencia exacta para: ${args.subQuery.label}.`,
    ].filter(Boolean).join(' '),
  };
}

export function selectProvidersForSubQuery(args: {
  subQuery: ProviderNeedSubQuery;
  providers: ProviderSummary[];
  baseCriteria: ProviderFitCriteria;
}): ProviderSubQueryResult {
  const criteria = createSubQueryFitCriteria({
    baseCriteria: args.baseCriteria,
    subQuery: args.subQuery,
  });
  const categoryFiltered = args.providers.filter((provider) =>
    args.subQuery.allowCrossCategory ||
    normalizeToProviderCategory(provider.category) === args.subQuery.category,
  );
  const ranked = rankProvidersForCriteria(categoryFiltered, criteria)
    .map((provider) => applyMustHaveEvidenceBoost(provider, args.subQuery))
    .sort((left, right) => {
      const scoreDelta = (right.fitScore ?? 0) - (left.fitScore ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const retrievalDelta = (right.retrievalScore ?? 0) - (left.retrievalScore ?? 0);
      if (retrievalDelta !== 0) {
        return retrievalDelta;
      }
      return left.id - right.id;
    });
  const selected = ranked
    .filter((provider) =>
      (provider.fitScore ?? 0) >= MIN_STRONG_MATCH_SCORE &&
      isProviderEligibleForCriteria(provider, criteria) &&
      hasRequiredSubQueryEvidence(provider, args.subQuery),
    )
    .slice(0, args.subQuery.maxSelections);

  return {
    subQuery: args.subQuery,
    candidate_provider_ids: ranked.map((provider) => provider.id),
    selected_provider_ids: selected.map((provider) => provider.id),
    candidates: ranked,
    no_match_reason: selected.length > 0
      ? null
      : `No encontramos un match fuerte para ${args.subQuery.label}.`,
  };
}

function applyMustHaveEvidenceBoost(
  provider: ScoredProviderSummary,
  subQuery: ProviderNeedSubQuery,
): ProviderSubQueryCandidate {
  const evidence = scoreMustHaveEvidence(provider, subQuery.mustHave);
  const baseScore = provider.fitScore ?? 0;
  const fitTags = new Set(provider.fitTags ?? []);
  const fitWarnings = new Set(provider.fitWarnings ?? []);

  if (evidence.matches > 0) {
    fitTags.add('must_have_evidence');
  }
  if (evidence.matches === 0 && subQuery.mustHave.length > 0) {
    fitWarnings.add(`No hay evidencia exacta de ${subQuery.label} en la ficha.`);
  }
  const eventServiceEvidence =
    subQuery.category !== 'Hogar y deco' || providerHasEventServiceEvidence(provider);
  if (eventServiceEvidence) {
    fitTags.add('event_service_evidence');
  } else {
    fitWarnings.add('La ficha no demuestra un servicio orientado a eventos.');
  }

  return {
    ...provider,
    fitScore: clampScore(
      baseScore +
      evidence.score +
      (subQuery.category === 'Hogar y deco' && eventServiceEvidence ? 14 : 0),
    ),
    fitTags: Array.from(fitTags),
    fitWarnings: Array.from(fitWarnings),
  };
}

function hasRequiredSubQueryEvidence(
  provider: ProviderSubQueryCandidate,
  subQuery: ProviderNeedSubQuery,
): boolean {
  const tags = provider.fitTags ?? [];
  const mustHaveSatisfied =
    subQuery.mustHave.length === 0 || tags.includes('must_have_evidence');
  const eventServiceSatisfied =
    subQuery.category !== 'Hogar y deco' || tags.includes('event_service_evidence');
  return mustHaveSatisfied && eventServiceSatisfied;
}

export function providerHasEventServiceEvidence(provider: ProviderSummary): boolean {
  const providerText = normalizeText([
    provider.descriptionSnippet ?? '',
    provider.description ?? '',
    provider.serviceHighlights.join(' '),
    provider.termsHighlights.join(' '),
  ].join(' '));
  return [
    'evento',
    'eventos',
    'boda',
    'bodas',
    'matrimonio',
    'baby shower',
    'cumpleanos',
    'quinceanos',
    'celebracion',
  ].some((signal) => providerText.includes(signal));
}

function scoreMustHaveEvidence(
  provider: ProviderSummary,
  mustHave: string[],
): { matches: number; score: number } {
  const providerText = normalizeText([
    provider.title,
    provider.category ?? '',
    provider.descriptionSnippet ?? '',
    provider.description ?? '',
    provider.serviceHighlights.join(' '),
    provider.termsHighlights.join(' '),
    provider.promoBadge ?? '',
    provider.promoSummary ?? '',
  ].join(' '));
  const matches = mustHave.filter((value) => {
    const normalized = normalizeText(value);
    if (normalized.length < 3) {
      return false;
    }
    if (providerText.includes(normalized)) {
      return true;
    }
    return normalized.split(' ').filter((part) => part.length >= 4).some((part) => providerText.includes(part));
  }).length;

  return {
    matches,
    score: Math.min(matches * 14, 36),
  };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
