import { describe, it, expect } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { ExtractionResult } from '../src/runtime/contracts';
import type { PlanSnapshot } from '../src/core/plan';

function makeExtraction(overrides: Partial<ExtractionResult>): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    intentConfidence: 1,
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
    conversationSummary: 'test',
    selectedProviderHints: [],
    selectedProviderReferences: [],
    closeAction: null,
    pauseRequested: false,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
    rsvpAction: null,
    rsvpDecisionSource: null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    ...overrides,
  } as unknown as ExtractionResult;
}

function makePlan(overrides: Partial<PlanSnapshot>): PlanSnapshot {
  const base: PlanSnapshot = {
    plan_id: 'test-plan',
    conversation_id: 'conv-test',
    channel: 'whatsapp',
    externalUserId: 'user',
    lifecycle_state: 'active',
    current_node: 'resolver_consultas_informativas',
    intent: null,
    intent_confidence: 1,
    event_type: null,
    vendor_category: null,
    location: null,
    budget_signal: null,
    guest_range: null,
    provider_needs: [],
    active_need_category: null,
    selected_provider_ids: [],
    recommended_provider_ids: [],
    recommended_providers: [],
    missing_fields: [],
    open_questions: [],
    conversation_summary: '',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    contact_phone_extension: null,
    contact_phone_number: null,
    user_auth: { status: 'none', email: null, token: null, token_expires_at: null, last_error: null, requested_at: null, failed_code_attempts: 0, otp_send_attempts: 0, otp_non_delivery_reports: 0, auth_method: null, awaiting_phone_confirmation: false },
    information_state: { pending_requests: [], selection_candidates: [], last_completed_request: null, resume_node: null },
    rsvp_state: { status: 'none', candidates: [], pending_action: null, pending_plus_one_response: null, requested_at: null, selection_attempts: 0 },
    human_escalation: { status: 'none', requested_at: null, phone_number: null, last_error: null },
    conversation_health: { status: 'progressing', reason: 'normal_progress', consecutive_non_progress_turns: 0, help_offer_status: 'none', help_offered_at: null, last_assessed_at: null },
    assumptions: [],
  } as unknown as PlanSnapshot;
  return { ...base, ...overrides, information_state: { ...base.information_state, ...(overrides.information_state ?? {}) }, rsvp_state: { ...base.rsvp_state, ...(overrides.rsvp_state ?? {}) } } as PlanSnapshot;
}

