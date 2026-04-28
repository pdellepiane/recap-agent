import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createEmptyPlan } from '../core/plan';
import { getConfig } from '../runtime/config';
import {
  type EvalCase,
  type EvalExpectation,
  type EvalReport,
  type EvalResult,
  type EvalRunConfig,
  type EvalTurnResult,
  type ExpectationResult,
  type ScorerResult,
} from './case-schema';
import { EvalLoader } from './loader';
import { writeEvalArtifacts } from './reporting';
import { runSemanticJudge } from './scorers/semantic-judge';
import { runLiveLambdaCase } from './targets/live-lambda';
import { runOfflineCase } from './targets/offline';

export type EvalRunnerOptions = {
  evalsDir: string;
  outputDir: string;
  suite?: string | null;
  target?: EvalRunConfig['target'] | null;
  caseId?: string | null;
  matrixPath?: string | null;
  dryRun?: boolean;
};

type RuntimeCaseResult = {
  turns: EvalTurnResult[];
  status: EvalResult['status'];
  errorMessage?: string;
};

type EvaluationContext = {
  currentCase: EvalCase;
  config: EvalRunConfig;
  turns: EvalTurnResult[];
};

export async function runEvaluation(
  options: EvalRunnerOptions,
): Promise<{
  runId: string;
  report: EvalReport;
  runDir: string;
}> {
  const loader = new EvalLoader(options.evalsDir);
  const catalog = await loader.loadCatalog();
  const runConfigs = await resolveRunConfigs(loader, options);
  const selectedCases = selectCases(catalog.cases, catalog.suites, options);
  const runId = buildRunId();
  const results: EvalResult[] = [];

  for (const config of runConfigs) {
    for (const currentCase of selectedCases) {
      if (!currentCase.targetModes.includes(config.target)) {
        continue;
      }

      if (options.dryRun) {
        results.push(buildDryRunResult(runId, currentCase, config));
        continue;
      }

      const caseOutputDir = path.join(
        options.outputDir,
        runId,
        'artifacts',
        config.label,
      );
      await fs.mkdir(caseOutputDir, { recursive: true });
      const runtimeResult = await executeCase(currentCase, config, caseOutputDir);
      const finalized = await finalizeResult({
        runId,
        currentCase,
        config,
        runtimeResult,
        artifactDir: caseOutputDir,
      });
      results.push(finalized);
    }
  }

  const { report, runDir } = await writeEvalArtifacts({
    outputDir: options.outputDir,
    runId,
    results,
  });

  return { runId, report, runDir };
}

export async function listEvaluationAssets(evalsDir: string): Promise<{
  cases: EvalCase[];
  suites: string[];
}> {
  const loader = new EvalLoader(evalsDir);
  const catalog = await loader.loadCatalog();
  return {
    cases: catalog.cases,
    suites: catalog.suites.map((suite) => suite.id),
  };
}

async function resolveRunConfigs(
  loader: EvalLoader,
  options: EvalRunnerOptions,
): Promise<EvalRunConfig[]> {
  if (options.matrixPath) {
    const matrix = await loader.loadMatrix(options.matrixPath);
    return matrix.configs.filter((config) =>
      options.target ? config.target === options.target : true,
    );
  }

  return [
    {
      label: options.target ?? 'offline-default',
      target: options.target ?? 'offline',
      liveLambda:
        options.target === 'live_lambda'
          ? {
              functionUrl: getConfig().lambda.functionUrl ?? undefined,
              channel: 'terminal_whatsapp_eval',
            }
          : undefined,
      notes: [],
      environmentOverrides: {},
    },
  ];
}

function selectCases(
  cases: EvalCase[],
  suites: Array<{ id: string; caseIds: string[] }>,
  options: EvalRunnerOptions,
): EvalCase[] {
  let selected = cases;

  if (options.caseId) {
    selected = selected.filter((candidate) => candidate.id === options.caseId);
  }

  if (options.suite) {
    const suiteManifest = suites.find((suite) => suite.id === options.suite);
    if (!suiteManifest) {
      throw new Error(`Unknown suite "${options.suite}".`);
    }
    const allowedIds = new Set(suiteManifest.caseIds);
    selected = selected.filter((candidate) => allowedIds.has(candidate.id));
  }

  return selected;
}

