import path from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';
import YAML from 'yaml';
import fs from 'node:fs/promises';

import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentConversationGateway,
  AgentGuestRsvpInput,
} from '../src/runtime/agent-conversation-gateway';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import type { ExtractedInformationRequest } from '../src/core/information';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type {
  KnowledgeRetrievalGateway,
  KnowledgeRetrievalResult,
} from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import { InMemoryRsvpEffectStore } from '../src/runtime/rsvp-effect-executor';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { EvalLoader } from '../src/evals/loader';
import { assertLiveRegressionFixtureCoverage } from '../src/evals/runner';

const SCENARIO = 'rsvp-plus-one-multiple-pending';
const PHONE = '+51941438999';
const USER = 'continuity-twin-user';
const ANA_GUEST = 80001;
const ANA_EVENT = 8001;
const MARTA_GUEST = 80002;
const MARTA_EVENT = 8002;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function infoRequest(query: string, eventHint: string | null): ExtractedInformationRequest {
  return {
    kind: 'associated_event',
    query,
    eventHint,
    authAction: 'none',
  };
}

function twinExtraction(overrides: Partial<ExtractionResult>): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
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
    conversationSummary: 'Continuity twin turn.',
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
    ...overrides,
  };
}

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

class FakeKnowledgeGateway implements KnowledgeRetrievalGateway {
  async search(): Promise<KnowledgeRetrievalResult> {
    return { status: 'success', evidence: [] };
  }
}

function emptyProviderGateway(): ProviderGateway {
  const empty: UserEventLookupResult = {
    lookup: { email: null, phone: '900000000' },
    user: null,
    events: [],
    counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
  };
  return {
    async lookupAuthenticatedUserEvents(): Promise<UserEventLookupResult> {
      return empty;
    },
    async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
      return empty;
    },
  } as unknown as ProviderGateway;
}

type CapturedCalls = {
  writes: AgentGuestRsvpInput[];
  readEventIds: number[];
};

function captureGateway(
  gateway: FixtureAgentConversationGateway,
  captured: CapturedCalls,
): AgentConversationGateway {
  const guestRsvp = gateway.guestRsvp.bind(gateway);
  const getEventDetail = gateway.getEventDetail.bind(gateway);
  return new Proxy(gateway, {
    get(target: FixtureAgentConversationGateway, property: string | symbol): unknown {
      if (property === 'guestRsvp') {
        return async (input: AgentGuestRsvpInput): Promise<unknown> => {
          captured.writes.push(input);
          return guestRsvp(input);
        };
      }
      if (property === 'getEventDetail') {
        return async (
          input: Parameters<FixtureAgentConversationGateway['getEventDetail']>[0],
        ): Promise<unknown> => {
          if (typeof input.eventId === 'number') captured.readEventIds.push(input.eventId);
          return getEventDetail(input);
        };
      }
      const value: unknown = Reflect.get(target as object, property);
      if (typeof value === 'function') {
        return (value as (...args: never[]) => unknown).bind(target);
      }
      return value;
    },
  }) as unknown as AgentConversationGateway;
}

