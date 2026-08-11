import { describe, expect, it } from 'vitest';

import type {
  PendingInformationRequest,
  PurchaseInformation,
} from '../src/core/information';
import type {
  AgentConversationGateway,
  AgentPurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import {
  canDisclosePaymentDestination,
  hasPhysicalFulfillment,
} from '../src/runtime/purchase-disclosure-policy';

describe('purchase disclosure policy', () => {
  it('allows destination account details only for a pending purchase', () => {
    expect(canDisclosePaymentDestination(purchase({ paymentStatus: 'pending' }))).toBe(true);
    expect(canDisclosePaymentDestination(purchase({ paymentStatus: 'approved' }))).toBe(false);
    expect(canDisclosePaymentDestination(purchase({ paymentStatus: null }))).toBe(false);
  });

  it('requires affirmative physical-fulfillment evidence before exposing shipping', () => {
    expect(hasPhysicalFulfillment(purchase({ paymentStatus: 'approved', itemType: 'cash' }))).toBe(false);
    expect(hasPhysicalFulfillment(purchase({ paymentStatus: 'approved', itemType: null }))).toBe(false);
    expect(hasPhysicalFulfillment(purchase({ paymentStatus: 'approved', itemType: 'product' }))).toBe(true);
    expect(
      hasPhysicalFulfillment(
        purchase({ paymentStatus: 'approved', itemType: 'cash', sendPhysical: true }),
      ),
    ).toBe(true);
  });

  it('removes destination accounts and shipping before non-qualifying evidence reaches the reply model', async () => {
    const approvedCashPurchase = purchase({
      paymentStatus: 'approved',
      itemType: 'cash',
    });
    const result = await executePurchase(approvedCashPurchase);

    expect(result.shippingStatus).toBeNull();
    expect(result.payment?.destinationAccount).toBeUndefined();
  });

  it('preserves destination and shipping evidence for a pending physical purchase', async () => {
    const pendingPhysicalPurchase = purchase({
      paymentStatus: 'pending',
      itemType: 'product',
    });
    const result = await executePurchase(pendingPhysicalPurchase);

    expect(result.shippingStatus).toBe('preparing');
    expect(result.payment?.destinationAccount).toEqual(
      pendingPhysicalPurchase.payment?.destinationAccount,
    );
  });
});

async function executePurchase(
  purchaseResult: PurchaseInformation,
): Promise<PurchaseInformation> {
  const lookupResult: AgentPurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: [purchaseResult],
  };
  const agentGateway = {
    async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
      return lookupResult;
    },
  } as unknown as AgentConversationGateway;
  const orchestrator = new InformationOrchestrator({
    knowledgeGateway: {} as KnowledgeRetrievalGateway,
    providerGateway: {} as ProviderGateway,
    agentGateway,
  });
  const request: PendingInformationRequest = {
    requestId: 'purchase-disclosure',
    kind: 'purchase',
    resource: 'gift_purchases',
    query: 'Revisar pago y entrega.',
    orderId: 'ORD-1',
    aspects: ['summary', 'payment_status', 'payment_details', 'shipping'],
    sensitiveFields: ['destination_account'],
    authAction: 'none',
  };
  const execution = await orchestrator.execute({
    requests: [request],
    authentication: { token: 'test-token', email: 'test@example.com' },
    authBlock: null,
  });
  const result = execution.results[0];
  if (!result || result.status !== 'completed' || result.kind !== 'purchase') {
    throw new Error('Expected a completed purchase result.');
  }
  const projected = result.purchases[0];
  if (!projected) {
    throw new Error('Expected one projected purchase.');
  }
  return projected;
}

function purchase(overrides: {
  paymentStatus: string | null;
  itemType?: string | null;
  sendPhysical?: boolean | null;
}): PurchaseInformation {
  return {
    orderId: 'ORD-1',
    paymentStatus: overrides.paymentStatus,
    shippingStatus: 'preparing',
    grandTotal: 250,
    paymentMethod: 'Transferencia',
    eventName: 'Boda',
    eventDate: '2026-09-15',
    eventUrl: null,
    createdAt: '2026-08-10',
    items: [
      {
        giftName: 'Regalo',
        quantity: 1,
        amount: 250,
        rowTotal: 250,
        type: overrides.itemType ?? null,
      },
    ],
    payment: {
      method: 'Transferencia',
      amount: 250,
      paidAt: null,
      destinationAccount: {
        holder: 'Sin Envolturas',
        bank: 'Banco',
        number: '999111222',
        cci: '00112233445566778899',
        type: 'current',
      },
    },
    dedication: {
      message: null,
      isPrivate: null,
      sendPhysical: overrides.sendPhysical ?? false,
      physicalStatus: 'preparing',
    },
  };
}
