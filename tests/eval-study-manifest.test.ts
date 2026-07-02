import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { technicalStudyManifestSchema } from '../src/evals/study-schema';

describe('technical study manifest', () => {
  it('keeps every frozen version unique and balanced at ten scenarios per event group', () => {
    for (const version of [1, 2, 3]) {
      const manifestPath = path.resolve(
        process.cwd(),
        `evals/studies/technical-evaluation-50-v${version}.json`,
      );
      const manifest = technicalStudyManifestSchema.parse(
        JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown,
      );
      expect(manifest.version).toBe(version);
      expect(manifest.scenarios).toHaveLength(50);
      expect(new Set(manifest.scenarios.map((scenario) => scenario.id))).toHaveLength(50);
      expect(manifest.repetitions).toBe(3);
    }
  });
});
