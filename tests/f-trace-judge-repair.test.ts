import { describe, expect, it, vi } from 'vitest';

import {
  MAX_CANDIDATE_DETAILS,
  MAX_CALL_SUMMARIES,
  MAX_DIAGNOSTIC_BYTES,
  PACKET_VERSION,
  buildDecisionPackets,
  enforceTraceEnvelope,
  hashHex,
  hashJudgeRequest,
  validateDecisionPackets,
} from '../src/evals/trace-packets';
import {
  buildSemanticJudgeContext,
  resolveEffectiveFixtureScenario,
} from '../src/evals/runner';
import {
  evaluateSemanticJudgeOutcome,
  runSemanticJudge,
} from '../src/evals/scorers/semantic-judge';
import { projectSafeTrace } from '../src/runtime/artifact-redaction';
import type { EvalCase, EvalTurnResult } from '../src/evals/case-schema';
import { createEmptyPlan } from '../src/core/plan';
import { attachEvaluationState } from '../src/evals/evaluation-state';

function makeTurn(overrides: Partial<EvalTurnResult> = {}): EvalTurnResult {
  const plan = createEmptyPlan({ planId: 'p1', channel: 'whatsapp', externalUserId: 'u1' });
  return {
    turnIndex: 0,
    input: { text: 'hola', channel: 'whatsapp', sessionId: 's' },
    outputText: 'respuesta candidata final',
    currentNode: 'resolver_consultas_informativas',
    trace: {
      trace_id: 't1',
      conversation_id: null,
      plan_id: plan.plan_id,
      previous_node: 'contacto_inicial',
      next_node: 'resolver_consultas_informativas',
      node_path: ['contacto_inicial', 'resolver_consultas_informativas'],
      intent: null,
      missing_fields: [],
      search_ready: false,
      prompt_bundle_id: 'b1',
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
        status: 'valid',
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
      plan_persist_reason: 'test',
      timing_ms: {
        total: 0, load_plan: 0, prepare_working_plan: 0, extraction: 0,
        apply_extraction: 0, compute_sufficiency: 0, provider_search: 0,
        provider_enrichment: 0, prompt_bundle_load: 0, compose_reply: 0, save_plan: 0,
      },
      token_usage: {
        classifier: null,
        extraction: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        reply: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    },
    plan,
    latencyMs: 0,
    ...overrides,
  } as unknown as EvalTurnResult;
}

function makeCase(overrides: Partial<EvalCase>): EvalCase {
  return {
    id: 'test.case',
    suite: 'test',
    version: 1,
    description: 'test',
    targetModes: ['live_lambda'],
    tags: [],
    variables: {},
    inputs: [{ text: 'hola', channel: 'whatsapp' }],
    expectations: [],
    scorers: [],
    notes: [],
    imports: [],
    priority: 'p2',
    status: 'active',
    ...overrides,
  } as unknown as EvalCase;
}

describe('F packets flow unchanged with redaction and bounds', () => {
  it('builds versioned packets without raw PII or receipts', () => {
    const packets = buildDecisionPackets({
      extraction: {
        actionIntent: 'solicitar_humano',
        humanHelpIntent: 'request',
        phoneConfirmation: 'unclear',
        supportKind: 'report_issue',
        supportTopic: 'mailbox_capacity',
        supportDetail: 'mailbox_full',
        authActions: [],
        requestedOperation: null,
        extractionProfile: 'support',
        rejectedReasons: [],
      },
      authHelp: {
        terminalReason: 'otp_failed',
        sendAttempts: 1,
        verifyAttempts: 1,
        trustedPhonePresent: true,
        manifestAvailable: true,
        manifestReason: null,
        gatewayKind: 'fixture',
        decisionAction: 'handoff',
        decisionReason: 'terminal_before_email',
        attempted: true,
        gatewayOutcome: 'failed',
        requested: false,
        softPaused: false,
        dedupe: 'dispatched',
      },
      purchase: {
        referenceSupplied: true,
        resolution: 'unavailable',
        candidateCount: 1,
        selectedAlias: null,
        authFieldFlags: { phone: true, email: false },
      },
      effects: [
        { operation: 'handoff.write', attempts: 1, successes: 0, replays: 0, outcome: 'failed', receiptPresent: true, scenario: 's06-otp-handoff-failed' },
      ],
      reply: { rendererId: 'scoped_handoff', branchReason: 'phone_information_not_found', instructionBytes: 100, inputBytes: 200, textDigest: hashHex('hola') },
    });
    expect(packets.version).toBe(PACKET_VERSION);
    const serialized = JSON.stringify(packets);
    expect(serialized).not.toMatch(/\+51900000901|COD301816|eyJ[A-Za-z0-9_-]+\./);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const check = validateDecisionPackets(packets);
    expect(check.ok).toBe(true);
  });

  it('rejects unknown version and unknown tools', () => {
    const packets = buildDecisionPackets({
      extraction: {
        actionIntent: null, humanHelpIntent: 'none', phoneConfirmation: null,
        supportKind: null, supportTopic: null, supportDetail: null,
        authActions: [], requestedOperation: null, extractionProfile: 'general', rejectedReasons: [],
      },
      authHelp: {
        terminalReason: null, sendAttempts: 0, verifyAttempts: 0, trustedPhonePresent: false,
        manifestAvailable: true, manifestReason: null, gatewayKind: 'fixture',
        decisionAction: 'none', decisionReason: 'none', attempted: false,
        gatewayOutcome: 'none', requested: false, softPaused: false, dedupe: 'none',
      },
      purchase: { referenceSupplied: false, resolution: 'none', candidateCount: 0, selectedAlias: null, authFieldFlags: { phone: false, email: false } },
      effects: [],
      reply: { rendererId: 'r', branchReason: 'b', instructionBytes: 1, inputBytes: 1, textDigest: hashHex('x') },
    });
    const forged = { ...packets, version: 999 };
    expect(validateDecisionPackets(forged).ok).toBe(false);
    expect(validateDecisionPackets({ ...packets, unknownTool: 'evil_tool' } as unknown as typeof packets).ok).toBe(false);
  });

  it('enforces 8KiB envelope and 16/8 limits dropping candidate detail first', () => {
    const bigCandidates = Array.from({ length: 20 }, (_, index) => ({
      provider_id: index + 1, category: 'local', location: null, retrieval_source: 'test', retrieval_score: 1, fit_score: 1,
    }));
    const bigInputs = Array.from({ length: 20 }, () => ({ tool: 'list_categories', input: '{}' }));
    const trace = { tool_inputs: bigInputs, tool_outputs: bigInputs, provider_candidate_audit: bigCandidates, note: 'x'.repeat(9000) } as unknown as Record<string, unknown>;
    const enforced = enforceTraceEnvelope(trace);
    expect((enforced['tool_inputs'] as unknown[]).length).toBeLessThanOrEqual(MAX_CALL_SUMMARIES);
    expect((enforced['provider_candidate_audit'] as unknown[]).length).toBeLessThanOrEqual(MAX_CANDIDATE_DETAILS);
    expect(Buffer.byteLength(JSON.stringify(enforced), 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES);
    const facts = enforced['truncation'] as Record<string, unknown>;
    expect(facts['truncated']).toBe(true);
    expect(facts['droppedCandidateDetails']).toBeGreaterThan(0);
  });

  it('double projection is idempotent and forged summaries are omitted', () => {
    const raw = {
      tools_called: ['request_human_takeover'],
      tool_inputs: [{ tool: 'request_human_takeover', input: JSON.stringify({ phone_number: '+51900000901' }) }],
      tool_outputs: [{ tool: 'request_human_takeover', output: JSON.stringify({ status: 'requested' }) }],
      provider_candidate_audit: [{ provider_id: 1, category: 'local', location: null, retrieval_source: 's', retrieval_score: 1, fit_score: 1 }],
    };
    const once = projectSafeTrace(raw);
    const twice = projectSafeTrace(once);
    expect(twice).toEqual(once);
    const forged = projectSafeTrace({
      tool_inputs: [{ tool: 'evil_tool', input: JSON.stringify({ foo: 'bar' }) }],
      tool_outputs: [{ tool: 'list_categories', output: JSON.stringify({ projection_version: 999, count: 1 }) }],
    });
    const inputs = forged['tool_inputs'] as Array<Record<string, unknown>>;
    const outputs = forged['tool_outputs'] as Array<Record<string, unknown>>;
    expect(inputs[0]?.['input']).toBe('[omitted]');
    expect(outputs[0]?.['output']).toBe('[omitted]');
    const leak = projectSafeTrace({
      tool_inputs: [{ tool: 'search_providers_by_keyword', input: JSON.stringify({ keyword: 'user@example.com', page: 1 }) }],
    });
    expect(JSON.stringify(leak)).not.toContain('user@example.com');
  });
});

describe('F per-turn fixture resolver has no carry-forward', () => {
  it('override A turn0 then absent turn1 resolves case fixture B', () => {
    const currentCase = makeCase({
      backendFixture: { scenario: 'fixture-B' },
      inputs: [
        { text: 't0', backendFixture: { scenario: 'override-A' } },
        { text: 't1' },
      ],
    });
    expect(resolveEffectiveFixtureScenario(currentCase, 0)).toBe('override-A');
    expect(resolveEffectiveFixtureScenario(currentCase, 1)).toBe('fixture-B');
  });

  it('no case fixture at turn1 resolves real/no-fixture', () => {
    const currentCase = makeCase({
      inputs: [{ text: 't0', backendFixture: { scenario: 'override-A' } }, { text: 't1' }],
    });
    expect(resolveEffectiveFixtureScenario(currentCase, 0)).toBe('override-A');
    expect(resolveEffectiveFixtureScenario(currentCase, 1)).toBeNull();
  });

  it('nine frozen cases resolve to declared worlds every turn', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const ids = [
      'live-behavior-ambiguous-confirmation.yaml',
      'live-behavior-customer-transaction-code-by-phone.yaml',
      'live-behavior-mailbox-continuity-maria-isabel.yaml',
      'live-behavior-otp-auto-resend-once.yaml',
      'live-behavior-otp-not-received.yaml',
      'live-behavior-phone-account-rejected.yaml',
      'live-behavior-phone-missing-information.yaml',
      'live-behavior-repeated-otp-failure.yaml',
      'live-behavior-roberto-reminder-disagreement.yaml',
    ];
    const yaml = await import('yaml');
    for (const file of ids) {
      const raw = await fs.readFile(path.join(process.cwd(), 'evals', 'cases', file), 'utf8');
      const parsed = yaml.parse(raw) as EvalCase;
      const declared = parsed.backendFixture?.scenario ?? null;
      for (let turn = 0; turn < parsed.inputs.length; turn += 1) {
        const inputOverride = (parsed.inputs[turn] as { backendFixture?: { scenario?: string } })?.backendFixture?.scenario;
        const expected = inputOverride ?? declared ?? null;
        expect(resolveEffectiveFixtureScenario(parsed, turn)).toBe(expected);
      }
    }
  });
});

describe('F judge context isolation and digest gate', () => {
  it('isolates candidate vs prior assistant vs fixture history and tool-name is not effect proof', () => {
    const first = makeTurn({ turnIndex: 0, outputText: 'Confirma aqui: hola Sonia Maribel' });
    const second = makeTurn({ turnIndex: 1, outputText: 'Ya solicite apoyo humano', trace: { ...(first.trace as object), tools_called: ['request_human_takeover'] } as never });
    const currentCase = makeCase({
      notes: ['nota del autor'],
      backendFixture: { scenario: 'purchase-sonia-765' },
      inputs: [
        { text: 'pregunta 1', contactPhone: '+51900000001' },
        { text: 'pregunta 2', contactPhone: '+51900000001' },
      ],
    });
    const ctx = buildSemanticJudgeContext([first, second], 1, currentCase);
    expect(ctx).toContain('CANDIDATE RESPONSE');
    expect(ctx).toContain('PRIOR ASSISTANT');
    expect(ctx).toContain('FIXTURE HISTORY');
    expect(ctx).toMatch(/tool-name alone|tool name alone/i);
    expect(ctx).toMatch(/verified effect|effect counts/i);
    expect(ctx).toMatch(/unavailable.*reference|reference.*unavailable/i);
    const candidateSection = ctx.split('CANDIDATE RESPONSE')[1]?.split('PRIOR ASSISTANT')[0] ?? '';
    expect(candidateSection).toContain('Ya solicite apoyo humano');
    expect(ctx).toContain('plan_guardado=si');
    expect(ctx).toContain('rsvp_pending_flow=none');
    expect(ctx).toMatch(/no especules falta de persistencia/i);
  });

  it('provides verified RSVP effect outcomes without relying on a tool-name claim', () => {
    const turn = makeTurn();
    const plan = createEmptyPlan({ planId: 'effect-evidence', channel: 'whatsapp', externalUserId: 'fixture' });
    attachEvaluationState(turn, { plan, input: turn.input, outputText: turn.outputText,
      fixtureEffects: [{ operation: 'rsvp.write', attempts: 1, successes: 1, replays: 0,
        outcome: 'success', receiptPresent: true }] });
    const context = buildSemanticJudgeContext([turn], 0);
    expect(context).toContain('rsvp_pending_flow=none');
    expect(context).toContain('"operation":"rsvp.write"');
    expect(context).toContain('"successes":1');
    expect(context).toContain('"receiptPresent":true');
  });

  it('hashes serialized judge request and validates strictly', async () => {
    const h1 = hashJudgeRequest({ rubric: 'r', candidateText: 'a', context: 'c', model: 'm' });
    const h2 = hashJudgeRequest({ rubric: 'r', candidateText: 'b', context: 'c', model: 'm' });
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h2).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).not.toBe(h2);
    const fakeClient = {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"score": 0.9, "reason": "ok good"}' } }] }) } },
    } as never;
    const good = await runSemanticJudge({ apiKey: 'k', model: 'm', rubric: 'rubric text', candidateText: 'candidate', context: 'ctx', client: fakeClient });
    expect(good.skipped).toBe(false);
    expect(good.score).toBeCloseTo(0.9);
    expect(good.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(good.rubricDigest).toMatch(/^[a-f0-9]{64}$/);
    const badClient = {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] }) } },
    } as never;
    await expect(runSemanticJudge({ apiKey: 'k', model: 'm', rubric: 'r', candidateText: 'c', client: badClient })).rejects.toThrow();
    const missingClient = {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{}] }) } },
    } as never;
    await expect(runSemanticJudge({ apiKey: 'k', model: 'm', rubric: 'r', candidateText: 'c', client: missingClient })).rejects.toThrow();
  });

  it('malformed/missing/skipped judge fails gate when required', () => {
    expect(evaluateSemanticJudgeOutcome({ outcome: { skipped: true, score: 0, message: 'skip' }, minScore: 0.9, requireJudge: true }).passed).toBe(false);
    expect(evaluateSemanticJudgeOutcome({ outcome: { skipped: false, score: 0.89, message: 'below' }, minScore: 0.9, requireJudge: true }).passed).toBe(false);
    expect(evaluateSemanticJudgeOutcome({ outcome: { skipped: false, score: 0.9, message: 'ok' }, minScore: 0.9, requireJudge: true }).passed).toBe(true);
  });
});
