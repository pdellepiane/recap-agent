export type NormalizedInboundMessage = {
  channel: string;
  externalUserId: string;
  text: string;
  messageId: string;
  receivedAt: string;
  /** Optional phone number provided by the channel (e.g. WhatsApp webhook). */
  contactPhone?: string | null;
};

export type NormalizedOutboundMessage = {
  text: string;
  conversationId: string | null;
};

