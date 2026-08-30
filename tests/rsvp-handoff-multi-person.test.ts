import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway, AgentGuestEventsResult, AgentGuestRsvpResult } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

describe('RSVP multi-person handoff (T11)', () => {
  it('self_and_others with names replies single handoff sentence, no backend calls, plan untouched', async () => {
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
    // sanitizeAssistantOutput strips trailing period
    expect(outbound).toBe('¡Con gusto! Para confirmar la asistencia para ti y para Maria, nuestro equipo de apoyo humano te ayudará');
    expect(outbound.toLowerCase()).not.toContain('rsvp');
    expect(outbound).not.toContain('Para cuál');
    expect(outbound).not.toContain('Evento sin nombre');
    expect(gateway.calledTools).toEqual([]);
    expect(result.trace.tools_called.filter((t: string) => ['lookup_rsvp_invitations', 'lookup_guest_events_by_phone', 'get_guest_event_detail', 'guest_rsvp'].includes(t))).toEqual([]);
    expect(result.plan.rsvp_state).toEqual(seeded.rsvp_state);
    expect(result.plan.current_node).toBe('responder_invitacion');
    expect(result.trace.operational_note ?? '').toContain('handoff');
  });

  it('self_and_others without names uses fallback tu acompañante, one sentence', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: [] } }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-handoff-2', channel: 'whatsapp', externalUserId: 'user-handoff-2' }), {
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
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-handoff-2', text: 'Confirmamos asistencia para dos personas', messageId: 'msg-2', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).toBe('¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará');
    expect(outbound.toLowerCase()).not.toContain('rsvp');
    expect(gateway.calledTools).toEqual([]);
    expect(result.trace.tools_called.filter((t: string) => ['lookup_rsvp_invitations', 'lookup_guest_events_by_phone', 'get_guest_event_detail', 'guest_rsvp'].includes(t))).toEqual([]);
    expect(result.plan.rsvp_state).toEqual(seeded.rsvp_state);
  });

  it('self_and_others with two names interpolates both', async () => {
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
    expect(outbound).toBe('¡Con gusto! Para confirmar la asistencia para ti y para Maria y Carlos, nuestro equipo de apoyo humano te ayudará');
    expect(result.plan.rsvp_state).toEqual(seeded.rsvp_state);
    expect(result.trace.tools_called.filter((t: string) => ['lookup_rsvp_invitations', 'lookup_guest_events_by_phone', 'get_guest_event_detail', 'guest_rsvp'].includes(t))).toEqual([]);
    expect(gateway.calledTools).toEqual([]);
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
    expect(outbound).not.toBe('¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará');
    expect(result.trace.tools_called).toContain('lookup_rsvp_invitations');
  });

  it('handoff fragment is deterministic helper', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new HandoffRuntime(rsvpExtraction({ party: null })),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpHandoffFragment: (p: unknown) => string };
    const render = (service as unknown as { renderRsvpHandoffFragment: (p: unknown) => string }).renderRsvpHandoffFragment.bind(service);
    expect(render({ scope: 'self_and_others', mentioned_names: ['Maria'] })).toBe('¡Con gusto! Para confirmar la asistencia para ti y para Maria, nuestro equipo de apoyo humano te ayudará.');
    expect(render({ scope: 'self_and_others', mentioned_names: [] })).toBe('¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará.');
    expect(render({ scope: 'self_and_others', mentioned_names: ['Maria', 'Carlos', 'Ana'] })).toBe('¡Con gusto! Para confirmar la asistencia para ti y para Maria, Carlos y Ana, nuestro equipo de apoyo humano te ayudará.');
    expect(render({ scope: 'self', mentioned_names: [] })).toBe('¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará.');
    expect(render(null)).toBe('¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará.');
  });
});

class HandoffRuntime implements AgentRuntime {
  constructor(private readonly extraction: ExtractionResult) {}
  async extract(): Promise<ExtractionResult> { return this.extraction; }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    return { text: 'should not be called for handoff but called for single-person', structuredMessage: { type: 'generic', paragraphs_es: ['Modelo fallback'] } };
  }
}

class TrackingGateway implements AgentConversationGateway {
  calledTools: string[] = [];
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; }
  async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; }
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
