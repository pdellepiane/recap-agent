import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { InformationTaskResult, PurchaseInformation } from '../src/core/information';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import { decideTurnCapability } from '../src/runtime/turn-capability-policy';
import {
  detectConflictingFields,
  isApprovalBoundaryAnsweredByRecord,
  isReportedSettlementEvidence,
  partitionHasConflict,
  preserveServerTimestamp,
  reconcileTwoRecords,
  resolveAgainstStaleNote,
  resolveTransactionReference,
} from '../src/runtime/purchase-reconciliation';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type {
  AgentConversationGateway,
  AgentPhonePurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';

function basePurchase(overrides: Partial<PurchaseInformation> = {}): PurchaseInformation {
  return {
    orderId: 'ORD-000880',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 149.9,
    paymentMethod: 'Yape_o_Plin',
    eventName: 'Suki Sofia',
    eventDate: '2026-09-20',
    eventUrl: null,
    createdAt: '2026-09-04 10:00:00',
    items: [],
    ...overrides,
  };
}

class FakeGateway implements AgentConversationGateway {
  public guestOrdersResult: AgentPhonePurchaseLookupResult = {
    status: 'success',
    resource: 'orders',
    purchases: [],
  };
  public guestGiftResult: AgentPhonePurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: [],
  };
  async logMessage(input: never): Promise<never> {
    void input;
    throw new Error('unused');
  }
  async getRecentMessages(): Promise<never> {
    throw new Error('unused');
  }
  async requestHumanTakeover(): Promise<never> {
    throw new Error('unused');
  }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: boolean }> {
    return { status: 'failed', error: 'unused', retryable: false };
  }
  async updatePhone(): Promise<{ status: 'success' }> {
    return { status: 'success' };
  }
  async getGuestEventsByPhone(): Promise<{ status: 'not_found' }> {
    return { status: 'not_found' };
  }
  async getEventDetail(): Promise<{ status: 'not_found' }> {
    return { status: 'not_found' };
  }
  async getGuestOrdersByPhone(): Promise<AgentPhonePurchaseLookupResult> {
    return this.guestOrdersResult;
  }
  async getGuestGiftPurchasesByPhone(): Promise<AgentPhonePurchaseLookupResult> {
    return this.guestGiftResult;
  }
  async getOrders(): Promise<never> {
    throw new Error('unused');
  }
  async getGiftPurchases(): Promise<never> {
    throw new Error('unused');
  }
}

