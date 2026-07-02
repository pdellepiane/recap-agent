import fs from 'node:fs/promises';
import path from 'node:path';

import { decisionNodes } from '../core/decision-nodes';
import { classifyLocationCompatibility } from '../core/location';
import { normalizeToProviderCategory } from '../core/provider-category';
import { providerHasEventServiceEvidence } from '../runtime/provider-sub-query-selection';
import {
  evalReportSchema,
  type EvalCase,
  type EvalReport,
  type EvalResult,
} from './case-schema';
import { assessGrounding } from './grounding';
import { mean, median, percentile, wilsonInterval } from './metrics';
import { estimateTurnCost, pricingConfigSchema } from './pricing';
import { runEvaluation } from './runner';
import {
  technicalStudyManifestSchema,
  type StudyScenario,
  type TechnicalStudyManifest,
} from './study-schema';

const REACHABLE_TRANSITIONS_VERSION = 'decision-flow-v1-2026-07-01';
const REACHABLE_TRANSITIONS = new Set([
  'contacto_inicial->deteccion_intencion',
  'deteccion_intencion->minimos_para_buscar',
  'deteccion_intencion->entrevista',
  'deteccion_intencion->elicitacion_necesidades',
  'deteccion_intencion->consultar_faq',
  'deteccion_intencion->consultar_evento_invitado',
  'minimos_para_buscar->buscar_proveedores',
  'minimos_para_buscar->aclarar_pedir_faltante',
  'entrevista->existe_plan_guardado',
  'entrevista->minimos_para_buscar',
  'entrevista->aclarar_pedir_faltante',
  'entrevista->guardar_cerrar_temporalmente',
  'entrevista->crear_lead_cerrar',
  'elicitacion_necesidades->existe_plan_guardado',
  'aclarar_pedir_faltante->minimos_para_buscar',
  'aclarar_pedir_faltante->existe_plan_guardado',
  'aclarar_pedir_faltante->usuario_elige_proveedor',
  'aclarar_pedir_faltante->seguir_refinando_guardar_plan',
  'aclarar_pedir_faltante->guardar_cerrar_temporalmente',
  'buscar_proveedores->busqueda_exitosa',
  'buscar_proveedores->informar_error_reintento',
  'busqueda_exitosa->hay_resultados',
  'hay_resultados->recomendar',
  'hay_resultados->informar_error_reintento',
  'recomendar->existe_plan_guardado',
  'existe_plan_guardado->entrevista',
  'existe_plan_guardado->aclarar_pedir_faltante',
  'existe_plan_guardado->refinar_criterios',
  'existe_plan_guardado->usuario_elige_proveedor',
  'existe_plan_guardado->seguir_refinando_guardar_plan',
  'existe_plan_guardado->consultar_faq',
  'existe_plan_guardado->consultar_evento_invitado',
  'refinar_criterios->minimos_para_buscar',
  'refinar_criterios->entrevista',
  'refinar_criterios->usuario_elige_proveedor',
  'refinar_criterios->seguir_refinando_guardar_plan',
  'usuario_elige_proveedor->anadir_a_proveedores_recomendados',
  'usuario_elige_proveedor->seguir_refinando_guardar_plan',
  'anadir_a_proveedores_recomendados->seguir_refinando_guardar_plan',
  'seguir_refinando_guardar_plan->existe_plan_guardado',
  'seguir_refinando_guardar_plan->necesidad_cubierta',
  'necesidad_cubierta->continua',
  'continua->existe_plan_guardado',
  'crear_lead_cerrar->accion_final_exitosa',
  'informar_error_reintento->reintentar',
  'reintentar->minimos_para_buscar',
  'guardar_cerrar_temporalmente->existe_plan_guardado',
  'consultar_faq->existe_plan_guardado',
  'consultar_evento_invitado->existe_plan_guardado',
]);

export type TechnicalStudyOptions = {
  evalsDir: string;
  outputDir: string;
  manifestPath: string;
  pricingPath: string;
  dryRun?: boolean;
};

export async function loadTechnicalStudyCases(
  manifestPath: string,
): Promise<EvalCase[]> {
  const manifest = await loadManifest(manifestPath);
  return manifest.scenarios.map(toEvalCase);
}

type StudyOutcome =
  | 'completed'
  | 'failed_assertion'
  | 'runtime_error'
  | 'timeout'
  | 'manual_intervention';

