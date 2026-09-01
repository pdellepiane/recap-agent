import { conversationPartitionKey } from './conversation-key';
import {
  type ConversationTurnCoordinator,
  type ConversationTurnLease,
} from './conversation-turn-coordinator';

type StoredLease = ConversationTurnLease;

export class InMemoryConversationTurnCoordinator implements ConversationTurnCoordinator {
  private readonly locks = new Map<string, StoredLease>();

  async acquire(lease: ConversationTurnLease, nowMs: number): Promise<boolean> {
    validateLease(lease);
    validateEpochMs(nowMs, 'nowMs');
    const key = conversationPartitionKey(lease.channel, lease.externalUserId);
    const existing = this.locks.get(key);
    if (!existing || existing.expiresAtMs <= nowMs || existing.ownerId === lease.ownerId) {
      this.locks.set(key, { ...lease });
      return true;
    }
    return false;
  }

  async release(lease: ConversationTurnLease): Promise<void> {
    validateLease(lease);
    const key = conversationPartitionKey(lease.channel, lease.externalUserId);
    const existing = this.locks.get(key);
    if (existing?.ownerId === lease.ownerId) {
      this.locks.delete(key);
    }
  }
}

function validateLease(lease: ConversationTurnLease): void {
  validateEpochMs(lease.expiresAtMs, 'expiresAtMs');
  if (lease.ownerId.length === 0) {
    throw new TypeError('ownerId must not be empty');
  }
}

function validateEpochMs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a finite epoch millisecond integer`);
  }
}
