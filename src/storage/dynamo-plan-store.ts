import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

import { normalizeRawPlan, planSchema, type PlanSnapshot } from '../core/plan';
import { sessionFocusSchema, type SessionFocus } from '../core/turn-decision';
import type { FencedSavePlanInput, PlanStore, SavePlanInput } from './plan-store';
import { conversationPartitionKey } from './conversation-key';
import { buildFencedPlanTransactInput } from './turn-fencing';

type StoredItem = {
  pk: string;
  sk: string;
  reason: string;
} & Record<string, unknown>;

export class DynamoPlanStore implements PlanStore {
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

  async getByExternalUser(
    channel: string,
    externalUserId: string,
  ): Promise<PlanSnapshot | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: this.pk(channel, externalUserId),
          sk: 'PLAN',
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    const rawPlan = this.stripStorageEnvelope(response.Item as StoredItem);

    return planSchema.parse(normalizeRawPlan(rawPlan)) as PlanSnapshot;
  }

  async getSessionFocus(
    channel: string,
    externalUserId: string,
    sessionId: string,
  ): Promise<SessionFocus | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: this.pk(channel, externalUserId),
          sk: this.sessionFocusSk(sessionId),
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    const rawFocus = this.stripStorageEnvelope(response.Item as StoredItem);
    return sessionFocusSchema.parse(rawFocus);
  }

  async save(input: SavePlanInput): Promise<void> {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: this.pk(input.plan.channel, input.plan.external_user_id),
          sk: 'PLAN',
          reason: input.reason,
          ...input.plan,
        } satisfies StoredItem,
      }),
    );
  }

  /**
   * Packet B: plan writes under a turn lease use the current lease condition
   * (atomic Put + TURN_LOCK ConditionCheck, no second lock store) instead of
   * the test-only fencing helper in isolation. Without a lease owner this is
   * a plain save.
   */
  async saveFenced(input: FencedSavePlanInput): Promise<void> {
    if (!input.leaseOwnerId) {
      await this.save(input);
      return;
    }
    const planKey = this.pk(input.plan.channel, input.plan.external_user_id);
    const planItem: Record<string, unknown> = {
      pk: planKey,
      sk: 'PLAN',
      reason: input.reason,
      ...input.plan,
    };
    const transactInput = buildFencedPlanTransactInput({
      tableName: this.tableName,
      planKey,
      planItem,
      ownerId: input.leaseOwnerId,
      nowMs: input.nowMs ?? Date.now(),
    });
    await this.documentClient.send(new TransactWriteCommand(transactInput));
  }

  async saveSessionFocus(
    channel: string,
    externalUserId: string,
    focus: SessionFocus,
  ): Promise<void> {
    const parsed = sessionFocusSchema.parse(focus);
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: this.pk(channel, externalUserId),
          sk: this.sessionFocusSk(parsed.sessionId),
          reason: 'session_focus',
          ...parsed,
        } satisfies StoredItem,
      }),
    );
  }

  private pk(channel: string, externalUserId: string): string {
    return conversationPartitionKey(channel, externalUserId);
  }

  private sessionFocusSk(sessionId: string): string {
    return `SESSION#${sessionId}`;
  }

  private stripStorageEnvelope(item: StoredItem): Record<string, unknown> {
    const rawPlan: Record<string, unknown> = { ...item };
    delete rawPlan.pk;
    delete rawPlan.sk;
    delete rawPlan.reason;
    return rawPlan;
  }
}
