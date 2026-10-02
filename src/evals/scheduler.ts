/**
 * Packet O2 — bounded runner pipeline and durable progress.
 *
 * One coordinator process schedules case jobs through an async bounded
 * worker pool (never unbounded Promise.all). Configurations stay sequential;
 * within a configuration, ready fixture jobs are admitted in manifest order
 * alongside a single external lane. Case workers release their case slot
 * after execution, evidence snapshot, and teardown — before semantic
 * judging. A bounded snapshot queue (at most eight) between execution and
 * judging applies backpressure. The coordinator alone writes progress
 * records and the final aggregate, always in manifest order.
 *
 * Case lifecycle: queued → setup → running → snapshot → teardown →
 * awaiting_judge → finalized. Teardown belongs in a finally block. The
 * scheduler owns admission, ordering, deadline, SIGINT drain, and progress;
 * per-case turn behavior lives in the runner and is unchanged.
 */

export const MAX_CASE_CONCURRENCY = 4;
export const MIN_CASE_CONCURRENCY = 1;
export const MAX_JUDGE_CONCURRENCY = 2;
export const MIN_JUDGE_CONCURRENCY = 1;
export const DEFAULT_CASE_CONCURRENCY = 4;
export const DEFAULT_JUDGE_CONCURRENCY = 2;
/** At most eight completed case snapshots wait for judging (backpressure). */
export const MAX_SNAPSHOT_QUEUE = 8;
/** 60-minute suite coordinator deadline (bounds local orchestration). */
export const SUITE_DEADLINE_MS = 3_600_000;
/** Up to five minutes of bounded drain/cleanup after the deadline. */
export const SUITE_DRAIN_MS = 300_000;
/** Progress records are emitted at most every ten seconds. */
export const PROGRESS_INTERVAL_MS = 10_000;

export type LifecyclePhase =
  | 'queued'
  | 'setup'
  | 'running'
  | 'snapshot'
  | 'teardown'
  | 'awaiting_judge'
  | 'finalized';

export type SchedulerStopReason = 'sigint' | 'deadline' | 'contamination' | 'quota_exhausted' | null;

function parseConcurrency(value: unknown, min: number, max: number, name: string): number {
  const numeric = typeof value === 'string' && value.trim().length > 0
    ? Number(value.trim())
    : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric)) {
    throw new Error(`${name} must be an integer in ${min}..${max}; received ${formatReceived(value)}.`);
  }
  if (numeric < min || numeric > max) {
    throw new Error(`${name} must be in ${min}..${max}; received ${numeric}.`);
  }
  return numeric;
}

