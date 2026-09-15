import { describe, expect, it } from 'vitest';

import { buildSemanticJudgeContext } from '../src/evals/runner';
import { createEmptyPlan } from '../src/core/plan';
import type { EvalCase, EvalTurnResult } from '../src/evals/case-schema';

const FAQ_HASH = 'a'.repeat(64);
const PURCHASE_HASH = 'c'.repeat(64);

function makeTurn(overrides: {
  text?: string;
  outputText?: string;
  turnIndex?: number;
  summary?: string;
  faqEvidence?: boolean;
  purchaseEvidence?: boolean;
  toolsCalled?: string[];
}): EvalTurnResult {
  const plan = createEmptyPlan({
    planId: 'test-plan',
    channel: 'whatsapp',
    externalUserId: 'test-user',
  });
  if (overrides.summary !== undefined) {
    plan.conversation_summary = overrides.summary;
  }
  return {
    turnIndex: overrides.turnIndex ?? 0,
    input: {
      text: overrides.text ?? 'hola',
      channel: 'whatsapp',
      sessionId: 's',
    },
    outputText: overrides.outputText ?? 'respuesta',
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
      tools_called: overrides.toolsCalled ?? ['lookup_guest_orders_by_phone'],
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
      information_execution_summary: overrides.faqEvidence
        ? [
          {
            requestId: 'faq-1',
            kind: 'faq',
            status: 'completed',
            source: 'knowledge_base',
            outcomeCode: 'completed_with_results',
            retryable: null,
            queryHash: 'b'.repeat(64),
            evidence: [
              {
                fileId: 'faq-file-1',
                filename: 'politica-pagos.md',
                score: 0.92,
                contentHash: FAQ_HASH,
              },
            ],
            resultCount: 1,
            durationMs: 5,
          },
        ]
        : overrides.purchaseEvidence
          ? [
            {
              requestId: 'purchase-1',
              kind: 'purchase',
              status: 'completed',
              source: 'agent_api',
              outcomeCode: 'completed_with_results',
              retryable: null,
              queryHash: 'b'.repeat(64),
              evidence: [
                {
                  fileId: '',
                  filename: '',
                  score: 0,
                  contentHash: PURCHASE_HASH,
                  purchaseFact: {
                    eventLabel: 'Baby Shower Catalina',
                    total: 3173.81,
                    currency: null,
                    currencySymbol: null,
                    paymentMethod: null,
                    paymentStatus: 'pending',
                    eventDate: null,
                    createdAt: null,
                    referencePresent: false,
                  },
                },
              ],
              resultCount: 1,
              durationMs: 5,
              accessMethod: 'trusted_phone_purchase',
              coverage: 'complete',
              resource: 'orders',
            },
          ]
          : [],
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

function s13Case(): EvalCase {
  return makeCase({
    inputs: [
      {
        text: 'COD301816',
        channel: 'whatsapp',
        contactPhone: '+51900001303',
        sessionId: 's',
      } as unknown as EvalCase['inputs'][number],
    ],
    backendFixture: { scenario: 's13-reference-unavailable-multiple' },
  });
}

describe('EX1 candidate-visible evidence projection', () => {
  it('projects s13 phone-scoped purchase values with grounded PEN currency', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, s13Case());
    expect(ctx).toContain('proyeccion_compra');
    expect(ctx).toContain('Evento de prueba A');
    expect(ctx).toContain('Evento de prueba B');
    expect(ctx).toContain('120.5');
    expect(ctx).toContain('89.9');
    expect(ctx).toContain('PEN');
    expect(ctx).toContain('S/');
    expect(ctx).toContain('Transferencia');
    expect(ctx).toContain('pending');
    expect(ctx).toContain('approved');
    expect(ctx).toContain('2026-09-12');
    expect(ctx).toContain('2026-08-22');
  });

  it('never leaks opaque order ids, reference values, or phones in the projection', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, s13Case());
    expect(ctx).not.toContain('order-s13-multiple-a-01');
    expect(ctx).not.toContain('order-s13-multiple-b-01');
    expect(ctx).not.toContain('51900001303');
    expect(ctx).toContain('referencia_cliente=ausente');
  });

  it('marks currency absent when the world carries none (victor)', () => {
    const victor = makeCase({
      inputs: [
        {
          text: 'Revisa el regalo de S/ 80 para Samuel Josué',
          channel: 'whatsapp',
          contactPhone: '+51981056171',
          sessionId: 's',
        } as unknown as EvalCase['inputs'][number],
      ],
      backendFixture: { scenario: 'purchase-victor-171' },
    });
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, victor);
    expect(ctx).toContain('Samuel Josue');
    expect(ctx).toContain('moneda=ausente');
    expect(ctx).toContain('Yape_o_Plin');
    expect(ctx).toContain('referencia_cliente=presente');
  });

  it('projects live purchase lookup values for fixture-less turns', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({ purchaseEvidence: true })], 0);
    expect(ctx).toContain('evidencia_compra');
    expect(ctx).toContain('Baby Shower Catalina');
    expect(ctx).toContain('3173.81');
    expect(ctx).toContain(PURCHASE_HASH);
    expect(ctx).toContain('completed_with_results');
  });

  it('reports missing live purchase evidence as unknown, never success', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0);
    expect(ctx).toContain('evidencia_compra=ninguna');
  });

  it('projects retrieved FAQ evidence hash and filename', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({ faqEvidence: true })], 0, s13Case());
    expect(ctx).toContain('evidencia_faq');
    expect(ctx).toContain('politica-pagos.md');
    expect(ctx).toContain(FAQ_HASH);
    expect(ctx).toContain('completed_with_results');
  });

  it('reports missing FAQ evidence instead of inventing policy grounding', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, s13Case());
    expect(ctx).toContain('evidencia_faq=ninguna');
  });

  it('projects seeded conversation-summary facts as candidate-visible continuity', () => {
    const ctx = buildSemanticJudgeContext(
      [makeTurn({ summary: 'La campaña de carrito abandonado era para ANDREA & RODRIGO.' })],
      0,
      s13Case(),
    );
    expect(ctx).toContain('resumen_conversacion');
    expect(ctx).toContain('ANDREA & RODRIGO');
  });

  it('marks system operational notes as system-provided, never candidate invention', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, s13Case());
    expect(ctx).toContain('72 horas habiles');
    expect(ctx).toContain('saldo restante');
    expect(ctx).toContain('origen: sistema');
  });

  it('keeps operational notes and summary rules without a case but omits fixture purchases', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({ summary: 'hilo previo de soporte' })], 0);
    expect(ctx).toContain('72 horas habiles');
    expect(ctx).toContain('hilo previo de soporte');
    // Packet A carries sanitized tool facts even without a case, so the bare
    // token also appears in the shared fixture-less judge rule. Absence of a
    // fixture world is proven by the missing purchase projection header.
    expect(ctx).not.toContain('proyeccion_compra visible para el candidato');
    expect(ctx).toContain('hechos_herramienta');
  });

  it('binds purchase credibility to a completed lookup and echo to the user message', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, s13Case());
    expect(ctx).toContain('solo cuando la evidencia estructural muestra una consulta de compra completada con resultados');
    expect(ctx).toContain('es eco, nunca invencion');
  });

  it('projects fixture-backed event place labels so a grounded Lima is not invention', () => {
    const rsvpCase = makeCase({
      inputs: [
        {
          text: 'Hola',
          channel: 'whatsapp',
          contactPhone: '+51941438999',
          sessionId: 's',
        } as unknown as EvalCase['inputs'][number],
      ],
      backendFixture: { scenario: 'rsvp-plus-one-multiple-pending' },
    });
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, rsvpCase);
    expect(ctx).toContain('proyeccion_evento');
    expect(ctx).toContain('Lima');
  });
});

