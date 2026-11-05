import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { evalReportSchema } from './case-schema';
import { EvalLoader } from './loader';
import { assertLiveBehaviorPrerequisites } from './live-behavior-cli';
import { assertLiveRegressionFixtureCoverage } from './runner';
import { mean, median, percentile } from './metrics';
import {
  describeMasterDeployment, expandMasterCases, frozenMasterSchema,
  masterCasesDigest, masterInputDigests, masterProtocolSchema, masterSchedule,
  resolveMasterCases, summarizeMasterResults,
} from './master-study';

async function main(): Promise<void> {
  const [mode, filename, reportPath, ...extra] = process.argv.slice(2);
  if (!filename || extra.length || !['freeze', 'analyze'].includes(mode ?? '')) {
    throw new Error('Usage: master-study-cli.ts freeze <new-frozen-file> | analyze <frozen-file> <report.json>');
  }
  if (mode === 'freeze') {
    if (reportPath) throw new Error('Freeze accepts only the destination filename.');
    const protocolPath = process.env.MASTER_STUDY_PROTOCOL ?? 'evals/studies/current-master-2026-10-27.json';
    const protocol = masterProtocolSchema.parse(JSON.parse(await fs.readFile(protocolPath, 'utf8')) as unknown);
    const catalog = await new EvalLoader(path.resolve('evals')).loadCatalog();
    const cases = resolveMasterCases(protocol, catalog.cases);
    const mandatory = new Set(catalog.suites.find(s => s.id === 'live_behavior_regression')?.caseIds);
    if (cases.some(c => !mandatory.has(c.id))) throw new Error('Master case absent from mandatory suite.');
    await assertLiveBehaviorPrerequisites(cases);
    assertLiveRegressionFixtureCoverage(cases);
    const expanded = expandMasterCases(protocol, cases);
    const frozen = frozenMasterSchema.parse({
      studyId: protocol.id, frozenAt: new Date().toISOString(), protocolPath, protocol,
      casesDigest: masterCasesDigest(cases), sourceFiles: await masterInputDigests(process.cwd(), protocolPath),
      deployment: await describeMasterDeployment(), schedule: masterSchedule(protocol),
      scriptedTurns: expanded.reduce((n, c) => n + c.inputs.length, 0),
      hardAssertions: expanded.reduce((n, c) => n + c.expectations.filter(e => e.severity === 'hard').length, 0),
    });
    await fs.mkdir(path.dirname(path.resolve(filename)), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(frozen, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ filename, scenarios: cases.length, conversations: expanded.length, turns: frozen.scriptedTurns, hardAssertions: frozen.hardAssertions, deployment: frozen.deployment })}\n`);
    return;
  }
  if (!reportPath) throw new Error('Analyze requires the retained report.json path.');
  const frozen = frozenMasterSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8')) as unknown);
  const report = evalReportSchema.parse(JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown);
  const expected = new Set(frozen.schedule.map(a => `${a.caseId}.master_r${a.repetition}`));
  const observed = new Set<string>();
  const outcomes = new Map<string, boolean[]>();
  const rows = report.results.map(result => {
    if (!expected.has(result.caseId) || observed.has(result.caseId)) throw new Error('Unplanned or duplicate master result.');
    observed.add(result.caseId);
    const baseId = result.caseId.replace(/\.master_r[123]$/u, '');
    const scenario = frozen.protocol.population.find(c => c.id === baseId);
    if (!scenario) throw new Error('Missing scenario identity.');
    const passed = result.status === 'passed' && result.hardGatePassed;
    const values = outcomes.get(baseId) ?? [];
    values.push(passed);
    outcomes.set(baseId, values);
    return { caseId: baseId, executionId: result.caseId, stratum: scenario.stratum, status: result.status, passed,
      latencyMs: result.totalLatencyMs, turns: result.turns.length,
      failedHardAssertions: result.expectationResults.filter(e => e.severity === 'hard' && !e.passed),
      error: z.object({ error: z.string().optional() }).parse(result).error ?? null };
  });
  const turns = report.results.flatMap(result => result.turns);
  const calls = turns.flatMap(turn => Object.entries(turn.trace.openai_calls ?? {}).flatMap(([stage, call]) => call ? [{ stage, call }] : []));
  const distribution = (values: number[]) => values.length === 0 ? null : ({ n: values.length, mean: mean(values), median: median(values), p95: percentile(values, 95), max: Math.max(...values) });
  const providerReferences = turns.flatMap(turn => {
    const text = turn.deliveredText ?? turn.outputText;
    const references = [...text.matchAll(/https:\/\/(?:www\.)?sinenvolturas\.com\/proveedores\/[^\s<>)\]]+/gu)].map(match => match[0].replace(/[.,;:!?]+$/u, ''));
    const candidates = new Set(turn.trace.provider_results.map(p => p.detailUrl).filter(Boolean));
    return references.map(url => ({ url, matchedTraceProvider: candidates.has(url), traceId: turn.trace.trace_id }));
  });
  const summary = {
    studyId: frozen.studyId, runId: report.runId, population: 'current-master-only',
    ...summarizeMasterResults(frozen.protocol, outcomes),
    missingExecutionIds: [...expected].filter(id => !observed.has(id)),
    strata: [...new Set(frozen.protocol.population.map(c => c.stratum))].map(stratum => ({
      stratum, scheduled: frozen.protocol.population.filter(c => c.stratum === stratum).length * frozen.protocol.repetitions, observed: rows.filter(r => r.stratum === stratum).length,
      passed: rows.filter(r => r.stratum === stratum && r.passed).length,
    })),
    diagnostics: {
      observedTurns: turns.length, scriptedTurns: frozen.scriptedTurns,
      conversationLatencyMs: distribution(rows.map(row => row.latencyMs)),
      turnLatencyMs: distribution(turns.map(turn => turn.latencyMs)),
      deliveredEmptyTurns: turns.filter(turn => !(turn.deliveredText ?? turn.outputText)).length,
      tokenTelemetryTurns: turns.filter(turn => turn.trace.token_usage.total !== null).length,
      reportedTokens: turns.reduce((n, turn) => n + (turn.trace.token_usage.total?.total_tokens ?? 0), 0),
      cachedInputTokens: turns.reduce((n, turn) => n + (turn.trace.token_usage.total?.cached_input_tokens ?? 0), 0),
      modelStages: [...new Set(calls.map(entry => entry.stage))].map(stage => {
        const entries = calls.filter(entry => entry.stage === stage);
        return { stage, reportedOperations: entries.length,
          reportedAttempts: entries.reduce((n, entry) => n + entry.call.attemptCount, 0),
          instructionBytes: distribution(entries.map(entry => entry.call.requestMetrics.instructionBytes)),
          inputBytes: distribution(entries.map(entry => entry.call.requestMetrics.inputBytes)),
          observedTransportRequests: entries.reduce((n, entry) => n + (entry.call.requestMetrics.transport?.observedRequestCount ?? 0), 0),
        };
      }),
      traceProviderRecords: turns.reduce((n, turn) => n + turn.trace.provider_results.length, 0),
      detectedDeliveredProviderLinks: providerReferences.length,
      linksMatchedToSameTurnTraceProvider: providerReferences.filter(ref => ref.matchedTraceProvider).length,
      providerReferenceLimit: 'URL spans only; unmatched trace links may have other retained seed/history evidence. No comprehensive claim entailment or actual display count.',
    },
    cost: { accounting: 'estimated-from-token-usage-and-dated-rates', harnessEstimate: report.costSummary ?? null },
    limitations: frozen.protocol.analysis,
  };
  const destination = path.dirname(path.resolve(filename));
  await fs.writeFile(path.join(destination, 'master-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  await fs.writeFile(path.join(destination, 'master-conversations.json'), `${JSON.stringify(rows, null, 2)}\n`, { flag: 'wx' });
  await fs.writeFile(path.join(destination, 'master-provider-references.json'), `${JSON.stringify(providerReferences, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
