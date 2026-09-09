import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
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
import { redactEvalResultForArtifact, writeEvalArtifacts } from './reporting';
import { computeBenchmarkMetrics } from './metrics';
import {
  evaluateSemanticJudgeOutcome,
  runSemanticJudge,
} from './scorers/semantic-judge';
import { runLiveLambdaCase } from './targets/live-lambda';
import { runOfflineCase } from './targets/offline';
import { DEFAULT_GPT_TEXT_MODEL } from '../runtime/openai-model-defaults';
import { redactArtifactText } from '../runtime/artifact-redaction';
import {
  getEvaluationFixtureEffects,
  getEvaluationInput,
  getEvaluationOutputText,
  getEvaluationPlan,
} from './evaluation-state';
import {
  setupRsvpIsolation,
  teardownRsvpIsolation,
  type RsvpIsolationContext,
} from './rsvp-isolation';

export type EvalRunnerOptions = {
  evalsDir: string;
  outputDir: string;
  suite?: string | null;
  target?: EvalRunConfig['target'] | null;
  caseId?: string | null;
  caseIds?: string[] | null;
  matrixPath?: string | null;
  dryRun?: boolean;
  caseOverrides?: EvalCase[];
  configLabel?: string;
};

export const S01_FROZEN_BASELINE = {
  baselineCommit: '55a6c99bba6e2d1162aee071204f41aeebb8fba9',
  artifactModel: 'gpt-5.6-luna',
  asOfTime: '2026-09-05T01:33:57.291Z',
  frozenWorlds: ['purchase-kiara-frozen', 'purchase-martha-frozen'],
} as const;

