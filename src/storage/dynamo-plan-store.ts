import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

import { normalizeRawPlan, planSchema, type PlanSnapshot } from '../core/plan';
import { sessionFocusSchema, type SessionFocus } from '../core/turn-decision';
import type { PlanStore, SavePlanInput } from './plan-store';

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
    return `${channel}#${externalUserId}`;
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
