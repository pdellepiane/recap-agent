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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
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
      replyModel: 'gpt-5.4-mini',
      extractorModel: 'gpt-5.4-nano',
      promptCacheRetention: 'in-memory',
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
  });
});
