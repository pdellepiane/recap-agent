import { z } from 'zod';

import { planIntentValues, planSchema } from '../core/plan';
import type { PlanSnapshot } from '../core/plan';
import { providerCategorySchema } from '../core/provider-category';

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const scalarVariableSchema = z.union([z.string(), z.number(), z.boolean()]);

export const evalTargetModeSchema = z.enum(['offline', 'live_lambda']);
export type EvalTargetMode = z.infer<typeof evalTargetModeSchema>;

const providerSummarySchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string().nullish(),
  category: z.string().nullish(),
  location: z.string().nullish(),
  priceLevel: z.string().nullish(),
  rating: z.string().nullish(),
  reason: z.string().nullish(),
  detailUrl: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  minPrice: z.string().nullish(),
  maxPrice: z.string().nullish(),
  promoBadge: z.string().nullish(),
  promoSummary: z.string().nullish(),
  descriptionSnippet: z.string().nullish(),
  serviceHighlights: z.array(z.string()).default([]),
  termsHighlights: z.array(z.string()).default([]),
});

const providerDetailSchema = providerSummarySchema.extend({
  description: z.string().nullish(),
  eventTypes: z.array(z.string()).default([]),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const extractionResultSchema = z.object({
  intent: z.enum(planIntentValues).nullable(),
  intentConfidence: z.number().min(0).max(1).nullable(),
  eventType: z.string().nullable(),
  vendorCategory: providerCategorySchema.nullable(),
  vendorCategories: z.array(providerCategorySchema),
  activeNeedCategory: providerCategorySchema.nullable(),
  location: z.string().nullable(),
  budgetSignal: z.string().nullable(),
  guestRange: z.enum(['1-20', '21-50', '51-100', '101-200', '201+', 'unknown']).nullable(),
  preferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  conversationSummary: z.string(),
  selectedProviderHint: z.string().nullable(),
  pauseRequested: z.boolean(),
});

const toolOutputTraceSchema = z.object({
  tool: z.string(),
  output: z.string(),
});

const toolInputTraceSchema = z.object({
  tool: z.string(),
  input: z.string(),
});

const turnTraceSchema = z.object({
  trace_id: z.string(),
  conversation_id: z.string().nullable(),
  plan_id: z.string(),
  previous_node: z.string(),
  next_node: z.string(),
  node_path: z.array(z.string()),
  intent: z.string().nullable(),
  missing_fields: z.array(z.string()),
  search_ready: z.boolean(),
  prompt_bundle_id: z.string(),
  prompt_file_paths: z.array(z.string()),
  tools_considered: z.array(z.string()),
  tools_called: z.array(z.string()),
  tool_inputs: z.array(toolInputTraceSchema).default([]),
  tool_outputs: z.array(toolOutputTraceSchema),
  provider_results: z.array(providerSummarySchema),
  recommendation_funnel: z.object({
    available_candidates: z.number().int().nonnegative(),
    context_candidates: z.number().int().nonnegative(),
    context_candidate_ids: z.array(z.number().int().nonnegative()),
    presentation_limit: z.number().int().positive(),
  }).default({
    available_candidates: 0,
    context_candidates: 0,
    context_candidate_ids: [],
    presentation_limit: 5,
  }),
  plan_persisted: z.boolean(),
  plan_persist_reason: z.string().nullable(),
  timing_ms: z.object({
    total: z.number().nonnegative(),
    load_plan: z.number().nonnegative(),
    prepare_working_plan: z.number().nonnegative(),
    extraction: z.number().nonnegative(),
    apply_extraction: z.number().nonnegative(),
    compute_sufficiency: z.number().nonnegative(),
    provider_search: z.number().nonnegative(),
    provider_enrichment: z.number().nonnegative(),
    prompt_bundle_load: z.number().nonnegative(),
    compose_reply: z.number().nonnegative(),
    save_plan: z.number().nonnegative(),
  }),
  token_usage: z.object({
    extraction: z.object({
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      cached_input_tokens: z.number().nonnegative().optional(),
    }).nullable(),
    reply: z.object({
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      cached_input_tokens: z.number().nonnegative().optional(),
    }).nullable(),
    total: z.object({
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      cached_input_tokens: z.number().nonnegative().optional(),
    }).nullable(),
  }),
});

const cliPerfSummarySchema = z.object({
  trace_id: z.string(),
  conversation_id: z.string().nullable(),
  runtime_latency_ms: z.number().nonnegative(),
  extraction_latency_ms: z.number().nonnegative(),
  compose_latency_ms: z.number().nonnegative(),
  tools_called_count: z.number().int().nonnegative(),
  provider_results_count: z.number().int().nonnegative(),
  recommendation_context_candidates: z.number().int().nonnegative().default(0),
  recommendation_presentation_limit: z.number().int().positive().default(5),
  total_tokens: z.number().nonnegative().nullable(),
  cached_input_tokens: z.number().nonnegative().nullable(),
  cache_hit_rate: z.number().min(0).max(1).nullable(),
  extraction_to_compose_ratio: z.number().nonnegative().nullable(),
  captured_at: z.string(),
  persisted: z.boolean().default(true),
  storage_target: z.string().nullable().default(null),
});

const turnInputSchema = z.object({
  text: z.string().min(1),
  channel: z.string().optional(),
  externalUserId: z.string().optional(),
  receivedAt: z.string().optional(),
});

const turnOutcomeSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.union([
    z.object({
      value: inner,
    }),
    z.object({
      error: z.string().min(1),
    }),
  ]);

const marketplaceCategorySchema = z.object({
  id: z.number().nullable(),
  name: z.string(),
  slug: z.string().nullable(),
  color: z.string().nullable(),
  eventTypes: z.array(z.string()).default([]),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const marketplaceLocationSchema = z.object({
  cityId: z.number().nullable(),
  countryId: z.number().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const providerReviewSchema = z.object({
  id: z.number().nullable(),
  name: z.string().nullable(),
  rating: z.number().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string().nullable(),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const providerGatewayFixtureSchema = z.object({
  listCategories: z.array(marketplaceCategorySchema).optional(),
  categoriesBySlug: z.record(z.string(), marketplaceCategorySchema.nullable()).optional(),
  listLocations: z.array(marketplaceLocationSchema).optional(),
  searchProvidersByTurn: z.array(turnOutcomeSchema(z.object({ providers: z.array(providerSummarySchema) }))).optional(),
  searchProvidersByKeyword: turnOutcomeSchema(z.object({ providers: z.array(providerSummarySchema) })).optional(),
  searchProvidersByCategoryLocation: turnOutcomeSchema(
    z.object({ providers: z.array(providerSummarySchema) }),
  ).optional(),
  relevantProviders: z.array(providerSummarySchema).optional(),
  providerDetailsById: z.record(z.string(), turnOutcomeSchema(providerDetailSchema.nullable())).optional(),
  relatedProvidersById: z.record(z.string(), z.array(providerSummarySchema)).optional(),
  reviewsById: z.record(z.string(), z.array(providerReviewSchema)).optional(),
});

const offlineFixtureSchema = z.object({
  extractionsByTurn: z.array(extractionResultSchema).optional(),
  repliesByTurn: z.array(z.string()).optional(),
  providerGateway: providerGatewayFixtureSchema.optional(),
});

const planFieldExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('plan_field_equals'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const planFieldSubsetExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('plan_field_subset'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const nodeTransitionExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('node_transition'),
  from: z.string().optional(),
  to: z.string().optional(),
  allowed: z.array(z.object({ from: z.string().optional(), to: z.string().optional() })).optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const nodePathContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('node_path_contains'),
  requiredNodes: z.array(z.string()).min(1),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const providerMatchSchema = z.object({
  id: z.number().optional(),
  slug: z.string().optional(),
  category: z.string().optional(),
  titleContains: z.string().optional(),
  detailUrlContains: z.string().optional(),
});

const providerResultsContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('provider_results_contains'),
  providers: z.array(providerMatchSchema).min(1),
  turnIndex: z.number().int().nonnegative().optional(),
  matchMode: z.enum(['all', 'any']).default('all'),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const providerResultCountExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('provider_result_count'),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const traceFieldEqualsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trace_field_equals'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const traceFieldSubsetExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trace_field_subset'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const traceFieldNumberExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trace_field_number'),
  path: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const toolUsageExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('tool_usage'),
  mustCall: z.array(z.string()).default([]),
  mustNotCall: z.array(z.string()).default([]),
  maxTotalCalls: z.number().int().positive().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const textContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('text_contains'),
  allOf: z.array(z.string()).default([]),
  anyOf: z.array(z.string()).default([]),
  regex: z.array(z.string()).default([]),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const textNotContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('text_not_contains'),
  phrases: z.array(z.string()).min(1),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const textSemanticExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('text_semantic'),
  rubric: z.string().min(1),
  minScore: z.number().min(0).max(1).default(0.7),
  turnIndex: z.number().int().nonnegative().optional(),
  judgeModel: z.string().optional(),
  severity: z.enum(['hard', 'soft']).default('soft'),
});

const trajectoryInvariantExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trajectory_invariants'),
  noRepeatedQuestion: z.boolean().optional(),
  noCategoryReask: z.boolean().optional(),
  preservePriorSelection: z.boolean().optional(),
  noResolvedAmbiguityReopened: z.boolean().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const budgetConstraintExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('budget_constraints'),
  maxTurns: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().nonnegative().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  severity: z.enum(['hard', 'soft']).default('soft'),
});

export const expectationSchema = z.discriminatedUnion('type', [
  nodeTransitionExpectationSchema,
  nodePathContainsExpectationSchema,
  planFieldExpectationSchema,
  planFieldSubsetExpectationSchema,
  providerResultsContainsExpectationSchema,
  providerResultCountExpectationSchema,
  traceFieldEqualsExpectationSchema,
  traceFieldSubsetExpectationSchema,
  traceFieldNumberExpectationSchema,
  toolUsageExpectationSchema,
  textContainsExpectationSchema,
  textNotContainsExpectationSchema,
  textSemanticExpectationSchema,
  trajectoryInvariantExpectationSchema,
  budgetConstraintExpectationSchema,
]);
export type EvalExpectation = z.infer<typeof expectationSchema>;

const scorerSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('expectation_pass_rate'),
    expectationIds: z.array(z.string()).optional(),
    weight: z.number().positive().default(1),
  }),
  z.object({
    id: z.string(),
    type: z.literal('budget_efficiency'),
    weight: z.number().positive().default(0.5),
    targetLatencyMs: z.number().int().positive().optional(),
    targetToolCalls: z.number().int().nonnegative().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('text_semantic'),
    weight: z.number().positive().default(0.5),
    rubric: z.string().min(1),
    turnIndex: z.number().int().nonnegative().optional(),
    judgeModel: z.string().optional(),
  }),
]);
export type EvalScorerConfig = z.infer<typeof scorerSchema>;

const budgetSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().nonnegative().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  estimatedPromptTokensPerTurn: z.number().int().positive().optional(),
  estimatedCompletionTokensPerTurn: z.number().int().positive().optional(),
});

