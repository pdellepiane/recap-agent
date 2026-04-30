import { z } from 'zod';

import type { ProviderSummary } from '../core/provider';

export const budgetTierValues = [
  'very_low',
  'low',
  'medium',
  'high',
  'very_high',
  'unknown',
] as const;

export type BudgetTier = (typeof budgetTierValues)[number];

export const providerFitCriteriaSchema = z.object({
  eventType: z.string().nullable(),
  needCategory: z.string().nullable(),
  location: z.string().nullable(),
  budgetAmount: z.number().positive().nullable(),
  budgetCurrency: z.enum(['PEN', 'USD']).nullable(),
  budgetTier: z.enum(budgetTierValues),
  mustHave: z.array(z.string()),
  shouldAvoid: z.array(z.string()),
  rankingNotes: z.string(),
});

export type ProviderFitCriteria = z.infer<typeof providerFitCriteriaSchema>;

export type ScoredProviderSummary = ProviderSummary & {
  fitScore: number;
  fitWarnings: string[];
  fitTags: string[];
};

export function parseBudgetAmount(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }

  const normalized = normalizeText(raw);
  if (/^mil(?:\s+soles?)?$/.test(normalized)) {
    return 1000;
  }

  const cleaned = raw
    .replace(/S\//gi, '')
    .replace(/soles/gi, '')
    .replace(/pen/gi, '')
    .replace(/usd/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\./g, '')
    .replace(/,/g, '')
    .trim();

  const match = cleaned.match(/(\d+)/);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeBudgetTier(amount: number | null): BudgetTier {
  if (amount === null) {
    return 'unknown';
  }

  if (amount <= 1000) {
    return 'very_low';
  }
  if (amount <= 5000) {
    return 'low';
  }
  if (amount <= 10000) {
    return 'medium';
  }
  if (amount <= 25000) {
    return 'high';
  }

  return 'very_high';
}

export function inferCurrencyFromBudget(raw: string | null | undefined): 'PEN' | 'USD' | null {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return null;
  }
  if (/(^|\s)(usd|dolares|dollars|us)(\s|$)/.test(normalized)) {
    return 'USD';
  }
  if (/(^|\s)(sol|soles|pen|s)(\s|$)/.test(normalized)) {
    return 'PEN';
  }
  return null;
}

export function createProviderFitCriteria(input: {
  eventType: string | null;
  needCategory: string | null;
  location: string | null;
  budgetSignal: string | null;
  preferences: string[];
  hardConstraints: string[];
  rankingNotes?: string;
}): ProviderFitCriteria {
  const budgetAmount = parseBudgetAmount(input.budgetSignal);

  return {
    eventType: input.eventType,
    needCategory: input.needCategory,
    location: input.location,
    budgetAmount,
    budgetCurrency: inferCurrencyFromBudget(input.budgetSignal),
    budgetTier: normalizeBudgetTier(budgetAmount),
    mustHave: input.preferences,
    shouldAvoid: input.hardConstraints,
    rankingNotes: input.rankingNotes ?? '',
  };
}

export function rankProvidersForCriteria(
  providers: ProviderSummary[],
  criteria: ProviderFitCriteria,
): ScoredProviderSummary[] {
  return providers
    .map((provider) => scoreProviderForCriteria(provider, criteria))
    .sort((left, right) => {
      const scoreDelta = right.fitScore - left.fitScore;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.id - right.id;
    });
}

export function scoreProviderForCriteria(
  provider: ProviderSummary,
  criteria: ProviderFitCriteria,
): ScoredProviderSummary {
  let score = 50;
  const warnings: string[] = [];
  const tags: string[] = [];
  const providerText = buildProviderText(provider);
  const providerEventText = normalizeText((provider.eventTypes ?? []).join(' '));
  const criteriaEvent = normalizeText(criteria.eventType);
  const criteriaNeed = normalizeText(criteria.needCategory);

  const budget = scoreBudgetFit(provider.priceLevel, criteria.budgetTier);
  score += budget.score;
  if (budget.warning) warnings.push(budget.warning);
  if (budget.tag) tags.push(budget.tag);

  const event = scoreEventFit(providerEventText, providerText, criteriaEvent);
  score += event.score;
  if (event.warning) warnings.push(event.warning);
  if (event.tag) tags.push(event.tag);

  const need = scoreNeedFit(providerText, normalizeText(provider.category), criteriaNeed);
  score += need.score;
  if (need.warning) warnings.push(need.warning);
  if (need.tag) tags.push(need.tag);

  const preferences = scoreTextMatches(providerText, criteria.mustHave, 'preference_match');
  score += preferences.score;
  tags.push(...preferences.tags);

  const constraints = scoreTextMatches(providerText, criteria.shouldAvoid, 'constraint_risk');
  score -= constraints.score;
  if (constraints.tags.length > 0) {
    tags.push(...constraints.tags);
    warnings.push('La ficha contiene una señal que el usuario quería evitar.');
  }

  return {
    ...provider,
    reason: buildRationale(provider, criteria, warnings),
    fitScore: clampScore(score),
    fitWarnings: dedupe(warnings),
    fitTags: dedupe(tags),
  };
}

