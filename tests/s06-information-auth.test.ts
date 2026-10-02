import { describe, expect, it } from 'vitest';

import type { PendingInformationRequest } from '../src/core/information';
import {
  OTP_TRANSPORT_RETRY_POLICY,
  applySendResult,
  applyVerificationResult,
  consumeSendAttempt,
  consumeVerificationAttempt,
  decideOtpEntry,
  decideTerminalHumanHelp,
  decideVerification,
  emptyAuthRecoveryState,
  extractSingleCodeForVerification,
  handleCredentialExpiry,
  handlePostTerminalInput,
  mergeAuthRecovery,
  normalizeLegacyAuthRecovery,
  preserveRecoveryAcrossReset,
  refuseAuthentication,
  reportNonDelivery,
  requestEmailChange,
  requestOtpResend,
  selectOtpEmail,
  shouldRetryOtpTransport,
} from '../src/runtime/information-auth-state-machine';

function preservedRequest(): PendingInformationRequest {
  return {
    kind: 'purchase',
    resource: 'gift_purchases',
    query: 'Confirmar si el deposito del regalo llego.',
    orderId: null,
    authAction: 'provide_otp',
    requestId: 'information-1',
  };
}

function eligibleGate(overrides: Record<string, unknown> = {}) {
  return {
    userExplicitlyChoseEmail: true,
    userClaimedRegistered: false,
    trustedExistingAccountEmail: 'person@example.com',
    accountEligibility: 'existing' as const,
    protectedResourceSupportsOtpCredential: true,
    otpCapabilityEnabled: true,
    humanTakeoverActive: false,
    recovery: emptyAuthRecoveryState(),
    ...overrides,
  };
}

describe('S06 one-shot OTP recovery budget', () => {
  it('starts empty and sends exactly once without transport retries', () => {
    expect(OTP_TRANSPORT_RETRY_POLICY.sendMaxRetries).toBe(0);
    expect(OTP_TRANSPORT_RETRY_POLICY.verifyMaxRetries).toBe(0);
    expect(shouldRetryOtpTransport()).toBe(false);
    expect(emptyAuthRecoveryState()).toEqual({
      sendAttempted: false,
      verificationAttempted: false,
      terminalReason: null,
      challengeEmail: null,
      challengeRequestedAt: null,
      preservedRequest: null,
    });
    const first = consumeSendAttempt(emptyAuthRecoveryState(), {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:00:00.000Z',
      preservedRequest: preservedRequest(),
    });
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;
    expect(first.state.sendAttempted).toBe(true);
    expect(first.state.challengeEmail).toBe('person@example.com');
    const second = consumeSendAttempt(first.state, {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:01:00.000Z',
      preservedRequest: preservedRequest(),
    });
    expect(second.allowed).toBe(false);
    expect(second.state.sendAttempted).toBe(true);

    // The single consumed send awaits exactly one code.
    const dispatched = consumeSendAttempt(emptyAuthRecoveryState(), {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:00:00.000Z',
      preservedRequest: preservedRequest(),
    });
    expect(dispatched.allowed).toBe(true);
    if (!dispatched.allowed) return;
    const result = applySendResult(dispatched.state, 'sent');
    expect(result.next).toBe('await_code_once');
    expect(result.state.terminalReason).toBeNull();
  });

  it('terminates recovery on failed sends and on first report, resend, change, or refusal', () => {
    for (const outcome of ['failed', 'timeout', 'blocked', 'rate_limited', 'email_not_found'] as const) {
      const consumed = consumeSendAttempt(emptyAuthRecoveryState(), {
        email: 'person@example.com',
        requestedAt: '2026-09-05T00:00:00.000Z',
        preservedRequest: preservedRequest(),
      });
      expect(consumed.allowed).toBe(true);
      if (!consumed.allowed) return;
      const result = applySendResult(consumed.state, outcome);
      expect(result.next).toBe('terminal_human');
      expect(result.state.terminalReason).toBe('send_failed');
      expect(consumeSendAttempt(result.state, {
        email: 'person@example.com',
        requestedAt: '2026-09-05T00:02:00.000Z',
        preservedRequest: preservedRequest(),
      }).allowed).toBe(false);
    }
    const base = consumeSendAttempt(emptyAuthRecoveryState(), {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:00:00.000Z',
      preservedRequest: preservedRequest(),
    });
    expect(base.allowed).toBe(true);
    if (!base.allowed) return;
    const awaiting = applySendResult(base.state, 'sent');
    expect(reportNonDelivery(awaiting.state).next).toBe('terminal_human');
    expect(reportNonDelivery(awaiting.state).state.terminalReason).toBe('non_delivery_reported');
    expect(requestOtpResend(awaiting.state).state.terminalReason).toBe('resend_requested');
    expect(requestEmailChange(awaiting.state).state.terminalReason).toBe('email_change_requested');
    expect(refuseAuthentication(awaiting.state).state.terminalReason).toBe('auth_refused');
    for (const terminal of [
      reportNonDelivery(awaiting.state).state,
      requestOtpResend(awaiting.state).state,
    ]) {
      expect(consumeVerificationAttempt(terminal).allowed).toBe(false);
    }
  });
});

