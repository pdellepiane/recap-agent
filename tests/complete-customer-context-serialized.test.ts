import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  CartInformation,
  PurchaseInformation,
} from '../src/core/information';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type {
  ComposeReplyRequest,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import type {
  AgentConversationGateway,
  AgentEventDetail,
  AgentGuestEventSummary,
  AgentPhonePurchaseLookupResult,
  AgentPurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { projectCustomerContext } from '../src/runtime/customer-context';
import { openAiInformationRequestSchema } from '../src/runtime/extraction-schemas';
import type {
  ProviderGateway,
  UserEventLookupResult,
  UserEventOrderSummary,
  UserEventSummary,
} from '../src/runtime/provider-gateway';
import { buildTurnMessageContext } from '../src/runtime/turn-message-context';

const AUTH = { token: 'synthetic-account-token', email: 'customer@example.invalid' };
const TRUSTED_PHONE = { phone_extension: '+51', phone_number: '900000091' };
const NOW = '2026-09-23T12:00:00.000Z';
const CAMPAIGN = 'Recordatorio de Boda Lucía y Marco';

function eventOrder(): UserEventOrderSummary {
  return {
    id: 71,
    eventId: 701,
    eventName: 'Boda Lucía y Marco',
    eventDate: '2021-05-01',
    eventUrl: 'https://events.example.invalid/701',
    currency: 'PEN',
    incrementId: 'COD-EVENT-71',
    giftType: 'physical',
    grandTotal: 175.5,
    paymentStatus: 'pending',
    shippingStatus: 'preparing',
    createdAt: '2021-05-01T10:00:00-05:00',
    paymentMethod: 'Transferencia',
  };
}

function purchase(orderId: string, overrides: Partial<PurchaseInformation> = {}): PurchaseInformation {
  return {
    orderId,
    recordSource: 'orders',
    accessScope: 'account',
    eventId: 701,
    currency: 'PEN',
    currencySymbol: 'S/',
    customerTransactionNumber: `COD-${orderId}`,
    paymentStatus: 'pending',
    shippingStatus: 'preparing',
    grandTotal: 175.5,
    paymentMethod: 'Transferencia',
    eventName: 'Boda Lucía y Marco',
    eventDate: '2021-06-14',
    eventUrl: 'https://events.example.invalid/701',
    createdAt: '2021-05-01T10:00:00-05:00',
    items: [{
      giftName: 'Juego de sábanas',
      quantity: 2,
      amount: 80,
      rowTotal: 160,
      type: 'se_store',
    }],
    payment: {
      method: 'Transferencia',
      amount: 75.5,
      paidAt: '2021-05-01T10:30:00-05:00',
      paymentId: 'private-payment-id-sentinel',
      transactionStatus: 'pending_verification',
      gatewayMessage: 'En validación por el banco',
      operationCode: 'TRANSFER-OP-2026-0091',
      voucherProvided: true,
      originBank: 'Banco de Lima',
      destinationAccount: {
        holder: 'Sin Envolturas',
        bank: 'Banco de Lima',
        number: '191-0091-34',
        cci: '002-191-0091-340-91',
        type: 'corriente',
      },
      voucherImage: 'https://private.example.invalid/voucher?token=secret',
    },
    paymentValidationExpectation: {
      maxBusinessHours: 72,
      appliesTo: 'indexed_validation_methods',
    },
    declineCode: 'DECLINED-TEST',
    adminComment: 'operator-only-sentinel',
    dedication: {
      message: 'Que disfruten su nuevo hogar',
      isPrivate: false,
      sendPhysical: true,
      physicalStatus: 'preparing',
    },
    thanks: {
      message: 'Gracias por acompañarnos',
      sendMethod: 'whatsapp',
    },
    isThanked: true,
    ...overrides,
  };
}

function userEvent(): UserEventSummary {
  return {
    relation: 'owner',
    guestId: null,
    eventId: 701,
    slug: 'boda-lucia-marco',
    url: 'https://events.example.invalid/701',
    name: 'Boda Lucía y Marco',
    place: 'Casa Andina Miraflores',
    type: 'wedding',
    datetime: '2026-10-10T18:30:00-05:00',
    stage: 'published',
    isVisible: true,
    isPublic: false,
    currency: 'PEN',
    country: 'Perú',
    guestStatus: null,
    hostType: 'couple',
    hostPermission: 'owner',
    hostStatus: 'active',
    celebratedType: 'couple',
    amountCollected: 1200,
    amountTransferred: 750,
    transactionsCount: 8,
    invitedGuestCount: 90,
    confirmedGuestCount: 61,
    orders: [eventOrder()],
    detail: {
      withTime: true,
      timezone: 'America/Lima',
      city: 'Lima',
      celebrateds: [{ name: 'Lucía', type: 'bride' }, { name: 'Marco', type: 'groom' }],
      moments: [{
        label: 'Ceremonia',
        description: 'Ceremonia principal',
        datetime: '2026-10-10T18:30:00-05:00',
        withTime: true,
        locationDescription: 'Salón principal',
        locationReference: 'Casa Andina',
        locationUrl: null,
        locationCoords: null,
        position: 0,
      }],
      dresscode: { type: 'formal', description: 'Formal' },
      commonAsked: [{ question: '¿Hay estacionamiento?', answer: 'Sí, en el sótano.' }],
      contactInfo: [{ label: 'Organización', value: 'Lucía' }],
    },
  };
}

function authenticatedEvents(): UserEventLookupResult {
  return {
    lookup: { email: AUTH.email },
    user: {
      id: 900123,
      fullName: 'Cliente Autorizado',
      email: AUTH.email,
      fullPhone: '+51900000091',
    },
    events: [userEvent()],
    recentOrders: [eventOrder()],
    counts: {
      ownerEvents: 1,
      guestEvents: 0,
      hostEvents: 1,
      celebratedEvents: 0,
      recentOrders: 1,
    },
  };
}

function guestEvent(eventId: number): AgentGuestEventSummary {
  return {
    eventId,
    name: `Evento ${eventId}`,
    slug: `evento-${eventId}`,
    url: `https://events.example.invalid/${eventId}`,
    datetime: '2026-10-10T18:30:00-05:00',
    type: 'wedding',
    typeDetail: null,
    stage: 'published',
    city: 'Lima',
    country: 'Perú',
    currency: 'PEN',
  };
}

function eventDetail(eventId: number): AgentEventDetail {
  return {
    ...guestEvent(eventId),
    withTime: true,
    timezone: 'America/Lima',
    celebrateds: [{ name: `Celebrado ${eventId}`, type: 'host' }],
    moments: [],
    dresscode: null,
    commonAsked: [],
    contactInfo: [],
    attendance: null,
    purchases: [],
  };
}

function abandonedCart(): CartInformation {
  return {
    cartId: 'cart-sentinel-901',
    recordSource: 'orders',
    accessScope: 'trusted_phone_purchase',
    status: 'abandoned',
    wasAbandoned: true,
    eventId: 701,
    eventName: 'Boda Lucía y Marco',
    eventDate: '2021-06-14',
    eventUrl: 'https://events.example.invalid/701',
    subtotal: 249.9,
    currency: 'PEN',
    currencySymbol: 'S/',
    giftsQuantity: 1,
    createdAt: '2021-04-30T08:00:00-05:00',
    items: [{ giftName: 'Lámpara de mesa', quantity: 1, amount: 249.9, rowTotal: 249.9, type: 'se_store' }],
  };
}

function fixture(args: {
  readonly failGifts?: boolean;
  readonly emptyOrders?: boolean;
  readonly emptyGifts?: boolean;
  readonly emptyEvents?: boolean;
} = {}) {
  const purchases = [
    purchase('SHARED-ORDER-ID'),
    purchase('71'),
    purchase('ORD-SECOND'),
    purchase('ORD-THIRD'),
    purchase('ORD-FOURTH'),
    purchase('ORD-FIFTH'),
    purchase('ORD-OLDER-2021', { eventDate: '2021-01-12', createdAt: '2020-12-20T09:00:00-05:00' }),
  ];
  const sameIdGift = purchase('SHARED-ORDER-ID', {
    recordSource: 'gift_purchases',
    accessScope: 'account',
    grandTotal: 80,
    paymentStatus: 'approved',
    paymentMethod: 'Crédito de anfitrión',
    items: [{ giftName: 'Aporte de luna de miel', quantity: 1, amount: 80, rowTotal: 80, type: 'credit' }],
  });
  const detailCalls: number[] = [];
  let orderCalls = 0;
  let giftCalls = 0;
  let phoneOrderCalls = 0;
  let phoneGiftCalls = 0;
  let guestEventCalls = 0;
  let authenticatedEventCalls = 0;

  const agentGateway = {
    async getOrders(): Promise<AgentPurchaseLookupResult> {
      orderCalls += 1;
      return { status: 'success', resource: 'orders', purchases: args.emptyOrders ? [] : purchases };
    },
    async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
      giftCalls += 1;
      if (args.failGifts) {
        throw new Error('synthetic gift read failure');
      }
      return { status: 'success', resource: 'gift_purchases', purchases: args.emptyGifts ? [] : [sameIdGift] };
    },
    async getGuestOrdersByPhone(): Promise<AgentPhonePurchaseLookupResult> {
      phoneOrderCalls += 1;
      return {
        status: 'success',
        resource: 'orders',
        purchases: [],
        carts: [abandonedCart()],
      };
    },
    async getGuestGiftPurchasesByPhone(): Promise<AgentPhonePurchaseLookupResult> {
      phoneGiftCalls += 1;
      return { status: 'success', resource: 'gift_purchases', purchases: [] };
    },
    async getGuestEventsByPhone(): Promise<{ status: 'success'; events: AgentGuestEventSummary[] }> {
      guestEventCalls += 1;
      return {
        status: 'success',
        events: [701, 702, 703, 704, 705, 706].map(guestEvent),
      };
    },
    async getEventDetail(input: { eventId?: number }): Promise<{ status: 'success'; event: AgentEventDetail }> {
      const eventId = input.eventId ?? 0;
      detailCalls.push(eventId);
      return { status: 'success', event: eventDetail(eventId) };
    },
    async authByPhone() {
      throw new Error('profile preparation must not perform authentication');
    },
  } as unknown as AgentConversationGateway;

  const providerGateway = {
    async lookupAuthenticatedUserEvents(): Promise<UserEventLookupResult> {
      authenticatedEventCalls += 1;
      const result = authenticatedEvents();
      return args.emptyEvents
        ? { ...result, events: [], recentOrders: [], counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } }
        : result;
    },
  } as unknown as ProviderGateway;

  const orchestrator = new InformationOrchestrator({
    knowledgeGateway: {} as never,
    providerGateway,
    agentGateway,
  });

  return {
    orchestrator,
    reads: () => ({
      orderCalls,
      giftCalls,
      phoneOrderCalls,
      phoneGiftCalls,
      guestEventCalls,
      authenticatedEventCalls,
      detailCalls: [...detailCalls].sort((left, right) => left - right),
    }),
  };
}

