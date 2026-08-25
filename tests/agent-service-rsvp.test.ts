import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type {
  AgentConversationMessage,
  AgentConversationGateway,
  AgentGatewayResult,
  AgentGuestEventsResult,
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
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

describe('AgentService RSVP flow', () => {
  it('keeps immediate RSVP changes in the RSVP-only prompt bundle', () => {
    const systemPrompt = fs.readFileSync(
      path.resolve(process.cwd(), 'prompts/nodes/responder_invitacion/system.txt'),
      'utf8',
    );
    expect(systemPrompt).toContain(
      'registra el cambio en ese mismo turno',
    );
    expect(systemPrompt).not.toContain(
      'pide una sola confirmación antes de ejecutar el cambio',
    );
  });

  it.each([
    ['attending', 'estado attending final'],
    ['declining', 'estado declining final'],
  ] as const)('records an explicit %s response using only the trusted channel phone', async (
    action,
    expectedNote,
  ) => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action })]);
    const gateway = new RsvpGateway([{
      status: 'responded',
      action,
      willAttend: action === 'attending',
      guestId: 41,
      eventName: 'Matrimonio de Ana y Luis',
      eventDate: '2026-09-12',
    }]);
    const service = createService(runtime, gateway);

    const result = await service.handleTurn(inbound('Confirmo mi respuesta'));

    expect(gateway.inputs).toEqual([{
      phone_extension: '+51',
      phone_number: '973296571',
      action,
      guest_id: 41,
    }]);
    expect(result.plan.current_node).toBe('responder_invitacion');
    expect(result.plan.rsvp_state.status).toBe('none');
    expect(result.plan.user_auth.status).toBe('none');
    expect(result.trace.route_kind).toBe('rsvp');
    expect(result.trace.tools_called).toContain('guest_rsvp');
    expect(result.trace.tools_called).toContain('lookup_guest_events_by_phone');
    expect(gateway.guestEventLookupCalls).toBe(1);
    expect(result.trace.timing_ms.rsvp_execution).toBeTypeOf('number');
    expect(runtime.composeRequests[0]?.errorMessage).toContain(expectedNote);
    expect(runtime.composeRequests[0]?.errorMessage).not.toContain('correo');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      coverage: 'complete',
      resolution: 'authoritative_invitation',
      events: [{
        event_name: 'Matrimonio de Ana y Luis',
        invitation_record: 'available',
        rsvp_state: action,
      }],
    });
  });

  it('persists multiple pending candidates and re-calls with only a validated selection', async () => {
    const runtime = new RsvpRuntime([
      rsvpExtraction({ action: 'attending' }),
      rsvpExtraction({
        action: null,
        candidateGuestId: 42,
        eventReference: 'Cumpleaños de Marta',
      }),
    ]);
    const gateway = new RsvpGateway([
      {
        status: 'responded',
        action: 'attending',
        willAttend: true,
        guestId: 42,
        eventName: 'Cumpleaños de Marta',
        eventDate: null,
      },
    ]);
    const store = new InMemoryPlanStore();
    const invitations = [
      rsvpLookupInvitation({ guestId: 41, eventName: 'Matrimonio de Ana y Luis' }),
      rsvpLookupInvitation({ guestId: 42, eventName: 'Cumpleaños de Marta' }),
    ];
    const service = createService(runtime, gateway, store, invitations);

    const first = await service.handleTurn(inbound('Sí, asistiré'));
    const second = await service.handleTurn(inbound('Al cumpleaños de Marta'));

    expect(first.plan.rsvp_state).toMatchObject({
      status: 'awaiting_event_selection',
      pending_action: 'attending',
      selection_attempts: 0,
    });
    expect(first.plan.rsvp_state.candidates).toHaveLength(2);
    expect(gateway.inputs[0]).toEqual({
      phone_extension: '+51',
      phone_number: '973296571',
      action: 'attending',
      guest_id: 42,
    });
    expect(second.plan.rsvp_state.status).toBe('none');
    expect(runtime.composeRequests[0]?.plan.rsvp_state.candidates).toHaveLength(2);
  });

  it('never calls the mutation when the extracted guest id is not a stored candidate', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({
      action: null,
      candidateGuestId: 999,
      eventReference: 'Ese evento',
    })]);
    const gateway = new RsvpGateway([]);
    const store = new InMemoryPlanStore();
    await store.save({
      reason: 'seed-rsvp',
      plan: mergePlan(createEmptyPlan({
        planId: 'plan-rsvp-seeded',
        channel: 'whatsapp',
        externalUserId: 'user-rsvp',
      }), {
        contact_phone: '51973296571',
        contact_phone_extension: '+51',
        contact_phone_number: '973296571',
        current_node: 'responder_invitacion',
        rsvp_state: {
          status: 'awaiting_event_selection',
          pending_action: 'declining',
          candidates: [
            {
              guest_id: 41,
              event_name: 'Matrimonio de Ana y Luis',
              event_date: '2026-09-12',
            },
            {
              guest_id: 42,
              event_name: 'Cumpleaños de Marta',
              event_date: null,
            },
          ],
          requested_at: '2026-08-13T15:00:00.000Z',
          selection_attempts: 0,
        },
      }),
    });
    const service = createService(runtime, gateway, store, [
      rsvpLookupInvitation({ guestId: 41, eventName: 'Matrimonio de Ana y Luis' }),
      rsvpLookupInvitation({ guestId: 42, eventName: 'Cumpleaños de Marta' }),
    ]);

    const result = await service.handleTurn(inbound('Ese evento'));

    expect(gateway.inputs).toEqual([]);
    expect(result.trace.tools_called).not.toContain('guest_rsvp');
    expect(result.plan.rsvp_state.selection_attempts).toBe(1);
    expect(runtime.composeRequests[0]?.errorMessage).toContain(
      'varias invitaciones reconciliadas',
    );
  });

  it('reports a pending invitation and offers confirmation without mutating it', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const gateway = new RsvpGateway([]);
    const service = createService(runtime, gateway);

    const result = await service.handleTurn(inbound('¿Cómo está mi invitación?'));

    expect(gateway.inputs).toEqual([]);
    expect(result.plan.rsvp_state).toMatchObject({
      status: 'awaiting_action',
      pending_action: 'attending',
    });
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence?.events[0]?.rsvp_state).toBe('pending');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('confirmes su asistencia');
  });

  it('distinguishes a user-level not-found result from a lookup failure', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: 'attending' })]);
    const gateway = new RsvpGateway([]);
    const service = createService(runtime, gateway, new InMemoryPlanStore(), null);

    await service.handleTurn(inbound('Sí, confirmo que asistiré'));

    expect(gateway.inputs).toEqual([]);
    expect(runtime.composeRequests[0]?.errorMessage).toContain(
      'no encontró ninguna invitación asociada',
    );
    expect(runtime.composeRequests[0]?.errorMessage).not.toContain(
      'No fue posible consultar',
    );
  });

  it('reports an already-confirmed invitation naturally without another mutation', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const gateway = new RsvpGateway([], [], {
      status: 'success',
      events: [{
        eventId: 205,
        name: 'Matrimonio de Ana y Luis',
        slug: 'matrimonio-ana-luis',
        url: null,
        datetime: '2026-09-12',
        type: null,
        typeDetail: null,
        stage: null,
        city: 'Lima',
        country: 'PE',
        currency: 'PEN',
      }],
    });
    const service = createService(runtime, gateway, new InMemoryPlanStore(), [
      rsvpLookupInvitation({ hasResponded: true, willAttend: true }),
    ]);

    await service.handleTurn(inbound('¿Mi asistencia está confirmada?'));

    expect(gateway.inputs).toEqual([]);
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence?.events[0]?.rsvp_state).toBe('attending');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence?.events).toHaveLength(1);
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence?.events[0]?.invitation_record).toBe(
      'available',
    );
    expect(runtime.composeRequests[0]?.errorMessage).toContain('disfrute el evento');
  });

  it('applies an explicit RSVP reversal immediately without another confirmation turn', async () => {
    const runtime = new RsvpRuntime([
      rsvpExtraction({ action: 'attending' }),
    ]);
    const gateway = new RsvpGateway([{
      status: 'responded',
      action: 'attending',
      willAttend: true,
      guestId: 41,
      eventName: 'Matrimonio de Ana y Luis',
      eventDate: '2026-09-12',
    }]);
    const store = new InMemoryPlanStore();
    const service = createService(runtime, gateway, store, [
      rsvpLookupInvitation({ hasResponded: true, willAttend: false }),
    ]);

    const result = await service.handleTurn(inbound('Quiero confirmar que asistiré'));

    expect(result.plan.rsvp_state.status).toBe('none');
    expect(gateway.inputs).toHaveLength(1);
    expect(gateway.inputs[0]).toMatchObject({ action: 'attending', guest_id: 41 });
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence?.events[0]?.rsvp_state).toBe('attending');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('actualización se completó');
  });

  it('never claims a declined invitation changed when the backend returns its current state', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const gateway = new RsvpGateway([{
      status: 'already_responded',
      currentAction: 'declining',
      requestedAction: 'attending',
      guestId: 41,
      eventName: 'Matrimonio de Ana y Luis',
      eventDate: null,
    }]);
    const store = new InMemoryPlanStore();
    await store.save({
      reason: 'seed-confirmed-change',
      plan: mergePlan(createEmptyPlan({
        planId: 'plan-rsvp-change',
        channel: 'whatsapp',
        externalUserId: 'user-rsvp',
      }), {
        contact_phone: '51973296571',
        contact_phone_extension: '+51',
        contact_phone_number: '973296571',
        current_node: 'responder_invitacion',
        rsvp_state: {
          status: 'awaiting_action',
          pending_action: 'attending',
          candidates: [{
            guest_id: 41,
            event_name: 'Matrimonio de Ana y Luis',
            event_date: null,
          }],
          requested_at: '2026-08-17T15:00:00.000Z',
          selection_attempts: 0,
        },
      }),
    });
    const service = createService(runtime, gateway, store, [
      rsvpLookupInvitation({ hasResponded: true, willAttend: false }),
    ]);

    await service.handleTurn(inbound('Sí'));

    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence?.events[0]?.rsvp_state).toBe('declining');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('no cambió');
    expect(runtime.composeRequests[0]?.errorMessage).not.toContain('quedó registrada');
  });

  it.each([
    [{
      status: 'already_responded',
      currentAction: null,
      requestedAction: 'attending',
      guestId: null,
      eventName: null,
      eventDate: null,
    }, 'ya tenía una respuesta registrada'],
    [{ status: 'no_pending' }, 'no confirmó ninguna actualización'],
    [{ status: 'phone_mismatch' }, 'no corresponde al número confiable'],
    [{ status: 'failed', error: 'timeout', retryable: true }, 'falló temporalmente'],
  ] satisfies Array<[AgentGuestRsvpResult, string]>)('reports %o without inventing success', async (
    gatewayResult,
    expectedNote,
  ) => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: 'attending' })]);
    const gateway = new RsvpGateway([gatewayResult]);
    const service = createService(runtime, gateway, new InMemoryPlanStore(), [
      rsvpLookupInvitation({ guestId: 41, eventName: 'Gia Antonella' }),
    ]);

    const result = await service.handleTurn(inbound('Sí asistiré'));

    expect(result.plan.rsvp_state.status).toBe('none');
    expect(runtime.composeRequests[0]?.errorMessage).toContain(expectedNote);
    expect(runtime.composeRequests[0]?.errorMessage).not.toContain(
      'quedó registrada',
    );
  });

  it('does not erase a campaign-grounded invitation when the user lookup has no current record', async () => {
    const runtime = new RsvpRuntime([
      rsvpExtraction({
        action: 'attending',
        eventReference: 'Gia Antonella',
      }),
    ]);
    const gateway = new RsvpGateway([], [campaignMessage('Gia Antonella')]);
    const service = createService(runtime, gateway, new InMemoryPlanStore(), []);

    const result = await service.handleTurn(inbound('Sí confirmamos la asistencia'));

    const request = runtime.composeRequests[0];
    expect(request?.rsvpPhoneEvidence).toEqual({
      coverage: 'complete',
      resolution: 'not_found',
      events: [],
    });
    expect(request?.extraction.rsvpEventReference).toBe('Gia Antonella');
    expect(request?.errorMessage).toContain('no devolvió su registro ni su estado');
    expect(request?.errorMessage).not.toContain(
      'no encontró invitaciones pendientes para el número',
    );
    expect(request?.errorMessage).not.toContain('quedó registrada');
    expect(request?.turnDecision?.persistReason).toBe(
      'needs_input',
    );
    expect(result.trace.tools_called).toContain('lookup_rsvp_invitations');
    expect(result.trace.tools_called).not.toContain('guest_rsvp');
  });

  it('uses the trusted-phone event read fallback instead of falsely denying an associated invitation', async () => {
    const runtime = new RsvpRuntime([
      rsvpExtraction({
        action: 'attending',
        eventReference: 'Michelle & Jorge',
      }),
    ]);
    const gateway = new RsvpGateway([], [], {
      status: 'success',
      events: [{
        eventId: 37218,
        name: 'Michelle & Jorge',
        slug: 'michellejorge',
        url: 'https://sinenvolturas.com/michellejorge',
        datetime: '2026-10-10T19:00:00.000Z',
        type: 'wedding',
        typeDetail: null,
        stage: 'active',
        city: 'Lima',
        country: 'PE',
        currency: 'PEN',
      }],
    });
    const service = createService(runtime, gateway, new InMemoryPlanStore(), []);

    const result = await service.handleTurn(inbound('Hola, ya confirmé, gracias'));

    expect(gateway.inputs).toEqual([]);
    expect(gateway.guestEventLookupCalls).toBe(1);
    expect(result.trace.tools_called).toContain('lookup_rsvp_invitations');
    expect(result.trace.tools_called).toContain('lookup_guest_events_by_phone');
    expect(result.trace.tools_called).not.toContain('guest_rsvp');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toEqual({
      coverage: 'complete',
      resolution: 'event_association_only',
      events: [{
        event_name: 'Michelle & Jorge',
        event_date: '2026-10-10T19:00:00.000Z',
        invitation_record: 'unavailable',
        rsvp_state: 'unavailable',
      }],
    });
    expect(runtime.composeRequests[0]?.errorMessage).not.toContain('Michelle & Jorge');
    expect(runtime.composeRequests[0]?.errorMessage).toContain(
      'no hiciste otro cambio',
    );
    expect(runtime.composeRequests[0]?.errorMessage).not.toContain(
      'no encontró ninguna invitación',
    );
  });

  it('starts both phone lookups before either result is reconciled', async () => {
    const sequence: string[] = [];
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const gateway = new RsvpGateway(
      [],
      [],
      { status: 'not_found' },
      () => sequence.push('guest-events-start'),
    );
    const providerGateway = {
      async lookupUserEventContext(): Promise<UserEventLookupResult> {
        sequence.push('user-context-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        sequence.push('user-context-end');
        return {
          lookup: { email: null, phone: '973296571' },
          user: null,
          events: [rsvpLookupInvitation({})],
          counts: {
            ownerEvents: 0,
            guestEvents: 1,
            hostEvents: 0,
            celebratedEvents: 0,
            recentOrders: 0,
          },
        };
      },
    } as unknown as ProviderGateway;
    const service = createService(
      runtime,
      gateway,
      new InMemoryPlanStore(),
      [],
      providerGateway,
    );

    await service.handleTurn(inbound('¿Cómo está mi invitación?'));

    expect(sequence).toEqual([
      'user-context-start',
      'guest-events-start',
      'user-context-end',
    ]);
  });

  it('marks reconciled evidence partial when one phone lookup fails', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: null })]);
    const gateway = new RsvpGateway(
      [],
      [],
      { status: 'not_found' },
      () => {
        throw new Error('guest-event read unavailable');
      },
    );
    const service = createService(runtime, gateway);

    await service.handleTurn(inbound('¿Cómo está mi invitación?'));

    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      coverage: 'partial',
      resolution: 'authoritative_invitation',
      events: [{ invitation_record: 'available', rsvp_state: 'pending' }],
    });
    expect(runtime.composeRequests[0]?.errorMessage).toContain('coverage=partial');
    expect(runtime.composeRequests[0]?.errorMessage).toContain(
      'no presentes la lista de eventos como exhaustiva',
    );
  });
});

class RsvpRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(private readonly extractions: ExtractionResult[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    const extraction = this.extractions.shift();
    if (!extraction) {
      throw new Error('No RSVP extraction queued.');
    }
    return extraction;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: request.errorMessage ?? 'Respuesta de asistencia' };
  }
}

class RsvpGateway implements AgentConversationGateway {
  readonly inputs: AgentGuestRsvpInput[] = [];
  guestEventLookupCalls = 0;

  constructor(
    private readonly results: AgentGuestRsvpResult[],
    private readonly messages: AgentConversationMessage[] = [],
    private readonly guestEvents: AgentGuestEventsResult = { status: 'not_found' },
    private readonly onGuestEventLookup?: () => void,
  ) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
  }

  async getRecentMessages(): Promise<{
    status: 'success';
    messages: AgentConversationMessage[];
  }> {
    return { status: 'success', messages: this.messages };
  }

  async requestHumanTakeover(): Promise<AgentGatewayResult> {
    return { status: 'success', message: 'Requested.' };
  }

  async authByPhone(): Promise<{
    status: 'failed';
    error: string;
    retryable: false;
  }> {
    return { status: 'failed', error: 'Unused.', retryable: false };
  }

  async updatePhone(): Promise<{ status: 'success' }> {
    return { status: 'success' };
  }

  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> {
    this.guestEventLookupCalls += 1;
    this.onGuestEventLookup?.();
    return this.guestEvents;
  }

  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    this.inputs.push(input);
    const result = this.results.shift();
    if (!result) {
      throw new Error('No RSVP gateway result queued.');
    }
    return result;
  }
}

