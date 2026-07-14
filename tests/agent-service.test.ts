import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createEmptyPlan,
  getActiveNeed,
  mergePlan,
  type PersistedPlan,
  type PlanSnapshot,
} from '../src/core/plan';
import { decisionNodes } from '../src/core/decision-nodes';
import type { ProviderDetail, ProviderSummary } from '../src/core/provider';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { AgentService } from '../src/runtime/agent-service';
import { executeFinishPlanTool } from '../src/runtime/finish-plan-tool';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  AgentConversationGateway,
  AgentGatewayResult,
  AgentMessageLogInput,
  AgentConversationMessage,
} from '../src/runtime/agent-conversation-gateway';
import type {
  MessageResponseClassifier,
  MessageResponseClassifierResult,
  ResponseClassifierMode,
} from '../src/runtime/message-response-classifier';
import type {
  CategoryLocationProviderSearchInput,
  CreateProviderReviewInput,
  FavoriteRequestInput,
  KeywordProviderSearchInput,
  MarketplaceCategory,
  MarketplaceLocation,
  ProviderGateway,
  ProviderGatewaySearchResult,
  ProviderReview,
  QueryIntentProviderSearchInput,
  QuoteRequestInput,
  UserEventLookupInput,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { PlanStore, SavePlanInput } from '../src/storage/plan-store';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import type { ProviderFitCriteria } from '../src/runtime/provider-fit';
import type {
  ProviderPlanOperation,
  ProviderQueryIntent,
} from '../src/runtime/extraction-schemas';

const testProviderFitCriteria = {
  eventType: 'boda',
  needCategory: 'Fotografía y video',
  location: 'Lima',
  budgetAmount: null,
  budgetCurrency: null,
  mustHave: ['natural'],
  shouldAvoid: [],
  rankingNotes: 'Priorizar proveedores alineados con la necesidad activa.',
} satisfies ProviderFitCriteria;

function providerNeedQuery(
  category: ProviderQueryIntent['category'],
  label: string,
  queryStrings: string[],
  mustHave: string[] = [],
): ProviderQueryIntent['queries'][number] {
  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'query',
    label,
    category,
    queryStrings,
    mustHave,
    shouldAvoid: [],
    maxSelections: 1,
    allowCrossCategory: false,
  };
}

class FakeRuntime implements AgentRuntime {
  public readonly composeRequests: ComposeReplyRequest[] = [];

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    if (request.userMessage.includes('stop')) {
      return {
        intent: 'pausar',
        intentConfidence: 0.95,
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
        conversationSummary: 'Pausa solicitada por el usuario.',
        selectedProviderHints: [],
        pauseRequested: true,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        providerFitCriteria: testProviderFitCriteria,
      };
    }

    if (request.userMessage.includes('proveedor 1')) {
      return {
        intent: 'confirmar_proveedor',
        intentConfidence: 0.92,
        eventType: 'boda',
        vendorCategory: 'Fotografía y video',
        vendorCategories: ['Fotografía y video', 'Catering'],
        activeNeedCategory: 'Fotografía y video',
        location: 'Lima',
        budgetSignal: '$$',
        guestRange: '51-100',
        preferences: [],
        hardConstraints: [],
        assumptions: [],
        conversationSummary: 'El usuario elige el proveedor 1.',
        selectedProviderHints: ['1'],
        pauseRequested: false,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        providerFitCriteria: testProviderFitCriteria,
      };
    }

    return {
      intent: 'buscar_proveedores',
      intentConfidence: 0.91,
      eventType: 'boda',
      vendorCategory: 'Fotografía y video',
      vendorCategories: ['Fotografía y video', 'Catering'],
      activeNeedCategory: 'Fotografía y video',
      location: 'Lima',
      budgetSignal: '$$',
      guestRange: '51-100',
      preferences: ['natural'],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'Boda en Lima con presupuesto medio.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: testProviderFitCriteria,
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: `reply:${request.currentNode}` };
  }
}

class FaqRuntime extends FakeRuntime {
  override async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      intent: 'consultar_faq',
      intentConfidence: 0.98,
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
      conversationSummary: 'El usuario pregunta por Sin Envolturas.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: testProviderFitCriteria,
    };
  }
}

class InvitedEventRuntime extends FakeRuntime {
  override async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      intent: 'consultar_evento_invitado',
      intentConfidence: 0.97,
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
      conversationSummary: 'El usuario pregunta por un evento al que está invitado.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: testProviderFitCriteria,
    };
  }
}

class HumanEscalationRuntime extends FakeRuntime {
  public extractCalls = 0;

  override async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    this.extractCalls += 1;
    return {
      intent: 'solicitar_humano',
      intentConfidence: 0.99,
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
      conversationSummary: 'El usuario pide hablar con una persona del equipo.',
      selectedProviderHints: [],
      selectedProviderReferences: [],
      closeAction: null,
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: testProviderFitCriteria,
      kbQuery: null,
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
    };
  }
}

class FakeAgentConversationGateway implements AgentConversationGateway {
  public requestedPhones: string[] = [];

  constructor(private readonly result: AgentGatewayResult) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return this.result;
  }

  async getRecentMessages(phoneNumber: string): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    void phoneNumber;
    if (this.result.status === 'success') {
      return { status: 'success', messages: [] };
    }
    return this.result;
  }

  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    this.requestedPhones.push(phoneNumber);
    return this.result;
  }
}

class TrackingAgentConversationGateway implements AgentConversationGateway {
  public readonly operations: string[] = [];
  public readonly loggedMessages: AgentMessageLogInput[] = [];

  constructor(private readonly messages: AgentConversationMessage[]) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    this.operations.push(`log:${input.direction}`);
    this.loggedMessages.push(input);
    return { status: 'success', message: 'Message logged.' };
  }

  async getRecentMessages(): Promise<{ status: 'success'; messages: AgentConversationMessage[] }> {
    this.operations.push('get');
    return { status: 'success', messages: this.messages };
  }

  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    this.operations.push(`takeover:${phoneNumber}`);
    return { status: 'success', message: 'Human takeover requested.' };
  }
}

class FakeResponseClassifier implements MessageResponseClassifier {
  public readonly calls: Array<{
    inboundText: string;
    messages: AgentConversationMessage[];
  }> = [];

  constructor(
    public readonly mode: ResponseClassifierMode,
    private readonly action: 'respond' | 'suppress_acknowledgement' | 'suppress_reaction',
    private readonly health: {
      status: MessageResponseClassifierResult['trace']['conversation_health'];
      reason: MessageResponseClassifierResult['trace']['health_reason'];
      helpResponse: MessageResponseClassifierResult['trace']['human_help_response'];
    } = {
      status: 'progressing',
      reason: 'normal_progress',
      helpResponse: 'not_applicable',
    },
  ) {}

  async classify(args: {
    inboundText: string;
    plan: PersistedPlan;
    messages: AgentConversationMessage[];
    contextSource: 'agent_api' | 'local_plan';
  }): Promise<MessageResponseClassifierResult> {
    this.calls.push({ inboundText: args.inboundText, messages: args.messages });
    const reason = this.action === 'suppress_acknowledgement'
      ? 'acknowledgement'
      : this.action === 'suppress_reaction'
        ? 'reaction'
        : 'requires_response';
    return {
      trace: {
        mode: this.mode,
        action: this.action,
        reason,
        would_suppress: this.action !== 'respond',
        context_source: args.contextSource,
        has_prior_outbound_message: args.messages.some((message) => message.direction === 'outbound'),
        fallback_used: false,
        conversation_health: this.health.status,
        health_reason: this.health.reason,
        human_help_response: this.health.helpResponse,
        prompt_bundle_id: 'test-classifier',
        prompt_file_paths: [],
      },
      tokenUsage: {
        input_tokens: 10,
        output_tokens: 2,
        total_tokens: 12,
      },
    };
  }
}

class MisclassifiedInvitedEventFollowUpRuntime extends FakeRuntime {
  override async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      intent: 'detallar_proveedor',
      intentConfidence: 0.74,
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
      conversationSummary: 'El usuario pide info de Paolo y Mariana.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: testProviderFitCriteria,
      providerDetailRequest: {
        provider: {
          providerId: null,
          providerTitle: 'Paolo y Mariana',
          category: null,
          hint: 'paolo y mariana',
        },
        category: null,
        requestedDepth: 'full',
      },
    };
  }
}

class FakeGateway implements ProviderGateway {
  public searchCalls = 0;

  async listCategories(): Promise<MarketplaceCategory[]> {
    return [
      {
        id: 1,
        name: 'Fotografía y video',
        slug: 'fotografia',
        color: null,
        eventTypes: ['boda'],
        raw: {},
      },
    ];
  }

  async getCategoryBySlug(slug: string): Promise<MarketplaceCategory | null> {
    return {
      id: 1,
      name: slug,
      slug,
      color: null,
      eventTypes: ['boda'],
      raw: {},
    };
  }

  async listLocations(): Promise<MarketplaceLocation[]> {
    return [
      {
        cityId: 1,
        countryId: 51,
        city: 'Lima',
        country: 'Perú',
        raw: {},
      },
    ];
  }

  async searchProviders(
    plan: PersistedPlan,
  ): Promise<ProviderGatewaySearchResult> {
    this.searchCalls += 1;
    if ((plan.vendor_category as string) === 'sin-resultados') {
      return { providers: [] };
    }

    return {
      providers: [
        {
          id: 1,
          title: 'Foto Uno',
          category: 'Fotografía y video',
          location: 'Lima',
          priceLevel: 'mid',
          reason: 'coincide con el plan',
          serviceHighlights: [],
          termsHighlights: [],
        },
      ],
    };
  }

  async searchProvidersByKeyword(
    input: KeywordProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    void input;
    return {
      providers: [
        {
          id: 1,
          title: 'Foto Uno',
          category: 'Fotografía y video',
          location: 'Lima',
          priceLevel: 'mid',
          reason: 'coincide con el plan',
          serviceHighlights: [],
          termsHighlights: [],
        },
      ],
    };
  }

  async searchProvidersByCategoryLocation(
    input: CategoryLocationProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    void input;
    return {
      providers: [
        {
          id: 1,
          title: 'Foto Uno',
          category: 'Fotografía y video',
          location: 'Lima',
          priceLevel: 'mid',
          reason: 'coincide con el plan',
          serviceHighlights: [],
          termsHighlights: [],
        },
      ],
    };
  }

  async searchProvidersByQueryIntent(
    input: QueryIntentProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    return this.searchProvidersByCategoryLocation({
      category: input.category,
      location: input.location,
      page: 1,
    });
  }

  async getRelevantProviders() {
    return [
      {
        id: 2,
        title: 'Foto Dos',
        serviceHighlights: [],
        termsHighlights: [],
      },
    ];
  }

