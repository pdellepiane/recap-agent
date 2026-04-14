import fs from 'node:fs/promises';
import path from 'node:path';

import {
  evalReportSchema,
  type EvalAggregateSummary,
  type EvalFlakyCandidate,
  type EvalReport,
  type EvalResult,
} from './case-schema';

export async function writeEvalArtifacts(args: {
  outputDir: string;
  runId: string;
  results: EvalResult[];
}): Promise<{ runDir: string; report: EvalReport }> {
  const runDir = path.join(args.outputDir, args.runId);
  await fs.mkdir(runDir, { recursive: true });

  const report = buildEvalReport(args.runId, args.results);
  await fs.writeFile(
    path.join(runDir, 'results.jsonl'),
    args.results.map((result) => JSON.stringify(result)).join('\n'),
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
    suiteSummaries: summarizeBy(results, (result) => result.suite),
    configSummaries: summarizeBy(results, (result) => result.configLabel),
    targetSummaries: summarizeBy(results, (result) => result.target),
    flakyCandidates: collectFlakyCandidates(results),
    results,
  });
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
  results: EvalResult[],
  keySelector: (result: EvalResult) => string,
): EvalAggregateSummary[] {
  const groups = new Map<string, EvalResult[]>();

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

function buildAggregateSummary(key: string, results: EvalResult[]): EvalAggregateSummary {
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

function collectFlakyCandidates(results: EvalResult[]): EvalFlakyCandidate[] {
  const groups = new Map<string, EvalResult[]>();

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
