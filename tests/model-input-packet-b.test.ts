import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import { normalizeInboundImage } from '../src/core/inbound-image';
import type {
  InformationTaskResult,
  PurchaseInformation,
} from '../src/core/information';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractionResult,
} from '../src/runtime/contracts';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { AgentService } from '../src/runtime/agent-service';
import type { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { fixtureCustomerContextOrchestrator } from './customer-context-test-utils';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import {
  assembleCustomerContext,
  projectCustomerContext,
} from '../src/runtime/customer-context';

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
    createEmptyPlan({ planId: 'packet-b-plan', channel: 'whatsapp', externalUserId: 'packet-b-user' }),
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

function luisPurchase(): PurchaseInformation {
  return {
    orderId: 'ORD-LUIS-389',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 227.76,
    paymentMethod: 'Yape o Plin',
    currency: 'PEN',
    eventName: 'Alejandra',
    eventDate: '2026-09-20',
    eventUrl: null,
    createdAt: '2026-08-27 15:00:00',
    items: [],
    payment: {
      method: 'Yape o Plin',
      amount: 13.76,
      paidAt: null,
      transactionStatus: 'PENDING',
      operationCode: 'OP-LUIS-389',
    },
  };
}

function luisResult(): InformationTaskResult {
  return {
    requestId: 'information-1',
    kind: 'purchase',
    status: 'completed',
    resource: 'orders',
    lookupResource: 'orders',
    purchases: [luisPurchase()],
    carts: [],
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
  };
}

function creditPurchase(): PurchaseInformation {
  return {
    orderId: 'GIFT-CREDIT-1',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: null,
    paymentMethod: null,
    currency: null,
    eventName: 'Boda Lucía y Marco',
    eventDate: '2026-10-10',
    eventUrl: null,
    createdAt: '2026-09-01 11:00:00',
    items: [{
      giftName: 'Aporte luna de miel',
      quantity: 1,
      amount: 120,
      rowTotal: 120,
      type: 'credit',
      fulfillment: { kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false },
    }],
    creditFulfillmentPolicy: { chosenBy: 'host', mechanism: 'host_account_credit' },
    dedication: {
      message: 'Tarjeta para la celebración',
      isPrivate: false,
      sendPhysical: true,
      physicalStatus: 'preparing',
    },
  };
}

function creditResult(): InformationTaskResult {
  return {
    requestId: 'information-1',
    kind: 'purchase',
    status: 'completed',
    resource: 'gift_purchases',
    lookupResource: 'gift_purchases',
    purchases: [creditPurchase()],
    carts: [],
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
  };
}

function purchaseExtraction(): ExtractionResult {
  return baseExtraction({
    requestedOperation: 'purchase.read',
    informationRequests: [{
      kind: 'purchase',
      resource: 'purchase_discovery',
      query: 'Cuanto me falta?',
      orderId: null,
      authAction: 'none',
      eventHint: 'Alejandra',
    }],
  });
}

function replyRequest(args: {
  plan: PersistedPlan;
  extraction: ExtractionResult;
  informationResults: InformationTaskResult[];
  withProfile: boolean;
}): ComposeReplyRequest {
  const profile = args.withProfile
    ? projectCustomerContext(
      assembleCustomerContext({
        execution: { results: args.informationResults, summaries: [] },
        identity: { customerRef: 'packet-b', source: 'test', scope: 'test', fetchedAt: '2026-09-22T00:00:00.000Z' },
        currentContext: null,
        nowIso: '2026-09-22T00:00:00.000Z',
      }))
    : null;
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'contacto_inicial',
    userMessage: 'Cuanto me falta?',
    messageContext: localTurnMessageContext('not_configured'),
    plan: args.plan,
    extraction: args.extraction,
    missingFields: [],
    searchReady: false,
    providerResults: [],
    turnDecision: null,
    informationResults: args.informationResults,
    customerContext: profile,
    toolUsage: { considered: [], inputs: [], outputs: [] },
  } as unknown as ComposeReplyRequest;
}