describe('S08 purchase reconciliation preserves identity and provenance', () => {
  it('partition conflict is set exactly when one order id spans both partitions', () => {
    const pending = [basePurchase({ orderId: 'ORD-P-1', paymentStatus: 'pending', partition: 'pending_orders' })];
    const completed = [basePurchase({ orderId: 'ORD-C-1', paymentStatus: 'approved', partition: 'completed_orders' })];
    const conflicts = partitionHasConflict(pending, completed);
    expect(conflicts.size).toBe(0);
    expect(pending[0]?.partition).toBe('pending_orders');
    expect(completed[0]?.partition).toBe('completed_orders');
    expect(pending[0]?.orderId).not.toBe(completed[0]?.orderId);
    const dupPending = [basePurchase({ orderId: 'ORD-DUP', paymentStatus: 'pending', partition: 'pending_orders' })];
    const dupCompleted = [basePurchase({ orderId: 'ORD-DUP', paymentStatus: 'approved', partition: 'completed_orders' })];
    const dupConflicts = partitionHasConflict(dupPending, dupCompleted);
    expect(dupConflicts.has('ORD-DUP')).toBe(true);
  });

  it('two-record reconciliation keeps agreement confident, treats null as freshness, prefers backend over stale notes, and conflicts on disagreed authority', () => {
    const current = basePurchase({ paymentStatus: 'pending', grandTotal: 149.9 });
    const incoming = basePurchase({ paymentStatus: 'approved', grandTotal: 149.9 });
    const fields = detectConflictingFields(current, incoming);
    expect(fields).toContain('paymentStatus');
    const outcome = reconcileTwoRecords(
      current,
      'orders',
      'pending_orders',
      incoming,
      'gift_purchases',
      'completed_orders',
    );
    expect(outcome.status).toBe('conflict');
    if (outcome.status === 'conflict') {
      expect(outcome.conflictingFields).toContain('paymentStatus');
      expect(outcome.canonical.paymentStatus).toBeNull();
      expect(outcome.orderId).toBe('ORD-000880');
    }
    const agreeCurrent = basePurchase({ paymentStatus: 'pending' });
    const agreeIncoming = basePurchase({ paymentStatus: 'pending', shippingStatus: 'enroute' });
    const agreeOutcome = reconcileTwoRecords(
      agreeCurrent,
      'orders',
      'pending_orders',
      agreeIncoming,
      'gift_purchases',
      'pending_orders',
    );
    expect(agreeOutcome.status).toBe('ok');
    if (agreeOutcome.status === 'ok') {
      expect(agreeOutcome.canonical.paymentStatus).toBe('pending');
      expect(agreeOutcome.provenance['paymentStatus']?.source).toBeDefined();
    }
    const freshCurrent = basePurchase({ paymentMethod: null });
    const freshIncoming = basePurchase({ paymentMethod: 'Yape_o_Plin' });
    expect(detectConflictingFields(freshCurrent, freshIncoming)).toEqual([]);
    const backend = basePurchase({ paymentStatus: 'approved' });
    expect(resolveAgainstStaleNote(backend, 'pending note').paymentStatus).toBe('approved');
  });

  it('never treats reported amounts, time or currency as settlement evidence', () => {
    expect(isReportedSettlementEvidence(999)).toBe(false);
    expect(isReportedSettlementEvidence('2026-08-29')).toBe(false);
    expect(isReportedSettlementEvidence('PEN')).toBe(false);
  });

  it('preserves server-local timestamps without conversion', () => {
    expect(preserveServerTimestamp('2026-09-04 10:00:00')).toBe('2026-09-04 10:00:00');
    expect(preserveServerTimestamp('2026-09-20')).toBe('2026-09-20');
    expect(preserveServerTimestamp(null)).toBeNull();
  });

  it('discloses a transaction reference only when the source supplies it and access is authorized', () => {
    const supplied = basePurchase({ customerTransactionNumber: '100000901' });
    expect(resolveTransactionReference(supplied, true)).toBe('100000901');
    expect(resolveTransactionReference(supplied, false)).toBeNull();
    const missing = basePurchase({ customerTransactionNumber: null });
    expect(resolveTransactionReference(missing, true)).toBeNull();
  });

  it('orchestrator preserves each source status and marks equally authoritative disagreement inconsistent', async () => {
    const gateway = new FakeGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [{ ...basePurchase(), paymentStatus: 'pending' }],
    };
    gateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [{ ...basePurchase(), paymentStatus: 'approved' }],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: gateway,
    });
    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'order-summary-conflict',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pedido',
          orderId: 'ORD-000880',
          authAction: 'none',
        },
        {
          requestId: 'gift-detail-conflict',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Detalle del regalo',
          orderId: 'ORD-000880',
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });
    for (const result of execution.results) {
      expect(result).toMatchObject({ status: 'completed', coverage: 'inconsistent' });
      if (result.status === 'completed' && result.kind === 'purchase') {
        expect(result.purchases[0]?.paymentStatus).toBe(
          result.requestId === 'order-summary-conflict' ? 'pending' : 'approved',
        ); // Preserve source-specific facts alongside inconsistency evidence.
      }
    }
  });

  it('orchestrator keeps multi-record order and gift reads with factual counts and no forced selection', async () => {
    const gateway = new FakeGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      orderPartitions: {
        pending: [
          { ...basePurchase({ orderId: 'ORD-M-1', eventName: 'Evento Familiar Norte' }) },
          { ...basePurchase({ orderId: 'ORD-M-2', eventName: 'Evento Familiar Sur' }) },
        ],
        completed: [],
      },
      carts: [],
      purchases: [
        { ...basePurchase({ orderId: 'ORD-M-1', eventName: 'Evento Familiar Norte' }) },
        { ...basePurchase({ orderId: 'ORD-M-2', eventName: 'Evento Familiar Sur' }) },
      ],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: gateway,
    });
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'martha-selection',
        kind: 'purchase',
        resource: 'orders',
        query: 'Quiero saber que paso con el regalo que intente pagar',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '900070122' },
    });
    const result = execution.results[0];
    // Contract revision (Lane B count-driven selection): multiplicity
    // alone sets no selection flag; both records stay with factual count.
    expect(result).toMatchObject({ status: 'completed', needsSelection: false });
    if (result?.status === 'completed' && result.kind === 'purchase') {
      expect(result.purchases).toHaveLength(2);
    }
    const giftGateway = new FakeGateway();
    const first = { ...basePurchase({ orderId: 'ORD-J-1', eventName: 'Chiara Vittoria', eventDate: '2026-09-10' }) };
    const second = { ...basePurchase({ orderId: 'ORD-J-2', eventName: 'Chiara Vittoria', eventDate: '2026-08-10' }) };
    giftGateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [first, second],
    };
    const giftOrchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: giftGateway,
    });
    const giftExecution = await giftOrchestrator.execute({
      requests: [{
        requestId: 'joaquin-gift-read',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: 'Quisiera cambiar la dedicatoria de un regalo para Chiara Vittoria',
        orderId: null,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '926857444' },
    });
    const giftResult = giftExecution.results[0];
    expect(giftResult).toMatchObject({ status: 'completed', needsSelection: false });
    if (giftResult?.status === 'completed' && giftResult.kind === 'purchase') {
      expect(giftResult.purchases).toHaveLength(2);
      expect(giftResult.carts ?? []).toEqual([]);
    }
  });
});

