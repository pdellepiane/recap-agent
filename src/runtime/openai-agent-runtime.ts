import {
  Agent,
  InputGuardrailTripwireTriggered,
  OpenAIConversationsSession,
  OutputGuardrailTripwireTriggered,
  retryPolicies,
  run,
  tool,
  fileSearchTool,
} from '@openai/agents';
import type {
  AgentOutputType,
  HostedTool,
  InputGuardrail,
  OutputGuardrail,
} from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

import type { PersistedPlan } from '../core/plan';
import {
  getActiveNeed,
  summarizeProviderNeeds,
  summarizeRecommendedProviders,
} from '../core/plan';
import { executeFinishPlanTool } from './finish-plan-tool';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractResult,
  ExtractRequest,
  TokenUsage,
} from './contracts';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { ToolName } from './prompt-manifest';
import type { RecommendationFunnelTrace } from '../core/trace';
import {
  closeConfirmationMessageSchema,
  closeResultMessageSchema,
  contactRequestMessageSchema,
  genericMessageSchema,
  recommendationMessageSchema,
  welcomeMessageSchema,
} from './structured-message';
import { providerFitCriteriaSchema } from './provider-fit';

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
      'consultar_faq',
    ])
    .nullable(),
  kbQuery: z.string().nullable().optional(),
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
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  providerFitCriteria: providerFitCriteriaSchema,
});

const SUPPORT_EMAIL = 'hola@sinenvolturas.com';

type RuntimeContext = {
  toolUsage: ComposeReplyRequest['toolUsage'];
};

export class OpenAiAgentRuntime implements AgentRuntime {
  private readonly client: OpenAI;

  constructor(
    private readonly options: {
      apiKey: string;
      replyModel: string;
      extractorModel: string;
      promptCacheRetention: 'in-memory' | '24h';
      replyProviderLimit: number;
      presentationProviderLimit: number;
      providerDetailLookupLimit: number;
      promptLoader: PromptLoader;
      providerGateway: ProviderGateway;
      knowledgeBase?: {
        enabled: boolean;
        vectorStoreId: string | null;
      };
    },
  ) {
    this.client = new OpenAI({ apiKey: options.apiKey, maxRetries: 3 });
  }

  async extract(request: ExtractRequest): Promise<ExtractResult> {
    const bundle = await this.options.promptLoader.loadExtractorBundle();
    const extractor = new Agent({
      name: 'plan_extractor',
      model: this.options.extractorModel,
      instructions: bundle.instructions,
      inputGuardrails: [this.createJailbreakInputGuardrail()],
      outputType: extractionSchema,
      modelSettings: this.buildModelSettings({
        model: this.options.extractorModel,
        cacheKey: `extractor:${bundle.id}`,
      }),
    });

    const input = this.composeExtractorInput(request);

    try {
      const result = await run(extractor, input);
      return {
        extraction: result.finalOutput as ExtractResult['extraction'],
        tokenUsage: this.extractTokenUsage(result),
      };
    } catch (error) {
      if (error instanceof InputGuardrailTripwireTriggered) {
        return {
          extraction: this.buildJailbreakExtraction(),
          tokenUsage: this.extractTokenUsage(error),
        };
      }
      throw error;
    }
  }

