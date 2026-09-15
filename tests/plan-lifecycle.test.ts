import { describe, expect, it } from 'vitest';

import {
  createEmptyPlan,
  mergePlan,
  planSchema,
  replaceProviderNeeds,
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
    expect(parsed.contact_phone_extension).toBeNull();
    expect(parsed.contact_phone_number).toBeNull();
    expect(parsed.user_auth.auth_method).toBeNull();
    expect(parsed.user_auth.awaiting_phone_confirmation).toBe(false);
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

  it('never keeps active focus on a deferred need', () => {
    const base = createEmptyPlan({
      planId: 'p-defer-focus',
      channel: 'terminal_whatsapp',
      externalUserId: 'u-defer-focus',
    });
    const deferredCatering = {
      category: 'Catering' as const,
      status: 'deferred' as const,
      preferences: [],
      hard_constraints: [],
      missing_fields: [],
      recommended_provider_ids: [],
      recommended_providers: [],
      selected_provider_ids: [],
      selected_provider_hints: [],
    };
    const selectedPhoto = {
      category: 'Fotografía y video' as const,
      status: 'selected' as const,
      preferences: [],
      hard_constraints: [],
      missing_fields: [],
      recommended_provider_ids: [90],
      recommended_providers: [],
      selected_provider_ids: [90],
      selected_provider_hints: ['Carlos Schult'],
    };

    // Requesting a deferred category falls back to the first non-deferred
    // need instead of foregrounding the deferred one.
    const diverted = replaceProviderNeeds(
      base,
      [deferredCatering, selectedPhoto],
      'Catering' as never,
    );
    expect(diverted.active_need_category).toBe('Fotografía y video');

    // A non-deferred request is untouched.
    const kept = replaceProviderNeeds(
      base,
      [selectedPhoto, deferredCatering],
      'Fotografía y video' as never,
    );
    expect(kept.active_need_category).toBe('Fotografía y video');

    // Every need deferred clears focus instead of pointing at one.
    const cleared = replaceProviderNeeds(base, [deferredCatering], 'Catering' as never);
    expect(cleared.active_need_category).toBeNull();
  });
});
