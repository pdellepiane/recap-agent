import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { buildTurnMessageContext } from '../src/runtime/turn-message-context';
import { AgentService, CUSTOMER_CONTEXT_READ_BUDGET_MS } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { InMemoryEvalFixtureStateStore } from '../src/runtime/eval-fixture-state';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { projectCustomerContext, mergeCustomerContextSnapshots } from '../src/runtime/customer-context';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import type { MessageResponseClassifier } from '../src/runtime/message-response-classifier';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = {
  terminal_whatsapp: new WhatsAppMessageRenderer(),
  whatsapp: new WhatsAppMessageRenderer(),
};

const PHONE = '+51941438999';
const TRUSTED_PHONE = { phone_extension: '+51', phone_number: '941438999' };

class StubRuntime implements AgentRuntime {
  public readonly extractRequests: ExtractRequest[] = [];
  public readonly composeRequests: ComposeReplyRequest[] = [];
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
    this.composeRequests.push(request);
    return { text: 'Respuesta informativa.' };
  }
}

function emptyExtraction(): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    phoneConfirmation: null,
    intentConfidence: 0.99,
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
    conversationSummary: '',
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
  } as unknown as ExtractionResult;
}

function fakeKnowledgeGateway(): KnowledgeRetrievalGateway {
  return {
    search: async () => ({ status: 'success', evidence: [] }),
  } as unknown as KnowledgeRetrievalGateway;
}

function fakeProviderGateway(): ProviderGateway {
  return {} as unknown as ProviderGateway;
}

async function fixtureGateway(
  store: InMemoryEvalFixtureStateStore,
): Promise<FixtureAgentConversationGateway> {
  return FixtureAgentConversationGateway.create('rsvp-plus-one-multiple-pending', undefined, {
    stateStore: store,
    runId: 'run-profile',
    caseId: 'case-profile',
    conversationKey: 'conv-profile',
  });
}

function realRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'offline-test-key',
    replyModel: 'gpt-6-luna',
    extractorModel: 'gpt-6-luna',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader,
    providerGateway: {} as never,
  });
}