  async composeReply(
    request: ComposeReplyRequest,
  ): Promise<ComposeReplyResult> {
    const bundle = await this.options.promptLoader.loadNodeBundle(
      request.currentNode,
    );
    const tools = this.createTools(request, bundle.allowedTools);

    request.toolUsage.considered.push(...bundle.allowedTools);

    const fileSearchTool = this.createFileSearchTool(request);
    if (fileSearchTool) {
      request.toolUsage.considered.push(fileSearchTool.name);
    }
    const agentTools = fileSearchTool ? [...tools, fileSearchTool] : tools;

    const outputSchema = this.resolveOutputSchema(request);
    const agent = new Agent<RuntimeContext, typeof outputSchema>({
      name: `reply_${request.currentNode}`,
      model: this.options.replyModel,
      instructions: () => bundle.instructions,
      tools: agentTools,
      inputGuardrails: [this.createJailbreakInputGuardrail()],
      outputType: outputSchema,
      outputGuardrails: [this.createSupportEmailGuardrail<typeof outputSchema>()],
      modelSettings: this.buildReplyModelSettings(request, Boolean(fileSearchTool)),
    });

    const session = new OpenAIConversationsSession({
      client: this.client,
      conversationId: request.plan.conversation_id ?? undefined,
    });

    const recommendationFunnel: RecommendationFunnelTrace = {
      available_candidates: request.providerResults.length,
      context_candidates: Math.min(
        request.providerResults.length,
        this.options.replyProviderLimit,
      ),
      context_candidate_ids: request.providerResults
        .slice(0, this.options.replyProviderLimit)
        .map((provider) => provider.id),
      presentation_limit: this.options.presentationProviderLimit,
    };

    const input = this.composeConversationInput(request, recommendationFunnel);

    let finalOutput: unknown;
    let runResult: unknown;
    try {
      const result = await run(agent, input, {
        session,
        context: {
          toolUsage: request.toolUsage,
        },
      });
      finalOutput = result.finalOutput;
      runResult = result;
    } catch (error) {
      if (error instanceof InputGuardrailTripwireTriggered) {
        return {
          text: '',
          structuredMessage: {
            type: 'generic',
            actions: [],
            paragraphs_es: [
              'No puedo ayudar a ignorar instrucciones, revelar prompts internos o saltarme las reglas del sistema. Sí puedo ayudarte con preguntas sobre Sin Envolturas o con tu plan de evento.',
            ],
          },
          tokenUsage: this.extractTokenUsage(error),
          recommendationFunnel,
        };
      }
      if (error instanceof OutputGuardrailTripwireTriggered) {
        finalOutput = error.result.agentOutput;
        runResult = error;
      } else {
        throw error;
      }
    }
    this.recordHostedToolUsage(request.toolUsage, runResult);

    request.plan.conversation_id = await session.getSessionId();

    const parseSchema = this.resolveOutputSchema(request);
    const structured = parseSchema.parse(this.normalizeSupportEmails(finalOutput));

    return {
      text: '',
      structuredMessage: structured,
      tokenUsage: this.extractTokenUsage(runResult),
      recommendationFunnel,
    };
  }

  private extractTokenUsage(value: unknown): TokenUsage | null {
    const candidates = this.collectUsageCandidates(value);
    for (const candidate of candidates) {
      const parsed = this.parseTokenUsage(candidate);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private collectUsageCandidates(value: unknown): unknown[] {
    if (!value || typeof value !== 'object') {
      return [];
    }

    const root = value as Record<string, unknown>;
    const nestedKeys = [
      'usage',
      'response',
      'rawResponse',
      'finalResponse',
      'result',
      'state',
      'runContext',
      'lastTurnResponse',
    ];
    const candidates: unknown[] = [root];

    for (const key of nestedKeys) {
      const entry = root[key];
      if (!entry) {
        continue;
      }
      candidates.push(entry);
      if (typeof entry === 'object') {
        const nested = entry as Record<string, unknown>;
        if (nested.usage) {
          candidates.push(nested.usage);
        }
        if (nested.response) {
          candidates.push(nested.response);
        }
        if (nested.lastTurnResponse) {
          candidates.push(nested.lastTurnResponse);
        }
        const nestedRawResponses = nested.rawResponses;
        if (Array.isArray(nestedRawResponses)) {
          for (const entry of nestedRawResponses) {
            candidates.push(entry);
          }
        }
      }
    }

    if (Array.isArray(root.rawResponses)) {
      for (const response of root.rawResponses) {
        candidates.push(response);
        if (response && typeof response === 'object') {
          const typedResponse = response as Record<string, unknown>;
          if (typedResponse.usage) {
            candidates.push(typedResponse.usage);
          }
          if (typedResponse.providerData && typeof typedResponse.providerData === 'object') {
            const providerData = typedResponse.providerData as Record<string, unknown>;
            if (providerData.usage) {
              candidates.push(providerData.usage);
            }
            if (providerData.response && typeof providerData.response === 'object') {
              const providerResponse = providerData.response as Record<string, unknown>;
              if (providerResponse.usage) {
                candidates.push(providerResponse.usage);
              }
            }
          }
        }
      }
    }

    if (typeof root.state === 'object' && root.state) {
      const state = root.state as Record<string, unknown>;
      if (Array.isArray(state.rawResponses)) {
        for (const response of state.rawResponses) {
          candidates.push(response);
          if (response && typeof response === 'object') {
            const typedResponse = response as Record<string, unknown>;
            if (typedResponse.usage) {
              candidates.push(typedResponse.usage);
            }
          }
        }
      }
    }

    return candidates;
  }

  private parseTokenUsage(value: unknown): TokenUsage | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const usage = value as Record<string, unknown>;
    const inputTokens = this.readNumericField(
      usage,
      ['input_tokens', 'prompt_tokens', 'inputTokenCount', 'inputTokens'],
    );
    const outputTokens = this.readNumericField(
      usage,
      ['output_tokens', 'completion_tokens', 'outputTokenCount', 'outputTokens'],
    );
    const totalTokens = this.readNumericField(
      usage,
      ['total_tokens', 'totalTokenCount', 'totalTokens'],
    );
    const cachedInputTokens = this.resolveCachedInputTokens(usage);

    if (
      inputTokens === null &&
      outputTokens === null &&
      totalTokens === null &&
      cachedInputTokens === null
    ) {
      return null;
    }

    const safeInput = inputTokens ?? 0;
    const safeOutput = outputTokens ?? 0;
    const safeTotal = totalTokens ?? safeInput + safeOutput;

    return {
      input_tokens: safeInput,
      output_tokens: safeOutput,
      total_tokens: safeTotal,
      cached_input_tokens: cachedInputTokens ?? 0,
    };
  }

  private readNumericField(
    source: Record<string, unknown>,
    keys: string[],
  ): number | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  private resolveCachedInputTokens(source: Record<string, unknown>): number | null {
    const topLevel = this.readNumericField(source, [
      'cached_tokens',
      'cached_input_tokens',
      'cachedInputTokens',
    ]);
    if (topLevel !== null) {
      return topLevel;
    }

    const detailsCandidates = [
      source.prompt_tokens_details,
      source.input_tokens_details,
      source.promptTokenDetails,
      source.inputTokenDetails,
      source.inputTokensDetails,
    ];
    for (const details of detailsCandidates) {
      const cached = this.readCachedTokensFromDetails(details);
      if (cached !== null) {
        return cached;
      }
    }

    const requestUsageEntries = source.request_usage_entries ?? source.requestUsageEntries;
    if (Array.isArray(requestUsageEntries)) {
      let aggregateCachedTokens = 0;
      let foundCachedTokens = false;
      for (const entry of requestUsageEntries) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const requestEntry = entry as Record<string, unknown>;
        const requestCached = this.readCachedTokensFromDetails(
          requestEntry.input_tokens_details ?? requestEntry.inputTokensDetails,
        );
        if (requestCached !== null) {
          aggregateCachedTokens += requestCached;
          foundCachedTokens = true;
        }
      }
      if (foundCachedTokens) {
        return aggregateCachedTokens;
      }
    }

    return null;
  }

