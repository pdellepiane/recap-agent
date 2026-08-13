import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('live evaluation fixture configuration', () => {
  it('loads ignored local fixture values before the shared environment file', () => {
    for (const relativePath of [
      'src/evals/cli.ts',
      'src/evals/live-behavior-cli.ts',
    ]) {
      const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
      expect(source).toContain("path: ['.env.local', '.env']");
    }
  });
});
