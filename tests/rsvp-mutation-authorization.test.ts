import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type {
  AgentConversationGateway,
  AgentGatewayResult,
  AgentGuestEventsResult,
  AgentEventDetailResult,
  AgentGuestRsvpInput,
  AgentGuestRsvpResult,
  AgentMessageLogInput,
  AgentConversationMessage,
} from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ExtractionResult,
} from '../src/runtime/contracts';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { QueuedAgentRuntime, echoErrorMessage } from './agent-runtime-test-utils';

describe('RSVP mutation authorization (awaiting_action vs awaiting_event_selection)', () => {
  it('awaiting_action without current-turn decision reports declining and offers one change without mutating', async () => {
    // PASS 2: covers both a null action and a stale plan_state-sourced
    // action (neither is a current-turn decision, so neither mutates).
    const scenarios = [
      { extraction: rsvpExtraction({ action: null }), text: 'Como figura mi asistencia a Matrimonio de Ana y Luis?' },
      { extraction: rsvpExtraction({ action: 'attending', decisionSource: 'plan_state' }), text: 'Quiero responder mi invitación.' },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const runtime = new RsvpRuntime([scenario.extraction]);
      const gateway = new RsvpGateway([]);
      const store = new InMemoryPlanStore();
      await store.save({
        reason: 'seed-awaiting-action',
        plan: mergePlan(
          createEmptyPlan({ planId: `plan-auth-1-${index}`, channel: 'whatsapp', externalUserId: 'user-rsvp' }),
          {
            contact_phone: '51973296571',
            contact_phone_extension: '+51',
            contact_phone_number: '973296571',
            current_node: 'responder_invitacion',
            rsvp_state: {
              status: 'awaiting_action',
              pending_action: 'attending',
              candidates: [{ guest_id: 41, event_name: 'Matrimonio de Ana y Luis', event_date: '2026-09-12' }],
              requested_at: '2026-08-17T15:00:00.000Z',
              selection_attempts: 0,
            },
          },
        ),
      });
      const service = createService(runtime, gateway, store, [
        rsvpLookupInvitation({ guestId: 41, eventName: 'Matrimonio de Ana y Luis', hasResponded: true, willAttend: false }),
      ]);

      const result = await service.handleTurn(inbound(scenario.text));

      expect(gateway.inputs).toEqual([]);
      expect(result.trace.tools_called).not.toContain('guest_rsvp');
      expect(result.trace.tools_called).toContain('lookup_rsvp_invitations');
      // P3 (P2 intended change): a pre-existing awaiting_action does not
      // survive a read-only turn; the declining state is still reported and
      // the one-change offer travels in prose via offer_action.
      expect(result.plan.rsvp_state.status).toBe('none');
      expect(result.plan.rsvp_state.pending_action).toBeNull();
      expect(runtime.composeRequests[0]?.errorMessage).toContain('"invitation_state":"declining"');
    }
  });

  it('awaiting_event_selection without current-turn action but stored pending_action still executes selection continuation', async () => {
    const runtime = new RsvpRuntime([
      rsvpExtraction({ action: null, candidateGuestId: 42, eventReference: 'Cumpleanos de Marta' }),
    ]);
    const gateway = new RsvpGateway([
      { status: 'responded', action: 'attending', willAttend: true, guestId: 42, eventName: 'Cumpleanos de Marta', eventDate: '2026-09-19' },
    ]);
    const store = new InMemoryPlanStore();
    await store.save({
      reason: 'seed-awaiting-selection',
      plan: mergePlan(
        createEmptyPlan({ planId: 'plan-auth-2', channel: 'whatsapp', externalUserId: 'user-rsvp' }),
        {
          contact_phone: '51973296571',
          contact_phone_extension: '+51',
          contact_phone_number: '973296571',
          current_node: 'responder_invitacion',
          rsvp_state: {
            status: 'awaiting_event_selection',
            pending_action: 'attending',
            candidates: [
              { guest_id: 41, event_name: 'Matrimonio de Ana y Luis', event_date: '2026-09-12' },
              { guest_id: 42, event_name: 'Cumpleanos de Marta', event_date: '2026-09-19' },
            ],
            requested_at: '2026-08-13T15:00:00.000Z',
            selection_attempts: 0,
          },
        },
      ),
    });
    const service = createService(runtime, gateway, store, [
      rsvpLookupInvitation({ guestId: 41, eventId: 205, eventName: 'Matrimonio de Ana y Luis' }),
      rsvpLookupInvitation({ guestId: 42, eventId: 206, eventName: 'Cumpleanos de Marta' }),
    ]);

    const result = await service.handleTurn(inbound('Cumpleanos de Marta'));

    expect(gateway.inputs).toHaveLength(1);
    expect(gateway.inputs[0]).toMatchObject({ action: 'attending', guest_id: 42 });
    expect(result.trace.tools_called).toContain('guest_rsvp');
    expect(result.plan.rsvp_state.status).toBe('none');
  });

  it('current-turn explicit action executes in awaiting_action status', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: 'attending', decisionSource: 'current_message' })]);
    const gateway = new RsvpGateway([
      { status: 'responded', action: 'attending', willAttend: true, guestId: 41, eventName: 'Matrimonio de Ana y Luis', eventDate: '2026-09-12' },
    ]);
    const store = new InMemoryPlanStore();
    await store.save({
      reason: 'seed-explicit-awaiting-action',
      plan: mergePlan(
        createEmptyPlan({ planId: 'plan-auth-3', channel: 'whatsapp', externalUserId: 'user-rsvp' }),
        {
          contact_phone: '51973296571',
          contact_phone_extension: '+51',
          contact_phone_number: '973296571',
          current_node: 'responder_invitacion',
          rsvp_state: {
            status: 'awaiting_action',
            pending_action: 'attending',
            candidates: [{ guest_id: 41, event_name: 'Matrimonio de Ana y Luis', event_date: '2026-09-12' }],
            requested_at: '2026-08-17T15:00:00.000Z',
            selection_attempts: 0,
          },
        },
      ),
    });
    const service = createService(runtime, gateway, store, [
      rsvpLookupInvitation({ guestId: 41, eventName: 'Matrimonio de Ana y Luis', hasResponded: true, willAttend: false }),
    ]);

    const result = await service.handleTurn(inbound('Si, quiero asistir'));

    expect(gateway.inputs).toHaveLength(1);
    expect(gateway.inputs[0]).toMatchObject({ action: 'attending', guest_id: 41 });
    expect(result.plan.rsvp_state.status).toBe('none');
  });

  it('current-turn explicit action executes in awaiting_event_selection status', async () => {
    const runtime = new RsvpRuntime([rsvpExtraction({ action: 'declining', decisionSource: 'current_message', candidateGuestId: 41 })]);
    const gateway = new RsvpGateway([
      { status: 'responded', action: 'declining', willAttend: false, guestId: 41, eventName: 'Matrimonio de Ana y Luis', eventDate: '2026-09-12' },
    ]);
    const store = new InMemoryPlanStore();
    await store.save({
      reason: 'seed-explicit-selection',
      plan: mergePlan(
        createEmptyPlan({ planId: 'plan-auth-4', channel: 'whatsapp', externalUserId: 'user-rsvp' }),
        {
          contact_phone: '51973296571',
          contact_phone_extension: '+51',
          contact_phone_number: '973296571',
          current_node: 'responder_invitacion',
          rsvp_state: {
            status: 'awaiting_event_selection',
            pending_action: null,
            candidates: [
              { guest_id: 41, event_name: 'Matrimonio de Ana y Luis', event_date: '2026-09-12' },
              { guest_id: 42, event_name: 'Cumpleanos de Marta', event_date: '2026-09-19' },
            ],
            requested_at: '2026-08-13T15:00:00.000Z',
            selection_attempts: 0,
          },
        },
      ),
    });
    const service = createService(runtime, gateway, store, [
      rsvpLookupInvitation({ guestId: 41, eventId: 205, eventName: 'Matrimonio de Ana y Luis' }),
      rsvpLookupInvitation({ guestId: 42, eventId: 206, eventName: 'Cumpleanos de Marta' }),
    ]);

    const result = await service.handleTurn(inbound('No asistire al Matrimonio de Ana y Luis'));

    expect(gateway.inputs).toHaveLength(1);
    expect(gateway.inputs[0]).toMatchObject({ action: 'declining', guest_id: 41 });
    expect(result.plan.rsvp_state.status).toBe('none');
  });

  // PASS 2: merged the plan_state-sourced action scenario into the
  // awaiting_action without current-turn decision test above (same seed,
  // same declining report, same no-mutation assertions).

  // PASS 2: removed the bare-Si continuation block (identical stubbed
  // extraction, seed, and assertions as the current-turn explicit action
  // test above; the raw text differs but extraction is stubbed so the text
  // cannot change behavior); keeper is the current-turn explicit action in
  // awaiting_action test in this file.
});

