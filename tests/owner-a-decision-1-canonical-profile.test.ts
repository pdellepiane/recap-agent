import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import type {
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseAspect,
  PurchaseInformation,
  PurchaseItem,
} from '../src/core/information';
import type {
  ComposeReplyRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type {
  AgentConversationGateway,
  AgentConversationMessage,
  AgentPurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  buildTurnMessageContext,
  localTurnMessageContext,
} from '../src/runtime/turn-message-context';
import {
  assembleCustomerContext,
  hasConfirmedOutcome,
  invalidateSectionAfterWrite,
  isValidMutationTargetId,
  mergeExecutionIntoSnapshot,
  projectCustomerContext,
  recordValidatedActionOutcome,
  resolveRelevantTarget,
} from '../src/runtime/customer-context';

const NOW = '2026-09-22T12:00:00.000Z';

function testRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-test',
    extractorModel: 'gpt-test',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    providerGateway: {
      async searchProviders(): Promise<never> {
        throw new Error('construction must not call the provider gateway');
      },
    } as never,
  });
}

function supportPlan(overrides: Record<string, unknown> = {}): PersistedPlan {
  return mergePlan(
    createEmptyPlan({ planId: 'decision-1-plan', channel: 'whatsapp', externalUserId: 'decision-1-user' }),
    { current_node: 'resolver_consultas_informativas', ...overrides },
  ) as PersistedPlan;
}

function baseExtraction(overrides: Record<string, unknown> = {}): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: null,
    reportedEventRole: null,
    informationRequests: [],
    supportAct: null,
    humanHelpIntent: null,
    normalizationIssues: [],
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: 'plan_state',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: null,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
      candidateOperations: [],
      questionKey: null,
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
    conversationSummary: '',
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
    imageReference: null,
    ...overrides,
  } as unknown as ExtractionResult;
}

function replyRequest(
  plan: PersistedPlan,
  overrides: Record<string, unknown> = {},
): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: '¿Cuál es el estado de mis compras?',
    messageContext: localTurnMessageContext('not_configured'),
    plan,
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'decision-1-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    ...overrides,
  } as unknown as ComposeReplyRequest;
}

const TURN_EVIDENCE_MARKER = 'Evidencia canónica del turno (JSON): ';

function extractTurnEvidence(input: string): Record<string, unknown> {
  const markerAt = input.indexOf(TURN_EVIDENCE_MARKER);
  if (markerAt < 0) {
    throw new Error('Turn evidence block missing from serialized input.');
  }
  const start = input.indexOf('{', markerAt);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(input.slice(start, index + 1)) as Record<string, unknown>;
      }
    }
  }
  throw new Error('Unbalanced turn evidence JSON in serialized input.');
}

function detailedPurchasesOf(input: string): PurchaseInformation[] {
  const evidence = extractTurnEvidence(input);
  const customerContext = evidence.customer_context as { detailedPurchases?: unknown } | undefined;
  if (!customerContext || !Array.isArray(customerContext.detailedPurchases)) {
    throw new Error('Parsed evidence carries no detailedPurchases.');
  }
  return customerContext.detailedPurchases as PurchaseInformation[];
}

/** Years-old authorized record: physical gift, quantity 2, recorded dispatch. */
function olderOrdersRecord(): PurchaseInformation {
  return {
    orderId: 'ORD-OLDER-2021',
    paymentStatus: 'approved',
    shippingStatus: 'delivered',
    grandTotal: 300,
    paymentMethod: 'Transferencia',
    currency: 'PEN',
    currencySymbol: 'S/',
    eventName: 'Aniversario Lucia',
    eventDate: '2021-06-14',
    eventUrl: null,
    createdAt: '2021-05-01 10:00:00',
    items: [{
      giftName: 'Juego de sábanas',
      quantity: 2,
      amount: 150,
      rowTotal: 300,
      type: 'se_store',
    }],
  };
}

/** Recent authorized record: host-credit gift, pending payment, unknown currency. */
function newerGiftRecord(): PurchaseInformation {
  return {
    orderId: 'GIFT-NEWER-2026',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 80,
    paymentMethod: 'Yape',
    currency: null,
    eventName: 'Baby Shower Catalina',
    eventDate: '2026-09-05',
    eventUrl: null,
    createdAt: '2026-08-28 10:00:00',
    items: [{
      giftName: 'Aporte luna de miel',
      quantity: 1,
      amount: 80,
      rowTotal: 80,
      type: 'credit',
    }],
    payment: { method: 'Yape', amount: null, paidAt: null },
  };
}

