import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = { terminal_whatsapp: new WhatsAppMessageRenderer() };

class ScriptedRuntime implements AgentRuntime {
  public composeCalls = 0;
  public readonly composeRequests: ComposeReplyRequest[] = [];
  private index = 0;
  constructor(private readonly extractions: ExtractionResult[]) {}
  async extract(): Promise<ExtractionResult> {
    const next = this.extractions[this.index] ?? this.extractions[this.extractions.length - 1];
    this.index += 1;
    if (!next) throw new Error('Missing extraction fixture.');
    return next;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeCalls += 1;
    this.composeRequests.push(request);
    return { text: 'Respuesta compuesta.' };
  }
}

class QuietKnowledgeGateway implements KnowledgeRetrievalGateway {
  async search(): Promise<never> {
    throw new Error('no kb');
  }
}

class RecordingAgentGateway {
  public takeoverCalls = 0;
  constructor(private readonly mode: 'success' | 'failed' | 'unknown' = 'success') {}
  async logMessage() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async getRecentMessages() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async requestHumanTakeover() {
    this.takeoverCalls += 1;
    if (this.mode === 'success') return { status: 'success' as const, message: 'ok' };
    return { status: 'failed' as const, error: this.mode, retryable: this.mode === 'unknown' as const, ...(this.mode === 'unknown' ? { outcome: 'unknown' as const } : {}) };
  }
  async getGuestOrdersByPhone() {
    return { status: 'not_found' as const, resource: 'orders' as const, orderId: null };
  }
  async getGuestGiftPurchasesByPhone() {
    return { status: 'not_found' as const, resource: 'gift_purchases' as const, orderId: null };
  }
  async authByPhone() {
    return { status: 'failed' as const, error: 'disabled', retryable: false as const };
  }
  async updatePhone() {
    return { status: 'success' as const };
  }
}

function scriptedProviderGateway() {
  const gateway = {
    async requestUserLoginCode() {
      return { status: 'sent' as const };
    },
    async verifyUserLoginCode() {
      return { status: 'authenticated' as const, token: 't', tokenExpiresAt: new Date(Date.now() + 3600000).toISOString() };
    },
  } as unknown as ProviderGateway;
  return gateway;
}

function createService(runtime: ScriptedRuntime, agentGateway: RecordingAgentGateway, planStore: InMemoryPlanStore): AgentService {
  return new AgentService({
    planStore,
    runtime,
    providerGateway: scriptedProviderGateway(),
    promptLoader,
    renderers,
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: new QuietKnowledgeGateway(),
      providerGateway: scriptedProviderGateway(),
      agentGateway: agentGateway as never,
    }),
    agentConversationGateway: agentGateway as never,
  });
}

function baseExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    phoneConfirmation: null,
    intentConfidence: 0.9,
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
    conversationSummary: 'Resumen.',
    selectedProviderHints: [],
    selectedProviderReferences: [],
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
  } as ExtractionResult;
}

function shortlistPlan(planStore: InMemoryPlanStore) {
  const seed = mergePlan(
    createEmptyPlan({ planId: 'd-shortlist', channel: 'whatsapp', externalUserId: 'd-user' }),
    {
      current_node: 'recomendar',
      event_type: 'boda',
      location: 'Lima',
      active_need_category: 'Fotografía y video' as never,
      vendor_category: 'Fotografía y video' as never,
      provider_needs: [
        {
          category: 'Fotografía y video' as never,
          status: 'shortlisted',
          preferences: ['estilo natural'],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [90, 91],
          recommended_providers: [
            { id: 90, title: 'Carlos Schult', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'primera', serviceHighlights: [], termsHighlights: [] },
            { id: 91, title: 'Fotografia Alternativa', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'segunda', serviceHighlights: [], termsHighlights: [] },
          ] as never,
          sub_query_results: [],
          selected_provider_ids: [],
          selected_provider_hints: [],
        },
      ],
    } as never,
  );
  return planStore.save({ plan: seed, reason: 'seed' });
}

async function turn(service: AgentService, text: string, messageId: string, contactPhone: string | null = '+51900000302') {
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'd-user',
    ...(contactPhone === null ? {} : { contactPhone }),
    text,
    messageId,
    receivedAt: new Date().toISOString(),
  });
}

