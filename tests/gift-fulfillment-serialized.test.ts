import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
import {
  HttpAgentConversationGateway,
  type AgentConversationGateway,
  type AgentConversationMessage,
  type AgentPurchaseLookupResult,
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
  projectCustomerContext,
} from '../src/runtime/customer-context';

const NOW = '2026-09-21T12:00:00.000Z';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    createEmptyPlan({ planId: 'gift-plan', channel: 'whatsapp', externalUserId: 'gift-user' }),
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
    userMessage: '¿Cuándo llega mi regalo?',
    messageContext: localTurnMessageContext('not_configured'),
    plan,
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'trace-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    ...overrides,
  } as unknown as ComposeReplyRequest;
}

type GiftWireItem = {
  gift_name: string | null;
  quantity: number | null;
  amount: number | null;
  row_total: number | null;
  type: string | null;
};

function giftWirePurchase(args: {
  id: string;
  paymentStatus: string | null;
  shippingStatus: string | null;
  items: GiftWireItem[];
  sendPhysical?: boolean | null;
  cardStatus?: string | null;
  total?: number;
}): Record<string, unknown> {
  return {
    id: args.id,
    increment_id: '100000901',
    payment_status: args.paymentStatus,
    shipping_status: args.shippingStatus,
    grand_total: args.total ?? 230,
    event_id: 9101,
    event_name: 'Boda Lucía y Marco',
    event_date: '2026-10-10',
    event_url: null,
    items: args.items,
    dedication: {
      message: 'Felicidades',
      is_private: false,
      send_physical: args.sendPhysical ?? false,
      physical_status: args.cardStatus ?? null,
    },
    created_at: '2026-09-01 11:00:00',
  };
}

function giftEnvelope(purchases: Record<string, unknown>[]): Record<string, unknown> {
  return {
    status: true,
    data: { purchases },
    errors: null,
    error: null,
  };
}

/** Parse the exact wire payload through the production gateway (stubbed fetch, no network). */
async function parseThroughGateway(
  purchases: Record<string, unknown>[],
): Promise<PurchaseInformation[]> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => giftEnvelope(purchases),
    text: async () => JSON.stringify(giftEnvelope(purchases)),
  });
  vi.stubGlobal('fetch', fetchMock);
  const gateway = new HttpAgentConversationGateway({
    baseUrl: 'https://api.example.test/api/agent',
    apiKey: 'secret-key',
    timeoutMs: 1_000,
    maxRetries: 0,
    messageLoggingEnabled: false,
  });
  const result = await gateway.getGiftPurchases({ token: 'user-jwt' });
  if (result.status !== 'success') {
    throw new Error('Expected gift purchase success.');
  }
  return result.purchases;
}

function mixedWireItems(): GiftWireItem[] {
  return [
    { gift_name: 'Juego de sábanas', quantity: 1, amount: 150, row_total: 150, type: 'se_store' },
    { gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' },
  ];
}

async function executeGiftTurn(args: {
  records: PurchaseInformation[];
  aspects: PurchaseAspect[];
  orderId?: string;
}): Promise<{ results: InformationTaskResult[]; summaries: InformationExecutionSummary[]; giftCalls: number }> {
  let giftCalls = 0;
  const lookupResult: AgentPurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: args.records,
  };
  const agentGateway = {
    async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
      giftCalls += 1;
      return lookupResult;
    },
  } as unknown as AgentConversationGateway;
  const orchestrator = new InformationOrchestrator({
    knowledgeGateway: {} as KnowledgeRetrievalGateway,
    providerGateway: {} as ProviderGateway,
    agentGateway,
  });
  const execution = await orchestrator.execute({
    requests: [{
      requestId: 'gift-shipping',
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Cuándo llega mi regalo?',
      orderId: args.orderId ?? 'gift-1',
      aspects: args.aspects,
      sensitiveFields: [],
      authAction: 'none',
    }],
    authentication: { token: 'test-token', email: 'test@example.com' },
    authBlock: null,
  });
  return { results: execution.results, summaries: execution.summaries, giftCalls };
}

function purchaseExtraction(aspects: PurchaseAspect[], orderId: string): ExtractionResult {
  return baseExtraction({
    informationRequests: [{
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Cuándo llega mi regalo?',
      orderId,
      aspects,
      sensitiveFields: [],
      authAction: 'none',
    }],
  });
}

const TURN_EVIDENCE_MARKER = 'Evidencia canónica del turno (JSON): ';

/**
 * Parses the canonical turn-evidence JSON block out of a serialized reply
 * input so binding assertions run against real parsed objects, not loose
 * substring occurrences.
 */
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

type ExpectedItemBinding = {
  giftName: string;
  quantity: number | null;
  amount: number | null;
  rowTotal: number | null;
  type: string | null;
  kind: string;
  chosenBy: string | null;
  giftShipmentApplicable: boolean | null;
};

