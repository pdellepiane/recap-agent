import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runEvaluation } from '../src/evals/runner';

describe('eval runner', () => {
  it('supports dry-run estimation without executing cases', async () => {
    const result = await runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
    });

    expect(result.report.totalCases).toBe(3);
    expect(result.report.results.every((entry) => entry.status === 'skipped')).toBe(true);
  });

  it('produces a stable result envelope for an offline smoke case', async () => {
    const result = await runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      caseId: 'selection.choose_edo_from_shortlist',
      target: 'offline',
    });
    const firstResult = result.report.results[0];

    expect(firstResult).toEqual(
      expect.objectContaining({
        caseId: 'selection.choose_edo_from_shortlist',
        suite: 'selection_continuity',
        target: 'offline',
        configLabel: 'offline',
        status: 'passed',
        hardGatePassed: true,
        finalScore: 1,
        totalToolCalls: 0,
        nodeTransitions: ['recomendar->seguir_refinando_guardar_plan'],
      }),
    );
    expect(firstResult?.artifactPaths.caseResult).toContain('.json');
    expect(firstResult?.expectationResults).toHaveLength(3);
    expect(firstResult?.scorerResults).toHaveLength(2);
    expect(firstResult?.planDiffSummary).toEqual(
      expect.arrayContaining([
        'selected_provider_id=109',
        'provider_needs=Catering:selected',
      ]),
    );
  });
});