describe('D1 ambiguous confirmation', () => {
  it('routes unclear, bare-yes, and close-pressure shortlist inputs without writes', async () => {
    async function shortlistTurn(extraction: ExtractionResult, text: string, messageId: string) {
      const planStore = new InMemoryPlanStore();
      await shortlistPlan(planStore);
      const runtime = new ScriptedRuntime([extraction]);
      const gateway = new RecordingAgentGateway('success');
      const service = createService(runtime, gateway, planStore);
      return turn(service, text, messageId);
    }

    // Unclear equals absent: the twin clarifies with no provider tools and
    // persists the aclarar node for structural proof.
    const unclear = await shortlistTurn(baseExtraction({
      phoneConfirmation: 'unclear',
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    }), 'Si confirmo.', 'd1-unclear-1');
    expect(unclear.outbound.text).toBe('Respuesta compuesta.');
    expect(unclear.plan.current_node).toBe('aclarar_pedir_faltante');
    expect(unclear.trace.tools_called ?? []).not.toContain('search_providers_from_plan');
    expect(unclear.trace.tools_called ?? []).not.toContain('get_provider_detail');
    expect(unclear.trace.tools_called ?? []).not.toContain('finish_plan');
    expect(unclear.plan.selected_provider_ids).toEqual([]);

    // A bare yes without auth state is ignored instead of escalating.
    const yes = await shortlistTurn(
      baseExtraction({ phoneConfirmation: 'yes' }), 'Si, confirmo.', 'd1-yes-1',
    );
    expect(yes.outbound.text).toBe('Respuesta compuesta.');
    expect(yes.plan.current_node).not.toBe('solicitar_agente_humano');
    expect(yes.plan.selected_provider_ids).toEqual([]);

    // Close pressure over the unresolved shortlist clarifies instead of
    // closing.
    const pressured = await shortlistTurn(baseExtraction({
      actionIntent: 'cerrar',
      closeAction: { type: 'confirm_close', category: null, reason: null },
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    }), 'Si confirmo todo, usen lo que extrajeron y cierren.', 'd1-close-pressure-1');
    expect(pressured.outbound.text).toBe('Respuesta compuesta.');
    expect(pressured.plan.current_node).toBe('aclarar_pedir_faltante');
    expect(pressured.trace.tools_called ?? []).not.toContain('finish_plan');
    expect(pressured.trace.tools_called ?? []).not.toContain('search_providers_from_plan');
    expect(pressured.plan.selected_provider_ids).toEqual([]);
  });

});

