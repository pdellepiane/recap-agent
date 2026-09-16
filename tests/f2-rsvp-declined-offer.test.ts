import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

function extractionNull(): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: null,
    rsvpDecisionSource: 'current_message',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null,
    location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [],
    assumptions: [], conversationSummary: 'rsvp', selectedProviderHints: [],
    selectedProviderReferences: [], closeAction: null, pauseRequested: false,
    contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null,
    providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null,
    providerDetailRequest: null,
  };
}

class NullRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];
  async extract(): Promise<ExtractionResult> { return extractionNull(); }
  async composeReply(request: ComposeReplyRequest): Promise<{ text: string; structuredMessage: { type: 'generic'; paragraphs_es: string[] } }> {
    this.composeRequests.push(request);
    return { text: 'tissue', structuredMessage: { type: 'generic', paragraphs_es: ['tissue'] } };
  }
}

class DeclinedGateway implements AgentConversationGateway {
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; }
  async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'unused', retryable: false }; }
}

function lookupDeclining(): UserEventLookupResult['events'] {
  return [{
    relation: 'guest', guestId: 584353, eventId: 1, slug: null, url: null,
    name: 'Otra celebración prueba', place: null, type: null, datetime: '2026-08-19 05:00:00',
    stage: null, isVisible: null, isPublic: null, currency: null, country: null,
    guestStatus: { hasResponded: true, willAttend: false, hasCouple: null, responseDate: null },
    hostType: null, hostPermission: null, hostStatus: null, celebratedType: null,
    amountCollected: null, amountTransferred: null, transactionsCount: null,
    invitedGuestCount: null, confirmedGuestCount: null, orders: [],
  }];
}

describe('F2 declined read-only offers one change', () => {
  it('read-only declining query stages awaiting_action with explicit question', async () => {
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'p-decl', channel: 'whatsapp', externalUserId: 'u-decl' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+51973296571',
      contact_phone_extension: '+51',
      contact_phone_number: '973296571',
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const runtime = new NullRuntime();
    const service = new AgentService({
      planStore: store,
      runtime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        const events = lookupDeclining();
        return { lookup: { email: null, phone: '973296571' }, user: null, events, counts: { ownerEvents: 0, guestEvents: events.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
      } } as unknown as ProviderGateway,
      agentConversationGateway: new DeclinedGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'u-decl',
      text: '¿Cómo figura mi asistencia a Otra celebración prueba?',
      messageId: 'm1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571',
    });
    // P3 signal-derived offer: a read-only declining query never stages
    // awaiting_action as later-action consent, and with no typed
    // current-message RSVP signal (no event reference or candidate guest
    // id) the prose offer is also withheld (offer_action false).
    expect(result.plan.rsvp_state.status).toBe('none');
    expect(result.plan.rsvp_state.pending_action).toBeNull();
    expect(result.outbound.text).toBe('tissue');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"offer_action":false');
  });
});
