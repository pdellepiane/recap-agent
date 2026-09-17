import { randomUUID } from 'node:crypto';

export type ConversationTurnIdentity = {
  channel: string;
  externalUserId: string;
};

export type ConversationTurnLease = ConversationTurnIdentity & {
  ownerId: string;
  expiresAtMs: number;
};

export interface ConversationTurnCoordinator {
  acquire(lease: ConversationTurnLease, nowMs: number): Promise<boolean>;
  release(lease: ConversationTurnLease): Promise<void>;
}

export type ConversationTurnEvent = {
  name: 'acquire' | 'release';
  outcome: 'acquired' | 'busy' | 'unavailable' | 'released' | 'error';
  wait_ms: number;
  attempts: number;
  duration_ms: number;
};

/**
 * Observed lease acquisition handed to the turn operation. `waitMs` is the
 * bounded time spent polling before the acquire succeeded; `attempts` counts
 * acquire calls (1 means an immediate first-attempt acquire, above 1 means
 * the turn waited behind a preceding holder). Read-only telemetry surfaced
 * for typed evidence; it never changes acquire/release semantics.
 */
export type ConversationTurnAcquisition = {
  waitMs: number;
  attempts: number;
};

export class ConversationTurnBusyError extends Error {
  constructor() {
    super('Conversation turn is busy');
    this.name = 'ConversationTurnBusyError';
  }
}

export class ConversationTurnUnavailableError extends Error {
  readonly cause: unknown;

  constructor(cause?: unknown) {
    super('Conversation turn coordination is temporarily unavailable');
    this.name = 'ConversationTurnUnavailableError';
    this.cause = cause;
  }
}

export type RunWithConversationTurnLeaseArgs<T> = {
  coordinator: ConversationTurnCoordinator;
  identity: ConversationTurnIdentity;
  hardDeadlineMs: number;
  waitMs: number;
  executionReserveMs: number;
  expirySafetyMs: number;
  pollMs: number;
  /**
   * Turn work executed while holding the lease. Receives the observed
   * acquisition (bounded wait milliseconds plus acquire attempts) so callers
   * can thread the wait fact downstream as typed evidence. Existing zero-arg
   * operations stay assignable; acquire/release semantics are unchanged.
   */
  operation: (acquisition: ConversationTurnAcquisition) => Promise<T>;
  onEvent?: (event: ConversationTurnEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  ownerId?: string;
};

const MAX_SLEEP_MS = 60_000;

function requireEpochMs(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a finite epoch millisecond integer`);
  }
  return value;
}

function requireDurationMs(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative millisecond integer`);
  }
  return value;
}

function safeEvent(
  onEvent: ((event: ConversationTurnEvent) => void) | undefined,
  event: ConversationTurnEvent,
): void {
  if (!onEvent) {
    return;
  }
  try {
    onEvent(event);
  } catch {
    // Observability must never alter lock ownership or turn behavior.
  }
}

function elapsedMs(now: () => number, startMs: number): number {
  const current = now();
  return Number.isFinite(current) ? Math.max(0, Math.round(current - startMs)) : 0;
}

