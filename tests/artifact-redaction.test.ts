import { describe, expect, it } from 'vitest';

import { mergePlan, createEmptyPlan, type PlanSnapshot } from '../src/core/plan';
import { buildCliResponseBody } from '../src/lambda/handler';
import { lambdaTurnResponseSchema, turnTraceSchema } from '../src/evals/case-schema';
import {
  projectSafePlan,
  projectSafeTrace,
  redactArtifactRecord,
  redactArtifactText,
  redactPublicResponseText,
} from '../src/runtime/artifact-redaction';
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

  it('keeps effect receipts when transport detail makes a trace large', () => {
    const request = {
      sequence: 0,
      stage: 'reply',
      requestId: 'request-id',
      responseId: 'response-id',
      statusCode: 200,
      succeeded: true,
      totalPayloadBytes: 20_000,
      instructionBytes: 12_000,
      inputBytes: 7_000,
      toolBytes: 500,
      outputSchemaBytes: 300,
      requestBodySha256: 'a'.repeat(64),
    };
    const call = {
      responseId: 'response-id',
      requestId: 'request-id',
      model: 'gpt-test',
      attemptCount: 2,
      requestMetrics: {
        instructionBytes: 12_000,
        inputBytes: 7_000,
        toolCount: 1,
        schemaPropertyCount: 2,
        transport: {
          observedRequestCount: 2,
          totalPayloadBytes: 40_000,
          instructionBytes: 24_000,
          inputBytes: 14_000,
          toolBytes: 1_000,
          outputSchemaBytes: 600,
          requests: [request, { ...request, sequence: 1 }],
        },
      },
    };
    const trace = projectSafeTrace({
      ...validTrace(),
      openai_calls: { classifier: call, extraction: call, reply: call },
      provider_candidate_audit: Array.from({ length: 8 }, (_, index) => ({
        provider_id: index + 1,
        category: 'Catering',
        location: 'Lima',
        retrieval_source: 'vector_search',
        retrieval_score: 0.9,
        fit_score: 0.8,
        detail: 'x'.repeat(700),
      })),
      information_execution_summary: [{
        requestId: 'information-1',
        kind: 'faq',
        status: 'completed',
        source: 'knowledge_base',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'b'.repeat(64),
        evidence: [{ fileId: 'file-1', filename: 'faq.md', score: 0.9, contentHash: 'c'.repeat(64) }],
        resultCount: 1,
        durationMs: 10,
        openAiTransport: {
          observedRequestCount: 1,
          totalPayloadBytes: 2_000,
          instructionBytes: 1_000,
          inputBytes: 800,
          toolBytes: 100,
          outputSchemaBytes: 100,
        },
      }],
      tool_inputs: [
        { tool: 'create_quote_request', input: JSON.stringify({ provider_id: 90, event_date: '2026-10-18', guests_range: '51-100', description: 'x' }) },
        { tool: 'guest_rsvp', input: JSON.stringify({ guest_id: 12, action: 'attending', trusted_phone_present: true }) },
        { tool: 'finish_plan', input: JSON.stringify({ event_date: '2026-10-18', name: 'Carolina' }) },
      ],
      tool_outputs: [
        { tool: 'create_quote_request', output: JSON.stringify({ status: 'success', providerId: 90, eventDate: '2026-10-18', id: 'receipt-1' }) },
        { tool: 'guest_rsvp', output: JSON.stringify({ status: 'responded', action: 'attending', guest_id: 12 }) },
        { tool: 'finish_plan', output: JSON.stringify({ status: 'success', eventDate: '2026-10-18', contacted_providers: [{ providerId: 90, category: 'Fotografía y video', success: true }] }) },
      ],
    });
    const serialized = JSON.stringify(trace);

    expect(Buffer.byteLength(serialized, 'utf8')).toBeGreaterThan(8192);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(12288);
    expect(serialized).not.toContain('requestBodySha256');
    expect(serialized).not.toContain('"requests"');
    expect((trace.tool_inputs as Array<Record<string, unknown>>).map((entry) => entry.tool)).toEqual([
      'create_quote_request',
      'guest_rsvp',
      'finish_plan',
    ]);
    expect((trace.tool_outputs as Array<Record<string, unknown>>).map((entry) => entry.tool)).toEqual([
      'create_quote_request',
      'guest_rsvp',
      'finish_plan',
    ]);
    const parsedTrace = turnTraceSchema.parse(trace);
    const parsedLambdaTrace = lambdaTurnResponseSchema.shape.trace.parse(trace);
    expect(parsedTrace.openai_calls?.classifier?.requestMetrics.transport).toMatchObject({
      observedRequestCount: 2,
      totalPayloadBytes: 40_000,
      instructionBytes: 24_000,
      inputBytes: 14_000,
      toolBytes: 1_000,
      outputSchemaBytes: 600,
      requests: [],
    });
    expect(parsedLambdaTrace.openai_calls?.reply?.requestMetrics.transport).toMatchObject({
      observedRequestCount: 2,
      requests: [],
    });
    expect(parsedTrace.information_execution_summary[0]?.openAiTransport).toMatchObject({
      observedRequestCount: 1,
      totalPayloadBytes: 2_000,
      requests: [],
    });
    expect(parsedTrace.tool_inputs.map((entry) => entry.tool)).toEqual([
      'create_quote_request',
      'guest_rsvp',
      'finish_plan',
    ]);
    expect(parsedTrace.tool_outputs.map((entry) => entry.tool)).toEqual([
      'create_quote_request',
      'guest_rsvp',
      'finish_plan',
    ]);
  });
});

