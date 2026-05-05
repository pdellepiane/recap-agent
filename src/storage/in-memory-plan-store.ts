import { normalizeRawPlan, planSchema, type PlanSnapshot } from '../core/plan';
import type { PlanStore, SavePlanInput } from './plan-store';

export class InMemoryPlanStore implements PlanStore {
  private readonly items = new Map<string, PlanSnapshot>();

  async getByExternalUser(
    channel: string,
    externalUserId: string,
  ): Promise<PlanSnapshot | null> {
    return this.items.get(this.key(channel, externalUserId)) ?? null;
  }

  async save(input: SavePlanInput): Promise<void> {
    const parsed = planSchema.parse(normalizeRawPlan(input.plan)) as PlanSnapshot;
    this.items.set(this.key(parsed.channel, parsed.external_user_id), parsed);
  }

  private key(channel: string, externalUserId: string): string {
    return `${channel}#${externalUserId}`;
  }
}

