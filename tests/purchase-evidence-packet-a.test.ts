import { describe, expect, it } from 'vitest';

import type {
  PendingInformationRequest,
  PurchaseInformation,
} from '../src/core/information';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import {
  disclosedPurchaseMethod,
  disclosedPurchasePaid,
  disclosedPurchaseTotal,
  projectPurchaseBalanceLimitation,
  selectPurchaseReplyOutcome,
} from '../src/runtime/purchase-reply-projector';
import {
  assembleCustomerContext,
  projectCustomerContext,
} from '../src/runtime/customer-context';
import { reconcileTwoRecords } from '../src/runtime/purchase-reconciliation';

class PacketAGateway implements AgentConversationGateway {
  public guestOrdersCalls = 0;
  public guestGiftCalls = 0;
  public guestOrdersResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getGuestOrdersByPhone']>>
  > = { status: 'success', resource: 'orders', purchases: [] };
  public guestGiftResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getGuestGiftPurchasesByPhone']>>
  > = { status: 'success', resource: 'gift_purchases', purchases: [] };

  async logMessage(): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async getRecentMessages(): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async requestHumanTakeover(): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: boolean }> {
    return { status: 'failed', error: 'not configured in test', retryable: false };
  }

  async updatePhone(): Promise<{ status: 'success' }> {
    return { status: 'success' };
  }

  async getGuestOrdersByPhone(): Promise<typeof this.guestOrdersResult> {
    this.guestOrdersCalls += 1;
    return this.guestOrdersResult;
  }

  async getGuestGiftPurchasesByPhone(): Promise<typeof this.guestGiftResult> {
    this.guestGiftCalls += 1;
    return this.guestGiftResult;
  }
}

const PHONE = { phone_extension: '+51', phone_number: '938389389' };

function orchestrator(gateway: PacketAGateway): InformationOrchestrator {
  return new InformationOrchestrator({
    knowledgeGateway: { async search() { throw new Error('unused'); } },
    providerGateway: {} as ProviderGateway,
    agentGateway: gateway,
  });
}

function luisOrder(): PurchaseInformation {
  return {
    orderId: 'ORD-LUIS-389',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 227.76,
    paymentMethod: 'Yape_o_Plin',
    currency: null,
    currencySymbol: null,
    eventName: 'Alejandra',
    eventDate: '2026-09-20',
    eventUrl: null,
    createdAt: '2026-08-27 15:00:00',
    items: [],
    payment: null,
  };
}

function creditPendingGift(): PurchaseInformation {
  return {
    orderId: 'GIFT-CREDIT-1',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 120,
    paymentMethod: 'Transferencia',
    currency: 'PEN',
    eventName: 'Boda Lucía y Marco',
    eventDate: '2026-10-10',
    eventUrl: null,
    createdAt: '2026-09-01 11:00:00',
    items: [{ giftName: 'Aporte luna de miel', quantity: 1, amount: 120, rowTotal: 120, type: 'credit' }],
  };
}

function mixedGift(): PurchaseInformation {
  return {
    orderId: 'GIFT-MIXED-1',
    paymentStatus: 'approved',
    shippingStatus: null,
    grandTotal: 230,
    paymentMethod: 'Transferencia',
    currency: null,
    eventName: 'Boda Lucía y Marco',
    eventDate: '2026-10-10',
    eventUrl: null,
    createdAt: '2026-09-01 11:00:00',
    items: [
      { giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150, type: 'se_store' },
      { giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80, type: 'credit' },
    ],
  };
}

