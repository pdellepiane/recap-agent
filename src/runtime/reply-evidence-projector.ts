import type { HandoffOutcome } from './human-help-policy';
import type { TurnCapabilityOutcome } from './turn-capability-policy';

/**
 * L1 owner of reply evidence projection.
 *
 * Consumes typed turn evidence (continuity disposition, capability outcome,
 * handoff outcome, verified facts, receipts) and produces the minimal
 * model-visible reply input. There is no deterministic text mode: complete
 * outcomes are composed by the model from projected facts, clarification
 * excludes providers before generation, and acknowledgement carries no
 * provider tools. Suppression is a legitimate no-delivery decision, never a
 * silent failure; operational failures are typed separately.
 */

export type ReplyDisposition = 'suppressed' | 'composed' | 'operational_failure';

export type ReplyContinuitySummary = {
  readonly disposition: 'extract_action' | 'acknowledge_without_interview' | 'suppress_closure';
  readonly providerToolsAllowed: boolean;
  readonly suppressClosure: boolean;
};

export type ReplyProjectionInput = {
  readonly continuity: ReplyContinuitySummary;
  readonly capabilityOutcome: TurnCapabilityOutcome | null;
  readonly handoffOutcome?: HandoffOutcome | null;
  readonly verifiedFacts: readonly string[];
  readonly allowedNextSteps: readonly string[];
  readonly providerResultCount: number;
  readonly acknowledgeRelationshipOnce?: boolean;
};

export type ReplyProjection = {
  readonly disposition: ReplyDisposition;
  readonly requiresReplyModel: boolean;
  readonly providersExcluded: boolean;
  readonly providerTools: readonly string[];
  readonly verifiedFacts: readonly string[];
  readonly allowedNextSteps: readonly string[];
};

function isCompleteOutcome(outcome: TurnCapabilityOutcome | null): boolean {
  return outcome !== null &&
    outcome.status !== 'executable' &&
    outcome.status !== 'needs_input';
}

export function projectReply(input: ReplyProjectionInput): ReplyProjection {
  const complete = isCompleteOutcome(input.capabilityOutcome);
  const acknowledgedOnce = input.acknowledgeRelationshipOnce === true;
  if (complete || acknowledgedOnce) {
    return {
      disposition: 'composed',
      requiresReplyModel: true,
      providersExcluded: true,
      providerTools: [],
      verifiedFacts: [...input.verifiedFacts],
      allowedNextSteps: [...input.allowedNextSteps],
    };
  }
  if (input.continuity.disposition === 'suppress_closure' && input.capabilityOutcome === null) {
    return {
      disposition: 'suppressed',
      requiresReplyModel: false,
      providersExcluded: true,
      providerTools: [],
      verifiedFacts: [...input.verifiedFacts],
      allowedNextSteps: [...input.allowedNextSteps],
    };
  }
  const providersExcluded = input.providerResultCount > 0 ||
    !input.continuity.providerToolsAllowed ||
    input.capabilityOutcome?.status === 'needs_input';
  return {
    disposition: 'composed',
    requiresReplyModel: true,
    providersExcluded,
    providerTools: input.continuity.providerToolsAllowed &&
        input.capabilityOutcome?.status === 'executable'
      ? ['provider_tools']
      : [],
    verifiedFacts: [...input.verifiedFacts],
    allowedNextSteps: [...input.allowedNextSteps],
  };
}

/** Typed operational failure projection for paths that cannot compose. */
export function projectOperationalFailure(args: {
  readonly verifiedFacts?: readonly string[];
  readonly allowedNextSteps?: readonly string[];
}): ReplyProjection {
  return {
    disposition: 'operational_failure',
    requiresReplyModel: false,
    providersExcluded: true,
    providerTools: [],
    verifiedFacts: [...(args.verifiedFacts ?? [])],
    allowedNextSteps: [...(args.allowedNextSteps ?? [])],
  };
}

export type ReplyNarrativeClaim = {
  readonly operation: string;
  readonly claimsSuccess: boolean;
  readonly receiptPresent: boolean;
  readonly operationAllowed: boolean;
};

/**
 * Structural claim contract for bounded narrative composition. A success
 * claim needs a matching receipt and an allowed typed operation. No
 * keyword routing or success detection is used here.
 */
export function checkReplyNarrativeClaims(
  claims: readonly ReplyNarrativeClaim[],
): 'ok' | 'fallback' {
  for (const claim of claims) {
    if (claim.claimsSuccess && (!claim.receiptPresent || !claim.operationAllowed)) {
      return 'fallback';
    }
  }
  return 'ok';
}

export type ResolvedComposedReply = {
  readonly disposition: ReplyDisposition;
  readonly text: string | null;
};

/**
 * Resolves a projected reply to deliverable text. Composed dispositions
 * require this turn's model text; anything else is a typed failure, never a
 * template substitution. Invalid claims do not silently become canned prose:
 * they resolve to an operational failure the channel reports without prose.
 */
export function resolveComposedReply(args: {
  readonly disposition: ReplyDisposition;
  readonly modelText: string | null;
  readonly claims: 'ok' | 'fallback';
}): ResolvedComposedReply {
  if (args.disposition === 'suppressed') {
    return { disposition: 'suppressed', text: null };
  }
  if (args.disposition === 'operational_failure' || args.claims === 'fallback') {
    return { disposition: 'operational_failure', text: null };
  }
  if (args.modelText === null) {
    return { disposition: 'operational_failure', text: null };
  }
  return { disposition: 'composed', text: args.modelText };
}
