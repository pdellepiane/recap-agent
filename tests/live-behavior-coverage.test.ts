import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { liveBehaviorCoverageSchema, validateCoverageImplementationEvidence } from '../src/evals/live-behavior-coverage';
import { EvalLoader } from '../src/evals/loader';


const nonStructuralExpectationTypes = new Set([
  'budget_constraints',
  'text_semantic',
  'token_usage_present',
]);

describe('live behavior coverage registry', () => {
  it('rejects uncommitted changes with missing or invalid source provenance', async () => {
    const change = { id: 'new-change', implementedBy: 'working-tree', liveCaseIds: ['live.case'] };
    expect(() => liveBehaviorCoverageSchema.parse({ version: 1, behaviorChanges: [change] })).toThrow();
    const registry = liveBehaviorCoverageSchema.parse({ version: 1, behaviorChanges: [{ ...change,
      implementationEvidence: ['missing-source.ts', '../outside-source.ts'] }] });
    expect(await validateCoverageImplementationEvidence(registry, process.cwd())).toHaveLength(2);
  });
  it('maps every registered behavior change to fail-closed live Lambda cases', async () => {
    const evalDirectory = path.resolve(process.cwd(), 'evals');
    const registry = liveBehaviorCoverageSchema.parse(YAML.parse(
      await fs.readFile(path.join(evalDirectory, 'live-behavior-coverage.yaml'), 'utf8'),
    ) as unknown);
    expect(await validateCoverageImplementationEvidence(registry, process.cwd())).toEqual([]);
    const catalog = await new EvalLoader(evalDirectory).loadCatalog();
    const suite = catalog.suites.find(
      (candidate) => candidate.id === 'live_behavior_regression',
    );
    expect(suite).toBeDefined();

    const registeredCaseIds = new Set(suite?.caseIds ?? []);
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    const behaviorIds = registry.behaviorChanges.map((change) => change.id);
    expect(new Set(behaviorIds).size).toBe(behaviorIds.length);

    for (const change of registry.behaviorChanges) {
      if (change.status === 'retired') {
        expect(change.retirementReason, `${change.id} needs an explicit retirement reason`).toBeTruthy();
        continue;
      }
      for (const caseId of change.liveCaseIds) {
        const evalCase = casesById.get(caseId);
        expect(evalCase, `${change.id} references missing case ${caseId}`).toBeDefined();
        expect(registeredCaseIds.has(caseId), `${caseId} is not in the mandatory suite`).toBe(true);
        expect(evalCase?.suite, `${caseId} has the wrong owning suite`).toBe(
          'live_behavior_regression',
        );
        expect(evalCase?.targetModes).toContain('live_lambda');

        const hasHardStructuralExpectation = evalCase?.expectations.some(
          (expectation) =>
            expectation.severity === 'hard' &&
            !nonStructuralExpectationTypes.has(expectation.type),
        );
        expect(
          hasHardStructuralExpectation,
          `${caseId} needs a hard structural expectation`,
        ).toBe(true);

        expect(
          evalCase?.expectations.some((expectation) => expectation.type === 'text_semantic'),
          `${caseId} must use hard contracts without semantic judge votes`,
        ).toBe(false);
      }
    }
  });
});