function expectItemBinding(
  items: PurchaseItem[],
  expected: {
    giftName: string;
    quantity: number | null;
    amount: number | null;
    rowTotal: number | null;
    type: string | null;
    kind: string;
    chosenBy: string | null;
    giftShipmentApplicable: boolean | null;
  },
): void {
  const found = items.find((item) => item.giftName === expected.giftName);
  if (!found) {
    throw new Error(`Item ${expected.giftName} missing from parsed evidence.`);
  }
  expect(found.quantity).toBe(expected.quantity);
  expect(found.amount).toBe(expected.amount);
  expect(found.rowTotal).toBe(expected.rowTotal);
  expect(found.type).toBe(expected.type);
  expect(found.fulfillment?.kind ?? null).toBe(expected.kind);
  expect(found.fulfillment?.chosenBy ?? null).toBe(expected.chosenBy);
  expect(found.fulfillment?.giftShipmentApplicable ?? null).toBe(expected.giftShipmentApplicable);
}

async function executeDiscovery(args: {
  orders: PurchaseInformation[] | { status: 'failed'; error: string };
  gifts: PurchaseInformation[] | { status: 'failed'; error: string };
  aspects?: PurchaseAspect[];
  orderId?: string | null;
}): Promise<{
  results: InformationTaskResult[];
  summaries: InformationExecutionSummary[];
  ordersCalls: number;
  giftCalls: number;
}> {
  let ordersCalls = 0;
  let giftCalls = 0;
  const agentGateway = {
    async getOrders(): Promise<AgentPurchaseLookupResult> {
      ordersCalls += 1;
      if (Array.isArray(args.orders)) {
        return { status: 'success', resource: 'orders', purchases: args.orders };
      }
      return {
        status: 'failed',
        resource: 'orders',
        retryable: true,
        failureKind: 'request_failed',
        error: args.orders.error,
      };
    },
    async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
      giftCalls += 1;
      if (Array.isArray(args.gifts)) {
        return { status: 'success', resource: 'gift_purchases', purchases: args.gifts };
      }
      return {
        status: 'failed',
        resource: 'gift_purchases',
        retryable: true,
        failureKind: 'request_failed',
        error: args.gifts.error,
      };
    },
  } as unknown as AgentConversationGateway;
  const orchestrator = new InformationOrchestrator({
    knowledgeGateway: {} as KnowledgeRetrievalGateway,
    providerGateway: {} as ProviderGateway,
    agentGateway,
  });
  const execution = await orchestrator.execute({
    requests: [{
      requestId: 'decision-1-discovery',
      kind: 'purchase',
      resource: 'purchase_discovery',
      query: '¿Cuál es el estado de mis compras?',
      orderId: args.orderId ?? null,
      aspects: args.aspects ?? ['summary', 'shipping', 'payment_status'],
      sensitiveFields: [],
      authAction: 'none',
    }],
    authentication: { token: 'test-token', email: 'test@example.com' },
    authBlock: null,
  });
  return { results: execution.results, summaries: execution.summaries, ordersCalls, giftCalls };
}

