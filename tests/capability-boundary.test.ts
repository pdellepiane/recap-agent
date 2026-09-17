import { describe, expect, it } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import { resolveDynamicTools } from '../src/runtime/dynamic-agent-policy';
import {
  buildRuntimeCapabilityManifest,
  mergeRuntimeCapabilityManifests,
  resolveCapabilityDecision,
  runtimeOperationIds,
} from '../src/runtime/capability-manifest';
import { projectSupportHandoffEvidence } from '../src/runtime/reply-evidence-projector';
import { runtimeToolOperationMap } from '../src/runtime/capability-manifest';

describe('runtime capability boundary', () => {
  it('keeps the v1 operation order stable', () => {
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
    expect(runtimeOperationIds).toContain('auth.otp.send');
  });

  it('blocks customer writes in development while leaving reads available', () => {
    const manifest = buildRuntimeCapabilityManifest({
      configured: true,
      environment: 'development',
      allowCustomerWrites: false,
      featureFlags: {
        faq: true,
        purchaseInformation: true,
        rsvp: true,
        humanTakeover: true,
      },
    });

    expect(manifest['purchase.orders.read']).toMatchObject({ available: true, reason: 'enabled' });
    expect(manifest['rsvp.response.write']).toMatchObject({ available: false, reason: 'write_blocked' });
    expect(manifest['human.takeover.write']).toMatchObject({ available: false, reason: 'write_blocked' });
    expect(manifest['confirmation_document.send']).toMatchObject({ available: false, reason: 'not_implemented' });
    // R9: receipt/image turns are answered by the model with DB tools, so
    // payment_proof.verify and media.image.inspect no longer force a
    // deterministic handoff. They resolve like any configured operation.
    expect(manifest['payment_proof.verify']).toMatchObject({ available: true, reason: 'enabled' });
    expect(manifest['media.image.inspect']).toMatchObject({ available: true, reason: 'enabled' });
  });

  it('marks every operation unavailable for the no-op gateway manifest', () => {
    const manifest = buildRuntimeCapabilityManifest({ configured: false });
    expect(manifest.operations).toHaveLength(runtimeOperationIds.length);
    expect(manifest.operations.every((operation) => !operation.available)).toBe(true);
    expect(manifest.operations.find((operation) => operation.id === 'media.image.inspect')?.reason)
      .toBe('gateway_unavailable');
  });

  it('separates extraction intent from deterministic availability', () => {
    const manifest = buildRuntimeCapabilityManifest({
      configured: true,
      featureFlags: { purchaseInformation: true, humanTakeover: true },
    });
    expect(resolveCapabilityDecision({ requestedOperation: null, manifest })).toEqual({ status: 'not_applicable' });
    expect(resolveCapabilityDecision({ requestedOperation: 'purchase.orders.read', manifest })).toEqual({
      status: 'supported',
      operation: 'purchase.orders.read',
    });
    // Mixed availability with an available servable read no longer preempts
    // the information flow: the read serves the fact (status_or_document
    // pairs resolve through the purchase lookup + safe read instead of a
    // capability question).
    expect(resolveCapabilityDecision({
      requestedOperation: null,
      manifest,
      ambiguity: {
        status: 'ambiguous',
        candidateOperations: ['purchase.orders.read', 'confirmation_document.send'],
        questionKey: 'status_or_document',
      },
    })).toEqual({ status: 'not_applicable' });
    // Mixed availability without a servable read still clarifies: a
    // write/unavailable pair crosses the runtime boundary with no
    // domain read to serve the fact.
    expect(resolveCapabilityDecision({
      requestedOperation: null,
      manifest,
      ambiguity: {
        status: 'ambiguous',
        candidateOperations: ['human.takeover.write', 'confirmation_document.send'],
        questionKey: 'type_missing',
      },
    })).toEqual({
      status: 'clarify',
      candidateOperations: ['human.takeover.write', 'confirmation_document.send'],
      questionKey: 'type_missing',
    });
    const allSupportedAmbiguityManifest = buildRuntimeCapabilityManifest({
      configured: true,
      allowCustomerWrites: true,
      featureFlags: { rsvp: true },
    });
    expect(resolveCapabilityDecision({
      requestedOperation: null,
      manifest: allSupportedAmbiguityManifest,
      ambiguity: {
        status: 'ambiguous',
        candidateOperations: ['rsvp.state.read', 'rsvp.response.write'],
        questionKey: 'type_missing',
      },
    })).toEqual({ status: 'not_applicable' });
    expect(resolveCapabilityDecision({ requestedOperation: 'confirmation_document.send', manifest })).toEqual({
      status: 'unsupported',
      operation: 'confirmation_document.send',
      reason: 'not_implemented',
      humanTakeoverAvailable: true,
    });
  });

  it('filters tools through the same manifest used by the service', () => {
    const plan = createEmptyPlan({ planId: 'capability-plan', channel: 'terminal', externalUserId: 'capability-user' });
    const manifest = buildRuntimeCapabilityManifest({
      configured: true,
      featureFlags: { providerPlanning: true, providerSearch: false },
    });
    const tools = resolveDynamicTools({
      plan,
      maximumTools: ['search_providers_from_plan', 'list_categories'],
      searchReady: true,
      providerResults: [],
      capabilityManifest: manifest,
    });
    expect(tools).toEqual(['list_categories']);
    expect(runtimeToolOperationMap.search_providers_from_plan).toBe('provider.search');
  });

  it('intersects configured features with the concrete gateway descriptor', () => {
    const configured = buildRuntimeCapabilityManifest({
      configured: true,
      featureFlags: { purchaseInformation: true, humanTakeover: true },
    });
    const gateway = buildRuntimeCapabilityManifest({
      configured: true,
      disabledOperations: ['purchase.orders.read', 'human.takeover.write'],
    });
    const merged = mergeRuntimeCapabilityManifests(configured, gateway);
    expect(merged['purchase.orders.read']).toMatchObject({
      available: false,
      reason: 'feature_disabled',
    });
    expect(merged['human.takeover.write']).toMatchObject({
      available: false,
      reason: 'feature_disabled',
    });
    expect(merged['purchase.gift_detail.read'].available).toBe(true);
  });
});

