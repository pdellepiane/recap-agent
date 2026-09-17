import type { InboundImage } from './inbound-image';
import type { OutputOriginEvidence } from '../audit/output-origin';

export const inboundMediaKindValues = [
  'image',
  'video',
  'audio',
  'document',
  'sticker',
] as const;

export type InboundMediaKind = (typeof inboundMediaKindValues)[number];

/**
 * Channel-normalized media metadata. The provider media id is an opaque handle
 * that a channel adapter can resolve later; the runtime does not download media.
 */
export type InboundMedia = {
  kind: InboundMediaKind;
  providerMediaId: string;
  mimeType: string | null;
  sha256: string | null;
  fileName: string | null;
};

/**
 * Lease-wait fact observed while acquiring the conversation turn. Carried as
 * internal execution context only (never persisted, never part of the intake
 * contract): the handler threads it from the turn runner into the service so
 * reply composition can distinguish a turn that waited behind a preceding
 * reply from a fresh turn. Typed numbers only, never prose.
 */
export type TurnWaitEvidence = {
  waitMs: number;
  attempts: number;
};

export type NormalizedInboundMessage = {
  /** Ephemeral validated content: never persist or log this field. */
  image?: InboundImage;
  channel: string;
  externalUserId: string;
  text: string;
  messageId: string;
  receivedAt: string;
  /** Adapter-provided media descriptors; media bytes are never passed here. */
  media?: readonly InboundMedia[];
  /** Optional adapter-provided session boundary. */
  sessionId?: string | null;
  /** Optional phone number provided by the channel (e.g. WhatsApp webhook). */
  contactPhone?: string | null;
  /**
   * Internal execution context (Packet B). True when messageId arrived from
   * the channel; false when the adapter generated a fallback UUID. Controls
   * deduplication coverage reporting only; never changes the external
   * inbound contract.
   */
  nativeMessageId?: boolean | null;
  /**
   * Internal execution context (Packet B). Lease identity acquired by the
   * caller-held conversation turn runner for this invocation. Threaded into
   * effect boundaries for fresh validation and lease-conditioned writes.
   */
  turnLease?: { ownerId: string; expiresAtMs: number } | null;
  /**
   * Internal execution context (Packet B). Fresh lease validation against
   * the live coordination record. The service calls this at effect
   * boundaries instead of trusting a stale snapshot.
   */
  validateTurnLease?: (() => Promise<boolean>) | null;
  /**
   * Internal execution context (wait-aware reply). Lease-wait fact for this
   * invocation, present only when the turn waited behind a preceding holder
   * (acquire attempts beyond the first). Absent otherwise so unrelated turns
   * stay byte-identical. Never changes the external inbound contract.
   */
  turnWait?: TurnWaitEvidence | null;
};

export type NormalizedOutboundMessage = {
  text: string | null;
  outputOrigin?: OutputOriginEvidence;
  conversationId: string | null;
  structuredMessageKind: string | null;
  delivery: {
    /**
     * L1 typed operational failure: the turn could not produce a model-written
     * reply (guardrail trip, origin mismatch, model error). Adapters must not
     * send text for `failure`; `text` is always null. This replaces quiet
     * canned fallback prose, never legitimate suppression.
     */
    action: 'send' | 'suppress' | 'failure';
    reason: string;
  };
};