describe('decision 1 canonical per-record profile in serialized production input', () => {
  it('retains the years-old record with quantities, amounts, payment/shipping states and provenance', async () => {
    const { results, summaries, ordersCalls, giftCalls } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    expect(ordersCalls).toBe(1);
    expect(giftCalls).toBe(1);

    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.purchasesCarts.status).toBe('ready');
    expect(snapshot.purchasesCarts.completeness).toBe('complete');
    const customerContext = projectCustomerContext(snapshot, { focus: 'general' });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
        extraction: baseExtraction({
          requestedOperation: 'purchase.read',
          informationRequests: [{
            kind: 'purchase',
            resource: 'purchase_discovery',
            query: '¿Cuál es el estado de mis compras?',
            orderId: null,
            aspects: ['summary', 'shipping', 'payment_status'],
            sensitiveFields: [],
            authAction: 'none',
          }],
        }),
      }),
    );

    // Both authorized records reach the serialized production input once.
    const purchases = detailedPurchasesOf(spec.input);
    expect(purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['GIFT-NEWER-2026', 'ORD-OLDER-2021'],
    );
    const older = purchases.find((purchase) => purchase.orderId === 'ORD-OLDER-2021');
    const newer = purchases.find((purchase) => purchase.orderId === 'GIFT-NEWER-2026');
    if (!older || !newer) throw new Error('Missing discovered purchases.');

    // Older record: 2021 dates, quantities, unit/row amounts, payment and
    // dispatch states survive with no cutoff.
    expect(older.createdAt).toBe('2021-05-01 10:00:00');
    expect(older.eventDate).toBe('2021-06-14');
    expect(older.paymentStatus).toBe('approved');
    expect(older.shippingStatus).toBe('delivered');
    expect(older.amountDisclosure?.total).toBe(300);
    expect(older.amountDisclosure?.currency).toBe('PEN');
    expectItemBinding(older.items, {
      giftName: 'Juego de sábanas', quantity: 2, amount: 150, rowTotal: 300,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    });

    // Newer record: pending payment, credit fulfillment, unknown currency
    // stays unknown (never inferred).
    expect(newer.paymentStatus).toBe('pending');
    expect(newer.amountDisclosure?.total).toBe(80);
    expect(newer.amountDisclosure?.currency ?? null).toBeNull();
    expectItemBinding(newer.items, {
      giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    expect(newer.creditFulfillmentPolicy).toEqual({
      chosenBy: 'host',
      mechanism: 'host_account_credit',
    });

    // Section provenance and per-source coverage ride the serialized profile
    // and reference: never an exhaustive claim from an unlisted source.
    const evidence = extractTurnEvidence(spec.input);
    const profile = evidence.customer_context as {
      provenance?: {
        purchasesCarts?: {
          source?: string;
          scope?: string;
          completeness?: string;
          sourceCoverage?: Array<{ source: string; status: string; count: number }>;
        };
      };
    };
    expect(profile.provenance?.purchasesCarts?.source).toBe('agent_api');
    expect(profile.provenance?.purchasesCarts?.scope).toBe('account');
    expect(profile.provenance?.purchasesCarts?.completeness).toBe('complete');
    expect(
      profile.provenance?.purchasesCarts?.sourceCoverage?.map((entry) => entry.source).sort(),
    ).toEqual(['gift_purchases', 'orders']);
    const refs = evidence.information_results as Array<Record<string, unknown>>;
    expect(refs[0]).toMatchObject({ profile_ref: 'customer_context' });
    expect(refs[0]).toHaveProperty('source_coverage');
  });

  it('keeps candidate, summary and detail amounts coherent with one home per fact', async () => {
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const projection = projectCustomerContext(snapshot, { focus: 'general' });

    // One home per fact: summaries and the candidate index mirror the
    // detail disclosure through the same readers, never contradicting it.
    for (const candidate of projection.candidates) {
      if (candidate.kind !== 'order' || candidate.orderId === undefined) continue;
      const detail = projection.detailedPurchases.find(
        (entry) => entry.orderId === candidate.orderId,
      );
      const summary = projection.purchases.find((entry) => entry.orderId === candidate.orderId);
      const detailTotal = detail?.amountDisclosure?.total ?? detail?.grandTotal ?? null;
      const detailCurrency = detail?.amountDisclosure?.currency ?? null;
      if (candidate.total !== undefined) {
        expect(candidate.total).toBe(detailTotal);
        expect(summary?.grandTotal ?? null).toBe(detailTotal);
      }
      if (candidate.currency !== undefined) {
        expect(candidate.currency).toBe(detailCurrency);
      }
      if (candidate.state !== undefined) {
        expect(candidate.state).toBe(summary?.paymentStatus ?? null);
      }
    }
    // The older PEN record exposes its currency in the candidate index
    // (disclosure-first); the newer unknown-currency record omits it.
    const olderCandidate = projection.candidates.find(
      (entry) => entry.kind === 'order' && entry.orderId === 'ORD-OLDER-2021',
    );
    const newerCandidate = projection.candidates.find(
      (entry) => entry.kind === 'order' && entry.orderId === 'GIFT-NEWER-2026',
    );
    expect(olderCandidate?.total).toBe(300);
    expect(olderCandidate?.currency).toBe('PEN');
    expect(newerCandidate?.total).toBe(80);
    expect(newerCandidate?.currency).toBeUndefined();
    // Item facts live once in the complete record body.
    expect(JSON.stringify(projection.purchases)).not.toContain('Juego de sábanas');
    expect(JSON.stringify(projection.candidates)).not.toContain('Juego de sábanas');
    const bodies = JSON.stringify(projection.detailedPurchases);
    expect(bodies.split('Juego de sábanas')).toHaveLength(2);
  });

  it('reads unknown paid as unknown remaining without ever computing a balance', async () => {
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'payment',
      relevantOrderIds: ['GIFT-NEWER-2026'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
        extraction: baseExtraction({
          informationRequests: [{
            kind: 'purchase',
            resource: 'purchase_discovery',
            query: '¿Cuánto debo?',
            orderId: null,
            aspects: ['summary', 'payment_status'],
            sensitiveFields: [],
            authAction: 'none',
          }],
        }),
      }),
    );
    const evidence = extractTurnEvidence(spec.input);
    const profile = evidence.customer_context as {
      purchases: Array<Record<string, unknown>>;
    };
    const newerSummary = profile.purchases.find(
      (entry) => entry.orderId === 'GIFT-NEWER-2026',
    );
    // Unknown paid stays unknown: null paid, unverifiable remaining, and no
    // computed difference anywhere in the serialized input.
    expect(newerSummary).toMatchObject({
      totalAvailability: 'available',
      paidAmount: null,
      paidAvailability: 'unknown',
      remaining: null,
      remainingVerifiable: false,
    });
    expect(spec.input).not.toMatch(/"remaining":\s*80/);
    expect(spec.input).not.toMatch(/"remaining":\s*300/);
  });

  it('keeps physical kind separate from dispatch and host credit separate from posting', async () => {
    const physicalUnknownDispatch: PurchaseInformation = {
      ...olderOrdersRecord(),
      orderId: 'ORD-PHYS-UNKNOWN-SHIP',
      shippingStatus: null,
    };
    const { results, summaries } = await executeDiscovery({
      orders: [physicalUnknownDispatch],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, { focus: 'general' });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
      }),
    );
    const purchases = detailedPurchasesOf(spec.input);
    const physical = purchases.find((entry) => entry.orderId === 'ORD-PHYS-UNKNOWN-SHIP');
    const credit = purchases.find((entry) => entry.orderId === 'GIFT-NEWER-2026');
    if (!physical || !credit) throw new Error('Missing separation fixtures.');
    // Physical kind without a dispatch record: still physical, null dispatch,
    // and no recipient derived.
    expect(physical.items[0]?.fulfillment?.kind).toBe('physical');
    expect(physical.shippingStatus ?? null).toBeNull();
    expect(JSON.stringify(physical)).not.toContain('recipient');
    // Host-credit choice with pending payment: host policy present, payment
    // state independent, and no posting/availability language derived.
    expect(credit.items[0]?.fulfillment?.kind).toBe('host_credit');
    expect(credit.paymentStatus).toBe('pending');
    const serialized = JSON.stringify(customerContext);
    expect(serialized).not.toContain('posted');
    expect(serialized).not.toContain('publicado');
    expect(serialized).not.toContain('fondos disponibles');
    expect(spec.input).not.toContain('credited');
  });

  it('exposes dispatch only with affirmative physical evidence, never from kind alone', async () => {
    // Physical record with a recorded state: the state is preserved.
    // Non-physical record with a recorded state: withheld, since no gift
    // shipment applies — per-item fulfillment carries applicability instead.
    // Either way nothing is derived from kind: no invented dispatch date,
    // no recipient.
    async function projectedFor(record: PurchaseInformation): Promise<PurchaseInformation> {
      const agentGateway = {
        async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
          return { status: 'success', resource: 'gift_purchases', purchases: [record] };
        },
      } as unknown as AgentConversationGateway;
      const orchestrator = new InformationOrchestrator({
        knowledgeGateway: {} as KnowledgeRetrievalGateway,
        providerGateway: {} as ProviderGateway,
        agentGateway,
      });
      const execution = await orchestrator.execute({
        requests: [{
          requestId: 'decision-1-ship-kind',
          kind: 'purchase',
          resource: 'gift_purchases',
          query: '¿Cuándo llega?',
          orderId: null,
          aspects: ['shipping'],
          sensitiveFields: [],
          authAction: 'none',
        }],
        authentication: { token: 'test-token', email: 'test@example.com' },
        authBlock: null,
      });
      const result = execution.results[0];
      if (!result || result.status !== 'completed' || result.kind !== 'purchase') {
        throw new Error('Expected a completed gift purchase result.');
      }
      const projected = result.purchases[0];
      if (!projected) throw new Error('Expected one projected purchase.');
      return projected;
    }

    const physical = await projectedFor({ ...olderOrdersRecord(), shippingStatus: 'in_transit' });
    expect(physical.shippingStatus).toBe('in_transit');
    expect(physical.items[0]?.fulfillment?.giftShipmentApplicable).toBe(true);
    expect(JSON.stringify(physical)).not.toContain('recipient');

    const credit = await projectedFor({ ...newerGiftRecord(), shippingStatus: 'in_transit' });
    expect(credit.shippingStatus).toBeNull();
    expect(credit.items[0]?.fulfillment?.giftShipmentApplicable).toBe(false);
  });

  it('carries per-record partition provenance through projection when the backend reports it', async () => {
    const partitioned: PurchaseInformation = {
      ...olderOrdersRecord(),
      partition: 'completed_orders',
    };
    const agentGateway = {
      async getOrders(): Promise<AgentPurchaseLookupResult> {
        return { status: 'success', resource: 'orders', purchases: [partitioned] };
      },
    } as unknown as AgentConversationGateway;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {} as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'decision-1-partition',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado?',
        orderId: null,
        aspects: ['summary'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: { token: 'test-token', email: 'test@example.com' },
      authBlock: null,
    });
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const projection = projectCustomerContext(snapshot, { focus: 'general' });
    expect(projection.detailedPurchases[0]?.partition).toBe('completed_orders');
    expect(projection.purchases[0]?.partition).toBe('completed_orders');
  });
});

