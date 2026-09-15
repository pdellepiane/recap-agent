import { describe, expect, it } from 'vitest';

import { hashPrivateOutput, observeOutputOrigin, validateOutputOriginEvidence } from '../src/audit/output-origin';
import {
  lambdaTurnResponseSchema,
} from '../src/evals/case-schema';
import { independentlyObserveWireOutput } from '../src/evals/targets/live-lambda';
import { buildCliResponseBody } from '../src/lambda/handler';
import { createEmptyPlan } from '../src/core/plan';
import type { HandleTurnResponse } from '../src/runtime/agent-service';

const SENSITIVE_TEXT =
  'Tu referencia es ABC-123, escribe a persona@example.com o llama al +51973296571 con el codigo 847261.';

function sensitiveResponse(): HandleTurnResponse {
  const plan = createEmptyPlan({
    planId: 'wire-plan',
    channel: 'terminal_whatsapp',
    externalUserId: 'wire-user',
  });
  return {
    outbound: {
      text: SENSITIVE_TEXT,
      outputOrigin: observeOutputOrigin({
        candidateText: SENSITIVE_TEXT,
        deliveredText: SENSITIVE_TEXT,
        transformationVersion: 'transport-v2',
      }),
      delivery: { action: 'send', reason: 'reply_composed' },
      conversationId: 'conversation-wire',
    },
    plan,
    trace: validTrace(),
  } as unknown as HandleTurnResponse;
}

function suppressedResponse(): HandleTurnResponse {
  const plan = createEmptyPlan({
    planId: 'wire-silence-plan',
    channel: 'terminal_whatsapp',
    externalUserId: 'wire-silence-user',
  });
  return {
    outbound: {
      text: null,
      delivery: { action: 'suppress', reason: 'human_escalation_active' },
      conversationId: 'conversation-wire-silence',
    },
    plan,
    trace: validTrace(),
  } as unknown as HandleTurnResponse;
}

