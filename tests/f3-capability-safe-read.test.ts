import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type { PendingInformationRequest } from '../src/core/information';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { CustomerExecution } from '../src/runtime/customer-context';
import { fixtureCustomerContextOrchestrator } from './customer-context-test-utils';
import { createEmptyPlan } from '../src/core/plan';

function modifyExtraction(): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: 'purchase.modify',
    informationRequests: [{
      kind: 'purchase',
      resource: 'purchase_discovery',
      query: 'cambiar la dedicatoria',
      orderId: null,
      authAction: 'none',
    }],
    supportAct: null,
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
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
    conversationSummary: 'Cambio de dedicatoria.',
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
  } as unknown as ExtractionResult;
}

async function runModifyTurn(options: {
  externalUserId: string;
  text: string;
  contactPhone: string;
  extraction: ExtractionResult;
  purchaseResult: Record<string, unknown>;
  summary: Record<string, unknown>;
  pendingPurchaseRequest?: PendingInformationRequest;
  composedText?: string;
}) {
  const store = new InMemoryPlanStore();
  const seedPlan = createEmptyPlan({
    planId: `p-${options.externalUserId}`,
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
  });
  await store.save({
    plan: options.pendingPurchaseRequest
      ? {
        ...seedPlan,
        information_state: {
          ...seedPlan.information_state,
          pending_requests: [options.pendingPurchaseRequest],
        },
      }
      : seedPlan,
    reason: 'seed',
  });
  const profileOrchestrator = fixtureCustomerContextOrchestrator({
    results: [options.purchaseResult] as unknown as CustomerExecution['results'],
    summaries: [options.summary] as unknown as CustomerExecution['summaries'],
  });
  const execute = vi.fn(async () => profileOrchestrator.execute());
  const composedText = options.composedText ?? 'respuesta generada para evidencia de compra';
  const composeRequests: ComposeReplyRequest[] = [];
  const gateway = {
    async logMessage(input: unknown) {
      void input;
      return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
    },
    async getRecentMessages() {
      return { status: 'success', messages: [] };
    },
    async requestHumanTakeover() {
      return { status: 'success', message: 'Requested.' };
    },
    async authByPhone() {
      return { status: 'failed', error: 'Unused.', retryable: false };
    },
    async updatePhone() {
      return { status: 'success' };
    },
    async getGuestEventsByPhone() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
    async getEventDetail() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
  } as unknown as AgentConversationGateway;
  const service = new AgentService({
    planStore: store,
    runtime: {
      async extract(): Promise<ExtractionResult> {
        return options.extraction;
      },
      async composeReply(request: ComposeReplyRequest) {
        composeRequests.push(request);
        return {
          text: composedText,
          structuredMessage: {
            type: 'generic',
            paragraphs_es: [composedText],
          },
        };
      },
    } as unknown as AgentRuntime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    informationOrchestrator: {
      prepareCustomerContext: profileOrchestrator.prepareCustomerContext,
      execute,
    } as never,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  const result = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
    text: options.text,
    messageId: `m-${options.externalUserId}`,
    receivedAt: '2026-09-04T15:01:00.000Z',
    contactPhone: options.contactPhone,
  });
  return { result, execute, composeRequests };
}

