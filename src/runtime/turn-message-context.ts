import type { NormalizedInboundMessage } from '../core/messages';
import type { PersistedPlan } from '../core/plan';
import type { AgentConversationMessage } from './agent-conversation-gateway';

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

  const recentMessages = Array.from(uniqueMessages.values()).slice(
    -recentConversationMessageLimit,
  );
  const entryMessage = [...recentMessages].reverse().find(
    (message) => message.source === 'admin_campaign',
  ) ?? recentMessages[0] ?? null;

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
