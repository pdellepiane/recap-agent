#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';
import dotenv from 'dotenv';

import { evalReportSchema } from './case-schema';
import { listEvaluationAssets, parseResumeModeOption, runEvaluation } from './runner';
import { renderMarkdownReport } from './reporting';
import { runTechnicalStudy } from './technical-study';
import { parseCaseConcurrency, parseJudgeConcurrency } from './scheduler';

dotenv.config({ path: ['.env.development', '.env.local', '.env'], quiet: true });

type RunCommandOptions = {
  suite?: string;
  case?: string;
  target?: 'offline' | 'live_lambda';
  matrix?: string;
  dryRun?: boolean;
  caseConcurrency?: string;
  judgeConcurrency?: string;
  resumeMode?: string;
};

type ReportCommandOptions = {
  input: string;
  format?: 'markdown' | 'json';
};

const program = new Command();

program.name('recap-evals').description('Evaluation runner for recap-agent.');

program
  .command('run')
  .option('--suite <suite>', 'Suite id to execute')
  .option('--case <caseId>', 'Single case id to execute')
  .option('--target <target>', 'Target mode: offline or live_lambda')
  .option('--matrix <path>', 'Matrix file relative to evals/')
  .option('--dry-run', 'Estimate cost and list cases without executing')
  .option('--case-concurrency <n>', 'Bounded case workers 1..4 (default 4)')
  .option('--judge-concurrency <n>', 'Judge API requests in flight 1..2 (default 2)')
  .option('--resume-mode <mode>', 'full or diagnostic (default full)')
  .action(async (options: RunCommandOptions) => {
    const evalsDir = path.resolve(process.cwd(), 'evals');
    const outputDir = path.resolve(process.cwd(), '.eval-runs');
    // Strict validation: missing/invalid values fail closed, never silent.
    const caseConcurrency = options.caseConcurrency === undefined
      ? undefined
      : parseCaseConcurrency(options.caseConcurrency);
    const judgeConcurrency = options.judgeConcurrency === undefined
      ? undefined
      : parseJudgeConcurrency(options.judgeConcurrency);
    const resumeMode = options.resumeMode === undefined
      ? undefined
      : parseResumeModeOption(options.resumeMode);
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: options.suite ?? null,
      caseId: options.case ?? null,
      target: options.target ?? null,
      matrixPath: options.matrix ?? null,
      dryRun: Boolean(options.dryRun),
      ...(caseConcurrency !== undefined ? { requestedCaseConcurrency: caseConcurrency } : {}),
      ...(judgeConcurrency !== undefined ? { requestedJudgeConcurrency: judgeConcurrency } : {}),
      ...(resumeMode !== undefined ? { resumeMode } : {}),
    });

    process.stdout.write(`${JSON.stringify(
      {
        runId: result.runId,
        runDir: result.runDir,
        summary: {
          totalCases: result.report.totalCases,
          passedCases: result.report.passedCases,
          failedCases: result.report.failedCases,
          erroredCases: result.report.erroredCases,
          skippedCases: result.report.skippedCases,
          averageScore: result.report.averageScore,
        },
      },
      null,
      2,
    )}\n`);
  });

program.command('list').action(async () => {
  const evalsDir = path.resolve(process.cwd(), 'evals');
  const listing = await listEvaluationAssets(evalsDir);
  process.stdout.write(
    `${JSON.stringify(
      {
        suites: listing.suites,
        cases: listing.cases.map((currentCase) => ({
          id: currentCase.id,
          suite: currentCase.suite,
          targetModes: currentCase.targetModes,
          priority: currentCase.priority,
          status: currentCase.status,
        })),
      },
      null,
      2,
    )}\n`,
  );
});

program
  .command('report')
  .requiredOption('--input <path>', 'Path to a run directory or report.json file under .eval-runs/')
  .option('--format <format>', 'Output format: markdown or json', 'markdown')
  .action(async (options: ReportCommandOptions) => {
    const inputPath = path.resolve(process.cwd(), options.input);
    const stats = await fs.stat(inputPath);
    const reportPath = stats.isDirectory() ? path.join(inputPath, 'report.json') : inputPath;
    const parsed = JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown;
    const report = evalReportSchema.parse(parsed);

    if (options.format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    process.stdout.write(renderMarkdownReport(report));
  });

program
  .command('study')
  .option('--dry-run', 'Validate and enumerate the study without invoking the Lambda')
  .action(async (options: { dryRun?: boolean }) => {
    const studyDir = await runTechnicalStudy({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), 'analysis/technical-evaluation-study/artifacts'),
      manifestPath: path.resolve(process.cwd(), 'evals/studies/technical-evaluation-50-v4.json'),
      pricingPath: path.resolve(process.cwd(), 'evals/studies/pricing-2026-08-04.json'),
      dryRun: Boolean(options.dryRun),
    });
    process.stdout.write(`${JSON.stringify({ studyDir }, null, 2)}\n`);
  });

void program.parseAsync(process.argv);
