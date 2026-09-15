import { describe, expect, it } from 'vitest';

import type { EvalTurnResult } from '../src/evals/case-schema';
import {
  attachEvaluationState,
  buildFixtureEffectSummariesFromReceipts,
  getEvaluationFixtureEffects,
  getEvaluationInput,
  getEvaluationOutputText,
  getPrivatePlanForEvidence,
  snapshotEvaluationTurns,
} from '../src/evals/evaluation-state';
import { InMemoryEvalFixtureStateStore } from '../src/runtime/eval-fixture-state';
import { createEmptyPlan } from '../src/core/plan';
import { projectSafePlan } from '../src/runtime/artifact-redaction';
import { redactEvalTurnsForSnapshot } from '../src/evals/reporting';
import { validateImageOnlySilence } from '../src/evals/silence';
import { collectOriginGateFailures, evaluateFixtureEffectCountForTesting } from '../src/evals/runner';
import { attendanceToIsolationState } from '../src/evals/rsvp-isolation';

function baseTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trace_id: 'snapshot-trace',
    conversation_id: null,
    plan_id: 'p-snap',
    previous_node: 'contacto_inicial',
    next_node: 'resolver_consultas_informativas',
    node_path: ['contacto_inicial', 'resolver_consultas_informativas'],
    intent: null,
    missing_fields: [],
    search_ready: false,
    prompt_bundle_id: 'b-snap',
    prompt_file_paths: [],
    tools_considered: [],
    tools_called: [],
    tool_inputs: [],
    tool_outputs: [],
    provider_results: [],
    search_strategy: 'none',
    close_action_summary: { type: null, category: null, reason_preview: null },
    selection_resolution_summary: {
      selected_provider_references: [],
      selected_provider_hints_count: 0,
      provider_plan_operation_types: [],
      provider_plan_operation_categories: [],
    },
    contact_validation_summary: {
      status: 'not_provided',
      field: null,
      reason_preview: null,
      extraction_contact_fields_present: { name: false, email: false, phone: false },
      plan_contact_fields_present: { name: false, email: false, phone: false },
    },
    provider_candidate_audit: [],
    information_execution_summary: [],
    recommendation_funnel: {
      available_candidates: 0,
      context_candidates: 0,
      context_candidate_ids: [],
      presentation_limit: 5,
    },
    plan_persisted: true,
    plan_persist_reason: 'image_file_silence',
    timing_ms: {
      total: 1, load_plan: 0, prepare_working_plan: 0, extraction: 0,
      apply_extraction: 0, compute_sufficiency: 0, provider_search: 0,
      provider_enrichment: 0, prompt_bundle_load: 0, compose_reply: 0, save_plan: 0,
    },
    token_usage: { extraction: null, reply: null, total: null },
    ...overrides,
  };
}

function fileRef(messageId: string, expiresAt: string): Record<string, unknown> {
  return {
    kind: 'file',
    fileId: 'file-secret-123',
    expiresAt,
    mimeType: 'image/jpeg',
    byteLength: 1234,
    contentDigest: 'b'.repeat(64),
    messageId,
    receivedAt: new Date().toISOString(),
  };
}

function makeImageSilenceTurn(messageId: string, overrides: Record<string, unknown> = {}): EvalTurnResult {
  const secretToken = 'secret-token-canary-xyz';
  const emptyBase = createEmptyPlan({ planId: 'p-snap', channel: 'terminal_whatsapp_eval', externalUserId: 'u-snap' });
  const privatePlan = {
    ...emptyBase,
    user_auth: { ...emptyBase.user_auth, status: 'authenticated', token: secretToken, auth_method: 'phone' },
    image_attachments: [fileRef(messageId, new Date(Date.now() + 86_400_000).toISOString())],
  };
  const turn = {
    turnIndex: 0,
    input: { text: '', image: { redacted: true as const, mime_type: 'image/jpeg', byte_length: 1234 } },
    outputText: '',
    deliveredText: null,
    delivery: { action: 'suppress' as const, reason: 'image_only_no_outstanding_task' },
    outputOrigin: {
      status: 'missing' as const,
      candidateSha256: null,
      deliveredSha256: null,
      transformationVersion: null,
      mismatchFields: ['candidate_output_origin'],
    },
    observedMessageId: messageId,
    currentNode: 'contacto_inicial',
    trace: baseTrace(),
    plan: projectSafePlan(privatePlan as unknown as Parameters<typeof projectSafePlan>[0]),
    latencyMs: 1,
    ...overrides,
  } as unknown as EvalTurnResult;
  attachEvaluationState(turn, {
    plan: privatePlan as unknown as EvalTurnResult['plan'],
    input: turn.input,
    outputText: '',
    fixtureEffects: buildFixtureEffectSummariesFromReceipts([]),
  });
  return turn;
}