describe('F3c safe read precedes the unsupported mutation handoff', () => {
  it('reads gift purchases for dedication selection on fresh and persisted discovery turns', async () => {
    const giftResult = {
      requestId: 'capability-status-read',
      kind: 'purchase',
      status: 'completed',
      resource: 'gift_purchases',
      purchases: [
        {
          orderId: 'order-joaquin-frozen-01',
          paymentStatus: 'pending',
          shippingStatus: null,
          grandTotal: 120.0,
          paymentMethod: 'Transferencia',
          eventName: 'Chiara Vittoria',
          eventDate: '2026-09-10',
          eventUrl: null,
          createdAt: '2026-09-03 11:00:00',
          items: [],
          payment: { method: 'Transferencia', amount: 120.0, paidAt: '2026-09-03 11:00:00' },
          currency: null,
        },
        {
          orderId: 'order-joaquin-frozen-02',
          paymentStatus: 'approved',
          shippingStatus: null,
          grandTotal: 95.5,
          paymentMethod: 'Transferencia',
          eventName: 'Chiara Vittoria',
          eventDate: '2026-08-10',
          eventUrl: null,
          createdAt: '2026-08-10 11:00:00',
          items: [],
          payment: { method: 'Transferencia', amount: 95.5, paidAt: '2026-08-10 11:00:00' },
          currency: null,
        },
      ],
      needsSelection: true,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
    };
    const { result, execute, composeRequests } = await runModifyTurn({
      externalUserId: 'u-f3c-joaquin',
      text: 'Quisiera cambiar la dedicatoria de un regalo para Chiara Vittoria.',
      contactPhone: '+51926857444',
      extraction: modifyExtraction(),
      purchaseResult: giftResult,
      summary: {
        requestId: 'capability-status-read',
        kind: 'purchase',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: false,
        queryHash: 'joaquin',
        evidence: [],
        resultCount: 2,
        durationMs: 1,
        accessMethod: 'trusted_phone_purchase',
        resource: 'gift_purchases',
      },
      composedText: 'Evidencia de dos regalos para Chiara Vittoria lista para elegir.',
    });
    expect(execute).toHaveBeenCalled();
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const text = result.outbound.text ?? '';
    expect(text).toBe('Evidencia de dos regalos para Chiara Vittoria lista para elegir.');
    expect(composeRequests).toHaveLength(1);
    expect(composeRequests[0]?.currentNode).toBe('resolver_consultas_informativas');
    expect(composeRequests[0]?.turnDecision?.persistReason).toBe('information_batch');
    expect(composeRequests[0]?.informationResults).toEqual([
      expect.objectContaining({ kind: 'purchase', status: 'completed', resource: 'gift_purchases' }),
    ]);
    expect(composeRequests[0]?.customerContext?.purchases.map((purchase) => purchase.orderId)).toEqual([
      'order-joaquin-frozen-01', 'order-joaquin-frozen-02',
    ]);
    const persisted = await runModifyTurn({
      externalUserId: 'u-f3c-joaquin-persisted',
      text: 'Quisiera cambiar la dedicatoria de un regalo para Chiara Vittoria.',
      contactPhone: '+51926857444',
      extraction: modifyExtraction(),
      purchaseResult: giftResult,
      summary: {
        requestId: 'capability-status-read',
        kind: 'purchase',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: false,
        queryHash: 'joaquin',
        evidence: [],
        resultCount: 2,
        durationMs: 1,
        accessMethod: 'trusted_phone_purchase',
        resource: 'gift_purchases',
      },
      pendingPurchaseRequest: {
        requestId: 'information-1',
        kind: 'purchase',
        resource: 'purchase_discovery',
        query: 'cambiar la dedicatoria',
        orderId: null,
        authAction: 'none',
      },
    });
    expect(persisted.execute).toHaveBeenCalled();
    const sentRequest = (persisted.execute.mock.calls[0] as Array<{ requests?: Array<{ resource?: unknown }> }>)[0]?.requests?.[0];
    expect(sentRequest?.resource).toBe('purchase_discovery');
    expect(persisted.result.plan.current_node).toBe('resolver_consultas_informativas');
    expect(persisted.result.outbound.text ?? '').toBe('respuesta generada para evidencia de compra');
    expect(persisted.composeRequests).toHaveLength(1);
    expect(persisted.composeRequests[0]?.informationResults).toEqual([
      expect.objectContaining({ kind: 'purchase', status: 'completed', resource: 'gift_purchases' }),
    ]);
    expect(persisted.composeRequests[0]?.customerContext?.purchases.map((purchase) => purchase.orderId)).toEqual([
      'order-joaquin-frozen-01', 'order-joaquin-frozen-02',
    ]);
  });
});