function buildRunId(): string {
  return `eval-${new Date().toISOString().replace(/[:.]/gu, '-')}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
}

function buildDryRunResult(runId: string, currentCase: EvalCase, config: EvalRunConfig): EvalResult {
  const estimatedTurns = currentCase.inputs.length;
  const estimatedPromptTokens =
    currentCase.budget?.estimatedPromptTokensPerTurn ?? 600;
  const estimatedCompletionTokens =
    currentCase.budget?.estimatedCompletionTokensPerTurn ?? 220;
  const totalEstimatedTokens = estimatedTurns * (estimatedPromptTokens + estimatedCompletionTokens);
  const startedAt = new Date().toISOString();

  return {
    runId,
    caseId: currentCase.id,
    suite: currentCase.suite,
    target: config.target,
    configLabel: config.label,
    status: 'skipped',
    hardGatePassed: true,
    finalScore: 0,
    totalLatencyMs: 0,
    totalToolCalls: 0,
    nodeTransitions: [],
    planDiffSummary: [
      `Dry-run only. Estimated turns=${estimatedTurns}. Estimated tokens=${totalEstimatedTokens}.`,
    ],
    artifactPaths: {
      caseResult: '',
    },
    expectationResults: [],
    scorerResults: [],
    turns: [],
    startedAt,
    completedAt: startedAt,
  };
}

async function executeCase(
  currentCase: EvalCase,
  config: EvalRunConfig,
  artifactDir: string,
): Promise<RuntimeCaseResult> {
  switch (config.target) {
    case 'offline':
      return runOfflineCase({
        currentCase,
        config,
        artifactDir,
      });
    case 'live_lambda':
      return runLiveLambdaCase({
        currentCase,
        config,
        artifactDir,
      });
    default:
      throw new Error(`Unsupported target "${String(config.target)}".`);
  }
}

async function finalizeResult(args: {
  runId: string;
  currentCase: EvalCase;
  config: EvalRunConfig;
  runtimeResult: RuntimeCaseResult;
  artifactDir: string;
}): Promise<EvalResult> {
  const startedAt = new Date().toISOString();
  const context: EvaluationContext = {
    currentCase: args.currentCase,
    config: args.config,
    turns: args.runtimeResult.turns,
  };
  const expectationResults = await evaluateExpectations(context);
  const scorerResults = await evaluateScorers(context, expectationResults);
  const hardGatePassed = expectationResults
    .filter((expectation) => expectation.severity === 'hard')
    .every((expectation) => expectation.passed);
  const finalScore = computeFinalScore(expectationResults, scorerResults);
  const status =
    args.runtimeResult.status === 'errored'
      ? 'errored'
      : hardGatePassed
        ? 'passed'
        : 'failed';
  const totalLatencyMs = args.runtimeResult.turns.reduce(
    (sum, turn) => sum + turn.latencyMs,
    0,
  );
  const totalToolCalls = args.runtimeResult.turns.reduce(
    (sum, turn) => sum + turn.trace.tools_called.length,
    0,
  );
  const artifactPath = path.join(args.artifactDir, `${args.currentCase.id}.json`);
  const caseResult: EvalResult = {
    runId: args.runId,
    caseId: args.currentCase.id,
    suite: args.currentCase.suite,
    target: args.config.target,
    configLabel: args.config.label,
    status,
    hardGatePassed,
    finalScore,
    totalLatencyMs,
    totalToolCalls,
    nodeTransitions: args.runtimeResult.turns.map(
      (turn) => `${turn.trace.previous_node}->${turn.trace.next_node}`,
    ),
    planDiffSummary: summarizePlanDiff(args.runtimeResult.turns),
    artifactPaths: {
      caseResult: artifactPath,
    },
    expectationResults,
    scorerResults,
    turns: args.runtimeResult.turns,
    startedAt,
    completedAt: new Date().toISOString(),
  };

  await fs.writeFile(artifactPath, JSON.stringify(caseResult, null, 2), 'utf8');
  return caseResult;
}

async function evaluateExpectations(
  context: EvaluationContext,
): Promise<ExpectationResult[]> {
  const results: ExpectationResult[] = [];

  for (const expectation of context.currentCase.expectations) {
    results.push(await evaluateExpectation(context, expectation));
  }

  return results;
}

async function evaluateScorers(
  context: EvaluationContext,
  expectationResults: ExpectationResult[],
): Promise<ScorerResult[]> {
  const results: ScorerResult[] = [];

  for (const scorer of context.currentCase.scorers) {
    switch (scorer.type) {
      case 'expectation_pass_rate': {
        const scoped = scorer.expectationIds?.length
          ? expectationResults.filter((result) => scorer.expectationIds?.includes(result.id))
          : expectationResults;
        const score =
          scoped.length === 0
            ? 1
            : scoped.reduce((sum, result) => sum + result.score, 0) / scoped.length;
        results.push({
          id: scorer.id,
          type: scorer.type,
          score,
          weight: scorer.weight,
          skipped: false,
          message: `Average expectation score across ${scoped.length} expectations.`,
        });
        break;
      }
      case 'budget_efficiency': {
        const latencyScore =
          scorer.targetLatencyMs && scorer.targetLatencyMs > 0
            ? Math.min(1, scorer.targetLatencyMs / Math.max(1, sumLatency(context.turns)))
            : 1;
        const toolScore =
          scorer.targetToolCalls !== undefined
            ? Math.min(1, scorer.targetToolCalls / Math.max(1, sumToolCalls(context.turns)))
            : 1;
        const score = (latencyScore + toolScore) / 2;
        results.push({
          id: scorer.id,
          type: scorer.type,
          score,
          weight: scorer.weight,
          skipped: false,
          message: 'Budget efficiency scorer completed.',
        });
        break;
      }
      case 'text_semantic': {
        const turn = selectTurn(context.turns, scorer.turnIndex);
        const judge = await runSemanticJudge({
          apiKey: process.env.OPENAI_API_KEY ?? null,
          model: scorer.judgeModel ?? 'gpt-5.4-mini',
          rubric: scorer.rubric,
          candidateText: turn?.outputText ?? '',
        });
        results.push({
          id: scorer.id,
          type: scorer.type,
          score: judge.score,
          weight: scorer.weight,
          skipped: judge.skipped,
          message: judge.message,
        });
        break;
      }
    }
  }

  return results;
}

async function evaluateExpectation(
  context: EvaluationContext,
  expectation: EvalExpectation,
): Promise<ExpectationResult> {
  const result: ExpectationResult = {
    id: expectation.id ?? `${expectation.type}-${crypto.randomUUID().slice(0, 8)}`,
    type: expectation.type,
    passed: false,
    severity: expectation.severity,
    score: 0,
    message: '',
  };

  switch (expectation.type) {
    case 'node_transition': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const actual = turn
        ? `${turn.trace.previous_node}->${turn.trace.next_node}`
        : 'missing-turn';
      const allowed = expectation.allowed?.map(
        (candidate) => `${candidate.from ?? '*'}->${candidate.to ?? '*'}`,
      );
      const matched =
        turn !== undefined &&
        (allowed
          ? expectation.allowed?.some(
              (candidate) =>
                (candidate.from === undefined ||
                  candidate.from === turn.trace.previous_node) &&
                (candidate.to === undefined || candidate.to === turn.trace.next_node),
            ) === true
          : (expectation.from === undefined ||
              expectation.from === turn.trace.previous_node) &&
            (expectation.to === undefined || expectation.to === turn.trace.next_node));
      result.passed = matched;
      result.score = matched ? 1 : 0;
      result.message = matched
        ? `Observed transition ${actual}.`
        : `Expected transition did not match. Observed ${actual}. Allowed=${allowed?.join(', ') ?? `${expectation.from ?? '*'}->${expectation.to ?? '*'}`}.`;
      return result;
    }
    case 'node_path_contains': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const nodePath = turn?.trace.node_path ?? [];
      const missing = expectation.requiredNodes.filter((node) => !nodePath.includes(node));
      result.passed = missing.length === 0;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? 'All required nodes were present in the node path.'
        : `Missing required nodes: ${missing.join(', ')}.`;
      return result;
    }
    case 'plan_field_equals': {
      const actual = getValueAtPath(finalPlan(context.turns), expectation.path);
      result.passed = deepEqual(actual, expectation.expected);
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? `Plan field ${expectation.path} matched exactly.`
        : `Plan field ${expectation.path} was ${JSON.stringify(actual)} instead of ${JSON.stringify(expectation.expected)}.`;
      return result;
    }
    case 'plan_field_subset': {
      const actual = getValueAtPath(finalPlan(context.turns), expectation.path);
      result.passed = isSubset(actual, expectation.expected);
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? `Plan field ${expectation.path} contained the expected subset.`
        : `Plan field ${expectation.path} did not contain the expected subset.`;
      return result;
    }
    case 'provider_results_contains': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const providers = turn?.trace.provider_results ?? [];
      const matched = expectation.providers.filter((matcher) =>
        providers.some((provider) => providerMatches(provider, matcher)),
      );
      result.passed =
        expectation.matchMode === 'any'
          ? matched.length > 0
          : matched.length === expectation.providers.length;
      result.score = result.passed ? 1 : matched.length / expectation.providers.length;
      result.message = result.passed
        ? 'Provider results contained the expected matches.'
        : `Matched ${matched.length} of ${expectation.providers.length} provider expectations.`;
      return result;
    }
    case 'tool_usage': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const toolsCalled = turn?.trace.tools_called ?? [];
      const missing = expectation.mustCall.filter((tool) => !toolsCalled.includes(tool));
      const forbidden = expectation.mustNotCall.filter((tool) => toolsCalled.includes(tool));
      const maxExceeded =
        expectation.maxTotalCalls !== undefined &&
        toolsCalled.length > expectation.maxTotalCalls;
      result.passed = missing.length === 0 && forbidden.length === 0 && !maxExceeded;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? 'Tool usage matched expectations.'
        : `Missing=${missing.join(', ') || 'none'}; forbidden=${forbidden.join(', ') || 'none'}; total=${toolsCalled.length}.`;
      return result;
    }
    case 'text_contains': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const text = turn?.outputText ?? '';
      const allOfPassed = expectation.allOf.every((phrase) => text.includes(phrase));
      const anyOfPassed =
        expectation.anyOf.length === 0 ||
        expectation.anyOf.some((phrase) => text.includes(phrase));
      const regexPassed = expectation.regex.every((pattern) =>
        new RegExp(pattern, 'u').test(text),
      );
      result.passed = allOfPassed && anyOfPassed && regexPassed;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? 'Text containment checks passed.'
        : 'Text containment checks failed.';
      return result;
    }
    case 'text_not_contains': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const text = turn?.outputText ?? '';
      const present = expectation.phrases.filter((phrase) => text.includes(phrase));
      result.passed = present.length === 0;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? 'Forbidden phrases were absent.'
        : `Forbidden phrases found: ${present.join(', ')}.`;
      return result;
    }
    case 'text_semantic': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const judge = await runSemanticJudge({
        apiKey: process.env.OPENAI_API_KEY ?? null,
        model: expectation.judgeModel ?? 'gpt-5.4-mini',
        rubric: expectation.rubric,
        candidateText: turn?.outputText ?? '',
      });
      result.passed = judge.skipped ? true : judge.score >= expectation.minScore;
      result.score = judge.skipped ? 1 : judge.score;
      result.message = judge.message;
      return result;
    }
    case 'trajectory_invariants': {
      const messages = context.turns.map((turn) => turn.outputText.toLowerCase());
      const failures: string[] = [];
      if (expectation.noRepeatedQuestion && hasRepeatedQuestion(messages)) {
        failures.push('repeated question detected');
      }
      if (
        expectation.noCategoryReask &&
        messages.some((message) => message.includes('salón/local para eventos'))
      ) {
        failures.push('category was re-asked');
      }
      if (
        expectation.preservePriorSelection &&
        finalPlan(context.turns)?.provider_needs.some(
          (need) => need.status === 'shortlisted' && need.selected_provider_hint,
        )
      ) {
        failures.push('selected provider hint did not become a selected need');
      }
      if (
        expectation.noResolvedAmbiguityReopened &&
        hasRepeatedQuestion(messages)
      ) {
        failures.push('resolved ambiguity appears to have reopened');
      }
      result.passed = failures.length === 0;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? 'Trajectory invariants passed.'
        : failures.join('; ');
      return result;
    }
    case 'budget_constraints': {
      const turnCount = context.turns.length;
      const toolCalls = sumToolCalls(context.turns);
      const latencyMs = sumLatency(context.turns);
      const failures: string[] = [];
      if (expectation.maxTurns !== undefined && turnCount > expectation.maxTurns) {
        failures.push(`turns=${turnCount}`);
      }
      if (
        expectation.maxToolCalls !== undefined &&
        toolCalls > expectation.maxToolCalls
      ) {
        failures.push(`toolCalls=${toolCalls}`);
      }
      if (
        expectation.maxLatencyMs !== undefined &&
        latencyMs > expectation.maxLatencyMs
      ) {
        failures.push(`latencyMs=${latencyMs}`);
      }
      result.passed = failures.length === 0;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? 'Budget constraints passed.'
        : failures.join('; ');
      return result;
    }
    default: {
      result.message = `Unknown expectation type: ${expectation.type}.`;
      return result;
    }
  }
}

function computeFinalScore(
  expectationResults: ExpectationResult[],
  scorerResults: ScorerResult[],
): number {
  const scorerWeight = scorerResults.reduce(
    (sum, scorer) => sum + (scorer.skipped ? 0 : scorer.weight),
    0,
  );

  if (scorerWeight > 0) {
    return scorerResults.reduce(
      (sum, scorer) => sum + (scorer.skipped ? 0 : scorer.score * scorer.weight),
      0,
    ) / scorerWeight;
  }

  if (expectationResults.length === 0) {
    return 1;
  }

  return (
    expectationResults.reduce((sum, expectation) => sum + expectation.score, 0) /
    expectationResults.length
  );
}

function summarizePlanDiff(turns: EvalTurnResult[]): string[] {
  if (turns.length === 0) {
    return [];
  }

  const initial = createEmptyPlan({
    planId: 'seed',
    channel: turns[0].plan.channel,
    externalUserId: turns[0].plan.external_user_id,
  });
  const final = finalPlan(turns);
  if (!final) {
    return [];
  }

  const summary: string[] = [];
  const keys: Array<keyof typeof final> = [
    'current_node',
    'intent',
    'event_type',
    'vendor_category',
    'active_need_category',
    'location',
    'budget_signal',
    'guest_range',
    'selected_provider_id',
  ];

  for (const key of keys) {
    if (!deepEqual(initial[key], final[key])) {
      summary.push(`${String(key)}=${JSON.stringify(final[key])}`);
    }
  }

  if (final.provider_needs.length > 0) {
    summary.push(
      `provider_needs=${final.provider_needs
        .map((need) => `${need.category}:${need.status}`)
        .join(', ')}`,
    );
  }

  return summary;
}

function finalPlan(turns: EvalTurnResult[]) {
  return turns.at(-1)?.plan ?? null;
}

function selectTurn(turns: EvalTurnResult[], turnIndex?: number) {
  if (turnIndex === undefined) {
    return turns.at(-1);
  }
  return turns[turnIndex];
}

function getValueAtPath(source: unknown, dottedPath: string): unknown {
  return dottedPath
    .split('.')
    .reduce<unknown>((current, key) => (current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined), source);
}

function providerMatches(
  provider: EvalTurnResult['trace']['provider_results'][number],
  matcher: {
    id?: number;
    slug?: string;
    category?: string;
    titleContains?: string;
    detailUrlContains?: string;
  },
): boolean {
  return (
    (matcher.id === undefined || provider.id === matcher.id) &&
    (matcher.slug === undefined || provider.slug === matcher.slug) &&
    (matcher.category === undefined || provider.category === matcher.category) &&
    (matcher.titleContains === undefined || provider.title.includes(matcher.titleContains)) &&
    (matcher.detailUrlContains === undefined ||
      provider.detailUrl?.includes(matcher.detailUrlContains) === true)
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') {
    return deepEqual(actual, expected);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return false;
    }
    return expected.every((expectedEntry) =>
      actual.some((actualEntry) => isSubset(actualEntry, expectedEntry)),
    );
  }

  if (!actual || typeof actual !== 'object') {
    return false;
  }

  return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
    isSubset((actual as Record<string, unknown>)[key], value),
  );
}

function hasRepeatedQuestion(messages: string[]): boolean {
  const questions = messages.flatMap((message) =>
    message
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('?')),
  );
  const unique = new Set(questions);
  return unique.size !== questions.length;
}

function sumLatency(turns: EvalTurnResult[]): number {
  return turns.reduce((sum, turn) => sum + turn.latencyMs, 0);
}

function sumToolCalls(turns: EvalTurnResult[]): number {
  return turns.reduce((sum, turn) => sum + turn.trace.tools_called.length, 0);
}
