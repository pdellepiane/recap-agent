import { describe, expect, it, vi } from 'vitest';

import {
  createInformationAuthGuidance,
  type PendingInformationRequest,
  type PurchaseInformation,
} from '../src/core/information';
import {
  type AgentConversationGateway,
  type AgentGatewayResult,
  type AgentMessageLogInput,
  type AgentPurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type {
  KnowledgeRetrievalGateway,
  KnowledgeRetrievalResult,
} from '../src/runtime/knowledge-retrieval-gateway';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';

describe('InformationOrchestrator', () => {
  it('starts independent FAQ and authenticated event work concurrently and preserves request order', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const knowledgeGateway: KnowledgeRetrievalGateway = {
      async search(): Promise<KnowledgeRetrievalResult> {
        started.push('faq');
        await gate;
        return {
          status: 'success',
          evidence: [
            {
              fileId: 'file-1',
              filename: 'faq.md',
              score: 0.9,
              text: 'Respuesta verificada.',
            },
          ],
        };
      },
    };
    const providerGateway = {
      async lookupAuthenticatedUserEvents(): Promise<UserEventLookupResult> {
        started.push('event');
        await gate;
        return eventLookup();
      },
    } as unknown as ProviderGateway;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway,
      providerGateway,
      agentGateway: new FakeAgentGateway(),
    });
    const requests: PendingInformationRequest[] = [
      {
        requestId: 'information-1',
        kind: 'faq',
        query: '¿Cómo funciona?',
      },
      {
        requestId: 'information-2',
        kind: 'associated_event',
        query: '¿A qué hora es mi evento?',
        eventHint: null,
      },
    ];

    const executionPromise = orchestrator.execute({
      requests,
      authentication: {
        token: 'jwt',
        email: 'user@example.com',
      },
      authBlock: null,
    });
    await Promise.resolve();

    expect(started).toEqual(['faq', 'event']);
    release();
    const execution = await executionPromise;
    expect(execution.results.map((result) => result.requestId)).toEqual([
      'information-1',
      'information-2',
    ]);
    expect(execution.results.map((result) => result.status)).toEqual([
      'completed',
      'completed',
    ]);
  });

  it('keeps successful FAQ evidence when a production purchase route is unavailable', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.giftResult = {
      status: 'route_unavailable',
      resource: 'gift_purchases',
      retryable: false,
      error: 'Route unavailable.',
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {
        async search() {
          return {
            status: 'success' as const,
            evidence: [
              {
                fileId: 'file-1',
                filename: 'faq.md',
                score: 0.88,
                text: 'Política verificada.',
              },
            ],
          };
        },
      },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'faq-1',
          kind: 'faq',
          query: 'Consulta general',
        },
        purchaseRequest('purchase-1', []),
      ],
      authentication: {
        token: 'jwt',
        email: 'user@example.com',
      },
      authBlock: null,
    });

    expect(execution.results).toEqual([
      expect.objectContaining({
        requestId: 'faq-1',
        status: 'completed',
      }),
      expect.objectContaining({
        requestId: 'purchase-1',
        status: 'failed',
        failureKind: 'route_unavailable',
      }),
    ]);
  });

  it('projects only requested purchase aspects and withholds sensitive payment data by default', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.giftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [giftPurchase()],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {
        async search() {
          return {
            status: 'failed' as const,
            reason: 'not_configured' as const,
            retryable: false,
            error: 'not configured',
          };
        },
      },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const defaultExecution = await orchestrator.execute({
      requests: [purchaseRequest('purchase-1', [])],
      authentication: {
        token: 'jwt',
        email: 'user@example.com',
      },
      authBlock: null,
    });
    const defaultResult = defaultExecution.results[0];
    if (
      !defaultResult ||
      defaultResult.status !== 'completed' ||
      defaultResult.kind !== 'purchase'
    ) {
      throw new Error('Expected a completed purchase result.');
    }
    expect(defaultResult.purchases[0]?.payment).toEqual({
      method: 'Transferencia',
      amount: 300,
      paidAt: '2026-07-10',
    });
    expect(defaultResult.purchases[0]?.payment).not.toHaveProperty(
      'operationCode',
    );
    expect(defaultResult.purchases[0]).not.toHaveProperty('dedication');

    const disclosedExecution = await orchestrator.execute({
      requests: [purchaseRequest('purchase-2', ['operation_code'])],
      authentication: {
        token: 'jwt',
        email: 'user@example.com',
      },
      authBlock: null,
    });
    const disclosedResult = disclosedExecution.results[0];
    if (
      !disclosedResult ||
      disclosedResult.status !== 'completed' ||
      disclosedResult.kind !== 'purchase'
    ) {
      throw new Error('Expected a completed purchase result.');
    }
    expect(disclosedResult.purchases[0]?.payment?.operationCode).toBe('OP-123');
    expect(disclosedResult.purchases[0]?.payment).not.toHaveProperty(
      'destinationAccount',
    );
  });

  it('does not call protected capabilities until shared authentication is ready', async () => {
    const agentGateway = new FakeAgentGateway();
    const lookupAuthenticatedUserEvents = vi.fn();
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {
        async search() {
          return {
            status: 'failed' as const,
            reason: 'not_configured' as const,
            retryable: false,
            error: 'not configured',
          };
        },
      },
      providerGateway: {
        lookupAuthenticatedUserEvents,
      } as unknown as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'event-1',
          kind: 'associated_event',
          query: 'Mi evento',
          eventHint: null,
        },
        purchaseRequest('purchase-1', []),
      ],
      authentication: null,
      authBlock: {
        nextInput: 'email',
        guidance: createInformationAuthGuidance('email_required', null),
      },
    });

    expect(execution.results).toEqual([
      expect.objectContaining({
        requestId: 'event-1',
        status: 'needs_input',
        nextInput: 'email',
      }),
      expect.objectContaining({
        requestId: 'purchase-1',
        status: 'needs_input',
        nextInput: 'email',
      }),
    ]);
    expect(lookupAuthenticatedUserEvents).not.toHaveBeenCalled();
    expect(agentGateway.ordersCalls).toBe(0);
    expect(agentGateway.giftCalls).toBe(0);
  });

  it.each([
    ['email', createInformationAuthGuidance('email_required', null)],
    ['otp', createInformationAuthGuidance('otp_pending', 'user@example.com')],
    [
      'phone_confirmation',
      createInformationAuthGuidance('phone_confirmation_required', null),
    ],
  ] as const)('preserves the typed authentication next input: %s', async (nextInput, guidance) => {
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {
        async search() {
          return {
            status: 'failed' as const,
            reason: 'not_configured' as const,
            retryable: false,
            error: 'not configured',
          };
        },
      },
      providerGateway: {} as ProviderGateway,
      agentGateway: new FakeAgentGateway(),
    });

    const execution = await orchestrator.execute({
      requests: [purchaseRequest('typed-next-input', [])],
      authentication: null,
      authBlock: { nextInput, guidance },
    });

    expect(execution.results[0]).toEqual(
      expect.objectContaining({
        status: 'needs_input',
        nextInput,
        guidance,
      }),
    );
  });

  it('uses the exact-order lookup automatically when recent orders contain one match', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.ordersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [giftPurchase()],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {
        async search() {
          return {
            status: 'failed' as const,
            reason: 'not_configured' as const,
            retryable: false,
            error: 'not configured',
          };
        },
      },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'order-1',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pedido',
          orderId: null,
          aspects: ['summary', 'payment_status', 'shipping'],
          sensitiveFields: [],
          authAction: 'none',
        },
      ],
      authentication: {
        token: 'jwt',
        email: 'user@example.com',
      },
      authBlock: null,
    });

    expect(agentGateway.ordersCalls).toBe(2);
    expect(agentGateway.orderIds).toEqual([null, 'ORD-000880']);
    expect(execution.results[0]).toEqual(
      expect.objectContaining({
        kind: 'purchase',
        status: 'completed',
        needsSelection: false,
      }),
    );
  });

  it('removes order and finance data from associated-event results', async () => {
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {
        async search() {
          return {
            status: 'failed' as const,
            reason: 'not_configured' as const,
            retryable: false,
            error: 'not configured',
          };
        },
      },
      providerGateway: {
        async lookupAuthenticatedUserEvents() {
          return eventLookup();
        },
      } as unknown as ProviderGateway,
      agentGateway: new FakeAgentGateway(),
    });

    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'event-1',
          kind: 'associated_event',
          query: 'Mi evento',
          eventHint: null,
        },
      ],
      authentication: {
        token: 'jwt',
        email: 'user@example.com',
      },
      authBlock: null,
    });
    const result = execution.results[0];
    if (
      !result ||
      result.status !== 'completed' ||
      result.kind !== 'associated_event'
    ) {
      throw new Error('Expected a completed associated-event result.');
    }
    expect(result.result.events[0]?.orders).toEqual([]);
    expect(result.result.events[0]?.amountCollected).toBeNull();
    expect(result.result.counts.recentOrders).toBe(0);
  });
});

