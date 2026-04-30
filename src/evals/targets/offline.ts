import { ulid } from 'ulid';

import { AgentService } from '../../runtime/agent-service';
import { createEmptyPlan, mergePlan } from '../../core/plan';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractResult,
  ExtractRequest,
} from '../../runtime/contracts';
import { PromptLoader } from '../../runtime/prompt-loader';
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
} from '../../runtime/provider-gateway';
import { InMemoryPlanStore } from '../../storage/in-memory-plan-store';
import type { EvalCase, EvalRunConfig, EvalTurnResult, OfflineFixture } from '../case-schema';
import type { ProviderDetail, ProviderSummary } from '../../core/provider';
import { WhatsAppMessageRenderer } from '../../runtime/message-renderer';

export async function runOfflineCase(args: {
  currentCase: EvalCase;
  config: EvalRunConfig;
  artifactDir: string;
}): Promise<{
  turns: EvalTurnResult[];
  status: 'passed' | 'failed' | 'errored' | 'skipped';
}> {
  const planStore = new InMemoryPlanStore();
  const fixture = args.currentCase.fixtures?.offline;
  const service = new AgentService({
    planStore,
    runtime: new FixtureRuntime(fixture),
    providerGateway: new FixtureProviderGateway(fixture),
    promptLoader: new PromptLoader('prompts'),
    renderers: {
      whatsapp: new WhatsAppMessageRenderer(),
      terminal_whatsapp: new WhatsAppMessageRenderer(),
      terminal_whatsapp_eval: new WhatsAppMessageRenderer(),
    },
  });
  const userId = `offline-${args.currentCase.id}`;
  const turns: EvalTurnResult[] = [];

  if (args.currentCase.seedPlan) {
    await planStore.save({
      plan: mergePlan(
        createSeedPlan(inputChannel(args.currentCase), inputUser(args.currentCase, userId)),
        args.currentCase.seedPlan,
      ),
      reason: 'eval-seed',
    });
  }

  for (const [turnIndex, input] of args.currentCase.inputs.entries()) {
    const startedAt = Date.now();
    const response = await service.handleTurn({
      channel: input.channel ?? 'terminal_whatsapp_eval',
      externalUserId: input.externalUserId ?? userId,
      text: input.text,
      messageId: `${args.currentCase.id}-${turnIndex}`,
      receivedAt: input.receivedAt ?? new Date().toISOString(),
    });
    turns.push({
      turnIndex,
      input,
      outputText: response.outbound.text,
      currentNode: response.plan.current_node,
      trace: response.trace,
      plan: response.plan,
      latencyMs: Date.now() - startedAt,
      rawTargetResponse: {
        outbound: response.outbound,
      },
    });
  }

  return {
    turns,
    status: 'passed',
  };
}

function createSeedPlan(channel: string, externalUserId: string) {
  return createEmptyPlan({
    planId: ulid(),
    channel,
    externalUserId,
  });
}

function inputChannel(currentCase: EvalCase): string {
  return currentCase.inputs[0]?.channel ?? 'terminal_whatsapp_eval';
}

function inputUser(currentCase: EvalCase, fallbackUserId: string): string {
  return currentCase.inputs[0]?.externalUserId ?? fallbackUserId;
}

class FixtureRuntime implements AgentRuntime {
  private extractionIndex = 0;
  private replyIndex = 0;

  constructor(private readonly fixture: OfflineFixture | undefined) {}

