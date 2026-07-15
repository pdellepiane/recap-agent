import { mergePlan, type PlanSnapshot } from '../core/plan';
import { resolveResumeNode } from '../core/decision-flow';
import type { PlanStore } from '../storage/plan-store';

export type ResumeAutomatedAgentResult =
  | { status: 'plan_not_found' }
  | {
      status: 'resumed' | 'already_active';
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
}