export function getFrozenBaselineIdentity(): typeof S01_FROZEN_BASELINE {
  return S01_FROZEN_BASELINE;
}

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
  const selectedCases = options.caseOverrides ??
    selectCases(catalog.cases, catalog.suites, options);
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
      let rsvpIsolationContext: RsvpIsolationContext | null = null;
      let rsvpSetupError: string | null = null;
      if (currentCase.rsvpIsolation?.setup) {
        try {
          rsvpIsolationContext = await setupRsvpIsolation({
            setup: currentCase.rsvpIsolation.setup,
          });
        } catch (error) {
          rsvpSetupError = error instanceof Error ? error.message : String(error);
        }
      }
      let runtimeResult: RuntimeCaseResult;
      if (rsvpSetupError !== null) {
        runtimeResult = {
          turns: [],
          status: 'errored',
          errorMessage: `RSVP isolation setup failed: ${rsvpSetupError}`,
        };
      } else {
        try {
          runtimeResult = await executeCase(currentCase, config, caseOutputDir);
        } catch (error) {
          runtimeResult = {
            turns: [],
            status: 'errored',
            errorMessage: error instanceof Error ? error.message : String(error),
          };
        }
      }
      if (currentCase.rsvpIsolation?.teardown) {
        try {
          await teardownRsvpIsolation(
            {
              setup: currentCase.rsvpIsolation.setup,
              teardown: currentCase.rsvpIsolation.teardown,
            },
            rsvpIsolationContext,
          );
        } catch (error) {
          const teardownMessage = error instanceof Error ? error.message : String(error);
          if (runtimeResult.status !== 'errored') {
            runtimeResult = {
              turns: runtimeResult.turns,
              status: 'errored',
              errorMessage: `RSVP isolation teardown failed: ${teardownMessage}`,
            };
          }
        }
      }
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
      label: options.configLabel ?? options.target ?? 'offline-default',
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

  if (options.caseIds && options.caseIds.length > 0) {
    const allowed = new Set(options.caseIds);
    selected = selected.filter((candidate) => allowed.has(candidate.id));
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
    planDiffSummary: args.runtimeResult.errorMessage
      ? [`Runtime error: ${args.runtimeResult.errorMessage}`]
      : summarizePlanDiff(args.runtimeResult.turns),
    artifactPaths: {
      caseResult: artifactPath,
    },
    expectationResults,
    scorerResults,
    benchmarkMetrics: computeBenchmarkMetrics(
      args.runtimeResult.turns,
      expectationResults,
    ),
    turns: args.runtimeResult.turns,
    startedAt,
    completedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    artifactPath,
    JSON.stringify(redactEvalResultForArtifact(caseResult), null, 2),
    'utf8',
  );
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
        const judgeContext = buildSemanticJudgeContext(context.turns, scorer.turnIndex, context.currentCase);
        try {
          const judge = await runSemanticJudge({
            apiKey: process.env.OPENAI_API_KEY ?? null,
            model: scorer.judgeModel ?? DEFAULT_GPT_TEXT_MODEL,
            rubric: scorer.rubric,
            candidateText: turn ? redactArtifactText(getEvaluationOutputText(turn)) : '',
            context: judgeContext,
          });
          results.push({
            id: scorer.id,
            type: scorer.type,
            score: judge.score,
            weight: scorer.weight,
            skipped: judge.skipped,
            message: judge.message,
          });
        } catch (error) {
          results.push({
            id: scorer.id,
            type: scorer.type,
            score: 0,
            weight: scorer.weight,
            skipped: false,
            message: `Judge gate failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
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
      const turn = expectation.turnIndex !== undefined
        ? selectTurn(context.turns, expectation.turnIndex)
        : context.turns.at(-1);
      const actual = getValueAtPath(turn ? getEvaluationPlan(turn) : null, expectation.path);
      result.passed = deepEqual(actual, expectation.expected);
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? `Plan field ${expectation.path} matched exactly.`
        : `Plan field ${expectation.path} was ${JSON.stringify(actual)} instead of ${JSON.stringify(expectation.expected)}.`;
      return result;
    }
    case 'plan_field_subset': {
      const turn = expectation.turnIndex !== undefined
        ? selectTurn(context.turns, expectation.turnIndex)
        : context.turns.at(-1);
      const actual = getValueAtPath(turn ? getEvaluationPlan(turn) : null, expectation.path);
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
    case 'provider_result_count': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const count = turn?.trace.provider_results.length ?? 0;
      const minPassed = expectation.min === undefined || count >= expectation.min;
      const maxPassed = expectation.max === undefined || count <= expectation.max;
      result.passed = minPassed && maxPassed;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? `Provider result count ${count} matched expectation.`
        : `Provider result count ${count} outside expected range min=${expectation.min ?? '*'} max=${expectation.max ?? '*'}.`;
      return result;
    }
    case 'trace_field_equals': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const actual = getValueAtPath(turn?.trace ?? null, expectation.path);
      result.passed = deepEqual(actual, expectation.expected);
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? `Trace field ${expectation.path} matched expectation.`
        : `Trace field ${expectation.path} was ${JSON.stringify(actual)} instead of ${JSON.stringify(expectation.expected)}.`;
      return result;
    }
    case 'trace_field_subset': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const actual = getValueAtPath(turn?.trace ?? null, expectation.path);
      result.passed = isSubset(actual, expectation.expected);
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? `Trace field ${expectation.path} contained the expected subset.`
        : `Trace field ${expectation.path} did not contain the expected subset.`;
      return result;
    }
    case 'trace_field_number': {
      const turn = selectTurn(context.turns, expectation.turnIndex);
      const actual = getValueAtPath(turn?.trace ?? null, expectation.path);
      const numeric = typeof actual === 'number' ? actual : null;
      const minPassed = numeric !== null && (expectation.min === undefined || numeric >= expectation.min);
      const maxPassed = numeric !== null && (expectation.max === undefined || numeric <= expectation.max);
      result.passed = minPassed && maxPassed;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? `Trace field ${expectation.path} numeric value ${numeric} matched expectation.`
        : `Trace field ${expectation.path} was ${JSON.stringify(actual)} outside expected range min=${expectation.min ?? '*'} max=${expectation.max ?? '*'}.`;
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
       const text = turn ? getEvaluationOutputText(turn) : '';
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
       const text = turn ? getEvaluationOutputText(turn) : '';
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
      try {
        const judge = await runSemanticJudge({
          apiKey: process.env.OPENAI_API_KEY ?? null,
          model: expectation.judgeModel ?? DEFAULT_GPT_TEXT_MODEL,
          rubric: expectation.rubric,
          candidateText: turn ? redactArtifactText(getEvaluationOutputText(turn)) : '',
          context: buildSemanticJudgeContext(context.turns, expectation.turnIndex, context.currentCase),
        });
        const verdict = evaluateSemanticJudgeOutcome({
          outcome: judge,
          minScore: expectation.minScore,
          requireJudge: expectation.requireJudge,
        });
        result.passed = verdict.passed;
        result.score = verdict.score;
        result.message = judge.message;
      } catch (error) {
        result.passed = false;
        result.score = 0;
        result.message = `Judge gate failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      return result;
    }
    case 'trajectory_invariants': {
       const messages = context.turns.map((turn) =>
         getEvaluationOutputText(turn).toLowerCase(),
       );
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
          (need) => need.status === 'shortlisted' && need.selected_provider_hints.length > 0,
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
    case 'token_usage_present': {
      const turns = expectation.allTurns
        ? context.turns
        : [selectTurn(context.turns, expectation.turnIndex)];
      const failures: string[] = [];
      turns.forEach((turn, index) => {
        if (!turn) {
          failures.push(`turn ${expectation.turnIndex ?? index} missing`);
          return;
        }
        const usage = turn.trace.token_usage;
        if (!usage.total || usage.total.total_tokens <= 0) {
          failures.push(`turn ${turn.turnIndex} missing total tokens`);
        }
        if (
          expectation.requireExtraction &&
          (!usage.extraction || usage.extraction.total_tokens <= 0)
        ) {
          failures.push(`turn ${turn.turnIndex} missing extraction tokens`);
        }
        if (
          expectation.requireReply &&
          (!usage.reply || usage.reply.total_tokens <= 0)
        ) {
          failures.push(`turn ${turn.turnIndex} missing reply tokens`);
        }
      });
      result.passed = failures.length === 0;
      result.score = result.passed ? 1 : 0;
      result.message = result.passed
        ? 'Token usage was present for expected turns.'
        : failures.join('; ');
      return result;
    }
    case 'fixture_effect_count': {
      const selected = selectTurn(context.turns, expectation.turnIndex);
      if (!selected) {
        result.passed = false;
        result.score = 0;
        result.message = `Missing turn ${expectation.turnIndex ?? 'final'} for fixture_effect_count.`;
        return result;
      }
      const effects = getEvaluationFixtureEffects(selected);
      if (effects === null) {
        result.passed = false;
        result.score = 0;
        result.message = `Missing fixture receipt evidence for ${expectation.operation}; it is not zero.`;
        return result;
      }
      const entry = effects.find((item) => item.operation === expectation.operation);
      if (!entry) {
        const expectsZero = expectation.expectedAttempts === 0 &&
          expectation.expectedSuccesses === 0 &&
          expectation.expectedReplays === 0;
        if (expectsZero) {
          result.passed = true;
          result.score = 1;
          result.message = `No ${expectation.operation} effects recorded as expected.`;
          return result;
        }
        result.passed = false;
        result.score = 0;
        result.message = `Missing fixture receipt evidence for ${expectation.operation}; it is not zero.`;
        return result;
      }
      if (!entry.receiptPresent) {
        result.passed = false;
        result.score = 0;
        result.message = `Missing fixture receipt evidence for ${expectation.operation}; it is not zero.`;
        return result;
      }
      const matched = entry.attempts === expectation.expectedAttempts &&
        entry.successes === expectation.expectedSuccesses &&
        entry.replays === expectation.expectedReplays;
      result.passed = matched;
      result.score = matched ? 1 : 0;
      result.message = matched
        ? `Fixture ${expectation.operation} attempts=${entry.attempts} successes=${entry.successes} replays=${entry.replays} outcome=${entry.outcome}.`
        : `Fixture ${expectation.operation} was attempts=${entry.attempts} successes=${entry.successes} replays=${entry.replays} outcome=${entry.outcome} instead of attempts=${expectation.expectedAttempts} successes=${expectation.expectedSuccesses} replays=${expectation.expectedReplays}.`;
      return result;
    }
    default: {
      const unknownExpectation = expectation as { type?: unknown };
      result.message = `Unknown expectation type: ${String(unknownExpectation.type)}.`;
      return result;
    }
  }
}

export function buildSemanticJudgeContext(
  turns: EvalTurnResult[],
  turnIndex: number | undefined,
  currentCase?: EvalCase,
): string {
  const selectedIndex = turnIndex ?? turns.length - 1;
  const effectiveTurns = turns.filter((turn) => turn.turnIndex <= selectedIndex);
  const interaction = effectiveTurns
    .map((turn) => {
      const plan = getEvaluationPlan(turn);
      return {
        turnIndex: turn.turnIndex,
        userInput: redactArtifactText(getEvaluationInput(turn).text),
        priorAssistantOutput:
          turn.turnIndex < selectedIndex
            ? redactArtifactText(getEvaluationOutputText(turn))
            : undefined,
        nodeTransition: `${turn.trace.previous_node}->${turn.trace.next_node}`,
        toolsCalled: [...turn.trace.tools_called],
        plan: {
          eventType: plan.event_type,
          location: plan.location,
          guestRange: plan.guest_range,
          activeNeedCategory: plan.active_need_category,
          providerNeeds: plan.provider_needs.map((need) => ({
            category: need.category,
            status: need.status,
            selectedProviderIds: [...need.selected_provider_ids],
          })),
          authEvidence: {
            status: plan.user_auth.status,
            authMethod: plan.user_auth.auth_method,
            awaitingPhoneConfirmation: plan.user_auth.awaiting_phone_confirmation,
            contactFieldsPresent: {
              name: turn.trace.contact_validation_summary.plan_contact_fields_present.name,
              email: turn.trace.contact_validation_summary.plan_contact_fields_present.email,
              phone: turn.trace.contact_validation_summary.plan_contact_fields_present.phone,
            },
          },
        },
      };
    });
  const base = JSON.stringify(interaction);
  const structuralLines = buildStructuralFactLines(effectiveTurns);
  const judgeRules = [
    'Reglas para el juez: los hechos estructurales verificados (verified effect counts/outcomes and state) prevalecen sobre cualquier especulacion.',
    'A tool-name alone is not effect proof: tools_called without verified effect counts/outcomes and persisted state must not be treated as a completed write; verified counts and state take precedence.',
    'Judge the candidate response only; do not attribute a phrase appearing only in prior assistant output or fixture history to the candidate.',
    'El juez no debe exigir que la respuesta repita codigos o referencias que el texto candidato muestra redactados.',
    'Unavailable reference policy: los campos ausentes se omiten; una respuesta de estado grounded sin eco de codigo es valida y el juez no debe exigir seleccion ni codigo echo; solo los campos existentes, explicitamente visibles para el cliente y autorizados pueden mostrarse (reference unavailable).',
  ].join(' ');
  const lastTurn = effectiveTurns[effectiveTurns.length - 1];
  const candidateText = selectedIndex >= 0 && lastTurn !== undefined
    ? redactArtifactText(getEvaluationOutputText(lastTurn))
    : '';
  const priorTexts = effectiveTurns.slice(0, -1).map((turn) => redactArtifactText(getEvaluationOutputText(turn)));
  const isolatedHeader = [
    `CANDIDATE RESPONSE (turn ${selectedIndex}, judge only this text): ${candidateText}`,
    priorTexts.length > 0
      ? `PRIOR ASSISTANT RESPONSES (turns before candidate, never attribute to candidate): ${JSON.stringify(priorTexts)}`
      : 'PRIOR ASSISTANT RESPONSES: none',
  ].join('\n');
  if (!currentCase) {
    return `${isolatedHeader}\n\nInteraction:\n${base}\n\n${structuralLines.join('\n')}\n\n${judgeRules}`;
  }
  const hasNotes = currentCase.notes.length > 0;
  const fixtureMessages = loadSubjectScopedFixtureMessages(currentCase, selectedIndex);
  const declaresFixture = resolveEffectiveFixtureScenario(currentCase, selectedIndex) !== null;
  const fixtureSection = fixtureMessages
    ? `FIXTURE HISTORY (declared world context, never attribute to candidate): fixture ${resolveEffectiveFixtureScenario(currentCase, selectedIndex) ?? 'desconocido'} mensajes declarados (id, direction, body): ${JSON.stringify(fixtureMessages)}`
    : declaresFixture
      ? `FIXTURE HISTORY: fixture ${resolveEffectiveFixtureScenario(currentCase, selectedIndex) ?? 'desconocido'} sin mensajes para el sujeto de este caso; no se transfirio historial de otros sujetos.`
      : 'FIXTURE HISTORY: none';
  if (!hasNotes && !fixtureMessages && !declaresFixture) {
    return `${isolatedHeader}\n\nInteraction:\n${base}\n\n${structuralLines.join('\n')}\n\n${fixtureSection}\n\n${judgeRules}`;
  }
  const trustedLines: string[] = [];
  trustedLines.push(isolatedHeader);
  trustedLines.push(`Interaction:\n${base}`);
  trustedLines.push('Contexto confiable reconstruido del caso:');
  trustedLines.push(structuralLines.join(' | '));
  trustedLines.push(fixtureSection);
  trustedLines.push(judgeRules);
  if (hasNotes) {
    trustedLines.push(`Notas del caso (procedencia: autor del caso, no evidencia del mundo congelado; los hechos actuales del mundo congelado prevalecen): ${JSON.stringify(currentCase.notes)}`);
  }
  trustedLines.push('Politica de referencia del cliente (minimum disclosure): solo los campos existentes, explicitamente visibles para el cliente y autorizados pueden mostrarse (transaction reference). Los campos ausentes se omiten y el juez no debe exigir que se repitan codigos redactados. Los identificadores internos/autenticacion permanecen ocultos.');
  return trustedLines.join('\n\n');
}

function buildStructuralFactLines(turns: EvalTurnResult[]): string[] {
  return turns.map((turn) => {
    const plan = getEvaluationPlan(turn);
    const selection = turn.trace.selection_resolution_summary;
    const executions = turn.trace.information_execution_summary
      .map((entry) => `${entry.requestId}:${entry.kind}:${entry.status}:${entry.outcomeCode}`)
      .join(',');
    const closeSummary = turn.trace.finish_plan_summary;
    const receipts = (turn.trace.provider_quote_receipts ?? [])
      .map((entry) => `${entry.providerId}:${entry.resultStatus}:${entry.eventDate}`)
      .join(',');
    const receiptFacts = receipts.length > 0 ? `:comprobantes=[${receipts}]` : '';
    const closeFacts = closeSummary?.status
      ? `finish_plan:${closeSummary.status}:${closeSummary.eventDate ?? 'sin-fecha'}:` +
        `confirmados=${closeSummary.confirmedCount}:` +
        `pendientes=[${closeSummary.pendingProviderIds.join(',')}]${receiptFacts}`
      : 'ninguno';
    return (
      `Hechos estructurales verificados del turno ${turn.turnIndex}: ` +
      `tools_called=[${turn.trace.tools_called.join(',')}] ` +
      `transicion=${turn.trace.previous_node}->${turn.trace.next_node} ` +
      `auth=${plan.user_auth.status} ` +
      `handoff=${plan.human_escalation.status} ` +
      `seleccion_hints=${selection.selected_provider_hints_count} ` +
      `operaciones_proveedor=[${selection.provider_plan_operation_types.join(',')}] ` +
      `ejecuciones=[${executions || 'ninguna'}] ` +
      `cierre=${closeFacts}`
    );
  });
}

export function resolveEffectiveFixtureScenario(
  currentCase: EvalCase,
  selectedIndex: number,
): string | null {
  const perTurn = currentCase.inputs[selectedIndex]?.backendFixture?.scenario;
  if (perTurn) return perTurn;
  return currentCase.backendFixture?.scenario ?? null;
}

export function resolveDispatchFixtureScenario(
  currentCase: EvalCase,
  turnIndex: number,
): string | null {
  return resolveEffectiveFixtureScenario(currentCase, turnIndex);
}

function collectCaseSubjectPhones(currentCase: EvalCase, selectedIndex: number): string[] {
  const phones: string[] = [];
  for (const input of currentCase.inputs.slice(0, selectedIndex + 1)) {
    const contactPhone = input.contactPhone;
    if (typeof contactPhone === 'string' && contactPhone.length > 0 && !contactPhone.startsWith('$')) {
      phones.push(contactPhone);
    }
  }
  const seedPhone = (currentCase.seedPlan as { contact_phone?: unknown } | undefined)?.contact_phone;
  if (typeof seedPhone === 'string' && seedPhone.length > 0 && !seedPhone.startsWith('$')) {
    phones.push(seedPhone);
  }
  return phones;
}

function phoneKeysMatch(left: string, right: string): boolean {
  const leftDigits = left.replace(/\D/gu, '');
  const rightDigits = right.replace(/\D/gu, '');
  if (leftDigits.length < 7 || rightDigits.length < 7) {
    return leftDigits === rightDigits;
  }
  const tail = Math.min(9, leftDigits.length, rightDigits.length);
  return leftDigits.slice(-tail) === rightDigits.slice(-tail);
}

function loadSubjectScopedFixtureMessages(
  currentCase: EvalCase,
  selectedIndex: number,
): Array<{ id: number; direction: string; body: string }> | null {
  const scenario = resolveEffectiveFixtureScenario(currentCase, selectedIndex);
  if (!scenario) {
    return null;
  }
  const subjectPhones = collectCaseSubjectPhones(currentCase, selectedIndex);
  if (subjectPhones.length === 0) {
    return null;
  }
  try {
    const fixturePath = path.join(process.cwd(), 'evals', 'fixtures', `${scenario}.json`);
    const raw = fsSync.readFileSync(fixturePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      recentMessages?: Record<string, { messages?: Array<{ id: number; direction: string; body: string }> }>;
    };
    if (!parsed.recentMessages || typeof parsed.recentMessages !== 'object') {
      return null;
    }
    const collected: Array<{ id: number; direction: string; body: string }> = [];
    for (const [subjectKey, entry] of Object.entries(parsed.recentMessages)) {
      if (!subjectPhones.some((phone) => phoneKeysMatch(phone, subjectKey))) {
        continue;
      }
      const msgs = entry?.messages ?? [];
      for (const m of msgs.slice(0, 20)) {
        collected.push({ id: m.id, direction: m.direction, body: redactArtifactText(m.body) });
      }
    }
    return collected.length > 0 ? collected : null;
  } catch {
    // fixture missing or unreadable - treat as no fixture context
    return null;
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
    channel: getEvaluationPlan(turns[0]).channel,
    externalUserId: getEvaluationPlan(turns[0]).external_user_id,
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
    'selected_provider_ids',
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
  const turn = turns.at(-1);
  return turn ? getEvaluationPlan(turn) : null;
}

function selectTurn(turns: EvalTurnResult[], turnIndex?: number) {
  if (turnIndex === undefined) {
    return turns.at(-1);
  }
  return turns[turnIndex];
}

export function evaluateFixtureEffectCountForTesting(args: {
  turns: EvalTurnResult[];
  operation: string;
  turnIndex?: number;
  expectedAttempts: number;
  expectedSuccesses: number;
  expectedReplays: number;
}): { passed: boolean; message: string } {
  const selected = args.turnIndex === undefined ? args.turns.at(-1) : args.turns[args.turnIndex];
  if (!selected) {
    return { passed: false, message: `Missing turn ${args.turnIndex ?? 'final'} for fixture_effect_count.` };
  }
  const effects = getEvaluationFixtureEffects(selected);
  if (effects === null) {
    return { passed: false, message: `Missing fixture receipt evidence for ${args.operation}; it is not zero.` };
  }
  const entry = effects.find((item) => item.operation === args.operation);
  if (!entry) {
    const expectsZero = args.expectedAttempts === 0 && args.expectedSuccesses === 0 && args.expectedReplays === 0;
    if (expectsZero) return { passed: true, message: `No ${args.operation} effects recorded as expected.` };
    return { passed: false, message: `Missing fixture receipt evidence for ${args.operation}; it is not zero.` };
  }
  if (!entry.receiptPresent) {
    return { passed: false, message: `Missing fixture receipt evidence for ${args.operation}; it is not zero.` };
  }
  const matched = entry.attempts === args.expectedAttempts &&
    entry.successes === args.expectedSuccesses &&
    entry.replays === args.expectedReplays;
  return {
    passed: matched,
    message: matched
      ? `Fixture ${args.operation} attempts=${entry.attempts} successes=${entry.successes} replays=${entry.replays} outcome=${entry.outcome}.`
      : `Fixture ${args.operation} was attempts=${entry.attempts} successes=${entry.successes} replays=${entry.replays} outcome=${entry.outcome} instead of attempts=${args.expectedAttempts} successes=${args.expectedSuccesses} replays=${args.expectedReplays}.`,
  };
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
