import { describe, expect, it } from 'vitest';

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

function createRequest(overrides: Partial<ComposeReplyRequest> = {}): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: 'Hice un retiro de dinero de mi evento y aun no lo recibo.',
    messageContext: localTurnMessageContext('not_configured'),
    plan: mergePlan(
      createEmptyPlan({ planId: 'w1-07', channel: 'whatsapp', externalUserId: 'u' }),
      { current_node: 'resolver_consultas_informativas' },
    ),
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'bundle-1',
    promptFilePaths: ['nodes/resolver_consultas_informativas/host-withdrawal.json'],
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

function hostPolicyResult(): InformationTaskResult {
  return {
    requestId: 'information-1',
    kind: 'faq',
    status: 'completed',
    evidence: [],
    hostWithdrawalPolicy: { maxBusinessHours: 72 },
  };
}

describe('W1-07 structured completeness (evidence only)', () => {
  it('projects host-withdrawal policy hours, unverifiable status and handoff for an individual-status request', () => {
    const extraction = baseExtraction();
    extraction.informationRequests = [{
      kind: 'faq',
      query: 'Hice un retiro de dinero de mi evento y aun no lo recibo.',
      hostWithdrawal: 'individual_status',
      eventHint: 'Diana y Fernando',
    }];
    const evidence = readEvidence(composeInput(createRequest({
      extraction,
      informationResults: [hostPolicyResult()],
    })));
    expect(evidence.turn_state['host_withdrawal_policy_hours']).toBe(72);
    expect(evidence.turn_state['host_withdrawal_status_unverifiable']).toBe(true);
    expect(evidence.turn_state['host_withdrawal_handoff_requested']).toBe(true);
  });

  it('projects only policy hours for a general host-withdrawal policy question without handoff', () => {
    const extraction = baseExtraction();
    extraction.informationRequests = [{
      kind: 'faq',
      query: 'Cuanto demora un retiro de fondos?',
      hostWithdrawal: 'policy_only',
    }];
    const evidence = readEvidence(composeInput(createRequest({
      extraction,
      informationResults: [hostPolicyResult()],
    })));
    expect(evidence.turn_state['host_withdrawal_policy_hours']).toBe(72);
    expect(evidence.turn_state).not.toHaveProperty('host_withdrawal_status_unverifiable');
    expect(evidence.turn_state).not.toHaveProperty('host_withdrawal_handoff_requested');
  });

  it('keeps handoff and unverifiable status when the policy result is unavailable', () => {
    const extraction = baseExtraction();
    extraction.informationRequests = [{
      kind: 'faq',
      query: 'No recibi mi retiro.',
      hostWithdrawal: 'individual_status',
    }];
    const evidence = readEvidence(composeInput(createRequest({ extraction })));
    expect(evidence.turn_state).not.toHaveProperty('host_withdrawal_policy_hours');
    expect(evidence.turn_state['host_withdrawal_status_unverifiable']).toBe(true);
    expect(evidence.turn_state['host_withdrawal_handoff_requested']).toBe(true);
  });

  it('keeps unrelated purchase turns byte-identical (no host-withdrawal keys)', () => {
    const evidence = readEvidence(composeInput(createRequest()));
    expect(evidence.turn_state).not.toHaveProperty('host_withdrawal_policy_hours');
    expect(evidence.turn_state).not.toHaveProperty('host_withdrawal_status_unverifiable');
    expect(evidence.turn_state).not.toHaveProperty('host_withdrawal_handoff_requested');
  });
});