class RsvpRuntime extends QueuedAgentRuntime {
  constructor(extractions: ExtractionResult[]) {
    super(extractions, echoErrorMessage('respuesta'));
  }
}

class RsvpGateway implements AgentConversationGateway {
  readonly inputs: AgentGuestRsvpInput[] = [];
  guestEventLookupCalls = 0;
  constructor(
    private readonly results: AgentGuestRsvpResult[],
    private readonly messages: AgentConversationMessage[] = [],
    private readonly guestEvents: AgentGuestEventsResult = { status: 'not_found' },
    private readonly eventDetail: AgentEventDetailResult = { status: 'not_found' },
  ) {}
  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: AgentConversationMessage[] }> { return { status: 'success', messages: this.messages }; }
  async requestHumanTakeover(): Promise<AgentGatewayResult> { return { status: 'success', message: 'Requested.' }; }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> { this.guestEventLookupCalls += 1; return this.guestEvents; }
  async getEventDetail(): Promise<AgentEventDetailResult> { return this.eventDetail; }
  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    this.inputs.push(input);
    const r = this.results.shift();
    if (!r) throw new Error('No RSVP result queued');
    return r;
  }
}

function rsvpExtraction(args: { action: 'attending' | 'declining' | null; decisionSource?: 'current_message' | 'plan_state' | null; candidateGuestId?: number | null; eventReference?: string | null }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action,
    rsvpDecisionSource: args.decisionSource ?? (args.action ? 'current_message' : 'plan_state'),
    rsvpCandidateGuestId: args.candidateGuestId ?? null,
    rsvpEventReference: args.eventReference ?? null,
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
    conversationSummary: 'RSVP',
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
        if (invitations === null) return null;
        return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
}

function rsvpLookupInvitation(args: { guestId?: number; eventId?: number; eventName?: string; hasResponded?: boolean; willAttend?: boolean | null }): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest',
    guestId: args.guestId ?? 41,
    eventId: args.eventId ?? 205,
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
    guestStatus: { hasResponded: args.hasResponded ?? false, willAttend: args.willAttend ?? null, hasCouple: null, responseDate: null },
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
  return { channel: 'whatsapp', externalUserId: 'user-rsvp', text, messageId: `msg-${text}`, receivedAt: '2026-08-13T15:00:00.000Z', contactPhone: '+51973296571' };
}
