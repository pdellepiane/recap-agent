import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway, AgentGuestEventsResult, AgentGuestRsvpResult } from '../src/runtime/agent-conversation-gateway';
import type { ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { QueuedAgentRuntime, type StubComposeFn } from './agent-runtime-test-utils';

describe('RSVP model output and typed current state', () => {
  it('passes current-state evidence to the model and preserves both model paragraphs', async () => {
    const first = 'MODELO_ESTADO_PRIMERO';
    const second = 'MODELO_ESTADO_SEGUNDO';
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })], first, second);
    const invitations = [rsvpLookupInvitation({
      guestId: 584352,
      eventId: 38331,
      eventName: 'Otra celebración prueba',
      hasResponded: true,
      willAttend: true,
      datetime: '2026-08-19 05:00:00',
    })];
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: new RsvpGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-attending', text: '¿Mi asistencia ya está confirmada?', messageId: 'msg-1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(result.outbound.text).toContain(first);
    expect(result.outbound.text).toContain(second);
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"invitation_state":"attending"');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({ state: 'resolved_single', event: { rsvp_state: 'attending' } });
  });

  it('keeps a declining invitation offer typed while model wording remains authoritative', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })], 'MODELO_OFERTA');
    const invitations = [rsvpLookupInvitation({ guestId: 584353, eventId: 38331, eventName: 'Evento Decline', hasResponded: true, willAttend: false, datetime: '2026-09-12' })];
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> { return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } }; } } as unknown as ProviderGateway,
      agentConversationGateway: new RsvpGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-declining', text: '¿Cómo figura mi asistencia?', messageId: 'msg-2', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    // P3 (P2 intended change): read-only never stages awaiting_action.
    expect(result.plan.rsvp_state).toMatchObject({ status: 'none', pending_action: null });
    expect(result.outbound.text).toContain('MODELO_OFERTA');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"invitation_state":"declining"');
    // PASS 2: folded the declining-offer prose assertion in here (same
    // read-only declining scenario previously pinned from the
    // offer-fragment file).
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"offer_action":true');
  });

  it('does not prepend or replace a generated RSVP response', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: 'attending' })], 'SENTINEL_RSVP_REPLY');
    const result = await new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> { return null; } } as unknown as ProviderGateway,
      agentConversationGateway: new RsvpGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }).handleTurn({ channel: 'whatsapp', externalUserId: 'user-rsvp', text: 'Confirmo', messageId: 'msg-3', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(result.outbound.text).toContain('SENTINEL_RSVP_REPLY');
    expect(result.outbound.text).not.toContain('Listo,');

    // PASS 2: folded the attending-state wording case in here (model
    // paragraphs preserved verbatim, no state fragment prepended).
    const attendingRuntime = new RsvpRuntime([rsvpExtraction({ action: null })], 'MODEL_ATTENDING_STATE', 'MODEL_SECOND_PARAGRAPH');
    const invitations = [rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: true, willAttend: true, datetime: '2026-08-19 05:00:00' })];
    const attendingResult = await new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: attendingRuntime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> { return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } }; } } as unknown as ProviderGateway,
      agentConversationGateway: new RsvpGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }).handleTurn({ channel: 'whatsapp', externalUserId: 'user-attending', text: '¿Mi asistencia ya está confirmada?', messageId: 'msg-attending', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(attendingResult.outbound.text).toContain('MODEL_ATTENDING_STATE');
    expect(attendingResult.outbound.text).toContain('MODEL_SECOND_PARAGRAPH');
    expect(attendingResult.outbound.text).not.toContain('Gracias, tu asistencia');
  });
});

const tissueReply = (p1?: string, p2?: string): StubComposeFn => () => {
  const para1 = p1 ?? 'Tu asistencia para Otra celebración prueba el 19/08/2026 está pendiente. Modelo.';
  const para2 = p2 ?? 'Fecha cruda 19/08/2026 no debe aparecer.';
  // If custom tissue provided, use it; else default
  const paragraphs = p1
    ? [p1, ...(p2 ? [p2] : [])]
    : [para1, para2];
  return {
    text: '',
    structuredMessage: {
      type: 'generic',
      paragraphs_es: paragraphs,
    },
  };
};

class RsvpRuntime extends QueuedAgentRuntime {
  constructor(extractions: ExtractionResult[], p1?: string, p2?: string) {
    super(extractions, tissueReply(p1, p2));
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
