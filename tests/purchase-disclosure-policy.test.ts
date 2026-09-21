import { describe, expect, it } from 'vitest';

import type {
  PendingInformationRequest,
  PurchaseAspect,
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
  hasPhysicalFulfillment,
  mapItemFulfillment,
  pendingPaymentValidationExpectation,
} from '../src/runtime/purchase-disclosure-policy';

describe('purchase disclosure policy', () => {
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

  it('adds the 72-business-hour expectation only for methods covered by the indexed article', () => {
    expect(pendingPaymentValidationExpectation(purchase({
      paymentStatus: 'pending',
      paymentMethod: 'Transferencia',
    }))).toEqual({
      maxBusinessHours: 72,
      appliesTo: 'indexed_validation_methods',
    });
    expect(pendingPaymentValidationExpectation(purchase({
      paymentStatus: 'pending',
      paymentMethod: 'Visa',
    }))).toBeNull();
    expect(pendingPaymentValidationExpectation(purchase({
      paymentStatus: 'pending',
      paymentMethod: null,
    }))).toBeNull();
    expect(pendingPaymentValidationExpectation(purchase({
      paymentStatus: 'pending',
      paymentMethod: 'PayPal',
    }))).toEqual({
      maxBusinessHours: 72,
      appliesTo: 'indexed_validation_methods',
    });
    expect(pendingPaymentValidationExpectation(purchase({
      paymentStatus: 'pending',
      paymentMethod: 'cash',
    }))).toBeNull();
  });

  it('removes destination accounts and shipping before evidence reaches the reply model', async () => {
    const approvedCashPurchase = purchase({
      paymentStatus: 'approved',
      itemType: 'cash',
    });
    const result = await executePurchase(approvedCashPurchase);

    expect(result.shippingStatus).toBeNull();
    expect(result.payment?.destinationAccount).toBeUndefined();
    expect(result.payment?.originBank).toBeUndefined();
    expect(result.payment?.voucherImage).toBeUndefined();
  });

  it('preserves shipping evidence but never destination identifiers for a pending physical purchase', async () => {
    const pendingPhysicalPurchase = purchase({
      paymentStatus: 'pending',
      itemType: 'product',
    });
    const result = await executePurchase(pendingPhysicalPurchase);

    expect(result.shippingStatus).toBe('preparing');
    expect(result.payment?.destinationAccount).toBeUndefined();
  });

  it('maps se_store to physical, credit to host credit, and anything else to unknown', () => {
    expect(mapItemFulfillment('se_store')).toEqual({
      kind: 'physical',
      chosenBy: null,
      giftShipmentApplicable: true,
    });
    expect(mapItemFulfillment('credit')).toEqual({
      kind: 'host_credit',
      chosenBy: 'host',
      giftShipmentApplicable: false,
    });
    for (const raw of [null, undefined, '', '   ', 'cash', 'digital', 'gift_card', 'se-credit']) {
      expect(mapItemFulfillment(raw)).toEqual({
        kind: 'unknown',
        chosenBy: null,
        giftShipmentApplicable: null,
      });
    }
  });

  it('normalizes item codes before mapping but never infers type from gift names', () => {
    expect(mapItemFulfillment(' SE_STORE ').kind).toBe('physical');
    expect(mapItemFulfillment('Credit').kind).toBe('host_credit');
    expect(mapItemFulfillment('Producto Físico').kind).toBe('physical');
    // A physical-sounding name with credit stays credit: mapping reads the
    // explicit backend enum only.
    expect(mapItemFulfillment('credit')).not.toEqual(
      expect.objectContaining({ kind: 'physical' }),
    );
  });

  it('treats se_store as physical fulfillment per item, not per order', () => {
    expect(hasPhysicalFulfillment(purchase({
      paymentStatus: 'approved',
      itemType: 'se_store',
    }))).toBe(true);
    expect(hasPhysicalFulfillment(mixedPurchase())).toBe(true);
    expect(hasPhysicalFulfillment(purchase({
      paymentStatus: 'approved',
      itemType: 'credit',
    }))).toBe(false);
  });

  it('keeps shipping status plus authorized amounts for se_store gifts on shipping-only requests', async () => {
    const result = await executePurchase(
      purchase({ paymentStatus: 'approved', itemType: 'se_store' }),
      ['shipping'],
    );

    expect(result.shippingStatus).toBe('preparing');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      giftName: 'Regalo',
      quantity: 1,
      amount: 250,
      rowTotal: 250,
      type: 'se_store',
      fulfillment: { kind: 'physical', chosenBy: null, giftShipmentApplicable: true },
    });
    expect(result.creditFulfillmentPolicy).toBeUndefined();
  });

  it('exposes host choice with preserved amounts and no posting claims for credit gifts on shipping-only requests', async () => {
    const result = await executePurchase(
      purchase({ paymentStatus: 'pending', itemType: 'credit' }),
      ['shipping'],
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      quantity: 1,
      amount: 250,
      rowTotal: 250,
      type: 'credit',
      fulfillment: { kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false },
    });
    expect(result.creditFulfillmentPolicy).toEqual({
      chosenBy: 'host',
      mechanism: 'host_account_credit',
    });
    expect(JSON.stringify(result)).not.toContain('credited');
  });

  it('keeps mixed se_store and credit items distinct on summary requests', async () => {
    const result = await executePurchase(mixedPurchase(), ['summary']);

    expect(result.shippingStatus).toBe('preparing');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.fulfillment?.kind).toBe('physical');
    expect(result.items[1]?.fulfillment?.kind).toBe('host_credit');
    expect(result.items[0]?.amount).toBe(150);
    expect(result.items[1]?.amount).toBe(80);
    expect(result.creditFulfillmentPolicy).toEqual({
      chosenBy: 'host',
      mechanism: 'host_account_credit',
    });
  });

  it('projects identical items for summary and shipping aspects of the same record', async () => {
    const summary = await executePurchase(mixedPurchase(), ['summary']);
    const shipping = await executePurchase(mixedPurchase(), ['shipping']);

    expect(shipping.items).toEqual(summary.items);
  });

  it('omits item fulfillment on payment-only requests', async () => {
    const result = await executePurchase(mixedPurchase(), ['payment_status']);

    expect(result.items).toHaveLength(0);
    expect(result.creditFulfillmentPolicy).toBeUndefined();
  });
});

async function executePurchase(
  purchaseResult: PurchaseInformation,
  aspects: PurchaseAspect[] = ['summary', 'payment_status', 'payment_details', 'shipping'],
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
    aspects,
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

function mixedPurchase(): PurchaseInformation {
  const base = purchase({ paymentStatus: 'approved', itemType: 'se_store' });
  return {
    ...base,
    grandTotal: 230,
    items: [
      {
        giftName: 'Juego de sábanas',
        quantity: 1,
        amount: 150,
        rowTotal: 150,
        type: 'se_store',
      },
      {
        giftName: 'Aporte luna de miel',
        quantity: 1,
        amount: 80,
        rowTotal: 80,
        type: 'credit',
      },
    ],
  };
}

function purchase(overrides: {
  paymentStatus: string | null;
  paymentMethod?: string | null;
  itemType?: string | null;
  sendPhysical?: boolean | null;
}): PurchaseInformation {
  return {
    orderId: 'ORD-1',
    paymentStatus: overrides.paymentStatus,
    shippingStatus: 'preparing',
    grandTotal: 250,
    paymentMethod: overrides.paymentMethod === undefined
      ? 'Transferencia'
      : overrides.paymentMethod,
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
      method: overrides.paymentMethod === undefined
        ? 'Transferencia'
        : overrides.paymentMethod,
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
