import { describe, expect, it } from 'vitest';

import { buildEvalReport, renderMarkdownReport } from '../src/evals/reporting';

describe('eval reporting', () => {
  it('builds aggregate reports and markdown output', () => {
    const report = buildEvalReport('run-1', [
      {
        runId: 'run-1',
        caseId: 'case-1',
        suite: 'smoke',
        target: 'offline',
        configLabel: 'offline-baseline',
        status: 'passed',
        hardGatePassed: true,
        finalScore: 0.95,
        totalLatencyMs: 25,
        totalToolCalls: 1,
        nodeTransitions: ['a->b'],
        planDiffSummary: ['event_type="boda"'],
        artifactPaths: { caseResult: '.eval-runs/run-1/case-1.json' },
        expectationResults: [],
        scorerResults: [],
        turns: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ]);

    expect(report.averageScore).toBe(0.95);
    expect(renderMarkdownReport(report)).toContain('| smoke | case-1 | offline |');
  });
});