function scoreBudgetFit(
  priceLevel: string | null | undefined,
  budgetTier: BudgetTier,
): { score: number; warning: string | null; tag: string | null } {
  if (!priceLevel || budgetTier === 'unknown') {
    return { score: 0, warning: null, tag: null };
  }

  const price = priceLevel.trim();
  const expensive = price.length >= 4;
  const mediumHigh = price.length === 3;
  const accessible = price.length <= 2;

  if (budgetTier === 'very_low' && expensive) {
    return { score: -35, warning: 'Precio muy alto para el presupuesto indicado.', tag: 'budget_risk' };
  }
  if (budgetTier === 'very_low' && mediumHigh) {
    return { score: -18, warning: 'Precio medio-alto para un presupuesto muy ajustado.', tag: 'budget_risk' };
  }
  if (budgetTier === 'low' && expensive) {
    return { score: -25, warning: 'Precio alto para el presupuesto indicado.', tag: 'budget_risk' };
  }
  if ((budgetTier === 'very_low' || budgetTier === 'low') && accessible) {
    return { score: 18, warning: null, tag: 'budget_match' };
  }

  return { score: 0, warning: null, tag: null };
}

function scoreEventFit(
  providerEventText: string,
  providerText: string,
  criteriaEvent: string,
): { score: number; warning: string | null; tag: string | null } {
  if (!criteriaEvent) {
    return { score: 0, warning: null, tag: null };
  }

  if (hasAny(providerEventText, ['others', 'otros', 'eventos', 'events', 'social'])) {
    return { score: 14, warning: null, tag: 'event_match' };
  }
  if (hasAny(providerEventText, eventSynonyms(criteriaEvent))) {
    return { score: 20, warning: null, tag: 'event_match' };
  }

  if (hasAny(providerEventText, ['wedding', 'boda', 'matrimonio']) && !hasAny(criteriaEvent, ['boda', 'matrimonio', 'wedding'])) {
    return { score: -25, warning: 'Proveedor orientado principalmente a bodas.', tag: 'event_mismatch' };
  }

  if (hasAny(providerText, eventSynonyms(criteriaEvent))) {
    return { score: 8, warning: null, tag: 'event_match' };
  }

  return { score: 0, warning: null, tag: null };
}

function scoreNeedFit(
  providerText: string,
  providerCategory: string,
  criteriaNeed: string,
): { score: number; warning: string | null; tag: string | null } {
  if (!criteriaNeed) {
    return { score: 0, warning: null, tag: null };
  }

  const needTerms = needSynonyms(criteriaNeed);
  if (hasAny(providerCategory, needTerms) || hasAny(providerText, needTerms)) {
    return { score: 24, warning: null, tag: 'need_match' };
  }

  if (hasAny(criteriaNeed, ['catering', 'comida']) && hasAny(providerText, ['torta', 'pasteleria', 'cake', 'postre'])) {
    return { score: -16, warning: 'La ficha parece más enfocada en postres que en comida principal.', tag: 'need_mismatch' };
  }

  return { score: -8, warning: null, tag: 'need_uncertain' };
}

function scoreTextMatches(
  providerText: string,
  values: string[],
  tag: string,
): { score: number; tags: string[] } {
  const matches = values.filter((value) => {
    const normalized = normalizeText(value);
    return normalized.length >= 3 && providerText.includes(normalized);
  });

  return {
    score: Math.min(matches.length * 6, 18),
    tags: matches.length > 0 ? [tag] : [],
  };
}

function buildProviderText(provider: ProviderSummary): string {
  return normalizeText([
    provider.title,
    provider.category ?? '',
    provider.descriptionSnippet ?? '',
    provider.description ?? '',
    provider.serviceHighlights.join(' '),
    provider.termsHighlights.join(' '),
    provider.promoBadge ?? '',
    provider.promoSummary ?? '',
  ].join(' '));
}

function buildRationale(
  provider: ProviderSummary,
  criteria: ProviderFitCriteria,
  warnings: string[],
): string {
  const need = criteria.needCategory ?? 'la necesidad solicitada';
  if (warnings.length > 0) {
    return `${provider.title} puede servir para ${need}, pero ${warnings[0].toLowerCase()}`;
  }
  return `${provider.title} encaja con ${need} según su ficha y señales de precio/evento.`;
}

function eventSynonyms(eventType: string): string[] {
  if (hasAny(eventType, ['cumple', 'birthday'])) {
    return ['cumple', 'cumpleanos', 'birthday', 'fiesta', 'celebracion'];
  }
  if (hasAny(eventType, ['boda', 'matrimonio', 'wedding'])) {
    return ['boda', 'matrimonio', 'wedding', 'novios'];
  }
  if (hasAny(eventType, ['corporativo', 'empresa', 'corporate'])) {
    return ['corporativo', 'empresa', 'corporate'];
  }
  return eventType.split(' ').filter(Boolean);
}

function needSynonyms(need: string): string[] {
  if (hasAny(need, ['catering', 'comida', 'gastronomia'])) {
    return ['catering', 'comida', 'gastronomia', 'buffet', 'restaurante', 'tablas', 'quesos', 'cena', 'almuerzo'];
  }
  if (hasAny(need, ['foto', 'fotografia', 'video'])) {
    return ['foto', 'fotografia', 'fotografo', 'video', 'audiovisual'];
  }
  if (hasAny(need, ['musica', 'dj'])) {
    return ['musica', 'dj', 'banda', 'orquesta'];
  }
  return need.split(' ').filter(Boolean);
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(normalizeText(term)));
}

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