describe('decision 1 explicit read-only reference over multiple records', () => {
  it('resolves an explicit order id without clarification and without selecting by recency', async () => {
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    // Read-only resolution: the explicit years-old id wins over the newer
    // pending record; two records without a ref stay candidates.
    expect(resolveRelevantTarget({
      orderIds: ['GIFT-NEWER-2026', 'ORD-OLDER-2021'],
      eventIds: [],
      relevantOrderIds: ['ORD-OLDER-2021'],
    })).toEqual({ kind: 'target', orderId: 'ORD-OLDER-2021', eventId: null });
    expect(resolveRelevantTarget({
      orderIds: ['GIFT-NEWER-2026', 'ORD-OLDER-2021'],
      eventIds: [],
    }).kind).toBe('candidates');

    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['ORD-OLDER-2021'],
    });
    expect(customerContext.purchases[0]?.orderId).toBe('ORD-OLDER-2021');
    expect(customerContext.detailedPurchases[0]?.orderId).toBe('ORD-OLDER-2021');
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        userMessage: 'Consulta por Aniversario Lucia. Ese pedido sigue pendiente?',
        customerContext,
        informationResults: results,
        extraction: baseExtraction({
          informationRequests: [{
            kind: 'purchase',
            resource: 'purchase_discovery',
            query: 'Consulta por Aniversario Lucia. Ese pedido sigue pendiente?',
            orderId: 'ORD-OLDER-2021',
            eventHint: 'Aniversario Lucia',
            aspects: ['summary', 'payment_status'],
            sensitiveFields: [],
            authAction: 'none',
          }],
        }),
      }),
    );
    const evidence = extractTurnEvidence(spec.input);
    const refs = evidence.information_results as Array<Record<string, unknown>>;
    // Both authorized records stay visible; multiplicity alone never compels
    // a selection question, and the explicit ref needs no clarification.
    expect(refs[0]).toMatchObject({ outcome_kind: 'order_set', permitted_next_action: 'none' });
    expect((refs[0]?.missing_inputs as string[] | undefined) ?? []).not.toContain('purchase_selection');
    expect(spec.input).not.toContain('purchase_selection');
    expect(spec.input).toContain('ORD-OLDER-2021');
    expect(spec.input).toContain('Aniversario Lucia');
  });

  it('narrows an explicit backend order id to a single record with no selection', async () => {
    let receivedOrderId: string | null | undefined;
    const agentGateway = {
      async getOrders(input: { orderId: string | null }): Promise<AgentPurchaseLookupResult> {
        receivedOrderId = input.orderId;
        const purchases = input.orderId
          ? [olderOrdersRecord()].filter((entry) => entry.orderId === input.orderId)
          : [olderOrdersRecord()];
        return { status: 'success', resource: 'orders', purchases };
      },
    } as unknown as AgentConversationGateway;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {} as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'decision-1-explicit-id',
        kind: 'purchase',
        resource: 'orders',
        query: 'Consulta por ORD-OLDER-2021',
        orderId: 'ORD-OLDER-2021',
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: { token: 'test-token', email: 'test@example.com' },
      authBlock: null,
    });
    expect(receivedOrderId).toBe('ORD-OLDER-2021');
    const result = execution.results[0];
    if (!result || result.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('Expected a completed single-record result.');
    }
    expect(result.purchases.map((entry) => entry.orderId)).toEqual(['ORD-OLDER-2021']);
    expect(result.needsSelection).toBe(false);
  });
});

