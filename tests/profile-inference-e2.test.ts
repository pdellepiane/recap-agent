import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { hashPrivateOutput } from '../src/audit/output-origin';
import { createEmptyPlan } from '../src/core/plan';
import type { EvalCase, EvalTurnResult } from '../src/evals/case-schema';
import {
  attachEvaluationState,
  buildFixtureEffectSummariesFromReceipts,
  snapshotEvaluationTurns,
} from '../src/evals/evaluation-state';
import { EvalLoader } from '../src/evals/loader';
import {
  adjudicateDiagnosticCause,
  annotateDiagnosticCauseForReview,
  classifyPrimaryFailureReason,
  redactEvalTurnsForSnapshot,
} from '../src/evals/reporting';
import { projectSafePlan } from '../src/runtime/artifact-redaction';
import {
  assertLiveRegressionFixtureCoverage,
  buildSemanticJudgeContext,
  classifyEvalCaseLane,
  computeHardGatePassed,
  normalizeZeroTurnResult,
} from '../src/evals/runner';
import {
  DEFAULT_CASE_CONCURRENCY,
  DEFAULT_JUDGE_CONCURRENCY,
  parseCaseConcurrency,
  parseJudgeConcurrency,
} from '../src/evals/scheduler';

function baseTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trace_id: 'e2-trace',
    conversation_id: null,
    plan_id: 'p-e2',
    previous_node: 'contacto_inicial',
    next_node: 'recomendar',
    node_path: ['contacto_inicial', 'recomendar'],
    intent: null,
    missing_fields: [],
    search_ready: false,
    prompt_bundle_id: 'b-e2',
    prompt_file_paths: [],
    tools_considered: [],
    tools_called: [],
    tool_inputs: [],
    tool_outputs: [],
    provider_results: [],
    search_strategy: 'none',
    plan_persisted: true,
    plan_persist_reason: 'e2-probe',
    timing_ms: {
      total: 1, load_plan: 0, prepare_working_plan: 0, extraction: 0,
      apply_extraction: 0, compute_sufficiency: 0, provider_search: 0,
      provider_enrichment: 0, prompt_bundle_load: 0, compose_reply: 0, save_plan: 0,
    },
    token_usage: { extraction: null, reply: null, total: null },
    contact_validation_summary: {
      status: 'not_provided',
      field: null,
      reason_preview: null,
      extraction_contact_fields_present: { name: false, email: false, phone: false },
      plan_contact_fields_present: { name: false, email: false, phone: false },
    },
    selection_resolution_summary: {
      selected_provider_references: [],
      selected_provider_hints_count: 0,
      provider_plan_operation_types: [],
      provider_plan_operation_categories: [],
    },
    information_execution_summary: [],
    ...overrides,
  };
}

function speechTurn(turnIndex: number, inputText: string, outputText: string): EvalTurnResult {
  const privatePlan = createEmptyPlan({
    planId: `p-e2-${turnIndex}`,
    channel: 'terminal_whatsapp_eval',
    externalUserId: 'u-e2',
  });
  const turn = {
    turnIndex,
    input: { text: inputText },
    outputText,
    deliveredText: outputText,
    delivery: { action: 'send' as const, reason: 'model_reply' },
    outputOrigin: {
      status: 'verified' as const,
      candidateSha256: hashPrivateOutput(outputText),
      deliveredSha256: hashPrivateOutput(outputText),
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    },
    currentNode: 'recomendar',
    trace: baseTrace(),
    plan: projectSafePlan(privatePlan as unknown as Parameters<typeof projectSafePlan>[0]),
    latencyMs: 1,
  } as unknown as EvalTurnResult;
  attachEvaluationState(turn, {
    plan: privatePlan as unknown as EvalTurnResult['plan'],
    input: turn.input,
    outputText,
    fixtureEffects: buildFixtureEffectSummariesFromReceipts([]),
  });
  return turn;
}

