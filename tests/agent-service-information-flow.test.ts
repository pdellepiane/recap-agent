import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  ExtractedInformationRequest,
  PurchaseInformation,
} from '../src/core/information';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import {
  type AgentConversationMessage,
  type AgentConversationGateway,
  type AgentGatewayResult,
  type AgentMessageLogInput,
  type AgentPurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
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
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = {
  terminal_whatsapp: new WhatsAppMessageRenderer(),
};

describe('AgentService first-class information flow', () => {
  it('answers FAQ evidence while preserving a purchase request blocked on email', async () => {
    const runtime = new InformationRuntime([
      extraction([
        { kind: 'faq', query: '¿Cómo funciona la lista de regalos?' },
        purchaseRequest(null),
      ]),
    ]);
    const knowledgeGateway = new FakeKnowledgeGateway();
    const purchaseGateway = new FakePurchaseGateway();
    const service = createService({
      runtime,
      knowledgeGateway,
      purchaseGateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'whatsapp:51999999999',
      text: '¿Cómo funciona la lista y cuál es el estado de mi regalo?',
      messageId: 'mixed-info-1',
      receivedAt: new Date().toISOString(),
    });

    const results = runtime.composeRequests.at(-1)?.informationResults ?? [];
    expect(results).toEqual([
      expect.objectContaining({ kind: 'faq', status: 'completed' }),
      expect.objectContaining({
        kind: 'purchase',
        status: 'needs_input',
        nextInput: 'email',
      }),
    ]);
    const purchaseBlock = results.find(
      (result) => result.kind === 'purchase' && result.status === 'needs_input',
    );
    expect(
      purchaseBlock?.status === 'needs_input' ? purchaseBlock.message : null,
    ).toContain('Por seguridad');
    expect(
      purchaseBlock?.status === 'needs_input' ? purchaseBlock.message : null,
    ).toContain('¿Cuál es el correo');
    expect(response.plan.information_state.pending_requests).toHaveLength(1);
    expect(response.plan.information_state.pending_requests[0]?.kind).toBe(
      'purchase',
    );
    expect(knowledgeGateway.calls).toBe(1);
    expect(purchaseGateway.ordersCalls + purchaseGateway.giftCalls).toBe(0);
  });

  it('treats a typed purchase request as clear when optional lookup details were marked ambiguous', async () => {
    const recordedExtraction = extraction([
      {
        kind: 'purchase',
        resource: 'orders',
        query: 'Estado del pedido propio del usuario.',
        orderId: null,
        aspects: ['summary', 'payment_status', 'shipping'],
        sensitiveFields: [],
        authAction: 'none',
      },
    ]);
    recordedExtraction.ambiguity = {
      status: 'ambiguous',
      clarificationQuestion:
        '¿Quieres consultar un pedido específico o todos tus pedidos?',
      interpretations: [
        'un pedido específico',
        'todos tus pedidos',
      ],
    };
    const runtime = new InformationRuntime([recordedExtraction]);
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'recorded-order-loop',
      text: 'Quiero saber el estado de un pedido',
      messageId: 'recorded-order-loop-1',
      receivedAt: new Date().toISOString(),
    });

    const results = runtime.composeRequests.at(-1)?.informationResults ?? [];
    const purchaseBlock = results.find(
      (result) => result.kind === 'purchase' && result.status === 'needs_input',
    );
    expect(purchaseBlock).toEqual(
      expect.objectContaining({
        kind: 'purchase',
        status: 'needs_input',
        nextInput: 'email',
      }),
    );
    expect(
      purchaseBlock?.status === 'needs_input' ? purchaseBlock.message : null,
    ).toContain('¿Cuál es el correo');
    expect(response.plan.information_state.pending_requests).toEqual([
      expect.objectContaining({
        kind: 'purchase',
        resource: 'orders',
        orderId: null,
      }),
    ]);
    expect(response.trace.extraction_summary.ambiguity_status).toBe('clear');
    expect(runtime.composeRequests.at(-1)?.errorMessage).toBeNull();
    expect(response.outbound.text).toContain('Por seguridad');
    expect(response.outbound.text).toContain('¿Cuál es el correo');
    expect(response.outbound.text).not.toContain('pedidos recientes');
  });

  it('asks briefly for account verification when the user already supplied an order number', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest('ORD-000880')]),
    ]);
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'specific-order-without-email',
      text: 'Revisa mi pedido ORD-000880.',
      messageId: 'specific-order-without-email-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.outbound.text).toContain('Por seguridad');
    expect(response.outbound.text).toContain('¿Cuál es el correo');
    expect(response.outbound.text).not.toContain('pedido que compartiste');
    expect(response.outbound.text).not.toContain('pedidos recientes');
  });

  it('uses one OTP to resume associated-event and purchase requests together', async () => {
    const runtime = new InformationRuntime([
      extraction(
        [
          {
            kind: 'associated_event',
            query: '¿A qué hora es mi evento?',
            eventHint: null,
          },
          purchaseRequest('ORD-000880'),
        ],
        null,
        'leonardocandio22@gmail.com',
      ),
      extraction([]),
    ]);
    const purchaseGateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway,
      providerGateway: provider,
    });

    const first = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'whatsapp:51999999999',
      text: 'Mi correo es leonardocandio22@gmail.com. Revisa mi evento y la orden ORD-000880.',
      messageId: 'shared-auth-1',
      receivedAt: new Date().toISOString(),
    });
    expect(first.plan.user_auth.status).toBe('code_requested');
    expect(provider.requestCodeCalls).toBe(1);
    expect(first.plan.information_state.pending_requests).toHaveLength(2);
    const otpBlock = runtime.composeRequests
      .at(-1)
      ?.informationResults?.find(
        (result) =>
          result.kind === 'purchase' && result.status === 'needs_input',
      );
    expect(
      otpBlock?.status === 'needs_input' ? otpBlock.message : null,
    ).toContain('leonardocandio22@gmail.com');

    const second = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'whatsapp:51999999999',
      text: '123456',
      messageId: 'shared-auth-2',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.eventLookupCalls).toBe(1);
    expect(purchaseGateway.giftCalls).toBe(1);
    expect(purchaseGateway.lastToken).toBe('shared-jwt');
    expect(second.plan.user_auth.status).toBe('authenticated');
    expect(second.plan.information_state.pending_requests).toEqual([]);
    expect(
      runtime.composeRequests
        .at(-1)
        ?.informationResults?.filter((result) => result.status === 'completed'),
    ).toHaveLength(2);
  });

  it('explains missing-code recovery without resending until the user asks', async () => {
    const missingCodeRequest = purchaseRequest(null);
    missingCodeRequest.authAction = 'report_otp_not_received';
    const resendRequest = purchaseRequest(null);
    resendRequest.authAction = 'resend_otp';
    const runtime = new InformationRuntime([
      extraction(
        [purchaseRequest(null)],
        null,
        'sandra.lopez.aguilar@gmail.com',
      ),
      extraction([missingCodeRequest]),
      extraction([resendRequest]),
    ]);
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: provider,
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'missing-code-user',
      text: 'sandra.lopez.aguilar@gmail.com',
      messageId: 'missing-code-1',
      receivedAt: new Date().toISOString(),
    });
    const missing = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'missing-code-user',
      text: 'No ha llegado nada',
      messageId: 'missing-code-2',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.requestCodeCalls).toBe(1);
    expect(missing.outbound.text).toContain('Por seguridad');
    expect(missing.outbound.text).toContain('sandra.lopez.aguilar@gmail.com');
    expect(missing.outbound.text).toContain('correo no deseado');
    expect(missing.outbound.text).toContain('puedo enviarte otro código');
    expect(missing.outbound.text).toContain('correo correcto');

    const resent = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'missing-code-user',
      text: 'Sí, envíame otro',
      messageId: 'missing-code-3',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.requestCodeCalls).toBe(2);
    expect(resent.outbound.text).toBe(
      'Listo, envié un nuevo código a sandra.lopez.aguilar@gmail.com. Escríbelo aquí para continuar',
    );
  });

  it('uses a newly provided email instead of the previously stored address', async () => {
    const changedEmailRequest = purchaseRequest(null);
    changedEmailRequest.authAction = 'change_email';
    const runtime = new InformationRuntime([
      extraction(
        [purchaseRequest(null)],
        null,
        'old@example.com',
      ),
      extraction(
        [changedEmailRequest],
        null,
        'correct@example.com',
      ),
    ]);
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: provider,
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'change-email-user',
      text: 'old@example.com',
      messageId: 'change-email-1',
      receivedAt: new Date().toISOString(),
    });
    const changed = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'change-email-user',
      text: 'Me registré con correct@example.com',
      messageId: 'change-email-2',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.requestCodeCalls).toBe(2);
    expect(changed.plan.user_auth.email).toBe('correct@example.com');
    expect(changed.outbound.text).toContain('correct@example.com');
    expect(changed.outbound.text).not.toContain('old@example.com');
  });

  it('persists information requests and executes neither side when a turn also asks for an exclusive action', async () => {
    const runtime = new InformationRuntime([
      extraction(
        [{ kind: 'faq', query: '¿Cuánto cobra Sin Envolturas?' }],
        'buscar_proveedores',
      ),
    ]);
    const knowledgeGateway = new FakeKnowledgeGateway();
    const purchaseGateway = new FakePurchaseGateway();
    purchaseGateway.recentMessages = [
      conversationMessage({
        id: 1,
        direction: 'outbound',
        body: 'Este es un recordatorio del evento de Ana y Luis.',
        source: 'admin_campaign',
        sentAt: '2026-07-31T14:00:00.000Z',
      }),
      conversationMessage({
        id: 2,
        direction: 'inbound',
        body: 'Busca fotógrafos y dime cuánto cobra Sin Envolturas.',
        source: 'whatsapp',
        whatsappMessageId: 'conflict-1',
        sentAt: '2026-07-31T14:01:00.000Z',
      }),
    ];
    const service = createService({
      runtime,
      knowledgeGateway,
      purchaseGateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-conflict',
      text: 'Busca fotógrafos y dime cuánto cobra Sin Envolturas.',
      messageId: 'conflict-1',
      receivedAt: '2026-07-31T14:01:00.000Z',
      contactPhone: '+51999999999',
    });

    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(response.plan.information_state.pending_requests).toHaveLength(1);
    expect(knowledgeGateway.calls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.informationResults).toEqual([]);
    expect(runtime.composeRequests.at(-1)?.errorMessage).toContain(
      'confirmar cuál quiere resolver primero',
    );
    expect(purchaseGateway.recentMessageCalls).toBe(1);
    expect(runtime.extractRequests.at(-1)?.messageContext).toEqual(
      expect.objectContaining({
        historyStatus: 'available',
        retrievedMessageCount: 2,
        excludedCurrentMessageCount: 1,
        recentMessages: [
          expect.objectContaining({
            body: 'Este es un recordatorio del evento de Ana y Luis.',
          }),
        ],
      }),
    );
    expect(runtime.composeRequests.at(-1)?.messageContext).toEqual(
      runtime.extractRequests.at(-1)?.messageContext,
    );
    expect(runtime.composeRequests.at(-1)?.extraction).toEqual(
      expect.objectContaining({
        actionIntent: 'buscar_proveedores',
        informationRequests: [
          expect.objectContaining({
            kind: 'faq',
            query: '¿Cuánto cobra Sin Envolturas?',
          }),
        ],
      }),
    );
  });

  it('persists compact candidates when recent purchases require a selection', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)]),
    ]);
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'selection-plan',
          channel: 'terminal_whatsapp',
          externalUserId: 'buyer@example.com',
        }),
        {
          contact_email: 'buyer@example.com',
          user_auth: {
            status: 'authenticated',
            email: 'buyer@example.com',
            token: 'existing-jwt',
            token_expires_at: new Date(
              Date.now() + 60 * 60 * 1000,
            ).toISOString(),
            last_error: null,
            requested_at: new Date().toISOString(),
          },
        },
      ),
      reason: 'seed-auth',
    });
    const purchaseGateway = new FakePurchaseGateway();
    purchaseGateway.giftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [purchase('ORD-1'), purchase('ORD-2')],
    };
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway,
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'buyer@example.com',
      text: 'Quiero revisar el estado de mi regalo.',
      messageId: 'selection-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.information_state.pending_requests).toHaveLength(1);
    expect(response.plan.information_state.selection_candidates).toEqual([
      {
        requestId: 'information-1',
        resource: 'gift_purchases',
        orders: [
          expect.objectContaining({ orderId: 'ORD-1' }),
          expect.objectContaining({ orderId: 'ORD-2' }),
        ],
      },
    ]);
    expect(response.plan.information_state.selection_candidates[0]).not.toHaveProperty(
      'payment',
    );
  });
});