function expectItemBinding(items: PurchaseItem[], expected: ExpectedItemBinding): void {
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

async function shippingSpecFor(args: {
  wireId: string;
  items: GiftWireItem[];
  aspects: PurchaseAspect[];
  paymentStatus?: string | null;
  shippingStatus?: string | null;
  total?: number;
}): Promise<{ input: string; instructions: string; moduleIds: string[]; giftCalls: number }> {
  const records = await parseThroughGateway([
    giftWirePurchase({
      id: args.wireId,
      paymentStatus: args.paymentStatus ?? 'approved',
      shippingStatus: args.shippingStatus ?? null,
      items: args.items,
      total: args.total,
    }),
  ]);
  const { results, summaries, giftCalls } = await executeGiftTurn({
    records,
    aspects: args.aspects,
    orderId: args.wireId,
  });
  const snapshot = assembleCustomerContext({
    execution: { results, summaries },
    identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
    currentContext: null,
    nowIso: NOW,
  });
  const customerContext = projectCustomerContext(snapshot, {
    focus: 'general',
    relevantOrderIds: [args.wireId],
  });
  const spec = await testRuntime().buildReplyRequestSpec(
    replyRequest(supportPlan(), {
      customerContext,
      informationResults: results,
      extraction: purchaseExtraction(args.aspects, args.wireId),
    }),
  );
  return {
    input: spec.input,
    instructions: spec.instructions,
    moduleIds: spec.modules.map((module) => module.id),
    giftCalls,
  };
}

const GIFT_INSTRUCTION_MARKER = 'cumplimiento de regalos';

describe('gift fulfillment serialized proof', () => {
  it.each([
    { aspects: ['shipping'] as PurchaseAspect[] },
    { aspects: ['summary'] as PurchaseAspect[] },
    { aspects: ['summary', 'shipping'] as PurchaseAspect[] },
  ])('binds mixed 150/80 name, quantity, amount, row total, type and fulfillment per item ($aspects)', async ({ aspects }) => {
    const { input, giftCalls } = await shippingSpecFor({
      wireId: 'gift-1',
      items: mixedWireItems(),
      aspects,
    });
    expect(giftCalls).toBe(1);

    const purchases = detailedPurchasesOf(input);
    expect(purchases).toHaveLength(1);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expectItemBinding(record.items, {
      giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    });
    expectItemBinding(record.items, {
      giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    expect(record.creditFulfillmentPolicy).toEqual({
      chosenBy: 'host',
      mechanism: 'host_account_credit',
    });
    // Currency stays unknown: never inferred from locale.
    expect(record.currency ?? null).toBeNull();
    expect(input).toContain('profile_ref');
    expect(input).not.toContain('credited');
  });

  it('keeps unit amount distinct from row total when quantity exceeds one', async () => {
    const { input } = await shippingSpecFor({
      wireId: 'gift-qty',
      items: [
        { gift_name: 'Juego de sábanas', quantity: 2, amount: 150, row_total: 300, type: 'se_store' },
        { gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' },
      ],
      aspects: ['shipping'],
      total: 380,
    });

    const purchases = detailedPurchasesOf(input);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expectItemBinding(record.items, {
      giftName: 'Juego de sábanas', quantity: 2, amount: 150, rowTotal: 300,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    });
    expectItemBinding(record.items, {
      giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    // Order-level totals travel only on summary/payment aspects; item-level
    // unit and row amounts are what shipping context must preserve.
    expect(record.amountDisclosure ?? null).toBeNull();
  });

  it('keeps physical relevance with missing shipping details for pure se_store and null status', async () => {
    const { input } = await shippingSpecFor({
      wireId: 'gift-2',
      items: [{ gift_name: 'Juego de sábanas', quantity: 1, amount: 150, row_total: 150, type: 'se_store' }],
      aspects: ['shipping'],
      total: 150,
    });

    const purchases = detailedPurchasesOf(input);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expectItemBinding(record.items, {
      giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    });
    expect(record.shippingStatus ?? null).toBeNull();
    expect(record.creditFulfillmentPolicy ?? null).toBeNull();
  });

  it('keeps host choice, no gift shipment and pending payment separate for pure credit', async () => {
    const { input } = await shippingSpecFor({
      wireId: 'gift-3',
      items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
      aspects: ['shipping', 'payment_status'],
      paymentStatus: 'pending',
      total: 80,
    });

    const purchases = detailedPurchasesOf(input);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expectItemBinding(record.items, {
      giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    expect(record.paymentStatus).toBe('pending');
    expect(record.creditFulfillmentPolicy).toEqual({
      chosenBy: 'host',
      mechanism: 'host_account_credit',
    });
    expect(input).not.toContain('credited');
  });

  it('keeps a physical dedication card separate from a credit gift', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-4',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
        sendPhysical: true,
        cardStatus: 'preparing',
        total: 80,
      }),
    ]);
    const { results, summaries } = await executeGiftTurn({
      records,
      aspects: ['shipping', 'dedication'],
      orderId: 'gift-4',
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-4'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
        extraction: purchaseExtraction(['shipping', 'dedication'], 'gift-4'),
      }),
    );

    const purchases = detailedPurchasesOf(spec.input);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expectItemBinding(record.items, {
      giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    expect(record.dedication?.sendPhysical).toBe(true);
    expect(record.dedication?.physicalStatus).toBe('preparing');
  });

  it('leaves unknown types unknown and never promotes a physical-sounding credit name', async () => {
    const { input } = await shippingSpecFor({
      wireId: 'gift-5',
      items: [
        { gift_name: 'Juego de ollas premium', quantity: 1, amount: 200, row_total: 200, type: 'credit' },
        { gift_name: 'Regalo misterioso', quantity: 1, amount: 50, row_total: 50, type: null },
      ],
      aspects: ['shipping'],
      total: 250,
    });

    const purchases = detailedPurchasesOf(input);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expectItemBinding(record.items, {
      giftName: 'Juego de ollas premium', quantity: 1, amount: 200, rowTotal: 200,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    expectItemBinding(record.items, {
      giftName: 'Regalo misterioso', quantity: 1, amount: 50, rowTotal: 50,
      type: null, kind: 'unknown', chosenBy: null, giftShipmentApplicable: null,
    });
  });

  it('projects an item-source conflict with both complete alternatives and no authoritative list', async () => {
    const seStoreRecords = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-conflict',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'se_store' }],
        total: 80,
      }),
    ]);
    const creditRecords = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-conflict',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
        total: 80,
      }),
    ]);
    const first = await executeGiftTurn({ records: seStoreRecords, aspects: ['shipping'], orderId: 'gift-conflict' });
    const second = await executeGiftTurn({ records: creditRecords, aspects: ['shipping'], orderId: 'gift-conflict' });
    const snapshot = assembleCustomerContext({
      execution: {
        results: [...first.results, ...second.results],
        summaries: [...first.summaries, ...second.summaries],
      },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-conflict'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: [...first.results, ...second.results],
        extraction: purchaseExtraction(['shipping'], 'gift-conflict'),
      }),
    );

    const purchases = detailedPurchasesOf(spec.input);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expect(record.items).toHaveLength(0);
    expect(record.creditFulfillmentPolicy ?? null).toBeNull();
    const conflict = record.itemSourceConflict;
    expect(conflict).toBeDefined();
    expect(conflict?.truncated).toBe(false);
    expect(conflict?.alternatives).toHaveLength(2);
    const kinds = (conflict?.alternatives ?? []).map(
      (alternative) => alternative.items[0]?.fulfillment?.kind ?? null,
    ).sort();
    expect(kinds).toEqual(['host_credit', 'physical']);
    for (const alternative of conflict?.alternatives ?? []) {
      // This token-auth read path carries no accessMethod; provenance stays
      // null rather than invented. Phone-scoped reads populate it (l4).
      expect(alternative.accessMethod).toBeNull();
      expect(alternative.items).toHaveLength(1);
      expect(alternative.items[0]?.amount).toBe(80);
    }
    // A conflicted turn still selects gift presentation guidance.
    expect(spec.modules.map((module) => module.id)).toContain('reply_gift_fulfillment');
    expect(spec.instructions).toContain(GIFT_INSTRUCTION_MARKER);
  });
});

