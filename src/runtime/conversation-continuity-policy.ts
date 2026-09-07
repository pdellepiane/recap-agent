/**
 * Pure conversation-continuity policy for S05.
 *
 * Handles campaign greetings, deferrals and post-RSVP remarks without
 * reopening the provider interview. All decisions use typed evidence
 * (message source, direction, recency, classifier enums, extraction flags,
 * persisted attendance state). No body-text keyword matching, no second
 * conversational memory, raw history stays bounded by the caller.
 */

export const reminderOutboundSources = [
  'admin_campaign',
  'frontend_followup',
] as const;

export const manualFollowupSources = ['admin_manual'] as const;

export const campaignLikeSources = [
  ...reminderOutboundSources,
  ...manualFollowupSources,
] as const;

export type CampaignLikeSource =
  (typeof campaignLikeSources)[number];

export type ContinuitySourceCategory =
  | 'reminder'
  | 'manual'
  | 'other';

export function categorizeOutboundSource(
  source: string | null,
): ContinuitySourceCategory {
  if (source === 'admin_campaign' || source === 'frontend_followup') {
    return 'reminder';
  }
  if (source === 'admin_manual') {
    return 'manual';
  }
  return 'other';
}

export function isReminderOutboundSource(
  source: string | null,
): boolean {
  return categorizeOutboundSource(source) === 'reminder';
}

export function isManualFollowupSource(
  source: string | null,
): boolean {
  return categorizeOutboundSource(source) === 'manual';
}

export function isCampaignLikeSource(
  source: string | null,
): boolean {
  return (
    isReminderOutboundSource(source) || isManualFollowupSource(source)
  );
}

export type MinimalContinuityMessage = {
  id: number;
  direction: 'inbound' | 'outbound';
  source: string | null;
};

export type ReminderContext = {
  hasReminderHistory: boolean;
  hasCurrentReminder: boolean;
  hasOldCampaignOnly: boolean;
  hasManualFollowup: boolean;
  newestReminderSource: string | null;
  entryMessageId: number | null;
};

export function resolveReminderContext(
  messages: readonly MinimalContinuityMessage[],
): ReminderContext {
  let newestReminderSource: string | null = null;
  let entryMessageId: number | null = null;
  let hasReminderHistory = false;
  let hasManualFollowup = false;
  let newestOutboundSource: string | null = null;

  for (const message of messages) {
    if (message.direction !== 'outbound') {
      continue;
    }
    newestOutboundSource = message.source;
    if (isCampaignLikeSource(message.source)) {
      hasReminderHistory = true;
      newestReminderSource = message.source;
      entryMessageId = message.id;
    }
    if (isManualFollowupSource(message.source)) {
      hasManualFollowup = true;
    }
  }

  const hasCurrentReminder =
    newestOutboundSource !== null &&
    isCampaignLikeSource(newestOutboundSource);
  const hasOldCampaignOnly = hasReminderHistory && !hasCurrentReminder;

  return {
    hasReminderHistory,
    hasCurrentReminder,
    hasOldCampaignOnly,
    hasManualFollowup,
    newestReminderSource,
    entryMessageId,
  };
}

export type PurchaseThreadState = {
  hasPendingPurchaseOrEventRequest: boolean;
  lastCompletedKind: string | null;
};

/**
 * A purchase thread is active when a purchase/associated_event request is
 * still pending or the last completed request was a purchase/associated
 * event lookup. Typed plan evidence only; no message-text matching.
 */
export function hasActivePurchaseThread(state: PurchaseThreadState): boolean {
  if (state.hasPendingPurchaseOrEventRequest) return true;
  return state.lastCompletedKind === 'purchase' ||
    state.lastCompletedKind === 'associated_event';
}

/**
 * An active purchase thread suppresses the conversation-health help offer
 * so a checkout/purchase follow-up stays in its thread instead of moving
 * to ofrecer_agente_humano. An already-requested escalation is never
 * suppressed.
 */
export function purchaseThreadSuppressesHealthOffer(args: {
  hasActivePurchaseThread: boolean;
  humanEscalationRequested: boolean;
}): boolean {
  return args.hasActivePurchaseThread && !args.humanEscalationRequested;
}

/**
 * An active purchase thread bypasses the generic contextual clarification
 * prompt so the information flow replays the last completed purchase/event
 * request with its canonical evidence instead of asking a generic question.
 */
export function purchaseThreadBypassesContextualClarification(
  lastCompletedKind: string | null,
): boolean {
  return lastCompletedKind === 'purchase' || lastCompletedKind === 'associated_event';
}

export type ClassifierProfile = 'campaign_reply' | 'general';

export function resolveClassifierProfile(
  messages: readonly MinimalContinuityMessage[],
): ClassifierProfile {
  let newestOutboundSource: string | null = null;
  for (const message of messages) {
    if (message.direction === 'outbound') {
      newestOutboundSource = message.source;
    }
  }
  if (
    newestOutboundSource !== null &&
    isCampaignLikeSource(newestOutboundSource)
  ) {
    return 'campaign_reply';
  }
  return 'general';
}

export type ClassifierAction =
  | 'respond'
  | 'suppress_acknowledgement'
  | 'suppress_reaction'
  | 'suppress_automated_response';

export type CampaignReplyKind =
  | 'not_applicable'
  | 'rsvp_decision'
  | 'declines_campaign_offer'
  | 'acknowledgement_only'
  | 'reaction_only'
  | 'question_or_request'
  | 'other_actionable'
  | 'unclear';

export type CampaignReplyDisposition =
  | 'suppress_closure'
  | 'acknowledge_without_interview'
  | 'extract_action';

/**
 * Resolve contradictory early-automation classifier output through typed
 * policy. A model `respond` paired with `acknowledgement_only` (the observed
 * Jose shape) must not reopen the provider interview: it acknowledges
 * contextually without tools or a repeated welcome.
 */
