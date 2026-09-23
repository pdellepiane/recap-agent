import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  hasActivePurchaseThread,
  purchaseThreadBypassesContextualClarification,
  purchaseThreadSuppressesHealthOffer,
} from '../src/runtime/conversation-continuity-policy';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { unavailableCustomerContext } from './customer-context-test-utils';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

const emptyExtractionBase = {
  actionIntent: null,
  informationRequests: [],
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
  conversationSummary: 'Consulta de compra en curso.',
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

function seedPurchasePlan(planId: string) {
  return mergePlan(
    createEmptyPlan({ planId, channel: 'whatsapp', externalUserId: 'u-f3a' }),
    {
      current_node: 'resolver_consultas_informativas',
      contact_phone: '+51982340340',
      contact_phone_extension: '+51',
      contact_phone_number: '982340340',
      information_state: {
        resume_node: null,
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: {
          kind: 'purchase',
          resource: 'orders',
          query: 'Quiero continuar el checkout',
          orderId: null,
          authAction: 'none',
        },
      },
    },
  );
}

describe('F3a purchase thread continuity helpers', () => {
  it('detects an active purchase thread from pending requests', () => {
    expect(
      hasActivePurchaseThread({
        hasPendingPurchaseOrEventRequest: true,
        lastCompletedKind: null,
      }),
    ).toBe(true);
  });

  it('detects an active purchase thread from last completed purchase', () => {
    expect(
      hasActivePurchaseThread({
        hasPendingPurchaseOrEventRequest: false,
        lastCompletedKind: 'purchase',
      }),
    ).toBe(true);
  });

  it('detects an active purchase thread from last completed event', () => {
    expect(
      hasActivePurchaseThread({
        hasPendingPurchaseOrEventRequest: false,
        lastCompletedKind: 'associated_event',
      }),
    ).toBe(true);
  });

  it('reports no purchase thread for faq-only state', () => {
    expect(
      hasActivePurchaseThread({
        hasPendingPurchaseOrEventRequest: false,
        lastCompletedKind: 'faq',
      }),
    ).toBe(false);
    expect(
      hasActivePurchaseThread({
        hasPendingPurchaseOrEventRequest: false,
        lastCompletedKind: null,
      }),
    ).toBe(false);
  });

  it('suppresses the health help offer on an active purchase thread', () => {
    expect(
      purchaseThreadSuppressesHealthOffer({
        hasActivePurchaseThread: true,
        humanEscalationRequested: false,
      }),
    ).toBe(true);
  });

  it('keeps the health offer when escalation was already requested', () => {
    expect(
      purchaseThreadSuppressesHealthOffer({
        hasActivePurchaseThread: true,
        humanEscalationRequested: true,
      }),
    ).toBe(false);
  });

  it('keeps the health offer without a purchase thread', () => {
    expect(
      purchaseThreadSuppressesHealthOffer({
        hasActivePurchaseThread: false,
        humanEscalationRequested: false,
      }),
    ).toBe(false);
  });

  it('bypasses generic clarification on a purchase thread', () => {
    expect(purchaseThreadBypassesContextualClarification('purchase')).toBe(true);
    expect(purchaseThreadBypassesContextualClarification('associated_event')).toBe(true);
    expect(purchaseThreadBypassesContextualClarification('faq')).toBe(false);
    expect(purchaseThreadBypassesContextualClarification(null)).toBe(false);
  });
});

describe('F3a purchase thread stays in information flow', () => {
  it('replays the purchase instead of generic clarification on empty follow-up', async () => {
    const store = new InMemoryPlanStore();
    await store.save({ plan: seedPurchasePlan('p-f3a-alex'), reason: 'seed' });
    const execute = vi.fn(async () => ({
      results: [
        {
          requestId: 'information-1',
          kind: 'purchase',
          status: 'completed',
          resource: 'orders',
          purchases: [],
          carts: [],
          needsSelection: false,
          accessMethod: 'trusted_phone_purchase',
          coverage: 'complete',
        },
      ],
      summaries: [],
    }));
    const composeReply = vi.fn(async () => ({
      text: 'continuacion de compra',
      structuredMessage: { type: 'generic', paragraphs_es: ['continuacion de compra'] },
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
    };
    const service = new AgentService({
      planStore: store,
      runtime: {
        async extract(): Promise<ExtractionResult> {
          return emptyExtractionBase;
        },
        async extractAlt(): Promise<never> {
          throw new Error('unused');
        },
        composeReply,
      } as unknown as AgentRuntime,
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
      informationOrchestrator: { prepareCustomerContext: unavailableCustomerContext, execute } as never,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'u-f3a',
      text: 'El carrito sigue activo, no es un pedido nuevo.',
      messageId: 'm-f3a-1',
      receivedAt: '2026-09-04T15:01:00.000Z',
      contactPhone: '+51982340340',
    });
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    expect(execute).toHaveBeenCalled();
  });

  it('continues the purchase on a user detail report instead of generic ack', async () => {
    const store = new InMemoryPlanStore();
    await store.save({ plan: seedPurchasePlan('p-f3a-claudia'), reason: 'seed' });
    const execute = vi.fn(async () => ({
      results: [
        {
          requestId: 'information-1',
          kind: 'purchase',
          status: 'completed',
          resource: 'orders',
          purchases: [],
          carts: [],
          needsSelection: false,
          accessMethod: 'trusted_phone_purchase',
          coverage: 'complete',
        },
      ],
      summaries: [],
    }));
    const extractionWithDetail: ExtractionResult = {
      ...emptyExtractionBase,
      supportAct: {
        kind: 'provide_detail',
        eventReference: 'Claudia and Luis Felipe',
        personReference: null,
      },
    } as unknown as ExtractionResult;
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
    };
    const service = new AgentService({
      planStore: store,
      runtime: {
        async extract(): Promise<ExtractionResult> {
          return extractionWithDetail;
        },
        async composeReply() {
          return {
            text: 'continuacion de compra con reporte',
            structuredMessage: {
              type: 'generic',
              paragraphs_es: ['continuacion de compra con reporte'],
            },
          };
        },
      } as unknown as AgentRuntime,
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
      informationOrchestrator: { prepareCustomerContext: unavailableCustomerContext, execute } as never,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'u-f3a',
      text: 'Ademas, lo hice el 30 de agosto a las 9:31 p. m.',
      messageId: 'm-f3a-2',
      receivedAt: '2026-09-04T15:02:00.000Z',
      contactPhone: '+51982340340',
    });
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    expect(execute).toHaveBeenCalled();
  });
});