export const evalCaseSchema = z.object({
  id: z.string().min(1),
  suite: z.string().min(1),
  version: z.union([z.string().min(1), z.number().int().positive()]),
  description: z.string().min(1),
  template: z.string().optional(),
  imports: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string()).default([]),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']).default('p2'),
  status: z.enum(['active', 'draft', 'skip']).default('active'),
  targetModes: z.array(evalTargetModeSchema).min(1),
  variables: z.record(z.string(), scalarVariableSchema).default({}),
  inputs: z.array(turnInputSchema).min(1),
  seedPlan: planSchema.partial().optional(),
  fixtures: z.object({
    offline: offlineFixtureSchema.optional(),
  }).optional(),
  configOverrides: z.object({
    replyModel: z.string().optional(),
    extractorModel: z.string().optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
    promptBundleLabel: z.string().optional(),
    env: z.record(z.string(), scalarVariableSchema).default({}),
    liveLambda: z.object({
      functionUrl: z.string().url().optional(),
      channel: z.string().optional(),
    }).optional(),
  }).optional(),
  expectations: z.array(expectationSchema).default([]),
  scorers: z.array(scorerSchema).default([]),
  budget: budgetSchema.optional(),
  notes: z.array(z.string()).default([]),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalSuiteManifestSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  caseIds: z.array(z.string()).min(1),
  tags: z.array(z.string()).default([]),
});
export type EvalSuiteManifest = z.infer<typeof evalSuiteManifestSchema>;

