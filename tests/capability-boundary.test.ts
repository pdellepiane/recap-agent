import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';

import { createEmptyPlan } from '../src/core/plan';
import { resolveDynamicTools } from '../src/runtime/dynamic-agent-policy';
import {
  buildRuntimeCapabilityManifest,
  mergeRuntimeCapabilityManifests,
  resolveCapabilityDecision,
  runtimeOperationIds,
} from '../src/runtime/capability-manifest';
import {
  CapabilityBoundaryRenderer,
  defaultCapabilityBoundaryMessages,
  parseCapabilityBoundaryMessages,
} from '../src/runtime/capability-boundary-renderer';
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
    expect(manifest['media.image.inspect']).toMatchObject({ available: false, reason: 'media_unavailable' });
  });

  it('marks every operation unavailable for the no-op gateway manifest', () => {
    const manifest = buildRuntimeCapabilityManifest({ configured: false });
    expect(manifest.operations).toHaveLength(runtimeOperationIds.length);
    expect(manifest.operations.every((operation) => !operation.available)).toBe(true);
    expect(manifest.operations.find((operation) => operation.id === 'media.image.inspect')?.reason)
      .toBe('media_unavailable');
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
    expect(resolveCapabilityDecision({
      requestedOperation: null,
      manifest,
      ambiguity: {
        status: 'ambiguous',
        candidateOperations: ['purchase.orders.read', 'confirmation_document.send'],
        questionKey: 'status_or_document',
      },
    })).toEqual({
      status: 'clarify',
      candidateOperations: ['purchase.orders.read', 'confirmation_document.send'],
      questionKey: 'status_or_document',
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

describe('capability boundary renderer', () => {
  it('parses the tracked deterministic Spanish messages', async () => {
    const boundaryText = await fs.readFile(
      `${process.cwd()}/prompts/nodes/resolver_consultas_informativas/capability_boundary.txt`,
      'utf8',
    );
    const messages = parseCapabilityBoundaryMessages(boundaryText);
    expect(messages).toEqual(expect.objectContaining(defaultCapabilityBoundaryMessages));
  });

  it('renders one clarification and honest handoff outcomes', () => {
    const renderer = new CapabilityBoundaryRenderer(defaultCapabilityBoundaryMessages);
    const clarification = renderer.render({
      status: 'clarify',
      candidateOperations: ['purchase.orders.read', 'confirmation_document.send'],
      questionKey: 'status_or_document',
    });
    expect(clarification).toBe('¿Quieres consultar si el pago está confirmado o necesitas que te envíen una constancia?');
    expect(renderer.render({
      status: 'unsupported',
      operation: 'confirmation_document.send',
      reason: 'not_implemented',
      humanTakeoverAvailable: true,
    }, { humanTakeoverFailed: true })).toContain('no pude registrar el apoyo humano');
    expect(renderer.render({
      status: 'unsupported',
      operation: 'media.image.inspect',
      reason: 'media_unavailable',
      humanTakeoverAvailable: true,
    })).toContain('No puedo leer ni revisar');
    expect(renderer.render({
      status: 'unsupported',
      operation: 'purchase.modify',
      reason: 'not_implemented',
      humanTakeoverAvailable: true,
    })).not.toContain('constancia');
    expect(renderer.render({
      status: 'unsupported',
      operation: 'purchase.modify',
      reason: 'not_implemented',
      humanTakeoverAvailable: true,
    })).toContain('No puedo realizar esa gestión');
  });
});
