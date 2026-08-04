import {
  Agent,
  InputGuardrailTripwireTriggered,
  OpenAIProvider,
  OutputGuardrailTripwireTriggered,
  Runner,
  tool,
} from '@openai/agents';
import type {
  AgentOutputType,
  InputGuardrail,
  OutputGuardrail,
} from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

import type { PersistedPlan } from '../core/plan';
import { getActiveNeed } from '../core/plan';
import {
  prioritizedProviderCategoriesForEvent,
  starterProviderCategoriesForEvent,
} from '../core/event-provider-priorities';
import { executeFinishPlanTool } from './finish-plan-tool';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractResult,
  ExtractRequest,
  OpenAiCallRef,
  OpenAiRequestMetrics,
  TokenUsage,
} from './contracts';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { ProviderSummary } from '../core/provider';
import type { ToolName } from './prompt-manifest';
import type { RecommendationFunnelTrace } from '../core/trace';
import type { AgentFeatureFlags } from './config';
import {
  closeConfirmationMessageSchema,
  closeResultMessageSchema,
  contactRequestMessageSchema,
  genericMessageSchema,
  multiNeedRecommendationMessageSchema,
  recommendationMessageSchema,
  welcomeMessageSchema,
} from './structured-message';
import { providerCategorySchema, categoryBucketNames } from '../core/provider-category';
import {
  createDynamicExtractionSchema,
  type OpenAiInformationRequest,
  type StructuredExtraction,
} from './extraction-schemas';
import { providerFitCriteriaSchema } from './provider-fit';
import {
  deriveDynamicAgentPolicy,
  resolveDynamicTools,
  type DynamicAgentPolicy,
} from './dynamic-agent-policy';
import { buildModelVisibleConversationHistory } from './turn-message-context';
import { openAiRetryPolicy } from './openai-retry';

const SUPPORT_EMAIL = 'hola@sinenvolturas.com';

type RuntimeContext = {
  toolUsage: ComposeReplyRequest['toolUsage'];
};

type ReplyTurnEvidence = {
  nodes: {
    previous: string;
    current: string;
  };
  history: {
    status: ComposeReplyRequest['messageContext']['historyStatus'];
    recent_messages: ReturnType<typeof buildModelVisibleConversationHistory>;
  };
  user_message: string;
  decision: Record<string, unknown> | null;
  extraction: Record<string, unknown>;
  plan: Record<string, unknown>;
  information_results: unknown[];
  turn_state: {
    focus_need_category: PersistedPlan['active_need_category'];
    missing_fields: string[];
    search_ready: boolean;
    missing_fields_instruction: string;
  };
  provider_candidates: Array<Record<string, unknown>>;
  recommendation_funnel: RecommendationFunnelTrace | null;
};

