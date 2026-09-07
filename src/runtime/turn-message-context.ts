import type { NormalizedInboundMessage } from '../core/messages';
import type { PersistedPlan } from '../core/plan';
import { normalizeServerTimestamp } from '../core/server-timestamp';
import type { AgentConversationMessage } from './agent-conversation-gateway';
import {
  resolveReminderContext,
  categorizeOutboundSource,
  isManualFollowupSource,
  isReminderOutboundSource,
} from './conversation-continuity-policy';

export { resolveReminderContext } from './conversation-continuity-policy';

export const recentConversationMessageLimit = 5;
export const modelConversationMessageBodyLimit = 600;

export const conversationHistoryStatusValues = [
  'available',
  'empty',
  'unavailable',
  'not_configured',
  'missing_phone_number',
] as const;

export type ConversationHistoryStatus =
  (typeof conversationHistoryStatusValues)[number];

export const conversationLaneValues = [
  'planning',
  'public_faq',
  'purchase_support',
  'event_support',
  'rsvp',
  'human_handoff',
  'unresolved',
] as const;

export type ConversationLane = (typeof conversationLaneValues)[number];

/** Derived continuity evidence. It is never persisted as a second memory store. */
export type ConversationContinuity = {
  state: 'new' | 'continuing' | 'degraded';
  hasPersistedPlan: boolean;
  hasRecentMessages: boolean;
  hasPriorOutbound: boolean;
  historyStatus: ConversationHistoryStatus;
  lane: ConversationLane;
  hasPriorContext: boolean;
  welcomeAllowed: boolean;
  hasPendingInformation: boolean;
  hasCompletedInformation: boolean;
  recentInboundCount: number;
  recentOutboundCount: number;
};

export type AdapterSourceCategory = 'reminder' | 'manual' | 'other';

/**
 * S04: normalize adapter source metadata without new wire fields.
 * Delegates to the shared S05 categorization so reminder/manual logic
 * has one owner; frontend_followup and admin_campaign share reminder.
 */
export function normalizeAdapterSourceCategory(
  source: string | null | undefined,
): AdapterSourceCategory {
  return categorizeOutboundSource(source ?? null);
}

export function isReminderSource(source: string | null | undefined): boolean {
  return isReminderOutboundSource(source ?? null);
}

export function isManualContextSource(source: string | null | undefined): boolean {
  return isManualFollowupSource(source ?? null);
}

/**
 * S04: order by valid server timestamps with message ID as stable tie-break.
 * Invalid timestamps never reorder by body text; they fall back to ID order.
 */
export function orderMessagesByServerTime(
  messages: readonly AgentConversationMessage[],
): AgentConversationMessage[] {
  return [...messages].sort((left, right) => {
    const leftTime = normalizeServerTimestamp(left.sentAt ?? left.createdAt);
    const rightTime = normalizeServerTimestamp(right.sentAt ?? right.createdAt);
    if (leftTime && rightTime) {
      if (leftTime < rightTime) {
        return -1;
      }
      if (leftTime > rightTime) {
        return 1;
      }
    }
    return left.id - right.id;
  });
}

/** Newest outbound reminder in the visible window, or null when absent. */
export function selectCurrentReminder(
  messages: readonly AgentConversationMessage[],
): AgentConversationMessage | null {
  const ordered = orderMessagesByServerTime(messages);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const candidate = ordered[index];
    if (candidate && candidate.direction === 'outbound' && isReminderSource(candidate.source)) {
      return candidate;
    }
  }
  return null;
}

export type ReminderNarrativeProvenance = 'outbound_message';

export type ReminderNarrativeContext = {
  readonly sourceMessageId: number;
  readonly provenance: ReminderNarrativeProvenance;
  readonly literalTitle: string | null;
  readonly publicLink: string | null;
  readonly purpose: string | null;
  readonly explicitTopicSwitch: string | null;
};

function boundNarrativeText(value: string | null | undefined, limit: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, limit);
}

