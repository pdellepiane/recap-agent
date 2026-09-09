import { describe, expect, it, vi, afterEach } from 'vitest';
import { FixtureAgentConversationGateway, parseFixtureDisabledOperations } from '../src/runtime/eval-fixture-gateway';
import { InMemoryEvalFixtureStateStore } from '../src/runtime/eval-fixture-state';
import { applyHandoffResult, resolveHandoffGatewayStatus } from '../src/runtime/human-help-policy';
import { attachEvaluationState, buildCumulativeFixtureEffectSummaries } from '../src/evals/evaluation-state';
import { evaluateFixtureEffectCountForTesting } from '../src/evals/runner';
import { expectationSchema } from '../src/evals/case-schema';
import type { EvalTurnResult } from '../src/evals/case-schema';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function denyNetwork(): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network disabled in fixture test');
  }));
}

function makeTurn(turnIndex: number, tools: string[], status: string): EvalTurnResult {
  const base = {
    turnIndex,
    input: { text: `t${turnIndex}` },
    outputText: `o${turnIndex}`,
    currentNode: 'solicitar_agente_humano',
    trace: {
      trace_id: `t${turnIndex}`,
      conversation_id: 'c',
      plan_id: 'p',
      previous_node: 'resolver_consultas_informativas',
      next_node: 'solicitar_agente_humano',
      node_path: ['resolver_consultas_informativas', 'solicitar_agente_humano'],
      intent: null,
      missing_fields: [],
      search_ready: false,
      prompt_bundle_id: 'b',
      prompt_file_paths: [],
      tools_considered: [],
      tools_called: tools,
      tool_inputs: [],
      tool_outputs: tools.map((tool) => ({ tool, output: JSON.stringify({ status: 'success' }) })),
      provider_results: [],
      search_strategy: 'none',
      plan_persisted: true,
      plan_persist_reason: 'r',
      timing_ms: { total: 1, load_plan: 0, prepare_working_plan: 0, extraction: 0, apply_extraction: 0, compute_sufficiency: 0, provider_search: 0, provider_enrichment: 0, prompt_bundle_load: 0, compose_reply: 0, save_plan: 0 },
      token_usage: { extraction: null, reply: null, total: null },
    },
    perf: null,
    plan: {
      plan_id: 'p',
      channel: 'whatsapp',
      external_user_id: 'u',
      conversation_id: 'c',
      lifecycle_state: 'active',
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      contact_phone_extension: null,
      contact_phone_number: null,
      current_node: 'solicitar_agente_humano',
      intent: null,
      intent_confidence: null,
      event_type: null,
      vendor_category: null,
      active_need_category: null,
      location: null,
      budget_signal: null,
      guest_range: null,
      preferences: [],
      hard_constraints: [],
      missing_fields: [],
      provider_needs: [],
      recommended_provider_ids: [],
      recommended_providers: [],
      selected_provider_ids: [],
      selected_provider_hints: [],
      assumptions: [],
      conversation_summary: '',
      last_user_goal: null,
      open_questions: [],
      updated_at: new Date().toISOString(),
      user_auth: { status, auth_method: null, email: null, token: null, token_expires_at: null, last_error: null, requested_at: null, failed_code_attempts: 0, otp_send_attempts: 0, otp_non_delivery_reports: 0, awaiting_phone_confirmation: false, phone_confirmation: null },
      human_escalation: { status: status === 'requested' ? 'requested' : 'none', requested_at: null, phone_number: null, last_error: status === 'requested' ? null : 'failed' },
      human_help_receipt: null,
      information_state: { resume_node: null, pending_requests: [], selection_candidates: [] },
    },
    latencyMs: 1,
  } as unknown as EvalTurnResult;
  return base;
}

