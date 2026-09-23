import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { projectSafePlan } from '../src/runtime/artifact-redaction';
import { AgentService } from '../src/runtime/agent-service';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
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
const renderers = { terminal_whatsapp: new WhatsAppMessageRenderer() };

class ScriptedRuntime implements AgentRuntime {
  public readonly extractRequests: ExtractRequest[] = [];
  public readonly composeRequests: ComposeReplyRequest[] = [];
  private index = 0;
  constructor(private readonly extractions: ExtractionResult[]) {}
  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractRequests.push(request);
    const next = this.extractions[this.index] ?? this.extractions[this.extractions.length - 1];
    this.index += 1;
    if (!next) throw new Error('Missing extraction fixture.');
    return next;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: 'Respuesta informativa.' };
  }
}

class QuietKnowledgeGateway implements KnowledgeRetrievalGateway {
  async search(): Promise<never> {
    throw new Error('Knowledge search must not run on OTP recovery turns.');
  }
}

type TakeoverMode = 'success' | 'failed' | 'unknown' | 'throw';

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
    if (this.mode === 'success') return { status: 'success' as const, message: 'ok' };
    if (this.mode === 'failed') {
      return { status: 'failed' as const, error: 'rejected', retryable: false as const };
    }
    if (this.mode === 'unknown') {
      return {
        status: 'failed' as const, error: 'timeout', retryable: true as const, outcome: 'unknown' as const,
      };
    }
    throw new Error('takeover transport boom');
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
    return { status: 'failed' as const, error: 'disabled', retryable: false as const };
  }
  async updatePhone() {
    return { status: 'success' as const };
  }
}

function scriptedProviderGateway(options?: { verifyStatus?: 'authenticated' | 'invalid_code' }) {
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
        status: 'authenticated' as const, token: 'twin-jwt',
        tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
    },
  } as unknown as ProviderGateway;
  return {
    gateway,
    get requestCodeCalls() { return state.requestCodeCalls; },
    get verifyCodeCalls() { return state.verifyCodeCalls; },
  };
}

function createService(args: {
  runtime: AgentRuntime;
  agentGateway: RecordingAgentGateway;
  provider: ProviderGateway;
  planStore: InMemoryPlanStore;
  disabledTakeover?: boolean;
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
    ...(args.disabledTakeover
      ? {
          capabilityManifest: buildRuntimeCapabilityManifest({
            configured: true, environment: 'production',
            disabledOperations: ['human.takeover.write'],
          }),
        }
      : {}),
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

const GIFT_QUERY = 'Confirmar si el deposito del regalo llego a los novios y revisar el estado del pago.';

function codeRequest(authAction: 'provide_otp' | 'report_otp_not_received' | 'resend_otp' | 'none' = 'provide_otp') {
  return {
    kind: 'purchase' as const,
    resource: 'gift_purchases' as const,
    query: GIFT_QUERY,
    orderId: null,
    authAction,
  };
}

function faqRequest(query = 'Cual es el horario de atencion?') {
  return { kind: 'faq' as const, query };
}

async function seedOtpPlan(
  planStore: InMemoryPlanStore,
  userAuth: Record<string, unknown>,
  pendingQuery = GIFT_QUERY,
) {
  const seed = mergePlan(
    createEmptyPlan({ planId: 'c-terminal', channel: 'whatsapp', externalUserId: 'c-terminal-user' }),
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
            requestId: 'information-1', kind: 'purchase', resource: 'gift_purchases',
            query: pendingQuery, orderId: null, authAction: 'none',
          },
        ],
        selection_candidates: [],
        last_completed_request: null,
      },
    },
  );
  await planStore.save({ plan: seed, reason: 'twin-fixture' });
}

function offersAnotherOtp(text: string | null | undefined): boolean {
  return /reenviar|nuevo c[oó]digo|te envi[oó]|intenta de nuevo|copia y pega/i.test(text ?? '');
}

async function turn(
  service: AgentService,
  text: string,
  messageId: string,
  contactPhone: string | null = '+51900000302',
) {
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'c-terminal-user',
    ...(contactPhone === null ? {} : { contactPhone }),
    text,
    messageId,
    receivedAt: new Date().toISOString(),
  });
}

describe('C terminal auth: typed recovery persisted without core-to-runtime imports', () => {
  it('seeds legacy user_auth once and merges monotonically with redacted diagnostics', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([twinExtraction([codeRequest()])]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, '753994', 'c-seed-1');
    expect(first.plan.auth_recovery.sendAttempted).toBe(true);
    expect(first.plan.auth_recovery.verificationAttempted).toBe(true);
    expect(first.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(first.plan.current_node).toBe('solicitar_agente_humano');

    const safe = projectSafePlan(first.plan);
    expect(safe.auth_recovery.sendAttempted).toBe(true);
    expect(safe.auth_recovery.terminalReason).toBe('verification_failed');
    expect(safe.auth_recovery.challengeEmail).toBeNull();
    expect(safe.auth_recovery.preservedRequest).toBeNull();
    expect(JSON.stringify(safe)).not.toContain('fallback@example.invalid');
    expect(first.trace.plan_summary.auth_recovery_terminal_reason).toBe('verification_failed');
    expect(provider.verifyCodeCalls).toBe(1);
  });
});

