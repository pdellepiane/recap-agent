import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { mapItemFulfillment } from '../src/runtime/purchase-disclosure-policy';

/**
 * Backend fixtures for the 2026-10-19 WhatsApp behaviour dossier (cases A,
 * B, C, D), the multi-purchase ambiguity twin (case E), and the synthetic
 * event-date and support-handoff worlds for objectives H/I.
 *
 * These files are the ONLY backend surface the runtime sees in those
 * scenarios: the fixture gateway is the sole reader. The assertions below are
 * therefore hard backend facts, not model output, and every value they pin
 * comes from `analysis/2026-10-19-whatsapp-behavior-cases/artifacts/turn-table-2026-10-20.md`
 * or the explicitly synthetic worlds declared for objectives H/I.
 */

const FIXTURE_ROOT = path.resolve(process.cwd(), 'evals', 'fixtures');

async function readFixtureText(scenario: string): Promise<string> {
  return fs.readFile(path.join(FIXTURE_ROOT, `${scenario}.json`), 'utf8');
}

/**
 * The record payload of a fixture, without its documentation note. Absence
 * assertions about ids, amounts and references run against this projection so
 * that the prose explaining what is deliberately not modelled cannot satisfy
 * or break them.
 */
async function readFixtureRecords(scenario: string): Promise<{ orders: string; gifts: string }> {
  const raw = await readFixtureText(scenario);
  const parsed = JSON.parse(raw) as {
    guestOrders?: Record<string, unknown>;
    guestGiftPurchases?: Record<string, unknown>;
  };
  return {
    orders: JSON.stringify(parsed.guestOrders ?? {}),
    gifts: JSON.stringify(parsed.guestGiftPurchases ?? {}),
  };
}

