import { describe, expect, it } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import type { AgentConversationMessage } from '../src/runtime/agent-conversation-gateway';
import {
  buildReminderNarrativeContext,
  buildTurnMessageContext,
  encodeReminderNarrativeAssumption,
  isManualContextSource,
  isReminderNarrativeAuthoritative,
  isReminderSource,
  normalizeAdapterSourceCategory,
  orderMessagesByServerTime,
  selectCurrentReminder,
} from '../src/runtime/turn-message-context';
import {
  RSVP_MISMATCH_HANDOFF_SCOPE,
  decideRsvpInvitationAction,
} from '../src/runtime/rsvp-invitation-evidence';

function inbound(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    channel: 'terminal_whatsapp',
    externalUserId: 's04-user',
    text: 'Si, asistire',
    messageId: 'wamid-s04-current',
    receivedAt: '2026-09-04T13:11:09.000Z',
    ...overrides,
  };
}

function msg(id: number, overrides: Partial<AgentConversationMessage> = {}): AgentConversationMessage {
  return {
    id,
    direction: id % 2 === 0 ? 'outbound' : 'inbound',
    source: id % 2 === 0 ? 'agent' : null,
    body: `message-${id}`,
    status: 'sent',
    sentAt: `2026-09-03T21:${String(50 + id).padStart(2, '0')}:00.000Z`,
    createdAt: null,
    ...overrides,
  };
}

