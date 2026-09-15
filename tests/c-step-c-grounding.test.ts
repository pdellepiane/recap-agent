import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type {
  AgentConversationGateway,
  AgentEventDetailResult,
  AgentGuestEventsResult,
  AgentGuestRsvpResult,
} from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractionResult,
} from '../src/runtime/contracts';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { closeContactEvidenceForReply, describeRsvpEventTime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  disclosedPurchaseCurrency,
  disclosedPurchaseCurrencySymbol,
  projectCompletedPurchaseForModel,
  projectPurchaseReplyForModel,
  selectPurchaseReplyOutcome,
} from '../src/runtime/purchase-reply-projector';
import type { PurchaseAspect, PurchaseInformation } from '../src/core/information';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = { whatsapp: new WhatsAppMessageRenderer() };

function aspects(...values: PurchaseAspect[]): PurchaseAspect[] {
  return values;
}

function order(overrides: Partial<PurchaseInformation> = {}): PurchaseInformation {
  return {
    orderId: 'order-luis-pending-227',
    eventId: 4001,
    currency: null,
    currencySymbol: null,
    customerTransactionNumber: null,
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: null,
    paymentMethod: null,
    amountDisclosure: {
      total: 227.76,
      paid: null,
      currency: null,
      currencySymbol: null,
      paymentMethod: 'Yape_o_Plin',
      presentation: 'recorded_method_no_currency',
    },
    eventName: 'Alejandra',
    eventDate: '2026-09-20',
    eventUrl: null,
    createdAt: '2026-08-27 15:00:00',
    items: [],
    ...overrides,
  } as PurchaseInformation;
}

function cart() {
  return {
    cartId: 'cart-luis-001',
    status: 'active',
    wasAbandoned: false,
    eventId: 4001,
    eventName: 'Alejandra',
    eventDate: '2026-09-20',
    eventUrl: null,
    subtotal: 227.76,
    currency: null,
    currencySymbol: null,
    giftsQuantity: 1,
    createdAt: '2026-08-27 14:00:00',
    items: [],
  };
}

describe('C1 purchase projector carries currency provenance and balance distinction', () => {
  it('prefers the amount disclosure for currency before the nulled direct fields', () => {
    expect(disclosedPurchaseCurrency({ currency: 'USD', amountDisclosure: { currency: 'PEN' } } as never)).toBe('USD');
    expect(disclosedPurchaseCurrency({ currency: null, amountDisclosure: { currency: 'PEN' } } as never)).toBe('PEN');
    expect(disclosedPurchaseCurrency({ currency: null, amountDisclosure: null } as never)).toBeNull();
    expect(disclosedPurchaseCurrencySymbol(
      { currency: null, currencySymbol: null, amountDisclosure: { currency: 'PEN', currencySymbol: 'S/' } } as never,
    )).toBe('S/');
    // Display metadata never stands in for a withheld currency claim.
    expect(disclosedPurchaseCurrencySymbol(
      { currency: null, currencySymbol: 'S/', amountDisclosure: null } as never,
    )).toBeNull();
  });

  it('projects PEN S/ from the disclosure instead of reporting currency missing', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({
        amountDisclosure: {
          total: 250,
          paid: null,
          currency: 'PEN',
          currencySymbol: 'S/',
          paymentMethod: 'Visa',
          presentation: 'explicit_currency',
        },
      })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.currency).toBe('PEN');
    expect(outcome.order.currencySymbol).toBe('S/');
    const model = projectPurchaseReplyForModel(outcome) as {
      order: { currency: string; currencySymbol: string; amount: Record<string, unknown> };
    };
    expect(model.order.currency).toBe('PEN');
    expect(model.order.currencySymbol).toBe('S/');
    expect(model.order.amount.currency).toBe('PEN');
    expect(model.order.amount.currencySymbol).toBe('S/');
  });

  it('marks the remaining balance unverifiable so the total is never read as owed', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order()],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status', 'validation_window'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.amount?.total).toBe(227.76);
    expect(outcome.order.amount?.remaining).toBeNull();
    expect(outcome.order.amount?.remainingVerifiable).toBe(false);
    const model = projectPurchaseReplyForModel(outcome) as {
      order: { amount: Record<string, unknown> };
    };
    expect(model.order.amount.remaining).toBeNull();
    expect(model.order.amount.remainingVerifiable).toBe(false);
  });

  it('keeps order payment state and amount off the same-event cart in model output', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order()],
      carts: [cart()],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_plus_cart');
    const model = projectPurchaseReplyForModel(outcome) as {
      order: { paymentStatus: string };
      cart: { paymentStatus: null; amount: null; status: string };
    };
    expect(model.order.paymentStatus).toBe('pending');
    expect(model.cart.status).toBe('active');
    expect(model.cart.paymentStatus).toBeNull();
    expect(model.cart.amount).toBeNull();
  });

  it('projects selection candidates with distinguishing record facts only', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        order({ orderId: 'order-1', grandTotal: null, eventName: 'Evento Familiar Norte', eventDate: '2026-09-12' }),
        order({ orderId: 'order-2', grandTotal: null, eventName: 'Evento Familiar Sur', eventDate: '2026-08-22' }),
      ],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('selection');
    if (outcome.kind !== 'selection') return;
    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.candidates[0]).toMatchObject({
      eventName: 'Evento Familiar Norte',
      eventDate: '2026-09-12',
      paymentStatus: 'pending',
    });
  });
});

class RecordingRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];
  constructor(private readonly extractions: ExtractionResult[]) {}
  async extract(): Promise<ExtractionResult> {
    const next = this.extractions.shift();
    if (!next) throw new Error('Missing extraction fixture.');
    return next;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return {
      text: 'Respuesta del modelo.',
      structuredMessage: { type: 'generic', paragraphs_es: ['Respuesta del modelo.'] },
    };
  }
}

function infoExtraction(aspectsList: string[]): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [
      {
        kind: 'purchase',
        resource: 'orders',
        query: 'consulta de compra',
        orderId: null,
        aspects: aspectsList,
        sensitiveFields: [],
        authAction: 'none',
      },
    ],
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
    conversationSummary: 'Consulta de compra.',
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
    requestedOperation: null,
  } as unknown as ExtractionResult;
}

function takeoverGateway() {
  return {
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
}

async function runInformationTurn(options: {
  externalUserId: string;
  text: string;
  extraction: ExtractionResult;
  results: unknown[];
}) {
  const store = new InMemoryPlanStore();
  await store.save({
    plan: createEmptyPlan({
      planId: `p-${options.externalUserId}`,
      channel: 'whatsapp',
      externalUserId: options.externalUserId,
    }),
    reason: 'seed',
  });
  const runtime = new RecordingRuntime([options.extraction]);
  const gateway = takeoverGateway();
  const service = new AgentService({
    planStore: store,
    runtime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    informationOrchestrator: {
      async execute() {
        return { results: options.results, summaries: [] };
      },
    } as never,
    promptLoader,
    renderers,
  });
  const response = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
    text: options.text,
    messageId: `m-${options.externalUserId}`,
    receivedAt: '2026-09-04T15:01:00.000Z',
    contactPhone: '+51938389389',
  });
  return { response, runtime };
}

function pendingYapeResult() {
  return {
    requestId: 'information-1',
    kind: 'purchase',
    status: 'completed',
    resource: 'orders',
    purchases: [
      {
        orderId: 'order-luis-pending-227',
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: null,
        paymentMethod: null,
        eventName: 'Alejandra',
        eventDate: '2026-09-20',
        eventUrl: null,
        createdAt: '2026-08-27 15:00:00',
        items: [],
        currency: null,
        paymentValidationExpectation: { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' },
        amountDisclosure: {
          total: 227.76,
          paid: null,
          currency: null,
          currencySymbol: null,
          paymentMethod: 'Yape_o_Plin',
          presentation: 'recorded_method_no_currency',
        },
      },
    ],
    carts: [],
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
  };
}

describe('C1 pending purchases guide window, balance and corrections without prose', () => {
  it('projects pending validation-window facts without unconditional advisory prose', async () => {
    const { runtime } = await runInformationTurn({
      externalUserId: 'u-c1-luis',
      text: 'Cuanto me falta?',
      extraction: infoExtraction(['summary', 'payment_status', 'validation_window']),
      results: [pendingYapeResult()],
    });
    // No unconditional advisory: the node response contract owns the
    // validation-window and total-vs-balance presentation.
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).not.toContain('72 horas');
    expect(note).not.toContain('saldo restante');
    // The pending summary still gets the window from the projected fact.
    const projected = runtime.composeRequests[0]?.informationResults?.[0];
    expect(projected?.status).toBe('completed');
    if (projected?.status === 'completed' && projected.kind === 'purchase') {
      expect(projected.purchases[0]?.paymentStatus).toBe('pending');
      expect(projected.purchases[0]?.paymentValidationExpectation?.maxBusinessHours).toBe(72);
      expect(projected.purchases[0]?.amountDisclosure?.total).toBe(227.76);
    } else {
      expect.unreachable('expected a completed purchase result');
    }
  });

  it('frames user currency/time corrections as unconfirmed record gaps', async () => {
    const { runtime } = await runInformationTurn({
      externalUserId: 'u-c1-claudia',
      text: 'Lo hice el 30 de agosto a las 9:31 p. m.; el monto es en dolares.',
      extraction: infoExtraction(['summary']),
      results: [pendingYapeResult()],
    });
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('no pueden confirmarse con el registro disponible');
  });

  it('asks selection from record facts without inferring associations', async () => {
    const { runtime } = await runInformationTurn({
      externalUserId: 'u-c1-martha',
      text: 'No tengo cuenta. Que paso con el regalo que intente pagar?',
      extraction: infoExtraction(['summary', 'payment_status']),
      results: [{
        requestId: 'information-1',
        kind: 'purchase',
        status: 'completed',
        resource: 'orders',
        purchases: [
          { ...pendingYapeResult().purchases[0], orderId: 'order-1', eventName: 'Evento Familiar Norte', eventDate: '2026-09-12' },
          { ...pendingYapeResult().purchases[0], orderId: 'order-2', eventName: 'Evento Familiar Sur', eventDate: '2026-08-22' },
        ],
        carts: [],
        needsSelection: true,
        accessMethod: 'trusted_phone_purchase',
        coverage: 'complete',
      }],
    });
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('no infieras invitaciones');
  });

  it('frames a scoped phone miss as a lookup limitation with the query preserved', async () => {
    const { response, runtime } = await runInformationTurn({
      externalUserId: 'u-c1-missing',
      text: 'Quiero consultar si mi compra esta confirmada. No tengo una cuenta registrada.',
      extraction: infoExtraction(['summary', 'payment_status']),
      results: [{
        requestId: 'information-1',
        kind: 'purchase',
        status: 'failed',
        retryable: false,
        failureKind: 'not_found',
        message: 'No encontré compras coincidentes asociadas a este número.',
        accessMethod: 'trusted_phone_purchase',
      }],
    });
    const outcome = runtime.composeRequests[0]?.authenticationOutcome;
    expect(outcome).toMatchObject({
      status: 'terminal',
      protectedRequestsClosed: false,
      scopedPhoneSearchMiss: true,
    });
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.information_state.pending_requests.map((request) => request.kind)).toContain('purchase');
  });
});