describe('handler-to-live-target wire observation', () => {
  it('verifies the original text before artifact redaction', () => {
    const body = buildCliResponseBody({
      response: sensitiveResponse(),
      perf: null,
      includeDiagnostics: true,
    });

    const redacted = body.message as string | null;
    expect(typeof redacted).toBe('string');
    expect(redacted).not.toContain('persona@example.com');
    expect(redacted).not.toContain('+51973296571');
    expect(redacted).not.toContain('847261');
    expect(body.message_original_sha256).toBe(hashPrivateOutput(SENSITIVE_TEXT));
    expect(body.message_redaction_applied).toBe(true);

    const parsed = lambdaTurnResponseSchema.parse(body);
    const observed = independentlyObserveWireOutput(parsed.message, parsed.output_origin, {
      originalSha256: parsed.message_original_sha256 ?? undefined,
      redactionApplied: parsed.message_redaction_applied ?? false,
    });
    expect(observed.status).toBe('verified');
    expect(observed.mismatchFields).toEqual([]);
    expect(observed.deliveredSha256).toBe(hashPrivateOutput(SENSITIVE_TEXT));
  });

  it('documents that hashing the redacted text alone cannot prove provenance', () => {
    const body = buildCliResponseBody({
      response: sensitiveResponse(),
      perf: null,
      includeDiagnostics: true,
    });
    const parsed = lambdaTurnResponseSchema.parse(body);
    const withoutWire = independentlyObserveWireOutput(parsed.message, parsed.output_origin);
    expect(withoutWire.status).toBe('mismatch');
    expect(withoutWire.mismatchFields).toContain('delivered_sha256');
  });

  it('keeps null output null and never presents it as verified', () => {
    const body = buildCliResponseBody({
      response: suppressedResponse(),
      perf: null,
      includeDiagnostics: true,
    });

    expect(body.message).toBeNull();
    expect(body.message_original_sha256).toBeNull();
    expect(body.message_redaction_applied).toBe(true);
    expect(() => lambdaTurnResponseSchema.parse(body)).not.toThrow();

    const parsed = lambdaTurnResponseSchema.parse(body);
    const wireOriginal = parsed.message_original_sha256 === undefined
      ? undefined
      : parsed.message_original_sha256;
    const observed = independentlyObserveWireOutput(parsed.message, parsed.output_origin, {
      originalSha256: wireOriginal,
      redactionApplied: parsed.message_redaction_applied ?? false,
    });
    expect(observed.status).toBe('missing');
    expect(observed.deliveredSha256).toBeNull();
  });

  it('leaves the original text untouched without diagnostics', () => {
    const body = buildCliResponseBody({
      response: sensitiveResponse(),
      perf: null,
      includeDiagnostics: false,
    });

    expect(body.message).toBe(SENSITIVE_TEXT);
    expect(body.message_original_sha256).toBe(hashPrivateOutput(SENSITIVE_TEXT));
    expect(body.message_redaction_applied).toBe(false);
  });

  it('redacts last-response secrets in diagnostics while hashing the private original', () => {
    const rawFileId = 'file-SYNTHETIC-private';
    const rawUrl = 'https://files.example.com/s/signed-payload?token=abc123';
    const rawEmail = 'synthetic@example.test';
    const rawPhone = '+51973296571';
    const plan = createEmptyPlan({
      planId: 'wire-last-response-plan',
      channel: 'terminal_whatsapp',
      externalUserId: 'wire-last-response-user',
    });
    plan.image_attachments = [
      {
        kind: 'file',
        fileId: rawFileId,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        mimeType: 'image/png',
        byteLength: 1024,
        contentDigest: 'c'.repeat(64),
        messageId: 'wamid.current-wire',
        receivedAt: new Date().toISOString(),
      },
    ];
    plan.last_outbound_context = {
      message_id: 'wamid.latest-wire',
      text: `Tu comprobante ${rawFileId} esta en ${rawUrl} escribe a ${rawEmail} o llama al ${rawPhone}.`,
      text_truncated: false,
      recorded_at: new Date().toISOString(),
      delivery_evidence: 'constructed',
    };
    const response = {
      outbound: {
        text: SENSITIVE_TEXT,
        outputOrigin: observeOutputOrigin({
          candidateText: SENSITIVE_TEXT,
          deliveredText: SENSITIVE_TEXT,
          transformationVersion: 'transport-v2',
        }),
        delivery: { action: 'send', reason: 'reply_composed' },
        conversationId: 'conversation-wire-last-response',
      },
      plan,
      trace: validTrace(),
    } as unknown as HandleTurnResponse;
    const body = buildCliResponseBody({
      response,
      perf: null,
      includeDiagnostics: true,
      observedMessageId: 'wamid.current-wire',
    });
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain(rawFileId);
    expect(serialized).not.toContain(rawUrl);
    expect(serialized).not.toContain(rawEmail);
    expect(serialized).not.toContain(rawPhone);
    const bodyPlan = body.plan as unknown as Record<string, unknown>;
    const lastOutbound = bodyPlan['last_outbound_context'] as Record<string, unknown>;
    expect(typeof lastOutbound['text']).toBe('string');
    expect(String(lastOutbound['text'])).toContain('[redacted-file]');
    expect(bodyPlan['image_attachments']).toEqual([]);
    expect(bodyPlan['image_attachment_count']).toBe(1);
    const observations = bodyPlan['image_attachment_observations'] as Array<Record<string, unknown>>;
    expect(observations[0]).toMatchObject({ kind: 'file', active: true, messageMatch: 'current' });
    // The wire hash still proves the private original, never the redacted text.
    expect(body.message_original_sha256).toBe(hashPrivateOutput(SENSITIVE_TEXT));
    const redactedMessage = typeof body.message === 'string' ? body.message : '';
    expect(body.message_original_sha256).not.toBe(hashPrivateOutput(redactedMessage));
    expect(() => lambdaTurnResponseSchema.parse(body)).not.toThrow();
    // Private runtime state keeps the real refs and original text.
    expect(JSON.stringify(plan)).toContain(rawFileId);
    expect(plan.last_outbound_context?.text).toContain(rawEmail);
  });

  it('fails closed on unknown versions, stale transport-v1, missing origin, and blanks', () => {
    const wire = 'Texto entregado por cable.';
    const wireSha = hashPrivateOutput(wire);
    const verifiedV2 = observeOutputOrigin({
      candidateText: wire,
      deliveredText: wire,
      transformationVersion: 'transport-v2',
    });
    expect(validateOutputOriginEvidence(verifiedV2).valid).toBe(true);
    expect(independentlyObserveWireOutput(wire, { ...verifiedV2, mismatchFields: [...verifiedV2.mismatchFields] }).status).toBe('verified');

    const staleV1 = observeOutputOrigin({
      candidateText: wire,
      deliveredText: wire,
      transformationVersion: 'transport-v1',
    });
    expect(validateOutputOriginEvidence(staleV1).valid).toBe(false);
    expect(independentlyObserveWireOutput(wire, { ...staleV1, mismatchFields: [...staleV1.mismatchFields] }).status).toBe('mismatch');

    const unknown = observeOutputOrigin({
      candidateText: wire,
      deliveredText: wire,
      transformationVersion: 'transport-v9',
    });
    expect(validateOutputOriginEvidence(unknown).valid).toBe(false);
    expect(independentlyObserveWireOutput(wire, { ...unknown, mismatchFields: [...unknown.mismatchFields] }).status).toBe('mismatch');

    expect(validateOutputOriginEvidence(undefined).valid).toBe(false);
    const missingWire = independentlyObserveWireOutput(wire, undefined);
    expect(missingWire.status).toBe('missing');

    const blankHash = hashPrivateOutput('');
    expect(blankHash).not.toBe(wireSha);
    expect(blankHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('carries distinct model-content and expected-render hashes on verified receipts', () => {
    const body = buildCliResponseBody({
      response: sensitiveResponse(),
      perf: null,
      includeDiagnostics: true,
    });
    const parsed = lambdaTurnResponseSchema.parse(body);
    expect(parsed.output_origin?.status).toBe('verified');
    expect(parsed.output_origin?.candidateSha256).toBe(hashPrivateOutput(SENSITIVE_TEXT));
    expect(parsed.output_origin?.deliveredSha256).toBe(hashPrivateOutput(SENSITIVE_TEXT));
    expect(parsed.output_origin?.transformationVersion).toBe('transport-v2');
  });
});

function validTrace() {
  return {
    trace_id: 'trace-wire',
    conversation_id: 'conversation-wire',
    plan_id: 'wire-plan',
    previous_node: 'contacto_inicial',
    next_node: 'deteccion_intencion',
    node_path: ['contacto_inicial', 'deteccion_intencion'],
    intent: null,
    missing_fields: [],
    search_ready: false,
    prompt_bundle_id: 'bundle-wire',
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
