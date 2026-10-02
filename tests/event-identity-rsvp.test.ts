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
import { describeRsvpEventTime, OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
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
    // The fresh-read verification targets the same event that was mutated.
    expect(gateway.readEventIds).toContain(2);
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { event_name: 'Boda Beto', rsvp_state: 'attending' },
    });
    // The reply receipt carries the same guest/event IDs end to end, so the
    // model-written prose grounds on Marta-equivalent B facts only.
    const note = JSON.parse(runtime.composeRequests[0]?.errorMessage ?? '{}') as {
      next_action: string;
      selected_candidate: { guest_id: number };
      backend_result: { status: string; guest_id: number; event_id: number } | null;
      verification: {
        verification_status: string;
        gateway_status: string;
        requested_attendance_change_verified: boolean;
        requested: { guest_id: number; event_id: number };
        observed: { guest_id: number; event_id: number; attendance: string } | null;
      };
    };
    expect(note.next_action).toBe('communicate_confirmed_state');
    expect(note.selected_candidate.guest_id).toBe(22);
    expect(note.backend_result).toBeNull();
    expect(note.verification.gateway_status).toBe('responded');
    expect(note.verification.requested_attendance_change_verified).toBe(true);
    expect(note.verification.verification_status).toBe('verified');
    expect(note.verification.requested).toMatchObject({ guest_id: 22, event_id: 2 });
    expect(note.verification.observed).toMatchObject({ guest_id: 22, event_id: 2, attendance: 'attending' });
    // The confirmation turn carries the stored event hour as a typed fact:
    // rsvp_event_time derives from this projected date, so the model-owned
    // sentence can state the hour. IDs and facts only, never prose pins.
    const confirmedEvidence = runtime.composeRequests[0]?.rsvpPhoneEvidence;
    const confirmedDate = confirmedEvidence?.state === 'resolved_single'
      ? confirmedEvidence.event.event_date
      : null;
    expect(describeRsvpEventTime(confirmedDate)?.hour24).toBe('18:00');
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

  it('shared name across different guests never auto-selects: asks a bounded selection', async () => {
    const hostDeclining: ProviderEvent = {
      ...EVENT_A,
      eventId: 100,
      guestId: 584353,
      name: 'Otra celebracion prueba',
      datetime: '2026-08-19 05:00:00',
      guestStatus: { hasResponded: false, willAttend: false, hasCouple: null, responseDate: null },
    };
    const associatedSummary: AgentGuestEventSummary = {
      eventId: 200,
      name: 'Otra celebracion prueba',
      slug: 'otra-celebracion-prueba',
      url: null,
      datetime: '2026-08-19 05:00:00',
      type: null,
      typeDetail: null,
      stage: null,
      city: null,
      country: null,
      currency: null,
    };
    const runtime = new TwinRuntime([
      twinExtraction({ action: null, eventReference: 'Otra celebracion prueba' }),
    ]);
    // Two-read order (d51acfef precedent): complete authorized profile
    // preparation hydrates the associated event detail before extraction,
    // then the RSVP-specific lookup reads the same detail again before the
    // reply. Both reads observe the same decided attendance; no assertion
    // below changed.
    const gateway = new TwinGateway(
      [],
      [
        readDetail({ eventId: 200, guestId: 777, willAttend: true }),
        readDetail({ eventId: 200, guestId: 777, willAttend: true }),
      ],
      { status: 'success', events: [associatedSummary] },
    );
    const service = twinService(
      runtime,
      gateway,
      new InMemoryPlanStore(),
      [hostDeclining],
    );

    await service.handleTurn(twinInbound('Cual es el estado de mi invitacion?', 'wamid-id-7'));

    // No mutation, no cross-guest auto-pick: two guest-bound decided records
    // for two different events stay unresolved, so the reply asks a bounded
    // selection naming both candidates instead of answering with one
    // guest's record. Same-guest same-event records still resolve directly.
    expect(gateway.writes).toHaveLength(0);
    const evidence = runtime.composeRequests[0]?.rsvpPhoneEvidence as unknown as {
      state: string;
      event?: { event_name: string | null; rsvp_state: string | null };
      candidates?: Array<{ event_name: string | null; rsvp_state: string | null }>;
    };
    expect(evidence.state).toBe('needs_event_selection');
    expect(evidence.event).toBeUndefined();
    expect(evidence.candidates ?? []).toHaveLength(2);
    expect((evidence.candidates ?? []).map((candidate) => candidate.rsvp_state).sort())
      .toEqual(['attending', 'declining']);
  });

  it('B after A then back to A preserves both fact sets per requested target', async () => {    const runtime = new TwinRuntime([
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

/**
 * R6 midnight-suppression twins through the real reply-evidence projection
 * (offline: buildReplyTurnEvidence only, no model call). A date-only record
 * carries no verified hour, so no rsvp_event_time fact is projected and the
 * model-owned sentence states no hour instead of a midnight default. Full
 * No conversion is ever made: the recorded date and hour travel with the
 * place's verified zone; the offset zone survives only as a fallback when
 * no verified zone exists.
 */
describe('rsvp event-time midnight suppression', () => {
  function projectRsvpEventTime(eventDate: string | null, eventTimeZone: string | null = null) {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test',
      replyModel: 'gpt-5',
      extractorModel: 'gpt-5',
      replyProviderLimit: 2,
      presentationProviderLimit: 2,
      providerDetailLookupLimit: 2,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: { lookupUserEventContext: async () => null } as unknown as never,
    });
    const evidence = (runtime as unknown as { buildReplyTurnEvidence: (args: unknown) => {
      rsvp_event_time?: { value: string; local_date: string; hour24: string; timezone: string };
    } }).buildReplyTurnEvidence({
      request: {
        currentNode: 'responder_invitacion',
        previousNode: 'responder_invitacion',
        userMessage: 'Confirmo la boda de Beto',
        messageContext: { historyStatus: 'none', recentMessages: [], history: [] } as unknown as never,
        plan: createEmptyPlan({ planId: 'plan-twin-hour', channel: 'whatsapp', externalUserId: 'user-identity' }),
        extraction: twinExtraction({ action: 'attending', eventReference: 'Beto' }),
        missingFields: [],
        searchReady: false,
        providerResults: [],
        errorMessage: null,
        promptBundleId: 'test',
        promptFilePaths: [],
        toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
        rsvpPhoneEvidence: {
          state: 'resolved_single',
          coverage: 'complete',
          resolution: 'authoritative_invitation',
          event: {
            event_id: 22,
            event_name: 'Boda Beto',
            event_date: eventDate,
            invitation_record: 'available',
            rsvp_state: 'attending',
          },
        },
        customerContext: eventTimeZone === null ? null : {
          invitations: [{ eventId: 22, detail: { timezone: eventTimeZone } }],
        },
      },
      focusNeedCategory: null,
      providerResults: [],
      recommendationFunnel: null,
      authenticationOnlyReply: false,
    });
    return evidence.rsvp_event_time;
  }

  it('projects no hour fact for a date-only record', () => {
    expect(describeRsvpEventTime('2026-09-21')?.hour24).toBe('unknown');
    expect(projectRsvpEventTime('2026-09-21')).toBeUndefined();
  });

  it('recognizes explicit UTC hours without inventing an event zone', () => {
    expect(describeRsvpEventTime('2026-09-21T19:00:00.000Z')?.hour24).toBe('19:00');
    expect(describeRsvpEventTime('2026-09-21T00:00:00.000Z')?.hour24).toBe('00:00');
    expect(describeRsvpEventTime('2026-09-21T19:00:00.000Z')?.timezone).toBe('UTC');
  });

  it('projects the truly-midnight ISO-T source instead of suppressing it', () => {
    expect(projectRsvpEventTime('2026-09-21T00:00:00.000Z')).toEqual({
      value: '2026-09-21T00:00:00.000Z',
      recorded_date: '2026-09-21',
      hour24: '00:00',
      timezone: 'UTC',
    });
  });

  it.each([
    { stored: '2026-09-21 19:00:00', expected: '19:00', timezone: 'unknown' },
    { stored: '2026-09-20 18:00:00', expected: '18:00', timezone: 'unknown' },
    { stored: '2026-09-21T19:00:00.000Z', expected: '19:00', timezone: 'UTC' },
    { stored: '2026-09-21T18:00:00.000Z', expected: '18:00', timezone: 'UTC' },
  ])('respects the source timezone for $stored', ({ stored, expected, timezone }) => {
    expect(projectRsvpEventTime(stored)).toEqual({
      value: stored,
      recorded_date: stored.slice(0, 10),
      hour24: expected,
      timezone,
    });
  });

  it('reads recorded hours as-is in the verified zone without converting', () => {
    expect(projectRsvpEventTime('2026-09-20T18:00:00.000Z', 'America/Lima')).toEqual({
      value: '2026-09-20T18:00:00.000Z',
      recorded_date: '2026-09-20',
      hour24: '18:00',
      timezone: 'America/Lima',
    });
    expect(projectRsvpEventTime('2026-09-21T00:00:00.000Z', 'America/Lima')).toEqual({
      value: '2026-09-21T00:00:00.000Z',
      recorded_date: '2026-09-21',
      hour24: '00:00',
      timezone: 'America/Lima',
    });
    // PASS 2: folded the offset-free local-time case in here (same
    // verified-zone preservation behavior, space-format input).
    expect(projectRsvpEventTime('2026-09-20 18:00:00', 'America/Lima')).toEqual({
      value: '2026-09-20 18:00:00',
      recorded_date: '2026-09-20',
      hour24: '18:00',
      timezone: 'America/Lima',
    });
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
  readonly readEventIds: number[] = [];
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

  async getEventDetail(input: { eventId: number }): Promise<AgentEventDetailResult> {
    this.reads += 1;
    this.readEventIds.push(input.eventId);
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