describe('C terminal auth: 3-turn sequences per outcome', () => {
  it.each([
    { mode: 'success' as TakeoverMode, outcome: 'handoff_requested', requested: true, softPaused: true },
    { mode: 'failed' as TakeoverMode, outcome: 'handoff_failed', requested: false, softPaused: false },
    { mode: 'unknown' as TakeoverMode, outcome: 'outcome_unknown', requested: false, softPaused: false },
  ])('first invalid persists terminal before handoff ($mode); later codes never verify', async ({ mode, outcome, requested, softPaused }) => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([twinExtraction([codeRequest()])]);
    const agentGateway = new RecordingAgentGateway(mode);
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, '753994', 'c-3t-1');
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(first.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(first.plan.user_auth.failed_code_attempts).toBe(1);
    expect(first.plan.human_help_receipt?.outcome).toBe(outcome);
    expect(first.plan.human_help_receipt?.requested).toBe(requested);
    expect(first.plan.human_help_receipt?.softPaused).toBe(softPaused);
    expect(offersAnotherOtp(first.outbound.text)).toBe(false);

    const second = await turn(service, '753994', 'c-3t-2');
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(second.trace.tools_called).not.toContain('verify_user_login_code');
    expect(second.trace.tools_called).not.toContain('request_user_login_code');
    expect(second.trace.tools_called).not.toContain('request_human_takeover');
    expect(second.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(offersAnotherOtp(second.outbound.text)).toBe(false);

    const third = await turn(service, 'Ese es el codigo que me llego', 'c-3t-3');
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(third.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(offersAnotherOtp(third.outbound.text)).toBe(false);
  });

  it('disabled capability records skipped without fabricating receipts', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([twinExtraction([codeRequest()])]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({
      runtime, agentGateway, provider: provider.gateway, planStore, disabledTakeover: true,
    });
    const first = await turn(service, '753994', 'c-disabled-1');
    expect(provider.verifyCodeCalls).toBe(1);
    expect(agentGateway.takeoverCalls).toBe(0);
    expect(first.plan.human_help_receipt).toBeNull();
    expect(first.plan.human_escalation.status).toBe('none');
    expect(first.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(offersAnotherOtp(first.outbound.text)).toBe(false);
  });

  it('missing trusted phone records missing_identity without dispatch', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([twinExtraction([codeRequest()])]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });
    const first = await turn(service, '753994', 'c-nophone-1', null);
    expect(provider.verifyCodeCalls).toBe(1);
    expect(agentGateway.takeoverCalls).toBe(0);
    expect(first.plan.human_help_receipt).toBeNull();
    expect(first.plan.human_escalation.last_error).toContain('missing_identity');
    expect(first.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(first.outbound.text).toBe('Respuesta informativa.');
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      // C1: terminal escalation retains the pending protected requests, so
      // the reply preserves the pending question instead of claiming closure.
      protectedRequestsClosed: false,
      handoffOutcome: null,
    });
    expect(typeof runtime.composeRequests.at(-1)?.authenticationOutcome?.reason).toBe('string');
    expect(offersAnotherOtp(first.outbound.text)).toBe(false);
  });
});

describe('C terminal auth: rejection precedence and legacy seed', () => {
  it('conflicting support detail plus identity rejection keeps rejection precedence', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([
      twinExtraction([codeRequest('none')], {
        phoneConfirmation: 'no',
        supportAct: {
          kind: 'report_issue',
        },
      }),
    ]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });
    const first = await turn(service, 'Ese no es mi numero', 'c-reject-1');
    expect(first.plan.current_node).toBe('solicitar_agente_humano');
    expect(provider.verifyCodeCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(offersAnotherOtp(first.outbound.text)).toBe(false);
  });

  it('legacy exhausted seed stays terminal with no new send or verify', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, { otp_send_attempts: 2, otp_non_delivery_reports: 1 });
    const runtime = new ScriptedRuntime([twinExtraction([codeRequest()])]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });
    const first = await turn(service, '753994', 'c-legacy-1');
    expect(first.plan.auth_recovery.terminalReason).not.toBeNull();
    expect(provider.verifyCodeCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(offersAnotherOtp(first.outbound.text)).toBe(false);
  });
});

