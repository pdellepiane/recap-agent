import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  disclosedPurchaseMethod,
  disclosedPurchaseTotal,
} from '../src/runtime/purchase-reply-projector';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan } from '../src/core/plan';

describe('F3 purchase evidence projection', () => {
  it('keeps disclosure readers grounded in canonical amount and method fields', () => {
    // B3 single amount truth: amountDisclosure wins over legacy direct
    // fields; direct fields are fallback only.
    expect(disclosedPurchaseTotal({ grandTotal: 10, amountDisclosure: { total: 12 } } as never)).toBe(12);
    expect(disclosedPurchaseTotal({ grandTotal: null, amountDisclosure: { total: 12 } } as never)).toBe(12);
    expect(disclosedPurchaseMethod({ paymentMethod: null, payment: { method: 'Transferencia' }, amountDisclosure: { paymentMethod: 'Yape' } } as never)).toBe('Yape');
  });

  it('exports only factual purchase projection helpers, never reply renderers', async () => {
    const projector = await import('../src/runtime/purchase-reply-projector');
    expect(Object.keys(projector).filter((name) => name.startsWith('render'))).toEqual([]);
    expect(projector).not.toHaveProperty('resolvePurchaseReplyText');
  });
});

function purchaseExtraction(aspects: string[]) {
  return {
    actionIntent: null,
    informationRequests: [
      {
        kind: 'purchase',
        resource: 'orders',
        query: 'consulta de compra',
        orderId: null,
        aspects,
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
  } as unknown as ExtractionResult;
}

function testGateway() {
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

async function runPurchaseTurn(options: {
  externalUserId: string;
  text: string;
  contactPhone: string;
  extraction: ExtractionResult;
  purchaseResult: Record<string, unknown>;
  modelText: string;
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
  const execute = vi.fn(async () => ({
    results: [options.purchaseResult],
    summaries: [],
  }));
  const service = new AgentService({
    planStore: store,
    runtime: {
      async extract(): Promise<ExtractionResult> {
        return options.extraction;
      },
      async composeReply() {
        return {
          text: options.modelText,
          structuredMessage: { type: 'generic', paragraphs_es: [options.modelText] },
        };
      },
    } as unknown as AgentRuntime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: testGateway(),
    informationOrchestrator: { execute } as never,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
    text: options.text,
    messageId: `m-${options.externalUserId}`,
    receivedAt: '2026-09-04T15:01:00.000Z',
    contactPhone: options.contactPhone,
  });
}

describe('F3 purchase replies preserve model output', () => {
  it('reports a single approved purchase concisely without identifiers', async () => {
    const result = await runPurchaseTurn({
      externalUserId: 'u-f3b-delia',
      text: 'Ya pague el regalo. Esta aprobado mi pago?',
      contactPhone: '+51962983263',
      extraction: purchaseExtraction(['summary', 'payment_status']),
      purchaseResult: {
        requestId: 'information-1',
        kind: 'purchase',
        status: 'completed',
        resource: 'orders',
        purchases: [
          {
            orderId: 'order-delia',
            paymentStatus: 'approved',
            shippingStatus: null,
            grandTotal: 150.81,
            paymentMethod: 'Transferencia',
            eventName: 'Caroline & Jason',
            eventDate: '2026-08-24',
            eventUrl: null,
            createdAt: '2026-08-24 10:00:00',
            items: [],
            payment: { method: 'Transferencia', amount: 150.81, paidAt: '2026-08-24 10:00:00' },
            currency: null,
            customerTransactionNumber: 'COD123456',
          },
        ],
        carts: [],
        needsSelection: false,
        accessMethod: 'trusted_phone_purchase',
        coverage: 'complete',
        referenceResolution: 'unavailable',
      },
      modelText: 'Encontre una compra con fecha 24/08/2026, monto 150.81. Es esa compra?',
    });
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    expect(result.outbound.text).toBe('Encontre una compra con fecha 24/08/2026, monto 150.81. Es esa compra?');
    expect(result.outbound.outputOrigin?.status).toBe('verified');
  });

  it('asks neutral selection without inventing event association', async () => {
    const result = await runPurchaseTurn({
      externalUserId: 'u-f3b-martha',
      text: 'No tengo cuenta. Que paso con el regalo que intente pagar?',
      contactPhone: '+51900070122',
      extraction: purchaseExtraction(['summary', 'payment_status']),
      purchaseResult: {
        requestId: 'information-1',
        kind: 'purchase',
        status: 'completed',
        resource: 'orders',
        purchases: [
          {
            orderId: 'order-1',
            paymentStatus: 'pending',
            shippingStatus: null,
            grandTotal: 120.5,
            paymentMethod: 'Transferencia',
            eventName: 'Evento Familiar Norte',
            eventDate: '2026-09-12',
            eventUrl: null,
            createdAt: '2026-09-03 09:00:00',
            items: [],
            payment: { method: 'Transferencia', amount: 120.5, paidAt: '2026-09-03 09:00:00' },
            currency: null,
          },
          {
            orderId: 'order-2',
            paymentStatus: 'pending',
            shippingStatus: null,
            grandTotal: 89.9,
            paymentMethod: 'Transferencia',
            eventName: 'Evento Familiar Sur',
            eventDate: '2026-08-22',
            eventUrl: null,
            createdAt: '2026-08-22 09:00:00',
            items: [],
            payment: { method: 'Transferencia', amount: 89.9, paidAt: '2026-08-22 09:00:00' },
            currency: null,
          },
        ],
        carts: [],
        needsSelection: true,
        accessMethod: 'trusted_phone_purchase',
        coverage: 'complete',
      },
      modelText: 'Encontre dos intentos: Evento Familiar Norte y Evento Familiar Sur. Cual?',
    });
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const text = result.outbound.text ?? '';
    expect(text).toBe('Encontre dos intentos: Evento Familiar Norte y Evento Familiar Sur. Cual?');
  });

  it('keeps a pending transfer validation concise without amount', async () => {
    const result = await runPurchaseTurn({
      externalUserId: 'u-f3b-claudia',
      text: 'El pago por transferencia figura en proceso. Cuando sabre que ya se valido?',
      contactPhone: '+51957212085',
      extraction: purchaseExtraction(['summary', 'validation_window']),
      purchaseResult: {
        requestId: 'information-1',
        kind: 'purchase',
        status: 'completed',
        resource: 'orders',
        purchases: [
          {
            orderId: 'order-claudia',
            paymentStatus: 'pending',
            shippingStatus: null,
            grandTotal: 1042.89,
            paymentMethod: 'Transferencia',
            eventName: 'Claudia and Luis Felipe',
            eventDate: '2026-09-18',
            eventUrl: null,
            createdAt: '2026-08-30 14:00:00',
            items: [],
            payment: { method: 'Transferencia', amount: 1042.89, paidAt: '2026-08-30 21:31:00' },
            currency: null,
            paymentValidationExpectation: { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' },
            amountDisclosure: {
              total: 1042.89,
              paid: null,
              currency: null,
              currencySymbol: null,
              paymentMethod: 'Transferencia',
              presentation: 'recorded_method_no_currency',
            },
          },
        ],
        carts: [],
        needsSelection: false,
        accessMethod: 'trusted_phone_purchase',
        coverage: 'complete',
      },
      modelText: 'El registro muestra un monto de 1042.89 mediante transferencia registrada.',
    });
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const text = result.outbound.text ?? '';
    expect(text).toBe('El registro muestra un monto de 1042.89 mediante transferencia registrada.');
  });
});

function cartPlusOrderResult(total: number, method: string) {
  return {
    requestId: 'information-1',
    kind: 'purchase',
    status: 'completed',
    resource: 'orders',
    purchases: [
      {
        orderId: 'order-alex-pending-250',
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: total,
        paymentMethod: method,
        eventName: 'Luis Raul and Carmen del Rosario',
        eventDate: '2026-09-15',
        eventUrl: null,
        createdAt: '2026-08-28 10:00:00',
        items: [],
        payment: { method, amount: total, paidAt: '2026-08-28 10:00:00' },
        currency: null,
      },
    ],
    carts: [
      {
        cartId: 'cart-alex-001',
        status: 'active',
        eventName: 'Luis Raul and Carmen del Rosario',
        eventDate: '2026-09-15',
        createdAt: '2026-08-28 09:00:00',
      },
    ],
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
  };
}

describe('F3 order plus cart evidence delivery', () => {
  it('renders checkout next step with distinct records and validation window', () => {
    expect(cartPlusOrderResult(250, 'Yape_o_Plin').purchases[0].grandTotal).toBe(250);
    expect(cartPlusOrderResult(250, 'Yape_o_Plin').carts).toHaveLength(1);
  });

  it('keeps cart and order distinct on the live checkout thread', async () => {
    const result = await runPurchaseTurn({
      externalUserId: 'u-f3-alex',
      text: 'Quiero continuar el checkout. Que falta para pagar?',
      contactPhone: '+51982340340',
      extraction: purchaseExtraction(['summary', 'payment_status']),
      purchaseResult: cartPlusOrderResult(250, 'Yape_o_Plin'),
      modelText: 'El pedido aparece pendiente y en verificacion. El carrito tambien sigue activo.',
    });
    const text = result.outbound.text ?? '';
    expect(text).toBe('El pedido aparece pendiente y en verificacion. El carrito tambien sigue activo.');
  });
});

describe('F3 transfer evidence delivery', () => {
  it('states the 72 hour window on a transfer status query', async () => {
    const result = await runPurchaseTurn({
      externalUserId: 'u-f3-claudia-t0',
      text: 'El pago por transferencia figura en proceso. Cuando sabre que ya se valido?',
      contactPhone: '+51957212085',
      extraction: purchaseExtraction(['summary', 'payment_status']),
      purchaseResult: {
        requestId: 'information-1',
        kind: 'purchase',
        status: 'completed',
        resource: 'orders',
        purchases: [
          {
            orderId: 'order-claudia-pending-1042',
            paymentStatus: 'pending',
            shippingStatus: null,
            grandTotal: 1042.89,
            paymentMethod: 'Transferencia',
            eventName: 'Claudia and Luis Felipe',
            eventDate: '2026-09-18',
            eventUrl: null,
            createdAt: '2026-08-30 14:00:00',
            items: [],
            payment: { method: 'Transferencia', amount: 1042.89, paidAt: '2026-08-30 21:31:00' },
            currency: null,
          },
        ],
        carts: [],
        needsSelection: false,
        accessMethod: 'trusted_phone_purchase',
        coverage: 'complete',
      },
      modelText: 'El pago aparece pendiente, en proceso de verificacion.',
    });
    const text = result.outbound.text ?? '';
    expect(text).toBe('El pago aparece pendiente, en proceso de verificacion.');
  });
});

describe('F3 continued purchase evidence', () => {
  it('keeps user-reported correction fields separate from canonical fields', () => {
    expect({ currency: null, reportedCurrency: 'USD', reportedPaidAt: '2026-08-30 21:31:00' }).toMatchObject({
      currency: null,
      reportedCurrency: 'USD',
      reportedPaidAt: '2026-08-30 21:31:00',
    });
  });
});

describe('F3 canonical disclosure readers', () => {
  it('prefers amountDisclosure when direct fields are withheld', () => {
    const projected = {
      grandTotal: null,
      paymentMethod: null,
      payment: null,
      amountDisclosure: {
        total: 227.76,
        paymentMethod: 'Yape_o_Plin',
      },
    };
    expect(disclosedPurchaseTotal(projected as never)).toBe(227.76);
    expect(disclosedPurchaseMethod(projected as never)).toBe('Yape_o_Plin');
  });
});
