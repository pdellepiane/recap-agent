import { mergePlan, type PlanSnapshot } from '../core/plan';
import { resolveResumeNode } from '../core/decision-flow';
import type { PlanStore } from '../storage/plan-store';

export type ResumeAutomatedAgentResult =
  | { status: 'plan_not_found' }
  | {
      status: 'resumed' | 'already_active';
      plan: PlanSnapshot;
    };

export type OvertakeConversationResult =
  | { status: 'plan_not_found' }
  | {
      status: 'overtaken' | 'already_overtaken';
      plan: PlanSnapshot;
    };

export class AgentParticipationService {
  constructor(private readonly planStore: PlanStore) {}

  async resumeAutomatedAgent(args: {
    channel: string;
    externalUserId: string;
  }): Promise<ResumeAutomatedAgentResult> {
    const plan = await this.planStore.getByExternalUser(args.channel, args.externalUserId);
    if (!plan) {
      return { status: 'plan_not_found' };
    }
    if (plan.human_escalation.status !== 'requested') {
      return { status: 'already_active', plan };
    }

    const resumedPlan = mergePlan(plan, {
      current_node: resolveResumeNode(plan),
      intent: 'retomar_plan',
      human_escalation: {
        status: 'none',
        requested_at: null,
        phone_number: null,
        last_error: null,
      },
    });
    await this.planStore.save({
      plan: resumedPlan,
      reason: 'crm_resume_automated_agent',
    });
    return { status: 'resumed', plan: resumedPlan };
  }

  async overtakeConversation(args: {
    channel: string;
    externalUserId: string;
    requestedAt?: string;
  }): Promise<OvertakeConversationResult> {
    const plan = await this.planStore.getByExternalUser(args.channel, args.externalUserId);
    if (!plan) {
      return { status: 'plan_not_found' };
    }
    if (plan.human_escalation.status === 'requested') {
      return { status: 'already_overtaken', plan };
    }

    const overtakenPlan = mergePlan(plan, {
      current_node: 'solicitar_agente_humano',
      intent: 'solicitar_humano',
      human_escalation: {
        status: 'requested',
        requested_at: args.requestedAt ?? new Date().toISOString(),
        phone_number: plan.contact_phone,
        last_error: null,
      },
    });
    await this.planStore.save({
      plan: overtakenPlan,
      reason: 'crm_overtake_conversation',
    });
    return { status: 'overtaken', plan: overtakenPlan };
  }
}