  async extract(request: ExtractRequest): Promise<ExtractResult> {
    void request;
    const configured = this.fixture?.extractionsByTurn?.[this.extractionIndex];
    this.extractionIndex += 1;

    if (configured) {
      return {
        extraction: {
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          providerFitCriteria: {
            eventType: null,
            needCategory: null,
            location: null,
            budgetAmount: null,
            budgetCurrency: null,
            budgetTier: 'unknown',
            mustHave: [],
            shouldAvoid: [],
            rankingNotes: 'Fixture did not provide provider fit criteria.',
          },
          ...configured,
        },
        tokenUsage: null,
      };
    }

    return {
      extraction: {
        intent: 'buscar_proveedores',
        intentConfidence: 0.9,
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
        conversationSummary: 'Offline fixture did not provide an extraction result.',
        selectedProviderHint: null,
        pauseRequested: false,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        providerFitCriteria: {
          eventType: null,
          needCategory: null,
          location: null,
          budgetAmount: null,
          budgetCurrency: null,
          budgetTier: 'unknown',
          mustHave: [],
          shouldAvoid: [],
          rankingNotes: 'Offline fixture did not provide provider fit criteria.',
        },
      },
      tokenUsage: null,
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    const configured = this.fixture?.repliesByTurn?.[this.replyIndex];
    this.replyIndex += 1;

    return {
      text: configured ?? `offline-reply-${this.replyIndex}`,
      tokenUsage: null,
    };
  }
}

class FixtureProviderGateway implements ProviderGateway {
  private searchTurnIndex = 0;

  constructor(private readonly fixture: OfflineFixture | undefined) {}

  async listCategories(): Promise<MarketplaceCategory[]> {
    return this.fixture?.providerGateway?.listCategories ?? [];
  }

  async getCategoryBySlug(slug: string): Promise<MarketplaceCategory | null> {
    return this.fixture?.providerGateway?.categoriesBySlug?.[slug] ?? null;
  }

  async listLocations(): Promise<MarketplaceLocation[]> {
    return this.fixture?.providerGateway?.listLocations ?? [];
  }

  async searchProviders(): Promise<ProviderGatewaySearchResult> {
    const configured =
      this.fixture?.providerGateway?.searchProvidersByTurn?.[this.searchTurnIndex];
    this.searchTurnIndex += 1;

    if (configured && 'error' in configured) {
      throw new Error(configured.error);
    }

    return configured?.value ?? { providers: [] };
  }

  async searchProvidersByKeyword(
    input: KeywordProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    void input;
    const configured = this.fixture?.providerGateway?.searchProvidersByKeyword;
    if (configured && 'error' in configured) {
      throw new Error(configured.error);
    }

    return configured?.value ?? { providers: [] };
  }

  async searchProvidersByCategoryLocation(
    input: CategoryLocationProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    void input;
    const configured = this.fixture?.providerGateway?.searchProvidersByCategoryLocation;
    if (configured && 'error' in configured) {
      throw new Error(configured.error);
    }

    return configured?.value ?? { providers: [] };
  }

  async getRelevantProviders(): Promise<ProviderSummary[]> {
    return this.fixture?.providerGateway?.relevantProviders ?? [];
  }

  async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
    const configured = this.fixture?.providerGateway?.providerDetailsById?.[String(providerId)];
    if (configured && 'error' in configured) {
      throw new Error(configured.error);
    }
    return configured?.value ?? null;
  }

  async getProviderDetailAndTrackView(providerId: number): Promise<ProviderDetail | null> {
    return this.getProviderDetail(providerId);
  }

  async getRelatedProviders(providerId: number): Promise<ProviderSummary[]> {
    return this.fixture?.providerGateway?.relatedProvidersById?.[String(providerId)] ?? [];
  }

  async listProviderReviews(providerId: number): Promise<ProviderReview[]> {
    return this.fixture?.providerGateway?.reviewsById?.[String(providerId)] ?? [];
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
  }): Promise<ProviderSummary[]> {
    void args;
    return [];
  }

  async listUserEventsVendorContext(userId: number): Promise<Record<string, unknown>[]> {
    void userId;
    return [];
  }

  async createQuoteRequest(input: QuoteRequestInput): Promise<Record<string, unknown>> {
    return { ok: true, requestId: ulid(), input };
  }

  async addVendorToEventFavorites(
    input: FavoriteRequestInput,
  ): Promise<Record<string, unknown>> {
    return { ok: true, requestId: ulid(), input };
  }

  async createProviderReview(
    input: CreateProviderReviewInput,
  ): Promise<Record<string, unknown>> {
    return { ok: true, requestId: ulid(), input };
  }
}
