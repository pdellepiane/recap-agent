import { Agent, OpenAIConversationsSession, run, tool } from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

import type { PersistedPlan } from '../core/plan';
import {
  getActiveNeed,
  summarizeProviderNeeds,
  summarizeRecommendedProviders,
} from '../core/plan';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from './contracts';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { ToolName } from './prompt-manifest';

const extractionSchema = z.object({
  intent: z
    .enum([
      'buscar_proveedores',
      'refinar_busqueda',
      'ver_opciones',
      'confirmar_proveedor',
      'retomar_plan',
      'cerrar',
      'pausar',
    ])
    .nullable(),
  intentConfidence: z.number().min(0).max(1).nullable(),
  eventType: z.string().nullable(),
  vendorCategory: z.string().nullable(),
  vendorCategories: z.array(z.string()),
  activeNeedCategory: z.string().nullable(),
  location: z.string().nullable(),
  budgetSignal: z.string().nullable(),
  guestRange: z.enum(['1-20', '21-50', '51-100', '101-200', '201+', 'unknown']).nullable(),
  preferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  conversationSummary: z.string(),
  selectedProviderHint: z.string().nullable(),
  pauseRequested: z.boolean(),
});

type RuntimeContext = {
  toolUsage: {
    considered: string[];
    called: string[];
  };
};

const queryPrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);
const queryValueSchema = z.union([
  queryPrimitiveSchema,
  z.array(queryPrimitiveSchema),
  z.null(),
]);

export class OpenAiAgentRuntime implements AgentRuntime {
  private readonly client: OpenAI;

  constructor(
    private readonly options: {
      apiKey: string;
      replyModel: string;
      extractorModel: string;
      replyProviderLimit: number;
      providerDetailLookupLimit: number;
      promptLoader: PromptLoader;
      providerGateway: ProviderGateway;
    },
  ) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    const bundle = await this.options.promptLoader.loadExtractorBundle();
    const extractor = new Agent({
      name: 'plan_extractor',
      model: this.options.extractorModel,
      instructions: bundle.instructions,
      outputType: extractionSchema,
    });

    const input = [
      `Mensaje del usuario:\n${request.userMessage}`,
      `Plan actual:\n${JSON.stringify(request.plan, null, 2)}`,
      `Necesidades de proveedores:\n${summarizeProviderNeeds(request.plan.provider_needs)}`,
      `Proveedores recomendados actuales:\n${summarizeRecommendedProviders(
        request.plan.recommended_providers,
      )}`,
      'Extrae solo cambios relevantes y normaliza al esquema pedido.',
    ].join('\n\n');

