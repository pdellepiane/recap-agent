import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EvalLoader } from '../src/evals/loader';

const coverageSchema = z.object({
  version: z.literal(1),
  behaviorChanges: z.array(z.object({
    id: z.string().min(1),
    implementedBy: z.string().regex(/^[0-9a-f]{7,40}$/u),
    liveCaseIds: z.array(z.string().min(1)).min(1),
  })).min(1),
});

const nonStructuralExpectationTypes = new Set([
  'budget_constraints',
  'text_semantic',
  'token_usage_present',
]);

describe('live behavior coverage registry', () => {
  it('maps every registered behavior change to fail-closed live Lambda cases', async () => {
    const evalDirectory = path.resolve(process.cwd(), 'evals');
    const registry = coverageSchema.parse(YAML.parse(
      await fs.readFile(path.join(evalDirectory, 'live-behavior-coverage.yaml'), 'utf8'),
    ) as unknown);
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

        const hasRequiredSemanticJudge = evalCase?.expectations.some(
          (expectation) =>
            expectation.type === 'text_semantic' &&
            expectation.severity === 'hard' &&
            expectation.requireJudge,
        );
        expect(
          hasRequiredSemanticJudge,
          `${caseId} needs a hard required semantic judge`,
        ).toBe(true);
      }
    }
  });
});
