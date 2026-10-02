import { describe, expect, it } from 'vitest';
import {
  buildRuntimeCapabilityManifest,
  mergeRuntimeCapabilityManifests,
  runtimeOperationIds,
  runtimeProviderGatewayOperationMap,
  runtimeToolOperationMap,
  runtimeWriteOperationIds,
} from '../src/runtime/capability-manifest';
import {
  buildBoundedCapabilityList,
  decideTurnCapability,
  projectExtractionOperations,
  recomputeTurnCapabilityAfterResult,
  turnCapabilityChanged,
} from '../src/runtime/turn-capability-policy';
import {
  applyHandoffResult,
  buildHandoffDedupeKey,
  decideHumanHelpAttempt,
} from '../src/runtime/human-help-policy';
import {
  claimAllowsSuccess,
} from '../src/runtime/capability-outcome-renderer';
import { projectSupportHandoffEvidence } from '../src/runtime/reply-evidence-projector';
import { toolNames } from '../src/runtime/prompt-manifest';

function manifestWith(overrides = {}) {
  return buildRuntimeCapabilityManifest({
    configured: true,
    environment: 'production',
    allowCustomerWrites: true,
    featureFlags: {
      faq: true,
      invitedEventLookup: true,
      purchaseInformation: true,
      rsvp: true,
      providerPlanning: true,
      providerSearch: true,
      providerQuoteRequests: true,
      phoneAuthentication: true,
      emailOtp: true,
      humanTakeover: true,
    },
    ...overrides,
  });
}

function baseInput(operation: 'purchase.orders.read' | 'confirmation_document.send' | 'rsvp.response.write' | 'provider.quote.write' | 'auth.otp.send') {
  const manifest = manifestWith();
  return {
    operation,
    manifest,
    gatewayAvailable: true,
    hasTrustedIdentity: true,
    requiresIdentity: true,
    resourceState: 'available' as const,
    isAuthorized: true,
    remainingAttempts: null as number | null,
    alreadyCompleted: false,
    missingInput: [] as readonly string[],
  };
}

