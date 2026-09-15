import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import type { RunManifest } from './run-manifest';
import { runManifestSchema } from './run-manifest';

import {
  type BenchmarkSummary,
  evalArtifactResultSchema,
  evalArtifactTurnResultSchema,
  evalReportSchema,
  type EvalAggregateSummary,
  type EvalArtifactResult,
  type EvalArtifactTurnResult,
  type EvalTurnResult,
  type EvalFlakyCandidate,
  type EvalReport,
  type EvalResult,
} from './case-schema';
import {
  projectSafeRecord,
  projectSafeTrace,
  redactArtifactText,
} from '../runtime/artifact-redaction';

export async function writeEvalArtifacts(args: {
  outputDir: string;
  runId: string;
  results: EvalResult[];
  orderedIds?: readonly string[];
  completion?: EvalReport['completion'];
  timingSummary?: EvalReport['timingSummary'];
  judgeSummary?: EvalReport['judgeSummary'];
}): Promise<{ runDir: string; report: EvalReport }> {
  const runDir = path.join(args.outputDir, args.runId);
  await fs.mkdir(runDir, { recursive: true });

  const safeResults = args.results.map(redactEvalResultForArtifact);
  const ordered = args.orderedIds && args.orderedIds.length > 0
    ? sortResultsInManifestOrder(safeResults, args.orderedIds)
    : safeResults;
  const report = buildEvalReport(args.runId, args.results, {
    orderedIds: args.orderedIds,
    completion: args.completion,
    timingSummary: args.timingSummary,
    judgeSummary: args.judgeSummary,
  });
  await writeAtomicText(
    path.join(runDir, 'results.jsonl'),
    ordered.map((result) => JSON.stringify(result)).join('\n'),
  );
  await writeAtomicText(
    path.join(runDir, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  await writeAtomicText(path.join(runDir, 'report.md'), renderMarkdownReport(report));

  return { runDir, report };
}

/**
 * Packet O2 coordinator-owned progress record. Exactly one writer (the
 * coordinator) updates this file, at most every ten seconds plus a final
 * partial snapshot on SIGINT or deadline. Atomic write; crash recovery
 * reads it to preserve unfinished/error states.
 */
export async function writeProgressRecord(args: {
  runDir: string;
  progress: {
    queued: number;
    running: number;
    completed: number;
    error: number;
    phase: string;
    elapsedMs: number;
    stopReason: string | null;
    complete: boolean;
  };
  runId: string;
  partial?: boolean;
}): Promise<void> {
  await writeAtomicText(
    path.join(args.runDir, 'progress.json'),
    JSON.stringify({
      runId: args.runId,
      ...args.progress,
      partial: args.partial ?? false,
      writtenAt: new Date().toISOString(),
    }, null, 2),
  );
}

async function writeAtomicText(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

export function buildEvalReport(
  runId: string,
  results: EvalResult[],
  options?: {
    /** Manifest order; results are sorted to it for deterministic output. */
    orderedIds?: readonly string[];
    completion?: EvalReport['completion'];
    timingSummary?: EvalReport['timingSummary'];
    judgeSummary?: EvalReport['judgeSummary'];
  },
): EvalReport {
  const safeResults = results.map(redactEvalResultForArtifact);
  // The coordinator assembles results in manifest order; preserve that
  // order by default and only re-sort when an explicit manifest order is
  // given (deterministic output regardless of completion order).
  const ordered = options?.orderedIds && options.orderedIds.length > 0
    ? sortResultsInManifestOrder(safeResults, options.orderedIds)
    : safeResults;
  const totalCases = safeResults.length;
  const passedCases = safeResults.filter((result) => result.status === 'passed').length;
  const failedCases = safeResults.filter((result) => result.status === 'failed').length;
  const erroredCases = safeResults.filter((result) => result.status === 'errored').length;
  const skippedCases = safeResults.filter((result) => result.status === 'skipped').length;
  const averageScore =
    totalCases === 0
      ? 0
      : safeResults.reduce((sum, result) => sum + result.finalScore, 0) / totalCases;
  const averageLatencyMs =
    totalCases === 0
      ? 0
      : safeResults.reduce((sum, result) => sum + result.totalLatencyMs, 0) / totalCases;

  return evalReportSchema.parse({
    runId,
    generatedAt: new Date().toISOString(),
    totalCases,
    passedCases,
    failedCases,
    erroredCases,
    skippedCases,
    averageScore,
    averageLatencyMs,
    suiteSummaries: summarizeBy(ordered, (result) => result.suite),
    configSummaries: summarizeBy(ordered, (result) => result.configLabel),
    targetSummaries: summarizeBy(ordered, (result) => result.target),
    flakyCandidates: collectFlakyCandidates(ordered),
    benchmarkSummary: buildBenchmarkSummary(ordered),
    ...(options?.completion ? { completion: options.completion } : {}),
    ...(options?.timingSummary ? { timingSummary: options.timingSummary } : {}),
    ...(options?.judgeSummary ? { judgeSummary: options.judgeSummary } : {}),
    results: ordered,
  });
}

/**
 * Packet O2 deterministic ordering. Results are placed in manifest order;
 * ties (same case across configs) keep coordinator insertion order. Any
 * result missing from the manifest sorts last, never silently dropped.
 */
export function sortResultsInManifestOrder<T extends { caseId: string }>(
  results: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index] as const));
  return [...results]
    .map((result, insertion) => ({ result, insertion }))
    .sort((left, right) => {
      const leftRank = rank.get(left.result.caseId) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.result.caseId) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.insertion - right.insertion;
    })
    .map((entry) => entry.result);
}