function runtime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'offline-test-key',
    replyModel: 'gpt-6-luna',
    extractorModel: 'gpt-6-luna',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    providerGateway: {} as never,
  });
}

function baseExtraction(
  informationRequests: ExtractionResult['informationRequests'] = [],
): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: null,
    reportedEventRole: null,
    informationRequests,
    supportAct: null,
    humanHelpIntent: null,
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: 'plan_state',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: 0.99,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [], candidateOperations: [], questionKey: null },
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
  };
}

function supportPlan() {
  return mergePlan(
    createEmptyPlan({ planId: 'complete-customer-context-test', channel: 'whatsapp', externalUserId: 'customer-91' }),
    { current_node: 'resolver_consultas_informativas' },
  );
}

function conversation() {
  return buildTurnMessageContext({
    inbound: {
      channel: 'whatsapp',
      externalUserId: 'customer-91',
      text: '¿A qué hora es mi evento?',
      messageId: 'current-turn',
      receivedAt: NOW,
      contactPhone: '+51900000091',
    },
    messages: [{
      id: 4801,
      direction: 'outbound',
      source: 'admin_campaign',
      body: CAMPAIGN,
      status: 'delivered',
      whatsappMessageId: null,
      sentAt: '2026-09-20T10:00:00-05:00',
      createdAt: '2026-09-20T10:00:00-05:00',
    }],
  });
}