  async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
    return {
      id: providerId,
      title: 'Foto Uno',
      slug: 'foto-uno',
      category: 'Fotografía y video',
      location: 'Lima',
      priceLevel: 'mid',
      rating: '4.8',
      reason: 'coincide con el plan',
      detailUrl: 'https://sinenvolturas.com/proveedores/foto-uno',
      websiteUrl: 'https://foto-uno.example.com',
      minPrice: '1500.00',
      maxPrice: '3000.00',
      promoBadge: '10% Off',
      promoSummary: '10% de descuento en sesiones de evento.',
      descriptionSnippet: 'Cobertura documental con enfoque natural.',
      serviceHighlights: ['Cobertura de boda', 'Sesión preboda'],
      termsHighlights: ['Sujeto a disponibilidad'],
      description: 'Cobertura documental con enfoque natural.',
      eventTypes: ['boda'],
      raw: {},
    };
  }

  async getProviderDetailAndTrackView(
    providerId: number,
  ): Promise<ProviderDetail | null> {
    return await this.getProviderDetail(providerId);
  }

  async getRelatedProviders(providerId: number) {
    void providerId;
    return [];
  }

  async listProviderReviews(providerId: number): Promise<ProviderReview[]> {
    void providerId;
    return [];
  }

  async getEventVendorContext(eventId: number): Promise<Record<string, unknown> | null> {
    void eventId;
    return null;
  }

  async listEventFavoriteProviders(args: {
    eventId: number;
    sortBy?: string | null;
    page?: number | null;
    categoryId?: number | null;
  }): Promise<ProviderDetail[]> {
    void args;
    return [];
  }

  async listUserEventsVendorContext(userId: number): Promise<Record<string, unknown>[]> {
    void userId;
    return [];
  }

  async lookupUserEventContext(
    input: UserEventLookupInput,
  ): Promise<UserEventLookupResult | null> {
    return {
      lookup: input,
      user: {
        id: 42,
        fullName: 'María García',
        email: input.email ?? null,
        fullPhone: input.phone ?? null,
      },
      events: [
        {
          relation: 'guest',
          eventId: 205,
          slug: 'cumple-ana-2026',
          url: 'https://sinenvolturas.com/cumple-ana-2026',
          name: 'Cumpleaños de Ana',
          place: 'Perú',
          type: null,
          datetime: '2026-06-15T19:00:00Z',
          stage: null,
          isVisible: null,
          isPublic: null,
          currency: null,
          country: null,
          guestStatus: {
            hasResponded: true,
            willAttend: true,
            hasCouple: true,
            responseDate: '2026-04-10T09:00:00Z',
          },
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
        },
      ],
      counts: {
        ownerEvents: 0,
        guestEvents: 1,
        hostEvents: 0,
        celebratedEvents: 0,
        recentOrders: 0,
      },
    };
  }

  async requestGuestLoginCode(
    email: string,
  ): Promise<Awaited<ReturnType<ProviderGateway['requestGuestLoginCode']>>> {
    void email;
    return { status: 'sent' };
  }

  async verifyGuestLoginCode(
    email: string,
    code: string,
  ): Promise<Awaited<ReturnType<ProviderGateway['verifyGuestLoginCode']>>> {
    void email;
    void code;
    return {
      status: 'authenticated',
      token: 'fake-token',
      tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async lookupAuthenticatedGuest(args: {
    token: string;
    email: string;
  }): Promise<UserEventLookupResult | null> {
    void args.token;
    return {
      lookup: { email: args.email, phone: null },
      user: {
        id: 42,
        fullName: 'María García',
        email: args.email,
        fullPhone: null,
      },
      events: [
        {
          relation: 'guest',
          eventId: 205,
          slug: 'cumple-ana-2026',
          url: 'https://sinenvolturas.com/cumple-ana-2026',
          name: 'Cumpleaños de Ana',
          place: 'Perú',
          type: null,
          datetime: '2026-06-15T19:00:00Z',
          stage: null,
          isVisible: null,
          isPublic: null,
          currency: null,
          country: null,
          guestStatus: {
            hasResponded: true,
            willAttend: true,
            hasCouple: true,
            responseDate: '2026-04-10T09:00:00Z',
          },
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
        },
      ],
      counts: {
        ownerEvents: 0,
        guestEvents: 1,
        hostEvents: 0,
        celebratedEvents: 0,
        recentOrders: 0,
      },
    };
  }

  async createQuoteRequest(
    input: QuoteRequestInput,
  ): Promise<Record<string, unknown>> {
    return { ok: true, input };
  }

  async addVendorToEventFavorites(
    input: FavoriteRequestInput,
  ): Promise<Record<string, unknown>> {
    return { ok: true, input };
  }

  async createProviderReview(
    input: CreateProviderReviewInput,
  ): Promise<Record<string, unknown>> {
    return { ok: true, input };
  }
}

class AuthScenarioGateway extends FakeGateway {
  public requestCodeCalls = 0;
  public verifyCodeCalls = 0;
  public authenticatedLookupCalls = 0;
  public lastRequestedEmail: string | null = null;
  public lastLookupEmail: string | null = null;
  public lastVerifiedCode: string | null = null;
  public requestCodeResult: Awaited<ReturnType<ProviderGateway['requestGuestLoginCode']>> = {
    status: 'sent',
  };
  public verificationResult: Awaited<ReturnType<ProviderGateway['verifyGuestLoginCode']>> = {
    status: 'authenticated',
    token: 'auth-token',
    tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  public authenticatedLookupResult: UserEventLookupResult | null = {
    lookup: { email: null, phone: '' },
    user: {
      id: 42,
      fullName: 'María García',
      email: 'maria@example.com',
      fullPhone: null,
    },
    events: [
      {
        relation: 'guest',
        eventId: 205,
        slug: 'cumple-ana-2026',
        url: 'https://sinenvolturas.com/cumple-ana-2026',
        name: 'Cumpleaños de Ana',
        place: 'Perú',
        type: null,
        datetime: '2026-06-15T19:00:00Z',
        stage: null,
        isVisible: null,
        isPublic: null,
        currency: null,
        country: null,
        guestStatus: {
          hasResponded: true,
          willAttend: true,
          hasCouple: true,
          responseDate: '2026-04-10T09:00:00Z',
        },
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
      },
    ],
    counts: {
      ownerEvents: 0,
      guestEvents: 1,
      hostEvents: 0,
      celebratedEvents: 0,
      recentOrders: 0,
    },
  };
  public authenticatedLookupError: string | null = null;

  override async requestGuestLoginCode(
    email: string,
  ): Promise<Awaited<ReturnType<ProviderGateway['requestGuestLoginCode']>>> {
    this.requestCodeCalls += 1;
    this.lastRequestedEmail = email;
    return this.requestCodeResult;
  }

  override async verifyGuestLoginCode(
    email: string,
    code: string,
  ): Promise<Awaited<ReturnType<ProviderGateway['verifyGuestLoginCode']>>> {
    void email;
    this.verifyCodeCalls += 1;
    this.lastVerifiedCode = code;
    return this.verificationResult;
  }

  override async lookupAuthenticatedGuest(
    args: {
      token: string;
      email: string;
    },
  ): Promise<UserEventLookupResult | null> {
    void args.token;
    this.lastLookupEmail = args.email;
    this.authenticatedLookupCalls += 1;
    if (this.authenticatedLookupError) {
      throw new Error(this.authenticatedLookupError);
    }
    return this.authenticatedLookupResult
      ? {
          ...this.authenticatedLookupResult,
          lookup: { email: args.email, phone: null },
          user: this.authenticatedLookupResult.user
            ? {
                ...this.authenticatedLookupResult.user,
                email: args.email,
              }
            : null,
        }
      : null;
  }
}

class RecordingPlanStore implements PlanStore {
  public currentPlan: PlanSnapshot | null = null;

  public readonly saves: SavePlanInput[] = [];

  async getByExternalUser(
    channel: string,
    externalUserId: string,
  ): Promise<PlanSnapshot | null> {
    void channel;
    void externalUserId;
    return this.currentPlan;
  }

  async save(input: SavePlanInput): Promise<void> {
    this.currentPlan = input.plan;
    this.saves.push(input);
  }
}

describe('AgentService', () => {
  const promptsDir = path.resolve(process.cwd(), 'prompts');
  const promptLoader = new PromptLoader(promptsDir);
  const renderers = {
    whatsapp: new WhatsAppMessageRenderer(),
    terminal_whatsapp: new WhatsAppMessageRenderer(),
  };

  it('routes FAQ questions to consultar_faq from every saved active node', async () => {
    for (const node of decisionNodes) {
      const runtime = new FaqRuntime();
      const planStore = new InMemoryPlanStore();
      const gateway = new FakeGateway();
      const service = new AgentService({
        planStore,
        runtime,
        providerGateway: gateway,
        promptLoader,
        renderers,
      });
      const externalUserId = `faq-from-${node}`;
      await planStore.save({
        plan: mergePlan(
          createEmptyPlan({
            planId: `plan-${node}`,
            channel: 'terminal_whatsapp',
            externalUserId,
          }),
          {
            current_node: node,
            intent: 'buscar_proveedores',
            event_type: 'boda',
            vendor_category: 'Fotografía y video',
            active_need_category: 'Fotografía y video',
            location: 'Lima',
            guest_range: '51-100',
          },
        ),
        reason: 'seed-faq-node',
      });

      const response = await service.handleTurn({
        channel: 'terminal_whatsapp',
        externalUserId,
        text: '¿Cuánto cobra Sin Envolturas por los regalos?',
        messageId: `msg-${node}`,
        receivedAt: new Date().toISOString(),
      });

      expect(response.plan.current_node, node).toBe('consultar_faq');
      expect(response.trace.next_node, node).toBe('consultar_faq');
      expect(response.trace.intent, node).toBe('consultar_faq');
      expect(runtime.composeRequests.at(-1)?.currentNode, node).toBe('consultar_faq');
      expect(gateway.searchCalls, node).toBe(0);
      expect(response.trace.tools_called, node).not.toContain(
        'search_providers_from_plan',
      );
      expect(response.trace.plan_persist_reason, node).toBe('consultar_faq');
    }
  });

  it('routes invited event questions to consultar_evento_invitado from every saved active node', async () => {
    for (const node of decisionNodes) {
      const runtime = new InvitedEventRuntime();
      const planStore = new InMemoryPlanStore();
      const gateway = new FakeGateway();
      const service = new AgentService({
        planStore,
        runtime,
        providerGateway: gateway,
        promptLoader,
        renderers,
      });
      const externalUserId = `invited-event-from-${node}@example.com`;
      await planStore.save({
        plan: mergePlan(
          createEmptyPlan({
            planId: `plan-invited-${node}`,
            channel: 'terminal_whatsapp',
            externalUserId,
          }),
          {
            current_node: node,
            intent: 'buscar_proveedores',
            event_type: 'boda',
            vendor_category: 'Fotografía y video',
            active_need_category: 'Fotografía y video',
            location: 'Lima',
            guest_range: '51-100',
            contact_email: externalUserId,
          },
        ),
        reason: 'seed-invited-event-node',
      });

      const response = await service.handleTurn({
        channel: 'terminal_whatsapp',
        externalUserId,
        text: '¿A qué hora es el evento al que estoy invitado?',
        messageId: `msg-invited-${node}`,
        receivedAt: new Date().toISOString(),
      });

      expect(response.plan.current_node, node).toBe('consultar_evento_invitado');
      expect(response.trace.next_node, node).toBe('consultar_evento_invitado');
      expect(response.trace.intent, node).toBe('consultar_evento_invitado');
      expect(response.trace.turn_decision.routeKind, node).toBe('invited_event_lookup');
      expect(runtime.composeRequests.at(-1)?.currentNode, node).toBe(
        'consultar_evento_invitado',
      );
      expect(gateway.searchCalls, node).toBe(0);
      expect(response.trace.tools_called, node).not.toContain(
        'search_providers_from_plan',
      );
      expect(response.trace.plan_persist_reason, node).toBe(
        'consultar_evento_invitado',
      );
    }
  });

  it('auto-rejects unknown guest auth emails without asking for a code', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    gateway.requestCodeResult = {
      status: 'email_not_found',
      error: 'email not found',
    };
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'missing@example.com',
      text: '¿A qué hora es mi evento?',
      messageId: 'msg-auth-missing',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('consultar_evento_invitado');
    expect(response.plan.guest_auth.status).toBe('email_not_found');
    expect(gateway.requestCodeCalls).toBe(1);
    expect(gateway.verifyCodeCalls).toBe(0);
    expect(gateway.authenticatedLookupCalls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.invitedEventLookupResult).toBeNull();
    expect(response.trace.tools_called).toContain('request_guest_login_code');
    expect(response.trace.tools_called).not.toContain('verify_guest_login_code');
  });

  it('requests one login code for known guest auth emails', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'maria@example.com',
      text: '¿A qué hora es mi evento?',
      messageId: 'msg-auth-request',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.guest_auth.status).toBe('code_requested');
    expect(response.plan.guest_auth.email).toBe('maria@example.com');
    expect(response.plan.guest_auth.token).toBeNull();
    expect(gateway.requestCodeCalls).toBe(1);
    expect(gateway.verifyCodeCalls).toBe(0);
    expect(gateway.authenticatedLookupCalls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.errorMessage).toContain('código');
  });

  it('keeps the code challenge active after a wrong guest auth code', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    gateway.verificationResult = {
      status: 'invalid_code',
      error: 'invalid code',
    };
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-wrong-code',
          channel: 'terminal_whatsapp',
          externalUserId: 'maria@example.com',
        }),
        {
          current_node: 'consultar_evento_invitado',
          intent: 'consultar_evento_invitado',
          contact_email: 'maria@example.com',
          guest_auth: {
            status: 'code_requested',
            email: 'maria@example.com',
            token: null,
            token_expires_at: null,
            last_error: null,
            requested_at: '2026-06-11T00:00:00.000Z',
          },
        },
      ),
      reason: 'seed-code-requested',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'maria@example.com',
      text: '000000',
      messageId: 'msg-auth-wrong-code',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.guest_auth.status).toBe('code_requested');
    expect(response.plan.guest_auth.last_error).toBe('invalid code');
    expect(gateway.verifyCodeCalls).toBe(1);
    expect(gateway.lastVerifiedCode).toBe('000000');
    expect(gateway.authenticatedLookupCalls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.invitedEventLookupResult).toBeNull();
  });

  it('persists the token and injects event context after a correct guest auth code', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-correct-code',
          channel: 'terminal_whatsapp',
          externalUserId: 'maria@example.com',
        }),
        {
          current_node: 'consultar_evento_invitado',
          intent: 'consultar_evento_invitado',
          contact_email: 'maria@example.com',
          guest_auth: {
            status: 'code_requested',
            email: 'maria@example.com',
            token: null,
            token_expires_at: null,
            last_error: null,
            requested_at: '2026-06-11T00:00:00.000Z',
          },
        },
      ),
      reason: 'seed-code-requested',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'maria@example.com',
      text: '123456',
      messageId: 'msg-auth-correct-code',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.guest_auth.status).toBe('authenticated');
    expect(response.plan.guest_auth.token).toBe('auth-token');
    expect(Date.parse(response.plan.guest_auth.token_expires_at ?? '')).toBeGreaterThan(
      Date.now() + 23 * 60 * 60 * 1000,
    );
    expect(gateway.verifyCodeCalls).toBe(1);
    expect(gateway.authenticatedLookupCalls).toBe(1);
    expect(gateway.lastLookupEmail).toBe('maria@example.com');
    expect(runtime.composeRequests.at(-1)?.invitedEventLookupResult?.events[0]?.name).toBe(
      'Cumpleaños de Ana',
    );
  });

  it('reuses a valid guest auth token on follow-up without sending another code', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-authenticated',
          channel: 'terminal_whatsapp',
          externalUserId: 'maria@example.com',
        }),
        {
          current_node: 'consultar_evento_invitado',
          intent: 'consultar_evento_invitado',
          contact_email: 'maria@example.com',
          guest_auth: {
            status: 'authenticated',
            email: 'maria@example.com',
            token: 'auth-token',
            token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            last_error: null,
            requested_at: '2026-06-11T00:00:00.000Z',
          },
        },
      ),
      reason: 'seed-authenticated',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'maria@example.com',
      text: '¿y la hora?',
      messageId: 'msg-auth-follow-up',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.guest_auth.status).toBe('authenticated');
    expect(gateway.requestCodeCalls).toBe(0);
    expect(gateway.verifyCodeCalls).toBe(0);
    expect(gateway.authenticatedLookupCalls).toBe(1);
    expect(gateway.lastLookupEmail).toBe('maria@example.com');
    expect(runtime.composeRequests.at(-1)?.invitedEventLookupResult?.events).toHaveLength(1);
  });

  it('requests a new code after the 24 hour guest auth session expires', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-expired-auth-window',
          channel: 'terminal_whatsapp',
          externalUserId: 'maria@example.com',
        }),
        {
          current_node: 'consultar_evento_invitado',
          intent: 'consultar_evento_invitado',
          contact_email: 'maria@example.com',
          guest_auth: {
            status: 'authenticated',
            email: 'maria@example.com',
            token: 'old-token',
            token_expires_at: new Date(Date.now() - 1000).toISOString(),
            last_error: null,
            requested_at: '2026-06-11T00:00:00.000Z',
          },
        },
      ),
      reason: 'seed-expired-auth-window',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'maria@example.com',
      text: '¿y la hora?',
      messageId: 'msg-auth-24h-expired',
      receivedAt: new Date().toISOString(),
    });

    expect(gateway.requestCodeCalls).toBe(1);
    expect(gateway.verifyCodeCalls).toBe(0);
    expect(gateway.authenticatedLookupCalls).toBe(0);
    expect(response.plan.guest_auth.status).toBe('code_requested');
    expect(response.plan.guest_auth.token).toBeNull();
  });

  it('clears a failing guest auth token and asks for re-authentication without requesting a code twice', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    gateway.authenticatedLookupError = 'Guest service API request failed with 401';
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-expired-token',
          channel: 'terminal_whatsapp',
          externalUserId: 'maria@example.com',
        }),
        {
          current_node: 'consultar_evento_invitado',
          intent: 'consultar_evento_invitado',
          contact_email: 'maria@example.com',
          guest_auth: {
            status: 'authenticated',
            email: 'maria@example.com',
            token: 'expired-token',
            token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            last_error: null,
            requested_at: '2026-06-11T00:00:00.000Z',
          },
        },
      ),
      reason: 'seed-expired-token',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'maria@example.com',
      text: '¿y la hora?',
      messageId: 'msg-auth-failure',
      receivedAt: new Date().toISOString(),
    });

    expect(gateway.authenticatedLookupCalls).toBe(1);
    expect(gateway.requestCodeCalls).toBe(0);
    expect(response.plan.guest_auth.status).toBe('none');
    expect(response.plan.guest_auth.token).toBeNull();
    expect(runtime.composeRequests.at(-1)?.invitedEventLookupResult).toBeNull();
    expect(runtime.composeRequests.at(-1)?.errorMessage).toContain('validar tu correo nuevamente');
  });

  it('keeps invited event follow-ups in consultar_evento_invitado even when extraction says provider detail', async () => {
    const runtime = new MisclassifiedInvitedEventFollowUpRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    const externalUserId = 'paolo.delepias@gmail.com';
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-invited-follow-up',
          channel: 'terminal_whatsapp',
          externalUserId,
        }),
        {
          current_node: 'consultar_evento_invitado',
          intent: 'consultar_evento_invitado',
          contact_email: externalUserId,
        },
      ),
      reason: 'seed-invited-follow-up',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId,
      text: 'Dame la info de Paolo y Mariana',
      messageId: 'msg-invited-follow-up',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('consultar_evento_invitado');
    expect(response.trace.intent).toBe('consultar_evento_invitado');
    expect(response.trace.turn_decision.routeKind).toBe('invited_event_lookup');
    expect(runtime.composeRequests.at(-1)?.currentNode).toBe('consultar_evento_invitado');
    expect(gateway.searchCalls).toBe(0);
  });

  it('persists the plan after extraction and moves to recommendation when search succeeds', async () => {
    const runtime = new FakeRuntime();
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-1',
      text: 'Busco fotógrafo para mi boda en Lima con presupuesto medio',
      messageId: 'msg-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.plan.recommended_provider_ids).toEqual([1]);
    expect(response.trace.plan_persisted).toBe(true);
    expect(response.trace.plan_persist_reason).toBe('recomendar');
    expect(response.plan.provider_needs).toHaveLength(2);
    expect(response.plan.active_need_category).toBe('Fotografía y video');
    expect(response.plan.recommended_providers[0]?.detailUrl).toBe(
      'https://sinenvolturas.com/proveedores/foto-uno',
    );
    expect(response.plan.recommended_providers[0]?.serviceHighlights).toEqual([
      'Cobertura de boda',
      'Sesión preboda',
    ]);

    const saved = await planStore.getByExternalUser('terminal_whatsapp', 'user-1');
    expect(saved?.vendor_category).toBe('Fotografía y video');
    expect(saved?.location).toBe('Lima');
    expect(saved?.provider_needs.map((need) => need.category)).toEqual([
      'Fotografía y video',
      'Catering',
    ]);
  });

  it('stores a temporary close when the user pauses', async () => {
    const runtime = new FakeRuntime();
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-2',
      text: 'stop por ahora',
      messageId: 'msg-2',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('guardar_cerrar_temporalmente');
    expect(response.trace.plan_persist_reason).toBe('guardar_cerrar_temporalmente');
  });

  it('resumes an existing shortlist without searching again', async () => {
    class ResumeRuntime extends FakeRuntime {
      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        if (request.userMessage.includes('continuar')) {
          return {
            intent: 'retomar_plan',
            intentConfidence: 0.97,
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
            conversationSummary: 'El usuario quiere retomar su plan.',
            selectedProviderHints: [],
            pauseRequested: false,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
            providerFitCriteria: testProviderFitCriteria,
          };
        }
        return await super.extract(request);
      }
    }

    const runtime = new ResumeRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-resume-shortlist',
      text: 'Busco fotógrafo para mi boda en Lima con presupuesto medio',
      messageId: 'msg-resume-search',
      receivedAt: new Date().toISOString(),
    });
    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-resume-shortlist',
      text: 'stop por ahora',
      messageId: 'msg-resume-pause',
      receivedAt: new Date().toISOString(),
    });
    const searchCallsBeforeResume = gateway.searchCalls;

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-resume-shortlist',
      text: 'quiero continuar',
      messageId: 'msg-resume-continue',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.trace.search_strategy).toBe('existing_plan_shortlist');
    expect(gateway.searchCalls).toBe(searchCallsBeforeResume);
  });

  it('keeps a selected provider and skips search when the user confirms by name', async () => {
    class SelectionRuntime extends FakeRuntime {
      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        if (request.userMessage.includes('edo')) {
          return {
            intent: 'confirmar_proveedor',
            intentConfidence: 0.97,
            eventType: 'cumpleanos',
            vendorCategory: 'Catering',
            vendorCategories: ['Catering'],
            activeNeedCategory: 'Catering',
            location: 'Lima',
            budgetSignal: null,
            guestRange: '21-50',
            preferences: [],
            hardConstraints: [],
            assumptions: [],
            conversationSummary: 'El usuario quiere seguir con EDO para catering.',
            selectedProviderHints: [],
            pauseRequested: false,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          };
        }

        return await super.extract(request);
      }
    }

    const runtime = new SelectionRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-selection',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-3',
      }),
      {
        current_node: 'recomendar',
        event_type: 'cumpleanos',
        location: 'Lima',
        guest_range: '21-50',
        active_need_category: 'Catering',
        vendor_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [109],
            recommended_providers: [
              {
                id: 109,
                title: 'EDO Sushi Bar',
                slug: 'edo-sushi-bar',
                category: 'Catering',
                location: 'Lima',
                priceLevel: 'high',
                rating: '4.7',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/edo-sushi-bar',
                websiteUrl: null,
                minPrice: '1200.00',
                maxPrice: null,
                promoBadge: '10% Off',
                promoSummary: '10% de descuento en catering.',
                descriptionSnippet: 'Catering especializado en sushi.',
                serviceHighlights: ['Catering para eventos'],
                termsHighlights: ['Pedidos de 300 piezas a más'],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
        recommended_provider_ids: [109],
        recommended_providers: [
          {
            id: 109,
            title: 'EDO Sushi Bar',
            slug: 'edo-sushi-bar',
            category: 'Catering',
            location: 'Lima',
            priceLevel: 'high',
            rating: '4.7',
            reason: 'coincide con el plan',
            detailUrl: 'https://sinenvolturas.com/proveedores/edo-sushi-bar',
            websiteUrl: null,
            minPrice: '1200.00',
            maxPrice: null,
            promoBadge: '10% Off',
            promoSummary: '10% de descuento en catering.',
            descriptionSnippet: 'Catering especializado en sushi.',
            serviceHighlights: ['Catering para eventos'],
            termsHighlights: ['Pedidos de 300 piezas a más'],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-3',
      text: 'quiero utilizar edo',
      messageId: 'msg-3',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('seguir_refinando_guardar_plan');
    expect(response.plan.selected_provider_ids).toEqual([109]);
    expect(response.trace.next_node).toBe('seguir_refinando_guardar_plan');
    expect(gateway.searchCalls).toBe(0);
  });

  it('ignores a spurious replace operation when a plain selection has no provider to replace', async () => {
    const selectOperation: ProviderPlanOperation = {
      type: 'select_provider',
      category: 'Catering',
      preferences: [],
      hardConstraints: [],
      queryIntent: null,
      rerunSearch: false,
      provider: {
        providerId: 109,
        providerTitle: 'EDO Sushi Bar',
        category: 'Catering',
        hint: 'EDO Sushi Bar',
      },
      removeProvider: null,
      addProvider: null,
    };
    const spuriousReplaceOperation: ProviderPlanOperation = {
      type: 'replace_provider',
      category: 'Catering',
      preferences: [],
      hardConstraints: [],
      queryIntent: null,
      rerunSearch: false,
      provider: null,
      removeProvider: {
        providerId: null,
        providerTitle: null,
        category: 'Catering',
        hint: 'opción anterior',
      },
      addProvider: {
        providerId: 109,
        providerTitle: 'EDO Sushi Bar',
        category: 'Catering',
        hint: 'EDO Sushi Bar',
      },
    };

    class SpuriousReplaceRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.9,
          eventType: 'boda',
          vendorCategory: 'Catering',
          vendorCategories: ['Catering'],
          activeNeedCategory: 'Catering',
          location: 'Lima',
          budgetSignal: 'medio-alto',
          guestRange: '101-200',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario selecciona EDO Sushi Bar para Catering.',
          selectedProviderHints: ['EDO Sushi Bar'],
          selectedProviderReferences: [
            {
              providerId: 109,
              providerTitle: 'EDO Sushi Bar',
              category: 'Catering',
              hint: 'EDO Sushi Bar',
            },
          ],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerPlanOperations: [selectOperation, spuriousReplaceOperation],
        };
      }
    }

    const runtime = new SpuriousReplaceRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-spurious-replace',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-spurious-replace',
        }),
        {
          current_node: 'recomendar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '101-200',
          active_need_category: 'Catering',
          vendor_category: 'Catering',
          provider_needs: [
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [109],
              recommended_providers: [
                {
                  id: 109,
                  title: 'EDO Sushi Bar',
                  slug: 'edo-sushi-bar',
                  category: 'Catering',
                  location: 'Lima',
                  priceLevel: 'high',
                  rating: '4.7',
                  reason: 'coincide con el plan',
                  detailUrl: 'https://sinenvolturas.com/proveedores/edo-sushi-bar',
                  websiteUrl: null,
                  minPrice: '1200.00',
                  maxPrice: null,
                  promoBadge: '10% Off',
                  promoSummary: '10% de descuento en catering.',
                  descriptionSnippet: 'Catering especializado en sushi.',
                  serviceHighlights: ['Catering para eventos'],
                  termsHighlights: ['Pedidos de 300 piezas a más'],
                },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
          recommended_provider_ids: [109],
          recommended_providers: [
            {
              id: 109,
              title: 'EDO Sushi Bar',
              slug: 'edo-sushi-bar',
              category: 'Catering',
              location: 'Lima',
              priceLevel: 'high',
              rating: '4.7',
              reason: 'coincide con el plan',
              detailUrl: 'https://sinenvolturas.com/proveedores/edo-sushi-bar',
              websiteUrl: null,
              minPrice: '1200.00',
              maxPrice: null,
              promoBadge: '10% Off',
              promoSummary: '10% de descuento en catering.',
              descriptionSnippet: 'Catering especializado en sushi.',
              serviceHighlights: ['Catering para eventos'],
              termsHighlights: ['Pedidos de 300 piezas a más'],
            },
          ],
        },
      ),
      reason: 'seed-spurious-replace',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-spurious-replace',
      text: 'Selecciona Edo Sushi Bar para Catering.',
      messageId: 'msg-spurious-replace',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('seguir_refinando_guardar_plan');
    expect(response.plan.provider_needs.find((need) => need.category === 'Catering')?.selected_provider_ids).toEqual([109]);
    expect(response.trace.operational_note).toBeNull();
    expect(response.trace.route_kind).toBe('apply_selection');
    expect(response.trace.selection_resolution_summary.provider_plan_operation_types).toEqual([
      'select_provider',
      'replace_provider',
    ]);
    expect(gateway.searchCalls).toBe(0);
  });

  it('preserves known event context when the extractor returns null or unknown for unchanged fields', async () => {
    class PreserveContextRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.85,
          eventType: null,
          vendorCategory: null,
          vendorCategories: ['Locales'],
          activeNeedCategory: 'Locales',
          location: null,
          budgetSignal: 'medio',
          guestRange: 'unknown',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario confirmó presupuesto medio.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new PreserveContextRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-preserve',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-4',
      }),
      {
        current_node: 'aclarar_pedir_faltante',
        event_type: 'baby_shower',
        location: 'La Molina, Lima, Perú',
        guest_range: '21-50',
        active_need_category: 'Locales',
        vendor_category: 'Locales',
        provider_needs: [
          {
            category: 'Locales',
            status: 'identified',
            preferences: [],
            hard_constraints: [],
            missing_fields: ['budget_or_guest_range'],
            recommended_provider_ids: [],
            recommended_providers: [],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-4',
      text: 'presupuesto medio',
      messageId: 'msg-4',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.event_type).toBe('baby_shower');
    expect(response.plan.location).toBe('La Molina, Lima, Perú');
    expect(response.plan.guest_range).toBe('21-50');
    expect(response.plan.budget_signal).toBe('medio');
  });

  it('asks for missing search context after refining a need without an existing shortlist', async () => {
    const updateOperation: ProviderPlanOperation = {
      type: 'update_need',
      category: 'Hogar y deco',
      preferences: ['decoración moderna'],
      hardConstraints: [],
      queryIntent: null,
      rerunSearch: false,
      provider: null,
      removeProvider: null,
      addProvider: null,
    };

    class IncompleteRefinementRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.9,
          eventType: 'quinceanos',
          vendorCategory: 'Hogar y deco',
          vendorCategories: ['Hogar y deco'],
          activeNeedCategory: 'Hogar y deco',
          location: 'Lima',
          budgetSignal: null,
          guestRange: null,
          preferences: ['decoración moderna'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario amplió el estilo de decoración.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: {
            ...testProviderFitCriteria,
            eventType: 'quinceanos',
            needCategory: 'Hogar y deco',
          },
          providerPlanOperations: [updateOperation],
        };
      }
    }

    const runtime = new IncompleteRefinementRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-incomplete-refinement',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-incomplete-refinement',
        }),
        {
          current_node: 'aclarar_pedir_faltante',
          event_type: 'quinceanos',
          location: 'Lima',
          active_need_category: 'Hogar y deco',
          vendor_category: 'Hogar y deco',
          provider_needs: [
            {
              category: 'Hogar y deco',
              status: 'identified',
              preferences: ['decoración futurista'],
              hard_constraints: [],
              missing_fields: ['budget_or_guest_range'],
              recommended_provider_ids: [],
              recommended_providers: [],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
      reason: 'seed-incomplete-refinement',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-incomplete-refinement',
      text: 'Amplía a decoración moderna.',
      messageId: 'msg-incomplete-refinement',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('aclarar_pedir_faltante');
    expect(response.trace.route_kind).toBe('clarify_missing_fields');
    expect(response.trace.search_ready).toBe(false);
    expect(gateway.searchCalls).toBe(0);
  });

  it('broadens the active shortlist when the user asks for more options', async () => {
    class BroadenRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: 'Fotografía y video',
          vendorCategories: ['Fotografía y video'],
          activeNeedCategory: 'Fotografía y video',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere ver más fotógrafos en Lima.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    class BroadenGateway extends FakeGateway {
      public readonly categoryLocationCalls: CategoryLocationProviderSearchInput[] = [];

      override async searchProvidersByCategoryLocation(
        input: CategoryLocationProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.categoryLocationCalls.push(input);
        expect(input.category).toBe('Fotografía y video');

        if (input.location === 'Lima' && input.page === 1) {
          return {
            providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
          };
        }

        if (input.location === 'Lima' && input.page === 2) {
          return {
            providers: [
              {
                id: 2,
                title: 'Foto Dos',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'high',
                reason: 'más opciones en la misma categoría',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
          };
        }

        return {
          providers: [],
        };
      }
    }

    const runtime = new BroadenRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new BroadenGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-broaden',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-broaden',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-broaden',
      text: 'busca más',
      messageId: 'msg-broaden',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('recomendar');
    expect(getActiveNeed(response.plan)?.recommended_provider_ids).toEqual([2]);
    expect(response.trace.tools_called).toContain('search_providers_by_category_location');
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
    expect(gateway.categoryLocationCalls).toEqual([
      { category: 'Fotografía y video', location: 'Lima', page: 1 },
      { category: 'Fotografía y video', location: 'Lima', page: 2 },
      { category: 'Fotografía y video', location: 'Lima', page: 3 },
      { category: 'Fotografía y video', location: null, page: 1 },
    ]);
  });

  it('keeps the current shortlist and records that there are no more options when broadened search is empty', async () => {
    class BroadenRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: 'Fotografía y video',
          vendorCategories: ['Fotografía y video'],
          activeNeedCategory: 'Fotografía y video',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere ver más fotógrafos en Lima.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    class EmptyBroadenGateway extends FakeGateway {
      public readonly categoryLocationCalls: CategoryLocationProviderSearchInput[] = [];

      override async searchProvidersByCategoryLocation(
        input: CategoryLocationProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.categoryLocationCalls.push(input);
        return { providers: [] };
      }
    }

    const runtime = new BroadenRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new EmptyBroadenGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-broaden-empty',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-broaden-empty',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-broaden-empty',
      text: 'busca más',
      messageId: 'msg-broaden-empty',
      receivedAt: new Date().toISOString(),
    });

    expect(getActiveNeed(response.plan)?.recommended_provider_ids).toEqual([1]);
    expect(runtime.composeRequests.at(-1)?.errorMessage).toBe(
      'No encontré más opciones distintas con los criterios actuales.',
    );
    expect(gateway.categoryLocationCalls).toEqual([
      { category: 'Fotografía y video', location: 'Lima', page: 1 },
      { category: 'Fotografía y video', location: null, page: 1 },
    ]);
  });

  it('falls back to category-wide search when location-scoped pages add no unseen providers', async () => {
    class BroadenRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: 'Fotografía y video',
          vendorCategories: ['Fotografía y video'],
          activeNeedCategory: 'Fotografía y video',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere ampliar la búsqueda de fotógrafos.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    class FallbackBroadenGateway extends FakeGateway {
      public readonly categoryLocationCalls: CategoryLocationProviderSearchInput[] = [];

      override async searchProvidersByCategoryLocation(
        input: CategoryLocationProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.categoryLocationCalls.push(input);

        if (input.location === 'Lima') {
          if (input.page && input.page > 1) {
            return { providers: [] };
          }

          return {
            providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
          };
        }

        if (input.location === null && input.page === 1) {
          return {
            providers: [
              {
                id: 3,
                title: 'Foto Tres',
                category: 'Fotografía y video',
                location: 'Miraflores, Perú',
                priceLevel: 'high',
                reason: 'ampliación por categoría',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
          };
        }

        return { providers: [] };
      }
    }

    const runtime = new BroadenRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FallbackBroadenGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-broaden-fallback',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-broaden-fallback',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-broaden-fallback',
      text: 'más opciones',
      messageId: 'msg-broaden-fallback',
      receivedAt: new Date().toISOString(),
    });

    expect(getActiveNeed(response.plan)?.recommended_provider_ids).toEqual([3]);
    expect(gateway.categoryLocationCalls).toEqual([
      { category: 'Fotografía y video', location: 'Lima', page: 1 },
      { category: 'Fotografía y video', location: 'Lima', page: 2 },
      { category: 'Fotografía y video', location: null, page: 1 },
      { category: 'Fotografía y video', location: null, page: 2 },
    ]);
  });

  it('keeps using the normal search path when refinement changes criteria', async () => {
    class CriteriaChangeRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.95,
          eventType: 'boda',
          vendorCategory: 'Fotografía y video',
          vendorCategories: ['Fotografía y video'],
          activeNeedCategory: 'Fotografía y video',
          location: 'Lima',
          budgetSignal: 'económico',
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere opciones de fotografía más económicas.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    class CriteriaChangeGateway extends FakeGateway {
      public readonly categoryLocationCalls: CategoryLocationProviderSearchInput[] = [];

      override async searchProvidersByCategoryLocation(
        input: CategoryLocationProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.categoryLocationCalls.push(input);
        return super.searchProvidersByCategoryLocation(input);
      }

      override async searchProviders(plan: PersistedPlan): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;
        expect(plan.budget_signal).toBe('económico');
        return {
          providers: [
            {
              id: 4,
              title: 'Foto Ahorro',
              category: 'Fotografía y video',
              location: 'Lima',
              priceLevel: 'low',
              reason: 'alineado al nuevo presupuesto',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
        };
      }
    }

    const runtime = new CriteriaChangeRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new CriteriaChangeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-broaden-criteria-change',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-broaden-criteria-change',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        budget_signal: 'medio',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-broaden-criteria-change',
      text: 'muéstrame opciones más económicas',
      messageId: 'msg-broaden-criteria-change',
      receivedAt: new Date().toISOString(),
    });

    expect(getActiveNeed(response.plan)?.recommended_provider_ids).toEqual([4]);
    expect(response.trace.tools_called).toContain('search_providers_from_plan');
    expect(response.trace.tools_called).not.toContain('search_providers_by_category_location');
    expect(gateway.categoryLocationCalls).toEqual([]);
  });

  it('keeps a prior provider selection while opening a different active need in the same turn', async () => {
    class MixedTurnRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: 'Catering',
          vendorCategories: ['Fotografía y video', 'Catering'],
          activeNeedCategory: 'Catering',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary:
            'El usuario quiere tomar a Carlos para fotografía y ahora necesita catering.',
          selectedProviderHints: ['Carlos'],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    class MixedTurnGateway extends FakeGateway {
      override async searchProviders(
        plan: PersistedPlan,
      ): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;

        if (plan.vendor_category === 'Catering') {
          return {
            providers: [
              {
                id: 109,
                title: 'EDO Sushi Bar',
                category: 'Catering',
                location: 'Lima',
                priceLevel: 'high',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
          };
        }

        return await super.searchProviders(plan);
      }

      override async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
        if (providerId === 109) {
          return {
            id: 109,
            title: 'EDO Sushi Bar',
            slug: 'edo-sushi-bar',
            category: 'Catering',
            location: 'Lima',
            priceLevel: 'high',
            rating: '4.7',
            reason: 'coincide con el plan',
            detailUrl: 'https://sinenvolturas.com/proveedores/edo-sushi-bar',
            websiteUrl: 'https://www.edosushibar.com/catering',
            minPrice: '1200.00',
            maxPrice: null,
            promoBadge: '10% Off',
            promoSummary: '10% de descuento en catering.',
            descriptionSnippet: 'Catering especializado en sushi.',
            serviceHighlights: ['Catering para eventos'],
            termsHighlights: ['Pedidos de 300 piezas a más'],
            description: 'Catering especializado en sushi.',
            eventTypes: ['boda'],
            raw: {},
          };
        }

        if (providerId === 90) {
          return {
            id: 90,
            title: 'Carlos Schult',
            slug: 'carlos-schult',
            category: 'Fotografía y video',
            location: 'Lima',
            priceLevel: null,
            rating: '4.9',
            reason: 'coincide con el plan',
            detailUrl: 'https://sinenvolturas.com/proveedores/carlos-schult',
            websiteUrl: 'https://carlos.example.com',
            minPrice: null,
            maxPrice: null,
            promoBadge: 'Gratis',
            promoSummary: 'Sesión pre boda incluida.',
            descriptionSnippet: 'Fotografía para matrimonios.',
            serviceHighlights: ['Sesión pre boda', 'Cobertura de matrimonios'],
            termsHighlights: ['Sujeto a disponibilidad'],
            description: 'Fotografía para matrimonios.',
            eventTypes: ['boda'],
            raw: {},
          };
        }

        return await super.getProviderDetail(providerId);
      }
    }

    const runtime = new MixedTurnRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new MixedTurnGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-mixed-turn',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-5',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [90],
            recommended_providers: [
              {
                id: 90,
                title: 'Carlos Schult',
                slug: 'carlos-schult',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: null,
                rating: '4.9',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/carlos-schult',
                websiteUrl: 'https://carlos.example.com',
                minPrice: null,
                maxPrice: null,
                promoBadge: 'Gratis',
                promoSummary: 'Sesión pre boda incluida.',
                descriptionSnippet: 'Fotografía para matrimonios.',
                serviceHighlights: ['Sesión pre boda', 'Cobertura de matrimonios'],
                termsHighlights: ['Sujeto a disponibilidad'],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-5',
      text: 'quiero utilizar los servicios de carlos, tambien necesito catering',
      messageId: 'msg-5',
      receivedAt: new Date().toISOString(),
    });

    const photographyNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Fotografía y video',
    );
    const cateringNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Catering',
    );

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.plan.active_need_category).toBe('Catering');
    expect(photographyNeed?.selected_provider_ids).toEqual([90]);
    expect(photographyNeed?.status).toBe('selected');
    expect(cateringNeed?.recommended_provider_ids).toEqual([109]);
    expect(gateway.searchCalls).toBe(1);
  });

  it('selects a provider whose name starts with a number while opening another need', async () => {
    class NumericNameSelectionRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: 'Música',
          vendorCategories: ['Música'],
          activeNeedCategory: 'Música',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary:
            'El usuario eligió 4Foodies para catering y ahora necesita música.',
          selectedProviderHints: ['4Foodies'],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    class MusicGateway extends FakeGateway {
      override async searchProviders(
        plan: PersistedPlan,
      ): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;
        expect(plan.vendor_category).toBe('Música');
        return {
          providers: [
            {
              id: 115,
              title: 'Dj Naoki',
              category: 'Música',
              location: 'Perú',
              priceLevel: 'high',
              reason: 'coincide con el plan',
              serviceHighlights: ['Servicio de DJ para bodas'],
              termsHighlights: [],
            },
          ],
        };
      }
    }

    const runtime = new NumericNameSelectionRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new MusicGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-numeric-provider',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-numeric-provider',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '21-50',
        active_need_category: 'Catering',
        vendor_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: ['tablas de queso'],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [136],
            recommended_providers: [
              {
                id: 136,
                title: '4Foodies',
                slug: '4foodies',
                category: 'Catering',
                location: 'Lima',
                priceLevel: 'high',
                rating: '0.0',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/4foodies',
                websiteUrl: 'https://www.4foodies.pe',
                minPrice: null,
                maxPrice: null,
                promoBadge: '10% Off',
                promoSummary: '10% de descuento.',
                descriptionSnippet: 'Tablas de quesos para eventos.',
                serviceHighlights: ['Tablas de quesos'],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-numeric-provider',
      text: 'quiero la opcion de 4Foodies. necesito musica tambien',
      messageId: 'msg-numeric-provider',
      receivedAt: new Date().toISOString(),
    });

    const cateringNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Catering',
    );
    const musicNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Música',
    );

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.plan.active_need_category).toBe('Música');
    expect(cateringNeed?.status).toBe('selected');
    expect(cateringNeed?.selected_provider_ids).toEqual([136]);
    expect(musicNeed?.status).toBe('shortlisted');
    expect(musicNeed?.selected_provider_hints).toEqual([]);
    expect(gateway.searchCalls).toBe(1);
  });

  it('selects a prior provider from extractor-resolved hint when opening another need', async () => {
    class DescriptiveSelectionRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.93,
          eventType: 'boda',
          vendorCategory: 'Música',
          vendorCategories: ['Música'],
          activeNeedCategory: 'Música',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary:
            'El usuario eligió el catering de tablas de queso y ahora necesita música.',
          selectedProviderHints: ['4Foodies'],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    class MusicGateway extends FakeGateway {
      override async searchProviders(): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;
        return {
          providers: [
            {
              id: 115,
              title: 'Dj Naoki',
              category: 'Música',
              location: 'Perú',
              priceLevel: 'high',
              reason: 'coincide con el plan',
              serviceHighlights: ['Servicio de DJ para bodas'],
              termsHighlights: [],
            },
          ],
        };
      }
    }

    const runtime = new DescriptiveSelectionRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new MusicGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-descriptive-provider',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-descriptive-provider',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '21-50',
        active_need_category: 'Catering',
        vendor_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: ['tablas de queso'],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [109, 136],
            recommended_providers: [
              {
                id: 109,
                title: 'Edo Sushi Bar',
                slug: 'edo-sushi-bar',
                category: 'Catering',
                location: 'Lima',
                priceLevel: 'high',
                rating: '5.0',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/edo-sushi-bar',
                websiteUrl: null,
                minPrice: '1200.00',
                maxPrice: null,
                promoBadge: '10% Off',
                promoSummary: '10% de descuento.',
                descriptionSnippet: 'Catering de sushi para eventos.',
                serviceHighlights: ['Catering de sushi'],
                termsHighlights: [],
              },
              {
                id: 136,
                title: '4Foodies',
                slug: '4foodies',
                category: 'Catering',
                location: 'Lima',
                priceLevel: 'high',
                rating: '0.0',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/4foodies',
                websiteUrl: 'https://www.4foodies.pe',
                minPrice: null,
                maxPrice: null,
                promoBadge: '10% Off',
                promoSummary: '10% de descuento.',
                descriptionSnippet: 'Tablas de quesos para eventos.',
                serviceHighlights: ['Tablas de quesos', 'Mesas gastronómicas'],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-descriptive-provider',
      text: 'dame la de tablas de queso y tambien necesito musica',
      messageId: 'msg-descriptive-provider',
      receivedAt: new Date().toISOString(),
    });

    const cateringNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Catering',
    );
    const musicNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Música',
    );

    expect(response.plan.active_need_category).toBe('Música');
    expect(cateringNeed?.status).toBe('selected');
    expect(cateringNeed?.selected_provider_ids).toEqual([136]);
    expect(musicNeed?.status).toBe('shortlisted');
    expect(gateway.searchCalls).toBe(1);
  });

  it('does not match short provider aliases inside unrelated words', async () => {
    class EmbeddedAliasRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: 'Catering',
          vendorCategories: ['Catering'],
          activeNeedCategory: 'Catering',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario eligió el proveedor de tablas de queso.',
          selectedProviderHints: ['proveedor de la shortlist de catering con servicio en tablas de quesos (4Foodies)'],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new EmbeddedAliasRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-embedded-alias',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-embedded-alias',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '21-50',
        active_need_category: 'Catering',
        vendor_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [109, 136],
            recommended_providers: [
              {
                id: 109,
                title: 'Edo Sushi Bar',
                slug: 'edo-sushi-bar',
                category: 'Catering',
                location: 'Lima',
                priceLevel: 'high',
                rating: '5.0',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/edo-sushi-bar',
                websiteUrl: null,
                minPrice: '1200.00',
                maxPrice: null,
                promoBadge: '10% Off',
                promoSummary: '10% de descuento.',
                descriptionSnippet: 'Catering de sushi para eventos.',
                serviceHighlights: ['Catering de sushi'],
                termsHighlights: [],
              },
              {
                id: 136,
                title: '4Foodies',
                slug: '4foodies',
                category: 'Catering',
                location: 'Lima',
                priceLevel: 'high',
                rating: '0.0',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/4foodies',
                websiteUrl: 'https://www.4foodies.pe',
                minPrice: null,
                maxPrice: null,
                promoBadge: '10% Off',
                promoSummary: '10% de descuento.',
                descriptionSnippet: 'Tablas de quesos para eventos.',
                serviceHighlights: ['Tablas de quesos'],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-embedded-alias',
      text: 'me quedo con el proveedor de tablas de queso',
      messageId: 'msg-embedded-alias',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.selected_provider_ids).toEqual([136]);
    expect(gateway.searchCalls).toBe(0);
  });

  it('resolves ordinal words against the active shortlist without searching again', async () => {
    class OrdinalSelectionRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.95,
          eventType: 'boda',
          vendorCategory: 'Música',
          vendorCategories: ['Música'],
          activeNeedCategory: 'Música',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario eligió la primera opción de música.',
          selectedProviderHints: ['primera opción'],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new OrdinalSelectionRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-ordinal-provider',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-ordinal-provider',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '21-50',
        active_need_category: 'Música',
        vendor_category: 'Música',
        provider_needs: [
          {
            category: 'Música',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [115, 119],
            recommended_providers: [
              {
                id: 115,
                title: 'Dj Naoki',
                slug: 'dj-naoki',
                category: 'Música',
                location: 'Perú',
                priceLevel: 'high',
                rating: '0.0',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/dj-naoki',
                websiteUrl: null,
                minPrice: null,
                maxPrice: null,
                promoBadge: '15% Off',
                promoSummary: '15% de descuento.',
                descriptionSnippet: 'DJ para bodas.',
                serviceHighlights: ['Servicio de DJ para bodas'],
                termsHighlights: [],
              },
              {
                id: 119,
                title: 'Dj Siles',
                slug: 'dj-siles',
                category: 'Música',
                location: 'Perú',
                priceLevel: 'mid',
                rating: '0.0',
                reason: 'coincide con el plan',
                detailUrl: 'https://sinenvolturas.com/proveedores/dj-siles',
                websiteUrl: null,
                minPrice: null,
                maxPrice: null,
                promoBadge: '15% Off',
                promoSummary: '15% de descuento.',
                descriptionSnippet: 'DJ y sonido para eventos.',
                serviceHighlights: ['Alquiler de equipos de sonido'],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({
      plan: seededPlan,
      reason: 'seed',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-ordinal-provider',
      text: 'dame la primera opcion',
      messageId: 'msg-ordinal-provider',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('seguir_refinando_guardar_plan');
    expect(response.plan.selected_provider_ids).toEqual([115]);
    expect(getActiveNeed(response.plan)?.status).toBe('selected');
    expect(gateway.searchCalls).toBe(0);
  });

  it('keeps broad planning in entrevista when the event is known but no provider need is active yet', async () => {
    class PlanningRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.88,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: [],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere planear una boda en Lima.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new PlanningRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-6',
      text: 'hola, me gustaria planear un matrimonio en lima',
      messageId: 'msg-6',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('entrevista');
    expect(gateway.searchCalls).toBe(0);
  });

  it('ignores implicit venue extraction for broad event-planning openers', async () => {
    class ImplicitVenueRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.82,
          eventType: 'boda',
          vendorCategory: 'Locales',
          vendorCategories: ['Locales'],
          activeNeedCategory: 'Locales',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '101-200',
          preferences: [],
          hardConstraints: [],
          assumptions: ['El tipo de evento podría necesitar local.'],
          conversationSummary: 'El usuario quiere planear una boda en Lima.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new ImplicitVenueRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-implicit-venue',
      text: 'hola, me gustaria planear un matrimonio en lima para 120 personas',
      messageId: 'msg-implicit-venue',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('entrevista');
    expect(response.plan.active_need_category).toBeNull();
    expect(response.plan.provider_needs).toHaveLength(0);
    expect(gateway.searchCalls).toBe(0);
  });

  it('preserves an explicit structured auditorium need without keyword routing', async () => {
    class ExplicitAuditoriumRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.95,
          eventType: 'corporativo',
          vendorCategory: 'Locales',
          vendorCategories: ['Locales'],
          activeNeedCategory: 'Locales',
          location: 'Aeropuerto de Lima',
          budgetSignal: 'mínimo',
          guestRange: '201+',
          preferences: ['auditorio dentro del aeropuerto'],
          hardConstraints: ['mañana'],
          assumptions: [],
          conversationSummary: 'Evento corporativo para 900 personas en un auditorio.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: {
            ...testProviderFitCriteria,
            eventType: 'corporativo',
            needCategory: 'Locales',
            location: 'Aeropuerto de Lima',
            budgetAmount: 1000,
            mustHave: ['auditorio dentro del aeropuerto'],
          },
        };
      }
    }

    const response = await new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new ExplicitAuditoriumRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-explicit-auditorium',
      text: 'Necesito un auditorio para un evento corporativo.',
      messageId: 'msg-explicit-auditorium',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.provider_needs.some((need) => need.category === 'Locales')).toBe(true);
    expect(response.plan.active_need_category).toBe('Locales');
  });

  it('maps an explicit guest count of 100 into the 51-100 range', async () => {
    class GuestCountRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.9,
          eventType: 'boda',
          vendorCategory: 'Fotografía y video',
          vendorCategories: ['Fotografía y video'],
          activeNeedCategory: 'Fotografía y video',
          location: 'Lima',
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda en Lima con 100 invitados.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new GuestCountRuntime();
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-7',
      text: 'son 100 invitados, que fotografos me recomiendas?',
      messageId: 'msg-7',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.guest_range).toBe('51-100');
  });

  it('resets a finished plan when the user starts a new planning request', async () => {
    const runtime = new FakeRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const finishedPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-done',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-finished',
      }),
      {
        current_node: 'necesidad_cubierta',
        lifecycle_state: 'finished',
        contact_name: 'Ada',
        contact_email: 'ada@example.com',
        conversation_summary: 'Cierre confirmado.',
      },
    );

    await planStore.save({ plan: finishedPlan, reason: 'seed' });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-finished',
      text: 'Quiero otra boda',
      messageId: 'msg-done',
      receivedAt: new Date().toISOString(),
    });

    expect(runtime.composeRequests).toHaveLength(1);
    expect(gateway.searchCalls).toBe(1);
    expect(response.outbound.text).not.toContain('24 horas');
    expect(response.outbound.text).not.toContain('enfriamiento');
    expect(response.plan.lifecycle_state).toBe('active');
  });

  it('persists finished plans without a TTL when runtime marks plan as finished', async () => {
    class FinishingRuntime extends FakeRuntime {
      override async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        const finished = mergePlan(request.plan as PlanSnapshot, {
          lifecycle_state: 'finished',
          contact_name: 'Lin',
          contact_email: 'lin@example.com',
          current_node: 'necesidad_cubierta',
          intent: 'cerrar',
        });
        Object.assign(request.plan, finished);
        return { text: 'Plan finalizado.' };
      }
    }

    const runtime = new FinishingRuntime();
    const planStore = new RecordingPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-finish-tool',
      text: 'listo, cierra el plan',
      messageId: 'msg-finish',
      receivedAt: new Date().toISOString(),
    });

    expect(planStore.saves.every((save) => !('ttlEpochSeconds' in save))).toBe(true);
    expect(planStore.currentPlan?.lifecycle_state).toBe('finished');
    expect(planStore.currentPlan?.contact_email).toBe('lin@example.com');
  });

  it('rejects an invalid phone immediately and does not persist it', async () => {
    class InvalidPhoneRuntime extends FakeRuntime {
      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        if (request.userMessage.includes('967')) {
          return {
            intent: 'cerrar',
            intentConfidence: 0.95,
            eventType: 'boda',
            vendorCategory: 'Fotografía y video',
            vendorCategories: ['Fotografía y video'],
            activeNeedCategory: 'Fotografía y video',
            location: 'Lima',
            budgetSignal: null,
            guestRange: '51-100',
            preferences: [],
            hardConstraints: [],
            assumptions: [],
            conversationSummary: 'El usuario quiere cerrar y dio un teléfono inválido.',
            selectedProviderHints: [],
            pauseRequested: false,
            contactName: 'Carolina',
            contactEmail: 'carolina@example.com',
            contactPhone: '967',
          };
        }

        return await super.extract(request);
      }
    }

    const runtime = new InvalidPhoneRuntime();
    const planStore = new RecordingPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-invalid-phone',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-invalid-phone',
      }),
      {
        current_node: 'crear_lead_cerrar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        contact_name: 'Carolina',
        contact_email: 'carolina@example.com',
        contact_phone: null,
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [1],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({ plan: seededPlan, reason: 'seed' });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-invalid-phone',
      text: 'mi teléfono es 967',
      messageId: 'msg-invalid-phone',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.contact_phone).toBeNull();
    expect(response.plan.contact_name).toBe('Carolina');
    expect(response.plan.contact_email).toBe('carolina@example.com');
    expect(response.trace.operational_note).toContain('teléfono');
    expect(response.trace.extraction_summary.contact_validation_error).toContain('teléfono');
    expect(response.trace.plan_summary.contact_validation_error).toContain('teléfono');
  });

  it('rejects an invalid email immediately and does not persist it', async () => {
    class InvalidEmailRuntime extends FakeRuntime {
      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        if (request.userMessage.includes('carolina.gmail.com')) {
          return {
            intent: 'cerrar',
            intentConfidence: 0.95,
            eventType: 'boda',
            vendorCategory: 'Fotografía y video',
            vendorCategories: ['Fotografía y video'],
            activeNeedCategory: 'Fotografía y video',
            location: 'Lima',
            budgetSignal: null,
            guestRange: '51-100',
            preferences: [],
            hardConstraints: [],
            assumptions: [],
            conversationSummary: 'El usuario quiere cerrar y dio un email inválido.',
            selectedProviderHints: [],
            pauseRequested: false,
            contactName: 'Carolina',
            contactEmail: 'carolina.gmail.com',
            contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          };
        }

        return await super.extract(request);
      }
    }

    const runtime = new InvalidEmailRuntime();
    const planStore = new RecordingPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-invalid-email',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-invalid-email',
      }),
      {
        current_node: 'crear_lead_cerrar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        contact_name: 'Carolina',
        contact_email: null,
        contact_phone: null,
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [1],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({ plan: seededPlan, reason: 'seed' });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-invalid-email',
      text: 'mi correo es carolina.gmail.com',
      messageId: 'msg-invalid-email',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.contact_email).toBeNull();
    expect(response.plan.contact_name).toBe('Carolina');
    expect(response.trace.operational_note).toContain('correo');
  });

  it('rejects a local phone correction without country code', async () => {
    class StandalonePhoneRuntime extends FakeRuntime {
      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        if (request.userMessage.includes('954779071')) {
          return {
            intent: 'cerrar',
            intentConfidence: 0.95,
            eventType: 'boda',
            vendorCategory: 'Fotografía y video',
            vendorCategories: ['Fotografía y video'],
            activeNeedCategory: 'Fotografía y video',
            location: 'Lima',
            budgetSignal: null,
            guestRange: '51-100',
            preferences: [],
            hardConstraints: [],
            assumptions: [],
            conversationSummary: 'El usuario quiere cerrar y dio su teléfono.',
            selectedProviderHints: [],
            pauseRequested: false,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          };
        }

        return await super.extract(request);
      }
    }

    const runtime = new StandalonePhoneRuntime();
    const planStore = new RecordingPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-standalone-phone',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-standalone-phone',
      }),
      {
        current_node: 'crear_lead_cerrar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        contact_name: 'Carolina',
        contact_email: 'carolina@example.com',
        contact_phone: null,
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [1],
            selected_provider_hints: [],
          },
        ],
      },
    );

    await planStore.save({ plan: seededPlan, reason: 'seed' });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-standalone-phone',
      text: 'mi telefono es 954779071',
      messageId: 'msg-standalone-phone',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.contact_phone).toBeNull();
    expect(response.plan.contact_name).toBe('Carolina');
    expect(response.plan.contact_email).toBe('carolina@example.com');
    expect(response.trace.operational_note).toContain('código de país');
  });

  it('rejects the incomplete Peru phone from the close-flow logs', async () => {
    class IncompleteInternationalPhoneRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'cerrar',
          intentConfidence: 0.95,
          eventType: 'boda',
          vendorCategory: 'Fotografía y video',
          vendorCategories: ['Fotografía y video'],
          activeNeedCategory: 'Fotografía y video',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere cerrar y dio un teléfono incompleto.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: 'Gabriela',
          contactEmail: 'gabriela@example.com',
          contactPhone: '+51 95477906',
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new IncompleteInternationalPhoneRuntime();
    const planStore = new RecordingPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-incomplete-pe-phone',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-incomplete-pe-phone',
      }),
      {
        current_node: 'crear_lead_cerrar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        contact_name: 'Gabriela',
        contact_email: 'gabriela@example.com',
        contact_phone: null,
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'Fotografía y video',
                location: 'Lima',
                priceLevel: 'mid',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_ids: [1],
            selected_provider_hints: [],
          },
        ],
      },
    );
    await planStore.save({ plan: seededPlan, reason: 'seed' });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-incomplete-pe-phone',
      text: 'mi teelfono es entonces +51 95477906',
      messageId: 'msg-incomplete-pe-phone',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.contact_phone).toBeNull();
    expect(response.trace.operational_note).toContain('incompleto');
    expect(response.trace.tools_called).not.toContain('finish_plan');
  });

  it('seeds contact phone from webhook payload and skips asking for it', async () => {
    const runtime = new FakeRuntime();
    const planStore = new RecordingPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-webhook-phone',
      text: 'Busco fotógrafo para mi boda en Lima',
      messageId: 'msg-webhook',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51 954 779 071',
    });

    expect(response.plan.contact_phone).toBe('51954779071');
    expect(response.trace.operational_note).toBeNull();
  });

  it('splits Peruvian phone numbers correctly in finish_plan', async () => {
    class FinishGateway extends FakeGateway {
      public lastQuoteRequest: QuoteRequestInput | null = null;

      override async createQuoteRequest(
        input: QuoteRequestInput,
      ): Promise<Record<string, unknown>> {
        this.lastQuoteRequest = input;
        return { ok: true, input };
      }
    }

    const gateway = new FinishGateway();
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'plan-finish-pe',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-finish-pe',
      }),
      {
        contact_name: 'Carolina',
        contact_email: 'carolina@example.com',
        contact_phone: '51954779071',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [],
            selected_provider_ids: [1],
            selected_provider_hints: [],
          },
        ],
      },
    );

    const result = await executeFinishPlanTool({
      plan: plan as unknown as PersistedPlan,
      providerGateway: gateway,
    });

    expect(result.status).toBe('success');
    expect(gateway.lastQuoteRequest?.phone).toBe('954779071');
    expect(gateway.lastQuoteRequest?.phoneExtension).toBe('+51');
  });

  it('splits Mexican phone numbers correctly in finish_plan', async () => {
    class FinishGateway extends FakeGateway {
      public lastQuoteRequest: QuoteRequestInput | null = null;

      override async createQuoteRequest(
        input: QuoteRequestInput,
      ): Promise<Record<string, unknown>> {
        this.lastQuoteRequest = input;
        return { ok: true, input };
      }
    }

    const gateway = new FinishGateway();
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'plan-finish-mx',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-finish-mx',
      }),
      {
        contact_name: 'Carlos',
        contact_email: 'carlos@example.com',
        contact_phone: '525512345678',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [],
            selected_provider_ids: [1],
            selected_provider_hints: [],
          },
        ],
      },
    );

    const result = await executeFinishPlanTool({
      plan: plan as unknown as PersistedPlan,
      providerGateway: gateway,
    });

    expect(result.status).toBe('success');
    expect(gateway.lastQuoteRequest?.phone).toBe('5512345678');
    expect(gateway.lastQuoteRequest?.phoneExtension).toBe('+52');
  });

  it('selects multiple providers by ordinal from the active shortlist', async () => {
    class MultiOrdinalRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.97,
          eventType: 'boda',
          vendorCategory: 'Catering',
          vendorCategories: ['Catering'],
          activeNeedCategory: 'Catering',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario eligió la primera y la tercera opción.',
          selectedProviderHints: ['primera y tercera'],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
        };
      }
    }

    const runtime = new MultiOrdinalRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-multi-ordinal',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-multi-ordinal',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Catering',
        vendor_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [101, 102, 103],
            recommended_providers: [
              { id: 101, title: 'EDO', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              { id: 102, title: 'Mesa Central', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              { id: 103, title: 'Dulcefina', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );
    await planStore.save({ plan: seededPlan, reason: 'seed' });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-multi-ordinal',
      text: 'me quedo con la primera y la tercera',
      messageId: 'msg-multi-ordinal',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.selected_provider_ids).toEqual([101, 103]);
    expect(gateway.searchCalls).toBe(0);
  });

  it('selects multiple providers by name and continues to a new need via secondary intent', async () => {
    class MultiIntentRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          secondaryIntents: ['confirmar_proveedor'],
          intentConfidence: 0.97,
          eventType: 'boda',
          vendorCategory: 'Música',
          vendorCategories: ['Música'],
          activeNeedCategory: 'Música',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario eligió dos caterings y ahora quiere música.',
          selectedProviderHints: ['EDO', 'Dulcefina'],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: {
            ...testProviderFitCriteria,
            needCategory: 'música',
          },
        };
      }
    }

    class MusicGateway extends FakeGateway {
      override async searchProviders(): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;
        return {
          providers: [
            {
              id: 201,
              title: 'DJ Pulga',
              category: 'Música',
              location: 'Lima',
              priceLevel: 'mid',
              reason: 'coincide con el plan',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
        };
      }

      override async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
        if (providerId === 201) {
          return {
            id: 201,
            title: 'DJ Pulga',
            slug: 'dj-pulga',
            category: 'Música',
            location: 'Lima',
            priceLevel: 'mid',
            rating: null,
            reason: 'coincide con el plan',
            detailUrl: null,
            websiteUrl: null,
            minPrice: null,
            maxPrice: null,
            promoBadge: null,
            promoSummary: null,
            descriptionSnippet: 'DJ para eventos.',
            serviceHighlights: [],
            termsHighlights: [],
            description: 'DJ para eventos.',
            eventTypes: ['boda'],
            raw: {},
          };
        }
        return await super.getProviderDetail(providerId);
      }
    }

    const runtime = new MultiIntentRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new MusicGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-multi-intent-selection',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-multi-intent-selection',
      }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Catering',
        vendor_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [101, 103],
            recommended_providers: [
              { id: 101, title: 'EDO', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              { id: 103, title: 'Dulcefina', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );
    await planStore.save({ plan: seededPlan, reason: 'seed' });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-multi-intent-selection',
      text: 'ok EDO y Dulcefina, ahora necesito música',
      messageId: 'msg-multi-intent-selection',
      receivedAt: new Date().toISOString(),
    });

    const cateringNeed = response.plan.provider_needs.find((need) => need.category === 'Catering');
    expect(cateringNeed?.selected_provider_ids).toEqual([101, 103]);
    expect(response.plan.active_need_category).toBe('Música');
    expect(response.plan.current_node).toBe('recomendar');
    expect(gateway.searchCalls).toBe(1);
  });

  it('creates one quote request per selected provider in finish_plan', async () => {
    class FinishGateway extends FakeGateway {
      public readonly quoteRequests: QuoteRequestInput[] = [];

      override async createQuoteRequest(
        input: QuoteRequestInput,
      ): Promise<Record<string, unknown>> {
        this.quoteRequests.push(input);
        return { ok: true, input };
      }
    }

    const gateway = new FinishGateway();
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'plan-finish-multiple',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-finish-multiple',
      }),
      {
        contact_name: 'Carolina',
        contact_email: 'carolina@example.com',
        contact_phone: '51954779071',
        provider_needs: [
          {
            category: 'Catering',
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [101, 103],
            recommended_providers: [],
            selected_provider_ids: [101, 103],
            selected_provider_hints: ['EDO', 'Dulcefina'],
          },
        ],
      },
    );

    const result = await executeFinishPlanTool({
      plan: plan as unknown as PersistedPlan,
      providerGateway: gateway,
    });

    expect(result.status).toBe('success');
    expect(gateway.quoteRequests.map((request) => request.providerId)).toEqual([
      101,
      103,
    ]);
  });

  it('runs multi-need elicitation and stores independent shortlists', async () => {
    class ElicitationRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: ['Catering', 'Música'],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: 'medio',
          guestRange: '51-100',
          preferences: ['elegante', 'cena tipo estaciones', 'música en vivo'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda elegante en Lima para 80 personas.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [
            {
              category: 'Catering',
              label: 'Catering para boda',
              priority: 1,
              queries: [providerNeedQuery('Catering', 'Catering para boda', ['catering elegante para boda en Lima'])],
              preferences: ['elegante', 'cena tipo estaciones'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'catering' },
            },
            {
              category: 'Música',
              label: 'Música para boda',
              priority: 2,
              queries: [providerNeedQuery('Música', 'Música para boda', ['música para boda elegante en Lima'])],
              preferences: ['elegante', 'música en vivo'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'música' },
            },
          ],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    class MultiNeedGateway extends FakeGateway {
      public readonly queryIntentCategories: string[] = [];

      override async searchProvidersByQueryIntent(
        input: QueryIntentProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.queryIntentCategories.push(input.category);
        return {
          providers: [
            {
              id: input.category === 'Catering' ? 301 : 401,
              title: input.category === 'Catering' ? 'Mesa Clara' : 'DJ Noche',
              category: input.category,
              location: 'Lima',
              priceLevel: 'mid',
              reason: 'coincide con la necesidad',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
        };
      }

      override async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
        const isCatering = providerId === 301;
        return {
          id: providerId,
          title: isCatering ? 'Mesa Clara' : 'DJ Noche',
          slug: isCatering ? 'mesa-clara' : 'dj-noche',
          category: isCatering ? 'Catering' : 'Música',
          location: 'Lima',
          priceLevel: 'mid',
          rating: null,
          reason: 'coincide con la necesidad',
          detailUrl: null,
          websiteUrl: null,
          minPrice: null,
          maxPrice: null,
          promoBadge: null,
          promoSummary: null,
          descriptionSnippet: isCatering ? 'Catering para bodas.' : 'DJ para bodas.',
          serviceHighlights: [],
          termsHighlights: [],
          description: isCatering ? 'Catering para bodas.' : 'DJ para bodas.',
          eventTypes: ['boda'],
          raw: {},
        };
      }
    }

    const gateway = new MultiNeedGateway();
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime: new ElicitationRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-elicit',
      text: 'quiero planear una boda elegante en Lima para 80 personas',
      messageId: 'msg-elicit',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('elicitacion_necesidades');
    expect(response.trace.search_strategy).toBe('multi_need_query_intents');
    expect(gateway.queryIntentCategories).toEqual(['Catering', 'Música']);
    expect(response.plan.provider_needs).toHaveLength(2);
    expect(response.plan.provider_needs.find((need) => need.category === 'Catering')?.recommended_provider_ids).toEqual([301]);
    expect(response.plan.provider_needs.find((need) => need.category === 'Música')?.recommended_provider_ids).toEqual([401]);
  });

  it('does not search structured query intents until global location is known', async () => {
    class MissingLocationRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.96,
          eventType: 'cumpleanos',
          vendorCategory: 'Música',
          vendorCategories: ['Música'],
          activeNeedCategory: 'Música',
          location: null,
          budgetSignal: null,
          guestRange: '21-50',
          preferences: ['DJ'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Cumpleaños de 30 personas con DJ; falta ubicación.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: {
            ...testProviderFitCriteria,
            eventType: 'cumpleanos',
            needCategory: 'Música',
            location: null,
          },
          providerQueryIntents: [
            {
              category: 'Música',
              label: 'DJ para cumpleaños',
              priority: 1,
              queries: [
                providerNeedQuery(
                  'Música',
                  'DJ para cumpleaños',
                  ['DJ para cumpleaños de 30 personas'],
                  ['DJ'],
                ),
              ],
              preferences: ['DJ'],
              hardConstraints: [],
              missingFields: ['location'],
              retrievalReady: true,
              fitCriteria: {
                ...testProviderFitCriteria,
                eventType: 'cumpleanos',
                needCategory: 'Música',
                location: null,
              },
            },
          ],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new MissingLocationRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-missing-location-query-intent',
      text: 'Quiero DJ para un cumpleaños de 30 personas.',
      messageId: 'msg-missing-location-query-intent',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('aclarar_pedir_faltante');
    expect(response.plan.location).toBeNull();
    expect(response.trace.search_ready).toBe(false);
    expect(response.trace.missing_fields).toContain('location');
    expect(response.trace.tools_called).not.toContain('search_providers_by_query_intent');
    expect(gateway.searchCalls).toBe(0);
  });

  it('does not let a focused need bypass missing global location', async () => {
    class MissingLocationFocusedNeedRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: 'Catering',
          vendorCategories: ['Catering'],
          activeNeedCategory: 'Catering',
          location: null,
          budgetSignal: 'medio',
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda con catering y presupuesto; falta ubicación.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: {
            ...testProviderFitCriteria,
            needCategory: 'Catering',
            location: null,
          },
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new MissingLocationFocusedNeedRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-missing-location-focused-need',
      text: 'Necesito catering para una boda de 80 personas con presupuesto medio.',
      messageId: 'msg-missing-location-focused-need',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('aclarar_pedir_faltante');
    expect(response.trace.search_ready).toBe(false);
    expect(response.trace.missing_fields).toContain('location');
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
    expect(gateway.searchCalls).toBe(0);
  });

  it('does not let stale active need downgrade a current multi-need provider request', async () => {
    class MultiFrontRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: ['Catering', 'Música', 'Locales'],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: 'medio-alto',
          guestRange: '101-200',
          preferences: ['sushi', 'banda elegante', 'local sofisticado'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda moderna en Lima con varios frentes de proveedores.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [
            {
              category: 'Catering',
              label: 'Catering',
              priority: 1,
              queries: [providerNeedQuery('Catering', 'Sushi', ['catering sushi boda Lima'], ['sushi'])],
              preferences: ['sushi'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: true,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Catering' },
            },
            {
              category: 'Música',
              label: 'Música',
              priority: 2,
              queries: [providerNeedQuery('Música', 'Banda', ['banda elegante boda Lima'], ['banda'])],
              preferences: ['banda elegante'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: true,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Música' },
            },
            {
              category: 'Locales',
              label: 'Locales',
              priority: 3,
              queries: [providerNeedQuery('Locales', 'Local', ['local noche sofisticado Lima'], ['sofisticado'])],
              preferences: ['noche sofisticada'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: true,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Locales' },
            },
          ],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    class MultiFrontGateway extends FakeGateway {
      public readonly queryIntentCategories: string[] = [];

      override async searchProviders(): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;
        return { providers: [] };
      }

      override async searchProvidersByQueryIntent(
        input: QueryIntentProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.queryIntentCategories.push(input.category);
        const idByCategory = {
          Catering: 301,
          Música: 401,
          Locales: 501,
        } satisfies Record<'Catering' | 'Música' | 'Locales', number>;
        const id = idByCategory[input.category as 'Catering' | 'Música' | 'Locales'];
        return {
          providers: [
            {
              id,
              title: `${input.category} Uno`,
              category: input.category,
              location: 'Lima',
              priceLevel: 'mid',
              reason: 'coincide con el frente solicitado',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-stale-catering',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-stale-catering',
        }),
        {
          current_node: 'recomendar',
          event_type: 'boda',
          active_need_category: 'Catering',
          location: 'Lima',
          budget_signal: 'medio-alto',
          guest_range: '101-200',
          provider_needs: [
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: ['buffet'],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [101],
              recommended_providers: [
                { id: 101, title: 'Catering Viejo', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: 'shortlist previa', serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const gateway = new MultiFrontGateway();
    const service = new AgentService({
      planStore,
      runtime: new MultiFrontRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-stale-catering',
      text: 'Quiero comparar catering, música y local para una boda moderna en Lima',
      messageId: 'msg-stale-catering',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('elicitacion_necesidades');
    expect(response.trace.search_strategy).toBe('multi_need_query_intents');
    expect(response.trace.turn_decision.routeKind).toBe('multi_need_search');
    expect(response.trace.turn_decision.nextNode).toBe(response.plan.current_node);
    expect(response.trace.turn_decision.providerSearchMode).toBe('multi_need_query_intents');
    expect(response.trace.presentation_scope).toBe('multi_need');
    expect(response.trace.state_machine_invariant_status).toBe('valid');
    expect(gateway.searchCalls).toBe(0);
    expect(gateway.queryIntentCategories).toEqual(['Catering', 'Música', 'Locales']);
  });

  it('uses matching session focus for single-need search without stale durable focus', async () => {
    class FocusedRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.92,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: [],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: '$$',
          guestRange: '51-100',
          preferences: ['elegante'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario pide seguir viendo opciones del frente activo.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed-session-focus-plan',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-session-focus',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-session-focus',
        }),
        {
          current_node: 'elicitacion_necesidades',
          event_type: 'boda',
          active_need_category: 'Catering',
          location: 'Lima',
          budget_signal: '$$',
          guest_range: '51-100',
          provider_needs: [
            {
              category: 'Catering',
              status: 'identified',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [],
              recommended_providers: [],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
            {
              category: 'Música',
              status: 'identified',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [],
              recommended_providers: [],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });
    await planStore.saveSessionFocus('terminal_whatsapp', 'user-session-focus', {
      sessionId: 'session-music',
      activeNeedCategory: 'Música',
      lastPresentedCategories: ['Música'],
      lastPresentedProviderIds: [],
      lastNode: 'elicitacion_necesidades',
      updatedAt: new Date().toISOString(),
    });

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime: new FocusedRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-session-focus',
      text: 'muéstrame opciones',
      messageId: 'msg-session-focus',
      receivedAt: new Date().toISOString(),
      sessionId: 'session-music',
    });

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.plan.active_need_category).toBe('Música');
    expect(response.trace.session_focus_used).toBe(true);
    expect(response.trace.turn_decision.routeKind).toBe('single_need_search');
    expect(response.trace.turn_decision.focusNeedCategory).toBe('Música');
    expect(response.trace.turn_decision.nextNode).toBe(response.plan.current_node);
    expect(gateway.searchCalls).toBe(1);
  });

  it('stores per-sub-query provenance and selected providers for complex needs', async () => {
    class ComplexCateringRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: ['Catering'],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: 'medio-alto',
          guestRange: '101-200',
          preferences: ['sushi', 'torta para novios'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda en Lima con catering de sushi y torta.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: { ...testProviderFitCriteria, needCategory: 'Catering' },
          providerQueryIntents: [
            {
              category: 'Catering',
              label: 'Catering para boda',
              priority: 1,
              queries: [
                {
                  id: 'sushi',
                  label: 'sushi',
                  category: 'Catering',
                  queryStrings: ['catering con sushi en Lima'],
                  mustHave: ['sushi'],
                  shouldAvoid: [],
                  maxSelections: 1,
                  allowCrossCategory: false,
                },
                {
                  id: 'torta',
                  label: 'torta para novios',
                  category: 'Catering',
                  queryStrings: ['torta para novios en Lima'],
                  mustHave: ['torta'],
                  shouldAvoid: [],
                  maxSelections: 1,
                  allowCrossCategory: false,
                },
              ],
              preferences: ['sushi', 'torta para novios'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: true,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Catering' },
            },
          ],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    class ComplexCateringGateway extends FakeGateway {
      private readonly providers = new Map<number, ProviderSummary>();

      override async searchProvidersByQueryIntent(
        input: QueryIntentProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        const isSushi = input.queryStrings.join(' ').includes('sushi');
        const providers: ProviderSummary[] = isSushi
            ? [
                {
                  id: 109,
                  title: 'Edo Sushi Bar',
                  category: 'Catering',
                  location: 'Lima',
                  priceLevel: 'high',
                  reason: null,
                  descriptionSnippet: 'Catering de sushi para eventos.',
                  serviceHighlights: ['Catering de sushi para eventos'],
                  termsHighlights: [],
                  retrievalScore: 0.9,
                },
                {
                  id: 135,
                  title: 'Paola Puerta Catering',
                  category: 'Catering',
                  location: 'Lima',
                  priceLevel: 'very_high',
                  reason: null,
                  descriptionSnippet: 'Catering para matrimonios.',
                  serviceHighlights: ['Catering para matrimonios'],
                  termsHighlights: [],
                  retrievalScore: 0.7,
                },
              ]
            : [
                {
                  id: 220,
                  title: 'Dulce Boda',
                  category: 'Catering',
                  location: 'Lima',
                  priceLevel: 'mid',
                  reason: null,
                  descriptionSnippet: 'Torta para novios y mesa dulce.',
                  serviceHighlights: ['Torta para novios'],
                  termsHighlights: [],
                  retrievalScore: 0.86,
                },
              ];
        for (const provider of providers) {
          this.providers.set(provider.id, provider);
        }
        return { providers };
      }

      override async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
        const provider = this.providers.get(providerId);
        if (!provider) {
          return null;
        }
        return {
          ...provider,
          eventTypes: ['boda'],
          raw: {},
        };
      }
    }

    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new ComplexCateringRuntime(),
      providerGateway: new ComplexCateringGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-complex-catering',
      text: 'quiero catering con sushi y torta para novios',
      messageId: 'msg-complex-catering',
      receivedAt: new Date().toISOString(),
    });

    const cateringNeed = response.plan.provider_needs.find((need) => need.category === 'Catering');
    expect(cateringNeed?.recommended_provider_ids).toEqual([109, 220]);
    expect(cateringNeed?.sub_query_results?.map((result) => result.subQuery.label)).toEqual([
      'sushi',
      'torta para novios',
    ]);
    expect(cateringNeed?.sub_query_results?.map((result) => result.selected_provider_ids)).toEqual([
      [109],
      [220],
    ]);
  });

  it('caps detailed elicitation searches while keeping extra needs identified', async () => {
    const categories = [
      'Catering',
      'Fotografía y video',
      'Música',
      'Florería y papelería',
      'Locales',
      'Wedding planners',
    ] as const;

    class CappedDetailedRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: [...categories],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: 'medio',
          guestRange: '101-200',
          preferences: ['sushi', 'fotos naturales', 'música en vivo', 'flores minimalistas'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda detallada con varias necesidades.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: categories.map((category, index) => ({
            category,
            label: category,
            priority: index + 1,
            queries: category === 'Catering'
              ? [
                  providerNeedQuery(category, 'sushi', ['catering sushi Lima'], ['sushi']),
                  providerNeedQuery(category, 'estaciones', ['estaciones de comida Lima'], ['estaciones']),
                  providerNeedQuery(category, 'torta', ['torta para novios Lima'], ['torta']),
                  providerNeedQuery(category, 'mesa dulce', ['mesa dulce Lima'], ['mesa dulce']),
                ]
              : [providerNeedQuery(category, category, [`${category} para boda Lima`])],
            preferences: [category],
            hardConstraints: [],
            missingFields: [],
            retrievalReady: false,
            fitCriteria: {
              ...testProviderFitCriteria,
              needCategory: category,
            },
          })),
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    class CappedGateway extends FakeGateway {
      public readonly calls: QueryIntentProviderSearchInput[] = [];

      override async searchProvidersByQueryIntent(
        input: QueryIntentProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.calls.push(input);
        return { providers: [] };
      }
    }

    const gateway = new CappedGateway();
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new CappedDetailedRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-capped-detailed',
      text: 'boda en Lima con sushi, estaciones, torta, música, fotos y flores',
      messageId: 'msg-capped-detailed',
      receivedAt: new Date().toISOString(),
    });

    expect(response.trace.search_strategy).toBe('multi_need_query_intents');
    expect(response.plan.provider_needs.map((need) => need.category)).toEqual([...categories]);
    expect(response.plan.provider_needs.at(-1)?.status).toBe('identified');
    expect(gateway.calls).toHaveLength(7);
    expect(gateway.calls.filter((call) => call.category === 'Catering')).toHaveLength(3);
    expect(gateway.calls.some((call) => call.queryStrings.includes('mesa dulce Lima'))).toBe(false);
  });

  it('searches detailed elicitation when details live inside query intents', async () => {
    class DetailedQueryIntentRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: ['Catering', 'Fotografía y video', 'Música', 'Florería y papelería'],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: null,
          guestRange: '101-200',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda moderna en Lima para 120 personas con sushi, música en vivo, fotos naturales y flores minimalistas.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [
            {
              category: 'Catering',
              label: 'Catering con sushi',
              priority: 1,
              queries: [providerNeedQuery('Catering', 'Catering con sushi', ['catering sushi boda Lima 120 personas'])],
              preferences: [],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Catering' },
            },
            {
              category: 'Fotografía y video',
              label: 'Fotografía para novios',
              priority: 2,
              queries: [providerNeedQuery('Fotografía y video', 'Fotografía para novios', ['fotografía natural novios boda Lima'])],
              preferences: [],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Fotografía y video' },
            },
            {
              category: 'Música',
              label: 'Música en vivo',
              priority: 3,
              queries: [providerNeedQuery('Música', 'Música en vivo', ['música en vivo boda Lima'])],
              preferences: [],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Música' },
            },
            {
              category: 'Florería y papelería',
              label: 'Flores minimalistas',
              priority: 4,
              queries: [providerNeedQuery('Florería y papelería', 'Flores minimalistas', ['flores minimalistas boda Lima'])],
              preferences: [],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Florería y papelería' },
            },
          ],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    class QueryIntentGateway extends FakeGateway {
      public readonly categories: string[] = [];
      private readonly providers = new Map<number, ProviderSummary>();

      override async searchProvidersByQueryIntent(
        input: QueryIntentProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.categories.push(input.category);
        const provider: ProviderSummary = {
          id: this.categories.length + 500,
          title: `${input.category} Uno`,
          category: input.category,
          location: 'Lima',
          priceLevel: 'mid',
          reason: 'coincide con la necesidad',
          serviceHighlights: [],
          termsHighlights: [],
        };
        this.providers.set(provider.id, provider);
        return { providers: [provider] };
      }

      override async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
        const provider = this.providers.get(providerId);
        return provider ? { ...provider, eventTypes: ['boda'], raw: {} } : null;
      }
    }

    const gateway = new QueryIntentGateway();
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new DetailedQueryIntentRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-detailed-query-intents',
      text: 'quiero una boda moderna en Lima para 120 personas, cena con sushi, música en vivo, fotos naturales, flores minimalistas, fotografia especializada para novios, torta para novios',
      messageId: 'msg-detailed-query-intents',
      receivedAt: new Date().toISOString(),
    });

    expect(response.trace.search_strategy).toBe('multi_need_query_intents');
    expect(gateway.categories).toEqual([
      'Catering',
      'Fotografía y video',
      'Música',
      'Florería y papelería',
    ]);
    expect(response.plan.provider_needs.every((need) => need.status === 'shortlisted')).toBe(true);
  });

  it('renders detailed elicitation results as grouped multi-need output', async () => {
    class StructuredElicitationRuntime extends FakeRuntime {
      public readonly composeNodes: string[] = [];

      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: ['Catering', 'Música'],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: null,
          guestRange: '101-200',
          preferences: ['sushi', 'música en vivo'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda con catering y música.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [
            {
              category: 'Catering',
              label: 'Catering con sushi',
              priority: 1,
              queries: [providerNeedQuery('Catering', 'Catering con sushi', ['catering sushi boda Lima'])],
              preferences: ['sushi'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Catering' },
            },
            {
              category: 'Música',
              label: 'Música en vivo',
              priority: 2,
              queries: [providerNeedQuery('Música', 'Música en vivo', ['música en vivo boda Lima'])],
              preferences: ['música en vivo'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'Música' },
            },
          ],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }

      override async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        this.composeNodes.push(request.currentNode);
        return {
          text: '',
          structuredMessage: {
            type: 'multi_need_recommendation',
            intro_es: 'Busqué proveedores de Sin Envolturas que encajan con tu plan.',
            needs: request.plan.provider_needs
              .filter((need) => need.recommended_providers.length > 0)
              .map((need) => ({
                category: need.category,
                summary_es: `Opciones para ${need.category}.`,
                providers: need.recommended_providers.map((provider) => ({
                  provider_id: provider.id,
                  rationale_es: 'Encaja con lo que pediste para este frente.',
                  caveat_es: null,
                })),
              })),
            next_step_es: 'Podemos revisar frente por frente para confirmar, cambiar o quitar opciones.',
          },
        };
      }
    }

    class StructuredGateway extends FakeGateway {
      override async searchProvidersByQueryIntent(
        input: QueryIntentProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        return {
          providers: [
            {
              id: input.category === 'Catering' ? 701 : 801,
              title: input.category === 'Catering' ? 'Sushi Mesa' : 'Banda Clara',
              category: input.category,
              location: 'Lima',
              priceLevel: 'mid',
              reason: 'coincide con la necesidad',
              detailUrl: `https://sinenvolturas.com/proveedores/${input.category === 'Catering' ? 'sushi-mesa' : 'banda-clara'}`,
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
        };
      }

      override async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
        const isCatering = providerId === 701;
        return {
          id: providerId,
          title: isCatering ? 'Sushi Mesa' : 'Banda Clara',
          slug: isCatering ? 'sushi-mesa' : 'banda-clara',
          category: isCatering ? 'Catering' : 'Música',
          location: 'Lima',
          priceLevel: 'mid',
          rating: null,
          reason: 'coincide con la necesidad',
          detailUrl: `https://sinenvolturas.com/proveedores/${isCatering ? 'sushi-mesa' : 'banda-clara'}`,
          websiteUrl: null,
          minPrice: null,
          maxPrice: null,
          promoBadge: null,
          promoSummary: null,
          descriptionSnippet: null,
          serviceHighlights: [],
          termsHighlights: [],
          description: null,
          eventTypes: ['boda'],
          raw: {},
        };
      }
    }

    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new StructuredElicitationRuntime(),
      providerGateway: new StructuredGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-structured-multi',
      text: 'quiero una boda con sushi y música en vivo',
      messageId: 'msg-structured-multi',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('elicitacion_necesidades');
    expect(response.outbound.text).toContain('Busqué proveedores de Sin Envolturas');
    expect(response.outbound.text).toContain('Catering\nOpciones para Catering.\n1. Sushi Mesa (Lima · $$)');
    expect(response.outbound.text).toContain('Música\nOpciones para Música.\n1. Banda Clara (Lima · $$)');
    expect(response.outbound.text).not.toContain('Ubicación:');
    expect(response.outbound.text).toContain('Podemos revisar frente por frente');
  });

  it('does not create a starter plan for a generic greeting', async () => {
    class GenericGreetingRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        const categories = [
          'Locales',
          'Catering',
          'Fotografía y video',
          'Música',
          'Hogar y deco',
        ] as const;
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.82,
          eventType: 'otro',
          vendorCategory: null,
          vendorCategories: categories.map((category) => category),
          activeNeedCategory: null,
          location: null,
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: '',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: categories.map((category, index) => ({
            category,
            label: category,
            priority: index + 1,
            queries: [providerNeedQuery(category, category, [`${category} para evento`])],
            preferences: [],
            hardConstraints: [],
            missingFields: [],
            retrievalReady: false,
            fitCriteria: {
              ...testProviderFitCriteria,
              eventType: 'otro',
              needCategory: category,
              location: null,
            },
          })),
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }

      override async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        this.composeRequests.push(request);
        return {
          text: '',
          structuredMessage: {
            type: 'welcome',
            greeting_es: '¡Hola! Soy el asistente de Sin Envolturas.',
            ask_es: 'Puedo ayudarte de varias formas. Elige por dónde quieres empezar.',
            capability_lines_es: [
              'armar un plan con proveedores para tu evento',
              'responder preguntas sobre nuestros servicios',
              'consultar información de eventos asociados a tu correo o teléfono',
            ],
            requested_fields_es: [],
          },
        };
      }
    }

    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new GenericGreetingRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-generic-greeting',
      text: 'hola como puedes ayudarme?',
      messageId: 'msg-generic-greeting',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('entrevista');
    expect(response.trace.intent).toBeNull();
    expect(response.plan.provider_needs).toHaveLength(0);
    expect(response.outbound.text).toContain('Soy el asistente de Sin Envolturas');
    expect(response.outbound.text).toContain('Armar un plan con proveedores');
    expect(response.outbound.text).toContain('Consultar información de eventos');
  });

  it('keeps otro as a valid event type when planning evidence exists', async () => {
    class OtherEventRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.9,
          eventType: 'otro',
          vendorCategory: null,
          vendorCategories: ['Locales', 'Catering'],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Activación de marca en Lima para 80 personas.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: {
            ...testProviderFitCriteria,
            eventType: 'otro',
            location: 'Lima',
          },
          providerQueryIntents: [
            {
              category: 'Locales',
              label: 'Locales',
              priority: 1,
              queries: [providerNeedQuery('Locales', 'Locales', ['local para activación de marca en Lima'])],
              preferences: [],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: {
                ...testProviderFitCriteria,
                eventType: 'otro',
                needCategory: 'Locales',
                location: 'Lima',
              },
            },
            {
              category: 'Catering',
              label: 'Catering',
              priority: 2,
              queries: [providerNeedQuery('Catering', 'Catering', ['catering para activación de marca en Lima'])],
              preferences: [],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: false,
              fitCriteria: {
                ...testProviderFitCriteria,
                eventType: 'otro',
                needCategory: 'Catering',
                location: 'Lima',
              },
            },
          ],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new OtherEventRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-other-event',
      text: 'quiero planear una activación de marca en Lima para 80 personas',
      messageId: 'msg-other-event',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('elicitacion_necesidades');
    expect(response.plan.event_type).toBe('otro');
    expect(response.plan.provider_needs.map((need) => need.category)).toEqual([
      'Locales',
      'Catering',
      'Fotografía y video',
      'Música',
      'Hogar y deco',
    ]);
  });

  it('keeps broad event elicitation as a compact starter menu without searching every need', async () => {
    class BroadElicitationRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        const categories = [
          'Locales',
          'Catering',
          'Fotografía y video',
          'Música',
          'Hogar y deco',
          'Florería y papelería',
          'Wedding planners',
          'Vestidos',
          'Maquillaje',
          'Salud y belleza',
          'Licores',
          'Accesorios y zapatos',
          'Ternos y camisas',
          'Baile',
          'Otros',
        ] as const;
        return {
          intent: 'elicitar_necesidades',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: [...categories],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: 'medio',
          guestRange: '51-100',
          preferences: ['elegante'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda elegante en Lima para 80 personas.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: categories.map((category, index) => ({
            category,
            label: category,
            priority: index + 1,
            queries: [providerNeedQuery(category, category, [`${category} para evento`])],
            preferences: ['elegante'],
            hardConstraints: [],
            missingFields: ['fecha', 'distrito'],
            retrievalReady: false,
            fitCriteria: {
              ...testProviderFitCriteria,
              needCategory: category,
            },
          })),
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    class SearchCountingGateway extends FakeGateway {
      public queryIntentCalls = 0;

      override async searchProvidersByQueryIntent(
        input: QueryIntentProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        void input;
        this.queryIntentCalls += 1;
        return { providers: [] };
      }
    }

    const gateway = new SearchCountingGateway();
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime: new BroadElicitationRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-broad-elicit',
      text: 'quiero planear una boda elegante en Lima para 80 personas, presupuesto medio',
      messageId: 'msg-broad-elicit',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('elicitacion_necesidades');
    expect(response.trace.search_strategy).toBe('none');
    expect(gateway.queryIntentCalls).toBe(0);
    expect(response.plan.provider_needs.map((need) => need.category)).toEqual([
      'Locales',
      'Catering',
      'Fotografía y video',
      'Música',
      'Florería y papelería',
    ]);
    expect(response.plan.provider_needs.every((need) => need.status === 'identified')).toBe(true);
    expect(response.plan.provider_needs.every(
      (need) => need.missing_fields.join(',') === 'need_priority_confirmation',
    )).toBe(true);
  });

  it('routes broad multi-need provider search extraction into elicitation without searching', async () => {
    class BroadSearchRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.9,
          eventType: 'boda',
          vendorCategory: 'Catering',
          vendorCategories: ['Catering', 'Fotografía y video'],
          activeNeedCategory: 'Catering',
          location: 'Lima',
          budgetSignal: 'medio',
          guestRange: '51-100',
          preferences: ['elegante'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda elegante en Lima para 80 personas.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    class SearchCountingGateway extends FakeGateway {
      public searchCalls = 0;

      override async searchProviders(): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;
        return { providers: [] };
      }
    }

    const gateway = new SearchCountingGateway();
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new BroadSearchRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-broad-search-elicit',
      text: 'quiero planear una boda elegante en Lima para 80 personas, presupuesto medio',
      messageId: 'msg-broad-search-elicit',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('elicitacion_necesidades');
    expect(response.trace.search_strategy).toBe('none');
    expect(gateway.searchCalls).toBe(0);
    expect(response.plan.provider_needs.map((need) => need.category)).toEqual([
      'Locales',
      'Catering',
      'Fotografía y video',
      'Música',
      'Florería y papelería',
    ]);
  });

  it('applies event-type provider priorities during normal plan projection', async () => {
    class BirthdayRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.9,
          eventType: 'cumpleanos',
          vendorCategory: null,
          vendorCategories: [
            'Wedding planners',
            'Catering',
            'Locales',
            'Música',
            'Fotografía y video',
            'Hogar y deco',
            'Licores',
          ],
          activeNeedCategory: null,
          location: 'Lima',
          budgetSignal: '$$',
          guestRange: '21-50',
          preferences: ['divertido'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Cumpleaños en Lima para 40 personas.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new BirthdayRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-birthday-normal-priority',
      text: 'quiero planear un cumpleaños para 40 personas en Lima',
      messageId: 'msg-birthday-normal-priority',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.provider_needs.map((need) => need.category)).toEqual([
      'Locales',
      'Catering',
      'Música',
      'Fotografía y video',
      'Hogar y deco',
    ]);
    expect(response.plan.provider_needs.map((need) => need.category)).not.toContain(
      'Wedding planners',
    );
  });

  it('keeps off-priority categories when the user explicitly asks for them', async () => {
    class ExplicitBirthdayPlannerRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.92,
          eventType: 'cumpleanos',
          vendorCategory: 'Wedding planners',
          vendorCategories: ['Wedding planners', 'Catering', 'Locales'],
          activeNeedCategory: 'Wedding planners',
          location: 'Lima',
          budgetSignal: '$$',
          guestRange: '21-50',
          preferences: ['organizado'],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Cumpleaños en Lima con pedido explícito de wedding planner.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new ExplicitBirthdayPlannerRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-explicit-birthday-planner',
      text: 'quiero un wedding planner para un cumpleaños en Lima',
      messageId: 'msg-explicit-birthday-planner',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.active_need_category).toBe('Wedding planners');
    expect(response.plan.provider_needs.map((need) => need.category)).toContain(
      'Wedding planners',
    );
  });

  it('advances to the next stored shortlist after selecting providers', async () => {
    class SelectAndContinueRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'modificar_plan_proveedores',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: [],
          activeNeedCategory: null,
          location: null,
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere cotizar ambos locales y seguir.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [],
          providerPlanOperations: [
            {
              type: 'select_provider',
              category: 'Locales',
              preferences: [],
              hardConstraints: [],
              queryIntent: null,
              rerunSearch: false,
              provider: {
                providerId: 147,
                providerTitle: null,
                category: 'Locales',
                hint: null,
              },
              removeProvider: null,
              addProvider: null,
            },
            {
              type: 'select_provider',
              category: 'Locales',
              preferences: [],
              hardConstraints: [],
              queryIntent: null,
              rerunSearch: false,
              provider: {
                providerId: 181,
                providerTitle: null,
                category: 'Locales',
                hint: null,
              },
              removeProvider: null,
              addProvider: null,
            },
          ],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const localProviders = [
      {
        id: 147,
        title: 'Casa Club 147',
        category: 'Locales',
        location: 'Perú',
        priceLevel: 'high',
        reason: 'local recomendado',
        serviceHighlights: [],
        termsHighlights: [],
      },
      {
        id: 181,
        title: 'Fundo las Palmeras',
        category: 'Locales',
        location: 'Ica',
        priceLevel: 'high',
        reason: 'local recomendado',
        serviceHighlights: [],
        termsHighlights: [],
      },
    ] satisfies ProviderSummary[];
    const cateringProviders = [
      {
        id: 109,
        title: 'Edo Sushi Bar',
        category: 'Catering',
        location: 'Lima',
        priceLevel: 'high',
        reason: 'catering recomendado',
        serviceHighlights: [],
        termsHighlights: [],
      },
    ] satisfies ProviderSummary[];
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-select-continue',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-select-continue',
        }),
        {
          current_node: 'recomendar',
          event_type: 'boda',
          active_need_category: 'Locales',
          location: 'Lima',
          guest_range: '101-200',
          provider_needs: [
            {
              category: 'Locales',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [147, 181],
              recommended_providers: localProviders,
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [109],
              recommended_providers: cateringProviders,
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const runtime = new SelectAndContinueRuntime();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-select-continue',
      text: 'ok quiero cotizar ambos. agregalos y sigamos con otro tipo de proveedor',
      messageId: 'msg-select-continue',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.plan.active_need_category).toBe('Catering');
    expect(response.plan.recommended_provider_ids).toEqual([109]);
    expect(response.trace.search_strategy).toBe('existing_plan_shortlist');
    expect(runtime.composeRequests.at(-1)?.providerResults.map((provider) => provider.title)).toEqual([
      'Edo Sushi Bar',
    ]);
  });

  it('applies structured plan operations without keyword fallback', async () => {
    class OperationRuntime extends FakeRuntime {
      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        const base = await super.extract(request);
        return {
          ...base,
          intent: 'modificar_plan_proveedores',
          vendorCategory: null,
          vendorCategories: [],
          activeNeedCategory: null,
          selectedProviderHints: request.userMessage === 'structured delete with selected context'
            ? ['EDO']
            : [],
          selectedProviderReferences: request.userMessage === 'structured delete with selected context'
            ? [{
                providerId: 101,
                providerTitle: 'EDO',
                category: 'Catering',
                hint: null,
              }]
            : [],
          providerPlanOperations: request.userMessage.startsWith('structured delete')
            ? [{
                type: 'delete_need',
                category: 'Música',
                preferences: [],
                hardConstraints: [],
                queryIntent: null,
                rerunSearch: false,
                provider: null,
                removeProvider: null,
                addProvider: null,
              }]
            : [],
          providerQueryIntents: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-operations',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-operations',
      }),
      {
        current_node: 'elicitacion_necesidades',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Catering',
        provider_needs: [
          {
            category: 'Catering',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [101],
            recommended_providers: [
              { id: 101, title: 'EDO', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
          {
            category: 'Música',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [201],
            recommended_providers: [
              { id: 201, title: 'DJ Noche', category: 'Música', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
            ],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      },
    );
    await planStore.save({ plan: seededPlan, reason: 'seed' });
    const service = new AgentService({
      planStore,
      runtime: new OperationRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const noOperation = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-operations',
      text: 'please delete music but extractor emits no operation',
      messageId: 'msg-no-op',
      receivedAt: new Date().toISOString(),
    });
    expect(noOperation.plan.provider_needs.map((need) => need.category)).toContain('Música');

    const deferred = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-operations',
      text: 'structured delete with selected context',
      messageId: 'msg-delete-op-with-selected-context',
      receivedAt: new Date().toISOString(),
    });
    expect(
      deferred.plan.provider_needs.find((need) => need.category === 'Música')?.status,
    ).toBe('deferred');

    const deleted = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-operations',
      text: 'structured delete',
      messageId: 'msg-delete-op',
      receivedAt: new Date().toISOString(),
    });
    expect(deleted.plan.provider_needs.map((need) => need.category)).not.toContain('Música');
  });

  it('uses structured provider references to resolve close-time selections', async () => {
    class StructuredCloseSelectionRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'cerrar',
          intentConfidence: 0.97,
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
          conversationSummary: 'El usuario elige Kisu y quiere cerrar.',
          selectedProviderHints: [],
          selectedProviderReferences: [
            {
              providerId: 302,
              providerTitle: null,
              category: 'Catering',
              hint: null,
            },
          ],
          pauseRequested: false,
          contactName: 'Carolina',
          contactEmail: 'carolina@example.com',
          contactPhone: '+51954779067',
          providerFitCriteria: testProviderFitCriteria,
          closeAction: { type: 'confirm_close' },
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-structured-close-selection',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-structured-close-selection',
        }),
        {
          current_node: 'crear_lead_cerrar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Catering',
          contact_name: 'Carolina',
          contact_email: 'carolina@example.com',
          contact_phone: '+51954779067',
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [168],
              recommended_providers: [
                { id: 168, title: 'Filomena', category: 'Fotografía y video', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [168],
              selected_provider_hints: ['Filomena'],
            },
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [302],
              recommended_providers: [
                { id: 302, title: 'Kisu', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime: new StructuredCloseSelectionRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-structured-close-selection',
      text: 'Kisu y cerrar',
      messageId: 'msg-structured-close-selection',
      receivedAt: new Date().toISOString(),
    });

    const cateringNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Catering',
    );
    expect(response.plan.current_node).toBe('crear_lead_cerrar');
    expect(cateringNeed?.status).toBe('selected');
    expect(cateringNeed?.selected_provider_ids).toEqual([302]);
    expect(response.trace.operational_note).toBeNull();
    expect(gateway.searchCalls).toBe(0);
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
    expect(response.trace.close_action_summary).toEqual({
      type: 'confirm_close',
      category: null,
      reason_preview: null,
    });
    expect(response.trace.selection_resolution_summary.selected_provider_references).toEqual([
      {
        provider_id: 302,
        category: 'Catering',
        has_title: false,
        has_hint: false,
      },
    ]);
    expect(response.trace.contact_validation_summary.status).toBe('valid');
  });

  it('requires structured close actions before deferring an unresolved shortlist', async () => {
    class UnstructuredDeclineRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'cerrar',
          intentConfidence: 0.96,
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
          conversationSummary: 'El usuario escribió una negativa, pero no hay acción estructurada.',
          selectedProviderHints: [],
          selectedProviderReferences: [],
          pauseRequested: false,
          contactName: 'Carolina',
          contactEmail: 'carolina@example.com',
          contactPhone: '+51954779067',
          providerFitCriteria: testProviderFitCriteria,
          closeAction: null,
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-unstructured-decline',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-unstructured-decline',
        }),
        {
          current_node: 'crear_lead_cerrar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Catering',
          contact_name: 'Carolina',
          contact_email: 'carolina@example.com',
          contact_phone: '+51954779067',
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [168],
              recommended_providers: [
                { id: 168, title: 'Filomena', category: 'Fotografía y video', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [168],
              selected_provider_hints: ['Filomena'],
            },
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [302],
              recommended_providers: [
                { id: 302, title: 'Kisu', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime: new UnstructuredDeclineRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-unstructured-decline',
      text: 'ninguna, cerrar',
      messageId: 'msg-unstructured-decline',
      receivedAt: new Date().toISOString(),
    });

    const cateringNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Catering',
    );
    expect(cateringNeed?.status).toBe('shortlisted');
    expect(cateringNeed?.selected_provider_ids).toEqual([]);
    expect(response.trace.operational_note).toContain('Catering');
    expect(gateway.searchCalls).toBe(0);
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
  });

  it('uses structured defer close actions to close with a deferred need', async () => {
    class StructuredDeferRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'cerrar',
          intentConfidence: 0.97,
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
          conversationSummary: 'El usuario quiere cerrar dejando Catering sin proveedor.',
          selectedProviderHints: [],
          selectedProviderReferences: [],
          pauseRequested: false,
          contactName: 'Carolina',
          contactEmail: 'carolina@example.com',
          contactPhone: '+51954779067',
          providerFitCriteria: testProviderFitCriteria,
          closeAction: { type: 'defer_need', category: 'Catering' },
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-structured-defer',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-structured-defer',
        }),
        {
          current_node: 'crear_lead_cerrar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Catering',
          contact_name: 'Carolina',
          contact_email: 'carolina@example.com',
          contact_phone: '+51954779067',
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [168],
              recommended_providers: [
                { id: 168, title: 'Filomena', category: 'Fotografía y video', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [168],
              selected_provider_hints: ['Filomena'],
            },
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [302],
              recommended_providers: [
                { id: 302, title: 'Kisu', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime: new StructuredDeferRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-structured-defer',
      text: 'deja catering sin proveedor y cierra',
      messageId: 'msg-structured-defer',
      receivedAt: new Date().toISOString(),
    });

    const cateringNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Catering',
    );
    expect(response.plan.current_node).toBe('crear_lead_cerrar');
    expect(cateringNeed?.status).toBe('deferred');
    expect(response.trace.operational_note).toBeNull();
    expect(gateway.searchCalls).toBe(0);
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
  });

  it('keeps phone-extension clarification in close flow without provider search', async () => {
    class ExtensionClarificationRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'buscar_proveedores',
          intentConfidence: 0.81,
          eventType: null,
          vendorCategory: 'Catering',
          vendorCategories: ['Catering'],
          activeNeedCategory: 'Catering',
          location: null,
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario pregunta qué es el código de extensión telefónica.',
          selectedProviderHints: [],
          selectedProviderReferences: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          closeAction: {
            type: 'clarify',
            reason: 'Aclara que el código de país es el prefijo del teléfono y pide solo el teléfono completo.',
          },
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-extension-clarification',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-extension-clarification',
        }),
        {
          current_node: 'crear_lead_cerrar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Catering',
          contact_name: 'Gabriela',
          contact_email: 'gabriela@example.com',
          contact_phone: null,
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [168],
              recommended_providers: [
                { id: 168, title: 'Filomena', category: 'Fotografía y video', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [168],
              selected_provider_hints: ['Filomena'],
            },
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [302],
              recommended_providers: [
                { id: 302, title: 'Kisu', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime: new ExtensionClarificationRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-extension-clarification',
      text: 'que es un codigo de extension',
      messageId: 'msg-extension-clarification',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('crear_lead_cerrar');
    expect(response.trace.operational_note).toContain('código de país');
    expect(gateway.searchCalls).toBe(0);
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
  });

  it('keeps invalid standalone phone corrections in close flow without provider search', async () => {
    class InvalidClosePhoneRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: null,
          intentConfidence: 0.72,
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
          conversationSummary: 'El usuario envía un teléfono incompleto durante el cierre.',
          selectedProviderHints: ['Kisu'],
          selectedProviderReferences: [
            {
              providerId: 302,
              providerTitle: 'Kisu',
              category: 'Catering',
              hint: null,
            },
          ],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: '967',
          providerFitCriteria: testProviderFitCriteria,
          closeAction: null,
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-invalid-close-phone',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-invalid-close-phone',
        }),
        {
          current_node: 'crear_lead_cerrar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          contact_name: 'Gabriela',
          contact_email: 'gabriela@example.com',
          contact_phone: null,
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [168],
              recommended_providers: [
                { id: 168, title: 'Filomena', category: 'Fotografía y video', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [168],
              selected_provider_hints: ['Filomena'],
            },
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [302],
              recommended_providers: [
                { id: 302, title: 'Kisu', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime: new InvalidClosePhoneRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-invalid-close-phone',
      text: '967',
      messageId: 'msg-invalid-close-phone',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('crear_lead_cerrar');
    expect(response.plan.contact_phone).toBeNull();
    expect(
      response.plan.provider_needs.find((need) => need.category === 'Catering')?.selected_provider_ids,
    ).toEqual([]);
    expect(response.trace.contact_validation_summary.status).toBe('invalid');
    expect(gateway.searchCalls).toBe(0);
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
  });

  it('preserves selected providers when the same external user resumes to contact them', async () => {
    class ResumeCloseRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'cerrar',
          intentConfidence: 0.96,
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
          conversationSummary: 'El usuario quiere contactar a los proveedores seleccionados.',
          selectedProviderHints: [],
          selectedProviderReferences: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          closeAction: { type: 'request_contact' },
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed-selected-provider',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-same-user-selected-provider',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-same-number',
        }),
        {
          current_node: 'seguir_refinando_guardar_plan',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Fotografía y video',
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [168],
              recommended_providers: [
                {
                  id: 168,
                  title: 'Filomena',
                  category: 'Fotografía y video',
                  location: 'Lima',
                  priceLevel: 'mid',
                  reason: null,
                  serviceHighlights: [],
                  termsHighlights: [],
                },
              ],
              selected_provider_ids: [168],
              selected_provider_hints: ['Filomena'],
            },
          ],
        },
      ),
    });

    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime: new ResumeCloseRuntime(),
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-same-number',
      text: 'me ayudas a contactar proveedores',
      messageId: 'msg-same-number-contact',
      receivedAt: new Date().toISOString(),
    });

    const selectedNeed = response.plan.provider_needs.find(
      (need) => need.category === 'Fotografía y video',
    );
    expect(response.plan.current_node).toBe('crear_lead_cerrar');
    expect(selectedNeed?.selected_provider_ids).toEqual([168]);
    expect(selectedNeed?.selected_provider_hints).toEqual(['Filomena']);
    expect(response.trace.operational_note).toBeNull();
    expect(gateway.searchCalls).toBe(0);
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
  });

  it('supports all-needs recommendation explanations without new search', async () => {
    class ExplainAllRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'explicar_recomendacion',
          intentConfidence: 0.96,
          eventType: 'boda',
          vendorCategory: null,
          vendorCategories: [],
          activeNeedCategory: null,
          location: null,
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario pide justificar todo.',
          selectedProviderHints: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerQueryIntents: [],
          providerPlanOperations: [],
          providerExplanationRequest: {
            scope: 'all_needs',
            primaryProvider: {
              providerId: null,
              providerTitle: null,
              category: null,
              hint: null,
            },
            comparedProviders: [],
            category: null,
            categories: [],
            question: 'Justifica todas las opciones recomendadas.',
          },
          providerDetailRequest: null,
        };
      }

      override async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        this.composeRequests.push(request);
        return {
          text: '',
          structuredMessage: {
            type: 'generic',
            paragraphs_es: [
              'Estas recomendaciones se eligieron por encaje con cada frente guardado del plan.',
              'Catering: EDO encaja por comida para eventos. Música: DJ Noche encaja por formato de recepción.',
            ],
          },
        };
      }
    }

    class NoSearchGateway extends FakeGateway {
      public searchCount = 0;

      override async searchProviders(): Promise<ProviderGatewaySearchResult> {
        this.searchCount += 1;
        return { providers: [] };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-explain-all',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-explain-all',
        }),
        {
          current_node: 'elicitacion_necesidades',
          event_type: 'boda',
          active_need_category: 'Catering',
          provider_needs: [
            {
              category: 'Catering',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [101],
              recommended_providers: [
                { id: 101, title: 'EDO', category: 'Catering', location: 'Lima', priceLevel: 'mid', reason: 'catering para eventos', serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
            {
              category: 'Música',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [201],
              recommended_providers: [
                { id: 201, title: 'DJ Noche', category: 'Música', location: 'Lima', priceLevel: 'mid', reason: 'música para recepción', serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
      reason: 'seed',
    });

    const runtime = new ExplainAllRuntime();
    const gateway = new NoSearchGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-explain-all',
      text: 'justifica por qué elegiste estas opciones para todos los frentes',
      messageId: 'msg-explain-all',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('seguir_refinando_guardar_plan');
    expect(gateway.searchCount).toBe(0);
    expect(runtime.composeRequests.at(-1)?.extraction.providerExplanationRequest?.scope).toBe('all_needs');
    expect(runtime.composeRequests.at(-1)?.providerResults.map((provider) => provider.title)).toEqual([
      'EDO',
      'DJ Noche',
    ]);
    expect(response.outbound.text).toContain('Catering: EDO');
  });

  it('resends guest auth code on non-code follow-up while code challenge is active', async () => {
    const runtime = new InvitedEventRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new AuthScenarioGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
      renderers,
    });
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-code-resend',
          channel: 'terminal_whatsapp',
          externalUserId: 'maria@example.com',
        }),
        {
          current_node: 'consultar_evento_invitado',
          intent: 'consultar_evento_invitado',
          contact_email: 'maria@example.com',
          guest_auth: {
            status: 'code_requested',
            email: 'maria@example.com',
            token: null,
            token_expires_at: null,
            last_error: null,
            requested_at: '2026-06-11T00:00:00.000Z',
          },
        },
      ),
      reason: 'seed-code-requested',
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'maria@example.com',
      text: 'No me llega',
      messageId: 'msg-auth-resend',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.guest_auth.status).toBe('code_requested');
    expect(gateway.requestCodeCalls).toBe(1);
    expect(gateway.verifyCodeCalls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.errorMessage).toContain('reenvió');
    expect(response.trace.tools_called).toContain('request_guest_login_code');
  });

  it('does not coerce an unknown provider name to a similar generic first token', async () => {
    class UnknownProviderRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'modificar_plan_proveedores',
          intentConfidence: 0.92,
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
          conversationSummary: 'El usuario menciona Baby Baloo.',
          selectedProviderHints: [],
          selectedProviderReferences: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerPlanOperations: [
            {
              type: 'select_provider',
              category: 'Bebés',
              preferences: [],
              hardConstraints: [],
              queryIntent: null,
              rerunSearch: false,
              provider: {
                providerId: null,
                providerTitle: 'Baby Baloo',
                category: 'Bebés',
                hint: null,
              },
              removeProvider: null,
              addProvider: null,
            },
          ],
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-baby-baloo',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-baby-baloo',
        }),
        {
          current_node: 'recomendar',
          event_type: 'baby_shower',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Bebés',
          provider_needs: [
            {
              category: 'Bebés',
              status: 'shortlisted',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [73],
              recommended_providers: [
                { id: 73, title: 'Baby Loli', category: 'Bebés', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
          ],
        },
      ),
    });

    const service = new AgentService({
      planStore,
      runtime: new UnknownProviderRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-baby-baloo',
      text: 'quiero a baby baloo',
      messageId: 'msg-baby-baloo',
      receivedAt: new Date().toISOString(),
    });

    const need = response.plan.provider_needs.find((item) => item.category === 'Bebés');
    expect(need?.selected_provider_ids).toEqual([]);
    expect(need?.status).toBe('shortlisted');
    expect(response.trace.operational_note).toContain('No pude identificar');
  });

  it('clears selected provider state when applying unselect_provider', async () => {
    class UnselectRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'modificar_plan_proveedores',
          intentConfidence: 0.95,
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
          conversationSummary: 'El usuario ya no quiere Baby Loli.',
          selectedProviderHints: [],
          selectedProviderReferences: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: testProviderFitCriteria,
          providerPlanOperations: [
            {
              type: 'unselect_provider',
              category: 'Bebés',
              preferences: [],
              hardConstraints: [],
              queryIntent: null,
              rerunSearch: false,
              provider: {
                providerId: 73,
                providerTitle: null,
                category: 'Bebés',
                hint: null,
              },
              removeProvider: null,
              addProvider: null,
            },
          ],
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-unselect-provider',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-unselect-provider',
        }),
        {
          current_node: 'crear_lead_cerrar',
          event_type: 'baby_shower',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Bebés',
          provider_needs: [
            {
              category: 'Bebés',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [73],
              recommended_providers: [
                { id: 73, title: 'Baby Loli', category: 'Bebés', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [73],
              selected_provider_hints: ['Baby Loli'],
            },
          ],
        },
      ),
    });

    const service = new AgentService({
      planStore,
      runtime: new UnselectRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-unselect-provider',
      text: 'no quiero quedarme con baby loli',
      messageId: 'msg-unselect-provider',
      receivedAt: new Date().toISOString(),
    });

    const need = response.plan.provider_needs.find((item) => item.category === 'Bebés');
    expect(need?.selected_provider_ids).toEqual([]);
    expect(need?.selected_provider_hints).toEqual([]);
    expect(need?.status).toBe('shortlisted');
    expect(response.plan.selected_provider_ids).toEqual([]);
  });

  it('accepts a valid international phone from raw text even when extraction has a local phone', async () => {
    class PhoneCorrectionRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'cerrar',
          intentConfidence: 0.95,
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
          conversationSummary: 'El usuario corrige su teléfono.',
          selectedProviderHints: [],
          selectedProviderReferences: [],
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: '954779067',
          providerFitCriteria: testProviderFitCriteria,
          closeAction: { type: 'request_contact' },
          providerPlanOperations: [],
          providerQueryIntents: [],
          providerExplanationRequest: null,
          providerDetailRequest: null,
        };
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-phone-correction',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-phone-correction',
        }),
        {
          current_node: 'crear_lead_cerrar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          contact_name: 'Carolina',
          contact_email: 'carolina@example.com',
          contact_phone: null,
          provider_needs: [
            {
              category: 'Fotografía y video',
              status: 'selected',
              preferences: [],
              hard_constraints: [],
              missing_fields: [],
              recommended_provider_ids: [1],
              recommended_providers: [
                { id: 1, title: 'Foto Uno', category: 'Fotografía y video', location: 'Lima', priceLevel: 'mid', reason: null, serviceHighlights: [], termsHighlights: [] },
              ],
              selected_provider_ids: [1],
              selected_provider_hints: ['Foto Uno'],
            },
          ],
        },
      ),
    });

    const response = await new AgentService({
      planStore,
      runtime: new PhoneCorrectionRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-phone-correction',
      text: '+51 954779067',
      messageId: 'msg-phone-correction',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.contact_phone).toBe('51954779067');
    expect(response.trace.contact_validation_summary.status).toBe('valid');
    expect(response.trace.operational_note).toBeNull();
  });

  it('sanitizes file citation artifacts and avoids a final plain period', async () => {
    class CitationRuntime extends FakeRuntime {
      override async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        this.composeRequests.push(request);
        return { text: 'Puedes revisar tu lista aquí. filecite turn1 file 0' };
      }
    }

    const response = await new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new CitationRuntime(),
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-citation',
      text: 'hola, necesito proveedores',
      messageId: 'msg-citation',
      receivedAt: new Date().toISOString(),
    });

    expect(response.outbound.text).toBe('Puedes revisar tu lista aquí');
  });

  it('routes explicit human support requests to local soft-pause when Agent API is not configured', async () => {
    const runtime = new HumanEscalationRuntime();
    const agentGateway = new FakeAgentConversationGateway({
      status: 'skipped',
      reason: 'not_configured',
      message: 'Agent API human takeover is not configured.',
    });
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      agentConversationGateway: agentGateway,
      promptLoader,
      renderers,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-human-escalation',
      text: 'quiero hablar con una persona de soporte',
      messageId: 'msg-human-escalation',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51 987654321',
    });

    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.intent).toBe('solicitar_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.human_escalation.phone_number).toBe('51987654321');
    expect(response.plan.human_escalation.last_error).toBe('Agent API human takeover is not configured.');
    expect(Date.parse(response.plan.human_escalation.bot_suppressed_until ?? '') - Date.now())
      .toBeGreaterThan(11 * 60 * 60 * 1_000);
    expect(response.trace.route_kind).toBe('human_escalation');
    expect(response.trace.tools_called).toContain('request_human_takeover');
    expect(response.trace.search_strategy).toBe('none');
    expect(response.trace.provider_results).toHaveLength(0);
    expect(agentGateway.requestedPhones).toEqual(['51987654321']);
    expect(response.outbound.text).toContain('Una persona del equipo podrá continuar');
    expect(response.outbound.text).not.toMatch(/12|horas/iu);
  });

  it('keeps escalated conversations soft-paused without extracting or searching again', async () => {
    const runtime = new HumanEscalationRuntime();
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-escalated',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-escalated',
        }),
        {
          current_node: 'solicitar_agente_humano',
          intent: 'solicitar_humano',
          human_escalation: {
            status: 'requested',
            requested_at: new Date(Date.now() - 60_000).toISOString(),
            bot_suppressed_until: new Date(Date.now() + 60_000).toISOString(),
            phone_number: '51987654321',
            last_error: 'Agent API human takeover is not configured.',
          },
        },
      ),
    });

    const response = await new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-escalated',
      text: 'sigues ahi?',
      messageId: 'msg-escalated-follow-up',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51 987654321',
    });

    expect(runtime.extractCalls).toBe(0);
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.trace.route_kind).toBe('human_escalation');
    expect(response.trace.tools_called).toEqual([]);
    expect(response.trace.provider_results).toHaveLength(0);
    expect(response.outbound.text).toBeNull();
    expect(response.outbound.delivery).toEqual({
      action: 'suppress',
      reason: 'human_escalation_active',
    });
  });

  it('resumes automated processing after the 12-hour human escalation window expires', async () => {
    const runtime = new FakeRuntime();
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed-expired-escalation',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'plan-expired-escalation',
          channel: 'terminal_whatsapp',
          externalUserId: 'user-expired-escalation',
        }),
        {
          current_node: 'solicitar_agente_humano',
          intent: 'solicitar_humano',
          human_escalation: {
            status: 'requested',
            requested_at: new Date(Date.now() - (13 * 60 * 60 * 1_000)).toISOString(),
            phone_number: '51987654321',
            last_error: null,
          },
        },
      ),
    });

    const response = await new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-expired-escalation',
      text: 'Quiero retomar la planificación',
      messageId: 'msg-expired-escalation',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51 987654321',
    });

    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.plan.human_escalation).toEqual({
      status: 'none',
      requested_at: null,
      bot_suppressed_until: null,
      phone_number: null,
      last_error: null,
    });
    expect(response.trace.tools_called).toContain('expire_human_escalation_window');
    expect(response.outbound.delivery.action).toBe('send');
  });

  it('observes acknowledgement suppression while retaining the full reply flow and logging both messages', async () => {
    const classifier = new FakeResponseClassifier('observe', 'suppress_acknowledgement');
    const gateway = new TrackingAgentConversationGateway([
      {
        id: 1,
        direction: 'outbound',
        source: 'agent',
        body: '¿Quieres que te comparta más opciones?',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      },
    ]);
    const response = await new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new FakeRuntime(),
      providerGateway: new FakeGateway(),
      agentConversationGateway: gateway,
      responseClassifier: classifier,
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: '51991347878',
      text: 'Gracias!',
      messageId: 'classifier-observe',
      receivedAt: '2026-07-09T10:00:00.000Z',
      contactPhone: '+51 991347878',
    });

    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).not.toBeNull();
    expect(response.trace.response_classifier?.would_suppress).toBe(true);
    expect(response.trace.token_usage.classifier?.total_tokens).toBe(12);
    expect(classifier.calls).toHaveLength(1);
    expect(gateway.operations).toEqual(['get', 'log:inbound', 'log:outbound']);
  });

  it('enforces acknowledgement suppression before extraction and provider search', async () => {
    class CountingRuntime extends FakeRuntime {
      public extractCalls = 0;

      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        this.extractCalls += 1;
        return await super.extract(request);
      }
    }

    const runtime = new CountingRuntime();
    const classifier = new FakeResponseClassifier('enforce', 'suppress_acknowledgement');
    const gateway = new TrackingAgentConversationGateway([
      {
        id: 1,
        direction: 'outbound',
        source: 'agent',
        body: '¿Quieres que te comparta más opciones?',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      },
    ]);
    const response = await new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: new FakeGateway(),
      agentConversationGateway: gateway,
      responseClassifier: classifier,
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: '51991347878',
      text: '👍',
      messageId: 'classifier-enforce',
      receivedAt: '2026-07-09T10:00:00.000Z',
      contactPhone: '+51 991347878',
    });

    expect(runtime.extractCalls).toBe(0);
    expect(response.outbound.text).toBeNull();
    expect(response.outbound.delivery).toEqual({
      action: 'suppress',
      reason: 'suppress_acknowledgement',
    });
    expect(response.trace.tools_called).not.toContain('search_providers_from_plan');
    expect(gateway.operations).toEqual(['get', 'log:inbound']);
  });

  it('offers human help after a second consecutive stalled turn and bypasses normal agent work', async () => {
    class CountingRuntime extends FakeRuntime {
      public extractCalls = 0;

      override async extract(request: ExtractRequest): Promise<ExtractionResult> {
        this.extractCalls += 1;
        return await super.extract(request);
      }
    }

    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed-stall',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'health-stalled',
          channel: 'terminal_whatsapp',
          externalUserId: 'health-stalled-user',
        }),
        {
          conversation_health: {
            status: 'stalled',
            reason: 'repeated_question',
            consecutive_non_progress_turns: 1,
            help_offer_status: 'none',
            help_offered_at: null,
            last_assessed_at: '2026-07-10T10:00:00.000Z',
          },
        },
      ),
    });
    const runtime = new CountingRuntime();
    const classifier = new FakeResponseClassifier('observe', 'respond', {
      status: 'stalled',
      reason: 'circular_conversation',
      helpResponse: 'not_applicable',
    });
    const gateway = new TrackingAgentConversationGateway([]);

    const response = await new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      agentConversationGateway: gateway,
      responseClassifier: classifier,
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'health-stalled-user',
      text: 'Todavía no logramos resolverlo',
      messageId: 'health-stalled-turn',
      receivedAt: '2026-07-10T10:01:00.000Z',
      contactPhone: '+51 900000001',
    });

    expect(runtime.extractCalls).toBe(0);
    expect(response.plan.current_node).toBe('ofrecer_agente_humano');
    expect(response.plan.conversation_health).toMatchObject({
      consecutive_non_progress_turns: 2,
      help_offer_status: 'offered',
    });
    expect(response.trace.route_kind).toBe('human_help_offer');
    expect(response.outbound.text).toContain('una persona del equipo se una a este chat');
    expect(gateway.operations).toEqual(['get', 'log:inbound', 'log:outbound']);
  });

  it('routes structured acceptance of a health-monitor offer through human takeover', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed-offer',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'health-offered',
          channel: 'terminal_whatsapp',
          externalUserId: 'health-offered-user',
        }),
        {
          current_node: 'ofrecer_agente_humano',
          conversation_health: {
            status: 'frustrated',
            reason: 'explicit_frustration',
            consecutive_non_progress_turns: 1,
            help_offer_status: 'offered',
            help_offered_at: '2026-07-10T10:00:00.000Z',
            last_assessed_at: '2026-07-10T10:00:00.000Z',
          },
        },
      ),
    });
    const classifier = new FakeResponseClassifier('observe', 'respond', {
      status: 'progressing',
      reason: 'normal_progress',
      helpResponse: 'accept',
    });
    const gateway = new TrackingAgentConversationGateway([]);

    const response = await new AgentService({
      planStore,
      runtime: new FakeRuntime(),
      providerGateway: new FakeGateway(),
      agentConversationGateway: gateway,
      responseClassifier: classifier,
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'health-offered-user',
      text: 'Sí, por favor',
      messageId: 'health-accept-turn',
      receivedAt: '2026-07-10T10:02:00.000Z',
      contactPhone: '+51 900000002',
    });

    expect(response.plan.human_escalation.status).toBe('requested');
    expect(Date.parse(response.plan.human_escalation.bot_suppressed_until ?? '') - Date.now())
      .toBeGreaterThan(11 * 60 * 60 * 1_000);
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.trace.route_kind).toBe('human_escalation');
    expect(response.outbound.text).toContain('Una persona del equipo se unirá a este chat');
    expect(response.outbound.text).not.toMatch(/12|horas/iu);
    expect(gateway.operations).toEqual([
      'get',
      'log:inbound',
      'takeover:51900000002',
      'log:outbound',
    ]);
  });

  it('resumes normal processing after a structured decline without repeating the offer', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed-decline',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'health-declined',
          channel: 'terminal_whatsapp',
          externalUserId: 'health-declined-user',
        }),
        {
          current_node: 'ofrecer_agente_humano',
          conversation_health: {
            status: 'stalled',
            reason: 'circular_conversation',
            consecutive_non_progress_turns: 2,
            help_offer_status: 'offered',
            help_offered_at: '2026-07-10T10:00:00.000Z',
            last_assessed_at: '2026-07-10T10:00:00.000Z',
          },
        },
      ),
    });
    const classifier = new FakeResponseClassifier('enforce', 'respond', {
      status: 'progressing',
      reason: 'normal_progress',
      helpResponse: 'decline',
    });

    const response = await new AgentService({
      planStore,
      runtime: new FakeRuntime(),
      providerGateway: new FakeGateway(),
      responseClassifier: classifier,
      promptLoader,
      renderers,
    }).handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'health-declined-user',
      text: 'Prefiero continuar por aquí',
      messageId: 'health-decline-turn',
      receivedAt: '2026-07-10T10:03:00.000Z',
    });

    expect(response.plan.human_escalation.status).toBe('none');
    expect(response.plan.conversation_health.help_offer_status).toBe('declined');
    expect(response.trace.route_kind).not.toBe('human_help_offer');
    expect(response.outbound.delivery.action).toBe('send');
  });
});
