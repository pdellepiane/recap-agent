import fs from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from '../src/runtime/agent-service';
import type { HandleTurnResponse } from '../src/runtime/agent-service';
import type { ExtractionResult } from '../src/runtime/contracts';
import type { InformationTaskResult } from '../src/core/information';
import {
  FixtureAgentConversationGateway,
  type FixtureData,
} from '../src/runtime/eval-fixture-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import {
  ScriptedSupportLaneRouter as EvalScriptedSupportLaneRouter,
  type ScriptedRouterAnswer,
} from '../src/evals/scripted-support-lane-router';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  KnowledgeRetrievalGateway,
  KnowledgeRetrievalResult,
} from '../src/runtime/knowledge-retrieval-gateway';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import type { SupportReplySidecar } from '../src/runtime/support-lane-flow';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { evalCaseSchema } from '../src/evals/case-schema';
import { runOfflineCase } from '../src/evals/targets/offline';
import { ScriptedAgentRuntime } from './agent-runtime-test-utils';

/**
 * WP3/WP5 — the deterministic offline twins of the 2026-10-19 WhatsApp
 * behaviour dossier (cases A, B, C, D and the multi-purchase ambiguity
 * twin).
 *
 * The twins replay the stored turn sequences against the committed backend
 * fixtures with the router scripted, so every assertion is about effects,
 * nodes, counts, plan state and receipts — never about reply wording.
 *
 * The spec is analysis/2026-10-19-whatsapp-behavior-cases/implementation/
 * 03-acceptance-tests.md, section "Offline twins".
 */

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = {
  terminal_whatsapp: new WhatsAppMessageRenderer(),
};

/** The dossier scenarios, with the synthetic phone of each thread. */
const SCENARIO_A = 'purchase-yape-receipt-no-match';
const PHONE_A = '+51900000401';
const SCENARIO_B = 'purchase-cod-reference-unavailable';
const PHONE_B = '+51900000402';
const SCENARIO_C = 'purchase-approved-host-receipt-refund';
const PHONE_C = '+51900000403';
const SCENARIO_D = 'purchase-declined-card-transfer-pending';
const PHONE_D = '+51900000404';
const SCENARIO_E = 'purchase-ambiguous-two-orders';
const PHONE_E = '+51900000405';

/** One scripted router answer: the answers the router gives on a turn. */
type ScriptedAnswer = ScriptedRouterAnswer;

/**
 * The scripted router port.
 *
 * The router is the only model in the funnel, so scripting its answers makes
 * the whole turn deterministic: the policy outcome follows from the typed
 * answers plus the plan state, never from the customer message.
 */
const ScriptedSupportLaneRouter = EvalScriptedSupportLaneRouter;
type ScriptedSupportLaneRouter = EvalScriptedSupportLaneRouter;


/** One replayed turn: the guest message and whether it carries an image. */
type TwinTurn = {
  readonly text: string;
  readonly image?: boolean;
};

type TwinTurnResult = {
  readonly response: HandleTurnResponse;
  readonly composedTurns: number;
};

/** The sidecar the scripted model reports on the turn being replayed. */
function neutralSidecar(): SupportReplySidecar {
  return { citedOrderIds: [], reportedPayment: null, claimedHandoff: false };
}

function knowledgeGateway(): KnowledgeRetrievalGateway {
  return {
    search: async (): Promise<KnowledgeRetrievalResult> => ({
      status: 'success',
      evidence: [],
    }),
  };
}

