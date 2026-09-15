import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvalLoader } from '../src/evals/loader';
import { runEvaluation } from '../src/evals/runner';

describe('eval runner caseIds filtering', () => {
  const evalsDir = path.resolve(process.cwd(), 'evals');
  const outputDir = path.resolve(process.cwd(), '.eval-runs-test');

  it('returns all cases when no filter is set', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
    });
    expect(result.report.totalCases).toBe(3);
  });

  it('filters by single caseIds entry', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['selection.choose_edo_from_shortlist'],
    });
    expect(result.report.totalCases).toBe(1);
    expect(result.report.results[0]?.caseId).toBe('selection.choose_edo_from_shortlist');
  });

  it('filters by repeatable multiple caseIds', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['selection.choose_edo_from_shortlist', 'domain.guest_range_boundary_100'],
    });
    expect(result.report.totalCases).toBe(2);
    const ids = result.report.results.map((entry) => entry.caseId).sort();
    expect(ids).toEqual(['domain.guest_range_boundary_100', 'selection.choose_edo_from_shortlist']);
  });

  it('returns zero cases for unknown caseId (exit contract)', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'live_behavior_regression',
      target: 'offline',
      dryRun: true,
      caseIds: ['does_not_exist_unknown_case'],
    });
    expect(result.report.totalCases).toBe(0);
    // The CLI exit contract treats totalCases===0 as failure (exit 1).
    // This test proves the runner contract that enables that gate.
    const shouldFail = result.report.totalCases === 0;
    expect(shouldFail).toBe(true);
  });

  it('intersects caseIds with suite (case not in suite yields filtered intersection)', async () => {
    // One id belongs to smoke, one belongs to live_behavior_regression but not smoke.
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['selection.choose_edo_from_shortlist', 'live_behavior.rsvp_cristian_phone_enriched_confirmation'],
    });
    expect(result.report.totalCases).toBe(1);
    expect(result.report.results[0]?.caseId).toBe('selection.choose_edo_from_shortlist');
  });

  it('returns zero when caseIds contains only outside-suite cases', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['live_behavior.rsvp_cristian_phone_enriched_confirmation'],
    });
    expect(result.report.totalCases).toBe(0);
  });

  it('preserves existing single caseId behavior', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseId: 'selection.choose_edo_from_shortlist',
    });
    expect(result.report.totalCases).toBe(1);
  });

  it('caseId and caseIds intersect when both are set', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseId: 'selection.choose_edo_from_shortlist',
      caseIds: ['selection.choose_edo_from_shortlist', 'domain.guest_range_boundary_100'],
    });
    expect(result.report.totalCases).toBe(1);
  });

  it('empty caseIds behaves like no filter (full suite)', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: [],
    });
    expect(result.report.totalCases).toBe(3);
  });

  it('selects the complete current manifest when unfiltered, never a hardcoded count', async () => {
    const catalog = await new EvalLoader(evalsDir).loadCatalog();
    const suiteManifest = catalog.suites.find((suite) => suite.id === 'smoke');
    expect(suiteManifest).toBeDefined();
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
    });
    expect(result.report.totalCases).toBe(suiteManifest?.caseIds.length);
    expect(result.report.results.map((entry) => entry.caseId).sort()).toEqual(
      [...(suiteManifest?.caseIds ?? [])].sort(),
    );
  });
});
