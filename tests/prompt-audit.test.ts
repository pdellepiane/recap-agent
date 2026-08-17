import path from 'node:path';

import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { auditPromptBundles } from '../src/audit/prompt-audit';
import { PromptLoader } from '../src/runtime/prompt-loader';

describe('prompt audit', () => {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

  it('passes completeness, ownership, duplication, relevance, and size gates', async () => {
    const result = await auditPromptBundles({
      loader,
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
    });

    expect(result.violations).toEqual([]);
    expect(result.entries).toHaveLength(33);
    expect(entry(result, 'contacto_inicial')).toMatchObject({
      serializedRequestBytes: 7279,
      maximumToolCount: 0,
    });
    expect(entry(result, 'resolver_consultas_informativas')).toMatchObject({
      serializedRequestBytes: 15721,
      maximumToolCount: 0,
    });
    expect(entry(result, 'responder_invitacion')).toMatchObject({
      maximumToolCount: 0,
    });
    expect(entry(result, 'extractor:rsvp').serializedRequestBytes)
      .toBeLessThan(4_500);
    expect(entry(result, 'extractor:conversation_only').serializedRequestBytes)
      .toBeLessThan(2_500);
    expect(entry(result, 'extractor:initial_planning_information').serializedRequestBytes)
      .toBeLessThan(9_000);
    expect(entry(result, 'extractor:shortlist').serializedRequestBytes)
      .toBeLessThan(12_000);
    for (const auditEntry of result.entries) {
      expect(auditEntry.ruleIds).toHaveLength(auditEntry.filePaths.length);
      expect(auditEntry.remoteInputTokens).toBeNull();
    }
  });

  it('uses the non-generative input token endpoint when explicitly enabled', async () => {
    const count = vi.fn().mockResolvedValue({
      object: 'response.input_tokens',
      input_tokens: 123,
    });
    const openAIClient = {
      responses: {
        inputTokens: { count },
      },
    } as unknown as OpenAI;

    const result = await auditPromptBundles({
      loader,
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
      openAIClient,
    });

    expect(count).toHaveBeenCalledTimes(result.entries.length);
    expect(result.entries.every((auditEntry) => auditEntry.remoteInputTokens === 123))
      .toBe(true);
  });
});

function entry(
  result: Awaited<ReturnType<typeof auditPromptBundles>>,
  route: string,
) {
  const match = result.entries.find((auditEntry) => auditEntry.route === route);
  if (!match) {
    throw new Error(`Missing prompt audit entry for ${route}.`);
  }
  return match;
}
