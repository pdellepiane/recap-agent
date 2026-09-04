import { describe, expect, it, vi } from 'vitest';

import {
  createInformationAuthGuidance,
  type PendingInformationRequest,
  type PurchaseInformation,
} from '../src/core/information';
import {
  type AgentConversationGateway,
  type AgentGatewayResult,
  type AgentEventDetailInput,
  type AgentMessageLogInput,
  type AgentPhonePurchaseLookupResult,
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
    expect(execution.summaries).toEqual([
      expect.objectContaining({
        requestId: 'information-1',
        kind: 'faq',
        outcomeCode: 'completed_with_results',
        retryable: null,
        resultCount: 1,
        evidence: [expect.objectContaining({
          fileId: 'file-1',
          filename: 'faq.md',
          score: 0.9,
        })],
      }),
      expect.objectContaining({
        requestId: 'information-2',
        kind: 'associated_event',
        outcomeCode: 'completed_with_results',
        retryable: null,
        evidence: [],
      }),
    ]);
    expect(execution.summaries[0]?.queryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(execution.summaries[0]?.evidence[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
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
    expect(execution.summaries).toEqual([
      expect.objectContaining({
        requestId: 'faq-1',
        outcomeCode: 'completed_with_results',
        retryable: null,
        evidence: [expect.objectContaining({ fileId: 'file-1' })],
      }),
      expect.objectContaining({
        requestId: 'purchase-1',
        outcomeCode: 'route_unavailable',
        retryable: false,
        evidence: [],
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
      method: null,
      amount: null,
      paidAt: '2026-07-10',
    });
    expect(defaultResult.purchases[0]?.amountDisclosure).toEqual({
      total: 300,
      paid: 300,
      currency: null,
      paymentMethod: 'Transferencia',
      presentation: 'recorded_method_no_currency',
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

  it('omits payment type from approved summaries but keeps it for pending ones', async () => {
    const knowledgeGateway = {
      async search() {
        return {
          status: 'failed' as const,
          reason: 'not_configured' as const,
          retryable: false,
          error: 'not configured',
        };
      },
    };
    const runSummary = async (purchase: PurchaseInformation) => {
      const agentGateway = new FakeAgentGateway();
      agentGateway.giftResult = {
        status: 'success',
        resource: 'gift_purchases',
        purchases: [purchase],
      };
      const orchestrator = new InformationOrchestrator({
        knowledgeGateway,
        providerGateway: {} as ProviderGateway,
        agentGateway,
      });
      const execution = await orchestrator.execute({
        requests: [{
          requestId: 'summary-1',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Estado de mi compra',
          orderId: 'ORD-000880',
          aspects: ['summary'],
          sensitiveFields: [],
          authAction: 'none',
        }],
        authentication: {
          token: 'jwt',
          email: 'user@example.com',
        },
        authBlock: null,
      });
      const result = execution.results[0];
      if (!result || result.status !== 'completed' || result.kind !== 'purchase') {
        throw new Error('Expected a completed purchase result.');
      }
      return result.purchases[0]?.amountDisclosure;
    };

    const approved = await runSummary(giftPurchase());
    expect(approved).toMatchObject({
      total: 300,
      paymentMethod: null,
      presentation: 'recorded_method_no_currency',
    });
    const pending = await runSummary({
      ...giftPurchase(),
      paymentStatus: 'pending',
      paymentMethod: 'Yape',
    });
    expect(pending).toMatchObject({
      total: 300,
      paymentMethod: 'Yape',
      presentation: 'recorded_method_no_currency',
    });
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

  it('resolves an account-less guest event from the trusted phone without OTP', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = {
      status: 'success',
      events: [{
        eventId: 88,
        name: 'Boda Laura & Marcos',
        slug: 'boda-laura-marcos',
        url: null,
        datetime: '15/09/2026 18:00',
        type: 'wedding',
        typeDetail: null,
        stage: 'published',
        city: 'Lima',
        country: 'Perú',
        currency: 'PEN',
      }],
    };
    agentGateway.eventDetailResult = {
      status: 'success',
      event: {
        ...agentGateway.guestEventsResult.events[0],
        withTime: true,
        timezone: 'America/Lima',
        celebrateds: [],
        moments: [{
          label: 'Recepción',
          description: null,
          datetime: '15/09/2026 19:00',
          withTime: true,
          locationDescription: 'Salón principal',
          locationReference: null,
          locationUrl: null,
          locationCoords: null,
          position: 1,
        }],
        dresscode: { type: 'formal', description: 'Vestimenta formal.' },
        commonAsked: [],
        contactInfo: [],
      },
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'event-guest-1',
        kind: 'associated_event',
        query: '¿Dónde es la recepción?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '973296571' },
    });

    expect(agentGateway.guestEventCalls).toBe(1);
    expect(agentGateway.eventDetailCalls).toBe(1);
    expect(execution.results[0]).toMatchObject({
      kind: 'associated_event',
      status: 'completed',
      accessMethod: 'trusted_phone_guest',
      result: {
        events: [{
          eventId: 88,
          detail: {
            moments: [{ locationDescription: 'Salón principal' }],
            dresscode: { type: 'formal' },
          },
        }],
      },
    });
    expect(execution.summaries[0]).toMatchObject({
      accessMethod: 'trusted_phone_guest',
      eventDetailCount: 1,
    });
  });

  it('returns guest event choices without OTP when several invitations remain ambiguous', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = {
      status: 'success',
      events: [
        guestEvent(88, 'Boda Laura & Marcos'),
        guestEvent(89, 'Bautizo Sofía'),
      ],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'event-guest-many',
        kind: 'associated_event',
        query: '¿Dónde es mi evento?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '973296571' },
    });

    expect(agentGateway.eventDetailCalls).toBe(0);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_guest',
      result: { counts: { guestEvents: 2 } },
    });
  });

  it.each(['not_found', 'empty'] as const)('preserves a scoped phone %s instead of falling through to email', async (outcome) => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = outcome === 'not_found'
      ? { status: 'not_found' }
      : { status: 'success', events: [] };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'event-guest-missing',
        kind: 'associated_event',
        query: '¿Dónde es mi evento?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: {
        nextInput: 'email',
        guidance: createInformationAuthGuidance('email_required', null),
      },
      trustedPhone: { phone_extension: '+51', phone_number: '973296571' },
    });

    expect(execution.results[0]).toMatchObject({
      status: 'failed',
      failureKind: 'not_found',
      accessMethod: 'trusted_phone_guest',
    });
    expect(execution.summaries[0]).toMatchObject({ outcomeCode: 'not_found', accessMethod: 'trusted_phone_guest' });
  });

  it('reads phone-scoped orders without an authentication or OTP preflight', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [giftPurchase()],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'phone-order-1',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado de mi pedido?',
        orderId: null,
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: {
        nextInput: 'email',
        guidance: createInformationAuthGuidance('email_required', null),
      },
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.guestOrdersCalls).toBe(1);
    expect(agentGateway.authByPhoneCalls).toBe(0);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      kind: 'purchase',
      needsSelection: false,
    });
  });

  it('routes gift summary requests directly to phone orders', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestGiftResult = {
      status: 'retryable_failure',
      resource: 'gift_purchases',
      retryable: true,
      error: 'HTTP 500',
    };
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [giftPurchase()],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'phone-gift-summary',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: '¿Se aprobó mi regalo?',
        orderId: 'ORD-000880',
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.guestGiftCalls).toBe(0);
    expect(agentGateway.guestOrdersCalls).toBe(1);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      kind: 'purchase',
      lookupResource: 'orders',
      purchases: [{ orderId: 'ORD-000880', paymentStatus: 'approved' }],
    });
  });

  it('does not use the orders fallback when gift details are requested', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestGiftResult = {
      status: 'retryable_failure',
      resource: 'gift_purchases',
      retryable: true,
      error: 'HTTP 500',
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'phone-gift-details',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: '¿Qué dedicatoria escribí?',
        orderId: null,
        aspects: ['dedication'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.guestGiftCalls).toBe(1);
    expect(agentGateway.guestOrdersCalls).toBe(0);
    expect(execution.results[0]).toMatchObject({
      status: 'failed',
      failureKind: 'request_failed',
    });
    expect(execution.results[0]).not.toMatchObject({ status: 'needs_input' });
  });

  it('deduplicates identical phone purchase reads across requests', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [giftPurchase()],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const request = (requestId: string): PendingInformationRequest => ({
      requestId,
      kind: 'purchase',
      resource: 'orders',
      query: 'Estado del pedido',
      orderId: 'ORD-000880',
      aspects: ['summary'],
      sensitiveFields: [],
      authAction: 'none',
    });
    const execution = await orchestrator.execute({
      requests: [request('dedupe-1'), request('dedupe-2')],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.guestOrdersCalls).toBe(1);
    expect(execution.results).toHaveLength(2);
    expect(execution.results.every((result) => result.status === 'completed')).toBe(true);
  });

  it('matches COD and numeric customer references locally against backend increment ids', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [
        { ...giftPurchase(), orderId: 'ORD_internal_1', customerTransactionNumber: '301816' },
        { ...giftPurchase(), orderId: 'ORD_internal_2', customerTransactionNumber: '188308' },
      ],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'customer-code',
        kind: 'purchase',
        resource: 'orders',
        query: 'COD301816',
        orderId: 'COD301816',
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.guestOrderIds).toEqual([null]);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      needsSelection: false,
      referenceResolution: 'matched',
      requestedCustomerTransactionNumber: '301816',
      purchases: [{
        orderId: 'ORD_internal_1',
        customerTransactionNumber: '301816',
      }],
    });
  });

  it('falls back to phone-scoped choices when the backend omits customer transaction ids', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [
        { ...giftPurchase(), orderId: 'ORD_internal_1', eventName: 'Maria Inés & Santiago' },
        { ...giftPurchase(), orderId: 'ORD_internal_2', eventName: 'Sylvia & Moises' },
      ],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'customer-code-unavailable',
        kind: 'purchase',
        resource: 'orders',
        query: '301816',
        orderId: '301816',
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.guestOrderIds).toEqual([null]);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      coverage: 'partial',
      needsSelection: true,
      referenceResolution: 'unavailable',
      requestedCustomerTransactionNumber: '301816',
      purchases: [{ eventName: 'Maria Inés & Santiago' }, { eventName: 'Sylvia & Moises' }],
    });
  });

  it('selects the current pending purchase from explicit typed evidence without dropping older records', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [
        {
          ...giftPurchase(),
          orderId: 'ORD-current',
          eventName: 'Samuel Josué',
          grandTotal: 80,
          paymentStatus: 'pending',
          createdAt: '2026-08-29',
          currency: null,
          payment: null,
        },
        {
          ...giftPurchase(),
          orderId: 'ORD-old',
          eventName: 'Josué y Paola',
          grandTotal: 88.18,
          paymentStatus: 'approved',
          createdAt: '2025-04-16',
          currency: null,
          payment: null,
        },
      ],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'victor-current-payment',
        kind: 'purchase',
        resource: 'orders',
        query: 'Estado del regalo para Samuel Josué por S/ 80.',
        orderId: null,
        eventHint: 'Samuel Josué',
        amount: 80,
        aspects: ['payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '981056171' },
    });

    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      needsSelection: false,
      purchases: [{
        orderId: 'ORD-current',
        eventName: 'Samuel Josué',
        grandTotal: null,
        paymentStatus: 'pending',
      }],
    });
  });

  it('treats a cart-only phone response as valid partial coverage', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [],
      carts: [{
        cartId: 'cart-sonia-1',
        eventName: 'Carlos y Adriana',
        status: 'abandoned',
        wasAbandoned: true,
        subtotal: 120,
        giftsQuantity: 1,
        items: [],
      }],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'cart-only',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Qué pasó con mi carrito?',
        orderId: null,
        aspects: ['summary'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });

    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      coverage: 'partial',
      needsSelection: false,
      purchases: [],
    });
    expect(execution.results[0]).not.toMatchObject({ failureKind: 'not_found' });
  });

  it('uses pending and completed partitions instead of a legacy flattened list', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      // This compatibility list intentionally contains only an unrelated old
      // record; partitioned evidence is authoritative for the new flow.
      purchases: [{ ...giftPurchase(), orderId: 'ORD-legacy-old', eventName: 'AMORCITOS' }],
      orderPartitions: {
        pending: [{
          ...giftPurchase(),
          orderId: 'ORD-pending-current',
          eventName: 'Isa y Lu',
          grandTotal: 63.85,
          paymentStatus: 'pending',
        }],
        completed: [{
          ...giftPurchase(),
          orderId: 'ORD-completed-old',
          eventName: 'AMORCITOS',
          grandTotal: 98.14,
          paymentStatus: 'declined',
        }],
      },
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'partition-current',
        kind: 'purchase',
        resource: 'orders',
        query: 'Estado de Isa y Lu por 63.85',
        orderId: null,
        eventHint: 'Isa y Lu',
        amount: 63.85,
        aspects: ['payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });

    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      purchases: [{ orderId: 'ORD-pending-current', eventName: 'Isa y Lu' }],
      needsSelection: false,
    });
    expect(execution.results[0]).not.toMatchObject({ purchases: [
      expect.objectContaining({ orderId: 'ORD-legacy-old' }),
    ] });
  });

  it('retains a known guest event when enriched detail returns 500 and public detail succeeds', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = {
      status: 'success',
      events: [guestEvent(88, 'Boda Laura & Marcos')],
    };
    agentGateway.enrichedEventDetailResult = {
      status: 'failed',
      retryable: true,
      error: 'HTTP 500',
    } as typeof agentGateway.enrichedEventDetailResult;
    agentGateway.publicEventDetailResult = {
      status: 'success',
      event: {
        ...guestEvent(88, 'Boda Laura & Marcos'),
        withTime: true,
        timezone: 'America/Lima',
        celebrateds: [],
        moments: [],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
      },
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'event-enriched-500',
        kind: 'associated_event',
        query: '¿Dónde es el evento?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.eventDetailCalls).toBe(2);
    expect(agentGateway.eventDetailInputs).toEqual([
      { eventId: 88, phone: { phone_extension: '+51', phone_number: '987654321' } },
      { eventId: 88 },
    ]);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_guest',
      result: { events: [{ eventId: 88, detail: { withTime: true } }] },
    });
  });

  it('keeps phone RSVP evidence when enriched event detail succeeds', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = {
      status: 'success',
      events: [guestEvent(88, 'Boda Laura & Marcos')],
    };
    agentGateway.enrichedEventDetailResult = {
      status: 'success',
      event: {
        ...guestEvent(88, 'Boda Laura & Marcos'),
        withTime: true,
        timezone: 'America/Lima',
        celebrateds: [],
        moments: [],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
      },
      attendance: {
        guestId: 123,
        name: 'Laura',
        hasResponded: true,
        willAttend: true,
        responseDate: '2026-08-25',
      },
      purchases: [],
    } as typeof agentGateway.enrichedEventDetailResult;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'event-attendance-1',
        kind: 'associated_event',
        query: '¿Estoy confirmado?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });
    expect(execution.results[0]).toMatchObject({
      result: {
        events: [{
          guestId: 123,
          guestStatus: {
            hasResponded: true,
            willAttend: true,
            responseDate: '2026-08-25',
          },
        }],
      },
    });
  });

  it('reuses event-scoped purchases and does not disclose them in the event result', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = {
      status: 'success',
      events: [guestEvent(88, 'Boda Laura & Marcos')],
    };
    agentGateway.enrichedEventDetailResult = {
      status: 'success',
      event: {
        ...guestEvent(88, 'Boda Laura & Marcos'),
        withTime: true,
        timezone: 'America/Lima',
        celebrateds: [],
        moments: [],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
        attendance: null,
        purchases: [giftPurchase()],
      },
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'event-with-purchase',
          kind: 'associated_event',
          query: '¿Dónde es el evento?',
          eventHint: null,
        },
        {
          requestId: 'event-purchase-status',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: '¿Se aprobó mi regalo para ese evento?',
          orderId: null,
          aspects: ['summary', 'payment_status'],
          sensitiveFields: [],
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.eventDetailCalls).toBe(1);
    expect(agentGateway.guestGiftCalls).toBe(0);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      result: { events: [{ orders: [] }], counts: { recentOrders: 0 } },
    });
    expect(execution.results[1]).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_event_purchase',
      coverage: 'complete',
      purchases: [{ orderId: 'ORD-000880', paymentStatus: 'approved' }],
    });
  });

  it('suppresses conflicting order summaries in favor of detailed gift data', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [{ ...giftPurchase(), paymentStatus: 'pending' }],
    };
    agentGateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [{ ...giftPurchase(), paymentStatus: 'approved' }],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'order-summary-conflict',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pedido',
          orderId: 'ORD-000880',
          aspects: ['summary', 'payment_status'],
          sensitiveFields: [],
          authAction: 'none',
        },
        {
          requestId: 'gift-detail-conflict',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Detalle del regalo',
          orderId: 'ORD-000880',
          aspects: ['payment_status', 'dedication'],
          sensitiveFields: [],
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(execution.results).toHaveLength(2);
    for (const result of execution.results) {
      expect(result).toMatchObject({
        status: 'completed',
        coverage: 'inconsistent',
        purchases: [{ paymentStatus: 'approved' }],
      });
    }
  });

  it('excludes paymentMethod from summary aspect and includes it for payment_details', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.giftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [giftPurchase()],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const summaryExecution = await orchestrator.execute({
      requests: [
        {
          requestId: 'summary-1',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'estado',
          orderId: 'ORD-000880',
          aspects: ['summary'],
          sensitiveFields: [],
          authAction: 'none',
        },
      ],
      authentication: { token: 'jwt', email: 'user@example.com' },
      authBlock: null,
    });
    const summaryResult = summaryExecution.results[0];
    if (!summaryResult || summaryResult.status !== 'completed' || summaryResult.kind !== 'purchase') {
      throw new Error('Expected completed purchase for summary aspect.');
    }
    expect(summaryResult.purchases[0]?.paymentMethod).toBeNull();

    const paymentDetailsExecution = await orchestrator.execute({
      requests: [
        {
          requestId: 'payment-details-1',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'pago',
          orderId: 'ORD-000880',
          aspects: ['payment_details'],
          sensitiveFields: [],
          authAction: 'none',
        },
      ],
      authentication: { token: 'jwt', email: 'user@example.com' },
      authBlock: null,
    });
    const paymentDetailsResult = paymentDetailsExecution.results[0];
    if (!paymentDetailsResult || paymentDetailsResult.status !== 'completed' || paymentDetailsResult.kind !== 'purchase') {
      throw new Error('Expected completed purchase for payment_details aspect.');
    }
    expect(paymentDetailsResult.purchases[0]?.paymentMethod).toBeNull();
    expect(paymentDetailsResult.purchases[0]?.amountDisclosure).toMatchObject({
      paymentMethod: 'Transferencia',
      presentation: 'recorded_method_no_currency',
    });
  });
});

