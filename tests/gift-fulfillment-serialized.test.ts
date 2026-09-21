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