function providerGateway(): ProviderGateway {
  return {
    requestUserLoginCode: async () => ({ status: 'sent' as const }),
    verifyUserLoginCode: async () => ({
      status: 'authenticated' as const,
      token: 'shared-jwt',
      tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    lookupAuthenticatedUserEvents: async (): Promise<UserEventLookupResult> => ({
      lookup: { email: 'customer@example.com', phone: null },
      user: { id: 1, fullName: 'Customer', email: 'customer@example.com', fullPhone: null },
      events: [],
      counts: {
        ownerEvents: 0,
        guestEvents: 0,
        hostEvents: 0,
        celebratedEvents: 0,
        recentOrders: 0,
      },
    }),
  } as unknown as ProviderGateway;
}

/**
 * The fixture gateway of a dossier scenario. The handoff outcome can be
 * overridden in memory (the committed fixtures stay untouched) so the
 * failing-handoff twin can assert the absence of a success claim.
 */
async function createGateway(
  scenario: string,
  overrides: { readonly handoffStatus?: 'failed' | 'unknown' } = {},
): Promise<FixtureAgentConversationGateway> {
  if (overrides.handoffStatus === undefined) {
    return await FixtureAgentConversationGateway.create(scenario);
  }
  const raw = await fs.readFile(
    path.join(process.cwd(), 'evals', 'fixtures', `${scenario}.json`),
    'utf8',
  );
  const data = JSON.parse(raw) as Record<string, unknown>;
  data['handoff'] = { status: overrides.handoffStatus };
  return FixtureAgentConversationGateway.createSync(scenario, data as FixtureData);
}

/** The neutral extraction the scripted runtime would answer with. */
function neutralExtraction(): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    intentConfidence: 0.9,
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
    conversationSummary: 'Offline twin turn.',
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

type TwinHarness = {
  readonly service: AgentService;
  readonly runtime: ScriptedAgentRuntime;
  readonly router: ScriptedSupportLaneRouter;
  readonly gateway: FixtureAgentConversationGateway;
  readonly planStore: InMemoryPlanStore;
  /** The sidecar the scripted model reports on the next turn. */
  sidecar: SupportReplySidecar;
  /** Replay the turns of one thread, in order. */
  replay(turns: readonly TwinTurn[]): Promise<TwinTurnResult[]>;
};

async function createHarness(args: {
  readonly gateway: FixtureAgentConversationGateway;
  readonly answers: readonly ScriptedAnswer[];
  readonly planStore?: InMemoryPlanStore;
}): Promise<TwinHarness> {
  const router = new ScriptedSupportLaneRouter({ answers: args.answers });
  const harness: {
    sidecar: SupportReplySidecar;
  } = { sidecar: neutralSidecar() };
  const runtime = new ScriptedAgentRuntime(
    [neutralExtraction()],
    () => ({
      text: 'Respuesta generada por el modelo.',
      sidecar: harness.sidecar,
    }),
  );
  const provider = providerGateway();
  const planStore = args.planStore ?? new InMemoryPlanStore();
  const service = new AgentService({
    planStore,
    runtime,
    providerGateway: provider,
    promptLoader,
    renderers,
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: knowledgeGateway(),
      providerGateway: provider,
      agentGateway: args.gateway,
    }),
    agentConversationGateway: args.gateway,
    supportLaneRouter: router,
  });
  return {
    service,
    runtime,
    router,
    gateway: args.gateway,
    planStore,
    get sidecar() {
      return harness.sidecar;
    },
    set sidecar(value: SupportReplySidecar) {
      harness.sidecar = value;
    },
    async replay(turns: readonly TwinTurn[]): Promise<TwinTurnResult[]> {
      const results: TwinTurnResult[] = [];
      // One thread, one plan: the external user id is stable so the plan,
      // the outcome signature and the repeat counter persist across turns.
      const externalUserId = `twin-${args.gateway.fixtureScenario}`;
      for (const [index, turn] of turns.entries()) {
        const composedBefore = runtime.composeRequests.length;
        const response = await service.handleTurn({
          channel: 'whatsapp',
          externalUserId,
          contactPhone: phoneOf(args.gateway.fixtureScenario),
          messageId: `twin-${args.gateway.fixtureScenario}-${index}`,
          receivedAt: new Date().toISOString(),
          text: turn.text,
          ...(turn.image === true
            ? {
              image: {
                status: 'available' as const,
                source: 'url' as const,
                url: 'https://example.invalid/receipt.png',
                mimeType: null,
              },
            }
            : {}),
        });
        // The replay is sequential: every turn observes the plan the
        // previous turn persisted.
        results.push({
          response,
          composedTurns: runtime.composeRequests.length - composedBefore,
        });
      }
      return results;
    },
  };
}

function phoneOf(scenario: string): string {
  const phones: Record<string, string> = {
    [SCENARIO_A]: PHONE_A,
    [SCENARIO_B]: PHONE_B,
    [SCENARIO_C]: PHONE_C,
    [SCENARIO_D]: PHONE_D,
    [SCENARIO_E]: PHONE_E,
  };
  return phones[scenario] ?? PHONE_A;
}

