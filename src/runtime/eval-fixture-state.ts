import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export const EVAL_FIXTURE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type FixtureEffectOperation =
  | 'otp.request'
  | 'otp.verify'
  | 'rsvp.write'
  | 'handoff.write'
  | 'provider.quote.write'
  | 'provider.favorite.write'
  | 'provider.review.write';

export type FixtureEffectReceipt = {
  readonly runId: string;
  readonly caseId: string;
  readonly scenario: string;
  readonly operation: FixtureEffectOperation;
  readonly attempt: number;
  readonly args: Record<string, unknown>;
  readonly resultStatus: string;
  readonly syntheticId: string;
  readonly createdAt: string;
  readonly ttl: number;
  readonly replayed: boolean;
};

export type FixtureStateKey = {
  readonly pk: string;
  readonly sk: string;
};

function requireIdentity(value: string, field: 'runId' | 'caseId' | 'scenario'): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new Error(`Fixture ${field} must be 1-128 chars.`);
  }
  return trimmed;
}

export function buildFixtureStateKey(runId: string, caseId: string, operation: FixtureEffectOperation): FixtureStateKey {
  const run = requireIdentity(runId, 'runId');
  const kase = requireIdentity(caseId, 'caseId');
  return {
    pk: `EVAL_FIXTURE#${run}#${kase}`,
    sk: `OP#${operation}`,
  };
}

/**
 * Packet O1 config-scoped fixture run identity. Matrix configurations must
 * never share fixture counters, so the fixture runId namespaces the logical
 * run ID by config label (`<runId>::<label>`). Reports keep the logical run
 * ID; only the fixture scope carries the suffix. Over-long identities are
 * truncated deterministically from the run side, never by dropping the
 * config label that provides the isolation.
 */
export function buildConfigScopedFixtureRunId(logicalRunId: string, configLabel: string): string {
  const run = logicalRunId.trim();
  const label = configLabel.trim();
  if (run.length === 0 || label.length === 0) {
    throw new Error('Fixture run identity requires a non-empty run ID and config label.');
  }
  const scoped = `${run}::${label}`;
  if (scoped.length <= 128) {
    return scoped;
  }
  const keepRun = Math.max(1, 128 - label.length - 2);
  return `${run.slice(0, keepRun)}::${label}`;
}

/**
 * S1 conversation scope. Derived by the Lambda handler from the existing
 * channel/user_id identity (never scenario-derived): the same conversation
 * retains its observed history across an intentional scenario transition,
 * while two concurrent cases on one phone (different caseId) and a later run
 * (different runId) stay isolated through the pk.
 */
export function buildFixtureConversationKey(channel: string, externalUserId: string): string {
  const cleanChannel = channel.trim();
  const cleanUser = externalUserId.trim();
  if (cleanChannel.length === 0 || cleanChannel.length > 128) {
    throw new Error('Fixture conversation channel must be 1-128 chars.');
  }
  if (cleanUser.length === 0 || cleanUser.length > 256) {
    throw new Error('Fixture conversation user must be 1-256 chars.');
  }
  return `${cleanChannel}#${cleanUser}`;
}

export const LOCAL_FIXTURE_CONVERSATION_KEY = 'local-conversation';

export function syntheticEffectId(scenario: string, operation: FixtureEffectOperation, runId: string, attempt: number): string {
  const safeScenario = scenario.trim().length > 0 ? scenario.trim() : 'unknown';
  const safeRun = runId.trim().length > 0 ? runId.trim().slice(0, 8) : 'local';
  return `fixture-${operation}-${safeScenario}-${safeRun}-${attempt}`;
}

export function ttlForFixtureState(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) + EVAL_FIXTURE_TTL_SECONDS;
}

export function assertFixtureAllowed(environment: string): void {
  if (environment === 'production') {
    throw new Error('Backend fixtures are available only in development.');
  }
}

export type FixtureMessageDirection = 'inbound' | 'outbound';

/**
 * Delivery truth for a logged fixture message. Only 'received' (an inbound
 * turn that actually arrived) and 'sent' (an outbound receipt backed by
 * actual delivered model text) may enter merged history. 'unverified'
 * outbound claims, 'suppressed' turns and 'failed' sends are retained for
 * audit but never surface as conversation context: fixtures must not
 * pretend suppressed/failed turns were sent.
 */
export type FixtureMessageDelivery = 'received' | 'sent' | 'unverified' | 'suppressed' | 'failed';