describe('Packet B model input and continuity', () => {
  it('loads support continuity only once the prior answer exists', async () => {
    const fresh = await testRuntime().buildReplyRequestSpec(replyRequest({
      plan: supportPlan(),
      extraction: purchaseExtraction(),
      informationResults: [luisResult()],
      withProfile: true,
    }));
    const freshIds = fresh.modules.map((module) => module.id);
    expect(freshIds).toContain('shared_invariants');
    expect(freshIds).not.toContain('reply_support_continuity');
    expect(freshIds).not.toContain('reply_planning_owner');
    expect(freshIds).not.toContain('reply_gift_fulfillment');
    // Stable static cache prefix: shared invariants first.
    expect(freshIds[0]).toBe('shared_invariants');
    expect(fresh.scopedTools).toEqual([]);

    const continued = supportPlan({
      last_outbound_context: {
        message_id: 'wamid.prior',
        text: 'Puedes pagar con tarjeta mediante PayPal.',
        text_truncated: false,
        recorded_at: '2026-09-22T00:00:00.000Z',
        delivery_evidence: 'constructed',
      },
    });
    const spec = await testRuntime().buildReplyRequestSpec(replyRequest({
      plan: continued,
      extraction: baseExtraction({
        supportAct: {
          kind: 'provide_detail',
          personReference: 'Roger Abanto',
          eventReference: 'Baby Shower Catalina',
        },
      }),
      informationResults: [],
      withProfile: false,
    }));
    const ids = spec.modules.map((module) => module.id);
    expect(ids).toContain('reply_support_continuity');
    expect(spec.input).toContain('Roger Abanto');
    expect(spec.input).toContain('Baby Shower Catalina');
  });

  it('credit and physical-card facts survive without a fulfillment prompt branch', async () => {
    const spec = await testRuntime().buildReplyRequestSpec(replyRequest({
      plan: supportPlan(),
      extraction: baseExtraction({
        requestedOperation: 'purchase.gift_detail.read',
        informationRequests: [{
          kind: 'purchase',
          resource: 'gift_purchases',
          query: '¿Ya les llegó el dinero?',
          orderId: null,
          authAction: 'none',
        }],
      }),
      informationResults: [creditResult()],
      withProfile: true,
    }));
    const ids = spec.modules.map((module) => module.id);
    expect(ids).not.toContain('reply_gift_fulfillment');
    expect(ids).not.toContain('reply_support_continuity');
    expect(spec.instructions).toContain('Una tarjeta física tiene su propio estado');
    expect(spec.input).toContain('host_account_credit');
    expect(spec.input).toContain('physicalStatus');
    expect(spec.input).toContain('preparing');
  });

  it('profile turn passes the canonical record once without stale support names', async () => {
    const spec = await testRuntime().buildReplyRequestSpec(replyRequest({
      plan: supportPlan(),
      extraction: purchaseExtraction(),
      informationResults: [luisResult()],
      withProfile: true,
    }));
    // The operation points at one canonical profile record; no facet
    // projector deletes payment facts or invents a remaining balance.
    expect(spec.input).toContain('customer_context');
    expect(spec.input).toContain('227.76');
    expect(spec.input).toContain('13.76');
    expect(spec.input).toContain('Yape o Plin');
    expect(spec.input).toContain('OP-LUIS-389');
    expect(spec.instructions).toContain('payment.amount');
    // No computed remaining balance anywhere in the serialized input.
    expect(spec.input).not.toMatch(/remaining":\s*[0-9]/);
    // A topic change imposes no old support names on the fresh turn.
    expect(spec.input).not.toContain('reported_guest_name');
    expect(spec.input).not.toContain('reported_event_name');
    expect(spec.input).not.toContain('Roger Abanto');
  });

  it('native media rides the reply call on URL turns and delayed file follow-ups', async () => {
    const receiptUrl = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png';
    const normalized = normalizeInboundImage({ url: receiptUrl });
    expect(normalized.status).toBe('available');
    if (normalized.status !== 'available' || normalized.source !== 'url') {
      throw new Error('fixture URL must normalize to an available URL image');
    }
    const composeRequests: ComposeReplyRequest[] = [];
    const scripted: AgentRuntime = {
      async extract(): Promise<ExtractionResult> {
        return baseExtraction({
          requestedOperation: 'payment_proof.verify',
          informationRequests: [{
            kind: 'purchase',
            resource: 'orders',
            query: 'El pedido figura pendiente por Yape. Cuanto me falta?',
            orderId: null,
            authAction: 'none',
            eventHint: 'Alejandra',
          }],
          supportAct: { kind: 'provide_detail',},
        });
      },
      async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        composeRequests.push(request);
        return { text: 'Respuesta del propietario.' };
      },
    };
    const orchestratorStub = fixtureCustomerContextOrchestrator({
      results: [luisResult()],
      summaries: [],
    }) as unknown as InformationOrchestrator;
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: scripted,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: orchestratorStub,
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51938389389',
      text: 'Ya envie lo que faltaba, aqui esta el comprobante.',
      messageId: 'wamid.url-luis-1',
      receivedAt: '2026-09-22T00:00:00.000Z',
      contactPhone: '+51938389389',
      image: normalized,
    });
    expect(composeRequests).toHaveLength(1);
    const request = composeRequests[0];
    // Native URL attachment plus purchase evidence on the same reply call.
    expect(request?.imageUrlAttachments).toEqual([{ url: receiptUrl, messageId: 'wamid.url-luis-1' }]);
    expect(request?.imageEvidence).toMatchObject({ status: 'available', source: 'url' });
    expect(request?.informationResults).toHaveLength(1);
    // The genuinely established URL context is recorded as a called tool,
    // mirroring image_file_context (live T1 proved the input-only record
    // never reaches tools_called).
    expect(response.trace.tools_called).toContain('image_url_context');
  });

  it('delayed amount question reuses the stored file natively without resend', async () => {
    const planStore = new InMemoryPlanStore();
    const seeded = mergePlan(
      createEmptyPlan({ planId: 'packet-b-media', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' }),
      {
        current_node: 'resolver_consultas_informativas',
        image_attachments: [{
          kind: 'file',
          fileId: 'file-receipt-149',
          messageId: 'wamid.file-t0',
          receivedAt: '2026-09-22T00:00:00.000Z',
          expiresAt: '2099-10-01T00:00:00.000Z',
          mimeType: 'image/png',
          byteLength: 54636,
          contentDigest: '0'.repeat(64),
        }],
      },
    );
    await planStore.save({ plan: seeded, reason: 'test-seed' });
    const composeRequests: ComposeReplyRequest[] = [];
    const scripted: AgentRuntime = {
      async extract(): Promise<ExtractionResult> {
        return baseExtraction({
          requestedOperation: 'media.image.inspect',
          imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.file-t0'] },
        });
      },
      async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        composeRequests.push(request);
        return { text: 'Respuesta del propietario.' };
      },
    };
    const service = new AgentService({
      planStore,
      runtime: scripted,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
      text: 'Cuanto dice ahi?',
      messageId: 'wamid.file-t1',
      receivedAt: '2026-09-22T00:01:00.000Z',
      contactPhone: '+51987654321',
    });
    expect(composeRequests).toHaveLength(1);
    // Same native file available to the explicit amount follow-up.
    expect(composeRequests[0]?.imageFileAttachments).toEqual([
      { fileId: 'file-receipt-149', messageId: 'wamid.file-t0' },
    ]);
    expect(composeRequests[0]?.imageEvidence).toMatchObject({ status: 'available', source: 'file' });
  });

  it('four candidates survive the reply projection without slicing', async () => {
    const purchases: PurchaseInformation[] = [1, 2, 3, 4].map((index) => ({
      orderId: `ORD-${index}`,
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: null,
      paymentMethod: null,
      currency: null,
      eventName: `Evento ${index}`,
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-01 10:00:00',
      items: [],
    }));
    const result: InformationTaskResult = {
      requestId: 'information-1',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      lookupResource: 'orders',
      purchases,
      carts: [],
      needsSelection: false,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
    };
    const spec = await testRuntime().buildReplyRequestSpec(replyRequest({
      plan: supportPlan(),
      extraction: purchaseExtraction(),
      informationResults: [result],
      withProfile: true,
    }));
    for (const index of [1, 2, 3, 4]) {
      expect(spec.input).toContain(`ORD-${index}`);
    }
  });
});
