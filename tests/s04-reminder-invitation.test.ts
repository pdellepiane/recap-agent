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
  it('normalizes frontend_followup and admin_campaign to the reminder category', () => {
    expect(normalizeAdapterSourceCategory('frontend_followup')).toBe('reminder');
    expect(normalizeAdapterSourceCategory('admin_campaign')).toBe('reminder');
    expect(normalizeAdapterSourceCategory('admin_manual')).toBe('manual');
    expect(normalizeAdapterSourceCategory('agent')).toBe('other');
    expect(normalizeAdapterSourceCategory(null)).toBe('other');
  });

  it('recognizes frontend_followup through adapter metadata', () => {
    expect(isReminderSource('frontend_followup')).toBe(true);
    expect(isReminderSource('admin_campaign')).toBe(true);
    expect(isReminderSource('admin_manual')).toBe(false);
    expect(isManualContextSource('admin_manual')).toBe(true);
  });

  it('selects the newest frontend_followup as the current reminder anchor', () => {
    const context = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        msg(1, { direction: 'outbound', source: 'admin_campaign', body: 'Campana anterior.' }),
        msg(2, { direction: 'inbound', body: 'Gracias.' }),
        msg(3, { direction: 'outbound', source: 'frontend_followup', body: 'Recordatorio actual Marcelo.' }),
      ],
    });
    expect(context.entryMessage?.id).toBe(3);
    expect(selectCurrentReminder(context.recentMessages)?.id).toBe(3);
  });

  it('orders by valid server timestamps with message id tie-breaker', () => {
    const ordered = orderMessagesByServerTime([
      msg(30, { direction: 'outbound', source: 'frontend_followup', body: 'Tercero', sentAt: '2026-09-04T10:00:00.000Z' }),
      msg(10, { direction: 'outbound', source: 'admin_campaign', body: 'Primero', sentAt: '2026-08-22T10:00:00.000Z' }),
      msg(20, { direction: 'outbound', source: 'frontend_followup', body: 'Segundo', sentAt: '2026-08-29T10:00:00.000Z' }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual([10, 20, 30]);
  });

  it('uses message id as a stable tie-breaker for equal timestamps', () => {
    const ordered = orderMessagesByServerTime([
      msg(9, { sentAt: '2026-09-04T10:00:00.000Z' }),
      msg(7, { sentAt: '2026-09-04T10:00:00.000Z' }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual([7, 9]);
  });

  it('keeps relevant admin_manual context in the bounded window', () => {
    const context = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        msg(1, { direction: 'outbound', source: 'admin_campaign', body: 'Campana.' }),
        msg(2, { direction: 'outbound', source: 'admin_manual', body: 'Seguimiento manual relevante.' }),
        msg(3, { direction: 'outbound', source: 'frontend_followup', body: 'Recordatorio actual.' }),
      ],
    });
    expect(context.recentMessages.map((m) => m.source)).toContain('admin_manual');
    expect(context.entryMessage?.source).toBe('frontend_followup');
  });
});

describe('S04 RSVP invitation evidence', () => {
  it('leaves an empty lookup unresolved without an actionable candidate', () => {
    const decision = decideRsvpInvitationAction({ trusted: [], semanticTitle: 'Marcelo', hasExplicitDecision: true });
    expect(decision.outcome).toBe('unresolved');
    expect(decision.candidate).toBeUndefined();
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

  it('keeps non-matching and ambiguous references unresolved without writing from text', () => {
    const trusted = [{ guestId: 2, eventId: 2, eventName: 'Cumple Marcelo', eventDate: null }];
    const noMatch = decideRsvpInvitationAction({
      trusted,
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
  });

  it('preserves the literal reminder title for confusion explanations', () => {
    const reminder = msg(81, { direction: 'outbound', source: 'frontend_followup', body: 'Recordatorio: Cumple Marcelo manana' });
    const narrative = buildReminderNarrativeContext({ reminder, literalTitle: 'Cumple Marcelo' });
    expect(narrative?.literalTitle).toBe('Cumple Marcelo');
    expect(buildReminderNarrativeContext({ reminder: null, literalTitle: 'Cumple Marcelo' })).toBeNull();
  });
});