/** The purchase facts the judge evidence carries on a turn. */
function purchaseFactsOf(
  response: HandleTurnResponse,
): Array<Record<string, unknown>> {
  return response.trace.information_execution_summary.flatMap(
    (summary) => summary.evidence
      .map((evidence) => evidence.purchaseFact)
      .filter((fact) => fact !== undefined)
      .map((fact) => fact as unknown as Record<string, unknown>),
  );
}

/** The index of the turn that requested the human takeover, or -1. */
function takeoverTurnIndex(results: readonly TwinTurnResult[]): number {
  return results.findIndex(
    (result) => result.response.trace.tools_called.includes('request_human_takeover'),
  );
}

/**
 * The perf gate of 03-acceptance-tests.md: a support-lane turn runs the
 * router and the reply only. No classifier stage, no extraction stage, and
 * at most one compose call per turn.
 */
function expectSupportLaneStages(result: TwinTurnResult): void {
  expect(result.response.trace.openai_calls.classifier).toBeNull();
  expect(result.response.trace.openai_calls.extraction).toBeNull();
  expect(result.composedTurns).toBeLessThanOrEqual(1);
}

/** The completed purchase results the reply model received. */
function completedPurchaseResults(
  harness: { readonly runtime: ScriptedAgentRuntime },
  turnIndex = 0,
): Array<{
  readonly referenceResolution?: 'matched' | 'unavailable';
  readonly requestedCustomerTransactionNumber?: string | null;
}> {
  const results = harness.runtime.composeRequests[turnIndex]?.informationResults ?? [];
  return results.filter(
    (result): result is Extract<InformationTaskResult, { kind: 'purchase'; status: 'completed' }> =>
      result.kind === 'purchase' && result.status === 'completed',
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('offline twin A — Wilfredo: settlement latency and the repeat backstop', () => {
  // 03-acceptance-tests.md, "Twin A — Wilfredo (settlement latency +
  // repeat backstop)": the escalation happens no later than the turn where
  // repeatCount reaches 2, no turn asserts global purchase absence after
  // the receipt turn, and the stages contain no extraction.
  const TURNS_A: readonly TwinTurn[] = [
    { text: '', image: true },
    { text: 'Ya pagué por Yape el 4 de octubre y no me aparece ninguna compra en la página.' },
    { text: 'Revisen por favor mi cuenta de Yape, el débito sí está en mi aplicación.' },
    { text: 'Al segundo ya que la primera compra quedó sin efectuarse aunque ambas son por lo mismo, una cabecera de cama y un cubrecama.' },
    { text: '', image: true },
    { text: 'Ya les mandé la captura de mis movimientos de Yape y ahí figura el monto pagado. ¿Dónde está mi pedido?' },
    { text: 'Por favor, investiguen ese pago y me comuniquen el resultado.' },
  ];

  it('escalates through the repeat backstop and never asserts a global purchase absence', async () => {
    const gateway = await createGateway(SCENARIO_A);
    const harness = await createHarness({
      gateway,
      answers: TURNS_A.map(() => ({
        route: 'answer_with_records' as const,
        loopRisk: 0,
        needsHumanNow: 0.1,
        capabilityBlocked: 0.1,
      })),
    });

    const results = await harness.replay(TURNS_A);

    // The escalation happens no later than the turn where repeatCount
    // reaches 2 (03-acceptance-tests.md, "Twin A — Wilfredo"). The count is
    // the CURRENT turn's count: the signature and the counter are computed
    // before the router runs, so the second identical unresolved outcome
    // escalates immediately.
    const escalationIndex = takeoverTurnIndex(results);
    expect(escalationIndex).toBe(1);
    const backstopInput = harness.router.inputs[escalationIndex];
    expect(backstopInput?.plan.support_outcome?.repeat_count).toBeGreaterThanOrEqual(2);
    expect(backstopInput?.plan.support_outcome?.unresolved_money).toBe(true);

    // The escalation is a real human-escalation turn with a gateway receipt.
    const escalation = results[escalationIndex]?.response;
    expect(escalation?.trace.route_kind).toBe('human_escalation');
    expect(escalation?.plan.human_escalation.status).toBe('requested');
    expect(escalation?.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(
      gateway.getFixtureReceipts().find((receipt) => receipt.operation === 'handoff.write')
        ?.resultStatus,
    ).toBe('success');

    // No turn after the receipt turn asserts a global purchase absence: the
    // money evidence stays unresolved instead of falling back to "there is
    // no purchase evidence".
    for (const [index, result] of results.entries()) {
      if (index === 0) continue;
      expect(result.response.plan.support_outcome.unresolved_money).toBe(true);
    }

    // At most one composed answer turn while the outcome is unresolved (the
    // escalation turn is not an answer turn), and no composed answer turn
    // after the escalation (the soft pause holds).
    const composedWhileUnresolved = results.filter(
      (result, index) =>
        result.composedTurns > 0 &&
        result.response.trace.route_kind !== 'human_escalation' &&
        index > 0 &&
        results[index - 1]?.response.plan.support_outcome.unresolved_money === true,
    );
    expect(composedWhileUnresolved.length).toBeLessThanOrEqual(1);
    // No composed answer turn after the escalation: the soft pause holds
    // for the text turns. R6: a turn that carries a new receipt image is
    // not dropped, because that reference would be lost otherwise.
    const afterEscalation = results.slice(escalationIndex + 1);
    afterEscalation.forEach((result, index) => {
      if (TURNS_A[escalationIndex + 1 + index]?.image === true) {
        return;
      }
      expect(result.composedTurns).toBe(0);
    });

    // The support lane ran no extraction stage, and every answer turn was
    // one compose call.
    expect(harness.runtime.extractRequests).toHaveLength(0);
    for (const result of results) {
      expectSupportLaneStages(result);
    }
  });
});

describe('offline twin B — Luis: the customer reference never denies twice', () => {
  // 03-acceptance-tests.md, "Twin B — Luis (COD + frustration
  // escalation)": the unavailable reference never composes an answer turn
  // twice, the Michi & Chino facts are answered from the profile, the
  // escalation fires at the objection turn and the receipt is present.
  const TURNS_B: readonly TwinTurn[] = [
    { text: 'Hola, ¿mi compra existe? El número de compra que me dio su propia página es COD309553.' },
    { text: 'Es la boda de Michi & Chino del 21 de noviembre, el código es COD309553.' },
    { text: 'Por favor confírmenme que corresponde a la boda de Michelle Aramburú y Francisco Ugaz.' },
    { text: 'Es el número que me arroja su propia página cuando cobraron la compra, ¿qué le puedo decir?' },
    { text: 'Entonces, ¿es posible afirmar que a Michi y Chino les llegará un mensaje indicando que les hice un regalo de bodas?' },
    { text: 'ok' },
  ];

  it('answers the purchase from the profile and escalates at the objection turn', async () => {
    const gateway = await createGateway(SCENARIO_B);
    const harness = await createHarness({
      gateway,
      answers: TURNS_B.map((_turn, index) => (
        // The objection turn carries the escalation trigger; the turns
        // before it keep the answer route with a healthy loop risk.
        index === 3
          ? {
            route: 'escalate_human' as const,
            loopRisk: 3,
            needsHumanNow: 0.9,
            capabilityBlocked: 0.1,
          }
          : {
            route: 'answer_with_records' as const,
            loopRisk: 0,
            needsHumanNow: 0.1,
            capabilityBlocked: 0.1,
          }
      )),
    });

    const results = await harness.replay(TURNS_B);

    // The escalation lands on the objection turn and carries a receipt.
    const escalationIndex = takeoverTurnIndex(results);
    expect(escalationIndex).toBe(3);
    expect(results[escalationIndex]?.response.trace.route_kind).toBe('human_escalation');
    expect(results[escalationIndex]?.response.plan.human_escalation.status).toBe('requested');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(
      gateway.getFixtureReceipts().find((receipt) => receipt.operation === 'handoff.write')
        ?.resultStatus,
    ).toBe('success');

    // The Michi & Chino purchase is answered from the profile: the typed
    // purchase fact of the read carries the event, the status and the
    // amount, and the authorized profile the model received carries the
    // record with its order id.
    const facts = purchaseFactsOf(results[0]?.response ?? ({} as HandleTurnResponse));
    expect(facts).toContainEqual(expect.objectContaining({
      eventLabel: 'Michi & Chino',
      paymentStatus: 'approved',
      total: 86.45,
      currency: 'USD',
      referencePresent: false,
    }));
    const profile = harness.runtime.composeRequests[0]?.customerContext;
    expect(profile?.purchases).toContainEqual(expect.objectContaining({
      orderId: 'ORD_6ad6760c5bbee',
      paymentStatus: 'approved',
      grandTotal: 86.45,
      currency: 'USD',
    }));

    // The guest's typed code never becomes a record selector, so no turn
    // can deny the purchase on a reference that matches nothing by
    // construction.
    const purchaseResults = completedPurchaseResults(harness);
    expect(purchaseResults.length).toBeGreaterThan(0);
    expect(
      purchaseResults.every((result) => result.referenceResolution === undefined),
    ).toBe(true);
    expect(
      purchaseResults.every((result) =>
        result.requestedCustomerTransactionNumber === undefined),
    ).toBe(true);
    const unavailableReferenceTurns = results.filter((result) =>
      result.composedTurns > 0 &&
      result.response.trace.information_execution_summary.some(
        (summary) => summary.kind === 'purchase' && summary.outcomeCode === 'completed_without_results',
      ));
    expect(unavailableReferenceTurns.length).toBeLessThanOrEqual(1);

    // The support lane ran no extraction stage.
    expect(harness.runtime.extractRequests).toHaveLength(0);
    for (const result of results) {
      expectSupportLaneStages(result);
    }
  });
});

describe('offline twin C — Mirta: derivation truth and the host receipt', () => {
  // 03-acceptance-tests.md, "Twin C — Mirta (derivation truth + host
  // receipt)": the escalation by turn 6, the turns 4-5 variant executes the
  // takeover on the accept turn, the judge evidence carries the host-receipt
  // fact and the amounts are labelled.
  const TURNS_C: readonly TwinTurn[] = [
    { text: 'Estimados señores, por favor me pueden mandar por este medio la foto del regalo que compré para Stephanie Marroquín? No lo encuentro en el baby shower.' },
    { text: 'Señores, Stephanie me dice que no ha recibido nada, por favor confirmen si le entregaste el regalo y qué monto figura.' },
    { text: 'Según lo que yo vi compré por 80 y tantos soles un cambiador de pañales necesito que por favor me aclaren sobre el particular. Gracias.' },
    { text: 'Por favor, entonces devuélvanme los ochenta y siete con treinta y seis soles por Yape a este número. Gracias.' },
    { text: 'Sí, por favor necesito la devolución de mi dinero. Gracias.' },
    { text: 'La verdad que estoy muy fastidiada porque hablé con la futura mamá y ustedes no le han hecho entrega de nada de eso.' },
  ];

  it('escalates by turn 6 and carries the host receipt and the labelled amounts', async () => {
    const gateway = await createGateway(SCENARIO_C);
    const harness = await createHarness({
      gateway,
      answers: TURNS_C.map((_turn, index) => (
        // The refund demand cannot be executed by the runtime: the
        // capability is blocked, which is the escalation trigger.
        index >= 3
          ? {
            route: 'escalate_human' as const,
            loopRisk: 3,
            needsHumanNow: 0.4,
            capabilityBlocked: 0.9,
          }
          : {
            route: 'answer_with_records' as const,
            loopRisk: 0,
            needsHumanNow: 0.1,
            capabilityBlocked: 0.1,
          }
      )),
    });

    const results = await harness.replay(TURNS_C);

    // The escalation happens by turn 6.
    const escalationIndex = takeoverTurnIndex(results);
    expect(escalationIndex).toBeGreaterThanOrEqual(0);
    expect(escalationIndex).toBeLessThanOrEqual(5);
    expect(results[escalationIndex]?.response.plan.human_escalation.status).toBe('requested');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);

    // The judge evidence carries the host receipt and the labelled amounts.
    // The purchase discovery reads both authorized sources, so the evidence
    // carries one fact per source; the host receipt is the gift-purchase
    // fact (the order read carries no thank-you).
    const facts = purchaseFactsOf(results[0]?.response ?? ({} as HandleTurnResponse));
    const hostReceiptFacts = facts.filter((fact) => fact['thanksPresent'] === true);
    expect(hostReceiptFacts).toHaveLength(1);
    const hostReceiptFact = hostReceiptFacts[0];
    expect(hostReceiptFact?.['eventLabel']).toBe('Baby Shower');
    expect(hostReceiptFact?.['eventDate']).toBe('2026-10-17');
    expect(hostReceiptFact?.['paymentStatus']).toBe('approved');
    expect(hostReceiptFact?.['total']).toBe(87.36);
    expect(hostReceiptFact?.['currency']).toBe('PEN');
    expect(hostReceiptFact?.['referencePresent']).toBe(false);
    expect(hostReceiptFact?.['thanksMessage'])
      .toBe('Hola tia hermosa! Hemos recibido tu regalo con muchisimo amor!');
    expect(hostReceiptFact?.['thanksSendMethod']).toBe('whatsapp');
    const payment = hostReceiptFact?.['payment'] as
      | { method?: string; amount?: number; paidAt?: string }
      | undefined;
    expect(payment?.method).toBe('Yape o Plin');
    expect(payment?.amount).toBe(87.36);
    expect(payment?.paidAt).toBe('2026-09-27 19:38:19');
    const amounts = hostReceiptFact?.['amounts'] as
      | {
        charged_total?: { value?: number; currency?: string };
        gift_value?: Array<{ value?: number; currency?: string }>;
      }
      | undefined;
    expect(amounts?.charged_total?.value).toBe(87.36);
    expect(amounts?.charged_total?.currency).toBe('PEN');
    expect(amounts?.gift_value?.[0]?.value).toBe(79);
    expect(amounts?.gift_value?.[0]?.currency).toBe('PEN');

    expect(harness.runtime.extractRequests).toHaveLength(0);
    for (const result of results) {
      expectSupportLaneStages(result);
    }
  });

  it('executes the takeover on the accept turn of the turns 4-5 variant', async () => {
    const gateway = await createGateway(SCENARIO_C);
    const harness = await createHarness({
      gateway,
      answers: [
        // The demand turn: the runtime cannot execute a refund, so it
        // offers the human review.
        {
          route: 'offer_human' as const,
          loopRisk: 2,
          needsHumanNow: 0.1,
          capabilityBlocked: 0.1,
        },
        // The accept turn: the guest takes the offer, the takeover runs.
        {
          route: 'escalate_human' as const,
          loopRisk: 2,
          needsHumanNow: 0.9,
          capabilityBlocked: 0.1,
        },
        {
          route: 'answer_with_records' as const,
          loopRisk: 0,
          needsHumanNow: 0.1,
          capabilityBlocked: 0.1,
        },
      ],
    });

    const results = await harness.replay([
      { text: 'Quiero que me devuelvan los S/ 87.36 porque el regalo no se entregó.' },
      { text: 'Sí, por favor pásenme con una persona para que revisen la devolución.' },
      { text: 'Quedo atenta a la respuesta, gracias.' },
    ]);

    // The offer is opened the same turn and the takeover runs on the accept.
    expect(results[0]?.response.plan.conversation_health.help_offer_status).toBe('offered');
    const escalationIndex = takeoverTurnIndex(results);
    expect(escalationIndex).toBe(1);
    // R9: the stop reason carries the router's own trigger; the acceptance
    // of the open offer is a separate fact, never a substitute for it.
    expect(results[escalationIndex]?.response.trace.turn_decision.stopReason)
      .toBe('router_escalation:needs_human_now_threshold');
    expect(results[escalationIndex]?.response.trace.operational_note)
      .toContain('accepted the open human help offer');
    // The takeover consumed the offer, so it is no longer open.
    expect(results[escalationIndex]?.response.plan.conversation_health.help_offer_status)
      .toBe('none');
    expect(results[escalationIndex]?.response.plan.human_escalation.status).toBe('requested');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(
      gateway.getFixtureReceipts().find((receipt) => receipt.operation === 'handoff.write')
        ?.resultStatus,
    ).toBe('success');
    expect(harness.runtime.extractRequests).toHaveLength(0);
    for (const result of results) {
      expectSupportLaneStages(result);
    }
  });
});

describe('offline twin D — Silvia: the terse loop escalates through the backstop', () => {
  // 03-acceptance-tests.md, "Twin D — Silvia (terse loop; backstop only)":
  // the escalation happens through the repeat backstop by turn 3 even
  // though the health signal is progressing, no extraction stage runs and
  // the receipt is present.
  const TURNS_D: readonly TwinTurn[] = [
    { text: '', image: true },
    { text: 'Ya envié el comprobante del plin al correo.' },
    { text: 'Por favor' },
    { text: 'Acá sí se ha cobrado el plin, de Ana Cerdán. ¿Y mi pedido?' },
  ];

  it('escalates by turn 3 through the backstop with the reported payment', async () => {
    const gateway = await createGateway(SCENARIO_D);
    const harness = await createHarness({
      gateway,
      answers: TURNS_D.map(() => ({
        route: 'answer_with_records' as const,
        loopRisk: 0,
        needsHumanNow: 0.1,
        capabilityBlocked: 0.1,
      })),
    });
    // The guest reports the Plin payment on the receipt turn: the model
    // reports it, the runtime never reads it from the message text.
    harness.sidecar = {
      citedOrderIds: [],
      reportedPayment: {
        amount: 391.87,
        currency: 'PEN',
        method: 'Plin',
        claimedSuccess: true,
      },
      claimedHandoff: false,
    };

    const results = await harness.replay(TURNS_D);

    // The receipt turn knows the declined record but not yet the reported
    // payment: the payment is the client's claim, and it only reaches the
    // runtime after the compose of that turn. The outcome of the receipt
    // turn is therefore the resolved one.
    expect(results[0]?.response.plan.support_outcome.unresolved_money).toBe(false);
    const purchaseSummaries = results[0]?.response.trace.information_execution_summary ?? [];
    expect(
      purchaseSummaries.some((summary) => summary.kind === 'purchase' && summary.status === 'completed'),
    ).toBe(true);
    expect(purchaseFactsOf(results[0]?.response ?? ({} as HandleTurnResponse)))
      .toContainEqual(expect.objectContaining({
        paymentStatus: 'declined',
        total: 403.53,
      }));
    // No customer reference was requested, so the outcome cannot be the
    // "reference unavailable" kind: it is the declined-against-reported
    // success shape.
    const purchaseResults = completedPurchaseResults(harness);
    expect(purchaseResults.length).toBeGreaterThan(0);
    expect(
      purchaseResults.every((result) => result.referenceResolution === undefined),
    ).toBe(true);

    // The next turn knows the reported payment: the declined record against
    // the client's successful payment is the unresolved money outcome, the
    // only unresolved kind reachable with a non-empty order set and no
    // requested customer reference.
    expect(results[1]?.response.plan.support_outcome.unresolved_money).toBe(true);
    expect(results[1]?.response.plan.support_outcome.reported_payment).toMatchObject({
      amount: 391.87,
      method: 'Plin',
      claimed_success: true,
    });

    // The escalation happens by turn 3, through the repeat backstop.
    const escalationIndex = takeoverTurnIndex(results);
    expect(escalationIndex).toBeLessThanOrEqual(2);
    expect(escalationIndex).toBeGreaterThanOrEqual(0);
    const backstopInput = harness.router.inputs[escalationIndex];
    expect(backstopInput?.plan.support_outcome?.repeat_count).toBeGreaterThanOrEqual(2);
    expect(backstopInput?.plan.support_outcome?.unresolved_money).toBe(true);
    expect(results[escalationIndex]?.response.plan.human_escalation.status).toBe('requested');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(
      gateway.getFixtureReceipts().find((receipt) => receipt.operation === 'handoff.write')
        ?.resultStatus,
    ).toBe('success');

    // The health signal never left "progressing": the backstop, not the
    // health, escalated the thread.
    expect(results[escalationIndex]?.response.plan.conversation_health.status).toBe('progressing');
    expect(harness.runtime.extractRequests).toHaveLength(0);
    for (const result of results) {
      expectSupportLaneStages(result);
    }
  });
});

describe('offline twin E — multi-purchase ambiguity: the clarification claims no order', () => {
  // 03-acceptance-tests.md, "Twin E — Multi-purchase ambiguity (guardrail
  // for merged compose)": the route is ask_clarification, the composed
  // sidecar cites nothing outside the clarification target set and the turn
  // carries no purchase-specific backend claim.
  const TURNS_E: readonly TwinTurn[] = [
    { text: 'Tengo dos compras, una para la boda y otra para el cumpleaños, no sé cuál es cuál.' },
  ];

  it('clarifies without a purchase-specific backend claim', async () => {
    const gateway = await createGateway(SCENARIO_E);
    const harness = await createHarness({
      gateway,
      answers: [{
        route: 'ask_clarification' as const,
        loopRisk: 0,
        needsHumanNow: 0.1,
        capabilityBlocked: 0.1,
      }],
    });
    const targetOrderIds = ['ORD_amb-01', 'ORD_amb-02'];
    harness.sidecar = {
      citedOrderIds: targetOrderIds,
      reportedPayment: null,
      claimedHandoff: false,
    };

    const results = await harness.replay(TURNS_E);

    expect(results[0]?.response.trace.router_decision?.route).toBe('ask_clarification');
    // The composed sidecar cites the clarification target set only.
    const cited = results[0]?.response.trace.tool_outputs
      .find((entry) => entry.tool === 'support_reply_sidecar');
    expect(cited).toBeDefined();
    expect(JSON.parse(cited?.output ?? '{}')).toMatchObject({
      cited_order_count: targetOrderIds.length,
      dropped_order_count: 0,
    });
    // The clarification turn carries no purchase-specific backend claim: no
    // task read produced an order-keyed fact.
    expect(results[0]?.response.trace.information_execution_summary).toEqual([]);
    expect(purchaseFactsOf(results[0]?.response ?? ({} as HandleTurnResponse))).toEqual([]);
    expect(harness.runtime.extractRequests).toHaveLength(0);
    expect(results[0]?.composedTurns).toBe(1);
    for (const result of results) {
      expectSupportLaneStages(result);
    }
  });
});

describe('offline twin — a failed handoff never carries a success claim', () => {  // WP5 step 3: a claim of a successful human handoff needs an in-turn
  // gateway success receipt. Without one the turn resolves without the
  // claim: a typed operational failure, never a success sentence and never
  // canned prose.
  it('resolves without the claim when the gateway fails', async () => {
    const gateway = await createGateway(SCENARIO_A, { handoffStatus: 'failed' });
    const harness = await createHarness({
      gateway,
      answers: [{
        route: 'escalate_human' as const,
        loopRisk: 4,
        needsHumanNow: 0.9,
        capabilityBlocked: 0.5,
      }],
    });
    // The model claims the handoff was registered; the gateway says it was
    // not.
    harness.sidecar = {
      citedOrderIds: [],
      reportedPayment: null,
      claimedHandoff: true,
    };

    const results = await harness.replay([
      { text: 'Por favor, investiguen ese pago y me comuniquen el resultado.' },
    ]);

    const response = results[0]?.response;
    expect(response?.outbound.text).toBeNull();
    expect(response?.outbound.delivery.action).toBe('failure');
    expect(response?.outbound.delivery.reason).toBe('support_lane_unverified_handoff_claim');
    // The compose received the real handoff outcome: the failed attempt,
    // never a success.
    const compose = harness.runtime.composeRequests[0];
    expect(compose?.handoffOutcome).toBe('handoff_failed');
    expect(response?.plan.human_escalation.status).toBe('none');
    expect(gateway.getFixtureCallCount('handoff.write')).toBe(1);
    expect(
      gateway.getFixtureReceipts().find((receipt) => receipt.operation === 'handoff.write')
        ?.resultStatus,
    ).toBe('failed');
  });
});

describe('offline eval target — the customer-assistance lane can be replayed', () => {
  // The offline target carries the scripted router: a case that declares
  // router answers replays the customer-assistance lane without a model and
  // without a network. A case that declares none keeps the established
  // path, so the target's public behaviour is unchanged.
  it('replays a support turn through the scripted router', async () => {
    const currentCase = evalCaseSchema.parse({
      id: 'offline-router-lane-smoke',
      suite: 'offline',
      version: 1,
      description: 'The offline target replays the customer-assistance lane.',
      targetModes: ['offline'],
      inputs: [{ text: 'Quiero saber el estado de mi compra.', channel: 'terminal_whatsapp_eval' }],
      fixtures: {
        offline: {
          repliesByTurn: ['Respuesta de la replay offline.'],
          routerAnswersByTurn: [{
            route: 'answer_with_records',
            loopRisk: 0,
            needsHumanNow: 0.1,
            capabilityBlocked: 0.1,
          }],
        },
      },
    });

    const result = await runOfflineCase({
      currentCase,
      config: {
        label: 'offline-router-lane-smoke',
        target: 'offline',
        notes: [],
        environmentOverrides: {},
      },
      artifactDir: path.resolve(process.cwd(), '.eval-runs-test'),
    });

    const turn = result.turns[0];
    expect(turn?.deliveredText).toBe('Respuesta de la replay offline.');
    // The router owned the turn: the router stage ran and no extraction
    // stage did.
    const openAiCalls = turn?.trace.openai_calls;
    expect(openAiCalls?.router).not.toBeNull();
    expect(openAiCalls?.extraction).toBeNull();
  });
});

