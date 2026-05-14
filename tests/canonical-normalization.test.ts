import { describe, expect, it } from 'vitest';

import { decisionNodeSchema } from '../src/core/decision-nodes';
import { normalizeToEventType } from '../src/core/event-type';
import { locationCountryKey, locationKey } from '../src/core/location';
import { planSchema } from '../src/core/plan';
import { normalizeToPriceLevel } from '../src/core/price-level';
import { providerSummarySchema } from '../src/core/provider';

describe('canonical normalization', () => {
  it('normalizes event types to canonical ids', () => {
    expect(normalizeToEventType('matrimonio')).toBe('boda');
    expect(normalizeToEventType('cumpleaños')).toBe('cumpleanos');
    expect(normalizeToEventType('baby shower')).toBe('baby_shower');
    expect(normalizeToEventType('15 años')).toBe('quinceanos');
    expect(normalizeToEventType('')).toBeNull();
  });

  it('normalizes price levels to logic ids', () => {
    expect(normalizeToPriceLevel('$')).toBe('low');
    expect(normalizeToPriceLevel('$$')).toBe('mid');
    expect(normalizeToPriceLevel('$$$')).toBe('high');
    expect(normalizeToPriceLevel('$$$$')).toBe('very_high');
    expect(normalizeToPriceLevel('premium')).toBe('very_high');
    expect(normalizeToPriceLevel('desconocido')).toBeNull();
  });

  it('normalizes location keys country-first', () => {
    expect(locationKey('Lima, Perú')).toBe('lima peru');
    expect(locationCountryKey('Miraflores, Lima')).toBe('peru');
    expect(locationCountryKey('Querétaro, México')).toBe('mexico');
    expect(locationCountryKey('Madrid')).toBeNull();
  });
});

describe('strict canonical schemas', () => {
  it('rejects invalid decision nodes', () => {
    expect(decisionNodeSchema.safeParse('recomendar').success).toBe(true);
    expect(decisionNodeSchema.safeParse('recomendar ').success).toBe(false);
  });

  it('rejects non-canonical provider summary fields', () => {
    expect(providerSummarySchema.safeParse({
      id: 1,
      title: 'Proveedor',
      category: 'Catering',
      priceLevel: 'mid',
      serviceHighlights: [],
      termsHighlights: [],
    }).success).toBe(true);

    expect(providerSummarySchema.safeParse({
      id: 1,
      title: 'Proveedor',
      category: 'catering',
      priceLevel: '$$',
      serviceHighlights: [],
      termsHighlights: [],
    }).success).toBe(false);
  });

  it('rejects non-canonical plan event types', () => {
    const basePlan = {
      plan_id: 'plan-1',
      channel: 'terminal_whatsapp',
      external_user_id: 'user-1',
      conversation_id: null,
      lifecycle_state: 'active',
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      current_node: 'entrevista',
      intent: null,
      intent_confidence: null,
      event_type: 'boda',
      vendor_category: null,
      active_need_category: null,
      location: null,
      budget_signal: null,
      guest_range: null,
      preferences: [],
      hard_constraints: [],
      missing_fields: [],
      provider_needs: [],
      recommended_provider_ids: [],
      recommended_providers: [],
      selected_provider_ids: [],
      selected_provider_hints: [],
      assumptions: [],
      conversation_summary: '',
      last_user_goal: null,
      open_questions: [],
      updated_at: new Date(0).toISOString(),
    };

    expect(planSchema.safeParse(basePlan).success).toBe(true);
    expect(planSchema.safeParse({ ...basePlan, event_type: 'matrimonio' }).success).toBe(false);
  });
});
