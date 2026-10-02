import type { ModelSettings } from '@openai/agents';

export const DEFAULT_GPT_TEXT_MODEL = 'gpt-6-luna';

/**
 * Evaluator default. The migration comparison is complete: the grader
 * shares the gpt-6-luna application default. Per-expectation and
 * per-scorer judgeModel overrides still take precedence where set.
 * Official application model card:
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 */
export const DEFAULT_EVAL_JUDGE_MODEL = 'gpt-6-luna';

export const DEFAULT_PROMPT_CACHE_OPTIONS = {
  mode: 'implicit',
  ttl: '30m',
} as const satisfies NonNullable<ModelSettings['promptCacheOptions']>;