function campaignMessage(eventName: string): AgentConversationMessage {
  return {
    id: 1,
    direction: 'outbound',
    source: 'admin_campaign',
    body: `Este es un recordatorio del evento: ${eventName}`,
    status: 'delivered',
    whatsappMessageId: null,
    sentAt: '2026-08-13T14:00:00.000Z',
    createdAt: '2026-08-13T14:00:00.000Z',
  };
}

function rsvpExtraction(args: {
  action: 'attending' | 'declining' | null;
  candidateGuestId?: number | null;
  eventReference?: string | null;
}): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action,
    rsvpCandidateGuestId: args.candidateGuestId ?? null,
    rsvpEventReference: args.eventReference ?? null,
    intentConfidence: 0.98,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
    },
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
    conversationSummary: 'La persona responde una invitación.',
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

function createService(
  runtime: AgentRuntime,
  gateway: AgentConversationGateway,
  store = new InMemoryPlanStore(),
  invitations: UserEventLookupResult['events'] | null = [rsvpLookupInvitation({})],
  providerGateway?: ProviderGateway,
): AgentService {
  return new AgentService({
    planStore: store,
    runtime,
    providerGateway: providerGateway ?? {
      async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        if (invitations === null) {
          return null;
        }
        return {
          lookup: { email: null, phone: '973296571' },
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
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
}

function rsvpLookupInvitation(args: {
  guestId?: number;
  eventName?: string;
  hasResponded?: boolean;
  willAttend?: boolean | null;
}): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest',
    guestId: args.guestId ?? 41,
    eventId: 205,
    slug: null,
    url: null,
    name: args.eventName ?? 'Matrimonio de Ana y Luis',
    place: null,
    type: null,
    datetime: '2026-09-12',
    stage: null,
    isVisible: null,
    isPublic: null,
    currency: null,
    country: null,
    guestStatus: {
      hasResponded: args.hasResponded ?? false,
      willAttend: args.willAttend ?? null,
      hasCouple: null,
      responseDate: null,
    },
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

function inbound(text: string) {
  return {
    channel: 'whatsapp',
    externalUserId: 'user-rsvp',
    text,
    messageId: `message-${text}`,
    receivedAt: '2026-08-13T15:00:00.000Z',
    contactPhone: '+51973296571',
  };
}
