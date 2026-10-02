#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import type { EvalCase } from './case-schema';
import { EvalLoader, type LoadedEvalCatalog } from './loader';
import type { FixtureLoadResult } from '../runtime/eval-fixture-gateway';
import { loadFixtureData } from '../runtime/eval-fixture-gateway';
import type { CaseCostEvent, EvalRunnerOptions } from './runner';
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
    costSummary?: {
      priced: boolean;
      pricingVersion: string | null;
      openaiUsd: number;
      judgeUsd: number;
      lambdaUsd: number;
      totalUsd: number;
      unpricedCases: string[];
      unpricedModels: string[];
    } | null;
  };
  runDir: string;
}>;

type EvaluationRunnerLoader = () => Promise<EvaluationRunner>;

const USAGE = `Usage: npm run eval:behavior-live [options]

Options:
  --case <id>   Run a specific regression case (repeatable, required; at least one).
  --label <name>  Reference/candidate label recorded in the run manifest (default: candidate).
  --case-concurrency <1..4>  Bounded case workers (default: 4).
  --judge-concurrency <1..2>  Judge API requests in flight (default: 2).
  --resume-mode <full|diagnostic>  Diagnostic labels an interrupted resume; never a clean gate (default: full).
  -h, --help    Show this help message.

Progress: one stderr line per settled case with exact running cost; stdout
carries only the final JSON summary.
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

/**
 * Fail-closed explicit selection. The behavior CLI never defaults to the full
 * suite: at least one --case selector is required before any network work.
 */
export function requireExplicitCaseIds(caseIds: string[] | undefined): string[] {
  if (!caseIds || caseIds.length === 0) {
    throw new Error(
      'Missing explicit case selection: pass at least one --case <id>. The unfiltered full suite is never selected by default.',
    );
  }
  return [...caseIds];
}

/**
 * Resolve one selection for validation and dispatch. Unknown IDs fail before
 * any runner load or network work so invalid selectors dispatch zero cases.
 */
export function resolveSelectedLiveBehaviorCases(
  catalog: Pick<LoadedEvalCatalog, 'cases'>,
  caseIds: readonly string[],
): EvalCase[] {
  const byId = new Map(catalog.cases.map((entry) => [entry.id, entry]));
  const unknown = caseIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown live behavior case ID(s): ${unknown.join(', ')}. No cases were dispatched.`,
    );
  }
  return caseIds.map((id) => byId.get(id) as EvalCase);
}

export type LiveBehaviorFixtureLoader = (scenario: string) => Promise<FixtureLoadResult>;

/**
 * Validate ALL selected fixture/configuration prerequisites before dispatch,
 * including required phone placeholders ($VAR contactPhone). Local file and
 * env checks only; no network work.
 */
export async function assertLiveBehaviorPrerequisites(
  selectedCases: readonly EvalCase[],
  loadFixture: LiveBehaviorFixtureLoader = loadFixtureData,
): Promise<void> {
  for (const currentCase of selectedCases) {
    const scenarios: string[] = [];
    if (currentCase.backendFixture?.scenario) {
      scenarios.push(currentCase.backendFixture.scenario);
    }
    for (const input of currentCase.inputs) {
      if (input.backendFixture?.scenario) {
        scenarios.push(input.backendFixture.scenario);
      }
    }
    const rsvpScenario = currentCase.rsvpIsolation?.setup?.fixtureScenario;
    if (rsvpScenario) {
      scenarios.push(rsvpScenario);
    }
    for (const scenario of [...new Set(scenarios)]) {
      const loaded = await loadFixture(scenario);
      if (loaded.status !== 'loaded') {
        throw new Error(
          `live_behavior_regression prerequisite missing: case "${currentCase.id}" requires fixture scenario "${scenario}" (${loaded.status}: ${loaded.error}); refusing to run before any remote call.`,
        );
      }
    }
    for (let index = 0; index < currentCase.inputs.length; index += 1) {
      const contactPhone = currentCase.inputs[index]?.contactPhone ?? null;
      if (typeof contactPhone === 'string' && contactPhone.startsWith('$')) {
        const variableName = contactPhone.slice(1);
        if (!process.env[variableName]) {
          throw new Error(
            `${variableName} is required for case "${currentCase.id}" turn ${index} before any remote call.`,
          );
        }
      }
    }
  }
}

