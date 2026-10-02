import { describe, expect, it } from 'vitest';

import type { ComposeReplyRequest } from '../src/runtime/contracts';
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

describe('W1-04 L1 semantic evidence (no templates)', () => {
  it('projects support-act evidence only when supplied, never manufactured', () => {
    const extraction = baseExtraction();
    extraction.supportAct = {
      kind: 'provide_detail',
      personReference: 'Roger Abanto',
      eventReference: 'Baby Shower Catalina',
    };
    const evidence = readEvidence(composeInput(createRequest({ extraction })));
    expect(evidence.turn_state['reported_guest_name']).toBe('Roger Abanto');
    expect(evidence.turn_state['reported_event_name']).toBe('Baby Shower Catalina');
    expect(evidence.turn_state).not.toHaveProperty('support_query_open');

    const bare = readEvidence(composeInput(createRequest()));
    expect(bare.turn_state).not.toHaveProperty('reported_guest_name');
    expect(bare.turn_state).not.toHaveProperty('reported_event_name');
    expect(bare.turn_state).not.toHaveProperty('support_query_open');
    expect(bare.turn_state).not.toHaveProperty('voucher_image_cannot_confirm_receipt');
    expect(bare.turn_state).not.toHaveProperty('backend_validation_pending');
  });

});