describe('typed state fixes wave C5 attempt-3', () => {
  it('hasRsvpWork: open information thread + weak RSVP signal stays in information flow', () => {
    const plan = makePlan({
      rsvp_state: { status: 'none', candidates: [], pending_action: null, pending_plus_one_response: null, requested_at: null, selection_attempts: 0 },
      information_state: {
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: { kind: 'purchase', query: 'test', requestId: '1', resource: 'orders', orderId: null, orderId_present: true } as unknown as PlanSnapshot['information_state']['last_completed_request'],
        resume_node: null,
      },
    });
    const extraction = makeExtraction({
      actionIntent: 'responder_invitacion',
      rsvpAction: null,
      rsvpCandidateGuestId: null,
      rsvpParty: null,
      rsvpEventReference: 'Boda Test',
    });
    const service = new AgentService({
      planStore: { getByExternalUser: async () => null, save: async () => {} } as never,
      runtime: { extract: async () => extraction, composeReply: async () => ({ text: '' }) } as never,
      providerGateway: {} as never,
      promptLoader: { loadNodeBundle: async () => ({ id: 'x', filePaths: [], instructions: '' }) } as never,
      renderers: {} as never,
    });
    const hasRsvp = (service as unknown as { hasRsvpWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasRsvpWork(plan, extraction);
    expect(hasRsvp).toBe(false);
  });

  it('hasRsvpWork: hard RSVP decision still wins over open information thread', () => {
    const plan = makePlan({
      rsvp_state: { status: 'none', candidates: [], pending_action: null, pending_plus_one_response: null, requested_at: null, selection_attempts: 0 },
      information_state: {
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: { kind: 'purchase', query: 'test', requestId: '1', resource: 'orders', orderId: null,} as unknown as PlanSnapshot['information_state']['last_completed_request'],
        resume_node: null,
      },
    });
    const extractionHard = makeExtraction({
      actionIntent: 'responder_invitacion',
      rsvpAction: 'attending',
      rsvpDecisionSource: 'current_message',
      rsvpCandidateGuestId: null,
    });
    const service = new AgentService({
      planStore: { getByExternalUser: async () => null, save: async () => {} } as never,
      runtime: { extract: async () => extractionHard, composeReply: async () => ({ text: '' }) } as never,
      providerGateway: {} as never,
      promptLoader: { loadNodeBundle: async () => ({ id: 'x', filePaths: [], instructions: '' }) } as never,
      renderers: {} as never,
    });
    const hasRsvp = (service as unknown as { hasRsvpWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasRsvpWork(plan, extractionHard);
    expect(hasRsvp).toBe(true);

    const extractionPlusOne = makeExtraction({
      rsvpParty: { scope: 'self', companion_count: 'one', plus_one_response: 'yes', mentioned_names: [] } as unknown as ExtractionResult['rsvpParty'],
    });
    const hasRsvpPlusOne = (service as unknown as { hasRsvpWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasRsvpWork(plan, extractionPlusOne);
    expect(hasRsvpPlusOne).toBe(true);

    const extractionGuestId = makeExtraction({
      rsvpCandidateGuestId: 12345,
    });
    const hasRsvpGuest = (service as unknown as { hasRsvpWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasRsvpWork(plan, extractionGuestId);
    expect(hasRsvpGuest).toBe(true);
  });

  it('hasRsvpWork: lingering rsvp_state yields to other-domain work without explicit RSVP evidence', () => {
    const plan = makePlan({
      rsvp_state: { status: 'awaiting_event_selection', candidates: [{ guest_id: 1, event_name: 'Test', event_date: null }], pending_action: 'attending', pending_plus_one_response: null, requested_at: new Date().toISOString(), selection_attempts: 0 },
      information_state: {
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: { kind: 'purchase', query: 'test', requestId: '1', resource: 'orders', orderId: null,} as unknown as PlanSnapshot['information_state']['last_completed_request'],
        resume_node: null,
      },
    });
    const extraction = makeExtraction({
      actionIntent: 'responder_invitacion',
      rsvpEventReference: 'Test',
    });
    const service = new AgentService({
      planStore: { getByExternalUser: async () => null, save: async () => {} } as never,
      runtime: { extract: async () => extraction, composeReply: async () => ({ text: '' }) } as never,
      providerGateway: {} as never,
      promptLoader: { loadNodeBundle: async () => ({ id: 'x', filePaths: [], instructions: '' }) } as never,
      renderers: {} as never,
    });
    const hasRsvp = (service as unknown as { hasRsvpWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasRsvpWork(plan, extraction);
    // R9 RSVP relaxation: a lingering selection state never hijacks a turn
    // carrying purchase work with only a bare event reference and no
    // explicit decision, selection, or plus-one evidence. The information
    // flow answers; an explicit RSVP choice still resumes the selection.
    expect(hasRsvp).toBe(false);
  });

  it('hasRsvpWork: fresh RSVP start (last_completed null) unaffected with weak signal', () => {
    const plan = makePlan({
      rsvp_state: { status: 'none', candidates: [], pending_action: null, pending_plus_one_response: null, requested_at: null, selection_attempts: 0 },
      information_state: {
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: null,
        resume_node: null,
      },
    });
    const extraction = makeExtraction({
      actionIntent: 'responder_invitacion',
      rsvpEventReference: 'Boda Test',
    });
    const service = new AgentService({
      planStore: { getByExternalUser: async () => null, save: async () => {} } as never,
      runtime: { extract: async () => extraction, composeReply: async () => ({ text: '' }) } as never,
      providerGateway: {} as never,
      promptLoader: { loadNodeBundle: async () => ({ id: 'x', filePaths: [], instructions: '' }) } as never,
      renderers: {} as never,
    });
    const hasRsvp = (service as unknown as { hasRsvpWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasRsvpWork(plan, extraction);
    expect(hasRsvp).toBe(true);
  });

  it('hasRsvpWork: rsvpAction without current_message source is treated as weak (blocked by open thread)', () => {
    const plan = makePlan({
      rsvp_state: { status: 'none', candidates: [], pending_action: null, pending_plus_one_response: null, requested_at: null, selection_attempts: 0 },
      information_state: {
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: { kind: 'purchase', query: 'test', requestId: '1', resource: 'orders', orderId: null,} as unknown as PlanSnapshot['information_state']['last_completed_request'],
        resume_node: null,
      },
    });
    const extraction = makeExtraction({
      rsvpAction: 'attending',
      rsvpDecisionSource: 'plan_state',
    });
    const service = new AgentService({
      planStore: { getByExternalUser: async () => null, save: async () => {} } as never,
      runtime: { extract: async () => extraction, composeReply: async () => ({ text: '' }) } as never,
      providerGateway: {} as never,
      promptLoader: { loadNodeBundle: async () => ({ id: 'x', filePaths: [], instructions: '' }) } as never,
      renderers: {} as never,
    });
    const hasRsvp = (service as unknown as { hasRsvpWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasRsvpWork(plan, extraction);
    expect(hasRsvp).toBe(false);
  });

  it('hasInformationWork: faq replay continues thread with actionIntent null', () => {
    const plan = makePlan({
      rsvp_state: { status: 'none', candidates: [], pending_action: null, pending_plus_one_response: null, requested_at: null, selection_attempts: 0 },
      information_state: {
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: { kind: 'faq', query: 'validacion', requestId: '1' } as unknown as PlanSnapshot['information_state']['last_completed_request'],
        resume_node: 'resolver_consultas_informativas',
      },
      current_node: 'resolver_consultas_informativas',
    });
    const extraction = makeExtraction({
      actionIntent: null,
      informationRequests: [],
    });
    const service = new AgentService({
      planStore: { getByExternalUser: async () => null, save: async () => {} } as never,
      runtime: { extract: async () => extraction, composeReply: async () => ({ text: '' }) } as never,
      providerGateway: {} as never,
      promptLoader: { loadNodeBundle: async () => ({ id: 'x', filePaths: [], instructions: '' }) } as never,
      renderers: {} as never,
    });
    const hasInfo = (service as unknown as { hasInformationWork: (p: PlanSnapshot, e: ExtractionResult, n: unknown) => boolean }).hasInformationWork(plan, extraction, 'resolver_consultas_informativas');
    expect(hasInfo).toBe(true);
  });

  it('hasInformationWork: purchase and associated_event replay still works', () => {
    const service = new AgentService({
      planStore: { getByExternalUser: async () => null, save: async () => {} } as never,
      runtime: { extract: async () => makeExtraction({}), composeReply: async () => ({ text: '' }) } as never,
      providerGateway: {} as never,
      promptLoader: { loadNodeBundle: async () => ({ id: 'x', filePaths: [], instructions: '' }) } as never,
      renderers: {} as never,
    });
    for (const kind of ['purchase', 'associated_event'] as const) {
      const plan = makePlan({
        information_state: {
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: { kind, query: 'test', requestId: '1', resource: 'orders', orderId: null,} as unknown as PlanSnapshot['information_state']['last_completed_request'],
          resume_node: null,
        },
      });
      const extraction = makeExtraction({ actionIntent: null, informationRequests: [] });
      const hasInfo = (service as unknown as { hasInformationWork: (p: PlanSnapshot, e: ExtractionResult) => boolean }).hasInformationWork(plan, extraction);
      expect(hasInfo).toBe(true);
    }
  });
});
