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

describe('RSVP human-help disclosure deterministic fragment (T10-fix-4 B)', () => {
  it('self_and_others with selection composes warm lead + enumeration + exact question + disclosure as final sentence', async () => {
    const runtime = new DisclosureRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
      '¿A cuál evento deseas confirmar tu asistencia?',
      'Evento 1 - 19 de agosto de 2026; Evento 2 - 20 de agosto de 2026',
    );
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', datetime: '2026-08-19 05:00:00' }),
      rsvpLookupInvitation({ guestId: 584353, eventId: 38332, eventName: 'Otra celebración prueba 2', datetime: '2026-08-20 05:00:00' }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-multi-select', channel: 'whatsapp', externalUserId: 'user-multi' }), {
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
      agentConversationGateway: new DisclosureGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-multi', text: 'Hola, confirmo mi asistencia y la de mi esposa Maria', messageId: 'msg-1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    const disclosure = 'Para confirmar la asistencia de Maria, nuestro equipo de apoyo humano te ayudará';
    expect(outbound).toContain('¡Con gusto!');
    expect(outbound).toContain('Otra celebración prueba - 19 de agosto de 2026');
    expect(outbound).toContain('Otra celebración prueba 2 - 20 de agosto de 2026');
    expect(outbound).toContain('¿Para cuál de estos eventos deseas registrar tu asistencia?');
    expect(outbound).toContain(disclosure);
    expect(outbound.endsWith(disclosure)).toBe(true);
    expect(outbound.toLowerCase()).not.toContain('aplicar la confirmación');
    expect(outbound.toLowerCase()).not.toContain('ya está confirmada');
  });

  it('self_and_others with resolved single appends disclosure after fragment+tissue', async () => {
    const tissue = '¡Que disfrutes mucho la celebración!';
    const runtime = new DisclosureRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] } }),
      tissue,
      'fallback',
    );
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: true, willAttend: true, datetime: '2026-08-19 05:00:00' }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-single', channel: 'whatsapp', externalUserId: 'user-single' }), {
      current_node: 'responder_invitacion', intent: 'responder_invitacion', contact_phone: '+51973296571', contact_phone_extension: '+51', contact_phone_number: '973296571',
      rsvp_state: { status: 'awaiting_action', pending_action: 'attending', candidates: [{ guest_id: 584352, event_name: 'Otra celebración prueba', event_date: '2026-08-19 05:00:00' }], requested_at: '2026-08-17T15:00:00.000Z', selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const service = new AgentService({
      planStore: store, runtime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> { return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } }; } } as unknown as ProviderGateway,
      agentConversationGateway: new DisclosureGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-single', text: 'Confirmo asistencia', messageId: 'msg-2', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    const disclosure = 'Para confirmar la asistencia de Maria, nuestro equipo de apoyo humano te ayudará';
    expect(outbound.endsWith(disclosure)).toBe(true);
    expect(outbound).toContain('Gracias, tu asistencia a Otra celebración prueba');
    expect(outbound).toContain(tissue.replace(/\.$/, ''));
    expect(outbound.indexOf('Gracias,')).toBe(0);
  });

  it('single-person does not append disclosure', async () => {
    const runtime = new DisclosureRuntime(rsvpExtraction({ party: null }), 'Hola, ¿cómo estás?', 'fallback directo');
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: true, willAttend: true, datetime: '2026-08-19 05:00:00' }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-single-no-help', channel: 'whatsapp', externalUserId: 'user-single-no' }), {
      current_node: 'responder_invitacion', intent: 'responder_invitacion', contact_phone: '+51973296571', contact_phone_extension: '+51', contact_phone_number: '973296571',
      rsvp_state: { status: 'awaiting_action', pending_action: 'attending', candidates: [{ guest_id: 584352, event_name: 'Otra celebración prueba', event_date: '2026-08-19 05:00:00' }], requested_at: '2026-08-17T15:00:00.000Z', selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const service = new AgentService({
      planStore: store, runtime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> { return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } }; } } as unknown as ProviderGateway,
      agentConversationGateway: new DisclosureGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-single-no', text: 'Confirmo asistencia', messageId: 'msg-3', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    const outbound = result.outbound.text ?? '';
    expect(outbound).not.toContain('nuestro equipo de apoyo humano te ayudará');
    expect(outbound).toContain('Gracias, tu asistencia a Otra celebración prueba');
  });

  it('disclosure helper renders names correctly and is deterministic', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new DisclosureRuntime(rsvpExtraction({ party: null })),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null };
    const single = (service as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null }).renderHumanHelpDisclosureFragment({ scope: 'self_and_others', mentioned_names: ['Maria'] });
    expect(single).toBe('Para confirmar la asistencia de Maria, nuestro equipo de apoyo humano te ayudará.');
    const two = (service as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null }).renderHumanHelpDisclosureFragment({ scope: 'self_and_others', mentioned_names: ['Maria', 'Carlos'] });
    expect(two).toBe('Para confirmar la asistencia de Maria y Carlos, nuestro equipo de apoyo humano te ayudará.');
    const none = (service as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null }).renderHumanHelpDisclosureFragment({ scope: 'self_and_others', mentioned_names: [] });
    expect(none).toBe('Para confirmar la asistencia de tu acompañante, nuestro equipo de apoyo humano te ayudará.');
    const self = (service as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null }).renderHumanHelpDisclosureFragment({ scope: 'self', mentioned_names: [] });
    expect(self).toBeNull();
    const nullParty = (service as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null }).renderHumanHelpDisclosureFragment(null);
    expect(nullParty).toBeNull();
    // determinism
    const a = (service as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null }).renderHumanHelpDisclosureFragment({ scope: 'self_and_others', mentioned_names: ['Maria'] });
    const b = (service as unknown as { renderHumanHelpDisclosureFragment: (p: unknown) => string | null }).renderHumanHelpDisclosureFragment({ scope: 'self_and_others', mentioned_names: ['Maria'] });
    expect(a).toBe(b);
  });
});

class DisclosureRuntime implements AgentRuntime {
  constructor(private readonly extraction: ExtractionResult, private readonly p1?: string, private readonly p2?: string) {}
  async extract(): Promise<ExtractionResult> { return this.extraction; }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    const para1 = this.p1 ?? 'Modelo tejido 1';
    const para2 = this.p2 ?? 'Modelo tejido 2';
    const paragraphs = this.p1 && this.p2 ? [this.p1, this.p2] : [para1, para2];
    void request;
    return { text: '', structuredMessage: { type: 'generic', paragraphs_es: paragraphs } };
  }
}

class DisclosureGateway implements AgentConversationGateway {
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
