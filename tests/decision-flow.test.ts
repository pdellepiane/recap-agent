import { describe, expect, it } from 'vitest';

import { resolveResumeNode } from '../src/core/decision-flow';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

describe('resolveResumeNode', () => {
  it('keeps finished plans at necesidad_cubierta', () => {
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'p-finished',
        channel: 'terminal_whatsapp',
        externalUserId: 'u-finished',
      }),
      {
        current_node: 'necesidad_cubierta',
        lifecycle_state: 'finished',
      },
    );

    expect(resolveResumeNode(plan)).toBe('necesidad_cubierta');
  });

  it('resumes paused plans in entrevista', () => {
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'p-paused',
        channel: 'terminal_whatsapp',
        externalUserId: 'u-paused',
      }),
      {
        current_node: 'guardar_cerrar_temporalmente',
      },
    );

    expect(resolveResumeNode(plan)).toBe('entrevista');
  });

  it('keeps invited event lookup plans in the invited event node for follow-ups', () => {
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'p-invited-event',
        channel: 'terminal_whatsapp',
        externalUserId: 'u-invited-event',
      }),
      {
        current_node: 'consultar_evento_invitado',
        intent: 'consultar_evento_invitado',
        contact_email: 'paolo.delepias@gmail.com',
      },
    );

    expect(resolveResumeNode(plan)).toBe('consultar_evento_invitado');
  });

  it('falls back to entrevista when the active need has no_providers_available', () => {
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'p-unavailable',
        channel: 'terminal_whatsapp',
        externalUserId: 'u-unavailable',
      }),
      {
        current_node: 'refinar_criterios',
        active_need_category: 'Wedding planners',
        provider_needs: [
          {
            category: 'Wedding planners',
            status: 'no_providers_available',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [],
            recommended_providers: [],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    expect(resolveResumeNode(plan)).toBe('entrevista');
  });
});