describe('decision 1 partial-source failures stay explicit beside ready facts', () => {
  it('keeps ready records usable with partial completeness and failed-leg coverage', async () => {
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: { status: 'failed', error: 'HTTP 500' },
    });
    const result = results[0];
    if (!result || result.status !== 'completed' || result.kind !== 'purchase') {
      throw new Error('Expected a completed partial result.');
    }
    expect(result.coverage).toBe('partial');
    expect(result.sourceCoverage?.map((entry) => `${entry.source}:${entry.status}`).sort()).toEqual(
      ['gift_purchases:failed', 'orders:completed'],
    );
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    // Ready facts stay usable; the section is partial, never exhaustive.
    expect(snapshot.purchasesCarts.status).toBe('ready');
    expect(snapshot.purchasesCarts.completeness).toBe('partial');
    expect(snapshot.purchasesCarts.purchases.map((entry) => entry.orderId)).toEqual(['ORD-OLDER-2021']);
    const customerContext = projectCustomerContext(snapshot, { focus: 'general' });
    expect(customerContext.provenance?.purchasesCarts?.completeness).toBe('partial');
    expect(
      customerContext.provenance?.purchasesCarts?.sourceCoverage?.map((entry) => entry.status).sort(),
    ).toEqual(['completed', 'failed']);
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
      }),
    );
    const evidence = extractTurnEvidence(spec.input);
    const refs = evidence.information_results as Array<Record<string, unknown>>;
    expect(refs[0]).toMatchObject({ coverage: 'partial', profile_ref: 'customer_context' });
    expect(JSON.stringify(refs[0])).toContain('gift_purchases');
    expect(spec.input).toContain('ORD-OLDER-2021');
  });
});

const CAMPAIGN_BODY = 'Recordatorio decision-1: Boda Lucía y Marco, 10 de octubre. Confirma tu asistencia.';
const KB_SCHEDULE_TEXT = 'Horario decision-1: lunes a viernes de 9am a 6pm por Yape o transferencia.';

