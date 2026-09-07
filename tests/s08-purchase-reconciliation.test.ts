import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PurchaseInformation } from '../src/core/information';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import { decideTurnCapability } from '../src/runtime/turn-capability-policy';
import {
  detectConflictingFields,
  isReportedSettlementEvidence,
  partitionHasConflict,
  preserveServerTimestamp,
  reconcileTwoRecords,
  resolveAgainstStaleNote,
  resolveTransactionReference,
  selectPurchaseRecords,
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
  it('distinguishes pending and completed partitions and never coerces carts into orders', () => {
    const pending = [basePurchase({ orderId: 'ORD-P-1', paymentStatus: 'pending', partition: 'pending_orders' })];
    const completed = [basePurchase({ orderId: 'ORD-C-1', paymentStatus: 'approved', partition: 'completed_orders' })];
    const conflicts = partitionHasConflict(pending, completed);
    expect(conflicts.size).toBe(0);
    expect(pending[0]?.partition).toBe('pending_orders');
    expect(completed[0]?.partition).toBe('completed_orders');
    expect(pending[0]?.orderId).not.toBe(completed[0]?.orderId);
  });

  it('flags the same order id in both partitions as a partition conflict', () => {
    const pending = [basePurchase({ orderId: 'ORD-DUP', paymentStatus: 'pending', partition: 'pending_orders' })];
    const completed = [basePurchase({ orderId: 'ORD-DUP', paymentStatus: 'approved', partition: 'completed_orders' })];
    const conflicts = partitionHasConflict(pending, completed);
    expect(conflicts.has('ORD-DUP')).toBe(true);
  });

  it('detects conflicting non-null authority instead of picking by source priority', () => {
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
  });

  it('keeps agreeing records confident with per-field provenance', () => {
    const current = basePurchase({ paymentStatus: 'pending' });
    const incoming = basePurchase({ paymentStatus: 'pending', shippingStatus: 'enroute' });
    const outcome = reconcileTwoRecords(
      current,
      'orders',
      'pending_orders',
      incoming,
      'gift_purchases',
      'pending_orders',
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.canonical.paymentStatus).toBe('pending');
      expect(outcome.provenance['paymentStatus']?.source).toBeDefined();
    }
  });

  it('treats null against a value as freshness, not a conflict', () => {
    const current = basePurchase({ paymentMethod: null });
    const incoming = basePurchase({ paymentMethod: 'Yape_o_Plin' });
    expect(detectConflictingFields(current, incoming)).toEqual([]);
  });

  it('lets current backend status win over a stale test note, never over equal authority', () => {
    const backend = basePurchase({ paymentStatus: 'approved' });
    expect(resolveAgainstStaleNote(backend, 'pending note').paymentStatus).toBe('approved');
    const equalA = basePurchase({ paymentStatus: 'pending' });
    const equalB = basePurchase({ paymentStatus: 'approved' });
    const outcome = reconcileTwoRecords(equalA, 'orders', 'pending_orders', equalB, 'gift_purchases', 'completed_orders');
    expect(outcome.status).toBe('conflict');
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

  it('requires unique records to be stated directly and multiples to need selection', () => {
    expect(selectPurchaseRecords([basePurchase()]).needsSelection).toBe(false);
    const two = [basePurchase({ orderId: 'A' }), basePurchase({ orderId: 'B' })];
    expect(selectPurchaseRecords(two).needsSelection).toBe(true);
    expect(selectPurchaseRecords([]).needsSelection).toBe(false);
  });

  it('discloses a transaction reference only when the source supplies it and access is authorized', () => {
    const supplied = basePurchase({ customerTransactionNumber: '100000901' });
    expect(resolveTransactionReference(supplied, true)).toBe('100000901');
    expect(resolveTransactionReference(supplied, false)).toBeNull();
    const missing = basePurchase({ customerTransactionNumber: null });
    expect(resolveTransactionReference(missing, true)).toBeNull();
  });

  it('orchestrator marks equally authoritative status disagreement as inconsistent without confident status', async () => {
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
          aspects: ['summary', 'payment_status'],
          sensitiveFields: [],
          authAction: 'none',
        },
        {
          requestId: 'gift-detail-conflict',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'Detalle del regalo',
          orderId: 'ORD-000880',
          aspects: ['payment_status', 'dedication'],
          sensitiveFields: [],
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
        expect(result.purchases[0]?.paymentStatus).toBeNull();
      }
    }
  });

  it('orchestrator keeps Martha multi-record selection from order mappings with empty guest events', async () => {
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
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '900070122' },
    });
    const result = execution.results[0];
    expect(result).toMatchObject({ status: 'completed', needsSelection: true });
    if (result?.status === 'completed' && result.kind === 'purchase') {
      expect(result.purchases).toHaveLength(2);
    }
  });

  it('orchestrator serves an authorized gift read for dedication selection without coercing carts', async () => {
    const gateway = new FakeGateway();
    const first = { ...basePurchase({ orderId: 'ORD-J-1', eventName: 'Chiara Vittoria', eventDate: '2026-09-10' }) };
    const second = { ...basePurchase({ orderId: 'ORD-J-2', eventName: 'Chiara Vittoria', eventDate: '2026-08-10' }) };
    gateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [first, second],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as ProviderGateway,
      agentGateway: gateway,
    });
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'joaquin-gift-read',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: 'Quisiera cambiar la dedicatoria de un regalo para Chiara Vittoria',
        orderId: null,
        aspects: ['dedication'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '926857444' },
    });
    const result = execution.results[0];
    expect(result).toMatchObject({ status: 'completed', needsSelection: true });
    if (result?.status === 'completed' && result.kind === 'purchase') {
      expect(result.purchases).toHaveLength(2);
      expect(result.carts ?? []).toEqual([]);
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
