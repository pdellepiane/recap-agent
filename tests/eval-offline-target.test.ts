import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvalLoader } from '../src/evals/loader';
import { runOfflineCase } from '../src/evals/targets/offline';

describe('offline eval target', () => {
  it('preserves one selected need while opening another in the same turn', async () => {
    const loader = new EvalLoader(path.resolve(process.cwd(), 'evals'));
    const catalog = await loader.loadCatalog();
    const currentCase = catalog.cases.find(
      (candidate) => candidate.id === 'multi_need.select_photography_and_open_catering',
    );

    expect(currentCase).toBeDefined();

    const result = await runOfflineCase({
      currentCase: currentCase!,
      config: {
        label: 'offline-baseline',
        target: 'offline',
        notes: [],
        environmentOverrides: {},
      },
      artifactDir: path.resolve(process.cwd(), '.eval-runs-test'),
    });

    const finalPlan = result.turns.at(-1)?.plan;
    expect(finalPlan?.active_need_category).toBe('Catering');
    expect(finalPlan?.provider_needs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Fotografía y video',
          status: 'selected',
          selected_provider_id: 90,
        }),
        expect.objectContaining({
          category: 'Catering',
          status: 'shortlisted',
        }),
      ]),
    );
  });
});
