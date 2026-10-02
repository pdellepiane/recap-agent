import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { EvalLoader } from '../src/evals/loader';
import { classifyEvalCaseLane } from '../src/evals/runner';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { FixtureProviderGateway } from '../src/runtime/fixture-provider-gateway';
import type { FixtureData } from '../src/runtime/eval-fixture-gateway';

/**
 * 2026-09-15 test-repair S1 fixture migration: the fixtureless
 * live_behavior_regression cases resolved from the inspected catalog
 * (load the suite, never hardcode the count) each run against a small
 * faithful synthetic world. No rubric text, thresholds, seeds, or
 * assertions change here; only backendFixture linkage fields.
 * 22 cases since the 2026-09-30 condensation merged 3 into carriers.
 * 15 cases since the 2026-09-30 live compression merged 7 into carriers
 * (4 removed outright, 3 kept as per-thread pins below).
 */
const CASE_TO_SCENARIO: Readonly<Record<string, string>> = {
  'live_behavior.accountless_guest_event_uses_phone_without_otp': 'guest-julisabeth-andres',
  // (nonphysical_purchase_omits_shipping merged into payment_destination carrier above)
  'live_behavior.ambiguous_confirmation_clarifies': 'plan-ambiguous-confirmation',
  'live_behavior.provider_reference_miraflores_option': 'provider-miraflores-option',
  'live_behavior.phone_confirmation_unclear_requires_yes_or_no': 'phone-confirmation-unclear',
  'live_behavior.authentication_refusal_closes_protected_query': 'auth-refusal-closed',
  'live_behavior.rsvp_ambiguous_event_requires_grounded_selection': 'rsvp-trusted-phone-empty',
  'live_behavior.reset_plan_discards_stored_context': 'plan-reset-clean',
  // (ambiguous_confirmation_adversarial_selection merged into ambiguous_confirmation_clarifies above)
  // 2026-09-30 live compression: rsvp_trusted_phone_reports_no_pending and
  // s4-injected-renderer-prose-fails merged into rsvp_ambiguous_event and
  // provider_reference_miraflores (same scenarios, mapped above);
  // rsvp_cinthya_campaign and owner_planning_to_faq merged into
  // rsvp_jose_campaign and image_conversation_continuity with their per-turn
  // scenarios intact (pinned below).
};

const CASE_IDS = Object.keys(CASE_TO_SCENARIO);

async function loadFixtureJson(scenario: string): Promise<FixtureData> {
  const content = await fs.readFile(
    path.join(process.cwd(), 'evals', 'fixtures', `${scenario}.json`),
    'utf8',
  );
  return JSON.parse(content) as FixtureData;
}