describe('C1 terminal handoff reports the retained receipt outcome', () => {
  async function runRetainTurn(receiptOutcome: 'handoff_requested' | 'handoff_failed' | 'outcome_unknown') {
    const store = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'c1-retain', channel: 'whatsapp', externalUserId: 'c1-retain-user' }),
      {
        current_node: 'solicitar_agente_humano',
        intent: 'solicitar_humano',
        contact_email: 'fallback@example.invalid',
        auth_recovery: { terminalReason: 'verification_failed' },
        human_help_receipt: {
          dedupeKey: 'handoff:c1-retain:protected_request',
          inboundId: 'm-prior',
          phone: '+51900000302',
          outcome: receiptOutcome,
          requested: receiptOutcome === 'handoff_requested',
          softPaused: false,
          updatedAt: '2026-09-04T15:00:00.000Z',
        },
        human_escalation: {
          status: 'requested',
          requested_at: '2026-09-04T15:00:00.000Z',
          phone_number: '+51900000302',
          last_error: null,
        },
        information_state: {
          resume_node: 'deteccion_intencion',
          pending_requests: [{
            requestId: 'information-1', kind: 'purchase', resource: 'gift_purchases',
            query: 'Confirmar el deposito.', orderId: null,
            aspects: ['payment_status'], sensitiveFields: [], authAction: 'provide_otp',
          }],
          selection_candidates: [],
          last_completed_request: null,
        },
      } as never,
    );
    await store.save({ plan: seed, reason: 'seed' });
    const runtime = new RecordingRuntime([infoExtraction(['payment_status'])]);
    const gateway = takeoverGateway();
    let takeovers = 0;
    const countingGateway = {
      ...gateway,
      async requestHumanTakeover() {
        takeovers += 1;
        return { status: 'success', message: 'Requested.' };
      },
    } as unknown as AgentConversationGateway;
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: countingGateway,
      promptLoader,
      renderers,
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'c1-retain-user',
      text: '753994',
      messageId: 'm-retain-1',
      receivedAt: '2026-09-04T15:01:00.000Z',
      contactPhone: '+51900000302',
    });
    return { response, runtime, takeovers };
  }

  it('retains a failed handoff as failed without redispatch or closure', async () => {
    const { runtime, takeovers } = await runRetainTurn('handoff_failed');
    expect(takeovers).toBe(0);
    expect(runtime.composeRequests[0]?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      protectedRequestsClosed: false,
      handoffOutcome: 'handoff_failed',
    });
    expect(runtime.composeRequests[0]?.handoffOutcome).toBe('handoff_failed');
  });

  it('retains an unknown handoff as unknown', async () => {
    const { runtime, takeovers } = await runRetainTurn('outcome_unknown');
    expect(takeovers).toBe(0);
    expect(runtime.composeRequests[0]?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      handoffOutcome: 'handoff_unknown',
    });
  });
});

