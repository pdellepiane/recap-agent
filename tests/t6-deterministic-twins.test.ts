import { describe, expect, it, vi, beforeEach } from 'vitest';

import { HttpAgentConversationGateway } from '../src/runtime/agent-conversation-gateway';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('T6 deterministic twins', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  function ordersGateway(payload: unknown): HttpAgentConversationGateway {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)));
    return new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'k',
      timeoutMs: 1000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });
  }

  it('parses order partitions and carts faithfully across account shapes', async () => {
    // Alex same-event: active pending order and active cart stay distinct.
    const alex = await ordersGateway({
      status: true,
      data: {
        pending_orders: [{
          id: 'ORD-PENDING-ALEX',
          payment_status: 'pending',
          grand_total: 250,
          payment_method: 'Yape',
          event_name: 'Luis Raul and Carmen del Rosario',
          event_id: 101,
          items: [],
          created_at: '2026-08-29',
        }],
        completed_orders: [],
        carts: [{
          cart_id: 'CART-ALEX',
          status: 'active',
          was_abandoned: false,
          event_id: 101,
          event_name: 'Luis Raul and Carmen del Rosario',
          subtotal: 250,
          gifts_quantity: 2,
          items: [],
          created_at: '2026-08-29',
        }],
      },
      errors: null,
      error: null,
    }).getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '982340340' });
    expect(alex.status).toBe('success');
    if (alex.status !== 'success') throw new Error('expected success');
    expect(alex.orderPartitions!.pending).toHaveLength(1);
    expect(alex.carts!).toHaveLength(1);
    expect(alex.orderPartitions!.pending[0].orderId).toBe('ORD-PENDING-ALEX');
    expect(alex.carts![0].cartId).toBe('CART-ALEX');
    expect(alex.carts![0].status).toBe('active');
    expect(alex.carts![0].wasAbandoned).toBe(false);
    // ensure purchases do not flatten cart into order
    expect(alex.purchases).toHaveLength(1);

    // Sonia: cart-only abandoned coverage without purchase_not_found.
    const sonia = await ordersGateway({
      status: true,
      data: {
        pending_orders: [],
        completed_orders: [],
        carts: [{
          cart_id: 'CART-SONIA',
          status: 'abandoned',
          was_abandoned: true,
          event_name: 'Carlos and Adriana',
          event_id: 55,
          subtotal: 120,
          gifts_quantity: 1,
          items: [],
          created_at: '2026-08-20',
        }],
      },
      errors: null,
      error: null,
    }).getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '965765765' });
    expect(sonia.status).toBe('success');
    if (sonia.status !== 'success') throw new Error('expected success');
    expect(sonia.orderPartitions!.pending).toHaveLength(0);
    expect(sonia.orderPartitions!.completed).toHaveLength(0);
    expect(sonia.carts![0].wasAbandoned).toBe(true);
    expect(sonia.carts![0].eventName).toBe('Carlos and Adriana');

    // Isa and Lu: current pending over historical declined AMORCITOS.
    const isalu = await ordersGateway({
      status: true,
      data: {
        pending_orders: [{
          id: 'ORD-PENDING-ISALU',
          payment_status: 'pending',
          grand_total: 63.85,
          payment_method: 'Transferencia',
          currency: null,
          event_name: 'Isa and Lu',
          event_id: 44,
          created_at: '2026-08-28 14:00:00',
        }],
        completed_orders: [{
          id: 'ORD-DECLINED-AMORCITOS',
          payment_status: 'declined',
          grand_total: 98.14,
          payment_method: 'Transferencia',
          event_name: 'AMORCITOS_WEDDING',
          created_at: '2023-11-11',
        }],
        carts: [{
          cart_id: 'CART-ISALU',
          status: 'active',
          was_abandoned: false,
          event_name: 'Isa and Lu',
          event_id: 44,
          subtotal: 63.85,
          gifts_quantity: 1,
          items: [],
          created_at: '2026-08-28',
        }],
      },
      errors: null,
      error: null,
    }).getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '987554554' });
    expect(isalu.status).toBe('success');
    if (isalu.status !== 'success') throw new Error('expected success');
    expect(isalu.orderPartitions!.pending[0].eventName).toBe('Isa and Lu');
    expect(isalu.orderPartitions!.completed[0].eventName).toBe('AMORCITOS_WEDDING');
    expect(isalu.carts![0].eventName).toBe('Isa and Lu');
    // currency null preserved
    expect(isalu.orderPartitions!.pending[0].currency).toBeNull();
    // Server-provided timestamp is preserved byte-for-byte.
    expect(isalu.orderPartitions!.pending[0].createdAt).toBe('2026-08-28 14:00:00');

    // Alejandra: pending total without inventing currency.
    const alejandra = await ordersGateway({
      status: true,
      data: {
        pending_orders: [{
          id: 'ORD-PENDING-ALEJANDRA',
          payment_status: 'pending',
          grand_total: 227.76,
          payment_method: 'Yape',
          currency: null,
          event_name: 'Alejandra',
          event_id: 77,
          created_at: '2026-08-30',
        }],
        completed_orders: [],
        carts: [{
          cart_id: 'CART-ALEJANDRA',
          status: 'active',
          was_abandoned: false,
          event_name: 'Alejandra',
          event_id: 77,
          subtotal: 227.76,
          gifts_quantity: 1,
          items: [],
          created_at: '2026-08-30',
        }],
      },
      errors: null,
      error: null,
    }).getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '938389389' });
    expect(alejandra.status).toBe('success');
    if (alejandra.status !== 'success') throw new Error('expected success');
    expect(alejandra.orderPartitions!.pending[0].grandTotal).toBe(227.76);
    expect(alejandra.orderPartitions!.pending[0].currency).toBeNull();
    expect(alejandra.orderPartitions!.pending[0].paymentMethod).toBe('Yape');

    // Samuel Josue: current pending over historical approved Josue y Paola.
    const samuel = await ordersGateway({
      status: true,
      data: {
        pending_orders: [{
          id: 'ORD-PENDING-SAMUEL',
          payment_status: 'pending',
          grand_total: 80,
          payment_method: 'Yape',
          event_name: 'Samuel Josue',
          created_at: '2026-08-29',
        }],
        completed_orders: [{
          id: 'ORD-COMPLETED-JOSUE',
          payment_status: 'approved',
          grand_total: 88.18,
          payment_method: 'Yape',
          event_name: 'Josue y Paola',
          created_at: '2025-04-16',
        }],
        carts: [],
      },
      errors: null,
      error: null,
    }).getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '981056171' });
    expect(samuel.status).toBe('success');
    if (samuel.status !== 'success') throw new Error('expected success');
    expect(samuel.orderPartitions!.pending[0].eventName).toBe('Samuel Josue');
    expect(samuel.orderPartitions!.completed[0].eventName).toBe('Josue y Paola');
  });

  it('preserves offset-less paidAt supplied by the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        purchases: [{
          id: 'ORD-CLF',
          payment_status: 'pending',
          grand_total: 1042.89,
          event_name: 'Claudia and Luis Felipe',
          payment: {
            method: 'Transferencia',
            amount: 1042.89,
            paid_at: '2026-08-30 21:31:27',
            payment_id: 'pay_1',
            destination_account: { bank: 'BCP', cci: '123' },
            voucher: 'voucher.png',
          },
          items: [],
          created_at: '2026-08-30',
        }],
      },
      errors: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'k',
      timeoutMs: 1000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });
    const result = await gateway.getGuestGiftPurchasesByPhone({ phone_extension: '+51', phone_number: '957212085' });
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('expected success');
    expect(result.purchases[0].payment?.paidAt).toBe('2026-08-30 21:31:27');
  });

  it('parses RSVP mutation outcomes honestly', async () => {
    await expect(ordersGateway({
      status: true,
      data: { plus_one: { saved: true, response: 'yes', reason: null }, guest_id: 481 },
      errors: null,
      error: null,
    }).guestRsvp({ phone_extension: '+51', phone_number: '942633292', guest_id: 481, plus_one_response: 'yes' })).resolves.toEqual(expect.objectContaining({
      status: 'responded',
      plusOne: { saved: true, response: 'yes', reason: null },
    }));

    await expect(ordersGateway({
      status: true,
      data: { plus_one: { saved: false, response: 'yes', reason: 'not_eligible' } },
      errors: null,
      error: null,
    }).guestRsvp({ phone_extension: '+51', phone_number: '942633292', guest_id: 481, plus_one_response: 'yes' })).resolves.toEqual(expect.objectContaining({
      status: 'responded',
      plusOne: { saved: false, response: 'yes', reason: 'not_eligible' },
    }));

    const combined = await ordersGateway({
      status: true,
      data: {
        rsvp: { guest_id: 481, will_attend: true, event_name: 'Michelle & Jorge' },
        plus_one: { saved: true, response: 'yes', reason: null },
      },
      errors: null,
      error: null,
    }).guestRsvp({ phone_extension: '+51', phone_number: '942633292', action: 'attending', guest_id: 481, plus_one_response: 'yes' });
    expect(combined.status).toBe('responded');
    if (combined.status !== 'responded') throw new Error('expected responded');
    expect(combined.willAttend).toBe(true);
    expect(combined.plusOne?.saved).toBe(true);

    await expect(ordersGateway({
      status: true,
      data: { pending_guests: [{ guest_id: 481, event_name: 'Evento A' }, { guest_id: 482, event_name: 'Evento B' }] },
      code: 'multiple_pending',
      error: 'Hay varias invitaciones pendientes.',
    }).guestRsvp({ phone_extension: '+51', phone_number: '941438999', action: 'attending' })).resolves.toEqual(expect.objectContaining({
      status: 'multiple_pending',
    }));
  });
});
