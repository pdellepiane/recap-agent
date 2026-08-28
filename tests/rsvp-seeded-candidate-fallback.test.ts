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

describe('RSVP seeded candidate fallback (Fix 1)', () => {
  it('fallback engaged projects needs_event_selection with candidates carrying event_name and event_date', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: 'attending', eventReference: null })]);
    const invitations: UserEventLookupResult['events'] = [];
    const store = new InMemoryPlanStore();
    const seededPlan = mergePlan(createEmptyPlan({ planId: 'plan-fallback', channel: 'whatsapp', externalUserId: 'user-fallback' }), {
      current_node: 'responder_invitacion',
      intent: 'responder_invitacion',
      contact_phone: '+12025550100',
      contact_phone_extension: '+1',
      contact_phone_number: '2025550100',
      rsvp_state: {
        status: 'awaiting_event_selection',
        pending_action: 'attending',
        candidates: [
          { guest_id: 41001, event_name: 'Matrimonio de Ana y Luis', event_date: '2026-09-12' },
          { guest_id: 41002, event_name: 'Cumpleaños de Marta', event_date: '2026-09-19' },
        ],
        requested_at: '2026-08-13T15:00:00.000Z',
        selection_attempts: 0,
      },
    });
    await store.save({ plan: seededPlan, reason: 'seed' });
    const service = createService(runtime, new RsvpGateway(), store, invitations);
    await service.handleTurn(inbound('Ese.', 'user-fallback'));
    const evidence = runtime.composeRequests[0]?.rsvpPhoneEvidence as unknown as { state: string; candidates: Array<{ event_name: string | null; event_date: string | null }> };
    expect(evidence.state).toBe('needs_event_selection');
    expect(evidence.candidates).toHaveLength(2);
    for (const candidate of evidence.candidates) {
      expect(candidate.event_name).toBeTruthy();
      expect(candidate.event_date).toBeTruthy();
    }
    const names = evidence.candidates.map((c) => c.event_name);
    expect(names).toEqual(expect.arrayContaining(['Matrimonio de Ana y Luis', 'Cumpleaños de Marta']));
    const dates = evidence.candidates.map((c) => c.event_date);
    expect(dates).toEqual(expect.arrayContaining(['2026-09-12', '2026-09-19']));
  });

  it('multipleRsvpInvitationsNote enumerates each candidate with name and Spanish date', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { multipleRsvpInvitationsNote: (inv: unknown[], action: unknown, attempts: number) => string; formatRsvpSpanishDate: (v: string | null) => string };
    const invitations = [
      { eventId: null, guestId: 41001, eventName: 'Matrimonio de Ana y Luis', eventDate: '2026-09-12', state: 'unknown', accessMethod: 'guest_record' },
      { eventId: null, guestId: 41002, eventName: 'Cumpleaños de Marta', eventDate: '2026-09-19', state: 'unknown', accessMethod: 'guest_record' },
    ] as unknown[];
    const note = (service as unknown as { multipleRsvpInvitationsNote: (a: unknown, b: unknown, c: number) => string }).multipleRsvpInvitationsNote(invitations, 'attending', 0);
    expect(note).toContain('Matrimonio de Ana y Luis');
    expect(note).toContain('Cumpleaños de Marta');
    expect(note).toContain('12 de septiembre de 2026');
    expect(note).toContain('19 de septiembre de 2026');
  });

  it('identical inputs produce byte-identical note and projection (deterministic)', async () => {
    const make = async (): Promise<{ evidence: unknown; note: string }> => {
      const rt = new RsvpRuntime([rsvpExtraction({ action: 'attending', eventReference: null })]);
      const inv: UserEventLookupResult['events'] = [];
      const store = new InMemoryPlanStore();
      const seeded = mergePlan(createEmptyPlan({ planId: 'plan-det', channel: 'whatsapp', externalUserId: 'user-det' }), {
        current_node: 'responder_invitacion',
        intent: 'responder_invitacion',
        contact_phone: '+12025550100',
        contact_phone_extension: '+1',
        contact_phone_number: '2025550100',
        rsvp_state: {
          status: 'awaiting_event_selection',
          pending_action: 'attending',
          candidates: [
            { guest_id: 41001, event_name: 'Matrimonio de Ana y Luis', event_date: '2026-09-12' },
            { guest_id: 41002, event_name: 'Cumpleaños de Marta', event_date: '2026-09-19' },
          ],
          requested_at: '2026-08-13T15:00:00.000Z',
          selection_attempts: 0,
        },
      });
      await store.save({ plan: seeded, reason: 'seed' });
      const svc = createService(rt, new RsvpGateway(), store, inv);
      await svc.handleTurn(inbound('Ese.', 'user-det'));
      const evidence = rt.composeRequests[0]?.rsvpPhoneEvidence;
      const svc2 = svc as unknown as { multipleRsvpInvitationsNote: (a: unknown, b: unknown, c: number) => string };
      const note = svc2.multipleRsvpInvitationsNote(
        [
          { eventId: null, guestId: 41001, eventName: 'Matrimonio de Ana y Luis', eventDate: '2026-09-12', state: 'unknown', accessMethod: 'guest_record' },
          { eventId: null, guestId: 41002, eventName: 'Cumpleaños de Marta', eventDate: '2026-09-19', state: 'unknown', accessMethod: 'guest_record' },
        ] as unknown[],
        'attending',
        1,
      );
      return { evidence, note };
    };
    const a = await make();
    const b = await make();
    expect(JSON.stringify(a.evidence)).toBe(JSON.stringify(b.evidence));
    expect(a.note).toBe(b.note);
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
    return { text: request.errorMessage ?? 'ok' };
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

function rsvpExtraction(args: { action?: 'attending'|'declining'|null; eventReference?: string | null }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action ?? null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: args.eventReference ?? null,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null, location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [], assumptions: [], conversationSummary: 'rsvp', selectedProviderHints: [], selectedProviderReferences: [], closeAction: null, pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null, providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null, providerDetailRequest: null,
  };
}

function createService(runtime: AgentRuntime, gateway: AgentConversationGateway, store: InMemoryPlanStore, invitations: UserEventLookupResult['events'] | null): AgentService {
  return new AgentService({
    planStore: store,
    runtime,
    providerGateway: {
      async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        if (invitations === null) return { lookup: { email: null, phone: '2025550100' }, user: null, events: [], counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        return { lookup: { email: null, phone: '2025550100' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
}

function inbound(text: string, externalUserId = 'user-fallback') {
  return { channel: 'whatsapp', externalUserId, text, messageId: `msg-${text}`, receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+12025550100' };
}
