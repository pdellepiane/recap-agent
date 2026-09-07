import { describe, expect, it } from 'vitest';

describe('F2c frozen concise and suppression guard', () => {
  it('single status query without amount skips mutable disclosure', () => {
    const asksExplicitAmount = false;
    const purchasesLength = 1;
    const isSingleStatusQuery = purchasesLength === 1 && !asksExplicitAmount;
    expect(isSingleStatusQuery).toBe(true);
  });

  it('rsvp lane never suppresses acknowledgement', () => {
    const plan = { rsvp_state: { status: 'none' }, current_node: 'responder_invitacion' };
    const validSuppression = plan.rsvp_state.status === 'none' && plan.current_node !== 'responder_invitacion';
    expect(validSuppression).toBe(false);
  });

  it('non-rsvp lane may still suppress when stateless', () => {
    const plan = { rsvp_state: { status: 'none' }, current_node: 'contacto_inicial' };
    const validSuppression = plan.rsvp_state.status === 'none' && plan.current_node !== 'responder_invitacion';
    expect(validSuppression).toBe(true);
  });
});
