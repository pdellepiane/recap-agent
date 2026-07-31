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

  it('keeps pending information work in the information resolver', () => {
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'p-invited-event',
        channel: 'terminal_whatsapp',
        externalUserId: 'u-invited-event',
      }),
      {
        current_node: 'resolver_consultas_informativas',
        intent: null,
        contact_email: 'paolo.delepias@gmail.com',
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [
            {
              requestId: 'information-1',
              kind: 'associated_event',
              query: 'Consulta el evento asociado.',
              eventHint: null,
            },
          ],
          selection_candidates: [],
        },
      },
    );

    expect(resolveResumeNode(plan)).toBe('resolver_consultas_informativas');
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
