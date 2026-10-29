import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { ExtractionResult } from '../src/runtime/contracts';
import { AgentService } from '../src/runtime/agent-service';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type {
  MessageResponseClassifier,
  MessageResponseClassifierResult,
} from '../src/runtime/message-response-classifier';
import { OpenAiSupportLaneRouter } from '../src/runtime/decisions-router-lane';
import { loadRouterQuestions } from '../src/runtime/decisions-router-questions';
import type { RouterRoute } from '../src/runtime/decisions-router-questions';
import { assertOpenAiStructuredSchemaCompatible } from '../src/runtime/openai-structured-schema';
import { genericMessageSchema } from '../src/runtime/structured-message';
import { supportReplySidecarSchema, isCustomerAssistanceTurn } from '../src/runtime/support-lane-flow';
import { zodTextFormat } from 'openai/helpers/zod';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  KnowledgeRetrievalGateway,
  KnowledgeRetrievalResult,
} from '../src/runtime/knowledge-retrieval-gateway';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { ScriptedAgentRuntime } from './agent-runtime-test-utils';

/**
 * WP3 — the customer-assistance lane.
 *
 * The router replaces the classifier on this lane: text, image and
 * media-only turns reach one shared router entry, the extractor does not run
 * on a support turn, and the reply is one composition with a sidecar beside
 * the message.
 *
 * The router is stubbed at its transport boundary (a fake `fetchImpl`), so
 * the real client, the real policy and the real input builder are exercised
 * without any network call.
 */

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = {
  terminal_whatsapp: new WhatsAppMessageRenderer(),
};

/** Dossier case C: one approved purchase with the host receipt present. */
const CASE_C_SCENARIO = 'purchase-approved-host-receipt-refund';
const CASE_C_PHONE = '+51900000403';
const CASE_C_ORDER_ID = 'ORD_6ab970ab70802';

/** Dossier case A: a receipt with no purchase record on the backend. */
const CASE_A_SCENARIO = 'purchase-yape-receipt-no-match';
const CASE_A_PHONE = '+51900000401';

/** Dossier case D: the only readable record is the declined card attempt. */
const CASE_D_SCENARIO = 'purchase-declined-card-transfer-pending';
const CASE_D_PHONE = '+51900000404';

/** One scripted router answer: the three facts the router states. */
type RouterAnswers = {
  readonly route: RouterRoute;
  readonly sameOpenRequest: boolean;
  readonly selectedRequestKey?: string;
  readonly requestSettled: boolean;
};

/** The transport script: one answer, one per call, or a hard failure. */
type RouterScript =
  | RouterAnswers
  | readonly RouterAnswers[]
  | { readonly unavailable: true };

function decisionsPayload(answers: RouterAnswers, requestBody: string): unknown {
  const request = JSON.parse(requestBody) as { questions: { name: string; choices: { value: string }[] }[] };
  const requestChoices = request.questions.find((question) => question.name === 'same_open_request')?.choices ?? [];
  const sameOpenRequest = (answers.selectedRequestKey ? `request:${answers.selectedRequestKey}` : undefined) ?? (answers.sameOpenRequest ? requestChoices.filter((choice) => choice.value !== 'new').at(-1)?.value ?? 'new' : 'new');
  const requestSettled = answers.requestSettled ? 'settled' : 'open';
  const values: Record<string, string> = {
    route: answers.route,
    same_open_request: sameOpenRequest,
    request_settled: requestSettled,
  };
  // The GA API requires 2-255 choices, so the client omits same_open_request
  // when no request is retained. The stub answers exactly the questions sent.
  return {
    id: 'dec_router_test',
    answers: request.questions.map((question) => {
      const choice = values[question.name] ?? 'new';
      return {
        type: 'choice',
        name: question.name,
        choice,
        probabilities: [{ value: choice, probability: 0.9 }],
      };
    }),
  };
}

/** The scripted answers, consumed in turn order; the last one repeats. */
function routerScriptAnswers(
  script: RouterScript,
): readonly (RouterAnswers | { readonly unavailable: true })[] {
  return Array.isArray(script)
    ? (script as readonly RouterAnswers[])
    : [script as RouterAnswers | { readonly unavailable: true }];
}

/**
 * The stubbed router transport. It records every call so a test can prove
 * the router did or did not run.
 */
function routerFetch(script: RouterScript) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const answers = routerScriptAnswers(script);
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const index = calls.length;
    calls.push(url);
    bodies.push(typeof init?.body === 'string' ? init.body : '');
    const next = answers[Math.min(index, answers.length - 1)];
    if (next === undefined || 'unavailable' in next) {
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    }
    return new Response(JSON.stringify(decisionsPayload(next, typeof init?.body === 'string' ? init.body : '')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls, bodies, fetchImpl };
}