describe('S3 public plan projection: image refs and last-response text', () => {
  const rawFileId = 'file-SYNTHETIC-private';
  const rawUrl = 'https://files.example.com/s/signed-payload?token=abc123';
  const rawEmail = 'synthetic@example.test';
  const rawPhone = '+51973296571';
  const rawCode = '847261';
  const rawDigest = 'b'.repeat(64);

  function s3Plan(): PlanSnapshot {
    const base = createEmptyPlan({
      planId: 's3-plan',
      channel: 'whatsapp',
      externalUserId: 's3-user',
    });
    return {
      ...base,
      image_attachments: [
        {
          kind: 'file',
          fileId: rawFileId,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          mimeType: 'image/png',
          byteLength: 1024,
          contentDigest: rawDigest,
          messageId: 'wamid.current1',
          receivedAt: new Date(Date.now() - 1000).toISOString(),
        },
        {
          kind: 'url',
          url: rawUrl,
          messageId: 'wamid.url1',
          receivedAt: new Date(Date.now() - 2000).toISOString(),
        },
      ],
      last_outbound_context: {
        message_id: 'wamid.latest1',
        text: `Tu comprobante ${rawFileId} esta en ${rawUrl} escribe a ${rawEmail} o llama al ${rawPhone} con el codigo ${rawCode} resumen ${rawDigest}.`,
        text_truncated: false,
        recorded_at: new Date().toISOString(),
        delivery_evidence: 'constructed',
      },
    };
  }

  it('omits raw file IDs, URLs, and digests while exposing typed safe observations', () => {
    const safe = projectSafePlan(s3Plan());
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain(rawFileId);
    expect(serialized).not.toContain(rawUrl);
    expect(serialized).not.toContain(rawDigest);
    expect(serialized).not.toContain('wamid.current1');
    expect(serialized).not.toContain('wamid.url1');
    expect(safe.image_attachments).toEqual([]);
    expect(safe.image_attachment_count).toBe(2);
    expect(safe.image_attachment_observations).toHaveLength(2);
    const fileObservation = safe.image_attachment_observations.find((entry) => entry.kind === 'file');
    expect(fileObservation).toMatchObject({
      kind: 'file',
      active: true,
      expired: false,
      mimeType: 'image/png',
      byteLength: 1024,
      messageMatch: 'unknown',
    });
    expect(typeof fileObservation?.refFingerprint).toBe('string');
    expect(fileObservation?.refFingerprint).not.toContain(rawFileId);
    const urlObservation = safe.image_attachment_observations.find((entry) => entry.kind === 'url');
    expect(urlObservation).toMatchObject({ kind: 'url', active: true, expired: false });
  });

  it('redacts last-response text with the shared public-response policy', () => {
    const safe = projectSafePlan(s3Plan());
    const redacted = safe.last_outbound_context?.text ?? '';

    expect(redacted).not.toContain(rawFileId);
    expect(redacted).not.toContain(rawUrl);
    expect(redacted).not.toContain(rawEmail);
    expect(redacted).not.toContain(rawPhone);
    expect(redacted).not.toContain(rawCode);
    expect(redacted).not.toContain(rawDigest);
    expect(redacted).toContain('[redacted-file]');
    expect(redacted).toContain('[redacted-url]');
    expect(redacted).toContain('[redacted-email]');
    expect(redacted).toContain('[redacted-phone]');
    expect(redacted).toContain('[redacted-code]');
    expect(redacted).toContain('[redacted-digest]');
    expect(safe.last_outbound_context).toMatchObject({
      message_id: 'wamid.latest1',
      text_truncated: false,
      delivery_evidence: 'constructed',
    });
  });

  it('marks current versus prior message linkage only from the observed ID', () => {
    const plan = s3Plan();
    const matched = projectSafePlan(plan, { observedMessageId: 'wamid.current1' });
    expect(
      matched.image_attachment_observations.find((entry) => entry.kind === 'file')?.messageMatch,
    ).toBe('current');
    expect(
      matched.image_attachment_observations.find((entry) => entry.kind === 'url')?.messageMatch,
    ).toBe('prior');
  });

  it('flags expired file refs without leaking their identity', () => {
    const plan = s3Plan();
    plan.image_attachments = [
      {
        kind: 'file',
        fileId: rawFileId,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        mimeType: 'image/png',
        byteLength: 512,
        contentDigest: rawDigest,
        messageId: 'wamid.expired1',
        receivedAt: new Date(Date.now() - 500_000).toISOString(),
      },
    ];
    const safe = projectSafePlan(plan);
    expect(safe.image_attachment_observations[0]).toMatchObject({
      kind: 'file',
      active: false,
      expired: true,
    });
    expect(JSON.stringify(safe)).not.toContain(rawFileId);
  });

  it('never mutates the private plan snapshot', () => {
    const plan = s3Plan();
    const beforeAttachments = JSON.stringify(plan.image_attachments);
    const beforeLastOutbound = JSON.stringify(plan.last_outbound_context);
    projectSafePlan(plan, { observedMessageId: 'wamid.current1' });

    expect(JSON.stringify(plan.image_attachments)).toBe(beforeAttachments);
    expect(JSON.stringify(plan.last_outbound_context)).toBe(beforeLastOutbound);
    expect(JSON.stringify(plan)).toContain(rawFileId);
  });

  it('keeps ordinary prose while scrubbing provider handles', () => {
    const text = redactPublicResponseText(
      'Tu pedido esta confirmado para el 12 de septiembre de 2026. Referencia ABC-123.',
    );
    expect(text).toContain('2026');
    expect(text).toContain('ABC-123');
  });
});