export type FixtureLoggedMessage = {
  readonly runId: string;
  readonly caseId: string;
  readonly scenario: string;
  /** Run/case/conversation scope this observation belongs to. */
  readonly conversationKey: string;
  /** Display phone as logged. */
  readonly phone: string;
  /** All lookup forms derived at log time (national, ext:national, concatenated, digits). */
  readonly phoneKeys: readonly string[];
  readonly direction: FixtureMessageDirection;
  /** Text only. Never image bytes, captions-as-pixels, or descriptions. */
  readonly body: string;
  readonly whatsappMessageId: string | null;
  readonly sentAt: string | null;
  readonly delivery: FixtureMessageDelivery;
  readonly seq: number;
  readonly recordedAt: string;
  readonly ttl: number;
};

export interface EvalFixtureStateStore {
  record(args: {
    runId: string;
    caseId: string;
    scenario: string;
    operation: FixtureEffectOperation;
    args: Record<string, unknown>;
    resultStatus: string;
    replayed?: boolean;
  }): Promise<FixtureEffectReceipt>;
  count(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<number>;
  list(runId: string, caseId: string, operation?: FixtureEffectOperation): Promise<FixtureEffectReceipt[]>;
  lastReceipt(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<FixtureEffectReceipt | null>;
  recordMessage(args: {
    runId: string;
    caseId: string;
    scenario: string;
    conversationKey: string;
    phone: string;
    phoneKeys: readonly string[];
    direction: FixtureMessageDirection;
    body: string;
    whatsappMessageId?: string | null;
    sentAt?: string | null;
    delivery: FixtureMessageDelivery;
  }): Promise<FixtureLoggedMessage>;
  listMessages(runId: string, caseId: string, conversationKey: string): Promise<FixtureLoggedMessage[]>;
  resetForTesting(): Promise<void>;
}

function storeKey(runId: string, caseId: string, operation: FixtureEffectOperation): string {
  return `${runId}\u0000${caseId}\u0000${operation}`;
}

function messageStoreKey(runId: string, caseId: string, conversationKey: string): string {
  return `${runId}\u0000${caseId}\u0000MSG\u0000${conversationKey}`;
}

function messageDedupeKey(runId: string, caseId: string, conversationKey: string, whatsappMessageId: string): string {
  return `${runId}\u0000${caseId}\u0000MSGID\u0000${conversationKey}\u0000${whatsappMessageId}`;
}

function messagePartitionKey(runId: string, caseId: string): string {
  return buildFixtureStateKey(runId, caseId, 'otp.request').pk;
}

export class InMemoryEvalFixtureStateStore implements EvalFixtureStateStore {
  private readonly receipts = new Map<string, FixtureEffectReceipt[]>();
  private readonly messages = new Map<string, FixtureLoggedMessage[]>();
  private readonly messageIds = new Map<string, FixtureLoggedMessage>();

  async record(args: {
    runId: string;
    caseId: string;
    scenario: string;
    operation: FixtureEffectOperation;
    args: Record<string, unknown>;
    resultStatus: string;
    replayed?: boolean;
  }): Promise<FixtureEffectReceipt> {
    const runId = requireIdentity(args.runId, 'runId');
    const caseId = requireIdentity(args.caseId, 'caseId');
    const scenario = requireIdentity(args.scenario, 'scenario');
    const key = storeKey(runId, caseId, args.operation);
    const existing = this.receipts.get(key) ?? [];
    const attempt = existing.length + 1;
    const receipt: FixtureEffectReceipt = {
      runId,
      caseId,
      scenario,
      operation: args.operation,
      attempt,
      args: { ...args.args },
      resultStatus: args.resultStatus,
      syntheticId: syntheticEffectId(scenario, args.operation, runId, attempt),
      createdAt: new Date().toISOString(),
      ttl: ttlForFixtureState(),
      replayed: args.replayed ?? false,
    };
    existing.push(receipt);
    this.receipts.set(key, existing);
    return receipt;
  }

  async count(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<number> {
    return (this.receipts.get(storeKey(runId, caseId, operation)) ?? []).length;
  }

  async list(runId: string, caseId: string, operation?: FixtureEffectOperation): Promise<FixtureEffectReceipt[]> {
    if (operation) {
      return [...(this.receipts.get(storeKey(runId, caseId, operation)) ?? [])];
    }
    const out: FixtureEffectReceipt[] = [];
    for (const [key, values] of this.receipts) {
      if (key.startsWith(`${runId}\u0000${caseId}\u0000`)) {
        out.push(...values);
      }
    }
    return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async lastReceipt(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<FixtureEffectReceipt | null> {
    const values = this.receipts.get(storeKey(runId, caseId, operation)) ?? [];
    return values.length > 0 ? values[values.length - 1] : null;
  }

  async recordMessage(args: {
    runId: string;
    caseId: string;
    scenario: string;
    conversationKey: string;
    phone: string;
    phoneKeys: readonly string[];
    direction: FixtureMessageDirection;
    body: string;
    whatsappMessageId?: string | null;
    sentAt?: string | null;
    delivery: FixtureMessageDelivery;
  }): Promise<FixtureLoggedMessage> {
    const runId = requireIdentity(args.runId, 'runId');
    const caseId = requireIdentity(args.caseId, 'caseId');
    const scenario = requireIdentity(args.scenario, 'scenario');
    const conversationKey = args.conversationKey.trim().length > 0
      ? args.conversationKey.trim()
      : LOCAL_FIXTURE_CONVERSATION_KEY;
    // Idempotent message IDs: a retried/concurrent delivery of the same
    // whatsapp message id returns the first record instead of duplicating
    // the current message or double-counting history.
    const dedupeId = args.whatsappMessageId?.trim() ? args.whatsappMessageId.trim() : null;
    if (dedupeId !== null) {
      const existing = this.messageIds.get(messageDedupeKey(runId, caseId, conversationKey, dedupeId));
      if (existing) return existing;
    }
    const key = messageStoreKey(runId, caseId, conversationKey);
    const existing = this.messages.get(key) ?? [];
    const seq = existing.length + 1;
    const record: FixtureLoggedMessage = {
      runId,
      caseId,
      scenario,
      conversationKey,
      phone: args.phone,
      phoneKeys: [...args.phoneKeys],
      direction: args.direction,
      body: args.body,
      whatsappMessageId: dedupeId,
      sentAt: args.sentAt ?? null,
      delivery: args.delivery,
      seq,
      recordedAt: new Date().toISOString(),
      ttl: ttlForFixtureState(),
    };
    existing.push(record);
    this.messages.set(key, existing);
    if (dedupeId !== null) {
      this.messageIds.set(messageDedupeKey(runId, caseId, conversationKey, dedupeId), record);
    }
    return record;
  }

  async listMessages(runId: string, caseId: string, conversationKey: string): Promise<FixtureLoggedMessage[]> {
    return [...(this.messages.get(messageStoreKey(runId, caseId, conversationKey)) ?? [])];
  }

  async resetForTesting(): Promise<void> {
    this.receipts.clear();
    this.messages.clear();
    this.messageIds.clear();
  }
}

export class DynamoEvalFixtureStateStore implements EvalFixtureStateStore {
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    config?: DynamoDBClientConfig,
  ) {
    const client = new DynamoDBClient(config ?? {});
    this.documentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async record(args: {
    runId: string;
    caseId: string;
    scenario: string;
    operation: FixtureEffectOperation;
    args: Record<string, unknown>;
    resultStatus: string;
    replayed?: boolean;
  }): Promise<FixtureEffectReceipt> {
    const runId = requireIdentity(args.runId, 'runId');
    const caseId = requireIdentity(args.caseId, 'caseId');
    const scenario = requireIdentity(args.scenario, 'scenario');
    const key = buildFixtureStateKey(runId, caseId, args.operation);
    // Atomic per-scope counter: concurrent or retried writers each receive a
    // distinct attempt instead of racing a read-count-then-put sequence.
    const attempt = await this.nextCounter(key.pk, `CTR#${key.sk}`);
    const receipt: FixtureEffectReceipt = {
      runId,
      caseId,
      scenario,
      operation: args.operation,
      attempt,
      args: { ...args.args },
      resultStatus: args.resultStatus,
      syntheticId: syntheticEffectId(scenario, args.operation, runId, attempt),
      createdAt: new Date().toISOString(),
      ttl: ttlForFixtureState(),
      replayed: args.replayed ?? false,
    };
    // Conditional insert: a retried write never overwrites a stored receipt.
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: key.pk,
          sk: `${key.sk}#${String(attempt).padStart(10, '0')}`,
          ...receipt,
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }),
    );
    return receipt;
  }

  /**
   * Atomic per-scope sequence allocation shared by effect attempts and
   * message ordering. UpdateExpression ADD is single-writer atomic in
   * DynamoDB; the counter item carries TTL so fixture scopes expire.
   */
  private async nextCounter(pk: string, counterSk: string): Promise<number> {
    const response = await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: counterSk },
        UpdateExpression: 'ADD attempt :one SET #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':ttl': ttlForFixtureState() },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    const attempt = (response.Attributes as { attempt?: unknown } | undefined)?.attempt;
    if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt <= 0) {
      throw new Error('Fixture counter returned an invalid attempt.');
    }
    return attempt;
  }