describe('C1 ambiguous confirmation supplies only typed alternatives', () => {
  it('drops extractor interpretations naming providers from the guard output', async () => {
    const store = new InMemoryPlanStore();
    await store.save({
      plan: mergePlan(
        createEmptyPlan({ planId: 'p-c1-amb', channel: 'whatsapp', externalUserId: 'u-c1-amb' }),
        {
          current_node: 'recomendar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Fotografía y video',
          vendor_category: 'Fotografía y video',
          provider_needs: [{
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: ['estilo natural'],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [90, 91],
            recommended_providers: [
              { id: 90, title: 'Carlos Schult', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'primera opción presentada', serviceHighlights: [], termsHighlights: [] },
              { id: 91, title: 'Fotografía Alternativa', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'segunda opción presentada', serviceHighlights: [], termsHighlights: [] },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          }],
          selected_provider_ids: [],
        },
      ),
      reason: 'seed',
    });
    const extraction = {
      ...infoExtraction(['summary']),
      actionIntent: null,
      informationRequests: [],
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: null,
        interpretations: ['Confirmar a Carlos Schult', 'Confirmar a Fotografía Alternativa'],
      },
      eventType: 'boda',
      vendorCategory: 'Fotografía y video',
      vendorCategories: ['Fotografía y video'],
      activeNeedCategory: 'Fotografía y video',
      location: 'Lima',
      guestRange: '51-100',
      preferences: ['estilo natural'],
      conversationSummary: 'La persona indica que, si confirma todo, se debe usar lo extraído y cerrar.',
    } as unknown as ExtractionResult;
    const runtime = new RecordingRuntime([extraction]);
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: takeoverGateway(),
      promptLoader,
      renderers,
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'u-c1-amb',
      text: 'Si confirmo todo, usen lo que extrajeron y cierren.',
      messageId: 'm-c1-amb-1',
      receivedAt: '2026-09-04T15:01:00.000Z',
    });
    expect(response.plan.current_node).toBe('aclarar_pedir_faltante');
    const alternatives = runtime.composeRequests[0]?.extraction.ambiguity?.interpretations ?? [];
    expect(alternatives).toEqual([
      'provider:shortlisted:Fotografía y video',
      'provider:shortlisted:Fotografía y video',
    ]);
    expect(alternatives.join(' ')).not.toContain('Carlos Schult');
  });
});

describe('C1 close continuation after refinement', () => {
  it('continues the close when contact completes after a defer round', async () => {
    const store = new InMemoryPlanStore();
    await store.save({
      plan: mergePlan(
        createEmptyPlan({ planId: 'p-c1-close', channel: 'whatsapp', externalUserId: 'u-c1-close' }),
        {
          current_node: 'seguir_refinando_guardar_plan',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Fotografía y video',
          vendor_category: 'Fotografía y video',
          contact_name: 'Carolina',
          contact_email: 'carolina@example.com',
          contact_phone: null,
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [90],
              recommended_providers: [
                { id: 90, title: 'Carlos Schult', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'opción foto', serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [90],
              selected_provider_hints: ['Carlos Schult'],
            },
            {
              category: 'Catering',
              status: 'deferred',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [109],
              recommended_providers: [
                { id: 109, title: 'EDO Sushi Bar', category: 'Catering', location: 'Lima', priceLevel: 'high', reason: 'opción catering', serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
      reason: 'seed',
    });
    const extraction = {
      ...infoExtraction(['summary']),
      actionIntent: null,
      informationRequests: [],
      contactName: 'Carolina',
      contactEmail: 'carolina@example.com',
      contactPhone: '+51 954779071',
    } as unknown as ExtractionResult;
    const runtime = new RecordingRuntime([extraction]);
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {} as ProviderGateway,
      agentConversationGateway: takeoverGateway(),
      promptLoader,
      renderers,
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'u-c1-close',
      text: 'soy Carolina, carolina@example.com, teléfono +51 954779071',
      messageId: 'm-c1-close-1',
      receivedAt: '2026-09-04T15:01:00.000Z',
    });
    expect(response.plan.current_node).toBe('crear_lead_cerrar');
    expect(response.plan.contact_phone).toBe('51954779071');
    expect(response.plan.provider_needs.find((need) => need.category === 'Fotografía y video')?.selected_provider_ids).toEqual([90]);
    expect(response.plan.provider_needs.find((need) => need.category === 'Catering')?.status).toBe('deferred');
  });

  it('reports close-contact completeness as typed evidence', () => {
    expect(closeContactEvidenceForReply({
      contact_name: 'Carolina',
      contact_email: 'carolina@example.com',
      contact_phone: '51954779071',
    })).toEqual({ missingFields: [], complete: true });
    expect(closeContactEvidenceForReply({
      contact_name: 'Carolina',
      contact_email: null,
      contact_phone: null,
    })).toEqual({ missingFields: ['contact_email', 'contact_phone'], complete: false });
  });
});

class RsvpServiceRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];
  constructor(private readonly extractions: ExtractionResult[]) {}
  async extract(): Promise<ExtractionResult> {
    const next = this.extractions.shift();
    if (!next) throw new Error('No RSVP extraction queued.');
    return next;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return {
      text: 'RSVP_MODEL_SENTINEL',
      structuredMessage: { type: 'generic', paragraphs_es: ['RSVP_MODEL_SENTINEL'] },
    };
  }
}

function rsvpExtraction(args: {
  action: 'attending' | 'declining' | null;
  party?: {
    scope: 'self' | 'self_and_others';
    mentioned_names: string[];
    companion_count?: 'one' | 'multiple' | 'unknown';
    plus_one_response?: 'yes' | 'no' | 'unknown';
  } | null;
}): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action,
    rsvpDecisionSource: args.action ? 'current_message' : 'current_message',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: args.party ?? null,
    intentConfidence: 0.98,
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
    conversationSummary: 'La persona responde una invitación.',
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
    requestedOperation: null,
  } as unknown as ExtractionResult;
}

