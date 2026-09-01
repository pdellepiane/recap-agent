import { describe, expect, it, vi } from 'vitest';

import { conversationPartitionKey } from '../src/storage/conversation-key';
import { DynamoConversationTurnCoordinator } from '../src/storage/dynamo-conversation-turn-coordinator';
import { DynamoPlanStore } from '../src/storage/dynamo-plan-store';
import {
  type ConversationTurnCoordinator,
  ConversationTurnBusyError,
  ConversationTurnUnavailableError,
  runWithConversationTurnLease,
} from '../src/storage/conversation-turn-coordinator';
import { InMemoryConversationTurnCoordinator } from '../src/storage/in-memory-conversation-turn-coordinator';

const identity = { channel: 'whatsapp', externalUserId: '+51999999999' };

function lease(ownerId: string, expiresAtMs = 2_000) {
  return { ...identity, ownerId, expiresAtMs };
}

describe('conversation turn coordination', () => {
  it('still makes one immediate attempt when a zero-wait call crosses a clock tick', async () => {
    let time = 1_000;
    const coordinator = { acquire: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(undefined) };
    await expect(runWithConversationTurnLease({
      coordinator, identity, hardDeadlineMs: 10_000, waitMs: 0,
      executionReserveMs: 100, expirySafetyMs: 1_000, pollMs: 10,
      operation: async () => 'ok', now: () => time++,
    })).resolves.toBe('ok');
    expect(coordinator.acquire).toHaveBeenCalledOnce();
  });

  it('uses the exact shared opaque partition key', () => {
    expect(conversationPartitionKey('whatsapp', '+51999999999')).toBe('whatsapp#+51999999999');
    expect(conversationPartitionKey('webchat', '+51999999999')).toBe('webchat#+51999999999');
  });

  it('serializes one identity while allowing another identity', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    expect(await coordinator.acquire(lease('one'), 1_000)).toBe(true);
    expect(await coordinator.acquire(lease('two'), 1_000)).toBe(false);
    expect(await coordinator.acquire({ ...lease('other-user'), externalUserId: 'different' }, 1_000)).toBe(true);
    expect(await coordinator.acquire({ ...lease('other-channel'), channel: 'webchat' }, 1_000)).toBe(true);
  });

  it('only releases its own lock and recovers expired locks', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    await coordinator.acquire(lease('one', 1_100), 1_000);
    await coordinator.release(lease('two', 1_100));
    expect(await coordinator.acquire(lease('two', 3_000), 1_100)).toBe(true);
    await coordinator.release(lease('one', 1_100));
    expect(await coordinator.acquire(lease('three'), 1_101)).toBe(false);
    await coordinator.release(lease('two', 3_000));
    expect(await coordinator.acquire(lease('three'), 1_101)).toBe(true);
  });

  it('releases after successful and failed operations', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    const operation = vi.fn().mockResolvedValue('ok');
    await expect(runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation,
      now: () => 1_000,
      ownerId: 'one',
    })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledOnce();
    expect(await coordinator.acquire(lease('two'), 1_001)).toBe(true);

    await expect(runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => { throw new Error('operation failed'); },
      now: () => 2_000,
      ownerId: 'three',
    })).rejects.toThrow('operation failed');
    expect(await coordinator.acquire(lease('four'), 2_001)).toBe(true);
  });

  it('fails closed on acquisition errors and does not run the operation when busy', async () => {
    const unavailable: ConversationTurnCoordinator = {
      acquire: async () => { throw new Error('network'); },
      release: async () => undefined,
    };
    const operation = vi.fn().mockResolvedValue('should not run');
    await expect(runWithConversationTurnLease({
      coordinator: unavailable,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation,
      now: () => 1_000,
      ownerId: 'one',
    })).rejects.toBeInstanceOf(ConversationTurnUnavailableError);
    expect(operation).not.toHaveBeenCalled();

    const held = new InMemoryConversationTurnCoordinator();
    await held.acquire(lease('holder', 20_000), 1_000);
    await expect(runWithConversationTurnLease({
      coordinator: held,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation,
      now: () => 1_001,
      ownerId: 'one',
    })).rejects.toBeInstanceOf(ConversationTurnBusyError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('does not release until a delayed operation settles', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    let settle: (() => void) | undefined;
    const operation = new Promise<string>((resolve) => { settle = () => resolve('done'); });
    const running = runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => await operation,
      now: () => 1_000,
      ownerId: 'one',
    });
    await Promise.resolve();
    expect(await coordinator.acquire(lease('two'), 1_001)).toBe(false);
    settle?.();
    await expect(running).resolves.toBe('done');
    expect(await coordinator.acquire(lease('two'), 1_001)).toBe(true);
  });

  it('conflicts for concurrent turns with the same identity but not another user', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    let finishFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const first = runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => await new Promise<string>((resolve) => {
        firstStarted?.();
        finishFirst = () => resolve('first');
      }),
      now: () => 1_000,
      ownerId: 'first',
    });
    await started;
    await expect(runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => 'same-user',
      now: () => 1_001,
      ownerId: 'second',
    })).rejects.toBeInstanceOf(ConversationTurnBusyError);
    await expect(runWithConversationTurnLease({
      coordinator,
      identity: { ...identity, externalUserId: 'other-user' },
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => 'other-user',
      now: () => 1_001,
      ownerId: 'other',
    })).resolves.toBe('other-user');
    finishFirst?.();
    await expect(first).resolves.toBe('first');
  });

  it('waits through bounded polls, then observes state written by the released holder', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    const holder = lease('holder', 20_000);
    await coordinator.acquire(holder, 1_000);
    let clock = 1_000;
    let polls = 0;
    let sharedState = 'old';
    const result = await runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 100,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => sharedState,
      now: () => clock,
      random: () => 1,
      sleep: async (ms) => {
        clock += ms;
        polls += 1;
        if (polls === 2) {
          sharedState = 'new';
          await coordinator.release(holder);
        }
      },
      ownerId: 'waiter',
    });
    expect(result).toBe('new');
    expect(polls).toBe(2);
  });

  it('stops exhausted retries at the wait bound with no sleep over one minute', async () => {
    const sleeps: number[] = [];
    let clock = 1_000;
    const resultCoordinator: ConversationTurnCoordinator = {
      acquire: async () => false,
      release: async () => undefined,
    };
    await expect(runWithConversationTurnLease({
      coordinator: resultCoordinator,
      identity,
      hardDeadlineMs: 200_000,
      waitMs: 120_000,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 90_000,
      operation: async () => 'unexpected',
      now: () => clock,
      random: () => 1,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
      ownerId: 'waiter',
    })).rejects.toBeInstanceOf(ConversationTurnBusyError);
    expect(sleeps.length).toBeGreaterThan(0);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(60_000);
    expect(clock).toBe(121_000);
  });

  it('handles a late acquisition at the execution reserve boundary', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const coordinator = {
      acquire: vi.fn().mockResolvedValue(true),
      release,
    };
    let clock = 1_000;
    let reads = 0;
    await expect(runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 2_000,
      waitMs: 0,
      executionReserveMs: 500,
      expirySafetyMs: 100,
      pollMs: 10,
      operation: async () => 'unexpected',
      now: () => { reads += 1; clock = reads <= 2 ? 1_000 : 1_500; return clock; },
      ownerId: 'one',
    })).rejects.toBeInstanceOf(ConversationTurnBusyError);
    expect(release).toHaveBeenCalledOnce();
  });

  it('preserves operation result when release fails and bounds polling sleeps', async () => {
    const release = vi.fn().mockRejectedValue(new Error('release failed'));
    const events: Array<{ name: string; outcome: string }> = [];
    const result = await runWithConversationTurnLease({
      coordinator: { acquire: async () => true, release },
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 90_000,
      operation: async () => 'ok',
      onEvent: (event) => events.push(event),
      now: () => 1_000,
      ownerId: 'one',
    });
    expect(result).toBe('ok');
    expect(events.some((event) => event.name === 'release' && event.outcome === 'error')).toBe(true);
  });

  it('ignores event callback failures and still releases the operation lease', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    await expect(runWithConversationTurnLease({
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => 'ok',
      onEvent: () => { throw new Error('telemetry failure'); },
      now: () => 1_000,
      ownerId: 'one',
    })).resolves.toBe('ok');
    expect(await coordinator.acquire(lease('two'), 1_001)).toBe(true);
  });

  it('uses the hard deadline plus safety and does not reclaim before that expiry', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    const captured: Array<{ expiresAtMs: number; ownerId: string }> = [];
    const capturing: ConversationTurnCoordinator = {
      acquire: async (turnLease) => {
        captured.push({ expiresAtMs: turnLease.expiresAtMs, ownerId: turnLease.ownerId });
        return true;
      },
      release: async () => undefined,
    };
    await runWithConversationTurnLease({
      coordinator: capturing,
      identity,
      hardDeadlineMs: 100_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 5_000,
      pollMs: 10,
      operation: async () => 'ok',
      now: () => 1_000,
    });
    expect(captured[0]?.expiresAtMs).toBe(105_000);
    await coordinator.acquire(lease('old', 105_000), 1_000);
    expect(await coordinator.acquire(lease('new', 200_000), 30_000)).toBe(false);
    expect(await coordinator.acquire(lease('new', 200_000), 105_000)).toBe(true);
  });

  it('generates a fresh owner token for each invocation', async () => {
    const owners: string[] = [];
    const coordinator: ConversationTurnCoordinator = {
      acquire: async (turnLease) => { owners.push(turnLease.ownerId); return true; },
      release: async () => undefined,
    };
    const args = {
      coordinator,
      identity,
      hardDeadlineMs: 10_000,
      waitMs: 0,
      executionReserveMs: 100,
      expirySafetyMs: 1_000,
      pollMs: 10,
      operation: async () => 'ok',
      now: () => 1_000,
    };
    await runWithConversationTurnLease(args);
    await runWithConversationTurnLease(args);
    expect(owners).toHaveLength(2);
    expect(owners[0]).not.toBe(owners[1]);
  });
});