/**
 * S04: bounded narrative context from adapter metadata plus structured
 * extraction. Provenance is always outbound_message; the result is never
 * authoritative attendance or authorization evidence.
 */
export function buildReminderNarrativeContext(args: {
  readonly reminder: AgentConversationMessage | null;
  readonly literalTitle?: string | null;
  readonly publicLink?: string | null;
  readonly purpose?: string | null;
  readonly explicitTopicSwitch?: string | null;
}): ReminderNarrativeContext | null {
  if (!args.reminder) {
    return null;
  }
  return {
    sourceMessageId: args.reminder.id,
    provenance: 'outbound_message',
    literalTitle: boundNarrativeText(args.literalTitle, 200),
    publicLink: boundNarrativeText(args.publicLink, 500),
    purpose: boundNarrativeText(args.purpose, 200),
    explicitTopicSwitch: boundNarrativeText(args.explicitTopicSwitch, 200),
  };
}

/** Encode narrative context into the existing aggregate assumptions field. */
export function encodeReminderNarrativeAssumption(context: ReminderNarrativeContext): string {
  const title = context.literalTitle ?? '';
  return `reminder_narrative source_message_id=${context.sourceMessageId} provenance=${context.provenance} title=${title}`.slice(0, 280);
}

/** Narrative context never authorizes attendance or access. */
export function isReminderNarrativeAuthoritative(): boolean {
  return false;
}

export type TurnMessageContext = {
  historyStatus: ConversationHistoryStatus;
  contextSource: 'agent_api' | 'local_plan';
  retrievedMessageCount: number;
  excludedCurrentMessageCount: number;
  recentMessages: AgentConversationMessage[];
  entryMessage: AgentConversationMessage | null;
  continuity?: ConversationContinuity;
};

export function deriveConversationContinuity(args: {
  plan: PersistedPlan;
  recentMessages: readonly AgentConversationMessage[];
  historyStatus: ConversationHistoryStatus;
}): ConversationContinuity {
  const { plan, recentMessages, historyStatus } = args;
  const pending = plan.information_state.pending_requests.length > 0;
  const completed = plan.information_state.last_completed_request != null;
  const hasPlanningState = Boolean(
    plan.event_type ||
      plan.active_need_category ||
      plan.vendor_category ||
      plan.location ||
      plan.provider_needs.length > 0 ||
      plan.conversation_summary.trim(),
  );
  const hasPersistedPlan = Boolean(
      plan.current_node !== 'contacto_inicial' ||
      pending ||
      completed ||
      hasPlanningState ||
      plan.human_escalation.status === 'requested',
  );
  const hasRecentMessages = recentMessages.length > 0;
  const hasPriorOutbound = recentMessages.some((message) => message.direction === 'outbound');
  const degraded = !hasPersistedPlan &&
    (historyStatus === 'unavailable' || historyStatus === 'missing_phone_number');
  const state: ConversationContinuity['state'] = degraded
    ? 'degraded'
    : hasPersistedPlan || hasRecentMessages || historyStatus === 'available'
      ? 'continuing'
      : 'new';
  const hasPriorContext = state !== 'new';

  let lane: ConversationLane = 'unresolved';
  if (plan.human_escalation.status === 'requested') {
    lane = 'human_handoff';
  } else if (plan.current_node === 'responder_invitacion' || plan.rsvp_state.status !== 'none') {
    lane = 'rsvp';
  } else if (pending || completed || plan.current_node === 'resolver_consultas_informativas') {
    const informationKind =
      plan.information_state.pending_requests[0]?.kind ??
      plan.information_state.last_completed_request?.kind;
    lane = informationKind === 'purchase'
      ? 'purchase_support'
      : informationKind === 'associated_event'
        ? 'event_support'
        : informationKind === 'faq'
          ? 'public_faq'
          : 'unresolved';
  } else if (hasPlanningState) {
    lane = 'planning';
  }

  return {
    state,
    hasPersistedPlan,
    hasRecentMessages,
    hasPriorOutbound,
    historyStatus,
    lane,
    hasPriorContext,
    welcomeAllowed: !hasPriorContext,
    hasPendingInformation: pending,
    hasCompletedInformation: completed,
    recentInboundCount: recentMessages.filter((message) => message.direction === 'inbound').length,
    recentOutboundCount: recentMessages.filter((message) => message.direction === 'outbound').length,
  };
}

