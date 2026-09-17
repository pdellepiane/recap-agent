import type { AgentGatewayResult } from './agent-conversation-gateway';
import type { HandoffOutcome } from './human-help-policy';
import type { TurnCapabilityOutcome } from './turn-capability-policy';
import type { TurnWaitEvidence } from '../core/messages';
import type { LastOutboundContext } from '../core/plan';

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

export type SupportHandoffReplyOutcome =
  | 'handoff_requested'
  | 'handoff_failed'
  | 'handoff_unknown'
  | 'handoff_duplicate'
  | 'handoff_skipped_missing_phone'
  | 'handoff_skipped_unavailable'
  | null;

export type SupportHandoffEvidence = {
  readonly handoffOutcome: SupportHandoffReplyOutcome;
  readonly identityAvailable: boolean;
  readonly effectConfirmed: boolean;
  readonly receiptPresent: boolean;
  readonly requiresReplyModel: boolean;
  readonly operationalNote: string;
};

/**
 * Projects a human-takeover gateway result into typed reply evidence before
 * generation. Success is claimed only from an actual gateway success;
 * failed, unknown and unattempted (skipped) results stay distinct and every
 * branch still requires this turn's model composition. Skipped attempts
 * project a typed skipped outcome that preserves the reason family
 * (missing-phone vs unavailable capability) so the model distinguishes
 * them from evidence without prose. The operational note carries facts
 * (status, reason) for traces, never reply prose.
 */
export function projectSupportHandoffEvidence(args: {
  readonly result: AgentGatewayResult;
  readonly phonePresent: boolean;
  readonly confirmedReceipt: boolean;
}): SupportHandoffEvidence {
  if (args.result.status === 'success') {
    return {
      handoffOutcome: 'handoff_requested',
      identityAvailable: args.phonePresent,
      effectConfirmed: true,
      receiptPresent: args.confirmedReceipt,
      requiresReplyModel: true,
      operationalNote: 'Human takeover was requested through the Agent API.',
    };
  }
  if (args.result.status === 'failed' && args.result.outcome === 'unknown') {
    return {
      handoffOutcome: 'handoff_unknown',
      identityAvailable: args.phonePresent,
      effectConfirmed: false,
      receiptPresent: false,
      requiresReplyModel: true,
      operationalNote: `Human escalation API call outcome unknown: ${args.result.error}`,
    };
  }
  if (args.result.status === 'failed') {
    return {
      handoffOutcome: 'handoff_failed',
      identityAvailable: args.phonePresent,
      effectConfirmed: false,
      receiptPresent: false,
      requiresReplyModel: true,
      operationalNote: `Human escalation API call failed: ${args.result.error}`,
    };
  }
  return {
    handoffOutcome: args.result.reason === 'missing_phone_number'
      ? 'handoff_skipped_missing_phone'
      : 'handoff_skipped_unavailable',
    identityAvailable: args.phonePresent,
    effectConfirmed: false,
    receiptPresent: false,
    requiresReplyModel: true,
    operationalNote: `Local human escalation soft-pause only: ${args.result.reason}.`,
  };
}

/**
 * Wait-aware reply recency default (10 minutes). Mirrors the typed
 * conversationTurn.priorReplyFreshnessMs config default so pure helpers and
 * tests without a loaded config resolve the same bound.
 */
export const DEFAULT_WAIT_FOLLOWUP_FRESHNESS_MS = 600_000;

/**
 * Bound for the prior-reply reference summary. The wait evidence carries a
 * short reference excerpt only, never the full prior text, so the composed
 * evidence set holds no repeated prior facts for the model to echo.
 */
export const WAIT_FOLLOWUP_PRIOR_SUMMARY_MAX_CHARS = 280;

export type WaitFollowupEvidence = {
  readonly waited: true;
  readonly wait_ms: number;
  readonly acquire_attempts: number;
  readonly prior_reply: {
    readonly message_id: string;
    readonly recorded_at: string;
    readonly summary: string;
    readonly summary_truncated: boolean;
  };
};

/**
 * Projects the wait-aware reply evidence for a turn that waited on the
 * conversation lease behind a preceding reply. Returns null on every other
 * turn (no wait fact, stale prior reply beyond the recency bound, missing
 * record) so unrelated turns stay byte-identical. Facts only, never reply
 * prose: the prior reply travels as identity plus a bounded reference
 * summary, never its full text. No keyword matching, no phrase blacklist.
 */
export function resolveWaitFollowupEvidence(args: {
  readonly turnWait: TurnWaitEvidence | null | undefined;
  readonly lastOutbound: LastOutboundContext | null | undefined;
  readonly nowMs: number;
  readonly freshnessMs?: number;
}): WaitFollowupEvidence | null {
  const turnWait = args.turnWait ?? null;
  const lastOutbound = args.lastOutbound ?? null;
  if (turnWait === null || lastOutbound === null) return null;
  if (!Number.isFinite(turnWait.attempts) || turnWait.attempts <= 1) return null;
  if (!Number.isFinite(turnWait.waitMs) || turnWait.waitMs < 0) return null;
  if (!Number.isFinite(args.nowMs)) return null;
  const freshnessMs = args.freshnessMs ?? DEFAULT_WAIT_FOLLOWUP_FRESHNESS_MS;
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) return null;
  const recordedMs = Date.parse(lastOutbound.recorded_at);
  if (!Number.isFinite(recordedMs)) return null;
  // A future-dated record (clock skew) still counts as fresh; only a record
  // older than the bound answers normally again.
  if (args.nowMs - recordedMs > freshnessMs) return null;
  const summary = summarizePriorReplyText(lastOutbound.text);
  if (summary === null) return null;
  return {
    waited: true,
    wait_ms: Math.max(0, Math.round(turnWait.waitMs)),
    acquire_attempts: Math.max(0, Math.round(turnWait.attempts)),
    prior_reply: {
      message_id: lastOutbound.message_id,
      recorded_at: lastOutbound.recorded_at,
      summary: summary.text,
      summary_truncated: summary.truncated,
    },
  };
}

function summarizePriorReplyText(
  text: string,
): { text: string; truncated: boolean } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const chars = Array.from(trimmed);
  if (chars.length <= WAIT_FOLLOWUP_PRIOR_SUMMARY_MAX_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: chars.slice(0, WAIT_FOLLOWUP_PRIOR_SUMMARY_MAX_CHARS).join(''),
    truncated: true,
  };
}
