import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan, type PersistedPlan } from '../src/core/plan';
import { FixtureProviderGateway } from '../src/runtime/fixture-provider-gateway';
import {
  executePlanCompletion,
  isValidEventDate,
  type ProviderQuoteEffect,
} from '../src/runtime/plan-completion-executor';
import type { QuoteRequestInput } from '../src/runtime/provider-gateway';

const EVENT_DATE = '2026-10-18';

type QuoteStub = {
  gateway: { createQuoteRequest(input: QuoteRequestInput): Promise<Record<string, unknown>> };
  calls: QuoteRequestInput[];
};

function stubGateway(behavior: (input: QuoteRequestInput) => Promise<Record<string, unknown>>): QuoteStub {
  const calls: QuoteRequestInput[] = [];
  return {
    calls,
    gateway: {
      createQuoteRequest: async (input: QuoteRequestInput) => {
        calls.push(input);
        return behavior(input);
      },
    },
  };
}

function planWithProviders(): PersistedPlan {
  const plan = mergePlan(
    createEmptyPlan({ planId: 'plan-s12', channel: 'terminal_whatsapp', externalUserId: 'user-s12' }),
    {
      contact_name: 'Carolina Sintetica',
      contact_email: 'carolina.sintetica@example.com',
      contact_phone: '51999111222',
      provider_needs: [
        {
          category: 'Catering',
          status: 'selected',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [101],
          recommended_providers: [],
          selected_provider_ids: [101],
          selected_provider_hints: [],
        },
        {
          category: 'Música',
          status: 'selected',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [202],
          recommended_providers: [],
          selected_provider_ids: [202],
          selected_provider_hints: [],
        },
      ],
    },
  );
  return plan as unknown as PersistedPlan;
}

