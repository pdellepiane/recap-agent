import path from 'node:path';

import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  compareStaticPromptShapes,
  legacyPromptBaselineRef,
} from '../src/audit/static-prompt-comparison';

describe('static prompt comparison', () => {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

  it('proves every route-scoped prompt is leaner than the historical baseline', async () => {
    const result = await compareStaticPromptShapes({
      loader,
      counterModel: 'gpt-5.6-luna',
      generatedAt: '2026-08-04T00:00:00.000Z',
    });

    expect(result.baselineRef).toBe(legacyPromptBaselineRef);
    expect(result.comparisons).toHaveLength(32);
    expect(result.violations).toEqual([]);
    expect(result.summary.currentSerializedRequestBytes)
      .toBeLessThan(result.summary.baselineSerializedRequestBytes);
    expect(result.summary.serializedRequestByteReductionPercent).toBeGreaterThan(20);
    expect(route(result, 'classifier').serializedRequestByteReductionPercent).toBe(0);
    expect(route(result, 'extractor:conversation_only').current.fileCount).toBe(1);
    expect(route(result, 'extractor:shortlist').current.fileCount).toBe(6);
    expect(route(result, 'contacto_inicial').current.fileCount).toBe(7);
    expect(route(result, 'recomendar').current.fileCount).toBe(10);
    expect(route(result, 'resolver_consultas_informativas').current.fileCount).toBe(7);
  }, 15_000);

  it('uses non-generative input-token counting only when supplied', async () => {
    const count = vi.fn().mockResolvedValue({
      object: 'response.input_tokens',
      input_tokens: 100,
    });
    const openAIClient = {
      responses: { inputTokens: { count } },
    } as unknown as OpenAI;

    const result = await compareStaticPromptShapes({
      loader,
      counterModel: 'gpt-5.6-luna',
      openAIClient,
    });

    expect(count).toHaveBeenCalledTimes(result.comparisons.length * 2);
    expect(result.comparisons.every(
      (comparison) => comparison.baseline.remoteInputTokens === 100 &&
        comparison.current.remoteInputTokens === 100,
    )).toBe(true);
    expect(result.violations).toHaveLength(result.comparisons.length - 1);
  });
});

function route(
  result: Awaited<ReturnType<typeof compareStaticPromptShapes>>,
  routeName: string,
) {
  const comparison = result.comparisons.find(
    (candidate) => candidate.route === routeName,
  );
  if (!comparison) {
    throw new Error(`Missing comparison for ${routeName}.`);
  }
  return comparison;
}
