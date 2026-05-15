import type { EventType } from './event-type';
import type { ProviderCategory } from './provider-category';

export const eventTypeProviderPriorityMap: Record<EventType, ProviderCategory[]> = {
  boda: [
    'Locales',
    'Catering',
    'Fotografía y video',
    'Música',
    'Florería y papelería',
    'Wedding planners',
    'Hogar y deco',
    'Licores',
    'Maquillaje',
  ],
  cumpleanos: [
    'Locales',
    'Catering',
    'Música',
    'Fotografía y video',
    'Hogar y deco',
    'Licores',
    'Baile',
  ],
  corporativo: [
    'Locales',
    'Catering',
    'Fotografía y video',
    'Música',
    'Hogar y deco',
    'Otros',
  ],
  baby_shower: [
    'Locales',
    'Catering',
    'Bebés',
    'Florería y papelería',
    'Fotografía y video',
    'Hogar y deco',
  ],
  graduacion: [
    'Locales',
    'Catering',
    'Música',
    'Fotografía y video',
    'Licores',
    'Baile',
  ],
  bautizo: [
    'Locales',
    'Catering',
    'Fotografía y video',
    'Florería y papelería',
    'Hogar y deco',
  ],
  aniversario: [
    'Locales',
    'Catering',
    'Fotografía y video',
    'Música',
    'Florería y papelería',
    'Viajes',
  ],
  quinceanos: [
    'Locales',
    'Catering',
    'Música',
    'Fotografía y video',
    'Vestidos',
    'Maquillaje',
    'Baile',
    'Hogar y deco',
  ],
  otro: [
    'Locales',
    'Catering',
    'Fotografía y video',
    'Música',
    'Hogar y deco',
  ],
};

export const defaultStarterNeedCount = 5;

export function prioritizedProviderCategoriesForEvent(
  eventType: EventType | null | undefined,
): ProviderCategory[] {
  return eventTypeProviderPriorityMap[eventType ?? 'otro'];
}

export function starterProviderCategoriesForEvent(
  eventType: EventType | null | undefined,
  limit = defaultStarterNeedCount,
): ProviderCategory[] {
  return prioritizedProviderCategoriesForEvent(eventType).slice(0, limit);
}
