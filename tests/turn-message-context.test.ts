import { describe, expect, it } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import type { AgentConversationMessage } from '../src/runtime/agent-conversation-gateway';
import {
  buildExtractorConversationHistory,
  buildModelVisibleConversationHistory,
  buildTurnMessageContext,
  modelConversationMessageBodyLimit,
  recentConversationMessageLimit,
  selectProvenanceBoundCampaignMessages,
} from '../src/runtime/turn-message-context';

function inbound(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    channel: 'terminal_whatsapp',
    externalUserId: 'context-user',
    text: 'No ha llegado nada',
    messageId: 'wamid-current',
    receivedAt: '2026-07-31T09:49:00.000Z',
    ...overrides,
  };
}

function message(
  id: number,
  overrides: Partial<AgentConversationMessage> = {},
): AgentConversationMessage {
  return {
    id,
    direction: id % 2 === 0 ? 'outbound' : 'inbound',
    source: id % 2 === 0 ? 'agent' : null,
    body: `message-${id}`,
    status: 'sent',
    sentAt: `2026-07-31T09:${String(40 + id).padStart(2, '0')}:00.000Z`,
    createdAt: null,
    ...overrides,
  };
}

describe('turn message context', () => {
  it('deduplicates the current inbound message by native id and preserves ambiguity without it', () => {
    const context = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        message(1, { body: 'Mensaje anterior' }),
        message(2, {
          direction: 'inbound',
          source: null,
          body: 'No ha llegado nada',
          whatsappMessageId: 'wamid-current',
          sentAt: '2026-07-31T09:49:00.000Z',
        }),
      ],
    });

    expect(context.recentMessages.map((item) => item.id)).toEqual([1]);

    const ambiguous = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        message(1, {
          body: 'No ha llegado nada',
          sentAt: '2026-07-31T09:48:30.000Z',
        }),
      ],
    });

    expect(ambiguous.historyStatus).toBe('available');
    expect(ambiguous.recentMessages.map((item) => item.id)).toEqual([1]);
    expect(ambiguous.excludedCurrentMessageCount).toBe(0);
  });

  it('caps recent history and anchors the newest visible campaign entry', () => {
    const messages = Array.from(
      { length: recentConversationMessageLimit + 2 },
      (_, index) => message(index + 1),
    );
    messages[2] = message(3, {
      direction: 'outbound',
      source: 'admin_campaign',
      body: 'Recordatorio del evento.',
    });
    const context = buildTurnMessageContext({
      inbound: inbound({ text: 'Una consulta nueva' }),
      messages,
    });

    expect(context.recentMessages).toHaveLength(recentConversationMessageLimit);
    expect(context.recentMessages[0]?.id).toBe(3);
    expect(context.entryMessage).toMatchObject({
      id: 3,
      source: 'admin_campaign',
    });

    const newest = buildTurnMessageContext({
      inbound: inbound({ text: 'Sí, asistiré' }),
      messages: [
        message(1, {
          direction: 'outbound',
          source: 'admin_campaign',
          body: 'Campaña anterior.',
        }),
        message(2, { direction: 'inbound', body: 'Gracias.' }),
        message(3, {
          direction: 'outbound',
          source: 'admin_campaign',
          body: 'Campaña más reciente.',
        }),
      ],
    });

    expect(newest.entryMessage).toMatchObject({
      id: 3,
      body: 'Campaña más reciente.',
    });
  });

  it('limits raw message bodies before they enter model context', () => {
    const context = buildTurnMessageContext({
      inbound: inbound({ text: 'Otra consulta' }),
      messages: [message(1, { body: 'x'.repeat(2_000) })],
    });

    const visible = buildModelVisibleConversationHistory(context);
    expect(visible[0]?.body.length).toBe(modelConversationMessageBodyLimit);
    expect(visible[0]?.body).toContain('…');
  });

  it('retains campaign references with identity and delivery in both history projections', () => {
    const context = buildTurnMessageContext({
      inbound: inbound({ text: '¿A qué hora es?' }),
      messages: [
        message(1, {
          direction: 'outbound',
          source: 'admin_campaign',
          eventId: 40034,
          body: 'Recordatorio: Boda Lucía y Marco.',
          status: 'delivered',
          sentAt: '2026-07-31T09:40:00.000Z',
        }),
        message(2, {
          direction: 'outbound',
          source: 'agent',
          body: 'Hola, ¿en qué te ayudo?',
          status: 'delivered',
          sentAt: '2026-07-31T09:45:00.000Z',
        }),
      ],
    });

    // The older campaign survives the newer ordinary message as a
    // provenance-bound reference.
    const campaigns = selectProvenanceBoundCampaignMessages(context.recentMessages);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({
      sourceMessageId: 1,
      source: 'admin_campaign',
      delivery: 'delivered',
    });

    const extractorEntries = buildExtractorConversationHistory(context);
    expect(extractorEntries).toHaveLength(2);
    expect(extractorEntries[0]).toMatchObject({ message_id: 1, event_id: 40034, delivery: 'delivered' });
    expect('message_id' in (extractorEntries[1] ?? {})).toBe(false);
    expect('delivery' in (extractorEntries[1] ?? {})).toBe(false);

    const modelEntries = buildModelVisibleConversationHistory(context);
    expect(modelEntries).toHaveLength(2);
    expect(modelEntries[0]).toMatchObject({ message_id: 1, event_id: 40034, delivery: 'delivered' });
    expect('message_id' in (modelEntries[1] ?? {})).toBe(false);
    expect('delivery' in (modelEntries[1] ?? {})).toBe(false);
  });
});
