import { describe, expect, it } from 'vitest';

import {
  BoundedSnapshotQueue,
  DEFAULT_CASE_CONCURRENCY,
  DEFAULT_JUDGE_CONCURRENCY,
  MAX_SNAPSHOT_QUEUE,
  parseCaseConcurrency,
  parseJudgeConcurrency,
  ProgressTracker,
  runBoundedPipeline,
  runLifecycleStages,
  Semaphore,
  writeAtomicJson,
  type LifecyclePhase,
  type ScheduledJob,
  type SchedulerStopReason,
} from '../src/evals/scheduler';
import { sortResultsInManifestOrder } from '../src/evals/reporting';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stringJob(
  index: number,
  lane: 'parallel' | 'external',
  execute: (hooks: { setPhase: (phase: LifecyclePhase) => void; signal: AbortSignal | null }) => Promise<string>,
  judge: (snapshot: string) => Promise<string> = async (snapshot) => `final:${snapshot}`,
): ScheduledJob<string, string> {
  return { index, caseId: `case-${index}`, lane, execute, judge };
}

describe('eval scheduler concurrency bounds', () => {
  it('parses strict CLI concurrency with deterministic defaults', () => {
    expect(() => parseCaseConcurrency(undefined)).toThrow(/missing/);
    expect(parseCaseConcurrency('4')).toBe(4);
    expect(parseCaseConcurrency(1)).toBe(1);
    expect(() => parseCaseConcurrency(0)).toThrow(/1\.\.4/);
    expect(() => parseCaseConcurrency(5)).toThrow(/1\.\.4/);
    expect(() => parseCaseConcurrency('two')).toThrow(/integer/);
    expect(() => parseCaseConcurrency(2.5)).toThrow(/integer/);
    expect(parseJudgeConcurrency('2')).toBe(2);
    expect(() => parseJudgeConcurrency(0)).toThrow(/1\.\.2/);
    expect(() => parseJudgeConcurrency(3)).toThrow(/1\.\.2/);
    expect(DEFAULT_CASE_CONCURRENCY).toBe(4);
    expect(DEFAULT_JUDGE_CONCURRENCY).toBe(2);
    expect(MAX_SNAPSHOT_QUEUE).toBe(8);
  });

  it('bounds case, external-lane, and judge concurrency with order retained', async () => {
    {
      let active = 0;
      let maxActive = 0;
      const gates = Array.from({ length: 6 }, () => deferred<void>());
      const jobs = gates.map((gate, index) =>
        stringJob(index, 'parallel', async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gate.promise;
          active -= 1;
          return `snapshot-${index}`;
        }),
      );
      const outcomePromise = runBoundedPipeline({
        jobs,
        caseConcurrency: 4,
        judgeConcurrency: 2,
        drainMs: 1000,
      });
      // Let admissions settle without wall-clock sleeps: flush microtasks.
      await Promise.resolve();
      await Promise.resolve();
      expect(maxActive).toBeLessThanOrEqual(4);
      // Overlapping completion in reverse manifest order.
      for (let index = gates.length - 1; index >= 0; index -= 1) {
        gates[index]?.resolve();
        await Promise.resolve();
      }
      const outcome = await outcomePromise;
      expect(outcome.observedMaxCases).toBeLessThanOrEqual(4);
      expect(outcome.observedMaxCases).toBeGreaterThan(1);
      expect(outcome.results.map((result, index) =>
        result.status === 'ok' ? result.value : `error-${index}`,
      )).toEqual([
        'final:snapshot-0',
        'final:snapshot-1',
        'final:snapshot-2',
        'final:snapshot-3',
        'final:snapshot-4',
        'final:snapshot-5',
      ]);
      expect(outcome.stopReason).toBeNull();
    }

    {
      let externalActive = 0;
      let maxExternal = 0;
      let totalActive = 0;
      let maxTotal = 0;
      const gates = Array.from({ length: 5 }, () => deferred<void>());
      const lanes: Array<'parallel' | 'external'> = ['parallel', 'external', 'parallel', 'external', 'parallel'];
      const jobs = gates.map((gate, index) =>
        stringJob(index, lanes[index], async () => {
          totalActive += 1;
          maxTotal = Math.max(maxTotal, totalActive);
          if (lanes[index] === 'external') {
            externalActive += 1;
            maxExternal = Math.max(maxExternal, externalActive);
          }
          await gate.promise;
          if (lanes[index] === 'external') {
            externalActive -= 1;
          }
          totalActive -= 1;
          return `snapshot-${index}`;
        }),
      );
      const outcomePromise = runBoundedPipeline({
        jobs,
        caseConcurrency: 4,
        judgeConcurrency: 2,
        drainMs: 1000,
      });
      await Promise.resolve();
      await Promise.resolve();
      for (const gate of gates) {
        gate.resolve();
      }
      const outcome = await outcomePromise;
      expect(maxExternal).toBe(1);
      expect(outcome.observedMaxExternal).toBe(1);
      expect(maxTotal).toBeLessThanOrEqual(4);
      expect(outcome.results.every((result) => result.status === 'ok')).toBe(true);
    }

    {
      let judgeActive = 0;
      let maxJudge = 0;
      const release = deferred<void>();
      const jobs = Array.from({ length: 5 }, (_, index) =>
        stringJob(index, 'parallel', async () => `snapshot-${index}`, async (snapshot) => {
          judgeActive += 1;
          maxJudge = Math.max(maxJudge, judgeActive);
          await release.promise;
          judgeActive -= 1;
          return `final:${snapshot}`;
        }),
      );
      const outcomePromise = runBoundedPipeline({
        jobs,
        caseConcurrency: 4,
        judgeConcurrency: 2,
        drainMs: 1000,
      });
      // Wait until both judge slots are occupied (event-driven, no sleeps).
      for (let spin = 0; spin < 1000 && maxJudge < 2; spin += 1) {
        await Promise.resolve();
      }
      expect(maxJudge).toBe(2);
      release.resolve();
      const outcome = await outcomePromise;
      expect(outcome.observedMaxJudges).toBe(2);
      expect(outcome.results.map((result) =>
        result.status === 'ok' ? result.value : 'error',
      )).toEqual([
        'final:snapshot-0',
        'final:snapshot-1',
        'final:snapshot-2',
        'final:snapshot-3',
        'final:snapshot-4',
      ]);
    }
  });

  it('applies snapshot-queue backpressure and releases case slots before judging', async () => {
    const events: string[] = [];
    const judgeGate = deferred<void>();
    const jobs = [0, 1, 2].map((index) =>
      stringJob(index, 'parallel', async () => {
        events.push(`execute-done-${index}`);
        return `snapshot-${index}`;
      }, async (snapshot) => {
        events.push(`judge-start-${snapshot}`);
        await judgeGate.promise;
        return `final:${snapshot}`;
      }),
    );
    const outcomePromise = runBoundedPipeline({
      jobs,
      caseConcurrency: 3,
      judgeConcurrency: 1,
      snapshotCapacity: 1,
      drainMs: 1000,
    });
    // With capacity 1 and a blocked judge, producers queue behind the
    // snapshot bound instead of growing memory without bound.
    for (let spin = 0; spin < 1000 && events.filter((event) => event.startsWith('execute-done')).length < 3; spin += 1) {
      await Promise.resolve();
    }
    judgeGate.resolve();
    const outcome = await outcomePromise;
    expect(outcome.observedMaxSnapshots).toBeLessThanOrEqual(1);
    expect(outcome.results.every((result) => result.status === 'ok')).toBe(true);
    // Every execution finished before its judge started (slot released
    // after snapshot, judging drains the bounded queue).
    for (const index of [0, 1, 2]) {
      const doneAt = events.indexOf(`execute-done-${index}`);
      const judgeAt = events.indexOf(`judge-start-snapshot-${index}`);
      expect(doneAt).toBeGreaterThanOrEqual(0);
      expect(judgeAt).toBeGreaterThan(doneAt);
    }
  });
});

