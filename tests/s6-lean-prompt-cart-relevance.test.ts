import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeInboundImage } from '../src/core/inbound-image';
import type { NormalizedInboundMessage } from '../src/core/messages';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type {
  InformationExecutionSummary,
  InformationTaskResult,
  InformationSupportAct,
  PurchaseAspect,
} from '../src/core/information';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import type {
  AgentConversationGateway,
  AgentConversationMessage,
} from '../src/runtime/agent-conversation-gateway';
import type { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type { RecommendationFunnelTrace } from '../src/core/trace';
import type { CustomerContextProjection } from '../src/runtime/customer-context';
import { AgentService } from '../src/runtime/agent-service';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const RECOVERY_BODY =
  'Retoma tu compra: https://sinenvolturas.com/cart/recover/recovery-id';

function purchaseResultWithCart(
  requestId: string,
  orderId: string,
  cartId: string,
): { result: InformationTaskResult; summary: InformationExecutionSummary } {
  return {
    result: {
      requestId,
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      lookupResource: 'orders',
      purchases: [{
        orderId,
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: 150.5,
        paymentMethod: 'transfer',
        eventName: 'Evento Prueba',
        eventDate: null,
        eventUrl: null,
        createdAt: null,
        items: [],
      }],
      needsSelection: false,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
      carts: [{
        cartId,
        status: 'abandoned',
        wasAbandoned: true,
        eventName: 'Evento Prueba',
        items: [],
      }],
    },
    summary: {
      requestId,
      kind: 'purchase',
      status: 'completed',
      source: 'agent_api',
      outcomeCode: 'completed_with_results',
      retryable: null,
      queryHash: 'q',
      evidence: [],
      resultCount: 1,
      durationMs: 40,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
      resource: 'orders',
    },
  };
}

class ScriptedPurchaseRuntime implements AgentRuntime {
  public readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(
    private readonly aspects: PurchaseAspect[],
    private readonly supportAct: InformationSupportAct | null = null,
  ) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      actionIntent: null,
      informationRequests: [{
        kind: 'purchase',
        resource: 'orders',
        query: 'Consulta de compra.',
        orderId: 'ORD-A',
        aspects: [...this.aspects],
        sensitiveFields: [],
        authAction: 'none',
      }],
      supportAct: this.supportAct,
      phoneConfirmation: null,
      intentConfidence: 0.97,
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
      conversationSummary: 'Consulta de compra.',
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

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: 'Respuesta de compra.' };
  }
}

function historyGateway(
  bodies: string[],
): AgentConversationGateway {
  const messages: AgentConversationMessage[] = bodies.map((body, index) => ({
    id: index + 1,
    direction: 'outbound',
    source: 'admin_campaign',
    body,
    status: 'sent',
    whatsappMessageId: null,
    sentAt: '2026-08-31T19:10:00-05:00',
    createdAt: null,
  }));
  return {
    async logMessage() {
      return { status: 'skipped', reason: 'disabled', message: 'disabled' };
    },
    async getRecentMessages() {
      return { status: 'success', messages };
    },
    async requestHumanTakeover() {
      return { status: 'success', message: 'fixture_handoff' };
    },
    async authByPhone() {
      return { status: 'failed', error: 'not configured', retryable: false };
    },
  } as unknown as AgentConversationGateway;
}

function serviceWith(
  runtime: ScriptedPurchaseRuntime,
  results: InformationTaskResult[],
  summaries: InformationExecutionSummary[],
  gateway?: AgentConversationGateway,
): AgentService {
  return new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    ...(gateway ? { agentConversationGateway: gateway } : {}),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: {
      execute: async () => ({ results, summaries }),
    } as unknown as InformationOrchestrator,
  });
}

function textInbound(text: string): NormalizedInboundMessage {
  return {
    channel: 'whatsapp',
    externalUserId: 's6-user',
    text,
    messageId: `s6-${text.length}`,
    receivedAt: '2026-09-14T12:00:00.000Z',
    contactPhone: '+51900000001',
  };
}

