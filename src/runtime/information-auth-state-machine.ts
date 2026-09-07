import type { PendingInformationRequest } from '../core/information';
import {
  decideHumanHelpAttempt,
  type HandoffPersistedRecord,
  type HumanHelpAttemptDecision,
} from './human-help-policy';
import { extractOtpCode } from './otp-normalization';

/**
 * S06 one-shot OTP recovery. A recovery episode allows exactly one send and
 * at most one verification; any failure terminates the episode and the shared
 * human help policy takes over. Transport retries are disabled so retries can
 * never create another send or verification.
 */
export const OTP_TRANSPORT_RETRY_POLICY = {
  sendMaxRetries: 0,
  verifyMaxRetries: 0,
} as const;

export function shouldRetryOtpTransport(): false {
  return false;
}

export const authRecoveryTerminalReasons = [
  'send_failed',
  'non_delivery_reported',
  'resend_requested',
  'email_change_requested',
  'auth_refused',
  'verification_failed',
  'legacy_terminated',
] as const;

export type AuthRecoveryTerminalReason = (typeof authRecoveryTerminalReasons)[number];

export type InformationAuthRecoveryState = {
  readonly sendAttempted: boolean;
  readonly verificationAttempted: boolean;
  readonly terminalReason: AuthRecoveryTerminalReason | null;
  readonly challengeEmail: string | null;
  readonly challengeRequestedAt: string | null;
  readonly preservedRequest: PendingInformationRequest | null;
};

export function emptyAuthRecoveryState(): InformationAuthRecoveryState {
  return {
    sendAttempted: false,
    verificationAttempted: false,
    terminalReason: null,
    challengeEmail: null,
    challengeRequestedAt: null,
    preservedRequest: null,
  };
}

export type LegacyAuthFields = {
  readonly status: string;
  readonly email: string | null;
  readonly requestedAt: string | null;
  readonly failedCodeAttempts: number;
  readonly otpSendAttempts: number;
  readonly otpNonDeliveryReports: number;
};

/**
 * One-time typed normalization of pre-S06 persisted auth fields. An existing
 * challenge consumes the send allowance; any failure or non-delivery evidence
 * terminates recovery. Never clears an already terminal episode.
 */
export function normalizeLegacyAuthRecovery(input: LegacyAuthFields): InformationAuthRecoveryState {
  const challenged = input.status === 'code_requested' ||
    input.otpSendAttempts > 0 ||
    (input.email !== null && input.requestedAt !== null && input.status !== 'none');
  const failed = input.status === 'failed' ||
    input.failedCodeAttempts > 0 ||
    input.otpNonDeliveryReports > 0;
  if (failed) {
    return {
      sendAttempted: true,
      verificationAttempted: input.failedCodeAttempts > 0,
      terminalReason: 'legacy_terminated',
      challengeEmail: input.email,
      challengeRequestedAt: input.requestedAt,
      preservedRequest: null,
    };
  }
  if (challenged) {
    return {
      sendAttempted: true,
      verificationAttempted: false,
      terminalReason: null,
      challengeEmail: input.email,
      challengeRequestedAt: input.requestedAt,
      preservedRequest: null,
    };
  }
  return emptyAuthRecoveryState();
}

/** Monotonic merge: budget flags and terminal state are sticky and win. */
export function mergeAuthRecovery(
  current: InformationAuthRecoveryState,
  incoming: InformationAuthRecoveryState,
): InformationAuthRecoveryState {
  return {
    sendAttempted: current.sendAttempted || incoming.sendAttempted,
    verificationAttempted: current.verificationAttempted || incoming.verificationAttempted,
    terminalReason: current.terminalReason ?? incoming.terminalReason,
    challengeEmail: current.challengeEmail ?? incoming.challengeEmail,
    challengeRequestedAt: current.challengeRequestedAt ?? incoming.challengeRequestedAt,
    preservedRequest: current.preservedRequest ?? incoming.preservedRequest,
  };
}

/**
 * Budget survives browser/session changes, topic switches, and event-plan
 * resets. A reset must never clear attempts or terminal recovery.
 */
export function preserveRecoveryAcrossReset(
  current: InformationAuthRecoveryState,
): InformationAuthRecoveryState {
  return current;
}