function makeSpeechTurn(turnIndex: number, text: string): EvalTurnResult {
  const plan = createEmptyPlan({ planId: `p-${turnIndex}`, channel: 'terminal_whatsapp_eval', externalUserId: 'u-snap' });
  const turn = {
    turnIndex,
    input: { text: `in-${turnIndex}` },
    outputText: text,
    deliveredText: text,
    delivery: { action: 'send' as const, reason: 'model_reply' },
    outputOrigin: {
      status: 'missing' as const,
      candidateSha256: null,
      deliveredSha256: null,
      transformationVersion: null,
      mismatchFields: ['candidate_output_origin'],
    },
    currentNode: 'recomendar',
    trace: baseTrace({ plan_persisted: true, plan_persist_reason: 'r' }),
    plan: projectSafePlan(plan),
    latencyMs: 1,
  } as unknown as EvalTurnResult;
  attachEvaluationState(turn, {
    plan: plan as unknown as EvalTurnResult['plan'],
    input: turn.input,
    outputText: text,
    fixtureEffects: buildFixtureEffectSummariesFromReceipts([]),
  });
  return turn;
}

describe('recheck-b9a7662d evidence-preserving snapshot (execute->snapshot->teardown->finalize)', () => {
  it('valid receipt survives the snapshot with binding intact', () => {
    const messageId = 'snap-case-0-seed';
    const original = makeImageSilenceTurn(messageId);
    const [snapshot] = snapshotEvaluationTurns([original]);
    if (!snapshot) throw new Error('Missing snapshot turn.');
    expect(validateImageOnlySilence(snapshot, {
      observedMessageId: snapshot.observedMessageId ?? null,
      nowMs: Date.now(),
    }).exempt).toBe(true);
    const refs = (getPrivatePlanForEvidence(snapshot) as unknown as { image_attachments?: unknown[] }).image_attachments;
    expect(Array.isArray(refs) && refs?.length).toBe(1);
    expect(getEvaluationFixtureEffects(snapshot)).not.toBeNull();
  });

  it('post-snapshot original mutation does not change the snapshot', () => {
    const messageId = 'snap-mutate-0';
    const original = makeImageSilenceTurn(messageId);
    const [snapshot] = snapshotEvaluationTurns([original]);
    if (!snapshot) throw new Error('Missing snapshot turn.');
    const privatePlan = getPrivatePlanForEvidence(original) as unknown as {
      image_attachments: Array<Record<string, unknown>>;
      user_auth?: Record<string, unknown>;
    };
    privatePlan.image_attachments.length = 0;
    attachEvaluationState(original, {
      plan: getPrivatePlanForEvidence(original),
      input: { text: 'mutated' },
      outputText: 'mutated speech',
      fixtureEffects: buildFixtureEffectSummariesFromReceipts([]),
    });
    expect(getEvaluationInput(snapshot).text).toBe('');
    expect(getEvaluationOutputText(snapshot)).toBe('');
    const snapshotRefs = (getPrivatePlanForEvidence(snapshot) as unknown as { image_attachments?: unknown[] }).image_attachments;
    expect(Array.isArray(snapshotRefs) && snapshotRefs?.length).toBe(1);
    expect(validateImageOnlySilence(snapshot, {
      observedMessageId: snapshot.observedMessageId ?? null,
      nowMs: Date.now(),
    }).exempt).toBe(true);
  });

  it('preserves absent effects as absent instead of inventing zeros', () => {
    const turn = makeSpeechTurn(0, 'hola');
    const bare = { ...JSON.parse(JSON.stringify(turn)) } as EvalTurnResult;
    // No attach: private effects absent.
    const [snapshot] = snapshotEvaluationTurns([bare]);
    if (!snapshot) throw new Error('Missing snapshot turn.');
    expect(getEvaluationFixtureEffects(snapshot)).toBeNull();
    expect(evaluateFixtureEffectCountForTesting({
      turns: [snapshot],
      operation: 'rsvp.write',
      expectedAttempts: 1,
      expectedSuccesses: 1,
      expectedReplays: 0,
    }).passed).toBe(false);
  });

  it('wrong message IDs, expired refs, missing refs, and failed generation remain failures', () => {
    const messageId = 'snap-fail-0';
    const wrongBinding = makeImageSilenceTurn(messageId);
    expect(validateImageOnlySilence(wrongBinding, {
      observedMessageId: 'different-invocation-id',
      nowMs: Date.now(),
    }).exempt).toBe(false);

    const expired = makeImageSilenceTurn(messageId);
    const expiredPlan = getPrivatePlanForEvidence(expired) as unknown as {
      image_attachments: Array<Record<string, unknown>>;
    };
    expiredPlan.image_attachments[0] = fileRef(messageId, new Date(Date.now() - 1_000).toISOString());
    const [expiredSnapshot] = snapshotEvaluationTurns([expired]);
    if (!expiredSnapshot) throw new Error('Missing expired snapshot.');
    expect(validateImageOnlySilence(expiredSnapshot, {
      observedMessageId: messageId,
      nowMs: Date.now(),
    }).exempt).toBe(false);

    const missingRef = makeImageSilenceTurn(messageId);
    const missingPlan = getPrivatePlanForEvidence(missingRef) as unknown as {
      image_attachments: Array<Record<string, unknown>>;
    };
    missingPlan.image_attachments.length = 0;
    const [missingSnapshot] = snapshotEvaluationTurns([missingRef]);
    if (!missingSnapshot) throw new Error('Missing snapshot.');
    expect(validateImageOnlySilence(missingSnapshot, {
      observedMessageId: messageId,
      nowMs: Date.now(),
    }).exempt).toBe(false);

    const failedGeneration = makeSpeechTurn(0, '');
    const failed = {
      ...failedGeneration,
      deliveredText: null,
      outputText: '',
      outputOrigin: {
        status: 'generation_failed' as const,
        candidateSha256: null,
        deliveredSha256: null,
        transformationVersion: null,
        mismatchFields: [] as string[],
      },
    } as EvalTurnResult;
    attachEvaluationState(failed, {
      plan: getPrivatePlanForEvidence(failedGeneration),
      input: failed.input,
      outputText: '',
    });
    const [failedSnapshot] = snapshotEvaluationTurns([failed]);
    if (!failedSnapshot) throw new Error('Missing failed snapshot.');
    expect(collectOriginGateFailures([failedSnapshot]).length).toBeGreaterThan(0);
  });

  it('public snapshot artifacts stay redacted', () => {
    const messageId = 'snap-redact-0';
    const original = makeImageSilenceTurn(messageId);
    const [snapshot] = snapshotEvaluationTurns([original]);
    if (!snapshot) throw new Error('Missing snapshot turn.');
    const redacted = redactEvalTurnsForSnapshot([snapshot]);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('file-secret-123');
    expect(serialized).not.toContain('secret-token-canary-xyz');
    expect(redacted[0]?.plan_summary).toBeDefined();
  });
});

