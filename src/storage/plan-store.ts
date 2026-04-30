import type { PlanSnapshot } from '../core/plan';

export type SavePlanInput = {
  plan: PlanSnapshot;
  reason: string;
};

export interface PlanStore {
  getByExternalUser(channel: string, externalUserId: string): Promise<PlanSnapshot | null>;
  save(input: SavePlanInput): Promise<void>;
}
