import { describe, expect, it } from 'vitest';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  DynamoRsvpEffectStore,
  parseRsvpEffectRecord,
  rsvpEffectOperationHash,
  rsvpEffectSortKey,
} from '../src/storage/dynamo-rsvp-effect-store';
import {
  RsvpEffectConflictError,
  RsvpEffectRecordInvalidError,
  type RsvpEffectIntentInput,
  type RsvpEffectOperation,
  type RsvpVerifiedEffect,
} from '../src/runtime/rsvp-effect-executor';

const OPERATION: RsvpEffectOperation = {
  conversationKey: 'whatsapp#user-1',
  messageId: 'wamid.store-1',
  guestId: 41,
  eventId: 205,
  action: 'attending',
  plusOneResponse: null,
  phoneExtension: '+51',
  phoneNumber: '973296571',
};

function intentFor(operation: RsvpEffectOperation): RsvpEffectIntentInput {
  return {
    conversationKey: operation.conversationKey,
    messageId: operation.messageId,
    operationHash: rsvpEffectOperationHash(operation),
    requested: {
      guestId: operation.guestId,
      eventId: operation.eventId,
      action: operation.action,
      plusOneResponse: operation.plusOneResponse,
      phoneExtension: operation.phoneExtension,
      phoneNumber: operation.phoneNumber,
    },
  };
}

function verifiedOutcome(operation: RsvpEffectOperation): RsvpVerifiedEffect {
  return {
    status: 'verified',
    requested: {
      guestId: operation.guestId,
      eventId: operation.eventId,
      action: operation.action,
      plusOneResponse: operation.plusOneResponse,
      phoneExtension: operation.phoneExtension,
      phoneNumber: operation.phoneNumber,
    },
    observed: {
      guestId: operation.guestId,
      eventId: operation.eventId,
      attendance: 'attending',
      hasResponded: true,
      responseDate: '2026-09-14T00:00:00.000Z',
      source: 'fresh_read',
    },
    attendanceConfirmed: true,
    plusOneEcho: null,
    companionConfirmed: false,
    companionVerification: 'unavailable',
    successClaimAllowed: true,
    effectApplied: true,
    observedWithoutAttribution: false,
    writeCount: 1,
    readCount: 1,
    persistedBeforeReply: true,
    replayed: false,
    freshRead: true,
    dedupCoverage: 'native',
    readStatus: 'matched',
    mismatch: null,
    gatewayStatus: 'responded',
    failureReason: null,
    persistence: 'confirmed',
    operationHash: rsvpEffectOperationHash(operation),
    messageId: operation.messageId,
    conversationKey: operation.conversationKey,
  };
}

/** Minimal fake honoring conditional creates and hash-guarded result writes. */
class FakeDocumentClient {
  readonly items = new Map<string, Record<string, unknown>>();

  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const name = command.constructor.name;
    if (name === 'GetCommand') {
      const key = command.input.Key as { pk: string; sk: string };
      return { Item: this.items.get(`${key.pk}\n${key.sk}`) };
    }
    if (name === 'PutCommand') {
      const item = command.input.Item as Record<string, unknown>;
      const key = `${item.pk as string}\n${item.sk as string}`;
      const condition = command.input.ConditionExpression as string | undefined;
      if (condition?.includes('attribute_not_exists') && this.items.has(key)) {
        throw Object.assign(new Error('conditional check failed'), {
          name: 'ConditionalCheckFailedException',
        });
      }
      if (condition?.includes('operationHash')) {
        const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
        if (this.items.get(key)?.['operationHash'] !== values[':operation_hash']) {
          throw Object.assign(new Error('conditional check failed'), {
            name: 'ConditionalCheckFailedException',
          });
        }
      }
      this.items.set(key, item);
      return {};
    }
    throw new Error(`unsupported command ${name}`);
  }
}

function testStore(fake: FakeDocumentClient): DynamoRsvpEffectStore {
  return new DynamoRsvpEffectStore('plans-table', {
    documentClient: fake as unknown as DynamoDBDocumentClient,
  });
}

