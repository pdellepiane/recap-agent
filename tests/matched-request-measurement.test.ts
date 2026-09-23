import path from 'node:path';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import type {
  ComposeReplyRequest,
  ExtractRequest,
  OpenAiTransportMetrics,
} from '../src/runtime/contracts';
import type { InformationTaskResult } from '../src/core/information';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import {
  aggregateMatchedByDomain,
  attributeEvidenceBlockBytes,
  summarizeMatchedStage,
  summarizeMatchedTurn,
  type MatchedDomain,
} from '../src/audit/matched-request-measurement';
import { captureOpenAiTransport, installOpenAiTransportCapture } from '../src/audit/openai-transport-capture';

const PROMPTS_DIR = path.resolve(process.cwd(), 'prompts');
const STUB_MODEL = 'gpt-test';

/**
 * Step-D matched-request measurement (offline, current candidate only).
 *
 * Every byte total below is captured AFTER installed-SDK serialization from
 * a real OpenAiAgentRuntime call with a stubbed transport fetch. Records are
 * content-free (block IDs, byte counts, hashes). These pins describe the
 * current candidate on the offline stub model; they are NOT a runtime-cost
 * claim and NOT a baseline comparison. A future baseline-vs-candidate
 * comparison needs identical denominators: same model/settings/fixture
 * world, the same requested cases, and failed runs plus repair calls
 * included on both sides.
 */

function cannedReplyPayload(paragraph: string): string {
  return JSON.stringify({
    id: 'resp_stepd_1',
    object: 'response',
    created_at: 1750000000,
    model: STUB_MODEL,
    status: 'completed',
    output: [{
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: `{"type":"generic","paragraphs_es":["${paragraph}"]}`, annotations: [] }],
    }],
    usage: { input_tokens: 900, output_tokens: 40, total_tokens: 940 },
  });
}

function cannedExtractionPayload(): string {
  return JSON.stringify({
    id: 'resp_stepd_extract_1',
    object: 'response',
    created_at: 1750000000,
    model: STUB_MODEL,
    status: 'completed',
    output: [{
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: JSON.stringify({
          actionIntent: null,
          intentConfidence: 0.9,
          ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
          assumptions: [],
          conversationSummary: 'Código de verificación.',
          informationRequests: [],
          supportAct: null,
          humanHelpIntent: null,
          phoneConfirmation: null,
          rsvpAction: null,
          rsvpCandidateGuestId: null,
          rsvpEventReference: null,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          imageReference: { status: 'none', referencedMessageIds: [] },
          providerFitCriteria: {
            eventType: null, needCategory: null, location: null,
            budgetAmount: null, budgetCurrency: null,
            mustHave: [], shouldAvoid: [], rankingNotes: '',
          },
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
          eventType: null,
          vendorCategory: null,
          vendorCategories: [],
          activeNeedCategory: null,
          location: null,
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          selectedProviderHints: [],
          selectedProviderReferences: [],
          closeAction: null,
          pauseRequested: false,
        }),
        annotations: [],
      }],
    }],
    usage: { input_tokens: 700, output_tokens: 60, total_tokens: 760 },
  });
}

function stubClient(payload: () => string, wireBodies: string[]): OpenAI {
  const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
  let n = 0;
  Reflect.set(client, 'fetch', async (_input: unknown, init?: RequestInit) => {
    if (typeof init?.body === 'string') wireBodies.push(init.body);
    n += 1;
    return new Response(payload().replace('resp_stepd_1', `resp_stepd_${n}`), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': `req-stepd-${n}` },
    });
  });
  return client;
}

function testRuntime(client: OpenAI): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: STUB_MODEL,
    extractorModel: STUB_MODEL,
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(PROMPTS_DIR),
    providerGateway: {} as never,
    openAIClient: client,
  });
}