function clampRandom(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/**
 * Runs one operation while holding a fixed lease through the Lambda deadline.
 * The lease is never renewed and is released only after the operation settles.
 */
export async function runWithConversationTurnLease<T>(
  args: RunWithConversationTurnLeaseArgs<T>,
): Promise<T> {
  const hardDeadlineMs = requireEpochMs(args.hardDeadlineMs, 'hardDeadlineMs');
  const waitMs = requireDurationMs(args.waitMs, 'waitMs');
  const executionReserveMs = requireDurationMs(args.executionReserveMs, 'executionReserveMs');
  const expirySafetyMs = requireDurationMs(args.expirySafetyMs, 'expirySafetyMs');
  const pollMs = requireDurationMs(args.pollMs, 'pollMs');
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = args.random ?? Math.random;
  const ownerId = args.ownerId ?? randomUUID();
  if (ownerId.length === 0) {
    throw new TypeError('ownerId must not be empty');
  }

  const startMs = requireEpochMs(now(), 'now');
  const reserveDeadlineMs = hardDeadlineMs - executionReserveMs;
  const waitDeadlineMs = Math.min(startMs + waitMs, reserveDeadlineMs);
  const lease: ConversationTurnLease = {
    ...args.identity,
    ownerId,
    expiresAtMs: requireEpochMs(hardDeadlineMs + expirySafetyMs, 'expiresAtMs'),
  };
  let attempts = 0;

  while (true) {
    const beforeAcquireMs = requireEpochMs(now(), 'now');
    // The first attempt is always immediate when reserve time remains. Subsequent
    // attempts must stop at the bounded wait deadline rather than crossing it.
    if (beforeAcquireMs >= reserveDeadlineMs || (attempts > 0 && beforeAcquireMs >= waitDeadlineMs)) {
      safeEvent(args.onEvent, {
        name: 'acquire',
        outcome: 'busy',
        wait_ms: elapsedMs(now, startMs),
        attempts,
        duration_ms: elapsedMs(now, startMs),
      });
      throw new ConversationTurnBusyError();
    }

    attempts += 1;
    let acquired: boolean;
    try {
      acquired = await args.coordinator.acquire(lease, beforeAcquireMs);
    } catch (error: unknown) {
      safeEvent(args.onEvent, {
        name: 'acquire',
        outcome: 'unavailable',
        wait_ms: elapsedMs(now, startMs),
        attempts,
        duration_ms: elapsedMs(now, startMs),
      });
      throw new ConversationTurnUnavailableError(error);
    }

    const afterAcquireMs = requireEpochMs(now(), 'now');
    if (acquired && afterAcquireMs >= reserveDeadlineMs) {
      await releaseSafely(args, lease, startMs, attempts, now);
      safeEvent(args.onEvent, {
        name: 'acquire',
        outcome: 'busy',
        wait_ms: elapsedMs(now, startMs),
        attempts,
        duration_ms: elapsedMs(now, startMs),
      });
      throw new ConversationTurnBusyError();
    }
    if (acquired) {
      safeEvent(args.onEvent, {
        name: 'acquire',
        outcome: 'acquired',
        wait_ms: elapsedMs(now, startMs),
        attempts,
        duration_ms: elapsedMs(now, startMs),
      });
      try {
        // No extra clock read: the wait fact reuses the timestamp already
        // observed for this acquire, so polling bounds and tick-counting
        // callers see no behavior change.
        return await args.operation({
          waitMs: Math.max(0, Math.round(afterAcquireMs - startMs)),
          attempts,
        });
      } finally {
        await releaseSafely(args, lease, startMs, attempts, now);
      }
    }

    if (afterAcquireMs >= waitDeadlineMs || pollMs === 0) {
      safeEvent(args.onEvent, {
        name: 'acquire',
        outcome: 'busy',
        wait_ms: elapsedMs(now, startMs),
        attempts,
        duration_ms: elapsedMs(now, startMs),
      });
      throw new ConversationTurnBusyError();
    }

    const remainingWaitMs = Math.max(0, waitDeadlineMs - afterAcquireMs);
    const jitteredPollMs = Math.max(1, Math.round(pollMs * (0.5 + clampRandom(random()) * 0.5)));
    const waitForMs = Math.min(MAX_SLEEP_MS, remainingWaitMs, jitteredPollMs);
    if (waitForMs <= 0) {
      safeEvent(args.onEvent, {
        name: 'acquire',
        outcome: 'busy',
        wait_ms: elapsedMs(now, startMs),
        attempts,
        duration_ms: elapsedMs(now, startMs),
      });
      throw new ConversationTurnBusyError();
    }
    await sleep(waitForMs);
  }
}

async function releaseSafely<T>(
  args: RunWithConversationTurnLeaseArgs<T>,
  lease: ConversationTurnLease,
  startMs: number,
  attempts: number,
  now: () => number,
): Promise<void> {
  try {
    await args.coordinator.release(lease);
    safeEvent(args.onEvent, {
      name: 'release',
      outcome: 'released',
      wait_ms: elapsedMs(now, startMs),
      attempts,
      duration_ms: elapsedMs(now, startMs),
    });
  } catch {
    safeEvent(args.onEvent, {
      name: 'release',
      outcome: 'error',
      wait_ms: elapsedMs(now, startMs),
      attempts,
      duration_ms: elapsedMs(now, startMs),
    });
  }
}
