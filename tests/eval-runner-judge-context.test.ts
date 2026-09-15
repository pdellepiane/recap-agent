import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';

import { buildSemanticJudgeContext, collectOriginGateFailures, collectTransportGateFailures } from '../src/evals/runner';
import { hashPrivateOutput } from '../src/audit/output-origin';
import type { EvalCase, EvalTurnResult } from '../src/evals/case-schema';
import { createEmptyPlan } from '../src/core/plan';

function makeTurn(text: string, turnIndex = 0, outputText = 'respuesta'): EvalTurnResult {
  const plan = createEmptyPlan({
    planId: 'test-plan',
    channel: 'whatsapp',
    externalUserId: 'test-user',
  });
  return {
    turnIndex,
    input: {
      text,
      channel: 'whatsapp',
      sessionId: 's',
    },
    outputText,
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
      tools_called: ['lookup_guest_orders_by_phone'],
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
        plan_contact_fields_present: { name: false, email: false, phone: true },
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
        total: 0,
        load_plan: 0,
        prepare_working_plan: 0,
        extraction: 0,
        apply_extraction: 0,
        compute_sufficiency: 0,
        provider_search: 0,
        provider_enrichment: 0,
        prompt_bundle_load: 0,
        compose_reply: 0,
        save_plan: 0,
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
  } as unknown as EvalTurnResult;
}

function makeCase(overrides: Partial<EvalCase>): EvalCase {
  const base: EvalCase = {
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
  } as unknown as EvalCase;
  return { ...base, ...overrides } as EvalCase;
}

describe('buildSemanticJudgeContext judge-context completeness', () => {
  it('keeps prior user inputs and assistant responses but excludes the candidate', () => {
    const ctx = buildSemanticJudgeContext([
      makeTurn('mensaje previo', 0, 'respuesta previa'),
      makeTurn('mensaje actual', 1, 'respuesta candidata'),
    ], 1);
    expect(ctx).toContain('priorUserInputs');
    expect(ctx).toContain('mensaje previo');
    expect(ctx).toContain('respuesta previa');
    expect(ctx).not.toContain('respuesta candidata');
  });

  it('includes notes and fixture recentMessages when case provides them', () => {
    const turns = [makeTurn('Tengo un carrito abandonado de Carlos y Adriana')];
    const currentCase = makeCase({
      inputs: [
        {
          text: 'Tengo un carrito abandonado de Carlos y Adriana',
          channel: 'whatsapp',
          contactPhone: '+51965765765',
          sessionId: 's',
        } as unknown as EvalCase['inputs'][number],
      ],
      notes: [
        "Contexto confiable reconstruido: el historial saliente verificado contiene el mensaje id 1 outbound campaign body 'Hola Sonia Maribel, hiciste un regalo para Carlos & Adriana pero no terminaste el proceso. Puedes completarlo aqui: https://sinenvolturas.com/cart/recover/ea14739a-4064-4791-a646-aa24b799d2da' con ruta /cart/recover valida.",
      ],
      backendFixture: { scenario: 'purchase-sonia-765' },
    });
    const ctx = buildSemanticJudgeContext(turns, 0, currentCase);
    expect(ctx).toContain('Contexto confiable reconstruido del caso');
    expect(ctx).toContain('Notas del caso');
    expect(ctx).toContain('procedencia');
    expect(ctx).toContain('Hola Sonia Maribel');
    expect(ctx).toContain('https://sinenvolturas.com/cart/recover/');
    expect(ctx).toContain('FIXTURE HISTORY');
    expect(ctx).toContain('"id":1');
    expect(ctx).toContain('"direction":"outbound"');
    // also retains interaction
    expect(ctx).toContain('Tengo un carrito abandonado');
  });

  it('excludes fixture messages from other subjects', () => {
    const turns = [makeTurn('COD301816')];
    const currentCase = makeCase({
      inputs: [
        {
          text: 'COD301816',
          channel: 'whatsapp',
          contactPhone: '+51900000001',
          sessionId: 's',
        } as unknown as EvalCase['inputs'][number],
      ],
      notes: [],
      backendFixture: { scenario: 'purchase-sonia-765' },
    });
    const ctx = buildSemanticJudgeContext(turns, 0, currentCase);
    expect(ctx).not.toContain('Hola Sonia Maribel');
    expect(ctx).toContain('sin mensajes para el sujeto de este caso');
  });

  it('omits trusted section when case has no notes and no fixture', () => {
    const turns = [makeTurn('hola')];
    const currentCase = makeCase({
      notes: [],
    });
    const ctx = buildSemanticJudgeContext(turns, 0, currentCase);
    expect(ctx).not.toContain('Contexto confiable reconstruido del caso');
    expect(ctx).not.toContain('Notas del caso');
    expect(ctx).not.toContain('Historial confiable reciente');
    // still contains interaction JSON
    expect(ctx).toContain('hola');
  });

  it('returns same as before when currentCase is undefined', () => {
    const turns = [makeTurn('test without case')];
    const ctx = buildSemanticJudgeContext(turns, 0);
    expect(ctx).not.toContain('Contexto confiable reconstruido del caso');
    expect(ctx).toContain('test without case');
  });
});

