import { describe, expect, it } from 'vitest';

import { buildSemanticJudgeContext } from '../src/evals/runner';
import {
  buildFixturePurchaseFactLines,
  buildFixturePurchaseRecords,
  buildLivePurchaseFactLines,
  formatProjectedPurchaseFact,
  projectLivePurchaseFacts,
  type FixturePurchaseWorld,
  type ProjectedPurchaseFact,
} from '../src/evals/purchase-evidence';
import { createEmptyPlan } from '../src/core/plan';
import type { EvalCase, EvalTurnResult } from '../src/evals/case-schema';

const FACT_HASH = 'd'.repeat(64);

function typedFactEvidence() {
  return [
    {
      fileId: '',
      filename: '',
      score: 0,
      contentHash: FACT_HASH,
      purchaseFact: {
        eventLabel: 'Baby Shower Catalina',
        total: 3173.81,
        currency: 'PEN',
        currencySymbol: 'S/',
        paymentMethod: 'Transferencia',
        paymentStatus: 'pending',
        eventDate: '2026-09-12',
        createdAt: '2026-08-22',
        referencePresent: false,
      },
    },
  ];
}

function legacyBridgeEvidence() {
  return [
    {
      fileId: '',
      filename: 'Baby Shower Catalina',
      score: 3173.81,
      contentHash: FACT_HASH,
    },
  ];
}

