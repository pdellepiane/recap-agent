import { describe, expect, it } from 'vitest';

import { buildRsvpOfferKey } from '../src/core/rsvp';
import {
  RSVP_EFFECT_POLICY,
  decideRsvpOffer,
  decideRsvpTurn,
  filterSelectableRsvpInvitations,
  type RsvpPolicyInvitation,
} from '../src/runtime/rsvp-decision-policy';

function invitation(overrides: Partial<RsvpPolicyInvitation> = {}): RsvpPolicyInvitation {
  return {
    guestId: 584353,
    eventId: 38331,
    eventName: 'Otra celebracion prueba',
    eventDate: '2026-08-19 05:00:00',
    attendance: 'declining',
    ...overrides,
  };
}

describe('S07 RSVP decision policy: offer disposition', () => {
  it('read-only declining status offers one optional change with no mutation', () => {
    const trusted = [invitation({ attendance: 'declining' })];
    const decision = decideRsvpTurn({
      trusted,
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('declining_offer_change_once');
    expect(decision.shouldOffer).toBe(true);
    expect(decision.shouldWrite).toBe(false);
    expect(decision.isWrite).toBe(false);
    expect(decision.candidateGuestId).toBe(584353);
    expect(decision.offerKey).toBe(
      buildRsvpOfferKey({
        guestId: 584353,
        eventId: 38331,
        eventName: 'Otra celebracion prueba',
        eventDate: '2026-08-19 05:00:00',
        attendance: 'declining',
      }),
    );
  });

  it('repeated query for the same event/state version does not re-offer', () => {
    const trusted = [invitation({ attendance: 'declining' })];
    const offerKey = buildRsvpOfferKey({
      guestId: 584353,
      eventId: 38331,
      eventName: 'Otra celebracion prueba',
      eventDate: '2026-08-19 05:00:00',
      attendance: 'declining',
    });
    const decision = decideRsvpTurn({
      trusted,
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: [offerKey],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('declining_reported_no_reoffer');
    expect(decision.shouldOffer).toBe(false);
    expect(decision.shouldWrite).toBe(false);
  });

  it('explicit no-change does not loop into another offer', () => {
    const trusted = [invitation({ attendance: 'declining' })];
    const decision = decideRsvpTurn({
      trusted,
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: true,
    });
    expect(decision.outcome).toBe('declining_reported_no_reoffer');
    expect(decision.shouldOffer).toBe(false);
    expect(decision.shouldWrite).toBe(false);
    const offer = decideRsvpOffer({
      attendance: 'declining',
      offerKey: 'k1',
      alreadyOfferedKeys: [],
      explicitNoChange: true,
    });
    expect(offer.shouldOffer).toBe(false);
    expect(offer.disposition).toBe('no_change_acknowledged');
    expect(offer.isWrite).toBe(false);
  });

  it('offer key changes with event/state version', () => {
    const before = buildRsvpOfferKey({
      guestId: 1,
      eventId: 10,
      eventName: 'Evento A',
      eventDate: '2026-09-12',
      attendance: 'declining',
    });
    const after = buildRsvpOfferKey({
      guestId: 1,
      eventId: 10,
      eventName: 'Evento A',
      eventDate: '2026-09-12',
      attendance: 'attending',
    });
    expect(before).not.toBe(after);
  });
});

describe('S07 RSVP decision policy: mutation authorization', () => {
  it('current attending state reports without a write', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ attendance: 'attending' })],
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('attending_reported_no_write');
    expect(decision.shouldWrite).toBe(false);
    expect(decision.shouldOffer).toBe(false);
  });

  it('repeated identical attending decision avoids an unnecessary write', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ attendance: 'attending' })],
      semanticTitle: 'Otra celebracion prueba',
      hasExplicitDecision: true,
      decisionSource: 'current_message',
      requestedAction: 'attending',
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('identical_decision_no_write');
    expect(decision.shouldWrite).toBe(false);
    expect(decision.needsHumanHelp).toBe(false);
  });

  it('explicit declining to attending reversal authorizes one write with validated subject and action', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ attendance: 'declining' })],
      semanticTitle: 'Otra celebracion prueba',
      hasExplicitDecision: true,
      decisionSource: 'current_message',
      requestedAction: 'attending',
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('authorized_mutation');
    expect(decision.shouldWrite).toBe(true);
    expect(decision.candidateGuestId).toBe(584353);
    expect(decision.requestedAction).toBe('attending');
    expect(decision.isReversal).toBe(true);
    expect(decision.effectIntent).toMatchObject({ guest_id: 584353, action: 'attending' });
    expect(decision.effectIntent?.persistBeforeExecution).toBe(true);
  });

  it('plan_state action without a current explicit decision never authorizes a write', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ attendance: 'declining' })],
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'plan_state',
      requestedAction: 'attending',
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.shouldWrite).toBe(false);
    expect(decision.outcome).not.toBe('authorized_mutation');
  });

  it('reversal without a unique verified invitation requires human help instead of writing', () => {
    const decision = decideRsvpTurn({
      trusted: [
        invitation({ guestId: 41, eventName: 'Evento A', attendance: 'declining' }),
        invitation({ guestId: 42, eventName: 'Evento B', attendance: 'declining' }),
      ],
      semanticTitle: null,
      hasExplicitDecision: true,
      decisionSource: 'current_message',
      requestedAction: 'attending',
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('needs_event_selection');
    expect(decision.shouldWrite).toBe(false);
    expect(decision.needsHumanHelp).toBe(false);
  });

  it('effect policy persists intent and result with no auto retries', () => {
    expect(RSVP_EFFECT_POLICY.persistIntentBeforeExecution).toBe(true);
    expect(RSVP_EFFECT_POLICY.persistResultBeforeReply).toBe(true);
    expect(RSVP_EFFECT_POLICY.maxAttempts).toBe(1);
    expect(RSVP_EFFECT_POLICY.autoRetry).toBe(false);
  });
});

