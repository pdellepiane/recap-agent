import { describe, expect, it } from 'vitest';
import { parseTurnCoordinationHeaders, runOverlappingTurns } from '../src/evals/concurrent-turns';

describe('live concurrency scheduling', () => {
  it('starts the second turn under the first lock and preserves input ordering', async () => {
    let finishFirst: (value: string) => void = () => undefined;
    let firstRunning = false;
    const result = await runOverlappingTurns({
      first: () => { firstRunning = true; return new Promise<string>((resolve) => { finishFirst = resolve; }); },
      firstLockIsHeld: async () => firstRunning,
      second: async () => { expect(firstRunning).toBe(true); finishFirst('first'); return 'second'; },
    });
    expect(result).toEqual(['first', 'second']);
  });

  it('fails rather than silently substituting a sequential run', async () => {
    let secondCalled = false;
    await expect(runOverlappingTurns({
      first: async () => 'first',
      firstLockIsHeld: async () => false,
      second: async () => { secondCalled = true; return 'second'; },
      pollMs: 1,
    })).rejects.toThrow('did not observe');
    expect(secondCalled).toBe(false);
  });

  it('settles the first turn even when the second fails', async () => {
    let settled = false;
    await expect(runOverlappingTurns({
      first: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); settled = true; return 'first'; },
      firstLockIsHeld: async () => true,
      second: async () => { throw new Error('second failed'); },
    })).rejects.toThrow('second failed');
    expect(settled).toBe(true);
  });

  it('only accepts bounded numeric coordination metadata', () => {
    expect(parseTurnCoordinationHeaders(new Headers({
      'x-recap-turn-wait-ms': '100', 'x-recap-turn-acquire-attempts': '2',
    }))).toEqual({ wait_ms: 100, attempts: 2 });
    for (const value of ['-1', 'secret', 'Infinity', '99999999999999999999']) {
      expect(parseTurnCoordinationHeaders(new Headers({
        'x-recap-turn-wait-ms': value, 'x-recap-turn-acquire-attempts': '2',
      }))).toBeUndefined();
    }
    expect(parseTurnCoordinationHeaders(undefined)).toBeUndefined();
  });
});
