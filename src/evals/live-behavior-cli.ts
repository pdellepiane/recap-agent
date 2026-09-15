#!/usr/bin/env node

import path from 'node:path';

import dotenv from 'dotenv';

import type { EvalRunnerOptions } from './runner';
import {
  isCleanGate,
  parseResumeModeOption as parseRunnerResumeMode,
  summarizeGateReport,
} from './runner';
import {
  DEFAULT_CASE_CONCURRENCY,
  DEFAULT_JUDGE_CONCURRENCY,
  parseCaseConcurrency,
  parseJudgeConcurrency,
} from './scheduler';

dotenv.config({ path: ['.env.development', '.env.local', '.env'], quiet: true });

type EvaluationRunner = (
  options: EvalRunnerOptions,
) => Promise<{
  runId: string;
  report: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    erroredCases: number;
    skippedCases: number;
  };
  runDir: string;
}>;

type EvaluationRunnerLoader = () => Promise<EvaluationRunner>;

const USAGE = `Usage: npm run eval:behavior-live [options]

Options:
  --case <id>   Run a specific regression case (repeatable).
  --label <name>  Reference/candidate label recorded in the run manifest (default: candidate).
  --case-concurrency <1..4>  Bounded case workers (default: 4).
  --judge-concurrency <1..2>  Judge API requests in flight (default: 2).
  --resume-mode <full|diagnostic>  Diagnostic labels an interrupted resume; never a clean gate (default: full).
  -h, --help    Show this help message.
`;

const KNOWN_FLAGS = new Set([
  '--case',
  '--label',
  '--case-concurrency',
  '--judge-concurrency',
  '--resume-mode',
  '--help',
  '-h',
]);

async function loadEvaluationRunner(): Promise<EvaluationRunner> {
  const runner = await import('./runner');
  return runner.runEvaluation;
}

export function parseCaseIds(argv: readonly string[]): string[] | undefined {
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

export function isHelpRequested(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function parseRunLabel(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--label') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && next.trim().length > 0) {
        return next.trim();
      }
      throw new Error('Missing value for --label.');
    }
    if (arg.startsWith('--label=')) {
      const value = arg.slice('--label='.length).trim();
      if (value.length > 0) {
        return value;
      }
      throw new Error('Missing value for --label.');
    }
  }
  return 'candidate';
}

/**
 * Packet O2 strict flag parsing. Unknown --flags are rejected; a
 * concurrency flag with a missing value or an out-of-range/invalid value
 * fails closed. --case stays repeatable.
 */
export function assertKnownFlags(argv: readonly string[]): void {
  for (const arg of argv) {
    if (!arg.startsWith('-') || arg === '-') {
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      continue;
    }
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (name.startsWith('--') && KNOWN_FLAGS.has(name)) {
      continue;
    }
    if (!name.startsWith('--') && KNOWN_FLAGS.has(name)) {
      continue;
    }
    throw new Error(`Unknown flag "${name}". Allowed flags: --case, --label, --case-concurrency, --judge-concurrency, --resume-mode, -h/--help.`);
  }
}

function parseSingleFlagValue(argv: readonly string[], name: string): string | undefined {
  let found: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === name) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`Missing value for ${name}.`);
      }
      found = next;
      i += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      if (value.length === 0) {
        throw new Error(`Missing value for ${name}.`);
      }
      found = value;
    }
  }
  return found;
}

export function parseCaseConcurrencyFlag(argv: readonly string[]): number {
  const raw = parseSingleFlagValue(argv, '--case-concurrency');
  if (raw === undefined) {
    return DEFAULT_CASE_CONCURRENCY;
  }
  return parseCaseConcurrency(raw);
}

export function parseJudgeConcurrencyFlag(argv: readonly string[]): number {
  const raw = parseSingleFlagValue(argv, '--judge-concurrency');
  if (raw === undefined) {
    return DEFAULT_JUDGE_CONCURRENCY;
  }
  return parseJudgeConcurrency(raw);
}

/**
 * Packet O5: resume-mode validation lives in the runner API; this entry
 * point keeps its export for existing callers and delegates.
 */
export function parseResumeMode(argv: readonly string[]): 'full' | 'diagnostic' {
  const raw = parseSingleFlagValue(argv, '--resume-mode');
  if (raw === undefined) {
    return 'full';
  }
  return parseRunnerResumeMode(raw);
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  loadRunner: EvaluationRunnerLoader = loadEvaluationRunner,
): Promise<void> {
  if (isHelpRequested(argv)) {
    process.stdout.write(USAGE);
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is required because live behavior regressions use mandatory semantic judges.',
    );
  }

  const runEvaluation = await loadRunner();
  const caseIds = parseCaseIds(argv);
  assertKnownFlags(argv);
  const runLabel = parseRunLabel(argv);
  const caseConcurrency = parseCaseConcurrencyFlag(argv);
  const judgeConcurrency = parseJudgeConcurrencyFlag(argv);
  const resumeMode = parseResumeMode(argv);

  // The unfiltered command selects the complete current manifest suite
  // (live_behavior_regression); the count is never hardcoded.
  const result = await runEvaluation({
    evalsDir: path.resolve(process.cwd(), 'evals'),
    outputDir: path.resolve(process.cwd(), '.eval-runs'),
    suite: 'live_behavior_regression',
    target: 'live_lambda',
    caseIds: caseIds ?? undefined,
    runLabel,
    requestedCaseConcurrency: caseConcurrency,
    requestedJudgeConcurrency: judgeConcurrency,
    resumeMode,
  });
  const summary = summarizeGateReport({
    totalCases: result.report.totalCases,
    passedCases: result.report.passedCases,
    failedCases: result.report.failedCases,
    erroredCases: result.report.erroredCases,
    skippedCases: result.report.skippedCases,
  });
  const gatedSummary = {
    runId: result.runId,
    runDir: result.runDir,
    ...summary,
  };

  process.stdout.write(`${JSON.stringify(gatedSummary, null, 2)}\n`);

  if (!isCleanGate(summary)) {
    process.exitCode = 1;
  }
}

if (!process.env.VITEST) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