describe('S07 RSVP decision policy: distinct attendance and selection outcomes', () => {
  it('pending without a decision asks for an explicit decision without writing', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ attendance: 'pending' })],
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('pending_needs_explicit_decision');
    expect(decision.shouldWrite).toBe(false);
  });

  it('unknown attendance uses its own outcome and requires human help', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ attendance: 'unknown' })],
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('unknown_state_requires_help');
    expect(decision.shouldWrite).toBe(false);
    expect(decision.needsHumanHelp).toBe(true);
  });

  it('ambiguous references require selection without writing', () => {
    const decision = decideRsvpTurn({
      trusted: [
        invitation({ guestId: 3, eventName: 'Duplicado', attendance: 'pending' }),
        invitation({ guestId: 4, eventName: 'Duplicado', attendance: 'pending' }),
      ],
      semanticTitle: 'Duplicado',
      hasExplicitDecision: true,
      decisionSource: 'current_message',
      requestedAction: 'attending',
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('needs_event_selection');
    expect(decision.shouldWrite).toBe(false);
  });

  it('missing event identity is unavailable and never becomes selectable placeholders', () => {
    const unnamed = Array.from({ length: 8 }, (_, index) => invitation({
      guestId: 90000 + index,
      eventId: null,
      eventName: null,
      eventDate: null,
      attendance: 'unknown',
    }));
    expect(filterSelectableRsvpInvitations(unnamed)).toHaveLength(0);
    const decision = decideRsvpTurn({
      trusted: unnamed,
      semanticTitle: null,
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('unavailable_missing_identity');
    expect(decision.shouldWrite).toBe(false);
    expect(decision.selectableCount).toBe(0);
    expect(decision.needsHumanHelp).toBe(true);
  });

  it('empty trusted set is a distinct no-invitation unavailable outcome', () => {
    const decision = decideRsvpTurn({
      trusted: [],
      semanticTitle: null,
      hasExplicitDecision: true,
      decisionSource: 'current_message',
      requestedAction: 'attending',
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('unavailable_no_invitation');
    expect(decision.shouldWrite).toBe(false);
  });

  it('lookup failure is a distinct unavailable outcome without a write', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation()],
      semanticTitle: null,
      hasExplicitDecision: true,
      decisionSource: 'current_message',
      requestedAction: 'attending',
      lookupFailed: true,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
    });
    expect(decision.outcome).toBe('unavailable_lookup_failed');
    expect(decision.shouldWrite).toBe(false);
  });

  it('missing attendance decision requires an explicit decision without writing', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ attendance: 'declining' })],
      semanticTitle: 'Otra celebracion prueba',
      hasExplicitDecision: false,
      decisionSource: 'current_message',
      requestedAction: null,
      lookupFailed: false,
      alreadyOfferedKeys: ['already-consumed'],
      explicitNoChange: false,
    });
    expect(decision.shouldWrite).toBe(false);
    expect(['declining_offer_change_once', 'declining_reported_no_reoffer']).toContain(decision.outcome);
  });

  it('never writes using an ID or URL taken only from message text', () => {
    const decision = decideRsvpTurn({
      trusted: [invitation({ guestId: 42, eventName: 'Cumple Marcelo', attendance: 'declining' })],
      semanticTitle: 'Fiesta Inexistente',
      hasExplicitDecision: true,
      decisionSource: 'current_message',
      requestedAction: 'attending',
      lookupFailed: false,
      alreadyOfferedKeys: [],
      explicitNoChange: false,
      textGuestId: 999,
      textUrl: 'https://example.com/event/999',
    });
    expect(decision.shouldWrite).toBe(false);
    expect(decision.candidateGuestId).not.toBe(999);
    expect(decision.outcome).not.toBe('authorized_mutation');
  });
});
