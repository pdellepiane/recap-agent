import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvalLoader } from '../src/evals/loader';
import { runEvaluation } from '../src/evals/runner';

describe('eval runner caseIds filtering', () => {
  const evalsDir = path.resolve(process.cwd(), 'evals');
  const outputDir = path.resolve(process.cwd(), '.eval-runs-test');

  // Catalog-loading test: needs headroom under full-suite parallel load (trips the 5s default).
  it('selects cases by caseIds: single, multiple, unknown, and empty filters', { timeout: 30_000 }, async () => {
    const unfiltered = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
    });
    expect(unfiltered.report.totalCases).toBe(3);

    const single = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['selection.choose_edo_from_shortlist'],
    });
    expect(single.report.totalCases).toBe(1);
    expect(single.report.results[0]?.caseId).toBe('selection.choose_edo_from_shortlist');

    const multiple = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['selection.choose_edo_from_shortlist', 'domain.guest_range_boundary_100'],
    });
    expect(multiple.report.totalCases).toBe(2);
    const ids = multiple.report.results.map((entry) => entry.caseId).sort();
    expect(ids).toEqual(['domain.guest_range_boundary_100', 'selection.choose_edo_from_shortlist']);

    const unknown = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'live_behavior_regression',
      target: 'offline',
      dryRun: true,
      caseIds: ['does_not_exist_unknown_case'],
    });
    expect(unknown.report.totalCases).toBe(0);
    // The CLI exit contract treats totalCases===0 as failure (exit 1).
    // This test proves the runner contract that enables that gate.
    const shouldFail = unknown.report.totalCases === 0;
    expect(shouldFail).toBe(true);

    const empty = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: [],
    });
    expect(empty.report.totalCases).toBe(3);
  });

  it('intersects caseIds with the suite, dropping outside-suite cases', async () => {
    // One id belongs to smoke, one belongs to live_behavior_regression but not smoke.
    const partial = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['selection.choose_edo_from_shortlist', 'live_behavior.rsvp_cristian_phone_enriched_confirmation'],
    });
    expect(partial.report.totalCases).toBe(1);
    expect(partial.report.results[0]?.caseId).toBe('selection.choose_edo_from_shortlist');

    const outside = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseIds: ['live_behavior.rsvp_cristian_phone_enriched_confirmation'],
    });
    expect(outside.report.totalCases).toBe(0);
  });

  it('preserves single caseId behavior and intersects it with caseIds', async () => {
    const single = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseId: 'selection.choose_edo_from_shortlist',
    });
    expect(single.report.totalCases).toBe(1);

    const both = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      caseId: 'selection.choose_edo_from_shortlist',
      caseIds: ['selection.choose_edo_from_shortlist', 'domain.guest_range_boundary_100'],
    });
    expect(both.report.totalCases).toBe(1);
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
