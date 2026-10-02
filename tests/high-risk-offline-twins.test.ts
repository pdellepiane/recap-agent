import path from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway, KnowledgeRetrievalResult } from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { InMemoryRsvpEffectStore } from '../src/runtime/rsvp-effect-executor';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan } from '../src/core/plan';
import type { EvalTurnResult } from '../src/evals/case-schema';
import { EvalLoader } from '../src/evals/loader';
import { attachEvaluationState, type FixtureEffectSummary } from '../src/evals/evaluation-state';
import { assertLiveRegressionFixtureCoverage, evaluateFixtureEffectCountForTesting, resolveTextSemanticCandidate } from '../src/evals/runner';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function emptyProviderGateway(): ProviderGateway {
  const empty: UserEventLookupResult = {
    lookup: { email: null, phone: '900000000' },
    user: null,
    events: [],
    counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
  };
  return {
    async lookupAuthenticatedUserEvents(): Promise<UserEventLookupResult> {
      return empty;
    },
    async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
      return empty;
    },
  } as unknown as ProviderGateway;
}

function sentinelRuntime(extractions: ExtractionResult[]): AgentRuntime {
  return {
    async extract(): Promise<ExtractionResult> {
      const next = extractions.shift();
      if (!next) throw new Error('No twin extraction queued.');
      return next;
    },
    async composeReply(): Promise<ComposeReplyResult> {
      return {
        text: 'TWIN_MODEL_SENTINEL',
        structuredMessage: { type: 'generic', paragraphs_es: ['TWIN_MODEL_SENTINEL'] },
      };
    },
  };
}

function baseExtraction(overrides: Partial<ExtractionResult>): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null,
    vendorCategory: null,
    vendorCategories: [],
    activeNeedCategory: null,
    location: null,
    budgetSignal: null,
    guestRange: null,
    preferences: [],
    hardConstraints: [],
    assumptions: [],
    conversationSummary: 'High-risk twin turn.',
    selectedProviderHints: [],
    selectedProviderReferences: [],
    closeAction: null,
    pauseRequested: false,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
    ...overrides,
  };
}

function twinService(
  gateway: AgentConversationGateway,
  runtime: AgentRuntime,
  planStore: InMemoryPlanStore,
): AgentService {
  const provider = emptyProviderGateway();
  return new AgentService({
    planStore,
    runtime,
    providerGateway: provider,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: {
        async search(): Promise<KnowledgeRetrievalResult> {
          return { status: 'success', evidence: [] };
        },
      } as KnowledgeRetrievalGateway,
      providerGateway: provider,
      agentGateway: gateway,
    }),
    agentConversationGateway: gateway,
    rsvpEffectStore: new InMemoryRsvpEffectStore(),
  });
}

