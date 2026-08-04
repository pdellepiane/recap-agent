import { describe, expect, it, vi } from 'vitest';

import {
  OpenAiAuditClient,
  sanitizeOpenAiError,
} from '../src/audit/openai-audit-client';

describe('OpenAiAuditClient', () => {
  it('retrieves a response and every paginated input item using GET only', async () => {
    const requestFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse({ id: 'resp_test', model: 'gpt-test' }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'item_1', role: 'system' }],
        has_more: true,
        last_id: 'item_1',
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'item_2', role: 'user' }],
        has_more: false,
        last_id: 'item_2',
      }));
    const client = new OpenAiAuditClient({
      apiKey: 'sk-test-secret',
      fetch: requestFetch,
      baseUrl: 'https://api.test/v1',
    });

    const response = await client.retrieveResponse('resp_test');
    const inputItems = await client.listAllInputItems('resp_test');

    expect(response.id).toBe('resp_test');
    expect(inputItems.map((item) => item.id)).toEqual(['item_1', 'item_2']);
    expect(requestFetch).toHaveBeenCalledTimes(3);
    for (const call of requestFetch.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    }
    const thirdUrl = requestFetch.mock.calls[2]?.[0];
    const thirdUrlText = typeof thirdUrl === 'string'
      ? thirdUrl
      : thirdUrl instanceof URL
        ? thirdUrl.href
        : thirdUrl?.url ?? '';
    expect(thirdUrlText).toContain('after=item_1');
  });

  it('sanitizes API keys and authorization values from errors', () => {
    expect(sanitizeOpenAiError(
      'Authorization: Bearer sk-project-secret and sk-anothersecret',
    )).toBe('Authorization: Bearer [redacted] and [redacted-api-key]');
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
