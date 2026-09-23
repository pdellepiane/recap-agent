import { describe, expect, it, vi } from 'vitest';

import { HttpAgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { SinEnvolturasGateway } from '../src/runtime/sinenvolturas-gateway';
import type { UnmappedWireKeyDiagnostic } from '../src/runtime/wire-key-diagnostics';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('customer gateway field conservation', () => {
  it('maps order, payment, card, thanks and item fields while diagnosing unknown wire keys', async () => {
    const diagnostics: UnmappedWireKeyDiagnostic[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      status: true,
      data: {
        next_cursor: 'page-two-cursor',
        purchases: [{
          id: 'gift-7',
          increment_id: '3044',
          payment_status: 'pending',
          shipping_status: 'preparing',
          grand_total: 150,
          is_thanked: false,
          payment: {
            method: 'bank transfer',
            amount: 80,
            paid_at: '2026-09-20T14:30:00-05:00',
            payment_id: 'private-payment-id',
            transaction_status: 'processing',
            gateway_message: 'transfer pending validation',
            op_code: 'OP-14',
            origin_bank: 'Banco Uno',
            destination_account: {
              holder: 'Sin Envolturas', bank: 'Banco Dos', number: '12345', cci: '002123', type: 'checking',
            },
            voucher: 'https://private.example/voucher/abc',
          },
          decline_code: null,
          admin_comment: 'private operator note',
          event_id: 91,
          currency: 'legacy-PEN',
          currency_code: 'PEN',
          currency_symbol: 'S/',
          event_name: 'Anniversary',
          event_date: '2026-09-25T20:00:00-05:00',
          event_url: 'https://events.example/91',
          items: [{ gift_name: 'Dinner', quantity: 2, amount: 75, row_total: 150, type: 'physical' }],
          dedication: { message: 'With love', is_private: false, send_physical: true, physical_status: 'preparing' },
          thanks: { message: 'Thank you', send_method: 'whatsapp' },
          created_at: '2021-02-01T09:00:00-05:00',
          future_continuation: 'ignored until a gateway contract exists',
        }],
      },
      errors: null,
      error: null,
    })));
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'test-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
      onUnmappedWireKey: (diagnostic) => diagnostics.push(diagnostic),
    });

    const result = await gateway.getGiftPurchases({ token: 'test-token' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected purchase fixture success.');
    const record = result.purchases[0];
    expect(record).toMatchObject({
      orderId: 'gift-7',
      recordSource: 'gift_purchases',
      grandTotal: 150,
      currency: null,
      currencySymbol: 'S/',
      currencyConflict: true,
      eventDate: '2026-09-25T20:00:00-05:00',
      createdAt: '2021-02-01T09:00:00-05:00',
      dedication: { message: 'With love', isPrivate: false, sendPhysical: true, physicalStatus: 'preparing' },
      thanks: { message: 'Thank you', sendMethod: 'whatsapp' },
      items: [{ giftName: 'Dinner', quantity: 2, amount: 75, rowTotal: 150, type: 'physical' }],
      payment: {
        amount: 80,
        paidAt: '2026-09-20T14:30:00-05:00',
        paymentId: 'private-payment-id',
        transactionStatus: 'processing',
        gatewayMessage: 'transfer pending validation',
        operationCode: 'OP-14',
        originBank: 'Banco Uno',
        destinationAccount: { holder: 'Sin Envolturas', bank: 'Banco Dos', number: '12345', cci: '002123', type: 'checking' },
        voucherProvided: true,
      },
    });
    expect(record?.adminComment).toBe('private operator note');
    expect(diagnostics).toContainEqual({ endpoint: '/gift-purchases', fieldPath: 'purchases.future_continuation' });
    expect(diagnostics).toContainEqual({ endpoint: '/gift-purchases', fieldPath: 'next_cursor' });
    expect(JSON.stringify(diagnostics)).not.toContain('ignored until');
    expect(JSON.stringify(diagnostics)).not.toContain('page-two-cursor');
  });

  it('maps authorized user identity, full user-lookup event details and order references', async () => {
    const diagnostics: UnmappedWireKeyDiagnostic[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      status: true,
      errors: null,
      error: null,
      data: {
        user: { id: 17, full_name: 'María Example', email: 'maria@example.test', full_phone: '+51900000001' },
        events: [{
          id: 91,
          slug: 'anniversary-91',
          url: 'https://events.example/91',
          name: 'Anniversary',
          datetime: '2026-09-25T20:00:00-05:00',
          type: 'celebration',
          type_detail: 'anniversary',
          stage: 'active',
          is_visible: true,
          is_public: false,
          currency: { id: 4, name: 'Peruvian sol', cod_alpha: 'PEN', symbol: 'S/' },
          currency_symbol: 'S/',
          country: { id: 1, name: 'Perú', short_code: 'PE' },
          city: 'Cusco',
          place: 'Casa Sol',
          location: 'San Blas',
          address: 'Calle Uno 10',
          with_time: true,
          timezone: 'America/Lima',
          celebrateds: [{ name: 'Ana', type: 'host' }],
          moments: [{
            label: 'Ceremony', description: 'Main ceremony', datetime: '2026-09-25T21:00:00-05:00',
            with_time: true, location_description: 'Garden', location_reference: 'gate A',
            location_url: 'https://maps.example/91', location_coords: '-13.5,-71.9', position: 2,
          }],
          dresscode: { type: 'formal', description: 'Dark colors' },
          common_asked: [{ question: 'Parking?', answer: 'At the entrance' }],
          contact_info: [{ label: 'Host', value: '+51999999999' }],
          amount_collected: 500,
          amount_transferred: 250,
          transactions_count: 8,
          invited_guest: 40,
          confirmed_guest: 31,
          future_detail: 'diagnostic only',
        }],
        guest_in_events: [],
        host_in_events: [],
        celebrated_in: [],
        recent_orders: [{
          id: 302,
          event_id: 91,
          event: { id: 91, name: 'Anniversary', slug: 'anniversary-91', url: 'https://events.example/91', datetime: '2026-09-25T20:00:00-05:00', currency: { id: 4, name: 'Peruvian sol', cod_alpha: 'PEN', symbol: 'S/' } },
          increment_id: '3902',
          gift_type: 'gift-credit',
          grand_total: 75,
          payment_status: 'pending',
          shipping_status: 'received',
          created_at: '2020-01-01T10:00:00-05:00',
          payment_method: { id: 3, name: 'bank transfer' },
        }],
      },
    })));
    const gateway = new SinEnvolturasGateway({
      baseUrl: 'https://api.example.test/vendor',
      guestServiceBaseUrl: 'https://api.example.test/guest',
      persistedSearchLimit: 5,
      summarySearchWordLimit: 10,
      onUnmappedWireKey: (diagnostic) => diagnostics.push(diagnostic),
    });

    const result = await gateway.lookupAuthenticatedUserEvents({ token: 'authorized-token', email: 'maria@example.test' });

    expect(result).toMatchObject({
      user: { id: 17, fullName: 'María Example', email: 'maria@example.test', fullPhone: '+51900000001' },
      events: [{
        eventId: 91,
        source: 'sinenvolturas_user_lookup',
        datetime: '2026-09-25T20:00:00-05:00',
        typeDetail: 'anniversary',
        currency: 'PEN',
        currencySymbol: 'S/',
        country: 'Perú',
        countryCode: 'PE',
        place: 'Casa Sol',
        location: 'San Blas',
        address: 'Calle Uno 10',
        amountCollected: 500,
        amountTransferred: 250,
        transactionsCount: 8,
        invitedGuestCount: 40,
        confirmedGuestCount: 31,
        orderIds: ['302'],
        orders: [],
        detail: {
          withTime: true,
          timezone: 'America/Lima',
          city: 'Cusco',
          celebrateds: [{ name: 'Ana', type: 'host' }],
          moments: [{
            label: 'Ceremony', description: 'Main ceremony', datetime: '2026-09-25T21:00:00-05:00',
            withTime: true, locationDescription: 'Garden', locationReference: 'gate A',
            locationUrl: 'https://maps.example/91', locationCoords: '-13.5,-71.9', position: 2,
          }],
          dresscode: { type: 'formal', description: 'Dark colors' },
          commonAsked: [{ question: 'Parking?', answer: 'At the entrance' }],
          contactInfo: [{ label: 'Host', value: '+51999999999' }],
        },
      }],
      recentOrders: [{
        id: 302,
        eventId: 91,
        eventName: 'Anniversary',
        currency: 'PEN',
        currencySymbol: 'S/',
        incrementId: '3902',
        giftType: 'gift-credit',
        grandTotal: 75,
        paymentStatus: 'pending',
        shippingStatus: 'received',
        paymentMethod: 'bank transfer',
      }],
    });
    expect(diagnostics).toContainEqual({ endpoint: '/user-lookup', fieldPath: 'events.future_detail' });
  });
});