export function withConversationContinuity(
  context: TurnMessageContext,
  plan: PersistedPlan,
): TurnMessageContext {
  return {
    ...context,
    continuity: deriveConversationContinuity({
      plan,
      recentMessages: context.recentMessages,
      historyStatus: context.historyStatus,
    }),
  };
}

export function localTurnMessageContext(
  historyStatus: Extract<
    ConversationHistoryStatus,
    'not_configured' | 'missing_phone_number'
  >,
): TurnMessageContext {
  return {
    historyStatus,
    contextSource: 'local_plan',
    retrievedMessageCount: 0,
    excludedCurrentMessageCount: 0,
    recentMessages: [],
    entryMessage: null,
  };
}

export function unavailableTurnMessageContext(): TurnMessageContext {
  return {
    historyStatus: 'unavailable',
    contextSource: 'local_plan',
    retrievedMessageCount: 0,
    excludedCurrentMessageCount: 0,
    recentMessages: [],
    entryMessage: null,
  };
}

export function buildTurnMessageContext(args: {
  messages: readonly AgentConversationMessage[];
  inbound: NormalizedInboundMessage;
}): TurnMessageContext {
  const uniqueMessages = new Map<number, AgentConversationMessage>();
  let excludedCurrentMessageCount = 0;
  for (const message of args.messages) {
    if (isCurrentInboundMessage(message, args.inbound)) {
      excludedCurrentMessageCount += 1;
      continue;
    }
    uniqueMessages.set(message.id, message);
  }

  // S04: order by valid server timestamps with message ID tie-breaker
  // before bounding; S05 entry anchor then selects the newest campaign-like
  // outbound. No body-text matching; raw history stays capped.
  const recentMessages = orderMessagesByServerTime(Array.from(uniqueMessages.values())).slice(
    -recentConversationMessageLimit,
  );
  const reminder = resolveReminderContext(recentMessages);
  const entryMessage = reminder.entryMessageId !== null
    ? (recentMessages.find((message) => message.id === reminder.entryMessageId) ?? null)
    : (recentMessages[0] ?? null);

  return {
    historyStatus: recentMessages.length > 0 ? 'available' : 'empty',
    contextSource: 'agent_api',
    retrievedMessageCount: args.messages.length,
    excludedCurrentMessageCount,
    recentMessages,
    entryMessage,
  };
}

export function buildModelVisibleConversationHistory(
  context: TurnMessageContext,
): Array<{
  direction: AgentConversationMessage['direction'];
  source: string | null;
  body: string;
  sent_at: string | null;
}> {
  return context.recentMessages.map((message) => ({
    direction: message.direction,
    source: message.source,
    body: truncateMessageBody(message.body),
    sent_at: message.sentAt ?? message.createdAt,
  }));
}

function isCurrentInboundMessage(
  message: AgentConversationMessage,
  inbound: NormalizedInboundMessage,
): boolean {
  if (message.direction !== 'inbound') {
    return false;
  }
  // S14: exclude only on native/record ID match. When coalesced constituent
  // IDs are absent, preserve ambiguity: distinct identical-body records are
  // never deleted by body text or timestamp proximity alone.
  return Boolean(
    message.whatsappMessageId &&
      inbound.messageId &&
      message.whatsappMessageId === inbound.messageId,
  );
}

function truncateMessageBody(value: string): string {
  if (value.length <= modelConversationMessageBodyLimit) {
    return value;
  }
  const headLength = Math.ceil(modelConversationMessageBodyLimit * 0.7);
  const tailLength = modelConversationMessageBodyLimit - headLength - 1;
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}
