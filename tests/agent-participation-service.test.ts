import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { AgentParticipationService } from '../src/runtime/agent-participation-service';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

describe('AgentParticipationService', () => {
  it('resumes a paused agent and clears the human escalation state', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed_human_escalation',
      plan: mergePlan(createEmptyPlan({
        planId: 'plan-resume',
        channel: 'whatsapp',
        externalUserId: 'whatsapp:51999999999',
      }), {
        current_node: 'solicitar_agente_humano',
        intent: 'solicitar_humano',
        human_escalation: {
          status: 'requested',
          requested_at: '2026-07-15T18:00:00.000Z',
          phone_number: '51999999999',
          last_error: null,
        },
      }),
    });

    const service = new AgentParticipationService(planStore);
    const result = await service.resumeAutomatedAgent({
      channel: 'whatsapp',
      externalUserId: 'whatsapp:51999999999',
    });

    expect(result.status).toBe('resumed');
    if (result.status !== 'resumed') {
      throw new Error('Expected the automated agent to resume.');
    }
    expect(result.plan.current_node).toBe('entrevista');
    expect(result.plan.intent).toBe('retomar_plan');
    expect(result.plan.human_escalation).toEqual({
      status: 'none',
      requested_at: null,
      phone_number: null,
      last_error: null,
    });
  });

  it('is idempotent when the automated agent is already active', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed_active',
      plan: createEmptyPlan({
        planId: 'plan-active',
        channel: 'whatsapp',
        externalUserId: 'whatsapp:51999999999',
      }),
    });
    const result = await new AgentParticipationService(planStore).resumeAutomatedAgent({
      channel: 'whatsapp',
      externalUserId: 'whatsapp:51999999999',
    });
    expect(result.status).toBe('already_active');
  });

  it('reports a missing plan without creating one', async () => {
    const result = await new AgentParticipationService(
      new InMemoryPlanStore(),
    ).resumeAutomatedAgent({
      channel: 'whatsapp',
      externalUserId: 'whatsapp:51999999999',
    });
    expect(result).toEqual({ status: 'plan_not_found' });
  });
});