export const evalRunConfigSchema = z.object({
  run_id: z.string().min(1).optional(),
  label: z.string().min(1),
  target: evalTargetModeSchema,
  replyModel: z.string().optional(),
  extractorModel: z.string().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  promptBundleLabel: z.string().optional(),
  notes: z.array(z.string()).default([]),
  environmentOverrides: z.record(z.string(), scalarVariableSchema).default({}),
  liveLambda: z.object({
    functionUrl: z.string().url().optional(),
    channel: z.string().default('terminal_whatsapp_eval'),
  }).optional(),
});
export type EvalRunConfig = z.infer<typeof evalRunConfigSchema>;

export const evalMatrixSchema = z.object({
  configs: z.array(evalRunConfigSchema).min(1),
});
export type EvalMatrix = z.infer<typeof evalMatrixSchema>;

export const lambdaTurnResponseSchema = z.object({
  message: z.string(),
  conversation_id: z.string().nullable(),
  plan_id: z.string(),
  current_node: z.string(),
  trace: turnTraceSchema,
  plan: planSchema.optional(),
  perf: cliPerfSummarySchema.nullable().optional(),
});

export const evalTurnResultSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  input: turnInputSchema,
  outputText: z.string(),
  currentNode: z.string(),
  trace: turnTraceSchema,
  perf: cliPerfSummarySchema.nullable().optional(),
  plan: planSchema,
  latencyMs: z.number().nonnegative(),
  rawTargetResponse: z.record(z.string(), jsonValueSchema).optional(),
});
export type EvalTurnResult = z.infer<typeof evalTurnResultSchema>;