export class OpenAiAgentRuntime implements AgentRuntime {
  private readonly runner: Runner;

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
      features?: AgentFeatureFlags;
      openAIClient?: OpenAI;
    },
  ) {
    const openAIClient = options.openAIClient ?? new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 0,
    });
    this.runner = new Runner({
      modelProvider: new OpenAIProvider({ openAIClient }),
    });
  }

  async extract(request: ExtractRequest): Promise<ExtractResult> {
    const bundle = await this.options.promptLoader.loadExtractorBundle();
    const policy = deriveDynamicAgentPolicy(request.plan);
    const features = this.resolveFeatureFlags();
    const informationEnabled =
      features.faq ||
      features.invitedEventLookup ||
      features.purchaseInformation;
    const allowedActionIntents = features.providerPlanning
      ? policy.allowedActionIntents
      : policy.allowedActionIntents.filter(
          (actionIntent) => actionIntent === 'solicitar_humano',
        );
    const outputSchema = createDynamicExtractionSchema({
      allowedActionIntents,
      capabilities: {
        information: informationEnabled,
        providerPlanning: features.providerPlanning,
        providerOperations:
          features.providerPlanning && policy.capabilities.hasActivePlan,
        providerSelection:
          features.providerPlanning && policy.capabilities.hasShortlist,
        providerInspection:
          features.providerPlanning && policy.capabilities.hasShortlist,
        contact: informationEnabled || policy.capabilities.canClose,
        close: features.providerPlanning && policy.capabilities.canClose,
        pause: features.providerPlanning && policy.capabilities.canPause,
      },
    });
    const extractor = new Agent({
      name: 'plan_extractor',
      model: this.options.extractorModel,
      instructions: bundle.instructions,
      inputGuardrails: [this.createJailbreakInputGuardrail()],
      outputType: outputSchema,
      modelSettings: this.buildModelSettings({
        model: this.options.extractorModel,
        cacheKey: `extractor:${bundle.id}`,
      }),
    });

    const input = this.composeExtractorInput(request, policy);
    const requestMetrics = this.buildRequestMetrics({
      instructions: bundle.instructions,
      input,
      toolCount: 0,
      schemaPropertyCount: Object.keys(outputSchema.shape).length,
    });

    try {
      const result = await this.runner.run(extractor, input);
      return {
        extraction: this.normalizeExtraction(
          result.finalOutput as StructuredExtraction,
        ),
        tokenUsage: this.extractTokenUsage(result),
        openAiCall: this.extractOpenAiCallRef(
          result,
          this.options.extractorModel,
          requestMetrics,
        ),
      };
    } catch (error) {
      if (error instanceof InputGuardrailTripwireTriggered) {
        return {
          extraction: this.buildJailbreakExtraction(),
          tokenUsage: this.extractTokenUsage(error),
          openAiCall: null,
        };
      }
      throw error;
    }
  }

  private normalizeExtraction(
    extraction: Partial<StructuredExtraction>,
  ): ExtractResult['extraction'] {
    return {
      actionIntent: extraction.actionIntent ?? null,
      informationRequests: (extraction.informationRequests ?? []).flatMap((request) =>
        this.normalizeInformationRequest(request),
      ),
      intentConfidence: extraction.intentConfidence ?? null,
      ambiguity: extraction.ambiguity ?? {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
      eventType: extraction.eventType ?? null,
      vendorCategory: extraction.vendorCategory ?? null,
      vendorCategories: extraction.vendorCategories ?? [],
      activeNeedCategory: extraction.activeNeedCategory ?? null,
      location: extraction.location ?? null,
      budgetSignal: extraction.budgetSignal ?? null,
      guestRange: extraction.guestRange ?? null,
      preferences: extraction.preferences ?? [],
      hardConstraints: extraction.hardConstraints ?? [],
      assumptions: extraction.assumptions ?? [],
      conversationSummary: extraction.conversationSummary ?? '',
      selectedProviderHints: extraction.selectedProviderHints ?? [],
      selectedProviderReferences: extraction.selectedProviderReferences ?? [],
      closeAction: extraction.closeAction ?? null,
      pauseRequested: extraction.pauseRequested ?? false,
      contactName: extraction.contactName ?? null,
      contactEmail: extraction.contactEmail ?? null,
      contactPhone: extraction.contactPhone ?? null,
      providerFitCriteria: extraction.providerFitCriteria ?? null,
      providerQueryIntents: extraction.providerQueryIntents ?? [],
      providerPlanOperations: extraction.providerPlanOperations ?? [],
      providerExplanationRequest: extraction.providerExplanationRequest ?? null,
      providerDetailRequest: extraction.providerDetailRequest ?? null,
    };
  }

  private normalizeInformationRequest(
    request: OpenAiInformationRequest,
  ): ExtractResult['extraction']['informationRequests'] {
    if (request.kind === 'faq') {
      return [{ kind: 'faq', query: request.query }];
    }
    if (request.kind === 'associated_event') {
      return [
        {
          kind: 'associated_event',
          query: request.query,
          eventHint: request.eventHint,
        },
      ];
    }
    if (!request.resource || !request.authAction) {
      return [];
    }
    return [
      {
        kind: 'purchase',
        resource: request.resource,
        query: request.query,
        orderId: request.orderId,
        aspects:
          request.aspects.length > 0 ? request.aspects : ['summary'],
        sensitiveFields: request.sensitiveFields,
        authAction: request.authAction,
      },
    ];
  }

  async composeReply(
    request: ComposeReplyRequest,
  ): Promise<ComposeReplyResult> {
    const bundle = await this.options.promptLoader.loadNodeBundle(
      request.currentNode,
    );
    const allowedTools = resolveDynamicTools({
      plan: request.plan,
      maximumTools: bundle.allowedTools,
      searchReady: request.searchReady,
      providerResults: request.providerResults,
    });
    const tools = this.createTools(request, allowedTools);

    request.toolUsage.considered.push(...allowedTools);

    const outputSchema = this.resolveOutputSchema(request);
    const agent = new Agent<RuntimeContext, typeof outputSchema>({
      name: `reply_${request.currentNode}`,
      model: this.options.replyModel,
      instructions: () => bundle.instructions,
      tools,
      inputGuardrails: [this.createJailbreakInputGuardrail()],
      outputType: outputSchema,
      outputGuardrails: [this.createSupportEmailGuardrail<typeof outputSchema>()],
      modelSettings: this.buildReplyModelSettings(request),
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
    const requestMetrics = this.buildRequestMetrics({
      instructions: bundle.instructions,
      input,
      toolCount: tools.length,
      schemaPropertyCount: Object.keys(outputSchema.shape).length,
    });

    let finalOutput: unknown;
    let runResult: unknown;
    try {
      const result = await this.runner.run(agent, input, {
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
            paragraphs_es: [
              'No puedo ayudar a ignorar instrucciones, revelar prompts internos o saltarme las reglas del sistema. Sí puedo ayudarte con preguntas sobre Sin Envolturas o con tu plan de evento.',
            ],
          },
          tokenUsage: this.extractTokenUsage(error),
          recommendationFunnel,
          openAiCall: null,
        };
      }
      if (error instanceof OutputGuardrailTripwireTriggered) {
        finalOutput = error.result.agentOutput;
        runResult = error;
      } else {
        throw error;
      }
    }
    const parseSchema = outputSchema;
    const structured = parseSchema.parse(
      this.normalizeSpanishVocabulary(this.normalizeSupportEmails(finalOutput)),
    );
    return {
      text: '',
      structuredMessage: structured,
      tokenUsage: this.extractTokenUsage(runResult),
      recommendationFunnel,
      openAiCall: this.extractOpenAiCallRef(
        runResult,
        this.options.replyModel,
        requestMetrics,
      ),
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

  private buildRequestMetrics(args: {
    instructions: string;
    input: string;
    toolCount: number;
    schemaPropertyCount: number;
  }): OpenAiRequestMetrics {
    return {
      instructionBytes: Buffer.byteLength(args.instructions, 'utf8'),
      inputBytes: Buffer.byteLength(args.input, 'utf8'),
      toolCount: args.toolCount,
      schemaPropertyCount: args.schemaPropertyCount,
    };
  }

  private extractOpenAiCallRef(
    value: unknown,
    model: string,
    requestMetrics: OpenAiRequestMetrics,
  ): OpenAiCallRef | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const root = value as Record<string, unknown>;
    const responseId = typeof root.lastResponseId === 'string'
      ? root.lastResponseId
      : this.lastModelResponseField(root, 'responseId');
    if (!responseId) {
      return null;
    }
    const requestId = this.lastModelResponseField(root, 'requestId');
    const state = root.state && typeof root.state === 'object'
      ? root.state as Record<string, unknown>
      : null;
    const usage = state?.usage && typeof state.usage === 'object'
      ? state.usage as Record<string, unknown>
      : null;
    const attempts = usage
      ? this.readNumericField(usage, ['requests'])
      : null;

    return {
      responseId,
      requestId,
      model,
      attemptCount: Math.max(1, attempts ?? 1),
      requestMetrics,
    };
  }

  private lastModelResponseField(
    root: Record<string, unknown>,
    field: 'responseId' | 'requestId',
  ): string | null {
    const directResponses = this.toUnknownArray(root.rawResponses);
    const state = root.state && typeof root.state === 'object'
      ? root.state as Record<string, unknown>
      : null;
    const stateResponses = this.toUnknownArray(state?.rawResponses);
    const responses = directResponses.length > 0
      ? directResponses
      : stateResponses;
    const lastResponse = responses.at(-1);
    if (!lastResponse || typeof lastResponse !== 'object') {
      return null;
    }
    const candidate = (lastResponse as Record<string, unknown>)[field];
    return typeof candidate === 'string' ? candidate : null;
  }

  private toUnknownArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value as unknown[] : [];
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

  private composeExtractorInput(
    request: ExtractRequest,
    policy: DynamicAgentPolicy,
  ): string {
    const suggestedCategories = this.buildEventCategoryPromptContext(
      request.plan.event_type,
      'extractor',
    );
    return [
      `Estado del historial: ${request.messageContext.historyStatus}.`,
      `Historial reciente visible (JSON): ${JSON.stringify(buildModelVisibleConversationHistory(request.messageContext))}`,
      `Mensaje del usuario: ${request.userMessage}`,
      `Plan base (JSON compacto): ${JSON.stringify(this.buildExtractorPlanSnapshot(request.plan))}`,
      `Acciones disponibles en este turno: ${policy.allowedActionIntents.join(', ')}. No extraigas acciones fuera de esta lista.`,
      suggestedCategories,
      'Extrae solo cambios nuevos del turno. Si un dato no cambia, mantenlo como null/vacio para no sobreescribir sin evidencia.',
    ].join('\n');
  }

  private buildExtractorPlanSnapshot(plan: PersistedPlan): Record<string, unknown> {
    return {
      current_node: plan.current_node,
      action_intent:
        plan.current_node === 'resolver_consultas_informativas'
          ? null
          : plan.intent,
      event_type: plan.event_type,
      active_need_category: plan.active_need_category,
      vendor_category: plan.vendor_category,
      location: plan.location,
      budget_signal: plan.budget_signal,
      guest_range: plan.guest_range,
      preferences: plan.preferences,
      hard_constraints: plan.hard_constraints,
      missing_fields: plan.missing_fields.map((field) => this.userVisibleMissingFieldLabel(field)),
      provider_needs: plan.provider_needs.map((need) => ({
        category: need.category,
        status: need.status,
        preferences: need.preferences,
        hard_constraints: need.hard_constraints,
        missing_fields: need.missing_fields.map((field) => this.userVisibleMissingFieldLabel(field)),
        selected_provider_ids: need.selected_provider_ids,
        selected_provider_hints: need.selected_provider_hints,
        sub_query_results: (need.sub_query_results ?? []).map((result) => ({
          label: result.subQuery.label,
          selected_provider_ids: result.selected_provider_ids,
          no_match_reason: result.no_match_reason,
        })),
        recommended_providers: need.recommended_providers.slice(0, 4).map((provider, index) => ({
          rank: index + 1,
          id: provider.id,
          title: provider.title,
          category: provider.category,
          location: provider.location,
          price_level: provider.priceLevel,
          min_price: provider.minPrice,
          max_price: provider.maxPrice,
          reason: provider.reason,
          promo_badge: provider.promoBadge,
        })),
      })),
      selected_provider_ids: plan.selected_provider_ids,
      selected_provider_hints: plan.selected_provider_hints,
      contact_name: plan.contact_name,
      contact_email: plan.contact_email,
      contact_phone: plan.contact_phone,
      conversation_summary: this.truncateText(plan.conversation_summary, 180),
      open_questions: plan.open_questions.slice(0, 3),
      information_state: {
        pending_requests: plan.information_state.pending_requests,
        selection_candidates: plan.information_state.selection_candidates,
        authentication_status: plan.user_auth.status,
        authenticated_email: plan.user_auth.email,
      },
    };
  }

  private buildModelSettings(args: {
    model: string;
    cacheKey: string;
  }): {
    promptCacheRetention: 'in-memory' | '24h';
    providerData: Record<string, string>;
    store: true;
    reasoning?: { effort: 'none' };
    text?: { verbosity: 'low' };
    retry?: {
      maxRetries: number;
      backoff: { initialDelayMs: number; maxDelayMs: number; multiplier: number; jitter: boolean };
      policy: typeof openAiRetryPolicy;
    };
  } {
    const baseSettings: {
      promptCacheRetention: 'in-memory' | '24h';
      providerData: Record<string, string>;
      store: true;
      reasoning?: { effort: 'none' };
      text?: { verbosity: 'low' };
      retry?: {
        maxRetries: number;
        backoff: { initialDelayMs: number; maxDelayMs: number; multiplier: number; jitter: boolean };
        policy: typeof openAiRetryPolicy;
      };
    } = {
      promptCacheRetention:
        this.options.promptCacheRetention === 'in-memory'
          ? ('in_memory' as unknown as 'in-memory')
          : '24h',
      providerData: {
        prompt_cache_key: args.cacheKey,
      },
      store: true,
      retry: {
        maxRetries: 3,
        backoff: { initialDelayMs: 1000, maxDelayMs: 30_000, multiplier: 2, jitter: true },
        policy: openAiRetryPolicy,
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
    const stripProviders =
      request.currentNode === 'resolver_consultas_informativas';
    const includeAllGroupedProviders =
      request.currentNode === 'elicitacion_necesidades' &&
      this.hasShortlistedProviderNeeds(request.plan);
    const providerResults = stripProviders
      ? []
      : includeAllGroupedProviders
        ? this.collectRecommendedProvidersForMultiNeed(request.plan)
        : request.providerResults.slice(0, this.options.replyProviderLimit);
    const activeNeed = getActiveNeed(request.plan);
    const focusNeedCategory =
      request.turnDecision?.focusNeedCategory ?? activeNeed?.category ?? null;

    const evidence = this.buildReplyTurnEvidence({
      request,
      focusNeedCategory,
      providerResults,
      recommendationFunnel: stripProviders ? null : recommendationFunnel,
    });
    const parts: Array<string | null> = [
      `Evidencia canónica del turno (JSON): ${JSON.stringify(evidence, null, 2)}`,
      request.extraction.ambiguity?.status === 'ambiguous'
        ? 'La extracción marcó ambigüedad. Formula la respuesta alrededor de ambiguity.clarification_question y no reinicies la conversación con una bienvenida genérica.'
        : null,
      this.buildEventCategoryPromptContext(request.plan.event_type, 'reply'),
      `Capacidades habilitadas del agente:\n${this.summarizeEnabledCapabilities()}`,
    ];

    if (request.currentNode === 'entrevista') {
      parts.push(`Categorías de proveedores disponibles: ${categoryBucketNames.join(', ')}. No inventar categorías fuera de esta lista.`);
    }

    parts.push(`Herramientas autorizadas en este nodo: ${allowedTools}`);

    if (request.errorMessage) {
      parts.push(`Nota operativa: ${request.errorMessage}`);
    }

    return parts.filter(Boolean).join('\n\n');
  }

  private buildReplyTurnEvidence(args: {
    request: ComposeReplyRequest;
    focusNeedCategory: PersistedPlan['active_need_category'];
    providerResults: ProviderSummary[];
    recommendationFunnel: RecommendationFunnelTrace | null;
  }): ReplyTurnEvidence {
    const decision = args.request.turnDecision
      ? {
          route_kind: args.request.turnDecision.routeKind,
          presentation_scope: args.request.turnDecision.presentationScope,
          provider_search_mode: args.request.turnDecision.providerSearchMode,
          focus_need_category: args.request.turnDecision.focusNeedCategory,
          needs_to_present: args.request.turnDecision.needsToPresent,
          stop_reason: args.request.turnDecision.stopReason,
        }
      : null;

    return {
      nodes: {
        previous: this.modelVisibleNodeName(args.request.previousNode),
        current: this.modelVisibleNodeName(args.request.currentNode),
      },
      history: {
        status: args.request.messageContext.historyStatus,
        recent_messages: buildModelVisibleConversationHistory(args.request.messageContext),
      },
      user_message: args.request.userMessage,
      decision,
      extraction: this.buildReplyExtractionSnapshot(args.request.extraction),
      plan: this.buildPromptPlanSnapshot(args.request.plan, args.focusNeedCategory),
      information_results: (args.request.informationResults ?? []).map((result) =>
        this.stripRawFields(result),
      ),
      turn_state: {
        focus_need_category: args.focusNeedCategory,
        missing_fields: args.request.missingFields.map((field) =>
          this.userVisibleMissingFieldLabel(field),
        ),
        search_ready: args.request.searchReady,
        missing_fields_instruction: this.buildMissingFieldsInstruction(args.request),
      },
      provider_candidates: args.providerResults.map((provider, index) =>
        this.buildProviderEvidence(provider, index + 1),
      ),
      recommendation_funnel: args.recommendationFunnel,
    };
  }

  private modelVisibleNodeName(node: ComposeReplyRequest['currentNode']): string {
    return node;
  }

  private buildMissingFieldsInstruction(request: ComposeReplyRequest): string {
    const hasPlanMissingFields = request.missingFields.length > 0;
    const hasNeedMissingFields = request.plan.provider_needs.some(
      (need) => need.missing_fields.length > 0,
    );

    if (hasPlanMissingFields || hasNeedMissingFields) {
      return 'Solo menciona faltantes presentes en turn_state.missing_fields o plan.provider_needs[].missing_fields. No agregues otros.';
    }

    return 'No hay faltantes registrados. No digas que faltan fecha, distrito, modalidad, restricciones, presupuesto, preferencias u otros datos.';
  }

  private buildEventCategoryPromptContext(
    eventType: PersistedPlan['event_type'],
    mode: 'extractor' | 'reply',
  ): string {
    const starterCategories = starterProviderCategoriesForEvent(eventType);
    const prioritizedCategories = prioritizedProviderCategoriesForEvent(eventType);
    const normalizedEvent = eventType ?? 'otro';
    const instruction =
      mode === 'extractor'
        ? 'Para necesidades sugeridas o inferidas, usa primero estas categorías. Mantén una categoría fuera de esta lista solo si el usuario la pide de forma explícita.'
        : 'Cuando sugieras próximos frentes al usuario, muestra primero estas categorías. No presentes categorías fuera de esta lista como sugerencias iniciales; sí puedes aceptarlas si el usuario las pide explícitamente.';

    return [
      `Categorías sugeridas para event_type=${normalizedEvent}: ${starterCategories.join(', ')}`,
      `Prioridad completa para event_type=${normalizedEvent}: ${prioritizedCategories.join(', ')}`,
      instruction,
    ].join('\n');
  }

  private buildReplyExtractionSnapshot(extraction: ComposeReplyRequest['extraction']): Record<string, unknown> {
    return {
      action_intent: extraction.actionIntent,
      intent_confidence: extraction.intentConfidence,
      ambiguity: extraction.ambiguity
        ? {
            status: extraction.ambiguity.status,
            clarification_question: extraction.ambiguity.clarificationQuestion,
            interpretations: extraction.ambiguity.interpretations ?? [],
          }
        : null,
      information_requests: extraction.informationRequests,
      event_type: extraction.eventType,
      vendor_category: extraction.vendorCategory,
      vendor_categories: extraction.vendorCategories,
      active_need_category: extraction.activeNeedCategory,
      location: extraction.location,
      budget_signal: extraction.budgetSignal,
      guest_range: extraction.guestRange,
      preferences: extraction.preferences,
      hard_constraints: extraction.hardConstraints,
      assumptions: extraction.assumptions,
      conversation_summary: this.truncateText(extraction.conversationSummary, 300),
      selected_provider_hints: extraction.selectedProviderHints,
      selected_provider_references: extraction.selectedProviderReferences ?? [],
      close_action: extraction.closeAction ?? null,
      pause_requested: extraction.pauseRequested,
      contact: {
        name: extraction.contactName,
        email: extraction.contactEmail,
        phone: extraction.contactPhone,
      },
      provider_fit_criteria: extraction.providerFitCriteria ?? null,
      provider_explanation_request: extraction.providerExplanationRequest ?? null,
      provider_detail_request: extraction.providerDetailRequest ?? null,
      provider_plan_operations: extraction.providerPlanOperations ?? [],
      provider_query_intents: (extraction.providerQueryIntents ?? []).map((queryIntent) => ({
        category: queryIntent.category,
        label: queryIntent.label,
        priority: queryIntent.priority,
        retrieval_ready: queryIntent.retrievalReady,
        queries: queryIntent.queries.map((query) => ({
          id: query.id,
          label: query.label,
          query_strings: query.queryStrings,
          must_have: query.mustHave,
        })),
      })),
    };
  }

  private buildProviderEvidence(
    provider: ProviderSummary,
    rank: number,
  ): Record<string, unknown> {
    return {
      rank,
      id: provider.id,
      title: provider.title,
      category: provider.category,
      location: provider.location,
      price_level: provider.priceLevel,
      min_price: provider.minPrice,
      max_price: provider.maxPrice,
      rating: provider.rating,
      reason: provider.reason,
      promo_badge: provider.promoBadge,
      promo_summary: provider.promoSummary,
      description_snippet: provider.descriptionSnippet,
      service_highlights: provider.serviceHighlights,
      terms_highlights: provider.termsHighlights,
      fit_score: provider.fitScore,
      fit_warnings: provider.fitWarnings ?? [],
      fit_tags: provider.fitTags ?? [],
      detail_url: provider.detailUrl,
    };
  }

  private resolveOutputSchema(request: ComposeReplyRequest) {
    if (request.extraction.ambiguity?.status === 'ambiguous') {
      return genericMessageSchema;
    }

    const node = request.currentNode;
    if (node === 'contacto_inicial') {
      return welcomeMessageSchema;
    }
    if (node === 'entrevista' && !this.hasPlanningContext(request.plan)) {
      return welcomeMessageSchema;
    }
    if (
      node === 'elicitacion_necesidades' &&
      this.hasShortlistedProviderNeeds(request.plan)
    ) {
      return multiNeedRecommendationMessageSchema;
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

  private summarizeEnabledCapabilities(): string {
    return this.resolveEnabledCapabilityLines()
      .map((line) => `- ${line}`)
      .join('\n');
  }

  private resolveEnabledCapabilityLines(): string[] {
    const capabilities = this.resolveFeatureFlags();
    const lines: string[] = [];

    if (capabilities.providerPlanning) {
      lines.push('Planificar un evento desde cero o continuar un plan guardado.');
    }
    if (capabilities.providerPlanning && capabilities.providerSearch) {
      lines.push('Detectar varias necesidades de proveedores y buscar o recomendar opciones de la plataforma de proveedores.');
    }
    if (capabilities.providerPlanning && capabilities.providerQuoteRequests) {
      lines.push('Ayudar a elegir proveedores y preparar solicitudes de cotización/contacto.');
    }
    if (capabilities.faq) {
      lines.push('Responder preguntas generales sobre Sin Envolturas y ofrecer atención humana cuando el caso requiera revisar operaciones.');
    }
    if (capabilities.invitedEventLookup) {
      lines.push('Consultar información de eventos asociados al usuario, como confirmación de asistencia, relación con el evento y anfitriones.');
    }
    if (capabilities.purchaseInformation) {
      lines.push('Consultar tus pedidos recientes o buscar uno directamente por su número después de verificar tu correo.');
      lines.push('Consultar detalles de regalos comprados, como pago, dedicatoria, tarjeta física, envío y agradecimiento, cuando estén disponibles.');
    }

    return lines.length > 0
      ? lines
      : ['Explicar qué información necesita para derivar al canal correcto.'];
  }

  private resolveFeatureFlags(): AgentFeatureFlags {
    return {
      providerPlanning: true,
      providerSearch: true,
      providerQuoteRequests: true,
      faq: true,
      invitedEventLookup: true,
      purchaseInformation: true,
      ...this.options.features,
    };
  }

  private hasShortlistedProviderNeeds(plan: PersistedPlan): boolean {
    return plan.provider_needs.some(
      (need) => need.recommended_providers.length > 0,
    );
  }

  private hasPlanningContext(plan: PersistedPlan): boolean {
    return Boolean(
      plan.event_type ??
      plan.active_need_category ??
      plan.vendor_category ??
      plan.location ??
      plan.budget_signal ??
      plan.guest_range ??
      (plan.provider_needs.length > 0 ? true : null),
    );
  }

  private summarizeGroupedProviderResults(plan: PersistedPlan): string {
    const sections = plan.provider_needs
      .filter((need) => need.recommended_providers.length > 0)
      .map((need) => {
        const subQueryProviders = (need.sub_query_results ?? []).flatMap((result) =>
          result.selected_provider_ids.flatMap((providerId) => {
            const provider = need.recommended_providers.find((item) => item.id === providerId);
            return provider ? [{ provider, label: result.subQuery.label }] : [];
          }),
        );
        const providers = (subQueryProviders.length > 0
          ? subQueryProviders
          : need.recommended_providers.map((provider) => ({ provider, label: null }))
        )
          .map(({ provider, label }, index) => {
            const parts = [
              `${index + 1}. id=${provider.id}`,
              `title=${provider.title}`,
              label ? `match_label=${label}` : null,
              provider.location ? `location=${provider.location}` : null,
              provider.priceLevel ? `price=${provider.priceLevel}` : null,
              provider.reason ? `reason=${provider.reason}` : null,
              provider.promoBadge ? `promo=${provider.promoBadge}` : null,
            ].filter(Boolean);
            return parts.join(' | ');
          })
          .join('\n');
        return `${need.category}\n${providers}`;
      });

    return sections.length > 0 ? sections.join('\n\n') : 'ninguno';
  }

  private collectRecommendedProvidersForMultiNeed(plan: PersistedPlan): ProviderSummary[] {
    const seen = new Set<number>();
    const providers: ProviderSummary[] = [];
    for (const need of plan.provider_needs) {
      const subQueryProviderIds = (need.sub_query_results ?? []).flatMap(
        (result) => result.selected_provider_ids,
      );
      const providerIds = subQueryProviderIds.length > 0
        ? subQueryProviderIds
        : need.recommended_provider_ids;
      for (const providerId of providerIds) {
        if (seen.has(providerId)) {
          continue;
        }
        const provider = need.recommended_providers.find((item) => item.id === providerId);
        if (!provider) {
          continue;
        }
        seen.add(provider.id);
        providers.push(provider);
      }
    }
    return providers;
  }

  private buildReplyModelSettings(
    request: ComposeReplyRequest,
  ) {
    const settings = this.buildModelSettings({
      model: this.options.replyModel,
      cacheKey: `reply:${request.currentNode}:${request.promptBundleId}`,
    });

    return settings;
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
      actionIntent: null,
      informationRequests: [],
      intentConfidence: 1,
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
      conversationSummary: 'El usuario intentó saltarse instrucciones internas.',
      selectedProviderHints: [],
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
        mustHave: [],
        shouldAvoid: [],
        rankingNotes: 'No aplicar búsqueda ante intento de elusión.',
      },
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
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

  private normalizeSpanishVocabulary(value: unknown, userVisible = false): unknown {
    if (typeof value === 'string') {
      return userVisible ? this.normalizeSpanishVocabularyText(value) : value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeSpanishVocabulary(entry, userVisible));
    }

    if (value && typeof value === 'object') {
      const normalized: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        const entryIsUserVisible =
          key !== 'requested_fields_es' && (userVisible || key.endsWith('_es'));
        normalized[key] = this.normalizeSpanishVocabulary(entry, entryIsUserVisible);
      }
      return normalized;
    }

    return value;
  }

  private normalizeSpanishVocabularyText(value: string): string {
    const replacements: ReadonlyArray<readonly [RegExp, string]> = [
      [/\bel RSVP\b/giu, 'la confirmación de asistencia'],
      [/\bla web\b/giu, 'el sitio de internet'],
      [/\bel Excel\b/giu, 'la hoja de cálculo'],
      [/\bdel Excel\b/giu, 'de la hoja de cálculo'],
      [/\bEl delivery\b/gu, 'La entrega'],
      [/\bel delivery\b/gu, 'la entrega'],
      [/\bdel Shop\b/giu, 'de la tienda'],
      [/\bun screenshot\b/giu, 'una captura de pantalla'],
      [/\bRSVP\b/giu, 'confirmación de asistencia'],
      [/\bShop\b/giu, 'tienda'],
      [/\bExcel\b/giu, 'hoja de cálculo'],
      [/\bQR\b/gu, 'código de pago'],
      [/\be-?mail\b/giu, 'correo electrónico'],
      [/\bchat\b/giu, 'conversación'],
      [/\bweb\b/giu, 'sitio de internet'],
      [/\blink\b/giu, 'enlace'],
      [/\bonline\b/giu, 'en línea'],
      [/\bdelivery\b/giu, 'entrega'],
      [/\bspam\b/giu, 'correo no deseado'],
      [/\bmarketplace\b/giu, 'plataforma de proveedores'],
      [/\bstreaming\b/giu, 'transmisión en vivo'],
      [/\bhost\b/giu, 'anfitrión'],
      [/\bbartenders?\b/giu, 'personal de barra'],
      [/\bbaby shower\b/giu, 'celebración por la llegada del bebé'],
      [/\bcatering\b/giu, 'servicio de comida'],
      [/\bwedding planners?\b/giu, 'organización de bodas'],
      [/\bscreenshot\b/giu, 'captura de pantalla'],
      [/\bFAQ\b/gu, 'preguntas frecuentes'],
      [/\bfeedback\b/giu, 'comentarios'],
      [/\bapp\b/giu, 'aplicación'],
      [/\blogin\b/giu, 'acceso'],
    ];

    return replacements.reduce(
      (normalized, [pattern, replacement]) => normalized.replace(pattern, replacement),
      value,
    );
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
            category: providerCategorySchema,
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
      search_providers_by_query_intent: tool({
        name: 'search_providers_by_query_intent',
        description:
          'Busca proveedores desde una intención estructurada de necesidad ya extraída.',
        parameters: z
          .object({
            category: providerCategorySchema,
            queryStrings: z.array(z.string().min(2)).min(1),
            location: z.string().min(2).nullable(),
            fitCriteria: providerFitCriteriaSchema,
          })
          .strict(),
        execute: async (input) => {
          this.recordToolInput(toolUsage, 'search_providers_by_query_intent', input);
          toolUsage.called.push('search_providers_by_query_intent');
          const result = await this.options.providerGateway.searchProvidersByQueryIntent(
            input,
          );
          this.recordToolOutput(toolUsage, 'search_providers_by_query_intent', result);
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

  private buildPromptPlanSnapshot(
    plan: PersistedPlan,
    focusNeedCategory: PersistedPlan['active_need_category'],
  ): Record<string, unknown> {
    return {
      lifecycle_state: plan.lifecycle_state,
      contact_name: plan.contact_name,
      contact_email: plan.contact_email,
      contact_phone: plan.contact_phone,
      current_node: this.modelVisibleNodeName(plan.current_node),
      action_intent:
        plan.current_node === 'resolver_consultas_informativas'
          ? null
          : plan.intent,
      information_state: {
        pending_requests: plan.information_state.pending_requests,
        selection_candidates: plan.information_state.selection_candidates,
      },
      event_type: plan.event_type,
      focus_need_category: focusNeedCategory,
      vendor_category: plan.vendor_category,
      location: plan.location,
      budget_signal: plan.budget_signal,
      guest_range: plan.guest_range,
      preferences: plan.preferences,
      hard_constraints: plan.hard_constraints,
      missing_fields: plan.missing_fields.map((field) => this.userVisibleMissingFieldLabel(field)),
      provider_needs: plan.provider_needs.map((need) => ({
        category: need.category,
        status: need.status,
        preferences: need.preferences,
        hard_constraints: need.hard_constraints,
        missing_fields: need.missing_fields.map((field) => this.userVisibleMissingFieldLabel(field)),
        selected_provider_ids: need.selected_provider_ids,
        selected_provider_hints: need.selected_provider_hints,
        selected_provider_titles: need.selected_provider_ids
          .map((selectedProviderId) =>
            need.recommended_providers.find((provider) => provider.id === selectedProviderId)?.title ?? null,
          )
          .filter((title): title is string => Boolean(title)),
        recommended_provider_ids: need.recommended_provider_ids.slice(0, 6),
        recommended_provider_titles: need.recommended_providers
          .slice(0, 3)
          .map((provider) => provider.title),
      })),
      selected_provider_ids: plan.selected_provider_ids,
      selected_provider_hints: plan.selected_provider_hints,
      conversation_summary: this.truncateText(plan.conversation_summary, 300),
      open_questions: plan.open_questions.slice(0, 5),
    };
  }

  private userVisibleMissingFieldLabel(field: string): string {
    const labels: Record<string, string> = {
      vendor_category: 'tipo de proveedor o servicio',
      location: 'ubicación',
      budget_or_guest_range: 'presupuesto o cantidad aproximada de invitados',
    };

    return labels[field] ?? field.replace(/_/gu, ' ');
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