function buildRouter(args: {
  readonly enabled: boolean;
  readonly answers: RouterScript;
}): { router: OpenAiSupportLaneRouter; calls: string[]; bodies: string[] } {
  const stub = routerFetch(args.answers);
  const router = new OpenAiSupportLaneRouter({
    enabled: args.enabled,
    apiKey: 'test-key',
    baseUrl: 'https://api.example.test/v1',
    model: 'gpt-6-luna',
    timeoutMs: 5_000,
    promptLoader,
    fetchImpl: stub.fetchImpl,
  });
  return { router, calls: stub.calls, bodies: stub.bodies };
}

/** A classifier double that records the preflight calls. */
class RecordingClassifier implements MessageResponseClassifier {
  readonly mode = 'enforce' as const;
  calls = 0;

  async classify(): Promise<MessageResponseClassifierResult> {
    this.calls += 1;
    return {
      trace: {
        mode: this.mode,
        classifier_profile: 'general',
        action: 'respond',
        reason: 'requires_response',
        would_suppress: false,
        context_source: 'agent_api',
        has_prior_outbound_message: false,
        fallback_used: false,
        conversation_health: 'progressing',
        health_reason: 'normal_progress',
        human_help_response: 'not_applicable',
        campaign_reply_kind: 'not_applicable',
        automation_confidence: 'not_automated',
        automation_pattern: 'none',
        automation_scope: 'none_or_uncertain',
        prompt_bundle_id: null,
        prompt_file_paths: [],
      },
      tokenUsage: null,
    };
  }
}

function knowledgeGateway(): KnowledgeRetrievalGateway {
  return {
    search: async (): Promise<KnowledgeRetrievalResult> => ({
      status: 'success',
      evidence: [],
    }),
  };
}

function providerGateway(): ProviderGateway {
  return {
    requestUserLoginCode: async () => ({ status: 'sent' as const }),
    verifyUserLoginCode: async () => ({
      status: 'authenticated' as const,
      token: 'shared-jwt',
      tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    lookupAuthenticatedUserEvents: async (): Promise<UserEventLookupResult> => ({
      lookup: { email: 'customer@example.com', phone: null },
      user: { id: 1, fullName: 'Customer', email: 'customer@example.com', fullPhone: null },
      events: [],
      counts: {
        ownerEvents: 0,
        guestEvents: 0,
        hostEvents: 0,
        celebratedEvents: 0,
        recentOrders: 0,
      },
    }),
  } as unknown as ProviderGateway;
}

function emptyExtraction(): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    intentConfidence: 0.9,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
    },
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
    conversationSummary: 'Support turn.',
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
  };
}

async function createService(args: {
  readonly runtime: ScriptedAgentRuntime;
  readonly gateway: FixtureAgentConversationGateway;
  readonly planStore?: InMemoryPlanStore;
  readonly router?: OpenAiSupportLaneRouter;
  readonly responseClassifier?: MessageResponseClassifier;
}): Promise<AgentService> {
  const provider = providerGateway();
  return new AgentService({
    planStore: args.planStore ?? new InMemoryPlanStore(),
    runtime: args.runtime,
    providerGateway: provider,
    promptLoader,
    renderers,
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: knowledgeGateway(),
      providerGateway: provider,
      agentGateway: args.gateway,
    }),
    agentConversationGateway: args.gateway,
    ...(args.router ? { supportLaneRouter: args.router } : {}),
    ...(args.responseClassifier ? { responseClassifier: args.responseClassifier } : {}),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('decisions router: the customer-assistance lane gate', () => {
  // R2: the router owns the customer-assistance lane only. A turn with an
  // in-flight obligation outside that lane keeps the established flow: the
  // classifier preflight and the extractor.
  it('decides the lane from typed plan state only', () => {
    const fresh = createEmptyPlan({
      planId: 'lane-gate-fresh',
      channel: 'whatsapp',
      externalUserId: 'lane-gate-fresh',
    });
    expect(isCustomerAssistanceTurn(fresh)).toBe(true);

    const planning = mergePlan(fresh, {
      active_need_category: 'Fotografía y video',
      provider_needs: [{
        category: 'Fotografía y video',
        status: 'identified',
        preferences: [],
        hard_constraints: [],
        missing_fields: [],
        recommended_provider_ids: [],
        recommended_providers: [],
        sub_query_results: [],
        selected_provider_ids: [],
        selected_provider_hints: [],
      }],
    });
    expect(isCustomerAssistanceTurn(planning)).toBe(false);

    const rsvp = mergePlan(fresh, {
      rsvp_state: {
        status: 'awaiting_action',
        pending_action: 'attending',
        pending_plus_one_response: null,
        candidates: [],
        requested_at: '2026-10-20T00:00:00.000Z',
        selection_attempts: 0,
      },
    });
    expect(isCustomerAssistanceTurn(rsvp)).toBe(false);

    const auth = mergePlan(fresh, {
      user_auth: {
        status: 'code_requested',
        email: 'customer@example.com',
        requested_at: '2026-10-20T00:00:00.000Z',
      },
    });
    expect(isCustomerAssistanceTurn(auth)).toBe(false);

    // A support thread (no obligation) is a customer-assistance turn.
    const support = mergePlan(fresh, {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: 'resolver_consultas_informativas',
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: {
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Compra anterior',
          orderId: null,
          authAction: 'none',
        },
      },
    });
    expect(isCustomerAssistanceTurn(support)).toBe(true);
  });

  it('does not reach the router when the plan carries an in-flight obligation', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const classifier = new RecordingClassifier();
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'lane-gate-planning',
        channel: 'whatsapp',
        externalUserId: 'lane-gate-planning',
      }), {
        current_node: 'elicitacion_necesidades',
        active_need_category: 'Fotografía y video',
        event_type: 'boda',
      }),
    });
    const service = await createService({
      runtime, gateway, router, planStore, responseClassifier: classifier,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'lane-gate-planning',
      contactPhone: CASE_C_PHONE,
      messageId: 'lane-gate-planning-1',
      receivedAt: new Date().toISOString(),
      text: 'QuieroContractual fotos para una boda.',
    });

    // The router never ran: the planning lane keeps the established flow.
    expect(calls).toEqual([]);
    expect(classifier.calls).toBe(1);
    expect(runtime.extractRequests.length).toBeGreaterThan(0);
    expect(response.trace.router_decision).toBeUndefined();
  });

  it('runs the classifier preflight when the router routes a turn to planning', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'planning_flow', sameOpenRequest: false, requestSettled: false },
    });
    const classifier = new RecordingClassifier();
    const service = await createService({
      runtime, gateway, router, responseClassifier: classifier,
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'lane-gate-planning-route',
      contactPhone: CASE_C_PHONE,
      messageId: 'lane-gate-planning-route-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero un plan de proveedores para una boda.',
    });

    // The router ran, and the planning lane keeps its classifier preflight.
    expect(calls.length).toBeGreaterThan(0);
    expect(classifier.calls).toBe(1);
    expect(runtime.extractRequests.length).toBeGreaterThan(0);
  });
});

