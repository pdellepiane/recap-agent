import { describe, expect, it } from 'vitest';

import {
  buildRuntimeCapabilityManifest,
  runtimeOperationIds,
  type RuntimeCapabilityManifest,
} from '../src/runtime/capability-manifest';
import {
  buildCapabilityDigest,
  capabilityDigestById,
} from '../src/runtime/capability-digest';

describe('capability digest', () => {
  it('exposes exactly the four router fields for every operation', () => {
    const manifest = buildRuntimeCapabilityManifest({ configured: true });
    const digest = buildCapabilityDigest(manifest);

    expect(digest.version).toBe('v1');
    expect(digest.operations).toHaveLength(runtimeOperationIds.length);
    for (const entry of digest.operations) {
      expect(Object.keys(entry).sort()).toEqual([
        'available',
        'class',
        'id',
        'reason',
      ]);
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.available).toBe('boolean');
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.class.length).toBeGreaterThan(0);
    }
    expect(digest.operations.map((entry) => entry.id)).toEqual([
      ...runtimeOperationIds,
    ]);
  });

  it('is deterministic across builds', () => {
    const manifest = buildRuntimeCapabilityManifest({ configured: true });
    const first = buildCapabilityDigest(manifest);
    const second = buildCapabilityDigest(manifest);

    expect(first).toEqual(second);
    expect(first.operations.map((entry) => entry.id)).toEqual(
      second.operations.map((entry) => entry.id),
    );
  });

  it('keeps the reason of an unavailable operation', () => {
    const notImplemented = buildRuntimeCapabilityManifest({ configured: true });
    const featureDisabled = buildRuntimeCapabilityManifest({
      configured: true,
      featureFlags: { purchaseInformation: false },
    });
    const writeBlocked = buildRuntimeCapabilityManifest({
      configured: true,
      environment: 'development',
      allowCustomerWrites: false,
      featureFlags: { rsvp: true },
    });

    const notImplementedDigest = buildCapabilityDigest(notImplemented);
    expect(notImplementedDigest.operations.find(
      (entry) => entry.id === 'refund_or_withdrawal.execute',
    )).toMatchObject({
      available: false,
      reason: 'not_implemented',
      class: 'unsupported',
    });

    const featureDisabledDigest = buildCapabilityDigest(featureDisabled);
    expect(featureDisabledDigest.operations.find(
      (entry) => entry.id === 'purchase.orders.read',
    )).toMatchObject({
      available: false,
      reason: 'feature_disabled',
    });

    const writeBlockedDigest = buildCapabilityDigest(writeBlocked);
    expect(writeBlockedDigest.operations.find(
      (entry) => entry.id === 'rsvp.response.write',
    )).toMatchObject({
      available: false,
      reason: 'write_blocked',
      class: 'effect_write',
    });
  });

  it('mirrors the manifest availability for every operation', () => {
    const manifest: RuntimeCapabilityManifest = buildRuntimeCapabilityManifest({
      configured: true,
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
    });
    const digest = buildCapabilityDigest(manifest);
    const byId = capabilityDigestById(digest);

    for (const id of runtimeOperationIds) {
      expect(byId[id].available, id).toBe(manifest[id].available);
      expect(byId[id].reason, id).toBe(manifest[id].reason);
    }
    expect(digest.operations.filter((entry) => entry.available)).toHaveLength(
      runtimeOperationIds.length - 3,
    );
  });
});