export function assertExpectedCasesExecuted(
  expectedCaseIds: readonly string[],
  results: readonly Pick<EvalResult, 'caseId'>[],
): void {
  const executed = new Set(results.map((result) => result.caseId));
  const missing = expectedCaseIds.filter((caseId) => !executed.has(caseId));
  if (missing.length > 0) {
    throw new Error(`mandatory evaluation cases missing: ${missing.join(', ')}`);
  }
}

export function redactEvalResultForArtifact(result: EvalResult): EvalArtifactResult {
  const safeResult = {
    runId: result.runId,
    caseId: result.caseId,
    suite: result.suite,
    target: result.target,
    configLabel: result.configLabel,
    status: result.status,
    hardGatePassed: result.hardGatePassed,
    ...(result.primaryFailureReason ? { primaryFailureReason: result.primaryFailureReason } : {}),
    finalScore: result.finalScore,
    totalLatencyMs: result.totalLatencyMs,
    totalToolCalls: result.totalToolCalls,
    nodeTransitions: [...result.nodeTransitions],
    planDiffSummary: [...result.planDiffSummary],
    artifactPaths: { caseResult: result.artifactPaths.caseResult },
    expectationResults: result.expectationResults.map((entry) => ({ ...entry })),
    scorerResults: result.scorerResults.map((entry) => ({ ...entry })),
    ...(result.benchmarkMetrics ? { benchmarkMetrics: { ...result.benchmarkMetrics } } : {}),
    ...(result.timing ? { timing: { ...result.timing } } : {}),
    ...(result.judgeMetrics ? { judgeMetrics: { ...result.judgeMetrics, judgeModels: [...result.judgeMetrics.judgeModels] } } : {}),
    ...(result.executionUncertain ? { executionUncertain: true } : {}),
    turns: result.turns.map(projectEvalTurnForArtifact),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  } satisfies Omit<EvalArtifactResult, 'benchmarkMetrics'> & {
    benchmarkMetrics?: EvalArtifactResult['benchmarkMetrics'];
  };

  return evalArtifactResultSchema.parse(safeResult);
}

/**
 * Packet O2 snapshot redaction. Immutable private turn evidence is
 * projected through the same redaction as final artifacts before the
 * atomic per-case snapshot write; no new raw customer data is published.
 */
export function redactEvalTurnsForSnapshot(turns: EvalTurnResult[]): EvalArtifactTurnResult[] {
  return turns.map(projectEvalTurnForArtifact);
}