export type LiveBehaviorMainDeps = {
  evalsDir?: string;
  loadCatalog?: () => Promise<LoadedEvalCatalog>;
  loadFixture?: LiveBehaviorFixtureLoader;
};

/**
 * Latest dated pricing file wins, by filename. Live behavior gates refuse
 * to run unpriced: exact cost is mandatory observability, never an estimate.
 */
export function resolveLatestPricingPath(evalsDir: string): string {
  const studiesDir = path.join(evalsDir, 'studies');
  let entries: string[];
  try {
    entries = fs.readdirSync(studiesDir);
  } catch {
    throw new Error(`No pricing files found in ${studiesDir}; live behavior gates require exact cost tracking.`);
  }
  const latest = entries.filter((entry) => /^pricing-.*\.json$/.test(entry)).sort().at(-1);
  if (!latest) {
    throw new Error(`No pricing files found in ${studiesDir}; live behavior gates require exact cost tracking.`);
  }
  return path.join(studiesDir, latest);
}

/** Single stderr progress line per settled case; stdout stays final-JSON-only. */
export function formatCaseProgressLine(event: CaseCostEvent): string {
  const cost = event.priced
    ? ` case=$${event.caseCostUsd.toFixed(6)} running=$${event.runningCostUsd.toFixed(6)}`
    : '';
  return `[${event.settledCases}/${event.totalCases}] ${event.caseId} ${event.status}${cost}`;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  loadRunner: EvaluationRunnerLoader = loadEvaluationRunner,
  deps: LiveBehaviorMainDeps = {},
): Promise<void> {
  if (isHelpRequested(argv)) {
    process.stdout.write(USAGE);
    return;
  }

  assertKnownFlags(argv);
  const runLabel = parseRunLabel(argv);
  const caseConcurrency = parseCaseConcurrencyFlag(argv);
  const judgeConcurrency = parseJudgeConcurrencyFlag(argv);
  const resumeMode = parseResumeMode(argv);
  const caseIds = requireExplicitCaseIds(parseCaseIds(argv));

  const evalsDir = deps.evalsDir ?? path.resolve(process.cwd(), 'evals');
  const catalog = deps.loadCatalog
    ? await deps.loadCatalog()
    : await new EvalLoader(evalsDir).loadCatalog();
  const selectedCases = resolveSelectedLiveBehaviorCases(catalog, caseIds);
  await assertLiveBehaviorPrerequisites(selectedCases, deps.loadFixture ?? loadFixtureData);

  if (!process.env.OPENAI_API_KEY && selectedCases.some((evalCase) =>
    evalCase.expectations?.some((expectation) => expectation.type === 'text_semantic') ||
    evalCase.scorers?.some((scorer) => scorer.type === 'text_semantic'),
  )) {
    throw new Error(
      'OPENAI_API_KEY is required when selected cases include semantic judges.',
    );
  }

  const runEvaluation = await loadRunner();
  const pricingPath = resolveLatestPricingPath(evalsDir);
  const result = await runEvaluation({
    evalsDir,
    outputDir: path.resolve(process.cwd(), '.eval-runs'),
    suite: 'live_behavior_regression',
    target: 'live_lambda',
    caseIds,
    runLabel,
    requestedCaseConcurrency: caseConcurrency,
    requestedJudgeConcurrency: judgeConcurrency,
    resumeMode,
    pricingPath,
    onCaseComplete: (event) => {
      process.stderr.write(`${formatCaseProgressLine(event)}\n`);
    },
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
    cost: result.report.costSummary ?? null,
  };

  process.stdout.write(`${JSON.stringify(gatedSummary, null, 2)}\n`);

  if (!isCleanGate(summary)) {
    process.exitCode = 1;
  }
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }
  return /(?:^|[/\\])live-behavior-cli\.(?:ts|js)$/.test(entrypoint);
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
