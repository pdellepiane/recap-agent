import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import type {
  InformationExecutionSummary,
  InformationTaskResult,
} from '../src/core/information';
import type { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import { AgentService } from '../src/runtime/agent-service';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { fixtureCustomerContextOrchestrator } from './customer-context-test-utils';

const RELEVANT_TOTAL = 150.5;
const UNRELATED_TOTAL = 999.75;
const UNRELATED_CART = 'cart-unrelated-sentinel';

function purchaseResult(
  requestId: string,
  orderId: string,
  total: number,
  cartId: string,
): { result: InformationTaskResult; summary: InformationExecutionSummary } {
  return {
    result: {
      requestId,
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      lookupResource: 'orders',
      purchases: [{
        orderId,
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: total,
        paymentMethod: 'transfer',
        eventName: 'Evento Prueba',
        eventDate: null,
        eventUrl: null,
        createdAt: null,
        items: [],
      }],
      needsSelection: false,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
      carts: [{
        cartId,
        status: 'abandoned',
        wasAbandoned: true,
        eventName: 'Evento Prueba',
        items: [],
      }],
    },
    summary: {
      requestId,
      kind: 'purchase',
      status: 'completed',
      source: 'agent_api',
      outcomeCode: 'completed_with_results',
      retryable: null,
      queryHash: 'q',
      evidence: [],
      resultCount: 1,
      durationMs: 40,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
      resource: 'orders',
    },
  };
}

class PaymentQuestionRuntime implements AgentRuntime {
  public readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(private readonly orderId: string | null = 'ORD-A') {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      actionIntent: null,
      informationRequests: [{
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado de mi pago?',
        orderId: this.orderId,
        authAction: 'none',
      }],
      phoneConfirmation: null,
      intentConfidence: 0.97,
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
      conversationSummary: 'Pregunta por el estado del pago.',
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
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: 'Respuesta de estado.' };
  }
}

function serviceWith(
  runtime: PaymentQuestionRuntime,
  results: InformationTaskResult[],
  summaries: InformationExecutionSummary[],
): { service: AgentService; runtime: PaymentQuestionRuntime } {
  const informationOrchestrator = fixtureCustomerContextOrchestrator({ results, summaries });
  const service = new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: informationOrchestrator as unknown as InformationOrchestrator,
  });
  return { service, runtime };
}

