import {
  DynamoDBClient,
  ConditionalCheckFailedException,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { conversationPartitionKey } from './conversation-key';
import {
  RsvpEffectConflictError,
  RsvpEffectRecordInvalidError,
  createRsvpOperationHash,
  type RsvpEffectIntentInput,
  type RsvpEffectLeaseContext,
  type RsvpEffectOperation,
  type RsvpEffectRecord,
  type RsvpEffectStore,
  type RsvpIntentSaveResult,
  type RsvpVerifiedEffect,
} from '../runtime/rsvp-effect-executor';

/**
 * Packet B production RSVP effect store.
 *
 * Uses the EXISTING plans table with the same conversation partition key and
 * a separate RSVP_EFFECT#<message-id> sort key. No second table, no TTL
 * attributes (PlansTable has no TTL; receipts follow existing retention and
 * are never silently expired), no generic workflow engine.
 *
 * Intent uses a conditional create bound to a SHA-256 hash of the typed
 * operation. A duplicate id with a different operation is a conflict, never
 * an overwrite. Intent and result share one record; reads validate schema.
 *
 * Lease gating: when a turn lease owner is supplied, intent/result writes go
 * through a TransactWrite conditioned on the existing TURN_LOCK record still
 * held by that owner and unexpired. Without a lease (unit tests, tooling)
 * plain conditional writes are used.
 */

export const RSVP_EFFECT_SK_PREFIX = 'RSVP_EFFECT#';

export function rsvpEffectSortKey(messageId: string): string {
  if (messageId.length === 0 || messageId.includes('#')) {
    throw new TypeError('messageId must be a non-empty value without the partition separator');
  }
  return `${RSVP_EFFECT_SK_PREFIX}${messageId}`;
}

export function rsvpEffectOperationHash(operation: RsvpEffectOperation): string {
  return createRsvpOperationHash(operation);
}

const requestedFieldsSchema = z.object({
  guestId: z.number().int().positive(),
  eventId: z.number().int().positive().nullable(),
  action: z.enum(['attending', 'declining']).nullable(),
  plusOneResponse: z.enum(['yes', 'no']).nullable(),
  phoneExtension: z.string(),
  phoneNumber: z.string(),
});

const observedFieldsSchema = z.object({
  guestId: z.number().int().positive().nullable(),
  eventId: z.number().int().positive().nullable(),
  attendance: z.enum(['attending', 'declining']).nullable(),
  hasResponded: z.boolean().nullable(),
  responseDate: z.string().nullable(),
  source: z.literal('fresh_read'),
});

const verifiedEffectSchema = z.object({
  status: z.enum(['verified', 'observed_state', 'unconfirmed', 'no_write']),
  requested: requestedFieldsSchema,
  observed: observedFieldsSchema.nullable(),
  attendanceConfirmed: z.boolean(),
  plusOneEcho: z.object({
    saved: z.boolean(),
    response: z.enum(['yes', 'no']).nullable(),
    reason: z.string().nullable(),
  }).nullable(),
  companionConfirmed: z.boolean(),
  companionVerification: z.literal('unavailable'),
  successClaimAllowed: z.boolean(),
  effectApplied: z.boolean(),
  observedWithoutAttribution: z.boolean(),
  writeCount: z.number().int().nonnegative(),
  readCount: z.number().int().nonnegative(),
  persistedBeforeReply: z.boolean(),
  replayed: z.boolean(),
  freshRead: z.boolean(),
  dedupCoverage: z.enum(['native', 'unavailable']),
  readStatus: z.enum(['matched', 'mismatch', 'unavailable', 'not_attempted']),
  mismatch: z.object({
    kind: z.enum(['guest_id', 'event_id', 'attendance']),
    expected: z.string(),
    returned: z.string(),
  }).nullable(),
  gatewayStatus: z.enum([
    'responded',
    'multiple_pending',
    'already_responded',
    'no_pending',
    'phone_mismatch',
    'failed',
  ]).nullable(),
  failureReason: z.enum([
    'guest_mismatch',
    'event_mismatch',
    'attendance_mismatch',
    'read_unavailable',
    'write_failed',
    'write_unsupported',
    'lease_rejected',
    'intent_conflict',
    'receipt_invalid',
    'result_save_failed',
    'intent_save_failed',
    'no_mutation_requested',
  ]).nullable(),
  persistence: z.enum(['confirmed', 'observed', 'unknown', 'none']),
  operationHash: z.string().min(1),
  messageId: z.string().min(1),
  conversationKey: z.string().min(1),
});

const rsvpEffectRecordSchema = z.object({
  conversationKey: z.string().min(1),
  messageId: z.string().min(1),
  operationHash: z.string().min(1),
  requested: requestedFieldsSchema,
  status: z.enum(['intent', 'complete']),
  outcome: verifiedEffectSchema.nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export function parseRsvpEffectRecord(raw: unknown): RsvpEffectRecord {
  const parsed = rsvpEffectRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RsvpEffectRecordInvalidError();
  }
  return parsed.data;
}

/**
 * @deprecated Use RsvpEffectLeaseContext from the shared store seam. Kept
 * only so older held references keep compiling.
 */
export type RsvpEffectLease = {
  readonly ownerId: string;
  readonly nowMs: number;
};

export type DynamoRsvpEffectStoreOptions = {
  readonly documentClient?: DynamoDBDocumentClient;
};

type StoredRsvpEffectItem = {
  pk: string;
  sk: string;
  record_type: 'RSVP_EFFECT';
  reason: string;
} & Record<string, unknown>;

export class DynamoRsvpEffectStore implements RsvpEffectStore {
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    options?: DynamoRsvpEffectStoreOptions,
    config?: DynamoDBClientConfig,
  ) {
    this.documentClient = options?.documentClient ??
      DynamoDBDocumentClient.from(new DynamoDBClient(config ?? {}), {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      });
  }

  async loadByMessage(conversationKey: string, messageId: string): Promise<RsvpEffectRecord | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: conversationKey,
          sk: rsvpEffectSortKey(messageId),
        },
        ConsistentRead: true,
      }),
    );
    if (!response.Item) {
      return null;
    }
    return parseRsvpEffectRecord(this.stripStorageEnvelope(response.Item as StoredRsvpEffectItem));
  }

  async saveIntent(
    intent: RsvpEffectIntentInput,
    leaseContext?: RsvpEffectLeaseContext,
  ): Promise<RsvpIntentSaveResult> {
    const now = new Date().toISOString();
    const record: RsvpEffectRecord = {
      conversationKey: intent.conversationKey,
      messageId: intent.messageId,
      operationHash: intent.operationHash,
      requested: intent.requested,
      status: 'intent',
      outcome: null,
      createdAt: now,
      updatedAt: now,
    };
    const item = this.toStoredItem(record);
    try {
      if (leaseContext) {
        await this.documentClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: this.tableName,
                  Item: item,
                  ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                },
              },
              {
                ConditionCheck: {
                  TableName: this.tableName,
                  Key: { pk: intent.conversationKey, sk: 'TURN_LOCK' },
                  ConditionExpression: 'owner_id = :owner_id AND lease_until_ms > :now_ms',
                  ExpressionAttributeValues: {
                    ':owner_id': leaseContext.ownerId,
                    ':now_ms': leaseContext.nowMs,
                  },
                },
              },
            ],
          }),
        );
        return { kind: 'created' };
      }
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
      return { kind: 'created' };
    } catch (error: unknown) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const existing = await this.loadByMessage(intent.conversationKey, intent.messageId);
      if (!existing) {
        throw error;
      }
      if (existing.operationHash !== intent.operationHash) {
        throw new RsvpEffectConflictError();
      }
      return { kind: 'duplicate', existing };
    }
  }

  async saveResult(
    conversationKey: string,
    messageId: string,
    operationHash: string,
    outcome: RsvpVerifiedEffect,
    leaseContext?: RsvpEffectLeaseContext,
  ): Promise<void> {
    const existing = await this.loadByMessage(conversationKey, messageId);
    if (!existing) {
      throw new Error('rsvp result save without intent');
    }
    if (existing.operationHash !== operationHash) {
      throw new RsvpEffectConflictError();
    }
    const record: RsvpEffectRecord = {
      ...existing,
      status: 'complete',
      outcome,
      updatedAt: new Date().toISOString(),
    };
    const item = this.toStoredItem(record);
    if (!leaseContext) {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'operationHash = :operation_hash',
          ExpressionAttributeValues: {
            ':operation_hash': operationHash,
          },
        }),
      );
      return;
    }
    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: item,
              ConditionExpression: 'operationHash = :operation_hash',
              ExpressionAttributeValues: {
                ':operation_hash': operationHash,
              },
            },
          },
          {
            ConditionCheck: {
              TableName: this.tableName,
              Key: { pk: conversationKey, sk: 'TURN_LOCK' },
              ConditionExpression: 'owner_id = :owner_id AND lease_until_ms > :now_ms',
              ExpressionAttributeValues: {
                ':owner_id': leaseContext.ownerId,
                ':now_ms': leaseContext.nowMs,
              },
            },
          },
        ],
      }),
    );
  }

  conversationKeyFor(channel: string, externalUserId: string): string {
    return conversationPartitionKey(channel, externalUserId);
  }

  private toStoredItem(record: RsvpEffectRecord): StoredRsvpEffectItem {
    return {
      pk: record.conversationKey,
      sk: rsvpEffectSortKey(record.messageId),
      record_type: 'RSVP_EFFECT',
      reason: 'rsvp_effect_receipt',
      ...record,
    };
  }

  private stripStorageEnvelope(item: StoredRsvpEffectItem): Record<string, unknown> {
    const raw: Record<string, unknown> = { ...item };
    delete raw.pk;
    delete raw.sk;
    delete raw.record_type;
    delete raw.reason;
    return raw;
  }
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException ||
    (typeof error === 'object' && error !== null &&
      'name' in error && (error as { name?: unknown }).name === 'ConditionalCheckFailedException');
}