describe('dossier purchase fixtures (WhatsApp behaviour cases A/B/C/D + ambiguity)', () => {
  it('case A: no purchase record exists, only the two identical abandoned carts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const gateway = await FixtureAgentConversationGateway.create('purchase-yape-receipt-no-match');

    const orders = await gateway.getGuestOrdersByPhone({
      phone_extension: '+51',
      phone_number: '900000401',
    });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    // A1-A6: every guest read completed without results, so the receipt image
    // had no purchase to bind to.
    expect(orders.purchases).toEqual([]);
    expect(orders.purchases.filter((purchase) => purchase.paymentStatus === 'approved')).toEqual([]);
    expect(orders.orderPartitions?.pending).toEqual([]);
    expect(orders.orderPartitions?.completed).toEqual([]);

    const carts = orders.carts ?? [];
    expect(carts.map((cart) => cart.cartId).sort()).toEqual(['470893', '471454']);
    for (const cart of carts) {
      expect(cart.subtotal).toBe(442);
      expect(cart.currency).toBe('PEN');
      expect(cart.status).toBe('abandoned');
      expect(cart.wasAbandoned).toBe(true);
      expect(cart.eventName).toBe('Giuly & Brian');
      expect(cart.eventDate).toBe('2026-10-24');
    }

    const gifts = await gateway.getGuestGiftPurchasesByPhone({
      phone_extension: '+51',
      phone_number: '900000401',
    });
    expect(gifts.status).toBe('success');
    if (gifts.status !== 'success') return;
    expect(gifts.purchases).toEqual([]);

    // The takeover must be executable and receipt-bearing in this scenario.
    const takeover = await gateway.requestHumanTakeover('+51900000401');
    expect(takeover.status).toBe('success');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    const handoffReceipt = gateway.getFixtureReceipts()
      .find((receipt) => receipt.operation === 'handoff.write');
    expect(handoffReceipt?.resultStatus).toBe('success');
    expect(handoffReceipt?.replayed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('case A ships the then-state: the order that settled later is not modelled', async () => {
    const records = await readFixtureRecords('purchase-yape-receipt-no-match');
    // ORD_6ac56cb4ec4bd (S/ 464.86) settled at 2026-10-06 21:48:37, about 37
    // minutes after the last bot turn, so it did not exist during the thread.
    expect(records.orders).not.toContain('ORD_6ac56cb4ec4bd');
    expect(records.orders).not.toContain('464.86');
    expect(records.gifts).not.toContain('ORD_6ac56cb4ec4bd');
    expect(records.orders).not.toMatch(/"increment_id"/u);
    expect(records.gifts).not.toMatch(/"increment_id"/u);
  });

  it('case B: four approved purchases and no customer transaction number on any of them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const gateway = await FixtureAgentConversationGateway.create('purchase-cod-reference-unavailable');

    const gifts = await gateway.getGuestGiftPurchasesByPhone({
      phone_extension: '+51',
      phone_number: '900000402',
    });
    expect(gifts.status).toBe('success');
    if (gifts.status !== 'success') return;
    expect(gifts.purchases).toHaveLength(4);
    expect(gifts.purchases.map((purchase) => purchase.orderId).sort()).toEqual([
      '627063d405f1a',
      '66e85020a0241',
      'ORD_6a18d3ca76e45',
      'ORD_6ad6760c5bbee',
    ]);
    for (const purchase of gifts.purchases) {
      expect(purchase.paymentStatus).toBe('approved');
      // The guest payloads carry no increment_id key at all, so the customer
      // transaction number is unmatchable by construction.
      expect(purchase.customerTransactionNumber ?? null).toBeNull();
    }

    const michi = gifts.purchases.find((purchase) => purchase.orderId === 'ORD_6ad6760c5bbee');
    expect(michi).toBeDefined();
    expect(michi?.eventName).toBe('Michi & Chino');
    expect(michi?.eventDate).toBe('2026-11-21');
    expect(michi?.grandTotal).toBe(86.45);
    expect(michi?.currency).toBe('USD');
    expect(michi?.payment?.method).toBe('Tarjeta de crédito/débito');
    expect(michi?.payment?.paidAt).toBe('2026-10-19 19:57:07');
    expect(michi?.isThanked).toBe(true);

    const orders = await gateway.getGuestOrdersByPhone({
      phone_extension: '+51',
      phone_number: '900000402',
    });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases).toHaveLength(4);
    for (const purchase of orders.purchases) {
      expect(purchase.paymentStatus).toBe('approved');
      expect(purchase.customerTransactionNumber ?? null).toBeNull();
    }

    const takeover = await gateway.requestHumanTakeover('+51900000402');
    expect(takeover.status).toBe('success');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('case B: the guest code is not the identifier of any record', async () => {
    const records = await readFixtureRecords('purchase-cod-reference-unavailable');
    expect(records.orders).not.toContain('COD309553');
    expect(records.orders).not.toContain('309553');
    expect(records.gifts).not.toContain('COD309553');
    expect(records.gifts).not.toContain('309553');
    expect(records.orders).not.toMatch(/"increment_id"/u);
    expect(records.gifts).not.toMatch(/"increment_id"/u);
  });

  it('case C: one approved host-credit purchase with the host receipt present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const gateway = await FixtureAgentConversationGateway.create('purchase-approved-host-receipt-refund');

    const gifts = await gateway.getGuestGiftPurchasesByPhone({
      phone_extension: '+51',
      phone_number: '900000403',
    });
    expect(gifts.status).toBe('success');
    if (gifts.status !== 'success') return;
    expect(gifts.purchases).toHaveLength(1);
    const purchase = gifts.purchases[0];
    expect(purchase?.orderId).toBe('ORD_6ab970ab70802');
    expect(purchase?.paymentStatus).toBe('approved');
    expect(purchase?.grandTotal).toBe(87.36);
    expect(purchase?.currency).toBe('PEN');
    expect(purchase?.eventName).toBe('Baby Shower');
    expect(purchase?.eventDate).toBe('2026-10-17');
    expect(purchase?.payment?.method).toBe('Yape o Plin');
    expect(purchase?.payment?.paidAt).toBe('2026-09-27 19:38:19');
    expect(purchase?.payment?.operationCode).toBe('mobile-payment');

    // The host receipt: the gift was thanked and the real thank-you message
    // reached the reply model on every turn of the thread.
    expect(purchase?.isThanked).toBe(true);
    expect(purchase?.thanks?.sendMethod).toBe('whatsapp');
    expect(purchase?.thanks?.message ?? '').toContain('Hemos recibido tu regalo');

    // The line item: S/ 79 for a host credit, not a shipped physical article.
    const item = purchase?.items[0];
    expect(item?.giftName).toBe('Cambiador portátil');
    expect(item?.rowTotal).toBe(79);
    expect(mapItemFulfillment(item?.type).kind).toBe('host_credit');

    const orders = await gateway.getGuestOrdersByPhone({
      phone_extension: '+51',
      phone_number: '900000403',
    });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases).toHaveLength(1);
    expect(orders.purchases[0]?.grandTotal).toBe(87.36);
    expect(orders.purchases[0]?.currency).toBe('PEN');
    expect(orders.purchases[0]?.customerTransactionNumber ?? null).toBeNull();

    const takeover = await gateway.requestHumanTakeover('+51900000403');
    expect(takeover.status).toBe('success');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('case D: the only readable record is the declined card attempt', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const gateway = await FixtureAgentConversationGateway.create('purchase-declined-card-transfer-pending');

    const orders = await gateway.getGuestOrdersByPhone({
      phone_extension: '+51',
      phone_number: '900000404',
    });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases).toHaveLength(1);
    const order = orders.purchases[0];
    expect(order?.orderId).toBe('ORD_6ad637da04583');
    expect(order?.paymentStatus).toBe('declined');
    expect(order?.grandTotal).toBe(403.53);
    expect(order?.currency).toBe('PEN');
    expect(order?.eventName).toBe('Nicolás');
    expect(order?.eventDate).toBe('2026-10-24');
    expect(order?.payment?.transactionStatus).toBe('declined');
    expect(order?.payment?.paidAt).toBe('2026-10-19 15:31:44');
    expect(order?.customerTransactionNumber ?? null).toBeNull();

    const gifts = await gateway.getGuestGiftPurchasesByPhone({
      phone_extension: '+51',
      phone_number: '900000404',
    });
    expect(gifts.status).toBe('success');
    if (gifts.status !== 'success') return;
    expect(gifts.purchases).toHaveLength(1);
    expect(gifts.purchases[0]?.paymentStatus).toBe('declined');
    expect(gifts.purchases[0]?.grandTotal).toBe(403.53);
    expect(gifts.purchases[0]?.isThanked ?? null).toBeNull();

    const takeover = await gateway.requestHumanTakeover('+51900000404');
    expect(takeover.status).toBe('success');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('case D ships the declined state: the repriced Plin payment is not a backend record', async () => {
    const records = await readFixtureRecords('purchase-declined-card-transfer-pending');
    // The live backend repriced the same order id to S/ 391.87 pending
    // (Yape o Plin) after the turns; the guest-reported Plin payment is a
    // model-side signal, so no record claims that amount or method here.
    expect(records.orders).not.toContain('391.87');
    expect(records.orders).not.toContain('Yape o Plin');
    expect(records.gifts).not.toContain('391.87');
    expect(records.gifts).not.toContain('Yape o Plin');
    expect(records.orders).toContain('403.53');
    expect(records.orders).toContain('declined');
    expect(records.orders).not.toMatch(/"increment_id"/u);
    expect(records.gifts).not.toMatch(/"increment_id"/u);
  });

  it('case E: two approved purchases with different events and different totals', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const gateway = await FixtureAgentConversationGateway.create('purchase-ambiguous-two-orders');

    const gifts = await gateway.getGuestGiftPurchasesByPhone({
      phone_extension: '+51',
      phone_number: '900000405',
    });
    expect(gifts.status).toBe('success');
    if (gifts.status !== 'success') return;
    expect(gifts.purchases.length).toBeGreaterThanOrEqual(2);
    for (const purchase of gifts.purchases) {
      expect(purchase.paymentStatus).toBe('approved');
      expect(purchase.grandTotal).not.toBeNull();
    }
    const eventNames = new Set(gifts.purchases.map((purchase) => purchase.eventName));
    expect(eventNames.size).toBe(gifts.purchases.length);
    const totals = new Set(gifts.purchases.map((purchase) => purchase.grandTotal));
    expect(totals.size).toBe(gifts.purchases.length);
    expect([...eventNames].sort()).toEqual(['Boda Comunitaria', 'Cumpleaños Familiar']);
    expect([...totals].sort()).toEqual([120.5, 350]);

    const orders = await gateway.getGuestOrdersByPhone({
      phone_extension: '+51',
      phone_number: '900000405',
    });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases.length).toBe(gifts.purchases.length);
    expect(new Set(orders.purchases.map((purchase) => purchase.grandTotal)).size).toBe(
      orders.purchases.length,
    );

    const takeover = await gateway.requestHumanTakeover('+51900000405');
    expect(takeover.status).toBe('success');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    { scenario: 'purchase-approved-event-date', phone: '900000406', orderId: 'ORD_support-event-406', total: 150, outcome: 'success', operationCode: 'fixture-event-406' },
    { scenario: 'purchase-support-handoff-failed', phone: '900000407', orderId: 'ORD_support-failed-407', total: 180, outcome: 'failed', operationCode: null },
    { scenario: 'purchase-support-handoff-unknown', phone: '900000408', orderId: 'ORD_support-unknown-408', total: 210, outcome: 'unknown', operationCode: null },
  ] as const)('objectives H/I: $scenario maps its purchase and real handoff outcome', async ({ scenario, phone, orderId, total, outcome, operationCode }) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const gateway = await FixtureAgentConversationGateway.create(scenario);

    const orders = await gateway.getGuestOrdersByPhone({
      phone_extension: '+51',
      phone_number: phone,
    });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases).toHaveLength(1);
    expect(orders.purchases[0]?.orderId).toBe(orderId);
    expect(orders.purchases[0]?.paymentStatus).toBe('approved');
    expect(orders.purchases[0]?.grandTotal).toBe(total);
    expect(orders.purchases[0]?.currency).toBe('PEN');
    expect(orders.purchases[0]?.customerTransactionNumber ?? null).toBeNull();
    expect(orders.purchases[0]?.payment?.operationCode ?? null).toBe(operationCode);

    const gifts = await gateway.getGuestGiftPurchasesByPhone({
      phone_extension: '+51',
      phone_number: phone,
    });
    expect(gifts.status).toBe('success');
    if (gifts.status !== 'success') return;
    expect(gifts.purchases).toHaveLength(1);
    const purchase = gifts.purchases[0];
    expect(purchase?.orderId).toBe(orderId);
    expect(purchase?.paymentStatus).toBe('approved');
    expect(purchase?.grandTotal).toBe(total);
    expect(purchase?.currency).toBe('PEN');
    expect(purchase?.customerTransactionNumber ?? null).toBeNull();
    expect(purchase?.payment?.operationCode ?? null).toBe(operationCode);
    expect(purchase?.isThanked).toBe(false);
    expect(purchase?.thanks ?? null).toBeNull();

    const events = await gateway.getGuestEventsByPhone({
      phone_extension: '+51',
      phone_number: phone,
    });
    expect(events.status).toBe('success');
    if (events.status !== 'success') return;
    if (scenario === 'purchase-approved-event-date') {
      expect(events.events).toHaveLength(1);
      expect(events.events[0]?.eventId).toBe(90406);
      expect(events.events[0]?.name).toBe('Celebración de prueba');
      expect(events.events[0]?.datetime).toBe('2026-12-12');
      expect(purchase?.eventId).toBe(90406);
      expect(purchase?.eventDate).toBe('2026-12-12');
    } else {
      expect(events.events).toEqual([]);
    }

    const takeover = await gateway.requestHumanTakeover(`+51${phone}`);
    expect(takeover.status).toBe(outcome === 'success' ? 'success' : 'failed');
    if (takeover.status === 'failed') {
      expect(takeover.outcome).toBe(outcome);
      expect(takeover.retryable).toBe(false);
    }
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    const handoffReceipt = gateway.getFixtureReceipts()
      .find((receipt) => receipt.operation === 'handoff.write');
    expect(handoffReceipt?.resultStatus).toBe(outcome);
    expect(handoffReceipt?.replayed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
