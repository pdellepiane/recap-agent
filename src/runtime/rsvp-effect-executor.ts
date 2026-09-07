import { isLeaseFenceSatisfied } from '../storage/turn-fencing';
import type {
  AgentConversationGateway,
  AgentEventDetailResult,
  AgentGuestRsvpResult,
} from './agent-conversation-gateway';
import type { RsvpTurnDecision } from './rsvp-decision-policy';

export type RsvpDurableStatus = 'no_write' | 'confirmed' | 'observed_state' | 'needs_help';

export type RsvpDurableOutcome = {
  readonly status: RsvpDurableStatus;
  readonly finalAttendance: 'attending' | 'declining' | null;
  readonly attemptedEffectCount: number;
  readonly stateReadCount: number;
  readonly successClaimAllowed: boolean;
  readonly needsHumanHelp: boolean;
  readonly observedWithoutAttribution: boolean;
  readonly persistedBeforeReply: boolean;
  readonly replayed: boolean;
  readonly saveError: 'result_save_failed' | 'intent_save_failed' | 'lease_fence_rejected' | null;
  readonly intentId: string;
  readonly messageId: string;
};

export type RsvpEffectLease = {
  readonly currentOwnerId: string | null;
  readonly ownerId: string;
  readonly nowMs: number;
  readonly expiresAtMs: number;
};

type GatewaySeam = Pick<AgentConversationGateway, 'guestRsvp' | 'getEventDetail'> & {
  readonly capabilityDescriptor?: {
    readonly 'rsvp.response.write'?: { readonly available?: boolean };
  };
};

export type RsvpEffectIntentRecord = {
  readonly intentId: string;
  readonly messageId: string;
  readonly guestId: number;
  readonly action: 'attending' | 'declining';
  readonly phoneExtension: string;
  readonly phoneNumber: string;
};

export interface RsvpEffectStore {
  saveIntent(intent: RsvpEffectIntentRecord): Promise<void>;
  saveResult(outcome: RsvpDurableOutcome): Promise<void>;
  loadByMessage(messageId: string): Promise<RsvpDurableOutcome | null>;
}

export class InMemoryRsvpEffectStore implements RsvpEffectStore {
  private readonly intents = new Map<string, RsvpEffectIntentRecord>();
  private readonly results = new Map<string, RsvpDurableOutcome>();
  private readonly byMessage = new Map<string, RsvpDurableOutcome>();
  private failNextResult = false;

  constructor(
    private readonly onIntent?: () => void,
    private readonly onResult?: () => void,
  ) {}

  failNextResultSave(): void {
    this.failNextResult = true;
  }

  loadResultSync(intentId: string): RsvpDurableOutcome | null {
    return this.results.get(intentId) ?? null;
  }

  async saveIntent(intent: RsvpEffectIntentRecord): Promise<void> {
    this.intents.set(intent.intentId, intent);
    this.onIntent?.();
  }

  async saveResult(outcome: RsvpDurableOutcome): Promise<void> {
    if (this.failNextResult) {
      this.failNextResult = false;
      throw new Error('rsvp result save failed');
    }
    this.results.set(outcome.intentId, outcome);
    this.byMessage.set(outcome.messageId, outcome);
    this.onResult?.();
  }

  async loadByMessage(messageId: string): Promise<RsvpDurableOutcome | null> {
    return this.byMessage.get(messageId) ?? null;
  }

  loadResultSyncByMessage(messageId: string): RsvpDurableOutcome | null {
    return this.byMessage.get(messageId) ?? null;
  }
}

export function replayPersistedRsvpOutcome(
  store: InMemoryRsvpEffectStore,
  messageId: string,
): RsvpDurableOutcome | null {
  return store.loadResultSyncByMessage(messageId);
}

function isTimeoutLike(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('unknown') ||
    normalized.includes('abort') ||
    normalized.includes('econn');
}

function fenceAllows(lease: RsvpEffectLease | undefined): boolean {
  if (!lease) {
    return true;
  }
  if (lease.currentOwnerId === null || lease.currentOwnerId.length === 0) {
    return false;
  }
  return isLeaseFenceSatisfied(
    { ownerId: lease.currentOwnerId, expiresAtMs: lease.expiresAtMs },
    lease.ownerId,
    lease.nowMs,
  );
}