export type OtpEntryGate = {
  readonly userExplicitlyChoseEmail: boolean;
  /** A user claim of being registered; never trusted as account evidence. */
  readonly userClaimedRegistered: boolean;
  /** Existing account email from trusted evidence only, never from user claims. */
  readonly trustedExistingAccountEmail: string | null;
  readonly accountEligibility: 'existing' | 'unknown' | 'unsupported';
  readonly protectedResourceSupportsOtpCredential: boolean;
  readonly otpCapabilityEnabled: boolean;
  readonly humanTakeoverActive: boolean;
  readonly recovery: InformationAuthRecoveryState;
};

export type OtpEntryDecision =
  | { readonly eligible: true; readonly email: string }
  | { readonly eligible: false; readonly humanReason: string };

export function decideOtpEntry(gate: OtpEntryGate): OtpEntryDecision {
  if (!gate.userExplicitlyChoseEmail) {
    return { eligible: false, humanReason: 'email_not_explicitly_chosen' };
  }
  if (gate.accountEligibility !== 'existing') {
    return { eligible: false, humanReason: 'account_eligibility_unknown' };
  }
  const trustedEmail = gate.trustedExistingAccountEmail?.trim() ?? '';
  if (trustedEmail.length === 0) {
    return { eligible: false, humanReason: 'no_trusted_account_email' };
  }
  if (!gate.protectedResourceSupportsOtpCredential) {
    return { eligible: false, humanReason: 'resource_does_not_support_otp' };
  }
  if (!gate.otpCapabilityEnabled) {
    return { eligible: false, humanReason: 'otp_capability_disabled' };
  }
  if (gate.humanTakeoverActive) {
    return { eligible: false, humanReason: 'human_takeover_active' };
  }
  if (gate.recovery.terminalReason !== null || gate.recovery.sendAttempted) {
    return { eligible: false, humanReason: 'recovery_budget_used' };
  }
  return { eligible: true, email: trustedEmail };
}

/** Only the verified account email is used; alternatives escalate. */
export function selectOtpEmail(verifiedAccountEmail: string | null): string | null {
  const email = verifiedAccountEmail?.trim() ?? '';
  return email.length > 0 ? email : null;
}

export type OtpChallenge = {
  readonly email: string;
  readonly requestedAt: string;
  readonly preservedRequest: PendingInformationRequest;
};

export type ConsumeSendResult =
  | { readonly allowed: true; readonly state: InformationAuthRecoveryState }
  | { readonly allowed: false; readonly state: InformationAuthRecoveryState };

/** Consume the single send before the outbound call. */
export function consumeSendAttempt(
  state: InformationAuthRecoveryState,
  challenge: OtpChallenge,
): ConsumeSendResult {
  if (state.terminalReason !== null || state.sendAttempted) {
    return { allowed: false, state };
  }
  return {
    allowed: true,
    state: {
      ...state,
      sendAttempted: true,
      challengeEmail: challenge.email,
      challengeRequestedAt: challenge.requestedAt,
      preservedRequest: challenge.preservedRequest,
    },
  };
}

export type OtpSendResult =
  | 'sent'
  | 'failed'
  | 'timeout'
  | 'blocked'
  | 'rate_limited'
  | 'email_not_found';

export function applySendResult(
  state: InformationAuthRecoveryState,
  result: OtpSendResult,
): { readonly state: InformationAuthRecoveryState; readonly next: 'await_code_once' | 'terminal_human' } {
  if (result === 'sent') {
    return { state, next: 'await_code_once' };
  }
  return { state: { ...state, terminalReason: 'send_failed' }, next: 'terminal_human' };
}

function terminate(
  state: InformationAuthRecoveryState,
  reason: AuthRecoveryTerminalReason,
): { readonly state: InformationAuthRecoveryState; readonly next: 'terminal_human' } {
  if (state.terminalReason !== null) {
    return { state, next: 'terminal_human' };
  }
  return { state: { ...state, terminalReason: reason }, next: 'terminal_human' };
}

/** First non-delivery report ends the episode; no new code operation. */
export function reportNonDelivery(state: InformationAuthRecoveryState) {
  return terminate(state, 'non_delivery_reported');
}

