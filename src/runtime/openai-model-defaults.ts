import type { ModelSettings } from '@openai/agents';

export const DEFAULT_GPT_TEXT_MODEL = 'gpt-5.6-luna';

export const DEFAULT_PROMPT_CACHE_OPTIONS = {
  mode: 'implicit',
  ttl: '30m',
} as const satisfies NonNullable<ModelSettings['promptCacheOptions']>;
