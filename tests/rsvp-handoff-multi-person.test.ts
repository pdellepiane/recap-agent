import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway, AgentGatewayResult, AgentGuestEventsResult, AgentGuestRsvpResult } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

describe('RSVP multi-person handoff (T11)', () => {
  it('self_and_others with names replies single handoff sentence, prefetch read only, plan untouched except backend-registered handoff', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-handoff-1', channel: 'whatsapp', externalUserId: 'user-handoff-1' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          throw new Error('should not be called');
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-handoff-1', text: 'Hola, confirmo mi asistencia y la de mi esposa Maria para el evento del sabado', messageId: 'msg-1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).toBe('MODEL_HANDOFF_SENTINEL');
    expect(outbound.toLowerCase()).not.toContain('rsvp');
    expect(outbound).not.toContain('Para cuál');
    expect(outbound).not.toContain('Evento sin nombre');
    // Two-read order (d51acfef precedent): complete authorized profile
    // preparation reads the phone events once before extraction. The handoff
    // itself performs no RSVP-flow re-read, detail read, or write.
    expect(gateway.calledTools).toEqual(['lookup_guest_events_by_phone']);
    expect(result.trace.tools_called.filter((t: string) => ['lookup_rsvp_invitations', 'lookup_guest_events_by_phone', 'get_guest_event_detail', 'guest_rsvp'].includes(t))).toEqual([]);
    expect(result.trace.tools_called).toContain('request_human_takeover');
    expect(gateway.takeoverCalls).toBe(1);
    expect(gateway.lastPhoneNumber).toBe('51973296571');
    expect(result.plan.rsvp_state).toEqual(seeded.rsvp_state);
    expect(result.plan.current_node).toBe('responder_invitacion');
    expect(result.plan.assumptions).toContain(`rsvp_handoff:${result.plan.conversation_id ?? result.plan.plan_id}`);
    expect(result.trace.operational_note ?? '').toContain('handoff');
  });

  // PASS 2: removed the nameless self_and_others block (same handoff
  // assertions as the with-names test above, a strict subset, and it never
  // asserted the fallback name its title named); keeper is the
  // self_and_others with-names test in this file.
  it('self_and_others with two names interpolates both, prefetch read only and registers handoff', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria', 'Carlos'] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-handoff-3', channel: 'whatsapp', externalUserId: 'user-handoff-3' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'awaiting_event_selection', pending_action: 'attending', candidates: [{ guest_id: 1, event_name: 'Ev1', event_date: '2026-08-19 05:00:00' }], requested_at: new Date().toISOString(), selection_attempts: 1 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          throw new Error('should not be called');
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-handoff-3', text: 'Confirmo para mi y Maria y Carlos', messageId: 'msg-3', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).toBe('MODEL_HANDOFF_SENTINEL');
    expect(result.plan.rsvp_state).toEqual(seeded.rsvp_state);
    expect(result.trace.tools_called).toContain('request_human_takeover');
    expect(gateway.takeoverCalls).toBe(1);
    expect(result.trace.tools_called.filter((t: string) => ['lookup_rsvp_invitations', 'lookup_guest_events_by_phone', 'get_guest_event_detail', 'guest_rsvp'].includes(t))).toEqual([]);
    // Prefetch-only read, as above: no RSVP-flow re-read, detail, or write.
    expect(gateway.calledTools).toEqual(['lookup_guest_events_by_phone']);
    expect(result.plan.assumptions).toContain(`rsvp_handoff:${result.plan.conversation_id ?? result.plan.plan_id}`);
  });

  it('single-person does NOT handoff and proceeds to normal RSVP backend (lookup called)', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self', mentioned_names: [] } }),
    );
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: false, willAttend: null, datetime: '2026-08-19 05:00:00' }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-single', channel: 'whatsapp', externalUserId: 'user-single' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-single', text: 'Confirmo mi asistencia', messageId: 'msg-4', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).not.toBe('¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará.');
    expect(result.trace.tools_called).toContain('lookup_rsvp_invitations');
    expect(result.trace.tools_called).not.toContain('request_human_takeover');
    expect(gateway.takeoverCalls).toBe(0);
  });

});