describe('decisions router: the reply sidecar contract', () => {
  // R4: the sidecar fields reach the model through the reply output schema.
  // The description is the contract the model reads, so it must survive the
  // strict-schema conversion.
  it('carries the sidecar descriptions into the schema sent to the model', () => {
    const schema = genericMessageSchema.extend({
      cited_order_ids: supportReplySidecarSchema.shape.cited_order_ids,
      reported_payment: supportReplySidecarSchema.shape.reported_payment,
      claimed_handoff: supportReplySidecarSchema.shape.claimed_handoff,
    });
    const format = zodTextFormat(schema, 'reply');
    const properties = (format.schema as {
      properties: Record<string, { description?: string }>;
    }).properties;

    expect(properties['cited_order_ids']?.description).toContain('order ids this answer relies on');
    expect(properties['reported_payment']?.description).toContain('the CLIENT reported');
    expect(properties['reported_payment']?.description).toContain('NOT the payment of the record');
    expect(properties['claimed_handoff']?.description).toContain('human handoff');
  });
});

describe('decisions router: the route contract', () => {
  // R5: the router input already carries the open-offer state, and the
  // route question tells the router that an accepted offer is an
  // escalation. The accept stays typed (the offer state plus the router's
  // decision): no keyword matching, no extra call.
  it('tells the router that an accepted human offer is an escalation', async () => {
    const questions = await loadRouterQuestions(promptLoader);
    const route = questions.questions.find((question) => question.name === 'route');
    expect(route?.type).toBe('choice');
    if (route?.type !== 'choice') return;
    expect(route.instructions).toContain('derivacion_pendiente');
    expect(route.instructions).toContain('escalate_human');
  });
});