function projectEvalTurnForArtifact(turn: EvalTurnResult): EvalArtifactTurnResult {
  const projected = {
    turnIndex: turn.turnIndex,
    input: {
      ...turn.input,
      text: redactArtifactText(turn.input.text),
      ...(turn.input.externalUserId
        ? { externalUserId: turn.input.externalUserId }
        : {}),
      ...(turn.input.contactPhone !== undefined ? { contactPhone: null } : {}),
    },
    outputText: redactArtifactText(turn.outputText),
    ...(turn.deliveredText === undefined
      ? {}
      : { deliveredText: turn.deliveredText === null ? null : redactArtifactText(turn.deliveredText) }),
    ...(turn.delivery ? { delivery: { ...turn.delivery } } : {}),
    ...(turn.outputOrigin ? { outputOrigin: { ...turn.outputOrigin } } : {}),
    currentNode: turn.currentNode,
    trace: projectSafeTrace(turn.trace),
    perf:
      turn.perf === undefined || turn.perf === null
        ? turn.perf
        : projectSafeRecord(turn.perf),
    plan_summary: {
      current_node: turn.plan.current_node,
      lifecycle_state: turn.plan.lifecycle_state,
      event_type: turn.plan.event_type,
      vendor_category: turn.plan.vendor_category,
      active_need_category: turn.plan.active_need_category,
      location: turn.plan.location,
      budget_signal: turn.plan.budget_signal,
      guest_range: turn.plan.guest_range,
      provider_needs: turn.plan.provider_needs.map((need) => ({
        category: need.category,
        status: need.status,
        recommended_provider_ids: [...need.recommended_provider_ids],
        selected_provider_ids: [...need.selected_provider_ids],
      })),
      selected_provider_ids: [...turn.plan.selected_provider_ids],
      missing_fields: [...turn.plan.missing_fields],
    },
    auth_evidence: {
      status: turn.plan.user_auth.status,
      auth_method: turn.plan.user_auth.auth_method,
      awaiting_phone_confirmation: turn.plan.user_auth.awaiting_phone_confirmation,
      phone_confirmation: turn.plan.user_auth.awaiting_phone_confirmation
        ? 'awaiting' as const
        : 'not_awaiting' as const,
      contact_fields_present: {
        name: turn.trace.contact_validation_summary.plan_contact_fields_present.name,
        email: turn.trace.contact_validation_summary.plan_contact_fields_present.email,
        phone: turn.trace.contact_validation_summary.plan_contact_fields_present.phone,
      },
    },
    latencyMs: turn.latencyMs,
  };

  return evalArtifactTurnResultSchema.parse(projected);
}

function buildBenchmarkSummary(results: EvalArtifactResult[]): BenchmarkSummary | undefined {
  const metrics = results
    .map((result) => result.benchmarkMetrics)
    .filter((entry): entry is NonNullable<EvalResult['benchmarkMetrics']> => entry !== undefined);
  if (metrics.length === 0) {
    return undefined;
  }
  const average = (selector: (entry: (typeof metrics)[number]) => number) =>
    metrics.reduce((sum, entry) => sum + selector(entry), 0) / metrics.length;
  // Packet O3: token aggregates are summed counts over cases with known
  // usage only; the hit rate is the ratio of those sums, never an average
  // of per-case percentages. Missing usage stays unknown, never zero.
  const known = metrics.filter((entry) => entry.usage_known !== false);
  const sumKnown = (selector: (entry: (typeof metrics)[number]) => number): number =>
    known.reduce((sum, entry) => sum + (selector(entry) ?? 0), 0);
  const totalInput = sumKnown((entry) => entry.input_tokens ?? 0);
  const totalCached = sumKnown((entry) => entry.cached_input_tokens ?? 0);
  return {
    avg_tool_precision: average((entry) => entry.tool_precision),
    avg_tool_recall: average((entry) => entry.tool_recall),
    avg_tool_f1: average((entry) => entry.tool_f1),
    avg_branch_coverage: average((entry) => entry.branch_coverage),
    avg_state_expectation_pass_rate: average((entry) => entry.state_expectation_pass_rate),
    avg_trajectory_expectation_pass_rate: average(
      (entry) => entry.trajectory_expectation_pass_rate,
    ),
    avg_plan_persistence_rate: average((entry) => entry.plan_persistence_rate),
    avg_cache_hit_rate: totalInput === 0 ? 0 : totalCached / totalInput,
    total_tokens: metrics.reduce((sum, entry) => sum + entry.total_tokens, 0),
    total_input_tokens: totalInput,
    total_cached_input_tokens: totalCached,
    total_cache_write_input_tokens: sumKnown((entry) => entry.cache_write_input_tokens ?? 0),
    total_uncached_input_tokens: Math.max(0, totalInput - totalCached),
  };
}

/**
 * Packet O5 — one primary reason per failure. Numerical scores stay
 * diagnostic details; each failed or errored case carries exactly one
 * primary reason so contradictory time, invented absence, wrong-event
 * writes and false success read as product defects even when the prose is
 * understandable, while a missing preferred sentence is never a defect on
 * its own. Priority is deterministic: infrastructure and evaluator defects
 * trump verdict content (the verdict itself is untrustworthy), then product
 * effect/identity, then product fact/completeness, then unnecessary
 * interaction (quality-only failures).
 */