describe('gift instruction scoping and mutation controls', () => {
  it('selects gift guidance for physical, credit and mixed turns but not for unrelated turns', async () => {
    const giftTurns = [
      {
        spec: await shippingSpecFor({
          wireId: 'gift-inst-1',
          items: [{ gift_name: 'Juego de sábanas', quantity: 1, amount: 150, row_total: 150, type: 'se_store' }],
          aspects: ['shipping'],
          total: 150,
        }),
        evidence: 'se_store',
      },
      {
        spec: await shippingSpecFor({
          wireId: 'gift-inst-2',
          items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
          aspects: ['shipping'],
          total: 80,
        }),
        evidence: '"kind": "host_credit"',
      },
      {
        spec: await shippingSpecFor({ wireId: 'gift-inst-3', items: mixedWireItems(), aspects: ['shipping'] }),
        evidence: 'host_account_credit',
      },
    ];
    for (const turn of giftTurns) {
      expect(turn.spec.moduleIds).toContain('reply_gift_fulfillment');
      expect(turn.spec.instructions).toContain(GIFT_INSTRUCTION_MARKER);
      // Codes stay in the input evidence; the instruction only guides prose.
      expect(turn.spec.input).toContain(turn.evidence);
    }

    const faqSpec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        userMessage: '¿Cuál es la política de devoluciones?',
        extraction: baseExtraction({
          informationRequests: [{ kind: 'faq', query: 'política de devoluciones' }],
        }),
        informationResults: [{
          requestId: 'faq-1',
          kind: 'faq',
          status: 'completed',
          query: 'política de devoluciones',
          evidence: [{ fileId: 'file-1', filename: 'policy.md', score: 0.9, text: 'Devolución disponible dentro de 7 días' }],
        }],
      }),
    );
    expect(faqSpec.modules.map((module) => module.id)).not.toContain('reply_gift_fulfillment');
    expect(faqSpec.instructions).not.toContain(GIFT_INSTRUCTION_MARKER);

    const rsvpSpec = await testRuntime().buildReplyRequestSpec(
      replyRequest(
        mergePlan(supportPlan(), { current_node: 'responder_invitacion' }) as PersistedPlan,
        {
          currentNode: 'responder_invitacion',
          userMessage: 'Sí confirmo mi asistencia',
          extraction: baseExtraction({
            actionIntent: 'responder_invitacion',
            rsvpAction: 'attending',
            rsvpEventReference: 'Boda Lucía y Marco',
            rsvpDecisionSource: 'current_message',
          }),
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
        },
      ),
    );
    expect(rsvpSpec.modules.map((module) => module.id)).toContain('reply_rsvp_facts');
    expect(rsvpSpec.modules.map((module) => module.id)).not.toContain('reply_gift_fulfillment');
    expect(rsvpSpec.instructions).not.toContain(GIFT_INSTRUCTION_MARKER);

    const paymentOnly = await shippingSpecFor({
      wireId: 'gift-inst-4',
      items: mixedWireItems(),
      aspects: ['payment_status'],
    });
    expect(paymentOnly.moduleIds).not.toContain('reply_gift_fulfillment');
    expect(paymentOnly.instructions).not.toContain(GIFT_INSTRUCTION_MARKER);
  });

  it('carries credit meaning together with payment state when the question needs both', async () => {
    const { input, instructions, moduleIds } = await shippingSpecFor({
      wireId: 'gift-inst-5',
      items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
      aspects: ['shipping', 'payment_status'],
      paymentStatus: 'pending',
      total: 80,
    });

    const purchases = detailedPurchasesOf(input);
    const record = purchases[0];
    if (!record) throw new Error('Missing parsed purchase.');
    expect(record.paymentStatus).toBe('pending');
    expectItemBinding(record.items, {
      giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    expect(moduleIds).toContain('reply_gift_fulfillment');
    expect(instructions).toContain(GIFT_INSTRUCTION_MARKER);
  });

  it('fails binding checks against mutated evidence instead of passing vacuously', async () => {
    const { input } = await shippingSpecFor({
      wireId: 'gift-mut',
      items: mixedWireItems(),
      aspects: ['shipping'],
    });
    const record = detailedPurchasesOf(input)[0];
    if (!record) throw new Error('Missing parsed purchase.');
    const sheetsBinding = {
      giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    } as const;

    // Swapped fulfillment mappings: sheets classified as credit must fail.
    const swapped = record.items.map((item) => item.giftName === 'Juego de sábanas'
      ? { ...item, type: 'credit' as const, fulfillment: { kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false } as const }
      : item);
    expect(() => expectItemBinding(swapped, { ...sheetsBinding })).toThrow();

    // Nulled known amounts: the recorded 150 must fail against nulls.
    const nulled = record.items.map((item) => item.giftName === 'Juego de sábanas'
      ? { ...item, quantity: null, amount: null, rowTotal: null }
      : item);
    expect(() => expectItemBinding(nulled, { ...sheetsBinding })).toThrow();

    // Pending turned posted: a pending-state check must fail on approved.
    const pendingSpec = await shippingSpecFor({
      wireId: 'gift-mut-pending',
      items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
      aspects: ['shipping', 'payment_status'],
      paymentStatus: 'pending',
      total: 80,
    });
    const pendingRecord = detailedPurchasesOf(pendingSpec.input)[0];
    if (!pendingRecord) throw new Error('Missing parsed pending purchase.');
    const expectPending = (status: string | null): void => {
      expect(status).toBe('pending');
    };
    expectPending(pendingRecord.paymentStatus);
    expect(() => expectPending('approved')).toThrow();

    // Erased conflict: a single authoritative list must fail conflict checks.
    const { itemSourceConflict, ...withoutConflict } = record;
    expect(itemSourceConflict ?? null).toBeNull();
    expect('itemSourceConflict' in withoutConflict).toBe(false);
    expect(() => expect(withoutConflict).toHaveProperty('itemSourceConflict')).toThrow();
  });

  it('fails the card/gift separation check when the card collapses into shipment', async () => {
    const records = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-mut-card',
        paymentStatus: 'approved',
        shippingStatus: 'enroute',
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
        sendPhysical: false,
        cardStatus: null,
        total: 80,
      }),
    ]);
    const { results, summaries } = await executeGiftTurn({
      records,
      aspects: ['shipping', 'dedication'],
      orderId: 'gift-mut-card',
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['gift-mut-card'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
        extraction: purchaseExtraction(['shipping', 'dedication'], 'gift-mut-card'),
      }),
    );
    const record = detailedPurchasesOf(spec.input)[0];
    if (!record) throw new Error('Missing parsed purchase.');
    // The credit item keeps no-shipment semantics even with an order-level
    // shipment state; a collapsed reading claiming product shipment fails.
    expect(record.items[0]?.fulfillment?.giftShipmentApplicable).toBe(false);
    expect(() => expect(record.items[0]?.fulfillment?.giftShipmentApplicable).toBe(true)).toThrow();
    expect(record.dedication?.sendPhysical ?? null).not.toBe(true);
  });
});