describe('customer profile deadline origin and failure mapping (Finding 2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads fixture roots when classifier time exceeds seven seconds before preparation', async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await fixtureGateway(store);
    const runtime = new StubRuntime([emptyExtraction()]);
    const provider = fakeProviderGateway();
    const classifier: MessageResponseClassifier = {
      mode: 'observe',
      classify: async () => {
        now += 9_277;
        return {
          trace: {
            mode: 'observe',
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
      },
    };
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: provider,
      promptLoader,
      renderers,
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: fakeKnowledgeGateway(),
        providerGateway: provider,
        agentGateway: gateway as unknown as AgentConversationGateway,
      }),
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
      responseClassifier: classifier,
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'profile-deadline-user',
      contactPhone: PHONE,
      text: '¿Cuáles son mis eventos?',
      messageId: 'profile-deadline-1',
      receivedAt: new Date(now).toISOString(),
    });

    expect(CUSTOMER_CONTEXT_READ_BUDGET_MS).toBe(7_000);
    expect(runtime.extractRequests).toHaveLength(1);
    const customerContext = runtime.extractRequests[0]?.customerContext;
    expect(customerContext).toBeDefined();
    const names = (customerContext?.invitations ?? []).map((event) => event.name);
    expect(names).toContain('Boda Ana y Luis');
    expect(names).toContain('Cumpleaños Marta');
    expect(customerContext?.coverage.invitationsEvents.status).not.toBe('failed');
    expect(customerContext?.coverage.purchasesCarts.status).not.toBe('failed');
  });

  it('marks both purchase and event sections failed on preparation deadline exhaustion, never not_configured', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await fixtureGateway(store);
    const provider = fakeProviderGateway();
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: fakeKnowledgeGateway(),
      providerGateway: provider,
      agentGateway: gateway as unknown as AgentConversationGateway,
    });
    const expiredDeadline = Date.now() - 1;
    const snapshot = await orchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: TRUSTED_PHONE,
      identity: { customerRef: PHONE, scope: 'trusted_phone', source: 'channel_contact_phone' },
      currentContext: null,
      deadlineMs: expiredDeadline,
    });
    expect(snapshot.purchasesCarts.status).toBe('failed');
    expect(snapshot.purchasesCarts.source).toBe('deadline');
    expect(snapshot.invitationsEvents.status).toBe('failed');
    expect(snapshot.invitationsEvents.source).toBe('deadline');
    expect(snapshot.readMetrics?.totalReads).toBe(0);

    const execution = await orchestrator.execute({
      requests: [
        { requestId: 'expired-purchase', kind: 'purchase', resource: 'purchase_discovery', query: 'q', orderId: null, authAction: 'none' },
        { requestId: 'expired-event', kind: 'associated_event', query: 'q', eventHint: null, authAction: 'none' },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: TRUSTED_PHONE,
      preparedCustomerContext: snapshot,
      deadlineMs: expiredDeadline,
    });
    for (const result of execution.results) {
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.failureKind).toBe('request_failed');
        expect(result.retryable).toBe(true);
      }
    }
    expect(execution.results.some((result) => result.status === 'failed' && result.failureKind === 'not_configured')).toBe(false);
    expect(execution.results.some((result) => result.status === 'failed' && result.failureKind === 'not_found')).toBe(false);
  });

  it('carries both events and details into the canonical profile and serialized model requests', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await fixtureGateway(store);
    const provider = fakeProviderGateway();
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: fakeKnowledgeGateway(),
      providerGateway: provider,
      agentGateway: gateway as unknown as AgentConversationGateway,
    });
    const snapshot = await orchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: TRUSTED_PHONE,
      identity: { customerRef: PHONE, scope: 'trusted_phone', source: 'channel_contact_phone' },
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    expect(snapshot.readMetrics?.totalReads).toBe(6);
    expect(snapshot.readMetrics?.peakConcurrency).toBeLessThanOrEqual(4);
    const names = snapshot.invitationsEvents.invitations.map((event) => event.name);
    expect(names).toContain('Boda Ana y Luis');
    expect(names).toContain('Cumpleaños Marta');

    const customerContext = projectCustomerContext(snapshot);
    expect(customerContext.invitations).toHaveLength(2);
    const openAi = realRuntime();
    const plan = mergePlan(
      createEmptyPlan({ planId: 'profile-serialized', channel: 'whatsapp', externalUserId: 'profile-user' }),
      { current_node: 'resolver_consultas_informativas' },
    );
    const messageContext = buildTurnMessageContext({
      inbound: {
        channel: 'whatsapp',
        externalUserId: 'profile-user',
        text: '¿Cuáles son mis eventos?',
        messageId: 'profile-serialized-1',
        receivedAt: new Date().toISOString(),
        contactPhone: PHONE,
      },
      messages: [],
    });
    const extractSpec = await openAi.buildExtractionRequestSpec({
      userMessage: '¿Cuáles son mis eventos?',
      plan,
      messageContext,
      customerContext,
    });
    expect(extractSpec.input).toContain('Boda Ana y Luis');
    expect(extractSpec.input).toContain('Cumpleaños Marta');
    expect(extractSpec.input).toContain('Ana');
  });

  it('reuses prepared roots without new gateway reads and keeps concurrency bounded', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await fixtureGateway(store);
    const provider = fakeProviderGateway();
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: fakeKnowledgeGateway(),
      providerGateway: provider,
      agentGateway: gateway as unknown as AgentConversationGateway,
    });
    const snapshot = await orchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: TRUSTED_PHONE,
      identity: { customerRef: PHONE, scope: 'trusted_phone', source: 'channel_contact_phone' },
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    const guestEventsSpy = vi.spyOn(gateway, 'getGuestEventsByPhone');
    const guestOrdersSpy = vi.spyOn(gateway, 'getGuestOrdersByPhone');
    const guestGiftsSpy = vi.spyOn(gateway, 'getGuestGiftPurchasesByPhone');
    const eventDetailSpy = vi.spyOn(gateway, 'getEventDetail');

    await orchestrator.execute({
      requests: [
        { requestId: 'reuse-purchase', kind: 'purchase', resource: 'purchase_discovery', query: 'q', orderId: null, authAction: 'none' },
        { requestId: 'reuse-event', kind: 'associated_event', query: 'q', eventHint: null, authAction: 'none' },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: TRUSTED_PHONE,
      preparedCustomerContext: snapshot,
      deadlineMs: Date.now() + 30_000,
    });

    expect(guestEventsSpy).not.toHaveBeenCalled();
    expect(guestOrdersSpy).not.toHaveBeenCalled();
    expect(guestGiftsSpy).not.toHaveBeenCalled();
    expect(eventDetailSpy).not.toHaveBeenCalled();
    expect(snapshot.readMetrics?.peakConcurrency).toBeLessThanOrEqual(4);
  });

  it('extends post-auth account scope without duplicating phone reads', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await fixtureGateway(store);
    const provider = fakeProviderGateway();
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: fakeKnowledgeGateway(),
      providerGateway: provider,
      agentGateway: gateway as unknown as AgentConversationGateway,
    });
    const phoneSnapshot = await orchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: TRUSTED_PHONE,
      identity: { customerRef: PHONE, scope: 'trusted_phone', source: 'channel_contact_phone' },
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    const guestEventsSpy = vi.spyOn(gateway, 'getGuestEventsByPhone');
    const guestOrdersSpy = vi.spyOn(gateway, 'getGuestOrdersByPhone');

    const accountSnapshot = await orchestrator.prepareCustomerContext({
      authentication: { token: 'synthetic-token', email: 'customer@example.invalid' },
      trustedPhone: null,
      identity: { customerRef: 'customer@example.invalid', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      deadlineMs: Date.now() + CUSTOMER_CONTEXT_READ_BUDGET_MS,
    });
    const merged = mergeCustomerContextSnapshots(phoneSnapshot, accountSnapshot);
    expect(guestEventsSpy).not.toHaveBeenCalled();
    expect(guestOrdersSpy).not.toHaveBeenCalled();
    expect(merged.identityAccess.authorizedScopes).toContain('trusted_phone_purchase');
    const names = merged.invitationsEvents.invitations.map((event) => event.name);
    expect(names).toContain('Boda Ana y Luis');
    expect(names).toContain('Cumpleaños Marta');
  });

  it('preserves both records on follow-up without mutating RSVP', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await fixtureGateway(store);
    const runtime = new StubRuntime([emptyExtraction(), emptyExtraction()]);
    const provider = fakeProviderGateway();
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: provider,
      promptLoader,
      renderers,
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: fakeKnowledgeGateway(),
        providerGateway: provider,
        agentGateway: gateway as unknown as AgentConversationGateway,
      }),
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
    });
    const base = {
      channel: 'whatsapp',
      externalUserId: 'profile-followup-user',
      contactPhone: PHONE,
      receivedAt: new Date().toISOString(),
    } as const;
    await service.handleTurn({ ...base, text: '¿Cuáles son mis eventos?', messageId: 'profile-followup-1' });
    await service.handleTurn({ ...base, text: '¿Y a qué hora es la boda?', messageId: 'profile-followup-2' });

    expect(runtime.extractRequests).toHaveLength(2);
    for (const request of runtime.extractRequests) {
      const names = (request.customerContext?.invitations ?? []).map((event) => event.name);
      expect(names).toContain('Boda Ana y Luis');
      expect(names).toContain('Cumpleaños Marta');
    }
    expect(await store.count('run-profile', 'case-profile', 'rsvp.write')).toBe(0);
  });
});
