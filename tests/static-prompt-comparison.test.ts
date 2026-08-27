import path from 'node:path';

import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  compareStaticPromptShapes,
  legacyPromptBaselineRef,
} from '../src/audit/static-prompt-comparison';
import { measureHistoricalBranches, measureCurrentBranches } from '../src/audit/prompt-branch-measurement';

describe('static prompt comparison', () => {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

  it('proves every route-scoped prompt is leaner than the historical baseline', async () => {
    const result = await compareStaticPromptShapes({
      loader,
      counterModel: 'gpt-5.6-luna',
      generatedAt: '2026-08-04T00:00:00.000Z',
    });

    expect(result.baselineRef).toBe(legacyPromptBaselineRef);
    expect(result.comparisons).toHaveLength(36);
    expect(result.violations).toEqual([]);
    expect(result.summary.currentSerializedRequestBytes)
      .toBeLessThan(result.summary.baselineSerializedRequestBytes);
    expect(result.summary.serializedRequestByteReductionPercent).toBeGreaterThan(20);
    expect(route(result, 'classifier').serializedRequestByteReductionPercent)
      .toBeGreaterThan(-5);
    expect(route(result, 'classifier:campaign_reply').serializedRequestByteReductionPercent)
      .toBeGreaterThan(50);
    expect(route(result, 'extractor:conversation_only').current.fileCount).toBe(1);
    expect(route(result, 'extractor:shortlist').current.fileCount).toBe(6);
    expect(route(result, 'extractor:rsvp').current.fileCount).toBe(2);
    expect(route(result, 'contacto_inicial').current.fileCount).toBe(7);
    expect(route(result, 'recomendar').current.fileCount).toBe(10);
    expect(route(result, 'resolver_consultas_informativas').current.fileCount).toBe(7);
    expect(route(result, 'responder_invitacion').current.fileCount).toBe(7);
    expect(route(result, 'reset_plan').current.fileCount).toBe(10);
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
    expect(result.violations).toHaveLength(result.comparisons.length - 2);
  });
});

describe('per-branch historical baseline via git show', () => {
  it('measures all branches from 78ae24e anchor without using working tree', async () => {
    const historical = await measureHistoricalBranches({
      anchorRef: '78ae24e',
      counterModel: 'gpt-5.6-luna',
    });
    expect(historical).toHaveLength(38);
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const current = await measureCurrentBranches({ loader, counterModel: 'gpt-5.6-luna' });
    expect(current).toHaveLength(38);
    // Historical and current share same branchId set
    expect(historical.map((branch) => branch.branchId).sort()).toEqual(
      current.map((branch) => branch.branchId).sort(),
    );
    // RSVP branches exist in historical baseline
    expect(historical.some((branch) => branch.branchId === 'responder_invitacion:resolved_single')).toBe(true);
    expect(historical.some((branch) => branch.branchId === 'responder_invitacion:needs_event_selection')).toBe(true);
    // Anchor instruction bytes for responder_invitacion are 8233 (stable anchor)
    const anchorRsvp = historical.find((branch) => branch.branchId === 'responder_invitacion:resolved_single');
    expect(anchorRsvp?.instructionBytes).toBe(8233);
    expect(anchorRsvp?.fileCount).toBe(7);
    // Current has +20 delta due to T1 three-state guidance
    const currentRsvp = current.find((branch) => branch.branchId === 'responder_invitacion:resolved_single');
    expect(currentRsvp?.instructionBytes).toBe(8253);
    expect((currentRsvp?.instructionBytes ?? 0) - (anchorRsvp?.instructionBytes ?? 0)).toBe(20);
  }, 15_000);
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
