import { RunContext, type tool } from '@openai/agents';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { AgentService } from '../src/runtime/agent-service';
import { closeActionSchema } from '../src/runtime/close-flow-schemas';
import { turnTraceSchema } from '../src/evals/case-schema';
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
  constructor(private readonly extractions: ExtractionResult[]) {}
  private index = 0;
  async extract(): Promise<ExtractionResult> {
    const next = this.extractions[this.index] ?? this.extractions[this.extractions.length - 1];
    this.index += 1;
    if (!next) throw new Error('Missing extraction fixture.');
    return next;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
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
  async logMessage() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async getRecentMessages() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async requestHumanTakeover() {
    return { status: 'success' as const, message: 'ok' };
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
  return {
    async requestUserLoginCode() {
      return { status: 'sent' as const };
    },
    async verifyUserLoginCode() {
      return { status: 'authenticated' as const, token: 't', tokenExpiresAt: new Date().toISOString() };
    },
  } as unknown as ProviderGateway;
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

function seedClosedPlan(planStore: InMemoryPlanStore) {
  const seed = mergePlan(
    createEmptyPlan({ planId: 'close-proceed', channel: 'whatsapp', externalUserId: 'close-user' }),
    {
      current_node: 'crear_lead_cerrar',
      event_type: 'boda',
      location: 'Lima',
      active_need_category: 'Fotografía y video',
      vendor_category: 'Fotografía y video',
      contact_name: 'Carolina',
      contact_email: 'carolina@example.com',
      contact_phone: '51900000302',
      provider_needs: [
        {
          category: 'Fotografía y video',
          status: 'selected',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [90],
          recommended_providers: [
            {
              id: 90,
              title: 'Carlos Schult',
              category: 'Fotografía y video',
              location: 'Lima',
              priceLevel: null,
              reason: 'primera',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
          selected_provider_ids: [90],
          selected_provider_hints: [],
        },
      ],
    } as never,
  );
  return planStore.save({ plan: seed, reason: 'seed' });
}

describe('proceed_confirmed close state', () => {
  it('schema accepts the confirmed-proceed discriminant', () => {
    const parsed = closeActionSchema.parse({ type: 'proceed_confirmed', category: null, reason: null });
    expect(parsed.type).toBe('proceed_confirmed');
  });

  it('eval trace validator cannot drift from the canonical close discriminant', () => {
    const summaryShape = turnTraceSchema.shape.close_action_summary.unwrap().shape;
    const traceOptions = (summaryShape.type.unwrap() as { options: readonly string[] }).options;
    expect(traceOptions).toContain('proceed_confirmed');
    expect([...traceOptions].sort()).toEqual([...closeActionSchema.shape.type.options].sort());
  });

  it('explicit confirmation stays in close handling without reopening auth or contact', async () => {
    const planStore = new InMemoryPlanStore();
    await seedClosedPlan(planStore);
    const extraction = baseExtraction({
      actionIntent: 'cerrar',
      closeAction: { type: 'proceed_confirmed', category: null, reason: null },
    });
    const agentGateway = new RecordingAgentGateway();
    const service = new AgentService({
      planStore,
      runtime: new ScriptedRuntime([extraction]),
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
    const res = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'close-user',
      contactPhone: '+51900000302',
      text: 'Confirmo: envía la solicitud de cotización a Carlos Schult y cierra el plan.',
      messageId: 'close-proceed-1',
      receivedAt: new Date().toISOString(),
    });
    expect(res.plan.current_node).toBe('crear_lead_cerrar');
    expect(res.trace.close_action_summary).toEqual({
      type: 'proceed_confirmed',
      category: null,
      reason_preview: null,
    });
    expect(res.trace.tools_called ?? []).not.toContain('request_user_login_code');
    expect(res.trace.tools_called ?? []).not.toContain('verify_user_login_code');
    expect(res.trace.tools_called ?? []).not.toContain('request_human_takeover');
    expect(res.trace.tools_called ?? []).not.toContain('search_providers_from_plan');
  });

  it('keeps the saved phone when a name/email delta arrives on the close node', async () => {
    const planStore = new InMemoryPlanStore();
    await seedClosedPlan(planStore);
    const extraction = baseExtraction({
      actionIntent: null,
      contactName: 'Carolina Mendoza',
      contactEmail: 'carolina.m@example.com',
    });
    const agentGateway = new RecordingAgentGateway();
    const service = new AgentService({
      planStore,
      runtime: new ScriptedRuntime([extraction]),
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
    const res = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'close-user',
      contactPhone: '+51900000302',
      text: 'Soy Carolina Mendoza, mi correo es carolina.m@example.com',
      messageId: 'close-contact-delta-1',
      receivedAt: new Date().toISOString(),
    });
    // R5: the delta applies without losing the persisted phone, close
    // intention survives the collection turn, and no quote is dispatched.
    expect(res.plan.current_node).toBe('crear_lead_cerrar');
    expect(res.plan.contact_phone).toBe('51900000302');
    expect(res.plan.contact_email).toBe('carolina.m@example.com');
    expect(res.plan.provider_needs[0]?.selected_provider_ids).toEqual([90]);
  });

  it('persists confirmed completion even if reply generation subsequently fails', async () => {
    const planStore = new InMemoryPlanStore();
    await seedClosedPlan(planStore);
    const extraction = baseExtraction({ actionIntent: 'cerrar',
      closeAction: { type: 'proceed_confirmed', category: null, reason: null } });
    const runtime = new ScriptedRuntime([extraction]);
    vi.spyOn(runtime, 'composeReply').mockImplementation(async (request) => {
      expect(request.onPlanCompleted).toBeDefined();
      await request.onPlanCompleted?.(mergePlan(request.plan, {
        lifecycle_state: 'finished', current_node: 'necesidad_cubierta',
      }));
      throw new Error('reply failed after confirmed effect');
    });
    const service = new AgentService({ planStore, runtime,
      providerGateway: scriptedProviderGateway(), promptLoader, renderers });
    await expect(service.handleTurn({ channel: 'whatsapp', externalUserId: 'close-user',
      text: 'Mi evento es el 18 de octubre de 2026. Confirmo el envío.',
      messageId: 'confirmed-before-model-failure', receivedAt: new Date().toISOString(),
    })).rejects.toThrow('reply failed after confirmed effect');
    expect((await planStore.getByExternalUser('whatsapp', 'close-user'))?.lifecycle_state).toBe('finished');
  });

  it('close contact turn with support label stays in close handling and keeps phone', async () => {
    const planStore = new InMemoryPlanStore();
    await seedClosedPlan(planStore);
    const extraction = baseExtraction({
      actionIntent: null,
      contactPhone: '+51 954779071',
      supportAct: { kind: 'provide_detail', topic: 'account_access', detail: 'unknown' } as never,
    });
    const agentGateway = new RecordingAgentGateway();
    const service = new AgentService({
      planStore,
      runtime: new ScriptedRuntime([extraction]),
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
    const res = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'close-user',
      text: 'perdón, mi teléfono con código es +51 954779071',
      messageId: 'close-support-phone-1',
      receivedAt: new Date().toISOString(),
    });
    expect(res.plan.current_node).toBe('crear_lead_cerrar');
    expect(res.plan.contact_phone).toBe('51954779071');
  });
});

describe('close tool effect boundary reconstructed from token_seeded_close_flow', () => {
  async function fixture(userMessage: string) {
    const planStore = new InMemoryPlanStore();
    await seedClosedPlan(planStore);
    const plan = await planStore.getByExternalUser('whatsapp', 'close-user');
    if (!plan) throw new Error('Missing seeded plan');
    const createQuoteRequest = vi.fn().mockResolvedValue({ id: 'confirmed-quote-90' });
    const onPlanCompleted = vi.fn().mockResolvedValue(undefined);
    const runtime = new OpenAiAgentRuntime({ apiKey: 'test-key',
      replyModel: 'test-model', extractorModel: 'test-model',
      replyProviderLimit: 4, presentationProviderLimit: 5, providerDetailLookupLimit: 3,
      promptLoader, providerGateway: { createQuoteRequest } as unknown as ProviderGateway });
    const request: ComposeReplyRequest = {
      currentNode: 'crear_lead_cerrar', previousNode: 'crear_lead_cerrar', plan,
      userMessage, messageContext: localTurnMessageContext('not_configured'),
      extraction: baseExtraction({ actionIntent: 'cerrar', closeAction: {
        type: 'proceed_confirmed', category: null, reason: null,
      } }), missingFields: [], searchReady: true, providerResults: [], errorMessage: null,
      promptBundleId: 'test', promptFilePaths: [],
      toolUsage: { considered: [], called: [], inputs: [], outputs: [] }, onPlanCompleted,
    };
    const access = runtime as unknown as {
      createTools(request: ComposeReplyRequest, names: ['finish_plan']): ReturnType<typeof tool>[];
    };
    const finish = access.createTools(request, ['finish_plan'])[0];
    if (!finish) throw new Error('Missing finish tool');
    const invoke = () => finish.invoke(new RunContext(), JSON.stringify({ event_date: '2026-10-18' }));
    return { invoke, createQuoteRequest, onPlanCompleted, runtime, request };
  }

  it('omits finish_plan from the serialized phone-turn tool surface without enlarging instructions', async () => {
    const bodies: Array<{ instructions?: string; input?: unknown; tools?: Array<{ name?: string }> }> = [];
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockImplementation(async (_url, init) => {
        if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body) as typeof bodies[number]);
        return new Response(JSON.stringify({ error: { message: 'test quota',
          type: 'insufficient_quota', code: 'insufficient_quota' } }), {
          status: 429, headers: { 'content-type': 'application/json' },
        });
      });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const phone = await fixture('mi teléfono es 51954779071');
      await expect(phone.runtime.composeReply(phone.request)).rejects.toBeDefined();
      const phoneBody = bodies.find((body) => body.tools);
      bodies.length = 0;
      const confirmed = await fixture('Mi evento es el 18 de octubre de 2026. Confirmo el envío.');
      await expect(confirmed.runtime.composeReply(confirmed.request)).rejects.toBeDefined();
      const confirmedBody = bodies.find((body) => body.tools);
      expect(phoneBody).toBeDefined();
      expect(confirmedBody?.tools?.map((entry) => entry.name)).toContain('finish_plan');
      expect(phoneBody?.tools?.map((entry) => entry.name)).not.toContain('finish_plan');
      expect(phoneBody?.instructions).toBe(confirmedBody?.instructions);
      const metrics = (body: typeof phoneBody) => ({
        instructionBytes: Buffer.byteLength(body?.instructions ?? ''),
        inputBytes: Buffer.byteLength(JSON.stringify(body?.input ?? [])),
        toolBytes: Buffer.byteLength(JSON.stringify(body?.tools ?? [])),
      });
      expect(metrics(phoneBody).toolBytes).toBeLessThan(metrics(confirmedBody).toolBytes);
      process.stdout.write(JSON.stringify({ closePromptMetrics: { phone: metrics(phoneBody), confirmed: metrics(confirmedBody) } }) + '\n');
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects the exact model-hallucinated date on the original phone-only turn', async () => {
    const test = await fixture('mi teléfono es 51954779071');
    await test.invoke();
    expect(test.createQuoteRequest).not.toHaveBeenCalled();
    expect(test.onPlanCompleted).not.toHaveBeenCalled();
  });

  it('returns typed close facts to the model without backend prose', async () => {
    const test = await fixture('Mi evento es el 18 de octubre de 2026. Confirmo el envío.');
    const result = await test.invoke() as { status: string; effects: Array<Record<string, unknown>> };
    expect(result.status).toBe('success');
    expect(result.effects[0]).toEqual(expect.objectContaining({
      status: 'confirmed', eventDate: '2026-10-18', receiptId: 'confirmed-quote-90',
    }));
    expect(result).not.toHaveProperty('detail');
    expect(result).not.toHaveProperty('contacted_providers');
  });

  it('persists confirmed completion and reuses its effect if the model repeats the tool', async () => {
    const test = await fixture('Mi evento es el 18 de octubre de 2026. Confirmo el envío.');
    await test.invoke();
    expect(test.onPlanCompleted).toHaveBeenCalledWith(expect.objectContaining({ lifecycle_state: 'finished' }));
    await test.invoke();
    expect(test.createQuoteRequest).toHaveBeenCalledTimes(1);
  });
});