function campaignMessageContext(): ReturnType<typeof buildTurnMessageContext> {
  return buildTurnMessageContext({
    messages: [{
      id: 7,
      direction: 'outbound',
      source: 'admin_campaign',
      body: CAMPAIGN_BODY,
      status: 'delivered',
      whatsappMessageId: null,
      sentAt: '2026-09-20T10:00:00.000Z',
      createdAt: '2026-09-20T10:00:00.000Z',
    } satisfies AgentConversationMessage],
    inbound: {
      channel: 'whatsapp',
      externalUserId: 'decision-1-user',
      text: '¿Cuál es el estado de mis compras?',
      messageId: 'decision-1-inbound',
      receivedAt: NOW,
      contactPhone: '+51900000001',
    },
  });
}

function kbFaqResult(): InformationTaskResult {
  return {
    requestId: 'decision-1-kb',
    kind: 'faq',
    status: 'completed',
    evidence: [{
      fileId: 'kb-decision-1',
      filename: 'horarios-y-canales-de-atencion.md',
      score: 0.98,
      text: KB_SCHEDULE_TEXT,
    }],
  };
}

function rsvpReceiptOverrides(): Record<string, unknown> {
  return {
    rsvpPhoneEvidence: {
      state: 'resolved_single',
      coverage: 'complete',
      resolution: 'authoritative_invitation',
      event: {
        event_name: 'Boda Lucía y Marco',
        event_date: '2026-10-10',
        invitation_record: 'available',
        rsvp_state: 'attending',
      },
    },
    rsvpWorkCompleted: true,
    errorMessage: JSON.stringify({
      outcome: 'mutation_result',
      requested_action: 'attending',
      requested_plus_one_response: null,
      verification: {
        verification_status: 'verified',
        gateway_status: 'responded',
        requested: { guest_id: 41, event_id: 205, action: 'attending', plus_one_response: null },
        observed: { guest_id: 41, event_id: 205, attendance: 'attending', source: 'fresh_read' },
        requested_attendance_change_verified: true,
        effect_applied: true,
        replayed: false,
        fresh_read: true,
      },
      next_action: 'communicate_confirmed_state',
    }),
  };
}

async function combinedRetentionSpec(): Promise<{ input: string; instructions: string }> {
  const { results, summaries } = await executeDiscovery({
    orders: [olderOrdersRecord()],
    gifts: [newerGiftRecord()],
  });
  const snapshot = assembleCustomerContext({
    execution: { results, summaries },
    identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
    currentContext: null,
    nowIso: NOW,
  });
  const customerContext = projectCustomerContext(snapshot, { focus: 'general' });
  const spec = await testRuntime().buildReplyRequestSpec(
    replyRequest(supportPlan(), {
      messageContext: campaignMessageContext(),
      customerContext,
      informationResults: [...results, kbFaqResult()],
      imageEvidence: {
        status: 'available',
        reason: 'decision-1-prior-single',
        captionPresent: false,
      },
      extraction: baseExtraction({
        requestedOperation: 'purchase.read',
        informationRequests: [
          {
            kind: 'purchase',
            resource: 'purchase_discovery',
            query: '¿Cuál es el estado de mis compras?',
            orderId: null,
            aspects: ['summary', 'shipping', 'payment_status'],
            sensitiveFields: [],
            authAction: 'none',
          },
          { kind: 'faq', query: 'horarios de atencion' },
        ],
      }),
      ...rsvpReceiptOverrides(),
    }),
  );
  return { input: spec.input, instructions: spec.instructions };
}

/** Strict retention assertions: each throws when its fact is absent. */
function expectOlderPurchaseRetained(input: string): void {
  const purchases = detailedPurchasesOf(input);
  const older = purchases.find((entry) => entry.orderId === 'ORD-OLDER-2021');
  if (!older) throw new Error('Older purchase ORD-OLDER-2021 missing.');
  expect(older.createdAt).toBe('2021-05-01 10:00:00');
  expect(older.amountDisclosure?.total).toBe(300);
}

function expectItemAmountRetained(input: string): void {
  const purchases = detailedPurchasesOf(input);
  const older = purchases.find((entry) => entry.orderId === 'ORD-OLDER-2021');
  if (!older) throw new Error('Older purchase missing for item check.');
  expectItemBinding(older.items, {
    giftName: 'Juego de sábanas', quantity: 2, amount: 150, rowTotal: 300,
    type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
  });
}

function expectCampaignAnchorRetained(input: string): void {
  expect(input).toContain('Boda Lucía y Marco, 10 de octubre');
  expect(input).toContain('admin_campaign');
  expect(input).toMatch(/"message_id":\s*7/);
  expect(input).toMatch(/"delivery":\s*"delivered"/);
}

function expectImageRefRetained(input: string): void {
  expect(input).toContain('image_evidence');
  expect(input).toContain('decision-1-prior-single');
}

function expectKbAnswerRetained(input: string): void {
  expect(input).toContain(KB_SCHEDULE_TEXT);
  expect(input).toContain('horarios-y-canales-de-atencion.md');
}

function expectRsvpReceiptRetained(input: string): void {
  expect(input).toContain('rsvp_completed_effect');
  expect(input).toContain('"verification_status": "verified"');
  expect(input).toContain('"requested_attendance_change_verified": true');
  expect(input).toContain('"fresh_read": true');
}