describe('decisions router: customer-assistance lane', () => {
  it('keeps the classifier path untouched while the lane flag is off', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: false,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const classifier = new RecordingClassifier();
    const service = await createService({ runtime, gateway, router, responseClassifier: classifier });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-flag-off',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-flag-off-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero saber el estado de mi compra.',
    });

    // The router never ran and the classifier path still owns the turn.
    expect(calls).toEqual([]);
    expect(classifier.calls).toBe(1);
    expect(runtime.extractRequests.length).toBeGreaterThan(0);
    expect(response.outbound.delivery.action).toBe('send');
  });

  it('falls back to the classifier path when the router is unavailable', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({ enabled: true, answers: { unavailable: true } });
    const classifier = new RecordingClassifier();
    const service = await createService({ runtime, gateway, router, responseClassifier: classifier });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-unavailable',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-unavailable-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero saber el estado de mi compra.',
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(classifier.calls).toBe(1);
    expect(runtime.extractRequests.length).toBeGreaterThan(0);
    expect(response.trace.router_decision).toBeUndefined();
    // A stage that ran and failed must be visible: the reason travels into
    // the trace and the perf record, so it can never look like a stage that
    // never ran.
    expect(response.trace.router_failure).toBeDefined();
    expect(response.trace.router_failure?.reason.length).toBeGreaterThan(0);
  });

  it('keeps the extractor for the planning lane', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'planning_flow', sameOpenRequest: false, requestSettled: false },
    });
    const service = await createService({ runtime, gateway, router });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-planning',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-planning-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero organizar una boda.',
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(runtime.extractRequests.length).toBeGreaterThan(0);
  });

  it('answers a support turn with one compose call and no extraction', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-answer',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-answer-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero saber el estado de mi compra.',
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(runtime.extractRequests).toHaveLength(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(response.trace.router_decision?.route).toBe('answer_with_records');
    // The phone-scoped read ran through the orchestrator.
    expect(response.trace.tools_called).toContain('lookup_guest_gift_purchases_by_phone');
  });

  it('carries the purchase read outcome in the evidence when the backend holds no purchase', async () => {
    // The turn must prove the read outcome even when the backend has nothing:
    // the judge reads the purchase facts from this summary, and an empty
    // summary leaves the judge with no evidence at all on exactly the
    // threads where the customer asks about a payment that is not there yet.
    const gateway = await FixtureAgentConversationGateway.create(CASE_A_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'No encuentro una compra registrada.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-empty-purchase-evidence',
      contactPhone: CASE_A_PHONE,
      messageId: 'router-empty-purchase-evidence-1',
      receivedAt: new Date().toISOString(),
      text: 'Ya hice la transferencia por Yape pero no me aparece ninguna compra.',
    });

    const purchaseSummary = response.trace.information_execution_summary.find(
      (entry) => entry.kind === 'purchase',
    );
    expect(purchaseSummary).toBeDefined();
    expect(purchaseSummary?.status).toBe('completed');
    expect(purchaseSummary?.outcomeCode).toBe('completed_without_results');
  });

  it('escalates the second turn of a request the record left unresolved', async () => {
    // The router keeps answering the same request the first turn could not
    // settle. The record says the request is still open and the guest came
    // back to it, so the policy escalates whatever the route says.
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: [
        { route: 'answer_with_records', sameOpenRequest: false, requestSettled: false },
        { route: 'answer_with_records', sameOpenRequest: true, requestSettled: false },
      ],
    });
    const planStore = new InMemoryPlanStore();
    const service = await createService({ runtime, gateway, router, planStore });

    const first = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-open-request-repeat',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-open-request-repeat-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero que me devuelvan el dinero de mi regalo.',
    });

    // The first turn is answered and leaves the request open.
    expect(first.trace.turn_decision.stopReason).toBeNull();
    expect(first.plan.open_requests.at(-1)).toMatchObject({
      state: 'unresolved',
      turns: 1,
    });
    expect(runtime.composeRequests[0]?.requestOpen).toBe(true);
    expect(runtime.composeRequests[0]?.requestOpenTurns).toBe(1);

    const second = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-open-request-repeat',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-open-request-repeat-2',
      receivedAt: new Date().toISOString(),
      text: 'Sigo sin recibir la devolución, quiero mi dinero de vuelta.',
    });

    expect(second.trace.turn_decision.stopReason)
      .toBe('router_escalation:unresolved_request_repeated');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(second.plan.human_escalation.status).toBe('requested');
    expect(second.plan.open_requests.at(-1)).toMatchObject({
      state: 'with_person',
      turns: 2,
    });
  });

  it('does not escalate the first turn of an open request', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: false },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-open-request-single',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-open-request-single-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero que me devuelvan el dinero de mi regalo.',
    });

    expect(response.trace.turn_decision.stopReason).toBeNull();
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(0);
    expect(response.plan.open_requests.at(-1)?.state).toBe('unresolved');
  });

  it('escalates through the takeover gateway and persists the receipt', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'escalate_human', sameOpenRequest: false, requestSettled: false },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-escalate',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-escalate-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero que me devuelvan el dinero y hablen con una persona.',
    });

    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(runtime.extractRequests).toHaveLength(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.currentNode).toBe('solicitar_agente_humano');
    expect(runtime.composeRequests[0]?.handoffOutcome).toBe('handoff_requested');
  });

  it.each([
    {
      scenario: 'purchase-support-handoff-failed',
      phone: '+51900000407',
      title: 'retries the failed takeover of a still-open request',
      attemptOutcome: 'handoff_failed',
      receiptOutcome: 'handoff_failed',
      secondOutcome: 'handoff_failed',
      secondReceiptOutcome: 'handoff_failed',
      attemptsAfterSecondTurn: 2,
      lastError: 'Fixture handoff failed.',
    },
    {
      scenario: 'purchase-support-handoff-unknown',
      phone: '+51900000408',
      title: 'never retries an unknown takeover outcome',
      attemptOutcome: 'handoff_unknown',
      receiptOutcome: 'outcome_unknown',
      secondOutcome: 'handoff_unknown_not_retried',
      secondReceiptOutcome: 'outcome_unknown',
      attemptsAfterSecondTurn: 1,
      lastError: 'unknown_stays_unretried',
    },
  ] as const)(
    'reports the real takeover outcome on the next turn of an open request: $title ($scenario)',
    async ({
      scenario,
      phone,
      attemptOutcome,
      receiptOutcome,
      secondOutcome,
      secondReceiptOutcome,
      attemptsAfterSecondTurn,
      lastError,
    }) => {
      const gateway = await FixtureAgentConversationGateway.create(scenario);
      const runtime = new ScriptedAgentRuntime(
        [emptyExtraction()],
        () => ({ text: 'Respuesta informativa.' }),
      );
      const { router } = buildRouter({
        enabled: true,
        answers: [
          { route: 'escalate_human', sameOpenRequest: false, requestSettled: false },
          { route: 'escalate_human', sameOpenRequest: true, requestSettled: false },
        ],
      });
      const planStore = new InMemoryPlanStore();
      const service = await createService({ runtime, gateway, router, planStore });

      const first = await service.handleTurn({
        channel: 'whatsapp',
        externalUserId: `router-${scenario}`,
        contactPhone: phone,
        messageId: `router-${scenario}-1`,
        receivedAt: new Date().toISOString(),
        text: 'Quiero que me devuelvan el dinero y hablen con una persona.',
      });

      // The first turn attempts the takeover once and the world decides its
      // outcome: the attempt really happened, so the reply evidence carries
      // the plain outcome, not the not-retried one.
      expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
      expect(runtime.composeRequests[0]?.handoffOutcome).toBe(attemptOutcome);
      expect(first.plan.human_escalation.status).toBe('none');
      expect(first.plan.human_help_receipt).toMatchObject({
        outcome: receiptOutcome,
        requested: false,
        softPaused: false,
      });
      // A failed or unconfirmed takeover leaves the request open: that is the
      // fact the next turn reads to decide a retry.
      expect(first.plan.open_requests.at(-1)?.state).toBe('unresolved');

      const second = await service.handleTurn({
        channel: 'whatsapp',
        externalUserId: `router-${scenario}`,
        contactPhone: phone,
        messageId: `router-${scenario}-2`,
        receivedAt: new Date().toISOString(),
        text: 'Necesito que alguien me atienda esto, por favor.',
      });

      // The record decided the second turn: the request came back still open.
      expect(second.trace.turn_decision.stopReason)
        .toBe('router_escalation:unresolved_request_repeated');
      expect(second.plan.open_requests.at(-1)?.state).toBe('unresolved');
      expect(gateway.getFixtureCallCount('handoff.write')).toBe(attemptsAfterSecondTurn);
      expect(runtime.composeRequests[1]?.handoffOutcome).toBe(secondOutcome);
      if (scenario === 'purchase-support-handoff-unknown') {
        // An unknown outcome is never retried automatically: the reply says
        // this turn sent no request, because a skipped retry is neither an
        // unavailable capability nor a fresh attempt.
        expect(runtime.composeRequests[1]?.handoffOutcome)
          .not.toBe('handoff_skipped_unavailable');
        expect(runtime.composeRequests[1]?.handoffOutcome).not.toBe(attemptOutcome);
      }
      // The plan state, the node and the last error follow the real effect.
      expect(second.plan.current_node).toBe('solicitar_agente_humano');
      expect(second.plan.human_escalation.status).toBe('none');
      expect(second.plan.human_escalation.last_error).toBe(lastError);
      expect(second.plan.human_help_receipt?.outcome).toBe(secondReceiptOutcome);
    },
  );

  it('answers an unrelated question after a takeover instead of suppressing the thread', async () => {
    // Defect this prevents: a record parked with a person used to pause every
    // later turn, so a question about anything else was swallowed.
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: [
        { route: 'escalate_human', sameOpenRequest: false, requestSettled: false },
        { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
      ],
    });
    const service = await createService({ runtime, gateway, router });

    const first = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-parked-then-unrelated',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-parked-then-unrelated-1',
      receivedAt: new Date().toISOString(),
      text: 'Quiero que me devuelvan el dinero y hablen con una persona.',
    });
    expect(first.plan.open_requests.at(-1)?.state).toBe('with_person');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);

    const second = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-parked-then-unrelated',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-parked-then-unrelated-2',
      receivedAt: new Date().toISOString(),
      text: '¿Hasta cuándo puedo cambiar la dirección de entrega?',
    });

    // The unrelated question is a new request: it is answered, not paused.
    expect(second.outbound.delivery.action).toBe('send');
    expect(runtime.composeRequests).toHaveLength(2);
    expect(runtime.composeRequests[1]?.currentNode).toBe('resolver_consultas_informativas');
    // No second takeover: the parked request is not retried by an unrelated
    // turn, and the record that is with a person stays in the list.
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(second.plan.open_requests).toContainEqual(
      expect.objectContaining({ state: 'with_person' }),
    );
  });

  it('opens the typed help offer on a purchase thread in the same turn', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'offer_human', sameOpenRequest: false, requestSettled: false },
    });
    const planStore = new InMemoryPlanStore();
    // An active purchase thread: the classifier-era suppression would have
    // disconnected the offer from its sensor.
    await planStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'router-offer',
        channel: 'whatsapp',
        externalUserId: 'router-offer',
      }), {
        current_node: 'resolver_consultas_informativas',
        information_state: {
          resume_node: 'resolver_consultas_informativas',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: {
            kind: 'purchase',
            resource: 'gift_purchases',
            query: 'Compra anterior',
            orderId: null,
            authAction: 'none',
          },
        },
      }),
    });
    const service = await createService({ runtime, gateway, router, planStore });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-offer',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-offer-1',
      receivedAt: new Date().toISOString(),
      text: 'Esto ya no avanza y sigo esperando lo mismo.',
    });

    expect(response.plan.conversation_health.help_offer_status).toBe('offered');
    expect(response.plan.conversation_health.help_offered_at).not.toBeNull();
    expect(runtime.extractRequests).toHaveLength(0);
  });

  it('executes the takeover when the guest accepts the offer on a later turn', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'escalate_human', sameOpenRequest: false, requestSettled: false },
    });
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'router-accept',
        channel: 'whatsapp',
        externalUserId: 'router-accept',
      }), {
        current_node: 'resolver_consultas_informativas',
        conversation_health: {
          status: 'frustrated',
          reason: 'explicit_frustration',
          consecutive_non_progress_turns: 2,
          help_offer_status: 'offered',
          help_offered_at: '2026-10-20T00:00:00.000Z',
          last_assessed_at: '2026-10-20T00:00:00.000Z',
        },
      }),
    });
    const service = await createService({ runtime, gateway, router, planStore });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-accept',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-accept-1',
      receivedAt: new Date().toISOString(),
      text: 'Sí, quiero que una persona me ayude.',
    });

    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(runtime.extractRequests).toHaveLength(0);
  });

  it('drops cited order ids outside the profile set without rewriting the message', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({
        text: 'Respuesta informativa.',
        sidecar: {
          citedOrderIds: [CASE_C_ORDER_ID, 'ORD_NOT_IN_THE_PROFILE'],
          reportedPayment: {
            amount: 87.36,
            currency: 'PEN',
            method: 'Yape o Plin',
            claimedSuccess: true,
          },
          requestOutcome: 'unresolved', financialReconciliationRequired: false, claimedHandoff: false,
        },
      }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-sidecar',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-sidecar-1',
      receivedAt: new Date().toISOString(),
      text: 'Ya pagué por Yape los 87.36 soles.',
    });

    expect(response.outbound.text).toBe('Respuesta informativa.');
    const sidecarRecord = response.trace.tool_outputs.find(
      (entry) => entry.tool === 'support_reply_sidecar',
    );
    expect(sidecarRecord).toBeDefined();
    expect(JSON.parse(sidecarRecord?.output ?? '{}')).toMatchObject({
      cited_order_count: 1,
      dropped_order_count: 1,
    });
    // The reported payment travels to the next turn as typed evidence.
    expect(response.plan.support_outcome.reported_payment).toMatchObject({
      amount: 87.36,
      currency: 'PEN',
      method: 'Yape o Plin',
      claimed_success: true,
    });
  });

  it('suppresses the acknowledgement through the established suppression machinery', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'suppress_ack', sameOpenRequest: false, requestSettled: true },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-suppress',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-suppress-1',
      receivedAt: new Date().toISOString(),
      text: 'ok',
    });

    expect(response.outbound.delivery.action).toBe('suppress');
    expect(response.outbound.delivery.reason).toBe('suppress_acknowledgement');
    expect(runtime.composeRequests).toHaveLength(0);
    expect(runtime.extractRequests).toHaveLength(0);
  });

  it('derives the conversation health from the open-request record', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: true, requestSettled: false },
    });
    const planStore = new InMemoryPlanStore();
    // A request the thread already left unresolved twice: the record, and
    // nothing else, is the health evidence on this lane.
    await planStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'router-health',
        channel: 'whatsapp',
        externalUserId: 'router-health',
      }), {
        current_node: 'resolver_consultas_informativas',
        open_requests: [{
          key: 'router-health-seed',
          opening_text: 'Ya te lo dije antes, esto no avanza.',
          state: 'unresolved',
          since: '2026-10-20T00:00:00.000Z',
          turns: 2,
        }],
      }),
    });
    const service = await createService({ runtime, gateway, router, planStore });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-health',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-health-1',
      receivedAt: new Date().toISOString(),
      text: 'Ya te lo dije antes, esto no avanza.',
    });

    expect(response.plan.conversation_health).toMatchObject({
      status: 'stalled',
      reason: 'repeated_question',
      consecutive_non_progress_turns: 2,
    });
    expect(response.trace.turn_decision.stopReason)
      .toBe('router_escalation:unresolved_request_repeated');
  });

  it('reaches the router from an image turn and runs the support lane', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-image',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-image-1',
      receivedAt: new Date().toISOString(),
      text: '',
      image: {
        status: 'available',
        source: 'url',
        url: 'https://example.invalid/receipt.jpg',
        mimeType: null,
      },
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(runtime.extractRequests).toHaveLength(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.trace.router_decision?.route).toBe('answer_with_records');
  });

  it('reaches the router from a media-only turn and runs the support lane', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-media',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-media-1',
      receivedAt: new Date().toISOString(),
      text: '',
      media: [{
        kind: 'image',
        providerMediaId: 'fixture-image',
        mimeType: 'image/jpeg',
        sha256: null,
        fileName: null,
      }],
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(runtime.extractRequests).toHaveLength(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.trace.router_decision?.route).toBe('answer_with_records');
  });

  it('keeps the support-lane compose schema strict-compatible', () => {
    const schema = genericMessageSchema.extend({
      cited_order_ids: supportReplySidecarSchema.shape.cited_order_ids,
      reported_payment: supportReplySidecarSchema.shape.reported_payment,
    });
    expect(() => {
      assertOpenAiStructuredSchemaCompatible(schema, 'reply_generic_support_sidecar');
    }).not.toThrow();
  });

  it('carries the reported payment into the next turn outcome signature', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_D_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction(), emptyExtraction()],
      () => ({
        text: 'Respuesta informativa.',
        sidecar: {
          citedOrderIds: [],
          reportedPayment: {
            amount: 391.87,
            currency: 'PEN',
            method: 'Yape o Plin',
            claimedSuccess: true,
          },
          requestOutcome: 'unresolved', financialReconciliationRequired: true, claimedHandoff: false,
        },
      }),
    );
    const { router, bodies } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
    });
    const service = await createService({ runtime, gateway, router });
    const inbound = {
      channel: 'whatsapp' as const,
      externalUserId: 'router-reported-payment',
      contactPhone: CASE_D_PHONE,
      receivedAt: new Date().toISOString(),
    };

    const first = await service.handleTurn({
      ...inbound,
      messageId: 'router-reported-payment-1',
      text: 'Aquí sí se ha cobrado el Plin.',
    });
    expect(first.plan.support_outcome.reported_payment).toMatchObject({
      amount: 391.87,
      claimed_success: true,
    });
    expect(first.plan.support_outcome.signature).not.toBeNull();

    const second = await service.handleTurn({
      ...inbound,
      messageId: 'router-reported-payment-2',
      text: 'Revisa si ese pago ya se acreditó.',
    });

    // The router input carries the open-request record of the previous
    // turn. The signature and the repeat count no longer travel to the
    // router: the record is the only state the policy reads.
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies[1]).toContain('solicitudes_retenidas:');
    expect(bodies[1]).toContain('Aquí sí se ha cobrado el Plin.');
    expect(first.plan.open_requests.at(-1)?.state).toBe('unresolved');
    // The declined record plus the reported successful payment is an
    // unresolved money outcome: the model-side signal, never a keyword.
    expect(second.plan.support_outcome.unresolved_money).toBe(true);
  });
});

