import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ExtractionResult,
} from '../src/runtime/contracts';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { ScriptedAgentRuntime as ScriptedRuntime } from './agent-runtime-test-utils';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = { terminal_whatsapp: new WhatsAppMessageRenderer() };

class QuietKnowledgeGateway implements KnowledgeRetrievalGateway {
  async search(): Promise<never> {
    throw new Error('Knowledge search must not run on auth turns.');
  }
}

type TakeoverMode = 'success' | 'failed';

class RecordingAgentGateway {
  public takeoverCalls = 0;
  constructor(private readonly mode: TakeoverMode = 'success') {}
  async logMessage() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async getRecentMessages() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async requestHumanTakeover() {
    this.takeoverCalls += 1;
    if (this.mode === 'failed') {
      return { status: 'failed' as const, error: 'rejected', retryable: false as const };
    }
    return { status: 'success' as const, message: 'ok' };
  }
  async getOrders(): Promise<never> {
    throw new Error('Orders lookup must not run on auth turns.');
  }
  async getGiftPurchases(): Promise<never> {
    throw new Error('Gift lookup must not run on auth turns.');
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
  const state = { requestCodeCalls: 0, verifyCodeCalls: 0 };
  const gateway = {
    async requestUserLoginCode() {
      state.requestCodeCalls += 1;
      return { status: 'sent' as const };
    },
    async verifyUserLoginCode() {
      state.verifyCodeCalls += 1;
      return { status: 'invalid_code' as const, error: 'El codigo es invalido.' };
    },
  } as unknown as ProviderGateway;
  return {
    gateway,
    get requestCodeCalls() {
      return state.requestCodeCalls;
    },
    get verifyCodeCalls() {
      return state.verifyCodeCalls;
    },
  };
}

function createService(args: {
  runtime: AgentRuntime;
  agentGateway: RecordingAgentGateway;
  provider: ProviderGateway;
  planStore: InMemoryPlanStore;
}): AgentService {
  return new AgentService({
    planStore: args.planStore,
    runtime: args.runtime,
    providerGateway: args.provider,
    promptLoader,
    renderers,
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: new QuietKnowledgeGateway(),
      providerGateway: args.provider,
      agentGateway: args.agentGateway as never,
    }),
    agentConversationGateway: args.agentGateway as never,
  });
}

function twinExtraction(
  informationRequests: ExtractionResult['informationRequests'],
  overrides: Partial<ExtractionResult> = {},
): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests,
    phoneConfirmation: null,
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
    conversationSummary: 'Consulta informativa.',
    selectedProviderHints: [],
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

const PENDING_QUERY = '¿La restricción de vestir de blanco aplica a mujeres y varones?';

function rejectedAccountRequest(authAction: 'decline_authentication' | 'none' = 'decline_authentication') {
  return {
    kind: 'associated_event' as const,
    query: PENDING_QUERY,
    eventHint: 'Karem y Alfredo',
    authAction,
  };
}

async function seedPhoneAuthenticatedPlan(planStore: InMemoryPlanStore) {
  const seed = mergePlan(
    createEmptyPlan({ planId: 'phone-reject', channel: 'whatsapp', externalUserId: 'phone-reject-user' }),
    {
      current_node: 'resolver_consultas_informativas',
      contact_phone_number: '+51900000901',
      user_auth: {
        status: 'authenticated',
        email: 'prior-account@example.invalid',
        token: 'seeded-phone-token',
        token_expires_at: '2026-12-01T00:00:00.000Z',
        last_error: null,
        requested_at: null,
        failed_code_attempts: 0,
        otp_send_attempts: 0,
        otp_non_delivery_reports: 0,
        auth_method: 'phone',
        awaiting_phone_confirmation: false,
      },
      information_state: {
        resume_node: 'entrevista',
        pending_requests: [
          {
            requestId: 'information-1',
            kind: 'associated_event',
            query: PENDING_QUERY,
            eventHint: 'Karem y Alfredo',
            authAction: 'none',
          },
        ],
        selection_candidates: [],
        last_completed_request: null,
      },
    },
  );
  await planStore.save({ plan: seed, reason: 'twin-fixture' });
}

async function seedUnauthenticatedRefusalPlan(planStore: InMemoryPlanStore) {
  const seed = mergePlan(
    createEmptyPlan({ planId: 'auth-refuse', channel: 'whatsapp', externalUserId: 'auth-refuse-user' }),
    {
      current_node: 'resolver_consultas_informativas',
      user_auth: {
        status: 'none',
        email: null,
        token: null,
        token_expires_at: null,
        last_error: 'No account found for current phone.',
        requested_at: null,
        failed_code_attempts: 0,
        otp_send_attempts: 0,
        otp_non_delivery_reports: 0,
        auth_method: null,
        awaiting_phone_confirmation: false,
      },
      information_state: {
        resume_node: 'entrevista',
        pending_requests: [
          {
            requestId: 'information-1',
            kind: 'purchase',
            resource: 'gift_purchases',
            query: 'Revisar una compra protegida.',
            orderId: null,
            authAction: 'none',
          },
        ],
        selection_candidates: [],
        last_completed_request: null,
      },
    },
  );
  await planStore.save({ plan: seed, reason: 'twin-fixture' });
}

