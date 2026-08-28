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

describe('RSVP composed multi-person selection reply (T10-fix-5)', () => {
  it('self_and_others + selection composes warm lead, enumeration, exact question, disclosure, no overclaim', async () => {
    const runtime = new ComposedRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
      'tissue that should be ignored if it repeats enumeration',
    );
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', datetime: '2026-08-19 05:00:00' }),
      rsvpLookupInvitation({ guestId: 584353, eventId: 38332, eventName: 'Otra celebración prueba 2', datetime: '2026-08-20 05:00:00' }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-multi-composed', channel: 'whatsapp', externalUserId: 'user-multi-composed' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: new ComposedGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-multi-composed', text: 'Hola, confirmo mi asistencia y la de mi esposa Maria para el evento del sabado', messageId: 'msg-1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).toContain('¡Con gusto!');
    expect(outbound).toContain('Otra celebración prueba - 19 de agosto de 2026');
    expect(outbound).toContain('Otra celebración prueba 2 - 20 de agosto de 2026');
    expect(outbound).toContain('¿Para cuál de estos eventos deseas registrar tu asistencia?');
    expect(outbound).toContain('Para confirmar la asistencia de Maria, nuestro equipo de apoyo humano te ayudará');
    expect(outbound.toLowerCase()).not.toContain('aplicar la confirmación');
    expect(outbound.toLowerCase()).not.toContain('aplicar la confirmacion');
    expect(outbound.indexOf('¡Con gusto!')).toBe(0);
    // disclosure after question, before optional tissue (tissue is after question before disclosure in this implementation)
    expect(outbound.indexOf('¿Para cuál de estos eventos deseas registrar tu asistencia?') < outbound.indexOf('Para confirmar la asistencia de Maria')).toBe(true);
    // awaiting_event_selection
    expect(result.plan.rsvp_state.status).toBe('awaiting_event_selection');
  });

  it('self_and_others + selection passes through optional tissue single sentence', async () => {
    const tissue = '¡Gracias por tu paciencia!';
    const runtime = new ComposedRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
      tissue,
    );
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', datetime: '2026-08-19 05:00:00' }),
      rsvpLookupInvitation({ guestId: 584353, eventId: 38332, eventName: 'Otra celebración prueba 2', datetime: '2026-08-20 05:00:00' }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-tissue', channel: 'whatsapp', externalUserId: 'user-tissue' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: new ComposedGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-tissue', text: 'Hola, confirmo mi asistencia y la de mi esposa Maria', messageId: 'msg-2', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).toContain(tissue);
    expect(outbound).toContain('¡Con gusto!');
    expect(outbound).toContain('¿Para cuál de estos eventos deseas registrar tu asistencia?');
  });

  it('single-person selection remains model-rendered and untouched (no warm lead, no deterministic composition)', async () => {
    const modelReply = '¿A cuál evento te refieres: Evento 1 - 19 de agosto de 2026 o Evento 2 - 20 de agosto de 2026?';
    const runtime = new SinglePersonRuntime(
      rsvpExtraction({ party: null }),
      modelReply,
    );
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Evento 1', datetime: '2026-08-19 05:00:00' }),
      rsvpLookupInvitation({ guestId: 584353, eventId: 38332, eventName: 'Evento 2', datetime: '2026-08-20 05:00:00' }),
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
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: new ComposedGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-single', text: 'Ese.', messageId: 'msg-3', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).toContain(modelReply);
    expect(outbound).not.toContain('¡Con gusto!');
    expect(outbound).not.toContain('¿Para cuál de estos eventos deseas registrar tu asistencia?');
    expect(outbound).not.toContain('nuestro equipo de apoyo humano te ayudará');
  });

  it('sanitizes tissue that contains forbidden overclaim phrase', async () => {
    const forbiddenTissue = 'Deseas aplicar la confirmación para ti y Maria';
    const runtime = new ComposedRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
      forbiddenTissue,
    );
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', datetime: '2026-08-19 05:00:00' }),
      rsvpLookupInvitation({ guestId: 584353, eventId: 38332, eventName: 'Otra celebración prueba 2', datetime: '2026-08-20 05:00:00' }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-forbidden', channel: 'whatsapp', externalUserId: 'user-forbidden' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: new ComposedGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-forbidden', text: 'Hola, confirmo mi asistencia y la de mi esposa Maria', messageId: 'msg-4', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound.toLowerCase()).not.toContain('aplicar la confirmación');
    expect(outbound).toContain('¡Con gusto!');
    expect(outbound).toContain('Para confirmar la asistencia de Maria, nuestro equipo de apoyo humano te ayudará');
  });
});

class ComposedRuntime implements AgentRuntime {
  constructor(private readonly extraction: ExtractionResult, private readonly tissue?: string) {}
  async extract(): Promise<ExtractionResult> { return this.extraction; }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    if (this.tissue) {
      return { text: '', structuredMessage: { type: 'generic', paragraphs_es: [this.tissue] } };
    }
    return { text: '', structuredMessage: { type: 'generic', paragraphs_es: ['Modelo fallback'] } };
  }
}

class SinglePersonRuntime implements AgentRuntime {
  constructor(private readonly extraction: ExtractionResult, private readonly modelReply: string) {}
  async extract(): Promise<ExtractionResult> { return this.extraction; }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    return { text: this.modelReply, structuredMessage: undefined };
  }
}

class ComposedGateway implements AgentConversationGateway {
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; }
  async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> { return { status: 'not_found' }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<AgentGuestRsvpResult> { return { status: 'failed', error: 'unused', retryable: false }; }
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
