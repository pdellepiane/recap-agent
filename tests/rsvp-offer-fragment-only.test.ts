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

describe('RSVP offer-variant fragment-only (T10-fix-3 A)', () => {
  it('declining+offer variant outbound equals fragment exactly with no tissue', async () => {
    const tissue1 = 'Tejido invalido que no debe aparecer.';
    const tissue2 = 'Otra frase que deberia ser filtrada.';
    const runtime = new OfferRuntime([rsvpExtraction({ action: null })], tissue1, tissue2);
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({
        guestId: 584353,
        eventId: 38331,
        eventName: 'Otra celebración prueba',
        hasResponded: true,
        willAttend: false,
        datetime: '2026-08-19 05:00:00',
      }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(
      createEmptyPlan({ planId: 'plan-declining-offer', channel: 'whatsapp', externalUserId: 'user-declining' }),
      {
        current_node: 'responder_invitacion',
        intent: 'responder_invitacion',
        contact_phone: '+51973296571',
        contact_phone_extension: '+51',
        contact_phone_number: '973296571',
        rsvp_state: {
          status: 'awaiting_action',
          pending_action: 'attending',
          candidates: [{ guest_id: 584353, event_name: 'Otra celebración prueba', event_date: '2026-08-19 05:00:00' }],
          requested_at: '2026-08-17T15:00:00.000Z',
          selection_attempts: 0,
        },
      },
    );
    await store.save({ plan: seeded, reason: 'seed' });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return {
            lookup: { email: null, phone: '973296571' },
            user: null,
            events: invitations,
            counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
          };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: new OfferGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const inbound = {
      channel: 'whatsapp' as const,
      externalUserId: 'user-declining',
      text: '¿Cómo figura mi asistencia?',
      messageId: 'msg-declining',
      receivedAt: '2026-08-27T15:00:00.000Z',
      contactPhone: '+51973296571',
    };
    const result = await service.handleTurn(inbound);
    const outbound = result.outbound.text ?? '';
    const verifier = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new OfferRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const fragment = verifier.renderRsvpCurrentStateDeterministically(
      { eventId: 38331, guestId: 584353, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'declining' } as unknown,
      true,
    );
    expect(outbound).toBe(fragment);
    expect(outbound).toContain('Figura que no asistirás');
    expect(outbound).toContain('¿Deseas que confirme tu asistencia?');
    expect(outbound.trim().endsWith('?')).toBe(true);
    expect(outbound).not.toContain(tissue1);
    expect(outbound).not.toContain(tissue2);
    expect(outbound).not.toContain('Que disfrutes');
  });

  it('attending variant keeps fragment lead plus tissue present', async () => {
    const tissue1 = '¡Que disfrutes mucho la celebración!';
    const tissue2 = 'Quedo atento por si necesitas algo más.';
    const runtime = new OfferRuntime([rsvpExtraction({ action: null })], tissue1, tissue2);
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({
        guestId: 584352,
        eventId: 38331,
        eventName: 'Otra celebración prueba',
        hasResponded: true,
        willAttend: true,
        datetime: '2026-08-19 05:00:00',
      }),
    ];
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(
      createEmptyPlan({ planId: 'plan-attending-offer', channel: 'whatsapp', externalUserId: 'user-attending' }),
      {
        current_node: 'responder_invitacion',
        intent: 'responder_invitacion',
        contact_phone: '+51973296571',
        contact_phone_extension: '+51',
        contact_phone_number: '973296571',
        rsvp_state: {
          status: 'awaiting_action',
          pending_action: 'attending',
          candidates: [{ guest_id: 584352, event_name: 'Otra celebración prueba', event_date: '2026-08-19 05:00:00' }],
          requested_at: '2026-08-17T15:00:00.000Z',
          selection_attempts: 0,
        },
      },
    );
    await store.save({ plan: seeded, reason: 'seed' });
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return {
            lookup: { email: null, phone: '973296571' },
            user: null,
            events: invitations,
            counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
          };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: new OfferGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const inbound = {
      channel: 'whatsapp' as const,
      externalUserId: 'user-attending',
      text: '¿Mi asistencia ya está confirmada?',
      messageId: 'msg-attending',
      receivedAt: '2026-08-27T15:00:00.000Z',
      contactPhone: '+51973296571',
    };
    const result = await service.handleTurn(inbound);
    const outbound = result.outbound.text ?? '';
    const verifier = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new OfferRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const fragment = verifier.renderRsvpCurrentStateDeterministically(
      { eventId: 38331, guestId: 584352, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'attending' } as unknown,
      true,
    );
    expect(outbound).toContain(fragment);
    expect(outbound.indexOf(fragment)).toBe(0);
    expect(outbound).toContain(tissue1.replace(/\.$/, ''));
    expect(outbound.indexOf(tissue1.replace(/\.$/, ''))).toBeGreaterThan(outbound.indexOf(fragment));
  });
});

class OfferRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];
  constructor(private readonly extractions: ExtractionResult[], private readonly p1?: string, private readonly p2?: string) {}
  async extract(): Promise<ExtractionResult> {
    const e = this.extractions.shift();
    if (!e) throw new Error('No extraction queued');
    return e;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    const para1 = this.p1 ?? 'Modelo tejido 1';
    const para2 = this.p2 ?? 'Modelo tejido 2';
    const paragraphs = this.p1 && this.p2 ? [this.p1, this.p2] : [para1, para2];
    return { text: '', structuredMessage: { type: 'generic', paragraphs_es: paragraphs } };
  }
}

class OfferGateway implements AgentConversationGateway {
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; }
  async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> { return { status: 'not_found' }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<AgentGuestRsvpResult> { return { status: 'failed', error: 'unused', retryable: false }; }
}

function rsvpExtraction(args: { action?: 'attending' | 'declining' | null }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action ?? null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
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
    conversationSummary: 'rsvp',
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
  } as unknown as ExtractionResult;
}

function rsvpLookupInvitation(args: {
  guestId?: number;
  eventId?: number;
  eventName?: string;
  hasResponded?: boolean;
  willAttend?: boolean | null;
  datetime?: string | null;
}): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest',
    guestId: args.guestId ?? 584352,
    eventId: args.eventId ?? 38331,
    slug: null,
    url: null,
    name: args.eventName ?? 'Otra celebración prueba',
    place: null,
    type: null,
    datetime: args.datetime ?? '2026-08-19 05:00:00',
    stage: null,
    isVisible: null,
    isPublic: null,
    currency: null,
    country: null,
    guestStatus: { hasResponded: args.hasResponded ?? true, willAttend: args.willAttend ?? true, hasCouple: null, responseDate: null },
    hostType: null,
    hostPermission: null,
    hostStatus: null,
    celebratedType: null,
    amountCollected: null,
    amountTransferred: null,
    transactionsCount: null,
    invitedGuestCount: null,
    confirmedGuestCount: null,
    orders: [],
  };
}
