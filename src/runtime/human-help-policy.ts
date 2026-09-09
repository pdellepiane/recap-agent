export const handoffOutcomes = [
  'handoff_requested',
  'handoff_failed',
  'outcome_unknown',
] as const;

export type HandoffOutcome = (typeof handoffOutcomes)[number];

export type HandoffPersistedRecord = {
  readonly dedupeKey: string;
  readonly inboundId: string;
  readonly phone: string;
  readonly outcome: HandoffOutcome;
  readonly requested: boolean;
  readonly softPaused: boolean;
  readonly updatedAt: string;
};

export type HandoffGatewayStatus = 'success' | 'failed' | 'unknown' | 'blocked' | 'skipped';

export function buildHandoffDedupeKey(conversationId: string, scope = 'general'): string {
  const safeConversation = conversationId.trim().length > 0 ? conversationId.trim() : 'unknown';
  const safeScope = scope.trim().length > 0 ? scope.trim() : 'general';
  return `handoff:${safeConversation}:${safeScope}`;
}

export type HumanHelpAttemptDecision =
  | { readonly action: 'attempt'; readonly dedupeKey: string; readonly reason: string }
  | { readonly action: 'skip_duplicate'; readonly dedupeKey: string; readonly reason: string }
  | { readonly action: 'skip_unknown_unretried'; readonly dedupeKey: string; readonly reason: string }
  | { readonly action: 'skip_no_phone'; readonly dedupeKey: string; readonly reason: string }
  | { readonly action: 'skip_unavailable'; readonly dedupeKey: string; readonly reason: string };

export function decideHumanHelpAttempt(args: {
  readonly conversationId: string;
  readonly inboundId: string;
  readonly scope?: string;
  readonly trustedPhone: string | null;
  readonly gatewayCapable: boolean;
  readonly prior: HandoffPersistedRecord | null;
  readonly explicitRetry: boolean;
}): HumanHelpAttemptDecision {
  const dedupeKey = buildHandoffDedupeKey(args.conversationId, args.scope ?? 'general');
  if (!args.trustedPhone || args.trustedPhone.trim().length === 0) {
    return { action: 'skip_no_phone', dedupeKey, reason: 'missing_identity' };
  }
  if (!args.gatewayCapable) {
    return { action: 'skip_unavailable', dedupeKey, reason: 'gateway_unavailable' };
  }
  const prior = args.prior;
  if (prior !== null && prior.dedupeKey === dedupeKey) {
    if (prior.outcome === 'handoff_requested') {
      return { action: 'skip_duplicate', dedupeKey, reason: 'already_requested' };
    }
    if (prior.outcome === 'outcome_unknown') {
      return { action: 'skip_unknown_unretried', dedupeKey, reason: 'unknown_stays_unretried' };
    }
    if (prior.outcome === 'handoff_failed') {
      const isNewInbound = prior.inboundId !== args.inboundId;
      if (args.explicitRetry && isNewInbound) {
        return { action: 'attempt', dedupeKey, reason: 'explicit_retry_new_inbound' };
      }
      return { action: 'skip_duplicate', dedupeKey, reason: 'failed_no_auto_retry' };
    }
  }
  return { action: 'attempt', dedupeKey, reason: 'first_attempt' };
}

export function resolveHandoffGatewayStatus(
  result: { status: 'success' | 'failed' | 'skipped' | 'blocked'; outcome?: 'failed' | 'unknown' },
): HandoffGatewayStatus {
  if (result.status === 'success') return 'success';
  if (result.status === 'failed' && result.outcome === 'unknown') return 'unknown';
  if (result.status === 'failed') return 'failed';
  if (result.status === 'blocked') return 'blocked';
  return 'skipped';
}

export function applyHandoffResult(args: {
  readonly dedupeKey: string;
  readonly inboundId: string;
  readonly phone: string;
  readonly gatewayStatus: HandoffGatewayStatus;
  readonly nowIso?: string;
}): HandoffPersistedRecord {
  const now = args.nowIso ?? new Date().toISOString();
  if (args.gatewayStatus === 'success') {
    return {
      dedupeKey: args.dedupeKey,
      inboundId: args.inboundId,
      phone: args.phone,
      outcome: 'handoff_requested',
      requested: true,
      softPaused: true,
      updatedAt: now,
    };
  }
  if (args.gatewayStatus === 'unknown') {
    return {
      dedupeKey: args.dedupeKey,
      inboundId: args.inboundId,
      phone: args.phone,
      outcome: 'outcome_unknown',
      requested: false,
      softPaused: false,
      updatedAt: now,
    };
  }
  return {
    dedupeKey: args.dedupeKey,
    inboundId: args.inboundId,
    phone: args.phone,
    outcome: 'handoff_failed',
    requested: false,
    softPaused: false,
    updatedAt: now,
  };
}