function baseOutcome(args: {
  status: RsvpDurableStatus;
  finalAttendance: RsvpDurableOutcome['finalAttendance'];
  attempted: number;
  reads: number;
  success: boolean;
  help: boolean;
  observed: boolean;
  intentId: string;
  messageId: string;
}): RsvpDurableOutcome {
  return {
    status: args.status,
    finalAttendance: args.finalAttendance,
    attemptedEffectCount: args.attempted,
    stateReadCount: args.reads,
    successClaimAllowed: args.success,
    needsHumanHelp: args.help,
    observedWithoutAttribution: args.observed,
    persistedBeforeReply: true,
    replayed: false,
    saveError: null,
    intentId: args.intentId,
    messageId: args.messageId,
  };
}

export async function executeRsvpEffectDurably(args: {
  readonly decision: RsvpTurnDecision;
  readonly phone: { readonly phone_extension: string; readonly phone_number: string };
  readonly gateway: GatewaySeam;
  readonly store: RsvpEffectStore;
  readonly messageId: string;
  readonly intentId: string;
  readonly readEventId?: number | null;
  readonly lease?: RsvpEffectLease;
}): Promise<RsvpDurableOutcome> {
  const replayed = await args.store.loadByMessage(args.messageId);
  if (replayed) {
    return { ...replayed, replayed: true };
  }

  const requested = args.decision.requestedAction;
  const guestId = args.decision.candidateGuestId;
  if (!args.decision.shouldWrite || args.decision.outcome !== 'authorized_mutation' || requested === null || guestId === null) {
    return {
      ...baseOutcome({
        status: 'no_write',
        finalAttendance: null,
        attempted: 0,
        reads: 0,
        success: false,
        help: args.decision.needsHumanHelp,
        observed: false,
        intentId: args.intentId,
        messageId: args.messageId,
      }),
      persistedBeforeReply: false,
    };
  }

  if (!fenceAllows(args.lease)) {
    return {
      ...baseOutcome({
        status: 'needs_help',
        finalAttendance: null,
        attempted: 0,
        reads: 0,
        success: false,
        help: true,
        observed: false,
        intentId: args.intentId,
        messageId: args.messageId,
      }),
      persistedBeforeReply: false,
      saveError: 'lease_fence_rejected',
    };
  }

  const writeAvailable = args.gateway.capabilityDescriptor?.['rsvp.response.write']?.available ?? true;
  if (!args.gateway.guestRsvp || !writeAvailable) {
    return {
      ...baseOutcome({
        status: 'needs_help',
        finalAttendance: null,
        attempted: 0,
        reads: 0,
        success: false,
        help: true,
        observed: false,
        intentId: args.intentId,
        messageId: args.messageId,
      }),
      persistedBeforeReply: false,
    };
  }

  try {
    await args.store.saveIntent({
      intentId: args.intentId,
      messageId: args.messageId,
      guestId,
      action: requested,
      phoneExtension: args.phone.phone_extension,
      phoneNumber: args.phone.phone_number,
    });
  } catch {
    return {
      ...baseOutcome({
        status: 'needs_help',
        finalAttendance: null,
        attempted: 0,
        reads: 0,
        success: false,
        help: true,
        observed: false,
        intentId: args.intentId,
        messageId: args.messageId,
      }),
      persistedBeforeReply: false,
      saveError: 'intent_save_failed',
    };
  }

  let result: AgentGuestRsvpResult;
  try {
    result = await args.gateway.guestRsvp({
      phone_extension: args.phone.phone_extension,
      phone_number: args.phone.phone_number,
      action: requested,
      guest_id: guestId,
    });
  } catch {
    return resolveAmbiguous({
      store: args.store,
      gateway: args.gateway,
      phone: args.phone,
      intentId: args.intentId,
      messageId: args.messageId,
      readEventId: args.readEventId ?? null,
      lease: args.lease,
    });
  }

  if (result.status === 'responded') {
    const expected = requested === 'attending';
    const matches = result.willAttend !== null && result.willAttend === expected;
    if (!matches) {
      return persistNeedsHelp(args.store, args.intentId, args.messageId, 1, 0, leaseOk(args.lease));
    }
    const confirmed = baseOutcome({
      status: 'confirmed',
      finalAttendance: requested,
      attempted: 1,
      reads: 0,
      success: true,
      help: false,
      observed: false,
      intentId: args.intentId,
      messageId: args.messageId,
    });
    return persistOrHelp(args.store, confirmed, leaseOk(args.lease));
  }

  if (result.status === 'failed' && (result.retryable || isTimeoutLike(result.error))) {
    return resolveAmbiguous({
      store: args.store,
      gateway: args.gateway,
      phone: args.phone,
      intentId: args.intentId,
      messageId: args.messageId,
      readEventId: args.readEventId ?? null,
      lease: args.lease,
    });
  }

  return persistNeedsHelp(args.store, args.intentId, args.messageId, 1, 0, leaseOk(args.lease));
}