export const expectationResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  passed: z.boolean(),
  severity: z.enum(['hard', 'soft']),
  score: z.number().min(0).max(1),
  message: z.string(),
});
export type ExpectationResult = z.infer<typeof expectationResultSchema>;

export const scorerResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  score: z.number().min(0).max(1),
  weight: z.number().positive(),
  skipped: z.boolean().default(false),
  message: z.string(),
});
export type ScorerResult = z.infer<typeof scorerResultSchema>;

const benchmarkMetricsSchema = z.object({
  turn_count: z.number().int().nonnegative(),
  avg_latency_ms: z.number().nonnegative(),
  p95_latency_ms: z.number().nonnegative(),
  tool_calls_total: z.number().int().nonnegative(),
  unique_tools_called: z.number().int().nonnegative(),
  tool_call_rate_per_turn: z.number().nonnegative(),
  tool_precision: z.number().min(0).max(1),
  tool_recall: z.number().min(0).max(1),
  tool_f1: z.number().min(0).max(1),
  branch_coverage: z.number().min(0).max(1),
  state_expectation_pass_rate: z.number().min(0).max(1),
  trajectory_expectation_pass_rate: z.number().min(0).max(1),
  plan_persistence_rate: z.number().min(0).max(1),
  total_tokens: z.number().int().nonnegative(),
  cache_hit_rate: z.number().min(0).max(1),
});
export type BenchmarkMetrics = z.infer<typeof benchmarkMetricsSchema>;

export const evalResultSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  suite: z.string(),
  target: evalTargetModeSchema,
  configLabel: z.string(),
  status: z.enum(['passed', 'failed', 'errored', 'skipped']),
  hardGatePassed: z.boolean(),
  finalScore: z.number().min(0).max(1),
  totalLatencyMs: z.number().nonnegative(),
  totalToolCalls: z.number().int().nonnegative(),
  nodeTransitions: z.array(z.string()),
  planDiffSummary: z.array(z.string()),
  artifactPaths: z.object({
    caseResult: z.string(),
  }),
  expectationResults: z.array(expectationResultSchema),
  scorerResults: z.array(scorerResultSchema),
  benchmarkMetrics: benchmarkMetricsSchema.optional(),
  turns: z.array(evalTurnResultSchema),
  startedAt: z.string(),
  completedAt: z.string(),
});
export type EvalResult = z.infer<typeof evalResultSchema>;

const evalAggregateSummarySchema = z.object({
  key: z.string(),
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  erroredCases: z.number().int().nonnegative(),
  skippedCases: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(1),
  averageLatencyMs: z.number().nonnegative(),
});
export type EvalAggregateSummary = z.infer<typeof evalAggregateSummarySchema>;

const flakyCandidateSchema = z.object({
  caseId: z.string(),
  suite: z.string(),
  statuses: z.array(z.string()),
  configLabels: z.array(z.string()),
  targets: z.array(evalTargetModeSchema),
});
export type EvalFlakyCandidate = z.infer<typeof flakyCandidateSchema>;

const benchmarkSummarySchema = z.object({
  avg_tool_precision: z.number().min(0).max(1),
  avg_tool_recall: z.number().min(0).max(1),
  avg_tool_f1: z.number().min(0).max(1),
  avg_branch_coverage: z.number().min(0).max(1),
  avg_state_expectation_pass_rate: z.number().min(0).max(1),
  avg_trajectory_expectation_pass_rate: z.number().min(0).max(1),
  avg_plan_persistence_rate: z.number().min(0).max(1),
  avg_cache_hit_rate: z.number().min(0).max(1),
  total_tokens: z.number().int().nonnegative(),
});
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>;

export const evalReportSchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  erroredCases: z.number().int().nonnegative(),
  skippedCases: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(1),
  averageLatencyMs: z.number().nonnegative(),
  suiteSummaries: z.array(evalAggregateSummarySchema),
  configSummaries: z.array(evalAggregateSummarySchema),
  targetSummaries: z.array(evalAggregateSummarySchema),
  flakyCandidates: z.array(flakyCandidateSchema),
  benchmarkSummary: benchmarkSummarySchema.optional(),
  results: z.array(evalResultSchema),
});
export type EvalReport = z.infer<typeof evalReportSchema>;

export type PartialPlanSeed = z.infer<ReturnType<typeof planSchema.partial>>;
export type EvalTurnTrace = z.infer<typeof turnTraceSchema>;
export type LambdaTurnResponse = z.infer<typeof lambdaTurnResponseSchema>;
export type OfflineFixture = z.infer<typeof offlineFixtureSchema>;
export type EvalPlanSnapshot = PlanSnapshot;