  async count(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<number> {
    const receipts = await this.list(runId, caseId, operation);
    return receipts.length;
  }

  async list(runId: string, caseId: string, operation?: FixtureEffectOperation): Promise<FixtureEffectReceipt[]> {
    const key = buildFixtureStateKey(runId, caseId, operation ?? 'otp.request');
    // Effect receipts share their pk with counters, message records and
    // idempotency markers: always scope the sort-key prefix to OP# so no
    // other record kind leaks into effect evidence.
    const response = await this.queryAll({
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': key.pk, ':sk': 'OP#' },
    });
    const items = response as Array<FixtureEffectReceipt & { pk: string; sk: string; operation?: unknown }>;
    return items
      .filter((item) => operation === undefined || item.operation === operation)
      .map((item) => ({
        runId: item.runId,
        caseId: item.caseId,
        scenario: item.scenario,
        operation: item.operation,
        attempt: item.attempt,
        args: item.args,
        resultStatus: item.resultStatus,
        syntheticId: item.syntheticId,
        createdAt: item.createdAt,
        ttl: item.ttl,
        replayed: item.replayed,
      }))
      .sort((left, right) => left.attempt - right.attempt);
  }

  /**
   * Paginated consistent reads: every page uses ConsistentRead so a
   * cold-start second invocation observes the actual prior response, and
   * LastEvaluatedKey is followed so no record is silently dropped.
   */
  private async queryAll(args: {
    KeyConditionExpression: string;
    ExpressionAttributeValues: Record<string, unknown>;
  }): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response = await this.documentClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: args.KeyConditionExpression,
          ExpressionAttributeValues: args.ExpressionAttributeValues,
          ConsistentRead: true,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      out.push(...((response.Items ?? []) as Record<string, unknown>[]));
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
    return out;
  }

