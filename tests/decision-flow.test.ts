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
});