describe('customer event task continuity offline twin (E3)', () => {
  it('binds exact guest/event IDs at the fixture gateway with no cross-event leakage', async () => {
    const gateway = await FixtureAgentConversationGateway.create(SCENARIO);
    const martaWrite = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '941438999',
      action: 'attending',
      guest_id: MARTA_GUEST,
    });
    expect(martaWrite.status).toBe('responded');
    if (martaWrite.status !== 'responded') return;
    expect(martaWrite.guestId).toBe(MARTA_GUEST);
    expect(martaWrite.eventId).toBe(MARTA_EVENT);

    const martaRead = await gateway.getEventDetail({
      eventId: MARTA_EVENT,
      phone: { phone_extension: '+51', phone_number: '941438999' },
    });
    expect(martaRead.status).toBe('success');
    if (martaRead.status !== 'success') return;
    expect(martaRead.event.attendance?.guestId).toBe(MARTA_GUEST);
    expect(martaRead.event.attendance?.willAttend).toBe(true);

    const anaWrite = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '941438999',
      action: 'attending',
      guest_id: ANA_GUEST,
    });
    expect(anaWrite.status).toBe('responded');
    if (anaWrite.status !== 'responded') return;
    expect(anaWrite.guestId).toBe(ANA_GUEST);
    expect(anaWrite.eventId).toBe(ANA_EVENT);

    const anaRead = await gateway.getEventDetail({
      eventId: ANA_EVENT,
      phone: { phone_extension: '+51', phone_number: '941438999' },
    });
    expect(anaRead.status).toBe('success');
    if (anaRead.status !== 'success') return;
    expect(anaRead.event.attendance?.guestId).toBe(ANA_GUEST);
    expect(anaRead.event.attendance?.willAttend).toBe(true);
  });

  it('runs four turns with exactly one Marta write and zero writes elsewhere', async () => {
    const runtime = new TwinRuntime([
      twinExtraction({ informationRequests: [infoRequest('¿Cuándo es la Boda Ana y Luis?', 'Boda Ana y Luis')] }),
      twinExtraction({
        actionIntent: 'responder_invitacion',
        informationRequests: [infoRequest('¿A qué hora es el Cumpleaños Marta?', 'Cumpleaños Marta')],
        rsvpAction: 'attending',
        rsvpDecisionSource: 'current_message',
        rsvpCandidateGuestId: null,
        rsvpEventReference: 'Cumpleaños Marta',
        rsvpParty: null,
      }),
      twinExtraction({ informationRequests: [infoRequest('¿A qué hora era la Boda Ana y Luis?', 'Boda Ana y Luis')] }),
      twinExtraction({}),
    ]);
    const rawGateway = await FixtureAgentConversationGateway.create(SCENARIO);
    const captured: CapturedCalls = { writes: [], readEventIds: [] };
    const gateway = captureGateway(rawGateway, captured);
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: emptyProviderGateway(),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: new FakeKnowledgeGateway(),
        providerGateway: emptyProviderGateway(),
        agentGateway: gateway,
      }),
      agentConversationGateway: gateway,
      rsvpEffectStore: new InMemoryRsvpEffectStore(),
    });

    const texts = [
      '¿Cuándo es la Boda Ana y Luis?',
      'Confirmo mi asistencia al Cumpleaños Marta. ¿A qué hora es?',
      '¿Y a qué hora era la Boda Ana y Luis?',
      'Gracias.',
    ];
    const writesPerTurn: number[] = [];
    const readsPerTurn: number[] = [];
    for (const [index, text] of texts.entries()) {
      const writesBefore = captured.writes.length;
      const readsBefore = captured.readEventIds.length;
      await service.handleTurn({
        channel: 'whatsapp',
        externalUserId: USER,
        contactPhone: PHONE,
        text,
        messageId: `continuity-twin-${index}`,
        receivedAt: new Date().toISOString(),
      });
      writesPerTurn.push(captured.writes.length - writesBefore);
      readsPerTurn.push(captured.readEventIds.length - readsBefore);
    }

    expect(writesPerTurn).toEqual([0, 1, 0, 0]);
    expect(captured.writes).toHaveLength(1);
    expect(captured.writes[0]?.guest_id).toBe(MARTA_GUEST);
    expect(captured.writes[0]?.action).toBe('attending');
    expect(captured.readEventIds).toContain(MARTA_EVENT);
    expect(runtime.composeRequests).toHaveLength(4);

    // Per-turn composed reply payload facts: each turn composes exactly one
    // reply from the captured evidence, so the IDs, datetimes, and verified
    // outcome below are the facts the model actually saw on that turn.
    const readSlices: number[][] = [];
    let readCursor = 0;
    for (const count of readsPerTurn) {
      readSlices.push(captured.readEventIds.slice(readCursor, readCursor + count));
      readCursor += count;
    }

    // Turn 0 (Ana 2026-09-20 18:00): the actionable identified turn loads
    // every authorized invitation/detail before extraction, even though the
    // requested task result remains scoped to Ana.
    expect([...readSlices[0]].sort((left, right) => left - right)).toEqual([
      ANA_EVENT,
      MARTA_EVENT,
    ]);
    const turn0 = runtime.composeRequests[0];
    const turn0Info = turn0?.informationResults?.find(
      (result) => result.kind === 'associated_event' && result.status === 'completed',
    );
    if (turn0Info?.kind !== 'associated_event' || turn0Info?.status !== 'completed') {
      throw new Error('Turn 0 is missing its completed associated_event facts.');
    }
    expect(turn0Info.result.events).toHaveLength(2);
    expect(turn0Info.result.events.find((event) => event.eventId === ANA_EVENT)).toMatchObject({
      guestId: ANA_GUEST,
      eventId: ANA_EVENT,
      name: 'Boda Ana y Luis',
      datetime: '2026-09-20T18:00:00.000Z',
    });
    const turn0Invitations = turn0?.customerContext?.invitations ?? [];
    expect(turn0Invitations.map((invitation) => invitation.eventId).sort()).toEqual([
      ANA_EVENT,
      MARTA_EVENT,
    ]);
    expect(turn0Invitations.find((invitation) => invitation.eventId === ANA_EVENT)).toMatchObject({
      eventId: ANA_EVENT,
      name: 'Boda Ana y Luis',
      datetime: '2026-09-20T18:00:00.000Z',
    });
    expect(turn0?.rsvpPhoneEvidence).toBeUndefined();
    expect(turn0?.rsvpWorkCompleted).toBeUndefined();

    // Turn 1 (Marta): the full profile reads both events before extraction;
    // one additional same-ID detail read verifies the requested mutation.
    expect(readSlices[1]?.filter((eventId) => eventId === ANA_EVENT)).toHaveLength(1);
    expect(readSlices[1]?.filter((eventId) => eventId === MARTA_EVENT)).toHaveLength(3);
    const turn1 = runtime.composeRequests[1];
    expect(turn1?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: {
        event_name: 'Cumpleaños Marta',
        event_date: '2026-09-21T19:00:00.000Z',
        rsvp_state: 'attending',
      },
    });
    expect(turn1?.rsvpWorkCompleted).toBe(true);
    const turn1Note = turn1?.errorMessage ?? '';
    expect(turn1Note).toContain('"verification_status":"verified"');
    expect(turn1Note).toContain('"requested":{"guest_id":80002,"event_id":8002');
    expect(turn1Note).toContain('"observed":{"guest_id":80002,"event_id":8002');
    expect(turn1Note).toContain('"requested_attendance_change_verified":true');
    expect(turn1Note).toContain('"write_count":1');
    expect(turn1Note).toContain('"fresh_read":true');
    const turn1Info = turn1?.informationResults?.find(
      (result) => result.kind === 'associated_event' && result.status === 'completed',
    );
    if (turn1Info?.kind !== 'associated_event' || turn1Info?.status !== 'completed') {
      throw new Error('Turn 1 is missing its completed associated_event facts.');
    }
    expect(turn1Info.result.events).toHaveLength(2);
    expect(turn1Info.result.events.find((event) => event.eventId === MARTA_EVENT)).toMatchObject({
      guestId: MARTA_GUEST,
      eventId: MARTA_EVENT,
      name: 'Cumpleaños Marta',
      datetime: '2026-09-21T19:00:00.000Z',
    });
    expect(turn1Info.result.events.find((event) => event.eventId === MARTA_EVENT)?.guestStatus?.willAttend).not.toBe(true);
    const turn1Invitations = turn1?.customerContext?.invitations ?? [];
    expect(turn1Invitations.map((invitation) => invitation.eventId).sort()).toEqual([
      ANA_EVENT,
      MARTA_EVENT,
    ]);
    expect(turn1Invitations.find((invitation) => invitation.eventId === MARTA_EVENT)).toMatchObject({
      eventId: MARTA_EVENT,
      name: 'Cumpleaños Marta',
      datetime: '2026-09-21T19:00:00.000Z',
      guestStatus: { hasResponded: false, willAttend: null },
    });
    expect(turn1?.customerContext?.actionOutcomes).toContainEqual(expect.objectContaining({
      operation: 'rsvp.response.write',
      target: `guest:${MARTA_GUEST}:event:${MARTA_EVENT}`,
      receipt: 'confirmed',
    }));

    // Turn 2 (Ana 18:00 again): a new profile snapshot still carries Marta's
    // authorized record as well as Ana's, while the task result is scoped to
    // the referenced Ana event.
    expect([...readSlices[2]].sort((left, right) => left - right)).toEqual([
      ANA_EVENT,
      MARTA_EVENT,
    ]);
    const turn2 = runtime.composeRequests[2];
    const turn2Info = turn2?.informationResults?.find(
      (result) => result.kind === 'associated_event' && result.status === 'completed',
    );
    if (turn2Info?.kind !== 'associated_event' || turn2Info?.status !== 'completed') {
      throw new Error('Turn 2 is missing its completed associated_event facts.');
    }
    expect(turn2Info.result.events).toHaveLength(2);
    expect(turn2Info.result.events.find((event) => event.eventId === ANA_EVENT)).toMatchObject({
      guestId: ANA_GUEST,
      eventId: ANA_EVENT,
      name: 'Boda Ana y Luis',
      datetime: '2026-09-20T18:00:00.000Z',
    });
    const turn2Invitations = turn2?.customerContext?.invitations ?? [];
    expect(turn2Invitations.map((invitation) => invitation.eventId).sort()).toEqual([
      ANA_EVENT,
      MARTA_EVENT,
    ]);
    expect(turn2Invitations.find((invitation) => invitation.eventId === ANA_EVENT)).toMatchObject({
      eventId: ANA_EVENT,
      name: 'Boda Ana y Luis',
      datetime: '2026-09-20T18:00:00.000Z',
    });
    const turn2Facts = JSON.stringify({
      informationResults: turn2?.informationResults,
      customerContext: turn2?.customerContext,
    });
    expect(turn2Facts).toContain('8002');
    expect(turn2Facts).toContain('Marta');
    expect(turn2Facts).toContain('2026-09-21');
    expect(turn2?.rsvpPhoneEvidence).toBeUndefined();
    expect(turn2?.errorMessage ?? '').not.toContain('"verification_status":"verified"');

    // Turn 3 is actionable in this test runtime, so it receives a fresh full
    // profile even though the extractor proposes no new customer task.
    expect([...readSlices[3]].sort((left, right) => left - right)).toEqual([
      ANA_EVENT,
      MARTA_EVENT,
    ]);
    const turn3 = runtime.composeRequests[3];
    expect(turn3?.informationResults).toEqual([]);
    expect(turn3?.customerContext?.invitations).toHaveLength(2);
    expect(turn3?.rsvpPhoneEvidence).toBeUndefined();
    expect(turn3?.rsvpWorkCompleted).toBeUndefined();
    expect(turn3?.errorMessage).toBeNull();
  });

  it('registers the live continuity case with per-turn hard effects and hard judges', async () => {    const evalDirectory = path.resolve(process.cwd(), 'evals');
    const catalog = await new EvalLoader(evalDirectory).loadCatalog();
    const live = catalog.cases.find((candidate) => candidate.id === 'live_behavior.customer_event_task_continuity');
    expect(live).toBeDefined();
    expect(live?.backendFixture?.scenario).toBe(SCENARIO);
    expect(live?.inputs).toHaveLength(4);
    const sessionIds = new Set((live?.inputs ?? []).map((input) => input.sessionId));
    expect(sessionIds.size).toBe(1);
    for (const input of live?.inputs ?? []) {
      expect(input.contactPhone).toBe(PHONE);
      expect(input.backendFixture?.scenario).toBe(SCENARIO);
    }
    for (const turnIndex of [0, 1, 2, 3]) {
      expect(
        live?.expectations.some(
          (expectation) => expectation.type === 'fixture_effect_count' &&
            expectation.severity === 'hard' &&
            (expectation.turnIndex ?? -1) === turnIndex,
        ),
        `turn ${turnIndex} needs a hard per-turn effect assertion`,
      ).toBe(true);      expect(
        live?.expectations.some(
          (expectation) => expectation.type === 'text_semantic' &&
            expectation.severity === 'hard' &&
            expectation.requireJudge === true &&
            (expectation.turnIndex ?? -1) === turnIndex,
        ),
        `turn ${turnIndex} needs a hard required semantic judge`,
      ).toBe(true);
    }
    const suite = catalog.suites.find((candidate) => candidate.id === 'live_behavior_regression');
    expect(suite?.caseIds).toContain('live_behavior.customer_event_task_continuity');
    expect(() => assertLiveRegressionFixtureCoverage([live!])).not.toThrow();

    // Cumulative-from-case-baseline ledger (Lane B 2026-09-17): each turn
    // carries every conversational receipt since the case baseline, so the
    // single turn-1 Marta write stays visible at turns 2 and 3.
    const cumulative: Array<[number, number, number, number]> = [
      [0, 0, 0, 0],
      [1, 1, 1, 0],
      [2, 1, 1, 0],
      [3, 1, 1, 0],
    ];
    for (const [turnIndex, attempts, successes, replays] of cumulative) {
      const effect = live?.expectations.find(
        (expectation) => expectation.type === 'fixture_effect_count' &&
          (expectation.turnIndex ?? -1) === turnIndex,
      );
      expect(effect?.type, `turn ${turnIndex} needs its cumulative effect pin`).toBe(
        'fixture_effect_count',
      );
      if (effect?.type !== 'fixture_effect_count') continue;
      expect([effect.expectedAttempts, effect.expectedSuccesses, effect.expectedReplays]).toEqual(
        [attempts, successes, replays],
      );
    }

    const registry = YAML.parse(
      await fs.readFile(path.join(evalDirectory, 'live-behavior-coverage.yaml'), 'utf8'),
    ) as { behaviorChanges: Array<{ id: string; liveCaseIds: string[] }> };
    const entry = registry.behaviorChanges.find((change) => change.liveCaseIds.includes(
      'live_behavior.customer_event_task_continuity',
    ));
    expect(entry).toBeDefined();
  });
});