export const PRIMARY_FAILURE_REASONS = [
  'product_effect_identity',
  'product_fact_completeness',
  'unnecessary_interaction',
  'evaluator_defect',
  'infrastructure_error',
] as const;

export type PrimaryFailureReason = (typeof PRIMARY_FAILURE_REASONS)[number];

const INFRASTRUCTURE_PATTERNS = [
  /transport gate failures/i,
  /uncertain execution/i,
  /rsvp isolation (setup|teardown) failed/i,
  /external lane stopped/i,
  /suite deadline/i,
  /sigint stopped/i,
];

const EVALUATOR_PATTERNS = [
  /judge gate failed/i,
  /mandatory judge/i,
  /skipped semantic judge/i,
  /missing wire-delivered candidate evidence/i,
  /missing fixture receipt evidence/i,
  /unknown expectation type/i,
  /case finalization failed/i,
];

const EFFECT_IDENTITY_PATTERNS = [
  /output-origin gate failures/i,
  /instead of attempts=/i,
  /tool usage matched expectations\.|missing=|forbidden=/i,
  /\bduplicate\b/i,
  /\breplay\b/i,
];

const UNNECESSARY_INTERACTION_TYPES = new Set(['trajectory_invariants', 'budget_constraints']);

export function classifyPrimaryFailureReason(args: {
  status: 'passed' | 'failed' | 'errored' | 'skipped';
  executionUncertain?: boolean;
  planDiffSummary: readonly string[];
  expectationResults: ReadonlyArray<{
    passed: boolean;
    severity: 'hard' | 'soft';
    type: string;
    message: string;
  }>;
}): PrimaryFailureReason | null {
  if (args.status === 'passed' || args.status === 'skipped') {
    return null;
  }
  if (args.status === 'errored' || args.executionUncertain === true) {
    return 'infrastructure_error';
  }
  const searchable = [...args.planDiffSummary];
  const failedHard = args.expectationResults.filter(
    (result) => result.severity === 'hard' && !result.passed,
  );
  for (const result of failedHard) {
    searchable.push(`${result.type}: ${result.message}`);
  }
  if (failedHard.length === 0 && args.planDiffSummary.length === 0) {
    // A failed verdict with no positive infrastructure or evaluator signal
    // is a content defect by default; infrastructure needs evidence.
    return 'product_fact_completeness';
  }
  const matches = (patterns: RegExp[]): boolean =>
    searchable.some((text) => patterns.some((pattern) => pattern.test(text)));
  if (matches(INFRASTRUCTURE_PATTERNS)) {
    return 'infrastructure_error';
  }
  if (matches(EVALUATOR_PATTERNS)) {
    return 'evaluator_defect';
  }
  if (matches(EFFECT_IDENTITY_PATTERNS)) {
    return 'product_effect_identity';
  }
  const onlyUnnecessary = failedHard.length > 0 &&
    failedHard.every((result) => UNNECESSARY_INTERACTION_TYPES.has(result.type));
  if (onlyUnnecessary) {
    return 'unnecessary_interaction';
  }
  return 'product_fact_completeness';
}

export async function writeRunManifestArtifact(args: {
  runDir: string;
  manifest: RunManifest;
}): Promise<{ manifestPath: string; manifestDigest: string }> {
  const parsed = runManifestSchema.parse(args.manifest);
  const manifestPath = path.join(args.runDir, 'manifest.json');
  const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
  const manifestDigest = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
  const tempPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, serialized, 'utf8');
  await fs.rename(tempPath, manifestPath);
  return { manifestPath, manifestDigest };
}

export async function readRunManifestArtifact(manifestPath: string): Promise<RunManifest> {
  const raw = await fs.readFile(manifestPath, 'utf8');
  return runManifestSchema.parse(JSON.parse(raw) as unknown);
}