describe('S04 reminder source normalization', () => {
  it('categorizes reminder and manual sources consistently', () => {
    expect(normalizeAdapterSourceCategory('frontend_followup')).toBe('reminder');
    expect(normalizeAdapterSourceCategory('admin_campaign')).toBe('reminder');
    expect(normalizeAdapterSourceCategory('admin_manual')).toBe('manual');
    expect(normalizeAdapterSourceCategory('agent')).toBe('other');
    expect(normalizeAdapterSourceCategory(null)).toBe('other');
    expect(isReminderSource('frontend_followup')).toBe(true);
    expect(isReminderSource('admin_campaign')).toBe(true);
    expect(isReminderSource('admin_manual')).toBe(false);
    expect(isManualContextSource('admin_manual')).toBe(true);
  });

  it('anchors the bounded window on the newest reminder while keeping manual context', () => {
    const anchored = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        msg(1, { direction: 'outbound', source: 'admin_campaign', body: 'Campana anterior.' }),
        msg(2, { direction: 'inbound', body: 'Gracias.' }),
        msg(3, { direction: 'outbound', source: 'frontend_followup', body: 'Recordatorio actual Marcelo.' }),
      ],
    });
    expect(anchored.entryMessage?.id).toBe(3);
    expect(selectCurrentReminder(anchored.recentMessages)?.id).toBe(3);
    const withManual = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        msg(1, { direction: 'outbound', source: 'admin_campaign', body: 'Campana.' }),
        msg(2, { direction: 'outbound', source: 'admin_manual', body: 'Seguimiento manual relevante.' }),
        msg(3, { direction: 'outbound', source: 'frontend_followup', body: 'Recordatorio actual.' }),
      ],
    });
    expect(withManual.recentMessages.map((m) => m.source)).toContain('admin_manual');
    expect(withManual.entryMessage?.source).toBe('frontend_followup');
  });

  it('orders by server timestamps with message id as a stable tie-breaker', () => {
    const ordered = orderMessagesByServerTime([
      msg(30, { direction: 'outbound', source: 'frontend_followup', body: 'Tercero', sentAt: '2026-09-04T10:00:00.000Z' }),
      msg(10, { direction: 'outbound', source: 'admin_campaign', body: 'Primero', sentAt: '2026-08-22T10:00:00.000Z' }),
      msg(20, { direction: 'outbound', source: 'frontend_followup', body: 'Segundo', sentAt: '2026-08-29T10:00:00.000Z' }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual([10, 20, 30]);
    const tied = orderMessagesByServerTime([
      msg(9, { sentAt: '2026-09-04T10:00:00.000Z' }),
      msg(7, { sentAt: '2026-09-04T10:00:00.000Z' }),
    ]);
    expect(tied.map((m) => m.id)).toEqual([7, 9]);
  });
});

describe('S04 RSVP invitation evidence', () => {
  it('leaves empty, non-matching, and ambiguous references unresolved without writing from text', () => {
    const empty = decideRsvpInvitationAction({ trusted: [], semanticTitle: 'Marcelo', hasExplicitDecision: true });
    expect(empty.outcome).toBe('unresolved');
    expect(empty.candidate).toBeUndefined();
    const noMatch = decideRsvpInvitationAction({
      trusted: [{ guestId: 2, eventId: 2, eventName: 'Cumple Marcelo', eventDate: null }],
      semanticTitle: 'Fiesta Inexistente',
      hasExplicitDecision: true,
      textGuestId: 999,
      textUrl: 'https://example.com/event/999',
    });
    expect(noMatch.outcome).toBe('unresolved');
    expect(noMatch.candidate).toBeUndefined();
    const duplicated = decideRsvpInvitationAction({
      trusted: [
        { guestId: 3, eventId: 3, eventName: 'Duplicado', eventDate: null },
        { guestId: 4, eventId: 4, eventName: 'Duplicado', eventDate: null },
      ],
      semanticTitle: 'Duplicado',
      hasExplicitDecision: true,
    });
    expect(duplicated.outcome).toBe('ambiguous');
  });

  it('marks a single verified invitation actionable only with an explicit decision', () => {
    const trusted = [{ guestId: 42, eventId: 7, eventName: 'Cumple Marcelo', eventDate: '2026-09-10 18:00:00' }];
    const withDecision = decideRsvpInvitationAction({ trusted, semanticTitle: null, hasExplicitDecision: true });
    expect(withDecision.outcome).toBe('actionable_unique');
    expect(withDecision.candidate?.guestId).toBe(42);
    const withoutDecision = decideRsvpInvitationAction({ trusted, semanticTitle: null, hasExplicitDecision: false });
    expect(withoutDecision.outcome).toBe('unresolved');
  });

  it('selects the unique semantic match from the trusted set', () => {
    const trusted = [
      { guestId: 1, eventId: 1, eventName: 'Baby Shower Julieta', eventDate: null },
      { guestId: 2, eventId: 2, eventName: 'Cumple Marcelo', eventDate: null },
    ];
    const decision = decideRsvpInvitationAction({ trusted, semanticTitle: 'Cumple Marcelo', hasExplicitDecision: true });
    expect(decision.outcome).toBe('actionable_unique');
    expect(decision.candidate?.guestId).toBe(2);
  });

  it('uses the dedicated mismatch handoff scope for unresolved intent', () => {
    expect(RSVP_MISMATCH_HANDOFF_SCOPE).toBe('rsvp_mismatch');
  });
});

describe('S04 bounded reminder narrative', () => {
  it('persists source message id with outbound provenance and never authorizes', () => {
    const reminder = msg(77, { direction: 'outbound', source: 'frontend_followup', body: 'Recordatorio: Cumple Marcelo' });
    const narrative = buildReminderNarrativeContext({
      reminder,
      literalTitle: 'Cumple Marcelo',
      publicLink: 'https://example.com/e/cumple-marcelo',
      purpose: 'recordatorio',
      explicitTopicSwitch: null,
    });
    expect(narrative?.sourceMessageId).toBe(77);
    expect(narrative?.provenance).toBe('outbound_message');
    expect(narrative?.literalTitle).toBe('Cumple Marcelo');
    expect(isReminderNarrativeAuthoritative()).toBe(false);
    const encoded = encodeReminderNarrativeAssumption(narrative!);
    expect(encoded).toContain('source_message_id=77');
    expect(encoded).toContain('provenance=outbound_message');
    expect(encoded).toContain('Cumple Marcelo');
    // The literal title is preserved for confusion explanations; a missing
    // reminder builds no narrative.
    const retitled = buildReminderNarrativeContext({
      reminder: msg(81, { direction: 'outbound', source: 'frontend_followup', body: 'Recordatorio: Cumple Marcelo manana' }),
      literalTitle: 'Cumple Marcelo',
    });
    expect(retitled?.literalTitle).toBe('Cumple Marcelo');
    expect(buildReminderNarrativeContext({ reminder: null, literalTitle: 'Cumple Marcelo' })).toBeNull();
  });
});