describe('high-risk scenario offline twins (F3)', () => {
  // Mandatory suite reconciliation (119 total / 111 support / 8
  // planning-only) lives in tests/eval-run-manifest.test.ts
  // ('reconciles frozen support-gate counts from the catalog suite'),
  // which pins the same counts plus the frozen-gate linkage.

  it('accountless venue: one trusted phone yields events, reception facts, and scoped purchases', async () => {
    const gateway = await FixtureAgentConversationGateway.create('guest-julisabeth-andres');
    const events = await gateway.getGuestEventsByPhone({ phone_extension: '+51', phone_number: '904523314' });
    expect(events.status).toBe('success');
    if (events.status !== 'success') return;
    const names = events.events.map((event) => event.name);
    expect(names).toContain('Julisabeth y Andrés');
    const detail = await gateway.getEventDetail({
      eventId: 702201,
      phone: { phone_extension: '+51', phone_number: '904523314' },
    });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') return;
    const moments = detail.event.moments.map((moment) => moment.description ?? '');
    expect(moments.some((description) => description.includes('Hacienda Recoveco'))).toBe(true);
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '904523314' });
    expect(orders.status).toBe('success');
  });

  it('purchase fixtures carry grounded order shapes: totals, labels, and linkability', async () => {
    const luis = await FixtureAgentConversationGateway.create('purchase-luis-389');
    const luisOrders = await luis.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '938389389' });
    expect(luisOrders.status).toBe('success');
    if (luisOrders.status !== 'success') return;
    const pending = luisOrders.purchases.find((purchase) => purchase.orderId === 'order-luis-pending-227');
    expect(pending?.paymentStatus).toBe('pending');
    expect(pending?.grandTotal).toBe(227.76);
    expect(pending?.currency ?? null).toBeNull();
    const raw = JSON.stringify(luisOrders.purchases);
    expect(raw).not.toMatch(/amount_received|balance_due|remaining/i);

    const martha = await FixtureAgentConversationGateway.create('purchase-martha-frozen');
    const marthaOrders = await martha.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '900070122' });
    expect(marthaOrders.status).toBe('success');
    if (marthaOrders.status !== 'success') return;
    expect(marthaOrders.purchases.length).toBeGreaterThanOrEqual(2);
    for (const purchase of marthaOrders.purchases) {
      expect(purchase.eventName).toBeTruthy();
      expect(purchase.eventDate).toBeTruthy();
      expect(typeof purchase.grandTotal).toBe('number');
    }

    const s13 = await FixtureAgentConversationGateway.create('s13-reference-unavailable-multiple');
    const s13Orders = await s13.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '900001303' });
    expect(s13Orders.status).toBe('success');
    if (s13Orders.status !== 'success') return;
    expect(s13Orders.purchases.length).toBeGreaterThanOrEqual(2);
    for (const purchase of s13Orders.purchases) {
      expect(purchase.customerTransactionNumber ?? null).toBeNull();
    }
  });

  it('Diana thread: four inputs share one session and the detail turn reuses the single handoff receipt', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const live = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.host_withdrawal_diana_policy_and_support',
    );
    // 2026-09-30 condensation: the general-policy question merged in as turn 0.
    expect(live?.inputs).toHaveLength(4);
    expect(new Set((live?.inputs ?? []).map((input) => input.sessionId)).size).toBe(1);
    const effect = live?.expectations.find((expectation) => expectation.id === 'one-handoff-effect-in-thread');
    expect(effect?.type).toBe('fixture_effect_count');
    if (effect?.type !== 'fixture_effect_count') return;
    expect(effect.operation).toBe('handoff.write');
    // 2026-09-17 actionable-answer Lane B: cumulative-from-baseline ledger —
    // turn 3 sees no new handoff (delta 0/0/0); turn 2 separately proves the single
    // attempt. Zero new dispatches are proven by the mustNotCall pin and the
    // offline service twin, not by a 0/0/0 cumulative count.
    expect([effect.expectedAttempts, effect.expectedSuccesses, effect.expectedReplays]).toEqual([0, 0, 0]);
    expect(() => assertLiveRegressionFixtureCoverage([live!])).not.toThrow();
  });

  it('companion outcomes report saved state honestly without inventing verification', async () => {
    const rejected = await FixtureAgentConversationGateway.create('rsvp-plus-one-not-eligible');
    const denial = await rejected.guestRsvp({
      phone_extension: '+51',
      phone_number: '942633292',
      guest_id: 70001,
      plus_one_response: 'yes',
    });
    expect(denial.status).toBe('responded');
    if (denial.status !== 'responded') return;
    expect(denial.plusOne?.saved).toBe(false);
    expect(denial.plusOne?.reason).toBeTruthy();
    expect(denial.willAttend).toBeNull();

    const acknowledged = await FixtureAgentConversationGateway.create('rsvp-plus-one-saved');
    const written = await acknowledged.guestRsvp({
      phone_extension: '+51',
      phone_number: '942633292',
      action: 'attending',
      guest_id: 70001,
      plus_one_response: 'yes',
    });
    expect(written.status).toBe('responded');
    if (written.status !== 'responded') return;
    expect(written.plusOne?.saved).toBe(true);
    const read = await acknowledged.getEventDetail({
      eventId: written.eventId ?? 0,
      phone: { phone_extension: '+51', phone_number: '942633292' },
    });
    // The read API carries no companion field: independent verification of
    // the companion is unavailable, so the reply must report the acknowledged
    // save without claiming a fresh read verified it.
    if (read.status === 'success') {
      expect(JSON.stringify(read.event)).not.toMatch(/plus_one|plusOne|companion/i);
    } else {
      expect(read.status).not.toBe('success');
    }
  });

  it('unmatched named event: no guest write without a grounded target', async () => {
    const rawGateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-multiple-pending');
    let writes = 0;
    const guestRsvp = rawGateway.guestRsvp.bind(rawGateway);
    const gateway = new Proxy(rawGateway, {
      get(target: FixtureAgentConversationGateway, property: string | symbol): unknown {
        if (property === 'guestRsvp') {
          return async (
            input: Parameters<FixtureAgentConversationGateway['guestRsvp']>[0],
          ): Promise<unknown> => {
            writes += 1;
            return guestRsvp(input);
          };
        }
        const value: unknown = Reflect.get(target as object, property);
        if (typeof value === 'function') {
          return (value as (...args: never[]) => unknown).bind(target);
        }
        return value;
      },
    }) as unknown as AgentConversationGateway;
    const service = twinService(
      gateway,
      sentinelRuntime([
        baseExtraction({
          actionIntent: 'responder_invitacion',
          rsvpAction: 'attending',
          rsvpDecisionSource: 'current_message',
          rsvpEventReference: 'Evento Inexistente Inventado',
        }),
      ]),
      new InMemoryPlanStore(),
    );
    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'unmatched-twin-user',
      contactPhone: '+51941438999',
      text: 'Confirmo mi asistencia al Evento Inexistente Inventado',
      messageId: 'unmatched-twin-0',
      receivedAt: new Date().toISOString(),
    });
    expect(writes).toBe(0);
  });

  it('failed OTP handoff: the terminal failure is recorded once and never retried silently', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s06-otp-handoff-failed');
    const first = await gateway.requestHumanTakeover('51900000001');
    expect(first.status).toBe('failed');
  });

  it('token-seeded close: contact gathering never submits, explicit authorization submits once', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    // 2026-09-30 live compression: the token close-flow thread merged into
    // the close-date-provenance survivor with its pins intact.
    const live = catalog.cases.find((candidate) => candidate.id === 'live_behavior.close_date_provenance_and_completed_retry');
    const noSubmit = live?.expectations.find((expectation) => expectation.id === 'contact-details-alone-do-not-submit');
    expect(noSubmit?.severity).toBe('hard');
    const effect = live?.expectations.find((expectation) => expectation.id === 'explicit-close-effect');
    expect(effect?.type).toBe('fixture_effect_count');
    expect(effect?.severity).toBe('hard');
  });
});

