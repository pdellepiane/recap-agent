import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createEmptyPlan,
  getActiveNeed,
  mergePlan,
  type PersistedPlan,
  type PlanSnapshot,
} from '../src/core/plan';
import type { ProviderDetail } from '../src/core/provider';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { AgentService } from '../src/runtime/agent-service';
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
  QuoteRequestInput,
} from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { PlanStore, SavePlanInput } from '../src/storage/plan-store';

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
        selectedProviderHint: null,
        pauseRequested: true,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      };
    }

    if (request.userMessage.includes('proveedor 1')) {
      return {
        intent: 'confirmar_proveedor',
        intentConfidence: 0.92,
        eventType: 'boda',
        vendorCategory: 'fotografía',
        vendorCategories: ['fotografía', 'catering'],
        activeNeedCategory: 'fotografía',
        location: 'Lima',
        budgetSignal: '$$',
        guestRange: '51-100',
        preferences: [],
        hardConstraints: [],
        assumptions: [],
        conversationSummary: 'El usuario elige el proveedor 1.',
        selectedProviderHint: '1',
        pauseRequested: false,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      };
    }

    return {
      intent: 'buscar_proveedores',
      intentConfidence: 0.91,
      eventType: 'boda',
      vendorCategory: 'fotografía',
      vendorCategories: ['fotografía', 'catering'],
      activeNeedCategory: 'fotografía',
      location: 'Lima',
      budgetSignal: '$$',
      guestRange: '51-100',
      preferences: ['natural'],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'Boda en Lima con presupuesto medio.',
      selectedProviderHint: null,
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: `reply:${request.currentNode}` };
  }
}

class FakeGateway implements ProviderGateway {
  public searchCalls = 0;