class InformationRuntime implements AgentRuntime {
  public readonly extractRequests: ExtractRequest[] = [];
  public readonly composeRequests: ComposeReplyRequest[] = [];
  private extractionIndex = 0;

  constructor(private readonly extractions: ExtractionResult[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractRequests.push(request);
    const next =
      this.extractions[this.extractionIndex] ??
      this.extractions[this.extractions.length - 1];
    this.extractionIndex += 1;
    if (!next) {
      throw new Error('Missing extraction fixture.');
    }
    return next;
  }

  async composeReply(
    request: ComposeReplyRequest,
  ): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: 'Respuesta informativa.' };
  }
}

class FakeKnowledgeGateway implements KnowledgeRetrievalGateway {
  public calls = 0;

  async search(): Promise<KnowledgeRetrievalResult> {
    this.calls += 1;
    return {
      status: 'success',
      evidence: [
        {
          fileId: 'faq-1',
          filename: 'faq.md',
          score: 0.9,
          text: 'La lista de regalos es opcional.',
        },
      ],
    };
  }
}

class FakePurchaseGateway implements AgentConversationGateway {
  public ordersCalls = 0;
  public giftCalls = 0;
  public lastToken: string | null = null;
  public recentMessageCalls = 0;
  public recentMessages: AgentConversationMessage[] | null = null;
  public giftResult: AgentPurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: [purchase('ORD-000880')],
  };

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async getRecentMessages(): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    this.recentMessageCalls += 1;
    if (this.recentMessages) {
      return { status: 'success', messages: this.recentMessages };
    }
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async requestHumanTakeover(): Promise<AgentGatewayResult> {
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async getOrders(args: {
    token: string;
  }): Promise<AgentPurchaseLookupResult> {
    this.ordersCalls += 1;
    this.lastToken = args.token;
    return {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
  }

  async getGiftPurchases(args: {
    token: string;
  }): Promise<AgentPurchaseLookupResult> {
    this.giftCalls += 1;
    this.lastToken = args.token;
    return this.giftResult;
  }
}

function createService(args: {
  runtime: AgentRuntime;
  knowledgeGateway: KnowledgeRetrievalGateway;
  purchaseGateway: AgentConversationGateway;
  providerGateway: ReturnType<typeof providerGateway>;
  planStore?: InMemoryPlanStore;
}): AgentService {
  const provider = args.providerGateway.gateway;
  return new AgentService({
    planStore: args.planStore ?? new InMemoryPlanStore(),
    runtime: args.runtime,
    providerGateway: provider,
    promptLoader,
    renderers,
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: args.knowledgeGateway,
      providerGateway: provider,
      agentGateway: args.purchaseGateway,
    }),
    agentConversationGateway: args.purchaseGateway,
  });
}

