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
  it('scopes judge context to prior and current turns, excluding the candidate and future turns', () => {
    const ctx = buildSemanticJudgeContext([
      makeTurn('mensaje previo', 0, 'respuesta previa'),
      makeTurn('mensaje actual', 1, 'respuesta candidata'),
    ], 1);
    expect(ctx).toContain('priorUserInputs');
    expect(ctx).toContain('mensaje previo');
    expect(ctx).toContain('respuesta previa');
    expect(ctx).not.toContain('respuesta candidata');
    const current = buildSemanticJudgeContext([
      makeTurn('mensaje actual', 0, 'respuesta candidata'),
      makeTurn('mensaje futuro unico xyz', 1, 'respuesta futura'),
    ], 0);
    expect(current).toContain('mensaje actual');
    expect(current).not.toContain('mensaje futuro unico xyz');
    expect(current).not.toContain('respuesta futura');
  });

  it('projects the trusted case section with fixture provenance, omitting it without notes, fixture, or case', () => {
    const cartInput = {
      text: 'Tengo un carrito abandonado de Carlos y Adriana',
      channel: 'whatsapp',
      contactPhone: '+51965765765',
      sessionId: 's',
    } as unknown as EvalCase['inputs'][number];
    const turns = [makeTurn('Tengo un carrito abandonado de Carlos y Adriana')];
    const currentCase = makeCase({
      inputs: [cartInput],
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
    // campaign provenance travels with the fixture history
    const provenanceCtx = buildSemanticJudgeContext(
      [makeTurn('Tengo un carrito abandonado de Carlos y Adriana')],
      0,
      makeCase({
        inputs: [cartInput],
        notes: [],
        backendFixture: { scenario: 'purchase-sonia-765' },
      }),
    );
    expect(provenanceCtx).toContain('FIXTURE HISTORY');
    expect(provenanceCtx).toContain('"source":"campaign"');
    expect(provenanceCtx).toContain('sent_at');
    const otherTurns = [makeTurn('COD301816')];
    const otherCase = makeCase({
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
    const otherCtx = buildSemanticJudgeContext(otherTurns, 0, otherCase);
    expect(otherCtx).not.toContain('Hola Sonia Maribel');
    expect(otherCtx).toContain('sin mensajes para el sujeto de este caso');

    // Without notes, fixture, or case the trusted section is omitted
    // while the interaction JSON still travels.
    const bareTurns = [makeTurn('hola')];
    const bareCase = makeCase({
      notes: [],
    });
    const bareCtx = buildSemanticJudgeContext(bareTurns, 0, bareCase);
    expect(bareCtx).not.toContain('Contexto confiable reconstruido del caso');
    expect(bareCtx).not.toContain('Notas del caso');
    expect(bareCtx).not.toContain('Historial confiable reciente');
    // still contains interaction JSON
    expect(bareCtx).toContain('hola');
    const caseless = buildSemanticJudgeContext([makeTurn('test without case')], 0);
    expect(caseless).not.toContain('Contexto confiable reconstruido del caso');
    expect(caseless).toContain('test without case');
  });
});

describe('final support rescue judge-evidence completeness (2026-09-16)', () => {
  it('projects candidate-visible pending requests and delivery dispositions', () => {
    const turn = makeTurn('No me llega ningún código.', 0, 'Ya pedimos ayuda humana.');
    const plan = turn.plan as unknown as { information_state: { pending_requests: unknown[] } };
    plan.information_state.pending_requests = [
      {
        requestId: 'information-1',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: 'Revisar el estado del regalo pagado por la persona.',
      },
    ];
    turn.delivery = { action: 'send', reason: 'reply_composed' };
    turn.outputOrigin = {
      status: 'verified',
      candidateSha256: 'a'.repeat(64),
      deliveredSha256: 'a'.repeat(64),
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    };
    const ctx = buildSemanticJudgeContext([turn], 0);
    expect(ctx).toContain('solicitud_pendiente');
    expect(ctx).toContain('Revisar el estado del regalo');
    expect(ctx).toContain('entrega turno 0');
    expect(ctx).toContain('accion=send');
    expect(ctx).toContain('origen=verified');
  });

  it('marks failure dispositions as operational failures, never silence', () => {
    const turn = makeTurn('Es mi comprobante, confirma mi pago con esto.', 0, '');
    turn.delivery = { action: 'failure', reason: 'generation_failed' };
    const ctx = buildSemanticJudgeContext([turn], 0);
    expect(ctx).toContain('accion=failure');
    expect(ctx).toContain('nunca silencio legitimo');
  });

  it('projects retained recommended providers with price levels', () => {
    const turn = makeTurn('Quiero la opción más económica.', 0, 'respuesta');
    const plan = turn.plan as unknown as { provider_needs: unknown[] };
    plan.provider_needs = [
      {
        category: 'Catering',
        status: 'shortlisted',
        selected_provider_ids: [],
        recommended_providers: [
          { id: 90, title: 'Opción Esencial', location: 'Miraflores', priceLevel: 'low' },
          { id: 109, title: 'EDO Sushi Bar', location: 'Barranco', priceLevel: 'high' },
        ],
      },
    ];
    const ctx = buildSemanticJudgeContext([turn], 0);
    expect(ctx).toContain('recommendedProviders');
    expect(ctx).toContain('Miraflores');
    expect(ctx).toContain('priceLevel');
  });
});

describe('finalization output-origin and transport gates', () => {
  it('gates every delivered turn on consistent verified origin evidence', () => {
    const delivered = 'respuesta entregada';
    const sha = hashPrivateOutput(delivered);
    const verifiedOrigin: {
      status: 'verified';
      candidateSha256: string;
      deliveredSha256: string;
      transformationVersion: string;
      mismatchFields: string[];
    } = {
      status: 'verified',
      candidateSha256: sha,
      deliveredSha256: sha,
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    };
    const turn = makeTurn('hola', 0, delivered);
    turn.outputOrigin = { ...verifiedOrigin };
    expect(collectOriginGateFailures([turn])).toEqual([]);
    const verified = makeTurn('primero', 0, delivered);
    verified.outputOrigin = { ...verifiedOrigin };
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

});

describe('judge packet identity under scheduling (O3)', () => {
  it('identifies judge packets by immutable evidence, independent of run order', () => {
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