describe('eval scheduler lifecycle and cleanup', () => {
  it('keeps normal turns sequential inside one execution', async () => {
    const events: string[] = [];
    const turn = (name: string): Promise<void> => {
      events.push(`start-${name}`);
      events.push(`end-${name}`);
      return Promise.resolve();
    };
    const outcome = await runBoundedPipeline({
      jobs: [stringJob(0, 'parallel', async () => {
        await turn('t0');
        await turn('t1');
        await turn('t2');
        return 'snapshot-0';
      })],
      caseConcurrency: 4,
      judgeConcurrency: 2,
      drainMs: 1000,
    });
    expect(events).toEqual(['start-t0', 'end-t0', 'start-t1', 'end-t1', 'start-t2', 'end-t2']);
    expect(outcome.results[0]).toEqual({ status: 'ok', value: 'final:snapshot-0' });
  });

  it('records per-case errors and continues remaining jobs', async () => {
    const outcome = await runBoundedPipeline({
      jobs: [
        stringJob(0, 'parallel', async () => {
          throw new Error('setup blew up');
        }),
        stringJob(1, 'parallel', async () => 'snapshot-1', async () => {
          throw new Error('judge blew up');
        }),
        stringJob(2, 'parallel', async () => 'snapshot-2'),
      ],
      caseConcurrency: 4,
      judgeConcurrency: 2,
      drainMs: 1000,
    });
    expect(outcome.results[0]).toEqual({ status: 'error', error: 'setup blew up' });
    expect(outcome.results[1]).toEqual({ status: 'error', error: 'judge blew up' });
    expect(outcome.results[2]).toEqual({ status: 'ok', value: 'final:snapshot-2' });
    expect(outcome.progress.completed).toBe(1);
    expect(outcome.progress.error).toBe(2);
  });

  it('runs teardown in finally via runLifecycleStages', async () => {
    const phases: LifecyclePhase[] = [];
    let tornDown = 0;
    await expect(runLifecycleStages({
      setup: async () => undefined,
      body: async () => {
        throw new Error('body failed');
      },
      teardown: async () => {
        tornDown += 1;
      },
      setPhase: (phase) => {
        phases.push(phase);
      },
    })).rejects.toThrow('body failed');
    expect(tornDown).toBe(1);
    // A failed body never reaches the snapshot phase, but teardown still
    // runs in finally.
    expect(phases).toEqual(['setup', 'running', 'teardown']);

    const successPhases: LifecyclePhase[] = [];
    await runLifecycleStages({
      setup: async () => undefined,
      body: async () => 'snapshot',
      teardown: async () => undefined,
      setPhase: (phase) => {
        successPhases.push(phase);
      },
    });
    expect(successPhases).toEqual(['setup', 'running', 'snapshot', 'teardown', 'awaiting_judge']);

    let setupTornDown = 0;
    await expect(runLifecycleStages({
      setup: async () => {
        throw new Error('setup failed');
      },
      body: async () => 'never',
      teardown: async () => {
        setupTornDown += 1;
      },
    })).rejects.toThrow('setup failed');
    expect(setupTornDown).toBe(0);
  });

  it('stops admissions on SIGINT, pre-stop, and deadline without hanging work', async () => {
    {
      const stopSignal = { stopped: false, reason: null as SchedulerStopReason };
      let teardownAttempts = 0;
      const outcome = await runBoundedPipeline({
        jobs: [
          stringJob(0, 'parallel', async () => {
            try {
              // SIGINT lands while this case runs: admissions stop, this
              // execution still finishes, teardown is still attempted.
              stopSignal.stopped = true;
              stopSignal.reason = 'sigint';
              return 'snapshot-0';
            } finally {
              teardownAttempts += 1;
            }
          }),
          stringJob(1, 'parallel', async () => 'snapshot-1'),
          stringJob(2, 'parallel', async () => 'snapshot-2'),
        ],
        caseConcurrency: 1,
        judgeConcurrency: 1,
        drainMs: 1000,
        stopSignal,
      });
      expect(outcome.stopReason).toBe('sigint');
      expect(teardownAttempts).toBe(1);
      expect(outcome.results[0]).toEqual({ status: 'ok', value: 'final:snapshot-0' });
      expect(outcome.results[1]).toEqual({
        status: 'error',
        error: 'incomplete: SIGINT stopped admissions before this case started',
      });
      expect(outcome.results[2]).toEqual({
        status: 'error',
        error: 'incomplete: SIGINT stopped admissions before this case started',
      });
    }

    {
      const stopSignal = { stopped: true, reason: 'sigint' as SchedulerStopReason };
      const outcome = await runBoundedPipeline({
        jobs: [
          stringJob(0, 'parallel', async () => 'snapshot-0'),
          stringJob(1, 'parallel', async () => 'snapshot-1'),
        ],
        caseConcurrency: 4,
        judgeConcurrency: 2,
        drainMs: 1000,
        stopSignal,
      });
      expect(outcome.stopReason).toBe('sigint');
      expect(outcome.results).toEqual([
        { status: 'error', error: 'incomplete: SIGINT stopped admissions before this case started' },
        { status: 'error', error: 'incomplete: SIGINT stopped admissions before this case started' },
      ]);
    }

    {
      const stopSignal = { stopped: true, reason: 'deadline' as SchedulerStopReason };
      const outcome = await runBoundedPipeline({
        jobs: [stringJob(0, 'parallel', async () => 'snapshot-0')],
        caseConcurrency: 4,
        judgeConcurrency: 2,
        drainMs: 100,
        stopSignal,
      });
      expect(outcome.stopReason).toBe('deadline');
      expect(outcome.results).toEqual([
        { status: 'error', error: 'incomplete: suite deadline stopped admissions before this case started' },
      ]);
    }
  });

});