function makeTurn(evidence: unknown[] | null): EvalTurnResult {
  const plan = createEmptyPlan({
    planId: 'o5-plan',
    channel: 'whatsapp',
    externalUserId: 'o5-user',
  });
  return {
    turnIndex: 0,
    input: { text: 'hola', channel: 'whatsapp', sessionId: 's' },
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
      information_execution_summary: evidence === null
        ? []
        : [
          {
            requestId: 'purchase-1',
            kind: 'purchase',
            status: 'completed',
            source: 'agent_api',
            outcomeCode: 'completed_with_results',
            retryable: null,
            queryHash: 'b'.repeat(64),
            evidence,
            resultCount: 1,
            durationMs: 5,
            accessMethod: 'trusted_phone_purchase',
            coverage: 'complete',
            resource: 'orders',
          },
        ],
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

function fact(overrides: Partial<ProjectedPurchaseFact> = {}): ProjectedPurchaseFact {
  return {
    kind: 'consulta_en_vivo',
    eventLabel: 'Evento X',
    eventDate: '2026-01-01',
    createdAt: '2026-01-02',
    total: 100,
    currencyCode: 'PEN',
    currencySymbol: 'S/',
    paymentMethod: 'Yape',
    paymentStatus: 'pending',
    referencePresent: false,
    provenance: 'live-lookup',
    contentHash: FACT_HASH,
    ...overrides,
  };
}

describe('O5 typed purchase adapter: values come only from typed facts', () => {
  it('projects typed live-lookup values with the verifiable hash', () => {
    const lines = buildLivePurchaseFactLines([makeTurn(typedFactEvidence())]);
    const text = lines.join('\n');
    expect(text).toContain('evidencia_compra turno 0');
    expect(text).toContain('completed_with_results');
    expect(text).toContain('Baby Shower Catalina');
    expect(text).toContain('3173.81');
    expect(text).toContain('PEN');
    expect(text).toContain('Transferencia');
    expect(text).toContain('pending');
    expect(text).toContain(FACT_HASH);
  });

  it('never decodes the retired filename/score bridge into values', () => {
    const lines = buildLivePurchaseFactLines([makeTurn(legacyBridgeEvidence())]);
    const text = lines.join('\n');
    expect(text).toContain('evidencia_compra turno 0');
    expect(text).toContain('completed_with_results');
    expect(text).not.toContain('Baby Shower Catalina');
    expect(text).not.toContain('3173.81');
    expect(text).toContain('evidencia_compra_datos=no_disponibles');
  });

  it('reports a missing backend read as unknown without demanding a named datum', () => {
    const lines = buildLivePurchaseFactLines([makeTurn(null)]);
    expect(lines.join('\n')).toContain('evidencia_compra=ninguna');
    const bridgeless = buildLivePurchaseFactLines([makeTurn(legacyBridgeEvidence())]).join('\n');
    expect(bridgeless).toContain('desconocido');
    expect(bridgeless).not.toMatch(/debe .* (monto|dato|valor|codigo)/iu);
  });

  it('shares one formatter across fixture and live provenances', () => {
    const live = formatProjectedPurchaseFact(fact({ provenance: 'live-lookup' }), 0);
    const world = formatProjectedPurchaseFact(
      fact({ provenance: 'fixture-world', kind: 'pedido_pendiente' }),
      0,
    );
    for (const token of ['evento=', 'monto=100', 'moneda=PEN (S/)', 'referencia_cliente=ausente']) {
      expect(live).toContain(token);
      expect(world.replace('pedido_pendiente', 'consulta_en_vivo')).toContain(token);
    }
  });

  it('keeps provenance, effect independence and the turn-visible boundary', () => {
    const facts = projectLivePurchaseFacts([makeTurn(typedFactEvidence())]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.provenance).toBe('live-lookup');
    expect(facts[0]?.contentHash).toBe(FACT_HASH);
    // A changed label is a different projection: wrong-event writes stay
    // detectable downstream instead of collapsing to a shared bridge value.
    const mutated = projectLivePurchaseFacts([makeTurn([
      {
        fileId: '',
        filename: '',
        score: 0,
        contentHash: FACT_HASH,
        purchaseFact: {
          eventLabel: 'Evento Equivocado',
          total: 3173.81,
          currency: 'PEN',
          currencySymbol: 'S/',
          paymentMethod: 'Transferencia',
          paymentStatus: 'pending',
          eventDate: null,
          createdAt: null,
          referencePresent: false,
        },
      },
    ])]);
    expect(mutated[0]?.eventLabel).toBe('Evento Equivocado');
    expect(facts[0]?.eventLabel).not.toBe(mutated[0]?.eventLabel);
  });

  it('projects typed fixture-world rows through the same adapter', () => {
    const world: FixturePurchaseWorld = {
      guestOrders: {
        '+51900001303': {
          pending_orders: [
            {
              id: 'order-1',
              event_name: 'Evento de prueba A',
              event_date: '2026-09-12',
              created_at: '2026-08-22',
              grand_total: 120.5,
              currency_code: 'PEN',
              currency_symbol: 'S/',
              payment_method: 'Transferencia',
              payment_status: 'pending',
            },
          ],
          completed_orders: [],
          carts: [],
        },
      },
    };
    const records = buildFixturePurchaseRecords(world, ['+51900001303']);
    expect(records).toHaveLength(1);
    const lines = buildFixturePurchaseFactLines('s13-test', records);
    const text = lines.join('\n');
    expect(text).toContain('proyeccion_compra visible para el candidato');
    expect(text).toContain('Evento de prueba A');
    expect(text).toContain('120.5');
    expect(text).toContain('referencia_cliente=ausente');
  });
});

describe('O5 judge context uses the single typed adapter on both branches', () => {
  function bareCase(): EvalCase {
    return {
      id: 'o5.case',
      suite: 'o5',
      version: 1,
      description: 'o5',
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
  }

  it('typed live facts reach the judge while legacy bridge values do not', () => {
    const typed = buildSemanticJudgeContext([makeTurn(typedFactEvidence())], 0, bareCase());
    expect(typed).toContain('Baby Shower Catalina');
    expect(typed).toContain('3173.81');
    const legacy = buildSemanticJudgeContext([makeTurn(legacyBridgeEvidence())], 0, bareCase());
    expect(legacy).not.toContain('Baby Shower Catalina');
    expect(legacy).not.toContain('3173.81');
    expect(legacy).toContain('no_disponibles');
  });
});