function conversationMessage(
  overrides: Partial<AgentConversationMessage> &
    Pick<AgentConversationMessage, 'id' | 'direction' | 'body'>,
): AgentConversationMessage {
  return {
    id: overrides.id,
    direction: overrides.direction,
    source: overrides.source ?? null,
    body: overrides.body,
    status: overrides.status ?? 'delivered',
    whatsappMessageId: overrides.whatsappMessageId ?? null,
    sentAt: overrides.sentAt ?? null,
    createdAt: overrides.createdAt ?? null,
  };
}

function extraction(
  informationRequests: ExtractedInformationRequest[],
  actionIntent: ExtractionResult['actionIntent'] = null,
  contactEmail: string | null = null,
): ExtractionResult {
  return {
    actionIntent,
    informationRequests,
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
    conversationSummary: 'Consulta informativa.',
    selectedProviderHints: [],
    pauseRequested: false,
    contactName: null,
    contactEmail,
    contactPhone: null,
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
  };
}

function purchaseRequest(
  orderId: string | null,
): Extract<ExtractedInformationRequest, { kind: 'purchase' }> {
  return {
    kind: 'purchase',
    resource: 'gift_purchases',
    query: 'Estado del regalo comprado.',
    orderId,
    aspects: ['summary', 'payment_status', 'shipping'],
    sensitiveFields: [],
    authAction: 'none',
  };
}

