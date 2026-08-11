import fs from 'node:fs/promises';
import path from 'node:path';

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
}): Promise<{ runDir: string; report: EvalReport }> {
  const runDir = path.join(args.outputDir, args.runId);
  await fs.mkdir(runDir, { recursive: true });

  const safeResults = args.results.map(redactEvalResultForArtifact);
  const report = buildEvalReport(args.runId, args.results);
  await fs.writeFile(
    path.join(runDir, 'results.jsonl'),
    safeResults.map((result) => JSON.stringify(result)).join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(runDir, 'report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  await fs.writeFile(path.join(runDir, 'report.md'), renderMarkdownReport(report), 'utf8');

  return { runDir, report };
}

export function buildEvalReport(runId: string, results: EvalResult[]): EvalReport {
  const safeResults = results.map(redactEvalResultForArtifact);
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
    suiteSummaries: summarizeBy(safeResults, (result) => result.suite),
    configSummaries: summarizeBy(safeResults, (result) => result.configLabel),
    targetSummaries: summarizeBy(safeResults, (result) => result.target),
    flakyCandidates: collectFlakyCandidates(safeResults),
    benchmarkSummary: buildBenchmarkSummary(safeResults),
    results: safeResults,
  });
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
    finalScore: result.finalScore,
    totalLatencyMs: result.totalLatencyMs,
    totalToolCalls: result.totalToolCalls,
    nodeTransitions: [...result.nodeTransitions],
    planDiffSummary: [...result.planDiffSummary],
    artifactPaths: { caseResult: result.artifactPaths.caseResult },
    expectationResults: result.expectationResults.map((entry) => ({ ...entry })),
    scorerResults: result.scorerResults.map((entry) => ({ ...entry })),
    ...(result.benchmarkMetrics ? { benchmarkMetrics: { ...result.benchmarkMetrics } } : {}),
    turns: result.turns.map(projectEvalTurnForArtifact),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  } satisfies Omit<EvalArtifactResult, 'benchmarkMetrics'> & {
    benchmarkMetrics?: EvalArtifactResult['benchmarkMetrics'];
  };

  return evalArtifactResultSchema.parse(safeResult);
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
    avg_cache_hit_rate: average((entry) => entry.cache_hit_rate),
    total_tokens: metrics.reduce((sum, entry) => sum + entry.total_tokens, 0),
  };
}

export function renderMarkdownReport(report: EvalReport): string {
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
    '| Suite | Case | Target | Config | Status | Score | Latency (ms) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.results.map(
      (result) =>
        `| ${result.suite} | ${result.caseId} | ${result.target} | ${result.configLabel} | ${result.status} | ${result.finalScore.toFixed(3)} | ${result.totalLatencyMs.toFixed(1)} |`,
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