describe('Packet A purchase/profile evidence', () => {
  it('Luis balance: payment_status facet retains total, paid-unknown, method and unverifiable remaining', async () => {
    const gateway = new PacketAGateway();
    gateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases: [luisOrder()] };
    const request: PendingInformationRequest = {
      requestId: 'information-1',
      kind: 'purchase',
      resource: 'orders',
      query: 'Cuanto me falta?',
      orderId: null,
      aspects: ['payment_status'],
      sensitiveFields: [],
      authAction: 'none',
      eventHint: 'Alejandra',
    };
    const execution = await orchestrator(gateway).execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone: PHONE,
    });
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(0);
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected completed purchase');
    }
    expect(result.purchases).toHaveLength(1);
    const projected = result.purchases[0];
    if (!projected) throw new Error('missing purchase');
    // Facet closure: total and method survive a payment_status aspect.
    expect(disclosedPurchaseTotal(projected)).toBe(227.76);
    expect(disclosedPurchasePaid(projected)).toBeNull();
    expect(disclosedPurchaseMethod(projected)).toBe('Yape_o_Plin');
    expect(projected.paymentStatus).toBe('pending');
    expect(projected.amountDisclosure?.total).toBe(227.76);
    expect(projected.amountDisclosure?.paid).toBeNull();
    expect(projected.amountDisclosure?.paymentMethod).toBe('Yape_o_Plin');

    const outcome = selectPurchaseReplyOutcome({
      purchases: result.purchases,
      carts: result.carts ?? [],
      needsSelection: result.needsSelection,
      coverage: result.coverage ?? 'complete',
      referenceResolution: result.referenceResolution ?? 'not_requested',
      requestedAspects: ['payment_status'],
      referenceAuthorized: false,
      userReported: {},
    });
    if (outcome.kind !== 'order_unique') throw new Error(`expected order_unique, got ${outcome.kind}`);
    expect(outcome.order.amount?.total).toBe(227.76);
    expect(outcome.order.amount?.paid).toBeNull();
    expect(outcome.order.amount?.remaining).toBeNull();
    expect(outcome.order.amount?.remainingVerifiable).toBe(false);
    expect(outcome.order.amount?.method).toBe('Yape_o_Plin');
    // Negative: paid-unknown never renders as full due.
    expect(outcome.order.amount?.remaining).not.toBe(227.76);

    const limitation = projectPurchaseBalanceLimitation(outcome, projected.orderId);
    expect(limitation?.total).toBe(227.76);
    expect(limitation?.paid).toBeNull();
    expect(limitation?.paidAvailability).toBe('unknown');
    expect(limitation?.remaining).toBeNull();
    expect(limitation?.remainingVerifiable).toBe(false);
    expect(limitation?.method).toBe('Yape_o_Plin');
    expect(limitation?.methodAvailability).toBe('available');
  });

  it('credit pending: payment_status facet preserves item fulfillment and approved-status coupling', async () => {
    const gateway = new PacketAGateway();
    gateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [creditPendingGift()] };
    const request: PendingInformationRequest = {
      requestId: 'information-1',
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Ya les llegó el dinero a los novios?',
      orderId: null,
      aspects: ['payment_status'],
      sensitiveFields: [],
      authAction: 'none',
    };
    const execution = await orchestrator(gateway).execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone: PHONE,
    });
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected completed purchase');
    }
    const projected = result.purchases[0];
    if (!projected) throw new Error('missing purchase');
    // Facet coupling repair: items survive a payment_status aspect.
    expect(projected.items.length).toBeGreaterThan(0);
    expect(projected.paymentStatus).toBe('pending');
    expect(projected.creditFulfillmentPolicy).toEqual({ chosenBy: 'host', mechanism: 'host_account_credit' });
    const fulfillment = projected.items[0]?.fulfillment;
    expect(fulfillment?.kind).toBe('host_credit');
    expect(fulfillment?.giftShipmentApplicable).toBe(false);
    // Mechanism does not prove posting: status stays pending.
    expect(projected.paymentStatus).not.toBe('approved');
  });

  it('mixed gifts: shipping facet keeps both items, approved status and unknown dispatch', async () => {
    const gateway = new PacketAGateway();
    gateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [mixedGift()] };
    const request: PendingInformationRequest = {
      requestId: 'information-1',
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Cuándo llegan?',
      orderId: null,
      aspects: ['shipping'],
      sensitiveFields: [],
      authAction: 'none',
    };
    const execution = await orchestrator(gateway).execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone: PHONE,
    });
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected completed purchase');
    }
    const projected = result.purchases[0];
    if (!projected) throw new Error('missing purchase');
    expect(projected.items).toHaveLength(2);
    // Backend approved is never masked as unknown on a shipping question.
    expect(projected.paymentStatus).toBe('approved');
    // Negative: dispatch is never inferred from physical type.
    expect(projected.shippingStatus).toBeNull();
    const physical = projected.items.find((item) => item.fulfillment?.kind === 'physical');
    const credit = projected.items.find((item) => item.fulfillment?.kind === 'host_credit');
    expect(physical?.giftName).toBe('Juego de sábanas');
    expect(credit?.giftName).toBe('Aporte luna de miel');
    expect(physical?.fulfillment?.giftShipmentApplicable).toBe(true);
    expect(credit?.fulfillment?.giftShipmentApplicable).toBe(false);
  });

  it('explicit older event: both candidates preserved without count-only selection', async () => {
    const gateway = new PacketAGateway();
    const older: PurchaseInformation = {
      orderId: 'ORD-OLDER',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 100,
      paymentMethod: 'Transferencia',
      currency: 'PEN',
      eventName: 'Aniversario Lucia',
      eventDate: '2026-08-01',
      eventUrl: null,
      createdAt: '2026-07-01 10:00:00',
      items: [],
    };
    const newer: PurchaseInformation = {
      orderId: 'ORD-NEWER',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 200,
      paymentMethod: 'Transferencia',
      currency: 'PEN',
      eventName: 'Baby Shower Catalina',
      eventDate: '2026-09-15',
      eventUrl: null,
      createdAt: '2026-08-15 10:00:00',
      items: [],
    };
    gateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases: [older, newer] };
    const request: PendingInformationRequest = {
      requestId: 'information-1',
      kind: 'purchase',
      resource: 'orders',
      query: 'Ese pedido sigue pendiente?',
      orderId: null,
      aspects: ['summary'],
      sensitiveFields: [],
      authAction: 'none',
      eventHint: 'Aniversario Lucia',
    };
    const execution = await orchestrator(gateway).execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone: PHONE,
    });
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected completed purchase');
    }
    // Negative: the older explicit event is never deleted; count alone never selects.
    expect(result.purchases).toHaveLength(2);
    expect(result.needsSelection).toBe(false);
    const events = result.purchases.map((purchase) => purchase.eventName).sort();
    expect(events).toEqual(['Aniversario Lucia', 'Baby Shower Catalina']);
    const outcome = selectPurchaseReplyOutcome({
      purchases: result.purchases,
      carts: [],
      needsSelection: result.needsSelection,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: ['summary'],
      referenceAuthorized: false,
      userReported: {},
    });
    if (outcome.kind !== 'order_set') throw new Error(`expected order_set, got ${outcome.kind}`);
    expect(outcome.orders).toHaveLength(2);
  });

  it('discovery with empty orders and complete gifts keeps per-source coverage', async () => {
    const gateway = new PacketAGateway();
    gateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases: [] };
    gateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [creditPendingGift()] };
    const request: PendingInformationRequest = {
      requestId: 'discovery-1',
      kind: 'purchase',
      resource: 'purchase_discovery',
      query: '¿Cuándo llega mi regalo?',
      orderId: null,
      aspects: ['summary', 'shipping'],
      sensitiveFields: [],
      authAction: 'none',
    };
    const execution = await orchestrator(gateway).execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone: PHONE,
    });
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(1);
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected completed discovery');
    }
    expect(result.sourceCoverage).toEqual([
      { source: 'orders', childId: 'discovery-1:orders', status: 'empty', count: 0 },
      { source: 'gift_purchases', childId: 'discovery-1:gift_purchases', status: 'completed', count: 1 },
    ]);
    // Negative: an empty orders leg never becomes an account-wide absence claim.
    expect(result.purchases).toHaveLength(1);
    expect(result.purchases[0]?.orderId).toBe('GIFT-CREDIT-1');
  });

  it('conflicting source values are detected, never silently defaulted', () => {
    const left: PurchaseInformation = {
      orderId: 'ORD-CONFLICT',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 100,
      paymentMethod: 'Transferencia',
      eventName: 'Evento',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-01 10:00:00',
      items: [],
    };
    const right: PurchaseInformation = {
      ...left,
      grandTotal: 200,
      paymentStatus: 'approved',
    };
    const outcome = reconcileTwoRecords(left, 'orders', 'pending_orders', right, 'gift_purchases', 'pending_orders');
    expect(outcome.status).toBe('conflict');
    expect(outcome.conflictingFields).toContain('grandTotal');
    expect(outcome.conflictingFields).toContain('paymentStatus');
    expect(outcome.canonical.grandTotal).toBeNull();
    expect(outcome.canonical.paymentStatus).toBeNull();
  });

  it('four candidates survive without first-three slicing in reply and profile', async () => {
    const gateway = new PacketAGateway();
    const purchases: PurchaseInformation[] = [1, 2, 3, 4].map((index) => ({
      orderId: `ORD-${index}`,
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 100 + index,
      paymentMethod: 'Transferencia',
      currency: 'PEN',
      eventName: `Evento ${index}`,
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-01 10:00:00',
      items: [],
    }));
    gateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases };
    const request: PendingInformationRequest = {
      requestId: 'information-1',
      kind: 'purchase',
      resource: 'orders',
      query: 'Mis pedidos?',
      orderId: null,
      aspects: ['summary'],
      sensitiveFields: [],
      authAction: 'none',
    };
    const execution = await orchestrator(gateway).execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone: PHONE,
    });
    const result = execution.results[0];
    if (result?.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('expected completed purchase');
    }
    expect(result.purchases).toHaveLength(4);
    const outcome = selectPurchaseReplyOutcome({
      purchases: result.purchases,
      carts: [],
      needsSelection: result.needsSelection,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: ['summary'],
      referenceAuthorized: false,
      userReported: {},
    });
    if (outcome.kind !== 'order_set') throw new Error(`expected order_set, got ${outcome.kind}`);
    // Negative: the 4th candidate is never sliced away.
    expect(outcome.orders).toHaveLength(4);

    const snapshot = assembleCustomerContext({
      execution: { results: execution.results, summaries: execution.summaries },
      identity: { customerRef: 'test', source: 'test', scope: 'test', fetchedAt: new Date().toISOString() },
      currentContext: null,
      nowIso: new Date().toISOString(),
    });
    const projection = projectCustomerContext(snapshot, { focus: 'payment', relevantOrderIds: [], relevantEventIds: [] });
    expect(projection.detailedPurchases).toHaveLength(4);
    expect(projection.purchases).toHaveLength(4);
  });

  it('canonical profile carries balance facts once with method provenance', async () => {
    const gateway = new PacketAGateway();
    gateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases: [luisOrder()] };
    const request: PendingInformationRequest = {
      requestId: 'information-1',
      kind: 'purchase',
      resource: 'orders',
      query: 'Cuanto me falta?',
      orderId: null,
      aspects: ['payment_status'],
      sensitiveFields: [],
      authAction: 'none',
      eventHint: 'Alejandra',
    };
    const execution = await orchestrator(gateway).execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone: PHONE,
    });
    const snapshot = assembleCustomerContext({
      execution: { results: execution.results, summaries: execution.summaries },
      identity: { customerRef: 'test', source: 'test', scope: 'test', fetchedAt: new Date().toISOString() },
      currentContext: null,
      nowIso: new Date().toISOString(),
    });
    const projection = projectCustomerContext(snapshot, { focus: 'payment', relevantOrderIds: [], relevantEventIds: [] });
    expect(projection.detailedPurchases).toHaveLength(1);
    const summary = projection.purchases.find((entry) => entry.orderId === 'ORD-LUIS-389');
    expect(summary?.totalAvailability).toBe('available');
    expect(summary?.paidAvailability).toBe('unknown');
    expect(summary?.remainingVerifiable).toBe(false);
    expect(summary?.method).toBe('Yape_o_Plin');
    expect(summary?.methodAvailability).toBe('available');
    const detail = projection.detailedPurchases[0];
    expect(disclosedPurchaseTotal(detail as PurchaseInformation)).toBe(227.76);
  });
});
