import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AgentConversationGateway,
  AgentConversationMessage,
  AgentEventDetailResult,
  AgentGatewayResult,
  AgentGuestEventsResult,
  AgentGuestEventSummary,
  AgentGuestRsvpInput,
  AgentGuestRsvpResult,
  AgentMessageLogInput,
} from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { InMemoryRsvpEffectStore } from '../src/runtime/rsvp-effect-executor';

type ProviderEvent = UserEventLookupResult['events'][number];

const EVENT_A: ProviderEvent = {
  relation: 'guest',
  guestId: 11,
  eventId: 1,
  slug: 'boda-ana',
  url: null,
  name: 'Boda Ana',
  place: null,
  type: null,
  datetime: '2026-09-20 18:00:00',
  stage: null,
  isVisible: null,
  isPublic: null,
  currency: null,
  country: null,
  guestStatus: { hasResponded: false, willAttend: null, hasCouple: null, responseDate: null },
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

const EVENT_B: ProviderEvent = {
  ...EVENT_A,
  guestId: 22,
  eventId: 2,
  slug: 'boda-beto',
  name: 'Boda Beto',
  datetime: '2026-09-21 18:00:00',
};

/**
 * I1/I2/I3 service regressions through the real AgentService.handleTurn
 * path. Structural ID assertions only; all prose stays model-written
 * (the twin runtime stands in for the model).
 */
describe('event identity RSVP regressions', () => {
  it('pending A never overrides an explicit B: only B is selected and mutated', async () => {
    const runtime = new TwinRuntime([
      twinExtraction({ action: 'attending', eventReference: 'Beto' }),
    ]);
    const gateway = new TwinGateway(
      [responded({ guestId: 22, eventId: 2 })],
      [readDetail({ eventId: 2, guestId: 22, willAttend: true })],
    );
    const store = new InMemoryPlanStore();
    await store.save({
      plan: mergePlan(
        createEmptyPlan({ planId: 'p-a', channel: 'whatsapp', externalUserId: 'user-identity' }),
        {
          contact_phone: '+51900000001',
          contact_phone_extension: '+51',
          contact_phone_number: '900000001',
          rsvp_state: {
            status: 'awaiting_action',
            pending_action: 'attending',
            pending_plus_one_response: null,
            candidates: [{ guest_id: 11, event_name: 'Boda Ana', event_date: '2026-09-20 18:00:00' }],
            requested_at: '2026-09-14T00:00:00.000Z',
            selection_attempts: 0,
          },
        },
      ),
      reason: 'seed',
    });
    const service = twinService(runtime, gateway, store, [EVENT_A, EVENT_B]);

    await service.handleTurn(twinInbound('Confirmo la boda de Beto', 'wamid-id-1'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]?.guest_id).toBe(22);
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { event_name: 'Boda Beto', rsvp_state: 'attending' },
    });
  });

  it('sole A with a named B performs zero mutations and never answers A as B', async () => {
    const runtime = new TwinRuntime([
      twinExtraction({ action: 'attending', eventReference: 'Beto' }),
    ]);
    const gateway = new TwinGateway([], []);
    const service = twinService(
      runtime,
      gateway,
      new InMemoryPlanStore(),
      [EVENT_A],
    );

    await service.handleTurn(twinInbound('Confirmo la boda de Beto', 'wamid-id-2'));

    expect(gateway.writes).toHaveLength(0);
    expect(gateway.reads).toBe(0);
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      state: 'needs_event_selection',
    });
    expect(runtime.composeRequests[0]?.errorMessage).toContain('"outcome":"event_selection_required"');
  });

  it('identical names with different IDs, guests and dates never merge', async () => {
    const sharedA: ProviderEvent = { ...EVENT_A, name: 'Celebracion familiar', datetime: '2026-09-20 18:00:00' };
    const sharedB: ProviderEvent = { ...EVENT_B, name: 'Celebracion familiar', datetime: '2026-09-21 18:00:00' };
    const runtime = new TwinRuntime([
      twinExtraction({ action: 'attending', eventReference: 'Celebracion familiar' }),
    ]);
    const gateway = new TwinGateway([], []);
    const service = twinService(
      runtime,
      gateway,
      new InMemoryPlanStore(),
      [sharedA, sharedB],
    );

    await service.handleTurn(twinInbound('Confirmo la celebracion familiar', 'wamid-id-3'));

    expect(gateway.writes).toHaveLength(0);
    const evidence = runtime.composeRequests[0]?.rsvpPhoneEvidence as unknown as {
      state: string;
      candidates: Array<{ event_name: string | null; event_date: string | null }>;
    };
    expect(evidence.state).toBe('needs_event_selection');
    expect(evidence.candidates).toHaveLength(2);
    const dates = evidence.candidates.map((candidate) => candidate.event_date).sort();
    expect(dates).toEqual(['2026-09-20 18:00:00', '2026-09-21 18:00:00']);
    const note = JSON.parse(runtime.composeRequests[0]?.errorMessage ?? '{}') as {
      candidates: Array<{ event_id: number | null }>;
    };
    expect(note.candidates.map((candidate) => candidate.event_id).sort()).toEqual([1, 2]);
  });

  it('missing-ID A never lends its date to dateless B', async () => {
    const missingIdA: ProviderEvent = {
      ...EVENT_A,
      eventId: null,
      name: 'Celebracion familiar',
      datetime: '2026-09-20 18:00:00',
    };
    const summaryB: AgentGuestEventSummary = {
      eventId: 2,
      name: 'Celebracion familiar',
      slug: 'celebracion-familiar',
      url: null,
      datetime: null,
      type: null,
      typeDetail: null,
      stage: null,
      city: null,
      country: null,
      currency: null,
    };
    const runtime = new TwinRuntime([twinExtraction({ action: null })]);
    const gateway = new TwinGateway([], [], { status: 'success', events: [summaryB] });
    const service = twinService(
      runtime,
      gateway,
      new InMemoryPlanStore(),
      [missingIdA],
    );

    await service.handleTurn(twinInbound('Cuando es la celebracion?', 'wamid-id-4'));

    const evidence = runtime.composeRequests[0]?.rsvpPhoneEvidence as unknown as {
      state: string;
      candidates: Array<{ event_name: string | null; event_date: string | null }>;
    };
    expect(evidence.state).toBe('needs_event_selection');
    expect(evidence.candidates).toHaveLength(2);
    const dated = evidence.candidates.filter((candidate) => candidate.event_date !== null);
    expect(dated).toHaveLength(1);
    expect(dated[0]?.event_date).toBe('2026-09-20 18:00:00');
  });

  it.each([
    { willAttend: true as const, expected: 'attending' },
    { willAttend: false as const, expected: 'declining' },
  ])(
    'host-set willAttend=$willAttend with hasResponded=false displays $expected consistently',
    async ({ willAttend, expected }) => {
      const hostSet: ProviderEvent = {
        ...EVENT_A,
        guestStatus: { hasResponded: false, willAttend, hasCouple: null, responseDate: null },
      };
      const runtime = new TwinRuntime([twinExtraction({ action: null })]);
      const gateway = new TwinGateway([], []);
      const service = twinService(
        runtime,
        gateway,
        new InMemoryPlanStore(),
        [hostSet],
      );

      await service.handleTurn(twinInbound('Cual es el estado de mi invitacion?', 'wamid-id-5'));

      expect(gateway.writes).toHaveLength(0);
      expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
        state: 'resolved_single',
        event: { event_name: 'Boda Ana', rsvp_state: expected, invitation_record: 'available' },
      });
    },
  );

  it('B after A then back to A preserves both fact sets per requested target', async () => {
    const runtime = new TwinRuntime([
      twinExtraction({ action: null, eventReference: 'Boda Ana' }),
      twinExtraction({ action: null, eventReference: 'Boda Beto' }),
      twinExtraction({ action: null, eventReference: 'Boda Ana' }),
    ]);
    const gateway = new TwinGateway([], []);
    const store = new InMemoryPlanStore();
    const service = twinService(runtime, gateway, store, [EVENT_A, EVENT_B]);

    await service.handleTurn(twinInbound('Cuando es la boda de Ana?', 'wamid-id-6a'));
    await service.handleTurn(twinInbound('Y la de Beto?', 'wamid-id-6b'));
    await service.handleTurn(twinInbound('Volviendo a la de Ana, cuando es?', 'wamid-id-6c'));

    expect(gateway.writes).toHaveLength(0);
    const names = runtime.composeRequests.map(
      (request) => (request.rsvpPhoneEvidence as unknown as {
        event?: { event_name: string | null; event_date: string | null };
      }).event,
    );
    expect(names[0]).toMatchObject({ event_name: 'Boda Ana', event_date: '2026-09-20 18:00:00' });
    expect(names[1]).toMatchObject({ event_name: 'Boda Beto', event_date: '2026-09-21 18:00:00' });
    expect(names[2]).toMatchObject({ event_name: 'Boda Ana', event_date: '2026-09-20 18:00:00' });
  });
});

class TwinRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(private readonly extractions: ExtractionResult[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    const extraction = this.extractions.shift();
    if (!extraction) {
      throw new Error('No twin extraction queued.');
    }
    return extraction;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return {
      text: 'TWIN_MODEL_SENTINEL',
      structuredMessage: { type: 'generic', paragraphs_es: ['TWIN_MODEL_SENTINEL'] },
    };
  }
}

class TwinGateway implements AgentConversationGateway {
  readonly writes: AgentGuestRsvpInput[] = [];
  reads = 0;

  constructor(
    private readonly writeScript: Array<AgentGuestRsvpResult | Error>,
    private readonly readScript: Array<AgentEventDetailResult | Error>,
    private readonly guestEvents: AgentGuestEventsResult = { status: 'not_found' },
  ) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
  }

  async getRecentMessages(): Promise<{
    status: 'success';
    messages: AgentConversationMessage[];
  }> {
    return { status: 'success', messages: [] };
  }

  async requestHumanTakeover(): Promise<AgentGatewayResult> {
    return { status: 'success', message: 'Requested.' };
  }

  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> {
    return { status: 'failed', error: 'Unused.', retryable: false };
  }

  async updatePhone(): Promise<{ status: 'success' }> {
    return { status: 'success' };
  }

  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> {
    return this.guestEvents;
  }

  async getEventDetail(): Promise<AgentEventDetailResult> {
    this.reads += 1;
    const next = this.readScript.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next ?? { status: 'not_found' };
  }

  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    this.writes.push(input);
    const next = this.writeScript.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (!next) {
      throw new Error('No twin write result queued.');
    }
    return next;
  }
}