function baseExtraction(): ComposeReplyRequest['extraction'] {
  return {
    actionIntent: null,
    informationRequests: [],
    intentConfidence: 0.9,
    eventType: null,
    vendorCategory: null,
    vendorCategories: [],
    activeNeedCategory: null,
    location: null,
    budgetSignal: null,
    guestRange: null,
    preferences: [],
    hardConstraints: [],
    assumptions: [],
    conversationSummary: '',
    selectedProviderHints: [],
    pauseRequested: false,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
  };
}

function baseRequest(
  currentNode: ComposeReplyRequest['currentNode'],
  userMessage: string,
): ComposeReplyRequest {
  return {
    currentNode,
    previousNode: currentNode,
    userMessage,
    messageContext: localTurnMessageContext('not_configured'),
    plan: mergePlan(
      createEmptyPlan({ planId: 'plan-stepd', channel: 'terminal_whatsapp_eval', externalUserId: 'user-stepd' }),
      { current_node: currentNode },
    ),
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'stepd-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
  };
}

/** Repeated-OTP terminal turn: pending purchase, failed code, handoff requested. */
function otpTerminalRequest(): ComposeReplyRequest {
  const request = baseRequest('resolver_consultas_informativas', '753994');
  request.plan = mergePlan(request.plan, {
    current_node: 'solicitar_agente_humano',
    contact_email: 'regression-otp@example.invalid',
    contact_phone: '+51900000903',
    user_auth: {
      status: 'code_requested',
      email: 'regression-otp@example.invalid',
      failed_code_attempts: 1,
      otp_send_attempts: 1,
    },
    information_state: {
      resume_node: 'deteccion_intencion',
      pending_requests: [{
        requestId: 'information-1',
        kind: 'purchase',
        resource: 'gift_purchases',
        query: 'Confirmar si el depósito del regalo llegó a los novios y revisar el estado del pago.',
        orderId: null,
        aspects: ['payment_status', 'payment_details'],
        sensitiveFields: [],
        authAction: 'provide_otp',
      }],
      selection_candidates: [],
    },
    human_escalation: {
      status: 'requested',
      requested_at: '2026-07-31T16:00:00.000Z',
      phone_number: '+51900000903',
      last_error: null,
    },
  } as never);
  request.extraction = {
    ...baseExtraction(),
    contactEmail: 'regression-otp@example.invalid',
    contactPhone: '+51900000903',
    informationRequests: [{
      kind: 'purchase',
      resource: 'gift_purchases',
      query: 'Confirmar si el depósito del regalo llegó a los novios y revisar el estado del pago.',
      orderId: null,
      aspects: ['payment_status', 'payment_details'],
      sensitiveFields: [],
      authAction: 'provide_otp',
    }],
  } as never;
  request.authenticationOutcome = {
    status: 'terminal',
    reason: 'otp_verification_failed',
    protectedRequestsClosed: false,
    publicInformationRequestsRemaining: 0,
    handoffOutcome: 'handoff_requested',
  };
  request.handoffOutcome = 'handoff_requested';
  request.informationResults = [];
  return request;
}

function purchaseCompletedRequest(): ComposeReplyRequest {
  const request = baseRequest('resolver_consultas_informativas', '¿Ya se aprobó mi regalo?');
  request.extraction = {
    ...baseExtraction(),
    informationRequests: [{
      kind: 'purchase',
      resource: 'orders',
      query: '¿Ya se aprobó mi regalo?',
      orderId: null,
      aspects: ['summary'],
      sensitiveFields: [],
      authAction: 'none',
    }],
  } as never;
  request.informationResults = [{
    requestId: 'phone-order-status',
    kind: 'purchase',
    status: 'completed',
    resource: 'gift_purchases',
    lookupResource: 'orders',
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    needsSelection: false,
    purchases: [{
      orderId: 'ORD-000880',
      paymentStatus: 'approved',
      shippingStatus: null,
      grandTotal: null,
      paymentMethod: null,
      eventName: 'Caroline & Jason',
      eventDate: '2026-09-05',
      eventUrl: null,
      createdAt: null,
      items: [],
    }],
  } satisfies InformationTaskResult];
  return request;
}

