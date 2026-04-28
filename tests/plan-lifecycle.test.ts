import { describe, expect, it } from 'vitest';

import {
  createEmptyPlan,
  FINISHED_PLAN_TTL_SECONDS,
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
      selected_provider_id: null,
      selected_provider_hint: null,
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

  it('exposes a 24h TTL constant for finished plans', () => {
    expect(FINISHED_PLAN_TTL_SECONDS).toBe(86_400);
  });
});
