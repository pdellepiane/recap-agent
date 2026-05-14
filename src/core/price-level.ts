import { z } from 'zod';

export const priceLevelValues = ['low', 'mid', 'high', 'very_high'] as const;

export type PriceLevel = (typeof priceLevelValues)[number];

export const priceLevelSchema = z.enum(priceLevelValues);

export function normalizeToPriceLevel(value: string | null | undefined): PriceLevel | null {
  if (!value) return null;
  const normalized = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const compact = normalized.replace(/\s/g, '');
  if (compact === '$') return 'low';
  if (compact === '$$') return 'mid';
  if (compact === '$$$') return 'high';
  if (compact === '$$$$') return 'very_high';

  const labelMap: Record<string, PriceLevel> = {
    low: 'low',
    bajo: 'low',
    baja: 'low',
    barato: 'low',
    economico: 'low',
    accesible: 'low',
    mid: 'mid',
    medio: 'mid',
    media: 'mid',
    moderado: 'mid',
    moderada: 'mid',
    intermedio: 'mid',
    high: 'high',
    alto: 'high',
    alta: 'high',
    premium: 'very_high',
    lujo: 'very_high',
    exclusivo: 'very_high',
    exclusiva: 'very_high',
    muyalto: 'very_high',
    veryhigh: 'very_high',
    very_high: 'very_high',
  };

  return labelMap[compact] ?? null;
}

export function formatPriceLevel(value: PriceLevel | null | undefined): string | null {
  switch (value) {
    case 'low':
      return '$';
    case 'mid':
      return '$$';
    case 'high':
      return '$$$';
    case 'very_high':
      return '$$$$';
    default:
      return null;
  }
}
