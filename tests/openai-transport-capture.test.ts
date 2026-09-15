import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import {
  assertCompleteTransportAccounting,
  captureOpenAiTransport,
  installOpenAiTransportCapture,
} from '../src/audit/openai-transport-capture';
import type { OpenAiTransportMetrics } from '../src/runtime/contracts';

type TransportFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function requestBody(): string {
  return JSON.stringify({
    model: 'gpt-test',
    instructions: 'Instrucción con ñ',
    input: [{ role: 'user', content: 'Entrada' }],
    tools: [{ type: 'function', name: 'lookup' }],
    text: { format: { type: 'json_schema', name: 'reply', schema: { type: 'object' } } },
  });
}

function installFetch(client: OpenAI, fetchImplementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
  Reflect.set(client, 'fetch', fetchImplementation);
  installOpenAiTransportCapture(client);
}

function getTransport(client: OpenAI): TransportFetch {
  const transport: unknown = Reflect.get(client, 'fetch');
  if (typeof transport !== 'function') throw new Error('missing instrumented fetch');
  return transport as TransportFetch;
}

describe('OpenAI transport accounting', () => {
  it('captures every serialized request, identifiers, and UTF-8 component bytes', async () => {
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    let responseNumber = 0;
    installFetch(client, async () => {
      responseNumber += 1;
      return new Response(JSON.stringify({ id: `resp-${responseNumber}` }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': `req-${responseNumber}` },
      });
    });
    const transport = getTransport(client);

    const captured = await captureOpenAiTransport('reply', async () => {
      await transport('https://example.test/responses', { method: 'POST', body: requestBody() });
      await transport('https://example.test/responses', { method: 'POST', body: requestBody() });
    });

    expect(captured.metrics.observedRequestCount).toBe(2);
    expect(captured.metrics.requests).toHaveLength(2);
    expect(captured.metrics.requests.map((request) => [request.requestId, request.responseId])).toEqual([
      ['req-1', 'resp-1'],
      ['req-2', 'resp-2'],
    ]);
    const first = captured.metrics.requests[0];
    expect(first?.totalPayloadBytes).toBe(Buffer.byteLength(requestBody(), 'utf8'));
    expect(first?.instructionBytes).toBe(Buffer.byteLength(JSON.stringify('Instrucción con ñ'), 'utf8'));
    expect(first?.inputBytes).toBe(Buffer.byteLength(JSON.stringify([{ role: 'user', content: 'Entrada' }]), 'utf8'));
    expect(first?.toolBytes).toBe(Buffer.byteLength(JSON.stringify([{ type: 'function', name: 'lookup' }]), 'utf8'));
    expect(first?.outputSchemaBytes).toBeGreaterThan(0);
    expect(first?.requestBodySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => assertCompleteTransportAccounting(captured.metrics, 2)).not.toThrow();
  });

  it('retains a failed request observation instead of converting it to zero', async () => {
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    let capturedMetrics: OpenAiTransportMetrics | undefined;
    installFetch(client, async () => {
      throw new Error('transport unavailable');
    });
    const transport = getTransport(client);

    await expect(captureOpenAiTransport(
      'extraction',
      async () => await transport('https://example.test/responses', { method: 'POST', body: requestBody() }),
      (metrics) => { capturedMetrics = metrics; },
    )).rejects.toThrow('transport unavailable');

    expect(capturedMetrics?.observedRequestCount).toBe(1);
    expect(capturedMetrics?.requests[0]?.succeeded).toBeNull();
    expect(capturedMetrics?.requests[0]?.totalPayloadBytes).toBeGreaterThan(0);
    if (!capturedMetrics) throw new Error('missing failed transport metrics');
    const failedMetrics = capturedMetrics;
    expect(() => assertCompleteTransportAccounting(failedMetrics, 1)).not.toThrow();
  });

  it('detects a hidden second classifier request and attributes both calls to classifier', async () => {
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    let responseNumber = 0;
    installFetch(client, async () => {
      responseNumber += 1;
      return new Response(JSON.stringify({ id: `classifier-response-${responseNumber}` }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': `classifier-request-${responseNumber}`,
        },
      });
    });
    const transport = getTransport(client);
    const captured = await captureOpenAiTransport('classifier', async () => {
      await transport('https://example.test/responses', { method: 'POST', body: requestBody() });
      await transport('https://example.test/responses', { method: 'POST', body: requestBody() });
    });

    expect(captured.metrics.observedRequestCount).toBe(2);
    expect(captured.metrics.requests.map((request) => request.stage)).toEqual([
      'classifier',
      'classifier',
    ]);
    expect(() => assertCompleteTransportAccounting(captured.metrics, 2)).not.toThrow();
  });
});
