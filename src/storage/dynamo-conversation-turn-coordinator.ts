import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

import { conversationPartitionKey } from './conversation-key';
import {
  type ConversationTurnCoordinator,
  type ConversationTurnLease,
} from './conversation-turn-coordinator';

type LockItem = {
  pk: string;
  sk: 'TURN_LOCK';
  owner_id: string;
  lease_until_ms: number;
};

export class DynamoConversationTurnCoordinator implements ConversationTurnCoordinator {
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    config?: DynamoDBClientConfig,
  ) {
    const client = new DynamoDBClient(config ?? {});
    this.documentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  async acquire(lease: ConversationTurnLease, nowMs: number): Promise<boolean> {
    validateLease(lease);
    validateEpochMs(nowMs, 'nowMs');
    const item: LockItem = {
      pk: conversationPartitionKey(lease.channel, lease.externalUserId),
      sk: 'TURN_LOCK',
      owner_id: lease.ownerId,
      lease_until_ms: lease.expiresAtMs,
    };
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression:
            'attribute_not_exists(pk) OR lease_until_ms <= :now_ms OR owner_id = :owner_id',
          ExpressionAttributeValues: {
            ':now_ms': nowMs,
            ':owner_id': lease.ownerId,
          },
        }),
      );
      return true;
    } catch (error: unknown) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  async release(lease: ConversationTurnLease): Promise<void> {
    validateLease(lease);
    try {
      await this.documentClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: conversationPartitionKey(lease.channel, lease.externalUserId),
            sk: 'TURN_LOCK',
          },
          ConditionExpression: 'owner_id = :owner_id',
          ExpressionAttributeValues: {
            ':owner_id': lease.ownerId,
          },
        }),
      );
    } catch (error: unknown) {
      if (isConditionalCheckFailed(error)) {
        return;
      }
      throw error;
    }
  }
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException ||
    (typeof error === 'object' && error !== null &&
      'name' in error && error.name === 'ConditionalCheckFailedException');
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