type StudyRow = {
  scenarioId: string;
  eventGroup: StudyScenario['eventGroup'];
  routeFamily: StudyScenario['routeFamily'];
  repetition: number;
  outcome: StudyOutcome;
  status: EvalResult['status'];
  turns: number;
  latencyMs: number;
  tokens: number;
  toolCalls: number;
  openaiCostUsd: number;
  lambdaCostUsd: number;
  totalPricedCostUsd: number;
  finalNode: string | null;
  terminalReached: boolean;
  groundedTurns: number;
  groundingRequiredTurns: number;
};

export async function runTechnicalStudy(options: TechnicalStudyOptions): Promise<string> {
  const manifest = await loadManifest(options.manifestPath);
  const pricing = pricingConfigSchema.parse(
    JSON.parse(await fs.readFile(options.pricingPath, 'utf8')) as unknown,
  );
  const cases = manifest.scenarios.map(toEvalCase);
  const studyId = `technical-study-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  const studyDir = path.join(options.outputDir, studyId);
  await fs.mkdir(studyDir, { recursive: true });
  const reports: EvalReport[] = [];

  for (let repetition = 1; repetition <= manifest.repetitions; repetition += 1) {
    const result = await runEvaluation({
      evalsDir: options.evalsDir,
      outputDir: path.join(studyDir, 'runs'),
      target: 'live_lambda',
      dryRun: options.dryRun,
      caseOverrides: cases,
      configLabel: `study-repetition-${repetition}`,
    });
    reports.push(result.report);
  }

  const rows = reports.flatMap((report, index) =>
    report.results.map((result) =>
      buildStudyRow(
        result,
        manifest.scenarios.find((scenario) => scenario.id === result.caseId),
        index + 1,
        pricing,
      ),
    ),
  );
  await writeStudyArtifacts(studyDir, manifest, pricing, reports, rows, options.dryRun ?? false);
  return studyDir;
}

export async function regenerateTechnicalStudyArtifacts(args: {
  studyDir: string;
  manifestPath: string;
  pricingPath: string;
}): Promise<void> {
  const manifest = await loadManifest(args.manifestPath);
  const pricing = pricingConfigSchema.parse(
    JSON.parse(await fs.readFile(args.pricingPath, 'utf8')) as unknown,
  );
  const reportFiles = await findFilesNamed(path.join(args.studyDir, 'runs'), 'report.json');
  const reports = await Promise.all(
    reportFiles.sort().map(async (filePath) =>
      evalReportSchema.parse(
        JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown,
      )),
  );
  const rows = reports.flatMap((report, index) =>
    report.results.map((result) =>
      buildStudyRow(
        result,
        manifest.scenarios.find((scenario) => scenario.id === result.caseId),
        index + 1,
        pricing,
      ),
    ),
  );
  await writeStudyArtifacts(args.studyDir, manifest, pricing, reports, rows, false);
}

async function loadManifest(filePath: string): Promise<TechnicalStudyManifest> {
  return technicalStudyManifestSchema.parse(
    JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown,
  );
}

async function findFilesNamed(directory: string, fileName: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findFilesNamed(entryPath, fileName);
    }
    return entry.name === fileName ? [entryPath] : [];
  }));
  return nested.flat();
}

function toEvalCase(scenario: StudyScenario): EvalCase {
  const finalTurnIndex = scenario.inputs.length - 1;
  return {
    id: scenario.id,
    suite: 'technical_evaluation_50',
    version: 1,
    description: scenario.description,
    imports: [],
    tags: ['study', scenario.eventGroup, scenario.routeFamily],
    priority: 'p1',
    status: 'active',
    targetModes: ['live_lambda'],
    variables: {},
    inputs: scenario.inputs.map((text) => ({ text })),
    expectations: [
      {
        id: 'expected-node-path',
        type: 'node_path_contains',
        requiredNodes: scenario.expectedNodes,
        severity: 'hard',
      },
      {
        id: 'terminal-node',
        type: 'node_transition',
        allowed: scenario.terminalNodes.map((to) => ({ to })),
        turnIndex: finalTurnIndex,
        severity: 'hard',
      },
      {
        id: 'persistence',
        type: 'trace_field_equals',
        path: 'plan_persisted',
        expected: scenario.expectPersistence,
        turnIndex: finalTurnIndex,
        severity: 'hard',
      },
      {
        id: 'search-state',
        type: 'trace_field_equals',
        path: 'search_ready',
        expected: scenario.expectSearch,
        turnIndex: finalTurnIndex,
        severity: 'soft',
      },
      ...(scenario.expectShortlist
        ? [{
            id: 'shortlist',
            type: 'provider_result_count' as const,
            min: 1,
            turnIndex: finalTurnIndex,
            severity: 'hard' as const,
          }]
        : []),
      ...(scenario.expectedEventType
        ? [{
            id: 'event-type',
            type: 'plan_field_equals' as const,
            path: 'event_type',
            expected: scenario.expectedEventType,
            severity: 'hard' as const,
          }]
        : []),
      ...scenario.expectedNeedCategories.map((category, index) => ({
        id: `need-${index}`,
        type: 'plan_field_subset' as const,
        path: 'provider_needs',
        expected: [{ category }],
        severity: 'hard' as const,
      })),
      {
        id: 'token-usage',
        type: 'token_usage_present',
        allTurns: true,
        requireExtraction: true,
        requireReply: true,
        severity: 'hard',
      },
      {
        id: 'turn-budget',
        type: 'budget_constraints',
        maxTurns: scenario.maxTurns,
        severity: 'soft',
      },
    ],
    scorers: [{ id: 'expectation-core', type: 'expectation_pass_rate', weight: 1 }],
    budget: { maxTurns: scenario.maxTurns },
    notes: [
      `event_group=${scenario.eventGroup}`,
      `route_family=${scenario.routeFamily}`,
      `expect_closure=${String(scenario.expectClosure)}`,
    ],
  };
}

function buildStudyRow(
  result: EvalResult,
  scenario: StudyScenario | undefined,
  repetition: number,
  pricing: ReturnType<typeof pricingConfigSchema.parse>,
): StudyRow {
  if (!scenario) {
    throw new Error(`Missing study metadata for ${result.caseId}.`);
  }
  const grounding = result.turns.map(assessGrounding);
  const costs = result.turns.map((turn) =>
    estimateTurnCost(turn, pricing, {
      extractor: 'gpt-5.4-nano',
      reply: 'gpt-5.4-mini',
    }),
  );
  const finalNode = result.turns.at(-1)?.trace.next_node ?? null;
  const terminalReached =
    finalNode !== null && scenario.terminalNodes.includes(finalNode);
  const errorMessage = result.planDiffSummary.join(' ');
  const outcome: StudyOutcome =
    result.status === 'errored'
      ? /abort|timeout|HTTP 502: Internal Server Error/iu.test(errorMessage)
        ? 'timeout'
        : 'runtime_error'
      : result.status === 'passed' && terminalReached
        ? 'completed'
        : 'failed_assertion';
  return {
    scenarioId: result.caseId,
    eventGroup: scenario.eventGroup,
    routeFamily: scenario.routeFamily,
    repetition,
    outcome,
    status: result.status,
    turns: result.turns.length,
    latencyMs: result.totalLatencyMs,
    tokens: result.benchmarkMetrics?.total_tokens ?? 0,
    toolCalls: result.totalToolCalls,
    openaiCostUsd: costs.reduce((sum, entry) => sum + entry.openaiUsd, 0),
    lambdaCostUsd: costs.reduce((sum, entry) => sum + entry.lambdaUsd, 0),
    totalPricedCostUsd: costs.reduce((sum, entry) => sum + entry.totalPricedUsd, 0),
    finalNode,
    terminalReached,
    groundedTurns: grounding.filter((entry) => entry.grounded === true).length,
    groundingRequiredTurns: grounding.filter((entry) => entry.groundingRequired).length,
  };
}

async function writeStudyArtifacts(
  studyDir: string,
  manifest: TechnicalStudyManifest,
  pricing: ReturnType<typeof pricingConfigSchema.parse>,
  reports: EvalReport[],
  rows: StudyRow[],
  dryRun: boolean,
): Promise<void> {
  const completed = rows.filter((row) => row.outcome === 'completed').length;
  const interval = wilsonInterval(completed, rows.length);
  const allResults = reports.flatMap((report) => report.results);
  const allTurns = allResults.flatMap((result) => result.turns);
  const observedTransitions = new Set(
    allTurns.flatMap((turn) => pathTransitions([
      turn.trace.previous_node,
      ...turn.trace.node_path,
      turn.trace.next_node,
    ])),
  );
  const observedNodes = new Set(
    allTurns.flatMap((turn) => [
      turn.trace.previous_node,
      turn.trace.next_node,
      ...turn.trace.node_path,
    ]),
  );
  const knownObservedTransitions = [...observedTransitions].filter((transition) =>
    REACHABLE_TRANSITIONS.has(transition),
  );
  const summary = {
    studyId: path.basename(studyDir),
    dryRun,
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    frozenAt: manifest.frozenAt,
    repetitions: manifest.repetitions,
    distinctScenarios: manifest.scenarios.length,
    executedConversations: rows.length,
    completed,
    completionRate: rows.length === 0 ? 0 : completed / rows.length,
    completionWilson95: interval,
    outcomes: countBy(rows, (row) => row.outcome),
    eventGroups: countBy(rows, (row) => row.eventGroup),
    routeFamilies: countBy(rows, (row) => row.routeFamily),
    outcomesByEventGroup: nestedCount(rows, (row) => row.eventGroup, (row) => row.outcome),
    outcomesByRouteFamily: nestedCount(rows, (row) => row.routeFamily, (row) => row.outcome),
    expectationPassRates: expectationPassRates(allResults),
    repeatability: repeatabilitySummary(rows),
    uniqueObservedRoutes: new Set(allResults.map((result) => result.nodeTransitions.join('|'))).size,
    nodeCoverage: {
      observed: observedNodes.size,
      total: decisionNodes.length,
      rate: observedNodes.size / decisionNodes.length,
      nodes: [...observedNodes].sort(),
    },
    transitionCoverage: {
      registryVersion: REACHABLE_TRANSITIONS_VERSION,
      observed: knownObservedTransitions.length,
      total: REACHABLE_TRANSITIONS.size,
      rate: knownObservedTransitions.length / REACHABLE_TRANSITIONS.size,
    },
    latencyMs: distribution(rows.map((row) => row.latencyMs)),
    nodeLatencyMs: nodeLatencySummary(allTurns),
    tokensPerConversation: distribution(rows.map((row) => row.tokens)),
    toolCallsPerConversation: distribution(rows.map((row) => row.toolCalls)),
    pricedCostUsdPerConversation: distribution(rows.map((row) => row.totalPricedCostUsd)),
    totalPricedCostUsd: rows.reduce((sum, row) => sum + row.totalPricedCostUsd, 0),
    grounding: {
      requiredTurns: rows.reduce((sum, row) => sum + row.groundingRequiredTurns, 0),
      groundedTurns: rows.reduce((sum, row) => sum + row.groundedTurns, 0),
    },
    recommendationQuality: buildRecommendationQualitySummary(allResults),
    runtimeErrors: allResults
      .filter((result) => result.status === 'errored')
      .map((result) => ({
        scenarioId: result.caseId,
        configLabel: result.configLabel,
        message: result.planDiffSummary[0] ?? 'Unknown runtime error.',
      })),
    pricing,
  };
  await fs.writeFile(path.join(studyDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(studyDir, 'conversations.csv'), renderCsv(rows));
  await fs.writeFile(path.join(studyDir, 'node-visits.csv'), renderNodeVisits(allTurns));
  await fs.writeFile(path.join(studyDir, 'routes.csv'), renderRoutes(allResults));
  await fs.writeFile(path.join(studyDir, 'grounding.csv'), renderGrounding(allResults));
  await fs.writeFile(path.join(studyDir, 'turn-telemetry.csv'), renderTurnTelemetry(allResults));
  await writeManualAuditTemplate(
    path.join(studyDir, 'manual-grounding-audit.csv'),
    renderManualAuditSample(allResults, manifest),
  );
  await fs.writeFile(
    path.join(studyDir, 'completion.svg'),
    renderBarChart(summary.outcomes, 'Technical study outcomes'),
  );
  await fs.writeFile(
    path.join(studyDir, 'event-groups.svg'),
    renderBarChart(summary.eventGroups, 'Conversations by event group'),
  );
  await fs.writeFile(
    path.join(studyDir, 'route-families.svg'),
    renderBarChart(summary.routeFamilies, 'Conversations by route family'),
  );
  await fs.writeFile(
    path.join(studyDir, 'node-visits.svg'),
    renderBarChart(
      countBy(allTurns.flatMap((turn) => turn.trace.node_path), (node) => node),
      'Workflow node visits',
    ),
  );
  await fs.writeFile(
    path.join(studyDir, 'tool-breakdown.svg'),
    renderBarChart(
      countBy(allTurns.flatMap((turn) => turn.trace.tools_called), (tool) => tool),
      'Recorded tool calls',
    ),
  );
  const totalInputTokens = allTurns.reduce(
    (sum, turn) => sum + (turn.trace.token_usage.total?.input_tokens ?? 0),
    0,
  );
  const cachedInputTokens = allTurns.reduce(
    (sum, turn) => sum + (turn.trace.token_usage.total?.cached_input_tokens ?? 0),
    0,
  );
  await fs.writeFile(
    path.join(studyDir, 'cache-use.svg'),
    renderBarChart({
      cached_input_tokens: cachedInputTokens,
      uncached_input_tokens: totalInputTokens - cachedInputTokens,
    }, 'Prompt cache use'),
  );
  await fs.writeFile(
    path.join(studyDir, 'grounding.svg'),
    renderBarChart({
      grounded_required_turns: rows.reduce((sum, row) => sum + row.groundedTurns, 0),
      ungrounded_required_turns: rows.reduce(
        (sum, row) => sum + row.groundingRequiredTurns - row.groundedTurns,
        0,
      ),
      grounding_not_required: allTurns.length - rows.reduce(
        (sum, row) => sum + row.groundingRequiredTurns,
        0,
      ),
    }, 'Deterministic grounding classification'),
  );
  await fs.writeFile(
    path.join(studyDir, 'conversation-latency.svg'),
    renderHistogram(rows.map((row) => row.latencyMs), 'Conversation latency (ms)'),
  );
  await fs.writeFile(
    path.join(studyDir, 'tokens.svg'),
    renderHistogram(rows.map((row) => row.tokens), 'Tokens per conversation'),
  );
  await fs.writeFile(
    path.join(studyDir, 'tool-calls.svg'),
    renderHistogram(rows.map((row) => row.toolCalls), 'Tool calls per conversation'),
  );
  await fs.writeFile(
    path.join(studyDir, 'cost.svg'),
    renderHistogram(rows.map((row) => row.totalPricedCostUsd), 'Priced cost per conversation (USD)'),
  );
  await fs.writeFile(path.join(studyDir, 'findings.md'), renderFindings(summary));
  await fs.writeFile(
    path.join(studyDir, 'raw-artifact-index.json'),
    JSON.stringify(reports.map((report) => ({ runId: report.runId, cases: report.totalCases })), null, 2),
  );
}

function buildRecommendationQualitySummary(results: EvalResult[]) {
  let displayedProviders = 0;
  let locationApplicable = 0;
  let locationSatisfied = 0;
  let locationUnknown = 0;
  let locationMismatch = 0;
  let categoryApplicable = 0;
  let categorySatisfied = 0;
  let budgetApplicable = 0;
  let budgetCompatible = 0;
  let eventServiceApplicable = 0;
  let eventServiceSupported = 0;
  let needsObserved = 0;
  let needsWithRecommendations = 0;
  const providerExposure = new Map<number, number>();
  const shortlistSizes: number[] = [];

  for (const result of results) {
    const finalPlan = result.turns.at(-1)?.plan;
    if (finalPlan) {
      needsObserved += finalPlan.provider_needs.length;
      needsWithRecommendations += finalPlan.provider_needs.filter(
        (need) => need.recommended_provider_ids.length > 0,
      ).length;
    }
    for (const turn of result.turns) {
      const providers = turn.trace.provider_results;
      if (providers.length > 0) {
        shortlistSizes.push(providers.length);
      }
      for (const provider of providers) {
        displayedProviders += 1;
        providerExposure.set(provider.id, (providerExposure.get(provider.id) ?? 0) + 1);
        if (turn.plan.location) {
          locationApplicable += 1;
          const compatibility = classifyLocationCompatibility(
            turn.plan.location,
            provider.location,
          );
          if (compatibility === 'exact' || compatibility === 'compatible') {
            locationSatisfied += 1;
          } else if (compatibility === 'unknown') {
            locationUnknown += 1;
          } else {
            locationMismatch += 1;
          }
        }
        const owningNeed = turn.plan.provider_needs.find((need) =>
          need.recommended_provider_ids.includes(provider.id),
        );
        const expectedCategory = normalizeToProviderCategory(
          owningNeed?.category ??
            turn.plan.active_need_category ??
            turn.plan.vendor_category,
        );
        if (expectedCategory) {
          categoryApplicable += 1;
          if (normalizeToProviderCategory(provider.category) === expectedCategory) {
            categorySatisfied += 1;
          }
        }
        if (turn.plan.budget_signal) {
          budgetApplicable += 1;
          if (!(provider.fitTags ?? []).includes('budget_risk')) {
            budgetCompatible += 1;
          }
        }
        if (normalizeToProviderCategory(provider.category) === 'Hogar y deco') {
          eventServiceApplicable += 1;
          if (providerHasEventServiceEvidence(provider)) {
            eventServiceSupported += 1;
          }
        }
      }
    }
  }

  const exposureCounts = [...providerExposure.values()];
  const exposureTotal = exposureCounts.reduce((sum, count) => sum + count, 0);
  const exposureHhi = exposureTotal === 0
    ? 0
    : exposureCounts.reduce((sum, count) => sum + (count / exposureTotal) ** 2, 0);
  const topExposure = exposureCounts.length === 0 ? 0 : Math.max(...exposureCounts);

  return {
    displayedProviders,
    uniqueProviders: providerExposure.size,
    meanShortlistSize: mean(shortlistSizes),
    locationConstraint: {
      applicable: locationApplicable,
      satisfied: locationSatisfied,
      unknown: locationUnknown,
      mismatched: locationMismatch,
      strictSatisfactionRate:
        locationApplicable === 0 ? 0 : locationSatisfied / locationApplicable,
      mismatchRate: locationApplicable === 0 ? 0 : locationMismatch / locationApplicable,
    },
    categoryConstraint: {
      applicable: categoryApplicable,
      satisfied: categorySatisfied,
      satisfactionRate:
        categoryApplicable === 0 ? 0 : categorySatisfied / categoryApplicable,
    },
    budgetCompatibility: {
      applicable: budgetApplicable,
      compatible: budgetCompatible,
      rate: budgetApplicable === 0 ? 0 : budgetCompatible / budgetApplicable,
    },
    eventServiceApplicability: {
      applicable: eventServiceApplicable,
      supported: eventServiceSupported,
      rate:
        eventServiceApplicable === 0
          ? 0
          : eventServiceSupported / eventServiceApplicable,
    },
    needRecommendationCoverage: {
      needsObserved,
      needsWithRecommendations,
      rate: needsObserved === 0 ? 0 : needsWithRecommendations / needsObserved,
    },
    exposure: {
      hhi: exposureHhi,
      topProviderShare: exposureTotal === 0 ? 0 : topExposure / exposureTotal,
    },
  };
}

function distribution(values: number[]) {
  return {
    mean: mean(values),
    median: median(values),
    p95: percentile(values, 95),
    min: values.length === 0 ? 0 : Math.min(...values),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

function countBy<T>(values: readonly T[], selector: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = selector(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function nestedCount<T>(
  values: readonly T[],
  outer: (value: T) => string,
  inner: (value: T) => string,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const value of values) {
    const outerKey = outer(value);
    const innerKey = inner(value);
    const bucket = result[outerKey] ?? {};
    bucket[innerKey] = (bucket[innerKey] ?? 0) + 1;
    result[outerKey] = bucket;
  }
  return result;
}

function pathTransitions(nodes: string[]): string[] {
  const normalized = nodes.filter((node, index) => index === 0 || node !== nodes[index - 1]);
  return normalized.slice(1).map((node, index) => `${normalized[index]}->${node}`);
}

function expectationPassRates(results: EvalResult[]): Record<string, {
  passed: number;
  total: number;
  rate: number;
}> {
  const buckets = new Map<string, { passed: number; total: number }>();
  for (const expectation of results.flatMap((result) => result.expectationResults)) {
    const bucket = buckets.get(expectation.id) ?? { passed: 0, total: 0 };
    bucket.total += 1;
    bucket.passed += expectation.passed ? 1 : 0;
    buckets.set(expectation.id, bucket);
  }
  return Object.fromEntries(
    [...buckets.entries()].map(([id, bucket]) => [
      id,
      { ...bucket, rate: bucket.total === 0 ? 0 : bucket.passed / bucket.total },
    ]),
  );
}

function repeatabilitySummary(rows: StudyRow[]) {
  const byScenario = new Map<string, StudyRow[]>();
  for (const row of rows) {
    byScenario.set(row.scenarioId, [...(byScenario.get(row.scenarioId) ?? []), row]);
  }
  const stableCompleted: string[] = [];
  const stableFailed: string[] = [];
  const flaky: string[] = [];
  for (const [scenarioId, entries] of byScenario) {
    const outcomes = new Set(entries.map((entry) => entry.outcome));
    if (outcomes.size > 1) {
      flaky.push(scenarioId);
    } else if (outcomes.has('completed')) {
      stableCompleted.push(scenarioId);
    } else {
      stableFailed.push(scenarioId);
    }
  }
  return {
    stableCompletedCount: stableCompleted.length,
    stableFailedCount: stableFailed.length,
    flakyCount: flaky.length,
    flakyRate: byScenario.size === 0 ? 0 : flaky.length / byScenario.size,
    stableCompleted,
    stableFailed,
    flaky,
  };
}

function nodeLatencySummary(turns: EvalResult['turns']): Record<string, {
  visits: number;
  meanMs: number;
  p95Ms: number;
}> {
  const buckets = new Map<string, number[]>();
  for (const turn of turns) {
    const values = buckets.get(turn.trace.next_node) ?? [];
    values.push(turn.latencyMs);
    buckets.set(turn.trace.next_node, values);
  }
  return Object.fromEntries(
    [...buckets.entries()].map(([node, values]) => [
      node,
      { visits: values.length, meanMs: mean(values), p95Ms: percentile(values, 95) },
    ]),
  );
}

function renderCsv(rows: StudyRow[]): string {
  const headers = Object.keys(rows[0] ?? {}) as Array<keyof StudyRow>;
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n') + '\n';
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderNodeVisits(turns: EvalResult['turns']): string {
  const counts = countBy(
    turns.flatMap((turn) => turn.trace.node_path),
    (node) => node,
  );
  return `node,visits\n${Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([node, visits]) => `${node},${visits}`)
    .join('\n')}\n`;
}

function renderRoutes(results: EvalResult[]): string {
  const counts = countBy(results, (result) => result.nodeTransitions.join('|'));
  return `route,count\n${Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([route, count]) => `${csvCell(route)},${count}`)
    .join('\n')}\n`;
}

function renderGrounding(results: EvalResult[]): string {
  const rows = results.flatMap((result) =>
    result.turns.map((turn) => ({
      scenario: result.caseId,
      turn: turn.turnIndex,
      ...assessGrounding(turn),
    })),
  );
  const headers = [
    'scenario',
    'turn',
    'turnClass',
    'groundingRequired',
    'grounded',
    'providerCount',
    'verifiedProviderCount',
    'unsupportedProviderIds',
    'attributeMismatches',
  ] as const;
  return `${headers.join(',')}\n${rows.map((row) =>
    headers.map((header) => csvCell(row[header])).join(',')).join('\n')}\n`;
}

type TurnStudyTelemetry = {
  scenario: string;
  turn: number;
  extractorModel: string;
  replyModel: string;
  extractionLlmCalls: number;
  replyLlmCalls: number;
  toolCalls: number;
  tools: string;
  runtimeLatencyMs: number;
  extractionLatencyMs: number;
  providerSearchLatencyMs: number;
  composeLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  persisted: boolean;
  errors: string;
};

function renderTurnTelemetry(results: EvalResult[]): string {
  const rows: TurnStudyTelemetry[] = results.flatMap((result) =>
    result.turns.map((turn) => {
      const total = turn.trace.token_usage.total;
      const inputTokens = total?.input_tokens ?? 0;
      const cachedInputTokens = total?.cached_input_tokens ?? 0;
      return {
        scenario: result.caseId,
        turn: turn.turnIndex,
        extractorModel: 'gpt-5.4-nano',
        replyModel: 'gpt-5.4-mini',
        extractionLlmCalls: turn.trace.token_usage.extraction ? 1 : 0,
        replyLlmCalls: turn.trace.token_usage.reply ? 1 : 0,
        toolCalls: turn.trace.tools_called.length,
        tools: turn.trace.tools_called.join('|'),
        runtimeLatencyMs: turn.trace.timing_ms.total,
        extractionLatencyMs: turn.trace.timing_ms.extraction,
        providerSearchLatencyMs:
          turn.trace.timing_ms.provider_search + turn.trace.timing_ms.provider_enrichment,
        composeLatencyMs: turn.trace.timing_ms.compose_reply,
        inputTokens,
        outputTokens: total?.output_tokens ?? 0,
        cachedInputTokens,
        totalTokens: total?.total_tokens ?? 0,
        cacheHitRate: inputTokens === 0 ? 0 : cachedInputTokens / inputTokens,
        persisted: turn.trace.plan_persisted,
        errors: '',
      };
    }),
  );
  const headers = Object.keys(rows[0] ?? {}) as Array<keyof TurnStudyTelemetry>;
  return `${headers.join(',')}\n${rows.map((row) =>
    headers.map((header) => csvCell(row[header])).join(',')).join('\n')}\n`;
}

function renderManualAuditSample(
  results: EvalResult[],
  manifest: TechnicalStudyManifest,
): string {
  const eligible = results.flatMap((result) =>
    result.turns
      .filter((turn) => assessGrounding(turn).turnClass === 'recommendation')
      .map((turn) => ({
        scenario: result.caseId,
        eventGroup:
          manifest.scenarios.find((scenario) => scenario.id === result.caseId)?.eventGroup ??
          'unknown',
        turn: turn.turnIndex,
        responseHash: turn.outputText.length === 0
          ? 'empty'
          : `${turn.outputText.length}-${turn.trace.trace_id}`,
      })),
  );
  const selected = [...new Map(
    eligible.map((entry) => [`${entry.eventGroup}:${entry.scenario}`, entry]),
  ).values()]
    .sort((left, right) => `${left.eventGroup}:${left.scenario}`.localeCompare(
      `${right.eventGroup}:${right.scenario}`,
    ))
    .filter((_entry, index) => index % 2 === 0)
    .slice(0, 20);
  return [
    'scenario,event_group,turn,response_reference,provider_existence,attribute_faithfulness,rationale_support,hard_constraint_consistency,auditor,notes',
    ...selected.map((entry) =>
      `${entry.scenario},${entry.eventGroup},${entry.turn},${entry.responseHash},pending,pending,pending,pending,,`),
  ].join('\n') + '\n';
}

async function writeManualAuditTemplate(filePath: string, template: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (!existing.includes(',pending,')) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  await fs.writeFile(filePath, template);
}

function renderBarChart(
  counts: Record<string, number>,
  title = 'Technical study outcomes',
): string {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map((entry) => entry[1]));
  const bars = entries.map(([label, value], index) => {
    const width = (value / max) * 460;
    const y = 45 + index * 42;
    return `<text x="10" y="${y + 15}" font-size="12">${label}</text><rect x="280" y="${y}" width="${width}" height="22" fill="#356859"/><text x="${290 + width}" y="${y + 16}" font-size="12">${value}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="${80 + entries.length * 42}" role="img" aria-label="${title}"><rect width="100%" height="100%" fill="white"/><text x="10" y="24" font-size="18" font-family="sans-serif">${title}</text><g font-family="sans-serif">${bars}</g></svg>\n`;
}

function renderHistogram(values: number[], title: string): string {
  if (values.length === 0) {
    return renderBarChart({ no_data: 0 });
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const bucketCount = 8;
  const width = maximum === minimum ? 1 : (maximum - minimum) / bucketCount;
  const buckets: Record<string, number> = {};
  for (let index = 0; index < bucketCount; index += 1) {
    const lower = minimum + index * width;
    const upper = index === bucketCount - 1 ? maximum : lower + width;
    buckets[`${lower.toFixed(3)}-${upper.toFixed(3)}`] = 0;
  }
  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.floor((value - minimum) / width));
    const key = Object.keys(buckets)[index];
    if (key) {
      buckets[key] = (buckets[key] ?? 0) + 1;
    }
  }
  return renderBarChart(buckets, title);
}

function renderFindings(summary: Record<string, unknown>): string {
  return `# Technical Evaluation Findings\n\n` +
    `Generated from immutable evaluation artifacts. This dossier reports technical behavior only; it does not include user testing or baseline comparison.\n\n` +
    `## Reproducibility\n\n- Manifest: technical-evaluation-50-v1\n- Transition registry: ${REACHABLE_TRANSITIONS_VERSION}\n- Raw summary: [summary.json](summary.json)\n- Conversation table: [conversations.csv](conversations.csv)\n- Grounding audit population: [grounding.csv](grounding.csv)\n\n` +
    `## Findings\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\n` +
    `## Limitations\n\n- Results describe the development deployment and marketplace snapshot at execution time.\n- Internal marketplace API calls are counted but not assigned an invented monetary price.\n- Deterministic grounding verifies structured provenance and attributes; free-text recommendation rationales still require the separate manual audit rubric.\n- No claims about user satisfaction, adoption, or superiority over a baseline are supported by this study.\n`;
}
