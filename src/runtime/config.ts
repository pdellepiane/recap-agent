import path from 'node:path';
import { z } from 'zod';
import type { ProviderSearchMode } from './provider-gateway';

export type AppConfig = {
  channelAuth: {
    apiKey: string | null;
    secretId: string | null;
  };
  openAi: {
    apiKey: string | null;
    secretId: string | null;
    promptCacheRetention: 'in-memory' | '24h';
    models: {
      reply: string;
      extractor: string;
      responseClassifier: string;
    };
  };
  responseClassifier: {
    mode: 'observe' | 'enforce';
  };
  aws: {
    region: string;
  };
  storage: {
    plansTableName: string;
  };
  prompts: {
    dir: string;
  };
  providerApi: {
    baseUrl: string;
    guestServiceBaseUrl: string;
    guestAuthBaseUrl: string;
    persistedSearchLimit: number;
    summarySearchWordLimit: number;
    searchMode: ProviderSearchMode;
    vectorStoreName: string;
    vectorStoreId: string | null;
    vectorMaxResults: number;
    vectorScoreThreshold: number;
  };
  agentApi: {
    baseUrl: string;
    secretId: string | null;
    timeoutMs: number;
    maxRetries: number;
    messageLoggingEnabled: boolean;
  };
  recommendation: {
    replyProviderLimit: number;
    presentationProviderLimit: number;
    providerDetailLookupLimit: number;
  };
  conversation: {
    defaultChannel: string;
  };
  lambda: {
    functionUrl: string | null;
  };
  performance: {
    tableName: string | null;
    retentionDays: number;
    captureAssistantPreview: boolean;
  };
  knowledgeBase: {
    baseUrl: string;
    vectorStoreName: string;
    vectorStoreId: string | null;
    enabled: boolean;
  };
  features: AgentFeatureFlags;
};

export type AgentFeatureFlags = {
  providerPlanning: boolean;
  providerSearch: boolean;
  providerQuoteRequests: boolean;
  faq: boolean;
  invitedEventLookup: boolean;
};

const environmentSchema = z.object({
  CHANNEL_API_KEY: z.string().min(1).optional(),
  CHANNEL_API_SECRET_ID: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_SECRET_ID: z.string().min(1).optional(),
  OPENAI_PROMPT_CACHE_RETENTION: z.enum(['in-memory', '24h']).default('in-memory'),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  OPENAI_EXTRACTOR_MODEL: z.string().min(1).default('gpt-5.4-nano'),
  OPENAI_RESPONSE_CLASSIFIER_MODEL: z.string().min(1).default('gpt-5.4-nano'),
  RESPONSE_CLASSIFIER_MODE: z.enum(['observe', 'enforce']).default('enforce'),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  PLANS_TABLE_NAME: z.string().min(1).default('recap-agent-plans'),
  PROMPTS_DIR: z.string().min(1).optional(),
  SINENVOLTURAS_BASE_URL: z
    .string()
    .url()
    .default('https://api.sinenvolturas.com/api-web/vendor'),
  SINENVOLTURAS_GUEST_SERVICE_BASE_URL: z
    .string()
    .url()
    .default('https://se-v2-api-dev.jnq.io/api/guest-service'),
  SINENVOLTURAS_GUEST_AUTH_BASE_URL: z
    .string()
    .url()
    .default('https://api.sinenvolturas.com/api-web/user'),
  AGENT_API_BASE_URL: z
    .string()
    .url()
    .default('https://api.sinenvolturas.com/api/agent'),
  SE_API_SECRET_ID: z.string().min(1).optional(),
  AGENT_API_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(5_000),
  AGENT_API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AGENT_MESSAGE_LOGGING_ENABLED: z.enum(['true', 'false']).default('false'),
  AGENT_FUNCTION_URL: z.string().url().optional(),
  DEFAULT_INBOUND_CHANNEL: z.string().min(1).default('terminal_whatsapp'),
  PROVIDER_SEARCH_LIMIT: z.coerce.number().int().positive().default(12),
  SEARCH_SUMMARY_WORD_LIMIT: z.coerce.number().int().positive().default(5),
  PROVIDER_SEARCH_MODE: z.enum(['api', 'vector', 'hybrid']).default('hybrid'),
  PROVIDER_VECTOR_STORE_NAME: z.string().min(1).default('Sin Envolturas Provider Search'),
  PROVIDER_VECTOR_STORE_ID: z.string().optional(),
  PROVIDER_VECTOR_MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(24),
  PROVIDER_VECTOR_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
  REPLY_PROVIDER_LIMIT: z.coerce.number().int().positive().default(6),
  PRESENTATION_PROVIDER_LIMIT: z.coerce.number().int().positive().default(6),
  PROVIDER_DETAIL_LOOKUP_LIMIT: z.coerce.number().int().positive().default(3),
  PERF_TABLE_NAME: z.string().min(1).optional(),
  PERF_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PERF_CAPTURE_ASSISTANT_PREVIEW: z.enum(['true', 'false']).default('true'),
  KB_BASE_URL: z.string().url().default('https://sinenvolturas.tawk.help'),
  KB_VECTOR_STORE_NAME: z.string().min(1).default('Sin Envolturas Knowledge Base'),
  KB_VECTOR_STORE_ID: z.string().optional(),
  KB_ENABLED: z.enum(['true', 'false']).default('true'),
  AGENT_FEATURE_PROVIDER_PLANNING: z.enum(['true', 'false']).default('true'),
  AGENT_FEATURE_PROVIDER_SEARCH: z.enum(['true', 'false']).default('true'),
  AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS: z.enum(['true', 'false']).default('true'),
  AGENT_FEATURE_FAQ: z.enum(['true', 'false']).default('true'),
  AGENT_FEATURE_INVITED_EVENT_LOOKUP: z.enum(['true', 'false']).default('true'),
});

