import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway, AgentGuestEventsResult, AgentGuestRsvpResult } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractRequest, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';

describe('RSVP three-state projection (Paolo & Mariana fix)', () => {
  it('projects resolved_single without candidate arrays for Paolo & Mariana attending', async () => {
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 9001, eventId: 1001, eventName: 'Paolo & Mariana', hasResponded: true, willAttend: true, datetime: '2026-09-19T18:00:00.000Z' }),
      rsvpLookupInvitation({ guestId: 9002, eventId: 1002, eventName: 'Otro Evento', hasResponded: false, willAttend: null, datetime: '2026-10-10T19:00:00.000Z' }),
    ];
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null, eventReference: 'Paolo & Mariana' })]);
    const service = createService(runtime, new RsvpGateway(), new InMemoryPlanStore(), invitations);
    await service.handleTurn(inbound('Estado de Paolo & Mariana?'));
    const evidence = runtime.composeRequests[0]?.rsvpPhoneEvidence as unknown as Record<string, unknown>;
    expect(evidence).toMatchObject({ state: 'resolved_single' });
    expect(evidence).not.toHaveProperty('candidates');
    expect(evidence).not.toHaveProperty('events');
    expect((evidence as { event: { event_name: string; rsvp_state: string } }).event.event_name).toBe('Paolo & Mariana');
    expect((evidence as { event: { rsvp_state: string } }).event.rsvp_state).toBe('attending');
  });

  it('rejects records lacking event identity and keeps projection deterministic', async () => {
    const service = createService(new RsvpRuntime([rsvpExtraction({ action: null })]), new RsvpGateway());
    const a = service as unknown as { reconcileRsvpPhoneEvidence: (x: unknown[], y: unknown[]) => unknown[] };
    const authInv = [
      { eventId: null, guestId: 1, eventName: null, eventDate: null, state: 'pending', accessMethod: 'guest_record' },
      { eventId: 5, guestId: 2, eventName: 'B', eventDate: '2026-09-12', state: 'pending', accessMethod: 'guest_record' },
      { eventId: 3, guestId: 3, eventName: 'A', eventDate: '2026-09-10', state: 'pending', accessMethod: 'guest_record' },
    ];
    const reconciled = a.reconcileRsvpPhoneEvidence(authInv, []) as Array<{ eventId: number | null; eventName: string | null }>;
    expect(reconciled.some(r => r.eventId === null)).toBe(false);
    expect(reconciled.map(r => r.eventId)).toEqual([3, 5]);
  });

  it('keeps guest-record authority across an enriched merge without flipping accessMethod', async () => {
    const service = createService(new RsvpRuntime([rsvpExtraction({ action: null })]), new RsvpGateway());
    const a = service as unknown as {
      reconcileRsvpPhoneEvidence: (x: unknown[], y: unknown[]) => Array<{
        eventId: number | null;
        guestId: number | null;
        eventDate: string | null;
        state: string;
        accessMethod: string;
      }>;
    };
    // Same event, same guest: fresh enriched values win but the guest-record
    // authority label stays, so guest-bound downstream logic still
    // recognizes the record.
    const reconciled = a.reconcileRsvpPhoneEvidence(
      [{ eventId: 100, guestId: 584353, eventName: 'Otra celebracion prueba', eventDate: null, state: 'pending', accessMethod: 'guest_record' }],
      [{ eventId: 100, guestId: 584353, eventName: 'Otra celebracion prueba', eventDate: '2026-08-19 05:00:00', state: 'declining', accessMethod: 'phone_enriched_event' }],
    );
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      eventId: 100,
      guestId: 584353,
      state: 'declining',
      accessMethod: 'guest_record',
    });
    expect(reconciled[0]?.eventDate).toBe('2026-08-19 05:00:00');
  });

  it('keeps a host-set decided state over stale enriched detail for the same guest', async () => {
    const service = createService(new RsvpRuntime([rsvpExtraction({ action: null })]), new RsvpGateway());
    const a = service as unknown as {
      reconcileRsvpPhoneEvidence: (x: unknown[], y: unknown[]) => Array<{
        eventId: number | null;
        guestId: number | null;
        state: string;
        accessMethod: string;
      }>;
    };
    // Same event, same guest: the host-set declining stands over a stale
    // enriched attending, and the guest-record authority label stays.
    const reconciled = a.reconcileRsvpPhoneEvidence(
      [{ eventId: 100, guestId: 584353, eventName: 'Otra celebracion prueba', eventDate: '2026-08-19 05:00:00', state: 'declining', accessMethod: 'guest_record' }],
      [{ eventId: 100, guestId: 584353, eventName: 'Otra celebracion prueba', eventDate: '2026-08-19 05:00:00', state: 'attending', accessMethod: 'phone_enriched_event' }],
    );
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      eventId: 100,
      guestId: 584353,
      state: 'declining',
      accessMethod: 'guest_record',
    });
  });

  it('keeps a different non-null guest as a separate invitation for the same event', async () => {
    const service = createService(new RsvpRuntime([rsvpExtraction({ action: null })]), new RsvpGateway());
    const a = service as unknown as {
      reconcileRsvpPhoneEvidence: (x: unknown[], y: unknown[]) => Array<{
        eventId: number | null;
        guestId: number | null;
        state: string;
      }>;
    };
    const reconciled = a.reconcileRsvpPhoneEvidence(
      [{ eventId: 100, guestId: 584353, eventName: 'E', eventDate: null, state: 'declining', accessMethod: 'guest_record' }],
      [{ eventId: 100, guestId: 777, eventName: 'E', eventDate: null, state: 'attending', accessMethod: 'phone_enriched_event' }],
    );
    expect(reconciled).toHaveLength(2);
    expect(reconciled.map(r => r.guestId).sort()).toEqual([584353, 777]);
  });

  it('produces stable ordering for needs_event_selection candidates', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const invitations: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 2, eventId: 20, eventName: 'Z Event' }),
      rsvpLookupInvitation({ guestId: 1, eventId: 10, eventName: 'A Event' }),
    ];
    const service = createService(runtime, new RsvpGateway(), new InMemoryPlanStore(), invitations);
    await service.handleTurn(inbound('Confirmo asistencia'));
    const evidence = runtime.composeRequests[0]?.rsvpPhoneEvidence as unknown as { state: string; candidates: Array<{ event_name: string }> };
    expect(evidence.state).toBe('needs_event_selection');
    expect(evidence.candidates.map(c => c.event_name)).toEqual(['A Event', 'Z Event']);
  });

  it('keeps broad candidate list only in needs_event_selection', async () => {
    const runtimeSingle = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const singleInv: UserEventLookupResult['events'] = [rsvpLookupInvitation({ guestId: 41, eventName: 'Solo Evento', hasResponded: true, willAttend: true })];
    const serviceSingle = createService(runtimeSingle, new RsvpGateway(), new InMemoryPlanStore(), singleInv);
    await serviceSingle.handleTurn(inbound('Mi invitacion?'));
    const evSingle = runtimeSingle.composeRequests[0]?.rsvpPhoneEvidence as unknown as Record<string, unknown>;
    expect(evSingle.state).toBe('resolved_single');
    expect(evSingle).not.toHaveProperty('candidates');

    const runtimeMulti = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const multiInv: UserEventLookupResult['events'] = [
      rsvpLookupInvitation({ guestId: 41, eventName: 'Evento A' }),
      rsvpLookupInvitation({ guestId: 42, eventName: 'Evento B' }),
    ];
    const serviceMulti = createService(runtimeMulti, new RsvpGateway(), new InMemoryPlanStore(), multiInv);
    await serviceMulti.handleTurn(inbound('Confirmo'));
    const evMulti = runtimeMulti.composeRequests[0]?.rsvpPhoneEvidence as unknown as { state: string; candidates: unknown[] };
    expect(evMulti.state).toBe('needs_event_selection');
    expect(evMulti.candidates).toHaveLength(2);
  });

  it('produces identical evidence for identical inputs (deterministic rendering)', async () => {
    const makeEvidence = async (): Promise<unknown> => {
      const rt = new RsvpRuntime([rsvpExtraction({ action: null, eventReference: 'Paolo & Mariana' })]);
      const inv: UserEventLookupResult['events'] = [
        rsvpLookupInvitation({ guestId: 9001, eventId: 1001, eventName: 'Paolo & Mariana', hasResponded: true, willAttend: true }),
        rsvpLookupInvitation({ guestId: 9002, eventId: 1002, eventName: 'Otro Evento' }),
      ];
      const svc = createService(rt, new RsvpGateway(), new InMemoryPlanStore(), inv);
      await svc.handleTurn(inbound('Estado?'));
      return rt.composeRequests[0]?.rsvpPhoneEvidence;
    };
    const a = await makeEvidence();
    const b = await makeEvidence();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

class RsvpRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];
  constructor(private readonly extractions: ExtractionResult[]) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async extract(_request: ExtractRequest): Promise<ExtractionResult> {
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

function createService(runtime: AgentRuntime, gateway: AgentConversationGateway, store = new InMemoryPlanStore(), invitations: UserEventLookupResult['events'] | null = null): AgentService {
  return new AgentService({
    planStore: store,
    runtime,
    providerGateway: {
      async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        if (invitations === null) return { lookup: { email: null, phone: '973296571' }, user: null, events: [], counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
        return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
}

function rsvpLookupInvitation(args: { guestId?: number; eventId?: number; eventName?: string; hasResponded?: boolean; willAttend?: boolean | null; datetime?: string | null }): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest', guestId: args.guestId ?? 41, eventId: args.eventId ?? 205, slug: null, url: null, name: args.eventName ?? 'Evento', place: null, type: null, datetime: args.datetime ?? '2026-09-12', stage: null, isVisible: null, isPublic: null, currency: null, country: null, guestStatus: { hasResponded: args.hasResponded ?? false, willAttend: args.willAttend ?? null, hasCouple: null, responseDate: null }, hostType: null, hostPermission: null, hostStatus: null, celebratedType: null, amountCollected: null, amountTransferred: null, transactionsCount: null, invitedGuestCount: null, confirmedGuestCount: null, orders: [],
  };
}

function inbound(text: string) {
  return { channel: 'whatsapp', externalUserId: 'user-rsvp-test', text, messageId: `msg-${text}`, receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' };
}