  async lastReceipt(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<FixtureEffectReceipt | null> {
    const receipts = await this.list(runId, caseId, operation);
    return receipts.length > 0 ? receipts[receipts.length - 1] : null;
  }

  private messageSkPrefix(conversationKey: string): string {
    return `MSG#${conversationKey}#`;
  }

  private isConditionalCheckFailed(error: unknown): boolean {
    return error !== null && typeof error === 'object' && (error as { name?: unknown }).name === 'ConditionalCheckFailedException';
  }

  async recordMessage(args: {
    runId: string;
    caseId: string;
    scenario: string;
    conversationKey: string;
    phone: string;
    phoneKeys: readonly string[];
    direction: FixtureMessageDirection;
    body: string;
    whatsappMessageId?: string | null;
    sentAt?: string | null;
    delivery: FixtureMessageDelivery;
  }): Promise<FixtureLoggedMessage> {
    const runId = requireIdentity(args.runId, 'runId');
    const caseId = requireIdentity(args.caseId, 'caseId');
    const scenario = requireIdentity(args.scenario, 'scenario');
    const conversationKey = args.conversationKey.trim().length > 0
      ? args.conversationKey.trim()
      : LOCAL_FIXTURE_CONVERSATION_KEY;
    const dedupeId = args.whatsappMessageId?.trim() ? args.whatsappMessageId.trim() : null;
    const pk = messagePartitionKey(runId, caseId);
    // Atomic per-scope sequence: concurrent writers never share an order
    // slot. A contended idempotent retry may leave an unused gap, which
    // ordering (sort by seq) tolerates; it never overwrites or double-counts.
    const seq = await this.nextCounter(pk, `CTR#${this.messageSkPrefix(conversationKey)}SEQ`);
    const record: FixtureLoggedMessage = {
      runId,
      caseId,
      scenario,
      conversationKey,
      phone: args.phone,
      phoneKeys: [...args.phoneKeys],
      direction: args.direction,
      body: args.body,
      whatsappMessageId: dedupeId,
      sentAt: args.sentAt ?? null,
      delivery: args.delivery,
      seq,
      recordedAt: new Date().toISOString(),
      ttl: ttlForFixtureState(),
    };
    // Idempotent message IDs: the sort key is deterministic per whatsapp
    // message id, so a retried/concurrent delivery of the same id collides
    // on a conditional insert instead of duplicating the current message.
    // The loser reads back the winner's record and returns it.
    const sk = dedupeId !== null
      ? `${this.messageSkPrefix(conversationKey)}ID#${dedupeId}`
      : `${this.messageSkPrefix(conversationKey)}${String(seq).padStart(10, '0')}`;
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk,
            ...record,
            phoneKeys: [...record.phoneKeys],
          },
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
    } catch (error) {
      if (dedupeId === null || !this.isConditionalCheckFailed(error)) {
        throw error;
      }
      const winner = await this.documentClient.send(
        new GetCommand({ TableName: this.tableName, Key: { pk, sk }, ConsistentRead: true }),
      );
      if (!winner.Item) throw error;
      return this.toLoggedMessage(winner.Item as Record<string, unknown>);
    }
    return record;
  }

  async listMessages(runId: string, caseId: string, conversationKey: string): Promise<FixtureLoggedMessage[]> {
    // Conversation scope spans scenarios: the same conversation retains its
    // observed history across an intentional scenario transition. Scenario
    // seed history is merged by the gateway, never used to erase observations.
    const items = await this.queryAll({
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': messagePartitionKey(runId, caseId), ':sk': this.messageSkPrefix(conversationKey) },
    });
    return items
      .map((item) => this.toLoggedMessage(item))
      .sort((left, right) => left.seq - right.seq);
  }

  private toLoggedMessage(item: Record<string, unknown>): FixtureLoggedMessage {
    const phoneKeys = item['phoneKeys'];
    const direction = item['direction'];
    const delivery = item['delivery'];
    return {
      runId: item['runId'] as string,
      caseId: item['caseId'] as string,
      scenario: item['scenario'] as string,
      conversationKey: typeof item['conversationKey'] === 'string' ? item['conversationKey'] : LOCAL_FIXTURE_CONVERSATION_KEY,
      phone: item['phone'] as string,
      phoneKeys: Array.isArray(phoneKeys)
        ? phoneKeys.filter((entry): entry is string => typeof entry === 'string')
        : [],
      direction: direction === 'outbound' ? 'outbound' : 'inbound',
      body: item['body'] as string,
      whatsappMessageId: typeof item['whatsappMessageId'] === 'string' ? item['whatsappMessageId'] : null,
      sentAt: typeof item['sentAt'] === 'string' ? item['sentAt'] : null,
      delivery: delivery === 'sent' || delivery === 'suppressed' || delivery === 'failed' || delivery === 'unverified'
        ? delivery
        : 'unverified',
      seq: item['seq'] as number,
      recordedAt: item['recordedAt'] as string,
      ttl: typeof item['ttl'] === 'number' ? item['ttl'] : ttlForFixtureState(),
    };
  }

  async resetForTesting(): Promise<void> {
    throw new Error('DynamoEvalFixtureStateStore does not support resetForTesting.');
  }

  async readReceipt(runId: string, caseId: string, operation: FixtureEffectOperation, attempt: number): Promise<FixtureEffectReceipt | null> {
    const key = buildFixtureStateKey(runId, caseId, operation);
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: key.pk, sk: `${key.sk}#${String(attempt).padStart(10, '0')}` },
        ConsistentRead: true,
      }),
    );
    if (!response.Item) {
      return null;
    }
    const item = response.Item as FixtureEffectReceipt;
    return {
      runId: item.runId,
      caseId: item.caseId,
      scenario: item.scenario,
      operation: item.operation,
      attempt: item.attempt,
      args: item.args,
      resultStatus: item.resultStatus,
      syntheticId: item.syntheticId,
      createdAt: item.createdAt,
      ttl: item.ttl,
      replayed: item.replayed,
    };
  }
}

export function createEvalFixtureStateStoreFromEnv(): EvalFixtureStateStore | null {
  const tableName = process.env.EVAL_FIXTURE_TABLE_NAME?.trim();
  if (!tableName) {
    return null;
  }
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  return new DynamoEvalFixtureStateStore(tableName, { region });
}
