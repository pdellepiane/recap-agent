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

export type NormalizedInboundMessage = {
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
};

export type NormalizedOutboundMessage = {
  text: string | null;
  conversationId: string | null;
  structuredMessageKind: string | null;
  delivery: {
    action: 'send' | 'suppress';
    reason: string;
  };
};
