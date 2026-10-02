import { describe, expect, it } from 'vitest';

import { hashPrivateOutput } from '../src/audit/output-origin';
import type { EvalTurnResult } from '../src/evals/case-schema';
import {
  collectOriginGateFailures,
  collectTransportGateFailures,
  computeHardGatePassed,
  normalizeZeroTurnResult,
} from '../src/evals/runner';

function minimalTurn(overrides: Record<string, unknown> = {}): EvalTurnResult {
  const text = 'Respuesta del modelo.';
  return {
    turnIndex: 0,
    input: { text: 'hola' },
    outputText: text,
    deliveredText: text,
    outputOrigin: {
      status: 'verified',
      candidateSha256: hashPrivateOutput(text),
      deliveredSha256: hashPrivateOutput(text),
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    },
    currentNode: 'recomendar',
    trace: {
      trace_id: 't-fail',
      conversation_id: 'c',
      plan_id: 'p',
      previous_node: 'contacto_inicial',
      next_node: 'recomendar',
      node_path: ['contacto_inicial', 'recomendar'],
      intent: null,
      missing_fields: [],
      search_ready: false,
      prompt_bundle_id: 'b',
      prompt_file_paths: [],
      tools_considered: [],
      tools_called: [],
      tool_inputs: [],
      tool_outputs: [],
      provider_results: [],
      search_strategy: 'none',
      plan_persisted: true,
      plan_persist_reason: 'recomendar',
      timing_ms: {
        total: 1, load_plan: 0, prepare_working_plan: 0, extraction: 0,
        apply_extraction: 0, compute_sufficiency: 0, provider_search: 0,
        provider_enrichment: 0, prompt_bundle_load: 0, compose_reply: 0, save_plan: 0,
      },
      token_usage: { extraction: null, reply: null, total: null },
      contact_validation_summary: {
        plan_contact_fields_present: { name: false, email: false, phone: false },
      },
      selection_resolution_summary: {
        selected_provider_hints_count: 0,
        provider_plan_operation_types: [],
      },
      information_execution_summary: [],
    },
    plan: {
      plan_id: 'p',
      channel: 'terminal_whatsapp_eval',
      external_user_id: 'u',
      current_node: 'recomendar',
      lifecycle_state: 'active',
    },
    latencyMs: 1,
    ...overrides,
  } as unknown as EvalTurnResult;
}

describe('§6 setup zero-turn is a harness/infrastructure failure with its cause', () => {
  it('forces zero-turn non-errors into errored with the recorded cause', () => {
    const normalized = normalizeZeroTurnResult({ turns: [], status: 'passed' }, 'case-zero');
    expect(normalized.status).toBe('errored');
    expect(normalized.errorMessage).toContain('case-zero');
    expect(normalized.errorMessage).toContain('zero turns');
    const cause = 'RSVP isolation setup failed: External evaluations are restricted to the named coordinator host';
    const preserved = normalizeZeroTurnResult(
      { turns: [], status: 'skipped', errorMessage: cause },
      'case-setup',
    );
    expect(preserved.status).toBe('errored');
    expect(preserved.errorMessage).toBe(cause);
    const skip = normalizeZeroTurnResult({ turns: [], status: 'skipped' }, 'case-skip');
    expect(skip.status).not.toBe('skipped');
    expect(skip.status).not.toBe('passed');
  });

  it('leaves explicit errors and completed turns untouched', () => {
    const errored = { turns: [], status: 'errored' as const, errorMessage: 'boom' };
    expect(normalizeZeroTurnResult(errored, 'case-e')).toBe(errored);
    const done = { turns: [minimalTurn()], status: 'passed' as const };
    expect(normalizeZeroTurnResult(done, 'case-d')).toBe(done);
  });
});

describe('§6 passing expectations never obscure a failed origin or transport gate', () => {
  it('gates the hard pass on expectations plus origin and transport evidence', () => {
    const allPass = [
      { severity: 'hard' as const, passed: true },
      { severity: 'soft' as const, passed: true },
    ];
    expect(computeHardGatePassed({
      expectationResults: allPass,
      originGateFailures: ['turn 0: output-origin status=mismatch'],
      transportGateFailures: [],
    })).toBe(false);
    expect(computeHardGatePassed({
      expectationResults: [{ severity: 'hard' as const, passed: true }],
      originGateFailures: [],
      transportGateFailures: ['turn 0 classifier: transport evidence is missing; absent is not zero'],
    })).toBe(false);
    expect(computeHardGatePassed({
      expectationResults: [
        { severity: 'hard' as const, passed: true },
        { severity: 'soft' as const, passed: false },
      ],
      originGateFailures: [],
      transportGateFailures: [],
    })).toBe(true);
    expect(computeHardGatePassed({
      expectationResults: [{ severity: 'hard' as const, passed: false }],
      originGateFailures: [],
      transportGateFailures: [],
    })).toBe(false);
  });

  it('reports structural, origin, and transport results under separate entries', () => {
    const text = 'Respuesta del modelo.';
    const mismatched = minimalTurn({
      outputOrigin: {
        status: 'mismatch' as const,
        candidateSha256: hashPrivateOutput('otro texto'),
        deliveredSha256: hashPrivateOutput(text),
        transformationVersion: 'transport-v2',
        mismatchFields: ['candidate_sha256'],
      },
      trace: {
        ...(minimalTurn().trace as unknown as Record<string, unknown>),
        openai_calls: { classifier: { requestMetrics: {} } },
      },
    });
    const origin = collectOriginGateFailures([mismatched]);
    const transport = collectTransportGateFailures([mismatched]);
    expect(origin).toHaveLength(1);
    expect(origin[0]).toContain('turn 0');
    expect(transport.length).toBeGreaterThan(0);
    expect(transport[0]).toContain('turn 0 classifier');
    // A clean turn fails neither gate.
    expect(collectOriginGateFailures([minimalTurn()])).toEqual([]);
    expect(collectTransportGateFailures([minimalTurn()])).toEqual([]);
  });
});
