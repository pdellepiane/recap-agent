import { normalizeRawPlan, planSchema, type PlanSnapshot } from '../core/plan';
import { sessionFocusSchema, type SessionFocus } from '../core/turn-decision';
import type { PlanStore, SavePlanInput } from './plan-store';

export class InMemoryPlanStore implements PlanStore {
  private readonly items = new Map<string, PlanSnapshot>();
  private readonly sessionFocusItems = new Map<string, SessionFocus>();

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

  async getSessionFocus(
    channel: string,
    externalUserId: string,
    sessionId: string,
  ): Promise<SessionFocus | null> {
    return this.sessionFocusItems.get(this.sessionFocusKey(channel, externalUserId, sessionId)) ?? null;
  }

  async saveSessionFocus(
    channel: string,
    externalUserId: string,
    focus: SessionFocus,
  ): Promise<void> {
    const parsed = sessionFocusSchema.parse(focus);
    this.sessionFocusItems.set(this.sessionFocusKey(channel, externalUserId, parsed.sessionId), parsed);
  }

  private key(channel: string, externalUserId: string): string {
    return `${channel}#${externalUserId}`;
  }

  private sessionFocusKey(channel: string, externalUserId: string, sessionId: string): string {
    return `${channel}#${externalUserId}#${sessionId}`;
  }
}
