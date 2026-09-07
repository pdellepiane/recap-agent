import { buildRsvpOfferKey } from '../core/rsvp';
import { decideRsvpInvitationAction } from './rsvp-invitation-evidence';

export type RsvpPolicyAttendance = 'pending' | 'attending' | 'declining' | 'unknown';

export type RsvpPolicyInvitation = {
  readonly guestId: number | null;
  readonly eventId: number | null;
  readonly eventName: string | null;
  readonly eventDate: string | null;
  readonly attendance: RsvpPolicyAttendance;
};

export type RsvpDecisionOutcome =
  | 'attending_reported_no_write'
  | 'declining_offer_change_once'
  | 'declining_reported_no_reoffer'
  | 'pending_needs_explicit_decision'
  | 'identical_decision_no_write'
  | 'authorized_mutation'
  | 'needs_event_selection'
  | 'needs_explicit_decision'
  | 'unavailable_no_invitation'
  | 'unavailable_missing_identity'
  | 'unavailable_lookup_failed'
  | 'unknown_state_requires_help';

export const RSVP_HUMAN_HELP_SCOPE = 'rsvp_mismatch' as const;

export const RSVP_EFFECT_POLICY = {
  persistIntentBeforeExecution: true,
  persistResultBeforeReply: true,
  maxAttempts: 1,
  autoRetry: false,
  onTimeout: 'single_authorized_state_read_then_report_observed_or_escalate',
} as const;

export type RsvpOfferDisposition = 'offer_once' | 'already_offered' | 'no_change_acknowledged' | 'not_declining';

export type RsvpOfferDecision = {
  readonly shouldOffer: boolean;
  readonly disposition: RsvpOfferDisposition;
  readonly isWrite: false;
};

export type RsvpTurnDecision = {
  readonly outcome: RsvpDecisionOutcome;
  readonly candidateGuestId: number | null;
  readonly requestedAction: 'attending' | 'declining' | null;
  readonly shouldWrite: boolean;
  readonly shouldOffer: boolean;
  readonly offerKey: string | null;
  readonly isWrite: boolean;
  readonly isReversal: boolean;
  readonly needsHumanHelp: boolean;
  readonly humanScope: typeof RSVP_HUMAN_HELP_SCOPE | null;
  readonly selectableCount: number;
  readonly effectIntent: {
    readonly guest_id: number;
    readonly action: 'attending' | 'declining';
    readonly persistBeforeExecution: true;
  } | null;
};

function normalizeSelectionText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasRsvpEventIdentity(invitation: {
  readonly eventId: number | null;
  readonly eventName: string | null;
}): boolean {
  if (invitation.eventId !== null && Number.isSafeInteger(invitation.eventId)) {
    return true;
  }
  return normalizeSelectionText(invitation.eventName ?? '').length > 0;
}

function hasValidGuestId(guestId: number | null): guestId is number {
  return guestId !== null && Number.isSafeInteger(guestId) && guestId > 0;
}

export function filterSelectableRsvpInvitations(
  invitations: readonly RsvpPolicyInvitation[],
): RsvpPolicyInvitation[] {
  return invitations.filter(
    (invitation) => hasValidGuestId(invitation.guestId) && hasRsvpEventIdentity(invitation),
  );
}

export function decideRsvpOffer(args: {
  readonly attendance: string;
  readonly offerKey: string;
  readonly alreadyOfferedKeys: readonly string[];
  readonly explicitNoChange: boolean;
}): RsvpOfferDecision {
  if (args.attendance !== 'declining') {
    return { shouldOffer: false, disposition: 'not_declining', isWrite: false };
  }
  if (args.explicitNoChange) {
    return { shouldOffer: false, disposition: 'no_change_acknowledged', isWrite: false };
  }
  if (args.alreadyOfferedKeys.includes(args.offerKey)) {
    return { shouldOffer: false, disposition: 'already_offered', isWrite: false };
  }
  return { shouldOffer: true, disposition: 'offer_once', isWrite: false };
}

function noWriteDecision(
  outcome: RsvpDecisionOutcome,
  args: {
    candidateGuestId: number | null;
    requestedAction: 'attending' | 'declining' | null;
    shouldOffer: boolean;
    offerKey: string | null;
    needsHumanHelp: boolean;
    selectableCount: number;
  },
): RsvpTurnDecision {
  return {
    outcome,
    candidateGuestId: args.candidateGuestId,
    requestedAction: args.requestedAction,
    shouldWrite: false,
    shouldOffer: args.shouldOffer,
    offerKey: args.offerKey,
    isWrite: false,
    isReversal: false,
    needsHumanHelp: args.needsHumanHelp,
    humanScope: args.needsHumanHelp ? RSVP_HUMAN_HELP_SCOPE : null,
    selectableCount: args.selectableCount,
    effectIntent: null,
  };
}

