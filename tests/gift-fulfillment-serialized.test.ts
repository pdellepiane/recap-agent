import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import type {
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseAspect,
  PurchaseInformation,
} from '../src/core/information';
import type {
  ComposeReplyRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import {
  HttpAgentConversationGateway,
  type AgentConversationGateway,
  type AgentPurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import {
  assembleCustomerContext,
  projectCustomerContext,
} from '../src/runtime/customer-context';

const NOW = '2026-09-21T12:00:00.000Z';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function testRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-test',
    extractorModel: 'gpt-test',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    providerGateway: {
      async searchProviders(): Promise<never> {
        throw new Error('construction must not call the provider gateway');
      },
    } as never,
  });
}

function supportPlan(overrides: Record<string, unknown> = {}): PersistedPlan {
  return mergePlan(
    createEmptyPlan({ planId: 'gift-plan', channel: 'whatsapp', externalUserId: 'gift-user' }),
    { current_node: 'resolver_consultas_informativas', ...overrides },
  ) as PersistedPlan;
}

function baseExtraction(overrides: Record<string, unknown> = {}): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: null,
    reportedEventRole: null,
    informationRequests: [],
    supportAct: null,
    humanHelpIntent: null,
    normalizationIssues: [],
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: 'plan_state',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: null,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
      candidateOperations: [],
      questionKey: null,
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
    conversationSummary: '',
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
    imageReference: null,
    ...overrides,
  } as unknown as ExtractionResult;
}

function replyRequest(
  plan: PersistedPlan,
  overrides: Record<string, unknown> = {},
): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: '¿Cuándo llega mi regalo?',
    messageContext: localTurnMessageContext('not_configured'),
    plan,
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'trace-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    ...overrides,
  } as unknown as ComposeReplyRequest;
}

type GiftWireItem = {
  gift_name: string | null;
  quantity: number | null;
  amount: number | null;
  row_total: number | null;
  type: string | null;
};

function giftWirePurchase(args: {
  id: string;
  paymentStatus: string | null;
  shippingStatus: string | null;
  items: GiftWireItem[];
  sendPhysical?: boolean | null;
  cardStatus?: string | null;
}): Record<string, unknown> {
  return {
    id: args.id,
    increment_id: '100000901',
    payment_status: args.paymentStatus,
    shipping_status: args.shippingStatus,
    grand_total: 200,
    event_id: 9101,
    event_name: 'Boda Lucía y Marco',
    event_date: '2026-10-10',
    event_url: null,
    items: args.items,
    dedication: {
      message: 'Felicidades',
      is_private: false,
      send_physical: args.sendPhysical ?? false,
      physical_status: args.cardStatus ?? null,
    },
    created_at: '2026-09-01 11:00:00',
  };
}

function giftEnvelope(purchases: Record<string, unknown>[]): Record<string, unknown> {
  return {
    status: true,
    data: { purchases },
    errors: null,
    error: null,
  };
}

/** Parse the exact wire payload through the production gateway (stubbed fetch, no network). */
async function parseThroughGateway(
  purchases: Record<string, unknown>[],
): Promise<PurchaseInformation[]> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => giftEnvelope(purchases),
    text: async () => JSON.stringify(giftEnvelope(purchases)),
  });
  vi.stubGlobal('fetch', fetchMock);
  const gateway = new HttpAgentConversationGateway({
    baseUrl: 'https://api.example.test/api/agent',
    apiKey: 'secret-key',
    timeoutMs: 1_000,
    maxRetries: 0,
    messageLoggingEnabled: false,
  });
  const result = await gateway.getGiftPurchases({ token: 'user-jwt' });
  if (result.status !== 'success') {
    throw new Error('Expected gift purchase success.');
  }
  return result.purchases;
}

function mixedWireItems(): GiftWireItem[] {
  return [
    { gift_name: 'Juego de sábanas', quantity: 1, amount: 120, row_total: 120, type: 'se_store' },
    { gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' },
  ];
}

async function executeShippingTurn(args: {
  records: PurchaseInformation[];
  aspects: PurchaseAspect[];
  orderId?: string;
}): Promise<{ results: InformationTaskResult[]; summaries: InformationExecutionSummary[]; giftCalls: number }> {
  let giftCalls = 0;
  const lookupResult: AgentPurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: args.records,
  };
  const agentGateway = {
    async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
      giftCalls += 1;
      return lookupResult;
    },
  } as unknown as AgentConversationGateway;
  const orchestrator = new InformationOrchestrator({
    knowledgeGateway: {} as KnowledgeRetrievalGateway,
    providerGateway: {} as ProviderGateway,
    agentGateway,
  });
  const execution = await orchestrator.execute({
    requests: [{
      requestId: 'gift-shipping',
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Cuándo llega mi regalo?',
      orderId: args.orderId ?? 'gift-1',
      aspects: args.aspects,
      sensitiveFields: [],
      authAction: 'none',
    }],
    authentication: { token: 'test-token', email: 'test@example.com' },
    authBlock: null,
  });
  return { results: execution.results, summaries: execution.summaries, giftCalls };
}

function purchaseExtraction(aspects: PurchaseAspect[], orderId: string): ExtractionResult {
  return baseExtraction({
    informationRequests: [{
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Cuándo llega mi regalo?',
      orderId,
      aspects,
      sensitiveFields: [],
      authAction: 'none',
    }],
  });
}