describe('campaign reference survival under note suppression', () => {
  it('keeps the campaign body in reply history when a typed image outcome suppresses the note', async () => {
    const campaignBody = 'Recordatorio: Boda Lucía y Marco, 10 de octubre. Confirma tu asistencia.';
    const messageContext = buildTurnMessageContext({
      messages: [{
        id: 7,
        direction: 'outbound',
        source: 'admin_campaign',
        body: campaignBody,
        status: 'delivered',
        whatsappMessageId: null,
        sentAt: '2026-09-20T10:00:00.000Z',
        createdAt: '2026-09-20T10:00:00.000Z',
      } satisfies AgentConversationMessage],
      inbound: {
        channel: 'whatsapp',
        externalUserId: 'gift-user',
        text: '¿A qué hora es?',
        messageId: 'inbound-1',
        receivedAt: NOW,
        contactPhone: '+51900000001',
      },
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        userMessage: '¿A qué hora es?',
        messageContext,
        extraction: baseExtraction({
          informationRequests: [{ kind: 'associated_event', query: '¿A qué hora es?', eventHint: null }],
        }),
        informationResults: [{
          requestId: 'event-1',
          kind: 'associated_event',
          status: 'completed',
          query: '¿A qué hora es?',
          accessMethod: 'trusted_phone_guest',
          result: {
            events: [{
              eventId: 88,
              name: 'Boda Lucía y Marco',
              slug: 'boda-lucia-marco',
              url: null,
              datetime: '10/10/2026 18:00',
              type: 'wedding',
              typeDetail: null,
              stage: 'published',
              city: 'Lima',
              country: 'Perú',
              currency: 'PEN',
            }],
          },
        }],
        imageEvidence: {
          status: 'available',
          reason: 'prior_single',
          captionPresent: false,
        },
        errorMessage: 'OPERATIONAL_NOTE_CAMPAIGN_SENTINEL',
      }),
    );

    // The typed image outcome suppresses the operational note...
    expect(spec.input).not.toContain('OPERATIONAL_NOTE_CAMPAIGN_SENTINEL');
    // ...but the campaign body, identity and delivery survive through the
    // reply history section (moved into typed history projection rather
    // than a suppression exemption).
    expect(spec.input).toContain('Boda Lucía y Marco, 10 de octubre');
    expect(spec.input).toContain('admin_campaign');
    expect(spec.input).toMatch(/"message_id":\s*7/);
    expect(spec.input).toMatch(/"delivery":\s*"delivered"/);
  });
});