function rsvpInvitation(hasResponded: boolean, willAttend: boolean | null): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest',
    guestId: 41,
    eventId: 205,
    slug: null,
    url: null,
    name: 'Matrimonio de Ana y Luis',
    place: null,
    type: null,
    datetime: '2026-09-12',
    stage: null,
    isVisible: null,
    isPublic: null,
    currency: null,
    country: null,
    guestStatus: { hasResponded, willAttend, hasCouple: null, responseDate: null },
    hostType: null,
    hostPermission: null,
    hostStatus: null,
    celebratedType: null,
    amountCollected: null,
    amountTransferred: null,
    transactionsCount: null,
    invitedGuestCount: null,
    confirmedGuestCount: null,
    orders: [],
  };
}

function rsvpGateway(results: AgentGuestRsvpResult[]) {
  const inputs: unknown[] = [];
  const gateway = {
    async logMessage(input: unknown) {
      void input;
      return { status: 'skipped' as const, reason: 'disabled' as const, message: 'Disabled.' };
    },
    async getRecentMessages() {
      return { status: 'success' as const, messages: [] };
    },
    async requestHumanTakeover() {
      return { status: 'success' as const, message: 'Requested.' };
    },
    async authByPhone() {
      return { status: 'failed' as const, error: 'Unused.', retryable: false as const };
    },
    async updatePhone() {
      return { status: 'success' as const };
    },
    async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> {
      return { status: 'not_found' as const };
    },
    async getEventDetail(): Promise<AgentEventDetailResult> {
      return { status: 'not_found' as const };
    },
    async guestRsvp(input: unknown): Promise<AgentGuestRsvpResult> {
      inputs.push(input);
      const result = results.shift();
      if (!result) throw new Error('No RSVP gateway result queued.');
      return result;
    },
  } as unknown as AgentConversationGateway;
  return { gateway, inputs };
}

async function runRsvpTurn(options: {
  externalUserId: string;
  text: string;
  extraction: ExtractionResult;
  invitations: UserEventLookupResult['events'];
  rsvpResults: AgentGuestRsvpResult[];
}) {
  const store = new InMemoryPlanStore();
  await store.save({
    plan: createEmptyPlan({
      planId: `p-${options.externalUserId}`,
      channel: 'whatsapp',
      externalUserId: options.externalUserId,
    }),
    reason: 'seed',
  });
  const runtime = new RsvpServiceRuntime([options.extraction]);
  const { gateway } = rsvpGateway(options.rsvpResults);
  const service = new AgentService({
    planStore: store,
    runtime,
    providerGateway: {
      async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        return {
          lookup: { email: null, phone: '973296571' },
          user: null,
          events: options.invitations,
          counts: { ownerEvents: 0, guestEvents: options.invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
        };
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    promptLoader,
    renderers,
  });
  const response = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
    text: options.text,
    messageId: `m-${options.externalUserId}`,
    receivedAt: '2026-09-04T15:01:00.000Z',
    contactPhone: '+51973296571',
  });
  return { response, runtime };
}

describe('C1 RSVP reports factual state without false writes', () => {
  it('states an existing confirmation with no new mutation', async () => {
    const { runtime } = await runRsvpTurn({
      externalUserId: 'u-c1-rsvp-confirmed',
      text: 'Mi asistencia ya esta confirmada?',
      extraction: rsvpExtraction({ action: 'attending' }),
      invitations: [rsvpInvitation(true, true)],
      rsvpResults: [],
    });
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"mutation_performed":false');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"invitation_state":"attending"');
  });

  it('carries a prose plus-one reason when the companion is not saved', async () => {
    const { response, runtime } = await runRsvpTurn({
      externalUserId: 'u-c1-rsvp-plusone',
      text: 'Quiero llevar a mi acompañante',
      extraction: rsvpExtraction({
        action: null,
        party: { scope: 'self_and_others', mentioned_names: [], companion_count: 'one', plus_one_response: 'yes' },
      }),
      invitations: [rsvpInvitation(true, true)],
      rsvpResults: [{
        status: 'responded',
        action: null,
        willAttend: null,
        guestId: 41,
        eventName: 'Matrimonio de Ana y Luis',
        eventDate: '2026-09-12',
        plusOne: { saved: false, response: 'yes', reason: 'El evento no permite acompañantes adicionales para este invitado.' },
      }],
    });
    expect(response.trace.tools_called).toContain('guest_rsvp');
    expect(response.trace.tools_called).not.toContain('request_human_takeover');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"saved":false');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('no permite acompañantes adicionales');
  });

  it('marks multi-person turns as unregistered with single-companion scope', async () => {
    const { response } = await runRsvpTurn({
      externalUserId: 'u-c1-rsvp-multi',
      text: 'Confirmo mi asistencia y la de Maria y Carlos',
      extraction: rsvpExtraction({
        action: 'attending',
        party: { scope: 'self_and_others', mentioned_names: ['Maria', 'Carlos'], companion_count: 'multiple', plus_one_response: 'unknown' },
      }),
      invitations: [rsvpInvitation(false, null)],
      rsvpResults: [],
    });
    expect(response.trace.tools_called).toContain('request_human_takeover');
    expect(response.trace.tools_called).not.toContain('guest_rsvp');
    expect(response.trace.operational_note).toContain('"attendance_registered":false');
    expect(response.trace.operational_note).toContain('single_companion_only');
  });
});

