import path from 'node:path';
import { z } from 'zod';
import type { ProviderSearchMode } from './provider-gateway';

export type AppConfig = {
  openAi: {
    apiKey: string | null;
    secretId: string | null;
    promptCacheRetention: 'in-memory' | '24h';
    models: {
      reply: string;
      extractor: string;
    };
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
    persistedSearchLimit: number;
    summarySearchWordLimit: number;
    searchMode: ProviderSearchMode;
    vectorStoreName: string;
    vectorStoreId: string | null;
    vectorMaxResults: number;
    vectorScoreThreshold: number;
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
  };
  knowledgeBase: {
    baseUrl: string;
    vectorStoreName: string;
    vectorStoreId: string | null;
    enabled: boolean;
  };
};

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_SECRET_ID: z.string().min(1).optional(),
  OPENAI_PROMPT_CACHE_RETENTION: z.enum(['in-memory', '24h']).default('in-memory'),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  OPENAI_EXTRACTOR_MODEL: z.string().min(1).default('gpt-5.4-nano'),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  PLANS_TABLE_NAME: z.string().min(1).default('recap-agent-plans'),
  PROMPTS_DIR: z.string().min(1).optional(),
  SINENVOLTURAS_BASE_URL: z
    .string()
    .url()
    .default('https://api.sinenvolturas.com/api-web/vendor'),
  AGENT_FUNCTION_URL: z.string().url().optional(),
  DEFAULT_INBOUND_CHANNEL: z.string().min(1).default('terminal_whatsapp'),
  PROVIDER_SEARCH_LIMIT: z.coerce.number().int().positive().default(5),
  SEARCH_SUMMARY_WORD_LIMIT: z.coerce.number().int().positive().default(5),
  PROVIDER_SEARCH_MODE: z.enum(['api', 'vector', 'hybrid']).default('hybrid'),
  PROVIDER_VECTOR_STORE_NAME: z.string().min(1).default('Sin Envolturas Provider Search'),
  PROVIDER_VECTOR_STORE_ID: z.string().optional(),
  PROVIDER_VECTOR_MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(12),
  PROVIDER_VECTOR_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
  REPLY_PROVIDER_LIMIT: z.coerce.number().int().positive().default(4),
  PRESENTATION_PROVIDER_LIMIT: z.coerce.number().int().positive().default(5),
  PROVIDER_DETAIL_LOOKUP_LIMIT: z.coerce.number().int().positive().default(3),
  PERF_TABLE_NAME: z.string().min(1).optional(),
  PERF_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  KB_BASE_URL: z.string().url().default('https://sinenvolturas.tawk.help'),
  KB_VECTOR_STORE_NAME: z.string().min(1).default('Sin Envolturas Knowledge Base'),
  KB_VECTOR_STORE_ID: z.string().optional(),
  KB_ENABLED: z.enum(['true', 'false']).default('true'),
});

export function getConfig(): AppConfig {
  const environment = environmentSchema.parse(process.env);

  return {
    openAi: {
      apiKey: environment.OPENAI_API_KEY ?? null,
      secretId: environment.OPENAI_SECRET_ID ?? null,
      promptCacheRetention: environment.OPENAI_PROMPT_CACHE_RETENTION,
      models: {
        reply: environment.OPENAI_MODEL,
        extractor:
          environment.OPENAI_EXTRACTOR_MODEL ?? environment.OPENAI_MODEL,
      },
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
      persistedSearchLimit: environment.PROVIDER_SEARCH_LIMIT,
      summarySearchWordLimit: environment.SEARCH_SUMMARY_WORD_LIMIT,
      searchMode: environment.PROVIDER_SEARCH_MODE,
      vectorStoreName: environment.PROVIDER_VECTOR_STORE_NAME,
      vectorStoreId: environment.PROVIDER_VECTOR_STORE_ID ?? null,
      vectorMaxResults: environment.PROVIDER_VECTOR_MAX_RESULTS,
      vectorScoreThreshold: environment.PROVIDER_VECTOR_SCORE_THRESHOLD,
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
    },
    knowledgeBase: {
      baseUrl: environment.KB_BASE_URL,
      vectorStoreName: environment.KB_VECTOR_STORE_NAME,
      vectorStoreId: environment.KB_VECTOR_STORE_ID ?? null,
      enabled: environment.KB_ENABLED === 'true',
    },
  };
}
