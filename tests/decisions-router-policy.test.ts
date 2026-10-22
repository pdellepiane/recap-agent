import { describe, expect, it } from 'vitest';

import {
  decideRouterPolicy,
  escalationReasonFor,
  routerPolicyThresholds,
  type RouterPolicyInput,
} from '../src/runtime/decisions-router-policy';

function policyInput(overrides: Partial<RouterPolicyInput> = {}): RouterPolicyInput {
  return {
    needsHumanNow: 0,
    capabilityBlocked: 0,
    loopRisk: 0,
    route: 'answer_with_records',
    repeatCount: 0,
    unresolvedMoney: false,
    capabilityBlockedStreak: 0,
    ...overrides,
  };
}

describe('decisions router policy', () => {
  it('keeps the Decision 2 constants verbatim', () => {
    expect(routerPolicyThresholds).toEqual({
      needsHumanNowEscalation: 0.70,
      loopRiskEscalation: 3,
      capabilityBlockedEscalation: 0.80,
      escalateRouteNeedsHumanNow: 0.50,
      repeatCountBackstop: 2,
      // Added with the capability-blocked backstop: the same shape as the
      // money backstop, for the other kind of unresolved request.
      capabilityBlockedBackstop: 2,
      offerHumanLoopRisk: 2,
    });
  });

  it('escalates when needs_human_now reaches the threshold', () => {
    expect(decideRouterPolicy(policyInput({ needsHumanNow: 0.70 }))).toEqual({
      kind: 'escalate',
      reason: 'needs_human_now_threshold',
    });
    expect(decideRouterPolicy(policyInput({ needsHumanNow: 0.69 })).kind).not.toBe('escalate');
  });

  it('escalates when loop_risk reaches level 3', () => {
    expect(decideRouterPolicy(policyInput({ loopRisk: 3 }))).toEqual({
      kind: 'escalate',
      reason: 'loop_risk_threshold',
    });
    expect(decideRouterPolicy(policyInput({ loopRisk: 2 })).kind).not.toBe('escalate');
  });

  it('escalates when capability_blocked is high and the route asks for a human', () => {
    expect(decideRouterPolicy(policyInput({
      capabilityBlocked: 0.80,
      route: 'escalate_human',
    }))).toEqual({
      kind: 'escalate',
      reason: 'capability_blocked_threshold',
    });
    expect(decideRouterPolicy(policyInput({
      capabilityBlocked: 0.80,
      route: 'offer_human',
    }))).toEqual({
      kind: 'escalate',
      reason: 'capability_blocked_threshold',
    });
    expect(decideRouterPolicy(policyInput({
      capabilityBlocked: 0.80,
      route: 'answer_with_records',
    })).kind).not.toBe('escalate');
  });

  it('escalates on the repeat backstop even when the router proposes an answer', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'answer_with_records',
      repeatCount: 2,
      unresolvedMoney: true,
    }))).toEqual({
      kind: 'escalate',
      reason: 'repeat_count_backstop',
    });
  });

  it('does not escalate on the backstop when the money outcome is resolved', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'answer_with_records',
      repeatCount: 4,
      unresolvedMoney: false,
    })).kind).not.toBe('escalate');
  });

  it('escalates on the capability-blocked backstop when the request the runtime cannot serve comes back', () => {
    // The first capability-blocked turn may still be answered from the
    // records; the second one means the answer is not moving.
    expect(decideRouterPolicy(policyInput({
      capabilityBlocked: 0.9,
      capabilityBlockedStreak: 1,
    })).kind).not.toBe('escalate');
    expect(decideRouterPolicy(policyInput({
      capabilityBlocked: 0.9,
      capabilityBlockedStreak: 2,
    }))).toEqual({ kind: 'escalate', reason: 'capability_blocked_repeat_backstop' });
    // A settled money outcome does not matter here: the blocked request is
    // the thing that is not moving.
    expect(decideRouterPolicy(policyInput({
      capabilityBlocked: 0.9,
      capabilityBlockedStreak: 3,
      repeatCount: 4,
      unresolvedMoney: false,
    })).kind).toBe('escalate');
  });

  it('escalates on an escalate_human route from needs_human_now 0.50 on', () => {
    expect(decideRouterPolicy(policyInput({
      route: 'escalate_human',
      needsHumanNow: 0.50,
    }))).toEqual({
      kind: 'escalate',
      reason: 'escalate_route_with_needs_human',
    });
    expect(decideRouterPolicy(policyInput({
      route: 'escalate_human',
      needsHumanNow: 0.49,
    })).kind).not.toBe('escalate');
  });

  it('opens a human offer only at loop risk level 2', () => {
    expect(decideRouterPolicy(policyInput({ route: 'offer_human', loopRisk: 2 }))).toEqual({
      kind: 'offer_human',
    });
    expect(decideRouterPolicy(policyInput({ route: 'offer_human', loopRisk: 1 }))).toEqual({
      kind: 'answer',
    });
    expect(decideRouterPolicy(policyInput({ route: 'offer_human', loopRisk: 3 }))).toEqual({
      kind: 'escalate',
      reason: 'loop_risk_threshold',
    });
  });

  it('degrades an escalate_human route without a trigger to an answer', () => {
    expect(decideRouterPolicy(policyInput({ route: 'escalate_human' }))).toEqual({
      kind: 'answer',
    });
  });

  it('maps the remaining routes to their outcomes', () => {
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

  it('treats a refused question as no signal instead of an escalation trigger', () => {
    // A refusal contributes the neutral defaults: probability 0, level 0 and
    // the answer route. No refusal may escalate the turn.
    const refused = policyInput({
      needsHumanNow: 0,
      capabilityBlocked: 0,
      loopRisk: 0,
      route: 'answer_with_records',
    });
    expect(escalationReasonFor(refused)).toBeNull();
    expect(decideRouterPolicy(refused)).toEqual({ kind: 'answer' });
  });
});