describe('eval scheduler primitives', () => {
  it('bounds semaphore admissions FIFO with observed maximum', async () => {
    const semaphore = new Semaphore(2);
    const order: string[] = [];
    const first = await semaphore.acquire();
    const second = await semaphore.acquire();
    const holder: { release: (() => void) | null } = { release: null };
    const third = semaphore.acquire().then((release) => {
      holder.release = release;
    });
    order.push('acquired-two');
    first();
    await third;
    expect(holder.release).not.toBeNull();
    order.push('third-admitted');
    second();
    holder.release?.();
    expect(semaphore.active).toBe(0);
    expect(semaphore.observedMax).toBe(2);
    expect(order).toEqual(['acquired-two', 'third-admitted']);
  });

  it('blocks snapshot pushes past capacity until a shift drains', async () => {
    const queue = new BoundedSnapshotQueue<string>(2);
    expect(await queue.push('a')).toBe(true);
    expect(await queue.push('b')).toBe(true);
    expect(queue.observedMax).toBe(2);
    let thirdPushed = false;
    const third = queue.push('c').then((ok) => {
      thirdPushed = ok;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(thirdPushed).toBe(false);
    expect(queue.shift()).toBe('a');
    await third;
    expect(thirdPushed).toBe(true);
    queue.close();
    expect(await queue.push('d')).toBe(false);
  });

  it('throttles progress emission to at most every ten seconds', () => {
    let nowMs = 1000;
    const tracker = new ProgressTracker(3, () => nowMs);
    expect(tracker.shouldEmit()).toBe(true);
    expect(tracker.shouldEmit()).toBe(false);
    nowMs += 9999;
    expect(tracker.shouldEmit()).toBe(false);
    nowMs += 1;
    expect(tracker.shouldEmit()).toBe(true);
    tracker.admit();
    tracker.complete();
    tracker.fail();
    const snapshot = tracker.snapshot('sigint');
    expect(snapshot).toMatchObject({
      queued: 2,
      running: 0,
      completed: 1,
      error: 1,
      stopReason: 'sigint',
    });
  });

  it('sorts results into manifest order with unknown cases last', () => {
    const results = [
      { caseId: 'c', value: 3 },
      { caseId: 'unknown', value: 0 },
      { caseId: 'a', value: 1 },
      { caseId: 'b', value: 2 },
    ];
    expect(sortResultsInManifestOrder(results, ['a', 'b', 'c']).map((entry) => entry.caseId))
      .toEqual(['a', 'b', 'c', 'unknown']);
  });

  it('writes atomic JSON artifacts', async () => {
    const { default: os } = await import('node:os');
    const { default: path } = await import('node:path');
    const { default: fs } = await import('node:fs/promises');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-atomic-'));
    const filePath = path.join(dir, 'case.json');
    await writeAtomicJson(filePath, { caseId: 'case-0', status: 'passed' });
    const raw = await fs.readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual({ caseId: 'case-0', status: 'passed' });
    const leftovers = (await fs.readdir(dir)).filter((entry) => entry.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('eval scheduler settle hook', () => {
  it('fires the settle hook once per job with execution outcome', async () => {
    {
      const events: Array<{ jobIndex: number; caseId: string; executed: boolean; status: string }> = [];
      const jobs = [
        stringJob(0, 'parallel', async () => 'snapshot-0'),
        stringJob(1, 'parallel', async () => { throw new Error('boom-execute'); }),
        stringJob(2, 'parallel', async () => 'snapshot-2', async () => { throw new Error('boom-judge'); }),
      ];
      const outcome = await runBoundedPipeline({
        jobs,
        caseConcurrency: 4,
        judgeConcurrency: 2,
        drainMs: 1000,
        onJobSettled: (event) => {
          events.push({
            jobIndex: event.jobIndex,
            caseId: event.caseId,
            executed: event.executed,
            status: event.outcome.status,
          });
        },
      });
      expect(outcome.results.map((result) => result.status)).toEqual(['ok', 'error', 'error']);
      expect(events).toHaveLength(3);
      expect(events.map((event) => event.jobIndex).sort()).toEqual([0, 1, 2]);
      expect(events.every((event) => event.executed)).toBe(true);
      expect(events.find((event) => event.jobIndex === 0))
        .toMatchObject({ caseId: 'case-0', status: 'ok' });
    }

    {
      const events: Array<{ jobIndex: number; executed: boolean }> = [];
      const outcome = await runBoundedPipeline({
        jobs: [stringJob(0, 'parallel', async () => 'snapshot-0')],
        caseConcurrency: 1,
        judgeConcurrency: 1,
        drainMs: 1000,
        stopSignal: { stopped: true, reason: 'sigint' },
        onJobSettled: (event) => {
          events.push({ jobIndex: event.jobIndex, executed: event.executed });
        },
      });
      expect(outcome.results[0]?.status).toBe('error');
      expect(events).toEqual([{ jobIndex: 0, executed: false }]);
    }
  });

});