describe('source discovery mixed gift shipping', () => {
  async function executeDiscoveryTurn(args: {
    orders: PurchaseInformation[];
    gifts: PurchaseInformation[];
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
        return { status: 'success', resource: 'orders', purchases: args.orders };
      },
      async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
        giftCalls += 1;
        return { status: 'success', resource: 'gift_purchases', purchases: args.gifts };
      },
    } as unknown as AgentConversationGateway;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {} as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'discovery-shipping',
        kind: 'purchase',
        resource: 'purchase_discovery',
        query: '¿Cuándo llega mi regalo?',
        orderId: null,
        aspects: ['summary', 'shipping'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: { token: 'test-token', email: 'test@example.com' },
      authBlock: null,
    });
    return { results: execution.results, summaries: execution.summaries, ordersCalls, giftCalls };
  }

  function ordersShippingRecord(): PurchaseInformation {
    return {
      orderId: 'ORD-DISC-9',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 150,
      paymentMethod: 'Transferencia',
      currency: 'PEN',
      eventName: 'Boda Lucía y Marco',
      eventDate: '2026-10-10',
      eventUrl: null,
      createdAt: '2026-09-01 11:00:00',
      items: [{ giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150, type: 'se_store' }],
    };
  }

  async function discoveryShippingSpec(): Promise<{ input: string; ordersCalls: number; giftCalls: number }> {
    const gifts = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-disc-9',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
        total: 80,
      }),
    ]);
    const { results, summaries, ordersCalls, giftCalls } = await executeDiscoveryTurn({
      orders: [ordersShippingRecord()],
      gifts,
    });
    const snapshot = assembleCustomerContext({
      execution: { results, summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['ORD-DISC-9', 'gift-disc-9'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: results,
        extraction: baseExtraction({
          requestedOperation: 'purchase.read',
          informationRequests: [{
            kind: 'purchase',
            resource: 'purchase_discovery',
            query: '¿Cuándo llega mi regalo?',
            orderId: null,
            aspects: ['summary', 'shipping'],
            sensitiveFields: [],
            authAction: 'none',
          }],
        }),
      }),
    );
    return { input: spec.input, ordersCalls, giftCalls };
  }

  // Row 1 at the production serialized boundary: unresolved source discovers
  // both roots once each and both 150/80 facts reach spec.input.
  it('discovers both roots and binds 150/80 facts in spec.input', async () => {
    const { input, ordersCalls, giftCalls } = await discoveryShippingSpec();
    expect(ordersCalls).toBe(1);
    expect(giftCalls).toBe(1);

    const purchases = detailedPurchasesOf(input);
    expect(purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['ORD-DISC-9', 'gift-disc-9'],
    );
    const ordersRecord = purchases.find((purchase) => purchase.orderId === 'ORD-DISC-9');
    const giftRecord = purchases.find((purchase) => purchase.orderId === 'gift-disc-9');
    if (!ordersRecord || !giftRecord) throw new Error('Missing discovered purchases.');
    expectItemBinding(ordersRecord.items, {
      giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150,
      type: 'se_store', kind: 'physical', chosenBy: null, giftShipmentApplicable: true,
    });
    expectItemBinding(giftRecord.items, {
      giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80,
      type: 'credit', kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false,
    });
    // No account-wide absence claim anywhere in the serialized input.
    expect(input).not.toContain('No encontré compras coincidentes');
    expect(input).not.toContain('No encontré esa orden');
  });

  // Negative control: the same mixed setup with the resource forced to orders
  // must NOT surface gift facts (proves the proof is source-sensitive).
  it('forced orders never surfaces gift facts in spec.input', async () => {
    const gifts = await parseThroughGateway([
      giftWirePurchase({
        id: 'gift-disc-9',
        paymentStatus: 'approved',
        shippingStatus: null,
        items: [{ gift_name: 'Aporte luna de miel', quantity: 1, amount: 80, row_total: 80, type: 'credit' }],
        total: 80,
      }),
    ]);
    void gifts;
    let giftCalls = 0;
    const agentGateway = {
      async getOrders(): Promise<AgentPurchaseLookupResult> {
        return { status: 'success', resource: 'orders', purchases: [ordersShippingRecord()] };
      },
      async getGiftPurchases(): Promise<AgentPurchaseLookupResult> {
        giftCalls += 1;
        throw new Error('forced orders must not read gifts');
      },
    } as unknown as AgentConversationGateway;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {} as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway,
    });
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'forced-orders',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuándo llega mi regalo?',
        orderId: null,
        aspects: ['summary', 'shipping'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: { token: 'test-token', email: 'test@example.com' },
      authBlock: null,
    });
    expect(giftCalls).toBe(0);
    const snapshot = assembleCustomerContext({
      execution: { results: execution.results, summaries: execution.summaries },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantOrderIds: ['ORD-DISC-9'],
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: execution.results,
      }),
    );
    const purchases = detailedPurchasesOf(spec.input);
    expect(purchases.map((purchase) => purchase.orderId)).toEqual(['ORD-DISC-9']);
    expect(JSON.stringify(purchases)).not.toContain('Aporte luna de miel');
  });
});