describe('S16 turn capability authority', () => {
  it('keeps the capability manifest registry ordered and exhaustively mapped', () => {
    {
      expect(runtimeOperationIds.slice(0, 18)).toEqual([
        'faq.read',
        'event.association.read',
        'event.detail.read',
        'purchase.orders.read',
        'purchase.gift_detail.read',
        'rsvp.state.read',
        'rsvp.response.write',
        'provider.plan',
        'provider.search',
        'provider.quote.write',
        'auth.phone',
        'auth.email_otp',
        'human.takeover.write',
        'confirmation_document.send',
        'media.image.inspect',
        'payment_proof.verify',
        'purchase.modify',
        'refund_or_withdrawal.execute',
      ]);
      expect(runtimeOperationIds).toContain('provider.favorites.write');
      expect(runtimeOperationIds).toContain('provider.review.write');
      expect(runtimeOperationIds).toContain('auth.phone_update.write');
      expect(runtimeOperationIds).toContain('auth.otp.send');
      expect(runtimeOperationIds).toContain('auth.otp.verify');
    }

    {
      for (const tool of toolNames) {
        expect(runtimeToolOperationMap[tool]).toBeDefined();
      }
      expect(runtimeToolOperationMap.finish_plan).toBe('provider.quote.write');
      expect(runtimeToolOperationMap.add_vendor_to_event_favorites).toBe('provider.favorites.write');
      expect(runtimeToolOperationMap.create_provider_review).toBe('provider.review.write');
      expect(runtimeToolOperationMap.create_quote_request).toBe('provider.quote.write');
      expect(runtimeProviderGatewayOperationMap.requestUserLoginCode).toBe('auth.otp.send');
      expect(runtimeProviderGatewayOperationMap.verifyUserLoginCode).toBe('auth.otp.verify');
      expect(runtimeProviderGatewayOperationMap.createQuoteRequest).toBe('provider.quote.write');
      expect(runtimeProviderGatewayOperationMap.addVendorToEventFavorites).toBe('provider.favorites.write');
      expect(runtimeWriteOperationIds).toContain('provider.favorites.write');
      expect(runtimeWriteOperationIds).toContain('auth.otp.send');
    }
  });

  it('decides turn capability by support, identity, budget, and freshness', () => {
    {
      const outcome = decideTurnCapability(baseInput('confirmation_document.send'));
      expect(outcome.status).toBe('unsupported');
      expect(outcome.allowedNext).toBe('handoff_once');
    }

    {
      const outcome = decideTurnCapability({ ...baseInput('purchase.orders.read'), hasTrustedIdentity: false });
      expect(outcome.status).toBe('blocked');
      expect(outcome.reason).toBe('missing_identity');
    }

    {
      const outcome = decideTurnCapability({ ...baseInput('auth.otp.send'), remainingAttempts: 0 });
      expect(outcome.status).toBe('blocked');
      expect(outcome.reason).toBe('attempts_exhausted');
    }

    {
      const manifest = buildRuntimeCapabilityManifest({ configured: true, featureFlags: { purchaseInformation: false } });
      const outcome = decideTurnCapability({ ...baseInput('purchase.orders.read'), manifest });
      expect(outcome.status).toBe('unavailable');
    }

    {
      const preflight = decideTurnCapability(baseInput('purchase.orders.read'));
      expect(preflight.status).toBe('executable');
      const after = recomputeTurnCapabilityAfterResult({ preflight, gatewayResult: { status: 'failed', retryable: false } });
      expect(after.status).toBe('unavailable');
      expect(after.allowedNext).toBe('handoff_once');
    }
  });

  it('detects capability change and merges configured with gateway support', () => {
    {
      const before = manifestWith();
      const after = buildRuntimeCapabilityManifest({ configured: false });
      expect(turnCapabilityChanged(before, after, 'purchase.orders.read')).toBe(true);
      expect(turnCapabilityChanged(before, manifestWith(), 'purchase.orders.read')).toBe(false);
    }

    {
      const configured = manifestWith();
      const gateway = buildRuntimeCapabilityManifest({ configured: true, disabledOperations: ['purchase.orders.read'] });
      const merged = mergeRuntimeCapabilityManifests(configured, gateway);
      expect(merged['purchase.orders.read'].available).toBe(false);
      const fixture = buildRuntimeCapabilityManifest({ configured: true, fixture: true });
      expect(fixture.simulated).toBe(true);
      expect(manifestWith().simulated).toBe(false);
    }
  });

  it('projects only relevant distinctions to extraction and bounds capability lists', () => {
    const projected = projectExtractionOperations({
      requestedDomain: 'purchase',
      candidateOperations: ['purchase.orders.read', 'confirmation_document.send', 'rsvp.response.write'],
    });
    expect(projected).toEqual(['purchase.orders.read']);
    expect(projected.length).toBeLessThanOrEqual(3);
    const list = buildBoundedCapabilityList({ manifest: manifestWith(), hasTrustedIdentity: true });
    expect(list.length).toBeLessThanOrEqual(6);
    expect(list.length).toBeGreaterThan(0);
  });

  it('enforces structural success claims only with matching receipts', () => {
    expect(claimAllowsSuccess([{ operation: 'rsvp.response.write', claimsSuccess: true, receiptPresent: true }])).toBe(true);
    expect(claimAllowsSuccess([{ operation: 'rsvp.response.write', claimsSuccess: true, receiptPresent: false }])).toBe(false);
  });

  it('projects handoff truthfulness as typed evidence without false success', () => {
    {
      const requested = projectSupportHandoffEvidence({
        result: { status: 'success', message: 'Requested.' },
        phonePresent: true,
        confirmedReceipt: true,
      });
      expect(requested.handoffOutcome).toBe('handoff_requested');
      expect(requested.effectConfirmed).toBe(true);
      expect(requested.receiptPresent).toBe(true);
      const failed = projectSupportHandoffEvidence({
        result: { status: 'failed', error: 'unavailable', retryable: false },
        phonePresent: true,
        confirmedReceipt: false,
      });
      expect(failed.handoffOutcome).toBe('handoff_failed');
      expect(failed.effectConfirmed).toBe(false);
      expect(failed.receiptPresent).toBe(false);
      const unknown = projectSupportHandoffEvidence({
        result: { status: 'failed', error: 'timeout', retryable: true, outcome: 'unknown' },
        phonePresent: true,
        confirmedReceipt: false,
      });
      expect(unknown.handoffOutcome).toBe('handoff_unknown');
      expect(unknown.effectConfirmed).toBe(false);
    }

    {
      const missingIdentity = projectSupportHandoffEvidence({
        result: { status: 'skipped', reason: 'missing_phone_number', message: 'Missing.' },
        phonePresent: false,
        confirmedReceipt: false,
      });
      expect(missingIdentity.handoffOutcome).not.toBe('handoff_requested');
      expect(missingIdentity.identityAvailable).toBe(false);
      expect(missingIdentity.effectConfirmed).toBe(false);
      expect(missingIdentity.operationalNote).toContain('missing_phone_number');
      const unavailable = projectSupportHandoffEvidence({
        result: { status: 'skipped', reason: 'not_configured', message: 'Disabled.' },
        phonePresent: true,
        confirmedReceipt: false,
      });
      expect(unavailable.handoffOutcome).not.toBe('handoff_requested');
      expect(unavailable.effectConfirmed).toBe(false);
      expect(unavailable.operationalNote).toContain('not_configured');
    }
  });

});

