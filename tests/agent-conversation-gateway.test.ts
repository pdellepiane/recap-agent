import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  HttpAgentConversationGateway,
  NoopAgentConversationGateway,
} from '../src/runtime/agent-conversation-gateway';

describe('AgentConversationGateway', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('skips all operations in no-op mode', async () => {
    const gateway = new NoopAgentConversationGateway('not_configured');

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'skipped',
      reason: 'not_configured',
      message: 'Agent API human takeover is not configured.',
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
    });

    await expect(gateway.requestHumanTakeover('51987654321')).resolves.toEqual({
      status: 'success',
      message: 'Human takeover requested.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
