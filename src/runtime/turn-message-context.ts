import type { NormalizedInboundMessage } from '../core/messages';
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

export type TurnMessageContext = {
  historyStatus: ConversationHistoryStatus;
  contextSource: 'agent_api' | 'local_plan';
  retrievedMessageCount: number;
  excludedCurrentMessageCount: number;
  recentMessages: AgentConversationMessage[];
  entryMessage: AgentConversationMessage | null;
};

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
  if (
    message.whatsappMessageId &&
    inbound.messageId &&
    message.whatsappMessageId === inbound.messageId
  ) {
    return true;
  }
  if (message.body.trim() !== inbound.text.trim()) {
    return false;
  }

  const messageTimestamp = parseTimestamp(message.sentAt ?? message.createdAt);
  const inboundTimestamp = parseTimestamp(inbound.receivedAt);
  return (
    messageTimestamp !== null &&
    inboundTimestamp !== null &&
    Math.abs(messageTimestamp - inboundTimestamp) <= 2 * 60 * 1_000
  );
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncateMessageBody(value: string): string {
  if (value.length <= modelConversationMessageBodyLimit) {
    return value;
  }
  const headLength = Math.ceil(modelConversationMessageBodyLimit * 0.7);
  const tailLength = modelConversationMessageBodyLimit - headLength - 1;
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}
