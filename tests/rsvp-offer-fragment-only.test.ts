import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway, AgentGuestEventsResult, AgentGuestRsvpResult } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';

describe('RSVP model output for offer states', () => {
  it('preserves generated wording for a declining-state offer', async () => {
    const runtime = new OfferRuntime([rsvpExtraction({ action: null })], 'MODEL_DECLINING_OFFER');
    const invitations = [rsvpLookupInvitation({ guestId: 584353, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: true, willAttend: false, datetime: '2026-08-19 05:00:00' })];
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> { return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } }; } } as unknown as ProviderGateway,
      agentConversationGateway: new OfferGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-declining', text: '¿Cómo figura mi asistencia?', messageId: 'msg-declining', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(result.plan.rsvp_state).toMatchObject({ status: 'awaiting_action', pending_action: 'attending' });
    expect(result.outbound.text).toContain('MODEL_DECLINING_OFFER');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"offer_action":true');
  });

  it('does not prepend a state fragment to generated wording', async () => {
    const runtime = new OfferRuntime([rsvpExtraction({ action: null })], 'MODEL_ATTENDING_STATE', 'MODEL_SECOND_PARAGRAPH');
    const invitations = [rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: true, willAttend: true, datetime: '2026-08-19 05:00:00' })];
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> { return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } }; } } as unknown as ProviderGateway,
      agentConversationGateway: new OfferGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'user-attending', text: '¿Mi asistencia ya está confirmada?', messageId: 'msg-attending', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' });
    expect(result.outbound.text).toContain('MODEL_ATTENDING_STATE');
    expect(result.outbound.text).toContain('MODEL_SECOND_PARAGRAPH');
    expect(result.outbound.text).not.toContain('Gracias, tu asistencia');
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
    const paragraphs = this.p1 ? [this.p1, ...(this.p2 ? [this.p2] : [])] : [para1, para2];
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