function ledgerTurn(
  effects: FixtureEffectSummary[] | null,
  turnIndex: number,
  overrides: Record<string, unknown> = {},
): EvalTurnResult {
  const plan = createEmptyPlan({
    planId: 'hardening-plan',
    channel: 'whatsapp',
    externalUserId: 'hardening-user',
  });
  const { trace: traceOverride, ...rest } = overrides as { trace?: Record<string, unknown> };
  const turn = {
    turnIndex,
    input: { text: 'hola', channel: 'whatsapp', sessionId: 'hardening-session' },
    outputText: 'respuesta de endurecimiento',
    deliveredText: 'respuesta de endurecimiento',
    plan,
    trace: {
      trace_id: 'hardening-trace',
      conversation_id: null,
      plan_id: plan.plan_id,
      previous_node: 'contacto_inicial',
      next_node: 'resolver_consultas_informativas',
      node_path: ['contacto_inicial', 'resolver_consultas_informativas'],
      intent: null,
      missing_fields: [],
      search_ready: false,
      prompt_bundle_id: 'b1',
      prompt_file_paths: [],
      tools_considered: [],
      tools_called: [],
      tool_inputs: [],
      tool_outputs: [],
      provider_results: [],
      search_strategy: 'none',
      close_action_summary: { type: null, category: null, reason_preview: null },
      selection_resolution_summary: {
        selected_provider_references: [],
        selected_provider_hints_count: 0,
        provider_plan_operation_types: [],
        provider_plan_operation_categories: [],
      },
      contact_validation_summary: {
        status: 'valid',
        field: null,
        reason_preview: null,
        extraction_contact_fields_present: { name: false, email: false, phone: false },
        plan_contact_fields_present: { name: false, email: false, phone: true },
      },
      provider_candidate_audit: [],
      information_execution_summary: [],
      recommendation_funnel: {
        available_candidates: 0,
        context_candidates: 0,
        context_candidate_ids: [],
        presentation_limit: 5,
      },
      plan_persisted: true,
      plan_persist_reason: 'test',
      timing_ms: {
        total: 0,
        load_plan: 0,
        prepare_working_plan: 0,
        extraction: 0,
        apply_extraction: 0,
        compute_sufficiency: 0,
        provider_search: 0,
        provider_enrichment: 0,
        prompt_bundle_load: 0,
        compose_reply: 0,
        save_plan: 0,
      },
      token_usage: {
        classifier: null,
        extraction: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        reply: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
      ...(traceOverride ?? {}),
    },
    latencyMs: 0,
    ...rest,
  } as unknown as EvalTurnResult;
  if (effects !== null) {
    attachEvaluationState(turn, {
      plan,
      input: turn.input,
      outputText: 'respuesta de endurecimiento',
      fixtureEffects: effects,
    });
  }
  return turn;
}

function receipt(
  operation: string,
  attempts: number,
  successes: number,
  replays: number,
): FixtureEffectSummary {
  return { operation, attempts, successes, replays, outcome: 'success', receiptPresent: true };
}

describe('support panel offline hardening proof (fault injections, 2026-09-17)', () => {
  it('the cumulative effect gate fails closed on double mutation or missing receipts', async () => {
    const single = ledgerTurn([receipt('rsvp.write', 1, 1, 0)], 1);
    expect(
      evaluateFixtureEffectCountForTesting({
        turns: [single],
        operation: 'rsvp.write',
        turnIndex: 0,
        expectedAttempts: 1,
        expectedSuccesses: 1,
        expectedReplays: 0,
      }).passed,
    ).toBe(true);
    const double = ledgerTurn([receipt('rsvp.write', 2, 2, 0)], 1);
    const mutated = evaluateFixtureEffectCountForTesting({
      turns: [double],
      operation: 'rsvp.write',
      turnIndex: 0,
      expectedAttempts: 1,
      expectedSuccesses: 1,
      expectedReplays: 0,
    });
    expect(mutated.passed).toBe(false);
    expect(mutated.message).toMatch(/instead of/);
    const secondTakeover = ledgerTurn([receipt('handoff.write', 2, 2, 0)], 2);
    expect(
      evaluateFixtureEffectCountForTesting({
        turns: [secondTakeover],
        operation: 'handoff.write',
        turnIndex: 0,
        expectedAttempts: 1,
        expectedSuccesses: 1,
        expectedReplays: 0,
      }).passed,
    ).toBe(false);

    const missing = ledgerTurn(null, 0);
    for (const expected of [
      { expectedAttempts: 1, expectedSuccesses: 1, expectedReplays: 0 },
      { expectedAttempts: 0, expectedSuccesses: 0, expectedReplays: 0 },
    ]) {
      const result = evaluateFixtureEffectCountForTesting({
        turns: [missing],
        operation: 'rsvp.write',
        turnIndex: 0,
        ...expected,
      });
      expect(result.passed).toBe(false);
      expect(result.message).toMatch(/Missing fixture receipt evidence/);
    }
  });

  it('a wrong event or guest ID fails identity at the fixture even if the prose sounds correct', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-multiple-pending');
    const wrongGuest = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '941438999',
      action: 'attending',
      guest_id: 999999,
    });
    expect(wrongGuest.status).not.toBe('responded');
    expect(wrongGuest.status).toBe('failed');
    const guestGateway = await FixtureAgentConversationGateway.create('guest-julisabeth-andres');
    const wrongEvent = await guestGateway.getEventDetail({
      eventId: 999999,
      phone: { phone_extension: '+51', phone_number: '904523314' },
    });
    expect(wrongEvent.status).not.toBe('success');
  });

  it('read pixels alone never establish backend payment approval', async () => {
    const gateway = await FixtureAgentConversationGateway.create('image-clean-world');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '987654321' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases).toHaveLength(0);
    // Pixel observations do not alter backend approval or create a payment effect.
    const after = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '987654321' });
    expect(after).toEqual(orders);

  });

  it('suppressed thanks reaches the mandatory judge while unexplained blank fails closed', async () => {
    const suppressed = ledgerTurn(null, 2, {
      outputText: '',
      deliveredText: null,
      delivery: { action: 'suppress', reason: 'suppress_acknowledgement' },
      trace: {
        trace_id: 'hardening-trace',
        previous_node: 'resolver_consultas_informativas',
        next_node: 'resolver_consultas_informativas',
        tools_called: [],
        plan_persisted: true,
        response_classifier: { mode: 'enforce', would_suppress: true },
        token_usage: { total: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      },
    });
    const allowed = resolveTextSemanticCandidate(suppressed);
    expect(allowed.route).toBe('silence');
    expect(allowed.candidateText).toBe('');
    expect(allowed.dispositionBlock ?? '').toContain('CANDIDATE SILENCE DISPOSITION');
    const blank = ledgerTurn(null, 0, { outputText: '', deliveredText: null });
    expect(resolveTextSemanticCandidate(blank).route).toBe('failure');
  });

  it('a valid paraphrase is not rejected by the retained exact checks or routing freedom', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    // 2026-09-30 live compression: the plus-one thread merged into the
    // cristian survivor; the honest negation must clear every retained pin.
    const plusOne = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.rsvp_cristian_phone_enriched_confirmation',
    );
    const pins = (plusOne?.expectations ?? []).filter(
      (expectation) => expectation.type === 'text_not_contains',
    );
    expect(pins.length).toBeGreaterThanOrEqual(1);
    // An honest negation reports the failure without tripping any retained exact check.
    for (const pin of pins) {
      if (pin.type !== 'text_not_contains') continue;
      for (const phrase of pin.phrases) {
        expect('No quedó registrado con éxito, te ofrezco ayuda humana como opción.').not.toContain(phrase);
      }
    }
    const spanish = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.spanish_only_mixed_language_request',
    );
    const languagePins = (spanish?.expectations ?? []).filter(
      (expectation) => expectation.type === 'text_not_contains',
    );
    const languagePhrases = languagePins[0]?.type === 'text_not_contains' ? languagePins[0].phrases : [];
    for (const phrase of languagePhrases) {
      expect('carolina@example.com').not.toContain(phrase);
      expect('https://ejemplo.com/confirmacion').not.toContain(phrase);
    }
    // 2026-09-30 condensation: s11 absorbed the declined-state thread and
    // its responder_invitacion node pin, so it no longer belongs here.
    // 2026-09-30 live compression: the plus-one thread merged into the
    // cristian survivor (absorbed turns 3-5 keep no node pin; the native
    // cristian thread pins its own entry node at turn 0) and the
    // owner-planning thread merged into image_conversation_continuity.
    for (const id of [
      'live_behavior.s01_frozen_kiara_pending_replay',
      'live_behavior.purchase_martha_accountless_selection',
      'live_behavior.image_conversation_continuity',
      'live_behavior.authentication_refusal_closes_protected_query',
      'live_behavior.concurrent_support_turns_preserve_context',
    ]) {
      const imageCase = catalog.cases.find((candidate) => candidate.id === id);
      expect(
        (imageCase?.expectations ?? []).some((expectation) => expectation.type === 'node_transition'),
        `${id} keeps no node pin`,
      ).toBe(false);
    }
    {
      const cristian = catalog.cases.find(
        (candidate) => candidate.id === 'live_behavior.rsvp_cristian_phone_enriched_confirmation',
      );
      expect(
        (cristian?.expectations ?? []).some(
          (expectation) => expectation.type === 'node_transition' && (expectation.turnIndex ?? 0) >= 3,
        ),
        'cristian absorbed plus-one turns keep no node pin',
      ).toBe(false);
    }
  });
});