async function turn(
  service: AgentService,
  text: string,
  messageId: string,
  externalUserId = 'phone-reject-user',
  contactPhone: string | null = '+51900000901',
) {
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId,
    ...(contactPhone === null ? {} : { contactPhone }),
    text,
    messageId,
    receivedAt: new Date().toISOString(),
  });
}

describe('Phone identity rejection vs authentication refusal', () => {
  it('identity rejection preserves the pending question and requests handoff exactly once', async () => {
    const planStore = new InMemoryPlanStore();
    await seedPhoneAuthenticatedPlan(planStore);
    const runtime = new ScriptedRuntime([twinExtraction([rejectedAccountRequest()])]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, 'Esa no es mi cuenta ni el número que tengo registrado.', 'phone-reject-1');

    expect(first.plan.current_node).toBe('solicitar_agente_humano');
    expect(first.plan.information_state.pending_requests).toHaveLength(1);
    expect(first.plan.information_state.pending_requests[0]?.query).toBe(PENDING_QUERY);
    expect(first.plan.user_auth.status).toBe('none');
    expect(first.plan.user_auth.token).toBeNull();
    expect(first.plan.user_auth.auth_method).toBeNull();
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(provider.verifyCodeCalls).toBe(0);
    expect(first.trace.turn_decision.stopReason).toBe('identity_rejected');
    expect(first.trace.plan_persist_reason).toBe('information_authentication_terminal_handoff');

    const noStore = new InMemoryPlanStore();
    await seedPhoneAuthenticatedPlan(noStore);
    const noRuntime = new ScriptedRuntime([
      twinExtraction([rejectedAccountRequest('none')], { phoneConfirmation: 'no' }),
    ]);
    const noGateway = new RecordingAgentGateway('success');
    const noProvider = scriptedProviderGateway();
    const noService = createService({ runtime: noRuntime, agentGateway: noGateway, provider: noProvider.gateway, planStore: noStore });

    const noFirst = await turn(noService, 'Ese no es mi numero.', 'phone-reject-no-1');

    expect(noFirst.plan.current_node).toBe('solicitar_agente_humano');
    expect(noFirst.plan.information_state.pending_requests).toHaveLength(1);
    expect(noGateway.takeoverCalls).toBe(1);
    expect(noFirst.trace.turn_decision.stopReason).toBe('identity_rejected');

    // A repeated rejection never dispatches a duplicate handoff.
    const dedupeStore = new InMemoryPlanStore();
    await seedPhoneAuthenticatedPlan(dedupeStore);
    const dedupeRuntime = new ScriptedRuntime([
      twinExtraction([rejectedAccountRequest()]),
      twinExtraction([rejectedAccountRequest()]),
    ]);
    const dedupeGateway = new RecordingAgentGateway('success');
    const dedupeProvider = scriptedProviderGateway();
    const dedupeService = createService({ runtime: dedupeRuntime, agentGateway: dedupeGateway, provider: dedupeProvider.gateway, planStore: dedupeStore });

    await turn(dedupeService, 'Esa no es mi cuenta ni el número que tengo registrado.', 'phone-reject-dedupe-1');
    const dedupeSecond = await turn(dedupeService, 'Esa no es mi cuenta ni el número que tengo registrado.', 'phone-reject-dedupe-2');

    expect(dedupeGateway.takeoverCalls).toBe(1);
    expect(dedupeSecond.plan.current_node).toBe('solicitar_agente_humano');
    expect(dedupeSecond.plan.information_state.pending_requests).toHaveLength(1);
    expect(dedupeProvider.requestCodeCalls).toBe(0);
    expect(dedupeProvider.verifyCodeCalls).toBe(0);
  });

  it('explicit authentication refusal without a phone identity closes the protected request with no handoff', async () => {
    const planStore = new InMemoryPlanStore();
    await seedUnauthenticatedRefusalPlan(planStore);
    const runtime = new ScriptedRuntime([
      twinExtraction([
        {
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Revisar una compra protegida.',
          orderId: null,
          authAction: 'decline_authentication',
        },
      ]),
    ]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(
      service,
      'No doy mis datos personales y no quiero continuar con esta verificación.',
      'auth-refuse-1',
      'auth-refuse-user',
    );

    expect(first.plan.current_node).toBe('entrevista');
    expect(first.plan.information_state.pending_requests).toHaveLength(0);
    expect(agentGateway.takeoverCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(provider.verifyCodeCalls).toBe(0);
    expect(first.plan.auth_recovery.terminalReason).toBe('auth_refused');
  });

  it('failed handoff keeps the pending question and reports the real outcome, never success', async () => {
    const planStore = new InMemoryPlanStore();
    await seedPhoneAuthenticatedPlan(planStore);
    const runtime = new ScriptedRuntime([twinExtraction([rejectedAccountRequest()])]);
    const agentGateway = new RecordingAgentGateway('failed');
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, 'Esa no es mi cuenta ni el número que tengo registrado.', 'phone-reject-failed-1');

    expect(agentGateway.takeoverCalls).toBe(1);
    expect(first.plan.current_node).toBe('solicitar_agente_humano');
    expect(first.plan.information_state.pending_requests).toHaveLength(1);
    expect(first.plan.human_help_receipt?.outcome).toBe('handoff_failed');
    const composed = runtime.composeRequests[0];
    expect(composed?.authenticationOutcome?.handoffOutcome).toBe('handoff_failed');
    expect(composed?.handoffOutcome).toBe('handoff_failed');
  });
});