describe('R6 purchase disclosure reads the authorized method and labeled time', () => {
  it('reads a requested method from the amount disclosure while approved summaries omit it', () => {
    const detailed = selectPurchaseReplyOutcome({
      purchases: [order()],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_details'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(detailed.kind).toBe('order_unique');
    if (detailed.kind !== 'order_unique') return;
    expect(detailed.order.amount?.method).toBe('Yape_o_Plin');

    const approvedSummary = selectPurchaseReplyOutcome({
      purchases: [order({ paymentStatus: 'approved' })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(approvedSummary.kind).toBe('order_unique');
    if (approvedSummary.kind !== 'order_unique') return;
    expect(approvedSummary.order.amount?.method).toBeNull();
  });

  it('omits method and validation policy on a status-only question', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order()],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.paymentStatus).toBe('pending');
    expect(outcome.order.amount?.method).toBeNull();
    expect(outcome.order.validationWindow).toBeNull();
    const model = projectPurchaseReplyForModel(outcome) as {
      order: { amount: Record<string, unknown> } & Record<string, unknown>;
    };
    expect(model.order.amount).not.toHaveProperty('method');
    expect(model.order).not.toHaveProperty('validationWindow');
  });

  it('labels the payment time verbatim with unknown timezone instead of converting it', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({
        payment: { method: null, amount: null, paidAt: '2026-08-19 05:00:00' },
      })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_details'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.paymentAt).toBe('2026-08-19 05:00:00');
    expect(outcome.order.paymentTimezone).toBe('unknown');
    expect(outcome.order.eventTimezone).toBe('unknown');
    const model = projectPurchaseReplyForModel(outcome) as {
      order: { paymentAt: string; paymentTimezone: string };
    };
    expect(model.order.paymentAt).toBe('2026-08-19 05:00:00');
    expect(model.order.paymentTimezone).toBe('unknown');
  });

  it('carries the sourced validation window only together with a validation question', () => {
    const withWindow = selectPurchaseReplyOutcome({
      purchases: [order({
        paymentValidationExpectation: { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' },
      })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'validation_window'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(withWindow.kind).toBe('order_unique');
    if (withWindow.kind !== 'order_unique') return;
    expect(withWindow.order.validationWindow).toEqual({ maxBusinessHours: 72 });
    expect(withWindow.order.amount?.method).toBe('Yape_o_Plin');

    const withoutWindow = selectPurchaseReplyOutcome({
      purchases: [order({
        paymentValidationExpectation: { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' },
      })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(withoutWindow.kind).toBe('order_unique');
    if (withoutWindow.kind !== 'order_unique') return;
    expect(withoutWindow.order.validationWindow).toBeNull();
  });
});

describe('R6 selection candidates carry provenance, never identifiers or invented currency', () => {
  it('never exposes transaction references even when authorized', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        order({ orderId: 'order-1', customerTransactionNumber: 'COD111', eventName: 'Evento Familiar Norte' }),
        order({ orderId: 'order-2', customerTransactionNumber: 'COD222', eventName: 'Evento Familiar Sur' }),
      ],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'matched',
      requestedAspects: aspects('summary'),
      referenceAuthorized: true,
      userReported: {},
    });
    expect(outcome.kind).toBe('selection');
    if (outcome.kind !== 'selection') return;
    for (const candidate of outcome.candidates) {
      expect(candidate.transactionReference).toBeNull();
    }
    const serialized = JSON.stringify(projectPurchaseReplyForModel(outcome));
    expect(serialized).not.toContain('COD111');
    expect(serialized).not.toContain('COD222');
    expect(serialized).not.toContain('order-1');
  });

  it('marks currency availability so absent currency never gains S/', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        order({ orderId: 'order-1', eventName: 'Evento Familiar Norte' }),
        order({ orderId: 'order-2', eventName: 'Evento Familiar Sur' }),
      ],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('selection');
    if (outcome.kind !== 'selection') return;
    for (const candidate of outcome.candidates) {
      expect(candidate.currency).toBeNull();
      expect(candidate.currencyAvailability).toBe('unknown');
    }
    const serialized = JSON.stringify(projectPurchaseReplyForModel(outcome));
    expect(serialized).not.toContain('S/');
    expect(serialized).not.toContain('PEN');
  });

  it('projects available currency with its provenance on candidates', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        order({
          orderId: 'order-pen',
          eventName: 'Mesa Mara',
          amountDisclosure: {
            total: 250,
            paid: null,
            currency: 'PEN',
            currencySymbol: 'S/',
            paymentMethod: 'Visa',
            presentation: 'explicit_currency',
          },
        }),
      ],
      carts: [],
      needsSelection: true,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('selection');
    if (outcome.kind !== 'selection') return;
    expect(outcome.candidates[0]?.currency).toBe('PEN');
    expect(outcome.candidates[0]?.currencyAvailability).toBe('available');
  });
});

describe('R6 order-plus-cart next action follows the question', () => {
  function purchaseResultWithCart() {
    return {
      requestId: 'information-1',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [order()],
      carts: [cart()],
      needsSelection: false,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
    } as never;
  }

  it('awaits validation on a payment discussion instead of paying the pending order again', () => {
    const evidence = projectCompletedPurchaseForModel(purchaseResultWithCart(), {
      requestedAspects: aspects('summary', 'payment_status'),
    }) as { outcome_kind: string; permitted_next_action: string };
    expect(evidence.outcome_kind).toBe('order_plus_cart');
    expect(evidence.permitted_next_action).toBe('await_validation');
  });

  it('keeps the cart checkout action for an explicit checkout request', () => {
    const evidence = projectCompletedPurchaseForModel(purchaseResultWithCart(), {
      requestedAspects: aspects('summary', 'payment_options'),
    }) as { outcome_kind: string; permitted_next_action: string };
    expect(evidence.outcome_kind).toBe('order_plus_cart');
    expect(evidence.permitted_next_action).toBe('complete_checkout');
  });
});

describe('R6 RSVP event time keeps the source hour with unknown timezone', () => {
  it('reads an explicit 05:00 as 05:00, never 17:00, without a guessed conversion', () => {
    expect(describeRsvpEventTime('2026-08-19 05:00:00')).toEqual({
      value: '2026-08-19 05:00:00',
      hour24: '05:00',
      timezone: 'unknown',
    });
    expect(describeRsvpEventTime('2026-07-04 17:00:00')?.hour24).toBe('17:00');
    expect(describeRsvpEventTime(null)).toBeNull();
    expect(describeRsvpEventTime('  ')).toBeNull();
  });

  it('reads ISO-T hours verbatim instead of the trailing midnight default', () => {
    expect(describeRsvpEventTime('2026-09-21T19:00:00.000Z')).toEqual({
      value: '2026-09-21T19:00:00.000Z',
      hour24: '19:00',
      timezone: 'unknown',
    });
    expect(describeRsvpEventTime('2026-09-21T00:00:00.000Z')?.hour24).toBe('00:00');
    expect(describeRsvpEventTime('2026-09-21')?.hour24).toBe('unknown');
  });
});

describe('Packet C explicit payment time survives extraction-to-reply', () => {
  it('keeps payment_details aspects into the read and answers the sourced 05:00, never the 17:00 event hour', async () => {
    const store = new InMemoryPlanStore();
    await store.save({
      plan: createEmptyPlan({ planId: 'p-c-time', channel: 'whatsapp', externalUserId: 'u-c-time' }),
      reason: 'seed',
    });
    const seen: Array<{ requests?: Array<{ kind?: string; aspects?: string[] }> }> = [];
    const purchase = {
      ...pendingYapeResult().purchases[0],
      payment: { method: null, amount: null, paidAt: '2026-08-19 05:00:00' },
      eventDate: '2026-08-19 17:00:00',
      createdAt: '2026-08-27 15:00:00',
    };
    const taskResult = { ...pendingYapeResult(), purchases: [purchase] };
    const runtime = new RecordingRuntime([infoExtraction(['summary', 'payment_status', 'payment_details'])]);
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: takeoverGateway(),
      informationOrchestrator: {
        async execute(input: { requests?: Array<{ kind?: string; aspects?: string[] }> }) {
          seen.push(input);
          return { results: [taskResult], summaries: [] };
        },
      } as never,
      promptLoader,
      renderers,
    });
    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'u-c-time',
      text: 'Pagué a las 05:00 o a las 17:00?',
      messageId: 'm-u-c-time',
      receivedAt: '2026-09-04T15:01:00.000Z',
      contactPhone: '+51938389389',
    });
    const sentAspects = seen[0]?.requests?.find((request) => request.kind === 'purchase')?.aspects ?? [];
    expect(sentAspects).toContain('payment_details');
    const composedAspects = (runtime.composeRequests[0]?.extraction.informationRequests ?? []).flatMap(
      (request) => request.kind === 'purchase' ? request.aspects : [],
    );
    expect(composedAspects).toContain('payment_details');
    const evidence = projectCompletedPurchaseForModel(taskResult as never, {
      requestedAspects: composedAspects as PurchaseAspect[],
    }) as { outcome: { order: { paymentAt: string; eventDate: string } } };
    expect(evidence.outcome.order.paymentAt).toBe('2026-08-19 05:00:00');
    expect(evidence.outcome.order.eventDate).toBe('2026-08-19 17:00:00');
  });

  it('acknowledges an absent payment time as unknown instead of inferring it', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [order({ payment: null })],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_details'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.paymentAt).toBeNull();
    const model = projectPurchaseReplyForModel(outcome) as Record<string, unknown>;
    expect(model.order).not.toHaveProperty('paymentAt');
  });

  it('coerces payment-time aspects to the gift route and keeps status-only on orders', async () => {
    const seen: Array<{ requests?: Array<{ kind?: string; resource?: string; aspects?: string[]; query?: string }> }> = [];
    const store = new InMemoryPlanStore();
    await store.save({
      plan: createEmptyPlan({ planId: 'p-c-route', channel: 'whatsapp', externalUserId: 'u-c-route' }),
      reason: 'seed',
    });
    const purchase = {
      ...pendingYapeResult().purchases[0],
      payment: { method: null, amount: null, paidAt: '2026-08-30 21:31:00' },
    };
    const taskResult = { ...pendingYapeResult(), purchases: [purchase] };
    const service = new AgentService({
      planStore: store,
      runtime: new RecordingRuntime([
        {
          ...infoExtraction(['payment_details']),
          informationRequests: [{
            kind: 'purchase',
            resource: 'orders',
            query: '¿A qué hora se hizo el pago de mi regalo?',
            orderId: null,
            aspects: ['payment_details'],
            sensitiveFields: [],
            authAction: 'none',
          }],
        } as unknown as ExtractionResult,
      ]),
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: takeoverGateway(),
      informationOrchestrator: {
        async execute(input: { requests?: Array<{ kind?: string }> }) {
          seen.push(input);
          return { results: [taskResult], summaries: [] };
        },
      } as never,
      promptLoader,
      renderers,
    });
    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'u-c-route',
      text: '¿A qué hora se hizo el pago de mi regalo?',
      messageId: 'm-u-c-route',
      receivedAt: '2026-09-04T15:01:00.000Z',
      contactPhone: '+51938389389',
    });
    const sent = seen[0]?.requests?.find((request) => request.kind === 'purchase');
    expect(sent?.aspects).toContain('payment_details');
    expect(sent?.resource).toBe('gift_purchases');
  });

  it('leaves a genuine status-only request on orders without payment details', async () => {
    const seen: Array<{ requests?: Array<{ kind?: string; resource?: string; aspects?: string[] }> }> = [];
    const store = new InMemoryPlanStore();
    await store.save({
      plan: createEmptyPlan({ planId: 'p-c-status', channel: 'whatsapp', externalUserId: 'u-c-status' }),
      reason: 'seed',
    });
    const service = new AgentService({
      planStore: store,
      runtime: new RecordingRuntime([
        infoExtraction(['summary', 'payment_status', 'shipping']),
      ]),
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: takeoverGateway(),
      informationOrchestrator: {
        async execute(input: { requests?: Array<{ kind?: string }> }) {
          seen.push(input);
          return { results: [pendingYapeResult()], summaries: [] };
        },
      } as never,
      promptLoader,
      renderers,
    });
    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'u-c-status',
      text: '¿Cuál es el estado de mi pedido?',
      messageId: 'm-u-c-status',
      receivedAt: '2026-09-04T15:01:00.000Z',
      contactPhone: '+51938389389',
    });
    const sent = seen[0]?.requests?.find((request) => request.kind === 'purchase');
    expect(sent?.resource).toBe('orders');
    expect(sent?.aspects).not.toContain('payment_details');
  });

  it('withholds the payment time from status-only projections', () => {
    const timed = order({
      payment: { method: 'Transferencia', amount: 227.76, paidAt: '2026-08-30 21:31:00' },
    });
    const timedOutcome = selectPurchaseReplyOutcome({
      purchases: [timed],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_details'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(timedOutcome.kind).toBe('order_unique');
    if (timedOutcome.kind !== 'order_unique') return;
    expect(timedOutcome.order.paymentAt).toBe('2026-08-30 21:31:00');
    const statusOutcome = selectPurchaseReplyOutcome({
      purchases: [timed],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: aspects('summary', 'payment_status'),
      referenceAuthorized: false,
      userReported: {},
    });
    expect(statusOutcome.kind).toBe('order_unique');
    if (statusOutcome.kind !== 'order_unique') return;
    expect(statusOutcome.order.paymentAt).toBeNull();
  });
});