describe('eval artifact timing redaction (O2/O3)', () => {
  it('carries pipeline timing and judge metrics without raw customer data', async () => {
    const { redactEvalResultForArtifact } = await import('../src/evals/reporting');
    const phone = '+51973296571';
    const safe = redactEvalResultForArtifact({
      runId: 'run-1',
      caseId: 'case-1',
      suite: 'smoke',
      target: 'offline',
      configLabel: 'offline',
      lane: 'parallel',
      status: 'passed',
      hardGatePassed: true,
      finalScore: 1,
      totalLatencyMs: 12,
      totalToolCalls: 0,
      nodeTransitions: ['a->b'],
      planDiffSummary: [],
      artifactPaths: { caseResult: '.eval-runs/run-1/case-1.json' },
      expectationResults: [],
      scorerResults: [],
      timing: {
        queueWaitMs: 1,
        setupMs: 2,
        turnMs: 3,
        snapshotMs: 4,
        teardownMs: 5,
        judgeWaitMs: 6,
        judgeApiMs: 7,
        reportWriteMs: 8,
        makespanMs: 36,
      },
      judgeMetrics: {
        modelCalls: 2,
        retryCount: 1,
        rateLimitCount: 0,
        tokensUnknown: false,
        openaiSdk: '6.49.0',
        judgeModels: ['gpt-5.6-luna'],
      },
      turns: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    // Timing and judge accounting survive redaction byte-identical.
    expect(safe.timing).toEqual({
      queueWaitMs: 1,
      setupMs: 2,
      turnMs: 3,
      snapshotMs: 4,
      teardownMs: 5,
      judgeWaitMs: 6,
      judgeApiMs: 7,
      reportWriteMs: 8,
      makespanMs: 36,
    });
    expect(safe.judgeMetrics).toEqual({
      modelCalls: 2,
      retryCount: 1,
      rateLimitCount: 0,
      tokensUnknown: false,
      openaiSdk: '6.49.0',
      judgeModels: ['gpt-5.6-luna'],
    });
    // Public reports carry no new raw customer data.
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain('eyJ');
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
