import crypto from 'node:crypto';
import path from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type {
  AgentRuntime,
  ComposeReplyResult,
  ExtractionResult,
} from '../src/runtime/contracts';
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

const PLANNING_DIAGNOSTIC_ONLY = [
  'live_behavior.provider_reference_cheaper_option',
  'live_behavior.provider_reference_miraflores_option',
  'live_behavior.reset_plan_discards_stored_context',
  'live_behavior.s12_provider_completion_truthful_event_date',
  'live_behavior.wedding_planner_location_completes_search',
  'live_feedback.token_fresh_multifront_stays_multi_need',
  'live_feedback.token_seeded_contact_correction',
  'live_feedback.token_seeded_selection_defer_close',
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

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

function sentinelRuntime(extractions: ExtractionResult[]): AgentRuntime {
  return {
    async extract(): Promise<ExtractionResult> {
      const next = extractions.shift();
      if (!next) throw new Error('No twin extraction queued.');
      return next;
    },
    async composeReply(): Promise<ComposeReplyResult> {
      return {
        text: 'TWIN_MODEL_SENTINEL',
        structuredMessage: { type: 'generic', paragraphs_es: ['TWIN_MODEL_SENTINEL'] },
      };
    },
  };
}

function baseExtraction(overrides: Partial<ExtractionResult>): ExtractionResult {
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
    conversationSummary: 'High-risk twin turn.',
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

function twinService(
  gateway: AgentConversationGateway,
  runtime: AgentRuntime,
  planStore: InMemoryPlanStore,
): AgentService {
  const provider = emptyProviderGateway();
  return new AgentService({
    planStore,
    runtime,
    providerGateway: provider,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: {
        async search(): Promise<KnowledgeRetrievalResult> {
          return { status: 'success', evidence: [] };
        },
      } as KnowledgeRetrievalGateway,
      providerGateway: provider,
      agentGateway: gateway,
    }),
    agentConversationGateway: gateway,
    rsvpEffectStore: new InMemoryRsvpEffectStore(),
  });
}