describe('S06 OTP entry gate is human-first', () => {
  it('gates OTP entry on verified eligibility and explicit choice without trusting user claims', () => {
    const decision = decideOtpEntry(eligibleGate());
    expect(decision).toEqual({ eligible: true, email: 'person@example.com' });
    expect(decideOtpEntry(eligibleGate({ accountEligibility: 'unknown' })).eligible).toBe(false);
    expect(decideOtpEntry(eligibleGate({ accountEligibility: 'unsupported' })).eligible).toBe(false);
    const claimed = decideOtpEntry(eligibleGate({
      trustedExistingAccountEmail: null,
      userClaimedRegistered: true,
    }));
    expect(claimed.eligible).toBe(false);
    expect(decideOtpEntry(eligibleGate({ userExplicitlyChoseEmail: false })).eligible).toBe(false);
    expect(decideOtpEntry(eligibleGate({ protectedResourceSupportsOtpCredential: false })).eligible).toBe(false);
    expect(decideOtpEntry(eligibleGate({ otpCapabilityEnabled: false })).eligible).toBe(false);
    expect(decideOtpEntry(eligibleGate({ humanTakeoverActive: true })).eligible).toBe(false);
    const used = consumeSendAttempt(emptyAuthRecoveryState(), {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:00:00.000Z',
      preservedRequest: preservedRequest(),
    });
    expect(used.allowed).toBe(true);
    if (!used.allowed) return;
    expect(decideOtpEntry(eligibleGate({ recovery: used.state })).eligible).toBe(false);
  });

  it('selects only the verified account email and never collects alternatives', () => {
    expect(selectOtpEmail('person@example.com')).toBe('person@example.com');
    expect(selectOtpEmail(null)).toBeNull();
    expect(selectOtpEmail('  ')).toBeNull();
  });

  it('terminal recovery delegates to the shared human help policy', () => {
    const decision = decideTerminalHumanHelp({
      conversationId: 'conv-1',
      inboundId: 'wamid-1',
      trustedPhone: '+51900000001',
      gatewayCapable: true,
      prior: null,
    });
    expect(decision.action).toBe('attempt');
  });
});

