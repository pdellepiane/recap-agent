import type { PlanSnapshot } from '../core/plan';
import type { SessionFocus } from '../core/turn-decision';

export type SavePlanInput = {
  plan: PlanSnapshot;
  reason: string;
};

export type FencedSavePlanInput = SavePlanInput & {
  /** Turn-lease owner for the conditional write; absent means unfenced save. */
  leaseOwnerId?: string;
  nowMs?: number;
};

export interface PlanStore {
  getByExternalUser(channel: string, externalUserId: string): Promise<PlanSnapshot | null>;
  getSessionFocus?(
    channel: string,
    externalUserId: string,
    sessionId: string,
  ): Promise<SessionFocus | null>;
  save(input: SavePlanInput): Promise<void>;
  /**
   * Packet B: lease-conditioned plan write. Implementations without fencing
   * support fall back to save. Used on the RSVP effect path so plan writes
   * under a lease carry the current lease condition.
   */
  saveFenced?(input: FencedSavePlanInput): Promise<void>;
  saveSessionFocus?(
    channel: string,
    externalUserId: string,
    focus: SessionFocus,
  ): Promise<void>;
}