describe('request-scoped support outcomes', () => {
  const phone = '+51900000406';
  const scenario = 'purchase-approved-event-date';
  const inbound = { channel: 'whatsapp' as const, contactPhone: phone, receivedAt: '2026-10-23T12:00:00.000Z' };
  const answeredSidecar = { citedOrderIds: [], reportedPayment: null, claimedHandoff: false,
    requestOutcome: 'answered' as const, financialReconciliationRequired: false };

  it('selects the older parked refund after an unrelated answered date', async () => {
    const gateway = await FixtureAgentConversationGateway.create(scenario);
    const runtime = new ScriptedAgentRuntime([emptyExtraction()], () => ({ text: 'El evento es el 12 de diciembre de 2026.', sidecar: answeredSidecar }));
    const { router, bodies } = buildRouter({ enabled: true, answers: [
      { route: 'escalate_human', sameOpenRequest: false, requestSettled: false },
      { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
      { route: 'escalate_human', sameOpenRequest: true, selectedRequestKey: 'parked-refund', requestSettled: false },
    ] });
    const service = await createService({ runtime, gateway, router });
    const base = { ...inbound, externalUserId: 'stable-retained-refund' };
    await service.handleTurn({ ...base, messageId: 'parked-refund', text: 'Que una persona revise la devolución.' });
    const date = await service.handleTurn({ ...base, messageId: 'independent-date', text: '¿Qué fecha tiene el evento?' });
    const followup = await service.handleTurn({ ...base, messageId: 'refund-return', text: '¿Ya revisaron la devolución?' });
    expect(date.plan.open_requests.find((request) => request.key === 'independent-date')?.state).toBe('answered');
    expect(followup.outbound.delivery?.action).toBe('suppress');
    expect(followup.plan.open_requests.map((request) => request.key)).toEqual(['parked-refund', 'independent-date']);
    expect(followup.plan.open_requests[0]?.state).toBe('with_person');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(runtime.composeRequests).toHaveLength(2);
    expect(bodies[2]).toContain('parked-refund');
  });

  it('settles a factual answer independently of an earlier financial dispute and keeps its report scoped', async () => {
    const gateway = await FixtureAgentConversationGateway.create(scenario);
    let composeIndex = 0;
    const runtime = new ScriptedAgentRuntime([emptyExtraction()], () => ({ text: 'Respuesta del turno.', sidecar: composeIndex++ === 0
      ? { ...answeredSidecar, requestOutcome: 'unresolved', financialReconciliationRequired: true,
        reportedPayment: { amount: 140, currency: 'PEN', method: 'Plin', claimedSuccess: true } }
      : answeredSidecar }));
    const { router } = buildRouter({ enabled: true, answers: [
      { route: 'answer_with_records', sameOpenRequest: false, requestSettled: false },
      { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
      { route: 'answer_with_records', sameOpenRequest: true, selectedRequestKey: 'date-answer', requestSettled: true },
    ] });
    const service = await createService({ runtime, gateway, router });
    const base = { ...inbound, externalUserId: 'scoped-money-dispute' };
    const dispute = await service.handleTurn({ ...base, messageId: 'money-dispute', text: 'Pagué 140 y no coincide, revisen la diferencia.' });
    expect(dispute.plan.support_outcome.unresolved_money).toBe(true);
    await service.handleTurn({ ...base, messageId: 'date-answer', text: '¿Qué fecha tiene el evento?' });
    const repeat = await service.handleTurn({ ...base, messageId: 'date-repeat', text: '¿Me repites esa fecha?' });
    expect(repeat.plan.open_requests.find((request) => request.key === 'date-answer')).toMatchObject({ state: 'answered', reported_payment: null });
    expect(repeat.plan.open_requests.find((request) => request.key === 'money-dispute')).toMatchObject({ state: 'unresolved',
      financial_reconciliation_required: true, reported_payment: { amount: 140 } });
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(0);
    expect(runtime.composeRequests).toHaveLength(3);
  });

  it('uses actual compose outcome rather than the router prediction and recognizes withdrawal', async () => {
    const gateway = await FixtureAgentConversationGateway.create(scenario);
    let composeIndex = 0;
    const runtime = new ScriptedAgentRuntime([emptyExtraction()], () => ({ text: 'Respuesta del turno.',
      sidecar: { ...answeredSidecar, requestOutcome: composeIndex++ === 0 ? 'unresolved' : 'withdrawn' } }));
    const { router } = buildRouter({ enabled: true, answers: [
      { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true },
      { route: 'answer_with_records', sameOpenRequest: true, requestSettled: true },
    ] });
    const service = await createService({ runtime, gateway, router });
    const base = { ...inbound, externalUserId: 'actual-settlement' };
    const first = await service.handleTurn({ ...base, messageId: 'request-not-settled', text: 'Quiero una devolución.' });
    expect(first.plan.open_requests[0]?.state).toBe('unresolved');
    const second = await service.handleTurn({ ...base, messageId: 'withdraw-request', text: 'Ya no quiero devolución, dejémoslo así.' });
    expect(second.plan.open_requests[0]?.state).toBe('answered');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(0);
  });

  it('runs one structured FAQ extraction after takeover without a second classifier call', async () => {
    const gateway = await FixtureAgentConversationGateway.create(scenario);
    const extraction = { ...emptyExtraction(), informationRequests: [{ kind: 'faq' as const, query: '¿Cuánto cuestan los retiros?', hostWithdrawal: 'policy_only' as const }] };
    const runtime = new ScriptedAgentRuntime([extraction], () => ({ text: 'Respuesta de la política disponible.', sidecar: answeredSidecar }));
    const classifier = new RecordingClassifier();
    const { router } = buildRouter({ enabled: true, answers: [
      { route: 'escalate_human', sameOpenRequest: false, requestSettled: false },
      { route: 'information_flow', sameOpenRequest: false, requestSettled: false },
    ] });
    const service = await createService({ runtime, gateway, router, responseClassifier: classifier });
    const base = { ...inbound, externalUserId: 'faq-after-takeover' };
    await service.handleTurn({ ...base, messageId: 'request-person', text: 'Quiero una persona para la devolución.' });
    const response = await service.handleTurn({ ...base, messageId: 'public-policy', text: 'Aparte, ¿cuánto cuestan los retiros?' });
    expect(classifier.calls).toBe(0);
    expect(runtime.extractRequests).toHaveLength(1);
    expect(runtime.composeRequests[1]?.informationResults?.some((result) => result.kind === 'faq')).toBe(true);
    expect(response.outbound.delivery?.action).toBe('send');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
  });

  it('does not settle a request when the composition fails before delivery', async () => {
    const gateway = await FixtureAgentConversationGateway.create(scenario);
    const runtime = new ScriptedAgentRuntime([emptyExtraction()], () => { throw new Error('composition failed'); });
    const { router } = buildRouter({ enabled: true, answers: { route: 'answer_with_records', sameOpenRequest: false, requestSettled: true } });
    const planStore = new InMemoryPlanStore();
    const service = await createService({ runtime, gateway, router, planStore });
    await expect(service.handleTurn({ ...inbound, externalUserId: 'failed-settlement', messageId: 'not-delivered', text: '¿Cuál es la fecha?' })).rejects.toThrow('composition failed');
    expect(runtime.composeRequests).toHaveLength(1);
    expect((await planStore.getByExternalUser('whatsapp', 'failed-settlement'))?.open_requests ?? []).toEqual([]);
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(0);
  });
});