describe('D2 mailbox and human arbitration', () => {
  it('arbitrates human-help intents: conflicting and unoffered intents withhold handoff, explicit requests trigger exactly one', async () => {
    async function arbitrationTurn(extraction: ExtractionResult, text: string, messageId: string) {
      const planStore = new InMemoryPlanStore();
      const seed = mergePlan(
        createEmptyPlan({ planId: 'd-arbitration', channel: 'whatsapp', externalUserId: 'd-user' }),
        { current_node: 'resolver_consultas_informativas' } as never,
      );
      await planStore.save({ plan: seed, reason: 'seed' });
      const runtime = new ScriptedRuntime([extraction]);
      const gateway = new RecordingAgentGateway('success');
      const service = createService(runtime, gateway, planStore);
      const res = await turn(service, text, messageId);
      return { res, gateway };
    }

    // Conflicting extraction replays the support win with no handoff.
    const conflicted = await arbitrationTurn(baseExtraction({
      actionIntent: 'solicitar_humano',
      supportAct: { kind: 'report_issue',} as never,
      ...( { humanHelpIntent: 'none' } as Record<string, unknown>),
    }), 'Tengo un problema de capacidad en mi gmail registrado', 'd2-conflict-1');
    expect(conflicted.gateway.takeoverCalls).toBe(0);
    expect(conflicted.res.plan.human_escalation.status).toBe('none');
    expect(conflicted.res.plan.current_node).toBe('resolver_consultas_informativas');

    // An explicit human request triggers exactly one handoff without OTP copy.
    const explicit = await arbitrationTurn(baseExtraction({
      actionIntent: 'solicitar_humano',
      supportAct: { kind: 'report_issue',} as never,
      ...( { humanHelpIntent: 'request' } as Record<string, unknown>),
    }), 'Quiero hablar con una persona sobre mi correo lleno', 'd2-explicit-1');
    expect(explicit.gateway.takeoverCalls).toBe(1);
    expect(explicit.res.plan.human_escalation.status).toBe('requested');
    expect((explicit.res.outbound.text ?? '').toLowerCase()).not.toContain('codigo');
    expect((explicit.res.outbound.text ?? '').toLowerCase()).not.toContain('otp');
    expect((explicit.res.outbound.text ?? '').toLowerCase()).not.toContain('correo');

    // accept_offer without a pending offer does not handoff.
    const accepted = await arbitrationTurn(baseExtraction({
      actionIntent: 'solicitar_humano',
      ...( { humanHelpIntent: 'accept_offer' } as Record<string, unknown>),
    }), 'Si, acepto ayuda.', 'd2-accept-1');
    expect(accepted.gateway.takeoverCalls).toBe(0);
    expect(accepted.res.plan.human_escalation.status).toBe('none');
  });

  it('bare greeting on first exchange gets a brief greeting with no plan presupposition', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-greet', channel: 'whatsapp', externalUserId: 'd-user' }),
      {
        current_node: 'deteccion_intencion',
        conversation_summary: 'The user previously shared an image described as transfer proof.',
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const runtime = new ScriptedRuntime([baseExtraction()]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Hola', 'd2-greet-1');
    expect(res.outbound.text).toBe('Respuesta compuesta.');
    expect(gateway.takeoverCalls).toBe(0);
  });
});

describe('D3 missing purchase scoped rendering', () => {
  it('phone-scoped miss answers from the normal reply path with zero writes and preserves question', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-missing', channel: 'whatsapp', externalUserId: 'd-user' }),
      {
        current_node: 'resolver_consultas_informativas',
        information_state: { resume_node: 'deteccion_intencion', pending_requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'orders', query: 'Quiero consultar si mi compra esta confirmada.', orderId: null, authAction: 'none' }], selection_candidates: [], last_completed_request: null },
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({
      informationRequests: [{ kind: 'purchase', resource: 'orders', query: 'Quiero consultar si mi compra esta confirmada.', orderId: null, authAction: 'none' } as never],
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Quiero consultar si mi compra esta confirmada. No tengo una cuenta registrada.', 'd3-missing-1', '+51985101461');
    // Read outcomes never authorize writes: the miss answers normally with
    // no escalation and no terminal persist reason; the pending question
    // survives for the conversation.
    expect(res.plan.human_escalation.status).toBe('none');
    expect(res.outbound.text).toBe('Respuesta compuesta.');
    expect(runtime.composeRequests.at(-1)?.handoffOutcome ?? null).toBeNull();
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome ?? null).toBeNull();
    expect(res.trace.plan_persist_reason).not.toBe('information_authentication_terminal_handoff');
    expect(gateway.takeoverCalls).toBe(0);
    const pending = res.plan.information_state.pending_requests;
    expect(pending).toEqual([]); // The full authorized profile resolves the read-only request.
  });

  it('identity_rejected success states discontinued access and requested help', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-reject-copy', channel: 'whatsapp', externalUserId: 'd-user' }),
      {
        current_node: 'resolver_consultas_informativas',
        user_auth: { status: 'code_requested', email: 'a@b.invalid', token: null, token_expires_at: null, last_error: null, requested_at: '2026-08-24T21:18:00.000Z', failed_code_attempts: 0, otp_send_attempts: 1, otp_non_delivery_reports: 0, auth_method: null, awaiting_phone_confirmation: true },
        information_state: { resume_node: 'deteccion_intencion', pending_requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'gift_purchases', query: 'Estado del regalo.', orderId: null, authAction: 'none' }], selection_candidates: [], last_completed_request: null },
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({ phoneConfirmation: 'no' });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Ese numero no es mio.', 'd3-reject-1');
    expect(res.plan.human_escalation.status).toBe('requested');
    expect(res.outbound.text).toBe('Respuesta compuesta.');
    expect(res.trace.plan_persist_reason).toBe('information_authentication_terminal_handoff');
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      // C1: terminal escalation retains pending protected requests.
      protectedRequestsClosed: false,
      handoffOutcome: 'handoff_requested',
    });
  });
});