describe('C terminal auth: reset, FAQ, and help retry', () => {
  it('recovery and dedupe survive plan reset', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([
      twinExtraction([codeRequest()]),
      twinExtraction([], { actionIntent: 'reset_plan' }),
      twinExtraction([codeRequest()]),
    ]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    await turn(service, '753994', 'c-reset-1');
    const reset = await turn(service, 'empecemos de nuevo', 'c-reset-2');
    expect(reset.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(reset.plan.auth_recovery.sendAttempted).toBe(true);
    const after = await turn(service, '753994', 'c-reset-3');
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(after.plan.auth_recovery.terminalReason).toBe('verification_failed');
  });

  it('unrelated FAQ after failed handoff routes normally without clearing recovery', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([
      twinExtraction([codeRequest()]),
      twinExtraction([faqRequest()]),
    ]);
    const agentGateway = new RecordingAgentGateway('failed');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, '753994', 'c-faq-1');
    expect(first.plan.human_help_receipt?.outcome).toBe('handoff_failed');
    const second = await turn(service, 'Cual es el horario de atencion?', 'c-faq-2');
    expect(second.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
  });

  it('explicit failed-help retry attempts once and never renews OTP budget', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([
      twinExtraction([codeRequest()]),
      twinExtraction([codeRequest('none')], { actionIntent: 'solicitar_humano' }),
    ]);
    const agentGateway = new RecordingAgentGateway('failed');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    await turn(service, '753994', 'c-retry-1');
    expect(agentGateway.takeoverCalls).toBe(1);
    const second = await turn(service, 'Quiero hablar con una persona', 'c-retry-2');
    expect(agentGateway.takeoverCalls).toBe(2);
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(second.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(offersAnotherOtp(second.outbound.text)).toBe(false);
  });

  it('unknown handoff never retries even on explicit help request', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([
      twinExtraction([codeRequest()]),
      twinExtraction([codeRequest('none')], { actionIntent: 'solicitar_humano' }),
    ]);
    const agentGateway = new RecordingAgentGateway('unknown');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, '753994', 'c-unknown-1');
    expect(first.plan.human_help_receipt?.outcome).toBe('outcome_unknown');
    const second = await turn(service, 'Quiero hablar con una persona', 'c-unknown-2');
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(second.plan.human_help_receipt?.outcome).toBe('outcome_unknown');
    expect(offersAnotherOtp(second.outbound.text)).toBe(false);
  });

  it('refusal closes the protected request without renewing budget', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([
      twinExtraction([
        {
          kind: 'purchase', resource: 'gift_purchases', query: GIFT_QUERY, orderId: null, authAction: 'decline_authentication',
        },
      ]),
      twinExtraction([codeRequest()]),
    ]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway();
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, 'No quiero verificarme', 'c-refuse-1');
    expect(first.plan.auth_recovery.terminalReason).toBe('auth_refused');
    expect(agentGateway.takeoverCalls).toBe(0);
    const second = await turn(service, '753994', 'c-refuse-2');
    expect(provider.verifyCodeCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(second.plan.auth_recovery.terminalReason).toBe('auth_refused');
  });
});

describe('C terminal auth: R4 exact reason and handoff preservation across repeats', () => {
  it('repeat keeps verification_failed and the failed handoff outcome with no new sends or verifies', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([twinExtraction([codeRequest()])]);
    const agentGateway = new RecordingAgentGateway('failed');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({ runtime, agentGateway, provider: provider.gateway, planStore });

    const first = await turn(service, '753994', 'c-r4-1');
    expect(first.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(first.plan.human_help_receipt?.outcome).toBe('handoff_failed');
    // First terminal turn carries the specific verification guidance reason;
    // it must name verification failure, never generic non-delivery.
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      handoffOutcome: 'handoff_failed',
    });
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome?.reason).toMatch(/verification_failed/);
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome?.reason).not.toBe('otp_recovery_exhausted');

    const second = await turn(service, '753994', 'c-r4-2');
    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(agentGateway.takeoverCalls).toBe(1);
    expect(second.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(second.plan.human_help_receipt?.outcome).toBe('handoff_failed');
    expect(second.trace.tools_called).not.toContain('verify_user_login_code');
    expect(second.trace.tools_called).not.toContain('request_user_login_code');
    expect(second.trace.tools_called).not.toContain('request_human_takeover');
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      reason: 'verification_failed',
      handoffOutcome: 'handoff_failed',
    });
  });

  it('disabled handoff stays unavailable with no dispatched effect and exact terminal reason', async () => {
    const planStore = new InMemoryPlanStore();
    await seedOtpPlan(planStore, {});
    const runtime = new ScriptedRuntime([twinExtraction([codeRequest()])]);
    const agentGateway = new RecordingAgentGateway('success');
    const provider = scriptedProviderGateway({ verifyStatus: 'invalid_code' });
    const service = createService({
      runtime, agentGateway, provider: provider.gateway, planStore, disabledTakeover: true,
    });
    const first = await turn(service, '753994', 'c-r4-unavail-1');
    expect(first.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(agentGateway.takeoverCalls).toBe(0);
    expect(first.plan.human_help_receipt).toBeNull();
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      handoffOutcome: null,
    });
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome?.reason).toMatch(/verification_failed/);
    const second = await turn(service, '753994', 'c-r4-unavail-2');
    expect(agentGateway.takeoverCalls).toBe(0);
    expect(second.plan.auth_recovery.terminalReason).toBe('verification_failed');
    expect(second.trace.tools_called).not.toContain('request_human_takeover');
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome?.handoffOutcome).toBeNull();
  });
});
