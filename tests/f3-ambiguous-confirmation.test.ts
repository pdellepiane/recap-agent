import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PurchaseInformation } from '../src/core/information';

const MODEL_REPLY = 'Respuesta escrita por el modelo para esta aclaración.';

function planningExtraction(
  overrides: Partial<ExtractionResult> = {},
): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    supportAct: null,
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: 0.9,
    ambiguity: { status: 'ambiguous', clarificationQuestion: null, interpretations: [] },
    eventType: 'boda',
    vendorCategory: null,
    vendorCategories: [],
    activeNeedCategory: 'Fotografía y video',
    location: 'Lima',
    budgetSignal: null,
    guestRange: '51-100',
    preferences: ['estilo natural'],
    hardConstraints: [],
    assumptions: [],
    conversationSummary: 'Shortlist de fotografia.',
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
    ...overrides,
  } as unknown as ExtractionResult;
}

function carinaExtraction(
  overrides: Partial<ExtractionResult> = {},
): ExtractionResult {
  return planningExtraction({
    actionIntent: null,
    informationRequests: [
      {
        kind: 'purchase',
        resource: 'orders',
        query: 'Necesito una conformidad de pago.',
        orderId: null,
        authAction: 'none',
      },
    ],
    ambiguity: {
      status: 'ambiguous',
      clarificationQuestion: '¿Necesitas el estado del pago o enviar la constancia?',
      interpretations: ['Consultar estado del pago', 'Enviar constancia de pago'],
      candidateOperations: ['purchase.orders.read', 'confirmation_document.send'],
      questionKey: 'status_or_document',
    },
    eventType: null,
    activeNeedCategory: null,
    location: null,
    guestRange: null,
    preferences: [],
    ...overrides,
  } as unknown as Partial<ExtractionResult>);
}

function seedInformationPlan(planId: string) {
  return mergePlan(
    createEmptyPlan({ planId, channel: 'whatsapp', externalUserId: 'u-carina' }),
    {
      current_node: 'resolver_consultas_informativas',
      contact_phone: '51987654321',
      contact_phone_extension: '+51',
      contact_phone_number: '987654321',
    },
  );
}

function carinaPurchase(): PurchaseInformation {
  return {
    orderId: 'ORD-CARINA-1',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 3173.81,
    paymentMethod: 'Transferencia',
    eventName: 'Baby Shower Catalina',
    eventDate: '2026-10-04',
    eventUrl: null,
    createdAt: '2026-09-01',
    items: [],
    paymentValidationExpectation: { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' },
  };
}

async function runInformationTurn(extraction: ExtractionResult, text: string) {
  const store = new InMemoryPlanStore();
  await store.save({ plan: seedInformationPlan('p-carina'), reason: 'seed' });
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
    async getGuestOrdersByPhone() {
      return {
        status: 'success',
        resource: 'orders',
        purchases: [carinaPurchase()],
      };
    },
    async getEventDetail() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
  } as unknown as AgentConversationGateway;
  const service = new AgentService({
    planStore: store,
    runtime: {
      async extract(): Promise<ExtractionResult> {
        return extraction;
      },
      async composeReply(request: ComposeReplyRequest) {
        composeRequests.push(request);
        return {
          text: MODEL_REPLY,
          structuredMessage: {
            type: 'generic',
            paragraphs_es: [MODEL_REPLY],
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
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  const response = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'u-carina',
    text,
    messageId: 'm-carina-1',
    receivedAt: '2026-09-04T15:01:00.000Z',
  });
  return { ...response, composeRequests, service };
}

describe('L3 Carina status-or-document ambiguity', () => {
  it('serves a purchase-shaped Carina conflict through the information flow, not capability clarification', async () => {
    const result = await runInformationTurn(
      carinaExtraction(),
      'Necesito una conformidad de pago.',
    );

    expect(result.outbound.text).toBe(MODEL_REPLY);
    // The available purchase read serves the fact: mixed-availability
    // ambiguity never preempts the information flow with a question.
    expect(result.trace.capability_decision ?? null).toBeNull();
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const purchaseLookup = result.trace.information_execution_summary.find(
      (entry) => entry.kind === 'purchase',
    );
    expect(purchaseLookup?.outcomeCode).toBe('completed_with_results');
    expect(purchaseLookup?.resultCount).toBe(1);
    expect(purchaseLookup?.resource).toBe('orders');
    // The model receives customer records from the canonical profile, not a
    // second purchase-fact copy in execution evidence.
    expect(result.composeRequests[0]?.customerContext?.purchases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grandTotal: 3173.81, eventName: 'Baby Shower Catalina' }),
      ]),
    );
    // Extraction ambiguity still survives normalization on the composed turn.
    expect(result.composeRequests[0]?.extraction.ambiguity?.status).toBe('ambiguous');
    expect(
      result.composeRequests[0]?.extraction.ambiguity?.interpretations,
    ).toEqual(['Consultar estado del pago', 'Enviar constancia de pago']);
  });
});
