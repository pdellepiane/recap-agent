import type { InMemoryConversationTurnCoordinator } from './in-memory-conversation-turn-coordinator';
import type { ConversationTurnLease } from './conversation-turn-coordinator';

export type LeaseFenceSnapshot = {
  ownerId: string;
  expiresAtMs: number;
};

export function isLeaseFenceSatisfied(
  current: LeaseFenceSnapshot | null,
  leaseOwnerId: string,
  nowMs: number,
): boolean {
  if (!current || leaseOwnerId.length === 0) {
    return false;
  }
  return current.ownerId === leaseOwnerId && current.expiresAtMs > nowMs;
}

export class FencedPlanSaveRejectedError extends Error {
  readonly code = 'lease_fence_rejected';

  constructor() {
    super('Plan save rejected: lease is expired or superseded');
    this.name = 'FencedPlanSaveRejectedError';
  }
}

export type FencedPlanRef = {
  planKey: string;
  version: number;
};

type FencedStoreOptions = {
  failNextSave?: boolean;
};

/**
 * Deterministic test double for lease-fenced plan persistence. The fence is
 * read from the single shared InMemoryConversationTurnCoordinator record; this
 * class holds no lock state of its own. Production uses
 * buildFencedPlanTransactInput against the existing DynamoDB coordination
 * record instead.
 */
export class InMemoryLeaseFencedPlanStore {
  private readonly saved = new Map<string, FencedPlanRef>();
  private failNextSave: boolean;

  constructor(
    private readonly coordinator: Pick<
      InMemoryConversationTurnCoordinator,
      'currentLease'
    >,
    options?: FencedStoreOptions,
  ) {
    this.failNextSave = options?.failNextSave === true;
  }

  async saveFenced(plan: FencedPlanRef, lease: ConversationTurnLease, nowMs: number): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('plan save failed');
    }
    const current = await this.coordinator.currentLease(lease.channel, lease.externalUserId, nowMs);
    if (!isLeaseFenceSatisfied(current, lease.ownerId, nowMs)) {
      throw new FencedPlanSaveRejectedError();
    }
    this.saved.set(plan.planKey, { ...plan });
  }

  getSaved(planKey: string): FencedPlanRef | null {
    return this.saved.get(planKey) ?? null;
  }
}

export type FencedPlanTransactInput = {
  TransactItems: [
    { Put: { TableName: string; Item: Record<string, unknown> } },
    {
      ConditionCheck: {
        TableName: string;
        Key: { pk: string; sk: string };
        ConditionExpression: string;
        ExpressionAttributeValues: Record<string, string | number>;
      };
    },
  ];
};

/**
 * Builds the atomic transact-write input the integrator wires to
 * DynamoDBDocumentClient.send(new TransactWriteCommand(input)). The plan Put
 * commits only when the existing TURN_LOCK record under the same partition key
 * is still held by this owner and unexpired. No second lock store is used.
 */
export function buildFencedPlanTransactInput(args: {
  tableName: string;
  planKey: string;
  planItem: Record<string, unknown>;
  ownerId: string;
  nowMs: number;
}): FencedPlanTransactInput {
  return {
    TransactItems: [
      {
        Put: {
          TableName: args.tableName,
          Item: { ...args.planItem },
        },
      },
      {
        ConditionCheck: {
          TableName: args.tableName,
          Key: { pk: args.planKey, sk: 'TURN_LOCK' },
          ConditionExpression: 'owner_id = :owner_id AND lease_until_ms > :now_ms',
          ExpressionAttributeValues: {
            ':owner_id': args.ownerId,
            ':now_ms': args.nowMs,
          },
        },
      },
    ],
  };
}

export type PersistedTurnOutcome = {
  text: string | null;
  deliveryAction: 'send' | 'suppress';
  effectCount: number;
};

export type TurnExecutionResult = {
  replayed: boolean;
  outcome: PersistedTurnOutcome;
};

/**
 * Bounded ledger keyed by the existing channel message identity. A duplicate
 * inbound ID replays the persisted outcome without rerunning effects. This is
 * local delivery dedup only and claims no cross-system exactly-once execution.
 */
export class TurnOutcomeLedger {
  private readonly outcomes = new Map<string, PersistedTurnOutcome>();

  constructor(private readonly maxEntries = 50) {}

  async executeOnce(
    messageId: string,
    execute: () => Promise<PersistedTurnOutcome>,
  ): Promise<TurnExecutionResult> {
    const existing = this.outcomes.get(messageId);
    if (existing) {
      return { replayed: true, outcome: { ...existing } };
    }
    const outcome = await execute();
    this.outcomes.set(messageId, { ...outcome });
    while (this.outcomes.size > this.maxEntries) {
      const oldest = this.outcomes.keys().next();
      if (oldest.done) {
        break;
      }
      this.outcomes.delete(oldest.value);
    }
    return { replayed: false, outcome: { ...outcome } };
  }

  has(messageId: string): boolean {
    return this.outcomes.has(messageId);
  }

  size(): number {
    return this.outcomes.size;
  }
}

export type HistoricalCorrelation = {
  note: string;
};

/**
 * Optional evidence enrichment for historical correlation (e.g. Tito
 * screenshot ordering). A null correlation leaves the outcome untouched, so
 * missing upstream trace never blocks or alters local behavior.
 */
export function attachHistoricalCorrelation<T extends object>(
  outcome: T,
  correlation: HistoricalCorrelation | null,
): T & { historicalCorrelation?: HistoricalCorrelation } {
  if (!correlation) {
    return { ...outcome };
  }
  return { ...outcome, historicalCorrelation: { ...correlation } };
}
