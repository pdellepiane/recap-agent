import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { EvalLoader } from '../src/evals/loader';
import { classifyEvalCaseLane } from '../src/evals/runner';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { FixtureProviderGateway } from '../src/runtime/fixture-provider-gateway';
import type { FixtureData } from '../src/runtime/eval-fixture-gateway';

/**
 * 2026-09-15 test-repair S1 fixture migration: the 25 fixtureless
 * live_behavior_regression cases resolved from the inspected catalog
 * (load the suite, never hardcode the count) each run against a small
 * faithful synthetic world. No rubric text, thresholds, seeds, or
 * assertions change here; only backendFixture linkage fields.
 */
const CASE_TO_SCENARIO: Readonly<Record<string, string>> = {
  'live_feedback.token_seeded_contact_correction': 'token-contact-correction-close',
  'live_feedback.token_fresh_multifront_stays_multi_need': 'token-multifront-fresh',
  'live_behavior.spanish_only_mixed_language_request': 'spanish-only-catering',
  'live_behavior.rsvp_cristian_phone_enriched_confirmation': 'rsvp-cristian-michelle-jorge',
  'live_behavior.accountless_guest_event_uses_phone_without_otp': 'guest-julisabeth-andres',
  'live_behavior.accountless_event_answer_precedes_remaining_private_auth': 'guest-julisabeth-andres',
  'live_behavior.payment_destination_requires_pending_purchase': 'plan-no-purchase-empty',
  'live_behavior.nonphysical_purchase_omits_shipping': 'plan-no-purchase-empty',
  'live_behavior.ambiguous_confirmation_clarifies': 'plan-ambiguous-confirmation',
  'live_behavior.provider_reference_cheaper_option': 'provider-cheaper-option',
  'live_behavior.provider_reference_miraflores_option': 'provider-miraflores-option',
  'live.faq_from_recommendation_node': 'faq-recommendation-node',
  'live_behavior.phone_confirmation_unclear_requires_yes_or_no': 'phone-confirmation-unclear',
  'live_behavior.authentication_refusal_closes_protected_query': 'auth-refusal-closed',
  'live_behavior.rsvp_trusted_phone_reports_no_pending': 'rsvp-trusted-phone-empty',
  'live_behavior.rsvp_jose_campaign_invitation_not_reported_missing': 'rsvp-jose-gia-antonella',
  'live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing': 'guest-julisabeth-andres',
  'live_behavior.rsvp_ambiguous_event_requires_grounded_selection': 'rsvp-trusted-phone-empty',
  'live_behavior.rsvp_confirmed_state_is_reported': 'rsvp-confirmed-otra-celebracion',
  'live_behavior.wedding_planner_location_completes_search': 'plan-wedding-planner-lima',
  'live_behavior.reset_plan_discards_stored_context': 'plan-reset-clean',
  'live_behavior.jose_campaign_greeting_then_acknowledgement': 'continuity-jose-acknowledgement',
  'live_behavior.ambiguous_confirmation_adversarial_selection': 'plan-ambiguous-confirmation',
  'live_behavior.owner_planning_to_faq_single_transfer': 'plan-owner-faq-transfer',
  'live_behavior.s4-injected-renderer-prose-fails': 'provider-miraflores-option',
};

const CASE_IDS = Object.keys(CASE_TO_SCENARIO);

async function loadFixtureJson(scenario: string): Promise<FixtureData> {
  const content = await fs.readFile(
    path.join(process.cwd(), 'evals', 'fixtures', `${scenario}.json`),
    'utf8',
  );
  return JSON.parse(content) as FixtureData;
}

describe('S1 fixture migration linkage for the 25 catalog-resolved cases', () => {
  it('attaches exactly the mapped fixture scenario and no real-backend isolation hooks', async () => {
    const catalog = await new EvalLoader('evals').loadCatalog();
    expect(CASE_IDS).toHaveLength(25);
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

  it('admits every migrated case except the provider-search mustCall case to the parallel lane', async () => {
    const catalog = await new EvalLoader('evals').loadCatalog();
    for (const id of CASE_IDS) {
      const currentCase = catalog.cases.find((entry) => entry.id === id);
      if (!currentCase) throw new Error(`Missing case ${id}`);
      const verdict = classifyEvalCaseLane(currentCase);
      if (id === 'live_behavior.wedding_planner_location_completes_search') {
        // Runner-owned limitation (another lane owns runner.ts): its
        // mustCall search_providers_from_plan has no fixture-operation
        // mapping, so it stays external until that mapping plus the Lambda
        // provider-search delegation land. Fixture linkage above still
        // scopes its conversation backend.
        expect(verdict.lane, id).toBe('external');
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
      expect(scenarios).toHaveLength(19);
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