class FakeAgentGateway implements AgentConversationGateway {
  public ordersCalls = 0;
  public giftCalls = 0;
  public orderIds: Array<string | null> = [];
  public ordersResult: AgentPurchaseLookupResult = {
    status: 'success',
    resource: 'orders',
    purchases: [],
  };
  public giftResult: AgentPurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: [],
  };

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async getRecentMessages(): Promise<
    Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async requestHumanTakeover(): Promise<AgentGatewayResult> {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async authByPhone(): Promise<{
    status: 'failed';
    error: string;
    retryable: boolean;
  }> {
    return { status: 'failed', error: 'not configured in test', retryable: false };
  }

  async updatePhone(): Promise<{ status: 'success' }> {
    return { status: 'success' };
  }

  async getOrders(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult> {
    void args.token;
    this.ordersCalls += 1;
    this.orderIds.push(args.orderId ?? null);
    return this.ordersResult;
  }

  async getGiftPurchases(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult> {
    void args;
    this.giftCalls += 1;
    return this.giftResult;
  }
}

function purchaseRequest(
  requestId: string,
  sensitiveFields: Array<'operation_code'>,
): PendingInformationRequest {
  return {
    requestId,
    kind: 'purchase',
    resource: 'gift_purchases',
    query: 'Detalles del pago',
    orderId: 'ORD-000880',
    aspects: ['payment_details'],
    sensitiveFields,
    authAction: 'none',
  };
}

function giftPurchase(): PurchaseInformation {
  return {
    orderId: 'ORD-000880',
    paymentStatus: 'approved',
    shippingStatus: 'enroute',
    grandTotal: 300,
    paymentMethod: 'Transferencia',
    eventName: 'Boda',
    eventDate: '2026-09-15',
    eventUrl: null,
    createdAt: '2026-07-10',
    items: [],
    payment: {
      method: 'Transferencia',
      amount: 300,
      paidAt: '2026-07-10',
      paymentId: 'payment-secret',
      transactionStatus: 'APPROVED',
      gatewayMessage: 'APPROVED',
      operationCode: 'OP-123',
      originBank: 'Banco origen',
      destinationAccount: {
        holder: 'Sin Envolturas',
        bank: 'Banco destino',
        number: '001',
        cci: '002',
        type: 'current',
      },
      voucherImage: 'voucher.png',
    },
    dedication: {
      message: 'Felicidades',
      isPrivate: false,
      sendPhysical: true,
      physicalStatus: 'enroute',
    },
    thanks: {
      message: 'Gracias',
      sendMethod: 'whatsapp',
    },
    isThanked: true,
  };
}

function eventLookup(): UserEventLookupResult {
  return {
    lookup: {
      email: 'user@example.com',
      phone: null,
    },
    user: {
      id: 42,
      fullName: 'Usuario',
      email: 'user@example.com',
      fullPhone: null,
    },
    events: [
      {
        relation: 'owner',
        eventId: 88,
        slug: 'boda',
        url: 'https://sinenvolturas.com/boda',
        name: 'Boda',
        place: 'Lima',
        type: 'wedding',
        datetime: '2026-09-15',
        stage: 'published',
        isVisible: true,
        isPublic: true,
        currency: 'PEN',
        country: 'Perú',
        guestStatus: null,
        hostType: null,
        hostPermission: null,
        hostStatus: null,
        celebratedType: null,
        amountCollected: 1000,
        amountTransferred: 500,
        transactionsCount: 4,
        invitedGuestCount: 20,
        confirmedGuestCount: 10,
        orders: [
          {
            id: 1,
            incrementId: 'ORD-000880',
            giftType: 'cash',
            grandTotal: 300,
            paymentStatus: 'approved',
            shippingStatus: null,
            createdAt: '2026-07-10',
            paymentMethod: 'Visa',
          },
        ],
      },
    ],
    counts: {
      ownerEvents: 1,
      guestEvents: 0,
      hostEvents: 0,
      celebratedEvents: 0,
      recentOrders: 1,
    },
  };
}
