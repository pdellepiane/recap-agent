import { describe, expect, it } from 'vitest';
import { getConfig } from '../src/runtime/config';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import type { ComposeReplyRequest } from '../src/runtime/contracts';
import { createEmptyPlan } from '../src/core/plan';

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createRequest(currentNode: ComposeReplyRequest['currentNode']): ComposeReplyRequest {
  return {
    previousNode: 'contacto_inicial',
    currentNode,
    userMessage: '¿Cuánto cuesta Sin Envolturas?',
    extraction: {
      intent: currentNode === 'consultar_faq' ? 'consultar_faq' : 'buscar_proveedores',
      intentConfidence: 0.95,
      eventType: null,
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: null,
      location: null,
      budgetSignal: null,
      guestRange: null,
      preferences: [],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: '',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: null,
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
    },
    plan: createEmptyPlan({
      planId: 'plan-vector-store-separation',
      channel: 'terminal_whatsapp',
      externalUserId: 'user-vector-store-separation',
    }),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'test-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
  };
}

describe('FAQ and provider vector store separation', () => {
  it('keeps guest authentication and event lookup in production by default', () => {
    withEnv(
      {
        SINENVOLTURAS_GUEST_SERVICE_BASE_URL: undefined,
        SINENVOLTURAS_GUEST_AUTH_BASE_URL: undefined,
      },
      () => {
        const config = getConfig();

        expect(config.providerApi.guestAuthBaseUrl).toBe(
          'https://api.sinenvolturas.com/api-web/user',
        );
        expect(config.providerApi.guestServiceBaseUrl).toBe(
          'https://api.sinenvolturas.com/api/guest-service',
        );
      },
    );
  });

  it('maps KB_VECTOR_STORE_ID only to FAQ knowledge-base config', () => {
    withEnv(
      {
        OPENAI_API_KEY: 'test-key',
        PROVIDER_VECTOR_STORE_ID: 'vs_provider_test',
        KB_VECTOR_STORE_ID: 'vs_kb_test',
      },
      () => {
        const config = getConfig();

        expect(config.providerApi.vectorStoreId).toBe('vs_provider_test');
        expect(config.knowledgeBase.vectorStoreId).toBe('vs_kb_test');
        expect(config.providerApi.vectorStoreId).not.toBe(config.knowledgeBase.vectorStoreId);
      },
    );
  });

  it('uses the KB vector store only for consultar_faq hosted file_search', () => {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-5.4-mini',
      extractorModel: 'gpt-5.4-nano',
      promptCacheRetention: 'in-memory',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: {} as never,
      providerGateway: {} as never,
      knowledgeBase: { enabled: true, vectorStoreId: 'vs_kb_test' },
    });
    const typedRuntime = runtime as unknown as {
      createFileSearchTool: (request: ComposeReplyRequest) => { name: string } | null;
    };

    expect(typedRuntime.createFileSearchTool(createRequest('consultar_faq'))?.name).toBe('file_search');
    expect(typedRuntime.createFileSearchTool(createRequest('recomendar'))).toBeNull();
  });
});