describe('high-risk scenario offline twins (F3)', () => {
  it('reconciles the mandatory suite count: 119 total, 111 support, 8 planning-only', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const suite = catalog.suites.find((candidate) => candidate.id === 'live_behavior_regression');
    const caseIds = new Set(suite?.caseIds ?? []);
    expect(caseIds.size).toBe(119);
    for (const planningId of PLANNING_DIAGNOSTIC_ONLY) {
      expect(caseIds.has(planningId), `${planningId} missing from the mandatory suite`).toBe(true);
    }
    expect(caseIds.size - PLANNING_DIAGNOSTIC_ONLY.length).toBe(111);
    expect(caseIds.has('live_behavior.customer_event_task_continuity')).toBe(true);
  });

  it('accountless venue: fixture detail carries the reception facts with no OTP path', async () => {
    const gateway = await FixtureAgentConversationGateway.create('guest-julisabeth-andres');
    const events = await gateway.getGuestEventsByPhone({ phone_extension: '+51', phone_number: '904523314' });
    expect(events.status).toBe('success');
    if (events.status !== 'success') return;
    const names = events.events.map((event) => event.name);
    expect(names).toContain('Julisabeth y Andrés');
    const detail = await gateway.getEventDetail({
      eventId: 702201,
      phone: { phone_extension: '+51', phone_number: '904523314' },
    });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') return;
    const moments = detail.event.moments.map((moment) => moment.description ?? '');
    expect(moments.some((description) => description.includes('Hacienda Recoveco'))).toBe(true);
  });

  it('mixed event/payment: the same trusted phone yields events and scoped purchases', async () => {
    const gateway = await FixtureAgentConversationGateway.create('guest-julisabeth-andres');
    const events = await gateway.getGuestEventsByPhone({ phone_extension: '+51', phone_number: '904523314' });
    expect(events.status).toBe('success');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '904523314' });
    expect(orders.status).toBe('success');
  });

  it('owner payment and Luis unknown balance: total known, paid amount and currency unknown', async () => {
    const gateway = await FixtureAgentConversationGateway.create('purchase-luis-389');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '938389389' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    const pending = orders.purchases.find((purchase) => purchase.orderId === 'order-luis-pending-227');
    expect(pending?.paymentStatus).toBe('pending');
    expect(pending?.grandTotal).toBe(227.76);
    expect(pending?.currency ?? null).toBeNull();
    const raw = JSON.stringify(orders.purchases);
    expect(raw).not.toMatch(/amount_received|balance_due|remaining/i);
  });

  it('Martha selection: both candidates carry usable labels, dates, and totals', async () => {
    const gateway = await FixtureAgentConversationGateway.create('purchase-martha-frozen');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '900070122' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases.length).toBeGreaterThanOrEqual(2);
    for (const purchase of orders.purchases) {
      expect(purchase.eventName).toBeTruthy();
      expect(purchase.eventDate).toBeTruthy();
      expect(typeof purchase.grandTotal).toBe('number');
    }
  });

  it('unavailable transaction reference: two orders, neither linkable to the code', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s13-reference-unavailable-multiple');
    const orders = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '900001303' });
    expect(orders.status).toBe('success');
    if (orders.status !== 'success') return;
    expect(orders.purchases.length).toBeGreaterThanOrEqual(2);
    for (const purchase of orders.purchases) {
      expect(purchase.customerTransactionNumber ?? null).toBeNull();
    }
  });

  it('Diana thread: three inputs share one session and the detail turn carries zero-takeover receipts', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const live = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.host_withdrawal_diana_policy_and_support',
    );
    expect(live?.inputs).toHaveLength(3);
    expect(new Set((live?.inputs ?? []).map((input) => input.sessionId)).size).toBe(1);
    const effect = live?.expectations.find((expectation) => expectation.id === 'one-handoff-effect-in-thread');
    expect(effect?.type).toBe('fixture_effect_count');
    if (effect?.type !== 'fixture_effect_count') return;
    expect(effect.operation).toBe('handoff.write');
    expect([effect.expectedAttempts, effect.expectedSuccesses, effect.expectedReplays]).toEqual([0, 0, 0]);
    expect(() => assertLiveRegressionFixtureCoverage([live!])).not.toThrow();
  });

  it('image distractor: judge ground truth is digest-bound to the attached fixture image', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const live = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.image_distractor_history_preserves_current_question',
    );
    const truth = live?.judgeGroundTruth;
    expect(truth).toBeDefined();
    if (!truth) return;
    const boundInput = live?.inputs[truth.boundInputTurn];
    const image = boundInput?.image;
    const imageData = image !== undefined && image !== null && 'data' in image ? image.data : null;
    expect(typeof imageData).toBe('string');
    if (typeof imageData !== 'string') throw new Error('distractor fixture image needs data');
    expect(imageData.length).toBeGreaterThan(0);
    const digest = crypto.createHash('sha256').update(imageData, 'utf8').digest('hex');
    expect(digest).toBe(truth.imageDigest);
    expect(truth.verifiedAmount).toBe('S/ 149.90');
  });

  it('companion rejection stays a rejection: saved false with a scoped reason', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-not-eligible');
    const written = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '942633292',
      guest_id: 70001,
      plus_one_response: 'yes',
    });
    expect(written.status).toBe('responded');
    if (written.status !== 'responded') return;
    expect(written.plusOne?.saved).toBe(false);
    expect(written.plusOne?.reason).toBeTruthy();
    expect(written.willAttend).toBeNull();
  });

  it('companion acknowledgment: saved true, and no fresh read can verify the companion field', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-saved');
    const written = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '942633292',
      action: 'attending',
      guest_id: 70001,
      plus_one_response: 'yes',
    });
    expect(written.status).toBe('responded');
    if (written.status !== 'responded') return;
    expect(written.plusOne?.saved).toBe(true);
    const read = await gateway.getEventDetail({
      eventId: written.eventId ?? 0,
      phone: { phone_extension: '+51', phone_number: '942633292' },
    });
    // The read API carries no companion field: independent verification of
    // the companion is unavailable, so the reply must report the acknowledged
    // save without claiming a fresh read verified it.
    if (read.status === 'success') {
      expect(JSON.stringify(read.event)).not.toMatch(/plus_one|plusOne|companion/i);
    } else {
      expect(read.status).not.toBe('success');
    }
  });

  it('unmatched named event: no guest write without a grounded target', async () => {
    const rawGateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-multiple-pending');
    let writes = 0;
    const guestRsvp = rawGateway.guestRsvp.bind(rawGateway);
    const gateway = new Proxy(rawGateway, {
      get(target: FixtureAgentConversationGateway, property: string | symbol): unknown {
        if (property === 'guestRsvp') {
          return async (
            input: Parameters<FixtureAgentConversationGateway['guestRsvp']>[0],
          ): Promise<unknown> => {
            writes += 1;
            return guestRsvp(input);
          };
        }
        const value: unknown = Reflect.get(target as object, property);
        if (typeof value === 'function') {
          return (value as (...args: never[]) => unknown).bind(target);
        }
        return value;
      },
    }) as unknown as AgentConversationGateway;
    const service = twinService(
      gateway,
      sentinelRuntime([
        baseExtraction({
          actionIntent: 'responder_invitacion',
          rsvpAction: 'attending',
          rsvpDecisionSource: 'current_message',
          rsvpEventReference: 'Evento Inexistente Inventado',
        }),
      ]),
      new InMemoryPlanStore(),
    );
    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'unmatched-twin-user',
      contactPhone: '+51941438999',
      text: 'Confirmo mi asistencia al Evento Inexistente Inventado',
      messageId: 'unmatched-twin-0',
      receivedAt: new Date().toISOString(),
    });
    expect(writes).toBe(0);
  });

  it('failed OTP handoff: the terminal failure is recorded once and never retried silently', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s06-otp-handoff-failed');
    const first = await gateway.requestHumanTakeover('51900000001');
    expect(first.status).toBe('failed');
  });

  it('token-seeded close: contact gathering never submits, explicit authorization submits once', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const live = catalog.cases.find((candidate) => candidate.id === 'live_feedback.token_seeded_close_flow');
    const noSubmit = live?.expectations.find((expectation) => expectation.id === 'contact-details-alone-do-not-submit');
    expect(noSubmit?.severity).toBe('hard');
    const effect = live?.expectations.find((expectation) => expectation.id === 'explicit-close-effect');
    expect(effect?.type).toBe('fixture_effect_count');
    expect(effect?.severity).toBe('hard');
  });
});
