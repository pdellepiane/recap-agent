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
import type { InformationOrchestrator, CustomerLinkedEnrichment, HydratedEventDetail } from '../src/runtime/information-orchestrator';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

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
        aspects: ['payment_status'],
        sensitiveFields: [],
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
  const service = new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: {
      execute: async () => ({ results, summaries }),
    } as unknown as InformationOrchestrator,
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
  it('feeds a payment question the full canonical profile with the relevant order first', async () => {
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
    expect(customerContext?.detailedPurchases.map((entry) => entry.orderId)).toEqual(['ORD-A', 'ORD-B']);
    expect(customerContext?.carts.map((entry) => entry.cartId)).toEqual(['cart-relevant-1', UNRELATED_CART]);
    const serialized = JSON.stringify(customerContext);
    expect(serialized).toContain(String(RELEVANT_TOTAL));
    expect(serialized).toContain(String(UNRELATED_TOTAL));
    // The serving owner travels with the request.
    expect(request?.owner).toBe('customer_assistance');
  });

  it('projects nothing without an authorized identity', async () => {
    const runtime = new PaymentQuestionRuntime();
    const relevant = purchaseResult('information-1', 'ORD-A', RELEVANT_TOTAL, 'cart-relevant-1');
    const { service } = serviceWith(
      runtime,
      [relevant.result],
      [relevant.summary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?'));

    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.customerContext).toBeNull();
  });

  it('leads with an explicit years-old order instead of the newest record', async () => {
    const runtime = new PaymentQuestionRuntime('ORD-OLD');
    const newest = purchaseResult('information-1', 'ORD-NEW', UNRELATED_TOTAL, 'cart-new');
    const explicit = purchaseResult('information-2', 'ORD-OLD', 75.25, 'cart-old');
    const { service } = serviceWith(
      runtime,
      [newest.result, explicit.result],
      [newest.summary, explicit.summary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    // No age cutoff and no newest-first hiding: the explicit old target
    // leads by reference while the newer record stays visible.
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-OLD', 'ORD-NEW']);
    const serialized = JSON.stringify(customerContext);
    expect(serialized).toContain('75.25');
    expect(serialized).toContain(String(UNRELATED_TOTAL));
  });

  it('keeps an ambiguous target out of writes while retaining every record', async () => {
    const runtime = new PaymentQuestionRuntime(null);
    const relevant = purchaseResult('information-1', 'ORD-A', RELEVANT_TOTAL, 'cart-relevant-1');
    const unrelated = purchaseResult('information-2', 'ORD-B', UNRELATED_TOTAL, UNRELATED_CART);
    const { service } = serviceWith(
      runtime,
      [relevant.result, unrelated.result],
      [relevant.summary, unrelated.summary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    // Both candidates stay visible; write-gating comes from the unresolved
    // target reference (candidates, never an inferred mutation), not from
    // hiding records.
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A', 'ORD-B']);
    expect(customerContext?.detailedPurchases).toHaveLength(2);
    expect(customerContext?.carts).toHaveLength(2);
    expect(customerContext?.commonRefs.orderIds).toEqual(['ORD-A', 'ORD-B']);
  });
});

describe('l4 S7 bounded enrichment through public AgentService', () => {
  function summaryOnlyResult(
    requestId: string,
    orderId: string,
    total: number,
  ): { result: InformationTaskResult; summary: InformationExecutionSummary } {
    const full = purchaseResult(requestId, orderId, total, `cart-${orderId}`);
    if (full.result.status !== 'completed' || full.result.kind !== 'purchase') {
      throw new Error('Expected a completed purchase fixture.');
    }
    return {
      result: {
        ...full.result,
        purchases: full.result.purchases.map((purchase) => ({
          ...purchase,
          items: [],
          payment: null,
          dedication: null,
        })),
      },
      summary: full.summary,
    };
  }

  function serviceWithEnrichment(
    runtime: PaymentQuestionRuntime,
    results: InformationTaskResult[],
    summaries: InformationExecutionSummary[],
    enrich: (args: {
      orderIds: readonly string[];
      eventIds: readonly (number | string)[];
    }) => Promise<CustomerLinkedEnrichment>,
    enrichCalls: { orderIds: readonly string[]; eventIds: readonly (number | string)[] }[],
  ): { service: AgentService; runtime: PaymentQuestionRuntime } {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: {
        execute: async () => ({ results, summaries }),
        enrichCustomerLinkedDetail: async (args: {
          orderIds: readonly string[];
          eventIds: readonly (number | string)[];
        }) => {
          enrichCalls.push({ orderIds: args.orderIds, eventIds: args.eventIds });
          return enrich(args);
        },
      } as unknown as InformationOrchestrator,
    });
    return { service, runtime };
  }

  it('fetches authorized gift detail before the answer and merges inline items', async () => {
    const runtime = new PaymentQuestionRuntime('ORD-A');
    const summaryOnly = summaryOnlyResult('information-1', 'ORD-A', RELEVANT_TOTAL);
    const enrichCalls: { orderIds: readonly string[]; eventIds: readonly (number | string)[] }[] = [];
    const { service } = serviceWithEnrichment(
      runtime,
      [summaryOnly.result],
      [summaryOnly.summary],
      async () => ({
        giftPurchases: [{
          orderId: 'ORD-A',
          paymentStatus: 'pending',
          shippingStatus: null,
          grandTotal: RELEVANT_TOTAL,
          paymentMethod: 'transfer',
          eventName: 'Evento Prueba',
          eventDate: null,
          eventUrl: null,
          createdAt: null,
          items: [{ giftName: 'Regalo Enriquecido', quantity: 1, amount: RELEVANT_TOTAL, rowTotal: RELEVANT_TOTAL, type: 'gift' }],
        }],
        eventDetails: new Map<number, HydratedEventDetail>(),
        readsAttempted: 1,
        truncatedByBound: false,
        unavailable: [],
        failures: [],
      }),
      enrichCalls,
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(enrichCalls).toHaveLength(1);
    expect(enrichCalls[0]?.orderIds).toEqual(['ORD-A']);
    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    expect(customerContext?.detailedPurchases).toHaveLength(1);
    expect(customerContext?.detailedPurchases[0]?.items).toHaveLength(1);
    expect(customerContext?.enrichment?.readsAttempted).toBe(1);
    expect(customerContext?.enrichment?.truncatedByBound).toBe(false);
  });

  it('fetches duplicate explicit IDs once and keeps the explicit old target', async () => {
    const runtime = new PaymentQuestionRuntime('ORD-OLD');
    const newest = summaryOnlyResult('information-1', 'ORD-NEW', UNRELATED_TOTAL);
    const oldest = summaryOnlyResult('information-2', 'ORD-OLD', 75.25);
    const enrichCalls: { orderIds: readonly string[]; eventIds: readonly (number | string)[] }[] = [];
    const { service } = serviceWithEnrichment(
      runtime,
      [newest.result, oldest.result],
      [newest.summary, oldest.summary],
      async () => ({
        giftPurchases: [],
        eventDetails: new Map<number, HydratedEventDetail>(),
        readsAttempted: 1,
        truncatedByBound: false,
        unavailable: [],
        failures: [],
      }),
      enrichCalls,
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(enrichCalls).toHaveLength(1);
    expect(enrichCalls[0]?.orderIds).toEqual(['ORD-OLD']);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-OLD', 'ORD-NEW']);
    const serialized = JSON.stringify(customerContext);
    expect(serialized).toContain('75.25');
    expect(serialized).toContain(String(UNRELATED_TOTAL));
  });

  it('never auto-selects the pending newest order: ambiguous enriches nothing', async () => {
    const runtime = new PaymentQuestionRuntime(null);
    const newest = summaryOnlyResult('information-1', 'ORD-NEW', UNRELATED_TOTAL);
    const oldest = summaryOnlyResult('information-2', 'ORD-OLD', 75.25);
    const enrichCalls: { orderIds: readonly string[]; eventIds: readonly (number | string)[] }[] = [];
    const { service } = serviceWithEnrichment(
      runtime,
      [newest.result, oldest.result],
      [newest.summary, oldest.summary],
      async () => ({
        giftPurchases: [],
        eventDetails: new Map<number, HydratedEventDetail>(),
        readsAttempted: 0,
        truncatedByBound: false,
        unavailable: [],
        failures: [],
      }),
      enrichCalls,
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(enrichCalls).toHaveLength(0);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    // Linked-detail enrichment stays explicit-only, but the profile itself
    // hides nothing: both candidates ride the canonical context.
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-NEW', 'ORD-OLD']);
    expect(customerContext?.detailedPurchases).toHaveLength(2);
    expect(customerContext?.commonRefs.orderIds).toEqual(['ORD-NEW', 'ORD-OLD']);
  });

  it('keeps required unavailable detail explicit while answering ready facts', async () => {
    const runtime = new PaymentQuestionRuntime('ORD-A');
    const summaryOnly = summaryOnlyResult('information-1', 'ORD-A', RELEVANT_TOTAL);
    const enrichCalls: { orderIds: readonly string[]; eventIds: readonly (number | string)[] }[] = [];
    const { service } = serviceWithEnrichment(
      runtime,
      [summaryOnly.result],
      [summaryOnly.summary],
      async () => ({
        giftPurchases: [],
        eventDetails: new Map<number, HydratedEventDetail>(),
        readsAttempted: 1,
        truncatedByBound: false,
        unavailable: ['order:ORD-A'],
        failures: [],
      }),
      enrichCalls,
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    expect(customerContext?.enrichment?.unavailable).toContain('order:ORD-A');
  });

  it('performs no writes during enrichment', async () => {
    const runtime = new PaymentQuestionRuntime('ORD-A');
    const summaryOnly = summaryOnlyResult('information-1', 'ORD-A', RELEVANT_TOTAL);
    const enrichCalls: { orderIds: readonly string[]; eventIds: readonly (number | string)[] }[] = [];
    let writeCalls = 0;
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      agentConversationGateway: {
        logMessage: async () => ({ status: 'skipped', reason: 'not_configured', message: 'skip' }),
        getRecentMessages: async () => ({ status: 'skipped', reason: 'not_configured', message: 'skip' }),
        requestHumanTakeover: async () => ({ status: 'skipped', reason: 'not_configured', message: 'skip' }),
        authByPhone: async () => ({ status: 'failed', error: 'unused', retryable: false }),
        updatePhone: async () => { writeCalls += 1; return { status: 'failed', error: 'unused', retryable: false }; },
        guestRsvp: async () => { writeCalls += 1; return { status: 'failed', error: 'unused', retryable: false }; },
      } as unknown as AgentConversationGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: {
        execute: async () => ({ results: [summaryOnly.result], summaries: [summaryOnly.summary] }),
        enrichCustomerLinkedDetail: async (args: {
          orderIds: readonly string[];
          eventIds: readonly (number | string)[];
        }) => {
          enrichCalls.push({ orderIds: args.orderIds, eventIds: args.eventIds });
          return {
            giftPurchases: [],
            eventDetails: new Map<number, HydratedEventDetail>(),
            readsAttempted: 0,
            truncatedByBound: false,
            unavailable: [],
            failures: [],
          };
        },
      } as unknown as InformationOrchestrator,
    });

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    expect(writeCalls).toBe(0);
  });
});

describe('l4 P1 canonical profile through public AgentService', () => {
  it('coalesces duplicate scoped route results without detail loss', async () => {
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
    expect(customerContext?.detailedPurchases).toHaveLength(1);
    expect(customerContext?.detailedPurchases[0]?.items).toHaveLength(1);
  });

  it('preserves ready facts when a duplicate scoped read fails', async () => {
    const runtime = new PaymentQuestionRuntime('ORD-A');
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
    const { service } = serviceWith(
      runtime,
      [relevant.result, failed],
      [relevant.summary, failedSummary],
    );

    await service.handleTurn(inbound('¿Cuál es el estado de mi pago?', '+51900000001'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    expect(customerContext?.commonRefs.orderIds).toContain('ORD-A');
  });
});
