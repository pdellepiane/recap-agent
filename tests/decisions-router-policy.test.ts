import { describe, expect, it } from 'vitest';

import type { OpenRequest, OpenRequestState } from '../src/core/open-request';
import {
  decideRouterPolicy,
  type RouterPolicyInput,
  type RouterPolicyOutcome,
} from '../src/runtime/decisions-router-policy';
import {
  routerRouteValues,
  type RouterRoute,
} from '../src/runtime/decisions-router-questions';

function openRequest(
  state: OpenRequestState,
  overrides: Partial<OpenRequest> = {},
): OpenRequest {
  return {
    key: 'wamid.request-1',
    opening_text: 'Quiero la devolución de mi compra',
    state,
    since: '2026-10-20T00:00:00.000Z',
    turns: 2,
    ...overrides,
  };
}

function policyInput(overrides: Partial<RouterPolicyInput> = {}): RouterPolicyInput {
  return {
    route: 'answer_with_records',
    sameOpenRequest: true,
    current: null,
    helpOfferPending: false,
    ...overrides,
  };
}

/** What the route alone decides when the record does not fire. */
const routeOutcome: Record<RouterRoute, RouterPolicyOutcome> = {
  answer_with_records: { kind: 'answer' },
  information_flow: { kind: 'information' },
  ask_clarification: { kind: 'clarify' },
  offer_human: { kind: 'offer_human' },
  escalate_human: { kind: 'escalate', reason: 'explicit_person_request' },
  rsvp_flow: { kind: 'rsvp' },
  planning_flow: { kind: 'planning' },
  suppress_ack: { kind: 'suppress_ack' },
};