describe('A1/A2/A3 fixture correctness', () => {
  it('offline truth table: success replays success with zero real writes', async () => {
    denyNetwork();
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await FixtureAgentConversationGateway.create('s06-identity-rejection-success', undefined, {
      runId: 'run-a1', caseId: 'case-success', stateStore: store,
    });
    const first = await gateway.requestHumanTakeover('+51900000901');
    expect(first.status).toBe('success');
    const second = await gateway.requestHumanTakeover('+51900000901');
    expect(second.status).toBe('success');
    expect(await store.count('run-a1', 'case-success', 'handoff.write')).toBe(2);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('offline truth table: rejected replays failed with typed outcome', async () => {
    denyNetwork();
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await FixtureAgentConversationGateway.create('s06-otp-handoff-failed', undefined, {
      runId: 'run-a2', caseId: 'case-failed', stateStore: store,
    });
    const first = await gateway.requestHumanTakeover('+51900000905');
    expect(first.status).toBe('failed');
    if (first.status === 'failed') expect(first.outcome).toBe('failed');
    const second = await gateway.requestHumanTakeover('+51900000905');
    expect(second.status).toBe('failed');
    if (second.status === 'failed') expect(second.outcome).toBe('failed');
    const receipts = await store.list('run-a2', 'case-failed', 'handoff.write');
    expect(receipts).toHaveLength(2);
    expect(receipts[1]?.replayed).toBe(true);
    expect(receipts[0]?.resultStatus).toBe('failed');
    expect(receipts[1]?.resultStatus).toBe('failed');
    expect(applyHandoffResult({ dedupeKey: 'k', inboundId: 'i', phone: 'p', gatewayStatus: resolveHandoffGatewayStatus(first) }).outcome).toBe('handoff_failed');
  });

  it('offline truth table: unknown replays unknown with typed outcome', async () => {
    denyNetwork();
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await FixtureAgentConversationGateway.create('s06-otp-handoff-unknown', undefined, {
      runId: 'run-a3', caseId: 'case-unknown', stateStore: store,
    });
    const first = await gateway.requestHumanTakeover('+51900000906');
    expect(first.status).toBe('failed');
    if (first.status === 'failed') expect(first.outcome).toBe('unknown');
    const second = await gateway.requestHumanTakeover('+51900000906');
    expect(second.status).toBe('failed');
    if (second.status === 'failed') expect(second.outcome).toBe('unknown');
    const receipts = await store.list('run-a3', 'case-unknown', 'handoff.write');
    expect(receipts.map((r) => r.resultStatus)).toEqual(['unknown', 'unknown']);
    expect(applyHandoffResult({ dedupeKey: 'k', inboundId: 'i', phone: 'p', gatewayStatus: resolveHandoffGatewayStatus(first) }).outcome).toBe('outcome_unknown');
  });

  it('disabled manifest blocks dispatch with typed disabledOperations', async () => {
    denyNetwork();
    expect(parseFixtureDisabledOperations(['human.takeover.write', 'nope'])).toEqual(['human.takeover.write']);
    const gateway = await FixtureAgentConversationGateway.create('s06-otp-handoff-unavailable', undefined, {
      runId: 'run-a4', caseId: 'case-disabled',
    });
    expect(gateway.capabilityDescriptor['human.takeover.write'].available).toBe(false);
    expect(gateway.capabilityDescriptor['human.takeover.write'].reason).toBe('feature_disabled');
    const result = await gateway.requestHumanTakeover('+51900000907');
    expect(result.status).toBe('skipped');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(0);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('cached state isolated by run/case/operation', async () => {
    denyNetwork();
    const store = new InMemoryEvalFixtureStateStore();
    const opts = (runId: string, caseId: string) => ({ runId, caseId, stateStore: store });
    const a = await FixtureAgentConversationGateway.create('s06-identity-rejection-success', undefined, opts('run-x', 'case-a'));
    await a.requestHumanTakeover('+51900000901');
    expect(await store.count('run-x', 'case-a', 'handoff.write')).toBe(1);
    expect(await store.count('run-x', 'case-b', 'handoff.write')).toBe(0);
    expect(await store.count('run-y', 'case-a', 'handoff.write')).toBe(0);
    expect(await store.count('run-x', 'case-a', 'otp.verify')).toBe(0);
  });

  it('fixture_effect_count schema parses and runner enforces cumulative receipts', async () => {
    const parsed = expectationSchema.safeParse({
      type: 'fixture_effect_count',
      operation: 'handoff.write',
      turnIndex: 0,
      expectedAttempts: 1,
      expectedSuccesses: 1,
      expectedReplays: 0,
    });
    expect(parsed.success).toBe(true);
    const t0 = makeTurn(0, ['request_human_takeover'], 'requested');
    const t1 = makeTurn(1, [], 'requested');
    const t2 = makeTurn(2, [], 'requested');
    const turns = [t0, t1, t2];
    for (const t of turns) {
      attachEvaluationState(t, {
        plan: t.plan as never,
        input: t.input,
        outputText: t.outputText,
        fixtureEffects: buildCumulativeFixtureEffectSummaries(turns, t.turnIndex),
      });
    }
    expect(evaluateFixtureEffectCountForTesting({ turns, operation: 'handoff.write', turnIndex: 0, expectedAttempts: 1, expectedSuccesses: 1, expectedReplays: 0 }).passed).toBe(true);
    expect(evaluateFixtureEffectCountForTesting({ turns, operation: 'handoff.write', turnIndex: 1, expectedAttempts: 1, expectedSuccesses: 1, expectedReplays: 0 }).passed).toBe(true);
    expect(evaluateFixtureEffectCountForTesting({ turns, operation: 'handoff.write', turnIndex: 2, expectedAttempts: 1, expectedSuccesses: 1, expectedReplays: 0 }).passed).toBe(true);
    expect(evaluateFixtureEffectCountForTesting({ turns, operation: 'handoff.write', turnIndex: 2, expectedAttempts: 2, expectedSuccesses: 1, expectedReplays: 0 }).passed).toBe(false);
  });

  it('fixture_effect_count missing receipt fails instead of zero', async () => {
    const t0 = makeTurn(0, [], 'none');
    expect(evaluateFixtureEffectCountForTesting({ turns: [t0], operation: 'handoff.write', expectedAttempts: 1, expectedSuccesses: 1, expectedReplays: 0 }).passed).toBe(false);
  });
});