describe('S08 frozen wire and gateway contract', () => {
  function readFixture(name: string): Record<string, unknown> {
    const raw = fs.readFileSync(path.join(process.cwd(), 'evals', 'fixtures', name), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  function ordersOf(fixture: Record<string, unknown>, phone: string): Record<string, Array<Record<string, unknown>>> {
    const guestOrders = fixture['guestOrders'] as Record<string, Record<string, Array<Record<string, unknown>>>>;
    const world = guestOrders[phone];
    if (!world) throw new Error(`Missing fixture world for ${phone}.`);
    return world;
  }

  it('freezes separate pending and approved Kiara worlds with server-local timestamps', () => {
    const pending = readFixture('purchase-kiara-frozen.json');
    const approved = readFixture('purchase-kiara-approved-frozen.json');
    const pendingOrders = ordersOf(pending, '51900027635');
    const approvedOrders = ordersOf(approved, '51900027635');
    expect(pendingOrders['pending_orders']).toHaveLength(1);
    expect(pendingOrders['completed_orders']).toHaveLength(0);
    expect(pendingOrders['pending_orders']?.[0]?.['payment_status']).toBe('pending');
    expect(approvedOrders['pending_orders']).toHaveLength(0);
    expect(approvedOrders['completed_orders']).toHaveLength(1);
    expect(approvedOrders['completed_orders']?.[0]?.['payment_status']).toBe('approved');
    expect(pendingOrders['pending_orders']?.[0]?.['id']).not.toBe(
      approvedOrders['completed_orders']?.[0]?.['id'],
    );
    for (const world of [pendingOrders, approvedOrders]) {
      const all = [...(world['pending_orders'] ?? []), ...(world['completed_orders'] ?? [])];
      for (const order of all) {
        expect(order['currency']).toBeNull();
        expect(order['created_at']).toBe('2026-09-04 10:00:00');
        expect(String(order['created_at'])).not.toContain('T');
      }
    }
  });

  it('keeps carts distinct from orders with preserved server-local time and uninferred currency', () => {
    const fixture = readFixture('purchase-alex-340.json');
    const orders = ordersOf(fixture, '51982340340');
    expect(orders['pending_orders']).toHaveLength(1);
    expect(orders['carts']).toHaveLength(1);
    const cart = orders['carts']?.[0];
    const order = orders['pending_orders']?.[0];
    expect(cart['cart_id']).toBe('cart-alex-001');
    expect(cart['cart_id']).not.toBe(order['id']);
    expect(cart['created_at']).toBe('2026-08-28 09:00:00');
    expect(order['created_at']).toBe('2026-08-28 10:00:00');
  });

  it('tests Martha selection from trusted order mappings, never from missing guest events', () => {
    const fixture = readFixture('purchase-martha-frozen.json');
    const orders = ordersOf(fixture, '51900070122');
    expect(orders['pending_orders']?.length).toBeGreaterThanOrEqual(2);
    const guestEvents = fixture['guestEvents'] as Record<string, Record<string, unknown>>;
    expect(guestEvents['51900070122']?.['events']).toEqual([]);
    const ids = new Set((orders['pending_orders'] ?? []).map((order) => order['id']));
    expect(ids.size).toBe(orders['pending_orders']?.length);
  });

  it('lets an authorized gift read precede the unsupported dedication mutation handoff per S16', () => {
    const manifest = buildRuntimeCapabilityManifest({
      configured: true,
      environment: 'production',
      allowCustomerWrites: true,
      featureFlags: {
        faq: true,
        invitedEventLookup: true,
        purchaseInformation: true,
        rsvp: true,
        providerPlanning: true,
        providerSearch: true,
        providerQuoteRequests: true,
        phoneAuthentication: true,
        emailOtp: true,
        humanTakeover: true,
      },
    });
    const giftRead = decideTurnCapability({
      operation: 'purchase.gift_detail.read',
      manifest,
      gatewayAvailable: true,
      hasTrustedIdentity: true,
      requiresIdentity: true,
      resourceState: 'available',
      isAuthorized: true,
      remainingAttempts: null,
      alreadyCompleted: false,
      missingInput: [],
    });
    expect(giftRead.status).toBe('executable');
    const dedicationWrite = decideTurnCapability({
      operation: 'purchase.modify',
      manifest,
      gatewayAvailable: true,
      hasTrustedIdentity: true,
      requiresIdentity: true,
      resourceState: 'available',
      isAuthorized: true,
      remainingAttempts: null,
      alreadyCompleted: false,
      missingInput: [],
    });
    expect(dedicationWrite.status).toBe('unsupported');
    expect(dedicationWrite.allowedNext).toBe('handoff_once');
  });
});

describe('E requested reference falls back to bare query text', () => {
  function referenceGateway(): FakeGateway {
    const gateway = new FakeGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      orderPartitions: {
        pending: [
          { ...basePurchase({ orderId: 'order-s13-matched-b-01', eventName: 'Evento de prueba B', paymentStatus: 'pending', customerTransactionNumber: '301817' }) },
        ],
        completed: [
          { ...basePurchase({ orderId: 'order-s13-matched-a-01', eventName: 'Evento de prueba A', paymentStatus: 'approved', customerTransactionNumber: '301816' }) },
        ],
      },
      carts: [],
      purchases: [
        { ...basePurchase({ orderId: 'order-s13-matched-a-01', eventName: 'Evento de prueba A', paymentStatus: 'approved', customerTransactionNumber: '301816' }) },
        { ...basePurchase({ orderId: 'order-s13-matched-b-01', eventName: 'Evento de prueba B', paymentStatus: 'pending', customerTransactionNumber: '301817' }) },
      ],
    };
    return gateway;
  }

  function runQuery(gateway: FakeGateway, query: string, orderId: string | null) {
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: gateway,
    });
    return orchestrator.execute({
      requests: [{
        requestId: 'reference-query',
        kind: 'purchase',
        resource: 'orders',
        query,
        orderId,
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '900013002' },
    });
  }

  it('a bare COD query narrows to the single match or keeps every candidate when none match', async () => {
    const execution = await runQuery(referenceGateway(), 'COD301816', null);
    const result = execution.results[0];
    expect(result).toMatchObject({ status: 'completed', referenceResolution: 'matched' });
    if (result?.status === 'completed' && result.kind === 'purchase') {
      expect(result.purchases.map((purchase) => purchase.eventName)).toEqual(['Evento de prueba A']);
    }
    const gateway = new FakeGateway();
    const noRefA = { ...basePurchase({ orderId: 'order-s13-multiple-a-01', eventName: 'Evento de prueba A', paymentStatus: 'pending', customerTransactionNumber: null }) };
    const noRefB = { ...basePurchase({ orderId: 'order-s13-multiple-b-01', eventName: 'Evento de prueba B', paymentStatus: 'approved', customerTransactionNumber: null }) };
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      orderPartitions: { pending: [noRefA], completed: [noRefB] },
      carts: [],
      purchases: [noRefA, noRefB],
    };
    const missExecution = await runQuery(gateway, 'COD301816', null);
    const missResult = missExecution.results[0];
    expect(missResult).toMatchObject({ status: 'completed', needsSelection: true, referenceResolution: 'unavailable' });
    if (missResult?.status === 'completed' && missResult.kind === 'purchase') {
      expect(missResult.purchases).toHaveLength(2);
    }
  });
});