describe('recheck-b9a7662d verified fixture receipts (no inferred success)', () => {
  it('failed writes and unknown outcomes are not successes', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    await store.record({
      runId: 'run-fail', caseId: 'case-fail', scenario: 's', operation: 'rsvp.write',
      args: {}, resultStatus: 'failed',
    });
    await store.record({
      runId: 'run-unknown', caseId: 'case-unknown', scenario: 's', operation: 'handoff.write',
      args: {}, resultStatus: 'unknown',
    });
    const failed = buildFixtureEffectSummariesFromReceipts(await store.list('run-fail', 'case-fail'));
    const unknown = buildFixtureEffectSummariesFromReceipts(await store.list('run-unknown', 'case-unknown'));
    expect(failed.find((entry) => entry.operation === 'rsvp.write')).toMatchObject({
      attempts: 1, successes: 0, replays: 0, outcome: 'failed',
    });
    expect(unknown.find((entry) => entry.operation === 'handoff.write')).toMatchObject({
      attempts: 1, successes: 0, replays: 0, outcome: 'unknown',
    });
  });

  it('counts duplicate writes and replays from receipt identity', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    await store.record({
      runId: 'run-dup', caseId: 'case-dup', scenario: 's', operation: 'rsvp.write',
      args: {}, resultStatus: 'responded',
    });
    await store.record({
      runId: 'run-dup', caseId: 'case-dup', scenario: 's', operation: 'rsvp.write',
      args: {}, resultStatus: 'responded',
    });
    await store.record({
      runId: 'run-replay', caseId: 'case-replay', scenario: 's', operation: 'handoff.write',
      args: {}, resultStatus: 'success',
    });
    await store.record({
      runId: 'run-replay', caseId: 'case-replay', scenario: 's', operation: 'handoff.write',
      args: {}, resultStatus: 'success', replayed: true,
    });
    const dup = buildFixtureEffectSummariesFromReceipts(await store.list('run-dup', 'case-dup'));
    const replay = buildFixtureEffectSummariesFromReceipts(await store.list('run-replay', 'case-replay'));
    expect(dup.find((entry) => entry.operation === 'rsvp.write')).toMatchObject({
      attempts: 2, successes: 2, replays: 0,
    });
    expect(replay.find((entry) => entry.operation === 'handoff.write')).toMatchObject({
      attempts: 2, successes: 2, replays: 1,
    });
  });

  it('provider intent markers do not double-count; lone intent is a failed attempt', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    await store.record({
      runId: 'run-q', caseId: 'case-q', scenario: 's', operation: 'provider.quote.write',
      args: {}, resultStatus: 'intent',
    });
    await store.record({
      runId: 'run-q', caseId: 'case-q', scenario: 's', operation: 'provider.quote.write',
      args: {}, resultStatus: 'simulated',
    });
    await store.record({
      runId: 'run-qi', caseId: 'case-qi', scenario: 's', operation: 'provider.quote.write',
      args: {}, resultStatus: 'intent',
    });
    const paired = buildFixtureEffectSummariesFromReceipts(await store.list('run-q', 'case-q'));
    const lone = buildFixtureEffectSummariesFromReceipts(await store.list('run-qi', 'case-qi'));
    expect(paired.find((entry) => entry.operation === 'provider.quote.write')).toMatchObject({
      attempts: 1, successes: 1, replays: 0, outcome: 'success',
    });
    expect(lone.find((entry) => entry.operation === 'provider.quote.write')).toMatchObject({
      attempts: 1, successes: 0, outcome: 'failed',
    });
  });

  it('wrong scope never leaks and later-turn writes do not satisfy earlier assertions', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    await store.record({
      runId: 'run-scope', caseId: 'case-a', scenario: 's', operation: 'rsvp.write',
      args: {}, resultStatus: 'responded',
    });
    const wrongScope = buildFixtureEffectSummariesFromReceipts(await store.list('run-scope', 'case-b'));
    expect(wrongScope.find((entry) => entry.operation === 'rsvp.write')).toMatchObject({
      attempts: 0, successes: 0, outcome: 'none',
    });

    const runId = 'run-boundary';
    const caseId = 'case-boundary';
    const baseline = await store.list(runId, caseId);
    expect(baseline).toHaveLength(0);
    await store.record({
      runId, caseId, scenario: 's', operation: 'rsvp.write', args: {}, resultStatus: 'responded',
    });
    const firstBoundary = buildFixtureEffectSummariesFromReceipts(
      (await store.list(runId, caseId)).filter((receipt) => !new Set(baseline.map((entry) => entry.syntheticId)).has(receipt.syntheticId)),
    );
    const turn0 = makeSpeechTurn(0, 'primero');
    attachEvaluationState(turn0, {
      plan: getPrivatePlanForEvidence(turn0),
      input: turn0.input,
      outputText: turn0.outputText,
      fixtureEffects: firstBoundary,
    });
    const [snap0] = snapshotEvaluationTurns([turn0]);
    if (!snap0) throw new Error('Missing turn0 snapshot.');

    await store.record({
      runId, caseId, scenario: 's', operation: 'rsvp.write', args: {}, resultStatus: 'responded',
    });
    const secondBoundary = buildFixtureEffectSummariesFromReceipts(await store.list(runId, caseId));
    const turn1 = makeSpeechTurn(1, 'segundo');
    attachEvaluationState(turn1, {
      plan: getPrivatePlanForEvidence(turn1),
      input: turn1.input,
      outputText: turn1.outputText,
      fixtureEffects: secondBoundary,
    });
    expect(evaluateFixtureEffectCountForTesting({
      turns: [snap0, turn1], operation: 'rsvp.write', turnIndex: 0,
      expectedAttempts: 1, expectedSuccesses: 1, expectedReplays: 0,
    }).passed).toBe(true);
    expect(evaluateFixtureEffectCountForTesting({
      turns: [snap0, turn1], operation: 'rsvp.write', turnIndex: 0,
      expectedAttempts: 2, expectedSuccesses: 2, expectedReplays: 0,
    }).passed).toBe(false);
    expect(evaluateFixtureEffectCountForTesting({
      turns: [snap0, turn1], operation: 'rsvp.write', turnIndex: 1,
      expectedAttempts: 2, expectedSuccesses: 2, expectedReplays: 0,
    }).passed).toBe(true);
  });

  it('tool calls without receipts are never writes; missing collection is unknown', () => {
    const observedZero = buildFixtureEffectSummariesFromReceipts([]);
    expect(observedZero.find((entry) => entry.operation === 'rsvp.write')).toMatchObject({
      attempts: 0, successes: 0, outcome: 'none',
    });
    const turn = makeSpeechTurn(0, 'hola');
    const bare = { ...JSON.parse(JSON.stringify(turn)) } as EvalTurnResult;
    expect(getEvaluationFixtureEffects(bare)).toBeNull();
    expect(evaluateFixtureEffectCountForTesting({
      turns: [bare], operation: 'rsvp.write',
      expectedAttempts: 0, expectedSuccesses: 0, expectedReplays: 0,
    }).passed).toBe(false);
  });

  it('retains willAttend precedence regardless of hasResponded', () => {
    expect(attendanceToIsolationState({ willAttend: true, hasResponded: false })).toBe('attending');
    expect(attendanceToIsolationState({ willAttend: false, hasResponded: false })).toBe('declining');
    expect(attendanceToIsolationState({ willAttend: null, hasResponded: false })).toBe('pending');
  });
});