export function renderMarkdownReport(report: EvalReport): string {
  const completion = report.completion;
  const lines = [
    `# Eval Report: ${report.runId}`,
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Total cases: ${report.totalCases}`,
    `- Passed: ${report.passedCases}`,
    `- Failed: ${report.failedCases}`,
    `- Errored: ${report.erroredCases}`,
    `- Skipped: ${report.skippedCases}`,
    `- Average score: ${report.averageScore.toFixed(3)}`,
    `- Average latency: ${report.averageLatencyMs.toFixed(1)} ms`,
    ...(completion
      ? [
        `- Completion: ${completion.complete ? 'complete' : 'INCOMPLETE'}${completion.reason ? ` (${completion.reason})` : ''}`,
        `- Resume mode: ${completion.resumeMode}`,
      ]
      : []),
    ...(report.timingSummary ? [`- Makespan: ${report.timingSummary.makespanMs.toFixed(0)} ms`] : []),
    ...(report.judgeSummary
      ? [`- Judge calls: ${report.judgeSummary.modelCalls} (retries=${report.judgeSummary.retryCount}, rate-limited=${report.judgeSummary.rateLimitCount})`]
      : []),
    ...(report.benchmarkSummary?.total_input_tokens !== undefined
      ? [`- Tokens: input=${report.benchmarkSummary.total_input_tokens} cached=${report.benchmarkSummary.total_cached_input_tokens ?? 0} uncached=${report.benchmarkSummary.total_uncached_input_tokens ?? 0}`]
      : []),
    '',
    '## Suite Summary',
    '',
    '| Suite | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.suiteSummaries.map(renderAggregateRow),
    '',
    '## Config Summary',
    '',
    '| Config | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.configSummaries.map(renderAggregateRow),
    '',
    '| Suite | Case | Target | Config | Status | Score | Latency (ms) | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.results.map(
      (result) =>
        `| ${result.suite} | ${result.caseId} | ${result.target} | ${result.configLabel} | ${result.status} | ${result.finalScore.toFixed(3)} | ${result.totalLatencyMs.toFixed(1)} | ${result.primaryFailureReason ?? '—'} |`,
    ),
  ];

  if (report.flakyCandidates.length > 0) {
    lines.push('', '## Flaky Candidates', '');
    for (const candidate of report.flakyCandidates) {
      lines.push(
        `- ${candidate.caseId} (${candidate.suite}): statuses=${candidate.statuses.join(', ')} configs=${candidate.configLabels.join(', ')} targets=${candidate.targets.join(', ')}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function summarizeBy(
  results: EvalArtifactResult[],
  keySelector: (result: EvalArtifactResult) => string,
): EvalAggregateSummary[] {
  const groups = new Map<string, EvalArtifactResult[]>();

  for (const result of results) {
    const key = keySelector(result);
    const entries = groups.get(key) ?? [];
    entries.push(result);
    groups.set(key, entries);
  }

  return [...groups.entries()]
    .map(([key, groupedResults]) => buildAggregateSummary(key, groupedResults))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function buildAggregateSummary(key: string, results: EvalArtifactResult[]): EvalAggregateSummary {
  const totalCases = results.length;
  const passedCases = results.filter((result) => result.status === 'passed').length;
  const failedCases = results.filter((result) => result.status === 'failed').length;
  const erroredCases = results.filter((result) => result.status === 'errored').length;
  const skippedCases = results.filter((result) => result.status === 'skipped').length;
  const averageScore =
    totalCases === 0
      ? 0
      : results.reduce((sum, result) => sum + result.finalScore, 0) / totalCases;
  const averageLatencyMs =
    totalCases === 0
      ? 0
      : results.reduce((sum, result) => sum + result.totalLatencyMs, 0) / totalCases;

  return {
    key,
    totalCases,
    passedCases,
    failedCases,
    erroredCases,
    skippedCases,
    averageScore,
    averageLatencyMs,
  };
}

function collectFlakyCandidates(results: EvalArtifactResult[]): EvalFlakyCandidate[] {
  const groups = new Map<string, EvalArtifactResult[]>();

  for (const result of results) {
    const entries = groups.get(result.caseId) ?? [];
    entries.push(result);
    groups.set(result.caseId, entries);
  }

  const candidates: Array<EvalFlakyCandidate | null> = [...groups.entries()].map(
    ([caseId, groupedResults]) => {
      const statuses = [...new Set(groupedResults.map((result) => result.status))];
      if (statuses.length < 2) {
        return null;
      }

      return {
        caseId,
        suite: groupedResults[0]?.suite ?? 'unknown',
        statuses,
        configLabels: [...new Set(groupedResults.map((result) => result.configLabel))].sort(),
        targets: [...new Set(groupedResults.map((result) => result.target))].sort(),
      } satisfies EvalFlakyCandidate;
    },
  );

  return candidates
    .filter((candidate): candidate is EvalFlakyCandidate => candidate !== null)
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function renderAggregateRow(summary: EvalAggregateSummary): string {
  return `| ${summary.key} | ${summary.totalCases} | ${summary.passedCases} | ${summary.failedCases} | ${summary.erroredCases} | ${summary.skippedCases} | ${summary.averageScore.toFixed(3)} | ${summary.averageLatencyMs.toFixed(1)} |`;
}
