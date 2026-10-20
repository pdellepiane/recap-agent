/**
 * WP1 — capability digest: the single capability truth the router reads.
 *
 * The Decisions router (WP2) needs, per operation, the availability, the
 * availability reason and the consumer class. `buildCapabilityDigest` is the
 * only place that projection is built, so the router never reads the raw
 * manifest or the consumer registry directly.
 *
 * Pure function: no I/O, no network, no model calls, deterministic ordering
 * (the stable `runtimeOperationIds` order).
 */
import {
  runtimeOperationIds,
  type RuntimeCapabilityAvailabilityReason,
  type RuntimeCapabilityManifest,
  type RuntimeOperationId,
} from './capability-manifest';
import {
  capabilityConsumerClassFor,
  type CapabilityConsumerClass,
} from './capability-consumer-map';

export type CapabilityDigestEntry = {
  readonly id: RuntimeOperationId;
  readonly available: boolean;
  readonly reason: RuntimeCapabilityAvailabilityReason;
  readonly class: CapabilityConsumerClass;
};

export type CapabilityDigest = {
  readonly version: 'v1';
  /** One entry per operation, in the stable `runtimeOperationIds` order. */
  readonly operations: readonly CapabilityDigestEntry[];
};

/**
 * Build the router-facing capability digest from a built manifest.
 *
 * Availability and reason come from the manifest as-is; an unavailable
 * operation keeps its own reason (not_implemented, feature_disabled,
 * write_blocked, ...). The class comes from the consumer registry, never
 * from the operation name.
 */
export function buildCapabilityDigest(
  manifest: RuntimeCapabilityManifest,
): CapabilityDigest {
  const operations = runtimeOperationIds.map((id): CapabilityDigestEntry => {
    const descriptor = manifest[id];
    return {
      id,
      available: descriptor.available,
      reason: descriptor.reason,
      class: capabilityConsumerClassFor(id),
    };
  });
  return { version: 'v1', operations };
}

/** Digest entries indexed by operation id. */
export function capabilityDigestById(
  digest: CapabilityDigest,
): Readonly<Record<RuntimeOperationId, CapabilityDigestEntry>> {
  const byId = {} as Record<RuntimeOperationId, CapabilityDigestEntry>;
  for (const entry of digest.operations) {
    byId[entry.id] = entry;
  }
  return byId;
}
