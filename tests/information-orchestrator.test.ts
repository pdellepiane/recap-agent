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
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import type {
  KnowledgeRetrievalGateway,
  KnowledgeRetrievalResult,
} from '../src/runtime/knowledge-retrieval-gateway';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import hostedEventFixture from '../evals/fixtures/phone-owner-history-kilimanjaro.json';

describe('InformationOrchestrator', () => {
  it('includes verified-phone account event facts and rejects mismatched accounts', async () => {
    const liveAccount = hostedEventFixture.providerUserEvents as unknown as UserEventLookupResult;
    const liveOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: { async lookupUserEventContext() { return liveAccount; } } as unknown as ProviderGateway,
      agentGateway: new FakeAgentGateway(),
    });
    const liveSnapshot = await liveOrchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: { phone_extension: '+51', phone_number: '900000400' },
      identity: { customerRef: '+51900000400', scope: 'trusted_phone', source: 'test_phone' },
      currentContext: { relevantEventIds: [40034] },
      deadlineMs: null,
    });
    expect(liveSnapshot.invitationsEvents.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 40034, name: 'Kilimanjaro', relation: 'host',
        datetime: '2026-09-22 15:35:00' }),
    ]));
    expect(liveSnapshot.currentContext.relevantEventIds).toContain(40034);

    const roles = eventLookup();
    if (!roles.user) throw new Error('expected account fixture');
    roles.user.fullPhone = '+51991347878';
    roles.events = [
      { ...roles.events[0], eventId: 40034, name: 'Kilimanjaro',
        datetime: '2026-09-22 15:35:00', relation: 'owner' },
      { ...roles.events[0], eventId: 40034, name: 'Kilimanjaro',
        datetime: '2026-09-22 15:35:00', relation: 'host' },
    ];
    const lookupUserEventContext = vi.fn(async () => roles);
    const providerGateway = {
      lookupUserEventContext,
    } as unknown as ProviderGateway;
    const rolesOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway,
      agentGateway: new FakeAgentGateway(),
    });
    const rolesSnapshot = await rolesOrchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: { phone_extension: '+51', phone_number: '991347878' },
      identity: { customerRef: '+51991347878', scope: 'trusted_phone', source: 'test_phone' },
      currentContext: null,
      deadlineMs: null,
    });
    expect(rolesSnapshot.invitationsEvents.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 40034, relation: 'owner',
        datetime: '2026-09-22 15:35:00', amountCollected: null, orders: [] }),
      expect.objectContaining({ eventId: 40034, relation: 'host',
        datetime: '2026-09-22 15:35:00', amountTransferred: null, orderIds: [] }),
    ]));
    expect(lookupUserEventContext).toHaveBeenCalledWith({
      email: null, phone: '991347878',
    });

    const mismatch = eventLookup();
    if (!mismatch.user) throw new Error('expected account fixture');
    mismatch.user.fullPhone = '+51900000000';
    mismatch.events[0] = { ...mismatch.events[0], eventId: 40034, name: 'Kilimanjaro' };
    const mismatchOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: { async lookupUserEventContext() { return mismatch; } } as unknown as ProviderGateway,
      agentGateway: new FakeAgentGateway(),
    });
    const mismatchSnapshot = await mismatchOrchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: { phone_extension: '+51', phone_number: '991347878' },
      identity: { customerRef: '+51991347878', scope: 'trusted_phone', source: 'test_phone' },
      currentContext: null,
      deadlineMs: null,
    });
    expect(mismatchSnapshot.invitationsEvents.invitations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 40034 }),
    ]));
  });

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
        purchaseRequest('purchase-1'),
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

  it('blocks protected capabilities until shared authentication is ready and preserves the typed next input', async () => {
    const blockedKnowledgeGateway = {
      async search() {
        return {
          status: 'failed' as const,
          reason: 'not_configured' as const,
          retryable: false,
          error: 'not configured',
        };
      },
    };
    const agentGateway = new FakeAgentGateway();
    const lookupAuthenticatedUserEvents = vi.fn();
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: blockedKnowledgeGateway,
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
        purchaseRequest('purchase-1'),
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

    const variants = [
      ['email', createInformationAuthGuidance('email_required', null)],
      ['otp', createInformationAuthGuidance('otp_pending', 'user@example.com')],
      [
        'phone_confirmation',
        createInformationAuthGuidance('phone_confirmation_required', null),
      ],
    ] as const;
    for (const [nextInput, guidance] of variants) {
      const typed = await orchestrator.execute({
        requests: [purchaseRequest('typed-next-input')],
        authentication: null,
        authBlock: { nextInput, guidance },
      });

      expect(typed.results[0]).toEqual(
        expect.objectContaining({
          status: 'needs_input',
          nextInput,
          guidance,
        }),
      );
    }
    expect(lookupAuthenticatedUserEvents).not.toHaveBeenCalled();
  });

  it('answers a single discovery match without an exact-order re-read', async () => {
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
          authAction: 'none',
        },
      ],
      authentication: {
        token: 'jwt',
        email: 'user@example.com',
      },
      authBlock: null,
    });

    // One source contract: the discovery result already carries the
    // record facts, so no detail read occurs; the single match still
    // answers without a selection step.
    expect(agentGateway.ordersCalls).toBe(1);
    expect(agentGateway.orderIds).toEqual([null]);
    expect(execution.results[0]).toEqual(
      expect.objectContaining({
        kind: 'purchase',
        status: 'completed',
        needsSelection: false,
      }),
    );
  });

  it('preserves authorized order and payment facts from associated-event results', async () => {
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
    expect(result.result.events[0]?.orders).toMatchObject([{
      id: 1,
      incrementId: 'ORD-000880',
      grandTotal: 300,
      paymentStatus: 'approved',
    }]);
    expect(result.result.counts.recentOrders).toBe(1);
  });

  it('resolves phone-scoped guest events for single, ambiguous, and missing matches without OTP', async () => {
    const trustedPhone = { phone_extension: '+51', phone_number: '973296571' };
    const singleGateway = new FakeAgentGateway();
    singleGateway.guestEventsResult = {
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
    singleGateway.eventDetailResult = {
      status: 'success',
      event: {
        ...singleGateway.guestEventsResult.events[0],
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
    const singleOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: singleGateway,
    });

    const single = await singleOrchestrator.execute({
      requests: [{
        requestId: 'event-guest-1',
        kind: 'associated_event',
        query: '¿Dónde es la recepción?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone,
    });

    expect(singleGateway.guestEventCalls).toBe(1);
    expect(singleGateway.eventDetailCalls).toBe(1);
    expect(single.results[0]).toMatchObject({
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
    expect(single.summaries[0]).toMatchObject({
      accessMethod: 'trusted_phone_guest',
      eventDetailCount: 1,
    });

    const manyGateway = new FakeAgentGateway();
    manyGateway.guestEventsResult = {
      status: 'success',
      events: [
        guestEvent(88, 'Boda Laura & Marcos'),
        guestEvent(89, 'Bautizo Sofía'),
      ],
    };
    const manyOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: manyGateway,
    });

    const many = await manyOrchestrator.execute({
      requests: [{
        requestId: 'event-guest-many',
        kind: 'associated_event',
        query: '¿Dónde es mi evento?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone,
    });

    expect(manyGateway.eventDetailCalls).toBe(2);
    expect(many.results[0]).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_guest',
      result: { counts: { guestEvents: 2 } },
    });

    for (const outcome of ['not_found', 'empty'] as const) {
      const missingGateway = new FakeAgentGateway();
      missingGateway.guestEventsResult = outcome === 'not_found'
        ? { status: 'not_found' }
        : { status: 'success', events: [] };
      const missingOrchestrator = new InformationOrchestrator({
        knowledgeGateway: { async search() { throw new Error('unused'); } },
        providerGateway: {} as ProviderGateway,
        agentGateway: missingGateway,
      });

      const missing = await missingOrchestrator.execute({
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
        trustedPhone,
      });

      expect(missing.results[0]).toMatchObject({
        status: 'failed',
        failureKind: 'not_found',
        accessMethod: 'trusted_phone_guest',
      });
      expect(missing.summaries[0]).toMatchObject({ outcomeCode: 'not_found', accessMethod: 'trusted_phone_guest' });
    }
  });

  it('reads phone-scoped orders once without a preflight and dedupes identical reads', async () => {
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

    const dedupeGateway = new FakeAgentGateway();
    dedupeGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [giftPurchase()],
    };
    const dedupeOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: dedupeGateway,
    });

    const dedupeRequest = (requestId: string): PendingInformationRequest => ({
      requestId,
      kind: 'purchase',
      resource: 'orders',
      query: 'Estado del pedido',
      orderId: 'ORD-000880',
      authAction: 'none',
    });
    const deduped = await dedupeOrchestrator.execute({
      requests: [dedupeRequest('dedupe-1'), dedupeRequest('dedupe-2')],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(dedupeGateway.guestOrdersCalls).toBe(1);
    expect(deduped.results).toHaveLength(2);
    expect(deduped.results.every((result) => result.status === 'completed')).toBe(true);
  });

  it('keeps a failed gift root explicit without an orders fallback in preparation and execution', async () => {
    const failedGift = {
      status: 'retryable_failure',
      resource: 'gift_purchases',
      retryable: true,
      error: 'HTTP 500',
    } as const;
    const prepGateway = new FakeAgentGateway();
    prepGateway.guestGiftResult = { ...failedGift };
    prepGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [giftPurchase()],
    };
    const prepOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: prepGateway,
    });

    const snapshot = await prepOrchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
      identity: {
        customerRef: '+51987654321',
        scope: 'trusted_phone',
        source: 'test_phone',
      },
      currentContext: null,
      deadlineMs: null,
    });

    // Both customer roots are read before extraction. A failed gift source
    // remains explicit while the successful orders fact stays available.
    expect(prepGateway.guestGiftCalls).toBe(1);
    expect(prepGateway.guestOrdersCalls).toBe(1);
    expect(snapshot.purchasesCarts).toMatchObject({
      status: 'ready',
      completeness: 'partial',
      purchases: [{ orderId: 'ORD-000880', paymentStatus: 'approved' }],
      sourceCoverage: [
        { source: 'orders', status: 'completed', count: 1 },
        { source: 'gift_purchases', status: 'failed' },
      ],
    });

    const execGateway = new FakeAgentGateway();
    execGateway.guestGiftResult = { ...failedGift };
    const execOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: execGateway,
    });

    const execution = await execOrchestrator.execute({
      requests: [{
        requestId: 'phone-gift-details',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: '¿Qué dedicatoria escribí?',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(execGateway.guestGiftCalls).toBe(1);
    expect(execGateway.guestOrdersCalls).toBe(0);
    expect(execution.results[0]).toMatchObject({
      status: 'failed',
      failureKind: 'request_failed',
    });
    expect(execution.results[0]).not.toMatchObject({ status: 'needs_input' });
  });

  it('keeps a payment-time question on its declared orders source without gift facts', async () => {
    const agentGateway = new FakeAgentGateway();
    const timed = giftPurchase();
    if (timed.payment) {
      timed.payment = { ...timed.payment, paidAt: '2026-08-30 21:31:00' };
    }
    agentGateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [timed],
    };
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [{ ...timed, payment: null }],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
    const phone = { phone_extension: '+51', phone_number: '987654321' };

    const timeExecution = await orchestrator.execute({
      requests: [{
        requestId: 'phone-payment-time',
        kind: 'purchase',
        resource: 'orders',
        query: '¿A qué hora se hizo el pago?',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: phone,
    });
    // One source contract: the declared orders source is read even
    // though payment_details names gift-owned facts; the orders record
    // carries no payment detail, so paidAt stays honestly absent instead
    // of crossing routes inside the executor.
    expect(agentGateway.guestGiftCalls).toBe(0);
    expect(agentGateway.guestOrdersCalls).toBe(1);
    const timeResult = timeExecution.results[0];
    if (!timeResult || timeResult.status !== 'completed' || timeResult.kind !== 'purchase') {
      throw new Error('Expected completed purchase for the payment-time read.');
    }
    expect(timeResult.purchases[0]?.payment ?? null).toBeNull();

    const statusExecution = await orchestrator.execute({
      requests: [{
        requestId: 'phone-status-only',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado de mi pedido?',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: phone,
    });
    expect(agentGateway.guestGiftCalls).toBe(0);
    expect(agentGateway.guestOrdersCalls).toBe(2);
    const statusResult = statusExecution.results[0];
    if (!statusResult || statusResult.status !== 'completed' || statusResult.kind !== 'purchase') {
      throw new Error('Expected completed purchase for the status-only read.');
    }
    expect(statusResult.purchases[0]?.payment ?? null).toBeNull();
  });

  it('resolves customer references locally, keeping authorized alternatives visible when unmatched', async () => {
    const trustedPhone = { phone_extension: '+51', phone_number: '987654321' };

    // A bare or prefixed reference matches locally against backend
    // increment ids with no exact-order re-read.
    for (const reference of ['COD301816', '301816']) {
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
          query: reference,
          orderId: reference,
          authAction: 'none',
        }],
        authentication: null,
        authBlock: null,
        trustedPhone,
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
    }

    const resolveReference = async (
      requestId: string,
      query: string,
      orderId: string,
      purchases: PurchaseInformation[],
    ) => {
      const agentGateway = new FakeAgentGateway();
      agentGateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases };
      const orchestrator = new InformationOrchestrator({
        knowledgeGateway: { async search() { throw new Error('unused'); } },
        providerGateway: {} as ProviderGateway,
        agentGateway,
      });
      const execution = await orchestrator.execute({
        requests: [{
          requestId,
          kind: 'purchase',
          resource: 'orders',
          query,
          orderId,
          authAction: 'none',
        }],
        authentication: null,
        authBlock: null,
        trustedPhone,
      });
      expect(agentGateway.guestOrderIds).toEqual([null]);
      return execution;
    };

    const omitted = await resolveReference('customer-code-unavailable', '301816', '301816', [
      { ...giftPurchase(), orderId: 'ORD_internal_1', eventName: 'Maria Inés & Santiago' },
      { ...giftPurchase(), orderId: 'ORD_internal_2', eventName: 'Sylvia & Moises' },
    ]);
    expect(omitted.results[0]).toMatchObject({
      status: 'completed',
      coverage: 'partial',
      needsSelection: true,
      referenceResolution: 'unavailable',
      requestedCustomerTransactionNumber: '301816',
      purchases: [{ eventName: 'Maria Inés & Santiago' }, { eventName: 'Sylvia & Moises' }],
    });

    const unmatched = await resolveReference('unmatched-customer-code', 'COD301816', 'COD301816', [
      { ...giftPurchase(), orderId: 'ORD-A', customerTransactionNumber: '301817', eventName: 'Evento de prueba A', eventDate: '2026-09-12' },
      { ...giftPurchase(), orderId: 'ORD-B', customerTransactionNumber: '301818', eventName: 'Evento de prueba B', eventDate: '2026-08-22' },
    ]);
    expect(unmatched.results[0]).toMatchObject({
      status: 'completed',
      needsSelection: true,
      referenceResolution: 'unavailable',
      requestedCustomerTransactionNumber: '301816',
      purchases: [
        { orderId: 'ORD-A', eventName: 'Evento de prueba A', eventDate: '2026-09-12' },
        { orderId: 'ORD-B', eventName: 'Evento de prueba B', eventDate: '2026-08-22' },
      ],
    });

    const nonexistent = await resolveReference('unknown-exact-ref', 'COD999999', 'COD999999', [
      { ...giftPurchase(), orderId: 'ORD_internal_1', customerTransactionNumber: '111111' },
      { ...giftPurchase(), orderId: 'ORD_internal_2', customerTransactionNumber: '222222' },
    ]);
    expect(nonexistent.results[0]).toMatchObject({
      status: 'completed',
      referenceResolution: 'unavailable',
      needsSelection: true,
    });
    const nonexistentResult = nonexistent.results[0];
    if (!nonexistentResult || nonexistentResult.status !== 'completed' || nonexistentResult.kind !== 'purchase') {
      throw new Error('Expected a completed purchase result with unmatched-reference evidence.');
    }
    expect(nonexistentResult.purchases.map((purchase) => purchase.orderId)).toEqual([
      'ORD_internal_1', 'ORD_internal_2',
    ]);
  });

  it('retains authorized purchase and gift records when hints or amounts describe them instead of backend identity', async () => {
    // Contract revision (Work 1, 2026-09-22): descriptive event/amount
    // hints never narrow candidates, so the older record stays visible
    // alongside the current one instead of resolving to the pending order
    // alone. No pending auto-selection may erase an explicit older target.
    // Contract revision (Lane B count-driven selection): multiplicity is
    // factual metadata, so needsSelection stays false here; the reply
    // model resolves the reference from the retained records.
    const hintedPurchases = (
      currentId: string,
      currentCreatedAt: string,
      oldCreatedAt: string,
    ): PurchaseInformation[] => [
      {
        ...giftPurchase(),
        orderId: currentId,
        eventName: 'Samuel Josué',
        grandTotal: 80,
        paymentStatus: 'pending',
        createdAt: currentCreatedAt,
        currency: null,
        payment: null,
      },
      {
        ...giftPurchase(),
        orderId: 'ORD-old',
        eventName: 'Josué y Paola',
        grandTotal: 88.18,
        paymentStatus: 'approved',
        createdAt: oldCreatedAt,
        currency: null,
        payment: null,
      },
    ];
    const runHinted = async (
      requestId: string,
      query: string,
      eventHint: string,
      amount: number | null,
      purchases: PurchaseInformation[],
    ) => {
      const agentGateway = new FakeAgentGateway();
      agentGateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases };
      const orchestrator = new InformationOrchestrator({
        knowledgeGateway: { async search() { throw new Error('unused'); } },
        providerGateway: {} as ProviderGateway,
        agentGateway,
      });
      return orchestrator.execute({
        requests: [{
          requestId,
          kind: 'purchase',
          resource: 'orders',
          query,
          orderId: null,
          eventHint,
          ...(amount === null ? {} : { amount }),
          authAction: 'none',
        }],
        authentication: null,
        authBlock: null,
        trustedPhone: { phone_extension: '+51', phone_number: '981056171' },
      });
    };

    const currentHinted = await runHinted(
      'victor-current-payment',
      'Estado del regalo para Samuel Josué por S/ 80.',
      'Samuel Josué',
      80,
      hintedPurchases('ORD-current', '2026-08-29', '2025-04-16'),
    );
    const currentResult = currentHinted.results[0];
    if (!currentResult || currentResult.status !== 'completed' || currentResult.kind !== 'purchase') {
      throw new Error('Expected a completed purchase result.');
    }
    expect(currentResult.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['ORD-current', 'ORD-old'],
    );
    expect(currentResult.needsSelection).toBe(false);
    expect(currentResult.purchases.find(
      (purchase) => purchase.orderId === 'ORD-current',
    )).toMatchObject({
      eventName: 'Samuel Josué',
      grandTotal: 80,
      paymentStatus: 'pending',
    });

    const olderHinted = await runHinted(
      'explicit-older-target',
      'Estado del regalo para Josué y Paola.',
      'Josué y Paola',
      null,
      [
        {
          ...giftPurchase(),
          orderId: 'ORD-new',
          eventName: 'Samuel Josué',
          grandTotal: 80,
          paymentStatus: 'pending',
          payment: null,
        },
        {
          ...giftPurchase(),
          orderId: 'ORD-old',
          eventName: 'Josué y Paola',
          grandTotal: 88.18,
          paymentStatus: 'approved',
          payment: null,
        },
      ],
    );
    const olderResult = olderHinted.results[0];
    if (!olderResult || olderResult.status !== 'completed' || olderResult.kind !== 'purchase') {
      throw new Error('Expected a completed purchase result.');
    }
    expect(olderResult.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['ORD-new', 'ORD-old'],
    );
    expect(olderResult.needsSelection).toBe(false);

    // Gift records follow the same retention: a gift-naming hint, an
    // item amount, and a same-value hint across events all keep their
    // authorized records; erasing any of them as not_found is the
    // baseline defect this test pins.
    const mixedItems = (): PurchaseInformation['items'] => [
      { giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150, type: 'se_store' },
      { giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80, type: 'credit' },
    ];
    const runGiftHint = async (
      requestId: string,
      query: string,
      hints: { eventHint?: string; amount?: number },
      purchases: PurchaseInformation[],
    ) => {
      const agentGateway = new FakeAgentGateway();
      agentGateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases };
      const orchestrator = new InformationOrchestrator({
        knowledgeGateway: { async search() { throw new Error('unused'); } },
        providerGateway: {} as ProviderGateway,
        agentGateway,
      });
      return orchestrator.execute({
        requests: [{
          requestId,
          kind: 'purchase',
          resource: 'gift_purchases',
          query,
          orderId: null,
          ...hints,
          authAction: 'none',
        }],
        authentication: null,
        authBlock: null,
        trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
      });
    };
    const completedPurchases = (
      execution: Awaited<ReturnType<InformationOrchestrator['execute']>>,
    ): PurchaseInformation[] => {
      const result = execution.results[0];
      if (!result || result.status !== 'completed' || result.kind !== 'purchase') {
        throw new Error('Expected a completed purchase result.');
      }
      return result.purchases;
    };

    const honeymoon = await runGiftHint(
      'honeymoon-hint',
      '¿Dónde está mi aporte de luna de miel?',
      { eventHint: 'luna de miel' },
      [{
        ...giftPurchase(),
        orderId: 'GIFT-HONEY-1',
        eventName: 'Boda Lucía y Marco',
        grandTotal: 230,
        paymentStatus: 'pending',
        payment: null,
        items: mixedItems(),
      }],
    );
    expect(honeymoon.results[0]).toMatchObject({ status: 'completed' });
    const honeymoonPurchases = completedPurchases(honeymoon);
    expect(honeymoonPurchases).toHaveLength(1);
    expect(honeymoonPurchases[0]).toMatchObject({
      orderId: 'GIFT-HONEY-1',
      eventName: 'Boda Lucía y Marco',
      paymentStatus: 'pending',
    });
    expect(honeymoonPurchases[0]?.items.map((item) => item.giftName)).toEqual([
      'Juego de sábanas',
      'Aporte luna de miel',
    ]);

    const mixed = await runGiftHint(
      'mixed-amount',
      '¿Qué pasó con mi aporte de 80?',
      { amount: 80 },
      [{
        ...giftPurchase(),
        orderId: 'GIFT-MIX-9',
        eventName: 'Boda Lucía y Marco',
        grandTotal: 230,
        paymentStatus: 'approved',
        payment: null,
        items: mixedItems(),
      }],
    );
    expect(mixed.results[0]).toMatchObject({ status: 'completed' });
    const mixedPurchases = completedPurchases(mixed);
    expect(mixedPurchases).toHaveLength(1);
    expect(mixedPurchases[0]?.items.map((item) => item.amount)).toEqual([150, 80]);

    const equalValue = await runGiftHint(
      'equal-value-hint',
      'Estado del regalo de 80 para Boda Lucía y Marco.',
      { eventHint: 'Boda Lucía y Marco', amount: 80 },
      [
        { ...giftPurchase(), orderId: 'GIFT-EQ-1', eventName: 'Boda Lucía y Marco', grandTotal: 80, payment: null },
        { ...giftPurchase(), orderId: 'GIFT-EQ-2', eventName: 'Fiesta Ana', grandTotal: 80, payment: null },
      ],
    );
    const equalResult = equalValue.results[0];
    if (!equalResult || equalResult.status !== 'completed' || equalResult.kind !== 'purchase') {
      throw new Error('Expected a completed purchase result.');
    }
    expect(equalResult.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['GIFT-EQ-1', 'GIFT-EQ-2'],
    );
    expect(equalResult.needsSelection).toBe(false);
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
    // Contract revision (Work 1, 2026-09-22): the hint still must not
    // narrow, so both partitions stay visible; only the legacy
    // compatibility list stays excluded.
    // Contract revision (Lane B count-driven selection): multiplicity is
    // factual metadata, so needsSelection stays false here.
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
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });

    const partitionResult = execution.results[0];
    if (!partitionResult || partitionResult.status !== 'completed' || partitionResult.kind !== 'purchase') {
      throw new Error('Expected a completed purchase result.');
    }
    expect(partitionResult.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['ORD-completed-old', 'ORD-pending-current'],
    );
    expect(partitionResult.needsSelection).toBe(false);
    expect(partitionResult.purchases.find(
      (purchase) => purchase.orderId === 'ORD-pending-current',
    )).toMatchObject({ eventName: 'Isa y Lu' });
    expect(execution.results[0]).not.toMatchObject({ purchases: [
      expect.objectContaining({ orderId: 'ORD-legacy-old' }),
    ] });
  });

  it('resolves enriched event detail with public fallback and keeps phone RSVP evidence', async () => {
    const trustedPhone = { phone_extension: '+51', phone_number: '987654321' };
    const fallbackGateway = new FakeAgentGateway();
    fallbackGateway.guestEventsResult = {
      status: 'success',
      events: [guestEvent(88, 'Boda Laura & Marcos')],
    };
    fallbackGateway.enrichedEventDetailResult = {
      status: 'failed',
      retryable: true,
      error: 'HTTP 500',
    } as typeof fallbackGateway.enrichedEventDetailResult;
    fallbackGateway.publicEventDetailResult = {
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
    const fallbackOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: fallbackGateway,
    });

    const fallback = await fallbackOrchestrator.execute({
      requests: [{
        requestId: 'event-enriched-500',
        kind: 'associated_event',
        query: '¿Dónde es el evento?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone,
    });

    expect(fallbackGateway.eventDetailCalls).toBe(2);
    expect(fallbackGateway.eventDetailInputs).toEqual([
      { eventId: 88, phone: { phone_extension: '+51', phone_number: '987654321' } },
      { eventId: 88 },
    ]);
    expect(fallback.results[0]).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_guest',
      result: { events: [{ eventId: 88, detail: { withTime: true } }] },
    });

    const attendanceGateway = new FakeAgentGateway();
    attendanceGateway.guestEventsResult = {
      status: 'success',
      events: [guestEvent(88, 'Boda Laura & Marcos')],
    };
    attendanceGateway.enrichedEventDetailResult = {
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
    } as typeof attendanceGateway.enrichedEventDetailResult;
    const attendanceOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: attendanceGateway,
    });

    const attendance = await attendanceOrchestrator.execute({
      requests: [{
        requestId: 'event-attendance-1',
        kind: 'associated_event',
        query: '¿Estoy confirmado?',
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone,
    });
    expect(attendance.results[0]).toMatchObject({
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
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(agentGateway.eventDetailCalls).toBe(1);
    // One source contract: the gift resource reads the gift route while
    // the event-scoped purchase still merges from the shared root.
    expect(agentGateway.guestGiftCalls).toBe(1);
    expect(agentGateway.guestOrdersCalls).toBe(0);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      result: { events: [{ orders: [], orderIds: ['ORD-000880'] }], counts: { recentOrders: 1 } },
    });
    expect(execution.results[1]).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_event_purchase',
      coverage: 'complete',
      purchases: [{ orderId: 'ORD-000880', paymentStatus: 'approved' }],
    });
  });

  it('marks equally authoritative status disagreement as an explicit conflict without confident status', async () => {
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
          authAction: 'none',
        },
        {
          requestId: 'gift-detail-conflict',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Detalle del regalo',
          orderId: 'ORD-000880',
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    expect(execution.results).toHaveLength(2);
    expect(execution.results[0]).toMatchObject({
      status: 'completed',
      coverage: 'inconsistent',
      purchases: [{ recordSource: 'orders', paymentStatus: 'pending' }],
    });
    expect(execution.results[1]).toMatchObject({
      status: 'completed',
      coverage: 'inconsistent',
      purchases: [{ recordSource: 'gift_purchases', paymentStatus: 'approved' }],
    });
  });

  it('P1 dedupes repeated scoped lookups within a turn but not across access scopes', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.ordersResult = {
      status: 'success',
      resource: 'orders',
      // P1 fixture: two purchases so the single-order auto-detail follow-up
      // does not trigger; the repeated identical list lookups dedupe to one
      // gateway call per turn.
      purchases: [{
        orderId: 'ORD-1',
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: 100,
        paymentMethod: 'transfer',
        eventName: 'Boda',
        eventDate: null,
        eventUrl: null,
        createdAt: null,
        items: [],
      }, {
        orderId: 'ORD-2',
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: 50,
        paymentMethod: 'transfer',
        eventName: 'Boda Dos',
        eventDate: null,
        eventUrl: null,
        createdAt: null,
        items: [],
      }],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
    const requestFor = (requestId: string): PendingInformationRequest => ({
      requestId,
      kind: 'purchase',
      resource: 'orders',
      query: 'estado',
      orderId: null,
      authAction: 'none',
    });
    const execution = await orchestrator.execute({
      requests: [requestFor('a-1'), requestFor('a-2')],
      authentication: { token: 'jwt-same-scope', email: 'user@example.com' },
      authBlock: null,
    });
    expect(execution.results).toHaveLength(2);
    expect(agentGateway.ordersCalls).toBe(1);

    const scopeGateway = new FakeAgentGateway();
    scopeGateway.guestEventsResult = {
      status: 'success',
      events: [guestEvent(5, 'Fiesta Sol'), guestEvent(6, 'Fiesta Luna')],
    };
    scopeGateway.enrichedEventDetailResult = {
      status: 'success',
      event: {
        eventId: 5,
        name: 'Fiesta Sol',
        slug: 'event-5',
        url: null,
        datetime: null,
        type: null,
        typeDetail: null,
        stage: null,
        city: 'Cusco',
        country: 'Perú',
        currency: null,
        withTime: false,
        timezone: null,
        celebrateds: [],
        moments: [],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
        attendance: null,
        purchases: [],
      },
    };
    // P1 fixture: the public re-fetch under a different access scope must
    // also succeed so the scope-separated second read proves a fresh gateway
    // call instead of reusing broader cached access.
    scopeGateway.publicEventDetailResult = scopeGateway.enrichedEventDetailResult;
    const scopeOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: scopeGateway,
    });
    const first = await scopeOrchestrator.enrichCustomerLinkedDetail({
      orderIds: [],
      eventIds: [5],
      authentication: null,
      trustedPhone: { phone_extension: '+51', phone_number: '900000001' },
      scope: 'trusted_phone_guest:+51900000001',
    });
    expect(first.eventDetails.size).toBe(1);
    const callsAfterFirst = scopeGateway.eventDetailCalls;
    const second = await scopeOrchestrator.enrichCustomerLinkedDetail({
      orderIds: [],
      eventIds: [5],
      authentication: null,
      trustedPhone: null,
      scope: 'public',
    });
    expect(second.eventDetails.size).toBe(1);
    expect(scopeGateway.eventDetailCalls).toBe(callsAfterFirst + 1);
  });

  it('seeds the full guest root once and reuses it with honest coverage on purchase-only turns', async () => {
    // A purchase-only turn shares the single phone-authorized guest-event
    // root: one guest-events flight, bounded hydration (details plus
    // event-scoped order A) merged once, and the applicable authorized
    // purchase root still acquired (orders A+B, never every endpoint).
    // Both sources merge by stable order ID: A enriches missing fields
    // from either side, B survives once, source conflicts stay explicit.
    // Five candidates exceed the concurrency bound, not the total-work
    // bound. Every authorized ID is visited and ready facts remain usable.
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = {
      status: 'success',
      events: [
        guestEvent(81, 'Boda Ana y Luis'),
        guestEvent(82, 'Boda María y José'),
        guestEvent(83, 'Boda Laura y Marcos'),
        guestEvent(84, 'Boda Diana y Fernando'),
        guestEvent(85, 'Boda Sol y Luna'),
      ],
    };
    const hydratedA = {
      ...giftPurchase(),
      orderId: 'ORD-000880',
      eventId: 81,
      eventName: 'Boda Ana y Luis',
    };
    agentGateway.enrichedEventDetailResult = {
      status: 'success',
      event: {
        eventId: 81,
        name: 'Boda Ana y Luis',
        slug: 'event-81',
        url: null,
        datetime: '2026-09-20T18:00:00',
        type: null,
        typeDetail: null,
        stage: null,
        city: 'Lima',
        country: 'Perú',
        currency: null,
        withTime: true,
        timezone: null,
        celebrateds: [],
        moments: [],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
        attendance: {
          guestId: 501,
          name: 'Ana',
          hasResponded: true,
          willAttend: true,
          responseDate: '2026-09-01',
        },
        purchases: [hydratedA],
      },
    };
    // Purchase root: sparse A (missing fields enriched from hydration)
    // plus B. Same stable IDs merge; each survives exactly once.
    const sparseA = {
      ...giftPurchase(),
      orderId: 'ORD-000880',
      eventId: 81,
      eventName: null,
      eventDate: null,
      grandTotal: null,
      paymentMethod: null,
    };
    const orderB = {
      ...giftPurchase(),
      orderId: 'ORD-000881',
      eventId: 82,
      eventName: 'Boda María y José',
      grandTotal: 150,
    };
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [sparseA, orderB],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });

    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'purchase-root-only',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado de mi compra?',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    // Shared reads once: one guest-events flight, bounded detail reads,
    // one applicable purchase root (orders). The gift-detail endpoint is
    // never read for a summary question.
    expect(agentGateway.guestEventCalls).toBe(1);
    expect(agentGateway.eventDetailCalls).toBe(5);
    expect(agentGateway.eventDetailInputs.map((input) => input.eventId).sort()).toEqual([
      81, 82, 83, 84, 85,
    ]);
    expect(agentGateway.guestOrdersCalls).toBe(1);
    expect(agentGateway.guestGiftCalls).toBe(0);
    const result = execution.results[0];
    expect(result).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_event_purchase',
      coverage: 'complete',
    });
    if (result.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('Expected a completed purchase result.');
    }
    // Same ID from different authorized sources stays as two sourced facts;
    // the complete records are not collapsed into one preferred-looking row.
    const sameOrder = result.purchases.filter((purchase) => purchase.orderId === 'ORD-000880');
    expect(result.purchases.map((purchase) => purchase.orderId).sort()).toEqual([
      'ORD-000880', 'ORD-000880', 'ORD-000881',
    ]);
    expect(sameOrder.map((purchase) => purchase.recordSource).sort()).toEqual([
      'event_detail', 'orders',
    ]);
    expect(sameOrder.find((purchase) => purchase.recordSource === 'event_detail')?.eventName)
      .toBe('Boda Ana y Luis');
    expect(sameOrder.find((purchase) => purchase.recordSource === 'orders')?.eventName)
      .toBeNull();
    // Associations/details travel through the existing purchase result:
    // event identity, venue and attendance without a second request.
    expect(result.linkedEvents).toBeDefined();
    const linked81 = result.linkedEvents?.events.find((event) => event.eventId === 81);
    expect(linked81?.name).toBe('Boda Ana y Luis');
    expect(linked81?.place).toBe('Lima');
    expect(linked81?.detail?.city).toBe('Lima');
    expect(linked81?.guestStatus?.willAttend).toBe(true);
    // The concurrency bound visits the full queue; it is not a total-work
    // cutoff that marks the fifth candidate truncated.
    expect(result.linkedEventsTruncated ?? false).toBe(false);
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

