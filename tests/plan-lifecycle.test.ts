import { describe, expect, it } from 'vitest';

import {
  createEmptyPlan,
  mergePlan,
  planSchema,
} from '../src/core/plan';

describe('plan lifecycle', () => {
  it('defaults lifecycle fields when parsing legacy-shaped objects', () => {
    const parsed = planSchema.parse({
      plan_id: 'p1',
      channel: 'terminal_whatsapp',
      external_user_id: 'u1',
      conversation_id: null,
      current_node: 'entrevista',
      intent: null,
      intent_confidence: null,
      event_type: null,
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
    });

    expect(parsed.lifecycle_state).toBe('active');
    expect(parsed.contact_name).toBeNull();
    expect(parsed.contact_email).toBeNull();
  });

  it('records finish contact fields and finished state', () => {
    const base = createEmptyPlan({
      planId: 'p2',
      channel: 'terminal_whatsapp',
      externalUserId: 'u2',
    });
    const finished = mergePlan(base, {
      lifecycle_state: 'finished',
      contact_name: 'Test User',
      contact_email: 'test@example.com',
      current_node: 'necesidad_cubierta',
    });

    expect(finished.lifecycle_state).toBe('finished');
    expect(finished.contact_name).toBe('Test User');
    expect(finished.contact_email).toBe('test@example.com');
  });

  it('appends and deduplicates selected providers for a need', () => {
    const base = mergePlan(
      createEmptyPlan({
        planId: 'p3',
        channel: 'terminal_whatsapp',
        externalUserId: 'u3',
      }),
      {
        active_need_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1, 2],
            recommended_providers: [],
            selected_provider_ids: [1],
            selected_provider_hints: ['EDO'],
          },
        ],
      },
    );

    const updated = mergePlan(base, {
      provider_needs: [
        {
          category: 'Catering',
          status: 'selected',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [1, 2],
          recommended_providers: [],
          selected_provider_ids: [1, 2],
          selected_provider_hints: ['EDO', 'Dulcefina'],
        },
      ],
    });

    expect(updated.provider_needs[0]?.selected_provider_ids).toEqual([1, 2]);
    expect(updated.provider_needs[0]?.selected_provider_hints).toEqual([
      'EDO',
      'Dulcefina',
    ]);
    expect(updated.provider_needs[0]?.status).toBe('selected');
  });

  it('preserves selected providers on unrelated need changes', () => {
    const base = mergePlan(
      createEmptyPlan({
        planId: 'p4',
        channel: 'terminal_whatsapp',
        externalUserId: 'u4',
      }),
      {
        active_need_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [],
            selected_provider_ids: [1],
            selected_provider_hints: ['EDO'],
          },
        ],
      },
    );

    const updated = mergePlan(base, {
      active_need_category: 'Música',
      provider_needs: [
        {
          category: 'Música',
          status: 'identified',
          preferences: ['dj'],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [],
          recommended_providers: [],
          selected_provider_ids: [],
          selected_provider_hints: [],
        },
      ],
    });

    const cateringNeed = updated.provider_needs.find((need) => need.category === 'Catering');
    expect(cateringNeed?.selected_provider_ids).toEqual([1]);
  });

  it('clears selected providers when a replacement shortlist is stored', () => {
    const base = mergePlan(
      createEmptyPlan({
        planId: 'p5',
        channel: 'terminal_whatsapp',
        externalUserId: 'u5',
      }),
      {
        active_need_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [],
            selected_provider_ids: [1],
            selected_provider_hints: ['EDO'],
          },
        ],
      },
    );

    const updated = mergePlan(base, {
      provider_needs: [
        {
          category: 'Catering',
          status: 'shortlisted',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [2],
          recommended_providers: [],
          selected_provider_ids: [],
          selected_provider_hints: [],
        },
      ],
    });

    expect(updated.provider_needs[0]?.selected_provider_ids).toEqual([]);
    expect(updated.provider_needs[0]?.status).toBe('shortlisted');
  });
});