describe('gift fulfillment serialized proof', () => {
  it('carries both mixed item types with distinct fulfillment facts into the real reply input', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-1',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: mixedWireItems(),
      }),
    ]);
    expect(records[0]?.items.map((item) => item.type)).toEqual(['se_store', 'credit']);

    const { results, summaries, giftCalls } = await executeShippingTurn({
      records,
      aspects: ['shipping'],
    });
    expect(giftCalls).toBe(1);
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-1'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
        extraction: purchaseExtraction(['shipping'], 'gift-1'),
      }),
    );

    expect(spec.input).toContain('se_store');
    expect(spec.input).toContain('credit');
    expect(spec.input).toContain('physical');
    expect(spec.input).toContain('host_credit');
    expect(spec.input).toContain('giftShipmentApplicable');
    expect(spec.input).toContain('host_account_credit');
    expect(spec.input).toContain('profile_ref');
    expect(spec.input).not.toContain('credited');
  });

  it('keeps physical relevance with missing shipping details for pure se_store and null status', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-2',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [{ gift_name: 'Juego de sábanas', quantity: 1, amount: 120, row_total: 120, type: 'se_store' }],
      }),
    ]);
    const { results, summaries } = await executeShippingTurn({ records, aspects: ['shipping'], orderId: 'gift-2' });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-2'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults: results, extraction: purchaseExtraction(['shipping'], 'gift-2') }),
    );

    expect(spec.input).toMatch(/"kind":\s*"physical"/);
    expect(spec.input).toMatch(/"giftShipmentApplicable":\s*true/);
    expect(spec.input).toMatch(/"shippingStatus":\s*null/);
    expect(spec.input).not.toContain('host_credit');
  });

  it('keeps host choice, no gift shipment and pending payment separate for pure credit', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-3',
        paymentStatus: 'pending',
        shippingStatus: null,
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
      }),
    ]);
    const { results, summaries } = await executeShippingTurn({
      records,
      aspects: ['shipping', 'payment_status'],
      orderId: 'gift-3',
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-3'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults: results, extraction: purchaseExtraction(['shipping', 'payment_status'], 'gift-3') }),
    );

    expect(spec.input).toMatch(/"kind":\s*"host_credit"/);
    expect(spec.input).toMatch(/"chosenBy":\s*"host"/);
    expect(spec.input).toMatch(/"giftShipmentApplicable":\s*false/);
    expect(spec.input).toMatch(/"paymentStatus":\s*"pending"/);
    expect(spec.input).toContain('host_account_credit');
    expect(spec.input).not.toContain('credited');
    expect(spec.input).not.toMatch(/"kind":\s*"physical"/);
  });

  it('keeps a physical dedication card separate from a credit gift', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-4',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
        sendPhysical: true,
        cardStatus: 'in_transit',
      }),
    ]);
    const { results, summaries } = await executeShippingTurn({
      records,
      aspects: ['shipping', 'dedication'],
      orderId: 'gift-4',
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-4'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults: results, extraction: purchaseExtraction(['shipping', 'dedication'], 'gift-4') }),
    );

    expect(spec.input).toMatch(/"kind":\s*"host_credit"/);
    expect(spec.input).toMatch(/"giftShipmentApplicable":\s*false/);
    expect(spec.input).toMatch(/"sendPhysical":\s*true/);
    expect(spec.input).toContain('in_transit');
  });

  it('leaves unknown types unknown and never promotes a physical-sounding credit name', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-5',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [
          { gift_name: 'Juego de ollas premium', quantity: 1, amount: 200, row_total: 200, type: 'credit' },
          { gift_name: 'Regalo misterioso', quantity: 1, amount: 50, row_total: 50, type: null },
        ],
      }),
    ]);
    const { results, summaries } = await executeShippingTurn({
      records,
      aspects: ['shipping'],
      orderId: 'gift-5',
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-5'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults: results, extraction: purchaseExtraction(['shipping'], 'gift-5') }),
    );

    expect(spec.input).toContain('Juego de ollas premium');
    expect(spec.input).toMatch(/"kind":\s*"host_credit"/);
    expect(spec.input).toMatch(/"kind":\s*"unknown"/);
    expect(spec.input).toMatch(/"giftShipmentApplicable":\s*null/);
    expect(spec.input).not.toMatch(/"kind":\s*"physical"/);
  });

  it('omits fulfillment facts from payment-only, FAQ and RSVP serialized inputs', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-6',
        paymentStatus: 'pending',
        shippingStatus: 'preparing',
        items: mixedWireItems(),
      }),
    ]);
    const { results, summaries } = await executeShippingTurn({
      records,
      aspects: ['payment_status'],
      orderId: 'gift-6',
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'payment',
      relevantOrderIds: ['gift-6'],
    });
    const paymentSpec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
        extraction: purchaseExtraction(['payment_status'], 'gift-6'),
        userMessage: '¿Mi pago ya fue aprobado?',
      }),
    );
    expect(paymentSpec.input).toMatch(/"paymentStatus":\s*"pending"/);
    expect(paymentSpec.input).not.toContain('giftShipmentApplicable');
    expect(paymentSpec.input).not.toContain('host_credit');
    expect(paymentSpec.input).not.toContain('host_account_credit');
    expect(paymentSpec.instructions).not.toContain('giftShipmentApplicable');

    const faqSpec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        userMessage: '¿Cuál es la política de devoluciones?',
        extraction: baseExtraction({
          informationRequests: [{ kind: 'faq', query: 'política de devoluciones' }],
        }),
        informationResults: [{
          requestId: 'faq-1',
          kind: 'faq',
          status: 'completed',
          query: 'política de devoluciones',
          evidence: [{ fileId: 'file-1', filename: 'policy.md', score: 0.9, text: 'Devolución disponible dentro de 7 días' }],
        }],
      }),
    );
    expect(faqSpec.input).not.toContain('giftShipmentApplicable');
    expect(faqSpec.input).not.toContain('host_credit');
    expect(faqSpec.instructions).not.toContain('giftShipmentApplicable');
  });
});