describe('Packet A sanitized tool facts and no-image-or-URL contract', () => {
  const purchaseLookup = {
    requestId: 'purchase-1',
    kind: 'purchase',
    status: 'completed',
    source: 'agent_api',
    outcomeCode: 'completed_with_results',
    retryable: null,
    queryHash: 'c'.repeat(64),
    evidence: [],
    resultCount: 2,
    durationMs: 5,
    accessMethod: 'trusted_phone_purchase',
    resource: 'orders',
    coverage: 'complete',
  };

  function fixtureLessDeliaCase(): EvalCase {
    return makeCase({
      inputs: [
        {
          text: 'Ya pagué el regalo para Caroline & Jason. ¿Mi pago está aprobado?',
          channel: 'whatsapp',
          contactPhone: '+51962983263',
          sessionId: 's',
        } as unknown as EvalCase['inputs'][number],
      ],
    });
  }

  function makeLookupTurn(withLookup: boolean): EvalTurnResult {
    const turn = makeTurn({ toolsCalled: ['lookup_guest_orders_by_phone'] });
    (turn.trace as unknown as { information_execution_summary: unknown }).information_execution_summary =
      withLookup ? [purchaseLookup] : [];
    return turn;
  }

  it('projects sanitized tool facts for fixture-backed and fixture-less cases alike', () => {
    const backed = buildSemanticJudgeContext([makeLookupTurn(true)], 0, s13Case());
    const less = buildSemanticJudgeContext([makeLookupTurn(true)], 0, fixtureLessDeliaCase());
    for (const ctx of [backed, less]) {
      expect(ctx).toContain('hechos_herramienta');
      expect(ctx).toContain('purchase:completed:completed_with_results');
      expect(ctx).toContain('resultados=2');
      expect(ctx).toContain('lookup_guest_orders_by_phone');
    }
    expect(less).toContain('sin_mundo_fixture');
    expect(backed).toContain('proyeccion_compra visible para el candidato');
  });

  it('same amount lacks grounding with absent evidence and gains it with a matching backend fact', () => {
    const absent = buildSemanticJudgeContext([makeLookupTurn(false)], 0, fixtureLessDeliaCase());
    expect(absent).toContain('sin_mundo_fixture');
    expect(absent).toContain('consultas=ninguna');
    expect(absent).not.toContain('3173.81');
    const matching = buildSemanticJudgeContext([makeLookupTurn(true)], 0, s13Case());
    expect(matching).toContain('120.5');
    expect(matching).toContain('purchase:completed:completed_with_results');
  });

  it('wrong amounts and polarities stay absent from evidence while actual statuses persist', () => {
    const backed = buildSemanticJudgeContext([makeLookupTurn(true)], 0, s13Case());
    const less = buildSemanticJudgeContext([makeLookupTurn(true)], 0, fixtureLessDeliaCase());
    for (const ctx of [backed, less]) {
      expect(ctx).not.toContain('9999.99');
      expect(ctx).not.toContain('reembolsado_xyz');
    }
    expect(backed).toContain('estado_pago=pending');
    expect(backed).toContain('estado_pago=approved');
  });

  it('judge rules forbid image or URL requests and treat repetition as quality', () => {
    const ctx = buildSemanticJudgeContext([makeTurn({})], 0, s13Case());
    expect(ctx).toMatch(/nunca debe pedir al cliente una imagen/u);
    expect(ctx).toMatch(/llegan solo desde el backend/u);
    expect(ctx).toMatch(/Repeticion: repetir informacion ya entregada es calidad/u);
    expect(ctx).toMatch(/sin_mundo_fixture o no_disponible/u);
  });
});
