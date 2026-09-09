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
    void request;
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
  it('unclear equals absent: twin clarifies with no provider tools', async () => {
    const planStore = new InMemoryPlanStore();
    await shortlistPlan(planStore);
    const extraction = baseExtraction({
      phoneConfirmation: 'unclear',
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Si confirmo.', 'd1-unclear-1');
    expect(res.outbound.text ?? '').toContain('confirmando');
    expect(res.trace.tools_called ?? []).not.toContain('search_providers_from_plan');
    expect(res.trace.tools_called ?? []).not.toContain('get_provider_detail');
    expect(res.plan.selected_provider_ids).toEqual([]);
  });

  it('yes is ignored in pure shortlist without auth state', async () => {
    const planStore = new InMemoryPlanStore();
    await shortlistPlan(planStore);
    const extraction = baseExtraction({ phoneConfirmation: 'yes' });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Si, confirmo.', 'd1-yes-1');
    expect(res.outbound.text ?? '').toContain('confirmando');
    expect(res.plan.current_node).not.toBe('solicitar_agente_humano');
  });

  it('clarification persists the aclarar_pedir_faltante node for structural proof', async () => {
    const planStore = new InMemoryPlanStore();
    await shortlistPlan(planStore);
    const extraction = baseExtraction({
      phoneConfirmation: 'unclear',
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Si confirmo.', 'd1-node-1');
    expect(res.outbound.text ?? '').toContain('confirmando');
    expect(res.plan.current_node).toBe('aclarar_pedir_faltante');
    expect(res.trace.tools_called ?? []).not.toContain('finish_plan');
    expect(res.plan.selected_provider_ids).toEqual([]);
  });

  it('close pressure over an unresolved shortlist clarifies instead of closing', async () => {
    const planStore = new InMemoryPlanStore();
    await shortlistPlan(planStore);
    const extraction = baseExtraction({
      actionIntent: 'cerrar',
      closeAction: { type: 'confirm_close', category: null, reason: null },
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Si confirmo todo, usen lo que extrajeron y cierren.', 'd1-close-pressure-1');
    expect(res.outbound.text ?? '').toContain('confirmando');
    expect(res.plan.current_node).toBe('aclarar_pedir_faltante');
    expect(res.trace.tools_called ?? []).not.toContain('finish_plan');
    expect(res.trace.tools_called ?? []).not.toContain('search_providers_from_plan');
    expect(res.plan.selected_provider_ids).toEqual([]);
  });

  it('rejection wins over clarification in protected context', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-reject', channel: 'whatsapp', externalUserId: 'd-user' }),
      {
        current_node: 'resolver_consultas_informativas',
        user_auth: { status: 'code_requested', email: 'a@b.invalid', token: null, token_expires_at: null, last_error: null, requested_at: '2026-08-24T21:18:00.000Z', failed_code_attempts: 0, otp_send_attempts: 1, otp_non_delivery_reports: 0, auth_method: null, awaiting_phone_confirmation: true },
        information_state: { resume_node: 'deteccion_intencion', pending_requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'gift_purchases', query: 'Estado del regalo.', orderId: null, aspects: ['summary'], sensitiveFields: [], authAction: 'none' }], selection_candidates: [], last_completed_request: null },
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({
      phoneConfirmation: 'no',
      ambiguity: { status: 'ambiguous', clarificationQuestion: null, interpretations: [] },
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Ese numero no es mio.', 'd1-reject-1');
    expect(res.plan.current_node).toBe('solicitar_agente_humano');
  });
});

describe('D2 mailbox and human arbitration', () => {
  it('conflicting extraction replays support win with no handoff', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-mailbox', channel: 'whatsapp', externalUserId: 'd-user' }),
      { current_node: 'resolver_consultas_informativas' } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({
      actionIntent: 'solicitar_humano',
      supportAct: { kind: 'report_issue', topic: 'mailbox_capacity', detail: 'mailbox_full' } as never,
      ...( { humanHelpIntent: 'none' } as Record<string, unknown>),
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Tengo un problema de capacidad en mi gmail registrado', 'd2-conflict-1');
    expect(gateway.takeoverCalls).toBe(0);
    expect(res.plan.human_escalation.status).toBe('none');
    expect(res.plan.current_node).toBe('resolver_consultas_informativas');
  });

  it('explicit human request triggers exactly one handoff without OTP copy', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-explicit', channel: 'whatsapp', externalUserId: 'd-user' }),
      { current_node: 'resolver_consultas_informativas' } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({
      actionIntent: 'solicitar_humano',
      supportAct: { kind: 'report_issue', topic: 'mailbox_capacity', detail: 'mailbox_full' } as never,
      ...( { humanHelpIntent: 'request' } as Record<string, unknown>),
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Quiero hablar con una persona sobre mi correo lleno', 'd2-explicit-1');
    expect(gateway.takeoverCalls).toBe(1);
    expect(res.plan.human_escalation.status).toBe('requested');
    expect((res.outbound.text ?? '').toLowerCase()).not.toContain('codigo');
    expect((res.outbound.text ?? '').toLowerCase()).not.toContain('otp');
    expect((res.outbound.text ?? '').toLowerCase()).not.toContain('correo');
  });

  it('accept_offer without pending offer does not handoff', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-accept', channel: 'whatsapp', externalUserId: 'd-user' }),
      { current_node: 'resolver_consultas_informativas' } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({
      actionIntent: 'solicitar_humano',
      ...( { humanHelpIntent: 'accept_offer' } as Record<string, unknown>),
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    await turn(service, 'Si, acepto ayuda.', 'd2-accept-1');
    expect(gateway.takeoverCalls).toBe(0);
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
    expect(res.outbound.text ?? '').toContain('Hola');
    expect(res.outbound.text ?? '').not.toContain('tu plan');
    expect(gateway.takeoverCalls).toBe(0);
  });
});

describe('D3 missing purchase scoped rendering', () => {
  it('phone_information_not_found success uses bounded scoped copy and preserves question', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-missing', channel: 'whatsapp', externalUserId: 'd-user' }),
      {
        current_node: 'resolver_consultas_informativas',
        information_state: { resume_node: 'deteccion_intencion', pending_requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'orders', query: 'Quiero consultar si mi compra esta confirmada.', orderId: null, aspects: ['summary', 'payment_status'], sensitiveFields: [], authAction: 'none' }], selection_candidates: [], last_completed_request: null },
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({
      informationRequests: [{ kind: 'purchase', resource: 'orders', query: 'Quiero consultar si mi compra esta confirmada.', orderId: null, aspects: ['summary', 'payment_status'], sensitiveFields: [], authAction: 'none' } as never],
    });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Quiero consultar si mi compra esta confirmada. No tengo una cuenta registrada.', 'd3-missing-1', '+51985101461');
    expect(res.plan.human_escalation.status).toBe('requested');
    expect(res.outbound.text ?? '').toContain('No pude localizar tu compra');
    expect(res.outbound.text ?? '').toContain('apoyo humano');
    expect((res.outbound.text ?? '').toLowerCase()).not.toContain('no existe');
    const pending = res.plan.information_state.pending_requests;
    expect(pending.length).toBeGreaterThan(0);
  });

  it('identity_rejected success states discontinued access and requested help', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'd-reject-copy', channel: 'whatsapp', externalUserId: 'd-user' }),
      {
        current_node: 'resolver_consultas_informativas',
        user_auth: { status: 'code_requested', email: 'a@b.invalid', token: null, token_expires_at: null, last_error: null, requested_at: '2026-08-24T21:18:00.000Z', failed_code_attempts: 0, otp_send_attempts: 1, otp_non_delivery_reports: 0, auth_method: null, awaiting_phone_confirmation: true },
        information_state: { resume_node: 'deteccion_intencion', pending_requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'gift_purchases', query: 'Estado del regalo.', orderId: null, aspects: ['summary'], sensitiveFields: [], authAction: 'none' }], selection_candidates: [], last_completed_request: null },
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const extraction = baseExtraction({ phoneConfirmation: 'no' });
    const runtime = new ScriptedRuntime([extraction]);
    const gateway = new RecordingAgentGateway('success');
    const service = createService(runtime, gateway, planStore);
    const res = await turn(service, 'Ese numero no es mio.', 'd3-reject-1');
    expect(res.plan.human_escalation.status).toBe('requested');
    expect(res.outbound.text ?? '').toContain('ya no se usará para acceder');
    expect(res.outbound.text ?? '').toContain('apoyo humano');
    expect((res.outbound.text ?? '').toLowerCase()).not.toContain('correo');
    expect((res.outbound.text ?? '').toLowerCase()).not.toContain('otp');
    expect((res.outbound.text ?? '').toLowerCase()).not.toContain('código');
  });
});