function responded(args: { guestId?: number; eventId?: number }): AgentGuestRsvpResult {
  return {
    status: 'responded',
    action: 'attending',
    willAttend: true,
    guestId: args.guestId ?? 22,
    eventId: args.eventId ?? 2,
    eventName: 'Boda Beto',
    eventDate: '2026-09-21 18:00:00',
    plusOne: null,
  };
}

function readDetail(args: { eventId: number; guestId: number; willAttend: boolean | null }): AgentEventDetailResult {
  return {
    status: 'success',
    event: {
      eventId: args.eventId,
      name: args.eventId === 2 ? 'Boda Beto' : 'Boda Ana',
      slug: args.eventId === 2 ? 'boda-beto' : 'boda-ana',
      url: null,
      datetime: '2026-09-21 18:00:00',
      type: null,
      typeDetail: null,
      stage: null,
      city: null,
      country: null,
      currency: null,
      withTime: false,
      timezone: null,
      celebrateds: [],
      moments: [],
      dresscode: null,
      commonAsked: [],
      contactInfo: [],
      attendance: {
        guestId: args.guestId,
        name: 'Invitado',
        hasResponded: true,
        willAttend: args.willAttend,
        responseDate: '2026-09-14T00:00:00.000Z',
      },
      purchases: [],
    },
  };
}

function twinExtraction(args: {
  action: 'attending' | 'declining' | null;
  eventReference?: string | null;
}): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action,
    rsvpDecisionSource: 'current_message',
    rsvpCandidateGuestId: null,
    rsvpEventReference: args.eventReference ?? null,
    rsvpParty: null,
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
    conversationSummary: 'La persona consulta su invitacion.',
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
  };
}

function twinService(
  runtime: AgentRuntime,
  gateway: AgentConversationGateway,
  planStore: InMemoryPlanStore,
  invitations: ProviderEvent[],
): AgentService {
  return new AgentService({
    planStore,
    runtime,
    providerGateway: {
      async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        return {
          lookup: { email: null, phone: '900000001' },
          user: null,
          events: invitations,
          counts: {
            ownerEvents: 0,
            guestEvents: invitations.length,
            hostEvents: 0,
            celebratedEvents: 0,
            recentOrders: 0,
          },
        };
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    rsvpEffectStore: new InMemoryRsvpEffectStore(),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
}

function twinInbound(text: string, messageId: string) {
  return {
    channel: 'whatsapp',
    externalUserId: 'user-identity',
    text,
    messageId,
    receivedAt: '2026-09-14T00:00:00.000Z',
    contactPhone: '+51900000001',
  };
}
