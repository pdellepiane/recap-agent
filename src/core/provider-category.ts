import { z } from 'zod';

export const providerCategoryValues = [
  'Accesorios y zapatos',
  'Catering',
  'Hogar y deco',
  'Florería y papelería',
  'Fotografía y video',
  'Maquillaje',
  'Música',
  'Vestidos',
  'Wedding planners',
  'Otros',
  'Bebés',
  'Salud y belleza',
  'Ternos y camisas',
  'Baile',
  'Viajes',
  'Locales',
  'Licores',
] as const;

export type ProviderCategory = (typeof providerCategoryValues)[number];

export const providerCategorySchema = z.enum(providerCategoryValues);

export function isProviderCategory(value: string): value is ProviderCategory {
  return providerCategoryValues.includes(value as ProviderCategory);
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeForComparison(value: string): string {
  return stripDiacritics(value).toLowerCase().trim();
}

/**
 * Normalize a free-form category string to the canonical ProviderCategory.
 * Handles official API display names (with diacritics, case variations)
 * and known legacy synonyms so old plans and API responses map cleanly.
 */
export function normalizeToProviderCategory(
  value: string | null | undefined,
): ProviderCategory | null {
  if (!value) return null;
  const normalized = normalizeForComparison(value);
  if (!normalized) return null;

  // Direct match against canonical values (diacritic-insensitive, case-insensitive)
  for (const canonical of providerCategoryValues) {
    if (normalized === normalizeForComparison(canonical)) {
      return canonical;
    }
  }

  // Legacy synonym mapping for old plans and user expressions.
  // Each key is a normalized (diacritic-free, lowercased) synonym.
  const synonymMap: Record<string, ProviderCategory> = {
    'foto': 'Fotografía y video',
    'fotografia': 'Fotografía y video',
    'fotografo': 'Fotografía y video',
    'fotografa': 'Fotografía y video',
    'video': 'Fotografía y video',
    'local': 'Locales',
    'venue': 'Locales',
    'salon': 'Locales',
    'locacion': 'Locales',
    'recepcion': 'Locales',
    'flor': 'Florería y papelería',
    'flores': 'Florería y papelería',
    'floreria': 'Florería y papelería',
    'papeleria': 'Florería y papelería',
    'invitaciones': 'Florería y papelería',
    'deco': 'Hogar y deco',
    'decoracion': 'Hogar y deco',
    'hogar': 'Hogar y deco',
    'muebles': 'Hogar y deco',
    'menaje': 'Hogar y deco',
    'planner': 'Wedding planners',
    'wedding planner': 'Wedding planners',
    'organizador': 'Wedding planners',
    'coordinador': 'Wedding planners',
    'bar': 'Licores',
    'barra': 'Licores',
    'tragos': 'Licores',
    'cocktails': 'Licores',
    'dj': 'Música',
    'banda': 'Música',
    'coro': 'Música',
    'novia': 'Vestidos',
    'sastre': 'Ternos y camisas',
    'camisa': 'Ternos y camisas',
    'baby shower': 'Bebés',
    'spa': 'Salud y belleza',
    'clinica': 'Salud y belleza',
    'belleza': 'Salud y belleza',
    'salud': 'Salud y belleza',
    'makeup': 'Maquillaje',
    'peinado': 'Maquillaje',
    'zapatos': 'Accesorios y zapatos',
    'accesorios': 'Accesorios y zapatos',
    'mesa gastronomica': 'Catering',
    'gastronomia': 'Catering',
    'comida': 'Catering',
    'buffet': 'Catering',
    'zapatillas': 'Accesorios y zapatos',
  };

  for (const [synonym, canonical] of Object.entries(synonymMap)) {
    if (normalized === synonym) {
      return canonical;
    }
  }

  return null;
}