describe('approval boundary: receipt amount alone never proves approval', () => {
  function completedPurchase(orderId: string): InformationTaskResult {
    return {
      requestId: `req-${orderId}`,
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [],
      needsSelection: false,
    };
  }

  function failedPurchase(): InformationTaskResult {
    return {
      requestId: 'req-miss',
      kind: 'purchase',
      status: 'failed',
      retryable: false,
      accessMethod: 'trusted_phone_purchase',
      failureKind: 'not_found',
      message: 'no records',
    };
  }

  it('completed outcomes, scoped misses, receipt context, and gift results settle the approval boundary', () => {
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [completedPurchase('a')],
      receiptContext: false,
    })).toBe(true);
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [completedPurchase('a')],
      receiptContext: true,
    })).toBe(true);
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [failedPurchase()],
      receiptContext: true,
    })).toBe(true);
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [failedPurchase()],
      receiptContext: false,
    })).toBe(false);
    // Native receipt turn: the visible amount already establishes that a
    // receipt alone proves nothing, so the approval-versus-review ambiguity
    // is answered from receipt guidance instead of a redundant question.
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [],
      receiptContext: true,
    })).toBe(true);
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [],
      receiptContext: false,
    })).toBe(false);
    const completedGift: InformationTaskResult = {
      requestId: 'req-gift',
      kind: 'purchase',
      status: 'completed',
      resource: 'gift_purchases',
      lookupResource: 'gift_purchases',
      purchases: [],
      needsSelection: false,
    };
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [completedGift],
      receiptContext: true,
    })).toBe(true);
    expect(isApprovalBoundaryAnsweredByRecord({
      informationResults: [completedGift],
      receiptContext: false,
    })).toBe(true);
  });
});
