#!/usr/bin/env node

import path from 'node:path';

import dotenv from 'dotenv';

import { runEvaluation } from './runner';

dotenv.config({ path: ['.env.development', '.env.local', '.env'], quiet: true });

export function parseCaseIds(argv: string[]): string[] | undefined {
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--case') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        ids.push(next);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--case=')) {
      const value = arg.slice('--case='.length);
      if (value.length > 0) {
        ids.push(value);
      }
    }
  }
  return ids.length > 0 ? ids : undefined;
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is required because live behavior regressions use mandatory semantic judges.',
    );
  }

  const caseIds = parseCaseIds(process.argv.slice(2));

  const result = await runEvaluation({
    evalsDir: path.resolve(process.cwd(), 'evals'),
    outputDir: path.resolve(process.cwd(), '.eval-runs'),
    suite: 'live_behavior_regression',
    target: 'live_lambda',
    caseIds: caseIds ?? undefined,
  });
  const summary = {
    runId: result.runId,
    runDir: result.runDir,
    totalCases: result.report.totalCases,
    passedCases: result.report.passedCases,
    failedCases: result.report.failedCases,
    erroredCases: result.report.erroredCases,
    skippedCases: result.report.skippedCases,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (
    summary.totalCases === 0 ||
    summary.passedCases !== summary.totalCases ||
    summary.failedCases > 0 ||
    summary.erroredCases > 0 ||
    summary.skippedCases > 0
  ) {
    process.exitCode = 1;
  }
}

if (!process.env.VITEST) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