describe('reply evidence Lane B proofs (selection, parity, availability, continuity)', () => {
  function olderApproved(): PurchaseInformation {
    return {
      orderId: 'ORD-OLDER',
      paymentStatus: 'approved',
      shippingStatus: null,
      // Projected-away shape: the trusted total travels in the disclosure
      // while the direct field stays null.
      grandTotal: null,
      paymentMethod: null,
      eventName: 'Aniversario Lucia',
      eventDate: '2025-06-14',
      eventUrl: null,
      createdAt: '2025-06-01 10:00:00',
      items: [{
        giftName: 'Juego de sábanas',
        quantity: 1,
        amount: 150,
        rowTotal: 150,
        type: 'se_store',
        fulfillment: { kind: 'physical', chosenBy: null, giftShipmentApplicable: true },
      }],
      amountDisclosure: {
        total: 88.18,
        paid: null,
        currency: null,
        currencySymbol: null,
        paymentMethod: null,
        presentation: 'recorded_method_no_currency',
      },
      currency: null,
    };
  }

  function newerPending(): PurchaseInformation {
    return {
      orderId: 'ORD-NEWER',
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 80,
      paymentMethod: 'Yape',
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
        fulfillment: { kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false },
      }],
      amountDisclosure: {
        total: 80,
        paid: null,
        currency: null,
        currencySymbol: null,
        paymentMethod: 'Yape',
        presentation: 'recorded_method_no_currency',
      },
      currency: null,
    };
  }

  function twoCandidateResult(overrides: {
    needsSelection: boolean;
    referenceResolution?: 'unavailable';
    requestedCustomerTransactionNumber?: string;
  }): InformationTaskResult {
    return {
      requestId: 'explicit-olderlanes',
      kind: 'purchase',
      status: 'completed',
      resource: 'gift_purchases',
      purchases: [olderApproved(), newerPending()],
      carts: [],
      needsSelection: overrides.needsSelection,
      coverage: 'complete',
      ...(overrides.referenceResolution !== undefined
        ? { referenceResolution: overrides.referenceResolution }
        : {}),
      ...(overrides.requestedCustomerTransactionNumber !== undefined
        ? { requestedCustomerTransactionNumber: overrides.requestedCustomerTransactionNumber }
        : {}),
    } as InformationTaskResult;
  }

  function explicitOlderExtraction(): ExtractionResult {
    return baseExtraction({
      informationRequests: [{
        kind: 'purchase',
        resource: 'gift_purchases',
        query: 'Consulta por Aniversario Lucia. Ese pedido sigue pendiente?',
        orderId: null,
        eventHint: 'Aniversario Lucia',
        aspects: ['summary', 'payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
    });
  }

  it('retains both named events with no selection compulsion on multiplicity alone', async () => {
    const result = twoCandidateResult({ needsSelection: false });
    const snapshot = assembleCustomerContext({
      execution: {
        results: [result],
        summaries: [{
          requestId: 'explicit-olderlanes',
          kind: 'purchase',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'lane-b-selection',
          evidence: [],
          resultCount: 2,
          durationMs: 1,
        }],
      },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, { focus: 'general' });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        userMessage: 'Consulta por Aniversario Lucia. Ese pedido sigue pendiente?',
        extraction: explicitOlderExtraction(),
        customerContext,
        informationResults: [result],
      }),
    );
    const evidence = extractTurnEvidence(spec.input);
    const results = evidence.information_results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    const projected = results[0] as {
      outcome_kind: string;
      permitted_next_action: string;
      missing_inputs: string[];
      outcome: { recordType: string };
    };
    // Both authorized facts stay visible for read reasoning.
    expect(spec.input).toContain('ORD-OLDER');
    expect(spec.input).toContain('ORD-NEWER');
    expect(spec.input).toContain('Aniversario Lucia');
    // Multiplicity alone never compels a selection question.
    expect(projected.outcome_kind).not.toBe('selection');
    expect(projected.permitted_next_action).not.toBe('select_purchase');
    expect(projected.missing_inputs ?? []).not.toContain('purchase_selection');
    expect(spec.input).not.toContain('purchase_selection');
  });

  it('genuine unresolved reference still compels a distinction (negative control)', async () => {
    const result = twoCandidateResult({
      needsSelection: true,
      referenceResolution: 'unavailable',
      requestedCustomerTransactionNumber: 'COD-missing',
    });
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        extraction: explicitOlderExtraction(),
        informationResults: [result],
      }),
    );
    const evidence = extractTurnEvidence(spec.input);
    const results = evidence.information_results as Array<Record<string, unknown>>;
    const projected = results[0] as {
      outcome_kind: string;
      permitted_next_action: string;
      missing_inputs: string[];
    };
    // An explicit validated-reference mismatch still requires asking.
    expect(projected.outcome_kind).toBe('selection');
    expect(projected.permitted_next_action).toBe('select_purchase');
    expect(projected.missing_inputs ?? []).toContain('purchase_selection');
  });

  it('canonical record parity keeps coherent totals, status, single item facts and no settlement relabeling', async () => {
    const result = twoCandidateResult({ needsSelection: false });
    const snapshot = assembleCustomerContext({
      execution: {
        results: [result],
        summaries: [{
          requestId: 'explicit-olderlanes',
          kind: 'purchase',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'lane-b-parity',
          evidence: [],
          resultCount: 2,
          durationMs: 1,
        }],
      },
      identity: { customerRef: 'gift-user', scope: 'account', source: 'authenticated_account' },
      currentContext: null,
      nowIso: NOW,
    });
    const projection = projectCustomerContext(snapshot, { focus: 'general' });
    const olderSummary = projection.purchases.find((entry) => entry.orderId === 'ORD-OLDER');
    if (!olderSummary) throw new Error('Missing older summary.');
    // A known total projected into the disclosure stays coherent: the
    // summary never pairs an available total with a null grand total.
    expect(olderSummary.totalAvailability).toBe('available');
    expect(olderSummary.grandTotal).toBe(88.18);
    // Known payment status is preserved, never masked to null.
    expect(olderSummary.paymentStatus).toBe('approved');
    const candidateStates = new Map(
      projection.candidates
        .filter((candidate) => candidate.kind === 'order' && candidate.orderId !== undefined)
        .map((candidate) => [candidate.orderId as string, candidate.state]),
    );
    expect(candidateStates.get('ORD-OLDER')).toBe('approved');
    expect(candidateStates.get('ORD-NEWER')).toBe('pending');
    // Item facts live once in the complete record body, never in the
    // compact summaries or the candidate index.
    expect(JSON.stringify(projection.purchases)).not.toContain('Juego de sábanas');
    expect(JSON.stringify(projection.candidates)).not.toContain('Juego de sábanas');
    const bodies = JSON.stringify(projection.detailedPurchases);
    expect(bodies.split('Juego de sábanas')).toHaveLength(2);
    // Host choice and fulfillment meaning stay; an approved payment is
    // never relabeled as posted funds or an available withdrawal.
    expect(bodies).toContain('"chosenBy":"host"');
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('posted');
    expect(serialized).not.toContain('publicado');
    expect(serialized).not.toContain('fondos disponibles');
  });

  it('exposes handoff availability with missing prerequisites and never claims unavailable help', async () => {
    const { buildRuntimeCapabilityManifest } = await import('../src/runtime/capability-manifest');
    const available = buildRuntimeCapabilityManifest({ featureFlags: { humanTakeover: true } });
    const runtime = testRuntime().withCapabilityManifest(available);
    const result = twoCandidateResult({ needsSelection: false });
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan({ contact_phone: null }), {
        extraction: explicitOlderExtraction(),
        informationResults: [result],
      }),
    );
    const evidence = extractTurnEvidence(spec.input);
    const availability = evidence.support_availability as
      | { handoff_available?: unknown; missing_prerequisite?: unknown }
      | undefined;
    expect(availability?.handoff_available).toBe(true);
    expect(availability?.missing_prerequisite).toBe('contact_phone');
    expect(evidence.handoff_outcome ?? null).toBeNull();

    const blocked = buildRuntimeCapabilityManifest({
      featureFlags: { humanTakeover: false },
    });
    const blockedSpec = await testRuntime().withCapabilityManifest(blocked).buildReplyRequestSpec(
      replyRequest(supportPlan({ contact_phone: '+51900000111' }), {
        extraction: explicitOlderExtraction(),
        informationResults: [result],
      }),
    );
    const blockedEvidence = extractTurnEvidence(blockedSpec.input);
    const blockedAvailability = blockedEvidence.support_availability as
      | { handoff_available?: unknown }
      | undefined;
    expect(blockedAvailability?.handoff_available).toBe(false);
    expect(blockedSpec.input).not.toContain('"handoff_available": true');
  });

  it('fresh purchase turn carries no prior-answer fact and no continuity directive', async () => {
    const result = twoCandidateResult({ needsSelection: false });
    // The reply-time plan already persists this turn's completed lookup,
    // while the history stays empty: a fresh question, not a continuation.
    const freshPlan = mergePlan(supportPlan(), {
      information_state: {
        resume_node: 'resolver_consultas_informativas',
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: {
          kind: 'purchase',
          resource: 'gift_purchases',
          query: '¿Cuándo llega mi regalo?',
          orderId: null,
          aspects: ['summary', 'payment_status'],
          sensitiveFields: [],
          authAction: 'none',
        },
      },
    }) as PersistedPlan;
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(freshPlan, {
        userMessage: '¿Cuándo llega mi regalo?',
        extraction: explicitOlderExtraction(),
        informationResults: [result],
      }),
    );
    expect(spec.input).not.toContain('continuity_has_prior_answer');
    expect(spec.modules.map((module) => module.id)).not.toContain('reply_support_continuity');
    expect(spec.instructions).not.toContain('La persona aportó un dato o reportó una situación');
  });

  it('real delivered history retains continuity facts and the continuity module', async () => {
    const { buildTurnMessageContext } = await import('../src/runtime/turn-message-context');
    const result = twoCandidateResult({ needsSelection: false });
    const messageContext = buildTurnMessageContext({
      messages: [
        {
          id: 1,
          direction: 'inbound',
          source: 'user',
          body: '¿Cuándo llega mi regalo?',
          status: 'delivered',
          whatsappMessageId: null,
          sentAt: '2026-09-21T11:00:00.000Z',
          createdAt: '2026-09-21T11:00:00.000Z',
        },
        {
          id: 2,
          direction: 'outbound',
          source: 'agent',
          body: 'Tu regalo viene en camino.',
          status: 'delivered',
          whatsappMessageId: null,
          sentAt: '2026-09-21T11:01:00.000Z',
          createdAt: '2026-09-21T11:01:00.000Z',
        },
      ],
      inbound: {
        channel: 'whatsapp',
        externalUserId: 'gift-user',
        text: '¿Y el otro?',
        messageId: 'gift-continued-1',
        receivedAt: '2026-09-21T12:00:00.000Z',
      },
    });
    const continuedPlan = mergePlan(supportPlan(), {
      owner_pending_question: '¿A cuál de los dos regalos te refieres?',
    }) as PersistedPlan;
    const spec = await testRuntime().buildReplyRequestSpec(
      replyRequest(continuedPlan, {
        userMessage: '¿Y el otro?',
        messageContext,
        extraction: explicitOlderExtraction(),
        informationResults: [result],
      }),
    );
    expect(spec.input).toContain('continuity_has_prior_answer');
    expect(spec.modules.map((module) => module.id)).toContain('reply_support_continuity');
  });

  it('faq and support bundles exclude gift and planning guidance', async () => {
    const faqSpec = await testRuntime().buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        userMessage: '¿Cuál es la política de devoluciones?',
        extraction: baseExtraction({
          informationRequests: [{ kind: 'faq', query: 'política de devoluciones' }],
        }),
        informationResults: [{
          requestId: 'faq-laneb',
          kind: 'faq',
          status: 'completed',
          query: 'política de devoluciones',
          evidence: [{ fileId: 'file-1', filename: 'policy.md', score: 0.9, text: 'Devolución disponible dentro de 7 días' }],
        }],
      }),
    );
    const faqModules = faqSpec.modules.map((module) => module.id);
    expect(faqModules).not.toContain('reply_gift_fulfillment');
    expect(faqModules).not.toContain('reply_planning_owner');
    expect(faqSpec.instructions).not.toContain('cumplimiento de regalos');
    expect(faqSpec.instructions).not.toContain('Categorías de proveedores disponibles');
    // A first-turn FAQ carries no continuation directive either.
    expect(faqModules).not.toContain('reply_support_continuity');
  });
});
