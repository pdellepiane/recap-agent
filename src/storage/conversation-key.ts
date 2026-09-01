/**
 * Returns the partition key shared by all conversation-scoped storage.
 * Channel and external user identifiers are trusted opaque values here.
 */
export function conversationPartitionKey(
  channel: string,
  externalUserId: string,
): string {
  if (channel.length === 0 || channel.includes('#')) {
    throw new TypeError('channel must be a non-empty value without the partition separator');
  }
  return `${channel}#${externalUserId}`;
}
