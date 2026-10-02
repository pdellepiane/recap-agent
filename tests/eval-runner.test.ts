import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inventoryDuplicateSemanticJudges, runEvaluation } from '../src/evals/runner';

describe('eval runner', () => {
  // Catalog-loading test: needs headroom under full-suite parallel load (trips the 5s default).
  it('dry-run estimates without executing, enforces concurrency bounds, and labels resumes', { timeout: 30_000 }, async () => {
    const estimate = await runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
    });

    expect(estimate.report.totalCases).toBe(3);
    expect(estimate.report.results.every((entry) => entry.status === 'skipped')).toBe(true);

    await expect(runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      requestedCaseConcurrency: 0,
    })).rejects.toThrow(/case-concurrency must be in 1\.\.4/);
    // Upper bound consolidated from eval-run-manifest.test.ts (same contract).
    await expect(runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      requestedCaseConcurrency: 5,
    })).rejects.toThrow(/case-concurrency must be in 1\.\.4/);
    await expect(runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      requestedJudgeConcurrency: 9,
    })).rejects.toThrow(/judge-concurrency must be in 1\.\.2/);

    const resumed = await runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      resumeMode: 'diagnostic',
    });
    expect(resumed.report.completion?.resumeMode).toBe('diagnostic');
    expect(resumed.report.completion?.complete).toBe(false);
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
    expect(firstResult?.expectationResults).toHaveLength(2);
    expect(firstResult?.scorerResults).toHaveLength(2);
    expect(firstResult?.planDiffSummary).toEqual(
      expect.arrayContaining([
        'selected_provider_ids=[109]',
        'provider_needs=Catering:selected',
      ]),
    );

    const artifact = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), firstResult?.artifactPaths.caseResult ?? ''), 'utf8'),
    ) as { turns: Array<Record<string, unknown>> };
    expect(artifact.turns[0]).not.toHaveProperty('plan');
    expect(artifact.turns[0]).not.toHaveProperty('rawTargetResponse');
  });

});

describe('eval runner bounded pipeline (O2/O3)', () => {
  it('executes the offline smoke panel at 4/2 in manifest order with timing', async () => {
    const result = await runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      requestedCaseConcurrency: 4,
      requestedJudgeConcurrency: 2,
      disableSignalHandlers: true,
    });
    expect(result.report.totalCases).toBe(3);
    const manifest = JSON.parse(
      await fs.readFile(path.join(result.runDir, 'manifest.json'), 'utf8'),
    ) as { cases: { orderedIds: string[] } };
    expect(result.report.results.map((entry) => entry.caseId)).toEqual(manifest.cases.orderedIds);
    expect(result.report.completion).toMatchObject({ complete: true, resumeMode: 'full' });
    expect(result.report.timingSummary?.makespanMs).toBeGreaterThanOrEqual(0);
    expect(result.report.judgeSummary).toMatchObject({ modelCalls: 0, retryCount: 0, rateLimitCount: 0 });
    for (const entry of result.report.results) {
      const timing = entry.timing;
      expect(timing).toBeDefined();
      for (const key of [
        'queueWaitMs',
        'setupMs',
        'turnMs',
        'snapshotMs',
        'teardownMs',
        'judgeWaitMs',
        'judgeApiMs',
        'reportWriteMs',
        'makespanMs',
      ] as const) {
        expect(typeof timing?.[key]).toBe('number');
      }
      const judgeMetrics = entry.judgeMetrics;
      expect(judgeMetrics).toBeDefined();
      expect(typeof judgeMetrics?.modelCalls).toBe('number');
      expect(typeof judgeMetrics?.retryCount).toBe('number');
      expect(typeof judgeMetrics?.rateLimitCount).toBe('number');
      expect(entry.benchmarkMetrics?.usage_known).toBeDefined();
    }
    // Atomic redacted artifacts exist per case at snapshot and finalization.
    for (const entry of result.report.results) {
      const finalPath = path.resolve(process.cwd(), entry.artifactPaths.caseResult);
      const snapshotPath = path.join(path.dirname(finalPath), `${entry.caseId}.snapshot.json`);
      const [finalRaw, snapshotRaw] = await Promise.all([
        fs.readFile(finalPath, 'utf8'),
        fs.readFile(snapshotPath, 'utf8'),
      ]);
      expect((JSON.parse(finalRaw) as { caseId: string }).caseId).toBe(entry.caseId);
      expect((JSON.parse(snapshotRaw) as { phase: string }).phase).toBe('snapshot');
    }
    const progress = JSON.parse(
      await fs.readFile(path.join(result.runDir, 'progress.json'), 'utf8'),
    ) as { complete: boolean; phase: string };
    expect(progress.complete).toBe(true);
    expect(progress.phase).toBe('finalized');
  });

  it('inventories duplicate optional scorers without reusing them by default', () => {
    const inventory = inventoryDuplicateSemanticJudges({
      id: 'probe',
      suite: 'probe',
      version: 1,
      description: 'probe',
      imports: [],
      tags: [],
      priority: 'p2',
      status: 'active',
      targetModes: ['offline'],
      variables: {},
      inputs: [{ text: 'hola' }],
      expectations: [
        {
          type: 'text_semantic',
          rubric: 'Misma rubrica.',
          minScore: 0.7,
          requireJudge: false,
          severity: 'soft',
          turnIndex: 0,
        },
      ],
      scorers: [
        { id: 'dup', type: 'text_semantic', rubric: 'Misma rubrica.', turnIndex: 0, weight: 0.5 },
        { id: 'other', type: 'text_semantic', rubric: 'Otra rubrica.', turnIndex: 0, weight: 0.5 },
      ],
      notes: [],
    });
    expect(inventory.groups).toHaveLength(1);
    expect(inventory.groups[0]).toMatchObject({ scorerId: 'dup', turnIndex: 0 });
  });
});