describe('finalization output-origin and transport gates', () => {
  it('passes every delivered turn with consistent verified evidence', () => {
    const delivered = 'respuesta entregada';
    const sha = hashPrivateOutput(delivered);
    const turn = makeTurn('hola', 0, delivered);
    turn.outputOrigin = {
      status: 'verified',
      candidateSha256: sha,
      deliveredSha256: sha,
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    };
    expect(collectOriginGateFailures([turn])).toEqual([]);
  });

  it('fails an inconsistent hash on an unjudged intermediate turn', () => {
    const delivered = 'respuesta entregada';
    const sha = hashPrivateOutput(delivered);
    const verified = makeTurn('primero', 0, delivered);
    verified.outputOrigin = {
      status: 'verified',
      candidateSha256: sha,
      deliveredSha256: sha,
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    };
    const intermediate = makeTurn('intermedio', 1, 'texto reemplazado');
    intermediate.outputOrigin = {
      status: 'mismatch',
      candidateSha256: hashPrivateOutput('candidato'),
      deliveredSha256: hashPrivateOutput('texto reemplazado'),
      transformationVersion: 'transport-v2',
      mismatchFields: ['delivered_text'],
    };
    const failures = collectOriginGateFailures([verified, intermediate]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('turn 1');
  });

  it('fails a completed model stage with missing transport aggregates', () => {
    const turn = makeTurn('hola');
    (turn.trace as unknown as { openai_calls: unknown }).openai_calls = {
      classifier: null,
      extraction: null,
      reply: {
        responseId: 'resp-1',
        requestId: 'req-1',
        model: 'gpt-5.6-luna',
        attemptCount: 1,
        requestMetrics: {
          instructionBytes: 10,
          inputBytes: 20,
          toolCount: 0,
          schemaPropertyCount: 2,
          transport: {
            observedRequestCount: 1,
            totalPayloadBytes: null,
            instructionBytes: null,
            inputBytes: null,
            toolBytes: null,
            outputSchemaBytes: null,
            requests: [],
          },
        },
      },
    };
    const failures = collectTransportGateFailures([turn]);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('; ')).toContain('turn 0 reply');
  });

  it('excludes future turns from the candidate-visible judge packet', () => {
    const ctx = buildSemanticJudgeContext([
      makeTurn('mensaje actual', 0, 'respuesta candidata'),
      makeTurn('mensaje futuro unico xyz', 1, 'respuesta futura'),
    ], 0);
    expect(ctx).toContain('mensaje actual');
    expect(ctx).not.toContain('mensaje futuro unico xyz');
    expect(ctx).not.toContain('respuesta futura');
  });
});

describe('judge packet identity under scheduling (O3)', () => {
  it('builds byte-identical contexts for identical evidence regardless of run order', () => {
    const turns = [
      makeTurn('mensaje previo', 0, 'respuesta previa'),
      makeTurn('mensaje actual', 1, 'respuesta candidata'),
    ];
    const first = buildSemanticJudgeContext(turns, 1);
    const second = buildSemanticJudgeContext([
      makeTurn('mensaje previo', 0, 'respuesta previa'),
      makeTurn('mensaje actual', 1, 'respuesta candidata'),
    ], 1);
    expect(first).toBe(second);
  });

  it('changes the judge context when immutable evidence changes', () => {
    const before = buildSemanticJudgeContext([makeTurn('mensaje actual', 0, 'respuesta')], 0);
    const after = buildSemanticJudgeContext([makeTurn('mensaje distinto', 0, 'respuesta')], 0);
    expect(before).not.toBe(after);
  });

  it('traces each judge result to its own immutable evidence digest', async () => {
    const { runSemanticJudge, hashJudgePayload } = await import('../src/evals/scorers/semantic-judge');
    const seen: Array<Record<string, unknown>> = [];
    const create = async (request: Record<string, unknown>): Promise<unknown> => {
      seen.push(request);
      return { choices: [{ message: { content: '{"score":1,"reason":"Cumple."}' } }] };
    };
    const client = { chat: { completions: { create } } } as unknown as {
      chat: { completions: { create: typeof create } };
    };
    const turns = [makeTurn('mensaje actual', 0, 'respuesta candidata')];
    const judgeContext = buildSemanticJudgeContext(turns, 0);
    const outcome = await runSemanticJudge({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      rubric: 'rubrica estable',
      candidateText: 'respuesta candidata',
      context: judgeContext,
      client: client as unknown as OpenAI,
    });
    expect(seen).toHaveLength(1);
    // The recorded digests identify this exact rubric and evidence.
    expect(outcome.rubricDigest).toBe(hashJudgePayload('rubrica estable'));
    expect(outcome.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(outcome.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    const userContent = JSON.stringify((seen[0]?.['messages'] as Array<Record<string, unknown>>)[1]);
    expect(userContent).toContain('respuesta candidata');
    expect(outcome.message).toContain(`requestHash=${outcome.requestHash}`);
  });
});
