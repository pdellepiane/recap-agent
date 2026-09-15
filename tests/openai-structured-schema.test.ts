import { describe, expect, it } from 'vitest';

import { extractionSchema } from '../src/runtime/extraction-schemas';
import { assertOpenAiStructuredSchemaCompatible } from '../src/runtime/openai-structured-schema';
import {
  genericMessageSchema,
  multiNeedRecommendationMessageSchema,
  recommendationMessageSchema,
  welcomeMessageSchema,
} from '../src/runtime/structured-message';

const openAiOutputSchemas = [
  ['extraction', extractionSchema],
  ['reply_welcome', welcomeMessageSchema],
  ['reply_recommendation', recommendationMessageSchema],
  ['reply_multi_need_recommendation', multiNeedRecommendationMessageSchema],
  ['reply_generic', genericMessageSchema],
] as const;

describe('OpenAI structured output schema compatibility', () => {
  it('converts and validates every OpenAI-facing output schema in one pass', () => {
    const failures: string[] = [];

    for (const [name, schema] of openAiOutputSchemas) {
      try {
        assertOpenAiStructuredSchemaCompatible(schema, name);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    expect(failures).toEqual([]);
  });
});