function faqCompletedRequest(): ComposeReplyRequest {
  const request = baseRequest('resolver_consultas_informativas', '¿Cuánto cobra Sin Envolturas?');
  request.extraction = {
    ...baseExtraction(),
    informationRequests: [{ kind: 'faq', query: '¿Cuánto cobra Sin Envolturas?' }],
  } as never;
  request.informationResults = [{
    requestId: 'faq-1',
    kind: 'faq',
    status: 'completed',
    evidence: [{
      fileId: 'faq-file',
      filename: 'tarifas.md',
      score: 0.9,
      text: 'La comisión por regalo es 9% más IGV.',
    }],
  }];
  return request;
}

function rsvpReadRequest(): ComposeReplyRequest {
  const request = baseRequest('responder_invitacion', 'Sí, asistiré');
  request.plan = mergePlan(request.plan, {
    current_node: 'responder_invitacion',
    contact_phone: '+51942633292',
    contact_phone_extension: '+51',
    contact_phone_number: '942633292',
  } as never);
  request.extraction = {
    ...baseExtraction(),
    actionIntent: 'responder_invitacion',
    rsvpAction: 'attending',
    rsvpDecisionSource: 'current_message',
  } as never;
  return request;
}

function closeRequest(): ComposeReplyRequest {
  const request = baseRequest('crear_lead_cerrar', 'Sí, envíalo');
  request.plan = mergePlan(request.plan, {
    current_node: 'crear_lead_cerrar',
    contact_name: 'Ana',
    contact_email: 'ana@example.com',
    contact_phone: '+51999111222',
  } as never);
  return request;
}

async function measureReply(
  request: ComposeReplyRequest,
  paragraph: string,
): Promise<{ bodies: string[]; transport: OpenAiTransportMetrics }> {
  const bodies: string[] = [];
  const runtime = testRuntime(stubClient(() => cannedReplyPayload(paragraph), bodies));
  const reply = await runtime.composeReply(request);
  const transport = reply.openAiCall?.requestMetrics.transport;
  if (!transport) throw new Error('missing reply transport metrics');
  return { bodies, transport };
}

function wireComponentBytes(body: string): {
  total: number; instruction: number; input: number; tools: number; schema: number;
} {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
  const text = parsed['text'] as Record<string, unknown> | undefined;
  const schema = text !== undefined ? text['format'] ?? null : null;
  return {
    total: Buffer.byteLength(body, 'utf8'),
    instruction: size(parsed['instructions']),
    input: size(parsed['input']),
    tools: size(parsed['tools'] ?? []),
    schema: schema === null ? 0 : size(schema),
  };
}

