import { describe, expect, it } from 'vitest';

import { markQuotaExhausted } from '../src/evals/runner';
import { runBoundedPipeline, type SchedulerStopReason } from '../src/evals/scheduler';
import { isPermanentQuotaExhaustion } from '../src/runtime/openai-retry';

function quotaError(): unknown {
  return Object.assign(new Error('You exceeded your current quota.'), {
    status: 429,
    code: 'insufficient_quota',
  });
}

describe('permanent quota cascade stop (Finding 4)', () => {
  it('marks quota exhaustion once and leaves unrelated errors unstopped', () => {
    const stopSignal = { stopped: false, reason: null as SchedulerStopReason };
    expect(isPermanentQuotaExhaustion(quotaError())).toBe(true);
    expect(markQuotaExhausted(stopSignal, quotaError())).toBe(true);
    expect(stopSignal).toEqual({ stopped: true, reason: 'quota_exhausted' });

    const secondSignal = { stopped: false, reason: null as SchedulerStopReason };
    expect(markQuotaExhausted(secondSignal, new Error('fetch failed'))).toBe(false);
    expect(secondSignal).toEqual({ stopped: false, reason: null });

    const alreadyStopped = { stopped: true, reason: 'sigint' as SchedulerStopReason };
    expect(markQuotaExhausted(alreadyStopped, quotaError())).toBe(true);
    expect(alreadyStopped).toEqual({ stopped: true, reason: 'sigint' });
  });

  it('stops scheduling new paid work while preserving completed partial results', async () => {
    const stopSignal = { stopped: false, reason: null as SchedulerStopReason };
    const executed: string[] = [];
    const outcome = await runBoundedPipeline<string, string>({
      jobs: [
        {
          index: 0,
          caseId: 'first',
          lane: 'parallel',
          execute: async () => {
            executed.push('first');
            return 'snapshot-first';
          },
          judge: async () => 'result-first',
        },
        {
          index: 1,
          caseId: 'quota',
          lane: 'parallel',
          execute: async () => {
            executed.push('quota');
            return 'snapshot-quota';
          },
          judge: async () => {
            markQuotaExhausted(stopSignal, quotaError());
            throw quotaError();
          },
        },
        {
          index: 2,
          caseId: 'unadmitted',
          lane: 'parallel',
          execute: async () => {
            executed.push('unadmitted');
            return 'snapshot-unadmitted';
          },
          judge: async () => 'result-unadmitted',
        },
      ],
      caseConcurrency: 1,
      judgeConcurrency: 1,
      snapshotCapacity: 8,
      stopSignal,
      drainMs: 5_000,
    });

    expect(outcome.stopReason).toBe('quota_exhausted');
    expect(outcome.results[0]).toEqual({ status: 'ok', value: 'result-first' });
    expect(outcome.results[1]?.status).toBe('error');
    const unadmitted = outcome.results[2];
    expect(unadmitted?.status).toBe('error');
    if (unadmitted?.status === 'error') {
      expect(unadmitted.error).toMatch(/permanent quota exhaustion stopped admissions/i);
      expect(unadmitted.error).toMatch(/no paid work was scheduled/i);
    }
    expect(executed).not.toContain('unadmitted');
    expect(outcome.progress.complete).toBe(true);
    expect(outcome.progress.stopReason).toBe('quota_exhausted');
  });

  it('records quota-stopped admissions as infrastructure errors without semantic verdicts', async () => {
    const stopSignal = { stopped: true, reason: 'quota_exhausted' as SchedulerStopReason };
    const outcome = await runBoundedPipeline<string, string>({
      jobs: [
        {
          index: 0,
          caseId: 'never-admitted',
          lane: 'parallel',
          execute: async () => 'snapshot',
          judge: async () => 'result',
        },
      ],
      caseConcurrency: 1,
      judgeConcurrency: 1,
      stopSignal,
      drainMs: 1_000,
    });
    expect(outcome.results).toHaveLength(1);
    const entry = outcome.results[0];
    expect(entry?.status).toBe('error');
    if (entry?.status === 'error') {
      expect(entry.error).toMatch(/incomplete:/i);
      expect(entry.error).not.toMatch(/score|rubric|semantic/i);
    }
  });
});