describe('decision 1 cross-lane retention in one serialized production input', () => {
  it('retains older purchase, item amount, campaign anchor, image ref, KB answer and RSVP receipt together', async () => {
    const { input, instructions } = await combinedRetentionSpec();
    expectOlderPurchaseRetained(input);
    expectItemAmountRetained(input);
    expectCampaignAnchorRetained(input);
    expectImageRefRetained(input);
    expectKbAnswerRetained(input);
    expectRsvpReceiptRetained(input);
    // Serialized size stays available for prompt-economy review.
    expect(input.length).toBeGreaterThan(0);
    expect(instructions.length).toBeGreaterThan(0);
  });
});

describe('decision 1 effect ledger: validated ids, single write, fresh read-back', () => {
  function readySnapshot(): ReturnType<typeof assembleCustomerContext> {
    return assembleCustomerContext({
      execution: {
        results: [{
          requestId: 'decision-1-ledger',
          kind: 'purchase',
          status: 'completed',
          resource: 'orders',
          lookupResource: 'orders',
          purchases: [olderOrdersRecord()],
          needsSelection: false,
          accessMethod: 'authenticated_account',
          coverage: 'complete',
        }],
        summaries: [{
          requestId: 'decision-1-ledger',
          kind: 'purchase',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'q',
          evidence: [],
          resultCount: 1,
          durationMs: 5,
        }],
      },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
  }

  it('validates mutation target ids without keyword inference', () => {
    expect(isValidMutationTargetId('ORD-OLDER-2021')).toBe(true);
    expect(isValidMutationTargetId(205)).toBe(true);
    expect(isValidMutationTargetId('  ')).toBe(false);
    expect(isValidMutationTargetId('')).toBe(false);
    expect(isValidMutationTargetId(null)).toBe(false);
    expect(isValidMutationTargetId(undefined)).toBe(false);
    expect(isValidMutationTargetId(0)).toBe(false);
    expect(isValidMutationTargetId(-3)).toBe(false);
    expect(isValidMutationTargetId(1.5)).toBe(false);
  });

  it('records a validated outcome once and rejects repeats and invalid targets', () => {
    const ready = readySnapshot();
    const outcome = {
      operation: 'rsvp.confirm',
      target: 'event:205:guest:41',
      receipt: 'confirmed' as const,
      observedAt: NOW,
      dedupeKey: 'decision-1:rsvp:205:41',
    };
    const recorded = recordValidatedActionOutcome(ready, outcome);
    expect(hasConfirmedOutcome(recorded, 'decision-1:rsvp:205:41')).toBe(true);
    // A repeat acknowledgement finds the confirmed receipt: no second write.
    const repeated = recordValidatedActionOutcome(recorded, outcome);
    expect(repeated.actionOutcomes.outcomes).toHaveLength(1);
    expect(repeated).toBe(recorded);
    // Invalid targets throw instead of recording an undeduplicatable receipt.
    expect(() => recordValidatedActionOutcome(ready, { ...outcome, operation: '  ' })).toThrow();
    expect(() => recordValidatedActionOutcome(ready, { ...outcome, target: '' })).toThrow();
    expect(() => recordValidatedActionOutcome(ready, { ...outcome, observedAt: '' })).toThrow();
    expect(() => recordValidatedActionOutcome(ready, { ...outcome, dedupeKey: null })).toThrow();
    expect(() => recordValidatedActionOutcome(ready, { ...outcome, dedupeKey: '  ' })).toThrow();
  });

  it('invalidates before reporting and restores through a fresh read-back', () => {
    const ready = readySnapshot();
    const invalidated = invalidateSectionAfterWrite(ready, 'purchases_carts');
    expect(invalidated.purchasesCarts.status).toBe('loading');
    expect(invalidated.purchasesCarts.purchases).toEqual([]);
    const recorded = recordValidatedActionOutcome(invalidated, {
      operation: 'rsvp.confirm',
      target: 'event:205:guest:41',
      receipt: 'confirmed' as const,
      observedAt: NOW,
      dedupeKey: 'decision-1:rsvp:205:41',
    });
    // A fresh authorized read-back restores the section with current facts.
    const restored = mergeExecutionIntoSnapshot({
      base: recorded,
      execution: {
        results: [{
          requestId: 'decision-1-reread',
          kind: 'purchase',
          status: 'completed',
          resource: 'orders',
          lookupResource: 'orders',
          purchases: [{ ...olderOrdersRecord(), paymentStatus: 'approved' }],
          needsSelection: false,
          accessMethod: 'authenticated_account',
          coverage: 'complete',
        }],
        summaries: [{
          requestId: 'decision-1-reread',
          kind: 'purchase',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'q',
          evidence: [],
          resultCount: 1,
          durationMs: 7,
        }],
      },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(restored.purchasesCarts.status).toBe('ready');
    expect(restored.purchasesCarts.purchases.map((entry) => entry.orderId)).toEqual(['ORD-OLDER-2021']);
    // The confirmed receipt survives the read-back: a repeat finds it and
    // implies no new action.
    expect(hasConfirmedOutcome(restored, 'decision-1:rsvp:205:41')).toBe(true);
    const rerecorded = recordValidatedActionOutcome(restored, {
      operation: 'rsvp.confirm',
      target: 'event:205:guest:41',
      receipt: 'confirmed' as const,
      observedAt: NOW,
      dedupeKey: 'decision-1:rsvp:205:41',
    });
    expect(rerecorded.actionOutcomes.outcomes).toHaveLength(1);
  });

  it('preserves the last known section when the fresh re-read fails', () => {
    const ready = readySnapshot();
    const preserved = mergeExecutionIntoSnapshot({
      base: ready,
      execution: {
        results: [{
          requestId: 'decision-1-reread-failed',
          kind: 'purchase',
          status: 'failed',
          retryable: true,
          failureKind: 'request_failed',
          message: 'boom',
        }],
        summaries: [{
          requestId: 'decision-1-reread-failed',
          kind: 'purchase',
          status: 'failed',
          source: 'agent_api',
          outcomeCode: 'request_failed',
          retryable: true,
          queryHash: 'q',
          evidence: [],
          resultCount: 0,
          durationMs: 3,
        }],
      },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    // A failed re-read never erases known data.
    expect(preserved.purchasesCarts.status).toBe('ready');
    expect(preserved.purchasesCarts.purchases.map((entry) => entry.orderId)).toEqual(['ORD-OLDER-2021']);
  });
});

describe('decision 1 negative controls fail when a retained fact is removed', () => {
  it('fails the older-purchase check when the older record is removed', async () => {
    const { input } = await combinedRetentionSpec();
    expectOlderPurchaseRetained(input);
    const { results, summaries } = await executeDiscovery({
      orders: [],
      gifts: [newerGiftRecord()],
    });
    const onlyNewer = results[0];
    if (!onlyNewer || onlyNewer.status !== 'completed' || onlyNewer.kind !== 'purchase') {
      throw new Error('Expected a newer-only completed result.');
    }
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext: projectCustomerContext(snapshot, { focus: 'general' }),
        informationResults: results,
      }),
    );
    expect(() => expectOlderPurchaseRetained(spec.input)).toThrow();
  });

  it('fails the item-amount binding when quantities or amounts are nulled', async () => {
    const { input } = await combinedRetentionSpec();
    expectItemAmountRetained(input);
    const purchases = detailedPurchasesOf(input);
    const older = purchases.find((entry) => entry.orderId === 'ORD-OLDER-2021');
    if (!older) throw new Error('Missing older purchase for mutation check.');
    const nulled = older.items.map((item) => ({ ...item, quantity: null, amount: null, rowTotal: null }));
    expect(() => expectItemBinding(nulled, {
      giftName: 'Juego de sábanas', quantity: 2, amount: 150, rowTotal: 300,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    })).toThrow();
    const swapped = older.items.map((item) => ({
      ...item,
      type: 'credit',
      fulfillment: { kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false } as const,
    }));
    expect(() => expectItemBinding(swapped, {
      giftName: 'Juego de sábanas', quantity: 2, amount: 150, rowTotal: 300,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    })).toThrow();
  });

  it('fails the campaign-anchor check when the campaign message is removed', async () => {
    const { input } = await combinedRetentionSpec();
    expectCampaignAnchorRetained(input);
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        messageContext: localTurnMessageContext('not_configured'),
        customerContext: projectCustomerContext(snapshot, { focus: 'general' }),
        informationResults: results,
      }),
    );
    expect(() => expectCampaignAnchorRetained(spec.input)).toThrow();
  });

  it('fails the image-ref check when image evidence is removed', async () => {
    const { input } = await combinedRetentionSpec();
    expectImageRefRetained(input);
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext: projectCustomerContext(snapshot, { focus: 'general' }),
        informationResults: results,
      }),
    );
    expect(() => expectImageRefRetained(spec.input)).toThrow();
  });

  it('fails the KB-answer check when the knowledge passage is removed', async () => {
    const { input } = await combinedRetentionSpec();
    expectKbAnswerRetained(input);
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext: projectCustomerContext(snapshot, { focus: 'general' }),
        informationResults: results,
      }),
    );
    expect(() => expectKbAnswerRetained(spec.input)).toThrow();
  });

  it('fails the RSVP-receipt check when the verified receipt is removed', async () => {
    const { input } = await combinedRetentionSpec();
    expectRsvpReceiptRetained(input);
    const { results, summaries } = await executeDiscovery({
      orders: [olderOrdersRecord()],
      gifts: [newerGiftRecord()],
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'decision-1-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext: projectCustomerContext(snapshot, { focus: 'general' }),
        informationResults: results,
      }),
    );
    expect(() => expectRsvpReceiptRetained(spec.input)).toThrow();
  });
});
