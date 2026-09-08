import { describe, expect, it } from 'vitest';

import type { EvalTurnResult } from '../src/evals/case-schema';
import { buildSemanticJudgeContext } from '../src/evals/runner';

function closeTurn(): EvalTurnResult {
  return {
    turnIndex: 0,
    input: { text: 'Mi evento es el 18 de octubre de 2026. Envia las cotizaciones.' },
    outputText: 'Las solicitudes fueron enviadas para tu evento del 18 de octubre de 2026.',
    currentNode: 'crear_lead_cerrar',
    latencyMs: 1,
    plan: {
      current_node: 'crear_lead_cerrar',
      user_auth: { status: 'none', auth_method: null, awaiting_phone_confirmation: false },
      human_escalation: { status: 'none' },
      provider_needs: [
        { category: 'Catering', status: 'selected', selected_provider_ids: [101] },
        { category: 'Musica', status: 'selected', selected_provider_ids: [202] },
      ],
    },
    trace: {
      previous_node: 'crear_lead_cerrar',
      next_node: 'crear_lead_cerrar',
      tools_called: ['finish_plan'],
      selection_resolution_summary: {
        selected_provider_hints_count: 2,
        provider_plan_operation_types: ['select_provider'],
      },
      information_execution_summary: [],
      finish_plan_summary: {
        status: 'success',
        eventDate: '2026-10-18',
        confirmedCount: 2,
        pendingProviderIds: [],
        errorKind: null,
      },
      provider_quote_receipts: [
        { providerId: 101, eventDate: '2026-10-18', resultStatus: 'confirmed', attempt: 1 },
        { providerId: 202, eventDate: '2026-10-18', resultStatus: 'confirmed', attempt: 1 },
      ],
      contact_validation_summary: {
        plan_contact_fields_present: { name: true, email: true, phone: true },
      },
    },
  } as unknown as EvalTurnResult;
}

describe('F4 judge context carries finish_plan close evidence', () => {
  it('projects verified close facts so the judge cannot deny recorded executions', () => {
    const context = buildSemanticJudgeContext([closeTurn()], undefined);
    expect(context).toContain('finish_plan');
    expect(context).toContain('success');
    expect(context).toContain('2026-10-18');
    expect(context).toContain('101');
    expect(context).toContain('202');
  });

  it('reports no close execution when finish_plan never ran', () => {
    const turn = closeTurn();
    (turn.trace as unknown as { finish_plan_summary: null }).finish_plan_summary = null;
    turn.trace.tools_called = [];
    const context = buildSemanticJudgeContext([turn], undefined);
    expect(context).toContain('cierre=ninguno');
  });
});
