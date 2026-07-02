import path from 'node:path';

import { runEvaluation } from '../src/evals/runner';
import { loadTechnicalStudyCases } from '../src/evals/technical-study';

const MISSING_LOCATION_CASE_IDS = new Set([
  'study.wedding.02',
  'study.birthday.02',
  'study.baby_shower.02',
  'study.corporate.02',
  'study.social.02',
]);

const GATE_CASE_IDS = new Set([
  ...MISSING_LOCATION_CASE_IDS,
  'study.wedding.03',
  'study.wedding.06',
  'study.birthday.09',
  'study.corporate.03',
  'study.corporate.09',
  'study.social.05',
  'study.social.07',
  'study.social.10',
]);

async function main(): Promise<void> {
  const evalsDir = path.resolve(process.cwd(), 'evals');
  const manifestPath = path.join(
    evalsDir,
    'studies',
    'technical-evaluation-50-v3.json',
  );
  const cases = (await loadTechnicalStudyCases(manifestPath))
    .filter((evalCase) => GATE_CASE_IDS.has(evalCase.id));

  if (cases.length !== GATE_CASE_IDS.size) {
    throw new Error(
      `Confirmatory gate selection expected ${GATE_CASE_IDS.size} cases; found ${cases.length}.`,
    );
  }

  const evaluation = await runEvaluation({
    evalsDir,
    outputDir: path.resolve(process.cwd(), '.eval-confirmatory-gates'),
    target: 'live_lambda',
    dryRun: false,
    caseOverrides: cases,
    configLabel: 'confirmatory-v3-gates',
  });
  const failures: string[] = [];

  for (const result of evaluation.report.results) {
    const finalTurn = result.turns.at(-1);
    if (!finalTurn) {
      failures.push(`${result.caseId}: no captured turns`);
      continue;
    }

    if (MISSING_LOCATION_CASE_IDS.has(result.caseId)) {
      const searched = result.turns.some((turn) =>
        turn.trace.tools_called.some((tool) => tool.startsWith('search_providers')),
      );
      if (searched) {
        failures.push(`${result.caseId}: searched before location was known`);
      }
      if (finalTurn.currentNode !== 'aclarar_pedir_faltante') {
        failures.push(
          `${result.caseId}: ended at ${finalTurn.currentNode}, expected aclarar_pedir_faltante`,
        );
      }
      if (!finalTurn.trace.missing_fields.includes('location')) {
        failures.push(`${result.caseId}: trace did not preserve missing location`);
      }
    }

    if (result.caseId === 'study.corporate.09') {
      if (finalTurn.plan.event_type !== 'corporativo') {
        failures.push('study.corporate.09: corporate event type was not extracted');
      }
      if (!finalTurn.plan.provider_needs.some((need) => need.category === 'Locales')) {
        failures.push('study.corporate.09: auditorium was not normalized to Locales');
      }
    }

    if (result.caseId === 'study.corporate.03') {
      const audiovisualNeed = finalTurn.plan.provider_needs.find(
        (need) => need.category === 'Fotografía y video',
      );
      if (!audiovisualNeed) {
        failures.push(
          'study.corporate.03: audiovisual need was not normalized to Fotografía y video',
        );
      }
      const displayedGeneralStore = result.turns.some((turn) =>
        turn.trace.provider_results.some(
          (provider) => provider.title === 'Shop Sin Envolturas',
        ),
      );
      if (displayedGeneralStore) {
        failures.push(
          'study.corporate.03: general store was displayed as audiovisual support',
        );
      }
    }

    if (result.turns.some((turn) =>
      turn.outputText.includes('No corresponde a esta categoría')
    )) {
      failures.push(`${result.caseId}: rendered a cross-category provider row`);
    }

    if (
      !MISSING_LOCATION_CASE_IDS.has(result.caseId) &&
      !result.hardGatePassed
    ) {
      const failedHardExpectations = result.expectationResults
        .filter((expectation) => expectation.severity === 'hard' && !expectation.passed)
        .map((expectation) => expectation.id)
        .join(', ');
      failures.push(
        `${result.caseId}: V3 hard gate failed (${failedHardExpectations || 'unknown'})`,
      );
    }
  }

  const summary = {
    runDir: evaluation.runDir,
    cases: evaluation.report.totalCases,
    passedHarnessCases: evaluation.report.passedCases,
    failedHarnessCases: evaluation.report.failedCases,
    erroredCases: evaluation.report.erroredCases,
    confirmatoryGatePassed: failures.length === 0,
    failures,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

void main();