describe('S12 per-provider quote completion', () => {
  it('rejects only strict calendar dates', () => {
    expect(isValidEventDate('2026-10-18')).toBe(true);
    expect(isValidEventDate('2024-02-29')).toBe(true);
    expect(isValidEventDate(null)).toBe(false);
    expect(isValidEventDate('')).toBe(false);
    expect(isValidEventDate('  ')).toBe(false);
    expect(isValidEventDate('18/10/2026')).toBe(false);
    expect(isValidEventDate('2026-13-01')).toBe(false);
    expect(isValidEventDate('2026-02-30')).toBe(false);
    expect(isValidEventDate('2023-02-29')).toBe(false);
    expect(isValidEventDate('2026-10-18T10:00:00')).toBe(false);
  });

  it('requires an explicitly captured event date and never calls the gateway without one', async () => {
    const stub = stubGateway(async () => ({ ok: true }));
    for (const missing of [undefined, null, '', '   ']) {
      const outcome = await executePlanCompletion({
        plan: planWithProviders(),
        eventDate: missing,
        providerGateway: stub.gateway,
      });
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toBe('missing_event_date');
      expect(outcome.effects).toEqual([]);
      expect(outcome.planUpdate).toBeNull();
    }
    expect(stub.calls).toEqual([]);
  });

  it('rejects an invalid event date without gateway calls', async () => {
    const stub = stubGateway(async () => ({ ok: true }));
    const outcome = await executePlanCompletion({
      plan: planWithProviders(),
      eventDate: 'fecha pendiente',
      providerGateway: stub.gateway,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('invalid_event_date');
    expect(stub.calls).toEqual([]);
  });

  it('sends the explicitly captured date verbatim and never substitutes today or null', async () => {
    const stub = stubGateway(async () => ({ ok: true }));
    const today = new Date().toISOString().split('T')[0];
    const chosen = today === EVENT_DATE ? '2026-11-02' : EVENT_DATE;
    const outcome = await executePlanCompletion({
      plan: planWithProviders(),
      eventDate: chosen,
      providerGateway: stub.gateway,
    });
    expect(outcome.status).toBe('success');
    expect(stub.calls).toHaveLength(2);
    for (const call of stub.calls) {
      expect(call.eventDate).toBe(chosen);
    }
    expect(outcome.eventDate).toBe(chosen);
  });

  it('keeps partial success unfinished and preserves the multi-need plan without mutation', async () => {
    const stub = stubGateway(async (input) => {
      if (input.providerId === 202) {
        throw new Error('quote rejected for provider 202');
      }
      return { ok: true, id: 'q-101' };
    });
    const plan = planWithProviders();
    const before = JSON.parse(JSON.stringify(plan)) as unknown;
    const outcome = await executePlanCompletion({ plan, eventDate: EVENT_DATE, providerGateway: stub.gateway });
    expect(outcome.status).toBe('partial');
    expect(outcome.finished).toBe(false);
    expect(outcome.planUpdate).toBeNull();
    expect(plan.lifecycle_state).toBe('active');
    expect(plan).toEqual(before);
    const byId = new Map(outcome.effects.map((effect) => [effect.providerId, effect]));
    expect(byId.get(101)?.status).toBe('confirmed');
    expect(byId.get(202)?.status).toBe('failed');
    expect(byId.get(101)?.category).toBe('Catering');
    expect(byId.get(202)?.category).toBe('Música');
    expect(outcome.effects).toHaveLength(2);
  });

  it('retries only unresolved providers and never re-attempts confirmed ones', async () => {
    const stub = stubGateway(async () => ({ ok: true }));
    const prior: readonly ProviderQuoteEffect[] = [
      { providerId: 101, category: 'Catering', status: 'confirmed', eventDate: EVENT_DATE, receiptId: 'q-101', error: null, attemptCount: 1 },
      { providerId: 202, category: 'Música', status: 'failed', eventDate: EVENT_DATE, receiptId: null, error: 'boom', attemptCount: 1 },
    ];
    const outcome = await executePlanCompletion({
      plan: planWithProviders(),
      eventDate: EVENT_DATE,
      providerGateway: stub.gateway,
      priorEffects: prior,
    });
    expect(stub.calls.map((call) => call.providerId)).toEqual([202]);
    expect(outcome.status).toBe('success');
    expect(outcome.finished).toBe(true);
    expect(outcome.planUpdate?.lifecycle_state).toBe('finished');
    const replayed = outcome.effects.find((effect) => effect.providerId === 101);
    expect(replayed?.status).toBe('confirmed');
    expect(replayed?.attemptCount).toBe(1);
    expect(outcome.replayedProviderIds).toEqual([101]);
    expect(outcome.retriedProviderIds).toEqual([202]);
  });

  it('marks unknown effects unresolved without a success claim and retries them', async () => {
    const stub = stubGateway(async () => {
      throw new Error('Unknown fixture scenario "s12-unknown".');
    });
    const first = await executePlanCompletion({ plan: planWithProviders(), eventDate: EVENT_DATE, providerGateway: stub.gateway });
    expect(first.status).toBe('failed');
    expect(first.effects.every((effect) => effect.status === 'unresolved')).toBe(true);
    expect(first.finished).toBe(false);
    expect(first.planUpdate).toBeNull();
    const retryStub = stubGateway(async () => ({ ok: true }));
    const second = await executePlanCompletion({
      plan: planWithProviders(),
      eventDate: EVENT_DATE,
      providerGateway: retryStub.gateway,
      priorEffects: first.effects,
    });
    expect(retryStub.calls).toHaveLength(2);
    expect(second.status).toBe('success');
  });

  it('finishes only when every provider confirms and returns an immutable plan update', async () => {
    const stub = stubGateway(async (input) => ({ ok: true, id: `q-${input.providerId}` }));
    const plan = planWithProviders();
    const outcome = await executePlanCompletion({ plan, eventDate: EVENT_DATE, providerGateway: stub.gateway });
    expect(outcome.status).toBe('success');
    expect(outcome.finished).toBe(true);
    expect(outcome.planUpdate?.lifecycle_state).toBe('finished');
    expect(outcome.planUpdate?.provider_needs).toHaveLength(2);
    expect(plan.lifecycle_state).toBe('active');
    expect(outcome.planUpdate).not.toBe(plan);
  });

  it('S02 fixture twin: simulated quotes persist receipts and unknown scenarios stay unresolved', async () => {
    const loaded = new FixtureProviderGateway('s12-provider-completion', null, 'loaded', {
      runId: 'run-s12',
      caseId: 'case-s12-twin',
    });
    const ok = await executePlanCompletion({ plan: planWithProviders(), eventDate: EVENT_DATE, providerGateway: loaded });
    expect(ok.status).toBe('success');
    expect(loaded.callCount('createQuoteRequest')).toBe(2);
    const unknown = new FixtureProviderGateway('s12-missing-scenario', null, 'unknown_scenario', {
      runId: 'run-s12',
      caseId: 'case-s12-unknown',
    });
    const failed = await executePlanCompletion({ plan: planWithProviders(), eventDate: EVENT_DATE, providerGateway: unknown });
    expect(failed.status).toBe('failed');
    expect(failed.effects.every((effect) => effect.status === 'unresolved')).toBe(true);
    expect(failed.planUpdate).toBeNull();
  });
});