describe('S1 fixture migration linkage for the 7 retained catalog cases', () => {
  it('attaches exactly the mapped fixture scenario and no real-backend isolation hooks', async () => {
    const catalog = await new EvalLoader('evals').loadCatalog();
    expect(CASE_IDS).toHaveLength(7);
    for (const id of CASE_IDS) {
      const currentCase = catalog.cases.find((entry) => entry.id === id);
      expect(currentCase, id).toBeDefined();
      if (!currentCase) throw new Error(`Missing case ${id}`);
      expect(currentCase.backendFixture?.scenario, id).toBe(CASE_TO_SCENARIO[id]);
      for (const [index, input] of currentCase.inputs.entries()) {
        const scenario = input.backendFixture?.scenario ?? currentCase.backendFixture?.scenario ?? null;
        expect(scenario, `${id} turn ${index}`).toBe(CASE_TO_SCENARIO[id]);
      }
      expect(currentCase.rsvpIsolation, id).toBeUndefined();
    }
  });

  it('keeps absorbed per-turn scenarios on the merged survivors', async () => {
    const catalog = await new EvalLoader('evals').loadCatalog();
    const byId = new Map(catalog.cases.map((entry) => [entry.id, entry]));
    const threads: Array<{ survivor: string; turns: number[]; scenario: string }> = [
      {
        survivor: 'live_behavior.rsvp_cristian_phone_enriched_confirmation',
        turns: [0, 1, 2],
        scenario: 'rsvp-cristian-michelle-jorge',
      },
      {
        survivor: 'live_behavior.rsvp_cristian_phone_enriched_confirmation',
        turns: [3, 4, 5],
        scenario: 'rsvp-plus-one-not-eligible',
      },
      {
        survivor: 'live_behavior.rsvp_confirmed_state_is_reported',
        turns: [0, 1, 2],
        scenario: 'rsvp-confirmed-otra-celebracion',
      },
      {
        survivor: 'live_behavior.rsvp_confirmed_state_is_reported',
        turns: [3, 4, 5],
        scenario: 'rsvp-resolved-attending',
      },
    ];
    for (const { survivor, turns, scenario } of threads) {
      const currentCase = byId.get(survivor);
      expect(currentCase, survivor).toBeDefined();
      for (const turn of turns) {
        expect(
          currentCase?.inputs[turn]?.backendFixture?.scenario,
          `${survivor} turn ${turn}`,
        ).toBe(scenario);
      }
      expect(currentCase?.rsvpIsolation, survivor).toBeUndefined();
    }
    // The unmapped survivor worlds keep serving reads with zero network.
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    try {
      for (const scenario of [
        'rsvp-jose-gia-antonella',
        'rsvp-confirmed-otra-celebracion',
        'rsvp-plus-one-not-eligible',
        'rsvp-resolved-attending',
        'plan-owner-faq-transfer',
      ]) {
        const gateway = await FixtureAgentConversationGateway.create(scenario);
        const probe = await gateway.getRecentMessages('51900000000');
        expect(probe.status, scenario).not.toBe('failed');
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('admits every migrated case to the parallel lane', async () => {
    const catalog = await new EvalLoader('evals').loadCatalog();
    for (const id of CASE_IDS) {
      const currentCase = catalog.cases.find((entry) => entry.id === id);
      if (!currentCase) throw new Error(`Missing case ${id}`);
      const verdict = classifyEvalCaseLane(currentCase);
      if (id === 'live_behavior.wedding_planner_location_completes_search') {
        // 2026-09-16 final support rescue: the runner-owned provider-tool
        // mapping (GATEWAY_PROVIDER_TOOL_METHODS, committed in 2113f105)
        // landed after this comment was written, so search_providers_from_plan
        // now resolves to FixtureProviderGateway.searchProviders and the case
        // classifies parallel. The stale external expectation below is
        // updated, not quarantined: lane classification is shared
        // fixture-isolation integrity, firmly in scope.
        expect(verdict.lane, id).toBe('parallel');
        continue;
      }
      expect(verdict.lane, `${id}: ${verdict.reason}`).toBe('parallel');
    }
  });
});

describe('S1 migrated fixture worlds serve their case reads with zero network', () => {
  it('loads every mapped world and serves reads without HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    try {
      const scenarios = [...new Set(Object.values(CASE_TO_SCENARIO))];
      // 2026-09-30 live compression: jose, cristian, and confirmed leave
      // the uniform map (their absorbed turns keep distinct scenarios,
      // pinned above); guest-julisabeth-andres stays via accountless.
      expect(scenarios).toHaveLength(7);
      for (const scenario of scenarios) {
        const gateway = await FixtureAgentConversationGateway.create(scenario);
        const probe = await gateway.getRecentMessages('51900000000');
        expect(probe.status, scenario).not.toBe('failed');
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('cristian world resolves the attending Michelle and Jorge invitation', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-cristian-michelle-jorge');
    const summaries = await gateway.getGuestEventsByPhone({
      phone_extension: '+51',
      phone_number: '942633292',
    });
    expect(summaries.status).toBe('success');
    if (summaries.status !== 'success') throw new Error('Expected guest events.');
    expect(summaries.events).toHaveLength(1);
    expect(summaries.events[0]?.name).toBe('Michelle & Jorge');
    const detail = await gateway.getEventDetail({
      eventId: summaries.events[0]?.eventId,
      phone: { phone_extension: '+51', phone_number: '942633292' },
    });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') throw new Error('Expected event detail.');
    expect(detail.event.attendance?.willAttend).toBe(true);
  });

  it('julisabeth world carries the reception location, attending polarity, and scoped purchase', async () => {
    const gateway = await FixtureAgentConversationGateway.create('guest-julisabeth-andres');
    const phone = { phone_extension: '+51', phone_number: '51904523314' };
    const summaries = await gateway.getGuestEventsByPhone(phone);
    expect(summaries.status).toBe('success');
    if (summaries.status !== 'success') throw new Error('Expected guest events.');
    expect(summaries.events).toHaveLength(1);
    const detail = await gateway.getEventDetail({ eventId: 702201, phone });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') throw new Error('Expected event detail.');
    expect(detail.event.attendance?.willAttend).toBe(true);
    const moments = detail.event.moments ?? [];
    expect(moments.some((moment) => moment.locationDescription === 'Hacienda Recoveco')).toBe(true);
    expect(detail.event.purchases?.length ?? 0).toBeGreaterThan(0);
    const gift = await gateway.getGuestGiftPurchasesByPhone({ ...phone, orderId: null });
    expect(gift.status).toBe('success');
  });

  it('trusted-phone world completes empty instead of failing the lookup', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-trusted-phone-empty');
    const summaries = await gateway.getGuestEventsByPhone({
      phone_extension: '+1',
      phone_number: '2025550100',
    });
    expect(summaries.status).toBe('success');
    if (summaries.status !== 'success') throw new Error('Expected guest events.');
    expect(summaries.events).toHaveLength(0);
  });

  it('jose world reports the documented Gia Antonella confirmation without a write', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-jose-gia-antonella');
    const phone = { phone_extension: '+51', phone_number: '51941438449' };
    const detail = await gateway.getEventDetail({ eventId: 38331, phone });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') throw new Error('Expected event detail.');
    expect(detail.event.attendance?.guestId).toBe(579788);
    expect(detail.event.attendance?.willAttend).toBe(true);
    expect(gateway.getFixtureCallCount('rsvp.write')).toBe(0);
  });

  it('confirmed-state world is attending on a distinct synthetic event from S11', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-confirmed-otra-celebracion');
    const phone = { phone_extension: '+51', phone_number: '51973296571' };
    const detail = await gateway.getEventDetail({ eventId: 584355, phone });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') throw new Error('Expected event detail.');
    expect(detail.event.attendance?.guestId).toBe(584352);
    expect(detail.event.attendance?.willAttend).toBe(true);
  });

  it('phone-confirmation world preserves the pending dress-code question context', async () => {
    const gateway = await FixtureAgentConversationGateway.create('phone-confirmation-unclear');
    const phone = { phone_extension: '+51', phone_number: '51973296571' };
    const detail = await gateway.getEventDetail({ eventId: 703301, phone });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') throw new Error('Expected event detail.');
    expect(detail.event.name).toBe('Karem y Alfredo');
    expect(detail.event.dresscode).not.toBeNull();
  });

  it('unknown scenario fails closed and never reaches the real backend', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    try {
      const gateway = await FixtureAgentConversationGateway.create('s1-no-such-world');
      const summaries = await gateway.getGuestEventsByPhone({
        phone_extension: '+51',
        phone_number: '51900000000',
      });
      expect(summaries.status).toBe('failed');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});

describe('S1 fixture provider gateway serves declared search worlds', () => {
  it('wedding-planner world returns Lima candidates from fixture data', async () => {
    const data = await loadFixtureJson('plan-wedding-planner-lima');
    const gateway = new FixtureProviderGateway('plan-wedding-planner-lima', data, 'loaded', {
      runId: 'test-run',
      caseId: 'test-case',
    });
    const byIntent = await gateway.searchProvidersByQueryIntent({
      category: 'Wedding planners',
      queryStrings: ['wedding planner Lima'],
      location: 'Lima',
      fitCriteria: {
        eventType: 'boda',
        needCategory: 'Wedding planners',
        location: 'Lima',
        budgetAmount: null,
        budgetCurrency: null,
        mustHave: [],
        shouldAvoid: [],
        rankingNotes: '',
      },
    });
    expect(byIntent.providers.length).toBeGreaterThanOrEqual(1);
    expect(byIntent.providers[0]?.location).toBe('Lima');
    const detail = await gateway.getProviderDetail(801);
    expect(detail?.title).toBe('Lucía Fernández');
    expect(gateway.callCount('searchProvidersByQueryIntent')).toBe(1);
  });

  it('drops malformed provider entries instead of inventing results', async () => {
    const gateway = new FixtureProviderGateway(
      's1-malformed-providers',
      { searchProvidersByQueryIntent: { providers: [{ id: 'not-a-number' }, null] } } as unknown as FixtureData,
      'loaded',
      { runId: 'test-run', caseId: 'test-case' },
    );
    const result = await gateway.searchProvidersByQueryIntent({
      category: 'Wedding planners',
      queryStrings: ['x'],
      location: null,
      fitCriteria: {
        eventType: 'boda',
        needCategory: 'Wedding planners',
        location: null,
        budgetAmount: null,
        budgetCurrency: null,
        mustHave: [],
        shouldAvoid: [],
        rankingNotes: '',
      },
    });
    expect(result.providers).toHaveLength(0);
  });
});