describe('S16 human help policy', () => {
  const key = buildHandoffDedupeKey('conv-1', 'general');

  it('attempts human help once with dedupe, explicit retry, and safe skips', () => {
    {
      const decision = decideHumanHelpAttempt({
        conversationId: 'conv-1',
        inboundId: 'in-1',
        trustedPhone: '+51999999999',
        gatewayCapable: true,
        prior: null,
        explicitRetry: false,
      });
      expect(decision.action).toBe('attempt');
      const persisted = applyHandoffResult({ dedupeKey: key, inboundId: 'in-1', phone: '+51999999999', gatewayStatus: 'success' });
      expect(persisted.requested).toBe(true);
      expect(persisted.softPaused).toBe(true);
      expect(persisted.outcome).toBe('handoff_requested');
    }

    {
      const prior = applyHandoffResult({ dedupeKey: key, inboundId: 'in-1', phone: '+51999999999', gatewayStatus: 'success' });
      const decision = decideHumanHelpAttempt({
        conversationId: 'conv-1',
        inboundId: 'in-2',
        trustedPhone: '+51999999999',
        gatewayCapable: true,
        prior,
        explicitRetry: true,
      });
      expect(decision.action).toBe('skip_duplicate');
    }

    {
      const failed = applyHandoffResult({ dedupeKey: key, inboundId: 'in-1', phone: '+51999999999', gatewayStatus: 'failed' });
      expect(failed.requested).toBe(false);
      expect(failed.softPaused).toBe(false);
      expect(failed.outcome).toBe('handoff_failed');
      const auto = decideHumanHelpAttempt({
        conversationId: 'conv-1',
        inboundId: 'in-1',
        trustedPhone: '+51999999999',
        gatewayCapable: true,
        prior: failed,
        explicitRetry: false,
      });
      expect(auto.action).toBe('skip_duplicate');
      const explicit = decideHumanHelpAttempt({
        conversationId: 'conv-1',
        inboundId: 'in-2',
        trustedPhone: '+51999999999',
        gatewayCapable: true,
        prior: failed,
        explicitRetry: true,
      });
      expect(explicit.action).toBe('attempt');
    }

    {
      const unknown = applyHandoffResult({ dedupeKey: key, inboundId: 'in-1', phone: '+51999999999', gatewayStatus: 'unknown' });
      expect(unknown.outcome).toBe('outcome_unknown');
      expect(unknown.requested).toBe(false);
      const decision = decideHumanHelpAttempt({
        conversationId: 'conv-1',
        inboundId: 'in-2',
        trustedPhone: '+51999999999',
        gatewayCapable: true,
        prior: unknown,
        explicitRetry: true,
      });
      expect(decision.action).toBe('skip_unknown_unretried');
    }

    {
      expect(decideHumanHelpAttempt({
        conversationId: 'conv-1',
        inboundId: 'in-1',
        trustedPhone: null,
        gatewayCapable: true,
        prior: null,
        explicitRetry: false,
      }).action).toBe('skip_no_phone');
      expect(decideHumanHelpAttempt({
        conversationId: 'conv-1',
        inboundId: 'in-1',
        trustedPhone: '+51999999999',
        gatewayCapable: false,
        prior: null,
        explicitRetry: false,
      }).action).toBe('skip_unavailable');
    }
  });

});