describe('capability boundary evidence', () => {
  it('projects honest handoff evidence without fixed replies', () => {
    const requested = projectSupportHandoffEvidence({
      result: { status: 'success', message: 'Requested.' },
      phonePresent: true,
      confirmedReceipt: true,
    });
    expect(requested.handoffOutcome).toBe('handoff_requested');
    expect(requested.effectConfirmed).toBe(true);
    expect(requested.requiresReplyModel).toBe(true);
    const failed = projectSupportHandoffEvidence({
      result: { status: 'failed', error: 'unavailable', retryable: true },
      phonePresent: true,
      confirmedReceipt: false,
    });
    expect(failed.handoffOutcome).toBe('handoff_failed');
    expect(failed.effectConfirmed).toBe(false);
    expect(failed.operationalNote).toContain('unavailable');
    const unknown = projectSupportHandoffEvidence({
      result: { status: 'failed', error: 'timeout', retryable: true, outcome: 'unknown' },
      phonePresent: true,
      confirmedReceipt: false,
    });
    expect(unknown.handoffOutcome).toBe('handoff_unknown');
    const skipped = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'missing_phone_number', message: 'Missing.' },
      phonePresent: false,
      confirmedReceipt: false,
    });
    expect(skipped.handoffOutcome).toBe('handoff_skipped_missing_phone');
    expect(skipped.identityAvailable).toBe(false);
    expect(skipped.effectConfirmed).toBe(false);
    for (const evidence of [requested, failed, unknown, skipped]) {
      expect(evidence.requiresReplyModel).toBe(true);
    }
  });
});
