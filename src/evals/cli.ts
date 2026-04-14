#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { evalReportSchema } from './case-schema';
import { listEvaluationAssets, runEvaluation } from './runner';
import { renderMarkdownReport } from './reporting';

type RunCommandOptions = {
  suite?: string;
  case?: string;
  target?: 'offline' | 'live_lambda';
  matrix?: string;
  dryRun?: boolean;
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
  .action(async (options: RunCommandOptions) => {
    const evalsDir = path.resolve(process.cwd(), 'evals');
    const outputDir = path.resolve(process.cwd(), '.eval-runs');
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: options.suite ?? null,
      caseId: options.case ?? null,
      target: options.target ?? null,
      matrixPath: options.matrix ?? null,
      dryRun: Boolean(options.dryRun),
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

void program.parseAsync(process.argv);
