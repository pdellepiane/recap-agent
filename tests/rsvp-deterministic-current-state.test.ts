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

describe('RSVP deterministic current-state report (Fix 2)', () => {
  it('attending renders attending polarity plus gracias plus no-change plus event/date', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const invitation = { eventId: 1, guestId: 584352, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'attending', accessMethod: 'guest_record' } as unknown;
    const text = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(invitation, false);
    expect(text.toLowerCase()).toContain('gracias');
    expect(text.toLowerCase()).toContain('no fue necesario hacer otro cambio');
    expect(text).toContain('Otra celebración prueba');
    expect(text).toContain('19 de agosto de 2026');
    expect(text.toLowerCase()).toMatch(/asistencia.*confirmada|asistirás|asiste/);
  });

  it('declining renders declining polarity plus offer-one-change preserved', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const invitation = { eventId: 1, guestId: 1, eventName: 'Evento Decline', eventDate: '2026-09-12', state: 'declining', accessMethod: 'guest_record' } as unknown;
    const textWithOffer = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(invitation, true);
    expect(textWithOffer.toLowerCase()).toContain('gracias');
    expect(textWithOffer.toLowerCase()).not.toContain('no fue necesario hacer otro cambio');
    expect(textWithOffer).toContain('no asistirás');
    expect(textWithOffer).toContain('Evento Decline');
    expect(textWithOffer).toContain('12 de septiembre de 2026');
    expect(textWithOffer).toContain('¿Deseas que confirme tu asistencia?');
    expect(textWithOffer.trim().endsWith('?')).toBe(true);
    const textWithoutOffer = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(invitation, false);
    expect(textWithoutOffer).toContain('no asistirás');
    expect(textWithoutOffer.toLowerCase()).toContain('no fue necesario hacer otro cambio');
    expect(textWithoutOffer).not.toContain('¿Deseas que confirme tu asistencia?');
  });

  it('identical inputs produce byte-identical output', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const inv = { eventId: 1, guestId: 584352, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'attending', accessMethod: 'guest_record' } as unknown;
    const a = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(inv, false);
    const b = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(inv, false);
    expect(a).toBe(b);
    expect(Buffer.from(a).toString()).toBe(Buffer.from(b).toString());
  });

  it('handleTurn for attending deterministic is byte-identical for identical inputs', async () => {
    const runOnce = async (): Promise<string> => {
      const runtime = new RsvpRuntime([rsvpExtraction({ action: null })]);
      const invitations: UserEventLookupResult['events'] = [rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: true, willAttend: true, datetime: '2026-08-19 05:00:00' })];
      const store = new InMemoryPlanStore();
      const seeded = mergePlan(createEmptyPlan({ planId: 'plan-attending', channel: 'whatsapp', externalUserId: 'user-attending' }), {
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
        agentConversationGateway: new RsvpGateway(),
        promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
        renderers: { whatsapp: new WhatsAppMessageRenderer() },
      });
      const inbound = { channel: 'whatsapp', externalUserId: 'user-attending', text: '¿Mi asistencia ya está confirmada?', messageId: 'msg-1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' };
      const result = await service.handleTurn(inbound);
      return result.outbound.text ?? '';
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a).toBe(b);
    expect(Buffer.from(a).toString()).toBe(Buffer.from(b).toString());
    expect(a).toContain('Gracias');
    expect(a.toLowerCase()).toContain('figura que asistirás');
    expect(a).toContain('19 de agosto de 2026');
    expect(a).not.toContain('19/08/2026');
    expect(a.toLowerCase()).toContain('no fue necesario hacer otro cambio');
    expect(a).toContain('Otra celebración prueba');
    // Must equal deterministic renderer output (bypass model paragraphs_es)
    const verifier = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const expected = verifier.renderRsvpCurrentStateDeterministically({ eventId: 1, guestId: 584352, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'attending' } as unknown, true);
    expect(a).toBe(expected);
  });
});

class RsvpRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];
  constructor(private readonly extractions: ExtractionResult[]) {}
  async extract(): Promise<ExtractionResult> {
    const e = this.extractions.shift();
    if (!e) throw new Error('No extraction queued');
    return e;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return {
      text: '',
      structuredMessage: {
        type: 'generic',
        paragraphs_es: [
          'Tu asistencia para Otra celebración prueba el 19/08/2026 está pendiente de confirmación. Modelo.',
          'Fecha cruda 19/08/2026 no debe aparecer en salida determinística.',
        ],
      },
    };
  }
}

class RsvpGateway implements AgentConversationGateway {
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; }
  async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> { return { status: 'not_found' }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<AgentGuestRsvpResult> { return { status: 'failed', error: 'unused', retryable: false }; }
}

function rsvpExtraction(args: { action?: 'attending'|'declining'|null }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action ?? null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null, location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [], assumptions: [], conversationSummary: 'rsvp', selectedProviderHints: [], selectedProviderReferences: [], closeAction: null, pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null, providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null, providerDetailRequest: null,
  };
}

function rsvpLookupInvitation(args: { guestId?: number; eventId?: number; eventName?: string; hasResponded?: boolean; willAttend?: boolean | null; datetime?: string | null }): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest', guestId: args.guestId ?? 584352, eventId: args.eventId ?? 38331, slug: null, url: null, name: args.eventName ?? 'Otra celebración prueba', place: null, type: null, datetime: args.datetime ?? '2026-08-19 05:00:00', stage: null, isVisible: null, isPublic: null, currency: null, country: null, guestStatus: { hasResponded: args.hasResponded ?? true, willAttend: args.willAttend ?? true, hasCouple: null, responseDate: null }, hostType: null, hostPermission: null, hostStatus: null, celebratedType: null, amountCollected: null, amountTransferred: null, transactionsCount: null, invitedGuestCount: null, confirmedGuestCount: null, orders: [],
  };
}