function extractProfileJson(input: string): Record<string, unknown> {
  const marker = 'Contexto autorizado del cliente (JSON; registros y cobertura): ';
  const markerAt = input.indexOf(marker);
  if (markerAt < 0) throw new Error('Authorized customer profile is missing from extraction input.');
  const start = input.indexOf('{', markerAt + marker.length);
  return extractJsonObject(input, start);
}

function extractJsonObject(input: string, start: number): Record<string, unknown> {
  if (start < 0) throw new Error('Serialized JSON object is missing from model input.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(input.slice(start, index + 1)) as Record<string, unknown>;
    }
  }
  throw new Error('Canonical turn evidence JSON is unbalanced.');
}

function extractReplyEvidence(input: string): Record<string, unknown> {
  const marker = 'Evidencia canónica del turno (JSON): ';
  const markerAt = input.indexOf(marker);
  if (markerAt < 0) throw new Error('Canonical turn evidence is missing from reply input.');
  const start = input.indexOf('{', markerAt + marker.length);
  return extractJsonObject(input, start);
}

function occurrences(input: string, value: string): number {
  return input.split(value).length - 1;
}

function composeRequest(
  customerContext: ComposeReplyRequest['customerContext'],
  extraction: ExtractionResult,
): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: '¿A qué hora es mi evento?',
    messageContext: conversation(),
    plan: supportPlan(),
    extraction,
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'complete-customer-context-test',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    customerContext,
  };
}

