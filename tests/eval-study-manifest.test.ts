import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { technicalStudyManifestSchema } from '../src/evals/study-schema';

describe('technical study manifest', () => {
  it('is frozen, unique, and balanced at ten scenarios per event group', () => {
    const manifestPath = path.resolve(
      process.cwd(),
      'evals/studies/technical-evaluation-50-v1.json',
    );
    const manifest = technicalStudyManifestSchema.parse(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown,
    );
    expect(manifest.scenarios).toHaveLength(50);
    expect(new Set(manifest.scenarios.map((scenario) => scenario.id))).toHaveLength(50);
    expect(manifest.repetitions).toBe(3);
  });
});