  private readCachedTokensFromDetails(details: unknown): number | null {
    if (!details) {
      return null;
    }

    if (Array.isArray(details)) {
      let aggregateCachedTokens = 0;
      let foundCachedTokens = false;
      for (const entry of details) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const nested = entry as Record<string, unknown>;
        const cached = this.readNumericField(nested, ['cached_tokens', 'cachedTokens']);
        if (cached !== null) {
          aggregateCachedTokens += cached;
          foundCachedTokens = true;
        }
      }
      return foundCachedTokens ? aggregateCachedTokens : null;
    }

    if (typeof details === 'object') {
      const nested = details as Record<string, unknown>;
      return this.readNumericField(nested, ['cached_tokens', 'cachedTokens']);
    }

    return null;
  }

  private composeExtractorInput(request: ExtractRequest): string {
    return [
      `Mensaje del usuario: ${request.userMessage}`,
      `Plan base (JSON compacto): ${JSON.stringify(this.buildExtractorPlanSnapshot(request.plan))}`,
      'Extrae solo cambios nuevos del turno. Si un dato no cambia, mantenlo como null/vacio para no sobreescribir sin evidencia.',
    ].join('\n');
  }

  private buildExtractorPlanSnapshot(plan: PersistedPlan): Record<string, unknown> {
    return {
      current_node: plan.current_node,
      intent: plan.intent,
      event_type: plan.event_type,
      active_need_category: plan.active_need_category,
      vendor_category: plan.vendor_category,
      location: plan.location,
      budget_signal: plan.budget_signal,
      guest_range: plan.guest_range,
      missing_fields: plan.missing_fields,
      provider_needs: plan.provider_needs.map((need) => ({
        category: need.category,
        status: need.status,
        missing_fields: need.missing_fields,
        selected_provider_id: need.selected_provider_id,
        selected_provider_hint: need.selected_provider_hint,
        recommended_providers: need.recommended_providers.slice(0, 4).map((provider, index) => ({
          rank: index + 1,
          id: provider.id,
          title: provider.title,
        })),
      })),
      selected_provider_id: plan.selected_provider_id,
      selected_provider_hint: plan.selected_provider_hint,
      contact_name: plan.contact_name,
      contact_email: plan.contact_email,
      contact_phone: plan.contact_phone,
      conversation_summary: this.truncateText(plan.conversation_summary, 180),
      open_questions: plan.open_questions.slice(0, 3),
    };
  }

  private buildModelSettings(args: {
    model: string;
    cacheKey: string;
  }): {
    promptCacheRetention: 'in-memory' | '24h';
    providerData: Record<string, string>;
    reasoning?: { effort: 'none' };
    text?: { verbosity: 'low' };
    retry?: {
      maxRetries: number;
      backoff: { initialDelayMs: number; maxDelayMs: number; multiplier: number; jitter: boolean };
      policy: ReturnType<typeof retryPolicies.any>;
    };
  } {
    const baseSettings: {
      promptCacheRetention: 'in-memory' | '24h';
      providerData: Record<string, string>;
      reasoning?: { effort: 'none' };
      text?: { verbosity: 'low' };
      retry?: {
        maxRetries: number;
        backoff: { initialDelayMs: number; maxDelayMs: number; multiplier: number; jitter: boolean };
        policy: ReturnType<typeof retryPolicies.any>;
      };
    } = {
      promptCacheRetention:
        this.options.promptCacheRetention === 'in-memory'
          ? ('in_memory' as unknown as 'in-memory')
          : '24h',
      providerData: {
        prompt_cache_key: args.cacheKey,
      },
      retry: {
        maxRetries: 3,
        backoff: { initialDelayMs: 1000, maxDelayMs: 30_000, multiplier: 2, jitter: true },
        policy: retryPolicies.any(
          retryPolicies.httpStatus([429]),
          retryPolicies.networkError(),
        ),
      },
    };

    if (this.isGpt5Model(args.model)) {
      return {
        ...baseSettings,
        reasoning: { effort: 'none' },
        text: { verbosity: 'low' },
      };
    }

    return baseSettings;
  }

  private isGpt5Model(model: string): boolean {
    return model.toLowerCase().startsWith('gpt-5');
  }

  private composeConversationInput(
    request: ComposeReplyRequest,
    recommendationFunnel: RecommendationFunnelTrace,
  ): string {
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
      `Plan resumido: ${JSON.stringify(this.buildPromptPlanSnapshot(request.plan), null, 2)}`,
      `Necesidad activa: ${activeNeed?.category ?? 'ninguna todavía'}`,
      `Necesidades del plan:\n${summarizeProviderNeeds(request.plan.provider_needs)}`,
      `Faltantes: ${request.missingFields.join(', ') || 'ninguno'}`,
      `Listo para buscar: ${request.searchReady ? 'sí' : 'no'}`,
      `Herramientas autorizadas en este nodo: ${allowedTools}`,
      `Resultados vigentes:\n${summarizeRecommendedProviders(providerResults)}`,
      `Embudo de recomendación: ${recommendationFunnel.available_candidates} candidatos disponibles; ${recommendationFunnel.context_candidates} enviados al modelo; objetivo de presentación final: ${recommendationFunnel.presentation_limit}.`,
      request.errorMessage ? `Nota operativa: ${request.errorMessage}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private resolveOutputSchema(request: ComposeReplyRequest) {
    const node = request.currentNode;
    if (node === 'contacto_inicial') {
      return welcomeMessageSchema;
    }
    if (node === 'recomendar') {
      return recommendationMessageSchema;
    }
    if (node === 'crear_lead_cerrar') {
      const hasContact =
        request.plan.contact_name &&
        request.plan.contact_email &&
        request.plan.contact_phone;
      if (!hasContact) {
        return contactRequestMessageSchema;
      }
      if (request.plan.lifecycle_state === 'finished') {
        return closeResultMessageSchema;
      }
      return closeConfirmationMessageSchema;
    }
    return genericMessageSchema;
  }

  private buildReplyModelSettings(
    request: ComposeReplyRequest,
    hasFileSearchTool: boolean,
  ) {
    const settings = this.buildModelSettings({
      model: this.options.replyModel,
      cacheKey: `reply:${request.currentNode}:${request.promptBundleId}`,
    });

    if (request.currentNode === 'consultar_faq' && hasFileSearchTool) {
      return {
        ...settings,
        toolChoice: 'required' as const,
      };
    }

    return settings;
  }

  private createFileSearchTool(request: ComposeReplyRequest): HostedTool | null {
    const kb = this.options.knowledgeBase;
    if (request.currentNode !== 'consultar_faq' || !kb?.enabled || !kb.vectorStoreId) {
      return null;
    }

    return fileSearchTool(kb.vectorStoreId, {
      includeSearchResults: true,
      maxNumResults: 6,
    });
  }

  private createSupportEmailGuardrail<TOutput extends AgentOutputType>(): OutputGuardrail<TOutput, RuntimeContext> {
    return {
      name: 'support_email_integrity',
      execute: async ({ agentOutput }) => {
        const violations = this.findSupportEmailViolations(agentOutput);
        return {
          outputInfo: {
            violations,
            expectedEmail: SUPPORT_EMAIL,
          },
          tripwireTriggered: violations.length > 0,
        };
      },
    };
  }

  private createJailbreakInputGuardrail(): InputGuardrail {
    return {
      name: 'jailbreak_prompt_injection',
      runInParallel: false,
      execute: async ({ input }) => {
        const violations = this.findJailbreakViolations(input);
        return {
          outputInfo: { violations },
          tripwireTriggered: violations.length > 0,
        };
      },
    };
  }

  private findJailbreakViolations(value: unknown): string[] {
    const text = this.stringifyForGuardrail(value).toLowerCase();
    const patterns: Array<{ id: string; pattern: RegExp }> = [
      { id: 'ignore_instructions', pattern: /\b(ignore|ignora|olvida|bypass|salt[aá]te|omite)\b.{0,80}\b(instructions?|instrucciones|reglas|system|sistema|developer)\b/iu },
      { id: 'reveal_prompt', pattern: /\b(reveal|muestra|mu[eé]strame|dime|imprime|print)\b.{0,80}\b(system prompt|prompt del sistema|developer message|mensaje de developer|instrucciones internas)\b/iu },
      { id: 'jailbreak_keyword', pattern: /\b(jailbreak|prompt injection|inyecci[oó]n de prompt|modo dan|developer mode)\b/iu },
      { id: 'role_override', pattern: /\b(act[uú]a como|pretend to be|simula ser)\b.{0,80}\b(system|developer|admin|root)\b/iu },
    ];

    return patterns
      .filter(({ pattern }) => pattern.test(text))
      .map(({ id }) => id);
  }

  private buildJailbreakExtraction(): ExtractResult['extraction'] {
    return {
      intent: null,
      intentConfidence: 1,
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
      conversationSummary: 'El usuario intentó saltarse instrucciones internas.',
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
        rankingNotes: 'No aplicar búsqueda ante intento de elusión.',
      },
    };
  }

  private findSupportEmailViolations(value: unknown): string[] {
    const text = this.stringifyForGuardrail(value);
    const violations = new Set<string>();
    const malformedPatterns = [
      /\[email\s*protected\]/giu,
      /\bemail\s+protected\b/giu,
      /\bhola\s*(?:\[at\]|\(at\)| at )\s*sinenvolturas\.com\b/giu,
    ];

    for (const pattern of malformedPatterns) {
      for (const match of text.matchAll(pattern)) {
        violations.add(match[0]);
      }
    }

    const sinEnvolturasEmails = text.match(/\b[A-Z0-9._%+-]+@sinenvolturas\.com\b/giu) ?? [];
    for (const email of sinEnvolturasEmails) {
      if (email.toLowerCase() !== SUPPORT_EMAIL) {
        violations.add(email);
      }
    }

    return Array.from(violations);
  }

  private normalizeSupportEmails(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.normalizeSupportEmailText(value);
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeSupportEmails(entry));
    }

    if (value && typeof value === 'object') {
      const normalized: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        normalized[key] = this.normalizeSupportEmails(entry);
      }
      return normalized;
    }

    return value;
  }

  private normalizeSupportEmailText(value: string): string {
    return value
      .replace(/\[email\s*protected\]/giu, SUPPORT_EMAIL)
      .replace(/\bemail\s+protected\b/giu, SUPPORT_EMAIL)
      .replace(/\bhola\s*(?:\[at\]|\(at\)| at )\s*sinenvolturas\.com\b/giu, SUPPORT_EMAIL)
      .replace(/\b(?!hola@)[A-Z0-9._%+-]+@sinenvolturas\.com\b/giu, SUPPORT_EMAIL);
  }

  private stringifyForGuardrail(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private createTools(
    request: ComposeReplyRequest,
    allowedTools: readonly ToolName[],
  ) {
    const toolUsage = request.toolUsage;
    const plan = request.plan;
    let remainingProviderDetailLookups =
      this.options.providerDetailLookupLimit;

    const toolMap = {
      list_categories: tool({
        name: 'list_categories',
        description:
          'Lista categorías reales del marketplace para aclarar ambigüedad.',
        parameters: z.object({}).strict(),
        execute: async () => {
          this.recordToolInput(toolUsage, 'list_categories', {});
          toolUsage.called.push('list_categories');
          const result = await this.options.providerGateway.listCategories();
          this.recordToolOutput(toolUsage, 'list_categories', result);
          return result;
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
          this.recordToolInput(toolUsage, 'get_category_by_slug', { slug });
          toolUsage.called.push('get_category_by_slug');
          const result = await this.options.providerGateway.getCategoryBySlug(slug);
          this.recordToolOutput(toolUsage, 'get_category_by_slug', result);
          return result;
        },
      }),
      list_locations: tool({
        name: 'list_locations',
        description:
          'Lista ubicaciones reales del marketplace para normalizar la ciudad o país.',
        parameters: z.object({}),
        execute: async () => {
          this.recordToolInput(toolUsage, 'list_locations', {});
          toolUsage.called.push('list_locations');
          const result = await this.options.providerGateway.listLocations();
          this.recordToolOutput(toolUsage, 'list_locations', result);
          return result;
        },
      }),
      search_providers_from_plan: tool({
        name: 'search_providers_from_plan',
        description:
          'Busca proveedores usando únicamente el plan vigente ya validado.',
        parameters: z.object({}),
        execute: async () => {
          this.recordToolInput(toolUsage, 'search_providers_from_plan', {});
          toolUsage.called.push('search_providers_from_plan');
          const result = await this.options.providerGateway.searchProviders(plan);
          this.recordToolOutput(toolUsage, 'search_providers_from_plan', result);
          return result;
        },
      }),
      search_providers_by_keyword: tool({
        name: 'search_providers_by_keyword',
        description:
          'Busca proveedores por palabra clave exacta con paginación controlada.',
        parameters: z
          .object({
            keyword: z.string().min(2),
            page: z.number().int().positive().nullish(),
          })
          .strict(),
        execute: async ({ keyword, page }) => {
          this.recordToolInput(toolUsage, 'search_providers_by_keyword', {
            keyword,
            page: page ?? null,
          });
          toolUsage.called.push('search_providers_by_keyword');
          const result = await this.options.providerGateway.searchProvidersByKeyword({
            keyword,
            page: page ?? null,
          });
          this.recordToolOutput(toolUsage, 'search_providers_by_keyword', result);
          return result;
        },
      }),
      search_providers_by_category_location: tool({
        name: 'search_providers_by_category_location',
        description:
          'Busca proveedores combinando categoría y ubicación en una consulta controlada.',
        parameters: z
          .object({
            category: z.string().min(2),
            location: z.string().min(2).nullish(),
            page: z.number().int().positive().nullish(),
          })
          .strict(),
        execute: async ({ category, location, page }) => {
          this.recordToolInput(toolUsage, 'search_providers_by_category_location', {
            category,
            location: location ?? null,
            page: page ?? null,
          });
          toolUsage.called.push('search_providers_by_category_location');
          const result = await this.options.providerGateway.searchProvidersByCategoryLocation(
            {
              category,
              location: location ?? null,
              page: page ?? null,
            },
          );
          this.recordToolOutput(
            toolUsage,
            'search_providers_by_category_location',
            result,
          );
          return result;
        },
      }),
      get_relevant_providers: tool({
        name: 'get_relevant_providers',
        description:
          'Trae proveedores relevantes del marketplace para exploración o fallback.',
        parameters: z.object({}),
        execute: async () => {
          this.recordToolInput(toolUsage, 'get_relevant_providers', {});
          toolUsage.called.push('get_relevant_providers');
          const result = await this.options.providerGateway.getRelevantProviders();
          this.recordToolOutput(toolUsage, 'get_relevant_providers', result);
          return result;
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
          this.recordToolInput(toolUsage, 'get_provider_detail', { provider_id });
          if (remainingProviderDetailLookups <= 0) {
            return null;
          }

          remainingProviderDetailLookups -= 1;
          toolUsage.called.push('get_provider_detail');
          const result = await this.options.providerGateway.getProviderDetail(provider_id);
          const safeResult = this.stripRawFields(result);
          this.recordToolOutput(toolUsage, 'get_provider_detail', safeResult);
          return safeResult;
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
          this.recordToolInput(toolUsage, 'get_provider_detail_and_track_view', {
            provider_id,
          });
          toolUsage.called.push('get_provider_detail_and_track_view');
          const result = await this.options.providerGateway.getProviderDetailAndTrackView(
            provider_id,
          );
          const safeResult = this.stripRawFields(result);
          this.recordToolOutput(
            toolUsage,
            'get_provider_detail_and_track_view',
            safeResult,
          );
          return safeResult;
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
          this.recordToolInput(toolUsage, 'get_related_providers', { provider_id });
          toolUsage.called.push('get_related_providers');
          const result = await this.options.providerGateway.getRelatedProviders(provider_id);
          this.recordToolOutput(toolUsage, 'get_related_providers', result);
          return result;
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
          this.recordToolInput(toolUsage, 'list_provider_reviews', { provider_id });
          toolUsage.called.push('list_provider_reviews');
          const result = await this.options.providerGateway.listProviderReviews(provider_id);
          const safeResult = this.stripRawFields(result);
          this.recordToolOutput(toolUsage, 'list_provider_reviews', safeResult);
          return safeResult;
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
          this.recordToolInput(toolUsage, 'get_event_vendor_context', { event_id });
          toolUsage.called.push('get_event_vendor_context');
          const result = await this.options.providerGateway.getEventVendorContext(event_id);
          this.recordToolOutput(toolUsage, 'get_event_vendor_context', result);
          return result;
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
          this.recordToolInput(toolUsage, 'list_event_favorite_providers', {
            event_id,
            sort_by: sort_by ?? null,
            page: page ?? null,
            category_id: category_id ?? null,
          });
          toolUsage.called.push('list_event_favorite_providers');
          const result = await this.options.providerGateway.listEventFavoriteProviders({
            eventId: event_id,
            sortBy: sort_by ?? null,
            page: page ?? null,
            categoryId: category_id ?? null,
          });
          this.recordToolOutput(toolUsage, 'list_event_favorite_providers', result);
          return result;
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
          this.recordToolInput(toolUsage, 'list_user_events_vendor_context', {
            user_id,
          });
          toolUsage.called.push('list_user_events_vendor_context');
          const result = await this.options.providerGateway.listUserEventsVendorContext(
            user_id,
          );
          this.recordToolOutput(toolUsage, 'list_user_events_vendor_context', result);
          return result;
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
          this.recordToolInput(toolUsage, 'create_quote_request', {
            provider_id,
            user_id,
            name,
            email,
            phone,
            phone_extension,
            event_date,
            guests_range,
            description,
          });
          toolUsage.called.push('create_quote_request');
          const result = await this.options.providerGateway.createQuoteRequest({
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
          this.recordToolOutput(toolUsage, 'create_quote_request', result);
          return result;
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
          this.recordToolInput(toolUsage, 'add_vendor_to_event_favorites', {
            provider_id,
            user_id,
            event_id,
          });
          toolUsage.called.push('add_vendor_to_event_favorites');
          const result = await this.options.providerGateway.addVendorToEventFavorites({
            providerId: provider_id,
            userId: user_id,
            eventId: event_id,
          });
          this.recordToolOutput(toolUsage, 'add_vendor_to_event_favorites', result);
          return result;
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
          this.recordToolInput(toolUsage, 'create_provider_review', {
            provider_id,
            user_id,
            name,
            rating,
            comment: comment ?? null,
          });
          toolUsage.called.push('create_provider_review');
          const result = await this.options.providerGateway.createProviderReview({
            providerId: provider_id,
            userId: user_id,
            name,
            rating,
            comment: comment ?? null,
          });
          this.recordToolOutput(toolUsage, 'create_provider_review', result);
          return result;
        },
      }),
      finish_plan: tool({
        name: 'finish_plan',
        description:
          'Cierra el plan definitivamente. Envía solicitudes de cotización (/quote) a cada proveedor seleccionado por necesidad usando los datos de contacto ya guardados en el plan (contact_name, contact_email, contact_phone). Requiere que al menos un proveedor esté seleccionado y que los datos de contacto estén completos.',
        parameters: z.object({}).strict(),
        execute: async () => {
          this.recordToolInput(toolUsage, 'finish_plan', {});
          toolUsage.called.push('finish_plan');
          const result = await executeFinishPlanTool({
            plan,
            providerGateway: this.options.providerGateway,
          });
          this.recordToolOutput(toolUsage, 'finish_plan', result);
          return result;
        },
      }),
    } satisfies Record<ToolName, ReturnType<typeof tool>>;

    return allowedTools.map((name) => toolMap[name]);
  }

  private recordToolOutput(
    toolUsage: RuntimeContext['toolUsage'],
    tool: string,
    output: unknown,
  ): void {
    toolUsage.outputs.push({
      tool,
      output: JSON.stringify(output, null, 2) ?? 'null',
    });
  }

  private recordToolInput(
    toolUsage: RuntimeContext['toolUsage'],
    tool: string,
    input: Record<string, unknown>,
  ): void {
    toolUsage.inputs.push({
      tool,
      input: JSON.stringify(input, null, 2) ?? 'null',
    });
  }

  private recordHostedToolUsage(
    toolUsage: RuntimeContext['toolUsage'],
    result: unknown,
  ): void {
    const resultRecord = result && typeof result === 'object'
      ? result as Record<string, unknown>
      : null;
    const currentTurnItems = Array.isArray(resultRecord?.newItems)
      ? resultRecord.newItems
      : result;
    const hostedCalls = this.collectHostedToolCalls(currentTurnItems);
    for (const call of hostedCalls) {
      if (!toolUsage.called.includes(call.name)) {
        toolUsage.called.push(call.name);
      }
      this.recordToolInput(toolUsage, call.name, {
        arguments: call.arguments ?? null,
        queries: call.queries,
      });
      toolUsage.outputs.push({
        tool: call.name,
        output: JSON.stringify({
          status: call.status ?? null,
          result_count: call.resultCount,
        }, null, 2),
      });
    }
  }

  private collectHostedToolCalls(value: unknown): Array<{
    name: string;
    arguments: string | null;
    queries: string[];
    status: string | null;
    resultCount: number | null;
  }> {
    const calls: Array<{
      name: string;
      arguments: string | null;
      queries: string[];
      status: string | null;
      resultCount: number | null;
    }> = [];
    const seen = new Set<unknown>();
    const visit = (entry: unknown): void => {
      if (!entry || typeof entry !== 'object' || seen.has(entry)) {
        return;
      }
      seen.add(entry);
      const record = entry as Record<string, unknown>;
      const providerData = record.providerData && typeof record.providerData === 'object'
        ? record.providerData as Record<string, unknown>
        : null;
      const type = typeof record.type === 'string'
        ? record.type
        : typeof providerData?.type === 'string'
          ? providerData.type
          : null;
      const rawName = typeof record.name === 'string'
        ? record.name
        : typeof providerData?.name === 'string'
          ? providerData.name
          : type === 'file_search_call'
            ? 'file_search'
            : null;

      if (type === 'hosted_tool_call' || type === 'file_search_call') {
        const queries = this.extractStringArray(providerData?.queries ?? record.queries);
        const results = Array.isArray(providerData?.results)
          ? providerData.results
          : Array.isArray(record.results)
            ? record.results
            : null;
        calls.push({
          name: rawName === 'file_search_call' ? 'file_search' : rawName ?? 'hosted_tool',
          arguments: typeof record.arguments === 'string' ? record.arguments : null,
          queries,
          status: typeof record.status === 'string' ? record.status : null,
          resultCount: results ? results.length : null,
        });
      }

      for (const nested of Object.values(record)) {
        if (Array.isArray(nested)) {
          for (const item of nested) {
            visit(item);
          }
        } else {
          visit(nested);
        }
      }
    };

    visit(value);
    return calls;
  }

  private extractStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  private buildPromptPlanSnapshot(plan: PersistedPlan): Record<string, unknown> {
    return {
      lifecycle_state: plan.lifecycle_state,
      contact_name: plan.contact_name,
      contact_email: plan.contact_email,
      contact_phone: plan.contact_phone,
      current_node: plan.current_node,
      intent: plan.intent,
      event_type: plan.event_type,
      active_need_category: plan.active_need_category,
      vendor_category: plan.vendor_category,
      location: plan.location,
      budget_signal: plan.budget_signal,
      guest_range: plan.guest_range,
      missing_fields: plan.missing_fields,
      provider_needs: plan.provider_needs.map((need) => ({
        category: need.category,
        status: need.status,
        missing_fields: need.missing_fields,
        selected_provider_id: need.selected_provider_id,
        recommended_provider_ids: need.recommended_provider_ids.slice(0, 6),
      })),
      selected_provider_id: plan.selected_provider_id,
      selected_provider_hint: plan.selected_provider_hint,
      conversation_summary: this.truncateText(plan.conversation_summary, 300),
      open_questions: plan.open_questions.slice(0, 5),
    };
  }

  private stripRawFields(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.stripRawFields(entry));
    }

    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};

      for (const [key, entry] of Object.entries(objectValue)) {
        if (key === 'raw') {
          continue;
        }
        next[key] = this.stripRawFields(entry);
      }
      return next;
    }

    return value;
  }

  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }
}