describe('complete authorized customer context in serialized model requests', () => {
  it('carries every prepared record into extraction and reply despite route/reference changes', async () => {
    const backend = fixture();
    const snapshot = await backend.orchestrator.prepareCustomerContext({
      authentication: AUTH,
      trustedPhone: TRUSTED_PHONE,
      identity: { customerRef: 'customer-91', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    const preparedReadCounts = backend.reads();
    await backend.orchestrator.execute({
      requests: [
        {
          requestId: 'same-turn-purchases',
          kind: 'purchase',
          resource: 'purchase_discovery',
          query: '¿Cuál es el estado de mis compras?',
          orderId: null,
          authAction: 'none',
        },
        {
          requestId: 'same-turn-events',
          kind: 'associated_event',
          query: '¿A qué hora es mi evento?',
          eventHint: null,
          authAction: 'none',
        },
      ],
      authentication: AUTH,
      authBlock: null,
      trustedPhone: TRUSTED_PHONE,
      preparedCustomerContext: snapshot,
      deadlineMs: Date.now() + 30_000,
    });
    expect(backend.reads()).toEqual(preparedReadCounts);
    const customerContext = projectCustomerContext(snapshot);
    const openAi = runtime();
    for (const removedSelector of ['resource', 'aspects', 'sensitiveFields']) {
      expect(openAiInformationRequestSchema.shape).not.toHaveProperty(removedSelector);
    }

    const extractionRequest: ExtractRequest = {
      userMessage: '¿A qué hora es mi evento?',
      plan: supportPlan(),
      messageContext: conversation(),
      customerContext,
    };
    const extractSpec = await openAi.buildExtractionRequestSpec(extractionRequest);
    const extractedProfile = extractProfileJson(extractSpec.input);
    expect(extractedProfile).toEqual(customerContext);
    expect(Buffer.byteLength(extractSpec.instructions, 'utf8')).toBeLessThanOrEqual(6_000);

    const base = baseExtraction();
    const wrongResourceAndNoAspects = {
      ...base,
      informationRequests: [{
        kind: 'purchase',
        resource: 'gift_purchases',
        query: '¿Qué pasó con mi tarjeta física?',
        orderId: 'UNKNOWN-REFERENCE',
        authAction: 'none',
        aspects: [],
      }],
    } as unknown as ExtractionResult;
    const changedResourceAndAspects = {
      ...base,
      informationRequests: [{
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el monto registrado?',
        orderId: 'ORD-OLDER-2021',
        authAction: 'none',
        aspects: ['payment_status'],
        sensitiveFields: [],
      }],
    } as unknown as ExtractionResult;
    const empty = await openAi.buildReplyRequestSpec(composeRequest(customerContext, base));
    const wrong = await openAi.buildReplyRequestSpec(composeRequest(customerContext, wrongResourceAndNoAspects));
    const changed = await openAi.buildReplyRequestSpec(composeRequest(customerContext, changedResourceAndAspects));
    const emptyProfile = extractReplyEvidence(empty.input).customer_context;
    const wrongProfile = extractReplyEvidence(wrong.input).customer_context;
    const changedProfile = extractReplyEvidence(changed.input).customer_context;
    expect(wrongProfile).toEqual(emptyProfile);
    expect(changedProfile).toEqual(emptyProfile);
    expect(emptyProfile).toEqual(customerContext);

    const profileJson = JSON.stringify(customerContext);
    const olderOrder = customerContext.purchases.find((record) => record.orderId === 'ORD-OLDER-2021');
    const cardOrder = customerContext.purchases.find((record) => record.orderId === 'SHARED-ORDER-ID' && record.recordSource === 'orders');
    const creditCardGift = customerContext.purchases.find((record) => record.orderId === 'SHARED-ORDER-ID' && record.recordSource === 'gift_purchases');
    const profileEvent = customerContext.invitations.find((event) => event.eventId === 701);
    expect(olderOrder).toMatchObject({
      customerTransactionNumber: 'COD-ORD-OLDER-2021',
      createdAt: '2020-12-20T09:00:00-05:00',
      eventDate: '2021-01-12',
      paymentStatus: 'pending',
      grandTotal: 175.5,
      payment: {
        amount: 75.5,
        paidAt: '2021-05-01T10:30:00-05:00',
        transactionStatus: 'pending_verification',
        gatewayMessage: 'En validación por el banco',
        operationCode: 'TRANSFER-OP-2026-0091',
        voucherProvided: true,
        originBank: 'Banco de Lima',
        destinationAccount: {
          holder: 'Sin Envolturas',
          bank: 'Banco de Lima',
          number: '191-0091-34',
          cci: '002-191-0091-340-91',
          type: 'corriente',
        },
      },
      dedication: {
        message: 'Que disfruten su nuevo hogar',
        isPrivate: false,
        sendPhysical: true,
        physicalStatus: 'preparing',
      },
      thanks: { message: 'Gracias por acompañarnos', sendMethod: 'whatsapp' },
      isThanked: true,
    });
    expect(extractSpec.input).toContain('COD-ORD-OLDER-2021');
    expect(empty.input).toContain('COD-ORD-OLDER-2021');
    expect(empty.input).not.toContain('private-payment-id-sentinel');
    expect(cardOrder?.dedication?.physicalStatus).toBe('preparing');
    expect(creditCardGift).toMatchObject({
      items: [{ type: 'credit' }],
      dedication: { sendPhysical: true, physicalStatus: 'preparing' },
    });
    expect(profileEvent).toMatchObject({
      datetime: '2026-10-10T18:30:00-05:00',
      place: 'Casa Andina Miraflores',
      detail: { timezone: 'America/Lima', city: 'Lima' },
      orders: [],
      orderIds: ['71'],
    });
    expect(customerContext.purchases.filter((record) => record.orderId === 'SHARED-ORDER-ID').map((record) => record.recordSource).sort())
      .toEqual(['gift_purchases', 'orders']);
    for (const spec of [extractSpec, empty, wrong, changed]) {
      expect(spec.input).toContain('ORD-OLDER-2021');
      expect(spec.input).toContain('cart-sentinel-901');
      expect(spec.input).toContain('Aporte de luna de miel');
      expect(spec.input).toContain('Que disfruten su nuevo hogar');
      expect(spec.input).toContain('preparing');
      expect(spec.input).toContain('2026-10-10T18:30:00-05:00');
      expect(spec.input).toContain(CAMPAIGN);
      expect(spec.input).not.toContain('private-payment-id-sentinel');
      expect(spec.input).toContain('TRANSFER-OP-2026-0091');
      expect(spec.input).toContain('191-0091-34');
      expect(spec.input).toContain('002-191-0091-340-91');
      expect(spec.input).not.toContain('private.example.invalid/voucher');
      expect(spec.input).not.toContain('operator-only-sentinel');
      expect(spec.input).not.toContain('900123');
    }
    expect(customerContext.purchases.filter((record) => record.orderId === 'SHARED-ORDER-ID'))
      .toHaveLength(2);
    expect(customerContext.purchases.filter((record) => record.orderId === '71').map((record) => record.recordSource).sort())
      .toEqual(['orders', 'user_lookup']);
    expect(occurrences(empty.input, '2020-12-20T09:00:00-05:00')).toBe(1);
    expect(occurrences(extractSpec.input, '2020-12-20T09:00:00-05:00')).toBe(1);
    expect(snapshot.purchasesCarts.purchases.map((record) => record.orderId)).toContain('ORD-OLDER-2021');
    expect(snapshot.invitationsEvents.invitations.map((event) => event.eventId)).toContain(701);
    expect(snapshot.purchasesCarts.carts.map((cart) => cart.cartId)).toContain('cart-sentinel-901');
    expect(backend.reads()).toMatchObject({
      orderCalls: 1,
      giftCalls: 1,
      phoneOrderCalls: 1,
      phoneGiftCalls: 1,
      guestEventCalls: 1,
      authenticatedEventCalls: 1,
      detailCalls: [701, 702, 703, 704, 705, 706],
    });
    expect(snapshot.readMetrics?.peakConcurrency).toBeGreaterThan(1);
    expect(snapshot.readMetrics?.peakConcurrency).toBeLessThanOrEqual(4);
    expect(snapshot.readMetrics?.totalReads).toBe(12);
    expect(snapshot.purchasesCarts.paginationExhausted).toBeNull();
    expect(snapshot.invitationsEvents.paginationExhausted).toBeNull();
    expect(snapshot.purchasesCarts.completeness).toBeNull();
    expect(snapshot.invitationsEvents.completeness).toBeNull();

    const bytes = {
      extractionInstructions: Buffer.byteLength(extractSpec.instructions, 'utf8'),
      extractionInput: Buffer.byteLength(extractSpec.input, 'utf8'),
      replyInstructions: Buffer.byteLength(empty.instructions, 'utf8'),
      replyInput: Buffer.byteLength(empty.input, 'utf8'),
      profileJson: Buffer.byteLength(profileJson, 'utf8'),
      backendReads: snapshot.readMetrics,
    };
    console.info(`complete-customer-context-request-metrics ${JSON.stringify(bytes)}`);
  });

  it('retains successful roots when another authorized root fails and marks coverage partial', async () => {
    const backend = fixture({ failGifts: true });
    const snapshot = await backend.orchestrator.prepareCustomerContext({
      authentication: AUTH,
      trustedPhone: null,
      identity: { customerRef: 'customer-91', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    const customerContext = projectCustomerContext(snapshot);
    const spec = await runtime().buildExtractionRequestSpec({
      userMessage: '¿A qué hora es mi evento?',
      plan: supportPlan(),
      messageContext: conversation(),
      customerContext,
    });
    const profile = extractProfileJson(spec.input);
    expect(snapshot.purchasesCarts.purchases.map((record) => record.orderId)).toContain('ORD-OLDER-2021');
    expect(JSON.stringify(profile)).toContain('ORD-OLDER-2021');
    expect(snapshot.purchasesCarts.completeness).toBe('partial');
    expect(snapshot.purchasesCarts.sourceCoverage?.map((entry) => entry.status)).toContain('failed');
    expect(backend.reads()).toMatchObject({ orderCalls: 1, giftCalls: 1, authenticatedEventCalls: 1 });
  });

  it('represents missing authorization explicitly and performs zero protected reads', async () => {
    const backend = fixture();
    const snapshot = await backend.orchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: null,
      identity: null,
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    const customerContext = projectCustomerContext(snapshot);
    const extraction = await runtime().buildExtractionRequestSpec({
      userMessage: '¿A qué hora es mi evento?',
      plan: supportPlan(),
      messageContext: conversation(),
      customerContext,
    });
    const reply = await runtime().buildReplyRequestSpec(composeRequest(customerContext, baseExtraction()));
    expect(snapshot.identityAccess.status).toBe('unavailable');
    expect(snapshot.purchasesCarts.status).toBe('unavailable');
    expect(snapshot.invitationsEvents.status).toBe('unavailable');
    expect(snapshot.readMetrics).toEqual({ totalReads: 0, peakConcurrency: 0, readsByOperation: {} });
    expect(backend.reads()).toMatchObject({
      orderCalls: 0,
      giftCalls: 0,
      phoneOrderCalls: 0,
      phoneGiftCalls: 0,
      guestEventCalls: 0,
      authenticatedEventCalls: 0,
      detailCalls: [],
    });
    expect(extraction.input).not.toContain('ORD-OLDER-2021');
    expect(reply.input).not.toContain('ORD-OLDER-2021');
    expect(extractProfileJson(extraction.input)).toMatchObject({
      identityAccess: { status: 'unavailable' },
      coverage: { purchasesCarts: { status: 'unavailable' }, invitationsEvents: { status: 'unavailable' } },
    });
  });

  it('distinguishes successful empty roots from unavailable or failed sources', async () => {
    const backend = fixture({ emptyOrders: true, emptyGifts: true, emptyEvents: true });
    const snapshot = await backend.orchestrator.prepareCustomerContext({
      authentication: AUTH,
      trustedPhone: null,
      identity: { customerRef: 'customer-91', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    const customerContext = projectCustomerContext(snapshot);
    const spec = await runtime().buildReplyRequestSpec(composeRequest(customerContext, baseExtraction()));
    const profile = extractReplyEvidence(spec.input).customer_context as Record<string, unknown>;
    expect(snapshot.purchasesCarts.status).toBe('empty');
    expect(snapshot.invitationsEvents.status).toBe('empty');
    expect(customerContext.purchases).toEqual([]);
    expect(customerContext.invitations).toEqual([]);
    expect(profile).toEqual(customerContext);
    expect(backend.reads()).toMatchObject({ orderCalls: 1, giftCalls: 1, authenticatedEventCalls: 1 });
  });
});
