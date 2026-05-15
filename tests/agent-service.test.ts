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
import type { ProviderDetail } from '../src/core/provider';
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
} from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { PlanStore, SavePlanInput } from '../src/storage/plan-store';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import type { ProviderFitCriteria } from '../src/runtime/provider-fit';

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

  it('accepts a standalone phone correction via regex fallback', async () => {
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
      text: '954779071',
      messageId: 'msg-standalone-phone',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.contact_phone).toBe('954779071');
    expect(response.plan.contact_name).toBe('Carolina');
    expect(response.plan.contact_email).toBe('carolina@example.com');
    expect(response.trace.operational_note).toBeNull();
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
        contact_phone: '5215512345678',
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
    expect(gateway.lastQuoteRequest?.phone).toBe('15512345678');
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
              queryStrings: ['catering elegante para boda en Lima'],
              preferences: ['elegante', 'cena tipo estaciones'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: true,
              fitCriteria: { ...testProviderFitCriteria, needCategory: 'catering' },
            },
            {
              category: 'Música',
              label: 'Música para boda',
              priority: 2,
              queryStrings: ['música para boda elegante en Lima'],
              preferences: ['elegante', 'música en vivo'],
              hardConstraints: [],
              missingFields: [],
              retrievalReady: true,
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
            queryStrings: [`${category} para boda elegante en Lima`],
            preferences: ['elegante'],
            hardConstraints: [],
            missingFields: ['fecha', 'distrito'],
            retrievalReady: true,
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
          providerPlanOperations: request.userMessage === 'structured delete'
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

    const deleted = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-operations',
      text: 'structured delete',
      messageId: 'msg-delete-op',
      receivedAt: new Date().toISOString(),
    });
    expect(deleted.plan.provider_needs.map((need) => need.category)).not.toContain('Música');
  });
});
