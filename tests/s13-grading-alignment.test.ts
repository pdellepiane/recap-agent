import { describe, expect, it } from 'vitest';

import { buildSemanticJudgeContext } from '../src/evals/runner';
import {
  CUSTOMER_REFERENCE_POLICY_VERSION,
  HANDOFF_FALLBACK_TEXT,
  OTP_POLICY_VERSION,
  projectCustomerReference,
} from '../src/evals/customer-reference-policy';
import type { EvalCase, EvalTurnResult } from '../src/evals/case-schema';
import { createEmptyPlan } from '../src/core/plan';

function makeTurn(overrides: {
  text?: string;
  tools?: string[];
  turnIndex?: number;
}): EvalTurnResult {
  const plan = createEmptyPlan({
    planId: 's13-plan',
    channel: 'whatsapp',
    externalUserId: 's13-user',
  });
  return {
    turnIndex: overrides.turnIndex ?? 0,
    input: { text: overrides.text ?? 'hola', channel: 'whatsapp', sessionId: 's' },
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
      tools_called: overrides.tools ?? ['verify_user_login_code'],
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
  const base = {
    id: 's13.case',
    suite: 'live_behavior_regression',
    version: 1,
    description: 's13',
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

describe('S13 grading alignment', () => {
  it('frames structural facts, note provenance, and disclosure rules for judges', () => {
    const toolCtx = buildSemanticJudgeContext(
      [makeTurn({ tools: ['verify_user_login_code'] })],
      0,
      makeCase({ notes: [] }),
    );
    expect(toolCtx).toContain('verify_user_login_code');
    expect(toolCtx).toMatch(/verificad|estructural/i);
    expect(toolCtx).toMatch(/no debe|no puede|prevalec/i);
    const noteCtx = buildSemanticJudgeContext(
      [makeTurn({})],
      0,
      makeCase({ notes: ['alguna nota del autor'] }),
    );
    expect(noteCtx).toContain('alguna nota del autor');
    expect(noteCtx).toMatch(/procedencia/i);
    expect(noteCtx).toMatch(/mundo congelado|frozen/i);
    const disclosureCtx = buildSemanticJudgeContext(
      [makeTurn({})],
      0,
      makeCase({ notes: [] }),
    );
    expect(disclosureCtx).toMatch(/referencia.*cliente|transaction reference/i);
    expect(disclosureCtx).toMatch(/omit|omitid/i);
  });

  it('scopes fixture history to the case subject instead of dumping all subjects', () => {
    const turns = [makeTurn({ text: 'COD301816' })];
    const currentCase = makeCase({
      inputs: [
        {
          text: 'COD301816',
          channel: 'whatsapp',
          contactPhone: '+51900000001',
          sessionId: 's',
        } as unknown as EvalCase['inputs'][number],
      ],
      backendFixture: { scenario: 'purchase-sonia-765' },
      notes: [],
    });
    const ctx = buildSemanticJudgeContext(turns, 0, currentCase);
    expect(ctx).not.toContain('Hola Sonia Maribel');
  });

  it('discloses a customer reference only when authorized and explicitly supplied', () => {
    expect(
      projectCustomerReference({ customerTransactionNumber: 'COD301816', referenceAuthorized: true }),
    ).toBe('COD301816');
    expect(
      projectCustomerReference({ customerTransactionNumber: 'COD301816', referenceAuthorized: false }),
    ).toBeNull();
    expect(
      projectCustomerReference({ customerTransactionNumber: null, referenceAuthorized: true }),
    ).toBeNull();
    expect(
      projectCustomerReference({ customerTransactionNumber: '  ', referenceAuthorized: true }),
    ).toBeNull();
    expect(
      projectCustomerReference({ customerTransactionNumber: 'order-martha-frozen-pending-01', referenceAuthorized: true }),
    ).toBeNull();
  });

  it('versions the customer-reference and one-shot OTP policies', () => {
    expect(CUSTOMER_REFERENCE_POLICY_VERSION).toMatch(/^2026-09-05-s13/);
    expect(OTP_POLICY_VERSION).toContain('one-shot');
  });

  it('provides distinct Spanish handoff fallback texts for success, failed and unknown', () => {
    expect(HANDOFF_FALLBACK_TEXT.success).toMatch(/human/i);
    expect(HANDOFF_FALLBACK_TEXT.failed).toMatch(/human/i);
    expect(HANDOFF_FALLBACK_TEXT.unknown).toMatch(/human/i);
    expect(new Set(Object.values(HANDOFF_FALLBACK_TEXT)).size).toBe(3);
  });
});