function makeFixtureCase(id: string): EvalCase {
  return {
    suite: 'live_behavior_regression',
    version: 1,
    description: 'E2 business-regression fixture probe.',
    imports: [],
    tags: [],
    priority: 'p2',
    status: 'active',
    targetModes: ['live_lambda'],
    variables: {},
    backendFixture: { scenario: 's11-rsvp-durability-declining' },
    inputs: [
      { text: 'primera pregunta', backendFixture: { scenario: 's11-rsvp-durability-declining' } },
      { text: 'segunda pregunta', backendFixture: { scenario: 's11-rsvp-durability-declining' } },
    ],
    expectations: [
      {
        type: 'fixture_effect_count',
        severity: 'hard',
        operation: 'rsvp.write',
        expectedAttempts: 1,
        expectedSuccesses: 1,
        expectedReplays: 0,
      },
    ],
    scorers: [],
    notes: [],
    id,
  } as EvalCase;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('packet E2 raw verdict stays separate from the adjudicated cause', () => {
  it('annotation sidecar copies raw scores without mutating the source result', () => {
    const source = Object.freeze({
      caseId: 'e2-cause-separation',
      runId: 'run-e2',
      status: 'failed' as const,
      hardGatePassed: false,
      finalScore: 0.42,
      planDiffSummary: ['Transport gate failures: turn 0 classifier: transport evidence is missing.'],
      expectationResults: [],
    });
    const annotation = annotateDiagnosticCauseForReview({
      caseId: source.caseId,
      runId: source.runId,
      status: source.status,
      hardGatePassed: source.hardGatePassed,
      finalScore: source.finalScore,
      planDiffSummary: source.planDiffSummary,
      expectationResults: source.expectationResults,
    });
    expect(annotation.raw).toEqual({ status: 'failed', hardGatePassed: false, finalScore: 0.42 });
    expect(annotation.primaryFailureReason).toBe('infrastructure_error');
    expect(annotation.diagnosticCause).toBe('infrastructure');
    expect(source.finalScore).toBe(0.42);
    expect(source.hardGatePassed).toBe(false);
  });

  it('human annotation never overwrites raw scores: passed stays passed with a null cause', () => {
    expect(adjudicateDiagnosticCause({
      status: 'passed',
      planDiffSummary: [],
      expectationResults: [],
      primaryFailureReason: null,
    })).toBeNull();
    const annotation = annotateDiagnosticCauseForReview({
      caseId: 'e2-passed',
      runId: 'run-e2',
      status: 'passed',
      hardGatePassed: true,
      finalScore: 1,
      planDiffSummary: [],
      expectationResults: [],
      primaryFailureReason: null,
    });
    expect(annotation.raw).toEqual({ status: 'passed', hardGatePassed: true, finalScore: 1 });
    expect(annotation.diagnosticCause).toBeNull();
  });

  it('output-origin gate failures read as product effect, never infrastructure', () => {
    const primary = classifyPrimaryFailureReason({
      status: 'failed',
      planDiffSummary: ['Output-origin gate failures: turn 0: output-origin status=mismatch.'],
      expectationResults: [],
    });
    expect(primary).toBe('product_effect_identity');
    expect(adjudicateDiagnosticCause({
      status: 'failed',
      planDiffSummary: ['Output-origin gate failures: turn 0: output-origin status=mismatch.'],
      expectationResults: [],
      primaryFailureReason: primary,
    })).toBe('product_fact_effect_omission');
  });

  it('all-green expectations never bypass the origin or transport gates', () => {
    const allPass = [{ severity: 'hard' as const, passed: true }];
    expect(computeHardGatePassed({
      expectationResults: allPass,
      originGateFailures: ['turn 0: output-origin status=mismatch'],
      transportGateFailures: [],
    })).toBe(false);
    expect(computeHardGatePassed({
      expectationResults: allPass,
      originGateFailures: [],
      transportGateFailures: ['turn 0 classifier: transport evidence is missing'],
    })).toBe(false);
    expect(computeHardGatePassed({
      expectationResults: allPass,
      originGateFailures: [],
      transportGateFailures: [],
    })).toBe(true);
  });
});

describe('packet E2 adjudicated cause taxonomy', () => {
  it('fixture digest mismatch refines a product failure into fixture_inconsistency', () => {
    const summary = [
      'JUDGE-ONLY IMAGE GROUND TRUTH: digest mismatch against the bound input image (projection defect, diagnosable; never candidate knowledge).',
    ];
    const primary = classifyPrimaryFailureReason({
      status: 'failed',
      planDiffSummary: summary,
      expectationResults: [],
    });
    expect(primary).toBe('product_fact_completeness');
    expect(adjudicateDiagnosticCause({
      status: 'failed',
      planDiffSummary: summary,
      expectationResults: [],
      primaryFailureReason: primary,
    })).toBe('fixture_inconsistency');
  });

  it('infrastructure still wins when fixture and transport signals coincide', () => {
    const summary = [
      'Transport gate failures: turn 0 classifier: transport evidence is missing.',
      'JUDGE-ONLY IMAGE GROUND TRUTH: digest mismatch against the bound input image.',
    ];
    expect(classifyPrimaryFailureReason({
      status: 'failed',
      planDiffSummary: summary,
      expectationResults: [],
    })).toBe('infrastructure_error');
    expect(adjudicateDiagnosticCause({
      status: 'failed',
      planDiffSummary: summary,
      expectationResults: [],
      primaryFailureReason: 'infrastructure_error',
    })).toBe('infrastructure');
  });

  it('missing fixture receipt evidence reads as evaluator missing evidence', () => {
    const failed = [{
      passed: false,
      severity: 'hard' as const,
      type: 'fixture_effect_count',
      message: 'Missing fixture receipt evidence for rsvp.write; it is not zero.',
    }];
    expect(classifyPrimaryFailureReason({
      status: 'failed',
      planDiffSummary: [],
      expectationResults: failed,
    })).toBe('evaluator_defect');
    expect(adjudicateDiagnosticCause({
      status: 'failed',
      planDiffSummary: [],
      expectationResults: failed,
      primaryFailureReason: 'evaluator_defect',
    })).toBe('evaluator_missing_evidence');
  });

  it('quality-only trajectory failures read as minor relevance or clarification', () => {
    const failed = [{
      passed: false,
      severity: 'hard' as const,
      type: 'trajectory_invariants',
      message: 'repeated question detected',
    }];
    expect(classifyPrimaryFailureReason({
      status: 'failed',
      planDiffSummary: [],
      expectationResults: failed,
    })).toBe('unnecessary_interaction');
    expect(adjudicateDiagnosticCause({
      status: 'failed',
      planDiffSummary: [],
      expectationResults: failed,
      primaryFailureReason: 'unnecessary_interaction',
    })).toBe('minor_relevance_clarification');
  });

  it('zero-turn setup errors stay infrastructure with the cause preserved', () => {
    const cause = 'RSVP isolation setup failed: External evaluations are restricted to the named coordinator host';
    const normalized = normalizeZeroTurnResult({ turns: [], status: 'skipped', errorMessage: cause }, 'e2-setup');
    expect(normalized.status).toBe('errored');
    expect(normalized.errorMessage).toBe(cause);
    const summary = [`Runtime error: ${normalized.errorMessage ?? ''}`];
    expect(classifyPrimaryFailureReason({
      status: 'errored',
      planDiffSummary: summary,
      expectationResults: [],
    })).toBe('infrastructure_error');
    expect(adjudicateDiagnosticCause({
      status: 'errored',
      planDiffSummary: summary,
      expectationResults: [],
      primaryFailureReason: 'infrastructure_error',
    })).toBe('infrastructure');
  });
});

describe('packet E2 private evidence survives the snapshot while public artifacts stay redacted', () => {
  it('judge context carries no private token and no future-turn text', () => {
    const secretToken = 'e2-secret-token-canary';
    const early = speechTurn(0, 'primera pregunta sobre el evento', 'respuesta inicial');
    const later = speechTurn(1, 'segunda pregunta FUTURE-CANARY-X7', 'respuesta posterior');
    const privatePlan = createEmptyPlan({
      planId: 'p-e2-secret',
      channel: 'terminal_whatsapp_eval',
      externalUserId: 'u-e2',
    }) as unknown as Record<string, unknown>;
    (privatePlan['user_auth'] as Record<string, unknown>)['token'] = secretToken;
    attachEvaluationState(early, {
      plan: privatePlan as unknown as EvalTurnResult['plan'],
      input: early.input,
      outputText: 'respuesta inicial',
      fixtureEffects: buildFixtureEffectSummariesFromReceipts([]),
    });
    const [snapEarly, snapLater] = snapshotEvaluationTurns([early, later]);
    if (!snapEarly || !snapLater) throw new Error('Missing E2 snapshot turns.');
    const earlyContext = buildSemanticJudgeContext([snapEarly, snapLater], 0);
    expect(earlyContext).not.toContain('FUTURE-CANARY-X7');
    expect(earlyContext).not.toContain(secretToken);
    const laterContext = buildSemanticJudgeContext([snapEarly, snapLater], 1);
    expect(laterContext).toContain('FUTURE-CANARY-X7');
    expect(laterContext).not.toContain(secretToken);
    const redacted = redactEvalTurnsForSnapshot([snapEarly, snapLater]);
    expect(JSON.stringify(redacted)).not.toContain(secretToken);
  });
});

describe('packet E2 bounded runner and complete fixture preflight need no external host', () => {
  it('bounds one 4-case and 2-judge pipeline and rejects anything wider', () => {
    expect(DEFAULT_CASE_CONCURRENCY).toBe(4);
    expect(DEFAULT_JUDGE_CONCURRENCY).toBe(2);
    expect(parseCaseConcurrency(4)).toBe(4);
    expect(parseJudgeConcurrency(2)).toBe(2);
    expect(() => parseCaseConcurrency(0)).toThrow(/case-concurrency/);
    expect(() => parseCaseConcurrency(5)).toThrow(/case-concurrency/);
    expect(() => parseJudgeConcurrency(0)).toThrow(/judge-concurrency/);
    expect(() => parseJudgeConcurrency(3)).toThrow(/judge-concurrency/);
  });

  it('a fully fixture-covered business-regression case passes preflight with no coordinator host', () => {
    vi.stubEnv('EVAL_COORDINATOR_HOST', '');
    const currentCase = makeFixtureCase('e2-no-host-required');
    expect(classifyEvalCaseLane(currentCase).lane).toBe('parallel');
    expect(() => assertLiveRegressionFixtureCoverage([currentCase])).not.toThrow();
  });

  it('incomplete coverage fails before any remote call and never names a host substitute', () => {
    vi.stubEnv('EVAL_COORDINATOR_HOST', '');
    const incomplete = makeFixtureCase('e2-coverage-incomplete');
    incomplete.inputs = [
      { text: 'con escenario', backendFixture: { scenario: 's11-rsvp-durability-declining' } },
      { text: 'sin escenario' },
    ];
    expect(() => assertLiveRegressionFixtureCoverage([incomplete])).toThrow(/e2-coverage-incomplete.*turn 1.*no fixture scenario/);
    try {
      assertLiveRegressionFixtureCoverage([incomplete]);
    } catch (error) {
      expect(String(error)).not.toMatch(/EVAL_COORDINATOR_HOST|coordinator host/i);
    }
  });
});

describe('packet E2 coverage linkage', () => {
  it('every e2 entry points at a mandatory-suite case with hard structure and no semantic judge', async () => {
    const evalDirectory = path.resolve(process.cwd(), 'evals');
    const registry = z.object({
      behaviorChanges: z.array(z.object({
        id: z.string().min(1),
        implementedBy: z.string().regex(/^[0-9a-f]{7,40}$/u),
        liveCaseIds: z.array(z.string().min(1)).min(1),
      })).min(1),
    }).parse(YAML.parse(
      await fs.readFile(path.join(evalDirectory, 'live-behavior-coverage.yaml'), 'utf8'),
    ) as unknown);
    const catalog = await new EvalLoader(evalDirectory).loadCatalog();
    const suite = catalog.suites.find((candidate) => candidate.id === 'live_behavior_regression');
    const registered = new Set(suite?.caseIds ?? []);
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    const e2 = registry.behaviorChanges.filter((change) => change.id.startsWith('e2-'));
    expect(e2.length).toBeGreaterThan(0);
    for (const change of e2) {
      for (const caseId of change.liveCaseIds) {
        const live = casesById.get(caseId);
        expect(live, `${change.id} references missing case ${caseId}`).toBeDefined();
        expect(registered.has(caseId), `${caseId} is not in the mandatory suite`).toBe(true);
        expect(
          live?.expectations.some((e) => e.severity === 'hard' && e.type !== 'text_semantic' && e.type !== 'budget_constraints' && e.type !== 'token_usage_present'),
          `${caseId} needs a hard structural expectation`,
        ).toBe(true);
        expect(
          live?.expectations.some((e) => e.type === 'text_semantic' && e.severity === 'hard' && e.requireJudge === true),
          `${caseId} must not require a semantic judge`,
        ).toBe(false);
      }
    }
  });
});
