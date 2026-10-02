import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const importsSchema = z.object({ imports: z.array(z.string()).optional() });

describe('evaluation fixture path portability', () => {
  it('resolves every case import to the exact Git filename, including capitalization', () => {
    const root = process.cwd();
    const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0'));
    const cases = path.join(root, 'evals/cases');
    for (const filename of fs.readdirSync(cases).filter((entry) => entry.endsWith('.yaml'))) {
      const casePath = path.join(cases, filename);
      const parsed = importsSchema.parse(YAML.parse(fs.readFileSync(casePath, 'utf8')) as unknown);
      for (const imported of parsed.imports ?? []) {
        const target = path.relative(root, path.resolve(path.dirname(casePath), imported)).split(path.sep).join('/');
        expect(tracked.has(target), `${filename}: import ${imported} must match its tracked filename exactly`).toBe(true);
      }
    }
  });
});