  async listCategories(): Promise<MarketplaceCategory[]> {
    return [
      {
        id: 1,
        name: 'fotografía',
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
    if (plan.vendor_category === 'sin-resultados') {
      return { providers: [] };
    }

    return {
      providers: [
        {
          id: 1,
          title: 'Foto Uno',
          category: 'fotografía',
          location: 'Lima',
          priceLevel: '$$',
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
          category: 'fotografía',
          location: 'Lima',
          priceLevel: '$$',
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
          category: 'fotografía',
          location: 'Lima',
          priceLevel: '$$',
          reason: 'coincide con el plan',
          serviceHighlights: [],
          termsHighlights: [],
        },
      ],
    };
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
      category: 'fotografía',
      location: 'Lima',
      priceLevel: '$$',
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

  public readonly ttls: Array<number | undefined> = [];

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
    this.ttls.push(input.ttlEpochSeconds);
  }
}

describe('AgentService', () => {
  const promptsDir = path.resolve(process.cwd(), 'prompts');
  const promptLoader = new PromptLoader(promptsDir);

  it('persists the plan after extraction and moves to recommendation when search succeeds', async () => {
    const runtime = new FakeRuntime();
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: new FakeGateway(),
      promptLoader,
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
    expect(response.plan.active_need_category).toBe('fotografía');
    expect(response.plan.recommended_providers[0]?.detailUrl).toBe(
      'https://sinenvolturas.com/proveedores/foto-uno',
    );
    expect(response.plan.recommended_providers[0]?.serviceHighlights).toEqual([
      'Cobertura de boda',
      'Sesión preboda',
    ]);

    const saved = await planStore.getByExternalUser('terminal_whatsapp', 'user-1');
    expect(saved?.vendor_category).toBe('fotografía');
    expect(saved?.location).toBe('Lima');
    expect(saved?.provider_needs.map((need) => need.category)).toEqual([
      'fotografía',
      'catering',
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
            eventType: 'cumpleaños',
            vendorCategory: 'catering',
            vendorCategories: ['catering'],
            activeNeedCategory: 'catering',
            location: 'Lima',
            budgetSignal: null,
            guestRange: '21-50',
            preferences: [],
            hardConstraints: [],
            assumptions: [],
            conversationSummary: 'El usuario quiere seguir con EDO para catering.',
            selectedProviderHint: null,
            pauseRequested: false,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
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
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-selection',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-3',
      }),
      {
        current_node: 'recomendar',
        event_type: 'cumpleaños',
        location: 'Lima',
        guest_range: '21-50',
        active_need_category: 'catering',
        vendor_category: 'catering',
        provider_needs: [
          {
            category: 'catering',
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
                category: 'catering',
                location: 'Lima',
                priceLevel: '$$$',
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
            selected_provider_id: null,
            selected_provider_hint: null,
          },
        ],
        recommended_provider_ids: [109],
        recommended_providers: [
          {
            id: 109,
            title: 'EDO Sushi Bar',
            slug: 'edo-sushi-bar',
            category: 'catering',
            location: 'Lima',
            priceLevel: '$$$',
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
    expect(response.plan.selected_provider_id).toBe(109);
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
          vendorCategories: ['local'],
          activeNeedCategory: 'local',
          location: null,
          budgetSignal: 'medio',
          guestRange: 'unknown',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario confirmó presupuesto medio.',
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
    });

    const seededPlan = mergePlan(
      createEmptyPlan({
        planId: 'plan-preserve',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-4',
      }),
      {
        current_node: 'aclarar_pedir_faltante',
        event_type: 'baby shower',
        location: 'La Molina, Lima, Perú',
        guest_range: '21-50',
        active_need_category: 'local',
        vendor_category: 'local',
        provider_needs: [
          {
            category: 'local',
            status: 'identified',
            preferences: [],
            hard_constraints: [],
            missing_fields: ['budget_or_guest_range'],
            recommended_provider_ids: [],
            recommended_providers: [],
            selected_provider_id: null,
            selected_provider_hint: null,
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

    expect(response.plan.event_type).toBe('baby shower');
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
          vendorCategory: 'fotografía',
          vendorCategories: ['fotografía'],
          activeNeedCategory: 'fotografía',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere ver más fotógrafos en Lima.',
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
        };
      }
    }

    class BroadenGateway extends FakeGateway {
      public readonly categoryLocationCalls: CategoryLocationProviderSearchInput[] = [];

      override async searchProvidersByCategoryLocation(
        input: CategoryLocationProviderSearchInput,
      ): Promise<ProviderGatewaySearchResult> {
        this.categoryLocationCalls.push(input);
        expect(input.category).toBe('fotografía');

        if (input.location === 'Lima' && input.page === 1) {
          return {
            providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'fotografía',
                location: 'Lima',
                priceLevel: '$$',
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
                category: 'fotografía',
                location: 'Lima',
                priceLevel: '$$$',
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
        active_need_category: 'fotografía',
        vendor_category: 'fotografía',
        provider_needs: [
          {
            category: 'fotografía',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'fotografía',
                location: 'Lima',
                priceLevel: '$$',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_id: null,
            selected_provider_hint: null,
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
      { category: 'fotografía', location: 'Lima', page: 1 },
      { category: 'fotografía', location: 'Lima', page: 2 },
      { category: 'fotografía', location: 'Lima', page: 3 },
      { category: 'fotografía', location: null, page: 1 },
    ]);
  });

  it('keeps the current shortlist and records that there are no more options when broadened search is empty', async () => {
    class BroadenRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: 'fotografía',
          vendorCategories: ['fotografía'],
          activeNeedCategory: 'fotografía',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere ver más fotógrafos en Lima.',
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
        active_need_category: 'fotografía',
        vendor_category: 'fotografía',
        provider_needs: [
          {
            category: 'fotografía',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'fotografía',
                location: 'Lima',
                priceLevel: '$$',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_id: null,
            selected_provider_hint: null,
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
      { category: 'fotografía', location: 'Lima', page: 1 },
      { category: 'fotografía', location: null, page: 1 },
    ]);
  });

  it('falls back to category-wide search when location-scoped pages add no unseen providers', async () => {
    class BroadenRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.94,
          eventType: 'boda',
          vendorCategory: 'fotografía',
          vendorCategories: ['fotografía'],
          activeNeedCategory: 'fotografía',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere ampliar la búsqueda de fotógrafos.',
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
                category: 'fotografía',
                location: 'Lima',
                priceLevel: '$$',
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
                category: 'fotografía',
                location: 'Miraflores, Perú',
                priceLevel: '$$$',
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
        active_need_category: 'fotografía',
        vendor_category: 'fotografía',
        provider_needs: [
          {
            category: 'fotografía',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'fotografía',
                location: 'Lima',
                priceLevel: '$$',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_id: null,
            selected_provider_hint: null,
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
      { category: 'fotografía', location: 'Lima', page: 1 },
      { category: 'fotografía', location: 'Lima', page: 2 },
      { category: 'fotografía', location: null, page: 1 },
      { category: 'fotografía', location: null, page: 2 },
    ]);
  });

  it('keeps using the normal search path when refinement changes criteria', async () => {
    class CriteriaChangeRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'refinar_busqueda',
          intentConfidence: 0.95,
          eventType: 'boda',
          vendorCategory: 'fotografía',
          vendorCategories: ['fotografía'],
          activeNeedCategory: 'fotografía',
          location: 'Lima',
          budgetSignal: 'económico',
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario quiere opciones de fotografía más económicas.',
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
              category: 'fotografía',
              location: 'Lima',
              priceLevel: '$',
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
        active_need_category: 'fotografía',
        vendor_category: 'fotografía',
        provider_needs: [
          {
            category: 'fotografía',
            status: 'shortlisted',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [1],
            recommended_providers: [
              {
                id: 1,
                title: 'Foto Uno',
                category: 'fotografía',
                location: 'Lima',
                priceLevel: '$$',
                reason: 'coincide con el plan',
                serviceHighlights: [],
                termsHighlights: [],
              },
            ],
            selected_provider_id: null,
            selected_provider_hint: null,
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
          vendorCategory: 'catering',
          vendorCategories: ['fotografía', 'catering'],
          activeNeedCategory: 'catering',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '51-100',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary:
            'El usuario quiere tomar a Carlos para fotografía y ahora necesita catering.',
          selectedProviderHint: 'Carlos',
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
        };
      }
    }

    class MixedTurnGateway extends FakeGateway {
      override async searchProviders(
        plan: PersistedPlan,
      ): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;

        if (plan.vendor_category === 'catering') {
          return {
            providers: [
              {
                id: 109,
                title: 'EDO Sushi Bar',
                category: 'catering',
                location: 'Lima',
                priceLevel: '$$$',
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
            category: 'catering',
            location: 'Lima',
            priceLevel: '$$$',
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
            category: 'fotografía',
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
        active_need_category: 'fotografía',
        vendor_category: 'fotografía',
        provider_needs: [
          {
            category: 'fotografía',
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
                category: 'fotografía',
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
            selected_provider_id: null,
            selected_provider_hint: null,
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
      (need) => need.category === 'fotografía',
    );
    const cateringNeed = response.plan.provider_needs.find(
      (need) => need.category === 'catering',
    );

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.plan.active_need_category).toBe('catering');
    expect(photographyNeed?.selected_provider_id).toBe(90);
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
          vendorCategory: 'música',
          vendorCategories: ['música'],
          activeNeedCategory: 'música',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary:
            'El usuario eligió 4Foodies para catering y ahora necesita música.',
          selectedProviderHint: '4Foodies',
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
        };
      }
    }

    class MusicGateway extends FakeGateway {
      override async searchProviders(
        plan: PersistedPlan,
      ): Promise<ProviderGatewaySearchResult> {
        this.searchCalls += 1;
        expect(plan.vendor_category).toBe('música');
        return {
          providers: [
            {
              id: 115,
              title: 'Dj Naoki',
              category: 'música',
              location: 'Perú',
              priceLevel: '$$$',
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
        active_need_category: 'catering',
        vendor_category: 'catering',
        provider_needs: [
          {
            category: 'catering',
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
                category: 'catering',
                location: 'Lima',
                priceLevel: '$$$',
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
            selected_provider_id: null,
            selected_provider_hint: null,
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
      (need) => need.category === 'catering',
    );
    const musicNeed = response.plan.provider_needs.find(
      (need) => need.category === 'música',
    );

    expect(response.plan.current_node).toBe('recomendar');
    expect(response.plan.active_need_category).toBe('música');
    expect(cateringNeed?.status).toBe('selected');
    expect(cateringNeed?.selected_provider_id).toBe(136);
    expect(musicNeed?.status).toBe('shortlisted');
    expect(musicNeed?.selected_provider_hint).toBeNull();
    expect(gateway.searchCalls).toBe(1);
  });

  it('selects a prior provider from extractor-resolved hint when opening another need', async () => {
    class DescriptiveSelectionRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.93,
          eventType: 'boda',
          vendorCategory: 'música',
          vendorCategories: ['música'],
          activeNeedCategory: 'música',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary:
            'El usuario eligió el catering de tablas de queso y ahora necesita música.',
          selectedProviderHint: '4Foodies',
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
              category: 'música',
              location: 'Perú',
              priceLevel: '$$$',
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
        active_need_category: 'catering',
        vendor_category: 'catering',
        provider_needs: [
          {
            category: 'catering',
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
                category: 'catering',
                location: 'Lima',
                priceLevel: '$$$',
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
                category: 'catering',
                location: 'Lima',
                priceLevel: '$$$',
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
            selected_provider_id: null,
            selected_provider_hint: null,
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
      (need) => need.category === 'catering',
    );
    const musicNeed = response.plan.provider_needs.find(
      (need) => need.category === 'música',
    );

    expect(response.plan.active_need_category).toBe('música');
    expect(cateringNeed?.status).toBe('selected');
    expect(cateringNeed?.selected_provider_id).toBe(136);
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
          vendorCategory: 'catering',
          vendorCategories: ['catering'],
          activeNeedCategory: 'catering',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario eligió el proveedor de tablas de queso.',
          selectedProviderHint:
            'proveedor de la shortlist de catering con servicio en tablas de quesos (4Foodies)',
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
        active_need_category: 'catering',
        vendor_category: 'catering',
        provider_needs: [
          {
            category: 'catering',
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
                category: 'catering',
                location: 'Lima',
                priceLevel: '$$$',
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
                category: 'catering',
                location: 'Lima',
                priceLevel: '$$$',
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
            selected_provider_id: null,
            selected_provider_hint: null,
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

    expect(response.plan.selected_provider_id).toBe(136);
    expect(gateway.searchCalls).toBe(0);
  });

  it('resolves ordinal words against the active shortlist without searching again', async () => {
    class OrdinalSelectionRuntime extends FakeRuntime {
      override async extract(): Promise<ExtractionResult> {
        return {
          intent: 'confirmar_proveedor',
          intentConfidence: 0.95,
          eventType: 'boda',
          vendorCategory: 'música',
          vendorCategories: ['música'],
          activeNeedCategory: 'música',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '21-50',
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario eligió la primera opción de música.',
          selectedProviderHint: 'primera opción',
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
        active_need_category: 'música',
        vendor_category: 'música',
        provider_needs: [
          {
            category: 'música',
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
                category: 'música',
                location: 'Perú',
                priceLevel: '$$$',
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
                category: 'música',
                location: 'Perú',
                priceLevel: '$$',
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
            selected_provider_id: null,
            selected_provider_hint: null,
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
    expect(response.plan.selected_provider_id).toBe(115);
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
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
          vendorCategory: 'local',
          vendorCategories: ['local'],
          activeNeedCategory: 'local',
          location: 'Lima',
          budgetSignal: null,
          guestRange: '101-200',
          preferences: [],
          hardConstraints: [],
          assumptions: ['El tipo de evento podría necesitar local.'],
          conversationSummary: 'El usuario quiere planear una boda en Lima.',
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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
          vendorCategory: 'fotografía',
          vendorCategories: ['fotografía'],
          activeNeedCategory: 'fotografía',
          location: 'Lima',
          budgetSignal: null,
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'Boda en Lima con 100 invitados.',
          selectedProviderHint: null,
          pauseRequested: false,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
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

  it('returns a deterministic reply when the stored plan is already finished', async () => {
    const runtime = new FakeRuntime();
    const planStore = new InMemoryPlanStore();
    const gateway = new FakeGateway();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: gateway,
      promptLoader,
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

    expect(runtime.composeRequests).toHaveLength(0);
    expect(gateway.searchCalls).toBe(0);
    expect(response.trace.prompt_bundle_id).toBe('skipped_finished_plan');
    expect(response.outbound.text).toContain('24 horas');
    expect(response.plan.lifecycle_state).toBe('finished');
  });

  it('persists a finish TTL when runtime marks plan as finished', async () => {
    class FinishingRuntime extends FakeRuntime {
      override async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
        request.onPlanFinished?.(1_750_000_000);
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
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-finish-tool',
      text: 'listo, cierra el plan',
      messageId: 'msg-finish',
      receivedAt: new Date().toISOString(),
    });

    expect(planStore.ttls.some((value) => value === 1_750_000_000)).toBe(true);
    expect(planStore.currentPlan?.lifecycle_state).toBe('finished');
    expect(planStore.currentPlan?.contact_email).toBe('lin@example.com');
  });
});