export function getConfig(): AppConfig {
  const environment = environmentSchema.parse(process.env);

  return {
    channelAuth: {
      apiKey: environment.CHANNEL_API_KEY ?? null,
      secretId: environment.CHANNEL_API_SECRET_ID ?? null,
    },
    openAi: {
      apiKey: environment.OPENAI_API_KEY ?? null,
      secretId: environment.OPENAI_SECRET_ID ?? null,
      promptCacheRetention: environment.OPENAI_PROMPT_CACHE_RETENTION,
      models: {
        reply: environment.OPENAI_MODEL,
        extractor:
          environment.OPENAI_EXTRACTOR_MODEL ?? environment.OPENAI_MODEL,
        responseClassifier: environment.OPENAI_RESPONSE_CLASSIFIER_MODEL,
      },
    },
    responseClassifier: {
      mode: environment.RESPONSE_CLASSIFIER_MODE,
    },
    aws: {
      region: environment.AWS_REGION,
    },
    storage: {
      plansTableName: environment.PLANS_TABLE_NAME,
    },
    prompts: {
      dir: environment.PROMPTS_DIR ?? path.resolve(process.cwd(), 'prompts'),
    },
    providerApi: {
      baseUrl: environment.SINENVOLTURAS_BASE_URL,
      guestServiceBaseUrl: environment.SINENVOLTURAS_GUEST_SERVICE_BASE_URL,
      guestAuthBaseUrl: environment.SINENVOLTURAS_GUEST_AUTH_BASE_URL,
      persistedSearchLimit: environment.PROVIDER_SEARCH_LIMIT,
      summarySearchWordLimit: environment.SEARCH_SUMMARY_WORD_LIMIT,
      searchMode: environment.PROVIDER_SEARCH_MODE,
      vectorStoreName: environment.PROVIDER_VECTOR_STORE_NAME,
      vectorStoreId: environment.PROVIDER_VECTOR_STORE_ID ?? null,
      vectorMaxResults: environment.PROVIDER_VECTOR_MAX_RESULTS,
      vectorScoreThreshold: environment.PROVIDER_VECTOR_SCORE_THRESHOLD,
    },
    agentApi: {
      baseUrl: environment.AGENT_API_BASE_URL.replace(/\/+$/u, ''),
      secretId: environment.SE_API_SECRET_ID ?? null,
      timeoutMs: environment.AGENT_API_TIMEOUT_MS,
      maxRetries: environment.AGENT_API_MAX_RETRIES,
      messageLoggingEnabled: environment.AGENT_MESSAGE_LOGGING_ENABLED === 'true',
    },
    recommendation: {
      replyProviderLimit: environment.REPLY_PROVIDER_LIMIT,
      presentationProviderLimit: environment.PRESENTATION_PROVIDER_LIMIT,
      providerDetailLookupLimit: environment.PROVIDER_DETAIL_LOOKUP_LIMIT,
    },
    conversation: {
      defaultChannel: environment.DEFAULT_INBOUND_CHANNEL,
    },
    lambda: {
      functionUrl: environment.AGENT_FUNCTION_URL ?? null,
    },
    performance: {
      tableName: environment.PERF_TABLE_NAME ?? null,
      retentionDays: environment.PERF_RETENTION_DAYS,
      captureAssistantPreview: environment.PERF_CAPTURE_ASSISTANT_PREVIEW === 'true',
    },
    knowledgeBase: {
      baseUrl: environment.KB_BASE_URL,
      vectorStoreName: environment.KB_VECTOR_STORE_NAME,
      vectorStoreId: environment.KB_VECTOR_STORE_ID ?? null,
      enabled: environment.KB_ENABLED === 'true',
    },
    features: {
      providerPlanning: environment.AGENT_FEATURE_PROVIDER_PLANNING === 'true',
      providerSearch: environment.AGENT_FEATURE_PROVIDER_SEARCH === 'true',
      providerQuoteRequests: environment.AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS === 'true',
      faq: environment.AGENT_FEATURE_FAQ === 'true',
      invitedEventLookup: environment.AGENT_FEATURE_INVITED_EVENT_LOOKUP === 'true',
    },
  };
}