export function decideRsvpTurn(args: {
  readonly trusted: readonly RsvpPolicyInvitation[];
  readonly semanticTitle: string | null | undefined;
  readonly hasExplicitDecision: boolean;
  readonly decisionSource: 'current_message' | 'plan_state';
  readonly requestedAction: 'attending' | 'declining' | null;
  readonly lookupFailed: boolean;
  readonly alreadyOfferedKeys: readonly string[];
  readonly explicitNoChange: boolean;
  readonly textGuestId?: number | null;
  readonly textUrl?: string | null;
}): RsvpTurnDecision {
  if (args.lookupFailed) {
    return noWriteDecision('unavailable_lookup_failed', {
      candidateGuestId: null,
      requestedAction: args.requestedAction,
      shouldOffer: false,
      offerKey: null,
      needsHumanHelp: true,
      selectableCount: 0,
    });
  }

  const selectable = filterSelectableRsvpInvitations(args.trusted);
  const hasValidIdentity = args.trusted.some(
    (invitation) => hasValidGuestId(invitation.guestId) && hasRsvpEventIdentity(invitation),
  );
  const hasValidGuest = args.trusted.some((invitation) => hasValidGuestId(invitation.guestId));

  if (selectable.length === 0) {
    if (hasValidGuest && !hasValidIdentity) {
      return noWriteDecision('unavailable_missing_identity', {
        candidateGuestId: null,
        requestedAction: args.requestedAction,
        shouldOffer: false,
        offerKey: null,
        needsHumanHelp: true,
        selectableCount: 0,
      });
    }
    return noWriteDecision('unavailable_no_invitation', {
      candidateGuestId: null,
      requestedAction: args.requestedAction,
      shouldOffer: false,
      offerKey: null,
      needsHumanHelp: true,
      selectableCount: 0,
    });
  }

  const reference = args.semanticTitle?.trim() ?? '';
  let candidate: RsvpPolicyInvitation | null = null;
  if (reference.length > 0) {
    const normalizedReference = normalizeSelectionText(reference);
    if (normalizedReference.length === 0) {
      return noWriteDecision('needs_explicit_decision', {
        candidateGuestId: null,
        requestedAction: args.requestedAction,
        shouldOffer: false,
        offerKey: null,
        needsHumanHelp: true,
        selectableCount: selectable.length,
      });
    }
    const matches = selectable.filter(
      (invitation) => normalizeSelectionText(invitation.eventName ?? '') === normalizedReference,
    );
    if (matches.length > 1) {
      return noWriteDecision('needs_event_selection', {
        candidateGuestId: null,
        requestedAction: args.requestedAction,
        shouldOffer: false,
        offerKey: null,
        needsHumanHelp: false,
        selectableCount: selectable.length,
      });
    }
    if (matches.length === 0) {
      return noWriteDecision('needs_explicit_decision', {
        candidateGuestId: null,
        requestedAction: args.requestedAction,
        shouldOffer: false,
        offerKey: null,
        needsHumanHelp: true,
        selectableCount: selectable.length,
      });
    }
    const single = matches[0];
    if (single === undefined) {
      return noWriteDecision('needs_explicit_decision', {
        candidateGuestId: null,
        requestedAction: args.requestedAction,
        shouldOffer: false,
        offerKey: null,
        needsHumanHelp: true,
        selectableCount: selectable.length,
      });
    }
    candidate = single;
  } else if (selectable.length === 1) {
    const single = selectable[0];
    if (single === undefined) {
      return noWriteDecision('unavailable_no_invitation', {
        candidateGuestId: null,
        requestedAction: args.requestedAction,
        shouldOffer: false,
        offerKey: null,
        needsHumanHelp: true,
        selectableCount: selectable.length,
      });
    }
    candidate = single;
  } else {
    return noWriteDecision('needs_event_selection', {
      candidateGuestId: null,
      requestedAction: args.requestedAction,
      shouldOffer: false,
      offerKey: null,
      needsHumanHelp: false,
      selectableCount: selectable.length,
    });
  }

  const candidateGuestId = candidate.guestId;
  if (candidateGuestId === null || !hasValidGuestId(candidateGuestId)) {
    return noWriteDecision('unavailable_missing_identity', {
      candidateGuestId: null,
      requestedAction: args.requestedAction,
      shouldOffer: false,
      offerKey: null,
      needsHumanHelp: true,
      selectableCount: selectable.length,
    });
  }

  const offerKey = buildRsvpOfferKey({
    guestId: candidateGuestId,
    eventId: candidate.eventId,
    eventName: candidate.eventName,
    eventDate: candidate.eventDate,
    attendance: candidate.attendance,
  });

  const isReadOnly = !args.hasExplicitDecision || args.requestedAction === null;
  if (isReadOnly) {
    if (candidate.attendance === 'declining') {
      const offer = decideRsvpOffer({
        attendance: candidate.attendance,
        offerKey,
        alreadyOfferedKeys: args.alreadyOfferedKeys,
        explicitNoChange: args.explicitNoChange,
      });
      if (offer.shouldOffer) {
        return {
          outcome: 'declining_offer_change_once',
          candidateGuestId,
          requestedAction: null,
          shouldWrite: false,
          shouldOffer: true,
          offerKey,
          isWrite: false,
          isReversal: false,
          needsHumanHelp: false,
          humanScope: null,
          selectableCount: selectable.length,
          effectIntent: null,
        };
      }
      return noWriteDecision('declining_reported_no_reoffer', {
        candidateGuestId,
        requestedAction: null,
        shouldOffer: false,
        offerKey,
        needsHumanHelp: false,
        selectableCount: selectable.length,
      });
    }
    if (candidate.attendance === 'attending') {
      return noWriteDecision('attending_reported_no_write', {
        candidateGuestId,
        requestedAction: null,
        shouldOffer: false,
        offerKey,
        needsHumanHelp: false,
        selectableCount: selectable.length,
      });
    }
    if (candidate.attendance === 'pending') {
      return noWriteDecision('pending_needs_explicit_decision', {
        candidateGuestId,
        requestedAction: null,
        shouldOffer: false,
        offerKey,
        needsHumanHelp: false,
        selectableCount: selectable.length,
      });
    }
    return noWriteDecision('unknown_state_requires_help', {
      candidateGuestId,
      requestedAction: null,
      shouldOffer: false,
      offerKey,
      needsHumanHelp: true,
      selectableCount: selectable.length,
    });
  }

  const requested = args.requestedAction;
  if (requested === null) {
    return noWriteDecision('needs_explicit_decision', {
      candidateGuestId,
      requestedAction: null,
      shouldOffer: false,
      offerKey,
      needsHumanHelp: true,
      selectableCount: selectable.length,
    });
  }

  if (args.decisionSource !== 'current_message') {
    return noWriteDecision('needs_explicit_decision', {
      candidateGuestId,
      requestedAction: requested,
      shouldOffer: false,
      offerKey,
      needsHumanHelp: true,
      selectableCount: selectable.length,
    });
  }

  if (requested === candidate.attendance) {
    return noWriteDecision('identical_decision_no_write', {
      candidateGuestId,
      requestedAction: requested,
      shouldOffer: false,
      offerKey,
      needsHumanHelp: false,
      selectableCount: selectable.length,
    });
  }

  const verification = decideRsvpInvitationAction({
    trusted: selectable.map((item) => ({
      guestId: item.guestId,
      eventId: item.eventId,
      eventName: item.eventName,
      eventDate: item.eventDate,
    })),
    semanticTitle: args.semanticTitle,
    hasExplicitDecision: true,
    textGuestId: args.textGuestId ?? null,
    textUrl: args.textUrl ?? null,
  });
  if (verification.outcome !== 'actionable_unique' || verification.candidate?.guestId !== candidateGuestId) {
    if (verification.outcome === 'ambiguous') {
      return noWriteDecision('needs_event_selection', {
        candidateGuestId: null,
        requestedAction: requested,
        shouldOffer: false,
        offerKey: null,
        needsHumanHelp: false,
        selectableCount: selectable.length,
      });
    }
    return noWriteDecision('needs_explicit_decision', {
      candidateGuestId,
      requestedAction: requested,
      shouldOffer: false,
      offerKey,
      needsHumanHelp: true,
      selectableCount: selectable.length,
    });
  }

  const isReversal =
    (candidate.attendance === 'attending' && requested === 'declining') ||
    (candidate.attendance === 'declining' && requested === 'attending');

  return {
    outcome: 'authorized_mutation',
    candidateGuestId,
    requestedAction: requested,
    shouldWrite: true,
    shouldOffer: false,
    offerKey,
    isWrite: true,
    isReversal,
    needsHumanHelp: false,
    humanScope: null,
    selectableCount: selectable.length,
    effectIntent: {
      guest_id: candidateGuestId,
      action: requested,
      persistBeforeExecution: true,
    },
  };
}
