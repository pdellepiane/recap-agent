import { describe, expect, it } from 'vitest';

import { mergePlan, createEmptyPlan } from '../src/core/plan';
import { buildCliResponseBody } from '../src/lambda/handler';
import { lambdaTurnResponseSchema } from '../src/evals/case-schema';
import { redactArtifactRecord, redactArtifactText } from '../src/runtime/artifact-redaction';
import type { TurnTrace } from '../src/core/trace';
import type { HandleTurnResponse } from '../src/runtime/agent-service';

describe('sensitive artifact redaction', () => {
  it('redacts CLI diagnostics while preserving safe authentication evidence', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.cli-canary.signature';
    const phone = '+51973296571';
    const otp = '847261';
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'redaction-plan',
        channel: 'whatsapp',
        externalUserId: 'redaction-user',
      }),
      {
        contact_phone: '51973296571',
        user_auth: {
          status: 'authenticated',
          token,
          token_expires_at: new Date(Date.now() + 60_000).toISOString(),
          auth_method: 'phone',
        },
      },
    );
    const trace = {
      plan_summary: {
        contact_fields_present: { name: false, email: true, phone: true },
        user_auth_status: 'authenticated',
      },
      tool_inputs: [
        { tool: 'auth_by_phone', input: `phone_number=${phone}` },
      ],
      tool_outputs: [
        { tool: 'verify_user_login_code', output: `code=${otp}` },
      ],
    } as unknown as TurnTrace;

    const body = buildCliResponseBody({
      response: {
        outbound: {
          text: 'Respuesta segura.',
          delivery: { action: 'send', reason: 'normal' },
          conversationId: 'conversation-redaction',
        },
        plan,
        trace,
      } as unknown as HandleTurnResponse,
      perf: null,
      includeDiagnostics: true,
    });
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain(otp);
    expect(body.plan).toMatchObject({
      contact_phone: null,
      user_auth: {
        status: 'authenticated',
        auth_method: 'phone',
        token: null,
      },
    });
    expect(body.trace).toMatchObject({
      plan_summary: {
        user_auth_status: 'authenticated',
        contact_fields_present: { phone: true },
      },
    });
  });

  it('preserves structural hashes, ids, statuses, counts, and timestamps', () => {
    const conversationHash = 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567';
    const capturedAt = '2026-08-07T12:34:56.789Z';
    const safe = redactArtifactRecord({
      conversation_hash: conversationHash,
      case_id: 'live_behavior.phone_first_auth_success',
      trace_id: 'trace-20260807-001',
      captured_at: capturedAt,
      status: 'authenticated',
      count: 123456,
    });

    expect(safe).toEqual({
      conversation_hash: conversationHash,
      case_id: 'live_behavior.phone_first_auth_success',
      trace_id: 'trace-20260807-001',
      captured_at: capturedAt,
      status: 'authenticated',
      count: 123456,
    });
  });

  it('redacts credentials and contact values by sensitive key only', () => {
    const token = 'access-token-canary';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.cli-canary.signature';
    const email = 'person@example.com';
    const phone = '51973296571';
    const otp = '847261';
    const safe = redactArtifactRecord({
      plan: {
        contact_email: email,
        contact_phone: phone,
        user_auth: {
          status: 'code_requested',
          auth_method: null,
          token,
          jwt,
          otp,
          code: otp,
        },
      },
      structural_code: 'status-code-is-structural',
    });
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain(otp);
    expect(safe.plan).toEqual({
      contact_email: null,
      contact_phone: null,
      user_auth: {
        status: 'code_requested',
        auth_method: null,
        token: null,
        jwt: null,
        otp: null,
        code: null,
      },
    });
    expect(safe.structural_code).toBe('status-code-is-structural');
  });

  it('uses contextual redaction only for free-text content', () => {
    const text = 'Mi correo es person@example.com y mi teléfono es +51973296571.';

    expect(redactArtifactText(text)).not.toContain('person@example.com');
    expect(redactArtifactText(text)).not.toContain('+51973296571');
    expect(redactArtifactRecord({ conversation_hash: text }).conversation_hash).toBe(text);
  });

  it('preserves calendar years while redacting standalone one-time codes', () => {
    const text = 'El evento será el 12 de septiembre de 2026. El código es 753994.';

    expect(redactArtifactText(text)).toContain('septiembre de 2026');
    expect(redactArtifactText(text)).not.toContain('753994');
    expect(redactArtifactText(text)).toContain('[redacted-code]');
  });

  it('returns a schema-valid redacted handler response', () => {
    const plan = createEmptyPlan({
      planId: 'handler-plan',
      channel: 'terminal_whatsapp',
      externalUserId: 'handler-user',
    });
    const response = {
      outbound: {
        text: 'Respuesta segura.',
        delivery: { action: 'send' as const, reason: 'normal' },
        conversationId: 'conversation-handler',
      },
      plan,
      trace: validTrace(),
    } as unknown as HandleTurnResponse;
    const body = buildCliResponseBody({
      response,
      perf: null,
      includeDiagnostics: true,
    });

    expect(() => lambdaTurnResponseSchema.parse(body)).not.toThrow();
  });
});

function validTrace() {
  return {
    trace_id: 'trace-handler',
    conversation_id: 'conversation-handler',
    plan_id: 'handler-plan',
    previous_node: 'contacto_inicial',
    next_node: 'deteccion_intencion',
    node_path: ['contacto_inicial', 'deteccion_intencion'],
    intent: null,
    missing_fields: [],
    search_ready: false,
    prompt_bundle_id: 'bundle-handler',
    prompt_file_paths: [],
    tools_considered: [],
    tools_called: [],
    tool_inputs: [],
    tool_outputs: [],
    provider_results: [],
    recommendation_funnel: {
      available_candidates: 0,
      context_candidates: 0,
      context_candidate_ids: [],
      presentation_limit: 5,
    },
    search_strategy: 'none',
    close_action_summary: { type: null, category: null, reason_preview: null },
    selection_resolution_summary: {
      selected_provider_references: [],
      selected_provider_hints_count: 0,
      provider_plan_operation_types: [],
      provider_plan_operation_categories: [],
    },
    contact_validation_summary: {
      status: 'not_provided',
      field: null,
      reason_preview: null,
      extraction_contact_fields_present: { name: false, email: false, phone: false },
      plan_contact_fields_present: { name: false, email: false, phone: false },
    },
    provider_candidate_audit: [],
    information_execution_summary: [],
    plan_persisted: true,
    plan_persist_reason: null,
    timing_ms: {
      total: 1,
      load_plan: 0,
      prepare_working_plan: 0,
      extraction: 0,
      apply_extraction: 0,
      compute_sufficiency: 0,
      provider_search: 0,
      provider_enrichment: 0,
      prompt_bundle_load: 0,
      compose_reply: 1,
      save_plan: 0,
    },
    token_usage: { extraction: null, reply: null, total: null },
  };
}
