import type { HandoffOutcome } from './human-help-policy';
import type { TurnCapabilityOutcome } from './turn-capability-policy';

/**
 * S10 single owner of reply evidence projection.
 *
 * Consumes typed turn evidence (continuity disposition, capability outcome,
 * handoff outcome, verified facts, receipts) and produces the minimal
 * model-visible reply input. Complete deterministic outcomes never invoke
 * the reply model; clarification excludes providers before generation and
 * acknowledgement carries no provider tools. Invalid narrative structure
 * falls back to the deterministic renderer with no corrective model call.
 */

export type ReplyMode = 'suppressed' | 'deterministic' | 'narrative';

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
  readonly mode: ReplyMode;
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
      mode: 'deterministic',
      requiresReplyModel: false,
      providersExcluded: true,
      providerTools: [],
      verifiedFacts: [...input.verifiedFacts],
      allowedNextSteps: [...input.allowedNextSteps],
    };
  }
  if (input.continuity.disposition === 'suppress_closure' && input.capabilityOutcome === null) {
    return {
      mode: 'suppressed',
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
    mode: 'narrative',
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

export type ResolvedReplyText = {
  readonly text: string;
  readonly usedFallback: boolean;
  readonly correctiveModelCall: boolean;
};

export function resolveReplyText(args: {
  readonly mode: ReplyMode;
  readonly deterministicText: string;
  readonly narrative: string | null;
  readonly claims: 'ok' | 'fallback';
}): ResolvedReplyText {
  if (args.mode === 'suppressed') {
    return { text: '', usedFallback: false, correctiveModelCall: false };
  }
  if (args.mode === 'deterministic' || args.claims === 'fallback' || args.narrative === null) {
    return {
      text: args.deterministicText,
      usedFallback: args.mode !== 'narrative' || args.claims === 'fallback',
      correctiveModelCall: false,
    };
  }
  return { text: args.narrative, usedFallback: false, correctiveModelCall: false };
}
