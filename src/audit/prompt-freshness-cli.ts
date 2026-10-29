import fs from 'node:fs/promises';
import path from 'node:path';

import { buildPromptReviewCandidate, comparePromptReview, promptReviewLockSchema } from './prompt-freshness';

async function main(): Promise<void> {
  const [mode, filename, ...rest] = process.argv.slice(2);
  if ((mode !== '--candidate' && mode !== '--check') || !filename || rest.length > 0) {
    throw new Error('Usage: node --import tsx src/audit/prompt-freshness-cli.ts --candidate <new-file> | --check <reviewed-file>');
  }
  const current = await buildPromptReviewCandidate(process.cwd());
  if (mode === '--candidate') {
    // Exclusive create prevents silently overwriting a completed review.
    await fs.writeFile(path.resolve(filename), `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ candidate: filename, prompts: current.prompts.length, approved: false })}\n`);
    return;
  }
  const reviewed = promptReviewLockSchema.parse(JSON.parse(await fs.readFile(path.resolve(filename), 'utf8')) as unknown);
  const issues = comparePromptReview(current, reviewed);
  process.stdout.write(`${JSON.stringify({ passed: issues.length === 0, prompts: current.prompts.length, issues }, null, 2)}\n`);
  if (issues.length > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
