export const RSVP_MISMATCH_HANDOFF_SCOPE = 'rsvp_mismatch' as const;

export type TrustedRsvpInvitation = {
  readonly guestId: number | null;
  readonly eventId: number | null;
  readonly eventName: string | null;
  readonly eventDate: string | null;
};

export type RsvpInvitationDecision = {
  readonly outcome: 'actionable_unique' | 'ambiguous' | 'unresolved';
  readonly reason: string;
  readonly candidate?: TrustedRsvpInvitation;
};

function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidActionableCandidate(invitation: TrustedRsvpInvitation): boolean {
  return invitation.guestId !== null && Number.isSafeInteger(invitation.guestId) && invitation.guestId > 0;
}

/**
 * Validate a semantic event reference against the trusted lookup set.
 * Only IDs returned by existing phone lookup/detail APIs can authorize a
 * write. IDs or URLs taken from message text are accepted as input solely so
 * tests can prove they are ignored; they never select a candidate.
 */
export function decideRsvpInvitationAction(args: {
  readonly trusted: readonly TrustedRsvpInvitation[];
  readonly semanticTitle: string | null | undefined;
  readonly hasExplicitDecision: boolean;
  readonly textGuestId?: number | null;
  readonly textUrl?: string | null;
}): RsvpInvitationDecision {
  void args.textGuestId;
  void args.textUrl;
  const valid = args.trusted.filter(isValidActionableCandidate);
  if (valid.length === 0) {
    return { outcome: 'unresolved', reason: 'no_verified_invitation' };
  }
  if (!args.hasExplicitDecision) {
    return { outcome: 'unresolved', reason: 'missing_explicit_decision' };
  }
  const reference = args.semanticTitle?.trim() ?? '';
  if (reference.length === 0) {
    if (valid.length === 1) {
      const only = valid[0];
      if (only !== undefined) {
        return { outcome: 'actionable_unique', candidate: only, reason: 'single_verified_invitation' };
      }
    }
    return { outcome: 'ambiguous', reason: 'selection_required' };
  }
  const normalizedReference = normalizeEvidenceText(reference);
  if (normalizedReference.length === 0) {
    return { outcome: 'unresolved', reason: 'empty_reference' };
  }
  const matches = valid.filter((invitation) => {
    if (!invitation.eventName) {
      return false;
    }
    return normalizeEvidenceText(invitation.eventName) === normalizedReference;
  });
  if (matches.length === 1) {
    const match = matches[0];
    if (match !== undefined) {
      return { outcome: 'actionable_unique', candidate: match, reason: 'unique_semantic_match' };
    }
  }
  if (matches.length > 1) {
    return { outcome: 'ambiguous', reason: 'multiple_matches' };
  }
  return { outcome: 'unresolved', reason: 'no_match_in_trusted_set' };
}
