import type { ModelSettings } from '@openai/agents';

export const DEFAULT_GPT_TEXT_MODEL = 'gpt-6-luna';

/**
 * First migration comparison judge. The evaluator default is pinned to
 * gpt-5.6-luna so moving the application model to gpt-6-luna does not
 * quietly change the grader; candidate and judge identities stay
 * comparable across the migration. Official application model card:
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 */
export const DEFAULT_EVAL_JUDGE_MODEL = 'gpt-5.6-luna';

export const DEFAULT_PROMPT_CACHE_OPTIONS = {
  mode: 'implicit',
  ttl: '30m',
} as const satisfies NonNullable<ModelSettings['promptCacheOptions']>;
