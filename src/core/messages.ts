export type NormalizedInboundMessage = {
  channel: string;
  externalUserId: string;
  text: string;
  messageId: string;
  receivedAt: string;
};

export type NormalizedOutboundMessage = {
  text: string;
  conversationId: string | null;
};

