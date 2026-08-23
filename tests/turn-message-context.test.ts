import { describe, expect, it } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import type { AgentConversationMessage } from '../src/runtime/agent-conversation-gateway';
import {
  buildModelVisibleConversationHistory,
  buildTurnMessageContext,
  modelConversationMessageBodyLimit,
  recentConversationMessageLimit,
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
  it('deduplicates the current inbound message by native message id', () => {
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
  });

  it('deduplicates a just-delivered inbound copy when the endpoint omits its native id', () => {
    const context = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        message(1, {
          body: 'No ha llegado nada',
          sentAt: '2026-07-31T09:48:30.000Z',
        }),
      ],
    });

    expect(context.historyStatus).toBe('empty');
    expect(context.recentMessages).toEqual([]);
  });

  it('caps recent history and preserves a visible campaign entry anchor', () => {
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
  });

  it('uses the newest campaign as the entry anchor when several are visible', () => {
    const context = buildTurnMessageContext({
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

    expect(context.entryMessage).toMatchObject({
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
});