describe('S06 at most one verification', () => {
  function awaitingCode() {
    const consumed = consumeSendAttempt(emptyAuthRecoveryState(), {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:00:00.000Z',
      preservedRequest: preservedRequest(),
    });
    if (!consumed.allowed) throw new Error('send must be allowed');
    const awaiting = applySendResult(consumed.state, 'sent');
    if (awaiting.next !== 'await_code_once') throw new Error('send must await code');
    return awaiting.state;
  }

  it('extracts a number-word code exactly once', () => {
    expect(extractSingleCodeForVerification('Uno cuatro siete cinco uno cinco')).toBe('147515');
    expect(extractSingleCodeForVerification('mi codigo es 753994')).toBe('753994');
    expect(extractSingleCodeForVerification('hola, necesito ayuda')).toBeNull();
    expect(extractSingleCodeForVerification('123456 y 654321')).toBeNull();
  });

  it('verifies one bound code while the challenge is active without persisting it', () => {
    const state = awaitingCode();
    expect(decideVerification(state, '753994', 'person@example.com')).toEqual({ allowed: true });
    expect(decideVerification(state, '753994', 'other@example.com').allowed).toBe(false);
    const consumed = consumeVerificationAttempt(state);
    expect(consumed.allowed).toBe(true);
    if (!consumed.allowed) return;
    expect(consumed.state.verificationAttempted).toBe(true);
    expect(JSON.stringify(consumed.state)).not.toContain('753994');
    expect('submittedCode' in consumed.state).toBe(false);
    expect(decideVerification(consumed.state, '753994', 'person@example.com').allowed).toBe(false);
  });

  it('resolves verification once: failures terminate recovery and success resumes the preserved request', () => {
    for (const outcome of ['invalid_code', 'expired_code', 'rejected', 'timeout', 'malformed', 'unsupported_account'] as const) {
      const consumed = consumeVerificationAttempt(awaitingCode());
      expect(consumed.allowed).toBe(true);
      if (!consumed.allowed) return;
      const result = applyVerificationResult(consumed.state, outcome);
      expect(result.next).toBe('terminal_human');
      expect(result.state.terminalReason).toBe('verification_failed');
      expect(consumeVerificationAttempt(result.state).allowed).toBe(false);
    }
    const consumed = consumeVerificationAttempt(awaitingCode());
    expect(consumed.allowed).toBe(true);
    if (!consumed.allowed) return;
    const result = applyVerificationResult(consumed.state, 'authenticated');
    expect(result.next).toBe('resume_preserved_request');
    expect(result.resumeRequest).toEqual(preservedRequest());
  });

  it('never reopens OTP after terminal state, later codes, or credential expiry', () => {
    const terminal = reportNonDelivery(awaitingCode()).state;
    const later = handlePostTerminalInput(terminal);
    expect(later.otpAllowed).toBe(false);
    expect(later.next).toBe('retain_human_path');
    expect(decideVerification(terminal, '753994', 'person@example.com').allowed).toBe(false);
    const consumed = consumeVerificationAttempt(awaitingCode());
    expect(consumed.allowed).toBe(true);
    if (!consumed.allowed) return;
    const resumed = applyVerificationResult(consumed.state, 'authenticated');
    expect(handleCredentialExpiry(resumed.state).otpAllowed).toBe(false);
    expect(handleCredentialExpiry(reportNonDelivery(awaitingCode()).state).otpAllowed).toBe(false);
  });
});

describe('S06 recovery budget survives resets and normalizes legacy state', () => {
  it('normalizes legacy recovery into the one-shot budget or a terminal state', () => {
    const normalized = normalizeLegacyAuthRecovery({
      status: 'code_requested',
      email: 'person@example.com',
      requestedAt: '2026-08-24T21:18:00.000Z',
      failedCodeAttempts: 0,
      otpSendAttempts: 1,
      otpNonDeliveryReports: 0,
    });
    expect(normalized.sendAttempted).toBe(true);
    expect(normalized.terminalReason).toBeNull();
    expect(consumeSendAttempt(normalized, {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:00:00.000Z',
      preservedRequest: preservedRequest(),
    }).allowed).toBe(false);
    expect(normalizeLegacyAuthRecovery({
      status: 'code_requested',
      email: 'person@example.com',
      requestedAt: '2026-08-24T21:18:00.000Z',
      failedCodeAttempts: 1,
      otpSendAttempts: 1,
      otpNonDeliveryReports: 0,
    }).terminalReason).toBe('legacy_terminated');
    expect(normalizeLegacyAuthRecovery({
      status: 'code_requested',
      email: 'person@example.com',
      requestedAt: '2026-08-24T21:18:00.000Z',
      failedCodeAttempts: 0,
      otpSendAttempts: 2,
      otpNonDeliveryReports: 1,
    }).terminalReason).toBe('legacy_terminated');
    expect(normalizeLegacyAuthRecovery({
      status: 'failed',
      email: 'person@example.com',
      requestedAt: null,
      failedCodeAttempts: 2,
      otpSendAttempts: 1,
      otpNonDeliveryReports: 0,
    }).terminalReason).toBe('legacy_terminated');
  });

  it('session, topic, or plan resets cannot clear the budget', () => {
    const consumed = consumeSendAttempt(emptyAuthRecoveryState(), {
      email: 'person@example.com',
      requestedAt: '2026-09-05T00:00:00.000Z',
      preservedRequest: preservedRequest(),
    });
    expect(consumed.allowed).toBe(true);
    if (!consumed.allowed) return;
    const awaiting = applySendResult(consumed.state, 'sent');
    const terminal = reportNonDelivery(awaiting.state);
    expect(terminal.state.terminalReason).not.toBeNull();
    expect(preserveRecoveryAcrossReset(terminal.state)).toBe(terminal.state);
    const merged = mergeAuthRecovery(terminal.state, emptyAuthRecoveryState());
    expect(merged.sendAttempted).toBe(true);
    expect(merged.terminalReason).toBe(terminal.state.terminalReason);
    expect(merged.challengeEmail).toBe('person@example.com');
    expect(merged.preservedRequest).toEqual(preservedRequest());
  });
});
