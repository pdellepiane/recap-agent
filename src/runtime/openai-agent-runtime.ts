import { Agent, OpenAIConversationsSession, run, tool } from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

import type { PersistedPlan } from '../core/plan';
import { summarizeRecommendedProviders } from '../core/plan';
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

    return [
      `Nodo previo: ${request.previousNode}`,
      `Nodo actual: ${request.currentNode}`,
      `Mensaje del usuario: ${request.userMessage}`,
      `Plan estructurado: ${JSON.stringify(request.plan, null, 2)}`,
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
          'Busca proveedores reales usando el plan vigente cuando ya hay mínimos suficientes.',
        parameters: z.object({}),
        execute: async () => {
          toolUsage.called.push('search_providers');
          return await this.options.providerGateway.searchProviders(plan);
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
    } satisfies Record<ToolName, ReturnType<typeof tool>>;

    return allowedTools.map((name) => toolMap[name]);
  }
}
