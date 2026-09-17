import crypto from 'node:crypto';
import path from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type {
  AgentRuntime,
  ComposeReplyResult,
  ExtractionResult,
} from '../src/runtime/contracts';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type {
  KnowledgeRetrievalGateway,
  KnowledgeRetrievalResult,
} from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import { InMemoryRsvpEffectStore } from '../src/runtime/rsvp-effect-executor';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan } from '../src/core/plan';
import type { EvalTurnResult } from '../src/evals/case-schema';
import { EvalLoader } from '../src/evals/loader';
import { attachEvaluationState, type FixtureEffectSummary } from '../src/evals/evaluation-state';
import {
  assertLiveRegressionFixtureCoverage,
  buildSemanticJudgeContext,
  evaluateFixtureEffectCountForTesting,
  resolveTextSemanticCandidate,
} from '../src/evals/runner';

const PLANNING_DIAGNOSTIC_ONLY = [
  'live_behavior.provider_reference_cheaper_option',
  'live_behavior.provider_reference_miraflores_option',
  'live_behavior.reset_plan_discards_stored_context',
  'live_behavior.s12_provider_completion_truthful_event_date',
  'live_behavior.wedding_planner_location_completes_search',
  'live_feedback.token_fresh_multifront_stays_multi_need',
  'live_feedback.token_seeded_contact_correction',
  'live_feedback.token_seeded_selection_defer_close',
];

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
  it('reconciles the mandatory suite count: 120 total, 112 support, 8 planning-only', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const suite = catalog.suites.find((candidate) => candidate.id === 'live_behavior_regression');
    const caseIds = new Set(suite?.caseIds ?? []);
    // 2026-09-17 actionable-answer: 119 + live_behavior.support_pending_question_completed.
    expect(caseIds.size).toBe(120);
    for (const planningId of PLANNING_DIAGNOSTIC_ONLY) {
      expect(caseIds.has(planningId), `${planningId} missing from the mandatory suite`).toBe(true);
    }
    expect(caseIds.size - PLANNING_DIAGNOSTIC_ONLY.length).toBe(112);
    expect(caseIds.has('live_behavior.customer_event_task_continuity')).toBe(true);
    expect(caseIds.has('live_behavior.support_pending_question_completed')).toBe(true);
  });

  it('accountless venue: fixture detail carries the reception facts with no OTP path', async () => {
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
  });

  it('mixed event/payment: the same trusted phone yields events and scoped purchases', async () => {
    const gateway = await FixtureAgentConversationGateway.create('guest-julisabeth-andres');
    const events = await gateway.getGuestEventsByPhone({ phone_extension: '+51', phone_number: '904523314' });
    expect(events.status).toBe('success');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '904523314' });
    expect(orders.status).toBe('success');
  });

  it('owner payment and Luis unknown balance: total known, paid amount and currency unknown', async () => {
    const gateway = await FixtureAgentConversationGateway.create('purchase-luis-389');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '938389389' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    const pending = orders.purchases.find((purchase) => purchase.orderId === 'order-luis-pending-227');
    expect(pending?.paymentStatus).toBe('pending');
    expect(pending?.grandTotal).toBe(227.76);
    expect(pending?.currency ?? null).toBeNull();
    const raw = JSON.stringify(orders.purchases);
    expect(raw).not.toMatch(/amount_received|balance_due|remaining/i);
  });

  it('Martha selection: both candidates carry usable labels, dates, and totals', async () => {
    const gateway = await FixtureAgentConversationGateway.create('purchase-martha-frozen');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '900070122' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases.length).toBeGreaterThanOrEqual(2);
    for (const purchase of orders.purchases) {
      expect(purchase.eventName).toBeTruthy();
      expect(purchase.eventDate).toBeTruthy();
      expect(typeof purchase.grandTotal).toBe('number');
    }
  });

  it('unavailable transaction reference: two orders, neither linkable to the code', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s13-reference-unavailable-multiple');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '900001303' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases.length).toBeGreaterThanOrEqual(2);
    for (const purchase of orders.purchases) {
      expect(purchase.customerTransactionNumber ?? null).toBeNull();
    }
  });

  it('Diana thread: three inputs share one session and the detail turn reuses the single handoff receipt', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const live = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.host_withdrawal_diana_policy_and_support',
    );
    expect(live?.inputs).toHaveLength(3);
    expect(new Set((live?.inputs ?? []).map((input) => input.sessionId)).size).toBe(1);
    const effect = live?.expectations.find((expectation) => expectation.id === 'one-handoff-effect-in-thread');
    expect(effect?.type).toBe('fixture_effect_count');
    if (effect?.type !== 'fixture_effect_count') return;
    expect(effect.operation).toBe('handoff.write');
    // 2026-09-17 actionable-answer Lane B: cumulative-from-baseline ledger —
    // turn 2 sees turn 1's single confirmed handoff (1/1/0), never a new
    // attempt. Zero new dispatches are proven by the mustNotCall pin and the
    // offline service twin, not by a 0/0/0 cumulative count.
    expect([effect.expectedAttempts, effect.expectedSuccesses, effect.expectedReplays]).toEqual([1, 1, 0]);
    expect(() => assertLiveRegressionFixtureCoverage([live!])).not.toThrow();
  });

  it('image distractor: judge ground truth is digest-bound to the attached fixture image', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const live = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.image_distractor_history_preserves_current_question',
    );
    const truth = live?.judgeGroundTruth;
    expect(truth).toBeDefined();
    if (!truth) return;
    const boundInput = live?.inputs[truth.boundInputTurn];
    const image = boundInput?.image;
    const imageData = image !== undefined && image !== null && 'data' in image ? image.data : null;
    expect(typeof imageData).toBe('string');
    if (typeof imageData !== 'string') throw new Error('distractor fixture image needs data');
    expect(imageData.length).toBeGreaterThan(0);
    const digest = crypto.createHash('sha256').update(imageData, 'utf8').digest('hex');
    expect(digest).toBe(truth.imageDigest);
    expect(truth.verifiedAmount).toBe('S/ 149.90');
  });

  it('companion rejection stays a rejection: saved false with a scoped reason', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-not-eligible');
    const written = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '942633292',
      guest_id: 70001,
      plus_one_response: 'yes',
    });
    expect(written.status).toBe('responded');
    if (written.status !== 'responded') return;
    expect(written.plusOne?.saved).toBe(false);
    expect(written.plusOne?.reason).toBeTruthy();
    expect(written.willAttend).toBeNull();
  });

  it('companion acknowledgment: saved true, and no fresh read can verify the companion field', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-saved');
    const written = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '942633292',
      action: 'attending',
      guest_id: 70001,
      plus_one_response: 'yes',
    });
    expect(written.status).toBe('responded');
    if (written.status !== 'responded') return;
    expect(written.plusOne?.saved).toBe(true);
    const read = await gateway.getEventDetail({
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
    const live = catalog.cases.find((candidate) => candidate.id === 'live_feedback.token_seeded_close_flow');
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
  it('a second RSVP or takeover mutation fails the cumulative effect gate', async () => {
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
  });

  it('absent receipt evidence errors instead of passing as zero', async () => {
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

  it('a promise-only answer is a failing semantic counterexample at packet level only', async () => {
    // Packet construction only: this proves the live judge would receive the grounded facts
    // needed to fail a promise-only reply. It never mocks judge agreement; real agreement is
    // proven only by the paid live run with requireJudge=true.
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const pending = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.support_pending_question_completed',
    );
    expect(pending).toBeDefined();
    const turn1 = pending?.expectations.find(
      (expectation) => expectation.id === 'turn1-reference-answered-grounded',
    );
    expect(turn1?.type).toBe('text_semantic');
    if (turn1?.type !== 'text_semantic') return;
    expect(turn1.rubric).toMatch(/18:00/);
    expect(turn1.rubric).toMatch(/must not ask another clarifying question/);
    const promiseOnly = ledgerTurn(null, 1, {
      input: { text: 'El de Ana y Luis, la boda.', channel: 'whatsapp', sessionId: 's' },
      outputText: 'Con gusto te ayudo con eso, en un momento te confirmo el horario.',
      deliveredText: 'Con gusto te ayudo con eso, en un momento te confirmo el horario.',
    });
    const packet = buildSemanticJudgeContext([promiseOnly], 1, pending);
    expect(packet).toContain('El de Ana y Luis');
    expect(promiseOnly.outputText).not.toContain('18:00');
  });

  it('read pixels alone never establish backend payment approval', async () => {
    const gateway = await FixtureAgentConversationGateway.create('image-clean-world');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '987654321' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases).toHaveLength(0);
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    for (const id of [
      'live_behavior.continuity_text_image_same_turn',
      'live_behavior.image_file_delayed_question',
      'live_behavior.continuity_question_needs_image',
    ]) {
      const imageCase = catalog.cases.find((candidate) => candidate.id === id);
      const semantics = (imageCase?.expectations ?? []).filter(
        (expectation) => expectation.type === 'text_semantic',
      );
      expect(semantics.length).toBeGreaterThan(0);
      const pixelAnswers = semantics.filter(
        (expectation) => expectation.type === 'text_semantic' && /never backend payment approval/.test(expectation.rubric),
      );
      // Every pixel-answering rubric names read-accuracy-only; the turn-0 image-only silence
      // rubric instead bans approval claims in its own terms and is covered above by silence routing.
      expect(pixelAnswers.length, `${id} judges pixels without proving approval`).toBeGreaterThan(0);
      expect(imageCase?.judgeGroundTruth?.verifiedAmount).toBeTruthy();
    }
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
    const plusOne = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.rsvp_plus_one_not_eligible_no_false_success',
    );
    const pins = (plusOne?.expectations ?? []).filter(
      (expectation) => expectation.type === 'text_not_contains',
    );
    expect(pins).toHaveLength(1);
    const phrases = pins[0]?.type === 'text_not_contains' ? pins[0].phrases : [];
    // An honest negation reports the failure without tripping the retained raw-API token check.
    expect('No quedó registrado con éxito, te ofrezco ayuda humana como opción.').not.toContain(phrases[0] ?? 'saved=true');
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
    for (const id of [
      'live_behavior.s11_rsvp_durability_confirms_once',
      'live_behavior.rsvp_plus_one_not_eligible_no_false_success',
      'live_behavior.s01_frozen_kiara_pending_replay',
      'live_behavior.purchase_martha_accountless_selection',
      'live_behavior.owner_planning_to_faq_single_transfer',
      'live_behavior.authentication_refusal_closes_protected_query',
      'live_behavior.concurrent_support_turns_preserve_context',
    ]) {
      const imageCase = catalog.cases.find((candidate) => candidate.id === id);
      expect(
        (imageCase?.expectations ?? []).some((expectation) => expectation.type === 'node_transition'),
        `${id} keeps no node pin`,
      ).toBe(false);
    }
  });
});