    const result = await run(extractor, input);
    return result.finalOutput as ExtractionResult;
  }

  async composeReply(
    request: ComposeReplyRequest,
  ): Promise<ComposeReplyResult> {
    const bundle = await this.options.promptLoader.loadNodeBundle(
      request.currentNode,
    );
    const tools = this.createTools(
      request.toolUsage,
      request.plan,
      bundle.allowedTools,
    );

    request.toolUsage.considered.push(...bundle.allowedTools);

    const agent = new Agent<RuntimeContext>({
      name: `reply_${request.currentNode}`,
      model: this.options.replyModel,
      instructions: () => bundle.instructions,
      tools,
    });

    const session = new OpenAIConversationsSession({
      client: this.client,
      conversationId: request.plan.conversation_id ?? undefined,
    });

    const input = this.composeConversationInput(request);

    const result = await run(agent, input, {
      session,
      context: {
        toolUsage: request.toolUsage,
      },
    });

    request.plan.conversation_id = await session.getSessionId();

    return {
      text: String(result.finalOutput ?? '').trim(),
    };
  }

  private composeConversationInput(request: ComposeReplyRequest): string {
    const allowedTools =
      request.toolUsage.considered.length > 0
        ? request.toolUsage.considered.join(', ')
        : 'ninguna';
    const providerResults = request.providerResults.slice(
      0,
      this.options.replyProviderLimit,
    );
    const activeNeed = getActiveNeed(request.plan);

    return [
      `Nodo previo: ${request.previousNode}`,
      `Nodo actual: ${request.currentNode}`,
      `Mensaje del usuario: ${request.userMessage}`,
      `Plan estructurado: ${JSON.stringify(request.plan, null, 2)}`,
      `Necesidad activa: ${activeNeed?.category ?? 'ninguna todavía'}`,
      `Necesidades del plan:\n${summarizeProviderNeeds(request.plan.provider_needs)}`,
      `Faltantes: ${request.missingFields.join(', ') || 'ninguno'}`,
      `Listo para buscar: ${request.searchReady ? 'sí' : 'no'}`,
      `Herramientas autorizadas en este nodo: ${allowedTools}`,
      `Resultados vigentes:\n${summarizeRecommendedProviders(providerResults)}`,
      request.errorMessage ? `Error operativo: ${request.errorMessage}` : '',
      'Responde únicamente con el próximo mensaje para el usuario.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private createTools(
    toolUsage: RuntimeContext['toolUsage'],
    plan: PersistedPlan,
    allowedTools: readonly ToolName[],
  ) {
    let remainingProviderDetailLookups =
      this.options.providerDetailLookupLimit;

    const toolMap = {
      list_categories: tool({
        name: 'list_categories',
        description:
          'Lista categorías reales del marketplace para aclarar ambigüedad.',
        parameters: z.object({}),
        execute: async () => {
          toolUsage.called.push('list_categories');
          return await this.options.providerGateway.listCategories();
        },
      }),
      get_category_by_slug: tool({
        name: 'get_category_by_slug',
        description:
          'Obtiene el detalle de una categoría real del marketplace usando su slug.',
        parameters: z.object({
          slug: z.string().min(1),
        }),
        execute: async ({ slug }) => {
          toolUsage.called.push('get_category_by_slug');
          return await this.options.providerGateway.getCategoryBySlug(slug);
        },
      }),
      list_locations: tool({
        name: 'list_locations',
        description:
          'Lista ubicaciones reales del marketplace para normalizar la ciudad o país.',
        parameters: z.object({}),
        execute: async () => {
          toolUsage.called.push('list_locations');
          return await this.options.providerGateway.listLocations();
        },
      }),
      search_providers: tool({
        name: 'search_providers',
        description:
          'Busca proveedores reales con el plan vigente o con filtros explícitos cuando se necesite controlar la búsqueda.',
        parameters: z.object({
          search: z.string().nullish(),
          page: z.number().int().positive().nullish(),
          query: z.record(z.string(), queryValueSchema).optional(),
        }),
        execute: async ({ page, query, search }) => {
          toolUsage.called.push('search_providers');
          const hasExplicitQuery =
            Boolean(search?.trim()) ||
            (page !== null && page !== undefined) ||
            Object.keys(query ?? {}).length > 0;

          if (hasExplicitQuery) {
            return await this.options.providerGateway.searchProvidersByQuery({
              search: search ?? null,
              page: page ?? null,
              query,
            });
          }

          return await this.options.providerGateway.searchProviders(plan);
        },
      }),
      get_relevant_providers: tool({
        name: 'get_relevant_providers',
        description:
          'Trae proveedores relevantes del marketplace para exploración o fallback.',
        parameters: z.object({}),
        execute: async () => {
          toolUsage.called.push('get_relevant_providers');
          return await this.options.providerGateway.getRelevantProviders();
        },
      }),
      get_provider_detail: tool({
        name: 'get_provider_detail',
        description:
          'Obtiene detalle real de un proveedor por id para ampliar una recomendación.',
        parameters: z.object({
          provider_id: z.number(),
        }),
        execute: async ({ provider_id }) => {
          if (remainingProviderDetailLookups <= 0) {
            return null;
          }

          remainingProviderDetailLookups -= 1;
          toolUsage.called.push('get_provider_detail');
          return await this.options.providerGateway.getProviderDetail(provider_id);
        },
      }),
      get_provider_detail_and_track_view: tool({
        name: 'get_provider_detail_and_track_view',
        description:
          'Obtiene detalle de proveedor usando el endpoint que además registra vista analítica.',
        parameters: z.object({
          provider_id: z.number(),
        }),
        execute: async ({ provider_id }) => {
          toolUsage.called.push('get_provider_detail_and_track_view');
          return await this.options.providerGateway.getProviderDetailAndTrackView(
            provider_id,
          );
        },
      }),
      get_related_providers: tool({
        name: 'get_related_providers',
        description:
          'Trae proveedores relacionados con uno ya conocido para ampliar alternativas.',
        parameters: z.object({
          provider_id: z.number(),
        }),
        execute: async ({ provider_id }) => {
          toolUsage.called.push('get_related_providers');
          return await this.options.providerGateway.getRelatedProviders(provider_id);
        },
      }),
      list_provider_reviews: tool({
        name: 'list_provider_reviews',
        description:
          'Lista reseñas reales de un proveedor para enriquecer la recomendación.',
        parameters: z.object({
          provider_id: z.number(),
        }),
        execute: async ({ provider_id }) => {
          toolUsage.called.push('list_provider_reviews');
          return await this.options.providerGateway.listProviderReviews(provider_id);
        },
      }),
      get_event_vendor_context: tool({
        name: 'get_event_vendor_context',
        description:
          'Recupera el contexto de proveedores asociados a un evento existente.',
        parameters: z.object({
          event_id: z.number(),
        }),
        execute: async ({ event_id }) => {
          toolUsage.called.push('get_event_vendor_context');
          return await this.options.providerGateway.getEventVendorContext(event_id);
        },
      }),
      list_event_favorite_providers: tool({
        name: 'list_event_favorite_providers',
        description:
          'Lista proveedores favoritos ya asociados a un evento.',
        parameters: z.object({
          event_id: z.number(),
          sort_by: z.string().nullish(),
          page: z.number().int().nonnegative().nullish(),
          category_id: z.number().int().positive().nullish(),
        }),
        execute: async ({ category_id, event_id, page, sort_by }) => {
          toolUsage.called.push('list_event_favorite_providers');
          return await this.options.providerGateway.listEventFavoriteProviders({
            eventId: event_id,
            sortBy: sort_by ?? null,
            page: page ?? null,
            categoryId: category_id ?? null,
          });
        },
      }),
      list_user_events_vendor_context: tool({
        name: 'list_user_events_vendor_context',
        description:
          'Lista el contexto de proveedores por eventos de un usuario.',
        parameters: z.object({
          user_id: z.number(),
        }),
        execute: async ({ user_id }) => {
          toolUsage.called.push('list_user_events_vendor_context');
          return await this.options.providerGateway.listUserEventsVendorContext(
            user_id,
          );
        },
      }),
      create_quote_request: tool({
        name: 'create_quote_request',
        description:
          'Registra una solicitud de cotización o contacto con un proveedor.',
        parameters: z.object({
          provider_id: z.number(),
          user_id: z.number(),
          name: z.string().min(1),
          email: z.string().email(),
          phone: z.string().min(1),
          phone_extension: z.string().min(1),
          event_date: z.string().min(1),
          guests_range: z.string().min(1),
          description: z.string().min(1),
        }),
        execute: async ({
          description,
          email,
          event_date,
          guests_range,
          name,
          phone,
          phone_extension,
          provider_id,
          user_id,
        }) => {
          toolUsage.called.push('create_quote_request');
          return await this.options.providerGateway.createQuoteRequest({
            providerId: provider_id,
            userId: user_id,
            name,
            email,
            phone,
            phoneExtension: phone_extension,
            eventDate: event_date,
            guestsRange: guests_range,
            description,
          });
        },
      }),
      add_vendor_to_event_favorites: tool({
        name: 'add_vendor_to_event_favorites',
        description:
          'Guarda un proveedor como favorito dentro de un evento.',
        parameters: z.object({
          provider_id: z.number(),
          user_id: z.number(),
          event_id: z.number(),
        }),
        execute: async ({ event_id, provider_id, user_id }) => {
          toolUsage.called.push('add_vendor_to_event_favorites');
          return await this.options.providerGateway.addVendorToEventFavorites({
            providerId: provider_id,
            userId: user_id,
            eventId: event_id,
          });
        },
      }),
      create_provider_review: tool({
        name: 'create_provider_review',
        description:
          'Registra una reseña para un proveedor cuando el flujo de feedback lo requiera.',
        parameters: z.object({
          provider_id: z.number(),
          user_id: z.number(),
          name: z.string().min(1),
          rating: z.number().min(1).max(5),
          comment: z.string().nullish(),
        }),
        execute: async ({ comment, name, provider_id, rating, user_id }) => {
          toolUsage.called.push('create_provider_review');
          return await this.options.providerGateway.createProviderReview({
            providerId: provider_id,
            userId: user_id,
            name,
            rating,
            comment: comment ?? null,
          });
        },
      }),
    } satisfies Record<ToolName, ReturnType<typeof tool>>;

    return allowedTools.map((name) => toolMap[name]);
  }
}