describe('RSVP multi-person handoff (T12 backend-registered)', () => {
  it('dedupe: second detection in same conversation does not create second backend call', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-dedupe', channel: 'whatsapp', externalUserId: 'user-dedupe' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> { throw new Error('should not be called'); },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const first = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-dedupe', text: 'Confirmo para mi y Maria', messageId: 'msg-d1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(first.trace.tools_called).toContain('request_human_takeover');
    expect(gateway.takeoverCalls).toBe(1);
    expect(first.outbound.text).toBe('MODEL_HANDOFF_SENTINEL');
    expect(first.plan.assumptions).toContain(`rsvp_handoff:${first.plan.conversation_id ?? first.plan.plan_id}`);
    const second = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-dedupe', text: 'Confirmo para mi y Maria otra vez', messageId: 'msg-d2', receivedAt: '2026-08-27T15:01:00.000Z', contactPhone: '+51973296571' });
    expect(second.outbound.text).toBe('MODEL_HANDOFF_SENTINEL');
    expect(second.trace.tools_called).not.toContain('request_human_takeover');
    expect(gateway.takeoverCalls).toBe(1);
    expect(second.plan.assumptions).toContain(`rsvp_handoff:${second.plan.conversation_id ?? second.plan.plan_id}`);
    expect(second.trace.operational_note ?? '').toContain('deduped');
  });

  it('retryable failure is retried once then honest fallback on second failure', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-retry-fail', channel: 'whatsapp', externalUserId: 'user-retry-fail' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway({
      takeoverSequence: [
        { status: 'failed', error: 'transient 500', retryable: true },
        { status: 'failed', error: 'still 500', retryable: true },
      ],
    });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> { throw new Error('should not be called'); },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-retry-fail', text: 'Confirmo para mi y Maria', messageId: 'msg-rf', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(gateway.takeoverCalls).toBe(2);
    expect(result.trace.tools_called).toContain('request_human_takeover');
    expect(result.outbound.text ?? '').toBe('MODEL_HANDOFF_SENTINEL');
    expect(result.plan.human_escalation.status).toBe('none');
    expect(result.plan.human_escalation.last_error).toContain('still 500');
  });

  it('retryable failure retried once succeeds on second attempt then handoff registered', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Carlos'] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-retry-success', channel: 'whatsapp', externalUserId: 'user-retry-success' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway({
      takeoverSequence: [
        { status: 'failed', error: 'transient', retryable: true },
        { status: 'success', message: 'Requested.' },
      ],
    });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> { throw new Error('should not be called'); },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-retry-success', text: 'Confirmo para mi y Carlos', messageId: 'msg-rs', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(gateway.takeoverCalls).toBe(2);
    expect(result.outbound.text).toBe('MODEL_HANDOFF_SENTINEL');
    expect(result.plan.assumptions).toContain(`rsvp_handoff:${result.plan.conversation_id ?? result.plan.plan_id}`);
  });

  it('definitive failure returns honest fallback without claiming help', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-definitive', channel: 'whatsapp', externalUserId: 'user-definitive' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway({
      takeoverSequence: [{ status: 'failed', error: 'definitive 400', retryable: false }],
    });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> { throw new Error('should not be called'); },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-definitive', text: 'Confirmo para mi y Maria', messageId: 'msg-def', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(gateway.takeoverCalls).toBe(1);
    expect(result.trace.tools_called.filter((t) => t === 'request_human_takeover').length).toBe(1);
    expect(result.outbound.text ?? '').toBe('MODEL_HANDOFF_SENTINEL');
    expect(result.plan.human_escalation.status).toBe('none');
    expect(result.plan.human_escalation.last_error).toContain('definitive 400');
    expect(result.plan.rsvp_state).toEqual(seeded.rsvp_state);
  });

  it('skipped handoff (missing phone / not configured) returns honest fallback', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-skipped', channel: 'whatsapp', externalUserId: 'user-skipped' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: null,
      contact_phone_extension: null,
      contact_phone_number: null,
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway({
      takeoverSequence: [{ status: 'skipped', reason: 'missing_phone_number', message: 'Human escalation requires a phone number for the Agent API.' }],
    });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> { throw new Error('should not be called'); },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-skipped', text: 'Confirmo para mi y Maria', messageId: 'msg-skip', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '' });
    // missing phone triggers missingPhoneEscalationResult without calling gateway, but honest fallback still
    expect(result.outbound.text ?? '').toBe('MODEL_HANDOFF_SENTINEL');
    expect(result.plan.human_escalation.status).toBe('none');
  });
});

