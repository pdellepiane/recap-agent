import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PersistedPlan } from '../src/core/plan';
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
  CreateProviderReviewInput,
  FavoriteRequestInput,
  MarketplaceCategory,
  MarketplaceLocation,
  ProviderGateway,
  ProviderGatewaySearchResult,
  ProviderReview,
  ProviderSearchQuery,
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
        },
      ],
    };
  }

  async searchProvidersByQuery(
    query: ProviderSearchQuery,
  ): Promise<ProviderGatewaySearchResult> {
    void query;
    return {
      providers: [
        {
          id: 1,
          title: 'Foto Uno',
          category: 'fotografía',
          location: 'Lima',
          priceLevel: '$$',
          reason: 'coincide con el plan',
        },
      ],
    };
  }

  async getRelevantProviders() {
    return [
      {
        id: 2,
        title: 'Foto Dos',
      },
    ];
  }

  async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
    void providerId;
    return null;
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
});
