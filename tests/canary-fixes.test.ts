import { describe, expect, it } from 'vitest';

import type {
  CartInformation,
  PendingInformationRequest,
  PurchaseInformation,
} from '../src/core/information';
import type {
  AgentConversationGateway,
  AgentPhonePurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import {
  areEventNamesEquivalent,
  eventMatches,
  normalizeEventTokens,
} from '../src/runtime/event-matching';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';

const EMPTY_ITEMS: PurchaseInformation['items'] = [];

function purchase(
  orderId: string,
  eventName: string,
  total: number,
): PurchaseInformation {
  return {
    orderId,
    partition: 'pending_orders',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: total,
    paymentMethod: 'Transferencia',
    eventName,
    eventDate: null,
    eventUrl: null,
    createdAt: null,
    items: EMPTY_ITEMS,
  };
}

function cart(eventName: string): CartInformation {
  return {
    cartId: 'cart-sonia-1',
    status: 'abandoned',
    wasAbandoned: true,
    eventId: null,
    eventName,
    eventDate: null,
    subtotal: 120,
    giftsQuantity: 1,
    createdAt: null,
    items: EMPTY_ITEMS,
  };
}

class PurchaseGateway implements AgentConversationGateway {
  constructor(private readonly result: AgentPhonePurchaseLookupResult) {}

  async logMessage() {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' } as const;
  }

  async getRecentMessages() {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' } as const;
  }

  async requestHumanTakeover() {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' } as const;
  }

  async authByPhone() {
    return { status: 'failed', error: 'not configured', retryable: false } as const;
  }

  async updatePhone() {
    return { status: 'success' } as const;
  }

  async getGuestOrdersByPhone(): Promise<AgentPhonePurchaseLookupResult> {
    return this.result;
  }

  async getGuestGiftPurchasesByPhone(): Promise<AgentPhonePurchaseLookupResult> {
    return { status: 'success', resource: 'gift_purchases', purchases: [] };
  }
}

const knowledgeGateway: KnowledgeRetrievalGateway = {
  async search() {
    return {
      status: 'failed',
      reason: 'not_configured',
      retryable: false,
      error: 'not configured',
    };
  },
};

function orchestrator(result: AgentPhonePurchaseLookupResult): InformationOrchestrator {
  return new InformationOrchestrator({
    knowledgeGateway,
    providerGateway: {} as ProviderGateway,
    agentGateway: new PurchaseGateway(result),
  });
}

function purchaseRequest(eventHint: string): PendingInformationRequest {
  return {
    requestId: 'purchase-request',
    kind: 'purchase',
    resource: 'orders',
    query: `Consulta para ${eventHint}`,
    orderId: null,
    eventHint,
    amount: null,
    aspects: ['payment_status'],
    sensitiveFields: [],
    authAction: 'none',
  };
}

describe('event identity matching canary fixes', () => {
  it('canonicalizes conjunction, punctuation, case, and accents', () => {
    expect(normalizeEventTokens('Claudia&Luis Félipe')).toEqual([
      'claudia',
      'and',
      'luis',
      'felipe',
    ]);
    expect(areEventNamesEquivalent(
      'Claudia & Luis Felipe',
      'Claudia and Luis Felipe',
    )).toBe(true);
    expect(areEventNamesEquivalent(
      'Carlos y Adriana',
      'Carlos and Adriana',
    )).toBe(true);
  });

  it('matches exact event tokens without substring false positives', () => {
    expect(eventMatches('Josué y Paola', 'Josue')).toBe(true);
    expect(eventMatches('Paolo & Mariana', 'Paolo Mariana')).toBe(true);
    expect(eventMatches('Mariana & Santiago', 'Ana')).toBe(false);
    expect(eventMatches('Samuel Josué', 'Josué y Paola')).toBe(false);
    expect(eventMatches('Claudia & Luis Felipe', 'y')).toBe(false);
  });

  it('selects the pending order when the fixture uses and and the user uses ampersand', async () => {
    const selected = purchase('ORD-CLAUDIA', 'Claudia and Luis Felipe', 1042.89);
    const execution = await orchestrator({
      status: 'success',
      resource: 'orders',
      purchases: [selected],
      orderPartitions: { pending: [selected], completed: [] },
      carts: [],
    }).execute({
      requests: [purchaseRequest('Claudia & Luis Felipe')],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '957212085' },
    });

    const result = execution.results[0];
    expect(result?.status).toBe('completed');
    if (result?.status === 'completed' && result.kind === 'purchase') {
      expect(result.purchases.map((candidate) => candidate.orderId)).toEqual([
        'ORD-CLAUDIA',
      ]);
    }
  });

  it('returns an event-matched cart as partial coverage instead of global not-found', async () => {
    const execution = await orchestrator({
      status: 'success',
      resource: 'orders',
      purchases: [],
      orderPartitions: { pending: [], completed: [] },
      carts: [cart('Carlos and Adriana')],
    }).execute({
      requests: [purchaseRequest('Carlos y Adriana')],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '965765765' },
    });

    const result = execution.results[0];
    expect(result?.status).toBe('completed');
    if (result?.status === 'completed' && result.kind === 'purchase') {
      expect(result.coverage).toBe('partial');
      expect(result.purchases).toEqual([]);
      expect(result.carts?.map((candidate) => candidate.cartId)).toEqual([
        'cart-sonia-1',
      ]);
    }
  });
});