describe('DynamoRsvpEffectStore', () => {
  it('keys receipts by conversation partition with a separate RSVP_EFFECT sort key', () => {
    expect(rsvpEffectSortKey('wamid.abc')).toBe('RSVP_EFFECT#wamid.abc');
    expect(() => rsvpEffectSortKey('')).toThrow(TypeError);
    expect(() => rsvpEffectSortKey('a#b')).toThrow(TypeError);
  });

  it('binds a stable hash of the typed operation', () => {
    expect(rsvpEffectOperationHash(OPERATION)).toBe(rsvpEffectOperationHash({ ...OPERATION }));
    expect(rsvpEffectOperationHash(OPERATION)).not.toBe(
      rsvpEffectOperationHash({ ...OPERATION, action: 'declining' }),
    );
  });

  it('round-trips intent then result in one record with no expiry attributes', async () => {
    const fake = new FakeDocumentClient();
    const store = testStore(fake);
    const intent = intentFor(OPERATION);

    await expect(store.loadByMessage(intent.conversationKey, intent.messageId)).resolves.toBeNull();
    await expect(store.saveIntent(intent)).resolves.toMatchObject({ kind: 'created' });
    const pending = await store.loadByMessage(intent.conversationKey, intent.messageId);
    expect(pending?.status).toBe('intent');
    expect(pending?.outcome).toBeNull();

    await store.saveResult(
      intent.conversationKey,
      intent.messageId,
      intent.operationHash,
      verifiedOutcome(OPERATION),
    );
    const receipt = await store.loadByMessage(intent.conversationKey, intent.messageId);
    expect(receipt?.status).toBe('complete');
    expect(receipt?.outcome?.status).toBe('verified');
    expect(receipt?.outcome?.requested.action).toBe('attending');
    expect(receipt?.outcome?.observed?.attendance).toBe('attending');

    const stored = fake.items.get(`${intent.conversationKey}\nRSVP_EFFECT#${intent.messageId}`);
    expect(stored?.['sk']).toBe('RSVP_EFFECT#wamid.store-1');
    expect(stored).not.toHaveProperty('ttl');
    expect(stored).not.toHaveProperty('expires_at');
    expect(stored).not.toHaveProperty('expireAt');
  });

  it('treats same-operation redelivery as duplicate and different-operation redelivery as conflict', async () => {
    const fake = new FakeDocumentClient();
    const store = testStore(fake);
    const intent = intentFor(OPERATION);
    await store.saveIntent(intent);

    const duplicate = await store.saveIntent(intent);
    expect(duplicate.kind).toBe('duplicate');

    const conflicting: RsvpEffectIntentInput = {
      ...intentFor({ ...OPERATION, action: 'declining' }),
      messageId: intent.messageId,
      conversationKey: intent.conversationKey,
    };
    await expect(store.saveIntent(conflicting)).rejects.toBeInstanceOf(RsvpEffectConflictError);
    const kept = await store.loadByMessage(intent.conversationKey, intent.messageId);
    expect(kept?.requested.action).toBe('attending');
  });

  it('refuses result saves without intent or with a mismatched hash', async () => {
    const fake = new FakeDocumentClient();
    const store = testStore(fake);
    const intent = intentFor(OPERATION);
    await expect(
      store.saveResult(intent.conversationKey, intent.messageId, intent.operationHash, verifiedOutcome(OPERATION)),
    ).rejects.toThrow('rsvp result save without intent');

    await store.saveIntent(intent);
    await expect(
      store.saveResult(intent.conversationKey, intent.messageId, 'different-hash', verifiedOutcome(OPERATION)),
    ).rejects.toBeInstanceOf(RsvpEffectConflictError);
  });

  it('rejects corrupt receipts on read instead of trusting them', async () => {
    const fake = new FakeDocumentClient();
    const store = testStore(fake);
    const intent = intentFor(OPERATION);
    fake.items.set(`${intent.conversationKey}\nRSVP_EFFECT#${intent.messageId}`, {
      pk: intent.conversationKey,
      sk: 'RSVP_EFFECT#wamid.store-1',
      requested: { guestId: 'not-a-number' },
    });
    await expect(store.loadByMessage(intent.conversationKey, intent.messageId)).rejects.toBeInstanceOf(
      RsvpEffectRecordInvalidError,
    );
    expect(() => parseRsvpEffectRecord({})).toThrow(RsvpEffectRecordInvalidError);
  });

  it('isolates receipts by conversation for the same message id', async () => {
    const fake = new FakeDocumentClient();
    const store = testStore(fake);
    await store.saveIntent(intentFor(OPERATION));
    await store.saveIntent(intentFor({ ...OPERATION, conversationKey: 'whatsapp#user-2' }));
    await expect(store.loadByMessage('whatsapp#user-1', OPERATION.messageId)).resolves.toMatchObject({
      conversationKey: 'whatsapp#user-1',
    });
    await expect(store.loadByMessage('whatsapp#user-2', OPERATION.messageId)).resolves.toMatchObject({
      conversationKey: 'whatsapp#user-2',
    });
  });
});
