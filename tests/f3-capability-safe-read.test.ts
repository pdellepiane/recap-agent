import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  renderVoucherContinuityReply,
  resolveCapabilityPurchaseContinuation,
} from '../src/runtime/purchase-reply-projector';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type { PendingInformationRequest } from '../src/core/information';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan } from '../src/core/plan';

describe('F3c capability purchase continuation', () => {
  it('selects among gift records for a dedication change without mutating', () => {
    const text = resolveCapabilityPurchaseContinuation({
      operation: 'purchase.modify',
      results: [
        {
          requestId: 'capability-status-read',
          kind: 'purchase',
          status: 'completed',
          resource: 'gift_purchases',
          purchases: [
            {
              orderId: 'order-joaquin-frozen-01',
              paymentStatus: 'pending',
              shippingStatus: null,
              grandTotal: 120.0,
              paymentMethod: 'Transferencia',
              eventName: 'Chiara Vittoria',
              eventDate: '2026-09-10',
              eventUrl: null,
              createdAt: '2026-09-03 11:00:00',
              items: [],
              payment: { method: 'Transferencia', amount: 120.0, paidAt: '2026-09-03 11:00:00' },
              currency: null,
            },
            {
              orderId: 'order-joaquin-frozen-02',
              paymentStatus: 'approved',
              shippingStatus: null,
              grandTotal: 95.5,
              paymentMethod: 'Transferencia',
              eventName: 'Chiara Vittoria',
              eventDate: '2026-08-10',
              eventUrl: null,
              createdAt: '2026-08-10 11:00:00',
              items: [],
              payment: { method: 'Transferencia', amount: 95.5, paidAt: '2026-08-10 11:00:00' },
              currency: null,
            },
          ],
          needsSelection: true,
          accessMethod: 'trusted_phone_purchase',
          coverage: 'complete',
        },
      ],
      reportedAmount: null,
    });
    expect(text).not.toBeNull();
    expect(text as string).toContain('Chiara Vittoria');
    expect(text as string).toContain('120');
    expect(text as string).toContain('95.5');
    expect(text as string).toContain('?');
    expect(text as string).not.toMatch(/dedicatoria.*(cambiada|actualizada|lista)/i);
  });

  it('acknowledges a voucher report on a single pending order without claiming validation', () => {
    const text = resolveCapabilityPurchaseContinuation({
      operation: 'purchase.modify',
      results: [
        {
          requestId: 'capability-status-read',
          kind: 'purchase',
          status: 'completed',
          resource: 'orders',
          purchases: [
            {
              orderId: 'order-luis-pending-227',
              paymentStatus: 'pending',
              shippingStatus: null,
              grandTotal: 227.76,
              paymentMethod: 'Yape_o_Plin',
              eventName: 'Alejandra',
              eventDate: '2026-09-20',
              eventUrl: null,
              createdAt: '2026-08-27 15:00:00',
              items: [],
              payment: { method: 'Yape_o_Plin', amount: 227.76, paidAt: '2026-08-27 15:00:00' },
              currency: null,
            },
          ],
          needsSelection: false,
          accessMethod: 'trusted_phone_purchase',
          coverage: 'complete',
        },
      ],
      reportedAmount: 13.76,
    });
    expect(text).not.toBeNull();
    expect(text as string).toContain('13.76');
    expect(text as string).toContain('pendiente');
    expect(text as string).toContain('72 horas');
    expect(text as string).not.toMatch(/validado|aprobado/i);
  });

  it('returns null when the safe read has no usable purchase evidence', () => {
    expect(
      resolveCapabilityPurchaseContinuation({
        operation: 'purchase.modify',
        results: [],
        reportedAmount: null,
      }),
    ).toBeNull();
    expect(
      resolveCapabilityPurchaseContinuation({
        operation: 'payment_proof.verify',
        results: [],
        reportedAmount: null,
      }),
    ).toBeNull();
  });

  it('renders voucher continuity deterministically', () => {
    const text = renderVoucherContinuityReply({ reportedAmount: 13.76, eventName: 'Alejandra' });
    expect(text).toContain('13.76');
    expect(text).toContain('Alejandra');
    expect(text).toContain('72 horas');
    const generic = renderVoucherContinuityReply({ reportedAmount: null, eventName: null });
    expect(generic).toContain('comprobante');
    expect(generic).toContain('pendiente');
  });

  it('continues a voucher report on payment_proof.verify without handoff', () => {
    const text = resolveCapabilityPurchaseContinuation({
      operation: 'payment_proof.verify',
      results: [
        {
          requestId: 'capability-status-read',
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
              payment: null,
              currency: null,
              amountDisclosure: {
                total: 227.76,
                paid: null,
                currency: null,
                paymentMethod: 'Yape_o_Plin',
                presentation: 'recorded_method_no_currency' as const,
              },
            },
          ],
          needsSelection: false,
          accessMethod: 'trusted_phone_purchase',
          coverage: 'complete',
        },
      ],
      reportedAmount: 13.76,
    });
    expect(text).not.toBeNull();
    expect(text as string).toContain('13.76');
    expect(text as string).toContain('pendiente');
    expect(text as string).toContain('72 horas');
    expect(text as string).not.toMatch(/apoyo humano/i);
  });
});