function purchaseRequest(requestId: string): PendingInformationRequest {
  return {
    requestId,
    kind: 'purchase',
    resource: 'gift_purchases',
    query: 'Detalles del pago',
    orderId: 'ORD-000880',
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

describe('B receipt discovery fan-out across authorized sources', () => {
  function discoveryOrder(): PurchaseInformation {
    return {
      orderId: 'ORD-DISC-1',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 340.44,
      paymentMethod: 'transfer',
      currency: 'PEN',
      eventName: 'Evento Sintetico',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-10 10:00:00',
      items: [],
    };
  }

  function discoveryGift(): PurchaseInformation {
    return {
      orderId: 'GIFT-DISC-7',
      paymentStatus: 'approved',
      shippingStatus: null,
      grandTotal: 340.44,
      paymentMethod: 'transfer',
      currency: 'PEN',
      eventName: 'Otro Evento Sintetico',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-09 10:00:00',
      items: [],
    };
  }

  function discoveryOrchestrator(agentGateway: FakeAgentGateway): InformationOrchestrator {
    return new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
  }

  const TRUSTED_PHONE = { phone_extension: '+51', phone_number: '987654321' };

  it('fans receipt discovery out across declared sources with honest partial coverage', async () => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      orderPartitions: { pending: [discoveryOrder()], completed: [] },
      purchases: [discoveryOrder()],
    };
    agentGateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      orderPartitions: { pending: [], completed: [discoveryGift()] },
      purchases: [discoveryGift()],
    };
    const execution = await discoveryOrchestrator(agentGateway).execute({
      requests: [
        {
          requestId: 'receipt-orders',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pago del comprobante.',
          orderId: null,
          authAction: 'none',
        },
        {
          requestId: 'receipt-gift',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Estado del pago del comprobante.',
          orderId: null,
          authAction: 'none',
        },
        {
          requestId: 'receipt-orders-duplicate',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pago del comprobante.',
          orderId: null,
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: TRUSTED_PHONE,
    });

    // Independent authorized roots run through the shared per-turn scoped
    // map: each request reads its own declared resource, and the repeated
    // orders scope reads once.
    expect(agentGateway.guestOrdersCalls).toBe(1);
    expect(agentGateway.guestGiftCalls).toBe(1);
    expect(agentGateway.guestGiftOrderIds).toEqual([null]);
    expect(execution.results).toHaveLength(3);
    const byId = new Map(execution.results.map((result) => [result.requestId, result]));
    expect(byId.get('receipt-orders')).toMatchObject({
      status: 'completed',
      lookupResource: 'orders',
      coverage: 'complete',
    });
    expect(byId.get('receipt-gift')).toMatchObject({
      status: 'completed',
      lookupResource: 'gift_purchases',
      coverage: 'complete',
    });
    const ordersPurchases = byId.get('receipt-orders');
    const giftPurchases = byId.get('receipt-gift');
    if (
      ordersPurchases?.status === 'completed' && ordersPurchases.kind === 'purchase' &&
      giftPurchases?.status === 'completed' && giftPurchases.kind === 'purchase'
    ) {
      // Stable identities: each source keeps its own canonical record with
      // visible amount, status, currency and event.
      expect(ordersPurchases.purchases.map((purchase) => purchase.orderId)).toEqual(['ORD-DISC-1']);
      expect(giftPurchases.purchases.map((purchase) => purchase.orderId)).toEqual(['GIFT-DISC-7']);
      for (const purchase of [...ordersPurchases.purchases, ...giftPurchases.purchases]) {
        expect(purchase.grandTotal).toBeGreaterThan(0);
        expect(purchase.currency).toBeTruthy();
        expect(purchase.eventName).toBeTruthy();
      }
    } else {
      throw new Error('expected both discovery reads to complete');
    }
    // No mutations ride a read-only discovery turn.
    expect(JSON.stringify(execution.results)).not.toContain('human_help_receipt');

    const failedGiftGateway = new FakeAgentGateway();
    failedGiftGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      orderPartitions: { pending: [discoveryOrder()], completed: [] },
      purchases: [discoveryOrder()],
    };
    failedGiftGateway.guestGiftResult = {
      status: 'failed',
      resource: 'gift_purchases',
      retryable: false,
      failureKind: 'request_failed',
      error: 'gift route down',
    };
    const failedGift = await discoveryOrchestrator(failedGiftGateway).execute({
      requests: [
        {
          requestId: 'receipt-orders',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pago del comprobante.',
          orderId: null,
          authAction: 'none',
        },
        {
          requestId: 'receipt-gift',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Estado del pago del comprobante.',
          orderId: null,
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: TRUSTED_PHONE,
    });

    expect(failedGiftGateway.guestOrdersCalls).toBe(1);
    expect(failedGiftGateway.guestGiftCalls).toBe(1);
    const failedById = new Map(failedGift.results.map((result) => [result.requestId, result]));
    const failedOrdersResult = failedById.get('receipt-orders');
    const failedGiftResult = failedById.get('receipt-gift');
    // The failed optional source neither discards ready facts nor reports
    // complete coverage for a scope it could not read.
    expect(failedOrdersResult).toMatchObject({ status: 'completed', lookupResource: 'orders' });
    if (failedOrdersResult?.status === 'completed' && failedOrdersResult.kind === 'purchase') {
      expect(failedOrdersResult.purchases.map((purchase) => purchase.orderId)).toEqual(['ORD-DISC-1']);
    } else {
      throw new Error('expected the orders read to stay completed');
    }
    expect(failedGiftResult).toMatchObject({ status: 'failed' });
    const completedGift = failedGift.results.filter(
      (result) => result.kind === 'purchase' && result.status === 'completed' &&
        (result.lookupResource ?? result.resource) === 'gift_purchases',
    );
    expect(completedGift).toHaveLength(0);

    const giftOnlyGateway = new FakeAgentGateway();
    giftOnlyGateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      orderPartitions: { pending: [], completed: [discoveryGift()] },
      purchases: [discoveryGift()],
    };
    const giftOnly = await discoveryOrchestrator(giftOnlyGateway).execute({
      requests: [{
        requestId: 'summary-gift-resource',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: 'Estado del pago.',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: TRUSTED_PHONE,
    });

    // One source contract: aspects select answer facts, never the route.
    expect(giftOnlyGateway.guestOrdersCalls).toBe(0);
    expect(giftOnlyGateway.guestGiftCalls).toBe(1);
    expect(giftOnly.results[0]).toMatchObject({
      status: 'completed',
      lookupResource: 'gift_purchases',
    });
  });

  it('overlaps independent purchase roots while the shared seed resolves', async () => {
    const agentGateway = new FakeAgentGateway();
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseOrders!: () => void;
    let releaseGifts!: () => void;
    const ordersGate = new Promise<void>((resolve) => { releaseOrders = resolve; });
    const giftsGate = new Promise<void>((resolve) => { releaseGifts = resolve; });
    const ordersResult: AgentPhonePurchaseLookupResult = {
      status: 'success',
      resource: 'orders',
      purchases: [{
        orderId: 'ORD-OVERLAP',
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: 100,
        paymentMethod: 'Transferencia',
        eventName: 'Evento Traslape',
        eventDate: null,
        eventUrl: null,
        createdAt: '2026-09-10 10:00:00',
        items: [],
      }],
    };
    const giftResult: AgentPhonePurchaseLookupResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [{
        orderId: 'GIFT-OVERLAP',
        paymentStatus: 'approved',
        shippingStatus: null,
        grandTotal: 100,
        paymentMethod: 'Transferencia',
        eventName: 'Evento Traslape',
        eventDate: null,
        eventUrl: null,
        createdAt: '2026-09-10 10:00:00',
        items: [],
      }],
    };
    agentGateway.getGuestOrdersByPhone = (async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await ordersGate;
        return ordersResult;
      } finally {
        inFlight -= 1;
      }
    }) as typeof agentGateway.getGuestOrdersByPhone;
    agentGateway.getGuestGiftPurchasesByPhone = (async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await giftsGate;
        return giftResult;
      } finally {
        inFlight -= 1;
      }
    }) as typeof agentGateway.getGuestGiftPurchasesByPhone;
    const executionPromise = discoveryOrchestrator(agentGateway).execute({
      requests: [
        {
          requestId: 'overlap-orders',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pedido.',
          orderId: null,
          authAction: 'none',
        },
        {
          requestId: 'overlap-gifts',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Estado del regalo.',
          orderId: null,
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: TRUSTED_PHONE,
    });
    for (let waited = 0; waited < 100 && inFlight < 2; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // Both independent roots are in flight together: one sequential
    // discovery stage, not two chained reads.
    expect(inFlight).toBe(2);
    releaseOrders();
    releaseGifts();
    const execution = await executionPromise;
    expect(maxInFlight).toBe(2);
    expect(execution.results.map((result) => result.status)).toEqual(['completed', 'completed']);
  });

});

describe('A one purchase source contract across access paths', () => {
  const MATRIX = [
    { path: 'phone', resource: 'orders', amount: 150 },
    { path: 'phone', resource: 'gift_purchases', amount: 80 },
    { path: 'authenticated', resource: 'orders', amount: 150 },
    { path: 'authenticated', resource: 'gift_purchases', amount: 80 },
  ] as const;

  function matrixOrchestrator(agentGateway: FakeAgentGateway): InformationOrchestrator {
    return new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
  }

  function matrixRecord(
    resource: 'orders' | 'gift_purchases',
    amount: number | null,
  ): PurchaseInformation {
    return {
      orderId: resource === 'orders' ? 'ORD-MX-1' : 'GIFT-MX-1',
      paymentStatus: 'approved',
      shippingStatus: null,
      grandTotal: amount ?? 100,
      paymentMethod: 'Transferencia',
      eventName: 'Evento Matriz',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-10 10:00:00',
      items: [],
    };
  }

  it.each(MATRIX)(
    '$path path reads the $resource source without field selectors',
    async (entry) => {
      const agentGateway = new FakeAgentGateway();
      const request = {
        requestId: 'matrix-1',
        kind: 'purchase',
        resource: entry.resource,
        query: 'Consulta de matriz.',
        orderId: null,
        ...(entry.amount !== null ? { amount: entry.amount } : {}),
        authAction: 'none',
      } as const;
      if (entry.path === 'phone') {
        agentGateway.guestOrdersResult = {
          status: 'success', resource: 'orders', purchases: [matrixRecord('orders', entry.amount)],
        };
        agentGateway.guestGiftResult = {
          status: 'success', resource: 'gift_purchases', purchases: [matrixRecord('gift_purchases', entry.amount)],
        };
        const execution = await matrixOrchestrator(agentGateway).execute({
          requests: [{ ...request }],
          authentication: null,
          authBlock: null,
          trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
        });
        expect(agentGateway.guestOrdersCalls).toBe(entry.resource === 'orders' ? 1 : 0);
        expect(agentGateway.guestGiftCalls).toBe(entry.resource === 'gift_purchases' ? 1 : 0);
        expect(execution.results[0]).toMatchObject({
          status: 'completed',
          resource: entry.resource,
          lookupResource: entry.resource,
        });
      } else {
        agentGateway.ordersResult = {
          status: 'success', resource: 'orders', purchases: [matrixRecord('orders', entry.amount)],
        };
        agentGateway.giftResult = {
          status: 'success', resource: 'gift_purchases', purchases: [matrixRecord('gift_purchases', entry.amount)],
        };
        const execution = await matrixOrchestrator(agentGateway).execute({
          requests: [{ ...request }],
          authentication: { token: 'matrix-token', email: 'matrix@example.com' },
          authBlock: null,
        });
        // Same requested source as the phone path; distinct permissioned
        // endpoints (token reads, never phone reads) enforce the access scope.
        expect(agentGateway.ordersCalls).toBe(entry.resource === 'orders' ? 1 : 0);
        expect(agentGateway.giftCalls).toBe(entry.resource === 'gift_purchases' ? 1 : 0);
        expect(agentGateway.guestOrdersCalls).toBe(0);
        expect(agentGateway.guestGiftCalls).toBe(0);
        expect(execution.results[0]).toMatchObject({
          status: 'completed',
          resource: entry.resource,
          lookupResource: entry.resource,
        });
      }
    },
  );
});

describe('source discovery purchase_discovery contract', () => {
  const DISCOVERY_PHONE = { phone_extension: '+51', phone_number: '987654321' };

  function discoveryOrchestrator(
    agentGateway: FakeAgentGateway,
    capabilityManifest?: ConstructorParameters<typeof InformationOrchestrator>[0]['capabilityManifest'],
  ): InformationOrchestrator {
    return new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway,
      ...(capabilityManifest ? { capabilityManifest } : {}),
    });
  }

  function ordersShippingRecord(): PurchaseInformation {
    return {
      orderId: 'ORD-SHIP-1',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 150,
      paymentMethod: 'Transferencia',
      currency: 'PEN',
      eventName: 'Matrimonio Lucia',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-10 10:00:00',
      items: [{ giftName: 'Torta', quantity: 1, amount: 150, rowTotal: 150, type: 'se_store' }],
    };
  }

  function giftShippingRecord(): PurchaseInformation {
    return {
      orderId: 'GIFT-SHIP-7',
      paymentStatus: 'approved',
      shippingStatus: null,
      grandTotal: 80,
      paymentMethod: 'Transferencia',
      currency: 'PEN',
      eventName: 'Baby Shower Catalina',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-09 10:00:00',
      items: [{ giftName: 'Aporte', quantity: 1, amount: 80, rowTotal: 80, type: 'credit' }],
    };
  }

  function mixedGateways(): FakeAgentGateway {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [ordersShippingRecord()],
    };
    agentGateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [giftShippingRecord()],
    };
    agentGateway.ordersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [ordersShippingRecord()],
    };
    agentGateway.giftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [giftShippingRecord()],
    };
    return agentGateway;
  }

  function discoveryRequest(
    query: string,
  ): Extract<PendingInformationRequest, { kind: 'purchase' }> {
    return {
      requestId: 'discovery-1',
      kind: 'purchase',
      resource: 'purchase_discovery',
      query,
      orderId: null,
      authAction: 'none',
    };
  }

  // Row 1: mixed gift shipping with unresolved backend source (phone and
  // authenticated paths read both authorized roots once each).
  it('reads both authorized roots once each and merges 150/80 facts on both paths', async () => {
    const agentGateway = mixedGateways();
    const execution = await discoveryOrchestrator(agentGateway).execute({
      requests: [discoveryRequest('¿Cuándo llega mi regalo? ¿Y el otro?')],
      authentication: null,
      authBlock: null,
      trustedPhone: DISCOVERY_PHONE,
    });

    expect(agentGateway.guestOrdersCalls).toBe(1);
    expect(agentGateway.guestGiftCalls).toBe(1);
    expect(execution.results).toHaveLength(1);
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected the discovery read to complete');
    }
    expect(result.resource).toBe('purchase_discovery');
    expect(result.coverage).toBe('complete');
    expect(result.sourceCoverage).toEqual([
      { source: 'orders', childId: 'discovery-1:orders', status: 'completed', count: 1 },
      { source: 'gift_purchases', childId: 'discovery-1:gift_purchases', status: 'completed', count: 1 },
    ]);
    const orderIds = result.purchases.map((purchase) => purchase.orderId).sort();
    expect(orderIds).toEqual(['GIFT-SHIP-7', 'ORD-SHIP-1']);
    const totals = result.purchases
      .flatMap((purchase) => purchase.items.map((item) => item.amount ?? null))
      .sort((left, right) => (left ?? 0) - (right ?? 0));
    expect(totals).toEqual([80, 150]);
    // Both facts reach the typed summary evidence: no account-wide absence
    // claim is possible when both authorized roots were read.
    // Contract revision (Lane C F1): the discovery summary names no
    // single source; per-source facts travel in sourceCoverage.
    expect(execution.summaries[0]).toMatchObject({ coverage: 'complete' });
    expect(execution.summaries[0]).not.toHaveProperty('resource');
    // Read-only discovery never mutates.
    expect(JSON.stringify(execution.results)).not.toContain('human_help_receipt');

    const tokenGateway = mixedGateways();
    const tokenExecution = await discoveryOrchestrator(tokenGateway).execute({
      requests: [discoveryRequest('¿Cuándo llega mi regalo?')],
      authentication: { token: 'discovery-token', email: 'discovery@example.com' },
      authBlock: null,
    });

    expect(tokenGateway.ordersCalls).toBe(1);
    expect(tokenGateway.giftCalls).toBe(1);
    expect(tokenGateway.guestOrdersCalls).toBe(0);
    expect(tokenGateway.guestGiftCalls).toBe(0);
    const tokenResult = tokenExecution.results[0];
    if (tokenResult?.status !== 'completed' || tokenResult.kind !== 'purchase') {
      throw new Error('expected the authenticated discovery read to complete');
    }
    expect(tokenResult.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['GIFT-SHIP-7', 'ORD-SHIP-1'],
    );
  });

  // Existing task reads use their declared source; profile preparation is
  // independently proven to load all authorized roots before extraction.
  it.each([
    { resource: 'orders' as const, hidden: 'GIFT-SHIP-7' },
    { resource: 'gift_purchases' as const, hidden: 'ORD-SHIP-1' },
  ])(
    'known $resource task reads its source once and never surfaces the other source',
    async ({ resource, hidden }) => {
    const agentGateway = mixedGateways();
    const execution = await discoveryOrchestrator(agentGateway).execute({
      requests: [{
        requestId: 'known-1',
        kind: 'purchase',
        resource,
        query: 'Consulta de fuente conocida.',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: DISCOVERY_PHONE,
    });

    expect(agentGateway.guestOrdersCalls).toBe(resource === 'orders' ? 1 : 0);
    expect(agentGateway.guestGiftCalls).toBe(resource === 'gift_purchases' ? 1 : 0);
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected the known-source read to complete');
    }
    expect(result.lookupResource).toBe(resource);
    expect(result.sourceCoverage ?? []).toEqual([]);
    expect(result.purchases.map((purchase) => purchase.orderId)).not.toContain(hidden);
  });

  // Row 3: one discovery source unauthorized stays uncalled with partial coverage.
  it('keeps accessible facts when one discovery source is unauthorized', async () => {
    const agentGateway = mixedGateways();
    const manifest = buildRuntimeCapabilityManifest({
      disabledOperations: ['purchase.gift_detail.read'],
    });
    const execution = await discoveryOrchestrator(agentGateway, manifest).execute({
      requests: [discoveryRequest('¿Cuándo llega mi regalo?')],
      authentication: null,
      authBlock: null,
      trustedPhone: DISCOVERY_PHONE,
    });

    expect(agentGateway.guestGiftCalls).toBe(0);
    expect(agentGateway.guestOrdersCalls).toBe(1);
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected partial discovery to complete');
    }
    expect(result.coverage).toBe('partial');
    expect(result.purchases.map((purchase) => purchase.orderId)).toEqual(['ORD-SHIP-1']);
    const giftCoverage = result.sourceCoverage?.find((entry) => entry.source === 'gift_purchases');
    expect(giftCoverage?.childId).toBe('discovery-1:gift_purchases');
    expect(giftCoverage?.count).toBe(0);
    expect(['unauthorized', 'unavailable']).toContain(giftCoverage?.status);
  });

  // Row 4 (orchestrator part): an explicit event hint never filters authorized records.
  // Row 5: same amounts across events stay visible alternatives, never amount-filtered.
  // Contract revision (Lane B count-driven selection): visibility without
  // amount-only inference carries no selection flag; the alternatives stay
  // distinguishable from the retained evidence.
  it('retains both discovery records when only a hint or an amount is known', async () => {
    const hintedGateway = mixedGateways();
    const hinted = await discoveryOrchestrator(hintedGateway).execute({
      requests: [{
        ...discoveryRequest('Consulta por Aniversario Lucia. ¿Sigue pendiente?'),
        eventHint: 'Aniversario Lucia',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: DISCOVERY_PHONE,
    });

    const hintedResult = hinted.results[0];
    if (hintedResult?.status !== 'completed' || hintedResult.kind !== 'purchase') {
      throw new Error('expected the hinted discovery read to complete');
    }
    expect(hintedResult.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['GIFT-SHIP-7', 'ORD-SHIP-1'],
    );

    const amountGateway = new FakeAgentGateway();
    const first: PurchaseInformation = {
      ...ordersShippingRecord(),
      orderId: 'ORD-AMT-1',
      eventName: 'Boda Lucia',
      grandTotal: 150,
      items: [],
    };
    const second: PurchaseInformation = {
      ...giftShippingRecord(),
      orderId: 'GIFT-AMT-2',
      eventName: 'Aniversario Lucia',
      grandTotal: 150,
      items: [],
    };
    amountGateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases: [first] };
    amountGateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [second] };
    const amountHinted = await discoveryOrchestrator(amountGateway).execute({
      requests: [{
        ...discoveryRequest('¿Cuánto fue?'),
        amount: 150,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: DISCOVERY_PHONE,
    });

    const amountResult = amountHinted.results[0];
    if (amountResult?.status !== 'completed' || amountResult.kind !== 'purchase') {
      throw new Error('expected the amount-hinted discovery read to complete');
    }
    expect(amountResult.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['GIFT-AMT-2', 'ORD-AMT-1'],
    );
    expect(amountResult.needsSelection).toBe(false);
  });

  // Row 6: an exact unmatched reference is preserved, never silently retargeted.
  it('preserves an unmatched exact reference separately from multiplicity', async () => {
    const agentGateway = mixedGateways();
    const execution = await discoveryOrchestrator(agentGateway).execute({
      requests: [{
        ...discoveryRequest('Estado del pedido COD999999.'),
        orderId: 'COD999999',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: DISCOVERY_PHONE,
    });

    expect(agentGateway.guestOrdersCalls).toBe(1);
    expect(agentGateway.guestGiftCalls).toBe(1);
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected the unmatched reference to retain scope');
    }
    // Both authorized records stay visible (no silent narrowing to one
    // source), while the mismatch itself is preserved as explicit evidence.
    expect(result.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['GIFT-SHIP-7', 'ORD-SHIP-1'],
    );
    expect(result.referenceResolution).toBe('unavailable');
    expect(result.requestedCustomerTransactionNumber).toBe('999999');
    expect(result.needsSelection).toBe(true);
  });

  it.each([
    { eventId: 90, name: 'Boda Ana y Luis', slug: 'boda-ana-luis', datetime: '2026-09-20T18:00:00.000Z', query: '¿Cuándo es la Boda Ana y Luis?' },
    { eventId: 91, name: 'Boda Laura & Marcos', slug: 'boda-laura-marcos', datetime: '15/09/2026 18:00', query: '¿Cuándo es la Boda Laura?' },
  ])('emits no local-time duplicate for guest event datetimes ($name)', async ({ eventId, name, slug, datetime, query }) => {
    const agentGateway = new FakeAgentGateway();
    agentGateway.guestEventsResult = {
      status: 'success',
      events: [{
        eventId,
        name,
        slug,
        url: null,
        datetime,
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
        requestId: `event-time-${eventId}`,
        kind: 'associated_event',
        query,
        eventHint: null,
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '973296571' },
    });

    const events = execution.results[0]?.status === 'completed' &&
        execution.results[0].kind === 'associated_event'
      ? execution.results[0].result.events
      : [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventId, datetime });
    expect('local_time' in (events[0] ?? {})).toBe(false);
  });

  // Guard: unrelated turns never trigger a both-source read.
  it('reads no purchase root for an unrelated FAQ turn', async () => {
    const agentGateway = mixedGateways();
    const execution = await discoveryOrchestrator(agentGateway).execute({
      requests: [{ requestId: 'faq-1', kind: 'faq', query: '¿A qué hora abre?' }],
      authentication: null,
      authBlock: null,
      trustedPhone: DISCOVERY_PHONE,
    });

    expect(agentGateway.guestOrdersCalls).toBe(0);
    expect(agentGateway.guestGiftCalls).toBe(0);
    expect(agentGateway.ordersCalls).toBe(0);
    expect(agentGateway.giftCalls).toBe(0);
    expect(execution.results[0]?.status).toBe('failed');
  });
});

describe('purchase evidence on summaries', () => {
  it('carries typed purchaseFacts on a completed purchase summary', async () => {
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
        requestId: 'ev-fact-1',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado de mi pedido?',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: {
        nextInput: 'email',
        guidance: createInformationAuthGuidance('email_required', null),
      },
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });

    const evidence = execution.summaries[0]?.evidence ?? [];
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      purchaseFact: {
        eventLabel: 'Boda',
        total: 300,
        paymentMethod: 'Transferencia',
        paymentStatus: 'approved',
        referencePresent: false,
      },
    });
    expect(evidence[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
