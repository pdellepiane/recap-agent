import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';

describe('OpenAiAgentRuntime retry behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes exactly one Agents SDK request for insufficient quota', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: 'You exceeded your current quota.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {} as never,
    });

    await expect(runtime.extract({
      userMessage: 'Necesito catering.',
      plan: createEmptyPlan({
        planId: 'agents-sdk-quota',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messageContext: localTurnMessageContext('not_configured'),
    })).rejects.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    const requestBody = JSON.parse(
      typeof body === 'string' ? body : '{}',
    ) as {
      model?: string;
      store?: boolean;
      prompt_cache_key?: string;
      prompt_cache_options?: { mode?: string; ttl?: string };
      prompt_cache_retention?: unknown;
      reasoning?: { effort?: string };
      text?: { verbosity?: string };
    };
    expect(requestBody.model).toBe('gpt-5.6-luna');
    expect(requestBody.store).toBe(true);
    expect(requestBody.prompt_cache_key).toMatch(/^extractor:/u);
    expect(requestBody.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(requestBody).not.toHaveProperty('prompt_cache_retention');
    expect(requestBody.reasoning).toEqual({ effort: 'none' });
    expect(requestBody.text?.verbosity).toBe('low');
  });
});