/** A resend request ends the episode instead of sending again. */
export function requestOtpResend(state: InformationAuthRecoveryState) {
  return terminate(state, 'resend_requested');
}

/** An email-change request ends the episode instead of collecting addresses. */
export function requestEmailChange(state: InformationAuthRecoveryState) {
  return terminate(state, 'email_change_requested');
}

/** An authentication refusal ends the episode. */
export function refuseAuthentication(state: InformationAuthRecoveryState) {
  return terminate(state, 'auth_refused');
}

/** Delegates number-word and digit extraction to the shared normalizer. */
export function extractSingleCodeForVerification(text: string): string | null {
  return extractOtpCode(text);
}

export type VerificationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/** At most one verification while a challenge is active and unattempted. */
export function decideVerification(
  state: InformationAuthRecoveryState,
  code: string,
  challengeEmail: string,
): VerificationDecision {
  if (state.terminalReason !== null) {
    return { allowed: false, reason: 'recovery_terminal' };
  }
  if (!state.sendAttempted || state.challengeEmail === null) {
    return { allowed: false, reason: 'no_active_challenge' };
  }
  if (state.challengeEmail !== challengeEmail) {
    return { allowed: false, reason: 'challenge_binding_mismatch' };
  }
  if (state.verificationAttempted) {
    return { allowed: false, reason: 'verification_already_attempted' };
  }
  if (code.trim().length === 0) {
    return { allowed: false, reason: 'missing_code' };
  }
  return { allowed: true };
}

export type ConsumeVerificationResult =
  | { readonly allowed: true; readonly state: InformationAuthRecoveryState }
  | { readonly allowed: false; readonly state: InformationAuthRecoveryState };

/** Consume the single verification before the outbound call. Never stores the code. */
export function consumeVerificationAttempt(state: InformationAuthRecoveryState): ConsumeVerificationResult {
  if (
    state.terminalReason !== null ||
    !state.sendAttempted ||
    state.challengeEmail === null ||
    state.verificationAttempted
  ) {
    return { allowed: false, state };
  }
  return { allowed: true, state: { ...state, verificationAttempted: true } };
}

export type OtpVerifyResult =
  | 'authenticated'
  | 'invalid_code'
  | 'expired_code'
  | 'rejected'
  | 'timeout'
  | 'malformed'
  | 'unsupported_account';

export function applyVerificationResult(
  state: InformationAuthRecoveryState,
  result: OtpVerifyResult,
): {
  readonly state: InformationAuthRecoveryState;
  readonly next: 'resume_preserved_request' | 'terminal_human';
  readonly resumeRequest: PendingInformationRequest | null;
} {
  if (result === 'authenticated') {
    return { state, next: 'resume_preserved_request', resumeRequest: state.preservedRequest };
  }
  return {
    state: { ...state, terminalReason: 'verification_failed' },
    next: 'terminal_human',
    resumeRequest: null,
  };
}

/** Terminal state plus a later code or restart retains the human path. */
export function handlePostTerminalInput(_state: InformationAuthRecoveryState): {
  readonly otpAllowed: false;
  readonly next: 'retain_human_path';
} {
  void _state;
  return { otpAllowed: false, next: 'retain_human_path' };
}

/** Credential expiry never silently restarts OTP. */
export function handleCredentialExpiry(state: InformationAuthRecoveryState): {
  readonly otpAllowed: false;
} {
  void state;
  return { otpAllowed: false };
}

/** Terminal recovery reuses the shared human help policy. */
export function decideTerminalHumanHelp(args: {
  readonly conversationId: string;
  readonly inboundId: string;
  readonly scope?: string;
  readonly trustedPhone: string | null;
  readonly gatewayCapable: boolean;
  readonly prior: HandoffPersistedRecord | null;
  readonly explicitRetry?: boolean;
}): HumanHelpAttemptDecision {
  return decideHumanHelpAttempt({
    conversationId: args.conversationId,
    inboundId: args.inboundId,
    scope: args.scope ?? 'auth-recovery',
    trustedPhone: args.trustedPhone,
    gatewayCapable: args.gatewayCapable,
    prior: args.prior,
    explicitRetry: args.explicitRetry ?? false,
  });
}