function purchase(orderId: string): PurchaseInformation {
  return {
    orderId,
    paymentStatus: 'approved',
    shippingStatus: 'enroute',
    grandTotal: 250,
    paymentMethod: 'Visa',
    eventName: 'Boda',
    eventDate: '2026-09-15',
    eventUrl: null,
    createdAt: '2026-07-10',
    items: [],
  };
}

function providerGateway(): {
  gateway: ProviderGateway;
  requestCodeCalls: number;
  verifyCodeCalls: number;
  eventLookupCalls: number;
} {
  const state = {
    requestCodeCalls: 0,
    verifyCodeCalls: 0,
    eventLookupCalls: 0,
  };
  const gateway = {
    async requestUserLoginCode() {
      state.requestCodeCalls += 1;
      return { status: 'sent' as const };
    },
    async verifyUserLoginCode() {
      state.verifyCodeCalls += 1;
      return {
        status: 'authenticated' as const,
        token: 'shared-jwt',
        tokenExpiresAt: new Date(
          Date.now() + 60 * 60 * 1000,
        ).toISOString(),
      };
    },
    async lookupAuthenticatedUserEvents(): Promise<UserEventLookupResult> {
      state.eventLookupCalls += 1;
      return {
        lookup: {
          email: 'leonardocandio22@gmail.com',
          phone: null,
        },
        user: {
          id: 22,
          fullName: 'Leonardo',
          email: 'leonardocandio22@gmail.com',
          fullPhone: null,
        },
        events: [],
        counts: {
          ownerEvents: 0,
          guestEvents: 0,
          hostEvents: 0,
          celebratedEvents: 0,
          recentOrders: 0,
        },
      };
    },
  } as unknown as ProviderGateway;
  return {
    gateway,
    get requestCodeCalls() {
      return state.requestCodeCalls;
    },
    get verifyCodeCalls() {
      return state.verifyCodeCalls;
    },
    get eventLookupCalls() {
      return state.eventLookupCalls;
    },
  };
}
