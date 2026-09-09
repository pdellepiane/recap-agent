import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  disclosedPurchaseMethod,
  disclosedPurchaseTotal,
  renderConciseApprovedStatus,
  renderConciseTransferValidation,
  renderNeutralPurchaseSelection,
  renderOrderPlusCartCheckout,
  renderPendingCorrectionGrounding,
  shouldRenderConciseApprovedStatus,
  shouldRenderConciseTransferValidation,
  shouldRenderNeutralSelection,
  shouldRenderOrderPlusCartCheckout,
  shouldRenderPendingCorrectionGrounding,
  shouldRenderTransferValidationForStatusQuery,
} from '../src/runtime/purchase-reply-projector';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan } from '../src/core/plan';

describe('F3b purchase truthfulness predicates', () => {
  it('renders concise approved status for a single approved record without linked reference', () => {
    expect(
      shouldRenderConciseApprovedStatus({
        purchaseCount: 1,
        paymentStatus: 'approved',
        referenceResolution: 'unavailable',
      }),
    ).toBe(true);
    expect(renderConciseApprovedStatus('Caroline & Jason')).toBe(
      'Tu regalo para Caroline & Jason ya quedó aprobado.',
    );
  });

  it('keeps the model path for multiple or non-approved records', () => {
    expect(
      shouldRenderConciseApprovedStatus({
        purchaseCount: 2,
        paymentStatus: 'approved',
        referenceResolution: 'unavailable',
      }),
    ).toBe(false);
    expect(
      shouldRenderConciseApprovedStatus({
        purchaseCount: 1,
        paymentStatus: 'pending',
        referenceResolution: 'unavailable',
      }),
    ).toBe(false);
    expect(
      shouldRenderConciseApprovedStatus({
        purchaseCount: 1,
        paymentStatus: 'approved',
        referenceResolution: 'matched',
      }),
    ).toBe(false);
  });

  it('renders neutral selection without event association when no guest event exists', () => {
    expect(
      shouldRenderNeutralSelection({ purchaseCount: 2, hasAssociatedGuestEvent: false }),
    ).toBe(true);
    expect(
      shouldRenderNeutralSelection({ purchaseCount: 2, hasAssociatedGuestEvent: true }),
    ).toBe(false);
    expect(
      shouldRenderNeutralSelection({ purchaseCount: 1, hasAssociatedGuestEvent: false }),
    ).toBe(false);
    const text = renderNeutralPurchaseSelection([
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
    ]);
    expect(text).not.toContain('Evento Familiar');
    expect(text).toContain('120.5');
    expect(text).toContain('89.9');
    expect(text).toContain('pendiente');
    expect(text).toContain('?');
  });

  it('renders concise transfer validation without amount for currency-less transfer', () => {
    expect(
      shouldRenderConciseTransferValidation({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Transferencia',
        currency: null,
        requestedAspects: ['summary', 'validation_window'],
      }),
    ).toBe(true);
    expect(
      shouldRenderConciseTransferValidation({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Yape_o_Plin',
        currency: null,
        requestedAspects: ['summary', 'validation_window'],
      }),
    ).toBe(false);
    expect(
      shouldRenderConciseTransferValidation({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Transferencia',
        currency: null,
        requestedAspects: ['summary', 'payment_details'],
      }),
    ).toBe(false);
    const text = renderConciseTransferValidation('Claudia and Luis Felipe');
    expect(text).toContain('pendiente');
    expect(text).toContain('72 horas');
    expect(text).not.toMatch(/1042/);
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

describe('F3b deterministic purchase replies', () => {
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
    expect(result.outbound.text).toContain('Tu regalo para Caroline & Jason ya quedó aprobado');
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
    expect(text).not.toContain('Evento Familiar');
    expect(text).toContain('120.5');
    expect(text).toContain('89.9');
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
    expect(text).toContain('72 horas');
    expect(text).not.toMatch(/1042/);
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

describe('F3 order plus cart checkout continuity', () => {
  it('renders checkout next step with distinct records and validation window', () => {
    expect(
      shouldRenderOrderPlusCartCheckout({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Yape_o_Plin',
        cartCount: 1,
        needsSelection: false,
        reportedAmount: null,
      }),
    ).toBe(true);
    expect(
      shouldRenderOrderPlusCartCheckout({
        purchaseCount: 1,
        paymentStatus: 'approved',
        paymentMethod: 'Yape_o_Plin',
        cartCount: 1,
        needsSelection: false,
        reportedAmount: null,
      }),
    ).toBe(false);
    expect(
      shouldRenderOrderPlusCartCheckout({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Yape_o_Plin',
        cartCount: 0,
        needsSelection: false,
        reportedAmount: null,
      }),
    ).toBe(false);
    expect(
      shouldRenderOrderPlusCartCheckout({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Yape_o_Plin',
        cartCount: 1,
        needsSelection: false,
        reportedAmount: 13.76,
      }),
    ).toBe(false);
    const text = renderOrderPlusCartCheckout({
      eventName: 'Luis Raul and Carmen del Rosario',
      total: 250,
      paymentMethod: 'Yape_o_Plin',
    });
    expect(text).toContain('250');
    expect(text).toContain('Yape o Plin');
    expect(text).not.toMatch(/S\/|PEN|soles/);
    expect(text).toContain('registro distinto');
    expect(text).toContain('checkout');
    expect(text).toContain('72 horas');
    expect(text).toContain('saldo');
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
    expect(text).toContain('checkout');
    expect(text).toContain('registro distinto');
    expect(text).toContain('250');
    expect(text).not.toContain('El carrito tambien sigue activo.');
  });
});

describe('F3 transfer validation on status-only queries', () => {
  it('fires without an explicit validation_window aspect', () => {
    expect(
      shouldRenderTransferValidationForStatusQuery({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Transferencia',
        currency: null,
        requestedAspects: ['summary', 'payment_status'],
        reportedAmount: null,
      }),
    ).toBe(true);
    expect(
      shouldRenderTransferValidationForStatusQuery({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Transferencia',
        currency: null,
        requestedAspects: ['summary', 'payment_details'],
        reportedAmount: null,
      }),
    ).toBe(false);
    expect(
      shouldRenderTransferValidationForStatusQuery({
        purchaseCount: 1,
        paymentStatus: 'pending',
        paymentMethod: 'Yape_o_Plin',
        currency: null,
        requestedAspects: ['summary', 'payment_status'],
        reportedAmount: null,
      }),
    ).toBe(false);
  });

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
    expect(text).toContain('72 horas');
  });
});

describe('F3 pending correction grounding on continuations', () => {
  it('grounds user-reported currency and time on a continued thread', () => {
    expect(
      shouldRenderPendingCorrectionGrounding({
        purchaseCount: 1,
        paymentStatus: 'pending',
        currency: null,
        isContinuedThread: true,
        reportedAmount: null,
      }),
    ).toBe(true);
    expect(
      shouldRenderPendingCorrectionGrounding({
        purchaseCount: 1,
        paymentStatus: 'pending',
        currency: null,
        isContinuedThread: false,
        reportedAmount: null,
      }),
    ).toBe(false);
    const text = renderPendingCorrectionGrounding('Claudia and Luis Felipe');
    expect(text).toContain('pendiente');
    expect(text).toContain('moneda');
    expect(text).toContain('zona horaria');
  });
});

describe('F3 canonical disclosure readers', () => {
  it('prefers amountDisclosure when projection nulls direct fields', () => {
    const projected = {
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
      payment: null,
      currency: null,
      amountDisclosure: {
        total: 227.76,
        paid: null,
        currency: null,
        currencySymbol: null,
        paymentMethod: 'Yape_o_Plin',
        presentation: 'recorded_method_no_currency' as const,
      },
    };
    expect(disclosedPurchaseTotal(projected)).toBe(227.76);
    expect(disclosedPurchaseMethod(projected)).toBe('Yape_o_Plin');
    expect(
      shouldRenderOrderPlusCartCheckout({
        purchaseCount: 1,
        paymentStatus: projected.paymentStatus,
        paymentMethod: disclosedPurchaseMethod(projected),
        cartCount: 1,
        needsSelection: false,
        reportedAmount: null,
      }),
    ).toBe(true);
    const text = renderOrderPlusCartCheckout({
      eventName: projected.eventName,
      total: disclosedPurchaseTotal(projected),
      paymentMethod: disclosedPurchaseMethod(projected),
    });
    expect(text).toContain('227.76');
    expect(text).toContain('Yape o Plin');
  });
});
