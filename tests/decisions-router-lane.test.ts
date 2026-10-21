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

/** Dossier case D: the only readable record is the declined card attempt. */
const CASE_D_SCENARIO = 'purchase-declined-card-transfer-pending';
const CASE_D_PHONE = '+51900000404';

type RouterAnswers = {
  readonly route: RouterRoute;
  readonly loopRisk: number;
  readonly needsHumanNow: number;
  readonly capabilityBlocked: number;
};

function decisionsPayload(answers: RouterAnswers): unknown {
  return {
    id: 'dec_router_test',
    answers: [
      { type: 'predicate', name: 'needs_human_now', probability: answers.needsHumanNow },
      { type: 'predicate', name: 'capability_blocked', probability: answers.capabilityBlocked },
      {
        type: 'choice',
        name: 'route',
        choice: answers.route,
        probabilities: [{ value: answers.route, probability: 0.9 }],
      },
      {
        type: 'score',
        name: 'loop_risk',
        score: answers.loopRisk,
        probabilities: [
          { value: String(answers.loopRisk), label: String(answers.loopRisk), probability: 0.9 },
        ],
      },
    ],
  };
}

/**
 * The stubbed router transport. It records every call so a test can prove
 * the router did or did not run.
 */
function routerFetch(answers: RouterAnswers | { readonly unavailable: true }) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    bodies.push(typeof init?.body === 'string' ? init.body : '');
    if ('unavailable' in answers) {
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    }
    return new Response(JSON.stringify(decisionsPayload(answers)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls, bodies, fetchImpl };
}

function buildRouter(args: {
  readonly enabled: boolean;
  readonly answers: RouterAnswers | { readonly unavailable: true };
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
      answers: { route: 'answer_with_records', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
      answers: { route: 'planning_flow', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
      answers: { route: 'answer_with_records', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
  });

  it('keeps the extractor for the planning lane', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'planning_flow', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
      answers: { route: 'answer_with_records', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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

  it('escalates through the takeover gateway and persists the receipt', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'escalate_human', loopRisk: 4, needsHumanNow: 0.9, capabilityBlocked: 0.9 },
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

  it('opens the typed help offer on a purchase thread in the same turn', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'offer_human', loopRisk: 2, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
      answers: { route: 'escalate_human', loopRisk: 4, needsHumanNow: 0.9, capabilityBlocked: 0.2 },
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
          claimedHandoff: false,
        },
      }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
      answers: { route: 'suppress_ack', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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

  it('derives the conversation health from the router loop risk', async () => {    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', loopRisk: 3, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
    });
    const service = await createService({ runtime, gateway, router });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'router-health',
      contactPhone: CASE_C_PHONE,
      messageId: 'router-health-1',
      receivedAt: new Date().toISOString(),
      text: 'Ya te lo dije antes, esto no avanza.',
    });

    expect(response.plan.conversation_health.status).toBe('frustrated');
    expect(response.plan.conversation_health.reason).toBe('repeated_correction');
    expect(response.plan.conversation_health.consecutive_non_progress_turns).toBe(1);
  });

  it('reaches the router from an image turn and runs the support lane', async () => {
    const gateway = await FixtureAgentConversationGateway.create(CASE_C_SCENARIO);
    const runtime = new ScriptedAgentRuntime(
      [emptyExtraction()],
      () => ({ text: 'Respuesta informativa.' }),
    );
    const { router, calls } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
      answers: { route: 'answer_with_records', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
          claimedHandoff: false,
        },
      }),
    );
    const { router, bodies } = buildRouter({
      enabled: true,
      answers: { route: 'answer_with_records', loopRisk: 0, needsHumanNow: 0.1, capabilityBlocked: 0.1 },
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
    const firstSignature = first.plan.support_outcome.signature;
    expect(firstSignature).not.toBeNull();

    const second = await service.handleTurn({
      ...inbound,
      messageId: 'router-reported-payment-2',
      text: 'Revisa si ese pago ya se acreditó.',
    });

    // The router input carries the CURRENT turn's outcome: the signature
    // and the repeat count are computed before the router runs, so the
    // router never reads the previous turn's count.
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies[1]).toContain(second.plan.support_outcome.signature ?? 'missing');
    expect(bodies[1]).not.toContain(firstSignature ?? 'missing');
    // The declined record plus the reported successful payment is an
    // unresolved money outcome: the model-side signal, never a keyword.
    expect(second.plan.support_outcome.unresolved_money).toBe(true);
  });
});