// The policy has no thresholds: every input is a typed fact (the record state,
// whether the turn is about that record, and the route), so each case below is
// decided by the facts and never by a cut-off.
describe('decisions router policy', () => {
  it.each([...routerRouteValues])(
    'pauses a turn about a request that is with a person, whatever the route (%s)',
    (route) => {
      expect(decideRouterPolicy(policyInput({
        route,
        sameOpenRequest: true,
        current: openRequest('with_person'),
      }))).toEqual({ kind: 'pause' });
    },
  );

  it.each([...routerRouteValues])(
    'escalates a repeated request that is still unresolved, whatever the route (%s)',
    (route) => {
      expect(decideRouterPolicy(policyInput({
        route,
        sameOpenRequest: true,
        current: openRequest('unresolved', { turns: 3 }),
      }))).toEqual({ kind: 'escalate', reason: 'unresolved_request_repeated' });
    },
  );

  it.each([...routerRouteValues])(
    'never pauses an unrelated turn after a takeover (%s)',
    (route) => {
      // The defect this design fixes: the previous turn parked a request with a
      // person, and a later question that is not about that request must still
      // be served. `same_open_request: false` falls through to the route. The
      // one route it cannot take is a second escalation: the conversation
      // already has a person, so there is nothing left to escalate and the
      // records answer the turn instead. A live probe answered an event-date
      // question with a claimed new review and no date before this rule held.
      const outcome = decideRouterPolicy(policyInput({
        route,
        sameOpenRequest: false,
        current: openRequest('with_person'),
      }));
      expect(outcome).toEqual(
        route === 'escalate_human' ? { kind: 'answer' } : routeOutcome[route],
      );
      expect(outcome).not.toEqual({ kind: 'pause' });
    },
  );

  it.each([...routerRouteValues])(
    'never escalates an unrelated request by the record rule (%s)',
    (route) => {
      const outcome = decideRouterPolicy(policyInput({
        route,
        sameOpenRequest: false,
        current: openRequest('unresolved'),
      }));
      expect(outcome).toEqual(routeOutcome[route]);
      expect(outcome).not.toEqual({
        kind: 'escalate',
        reason: 'unresolved_request_repeated',
      });
    },
  );

  it.each([...routerRouteValues])(
    'never pauses or escalates by the record rule when there is no record (%s)',
    (route) => {
      expect(decideRouterPolicy(policyInput({
        route,
        sameOpenRequest: false,
        current: null,
      }))).toEqual(routeOutcome[route]);
      // A `same` answer without a record still has no record to read: the
      // route decides and nothing is paused.
      expect(decideRouterPolicy(policyInput({
        route,
        sameOpenRequest: true,
        current: null,
      }))).toEqual(routeOutcome[route]);
    },
  );

  it('escalates an explicit person request even without a record', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'escalate_human',
      sameOpenRequest: false,
      current: null,
    }))).toEqual({ kind: 'escalate', reason: 'explicit_person_request' });
  });

  it('escalates an explicit person request over an answered record', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'escalate_human',
      sameOpenRequest: true,
      current: openRequest('answered', { turns: 1 }),
    }))).toEqual({ kind: 'escalate', reason: 'explicit_person_request' });
  });

  it('answers a different request instead of escalating a thread that is with a person', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'escalate_human',
      sameOpenRequest: false,
      current: openRequest('with_person'),
    }))).toEqual({ kind: 'answer' });
    // The retry path is untouched: a request the record left unresolved still
    // escalates, because no person ever took it.
    expect(decideRouterPolicy(policyInput({
      route: 'escalate_human',
      sameOpenRequest: false,
      current: openRequest('unresolved'),
    }))).toEqual({ kind: 'escalate', reason: 'explicit_person_request' });
  });

  it('offers human help only while no offer is open', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'offer_human',
      helpOfferPending: false,
    }))).toEqual({ kind: 'offer_human' });
    expect(decideRouterPolicy(policyInput({
      route: 'offer_human',
      helpOfferPending: true,
    }))).toEqual({ kind: 'answer' });
  });

  it('maps each remaining route to its outcome', () => {
    expect(decideRouterPolicy(policyInput({ route: 'answer_with_records' }))).toEqual({
      kind: 'answer',
    });
    expect(decideRouterPolicy(policyInput({ route: 'ask_clarification' }))).toEqual({
      kind: 'clarify',
    });
    expect(decideRouterPolicy(policyInput({ route: 'suppress_ack' }))).toEqual({
      kind: 'suppress_ack',
    });
    expect(decideRouterPolicy(policyInput({ route: 'rsvp_flow' }))).toEqual({
      kind: 'rsvp',
    });
    expect(decideRouterPolicy(policyInput({ route: 'planning_flow' }))).toEqual({
      kind: 'planning',
    });
  });

  it('answers the first record-grounded follow-up to a nonfinancial unresolved request before escalating a loop', () => {
    const base = openRequest('unresolved', { turns: 1, financial_reconciliation_required: false });
    expect(decideRouterPolicy(policyInput({ route: 'answer_with_records', sameOpenRequest: true, current: base }))).toEqual({ kind: 'answer' });
    expect(decideRouterPolicy(policyInput({ route: 'answer_with_records', sameOpenRequest: true, current: { ...base, turns: 2 } }))).toEqual({ kind: 'escalate', reason: 'unresolved_request_repeated' });
    expect(decideRouterPolicy(policyInput({ route: 'answer_with_records', sameOpenRequest: true, current: { ...base, financial_reconciliation_required: true } }))).toEqual({ kind: 'escalate', reason: 'unresolved_request_repeated' });
    expect(decideRouterPolicy(policyInput({ route: 'escalate_human', sameOpenRequest: true, current: base }))).toEqual({ kind: 'escalate', reason: 'unresolved_request_repeated' });
  });

  it('lets the record rule win over an answer route', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'answer_with_records',
      sameOpenRequest: true,
      current: openRequest('unresolved', { turns: 4 }),
    }))).toEqual({ kind: 'escalate', reason: 'unresolved_request_repeated' });
  });

  it('lets the route decide when the record is already answered or needs input', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'answer_with_records',
      current: openRequest('answered'),
    }))).toEqual({ kind: 'answer' });
    expect(decideRouterPolicy(policyInput({
      route: 'ask_clarification',
      current: openRequest('needs_input'),
    }))).toEqual({ kind: 'clarify' });
  });
});

it('does not recompose a repeated escalation when a confirmed thread receipt already owns an unresolved request', () => {
  expect(decideRouterPolicy(policyInput({ current: openRequest('unresolved'), sameOpenRequest: true,
    route: 'escalate_human', takeoverConfirmed: true, requestSettled: false }))).toEqual({ kind: 'pause' });
});