function inbound(text: string, contactPhone?: string) {
  return {
    channel: 'whatsapp' as const,
    externalUserId: 'l4-service-user',
    text,
    messageId: `l4-${text.length}-${contactPhone ?? 'nophone'}`,
    receivedAt: '2026-09-11T12:00:00.000Z',
    ...(contactPhone ? { contactPhone } : {}),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('l4 customer context production wiring', () => {
  it('serves the full canonical profile with stable order across requested, older, and ambiguous targets', async () => {
    const runtime = new PaymentQuestionRuntime();
    const relevant = purchaseResult('information-1', 'ORD-A', RELEVANT_TOTAL, 'cart-relevant-1');
    const unrelated = purchaseResult('information-2', 'ORD-B', UNRELATED_TOTAL, UNRELATED_CART);
    const { service } = serviceWith(
      runtime,
      [relevant.result, unrelated.result],
      [relevant.summary, unrelated.summary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    const customerContext = request?.customerContext;
    expect(customerContext).toBeDefined();
    // One canonical profile: every authorized record rides once as its own
    // entity; the requested order leads by reference instead of hiding the
    // rest. Carts stay distinct records for later cart questions.
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A', 'ORD-B']);
    expect(customerContext?.carts.map((entry) => entry.cartId)).toEqual(['cart-relevant-1', UNRELATED_CART]);
    const serialized = JSON.stringify(customerContext);
    expect(serialized).toContain(String(RELEVANT_TOTAL));
    expect(serialized).toContain(String(UNRELATED_TOTAL));
    // The serving owner travels with the request.
    expect(request?.owner).toBe('customer_assistance');

    // An explicit years-old target stays present without
    // reference-driven reordering or age-based filtering.
    const olderRuntime = new PaymentQuestionRuntime('ORD-OLD');
    const newest = purchaseResult('information-1', 'ORD-NEW', UNRELATED_TOTAL, 'cart-new');
    const explicit = purchaseResult('information-2', 'ORD-OLD', 75.25, 'cart-old');
    const { service: olderService } = serviceWith(
      olderRuntime,
      [newest.result, explicit.result],
      [newest.summary, explicit.summary],
    );

    await olderService.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(olderRuntime.composeRequests).toHaveLength(1);
    const olderContext = olderRuntime.composeRequests[0]?.customerContext;
    // Canonical order is stable backend order.
    expect(olderContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-NEW', 'ORD-OLD']);
    const olderSerialized = JSON.stringify(olderContext);
    expect(olderSerialized).toContain('75.25');
    expect(olderSerialized).toContain(String(UNRELATED_TOTAL));

    // An ambiguous target keeps both candidates visible; write-gating
    // comes from the unresolved target reference, not from hiding records.
    const ambiguousRuntime = new PaymentQuestionRuntime(null);
    const ambiguousRelevant = purchaseResult('information-1', 'ORD-A', RELEVANT_TOTAL, 'cart-relevant-1');
    const ambiguousUnrelated = purchaseResult('information-2', 'ORD-B', UNRELATED_TOTAL, UNRELATED_CART);
    const { service: ambiguousService } = serviceWith(
      ambiguousRuntime,
      [ambiguousRelevant.result, ambiguousUnrelated.result],
      [ambiguousRelevant.summary, ambiguousUnrelated.summary],
    );

    await ambiguousService.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(ambiguousRuntime.composeRequests).toHaveLength(1);
    const ambiguousContext = ambiguousRuntime.composeRequests[0]?.customerContext;
    expect(ambiguousContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A', 'ORD-B']);
    expect(ambiguousContext?.purchases).toHaveLength(2);
    expect(ambiguousContext?.carts).toHaveLength(2);
  });

  it('projects explicit unavailable coverage without an authorized identity', async () => {
    const runtime = new PaymentQuestionRuntime();
    const relevant = purchaseResult('information-1', 'ORD-A', RELEVANT_TOTAL, 'cart-relevant-1');
    const { service } = serviceWith(
      runtime,
      [relevant.result],
      [relevant.summary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?'));

    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.customerContext).toMatchObject({
      purchases: [],
      coverage: {
        purchasesCarts: { status: 'unavailable', source: 'authorization' },
        invitationsEvents: { status: 'unavailable', source: 'authorization' },
      },
    });
  });

});

describe('l4 P1 canonical profile through public AgentService', () => {
  it('coalesces duplicate scoped reads without detail loss and preserves ready facts on failure', async () => {
    const runtime = new PaymentQuestionRuntime('ORD-A');
    const summaryOnly = purchaseResult('information-1', 'ORD-A', RELEVANT_TOTAL, 'cart-ORD-A');
    const detailed = purchaseResult('information-2', 'ORD-A', RELEVANT_TOTAL, 'cart-ORD-A');
    if (
      detailed.result.status !== 'completed' || detailed.result.kind !== 'purchase' ||
      summaryOnly.result.status !== 'completed' || summaryOnly.result.kind !== 'purchase'
    ) {
      throw new Error('Expected completed purchase fixtures.');
    }
    const withDetail = {
      result: {
        ...detailed.result,
        purchases: detailed.result.purchases.map((purchase) => ({
          ...purchase,
          items: [{ giftName: 'Regalo', quantity: 1, amount: RELEVANT_TOTAL, rowTotal: RELEVANT_TOTAL, type: 'gift' }],
        })),
      },
      summary: detailed.summary,
    };
    const { service } = serviceWith(
      runtime,
      [summaryOnly.result, withDetail.result],
      [summaryOnly.summary, withDetail.summary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    expect(customerContext?.purchases).toHaveLength(1);
    expect(customerContext?.purchases[0]?.items).toHaveLength(1);

    const failedRuntime = new PaymentQuestionRuntime('ORD-A');
    const relevant = purchaseResult('information-1', 'ORD-A', RELEVANT_TOTAL, 'cart-ORD-A');
    const failed: InformationTaskResult = {
      requestId: 'information-2',
      kind: 'purchase',
      status: 'failed',
      retryable: true,
      failureKind: 'request_failed',
      message: 'lookup failed',
    };
    const failedSummary: InformationExecutionSummary = {
      requestId: 'information-2',
      kind: 'purchase',
      status: 'failed',
      source: 'agent_api',
      outcomeCode: 'request_failed',
      retryable: true,
      queryHash: 'q',
      evidence: [],
      resultCount: 0,
      durationMs: 10,
    };
    const { service: failedService } = serviceWith(
      failedRuntime,
      [relevant.result, failed],
      [relevant.summary, failedSummary],
    );

    await failedService.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(failedRuntime.composeRequests).toHaveLength(1);
    const failedContext = failedRuntime.composeRequests[0]?.customerContext;
    expect(failedContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
  });
});

describe('l4 B receipt discovery merges both authorized sources canonically', () => {
  function sourceResult(
    requestId: string,
    resource: 'orders' | 'gift_purchases',
    orderId: string,
    total: number,
    paymentStatus: string,
  ): { result: InformationTaskResult; summary: InformationExecutionSummary } {
    return {
      result: {
        requestId,
        kind: 'purchase',
        status: 'completed',
        resource,
        lookupResource: resource,
        purchases: [{
          orderId,
          paymentStatus,
          shippingStatus: null,
          grandTotal: total,
          paymentMethod: 'transfer',
          eventName: 'Evento Sintetico',
          eventDate: null,
          eventUrl: null,
          createdAt: null,
          items: [],
        }],
        needsSelection: false,
        accessMethod: 'trusted_phone_purchase',
        coverage: 'complete',
        carts: [],
      },
      summary: {
        requestId,
        kind: 'purchase',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'q',
        evidence: [],
        resultCount: 1,
        durationMs: 40,
        accessMethod: 'trusted_phone_purchase',
        coverage: 'complete',
        resource,
      },
    };
  }

  it('merges both receipt discovery sources canonically and keeps ready facts when gift fails', async () => {
    const runtime = new PaymentQuestionRuntime(null);
    const orders = sourceResult('information-1', 'orders', 'ORD-DISC-1', 340.44, 'pending');
    const gift = sourceResult('information-1:receipt-discovery', 'gift_purchases', 'GIFT-DISC-7', 340.44, 'approved');
    const { service } = serviceWith(
      runtime,
      [orders.result, gift.result],
      [orders.summary, gift.summary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    // One canonical profile: both authorized records ride once as their own
    // entities. Same amount alone proves nothing, so neither record is
    // filtered by amount, blocked as a duplicate, or hidden by recency.
    expect(customerContext?.purchases.map((entry) => entry.orderId).sort()).toEqual(
      ['GIFT-DISC-7', 'ORD-DISC-1'],
    );
    expect(customerContext?.purchases).toHaveLength(2);
    const serialized = JSON.stringify(customerContext);
    expect(serialized).toContain('340.44');
    expect(serialized).toContain('pending');
    expect(serialized).toContain('approved');
    expect(serialized).toContain('Evento Sintetico');
    expect(customerContext?.coverage.purchasesCarts.status).toBe('ready');

    const partialRuntime = new PaymentQuestionRuntime(null);
    const partialOrders = sourceResult('information-1', 'orders', 'ORD-DISC-1', 340.44, 'pending');
    const failedGift: InformationTaskResult = {
      requestId: 'information-1:receipt-discovery',
      kind: 'purchase',
      status: 'failed',
      retryable: false,
      accessMethod: 'trusted_phone_purchase',
      lookupResource: 'gift_purchases',
      failureKind: 'request_failed',
      message: 'gift lookup failed',
    };
    const failedGiftSummary: InformationExecutionSummary = {
      requestId: 'information-1:receipt-discovery',
      kind: 'purchase',
      status: 'failed',
      source: 'agent_api',
      outcomeCode: 'request_failed',
      retryable: false,
      queryHash: 'q',
      evidence: [],
      resultCount: 0,
      durationMs: 10,
      accessMethod: 'trusted_phone_purchase',
      coverage: null,
      resource: 'gift_purchases',
    };
    const { service: partialService } = serviceWith(
      partialRuntime,
      [partialOrders.result, failedGift],
      [partialOrders.summary, failedGiftSummary],
    );

    await partialService.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(partialRuntime.composeRequests).toHaveLength(1);
    const partialContext = partialRuntime.composeRequests[0]?.customerContext;
    // Ready facts survive the failed optional source while the section
    // stays servable; the failed scope contributes no phantom record and
    // the per-result coverage behind the reply stays honest (proven at the
    // executor level).
    expect(partialContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-DISC-1']);
    expect(partialContext?.purchases).toHaveLength(1);
    expect(partialContext?.coverage.purchasesCarts.status).toBe('ready');
  });
});
