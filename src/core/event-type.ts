import { z } from 'zod';

export const eventTypeValues = [
  'boda',
  'cumpleanos',
  'corporativo',
  'baby_shower',
  'graduacion',
  'bautizo',
  'aniversario',
  'quinceanos',
  'otro',
] as const;

export type EventType = (typeof eventTypeValues)[number];

export const eventTypeSchema = z.enum(eventTypeValues);

export const eventTypeLabelsEs: Record<EventType, string> = {
  boda: 'boda',
  cumpleanos: 'cumpleaños',
  corporativo: 'evento corporativo',
  baby_shower: 'baby shower',
  graduacion: 'graduación',
  bautizo: 'bautizo',
  aniversario: 'aniversario',
  quinceanos: 'quinceaños',
  otro: 'otro evento',
};

export const eventTypeRecommendationHintsEs: Record<EventType, string[]> = {
  boda: ['prioriza proveedores con experiencia en bodas, logística formal y coordinación de múltiples frentes'],
  cumpleanos: ['prioriza proveedores flexibles para celebraciones sociales y grupos del tamaño indicado'],
  corporativo: ['prioriza proveedores con manejo de eventos corporativos, puntualidad y presentación profesional'],
  baby_shower: ['prioriza proveedores adecuados para celebraciones familiares, delicadas y de escala íntima o media'],
  graduacion: ['prioriza proveedores para celebraciones sociales con grupos grandes y producción ágil'],
  bautizo: ['prioriza proveedores para celebraciones familiares, sobrias y de escala íntima o media'],
  aniversario: ['prioriza proveedores para celebraciones personales, memorables y cuidadas en detalles'],
  quinceanos: ['prioriza proveedores para celebraciones sociales con producción, música, foto y experiencia de fiesta'],
  otro: ['prioriza proveedores alineados a la necesidad activa y a las restricciones explícitas del usuario'],
};

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeForComparison(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeToEventType(value: string | null | undefined): EventType | null {
  if (!value) return null;
  const normalized = normalizeForComparison(value);
  if (!normalized) return null;

  const synonymMap: Record<string, EventType> = {
    boda: 'boda',
    bodas: 'boda',
    matrimonio: 'boda',
    matrimonios: 'boda',
    wedding: 'boda',
    cumple: 'cumpleanos',
    cumpleanos: 'cumpleanos',
    birthday: 'cumpleanos',
    corporativo: 'corporativo',
    corporativa: 'corporativo',
    empresa: 'corporativo',
    empresarial: 'corporativo',
    corporate: 'corporativo',
    'baby shower': 'baby_shower',
    shower: 'baby_shower',
    graduacion: 'graduacion',
    graduaciones: 'graduacion',
    promocion: 'graduacion',
    bautizo: 'bautizo',
    bautismo: 'bautizo',
    aniversario: 'aniversario',
    aniversarios: 'aniversario',
    quince: 'quinceanos',
    quinceanos: 'quinceanos',
    quinceanero: 'quinceanos',
    quinceanera: 'quinceanos',
    '15 anos': 'quinceanos',
    otro: 'otro',
    otros: 'otro',
    evento: 'otro',
  };

  if (normalized in synonymMap) {
    return synonymMap[normalized] ?? null;
  }

  for (const [synonym, eventType] of Object.entries(synonymMap)) {
    if (normalized.includes(synonym)) {
      return eventType;
    }
  }

  return null;
}

export function eventTypeLabelEs(value: EventType | null | undefined): string | null {
  return value ? eventTypeLabelsEs[value] : null;
}