describe('Dynamo conversation turn coordinator', () => {
  it('sends atomic owner-conditional lock commands', async () => {
    const coordinator = new DynamoConversationTurnCoordinator('table', { region: 'us-east-1' });
    const commands: Array<{ input: Record<string, unknown> }> = [];
    const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
      commands.push(command);
      if (commands.length === 2) {
        throw { name: 'ConditionalCheckFailedException' } as unknown;
      }
      return {};
    });
    (coordinator as unknown as { documentClient: { send: typeof send } }).documentClient.send = send;
    expect(await coordinator.acquire(lease('owner'), 1_000)).toBe(true);
    const putInput = commands[0]?.input ?? {};
    expect(putInput.Item).toEqual({
      pk: 'whatsapp#+51999999999',
      sk: 'TURN_LOCK',
      owner_id: 'owner',
      lease_until_ms: 2_000,
    });
    expect(putInput.ConditionExpression).toContain('attribute_not_exists(pk)');
    expect(putInput.ConditionExpression).toContain('lease_until_ms <= :now_ms');
    expect(putInput.ConditionExpression).toContain('owner_id = :owner_id');

    expect(await coordinator.acquire(lease('other'), 1_000)).toBe(false);
    await coordinator.release(lease('owner'));
    const deleteInput = commands[2]?.input ?? {};
    expect(deleteInput.ConditionExpression).toBe('owner_id = :owner_id');
  });

  it('uses consistent reads with the shared partition key', async () => {
    const store = new DynamoPlanStore('table', { region: 'us-east-1' });
    const commands: Array<{ input: Record<string, unknown> }> = [];
    const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
      commands.push(command);
      return {};
    });
    (store as unknown as { documentClient: { send: typeof send } }).documentClient.send = send;

    await store.getByExternalUser('webchat', '+51999999999');
    await store.getSessionFocus('webchat', '+51999999999', 'session-1');
    expect(commands[0]?.input).toMatchObject({
      Key: { pk: 'webchat#+51999999999', sk: 'PLAN' },
      ConsistentRead: true,
    });
    expect(commands[0]?.input.Key).not.toHaveProperty('ConsistentRead');
    expect(commands[1]?.input).toMatchObject({
      Key: { pk: 'webchat#+51999999999', sk: 'SESSION#session-1' },
      ConsistentRead: true,
    });
    expect(commands[1]?.input.Key).not.toHaveProperty('ConsistentRead');
  });

  it('ignores conditional release conflicts but propagates other release errors', async () => {
    const coordinator = new DynamoConversationTurnCoordinator('table', { region: 'us-east-1' });
    const send = vi.fn(async () => {
      throw { name: 'ConditionalCheckFailedException' } as unknown;
    });
    (coordinator as unknown as { documentClient: { send: typeof send } }).documentClient.send = send;
    await expect(coordinator.release(lease('successor'))).resolves.toBeUndefined();

    send.mockImplementation(async () => { throw new Error('storage failure'); });
    await expect(coordinator.release(lease('successor'))).rejects.toThrow('storage failure');
  });
});
