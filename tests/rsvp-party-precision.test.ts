import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway, AgentGatewayResult, AgentGuestEventsResult, AgentGuestRsvpResult } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';

describe('rsvp party detection precision (T12-fix)', () => {
  it('prompt tightens party rule: explicit companion evidence only, we-form not evidence, event titles never', () => {
    const prompt = fs.readFileSync(path.resolve(process.cwd(), 'prompts/extractors/rsvp.txt'), 'utf-8');
    expect(prompt).toContain("SOLO con evidencia explicita de acompañante");
    expect(prompt).toContain('Verbos en forma nosotros solos ("confirmamos", "vamos", "apuntamos") NO son evidencia de acompañante');
    expect(prompt).toContain('Titulos de evento NUNCA cuentan como acompañantes');
    expect(prompt).toContain('Gia Antonella');
    expect(prompt).toContain('Julisabeth y Andrés');
    expect(prompt).toContain('mentioned_names` queda vacio salvo que haya nombres reales de acompañantes');
    expect(prompt).toContain('la de mi esposa Maria');
    expect(prompt).toContain('pareja/esposo/esposa/acompañante/+1');
    expect(prompt).toContain('nosotros dos');
  });

  it('jose twin: Si confirmamos la asistencia (event Gia Antonella) -> scope self, no handoff, RSVP lookups run', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: null, eventReference: 'Gia Antonella', conversationSummary: 'Confirma asistencia propia al evento Gia Antonella' }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-jose-twin', channel: 'whatsapp', externalUserId: 'user-jose-twin' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51941438449',
      contact_phone_extension: '+51',
      contact_phone_number: '941438449',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 579788, eventId: 38331, eventName: 'Gia Antonella', hasResponded: true, willAttend: true, datetime: '2026-08-15 22:00:00' }),
    ];
    const gateway = new TrackingGateway();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '941438449' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-jose-twin', text: 'Si confirmamos la asistencia', messageId: 'msg-jose', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51941438449' });
    expect(result.trace.tools_called).toContain('lookup_rsvp_invitations');
    expect(result.trace.tools_called).not.toContain('request_human_takeover');
    expect(gateway.takeoverCalls).toBe(0);
    expect(result.outbound.text ?? '').not.toContain('nuestro equipo de apoyo humano');
  });

  it('maria twin: confirmo mi asistencia y la de mi esposa Maria -> self_and_others Maria with handoff', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: { scope: 'self_and_others', mentioned_names: ['Maria'] }, eventReference: 'evento del sabado', conversationSummary: 'Confirma asistencia para si mismo y esposa Maria' }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-maria-twin', channel: 'whatsapp', externalUserId: 'user-maria-twin' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51941438449',
      contact_phone_extension: '+51',
      contact_phone_number: '941438449',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new TrackingGateway();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          throw new Error('should not be called for multi-person handoff');
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-maria-twin', text: 'confirmo mi asistencia y la de mi esposa Maria', messageId: 'msg-maria', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51941438449' });
    expect(result.trace.tools_called).toContain('request_human_takeover');
    expect(gateway.takeoverCalls).toBe(1);
    expect(gateway.lastPhoneNumber).toBe('51941438449');
    expect(result.outbound.text).toBe('¡Con gusto! Para confirmar la asistencia para ti y para Maria, nuestro equipo de apoyo humano te ayudará');
    expect(result.trace.tools_called.filter((t: string) => ['lookup_rsvp_invitations', 'lookup_guest_events_by_phone', 'get_guest_event_detail', 'guest_rsvp'].includes(t))).toEqual([]);
  });

  it('we-form alone is not companion evidence: confirmamos without companion names stays self', async () => {
    const runtime = new HandoffRuntime(
      rsvpExtraction({ party: null, eventReference: 'Gia Antonella', conversationSummary: 'Confirma asistencia propia' }),
    );
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'plan-weform', channel: 'whatsapp', externalUserId: 'user-weform' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51941438449',
      contact_phone_extension: '+51',
      contact_phone_number: '941438449',
      rsvp_state: { status: 'none', pending_action: null, candidates: [], requested_at: null, selection_attempts: 0 },
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 579788, eventId: 38331, eventName: 'Gia Antonella', hasResponded: true, willAttend: true, datetime: '2026-08-15 22:00:00' }),
    ];
    const gateway = new TrackingGateway();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '941438449' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-weform', text: 'Si confirmamos la asistencia', messageId: 'msg-we', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51941438449' });
    expect(result.trace.tools_called).not.toContain('request_human_takeover');
    expect(result.trace.tools_called).toContain('lookup_rsvp_invitations');
  });
});

class HandoffRuntime implements AgentRuntime {
  constructor(private readonly extraction: ExtractionResult) {}
  async extract(): Promise<ExtractionResult> { return this.extraction; }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    return { text: 'Modelo fallback', structuredMessage: { type: 'generic', paragraphs_es: ['Modelo fallback'] } };
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
    if (!fallback) throw new Error('empty');
    const result = this.takeoverSequence[this.takeoverIndex] ?? fallback;
    if (this.takeoverIndex < this.takeoverSequence.length - 1) this.takeoverIndex += 1;
    return result;
  }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> { this.calledTools.push('lookup_guest_events_by_phone'); return { status: 'not_found' }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { this.calledTools.push('get_guest_event_detail'); return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<AgentGuestRsvpResult> { this.calledTools.push('guest_rsvp'); return { status: 'failed', error: 'unused', retryable: false }; }
}

function rsvpExtraction(args: { party?: { scope: string; mentioned_names: string[] } | null; eventReference?: string | null; conversationSummary?: string }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: 'attending',
    rsvpCandidateGuestId: null,
    rsvpEventReference: args.eventReference ?? null,
    rsvpParty: args.party as unknown as ExtractionResult['rsvpParty'],
    rsvpDecisionSource: 'current_message' as const,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null, location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [], assumptions: [], conversationSummary: args.conversationSummary ?? 'rsvp', selectedProviderHints: [], selectedProviderReferences: [], closeAction: null, pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null, providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null, providerDetailRequest: null,
  } as unknown as ExtractionResult;
}

function rsvpLookupInvitation(args: { guestId?: number; eventId?: number; eventName?: string; hasResponded?: boolean; willAttend?: boolean | null; datetime?: string | null }): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest', guestId: args.guestId ?? 579788, eventId: args.eventId ?? 38331, slug: null, url: null, name: args.eventName ?? 'Gia Antonella', place: null, type: null, datetime: args.datetime ?? '2026-08-15 22:00:00', stage: null, isVisible: null, isPublic: null, currency: null, country: null, guestStatus: { hasResponded: args.hasResponded ?? true, willAttend: args.willAttend ?? true, hasCouple: null, responseDate: null }, hostType: null, hostPermission: null, hostStatus: null, celebratedType: null, amountCollected: null, amountTransferred: null, transactionsCount: null, invitedGuestCount: null, confirmedGuestCount: null, orders: [],
  };
}
