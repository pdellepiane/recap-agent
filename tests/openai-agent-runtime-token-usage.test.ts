import { describe, expect, it } from 'vitest';

import type { TokenUsage } from '../src/runtime/contracts';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';

function createRuntimeForTokenUsageTests(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-5.4-mini',
    extractorModel: 'gpt-5.4-nano',
    promptCacheRetention: 'in-memory',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: {} as never,
    providerGateway: {} as never,
  });
}

function extractTokenUsageFrom(runtime: OpenAiAgentRuntime, value: unknown): TokenUsage | null {
  return (
    runtime as unknown as {
      extractTokenUsage: (input: unknown) => TokenUsage | null;
    }
  ).extractTokenUsage(value);
}

describe('OpenAiAgentRuntime token usage parsing', () => {
  it('extracts usage from SDK run state camelCase shape', () => {
    const runtime = createRuntimeForTokenUsageTests();
    const parsed = extractTokenUsageFrom(runtime, {
      state: {
        usage: {
          inputTokens: 1200,
          outputTokens: 300,
          totalTokens: 1500,
          inputTokensDetails: [{ cached_tokens: 480 }],
        },
      },
    });

    expect(parsed).toEqual({
      input_tokens: 1200,
      output_tokens: 300,
      total_tokens: 1500,
      cached_input_tokens: 480,
    });
  });

  it('extracts cached tokens from request usage entries fallback', () => {
    const runtime = createRuntimeForTokenUsageTests();
    const parsed = extractTokenUsageFrom(runtime, {
      rawResponses: [
        {
          usage: {
            inputTokens: 900,
            outputTokens: 100,
            totalTokens: 1000,
            requestUsageEntries: [
              {
                inputTokens: 500,
                outputTokens: 50,
                totalTokens: 550,
                inputTokensDetails: { cached_tokens: 200 },
              },
              {
                inputTokens: 400,
                outputTokens: 50,
                totalTokens: 450,
                inputTokensDetails: { cached_tokens: 100 },
              },
            ],
          },
        },
      ],
    });

    expect(parsed).toEqual({
      input_tokens: 900,
      output_tokens: 100,
      total_tokens: 1000,
      cached_input_tokens: 300,
    });
  });
});