describe('matched request measurement after SDK serialization', () => {
  it('captures complete reply transport for the OTP-terminal turn', async () => {
    const { bodies, transport } = await measureReply(
      otpTerminalRequest(),
      'Ya pedí ayuda humana para tu consulta.',
    );

    expect(bodies.length).toBeGreaterThan(0);
    expect(transport.observedRequestCount).toBe(bodies.length);
    const stage = summarizeMatchedStage('reply', transport, 'otp-terminal-reply');
    expect(stage.completeness.complete).toBe(true);
    expect(stage.completeness.reasons).toEqual([]);
    const turn = summarizeMatchedTurn({
      caseId: 'live_behavior.repeated_otp_failure_preserves_gift_query:turn0-shape',
      domain: 'auth',
      model: STUB_MODEL,
      stages: [stage],
    });
    expect(turn.transportComplete).toBe(true);
    expect(turn.modelCalls).toBe(bodies.length);
    // Current-candidate pins (offline stub model, installed SDK envelope).
    // Static sample bytes are never runtime cost; see the module header.
    // 2026-09-16 G1 retention: measured 8862 after retaining the
    // auth-terminal fragment (resolver response_contract L49-51) in the
    // reply-side continuity file and splitting auth_control.txt to the
    // extraction stage. Previous >16000 pin measured the pre-migration
    // node bundle; the 8306 interim value carried the same drop with no
    // retained fragment (+1013 auth-terminal, -486 extractor auth_control,
    // +29 scoped handoff wording).
    // 2026-09-16 auth split plus approval boundary: measured 9544 (+682).
    // The auth-terminal prose moved to auth_limitation.txt behind
    // reply_auth_limitation (one extra ## file header on auth turns) and
    // the receipt guard loads via reply_approval_boundary because this
    // turn requests payment_status aspects. Venue and non-approval turns
    // shrink by the removed auth prose; only applicable turns pay.
    // 2026-09-17 actionable-answer directive: +47 bytes on this turn
    // (measured 9647); the shared invariant replaces older text rather
    // than duplicating rules, so the cap moves minimally. Previous cap 9600.
    // 2026-09-22 Owner B B9/B11: measured 5595. The four-file shared core
    // (4,897 bytes) is replaced by the single reply-core file while the
    // same six task modules still load (purchase facts, approval boundary,
    // auth limitation, handoff outcome, real continuation behind the
    // pending purchase). Previous floor 8000, previous cap 9700.
    expect(turn.instructionBytes).toBeGreaterThan(5_000);
    expect(turn.instructionBytes).toBeLessThan(6_100);
    expect(turn.inputBytes).toBeGreaterThan(2_000);
    expect(turn.inputBytes).toBeLessThan(6_000);
    expect(turn.toolBytes).toBeLessThanOrEqual(4);
    expect(turn.outputSchemaBytes).toBeGreaterThan(0);
    const wire = wireComponentBytes(bodies[0]);
    expect(wire.total).toBe(turn.totalPayloadBytes);
    expect(wire.instruction).toBe(turn.instructionBytes);
    expect(wire.input).toBe(turn.inputBytes);
  });

  it('includes failed attempts and repair calls instead of zeroing them', async () => {
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    const failingBody = JSON.stringify({ model: STUB_MODEL, instructions: 'x', input: 'y' });
    let calls = 0;
    Reflect.set(client, 'fetch', async () => {
      calls += 1;
      if (calls === 1) throw new Error('transport unavailable');
      return new Response(cannedReplyPayload('reparado'), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-repair' },
      });
    });
    installOpenAiTransportCapture(client);
    const transport = Reflect.get(client, 'fetch') as (
      input: string | URL | Request, init?: RequestInit,
    ) => Promise<Response>;
    const captured = await captureOpenAiTransport('reply', async () => {
      await expect(transport('https://example.test/responses', { method: 'POST', body: failingBody }))
        .rejects.toThrow('transport unavailable');
      await transport('https://example.test/responses', { method: 'POST', body: failingBody });
    });
    // The failed attempt is retained with null success markers and intact
    // bytes; the repair call adds its own observation.
    expect(captured.metrics.observedRequestCount).toBe(2);
    expect(captured.metrics.requests[0]?.succeeded).toBeNull();
    expect(captured.metrics.requests[0]?.totalPayloadBytes).toBe(Buffer.byteLength(failingBody, 'utf8'));
    expect(captured.metrics.requests[1]?.succeeded).toBe(true);
    const stage = summarizeMatchedStage('reply', captured.metrics, 'failure-plus-repair');
    const turn = summarizeMatchedTurn({
      caseId: 'failure-plus-repair',
      domain: 'auth',
      model: STUB_MODEL,
      stages: [stage],
    });
    expect(turn.modelCalls).toBe(2);
    expect(turn.totalPayloadBytes).toBe(2 * Buffer.byteLength(failingBody, 'utf8'));
    expect(turn.transportComplete).toBe(true);
  });

  it('aggregates extraction plus reply stages for one matched turn', async () => {
    const otp = otpTerminalRequest();
    const extractRequest: ExtractRequest = {
      userMessage: otp.userMessage,
      plan: otp.plan,
      messageContext: otp.messageContext,
    };
    const extractClient = stubClient(() => cannedExtractionPayload(), []);
    const extractRuntime = testRuntime(extractClient);
    const extraction = await extractRuntime.extract(extractRequest);
    const extractionTransport = extraction.openAiCall?.requestMetrics.transport;
    if (!extractionTransport) throw new Error('missing extraction transport metrics');
    const { transport: replyTransport } = await measureReply(otpTerminalRequest(), 'ok');

    const turn = summarizeMatchedTurn({
      caseId: 'live_behavior.repeated_otp_failure_preserves_gift_query:extract-plus-reply',
      domain: 'auth',
      model: STUB_MODEL,
      stages: [
        summarizeMatchedStage('extraction', extractionTransport, 'otp-extraction'),
        summarizeMatchedStage('reply', replyTransport, 'otp-reply'),
      ],
      tokenUsage: extraction.tokenUsage,
    });
    expect(turn.modelCalls).toBe(
      extractionTransport.observedRequestCount + replyTransport.observedRequestCount,
    );
    expect(turn.transportComplete).toBe(true);
    expect(turn.inputTokens).toBe(700);
    const aggregate = aggregateMatchedByDomain([turn]);
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0]).toMatchObject({ domain: 'auth', turns: 1, modelCalls: turn.modelCalls });
  });

  it.each([
    ['auth', otpTerminalRequest, 'Ya pedí ayuda humana.'],
    ['purchase', purchaseCompletedRequest, 'Tu regalo fue aprobado.'],
    ['faq', faqCompletedRequest, 'La comisión es 9% más IGV.'],
    ['rsvp', rsvpReadRequest, 'Registré tu asistencia.'],
    ['close', closeRequest, 'Ya envié tu solicitud.'],
  ] as Array<[MatchedDomain, () => ComposeReplyRequest, string]>)(
    'records per-domain reply totals for %s',
    async (domain, build, paragraph) => {
      const { bodies, transport } = await measureReply(build(), paragraph);
      const turn = summarizeMatchedTurn({
        caseId: `stepd-offline-${domain}`,
        domain,
        model: STUB_MODEL,
        stages: [summarizeMatchedStage('reply', transport, `${domain}-reply`)],
      });
      expect(turn.transportComplete).toBe(true);
      expect(turn.modelCalls).toBe(bodies.length);
      expect(turn.totalPayloadBytes).toBeGreaterThan(0);
      expect(turn.instructionBytes).toBeGreaterThan(0);
      expect(turn.inputBytes).toBeGreaterThan(0);
      expect(turn.outputSchemaBytes).toBeGreaterThan(0);
      const aggregate = aggregateMatchedByDomain([turn]);
      expect(aggregate[0]?.domain).toBe(domain);
    },
  );
});

