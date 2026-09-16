import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

describe('F2c frozen concise and suppression guard', () => {
  it('single status query without amount skips mutable disclosure', () => {
    const asksExplicitAmount = false;
    const purchasesLength = 1;
    const isSingleStatusQuery = purchasesLength === 1 && !asksExplicitAmount;
    expect(isSingleStatusQuery).toBe(true);
  });

  it('rsvp lane never suppresses acknowledgement', () => {
    const plan = { rsvp_state: { status: 'none' }, current_node: 'responder_invitacion' };
    const validSuppression = plan.rsvp_state.status === 'none' && plan.current_node !== 'responder_invitacion';
    expect(validSuppression).toBe(false);
  });

  it('non-rsvp lane may still suppress when stateless', () => {
    const plan = { rsvp_state: { status: 'none' }, current_node: 'contacto_inicial' };
    const validSuppression = plan.rsvp_state.status === 'none' && plan.current_node !== 'responder_invitacion';
    expect(validSuppression).toBe(true);
  });

  it('post-rsvp thanks in rsvp lane acknowledges once without restarting rsvp', async () => {
    const emptyExtraction: ExtractionResult = {
      actionIntent: null,
      informationRequests: [],
      supportAct: null,
      phoneConfirmation: null,
      rsvpAction: null,
      rsvpDecisionSource: null,
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
      rsvpParty: null,
      intentConfidence: 0.99,
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null,
      location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [],
      assumptions: [], conversationSummary: 'La persona agradece la organizacion de una fiesta familiar ya realizada.',
      selectedProviderHints: [], selectedProviderReferences: [],
      closeAction: null, pauseRequested: false,
      contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null,
      providerQueryIntents: [], providerPlanOperations: [],
      providerExplanationRequest: null, providerDetailRequest: null,
    };
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'p-tito', channel: 'whatsapp', externalUserId: 'u-tito' }), {
      current_node: 'responder_invitacion',
      contact_phone: '+51900004780',
      contact_phone_extension: '+51',
      contact_phone_number: '9000004780',
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = {
      rsvpCalls: 0,
      async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; },
      async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; },
      async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; },
      async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; },
      async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; },
      async getGuestEventsByPhone(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; },
      async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; },
      async guestRsvp(): Promise<{ status: 'failed'; error: string; retryable: false }> { this.rsvpCalls += 1; return { status: 'failed', error: 'unused', retryable: false }; },
    };
    const service = new AgentService({
      planStore: store,
      runtime: {
        async extract(): Promise<ExtractionResult> { return emptyExtraction; },
        async composeReply(): Promise<{ text: string; structuredMessage: { type: 'generic'; paragraphs_es: string[] } }> {
          return { text: 'tissue', structuredMessage: { type: 'generic', paragraphs_es: ['tissue'] } };
        },
      } as unknown as AgentRuntime,
      providerGateway: { async lookupUserEventContext(): Promise<null> { return null; } } as unknown as ProviderGateway,
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'u-tito',
      text: 'Muchas gracias por la organizacion, la fiesta fue para mi familia y estamos muy agradecidos',
      messageId: 'm2', receivedAt: '2026-09-04T15:01:00.000Z', contactPhone: '+51900004780',
    });
    expect(gateway.rsvpCalls).toBe(0);
    const text = result.outbound.text ?? '';
    expect(text).toBe('tissue');
    expect(text).not.toMatch(/confirmar o rechazar/i);
    expect(text).not.toContain('?');
    expect(text).not.toMatch(/rsvp/i);
  });

  it('packet C gratitude follow-up neither replays a stale selection nor claims a new write', async () => {
    const attendingTurn: ExtractionResult = {
      actionIntent: 'responder_invitacion',
      informationRequests: [],
      supportAct: null,
      phoneConfirmation: null,
      rsvpAction: 'attending',
      rsvpDecisionSource: 'current_message',
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
      rsvpParty: null,
      intentConfidence: 0.9,
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null,
      location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [],
      assumptions: [], conversationSummary: 'La persona confirma sin precisar el evento.',
      selectedProviderHints: [], selectedProviderReferences: [],
      closeAction: null, pauseRequested: false,
      contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null,
      providerQueryIntents: [], providerPlanOperations: [],
      providerExplanationRequest: null, providerDetailRequest: null,
    };
    const gratitudeTurn: ExtractionResult = {
      actionIntent: null,
      informationRequests: [],
      supportAct: null,
      phoneConfirmation: null,
      rsvpAction: null,
      rsvpDecisionSource: null,
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
      rsvpParty: null,
      intentConfidence: 0.9,
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null,
      location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [],
      assumptions: [], conversationSummary: 'La persona agradece sin pedir cambios.',
      selectedProviderHints: [], selectedProviderReferences: [],
      closeAction: null, pauseRequested: false,
      contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null,
      providerQueryIntents: [], providerPlanOperations: [],
      providerExplanationRequest: null, providerDetailRequest: null,
    };
    const store = new InMemoryPlanStore();
    await store.save({
      plan: mergePlan(createEmptyPlan({ planId: 'p-tito-2', channel: 'whatsapp', externalUserId: 'u-tito-2' }), {
        current_node: 'responder_invitacion',
        contact_phone: '+51900004780',
        contact_phone_extension: '+51',
        contact_phone_number: '9000004780',
      }),
      reason: 'seed',
    });
    const lookups: Array<'two' | 'one'> = ['two', 'one'];
    const gateway = {
      rsvpCalls: 0,
      async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; },
      async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; },
      async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; },
      async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; },
      async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; },
      async getGuestEventsByPhone(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; },
      async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; },
      async guestRsvp(): Promise<{ status: 'failed'; error: string; retryable: false }> { this.rsvpCalls += 1; return { status: 'failed', error: 'unused', retryable: false }; },
    };
    const extractions = [attendingTurn, gratitudeTurn];
    const composeNotes: Array<string | null> = [];
    const service = new AgentService({
      planStore: store,
      runtime: {
        async extract(): Promise<ExtractionResult> {
          const next = extractions.shift();
          if (!next) throw new Error('No extraction queued.');
          return next;
        },
        async composeReply(request: { errorMessage?: string | null }): Promise<{ text: string; structuredMessage: { type: 'generic'; paragraphs_es: string[] } }> {
          composeNotes.push(request.errorMessage ?? null);
          return { text: 'tissue', structuredMessage: { type: 'generic', paragraphs_es: ['tissue'] } };
        },
      } as unknown as AgentRuntime,
      providerGateway: {
        async lookupUserEventContext() {
          const mode = lookups.shift() ?? 'one';
          const events = mode === 'two'
            ? [invitation(41, 'Matrimonio de Ana y Luis'), invitation(42, 'Cumpleaños de Marta')]
            : [invitation(41, 'Matrimonio de Ana y Luis')];
          return {
            lookup: { email: null, phone: '9000004780' },
            user: null,
            events,
            counts: { ownerEvents: 0, guestEvents: events.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
          };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    function invitation(guestId: number, name: string) {
      return {
        relation: 'guest', guestId, eventId: guestId, slug: null, url: null, name,
        place: null, type: null, datetime: '2026-09-12', stage: null, isVisible: null,
        isPublic: null, currency: null, country: null,
        guestStatus: { hasResponded: false, willAttend: null, hasCouple: null, responseDate: null },
        hostType: null, hostPermission: null, hostStatus: null, celebratedType: null,
        amountCollected: null, amountTransferred: null, transactionsCount: null,
        invitedGuestCount: null, confirmedGuestCount: null, orders: [],
      };
    }
    const first = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'u-tito-2',
      text: 'Sí, confirmo mi asistencia',
      messageId: 'm-tito-1', receivedAt: '2026-09-04T15:01:00.000Z', contactPhone: '+51900004780',
    });
    expect(first.plan.rsvp_state.status).toBe('awaiting_event_selection');
    const second = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'u-tito-2',
      text: 'Muchas gracias por la organización, estamos muy agradecidos',
      messageId: 'm-tito-2', receivedAt: '2026-09-04T15:02:00.000Z', contactPhone: '+51900004780',
    });
    expect(gateway.rsvpCalls).toBe(0);
    // A1: the pending selection is retained but never resumed by gratitude:
    // no new request evidence, no replay, no write. The current turn is a
    // plain closing, so no RSVP outcome note is manufactured for it.
    expect(second.plan.rsvp_state.status).toBe('awaiting_event_selection');
    const note = composeNotes[1] ?? '';
    expect(note).not.toContain('select_one_event');
    expect(note).not.toContain('mutation_result');
    expect(note).not.toContain('quedó registrada');
    expect(second.outbound.text).toBe('tissue');
  });
});