function leaseOk(lease: RsvpEffectLease | undefined): boolean {
  return fenceAllows(lease);
}

async function persistOrHelp(
  store: RsvpEffectStore,
  outcome: RsvpDurableOutcome,
  fencePasses: boolean,
): Promise<RsvpDurableOutcome> {
  if (!fencePasses) {
    return { ...outcome, status: 'needs_help', successClaimAllowed: false, needsHumanHelp: true, persistedBeforeReply: false, saveError: 'lease_fence_rejected' };
  }
  try {
    await store.saveResult(outcome);
    return outcome;
  } catch {
    return { ...outcome, status: 'needs_help', successClaimAllowed: false, needsHumanHelp: true, saveError: 'result_save_failed' };
  }
}

async function persistNeedsHelp(
  store: RsvpEffectStore,
  intentId: string,
  messageId: string,
  attempted: number,
  reads: number,
  fencePasses: boolean,
): Promise<RsvpDurableOutcome> {
  const outcome = baseOutcome({
    status: 'needs_help',
    finalAttendance: null,
    attempted,
    reads,
    success: false,
    help: true,
    observed: false,
    intentId,
    messageId,
  });
  return persistOrHelp(store, outcome, fencePasses);
}

async function resolveAmbiguous(args: {
  store: RsvpEffectStore;
  gateway: GatewaySeam;
  phone: { readonly phone_extension: string; readonly phone_number: string };
  intentId: string;
  messageId: string;
  readEventId: number | null;
  lease: RsvpEffectLease | undefined;
}): Promise<RsvpDurableOutcome> {
  if (!args.gateway.getEventDetail || args.readEventId === null) {
    return persistNeedsHelp(args.store, args.intentId, args.messageId, 1, 0, fenceAllows(args.lease));
  }
  let detail: AgentEventDetailResult;
  try {
    detail = await args.gateway.getEventDetail({
      eventId: args.readEventId,
      trustedPhone: {
        phone_extension: args.phone.phone_extension,
        phone_number: args.phone.phone_number,
      },
    });
  } catch {
    return persistNeedsHelp(args.store, args.intentId, args.messageId, 1, 1, fenceAllows(args.lease));
  }
  if (detail.status === 'success' && detail.event.attendance?.willAttend !== null && detail.event.attendance?.willAttend !== undefined) {
    const observed = detail.event.attendance?.willAttend === true ? 'attending' : 'declining';
    const outcome = baseOutcome({
      status: 'observed_state',
      finalAttendance: observed,
      attempted: 1,
      reads: 1,
      success: false,
      help: false,
      observed: true,
      intentId: args.intentId,
      messageId: args.messageId,
    });
    return persistOrHelp(args.store, outcome, fenceAllows(args.lease));
  }
  return persistNeedsHelp(args.store, args.intentId, args.messageId, 1, 1, fenceAllows(args.lease));
}

export function renderRsvpDurableOutcomeEs(outcome: RsvpDurableOutcome): string {
  if (outcome.status === 'confirmed') {
    return 'Tu asistencia ya está confirmada y figura que asistirás.';
  }
  if (outcome.status === 'observed_state') {
    const state = outcome.finalAttendance === 'declining' ? 'que no asistirás' : 'que asistirás';
    return `Según la consulta actual, figura ${state}. No podemos atribuir este estado a la solicitud actual; si necesitas un cambio, el equipo humano puede ayudar.`;
  }
  return 'No pudimos confirmar tu asistencia ahora. El equipo humano puede ayudar a revisarlo.';
}
