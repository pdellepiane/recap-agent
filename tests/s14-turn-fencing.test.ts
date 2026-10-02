import { describe, expect, it } from 'vitest';

import { buildTurnMessageContext } from '../src/runtime/turn-message-context';
import type { AgentConversationMessage } from '../src/runtime/agent-conversation-gateway';
import { InMemoryConversationTurnCoordinator } from '../src/storage/in-memory-conversation-turn-coordinator';
import {
  FencedPlanSaveRejectedError,
  InMemoryLeaseFencedPlanStore,
  TurnOutcomeLedger,
  attachHistoricalCorrelation,
  buildFencedPlanTransactInput,
  isLeaseFenceSatisfied,
} from '../src/storage/turn-fencing';

const identity = { channel: 'whatsapp', externalUserId: '+51900004780' };

function storedMessage(overrides: Partial<AgentConversationMessage> & { id: number }): AgentConversationMessage {
  return {
    direction: 'inbound',
    source: null,
    body: 'Gracias por la organizacion',
    status: 'received',
    whatsappMessageId: null,
    sentAt: '2026-09-04T13:11:09.000Z',
    createdAt: '2026-09-04T13:11:09.000Z',
    ...overrides,
  };
}

describe('S14 available-ID deduplication preserves ambiguity', () => {
  it('preserves identical-body records without identity evidence', () => {
    {
      const context = buildTurnMessageContext({
        messages: [storedMessage({ id: 16677 }), storedMessage({ id: 16679 })],
        inbound: {
          channel: 'whatsapp',
          externalUserId: '+51900004780',
          text: 'Otro texto distinto',
          messageId: 'wamid.native-current',
          receivedAt: '2026-09-04T13:12:00.000Z',
        },
      });
      expect(context.recentMessages).toHaveLength(2);
      expect(context.excludedCurrentMessageCount).toBe(0);
    }

    {
      const context = buildTurnMessageContext({
        messages: [storedMessage({ id: 16677 }), storedMessage({ id: 16679 })],
        inbound: {
          channel: 'whatsapp',
          externalUserId: '+51900004780',
          text: 'Gracias por la organizacion',
          messageId: 'wamid.unrelated',
          receivedAt: '2026-09-04T13:11:35.000Z',
        },
      });
      expect(context.recentMessages).toHaveLength(2);
      expect(context.excludedCurrentMessageCount).toBe(0);
    }
  });

  it('excludes exactly the current message on native ID match', () => {
    const context = buildTurnMessageContext({
      messages: [
        storedMessage({ id: 16677, whatsappMessageId: 'wamid.current' }),
        storedMessage({ id: 16679, body: 'Otro cuerpo' }),
      ],
      inbound: {
        channel: 'whatsapp',
        externalUserId: '+51900004780',
        text: 'Gracias por la organizacion',
        messageId: 'wamid.current',
        receivedAt: '2026-09-04T13:11:35.000Z',
      },
    });
    expect(context.recentMessages).toHaveLength(1);
    expect(context.recentMessages[0]?.id).toBe(16679);
    expect(context.excludedCurrentMessageCount).toBe(1);
  });

  it('keeps raw history bounded without a second memory store', () => {
    const messages = Array.from({ length: 7 }, (_, index) =>
      storedMessage({ id: 100 + index, body: `cuerpo ${index}` }));
    const context = buildTurnMessageContext({
      messages,
      inbound: {
        channel: 'whatsapp',
        externalUserId: '+51900004780',
        text: 'Texto actual no coincidente',
        messageId: 'wamid.current',
        receivedAt: '2026-09-04T13:12:00.000Z',
      },
    });
    expect(context.recentMessages).toHaveLength(5);
  });
});