function modifyExtraction(
  aspects: string[],
  amount: number | null,
): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: 'purchase.modify',
    informationRequests:
      aspects.length > 0
        ? [
            {
              kind: 'purchase',
              resource: 'orders',
              query: 'cambiar la dedicatoria',
              orderId: null,
              aspects,
              sensitiveFields: [],
              authAction: 'none',
              amount,
            },
          ]
        : [],
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
    conversationSummary: 'Cambio de dedicatoria.',
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

async function runModifyTurn(options: {
  externalUserId: string;
  text: string;
  contactPhone: string;
  extraction: ExtractionResult;
  purchaseResult: Record<string, unknown>;
  summary: Record<string, unknown>;
  pendingPurchaseRequest?: PendingInformationRequest;
}) {
  const store = new InMemoryPlanStore();
  const seedPlan = createEmptyPlan({
    planId: `p-${options.externalUserId}`,
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
  });
  await store.save({
    plan: options.pendingPurchaseRequest
      ? {
        ...seedPlan,
        information_state: {
          ...seedPlan.information_state,
          pending_requests: [options.pendingPurchaseRequest],
        },
      }
      : seedPlan,
    reason: 'seed',
  });
  const execute = vi.fn(async () => ({
    results: [options.purchaseResult],
    summaries: [options.summary],
  }));
  const gateway = {
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
  const service = new AgentService({
    planStore: store,
    runtime: {
      async extract(): Promise<ExtractionResult> {
        return options.extraction;
      },
      async composeReply() {
        throw new Error('model reply must not be used on safe-read continuation');
      },
    } as unknown as AgentRuntime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    informationOrchestrator: { execute } as never,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  const result = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
    text: options.text,
    messageId: `m-${options.externalUserId}`,
    receivedAt: '2026-09-04T15:01:00.000Z',
    contactPhone: options.contactPhone,
  });
  return { result, execute };
}

describe('F3c safe read precedes the unsupported mutation handoff', () => {
  it('reads gift purchases and asks for selection on a dedication change', async () => {
    const giftResult = {
      requestId: 'capability-status-read',
      kind: 'purchase',
      status: 'completed',
      resource: 'gift_purchases',
      purchases: [
        {
          orderId: 'order-joaquin-frozen-01',
          paymentStatus: 'pending',
          shippingStatus: null,
          grandTotal: 120.0,
          paymentMethod: 'Transferencia',
          eventName: 'Chiara Vittoria',
          eventDate: '2026-09-10',
          eventUrl: null,
          createdAt: '2026-09-03 11:00:00',
          items: [],
          payment: { method: 'Transferencia', amount: 120.0, paidAt: '2026-09-03 11:00:00' },
          currency: null,
        },
        {
          orderId: 'order-joaquin-frozen-02',
          paymentStatus: 'approved',
          shippingStatus: null,
          grandTotal: 95.5,
          paymentMethod: 'Transferencia',
          eventName: 'Chiara Vittoria',
          eventDate: '2026-08-10',
          eventUrl: null,
          createdAt: '2026-08-10 11:00:00',
          items: [],
          payment: { method: 'Transferencia', amount: 95.5, paidAt: '2026-08-10 11:00:00' },
          currency: null,
        },
      ],
      needsSelection: true,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
    };
    const { result, execute } = await runModifyTurn({
      externalUserId: 'u-f3c-joaquin',
      text: 'Quisiera cambiar la dedicatoria de un regalo para Chiara Vittoria.',
      contactPhone: '+51926857444',
      extraction: modifyExtraction(['summary', 'dedication'], null),
      purchaseResult: giftResult,
      summary: {
        requestId: 'capability-status-read',
        kind: 'purchase',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: false,
        queryHash: 'joaquin',
        evidence: [],
        resultCount: 2,
        durationMs: 1,
        accessMethod: 'trusted_phone_purchase',
        resource: 'gift_purchases',
      },
    });
    expect(execute).toHaveBeenCalled();
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const text = result.outbound.text ?? '';
    expect(text).toContain('Chiara Vittoria');
    expect(text).toContain('120');
    expect(text).toContain('?');
  });

  it('keeps a voucher report on the pending order without handoff', async () => {
    const orderResult = {
      requestId: 'capability-status-read',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [
        {
          orderId: 'order-luis-pending-227',
          paymentStatus: 'pending',
          shippingStatus: null,
          grandTotal: 227.76,
          paymentMethod: 'Yape_o_Plin',
          eventName: 'Alejandra',
          eventDate: '2026-09-20',
          eventUrl: null,
          createdAt: '2026-08-27 15:00:00',
          items: [],
          payment: { method: 'Yape_o_Plin', amount: 227.76, paidAt: '2026-08-27 15:00:00' },
          currency: null,
        },
      ],
      needsSelection: false,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
    };
    const { result, execute } = await runModifyTurn({
      externalUserId: 'u-f3c-luis',
      text: 'Ya envie los 13.76 que faltaban, tengo el voucher.',
      contactPhone: '+51938389389',
      extraction: modifyExtraction(['summary', 'payment_status'], 13.76),
      purchaseResult: orderResult,
      summary: {
        requestId: 'capability-status-read',
        kind: 'purchase',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: false,
        queryHash: 'luis',
        evidence: [],
        resultCount: 1,
        durationMs: 1,
        accessMethod: 'trusted_phone_purchase',
        resource: 'orders',
      },
    });
    expect(execute).toHaveBeenCalled();
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const text = result.outbound.text ?? '';
    expect(text).toContain('13.76');
    expect(text).toContain('pendiente');
    expect(text).toContain('72 horas');
  });

  it('reads gift purchases for purchase.modify even with a persisted orders request', async () => {
    const giftResult = {
      requestId: 'capability-status-read',
      kind: 'purchase',
      status: 'completed',
      resource: 'gift_purchases',
      purchases: [
        {
          orderId: 'order-joaquin-frozen-01',
          paymentStatus: 'pending',
          shippingStatus: null,
          grandTotal: 120.0,
          paymentMethod: 'Transferencia',
          eventName: 'Chiara Vittoria',
          eventDate: '2026-09-10',
          eventUrl: null,
          createdAt: '2026-09-03 11:00:00',
          items: [],
          payment: { method: 'Transferencia', amount: 120.0, paidAt: '2026-09-03 11:00:00' },
          currency: null,
        },
        {
          orderId: 'order-joaquin-frozen-02',
          paymentStatus: 'approved',
          shippingStatus: null,
          grandTotal: 95.5,
          paymentMethod: 'Transferencia',
          eventName: 'Chiara Vittoria',
          eventDate: '2026-08-10',
          eventUrl: null,
          createdAt: '2026-08-10 11:00:00',
          items: [],
          payment: { method: 'Transferencia', amount: 95.5, paidAt: '2026-08-10 11:00:00' },
          currency: null,
        },
      ],
      needsSelection: true,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
    };
    const { result, execute } = await runModifyTurn({
      externalUserId: 'u-f3c-joaquin-persisted',
      text: 'Quisiera cambiar la dedicatoria de un regalo para Chiara Vittoria.',
      contactPhone: '+51926857444',
      extraction: modifyExtraction(['summary', 'dedication'], null),
      purchaseResult: giftResult,
      summary: {
        requestId: 'capability-status-read',
        kind: 'purchase',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: false,
        queryHash: 'joaquin',
        evidence: [],
        resultCount: 2,
        durationMs: 1,
        accessMethod: 'trusted_phone_purchase',
        resource: 'gift_purchases',
      },
      pendingPurchaseRequest: {
        requestId: 'information-1',
        kind: 'purchase',
        resource: 'orders',
        query: 'cambiar la dedicatoria',
        orderId: null,
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      },
    });
    expect(execute).toHaveBeenCalled();
    const sentRequest = (execute.mock.calls[0] as Array<{ requests?: Array<{ resource?: unknown }> }>)[0]?.requests?.[0];
    expect(sentRequest?.resource).toBe('gift_purchases');
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const text = result.outbound.text ?? '';
    expect(text).toContain('Chiara Vittoria');
    expect(text).toContain('?');
  });
});
