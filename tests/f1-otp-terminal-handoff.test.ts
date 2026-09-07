import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { AgentGatewayResult } from '../src/runtime/agent-conversation-gateway';
import {
  decideTerminalContinuation,
  type LegacyAuthFields,
} from '../src/runtime/information-auth-state-machine';import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
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
const renderers = {
  terminal_whatsapp: new WhatsAppMessageRenderer(),
};

class ScriptedRuntime implements AgentRuntime {
  public readonly extractRequests: ExtractRequest[] = [];

  private index = 0;

  constructor(private readonly extractions: ExtractionResult[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractRequests.push(request);
    const next = this.extractions[this.index] ?? this.extractions[this.extractions.length - 1];
    this.index += 1;
    if (!next) {
      throw new Error('Missing extraction fixture.');
    }
    return next;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    return { text: 'Respuesta informativa.' };
  }
}

class QuietKnowledgeGateway implements KnowledgeRetrievalGateway {
  async search(): Promise<never> {
    throw new Error('Knowledge search must not run on OTP recovery turns.');
  }
}

class RecordingAgentGateway {
  public takeoverCalls = 0;

  async logMessage(): Promise<AgentGatewayResult> {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async getRecentMessages(): Promise<
    | { status: 'success'; messages: [] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async requestHumanTakeover(): Promise<AgentGatewayResult> {
    this.takeoverCalls += 1;
    return { status: 'success', message: 'Human takeover requested (twin).' };
  }

  async getOrders(): Promise<never> {
    throw new Error('Orders lookup must not run on OTP recovery turns.');
  }

  async getGiftPurchases(): Promise<never> {
    throw new Error('Gift lookup must not run on OTP recovery turns.');
  }

  async getGuestOrdersByPhone() {
    return { status: 'not_found' as const, resource: 'orders' as const, orderId: null };
  }

  async getGuestGiftPurchasesByPhone() {
    return { status: 'not_found' as const, resource: 'gift_purchases' as const, orderId: null };
  }

  async authByPhone() {
    return { status: 'failed' as const, error: 'phone auth disabled in twin', retryable: false as const };
  }

  async updatePhone() {
    return { status: 'success' as const };
  }
}

function scriptedProviderGateway(options?: {
  verifyStatus?: 'authenticated' | 'invalid_code';
}): { gateway: ProviderGateway; requestCodeCalls: number; verifyCodeCalls: number } {
  const state = { requestCodeCalls: 0, verifyCodeCalls: 0 };
  const gateway = {
    async requestUserLoginCode() {
      state.requestCodeCalls += 1;
      return { status: 'sent' as const };
    },
    async verifyUserLoginCode() {
      state.verifyCodeCalls += 1;
      if (options?.verifyStatus === 'invalid_code') {
        return { status: 'invalid_code' as const, error: 'El codigo es invalido.' };
      }
      return {
        status: 'authenticated' as const,
        token: 'twin-jwt',
        tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
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
  };
}

function reportContinuation() {
  return {
    kind: 'purchase' as const,
    resource: 'gift_purchases' as const,
    query: 'Revisar el estado del regalo pagado por la persona.',
    orderId: null,
    aspects: ['summary' as const, 'payment_status' as const],
    sensitiveFields: [],
    authAction: 'report_otp_not_received' as const,
  };
}

async function seedOtpPlan(
  planStore: InMemoryPlanStore,
  userAuth: Record<string, unknown>,
  pendingQuery = 'Revisar el estado del regalo pagado por la persona.',
) {
  const seed = mergePlan(
    createEmptyPlan({
      planId: 'f1-otp-handoff',
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
    }),
    {
      current_node: 'resolver_consultas_informativas',
      contact_email: 'fallback@example.invalid',
      user_auth: {
        status: 'code_requested',
        email: 'fallback@example.invalid',
        token: null,
        token_expires_at: null,
        last_error: null,
        requested_at: '2026-08-24T21:18:00.000Z',
        failed_code_attempts: 0,
        otp_send_attempts: 1,
        otp_non_delivery_reports: 0,
        auth_method: null,
        awaiting_phone_confirmation: false,
        ...userAuth,
      },
      information_state: {
        resume_node: 'deteccion_intencion',
        pending_requests: [
          {
            requestId: 'information-1',
            kind: 'purchase',
            resource: 'gift_purchases',
            query: pendingQuery,
            orderId: null,
            aspects: ['summary', 'payment_status'],
            sensitiveFields: [],
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

describe('decideTerminalContinuation one-shot report wiring', () => {
  const challenged: LegacyAuthFields = {
    status: 'code_requested',
    email: 'fallback@example.invalid',
    requestedAt: '2026-08-24T21:18:00.000Z',
    failedCodeAttempts: 0,
    otpSendAttempts: 1,
    otpNonDeliveryReports: 0,
  };

  it('terminates on the first non-delivery report of an active challenge', () => {
    expect(decideTerminalContinuation('report_otp_not_received', challenged)).toBe(
      'non_delivery_reported',
    );
  });

  it('terminates on a resend request of an active challenge', () => {
    expect(decideTerminalContinuation('resend_otp', challenged)).toBe('resend_requested');
  });

  it('keeps already-terminal episodes terminal', () => {
    const terminated: LegacyAuthFields = { ...challenged, otpNonDeliveryReports: 1 };
    expect(decideTerminalContinuation('report_otp_not_received', terminated)).toBe(
      'legacy_terminated',
    );
  });

  it('does not terminate unchallenged flows or unrelated actions', () => {
    const fresh: LegacyAuthFields = {
      status: 'none',
      email: null,
      requestedAt: null,
      failedCodeAttempts: 0,
      otpSendAttempts: 0,
      otpNonDeliveryReports: 0,
    };
    expect(decideTerminalContinuation('report_otp_not_received', fresh)).toBeNull();
    expect(decideTerminalContinuation('resend_otp', fresh)).toBeNull();
    expect(decideTerminalContinuation('provide_otp', challenged)).toBeNull();
    expect(decideTerminalContinuation('none', challenged)).toBeNull();
  });
});

describe('F1a first non-delivery report ends one-shot OTP recovery', () => {
  it('hands off to human support without resending when the first report arrives', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, { otp_send_attempts: 1, otp_non_delivery_reports: 0 });
    const runtime = new ScriptedRuntime([twinExtraction([reportContinuation()])]);
    const agentGateway = new RecordingAgentGateway();
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
      contactPhone: '+51900000302',
      text: 'No me llega ningun codigo.',
      messageId: 'f1a-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(provider.requestCodeCalls).toBe(0);
    expect(provider.verifyCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(response.plan.information_state.pending_requests.map((request) => request.query)).toContain(
      'Revisar el estado del regalo pagado por la persona.',
    );
  });
});

describe('F1b repeated missing-code report and resend request hand off without a second send', () => {
  it('hands off a second missing-code report after a prior resend', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(
      planStore,
      {
        status: 'code_requested',
        email: 'regression-not-received@example.invalid',
        otp_send_attempts: 2,
        otp_non_delivery_reports: 1,
      },
      '¿La restricción de vestir de blanco aplica a mujeres y varones?',
    );
    const runtime = new ScriptedRuntime([twinExtraction([reportContinuation()])]);
    const agentGateway = new RecordingAgentGateway();
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
      contactPhone: '+51900000302',
      text: 'No me ha llegado',
      messageId: 'f1b-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(provider.requestCodeCalls).toBe(0);
    expect(provider.verifyCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(response.plan.information_state.pending_requests).toHaveLength(1);
  });

  it('hands off an explicit resend request on an active challenge without sending', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, { otp_send_attempts: 1, otp_non_delivery_reports: 0 });
    const runtime = new ScriptedRuntime([twinExtraction([{
      kind: 'purchase',
      resource: 'gift_purchases',
      query: 'Revisar el estado del regalo pagado por la persona.',
      orderId: null,
      aspects: ['summary', 'payment_status'],
      sensitiveFields: [],
      authAction: 'resend_otp',
    }])]);
    const agentGateway = new RecordingAgentGateway();
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
      contactPhone: '+51900000302',
      text: 'Reenvien el codigo por favor.',
      messageId: 'f1b-2',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(provider.requestCodeCalls).toBe(0);
    expect(provider.verifyCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
  });
});

describe('F1c first rejected code verifies once then retains the human path', () => {
  const giftQuery = 'Confirmar si el deposito del regalo llego a los novios y revisar el estado del pago.';

  function codeContinuation() {
    return {
      kind: 'purchase' as const,
      resource: 'gift_purchases' as const,
      query: giftQuery,
      orderId: null,
      aspects: ['payment_status' as const, 'payment_details' as const],
      sensitiveFields: [],
      authAction: 'provide_otp' as const,
    };
  }

  async function seedGiftPlan(planStore: InMemoryPlanStore) {
    await seedOtpPlan(planStore, {}, giftQuery);
  }

  it('verifies the first code once and hands off on rejection without resending', async () => {
    const planStore = new InMemoryPlanStore();
    await seedGiftPlan(planStore);
    const runtime = new ScriptedRuntime([twinExtraction([codeContinuation()])]);
    const agentGateway = new RecordingAgentGateway();
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
      contactPhone: '+51900000302',
      text: '753994',
      messageId: 'f1c-1',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.user_auth.failed_code_attempts).toBe(1);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(response.plan.information_state.pending_requests.map((request) => request.query)).toContain(
      giftQuery,
    );
  });

  it('never verifies a later code once terminal and records a single handoff', async () => {
    const planStore = new InMemoryPlanStore();
    await seedGiftPlan(planStore);
    const runtime = new ScriptedRuntime([twinExtraction([codeContinuation()])]);
    const agentGateway = new RecordingAgentGateway();
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
      contactPhone: '+51900000302',
      text: '753994',
      messageId: 'f1c-1',
      receivedAt: new Date().toISOString(),
    });
    const second = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
      contactPhone: '+51900000302',
      text: '753994',
      messageId: 'f1c-2',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(second.trace.tools_called).toContain('request_human_takeover');
    expect(second.trace.tools_called).not.toContain('verify_user_login_code');
    expect(second.trace.tools_called).not.toContain('request_user_login_code');
    expect(second.plan.human_escalation.status).toBe('requested');
    expect(second.plan.user_auth.failed_code_attempts).toBe(1);
    expect(second.plan.information_state.pending_requests.map((request) => request.query)).toContain(
      giftQuery,
    );

    const third = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'f1-otp-handoff-user',
      contactPhone: '+51900000302',
      text: 'Ese es el codigo que me llego',
      messageId: 'f1c-3',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(third.plan.human_escalation.status).toBe('requested');
    expect(third.plan.user_auth.failed_code_attempts).toBe(1);
  });
});
