/**
 * WP2 — Decisions API router: the deterministic policy.
 *
 * The router proposes a route and two facts about the request; this policy
 * owns the effects. It reads one record — the open request — and nothing else.
 *
 * The policy is PURE: the same router answers and the same record always
 * produce the same outcome. It never writes a reply and never inspects the
 * customer message.
 */
import type { OpenRequest } from '../core/open-request';
import type { RouterRoute } from './decisions-router-questions';

/**
 * Why the turn escalates. The reason that fired is reported verbatim.
 *
 * Two reasons, both facts: the request the guest already asked came back
 * still open, or she asked for a person this turn.
 */
export type RouterEscalationReason =
  | 'unresolved_request_repeated'
  | 'explicit_person_request';

export type RouterPolicyOutcome =
  /**
   * The turn is about the request that is already with a person: nothing
   * happens and nothing is said. The record, not the turn shape, decides.
   */
  | { readonly kind: 'pause' }
  | { readonly kind: 'escalate'; readonly reason: RouterEscalationReason }
  | { readonly kind: 'offer_human' }
  | { readonly kind: 'answer' }
  | { readonly kind: 'information' }
  | { readonly kind: 'clarify' }
  | { readonly kind: 'suppress_ack' }
  | { readonly kind: 'planning' }
  | { readonly kind: 'rsvp' };

export type RouterPolicyInput = {
  /** Router route. */
  readonly route: RouterRoute;
  /**
   * Whether this turn is about the request the record holds. The router
   * answers it from the record it is shown; a turn about anything else opens
   * a new record and can never inherit a parked or unresolved state.
   */
  readonly sameOpenRequest: boolean;
  /** The request the previous turn left open, or null on a fresh thread. */
  readonly current: OpenRequest | null;
  /** True when an offer of human help is already open on this thread. */
  readonly helpOfferPending: boolean;
  /** New evidence or explicit withdrawal can resolve the old request without escalation. */
  readonly requestSettled?: boolean;
  readonly takeoverConfirmed?: boolean;
};

/**
 * Map the router answers and the open-request record onto one policy outcome.
 *
 * Order is the whole rule set:
 *
 * 1. The record says the request is with a person and this turn is about it:
 *    pause. A different request is never paused, so an answerable question
 *    that arrives after a takeover is answered.
 * 2. The record says the request is still open and the guest asked again:
 *    escalate. This is the loop, read from the record instead of inferred
 *    from a probability.
 * 3. The router says the guest asked for a person: escalate, and the attempt
 *    is retried when the record shows the previous one did not land. A turn
 *    about something else on a thread that is already with a person is not an
 *    escalation: there is nothing left to escalate, so the records answer it.
 * 4. The router offers help: honor the offer only while none is open.
 * 5. Otherwise the route decides.
 */
export function decideRouterPolicy(input: RouterPolicyInput): RouterPolicyOutcome {
  const current = input.current;
  const sameRequest = input.sameOpenRequest && current !== null;
  if (sameRequest && current.state === 'with_person') {
    return { kind: 'pause' };
  }
  if (sameRequest && current.state === 'unresolved' && !input.requestSettled) {
    // A first record-answerable follow-up may ask for another fact about the
    // same transaction. Give it one evidence-backed answer before the loop
    // backstop, while financial disputes and explicit escalation stay intact.
    if (!input.takeoverConfirmed && input.route === 'answer_with_records' &&
        current.financial_reconciliation_required === false && current.turns === 1) {
      return { kind: 'answer' };
    }
    return input.takeoverConfirmed
      ? { kind: 'pause' }
      : { kind: 'escalate', reason: 'unresolved_request_repeated' };
  }
  switch (input.route) {
    case 'escalate_human':
      // The record rule above already paused the turn that is about the parked
      // request, so reaching this branch with a parked record means the turn is
      // about something else. That case cannot be escalated: the conversation
      // already has a person, and repeating the handoff would only let the
      // reply claim a review instead of answering what was asked.
      return input.takeoverConfirmed || current?.state === 'with_person'
        ? { kind: 'answer' }
        : { kind: 'escalate', reason: 'explicit_person_request' };
    case 'offer_human':
      return input.helpOfferPending ? { kind: 'answer' } : { kind: 'offer_human' };
    case 'information_flow':
      return { kind: 'information' };
    case 'answer_with_records':
      return { kind: 'answer' };
    case 'ask_clarification':
      return { kind: 'clarify' };
    case 'suppress_ack':
      return { kind: 'suppress_ack' };
    case 'rsvp_flow':
      return { kind: 'rsvp' };
    case 'planning_flow':
      return { kind: 'planning' };
  }
}
