import path from 'node:path';
import { z } from 'zod';

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
  };
  recommendation: {
    replyProviderLimit: number;
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
  REPLY_PROVIDER_LIMIT: z.coerce.number().int().positive().default(4),
  PROVIDER_DETAIL_LOOKUP_LIMIT: z.coerce.number().int().positive().default(3),
  PERF_TABLE_NAME: z.string().min(1).optional(),
  PERF_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
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
    },
    recommendation: {
      replyProviderLimit: environment.REPLY_PROVIDER_LIMIT,
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
  };
}
