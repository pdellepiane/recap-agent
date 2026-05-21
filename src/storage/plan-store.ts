import type { PlanSnapshot } from '../core/plan';
import type { SessionFocus } from '../core/turn-decision';

export type SavePlanInput = {
  plan: PlanSnapshot;
  reason: string;
};

export interface PlanStore {
  getByExternalUser(channel: string, externalUserId: string): Promise<PlanSnapshot | null>;
  getSessionFocus?(
    channel: string,
    externalUserId: string,
    sessionId: string,
  ): Promise<SessionFocus | null>;
  save(input: SavePlanInput): Promise<void>;
  saveSessionFocus?(
    channel: string,
    externalUserId: string,
    focus: SessionFocus,
  ): Promise<void>;
}
