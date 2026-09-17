import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ComposeReplyRequest } from '../src/runtime/contracts';
import type { InformationTaskResult } from '../src/core/information';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';

function createRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-5.6-luna',
    extractorModel: 'gpt-5.6-luna',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: {} as never,
    providerGateway: {} as never,
  });
}

function baseExtraction(): ComposeReplyRequest['extraction'] {
  return {
    actionIntent: null,
    informationRequests: [],
    intentConfidence: 0.95,
    eventType: 'baby_shower',
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

function createRequest(overrides: Partial<ComposeReplyRequest> = {}): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: 'El nombre del invitado afectado es Roger Abanto. Y el evento es Baby Shower Catalina.',
    messageContext: localTurnMessageContext('not_configured'),
    plan: mergePlan(
      createEmptyPlan({ planId: 'w1-04', channel: 'whatsapp', externalUserId: 'u' }),
      {
        current_node: 'resolver_consultas_informativas',
        conversation_summary: 'La persona aportó información a una consulta de soporte que sigue abierta.',
      },
    ),
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'bundle-1',
    promptFilePaths: ['nodes/resolver_consultas_informativas/support_continuity.txt'],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    ...overrides,
  };
}

function readEvidence(input: string): {
  extraction: Record<string, unknown>;
  turn_state: Record<string, unknown>;
  information_results: unknown[];
} {
  const marker = 'Evidencia canónica del turno (JSON): ';
  const json = input.slice(input.indexOf(marker) + marker.length).split('\n\n')[0];
  return JSON.parse(json ?? '{}') as {
    extraction: Record<string, unknown>;
    turn_state: Record<string, unknown>;
    information_results: unknown[];
  };
}

function composeInput(request: ComposeReplyRequest): string {
  const runtime = createRuntime() as unknown as {
    composeConversationInput: (
      replyRequest: ComposeReplyRequest,
      funnel: { available_candidates: number; context_candidates: number; context_candidate_ids: number[]; presentation_limit: number },
    ) => string;
  };
  return runtime.composeConversationInput(request, {
    available_candidates: 0,
    context_candidates: 0,
    context_candidate_ids: [],
    presentation_limit: 0,
  });
}

function pendingPurchaseResult(): InformationTaskResult {
  return {
    requestId: 'information-1',
    kind: 'purchase',
    status: 'completed',
    resource: 'orders',
    purchases: [{
      orderId: 'order-1',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 227.76,
      paymentMethod: 'Yape_o_Plin',
      eventName: 'Alejandra',
      eventDate: null,
      eventUrl: null,
      createdAt: null,
      items: [],
    }],
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
  };
}

describe('W1-04 L1 semantic evidence (no templates)', () => {
  it('projects verbatim reported names from supportAct raw strings, not the normalized event_type', () => {
    const extraction = baseExtraction();
    extraction.supportAct = {
      kind: 'provide_detail',
      topic: 'unknown',
      detail: 'unknown',
      personReference: 'Roger Abanto',
      eventReference: 'Baby Shower Catalina',
    };
    const evidence = readEvidence(composeInput(createRequest({ extraction })));
    expect(evidence.turn_state['reported_guest_name']).toBe('Roger Abanto');
    expect(evidence.turn_state['reported_event_name']).toBe('Baby Shower Catalina');
  });

  it('marks the same support query open for continuation while the summary stays open', () => {
    const extraction = baseExtraction();
    extraction.supportAct = {
      kind: 'provide_detail',
      topic: 'unknown',
      detail: 'unknown',
      personReference: 'Roger Abanto',
      eventReference: 'Baby Shower Catalina',
    };
    const evidence = readEvidence(composeInput(createRequest({ extraction })));
    expect(evidence.turn_state['support_query_open']).toBe(true);
  });

  it('keeps purchase turns without a support act byte-identical (no new support fields)', () => {
    const evidence = readEvidence(composeInput(createRequest()));
    expect(evidence.turn_state).not.toHaveProperty('reported_guest_name');
    expect(evidence.turn_state).not.toHaveProperty('reported_event_name');
    expect(evidence.turn_state).not.toHaveProperty('support_query_open');
    expect(evidence.turn_state).not.toHaveProperty('voucher_image_cannot_confirm_receipt');
    expect(evidence.turn_state).not.toHaveProperty('backend_validation_pending');
  });

  it('projects voucher image and backend validation facts on a pending voucher report', () => {
    const extraction = baseExtraction();
    extraction.supportAct = {
      kind: 'provide_detail',
      topic: 'payment_proof',
      detail: 'submission_reported',
      personReference: null,
      eventReference: null,
    };
    extraction.informationRequests = [{
      kind: 'purchase',
      query: 'Ya envié los 13.76 que faltaban, tengo el voucher.',
      resource: 'orders',
      orderId: null,
      amount: 13.76,
      aspects: ['summary', 'payment_status'],
      sensitiveFields: [],
      authAction: 'none',
    }];
    const evidence = readEvidence(composeInput(createRequest({
      extraction,
      informationResults: [pendingPurchaseResult()],
    })));
    expect(evidence.turn_state['voucher_image_cannot_confirm_receipt']).toBe(true);
    expect(evidence.turn_state['backend_validation_pending']).toBe(true);
  });

  it('projects backend validation facts on a reported shortfall over a pending order', () => {
    const extraction = baseExtraction();
    extraction.supportAct = {
      kind: 'provide_detail',
      topic: 'unknown',
      detail: 'unknown',
      personReference: null,
      eventReference: null,
    };
    extraction.informationRequests = [{
      kind: 'purchase',
      query: 'Ya envié los 13.76 que faltaban.',
      resource: 'orders',
      orderId: null,
      amount: 13.76,
      aspects: ['summary', 'payment_status'],
      sensitiveFields: [],
      authAction: 'none',
    }];
    const evidence = readEvidence(composeInput(createRequest({
      extraction,
      informationResults: [pendingPurchaseResult()],
    })));
    expect(evidence.turn_state['voucher_image_cannot_confirm_receipt']).toBe(true);
    expect(evidence.turn_state['backend_validation_pending']).toBe(true);
  });

  it('directs verbatim names without a mandatory open-query recital and without canned prose', () => {
    const bundle = readFileSync(
      join(__dirname, '..', 'prompts', 'nodes', 'resolver_consultas_informativas', 'support_continuity.txt'),
      'utf8',
    );
    expect(bundle).toContain('reported_guest_name');
    expect(bundle).toContain('reported_event_name');
    // 2026-09-17 actionable-answer: the mandatory support_query_open
    // recital is removed; continuation is evidenced, not narrated.
    expect(bundle).not.toContain('support_query_open');
  });
});