function formatReceived(value: unknown): string {
  if (value === undefined) return 'missing';
  if (typeof value === 'string') {
    return value.trim().length === 0 ? 'missing' : JSON.stringify(value).slice(0, 64);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (value === null) return 'null';
  return Array.isArray(value) ? `array[${value.length}]` : 'invalid';
}

/** Strict CLI/option validation: --case-concurrency is an integer 1..4. */
export function parseCaseConcurrency(value: unknown): number {
  return parseConcurrency(value, MIN_CASE_CONCURRENCY, MAX_CASE_CONCURRENCY, 'case-concurrency');
}

/** Strict CLI/option validation: --judge-concurrency is an integer 1..2. */
export function parseJudgeConcurrency(value: unknown): number {
  return parseConcurrency(value, MIN_JUDGE_CONCURRENCY, MAX_JUDGE_CONCURRENCY, 'judge-concurrency');
}

/**
 * Counting semaphore with observed-maximum tracking. The maximum is the
 * admission bound; waiters queue FIFO. Resolved in tests via deferred
 * promises, never wall-clock sleeps.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  private activeCount = 0;
  private maxObserved = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Semaphore capacity must be a positive integer; received ${capacity}.`);
    }
    this.available = capacity;
  }

  get max(): number {
    return this.capacity;
  }

  get active(): number {
    return this.activeCount;
  }

  get observedMax(): number {
    return this.maxObserved;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      this.activeCount += 1;
      this.maxObserved = Math.max(this.maxObserved, this.activeCount);
      return () => this.release();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.activeCount += 1;
    this.maxObserved = Math.max(this.maxObserved, this.activeCount);
    return () => this.release();
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.waiters.shift();
    if (next) {
      // The slot transfers directly to the oldest waiter, which re-marks
      // itself active on wake; the observed maximum stays exact.
      next();
      return;
    }
    this.available += 1;
  }
}

/**
 * Bounded FIFO queue between case execution and judging. Push waits while
 * the queue is full (backpressure); shift resolves the oldest waiter.
 * Close wakes every waiter so a stopped coordinator cannot hang producers.
 */
export class BoundedSnapshotQueue<T> {
  private readonly items: T[] = [];
  private readonly pushWaiters: Array<() => void> = [];
  private readonly shiftWaiters: Array<() => void> = [];
  private closed = false;
  private maxObserved = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Snapshot queue capacity must be a positive integer; received ${capacity}.`);
    }
  }

  get size(): number {
    return this.items.length;
  }

  get observedMax(): number {
    return this.maxObserved;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async push(item: T): Promise<boolean> {
    while (this.items.length >= this.capacity && !this.closed) {
      await new Promise<void>((resolve) => {
        this.pushWaiters.push(resolve);
      });
    }
    if (this.closed) {
      return false;
    }
    this.items.push(item);
    this.maxObserved = Math.max(this.maxObserved, this.items.length);
    const shiftWaiter = this.shiftWaiters.shift();
    if (shiftWaiter) {
      shiftWaiter();
    }
    return true;
  }

  shift(): T | null {
    const item = this.items.shift() ?? null;
    const waiter = this.pushWaiters.shift();
    if (waiter) {
      waiter();
    }
    return item;
  }

  /** Resolves when an item arrives or the queue closes. */
  async waitForItem(): Promise<void> {
    if (this.items.length > 0 || this.closed) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.shiftWaiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
    let waiter = this.pushWaiters.shift();
    while (waiter) {
      waiter();
      waiter = this.pushWaiters.shift();
    }
    let shiftWaiter = this.shiftWaiters.shift();
    while (shiftWaiter) {
      shiftWaiter();
      shiftWaiter = this.shiftWaiters.shift();
    }
  }
}

export type ProgressCounts = {
  queued: number;
  running: number;
  completed: number;
  error: number;
};

export type ProgressSnapshot = ProgressCounts & {
  phase: string;
  elapsedMs: number;
  stopReason: SchedulerStopReason;
  complete: boolean;
};

/**
 * Coordinator-owned progress. Only the coordinator mutates it; workers
 * report transitions. Emission is throttled to PROGRESS_INTERVAL_MS; the
 * coordinator retains a partial snapshot on SIGINT or deadline.
 */
export class ProgressTracker {
  private readonly counts: ProgressCounts;
  private phase = 'queued';
  private lastEmitElapsed: number | null = null;
  readonly startedAtMs: number;

  constructor(totalJobs: number, private readonly now: () => number = Date.now) {
    this.counts = { queued: totalJobs, running: 0, completed: 0, error: 0 };
    this.startedAtMs = this.now();
  }

  setPhase(phase: string): void {
    this.phase = phase;
  }

  admit(): void {
    this.counts.queued = Math.max(0, this.counts.queued - 1);
    this.counts.running += 1;
  }

  complete(): void {
    this.counts.running = Math.max(0, this.counts.running - 1);
    this.counts.completed += 1;
  }

  fail(): void {
    this.counts.running = Math.max(0, this.counts.running - 1);
    this.counts.error += 1;
  }

  /** Jobs never admitted (SIGINT/deadline) stay visible as errors. */
  markUnadmitted(count: number): void {
    this.counts.queued = Math.max(0, this.counts.queued - count);
    this.counts.error += count;
  }

  snapshot(stopReason: SchedulerStopReason = null): ProgressSnapshot {
    return {
      ...this.counts,
      phase: this.phase,
      elapsedMs: this.now() - this.startedAtMs,
      stopReason,
      complete: this.counts.queued === 0 && this.counts.running === 0,
    };
  }

  shouldEmit(): boolean {
    const elapsed = this.now() - this.startedAtMs;
    if (this.lastEmitElapsed === null || elapsed - this.lastEmitElapsed >= PROGRESS_INTERVAL_MS) {
      this.lastEmitElapsed = elapsed;
      return true;
    }
    return false;
  }
}

export type ScheduledJob<Snapshot, Result> = {
  /** Manifest-order index; results are assembled by it, never by finish order. */
  index: number;
  caseId: string;
  lane: 'parallel' | 'external';
  /**
   * Setup → running → snapshot → teardown. Turns inside stay sequential;
   * teardown must be attempted in a finally block. Throws propagate as a
   * per-case error; the pipeline continues with remaining jobs unless the
   * coordinator stopped admissions.
   */
  execute: (hooks: {
    setPhase: (phase: LifecyclePhase) => void;
    signal: AbortSignal | null;
  }) => Promise<Snapshot>;
  /** awaiting_judge → finalized. Runs under the judge semaphore. */
  judge: (snapshot: Snapshot, hooks: {
    signal: AbortSignal | null;
  }) => Promise<Result>;
  onTeardownError?: (error: Error) => void;
};

export type PipelineOutcome<Result> = {
  /** Manifest order, including per-case errors for unadmitted jobs. */
  results: Array<{ status: 'ok'; value: Result } | { status: 'error'; error: string }>;
  stopReason: SchedulerStopReason;
  progress: ProgressSnapshot;
  observedMaxCases: number;
  observedMaxExternal: number;
  observedMaxJudges: number;
  observedMaxSnapshots: number;
};

/** Fired exactly once per settled job, in completion order. */
export type JobSettledEvent<Result> = {
  jobIndex: number;
  caseId: string;
  /** False only when the case never executed (unadmitted before any paid work). */
  executed: boolean;
  outcome: { status: 'ok'; value: Result } | { status: 'error'; error: string };
};

/**
 * Bounded two-stage pipeline. Case slots (max N) cover execute; the case
 * slot and external lane are released before judging; judge slots (max M)
 * cover judge. Snapshots flow through a bounded queue (max eight) so fast
 * executors cannot grow memory without bound. Admissions stop on SIGINT,
 * deadline, or contamination; in-flight work drains within the drain
 * budget while teardown still runs.
 */
export async function runBoundedPipeline<Snapshot, Result>(args: {
  jobs: Array<ScheduledJob<Snapshot, Result>>;
  caseConcurrency: number;
  judgeConcurrency: number;
  snapshotCapacity?: number;
  signal?: AbortSignal | null;
  requestStop?: (reason: Exclude<SchedulerStopReason, null>) => void;
  stopSignal?: { stopped: boolean; reason: SchedulerStopReason };
  drainMs?: number;
  onProgress?: (snapshot: ProgressSnapshot) => void;
  onJobSettled?: (event: JobSettledEvent<Result>) => void;
  now?: () => number;
}): Promise<PipelineOutcome<Result>> {
  const caseConcurrency = parseCaseConcurrency(args.caseConcurrency);
  const judgeConcurrency = parseJudgeConcurrency(args.judgeConcurrency);
  const snapshotCapacity = args.snapshotCapacity ?? MAX_SNAPSHOT_QUEUE;
  const now = args.now ?? Date.now;
  const jobs = [...args.jobs].sort((left, right) => left.index - right.index);
  const tracker = new ProgressTracker(jobs.length, now);
  const caseSlots = new Semaphore(caseConcurrency);
  const externalLane = new Semaphore(1);
  const judgeSlots = new Semaphore(judgeConcurrency);
  const snapshots = new BoundedSnapshotQueue<{ index: number; snapshot: Snapshot }>(snapshotCapacity);
  const outcomes = new Map<number, { status: 'ok'; value: Result } | { status: 'error'; error: string }>();
  const settleJob = (
    index: number,
    outcome: { status: 'ok'; value: Result } | { status: 'error'; error: string },
    executed: boolean,
  ): void => {
    if (outcomes.has(index)) {
      return;
    }
    outcomes.set(index, outcome);
    const job = jobs.find((candidate) => candidate.index === index);
    args.onJobSettled?.({
      jobIndex: index,
      caseId: job?.caseId ?? `job-${index}`,
      executed,
      outcome,
    });
  };
  const stopState = args.stopSignal ?? { stopped: false, reason: null as SchedulerStopReason };
  let externalActive = 0;
  let observedMaxExternal = 0;

  const emit = (): void => {
    if (args.onProgress && (tracker.shouldEmit() || tracker.snapshot(stopState.reason).complete)) {
      args.onProgress(tracker.snapshot(stopState.reason));
    }
  };

  const aborted = (): boolean =>
    stopState.stopped || (args.signal?.aborted ?? false);

  const unadmittedError = (): string => {
    if (stopState.reason === 'deadline') {
      return 'incomplete: suite deadline stopped admissions before this case started';
    }
    if (stopState.reason === 'sigint') {
      return 'incomplete: SIGINT stopped admissions before this case started';
    }
    if (stopState.reason === 'quota_exhausted') {
      return 'incomplete: permanent quota exhaustion stopped admissions before this case started; no paid work was scheduled';
    }
    return 'incomplete: admissions stopped before this case started';
  };

  const markRemainingUnadmitted = (fromCursor: number): void => {
    let unadmitted = 0;
    for (const job of jobs) {
      if (job.index >= fromCursor && !outcomes.has(job.index)) {
        settleJob(job.index, { status: 'error', error: unadmittedError() }, false);
        unadmitted += 1;
      }
    }
    if (unadmitted > 0) {
      tracker.markUnadmitted(unadmitted);
    }
  };

  const recordUnadmitted = (job: ScheduledJob<Snapshot, Result>): void => {
    if (outcomes.has(job.index)) {
      return;
    }
    settleJob(job.index, { status: 'error', error: unadmittedError() }, false);
    tracker.markUnadmitted(1);
  };

  async function executeJob(job: ScheduledJob<Snapshot, Result>): Promise<void> {
    const releaseCase = await caseSlots.acquire();
    if (aborted()) {
      releaseCase();
      recordUnadmitted(job);
      return;
    }
    let releaseExternal: (() => void) | null = null;
    if (job.lane === 'external') {
      releaseExternal = await externalLane.acquire();
      externalActive += 1;
      observedMaxExternal = Math.max(observedMaxExternal, externalActive);
      if (aborted()) {
        externalActive -= 1;
        releaseExternal();
        releaseCase();
        recordUnadmitted(job);
        return;
      }
    }
    tracker.admit();
    tracker.setPhase('running');
    emit();
    try {
      const snapshot = await job.execute({
        setPhase: (phase) => {
          tracker.setPhase(phase);
          emit();
        },
        signal: args.signal ?? null,
      });
      tracker.setPhase('awaiting_judge');
      const pushed = await snapshots.push({ index: job.index, snapshot });
      if (!pushed) {
        // Queue closed under a stop: the snapshot cannot be judged in this
        // run. A successfully pushed snapshot still drains through judging;
        // only a refused push is recorded here explicitly.
        if (!outcomes.has(job.index)) {
          settleJob(job.index, {
            status: 'error',
            error: 'incomplete: execution finished but judging was stopped before finalization',
          }, true);
          tracker.fail();
        }
      }
    } catch (error) {
      if (!outcomes.has(job.index)) {
        settleJob(job.index, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }, true);
        tracker.fail();
      }
    } finally {
      if (job.lane === 'external') {
        externalActive = Math.max(0, externalActive - 1);
      }
      if (releaseExternal) {
        releaseExternal();
      }
      // The case slot is released after snapshot + teardown, before judging.
      releaseCase();
      emit();
    }
  }

  async function judgeOne(entry: { index: number; snapshot: Snapshot }): Promise<void> {
    const job = jobs.find((candidate) => candidate.index === entry.index);
    if (!job || outcomes.has(job.index)) {
      return;
    }
    const releaseJudge = await judgeSlots.acquire();
    try {
      const value = await job.judge(entry.snapshot, { signal: args.signal ?? null });
      if (!outcomes.has(job.index)) {
        settleJob(job.index, { status: 'ok', value }, true);
        tracker.complete();
      }
    } catch (error) {
      if (!outcomes.has(job.index)) {
        settleJob(job.index, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }, true);
        tracker.fail();
      }
    } finally {
      releaseJudge();
      emit();
    }
  }

  // Admit in manifest order. Executors run concurrently up to the case
  // bound; the judge loop above drains the snapshot queue as entries arrive.
  const inFlight = new Set<Promise<void>>();
  let cursor = 0;

  // Event-driven judge drain, started before admissions so snapshot
  // producers never block on a full queue with nobody draining. Judge
  // requests run under the shared judge semaphore (at most M in flight);
  // result assembly stays in manifest order via the outcome map.
  const judgeInFlight = new Set<Promise<void>>();
  const judgeLoop = (async (): Promise<void> => {
    for (;;) {
      const entry = snapshots.shift();
      if (entry) {
        const task = judgeOne(entry);
        judgeInFlight.add(task);
        const forget = (): void => {
          judgeInFlight.delete(task);
        };
        void task.then(forget, forget);
        continue;
      }
      if (inFlight.size === 0 && snapshots.isClosed) {
        break;
      }
      await snapshots.waitForItem();
    }
    if (judgeInFlight.size > 0) {
      await Promise.allSettled([...judgeInFlight]);
    }
  })();

  while (cursor < jobs.length && !aborted()) {
    const job = jobs[cursor];
    if (!job) {
      cursor += 1;
      continue;
    }
    if (outcomes.has(job.index)) {
      cursor += 1;
      continue;
    }
    const task = executeJob(job);
    inFlight.add(task);
    const forget = (): void => {
      inFlight.delete(task);
    };
    void task.then(forget, forget);
    cursor += 1;
    // Bound admissions to the case slots: do not launch unbounded tasks.
    // Backpressure via the live in-flight set keeps at most caseConcurrency
    // executors plus queued microtasks; the semaphore is the hard bound.
    while (inFlight.size >= caseConcurrency + snapshotCapacity && !aborted()) {
      await Promise.race([...inFlight]);
    }
  }
  if (aborted()) {
    markRemainingUnadmitted(cursor);
  }
  const drainMs = args.drainMs ?? SUITE_DRAIN_MS;
  if (inFlight.size > 0) {
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, drainMs));
        if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
          timer.unref();
        }
      }),
    ]);
    await Promise.allSettled([...inFlight]);
  }
  snapshots.close();
  await judgeLoop;
  // Any snapshot that arrived after the stop still needs a terminal state.
  let leftover = snapshots.shift();
  while (leftover) {
    if (!outcomes.has(leftover.index)) {
      settleJob(leftover.index, {
        status: 'error',
        error: 'incomplete: execution finished but judging was stopped before finalization',
      }, true);
      tracker.fail();
    }
    leftover = snapshots.shift();
  }

  const results = jobs.map((job) => outcomes.get(job.index) ?? {
    status: 'error' as const,
    error: 'incomplete: no outcome recorded for this case',
  });
  const progress = tracker.snapshot(stopState.reason);
  if (args.onProgress) {
    args.onProgress(progress);
  }
  return {
    results,
    stopReason: stopState.reason,
    progress,
    observedMaxCases: caseSlots.observedMax,
    observedMaxExternal,
    observedMaxJudges: judgeSlots.observedMax,
    observedMaxSnapshots: snapshots.observedMax,
  };
}

/**
 * Lifecycle helper enforcing teardown-in-finally for one case. The runner
 * passes its existing setup/execute/snapshot/teardown closures; turn
 * behavior inside body is untouched.
 */
export async function runLifecycleStages<Snapshot>(args: {
  setup: () => Promise<void>;
  body: (hooks: { setPhase: (phase: LifecyclePhase) => void }) => Promise<Snapshot>;
  teardown: () => Promise<void>;
  onTeardownError?: (error: Error) => void;
  setPhase?: (phase: LifecyclePhase) => void;
}): Promise<{ snapshot: Snapshot }> {
  const setPhase = args.setPhase ?? ((): void => {});
  setPhase('setup');
  await args.setup();
  const bodyPromise = (async (): Promise<Snapshot> => {
    setPhase('running');
    const snapshot = await args.body({ setPhase });
    setPhase('snapshot');
    return snapshot;
  })();
  // Settle the body first so teardown always runs, even after a body
  // failure; throwing stays outside any finally block.
  const settled = await bodyPromise.then(
    (value): { ok: true; value: Snapshot } => ({ ok: true, value }),
    (error: unknown): { ok: false; error: unknown } => ({ ok: false, error }),
  );
  setPhase('teardown');
  try {
    await args.teardown();
  } catch (error) {
    const teardownError = error instanceof Error ? error : new Error(String(error));
    args.onTeardownError?.(teardownError);
    throw teardownError;
  }
  if (!settled.ok) {
    throw settled.error;
  }
  setPhase('awaiting_judge');
  return { snapshot: settled.value };
}

/** Atomic JSON write (temp file + rename) for per-case public artifacts. */
export async function writeAtomicJson(filePath: string, data: unknown): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const { default: crypto } = await import('node:crypto');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}
