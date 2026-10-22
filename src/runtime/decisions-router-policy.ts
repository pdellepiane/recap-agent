/**
 * WP2 — Decisions API router: the deterministic policy.
 *
 * Decision 2 is final and is implemented here verbatim. The router proposes;
 * this policy owns the effects. Every threshold is a named constant so no
 * magic number travels through the turn flow.
 *
 * The policy is PURE: the same router answers and outcome state always
 * produce the same outcome. It never writes a reply and never inspects the
 * customer message.
 */
import type { RouterRoute } from './decisions-router-questions';

/** Decision 2 constants, verbatim. */
export const routerPolicyThresholds = {
  /** Escalate when the router probability reaches this value. */
  needsHumanNowEscalation: 0.70,
  /** Escalate at this rubric level and above. */
  loopRiskEscalation: 3,
  /** Escalate at this capability probability and above, for human routes. */
  capabilityBlockedEscalation: 0.80,
  /** A route of escalate_human escalates from this probability on. */
  escalateRouteNeedsHumanNow: 0.50,
  /** Repeat count on an unresolved money signature that escalates. */
  repeatCountBackstop: 2,
  /**
   * Consecutive capability-blocked turns that escalate.
   *
   * The same shape as the money backstop, for the other kind of
   * unresolved request: one the runtime is told it cannot serve, asked
   * again and again. The first turn may still be answered from the
   * records; the second one means the answer is not moving.
   */
  capabilityBlockedBackstop: 2,
  /** The only rubric level that may open a human offer. */
  offerHumanLoopRisk: 2,
} as const;

/** Why the turn escalates. The reason that fired is reported verbatim. */
export type RouterEscalationReason =
  | 'needs_human_now_threshold'
  | 'loop_risk_threshold'
  | 'capability_blocked_threshold'
  | 'repeat_count_backstop'
  | 'capability_blocked_repeat_backstop'
  | 'escalate_route_with_needs_human';

export type RouterPolicyOutcome =
  | { readonly kind: 'escalate'; readonly reason: RouterEscalationReason }
  | { readonly kind: 'offer_human' }
  | { readonly kind: 'answer' }
  | { readonly kind: 'clarify' }
  | { readonly kind: 'suppress_ack' }
  | { readonly kind: 'planning' }
  | { readonly kind: 'rsvp' };

export type RouterPolicyInput = {
  /** Router probability for `needs_human_now`. */
  readonly needsHumanNow: number;
  /** Router probability for `capability_blocked`. */
  readonly capabilityBlocked: number;
  /** Router rubric level for `loop_risk`, 0..4. */
  readonly loopRisk: number;
  /** Router route. */
  readonly route: RouterRoute;
  /** Consecutive identical outcome signatures. */
  readonly repeatCount: number;
  /** True when the current outcome signature is an unresolved money outcome. */
  readonly unresolvedMoney: boolean;
  /**
   * Consecutive turns in which the request depended on a capability the
   * runtime cannot execute, including this turn. The capability-blocked
   * repeat backstop uses it: a request the runtime is told it cannot
   * serve, asked again, is a loop the router's own answer may not see.
   */
  readonly capabilityBlockedStreak: number;
};

/**
 * Map the router answers and the outcome state onto one policy outcome.
 *
 * Escalation order follows Decision 2. The repeat-count backstop overrides
 * the router output: a router that keeps proposing an answer on an
 * unresolved money signature still escalates on the second repetition. The
 * capability-blocked backstop is its twin for the other kind of unresolved
 * request: one the runtime is told it cannot serve.
 *
 * Degrade rules (deterministic, documented):
 * - A route of `offer_human` is honored only at rubric level 2 with no
 *   escalation trigger. Any other level degrades to `answer`.
 * - A route of `escalate_human` that satisfies no escalation condition
 *   degrades to `answer`: the deterministic policy owns the effect, so a
 *   route alone never takes the conversation over.
 */
export function decideRouterPolicy(input: RouterPolicyInput): RouterPolicyOutcome {
  const escalation = escalationReasonFor(input);
  if (escalation !== null) {
    return { kind: 'escalate', reason: escalation };
  }
  switch (input.route) {
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
    case 'offer_human':
      return input.loopRisk === routerPolicyThresholds.offerHumanLoopRisk
        ? { kind: 'offer_human' }
        : { kind: 'answer' };
    case 'escalate_human':
      return { kind: 'answer' };
  }
}

/**
 * The escalation trigger that fires, or null when none fires. Exported so the
 * turn flow can report the reason without re-deriving the thresholds.
 */
export function escalationReasonFor(
  input: RouterPolicyInput,
): RouterEscalationReason | null {
  if (input.needsHumanNow >= routerPolicyThresholds.needsHumanNowEscalation) {
    return 'needs_human_now_threshold';
  }
  if (input.loopRisk >= routerPolicyThresholds.loopRiskEscalation) {
    return 'loop_risk_threshold';
  }
  if (
    input.capabilityBlocked >= routerPolicyThresholds.capabilityBlockedEscalation &&
    (input.route === 'escalate_human' || input.route === 'offer_human')
  ) {
    return 'capability_blocked_threshold';
  }
  if (
    input.repeatCount >= routerPolicyThresholds.repeatCountBackstop &&
    input.unresolvedMoney
  ) {
    return 'repeat_count_backstop';
  }
  if (
    input.capabilityBlockedStreak >= routerPolicyThresholds.capabilityBlockedBackstop
  ) {
    return 'capability_blocked_repeat_backstop';
  }
  if (
    input.route === 'escalate_human' &&
    input.needsHumanNow >= routerPolicyThresholds.escalateRouteNeedsHumanNow
  ) {
    return 'escalate_route_with_needs_human';
  }
  return null;
}
