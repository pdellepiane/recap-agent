import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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
  resetForTesting(): Promise<void>;
}

function storeKey(runId: string, caseId: string, operation: FixtureEffectOperation): string {
  return `${runId}\u0000${caseId}\u0000${operation}`;
}

export class InMemoryEvalFixtureStateStore implements EvalFixtureStateStore {
  private readonly receipts = new Map<string, FixtureEffectReceipt[]>();

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

  async resetForTesting(): Promise<void> {
    this.receipts.clear();
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
    const existing = await this.count(runId, caseId, args.operation);
    const attempt = existing + 1;
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
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: key.pk,
          sk: `${key.sk}#${attempt}`,
          ...receipt,
        },
      }),
    );
    return receipt;
  }

  async count(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<number> {
    const receipts = await this.list(runId, caseId, operation);
    return receipts.length;
  }

  async list(runId: string, caseId: string, operation?: FixtureEffectOperation): Promise<FixtureEffectReceipt[]> {
    const key = buildFixtureStateKey(runId, caseId, operation ?? 'otp.request');
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk' + (operation ? ' AND begins_with(sk, :sk)' : ''),
        ExpressionAttributeValues: operation
          ? { ':pk': key.pk, ':sk': key.sk }
          : { ':pk': key.pk },
      }),
    );
    const items = (response.Items ?? []) as Array<FixtureEffectReceipt & { pk: string; sk: string }>;
    return items
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

  async lastReceipt(runId: string, caseId: string, operation: FixtureEffectOperation): Promise<FixtureEffectReceipt | null> {
    const receipts = await this.list(runId, caseId, operation);
    return receipts.length > 0 ? receipts[receipts.length - 1] : null;
  }

  async resetForTesting(): Promise<void> {
    throw new Error('DynamoEvalFixtureStateStore does not support resetForTesting.');
  }

  async readReceipt(runId: string, caseId: string, operation: FixtureEffectOperation, attempt: number): Promise<FixtureEffectReceipt | null> {
    const key = buildFixtureStateKey(runId, caseId, operation);
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: key.pk, sk: `${key.sk}#${attempt}` },
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