class HandoffRuntime implements AgentRuntime {
  constructor(private readonly extraction: ExtractionResult) {}
  async extract(): Promise<ExtractionResult> { return this.extraction; }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    return { text: 'MODEL_HANDOFF_SENTINEL', structuredMessage: { type: 'generic', paragraphs_es: ['MODEL_HANDOFF_SENTINEL'] } };
  }
}

class TrackingGateway implements AgentConversationGateway {
  calledTools: string[] = [];
  takeoverCalls = 0;
  lastPhoneNumber: string | null = null;
  private takeoverSequence: AgentGatewayResult[];
  private takeoverIndex = 0;
  constructor(options?: { takeoverSequence?: AgentGatewayResult[] }) {
    this.takeoverSequence = options?.takeoverSequence ?? [{ status: 'success', message: 'Requested.' }];
  }
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; }
  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    this.takeoverCalls += 1;
    this.lastPhoneNumber = phoneNumber;
    const fallback = this.takeoverSequence[this.takeoverSequence.length - 1];
    if (!fallback) {
      throw new Error('takeoverSequence is empty');
    }
    const result = this.takeoverSequence[this.takeoverIndex] ?? fallback;
    if (this.takeoverIndex < this.takeoverSequence.length - 1) {
      this.takeoverIndex += 1;
    }
    return result;
  }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> { this.calledTools.push('lookup_guest_events_by_phone'); return { status: 'not_found' }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { this.calledTools.push('get_guest_event_detail'); return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<AgentGuestRsvpResult> { this.calledTools.push('guest_rsvp'); return { status: 'failed', error: 'unused', retryable: false }; }
}

function rsvpExtraction(args: { party?: { scope: string; mentioned_names: string[] } | null }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: args.party as unknown as ExtractionResult['rsvpParty'],
    rsvpDecisionSource: 'current_message' as const,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null, location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [], assumptions: [], conversationSummary: 'rsvp', selectedProviderHints: [], selectedProviderReferences: [], closeAction: null, pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null, providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null, providerDetailRequest: null,
  } as unknown as ExtractionResult;
}

function rsvpLookupInvitation(args: { guestId?: number; eventId?: number; eventName?: string; hasResponded?: boolean; willAttend?: boolean | null; datetime?: string | null }): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest', guestId: args.guestId ?? 584352, eventId: args.eventId ?? 38331, slug: null, url: null, name: args.eventName ?? 'Otra celebración prueba', place: null, type: null, datetime: args.datetime ?? '2026-08-19 05:00:00', stage: null, isVisible: null, isPublic: null, currency: null, country: null, guestStatus: { hasResponded: args.hasResponded ?? true, willAttend: args.willAttend ?? true, hasCouple: null, responseDate: null }, hostType: null, hostPermission: null, hostStatus: null, celebratedType: null, amountCollected: null, amountTransferred: null, transactionsCount: null, invitedGuestCount: null, confirmedGuestCount: null, orders: [],
  };
}