export function resolveCampaignReplyDisposition(args: {
  action: ClassifierAction;
  campaignReplyKind: CampaignReplyKind;
  hasExplicitRequest: boolean;
  hasRsvpDecision: boolean;
  hasCredentialDecision: boolean;
  isExplicitTopicSwitch: boolean;
}): CampaignReplyDisposition {
  if (
    args.hasExplicitRequest ||
    args.hasRsvpDecision ||
    args.hasCredentialDecision ||
    args.isExplicitTopicSwitch
  ) {
    return 'extract_action';
  }
  switch (args.campaignReplyKind) {
    case 'rsvp_decision':
    case 'question_or_request':
    case 'other_actionable':
    case 'unclear':
      return 'extract_action';
    case 'declines_campaign_offer':
    case 'reaction_only':
      return args.action === 'respond'
        ? 'acknowledge_without_interview'
        : 'suppress_closure';
    case 'acknowledgement_only':
      return args.action === 'respond'
        ? 'acknowledge_without_interview'
        : 'suppress_closure';
    case 'not_applicable':
    default:
      return args.action === 'respond'
        ? 'extract_action'
        : 'suppress_closure';
  }
}

export type AttendanceState =
  | 'attending'
  | 'declining'
  | 'pending'
  | 'none'
  | 'unknown';

/**
 * RSVP consent requires an explicit typed attendance decision from structured
 * extraction. Confusion, thanks, relationship remarks and questions are never
 * consent (Maria Paz confusion stays non-consent).
 */
export function isRsvpConsentDecision(args: {
  campaignReplyKind: CampaignReplyKind;
  hasExplicitRsvpDecision: boolean;
}): boolean {
  return (
    args.campaignReplyKind === 'rsvp_decision' &&
    args.hasExplicitRsvpDecision
  );
}

export type HistoryStatus =
  | 'available'
  | 'empty'
  | 'unavailable'
  | 'not_configured'
  | 'missing_phone_number';

export type ContinuityPolicyInput = {
  hasPriorContext: boolean;
  historyStatus: HistoryStatus;
  action: ClassifierAction;
  campaignReplyKind: CampaignReplyKind;
  extractionDeltaEmpty: boolean;
  hasExplicitRequest: boolean;
  hasRsvpDecision: boolean;
  hasCredentialDecision: boolean;
  isExplicitTopicSwitch: boolean;
  isPureClosure: boolean;
  hasSubstantiveRelationshipRemark: boolean;
  attendingState: AttendanceState;
  hasActionableUnresolvedRequest: boolean;
};

export type ContinuityPolicyDecision = {
  disposition: CampaignReplyDisposition;
  shouldSuppressWelcome: boolean;
  allowOnboarding: boolean;
  suppressPureClosure: boolean;
  acknowledgeRelationshipOnce: boolean;
  passThrough: boolean;
  preserveAttending: boolean;
  allowPartySizeChange: boolean;
  grantAccess: boolean;
  isRsvpConsent: boolean;
  boundedClarification: boolean;
  providerToolsAllowed: boolean;
};

export function resolveContinuityDecision(
  input: ContinuityPolicyInput,
): ContinuityPolicyDecision {
  const disposition = resolveCampaignReplyDisposition({
    action: input.action,
    campaignReplyKind: input.campaignReplyKind,
    hasExplicitRequest: input.hasExplicitRequest,
    hasRsvpDecision: input.hasRsvpDecision,
    hasCredentialDecision: input.hasCredentialDecision,
    isExplicitTopicSwitch: input.isExplicitTopicSwitch,
  });

  const explicitPassThrough =
    input.hasExplicitRequest ||
    input.hasRsvpDecision ||
    input.hasCredentialDecision ||
    input.isExplicitTopicSwitch;
  const passThrough =
    explicitPassThrough ||
    (disposition === 'extract_action' && !input.extractionDeltaEmpty);

  // Empty delta never starts onboarding, even with no prior context.
  const allowOnboarding =
    !input.extractionDeltaEmpty && !input.hasPriorContext && passThrough;

  const shouldSuppressWelcome = input.hasPriorContext;

  const suppressPureClosure =
    !passThrough &&
    input.isPureClosure &&
    (disposition === 'suppress_closure' ||
      disposition === 'acknowledge_without_interview');

  // A substantive relationship comment after verified attendance gets one
  // short acknowledgement without a new question, tools or state change.
  const acknowledgeRelationshipOnce =
    !passThrough &&
    !input.isPureClosure &&
    input.hasSubstantiveRelationshipRemark;

  const preserveAttending = input.attendingState === 'attending';

  const isRsvpConsent = isRsvpConsentDecision({
    campaignReplyKind: input.campaignReplyKind,
    hasExplicitRsvpDecision: input.hasRsvpDecision,
  });

  // Missing histories produce a bounded clarification only when an
  // actionable request cannot otherwise be resolved. Never onboarding.
  const historyMissing =
    input.historyStatus === 'unavailable' ||
    input.historyStatus === 'empty' ||
    input.historyStatus === 'not_configured' ||
    input.historyStatus === 'missing_phone_number';
  const boundedClarification =
    historyMissing &&
    input.hasActionableUnresolvedRequest &&
    !passThrough;

  // Acknowledgement and clarification never carry provider tools (S16).
  const providerToolsAllowed = passThrough;

  return {
    disposition,
    shouldSuppressWelcome,
    allowOnboarding,
    suppressPureClosure,
    acknowledgeRelationshipOnce,
    passThrough,
    preserveAttending,
    allowPartySizeChange: false,
    grantAccess: false,
    isRsvpConsent,
    boundedClarification,
    providerToolsAllowed,
  };
}