function imageInbound(text: string): NormalizedInboundMessage {
  const image = normalizeInboundImage({ url: 'https://example.com/media/receipt-a.png' });
  if (image.status !== 'available' || image.source !== 'url') {
    throw new Error('fixture URL must normalize to an available URL image');
  }
  return { ...textInbound(text), messageId: 's6-image-1', image };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('S6 single customerContext serialization', () => {
  function composedInput(customerContext: CustomerContextProjection | undefined): string {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {} as never,
    });
    const typed = runtime as unknown as {
      composeConversationInput: (
        request: ComposeReplyRequest,
        funnel: RecommendationFunnelTrace,
      ) => string;
    };
    const funnel: RecommendationFunnelTrace = {
      available_candidates: 0,
      context_candidates: 0,
      context_candidate_ids: [],
      presentation_limit: 0,
    };
    const request = {
      currentNode: 'resolver_consultas_informativas',
      previousNode: 'resolver_consultas_informativas',
      userMessage: '¿Cuál es el estado de mi pago?',
      messageContext: localTurnMessageContext('not_configured'),
      plan: mergePlan(
        createEmptyPlan({ planId: 's6-plan', channel: 'whatsapp', externalUserId: 's6-user' }),
        { current_node: 'resolver_consultas_informativas' },
      ),
      extraction: {
        actionIntent: null,
        informationRequests: [],
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      },
      missingFields: [],
      searchReady: false,
      providerResults: [],
      errorMessage: null,
      promptBundleId: 's6-bundle',
      promptFilePaths: [],
      toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
      ...(customerContext !== undefined ? { customerContext } : {}),
    } as unknown as ComposeReplyRequest;
    return typed.composeConversationInput(request, funnel);
  }

  const projection: CustomerContextProjection = {
    commonRefs: { orderIds: ['ORD-A'], eventIds: [], pendingQuestion: null },
    candidates: [{ kind: 'order', orderId: 'ORD-A', eventName: 'Evento Prueba', state: 'pending' }],
    sections: { purchasesCarts: 'ready', invitationsEvents: 'not_requested' },
    purchases: [{
      orderId: 'ORD-A',
      eventId: null,
      eventName: 'Evento Prueba',
      paymentStatus: 'pending',
      grandTotal: 150.5,
    }],
    carts: [],
    detailedPurchases: [],
    invitations: [],
    actionOutcomes: [],
  };

  it('emits the canonical block exactly once with no duplicate prose JSON', () => {
    const input = composedInput(projection);
    expect(input.split('customer_context').length - 1).toBe(1);
    expect(input).not.toContain('Contexto de la operación del cliente');
    expect(input).not.toContain('customerContext');
  });

  it('emits no customer block when no projection was supplied', () => {
    const input = composedInput(undefined);
    expect(input).not.toContain('customer_context');
    expect(input).not.toContain('Contexto de la operación del cliente');
  });
});

describe('S6 cart relevance from structured checkout evidence', () => {
  it('keeps the cart as a distinct record on a payment question with a current image (D9)', async () => {
    const runtime = new ScriptedPurchaseRuntime(['payment_status']);
    const pair = purchaseResultWithCart('information-1', 'ORD-A', 'cart-image-1');
    const service = serviceWith(runtime, [pair.result], [pair.summary]);

    await service.handleTurn(imageInbound('Es mi comprobante, ¿ya se aprobó?'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    // One canonical profile: the cart rides along as its own record type
    // while payment evidence stays on the requested order.
    expect(customerContext?.carts.map((entry) => entry.cartId)).toEqual(['cart-image-1']);
  });

  it('projects cart facts for an explicit checkout question', async () => {
    const runtime = new ScriptedPurchaseRuntime(['payment_options']);
    const pair = purchaseResultWithCart('information-1', 'ORD-A', 'cart-checkout-1');
    const service = serviceWith(
      runtime,
      [pair.result],
      [pair.summary],
      historyGateway([RECOVERY_BODY]),
    );

    await service.handleTurn(textInbound('¿Puedo pagar este carrito por transferencia?'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.carts.map((entry) => entry.cartId)).toContain('cart-checkout-1');
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('carrito abandonado');
  });

  it('keeps payment plus thanks answerable from the order with the cart retained', async () => {
    const runtime = new ScriptedPurchaseRuntime(['payment_details', 'thanks']);
    const pair = purchaseResultWithCart('information-1', 'ORD-A', 'cart-thanks-1');
    const service = serviceWith(runtime, [pair.result], [pair.summary]);

    await service.handleTurn(textInbound('Gracias, ¿me confirmas el detalle del pago?'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    expect(customerContext?.carts.map((entry) => entry.cartId)).toEqual(['cart-thanks-1']);
  });

  it('receives both records for a genuinely-both question', async () => {
    const runtime = new ScriptedPurchaseRuntime(['payment_status', 'payment_options']);
    const pair = purchaseResultWithCart('information-1', 'ORD-A', 'cart-both-1');
    const service = serviceWith(runtime, [pair.result], [pair.summary]);

    await service.handleTurn(textInbound('¿Cuál es el estado del pedido y cómo pago el carrito?'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    expect(customerContext?.carts.map((entry) => entry.cartId)).toContain('cart-both-1');
  });

  it('keeps a voucher report answerable from the order with the cart retained', async () => {
    const runtime = new ScriptedPurchaseRuntime(['payment_status'], {
      kind: 'report_issue',
      topic: 'payment_proof',
      detail: 'submission_reported',
    });
    const pair = purchaseResultWithCart('information-1', 'ORD-A', 'cart-voucher-1');
    const service = serviceWith(runtime, [pair.result], [pair.summary]);

    await service.handleTurn(textInbound('Ya envié el comprobante, ¿llegó?'));

    expect(runtime.composeRequests).toHaveLength(1);
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A']);
    expect(customerContext?.carts.map((entry) => entry.cartId)).toEqual(['cart-voucher-1']);
  });

  it('does not surface an abandoned cart in the payment operational note', async () => {
    const runtime = new ScriptedPurchaseRuntime(['payment_status']);
    const pair = purchaseResultWithCart('information-1', 'ORD-A', 'cart-receipt-1');
    const service = serviceWith(
      runtime,
      [pair.result],
      [pair.summary],
      historyGateway([RECOVERY_BODY]),
    );

    await service.handleTurn(textInbound('¿Ya se aprobó mi pago?'));

    expect(runtime.composeRequests).toHaveLength(1);
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).not.toContain('carrito abandonado');
    expect(note).not.toContain('opción general de pago');
    // The cart stays in the canonical context as a distinct record; the
    // payment answer simply does not use it.
    const customerContext = runtime.composeRequests[0]?.customerContext;
    expect(customerContext?.carts.map((entry) => entry.cartId)).toEqual(['cart-receipt-1']);
  });
});
