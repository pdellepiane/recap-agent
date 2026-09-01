import { describe, expect, it } from 'vitest';

import { buildSemanticJudgeContext } from '../src/evals/runner';
import type { EvalCase, EvalTurnResult } from '../src/evals/case-schema';
import { createEmptyPlan } from '../src/core/plan';

function makeTurn(text: string): EvalTurnResult {
  const plan = createEmptyPlan({
    planId: 'test-plan',
    channel: 'whatsapp',
    externalUserId: 'test-user',
  });
  return {
    turnIndex: 0,
    input: {
      text,
      channel: 'whatsapp',
      sessionId: 's',
    },
    outputText: 'respuesta',
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
  it('includes notes and fixture recentMessages when case provides them', () => {
    const turns = [makeTurn('Tengo un carrito abandonado de Carlos y Adriana')];
    const currentCase = makeCase({
      notes: [
        "Contexto confiable reconstruido: el historial saliente verificado contiene el mensaje id 1 outbound campaign body 'Hola Sonia Maribel, hiciste un regalo para Carlos & Adriana pero no terminaste el proceso. Puedes completarlo aqui: https://sinenvolturas.com/cart/recover/ea14739a-4064-4791-a646-aa24b799d2da' con ruta /cart/recover valida.",
      ],
      backendFixture: { scenario: 'purchase-sonia-765' },
    });
    const ctx = buildSemanticJudgeContext(turns, 0, currentCase);
    expect(ctx).toContain('Contexto confiable reconstruido del caso');
    expect(ctx).toContain('Notas del caso');
    expect(ctx).toContain('Hola Sonia Maribel');
    expect(ctx).toContain('https://sinenvolturas.com/cart/recover/ea14739a-4064-4791-a646-aa24b799d2da');
    expect(ctx).toContain('Historial confiable reciente');
    expect(ctx).toContain('"id":1');
    expect(ctx).toContain('"direction":"outbound"');
    // also retains interaction
    expect(ctx).toContain('Tengo un carrito abandonado');
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