describe('S14 lease fencing on the existing coordination record', () => {
  it('allows the active lease owner to save', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    const store = new InMemoryLeaseFencedPlanStore(coordinator);
    expect(await coordinator.acquire({ ...identity, ownerId: 'owner-a', expiresAtMs: 20_000 }, 1_000)).toBe(true);
    await expect(store.saveFenced(
      { planKey: 'whatsapp#+51900004780', version: 1 },
      { ...identity, ownerId: 'owner-a', expiresAtMs: 20_000 },
      1_000,
    )).resolves.toBeUndefined();
  });

  it('rejects saves from superseded or expired lease owners', async () => {
    {
      const coordinator = new InMemoryConversationTurnCoordinator();
      const store = new InMemoryLeaseFencedPlanStore(coordinator);
      await coordinator.acquire({ ...identity, ownerId: 'owner-a', expiresAtMs: 20_000 }, 1_000);
      await expect(store.saveFenced(
        { planKey: 'k', version: 1 },
        { ...identity, ownerId: 'owner-b', expiresAtMs: 20_000 },
        1_000,
      )).rejects.toBeInstanceOf(FencedPlanSaveRejectedError);
    }

    {
      const coordinator = new InMemoryConversationTurnCoordinator();
      const store = new InMemoryLeaseFencedPlanStore(coordinator);
      await coordinator.acquire({ ...identity, ownerId: 'owner-a', expiresAtMs: 2_000 }, 1_000);
      await expect(store.saveFenced(
        { planKey: 'k', version: 1 },
        { ...identity, ownerId: 'owner-a', expiresAtMs: 2_000 },
        3_000,
      )).rejects.toBeInstanceOf(FencedPlanSaveRejectedError);
      expect(await coordinator.acquire({ ...identity, ownerId: 'owner-b', expiresAtMs: 30_000 }, 3_000)).toBe(true);
      await expect(store.saveFenced(
        { planKey: 'k', version: 2 },
        { ...identity, ownerId: 'owner-b', expiresAtMs: 30_000 },
        3_000,
      )).resolves.toBeUndefined();
    }
  });

  it('isLeaseFenceSatisfied matches the store decision table', () => {
    expect(isLeaseFenceSatisfied(null, 'owner-a', 1_000)).toBe(false);
    expect(isLeaseFenceSatisfied(
      { ownerId: 'owner-b', expiresAtMs: 20_000 }, 'owner-a', 1_000,
    )).toBe(false);
    expect(isLeaseFenceSatisfied(
      { ownerId: 'owner-a', expiresAtMs: 2_000 }, 'owner-a', 3_000,
    )).toBe(false);
    expect(isLeaseFenceSatisfied(
      { ownerId: 'owner-a', expiresAtMs: 20_000 }, 'owner-a', 1_000,
    )).toBe(true);
  });

  it('builds a Dynamo transact that conditions on the existing TURN_LOCK record', () => {
    const input = buildFencedPlanTransactInput({
      tableName: 'plans',
      planKey: 'whatsapp#+51900004780',
      planItem: { pk: 'x', sk: 'PLAN' },
      ownerId: 'owner-a',
      nowMs: 1_000,
    });
    expect(input.TransactItems).toHaveLength(2);
    const check = input.TransactItems[1]?.ConditionCheck;
    expect(check?.TableName).toBe('plans');
    expect(check?.Key).toEqual({ pk: 'whatsapp#+51900004780', sk: 'TURN_LOCK' });
    expect(check?.ConditionExpression).toContain('owner_id = :owner_id');
    expect(check?.ConditionExpression).toContain('lease_until_ms > :now_ms');
    expect(check?.ExpressionAttributeValues).toEqual({ ':owner_id': 'owner-a', ':now_ms': 1_000 });
  });
});

describe('S14 duplicate input and delivery retry replay without repeating effects', () => {
  it('replays persisted outcomes once per message ID in a bounded ledger', async () => {
    {
      const ledger = new TurnOutcomeLedger();
      let effects = 0;
      const first = await ledger.executeOnce('wamid.dup', async () => {
        effects += 1;
        return { text: 'Respuesta', deliveryAction: 'send' as const, effectCount: 1 };
      });
      expect(first.replayed).toBe(false);
      const second = await ledger.executeOnce('wamid.dup', async () => {
        effects += 1;
        return { text: 'Respuesta', deliveryAction: 'send' as const, effectCount: 1 };
      });
      expect(second.replayed).toBe(true);
      expect(second.outcome.text).toBe('Respuesta');
      expect(effects).toBe(1);
    }

    {
      const ledger = new TurnOutcomeLedger(3);
      for (let index = 0; index < 5; index += 1) {
        await ledger.executeOnce(`wamid.${index}`, async () => ({
          text: 'x', deliveryAction: 'send' as const, effectCount: 0,
        }));
      }
      expect(ledger.size()).toBeLessThanOrEqual(3);
      expect(ledger.has('wamid.4')).toBe(true);
    }
  });

  it('does not record an outcome when the save fails so a retry runs once more', async () => {
    const coordinator = new InMemoryConversationTurnCoordinator();
    const store = new InMemoryLeaseFencedPlanStore(coordinator, { failNextSave: true });
    const ledger = new TurnOutcomeLedger();
    await coordinator.acquire({ ...identity, ownerId: 'owner-a', expiresAtMs: 20_000 }, 1_000);
    let effects = 0;
    await expect((async () => {
      effects += 1;
      await store.saveFenced(
        { planKey: 'k', version: 1 },
        { ...identity, ownerId: 'owner-a', expiresAtMs: 20_000 },
        1_000,
      );
      await ledger.executeOnce('wamid.retry', async () => ({
        text: 'x', deliveryAction: 'send' as const, effectCount: 1,
      }));
    })()).rejects.toThrow();
    expect(ledger.has('wamid.retry')).toBe(false);
    effects += 1;
    await store.saveFenced(
      { planKey: 'k', version: 1 },
      { ...identity, ownerId: 'owner-a', expiresAtMs: 20_000 },
      1_000,
    );
    await ledger.executeOnce('wamid.retry', async () => ({
      text: 'x', deliveryAction: 'send' as const, effectCount: 1,
    }));
    expect(effects).toBe(2);
    expect(ledger.has('wamid.retry')).toBe(true);
  });

});

describe('S14 Tito historical correlation is optional enrichment only', () => {
  it('keeps historical correlation as optional enrichment only', () => {
    {
      const outcome = { text: 'ok', deliveryAction: 'send' as const };
      expect(attachHistoricalCorrelation(outcome, null)).toEqual(outcome);
    }

    {
      const outcome = { text: 'ok', deliveryAction: 'send' as const };
      const enriched = attachHistoricalCorrelation(outcome, { note: 'screenshot-confirmed ordering' });
      expect(enriched.text).toBe('ok');
      expect(enriched.historicalCorrelation).toEqual({ note: 'screenshot-confirmed ordering' });
    }
  });

});
