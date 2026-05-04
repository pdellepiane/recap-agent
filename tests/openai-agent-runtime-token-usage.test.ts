import { describe, expect, it } from 'vitest';

import type { ComposeReplyRequest, TokenUsage, ToolUsage } from '../src/runtime/contracts';
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

function createComposeRequest(
  currentNode: ComposeReplyRequest['currentNode'],
): ComposeReplyRequest {
  return {
    currentNode,
    previousNode: 'contacto_inicial',
    userMessage: '¿Cuánto cobra Sin Envolturas?',
    plan: {
      plan_id: 'plan-1',
      channel: 'terminal_whatsapp_eval',
      external_user_id: 'user-1',
      conversation_id: null,
      lifecycle_state: 'active',
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      current_node: currentNode,
      intent: 'consultar_faq',
      intent_confidence: 0.95,
      event_type: null,
      vendor_category: null,
      active_need_category: null,
      location: null,
      budget_signal: null,
      guest_range: null,
      preferences: [],
      hard_constraints: [],
      missing_fields: [],
      provider_needs: [],
      recommended_provider_ids: [],
      recommended_providers: [],
      selected_provider_id: null,
      selected_provider_hint: null,
      assumptions: [],
      conversation_summary: '',
      last_user_goal: null,
      open_questions: [],
      updated_at: '2026-05-03T00:00:00.000Z',
    },
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'bundle-1',
    promptFilePaths: ['prompts/nodes/consultar_faq/system.txt'],
    toolUsage: {
      considered: [],
      called: [],
      inputs: [],
      outputs: [],
    },
  };
}

function createRuntimeWithKnowledgeBase(): OpenAiAgentRuntime {
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
    knowledgeBase: {
      enabled: true,
      vectorStoreId: 'vs_test',
    },
  });
}

describe('OpenAiAgentRuntime FAQ file search wiring', () => {
  it('only enables the hosted file search tool for consultar_faq', () => {
    const runtime = createRuntimeWithKnowledgeBase();
    const faqRequest = createComposeRequest('consultar_faq');
    const planningRequest = createComposeRequest('entrevista');
    const typedRuntime = runtime as unknown as {
      createFileSearchTool: (request: ComposeReplyRequest) => { name: string } | null;
      buildReplyModelSettings: (
        request: ComposeReplyRequest,
        hasFileSearchTool: boolean,
      ) => { toolChoice?: string };
    };

    expect(typedRuntime.createFileSearchTool(faqRequest)?.name).toBe('file_search');
    expect(typedRuntime.createFileSearchTool(planningRequest)).toBeNull();
    expect(typedRuntime.buildReplyModelSettings(faqRequest, true).toolChoice).toBe(
      'required',
    );
  });

  it('records hosted file_search calls from generated SDK run items', () => {
    const runtime = createRuntimeWithKnowledgeBase();
    const toolUsage: ToolUsage = {
      considered: ['file_search'],
      called: [],
      inputs: [],
      outputs: [],
    };
    const typedRuntime = runtime as unknown as {
      recordHostedToolUsage: (toolUsage: ToolUsage, result: unknown) => void;
    };

    typedRuntime.recordHostedToolUsage(toolUsage, {
      newItems: [
        {
          rawItem: {
            type: 'file_search_call',
            status: 'completed',
            providerData: {
              type: 'file_search_call',
              queries: ['cuanto cuesta sin envolturas'],
              results: [{ file_id: 'file-1' }],
            },
          },
        },
      ],
    });

    expect(toolUsage.called).toEqual(['file_search']);
    expect(toolUsage.inputs[0]).toEqual({
      tool: 'file_search',
      input: JSON.stringify({
        arguments: null,
        queries: ['cuanto cuesta sin envolturas'],
      }, null, 2),
    });
    expect(toolUsage.outputs[0]?.tool).toBe('file_search');
    expect(toolUsage.outputs[0]?.output).toContain('"result_count": 1');
  });
});