class FakeAgentGateway implements AgentConversationGateway {
  public ordersCalls = 0;
  public giftCalls = 0;
  public guestOrdersCalls = 0;
  public guestGiftCalls = 0;
  public guestOrderIds: Array<string | null> = [];
  public guestGiftOrderIds: Array<string | null> = [];
  public authByPhoneCalls = 0;
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
  public guestOrdersResult: AgentPhonePurchaseLookupResult = {
    status: 'success',
    resource: 'orders',
    purchases: [],
  };
  public guestGiftResult: AgentPhonePurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: [],
  };
  public guestEventCalls = 0;
  public eventDetailCalls = 0;
  public eventDetailInputs: Array<{
    eventId: number;
    phone?: { phone_extension: string; phone_number: string };
  }> = [];
  public guestEventsResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getGuestEventsByPhone']>>
  > = { status: 'not_found' };
  public eventDetailResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>
  > = { status: 'not_found' };
  public enrichedEventDetailResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>
  > = { status: 'not_found' };
  public publicEventDetailResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>
  > = { status: 'not_found' };

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
    this.authByPhoneCalls += 1;
    return { status: 'failed', error: 'not configured in test', retryable: false };
  }

  async updatePhone(): Promise<{ status: 'success' }> {
    return { status: 'success' };
  }

  async getGuestEventsByPhone(): Promise<typeof this.guestEventsResult> {
    this.guestEventCalls += 1;
    return this.guestEventsResult;
  }

  async getEventDetail(input: AgentEventDetailInput): Promise<typeof this.eventDetailResult> {
    this.eventDetailCalls += 1;
    if (input.eventId === undefined) {
      return { status: 'not_found' };
    }
    this.eventDetailInputs.push({
      eventId: input.eventId,
      ...(input.phone
        ? { phone: input.phone }
        : {}),
    });
    if (input.phone) {
      return this.enrichedEventDetailResult.status === 'not_found'
        ? this.eventDetailResult
        : this.enrichedEventDetailResult;
    }
    return this.publicEventDetailResult.status === 'not_found'
      ? this.eventDetailResult
      : this.publicEventDetailResult;
  }

  async getGuestOrdersByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    this.guestOrdersCalls += 1;
    this.guestOrderIds.push(args.orderId ?? null);
    return this.guestOrdersResult;
  }

  async getGuestGiftPurchasesByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    this.guestGiftCalls += 1;
    this.guestGiftOrderIds.push(args.orderId ?? null);
    return this.guestGiftResult;
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

function guestEvent(eventId: number, name: string) {
  return {
    eventId,
    name,
    slug: `event-${eventId}`,
    url: null,
    datetime: '15/09/2026 18:00',
    type: 'wedding',
    typeDetail: null,
    stage: 'published',
    city: 'Lima',
    country: 'Perú',
    currency: 'PEN',
  };
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
        guestId: null,
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
