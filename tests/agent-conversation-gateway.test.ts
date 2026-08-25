import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  HttpAgentConversationGateway,
  NoopAgentConversationGateway,
} from '../src/runtime/agent-conversation-gateway';

describe('AgentConversationGateway', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('skips all operations in no-op mode', async () => {
    const gateway = new NoopAgentConversationGateway('not_configured');

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'skipped',
      reason: 'not_configured',
      message: 'Agent API human takeover is not configured.',
    });
    await expect(gateway.authByPhone({
      phone_extension: '+51',
      phone_number: '987654321',
    })).resolves.toEqual({
      status: 'failed',
      error: 'Agent API phone authentication is not configured.',
      retryable: false,
    });
    await expect(gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '987654321',
      action: 'attending',
    })).resolves.toEqual({
      status: 'failed',
      error: 'Agent API RSVP is not configured.',
      retryable: false,
    });
  });

  it('sends X-Agent-Key when requesting human takeover', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: { message: 'Solicitud de agente humano registrada.' },
      errors: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: true,
    });

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'success',
      message: 'Human takeover requested.',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/agent/conversations/request-human',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'X-Agent-Key': 'secret-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ phone_number: '51987654321' }),
      }),
    );
  });

  it('maps auth failures without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {
      status: false,
      data: null,
      errors: null,
      error: 'Autenticación api fallida',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'bad-key',
      timeoutMs: 1_000,
      maxRetries: 2,
      messageLoggingEnabled: true,
    });

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'failed',
      error: 'Agent API request failed with 401: Autenticación api fallida',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps method mismatch as a non-retryable failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(405, 'Method Not Allowed'));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 2,
      messageLoggingEnabled: true,
    });

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'failed',
      error: 'Agent API request failed with 405.',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed success envelopes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      ok: true,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: true,
    });

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'failed',
      error: 'Agent API response had an unexpected envelope.',
      retryable: false,
    });
  });

  it('parses recent messages from the documented envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        messages: [
          {
            id: 405,
            direction: 'inbound',
            source: null,
            body: 'ok gracias',
            status: 'received',
            whatsapp_message_id: 'wamid.405',
            sent_at: '2026-07-02T09:15:00Z',
            created_at: '2026-07-02T09:15:02Z',
          },
        ],
      },
      errors: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.getRecentMessages('51987654321')).resolves.toEqual({
      status: 'success',
      messages: [
        {
          id: 405,
          direction: 'inbound',
          source: null,
          body: 'ok gracias',
          status: 'received',
          whatsappMessageId: 'wamid.405',
          sentAt: '2026-07-02T09:15:00Z',
          createdAt: '2026-07-02T09:15:02Z',
        },
      ],
    });
  });

  it('retries transient server failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {
        status: false,
        data: null,
        errors: null,
        error: 'temporary',
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: true,
        data: { message: 'ok' },
        errors: null,
        error: null,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 1,
      messageLoggingEnabled: true,
    });

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'success',
      message: 'Human takeover requested.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('disables message writes without disabling other Agent API operations', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.logMessage({
      phoneNumber: '51987654321',
      body: 'Hola',
      direction: 'inbound',
    })).resolves.toEqual({
      status: 'skipped',
      reason: 'disabled',
      message: 'Agent API message logging is disabled.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retrieves a specific order with both required authentication headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        orders: [
          {
            id: 'ORD-000880',
            payment_status: 'approved',
            shipping_status: 'enroute',
            grand_total: 250,
            payment_method: 'Visa',
            event_name: 'Boda Laura & Marcos',
            event_date: '15/09/2026',
            event_url: 'https://sinenvolturas.com/boda-laura-marcos',
            items: [
              {
                gift_name: 'Aporte libre',
                quantity: 1,
                amount: 250,
                row_total: 250,
                type: 'cash',
              },
            ],
            created_at: '2026-07-10',
          },
        ],
      },
      errors: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    const result = await gateway.getOrders({
      token: 'user-jwt',
      orderId: 'ORD-000880',
    });

    expect(result.status).toBe('success');
    expect(result.status === 'success' ? result.purchases[0]?.orderId : null).toBe(
      'ORD-000880',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/agent/orders?order_id=ORD-000880',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-Agent-Key': 'secret-key',
          Authorization: 'Bearer user-jwt',
        },
      }),
    );
  });

  it('maps rich gift-purchase details from nullable API fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        purchases: [
          {
            id: 'ORD-000881',
            payment_status: 'approved',
            shipping_status: null,
            grand_total: 300,
            is_thanked: true,
            payment: {
              method: 'Transferencia',
              amount: 300,
              payment_id: null,
              transaction_status: null,
              gateway_message: null,
              op_code: 'OP-123',
              origin_bank: 'Banco origen',
              destination_account: {
                holder: 'Sin Envolturas',
                bank: 'Banco destino',
                number: '001',
                cci: '002',
                type: 'current',
              },
              voucher: ['voucher.png'],
              paid_at: '2026-07-10 14:32:00',
            },
            decline_code: null,
            admin_comment: null,
            event_name: 'Boda',
            event_date: '15/09/2026',
            event_url: null,
            items: [],
            dedication: {
              message: 'Muchas felicidades',
              is_private: false,
              send_physical: true,
              physical_status: 'enroute',
            },
            thanks: {
              message: 'Muchas gracias',
              send_method: 'whatsapp',
            },
            created_at: '2026-07-10',
          },
        ],
      },
      errors: null,
      error: null,
    })));
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    const result = await gateway.getGiftPurchases({ token: 'user-jwt' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected gift purchase success.');
    }
    expect(result.purchases[0]?.dedication?.physicalStatus).toBe('enroute');
    expect(result.purchases[0]?.thanks?.sendMethod).toBe('whatsapp');
    expect(result.purchases[0]?.payment?.destinationAccount?.cci).toBe('002');
  });

  it('distinguishes an account-level order miss from an unavailable route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {
        status: false,
        data: null,
        errors: null,
        error: 'Order not found',
      }))
      .mockResolvedValueOnce(jsonResponse(404, {
        message: 'The route api/agent/orders could not be found.',
      }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(
      gateway.getOrders({ token: 'user-jwt', orderId: 'ORD-404' }),
    ).resolves.toEqual({
      status: 'not_found',
      resource: 'orders',
      orderId: 'ORD-404',
    });
    await expect(
      gateway.getOrders({ token: 'user-jwt', orderId: 'ORD-404' }),
    ).resolves.toMatchObject({
      status: 'route_unavailable',
      resource: 'orders',
      retryable: false,
    });
  });

  it('authenticates by phone using the strict envelope and epoch expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        credentials: {
          access_token: 'phone-jwt',
          expires_in: 1787843661,
        },
        user: {
          email: 'registered@example.com',
        },
      },
      errors: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.authByPhone({
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toEqual({
      status: 'authenticated',
      token: 'phone-jwt',
      tokenExpiresAtIso: '2026-08-27T15:14:21.000Z',
      email: 'registered@example.com',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/agent/auth-by-phone',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'X-Agent-Key': 'secret-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          phone_extension: '+51',
          phone_number: '973296571',
        }),
      }),
    );
  });

  it('logs the complete phone-auth exchange while fingerprinting both credentials', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        credentials: {
          access_token: 'phone-jwt-secret',
          expires_in: 1787843661,
        },
        user: {
          id: 97,
          email: 'registered@example.com',
        },
      },
      errors: null,
      error: null,
    })));
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'agent-api-secret',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await gateway.authByPhone({
      phone_extension: '+51',
      phone_number: '973296571',
    });

    const logs = JSON.stringify(info.mock.calls);
    expect(logs).toContain('auth_http_request_started');
    expect(logs).toContain('agent_api');
    expect(logs).toContain('authenticate_by_phone');
    expect(logs).toContain('X-Agent-Key');
    expect(logs).toContain('"length":16');
    expect(logs).toContain('"phone_extension":"+51"');
    expect(logs).toContain('"phone_number":"973296571"');
    expect(logs).toContain('auth_http_response_received');
    expect(logs).toContain('"response_status":200');
    expect(logs).toContain('"length":16');
    expect(logs).toContain('"expires_in":1787843661');
    expect(logs).toContain('"id":97');
    expect(logs).toContain('registered@example.com');
    expect(logs).not.toContain('agent-api-secret');
    expect(logs).not.toContain('phone-jwt-secret');
  });

  it('maps structured phone user-not-found and generic failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {
        status: false,
        data: null,
        errors: { code: 'user_not_found' },
        error: 'No user',
      }))
      .mockResolvedValueOnce(jsonResponse(503, {
        status: false,
        data: null,
        errors: null,
        error: 'temporary',
      }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.authByPhone({
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toEqual({ status: 'user_not_found' });
    await expect(gateway.authByPhone({
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toMatchObject({
      status: 'failed',
      retryable: true,
    });
  });

  it('fails closed when phone authentication omits the backend email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        credentials: {
          access_token: 'phone-jwt',
          expires_in: 1787843661,
        },
        user: {},
      },
      errors: null,
      error: null,
    })));
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.authByPhone({
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toEqual({
      status: 'failed',
      error: 'Agent API phone authentication response had an unexpected shape.',
      retryable: false,
    });
  });

  it('rejects an auth-by-phone expiry that is already in the past', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        credentials: {
          access_token: 'phone-jwt-past-expiry',
          expires_in: 1_000_000_000,
        },
        user: {
          email: 'registered@example.com',
        },
      },
      errors: null,
      error: null,
    })));
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.authByPhone({
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toEqual({
      status: 'failed',
      error: 'Agent API phone authentication response had an expired expiry.',
      retryable: false,
    });
  });

  it('updates a phone with both Agent API authentication headers and maps a nonfatal conflict', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        status: true,
        data: { updated: true },
        errors: null,
        error: null,
      }))
      .mockResolvedValueOnce(jsonResponse(409, {
        status: false,
        data: null,
        errors: { code: 'phone_linked_to_other_account' },
        error: 'Phone linked',
      }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.updatePhone({
      token: 'verified-jwt',
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toEqual({ status: 'success' });
    await expect(gateway.updatePhone({
      token: 'verified-jwt',
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toEqual({ status: 'phone_linked_to_other_account' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/api/agent/user/update-phone',
      expect.objectContaining({
        headers: {
          'X-Agent-Key': 'secret-key',
          Authorization: 'Bearer verified-jwt',
          'content-type': 'application/json',
        },
      }),
    );
  });

  it('reads account-less guest events and full event detail using only the Agent API key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        status: true,
        data: {
          events: [{
            event_id: 88,
            name: 'Boda Laura & Marcos',
            slug: 'boda-laura-marcos',
            url: 'https://sinenvolturas.com/boda-laura-marcos',
            datetime: '15/09/2026 18:00',
            type: 'wedding',
            type_detail: null,
            stage: 'published',
            city: 'Lima',
            country: 'Perú',
            currency: 'PEN',
            role: 'guest',
          }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: true,
        data: {
          event: {
            event_id: 88,
            name: 'Boda Laura & Marcos',
            slug: 'boda-laura-marcos',
            url: 'boda-laura-marcos',
            type: 'wedding',
            type_detail: null,
            datetime: '15/09/2026 18:00',
            with_time: true,
            timezone: 'America/Lima',
            city: 'Lima',
            country: { id: 173, name: 'Perú', short_code: 'PE' },
            celebrateds: [{ name: 'Laura', type: 'bride' }],
            moments: [{
              label: 'Recepción',
              description: 'Cena y baile.',
              datetime: '15/09/2026 19:00',
              with_time: true,
              location_description: 'Salón principal',
              location_reference: null,
              location_url: null,
              location_coords: null,
              position: 1,
            }],
            dresscode: { type: 'formal', description: 'Vestimenta formal.' },
            common_asked: [{ question: '¿Habrá transporte?', answer: 'Sí.' }],
            contact_info: {
              email: 'coordinacion@example.com',
              phone: '+51 999 999 999',
              title: 'Coordinadora',
              name_relation: 'Laura',
            },
          },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.getGuestEventsByPhone({
      phone_extension: '+51',
      phone_number: '973296571',
    })).resolves.toMatchObject({
      status: 'success',
      events: [{ eventId: 88, name: 'Boda Laura & Marcos', city: 'Lima' }],
    });
    await expect(gateway.getEventDetail({ eventId: 88 })).resolves.toMatchObject({
      status: 'success',
      event: {
        eventId: 88,
        timezone: 'America/Lima',
        dresscode: { type: 'formal' },
        moments: [{ label: 'Recepción', locationDescription: 'Salón principal' }],
        contactInfo: [
          { label: 'email', value: 'coordinacion@example.com' },
          { label: 'phone', value: '+51 999 999 999' },
          { label: 'title', value: 'Coordinadora' },
          { label: 'name_relation', value: 'Laura' },
        ],
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/api/agent/guest/events?phone_extension=%2B51&phone_number=973296571',
      expect.objectContaining({
        method: 'GET',
        headers: { 'X-Agent-Key': 'secret-key' },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/api/agent/event?event_id=88',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('records an RSVP using the phone identity and optional guest id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        already_responded: false,
        guest_id: 481,
        will_attend: true,
        event_name: 'Matrimonio de Ana y Luis',
      },
      errors: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '973296571',
      action: 'attending',
      guest_id: 481,
    })).resolves.toEqual({
      status: 'responded',
      action: 'attending',
      willAttend: true,
      guestId: 481,
      eventName: 'Matrimonio de Ana y Luis',
      eventDate: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/agent/guest/rsvp',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'X-Agent-Key': 'secret-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          phone_extension: '+51',
          phone_number: '973296571',
          action: 'attending',
          guest_id: 481,
        }),
      }),
    );
  });

  it('maps multiple pending RSVP candidates and terminal failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        status: true,
        data: {
          pending_guests: [
            {
              guest_id: 481,
              event_name: 'Matrimonio de Ana y Luis',
              event_date: '2026-09-12',
            },
            {
              guest_id: 482,
              event: {
                name: 'Cumpleaños de Marta',
                date: null,
              },
            },
          ],
        },
        code: 'multiple_pending',
        error: 'Hay varias invitaciones pendientes.',
      }))
      .mockResolvedValueOnce(jsonResponse(404, {
        status: false,
        data: [],
        errors: null,
        error: 'No se encontraron respuestas de asistencia pendientes para este número.',
      }))
      .mockResolvedValueOnce(jsonResponse(403, {
        status: false,
        data: null,
        errors: { code: 'phone_mismatch' },
        error: 'El invitado no corresponde al teléfono.',
      }))
      .mockResolvedValueOnce(jsonResponse(409, {
        status: false,
        data: { guest_id: 481 },
        errors: { code: 'already_responded' },
        error: 'La invitación ya fue respondida.',
      }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });
    const input = {
      phone_extension: '+51',
      phone_number: '973296571',
      action: 'declining' as const,
    };

    await expect(gateway.guestRsvp(input)).resolves.toEqual({
      status: 'multiple_pending',
      candidates: [
        {
          guestId: 481,
          eventName: 'Matrimonio de Ana y Luis',
          eventDate: '2026-09-12',
        },
        {
          guestId: 482,
          eventName: 'Cumpleaños de Marta',
          eventDate: null,
        },
      ],
    });
    await expect(gateway.guestRsvp(input)).resolves.toEqual({ status: 'no_pending' });
    await expect(gateway.guestRsvp(input)).resolves.toEqual({ status: 'phone_mismatch' });
    await expect(gateway.guestRsvp(input)).resolves.toEqual({
      status: 'already_responded',
      currentAction: null,
      requestedAction: 'declining',
      guestId: null,
      eventName: null,
      eventDate: null,
    });
  });

  it('treats will_attend as the final state even when a successful update reports an earlier response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: {
        already_responded: true,
        will_attend: true,
        event_name: 'Otra celebración prueba',
      },
      errors: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '973296571',
      action: 'attending',
      guest_id: 584353,
    })).resolves.toEqual({
      status: 'responded',
      action: 'attending',
      willAttend: true,
      guestId: 584353,
      eventName: 'Otra celebración prueba',
      eventDate: null,
    });
  });

  it('does not treat an RSVP success without resulting attendance state as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      status: true,
      data: { action: 'attending', guest_id: 584353 },
      errors: null,
      error: null,
    })));
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });

    await expect(gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '973296571',
      action: 'attending',
      guest_id: 584353,
    })).resolves.toEqual({
      status: 'failed',
      error: 'Agent API RSVP response did not confirm the requested attendance state.',
      retryable: false,
    });
  });

  it('fails closed for malformed RSVP success and candidate envelopes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        status: true,
        data: { action: 'unexpected' },
        errors: null,
        error: null,
      }))
      .mockResolvedValueOnce(jsonResponse(409, {
        status: false,
        data: { candidates: [{ guest_id: 'not-an-integer' }] },
        errors: { code: 'multiple_pending' },
        error: 'Hay varias invitaciones pendientes.',
      }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({
      baseUrl: 'https://api.example.test/api/agent',
      apiKey: 'secret-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      messageLoggingEnabled: false,
    });
    const input = {
      phone_extension: '+51',
      phone_number: '973296571',
      action: 'attending' as const,
    };

    await expect(gateway.guestRsvp(input)).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
    });
    await expect(gateway.guestRsvp(input)).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
    });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html',
    },
  });
}
