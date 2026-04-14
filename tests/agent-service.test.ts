import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan, type PersistedPlan } from '../src/core/plan';
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

  it('preserves known event context when the extractor returns null for unchanged fields', async () => {
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
          guestRange: null,
          preferences: [],
          hardConstraints: [],
          assumptions: [],
          conversationSummary: 'El usuario confirmó presupuesto medio.',
          selectedProviderHint: null,
          pauseRequested: false,
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
});