describe('OTP-terminal projection attribution', () => {
  function evidenceOf(request: ComposeReplyRequest): Record<string, unknown> {
    const runtime = testRuntime(stubClient(() => cannedReplyPayload('ok'), []));
    const typed = runtime as unknown as {
      buildReplyTurnEvidence: (args: {
        request: ComposeReplyRequest;
        focusNeedCategory: null;
        providerResults: [];
        recommendationFunnel: null;
        authenticationOnlyReply: boolean;
      }) => Record<string, unknown>;
    };
    return typed.buildReplyTurnEvidence({
      request,
      focusNeedCategory: null,
      providerResults: [],
      recommendationFunnel: null,
      authenticationOnlyReply: false,
    });
  }

  it('attributes per-block bytes without storing payloads', () => {
    const blocks = attributeEvidenceBlockBytes(evidenceOf(otpTerminalRequest()));
    const byId = new Map(blocks.map((block) => [block.blockId, block]));
    expect(byId.get('plan')?.bytes).toBeGreaterThan(0);
    expect(byId.get('extraction')?.bytes).toBeGreaterThan(0);
    expect(byId.get('authentication_outcome')?.bytes).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
    // No planning-only fields reach this established auth turn.
    const serialized = JSON.stringify(evidenceOf(otpTerminalRequest()));
    for (const leaked of ['provider_needs', 'vendor_category', 'event_type', 'rsvp_state', 'close_submission_receipt']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('omits the duplicated top-level handoff block on auth turns only', () => {
    const authEvidence = evidenceOf(otpTerminalRequest());
    expect(authEvidence).not.toHaveProperty('handoff_outcome');
    expect(authEvidence).toMatchObject({
      authentication_outcome: { status: 'terminal', handoff_outcome: 'handoff_requested' },
    });

    const support = baseRequest('resolver_consultas_informativas', 'Necesito ayuda humana');
    support.handoffOutcome = 'handoff_requested';
    const supportEvidence = evidenceOf(support);
    expect(supportEvidence).toMatchObject({ handoff_outcome: 'handoff_requested' });
  });

  it('holds the auth turn byte-identical under unrelated planning/RSVP state', () => {
    const runtime = testRuntime(stubClient(() => cannedReplyPayload('ok'), []));
    const typed = runtime as unknown as {
      composeConversationInput: (
        request: ComposeReplyRequest,
        funnel: { available_candidates: number; context_candidates: number; context_candidate_ids: number[]; presentation_limit: number },
      ) => string;
    };
    const funnel = { available_candidates: 0, context_candidates: 0, context_candidate_ids: [], presentation_limit: 0 };
    const before = typed.composeConversationInput(otpTerminalRequest(), funnel);
    const changed = otpTerminalRequest();
    changed.plan = mergePlan(changed.plan, {
      event_type: 'boda',
      vendor_category: 'Catering',
      location: 'Lima',
      preferences: ['terraza'],
      provider_needs: [{
        category: 'Catering',
        status: 'shortlisted',
        preferences: [],
        hard_constraints: [],
        missing_fields: [],
        recommended_provider_ids: [],
        recommended_providers: [],
        selected_provider_ids: [],
        selected_provider_hints: [],
      }],
      rsvp_state: { status: 'awaiting_event_selection', pending_action: 'attending', candidates: [], requested_at: null, selection_attempts: 1 },
    } as never);
    expect(typed.composeConversationInput(changed, funnel)).toBe(before);

    const rsvpBefore = typed.composeConversationInput(rsvpReadRequest(), funnel);
    const rsvpChanged = rsvpReadRequest();
    rsvpChanged.plan = mergePlan(rsvpChanged.plan, {
      event_type: 'boda',
      provider_needs: [{
        category: 'Catering',
        status: 'shortlisted',
        preferences: [],
        hard_constraints: [],
        missing_fields: [],
        recommended_provider_ids: [],
        recommended_providers: [],
        selected_provider_ids: [],
        selected_provider_hints: [],
      }],
      information_state: {
        resume_node: null,
        pending_requests: [{
          requestId: 'purchase-1',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: 'estado',
          orderId: null,
          aspects: ['summary'],
          sensitiveFields: [],
          authAction: 'provide_otp',
        }],
        selection_candidates: [],
      },
    } as never);
    expect(typed.composeConversationInput(rsvpChanged, funnel)).toBe(rsvpBefore);
  });

  it('changes the auth turn when relevant auth evidence changes', () => {
    const runtime = testRuntime(stubClient(() => cannedReplyPayload('ok'), []));
    const typed = runtime as unknown as {
      composeConversationInput: (
        request: ComposeReplyRequest,
        funnel: { available_candidates: number; context_candidates: number; context_candidate_ids: number[]; presentation_limit: number },
      ) => string;
    };
    const funnel = { available_candidates: 0, context_candidates: 0, context_candidate_ids: [], presentation_limit: 0 };
    const before = typed.composeConversationInput(otpTerminalRequest(), funnel);
    const changed = otpTerminalRequest();
    if (!changed.authenticationOutcome) throw new Error('missing auth outcome fixture');
    changed.authenticationOutcome = { ...changed.authenticationOutcome, handoffOutcome: 'handoff_failed' };
    changed.handoffOutcome = 'handoff_failed';
    expect(typed.composeConversationInput(changed, funnel)).not.toBe(before);
  });
});
