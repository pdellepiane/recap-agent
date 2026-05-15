import { ulid } from 'ulid';

import type { DecisionNode } from '../core/decision-nodes';
import { extractionPersistenceNodes } from '../core/decision-nodes';
import { resolveResumeNode } from '../core/decision-flow';
import {
  prioritizedProviderCategoriesForEvent,
  starterProviderCategoriesForEvent,
} from '../core/event-provider-priorities';
import type {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
} from '../core/messages';
import {
  createEmptyPlan,
  getActiveNeed,
  isPlanFinished,
  mergePlan,
  replaceProviderNeeds,
  type PersistedPlan,
  type PlanSnapshot,
  type ProviderNeed,
} from '../core/plan';
import { normalizeProviderSummary, type ProviderSummary } from '../core/provider';
import {
  normalizeToProviderCategory,
  resolveSearchCategories,
  type ProviderCategory,
} from '../core/provider-category';
import { computeSearchSufficiency } from '../core/sufficiency';
import type {
  ExtractionDebugSummary,
  PlanDebugSummary,
  RecommendationFunnelTrace,
  SearchStrategyTrace,
  TurnTrace,
} from '../core/trace';
import type { AgentRuntime, ExtractionResult, ToolUsage } from './contracts';
import type { TokenUsage } from './contracts';
import type { MessageRenderer } from './message-renderer';
import { rankProvidersForCriteria } from './provider-fit';
import type {
  ProviderPlanOperation,
  ProviderQueryIntent,
  ProviderReference,
} from './extraction-schemas';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { StructuredMessage } from './structured-message';
import type { PlanStore } from '../storage/plan-store';

export type HandleTurnResponse = {
  plan: PlanSnapshot;
  outbound: NormalizedOutboundMessage;
  trace: TurnTrace;
};

type SelectionResolution =
  | {
      resolved: false;
    }
  | {
      resolved: true;
      selectedCategories: string[];
    };

type ProviderSelectionMatch = {
  selectedNeed: ProviderNeed;
  selectedProvider: ProviderSummary;
  hint: string;
};

type ProviderSearchExecutionResult = {
  providers: ProviderSummary[];
  note: string | null;
  strategy: SearchStrategyTrace;
};

const MAX_BROADEN_SEARCH_PAGES = 5;
const TARGET_BROADEN_UNSEEN_RESULTS = 5;
const MAX_STARTER_NEEDS = 5;
const MAX_DETAILED_ELICITATION_NEEDS = 6;

export class AgentService {
  constructor(
    private readonly dependencies: {
      planStore: PlanStore;
      runtime: AgentRuntime;
      providerGateway: ProviderGateway;
      promptLoader: PromptLoader;
      renderers: Record<string, MessageRenderer>;
    },
  ) {}

  async handleTurn(
    inbound: NormalizedInboundMessage,
  ): Promise<HandleTurnResponse> {
    const handleTurnStartedAt = Date.now();
    const toolUsage = {
      considered: [] as string[],
      called: [] as string[],
      inputs: [] as { tool: string; input: string }[],
      outputs: [] as { tool: string; output: string }[],
    };
    const timingMs = {
      total: 0,
      load_plan: 0,
      prepare_working_plan: 0,
      extraction: 0,
      apply_extraction: 0,
      compute_sufficiency: 0,
      provider_search: 0,
      provider_enrichment: 0,
      prompt_bundle_load: 0,
      compose_reply: 0,
      save_plan: 0,
    };
    const tokenUsage: {
      extraction: TokenUsage | null;
      reply: TokenUsage | null;
      total: TokenUsage | null;
    } = {
      extraction: null,
      reply: null,
      total: null,
    };
    const loadPlanStartedAt = Date.now();
    let existingPlan = await this.dependencies.planStore.getByExternalUser(
      inbound.channel,
      inbound.externalUserId,
    );
    timingMs.load_plan += Date.now() - loadPlanStartedAt;

    if (existingPlan && isPlanFinished(existingPlan)) {
      const extractionStartedAt = Date.now();
      const rawExtractionResult = await this.dependencies.runtime.extract({
        userMessage: inbound.text,
        plan: existingPlan,
      });
      const finishedExtraction =
        'extraction' in rawExtractionResult
          ? rawExtractionResult.extraction
          : rawExtractionResult;
      tokenUsage.extraction =
        'tokenUsage' in rawExtractionResult
          ? (rawExtractionResult.tokenUsage ?? null)
          : null;
      timingMs.extraction += Date.now() - extractionStartedAt;

      const isPlanningIntent =
        finishedExtraction.intent === 'buscar_proveedores' ||
        finishedExtraction.intent === 'retomar_plan' ||
        finishedExtraction.intent === 'ver_opciones' ||
        finishedExtraction.intent === 'refinar_busqueda' ||
        finishedExtraction.intent === 'confirmar_proveedor';

      if (isPlanningIntent) {
        const freshPlan = createEmptyPlan({
          planId: ulid(),
          channel: inbound.channel,
          externalUserId: inbound.externalUserId,
        });
        await this.dependencies.planStore.save({
          plan: freshPlan,
          reason: 'reset_after_finished',
        });
        existingPlan = freshPlan;
      } else {
        const finishedSufficiency = computeSearchSufficiency(existingPlan);
        const finishedProviders =
          getActiveNeed(existingPlan)?.recommended_providers ?? [];
        const respondNode = finishedExtraction.intent === 'consultar_faq'
          ? 'consultar_faq'
          : 'necesidad_cubierta';
        const bundle = await this.dependencies.promptLoader.loadNodeBundle(respondNode);
        const reply = await this.dependencies.runtime.composeReply({
          currentNode: respondNode,
          previousNode: existingPlan.current_node,
          userMessage: inbound.text,
          plan: existingPlan,
          missingFields: finishedSufficiency.missingFields,
          searchReady: finishedSufficiency.searchReady,
          providerResults: finishedProviders,
          errorMessage: null,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
        });
        tokenUsage.reply = reply.tokenUsage ?? null;
        tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
        timingMs.compose_reply += Date.now() - extractionStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        return {
          plan: existingPlan,
          outbound: {
            text: this.renderReply(reply, finishedProviders, inbound.channel),
            conversationId: existingPlan.conversation_id,
          },
          trace: this.buildTrace({
            plan: existingPlan,
            previousNode: existingPlan.current_node,
            currentNode: respondNode,
            nodePath: [existingPlan.current_node, 'existe_plan_guardado', respondNode],
            extraction: finishedExtraction,
            missingFields: finishedSufficiency.missingFields,
            searchReady: finishedSufficiency.searchReady,
            promptBundleId: bundle.id,
            promptFilePaths: bundle.filePaths,
            toolUsage,
            providerResults: finishedProviders,
            recommendationFunnel: this.resolveRecommendationFunnel(null, finishedProviders),
            planPersisted: false,
            planPersistReason: null,
            timingMs,
            tokenUsage,
            searchStrategy: 'none',
            operationalNote: null,
          }),
        };
      }
    }

    const previousNode = existingPlan?.current_node ?? 'contacto_inicial';
    const loadedPlan =
      existingPlan ??
      createEmptyPlan({
        planId: ulid(),
        channel: inbound.channel,
        externalUserId: inbound.externalUserId,
      });

    const prepareWorkingPlanStartedAt = Date.now();
    let planToResume = loadedPlan;
    if (loadedPlan.active_need_category) {
      const activeNeed = getActiveNeed(loadedPlan);
      if (activeNeed?.status === 'no_providers_available') {
        const nextNeed = loadedPlan.provider_needs.find(
          (need) => need.status !== 'no_providers_available',
        );
        if (nextNeed) {
          planToResume = mergePlan(loadedPlan, {
            active_need_category: nextNeed.category,
          });
        }
      }
    }
    const workingPlan = mergePlan(planToResume, {
      current_node: existingPlan ? resolveResumeNode(planToResume) : 'deteccion_intencion',
    });
    timingMs.prepare_working_plan += Date.now() - prepareWorkingPlanStartedAt;

    const extractionStartedAt = Date.now();
    const rawExtractionResult = await this.dependencies.runtime.extract({
      userMessage: inbound.text,
      plan: workingPlan,
    });
    const extraction =
      'extraction' in rawExtractionResult
        ? rawExtractionResult.extraction
        : rawExtractionResult;
    tokenUsage.extraction =
      'tokenUsage' in rawExtractionResult
        ? (rawExtractionResult.tokenUsage ?? null)
        : null;
    timingMs.extraction += Date.now() - extractionStartedAt;

    let errorMessage: string | null = null;
    const applyExtractionStartedAt = Date.now();
    const extractionNode = this.resolveExtractionNode(workingPlan, extraction);
    const { plan: extractedPlan, validationError } = this.applyExtraction(
      workingPlan,
      extraction,
      extractionNode,
      inbound.text,
      inbound.contactPhone,
    );
    if (validationError) {
      errorMessage = validationError;
    }
    const operationResult = this.applyProviderPlanOperations(
      extractedPlan,
      extraction.providerPlanOperations ?? [],
    );
    const mergedPlan = operationResult.plan;
    if (operationResult.unresolvedMessage) {
      errorMessage = operationResult.unresolvedMessage;
    }
    timingMs.apply_extraction += Date.now() - applyExtractionStartedAt;
    const sufficiencyStartedAt = Date.now();
    const sufficiency = computeSearchSufficiency(mergedPlan);
    timingMs.compute_sufficiency += Date.now() - sufficiencyStartedAt;

    const nodePath: DecisionNode[] = existingPlan
      ? [previousNode, 'existe_plan_guardado', extractionNode]
      : [previousNode, extractionNode];
    let currentNode = extractionNode;
    let providerResults: ProviderSummary[] =
      getActiveNeed(mergedPlan)?.recommended_providers ?? [];
    let searchStrategy: SearchStrategyTrace = 'none';
    let planPersistReason: string | null = null;
    let planPersisted = false;
    const persistPlan = async (plan: PlanSnapshot, reason: string) => {
      const savePlanStartedAt = Date.now();
      await this.dependencies.planStore.save({
        plan,
        reason,
      });
      timingMs.save_plan += Date.now() - savePlanStartedAt;
    };

    if (extraction.pauseRequested || extraction.intent === 'pausar') {
      currentNode = 'guardar_cerrar_temporalmente';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
      await persistPlan(planToSave, 'guardar_cerrar_temporalmente');
      planPersisted = true;
      planPersistReason = 'guardar_cerrar_temporalmente';

      const promptBundleStartedAt = Date.now();
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
      timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
      const composeReplyStartedAt = Date.now();
      const reply = await this.dependencies.runtime.composeReply({
        currentNode,
        previousNode,
        userMessage: inbound.text,
        plan: planToSave,
        missingFields: sufficiency.missingFields,
        searchReady: sufficiency.searchReady,
        providerResults,
        errorMessage,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage,
      });
      tokenUsage.reply = reply.tokenUsage ?? null;
      tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
      const recommendationFunnel = this.resolveRecommendationFunnel(
        reply.recommendationFunnel ?? null,
        providerResults,
      );
      timingMs.compose_reply += Date.now() - composeReplyStartedAt;

      await persistPlan(planToSave, planPersistReason ?? currentNode);
      timingMs.total = Date.now() - handleTurnStartedAt;

      return {
        plan: planToSave,
        outbound: {
          text: this.renderReply(reply, providerResults, inbound.channel),
          conversationId: planToSave.conversation_id,
        },
        trace: this.buildTrace({
          plan: planToSave,
          previousNode,
          currentNode,
          nodePath,
          extraction,
          missingFields: sufficiency.missingFields,
          searchReady: sufficiency.searchReady,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
          providerResults,
          recommendationFunnel: recommendationFunnel,
          planPersisted: true,
          planPersistReason: planPersistReason,
          timingMs,
          tokenUsage,
          searchStrategy,
          operationalNote: errorMessage,
        }),
      };
    }

    if (extraction.intent === 'cerrar') {
      const unselected = this.hasUnselectedShortlist(mergedPlan);
      const userDeclinedShortlist = inbound.text.toLowerCase().includes('ninguna');

      if (unselected && !userDeclinedShortlist) {
        currentNode = 'crear_lead_cerrar';
        nodePath.push(currentNode);
        errorMessage = `Antes de cerrar, necesito saber: ¿quieres elegir alguna opción de ${unselected.category} o prefieres dejarla sin proveedor? Responde "ninguna" si no quieres ninguna.`;
        const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
        await persistPlan(planToSave, 'crear_lead_cerrar');
        planPersisted = true;
        planPersistReason = 'crear_lead_cerrar';

        const promptBundleStartedAt = Date.now();
        const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
        timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
        const composeReplyStartedAt = Date.now();
        const reply = await this.dependencies.runtime.composeReply({
          currentNode,
          previousNode,
          userMessage: inbound.text,
          plan: planToSave,
          missingFields: sufficiency.missingFields,
          searchReady: sufficiency.searchReady,
          providerResults,
          errorMessage,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
        });
        tokenUsage.reply = reply.tokenUsage ?? null;
        tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
        const recommendationFunnel = this.resolveRecommendationFunnel(
          reply.recommendationFunnel ?? null,
          providerResults,
        );
        timingMs.compose_reply += Date.now() - composeReplyStartedAt;

        await persistPlan(planToSave, planPersistReason ?? currentNode);
        timingMs.total = Date.now() - handleTurnStartedAt;

        return {
          plan: planToSave,
          outbound: {
            text: this.renderReply(reply, providerResults, inbound.channel),
            conversationId: planToSave.conversation_id,
          },
          trace: this.buildTrace({
            plan: planToSave,
            previousNode,
            currentNode,
            nodePath,
            extraction,
            missingFields: sufficiency.missingFields,
            searchReady: sufficiency.searchReady,
            promptBundleId: bundle.id,
            promptFilePaths: bundle.filePaths,
            toolUsage,
            providerResults,
            recommendationFunnel: recommendationFunnel,
            planPersisted: true,
            planPersistReason: planPersistReason,
            timingMs,
            tokenUsage,
            searchStrategy,
            operationalNote: errorMessage,
          }),
        };
      }

      let planToClose = mergedPlan;
      if (unselected && userDeclinedShortlist) {
        const deferredNeed: ProviderNeed = {
          ...unselected,
          status: 'deferred',
          selected_provider_ids: [],
          selected_provider_hints: [],
        };
        planToClose = mergePlan(mergedPlan, {
          provider_needs: [deferredNeed],
        });
      }

      currentNode = 'crear_lead_cerrar';
      nodePath.push(currentNode);
      const planToSave = mergePlan(planToClose, { current_node: currentNode });
      await persistPlan(planToSave, 'crear_lead_cerrar');
      planPersisted = true;
      planPersistReason = 'crear_lead_cerrar';

      const promptBundleStartedAt = Date.now();
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
      timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
      const composeReplyStartedAt = Date.now();
      const reply = await this.dependencies.runtime.composeReply({
        currentNode,
        previousNode,
        userMessage: inbound.text,
        plan: planToSave,
        missingFields: sufficiency.missingFields,
        searchReady: sufficiency.searchReady,
        providerResults,
        errorMessage,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage,
      });
      tokenUsage.reply = reply.tokenUsage ?? null;
      tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
      const recommendationFunnel = this.resolveRecommendationFunnel(
        reply.recommendationFunnel ?? null,
        providerResults,
      );
      timingMs.compose_reply += Date.now() - composeReplyStartedAt;

      await persistPlan(planToSave, planPersistReason ?? currentNode);
      timingMs.total = Date.now() - handleTurnStartedAt;

      return {
        plan: planToSave,
        outbound: {
          text: this.renderReply(reply, providerResults, inbound.channel),
          conversationId: planToSave.conversation_id,
        },
        trace: this.buildTrace({
          plan: planToSave,
          previousNode,
          currentNode,
          nodePath,
          extraction,
          missingFields: sufficiency.missingFields,
          searchReady: sufficiency.searchReady,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
          providerResults,
          recommendationFunnel: recommendationFunnel,
          planPersisted: true,
          planPersistReason: planPersistReason,
          timingMs,
          tokenUsage,
          searchStrategy,
          operationalNote: errorMessage,
        }),
      };
    }

    if (extraction.intent === 'consultar_faq') {
      currentNode = 'consultar_faq';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      // Preserve the planning state: only update current_node so resume works.
      const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
      await persistPlan(planToSave, 'consultar_faq');
      planPersisted = true;
      planPersistReason = 'consultar_faq';

      const promptBundleStartedAt = Date.now();
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
      timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
      const composeReplyStartedAt = Date.now();
      const reply = await this.dependencies.runtime.composeReply({
        currentNode,
        previousNode,
        userMessage: inbound.text,
        plan: planToSave,
        missingFields: sufficiency.missingFields,
        searchReady: sufficiency.searchReady,
        providerResults,
        errorMessage,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage,
      });
      tokenUsage.reply = reply.tokenUsage ?? null;
      tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
      const recommendationFunnel = this.resolveRecommendationFunnel(
        reply.recommendationFunnel ?? null,
        providerResults,
      );
      timingMs.compose_reply += Date.now() - composeReplyStartedAt;

      await persistPlan(planToSave, planPersistReason ?? currentNode);
      timingMs.total = Date.now() - handleTurnStartedAt;

      return {
        plan: planToSave,
        outbound: {
          text: this.renderReply(reply, providerResults, inbound.channel),
          conversationId: planToSave.conversation_id,
        },
        trace: this.buildTrace({
          plan: planToSave,
          previousNode,
          currentNode,
          nodePath,
          extraction,
          missingFields: sufficiency.missingFields,
          searchReady: sufficiency.searchReady,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
          providerResults,
          recommendationFunnel: recommendationFunnel,
          planPersisted: true,
          planPersistReason: planPersistReason,
          timingMs,
          tokenUsage,
          searchStrategy,
          operationalNote: errorMessage,
        }),
      };
    }

    if (extractionPersistenceNodes.has(extractionNode)) {
      await persistPlan(mergedPlan, extractionNode);
      planPersisted = true;
      planPersistReason = extractionNode;
    }

    let planAfterFlow = mergedPlan;

    const routeProviderSearchToElicitation =
      this.shouldRouteProviderSearchToElicitation(extraction);
    if (extraction.intent === 'elicitar_necesidades' || routeProviderSearchToElicitation) {
      currentNode = 'elicitacion_necesidades';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      const queryIntents = this.resolveElicitationQueryIntents(extraction);
      const retrievalResult = await this.executeMultiNeedProviderRetrieval({
        plan: planAfterFlow,
        queryIntents,
        resetToQueryIntentsOnly: !this.hasDetailedElicitationConcept(extraction),
        toolUsage,
        timingMs,
      });
      planAfterFlow = mergePlan(retrievalResult.plan, {
        current_node: currentNode,
      });
      providerResults = this.collectPlanProviders(planAfterFlow);
      searchStrategy = retrievalResult.searchStrategy;
      await persistPlan(planAfterFlow, currentNode);
      planPersisted = true;
      planPersistReason = currentNode;
    } else if (operationResult.unresolvedMessage) {
      currentNode = 'seguir_refinando_guardar_plan';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      planAfterFlow = mergePlan(planAfterFlow, {
        current_node: currentNode,
      });
    } else if (
      extraction.intent === 'explicar_recomendacion' ||
      extraction.intent === 'detallar_proveedor' ||
      extraction.intent === 'modificar_plan_proveedores'
    ) {
      const nextNeed = this.resolveNextNeedAfterSelectionOperation(
        planAfterFlow,
        operationResult.appliedOperations,
      );
      if (nextNeed?.recommended_providers.length) {
        currentNode = 'recomendar';
        if (nodePath[nodePath.length - 1] !== currentNode) {
          nodePath.push('buscar_proveedores', 'busqueda_exitosa', 'hay_resultados', currentNode);
        }
        planAfterFlow = replaceProviderNeeds(
          planAfterFlow,
          planAfterFlow.provider_needs,
          nextNeed.category,
        );
        planAfterFlow = mergePlan(planAfterFlow, {
          current_node: currentNode,
          recommended_provider_ids: nextNeed.recommended_provider_ids,
          recommended_providers: nextNeed.recommended_providers,
        });
        providerResults = nextNeed.recommended_providers;
        searchStrategy = 'existing_plan_shortlist';
        await persistPlan(planAfterFlow, currentNode);
        planPersisted = true;
        planPersistReason = currentNode;
      } else {
        currentNode = 'seguir_refinando_guardar_plan';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      planAfterFlow = mergePlan(planAfterFlow, {
        current_node: currentNode,
      });
      providerResults = this.collectPlanProviders(planAfterFlow);
      await persistPlan(planAfterFlow, currentNode);
      planPersisted = true;
      planPersistReason = currentNode;
      }
    } else if (this.shouldAskForEventContext(mergedPlan)) {
      currentNode = 'entrevista';
      nodePath.push(currentNode);
      planAfterFlow = mergePlan(mergedPlan, {
        current_node: currentNode,
      });
    } else if (!sufficiency.searchReady) {
      currentNode = 'aclarar_pedir_faltante';
      nodePath.push('minimos_para_buscar', currentNode);
      const activeNeed = getActiveNeed(mergedPlan);
      planAfterFlow = mergePlan(mergedPlan, {
        current_node: currentNode,
        missing_fields: sufficiency.missingFields,
        provider_needs: activeNeed
          ? [
              {
                ...activeNeed,
                missing_fields: sufficiency.missingFields,
              },
            ]
          : [],
      });
    } else {
        const effectiveSelectionHints = this.resolveEffectiveSelectionHints(
          extraction,
          inbound.text,
          planAfterFlow,
        );

        const selectionResolution = this.tryResolveSelection(
          planAfterFlow,
          effectiveSelectionHints,
          extraction.intent,
        );

      if (
        selectionResolution.resolved &&
        !this.shouldContinueWithAnotherNeed(planAfterFlow, selectionResolution)
      ) {
        currentNode = 'anadir_a_proveedores_recomendados';
        nodePath.push('usuario_elige_proveedor', currentNode, 'seguir_refinando_guardar_plan');
        currentNode = 'seguir_refinando_guardar_plan';
        planAfterFlow = mergePlan(planAfterFlow, {
          current_node: currentNode,
        });
        await persistPlan(planAfterFlow, 'seguir_refinando_guardar_plan');
        planPersisted = true;
        planPersistReason = 'seguir_refinando_guardar_plan';
      } else {
        nodePath.push('minimos_para_buscar', 'buscar_proveedores');
        try {
          const searchResult = await this.executeProviderSearch({
            baselinePlan: workingPlan,
            plan: planAfterFlow,
            extraction,
            toolUsage,
            timingMs,
          });
          errorMessage = searchResult.note;
          searchStrategy = searchResult.strategy;
          const providerEnrichmentStartedAt = Date.now();
          const enrichedProviders = await this.enrichProviders(searchResult.providers);
          if (!extraction.providerFitCriteria) {
            throw new Error('Extractor did not return provider fit criteria.');
          }
          providerResults = rankProvidersForCriteria(
            enrichedProviders,
            extraction.providerFitCriteria,
          );
          timingMs.provider_enrichment += Date.now() - providerEnrichmentStartedAt;
          const activeNeed = getActiveNeed(planAfterFlow);
          planAfterFlow = mergePlan(planAfterFlow, {
            active_need_category:
              activeNeed?.category ?? planAfterFlow.active_need_category,
            provider_needs: activeNeed
              ? [
                  {
                    ...activeNeed,
                    recommended_provider_ids:
                      providerResults.length > 0
                        ? providerResults.map((provider) => provider.id)
                        : [],
                    recommended_providers: providerResults,
                    missing_fields: [],
                    selected_provider_ids: [],
                    selected_provider_hints: [],
                    status:
                      providerResults.length > 0 ? 'shortlisted' : 'no_providers_available',
                  },
                ]
              : [],
            recommended_provider_ids: providerResults.map((provider) => provider.id),
            recommended_providers: providerResults,
          });

          nodePath.push('busqueda_exitosa');
          if (providerResults.length === 0) {
            currentNode = 'refinar_criterios';
            nodePath.push('hay_resultados', currentNode);
            planAfterFlow = mergePlan(planAfterFlow, {
              current_node: currentNode,
            });
          } else {
            currentNode = 'recomendar';
            nodePath.push('hay_resultados', currentNode);
            planAfterFlow = mergePlan(planAfterFlow, {
              current_node: currentNode,
            });
          }

          await persistPlan(planAfterFlow, currentNode);
          planPersisted = true;
          planPersistReason = currentNode;
        } catch (error) {
          toolUsage.called.push('search_providers_from_plan');
          toolUsage.outputs.push({
            tool: 'search_providers_from_plan',
            output: JSON.stringify(
              {
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          });
          errorMessage =
            error instanceof Error ? error.message : 'Unknown provider search error.';
          currentNode = 'informar_error_reintento';
          nodePath.push('busqueda_exitosa', currentNode);
          planAfterFlow = mergePlan(planAfterFlow, {
            current_node: currentNode,
          });
          await persistPlan(planAfterFlow, currentNode);
          planPersisted = true;
          planPersistReason = currentNode;
        }
      }
    }

    const promptBundleStartedAt = Date.now();
    const promptBundle = await this.dependencies.promptLoader.loadNodeBundle(
      currentNode,
    );
    timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
    const composeReplyStartedAt = Date.now();
    const reply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode,
      userMessage: inbound.text,
      plan: planAfterFlow,
      missingFields: sufficiency.missingFields,
      searchReady: sufficiency.searchReady,
      providerResults,
      errorMessage,
      promptBundleId: promptBundle.id,
      promptFilePaths: promptBundle.filePaths,
      toolUsage,
    });
    tokenUsage.reply = reply.tokenUsage ?? null;
    tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
    const recommendationFunnel = this.resolveRecommendationFunnel(
      reply.recommendationFunnel ?? null,
      providerResults,
    );
    timingMs.compose_reply += Date.now() - composeReplyStartedAt;

    await persistPlan(planAfterFlow, planPersistReason ?? currentNode);
    timingMs.total = Date.now() - handleTurnStartedAt;

    return {
      plan: planAfterFlow,
      outbound: {
        text: this.renderReply(reply, providerResults, inbound.channel),
        conversationId: planAfterFlow.conversation_id,
      },
      trace: this.buildTrace({
        plan: planAfterFlow,
        previousNode,
        currentNode,
        nodePath,
        extraction,
        missingFields: sufficiency.missingFields,
        searchReady: sufficiency.searchReady,
        promptBundleId: promptBundle.id,
        promptFilePaths: promptBundle.filePaths,
        toolUsage,
        providerResults,
        recommendationFunnel: recommendationFunnel,
        planPersisted,
        planPersistReason,
        timingMs,
        tokenUsage,
        searchStrategy,
        operationalNote: errorMessage,
      }),
    };
  }

  private sumTokenUsage(
    first: TokenUsage | null,
    second: TokenUsage | null,
  ): TokenUsage | null {
    if (!first && !second) {
      return null;
    }

    return {
      input_tokens: (first?.input_tokens ?? 0) + (second?.input_tokens ?? 0),
      output_tokens: (first?.output_tokens ?? 0) + (second?.output_tokens ?? 0),
      total_tokens: (first?.total_tokens ?? 0) + (second?.total_tokens ?? 0),
      cached_input_tokens:
        (first?.cached_input_tokens ?? 0) + (second?.cached_input_tokens ?? 0),
    };
  }

  private resolveRecommendationFunnel(
    runtimeFunnel:
      | {
          available_candidates: number;
          context_candidates: number;
          context_candidate_ids: number[];
          presentation_limit: number;
        }
      | null,
    providerResults: ProviderSummary[],
  ): {
    available_candidates: number;
    context_candidates: number;
    context_candidate_ids: number[];
    presentation_limit: number;
  } {
    if (runtimeFunnel) {
      return runtimeFunnel;
    }

    return {
      available_candidates: providerResults.length,
      context_candidates: providerResults.length,
      context_candidate_ids: providerResults.map((provider) => provider.id),
      presentation_limit: 5,
    };
  }

  private buildTrace(args: {
    traceId?: string;
    plan: PlanSnapshot;
    previousNode: DecisionNode;
    currentNode: DecisionNode;
    nodePath: DecisionNode[];
    extraction: ExtractionResult;
    missingFields: string[];
    searchReady: boolean;
    promptBundleId: string;
    promptFilePaths: string[];
    toolUsage: ToolUsage;
    providerResults: ProviderSummary[];
    recommendationFunnel: RecommendationFunnelTrace;
    planPersisted: boolean;
    planPersistReason: string | null;
    timingMs: TurnTrace['timing_ms'];
    tokenUsage: TurnTrace['token_usage'];
    searchStrategy: SearchStrategyTrace;
    operationalNote: string | null;
  }): TurnTrace {
    return {
      trace_id: args.traceId ?? ulid(),
      conversation_id: args.plan.conversation_id,
      plan_id: args.plan.plan_id,
      previous_node: args.previousNode,
      next_node: args.currentNode,
      node_path: args.nodePath,
      intent: args.plan.intent,
      missing_fields: args.missingFields,
      search_ready: args.searchReady,
      prompt_bundle_id: args.promptBundleId,
      prompt_file_paths: args.promptFilePaths,
      tools_considered: args.toolUsage.considered,
      tools_called: args.toolUsage.called,
      tool_inputs: args.toolUsage.inputs,
      tool_outputs: args.toolUsage.outputs,
      provider_results: args.providerResults,
      recommendation_funnel: args.recommendationFunnel,
      search_strategy: args.searchStrategy,
      operational_note: args.operationalNote,
      extraction_summary: this.summarizeExtraction(args.extraction, args.operationalNote),
      plan_summary: this.summarizePlan(args.plan, args.operationalNote),
      plan_persisted: args.planPersisted,
      plan_persist_reason: args.planPersistReason,
      timing_ms: args.timingMs,
      token_usage: args.tokenUsage,
    };
  }

  private summarizeExtraction(
    extraction: ExtractionResult,
    operationalNote: string | null,
  ): ExtractionDebugSummary {
    const isContactValidationError = operationalNote !== null &&
      (operationalNote.includes('teléfono') || operationalNote.includes('correo'));
    return {
      intent_confidence: extraction.intentConfidence,
      event_type: extraction.eventType,
      vendor_category: extraction.vendorCategory,
      vendor_categories: extraction.vendorCategories,
      active_need_category: extraction.activeNeedCategory,
      location: extraction.location,
      budget_signal: extraction.budgetSignal,
      guest_range: extraction.guestRange,
      selected_provider_hints: extraction.selectedProviderHints,
      preferences: extraction.preferences,
      hard_constraints: extraction.hardConstraints,
      assumptions: extraction.assumptions,
      provider_query_intents_count: extraction.providerQueryIntents?.length ?? 0,
      provider_plan_operations_count: extraction.providerPlanOperations?.length ?? 0,
      provider_explanation_requested: Boolean(extraction.providerExplanationRequest),
      provider_detail_requested: Boolean(extraction.providerDetailRequest),
      conversation_summary_preview: this.truncateDebugText(extraction.conversationSummary, 160),
      pause_requested: extraction.pauseRequested,
      contact_fields_present: {
        name: Boolean(extraction.contactName),
        email: Boolean(extraction.contactEmail),
        phone: Boolean(extraction.contactPhone),
      },
      contact_validation_error: isContactValidationError ? operationalNote : null,
    };
  }

  private summarizePlan(plan: PlanSnapshot, operationalNote: string | null): PlanDebugSummary {
    const isContactValidationError = operationalNote !== null &&
      (operationalNote.includes('teléfono') || operationalNote.includes('correo'));
    return {
      current_node: plan.current_node,
      lifecycle_state: plan.lifecycle_state,
      event_type: plan.event_type,
      vendor_category: plan.vendor_category,
      active_need_category: plan.active_need_category,
      location: plan.location,
      budget_signal: plan.budget_signal,
      guest_range: plan.guest_range,
      provider_need_categories: plan.provider_needs.map((need) => need.category),
      provider_need_count: plan.provider_needs.length,
      provider_need_statuses: plan.provider_needs.map((need) => ({
        category: need.category,
        status: need.status,
        has_recommendations: need.recommended_provider_ids.length > 0,
        selected_provider_ids: need.selected_provider_ids,
      })),
      selected_provider_ids: plan.selected_provider_ids,
      missing_fields: plan.missing_fields,
      conversation_summary_preview: this.truncateDebugText(plan.conversation_summary, 160),
      open_question_count: plan.open_questions.length,
      contact_fields_present: {
        name: Boolean(plan.contact_name),
        email: Boolean(plan.contact_email),
        phone: Boolean(plan.contact_phone),
      },
      contact_validation_error: isContactValidationError ? operationalNote : null,
    };
  }

  private resolveExtractionNode(
    plan: PersistedPlan,
    extraction: ExtractionResult,
  ): DecisionNode {
    if (!plan.intent && !plan.event_type) {
      return 'deteccion_intencion';
    }

    if (extraction.intent === 'refinar_busqueda' || extraction.intent === 'ver_opciones') {
      return 'refinar_criterios';
    }

    if (extraction.intent === 'elicitar_necesidades') {
      return 'elicitacion_necesidades';
    }

    if (
      extraction.intent === 'modificar_plan_proveedores' ||
      extraction.intent === 'explicar_recomendacion' ||
      extraction.intent === 'detallar_proveedor'
    ) {
      return 'seguir_refinando_guardar_plan';
    }

    if (extraction.intent === 'confirmar_proveedor') {
      return 'usuario_elige_proveedor';
    }

    if (extraction.intent === 'consultar_faq') {
      return 'consultar_faq';
    }

    if ((plan.missing_fields ?? []).length > 0) {
      return 'aclarar_pedir_faltante';
    }

    return 'entrevista';
  }

  private applyExtraction(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    extractionNode: DecisionNode,
    userMessage: string,
    channelPhone: string | null | undefined,
  ): { plan: PlanSnapshot; validationError: string | null } {
    const guardedExtraction = this.guardImplicitVenueNeed(plan, extraction, userMessage);
    const extractedGuestRange =
      guardedExtraction.guestRange === 'unknown' ? null : guardedExtraction.guestRange;
    const normalizedGuestRange =
      this.inferGuestRangeFromMessage(userMessage) ??
      extractedGuestRange ??
      plan.guest_range;

    // Normalize and resolve contact fields independently (partial updates allowed)
    const normalizedExtractorPhone = this.normalizePhone(guardedExtraction.contactPhone);
    const normalizedChannelPhone = this.normalizePhone(channelPhone);
    const inferredPhone = this.inferContactPhoneFromMessage(userMessage);

    const nextPhone =
      normalizedExtractorPhone ??
      inferredPhone ??
      normalizedChannelPhone ??
      plan.contact_phone;

    const nextEmail = guardedExtraction.contactEmail ?? plan.contact_email;
    const nextName = guardedExtraction.contactName ?? plan.contact_name;

    const candidate = mergePlan(plan, {
      current_node: extractionNode,
      intent: guardedExtraction.intent ?? plan.intent,
      intent_confidence: guardedExtraction.intentConfidence ?? plan.intent_confidence,
      event_type: guardedExtraction.eventType ?? plan.event_type,
      vendor_category: guardedExtraction.vendorCategory ?? plan.vendor_category,
      active_need_category:
        guardedExtraction.activeNeedCategory ??
        guardedExtraction.vendorCategory ??
        plan.active_need_category,
      location: guardedExtraction.location ?? plan.location,
      budget_signal: guardedExtraction.budgetSignal ?? plan.budget_signal,
      guest_range: normalizedGuestRange,
      preferences: guardedExtraction.preferences,
      hard_constraints: guardedExtraction.hardConstraints,
      assumptions: guardedExtraction.assumptions,
      conversation_summary: guardedExtraction.conversationSummary,
      selected_provider_hints: plan.selected_provider_hints,
      contact_name: nextName,
      contact_email: nextEmail,
      contact_phone: nextPhone,
      provider_needs: this.buildNeedUpdates(plan, guardedExtraction),
      last_user_goal: guardedExtraction.intent ?? plan.last_user_goal,
    });

    const sufficiency = computeSearchSufficiency(candidate);
    const merged = mergePlan(candidate, {
      missing_fields: sufficiency.missingFields,
    });

    const validationError = this.validateContactFields(merged, plan);
    if (validationError) {
      // Revert invalid fields to previous plan values so we don't persist garbage
      const reverted = mergePlan(merged, {
        contact_phone: normalizedExtractorPhone !== null && !this.isValidPhone(normalizedExtractorPhone)
          ? plan.contact_phone
          : merged.contact_phone,
        contact_email: guardedExtraction.contactEmail !== null && !this.isValidEmail(guardedExtraction.contactEmail)
          ? plan.contact_email
          : merged.contact_email,
      });
      return { plan: reverted, validationError };
    }

    return { plan: merged, validationError: null };
  }

  private guardImplicitVenueNeed(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    userMessage: string,
  ): ExtractionResult {
    if (getActiveNeed(plan)?.category || this.messageHasVenueCue(userMessage)) {
      return extraction;
    }

    const vendorCategories = extraction.vendorCategories.filter(
      (category) => !this.isVenueLikeCategory(category),
    );
    const vendorCategory = this.isVenueLikeCategory(extraction.vendorCategory)
      ? null
      : extraction.vendorCategory;
    const activeNeedCategory = this.isVenueLikeCategory(extraction.activeNeedCategory)
      ? null
      : extraction.activeNeedCategory;

    if (
      vendorCategory === extraction.vendorCategory &&
      activeNeedCategory === extraction.activeNeedCategory &&
      vendorCategories.length === extraction.vendorCategories.length
    ) {
      return extraction;
    }

    return {
      ...extraction,
      vendorCategory,
      activeNeedCategory,
      vendorCategories,
    };
  }

  private applyProviderPlanOperations(
    plan: PlanSnapshot,
    operations: ProviderPlanOperation[],
  ): {
    plan: PlanSnapshot;
    unresolvedMessage: string | null;
    appliedOperations: ProviderPlanOperation[];
  } {
    if (operations.length === 0) {
      return { plan, unresolvedMessage: null, appliedOperations: [] };
    }

    let nextPlan = plan;
    const appliedOperations: ProviderPlanOperation[] = [];
    for (const operation of operations) {
      const result = this.applyProviderPlanOperation(nextPlan, operation);
      if (!result.applied) {
        return { plan: nextPlan, unresolvedMessage: result.message, appliedOperations };
      }
      nextPlan = result.plan;
      appliedOperations.push(operation);
    }

    return { plan: nextPlan, unresolvedMessage: null, appliedOperations };
  }

  private applyProviderPlanOperation(
    plan: PlanSnapshot,
    operation: ProviderPlanOperation,
  ): { applied: true; plan: PlanSnapshot } | { applied: false; message: string } {
    switch (operation.type) {
      case 'add_need':
      case 'update_need':
      case 'reactivate_need': {
        if (!operation.category) {
          return { applied: false, message: 'Necesito saber qué necesidad del plan quieres cambiar.' };
        }
        const existing = this.findNeedByCategory(plan, operation.category);
        const queryIntent = operation.queryIntent;
        const nextNeed: ProviderNeed = {
          category: operation.category,
          status: queryIntent?.retrievalReady
            ? 'search_ready'
            : existing?.status === 'no_providers_available'
              ? 'identified'
              : existing?.status ?? 'identified',
          preferences: this.uniqueOperationStrings([
            ...(existing?.preferences ?? []),
            ...operation.preferences,
          ]),
          hard_constraints: this.uniqueOperationStrings([
            ...(existing?.hard_constraints ?? []),
            ...operation.hardConstraints,
          ]),
          missing_fields: queryIntent?.missingFields ?? existing?.missing_fields ?? [],
          recommended_provider_ids: existing?.recommended_provider_ids ?? [],
          recommended_providers: existing?.recommended_providers ?? [],
          selected_provider_ids: existing?.selected_provider_ids ?? [],
          selected_provider_hints: existing?.selected_provider_hints ?? [],
        };
        return {
          applied: true,
          plan: this.upsertProviderNeed(plan, nextNeed, operation.category),
        };
      }
      case 'delete_need': {
        if (!operation.category) {
          return { applied: false, message: 'Necesito saber qué necesidad quieres eliminar.' };
        }
        const nextNeeds = plan.provider_needs.filter(
          (need) => need.category !== operation.category,
        );
        return {
          applied: true,
          plan: replaceProviderNeeds(
            plan,
            nextNeeds,
            plan.active_need_category === operation.category
              ? nextNeeds[0]?.category ?? null
              : plan.active_need_category,
          ),
        };
      }
      case 'defer_need': {
        if (!operation.category) {
          return { applied: false, message: 'Necesito saber qué necesidad quieres dejar para después.' };
        }
        const need = this.findNeedByCategory(plan, operation.category);
        if (!need) {
          return {
            applied: false,
            message: `No encuentro esa necesidad en el plan. ¿Qué frente quieres dejar para después?`,
          };
        }
        return {
          applied: true,
          plan: this.upsertProviderNeed(
            plan,
            {
              ...need,
              status: 'deferred',
              selected_provider_ids: [],
              selected_provider_hints: [],
            },
            operation.category,
          ),
        };
      }
      case 'select_provider':
      case 'unselect_provider': {
        if (!operation.provider) {
          return { applied: false, message: 'Necesito saber qué proveedor quieres cambiar.' };
        }
        const resolution = this.resolveProviderReference(plan, operation.provider, operation.category);
        if (!resolution) {
          return {
            applied: false,
            message: 'No pude identificar con seguridad ese proveedor. ¿Me dices el nombre o el número exacto de la opción?',
          };
        }
        const selectedIds = new Set(resolution.need.selected_provider_ids);
        const selectedHints = new Set(resolution.need.selected_provider_hints);
        if (operation.type === 'select_provider') {
          selectedIds.add(resolution.provider.id);
          selectedHints.add(resolution.provider.title);
        } else {
          selectedIds.delete(resolution.provider.id);
          selectedHints.delete(resolution.provider.title);
        }
        const nextSelectedIds = Array.from(selectedIds);
        return {
          applied: true,
          plan: this.upsertProviderNeed(
            plan,
            {
              ...resolution.need,
              status: nextSelectedIds.length > 0
                ? 'selected'
                : resolution.need.recommended_provider_ids.length > 0
                  ? 'shortlisted'
                  : 'identified',
              selected_provider_ids: nextSelectedIds,
              selected_provider_hints: Array.from(selectedHints),
            },
            resolution.need.category,
          ),
        };
      }
      case 'replace_provider': {
        if (!operation.removeProvider || !operation.addProvider) {
          return {
            applied: false,
            message: 'Necesito saber qué proveedor sale y cuál entra.',
          };
        }
        const removeResolution = this.resolveProviderReference(
          plan,
          operation.removeProvider,
          operation.category,
        );
        const addResolution = this.resolveProviderReference(
          plan,
          operation.addProvider,
          operation.category,
        );
        if (!removeResolution || !addResolution) {
          return {
            applied: false,
            message: 'No pude identificar con seguridad qué proveedor reemplazar. ¿Me confirmas ambos nombres?',
          };
        }
        if (removeResolution.need.category !== addResolution.need.category) {
          return {
            applied: false,
            message: 'El reemplazo cruza dos necesidades distintas. ¿En qué categoría quieres hacer el cambio?',
          };
        }
        const selectedIds = new Set(removeResolution.need.selected_provider_ids);
        selectedIds.delete(removeResolution.provider.id);
        selectedIds.add(addResolution.provider.id);
        const selectedHints = new Set(removeResolution.need.selected_provider_hints);
        selectedHints.delete(removeResolution.provider.title);
        selectedHints.add(addResolution.provider.title);
        return {
          applied: true,
          plan: this.upsertProviderNeed(
            plan,
            {
              ...removeResolution.need,
              status: 'selected',
              selected_provider_ids: Array.from(selectedIds),
              selected_provider_hints: Array.from(selectedHints),
            },
            removeResolution.need.category,
          ),
        };
      }
    }
  }

  private upsertProviderNeed(
    plan: PlanSnapshot,
    nextNeed: ProviderNeed,
    activeNeedCategory: ProviderCategory,
  ): PlanSnapshot {
    const nextNeeds = [
      ...plan.provider_needs.filter((need) => need.category !== nextNeed.category),
      nextNeed,
    ];
    return replaceProviderNeeds(plan, nextNeeds, activeNeedCategory);
  }

  private resolveNextNeedAfterSelectionOperation(
    plan: PlanSnapshot,
    operations: ProviderPlanOperation[],
  ): ProviderNeed | null {
    if (!operations.some((operation) => operation.type === 'select_provider')) {
      return null;
    }

    const activeCategory = plan.active_need_category;
    const openNeeds = plan.provider_needs.filter(
      (need) =>
        need.category !== activeCategory &&
        need.status !== 'selected' &&
        need.status !== 'deferred' &&
        need.status !== 'no_providers_available',
    );

    return (
      openNeeds.find((need) => need.recommended_providers.length > 0) ??
      openNeeds[0] ??
      null
    );
  }

  private findNeedByCategory(
    plan: PlanSnapshot,
    category: ProviderCategory,
  ): ProviderNeed | null {
    return plan.provider_needs.find((need) => need.category === category) ?? null;
  }

  private resolveProviderReference(
    plan: PlanSnapshot,
    reference: ProviderReference,
    fallbackCategory: ProviderCategory | null,
  ): { need: ProviderNeed; provider: ProviderSummary } | null {
    const candidateNeeds = plan.provider_needs.filter((need) =>
      reference.category
        ? need.category === reference.category
        : fallbackCategory
          ? need.category === fallbackCategory
          : true,
    );
    const matches = candidateNeeds.flatMap((need) =>
      need.recommended_providers.flatMap((provider) => {
        if (reference.providerId !== null && provider.id === reference.providerId) {
          return [{ need, provider }];
        }
        const textReference = reference.providerTitle ?? reference.hint;
        if (!textReference) {
          return [];
        }
        const normalizedReference = this.normalizeSelectionText(textReference);
        const matched = this.providerAliases(provider).some((alias) =>
          this.normalizedTextContainsAlias(normalizedReference, alias) ||
          this.normalizedTextContainsAlias(alias, normalizedReference),
        );
        return matched ? [{ need, provider }] : [];
      }),
    );

    if (matches.length !== 1) {
      return null;
    }
    return matches[0] ?? null;
  }

  private uniqueOperationStrings(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
    );
  }

  private tryResolveSelection(
    plan: PlanSnapshot,
    selectedProviderHints: string[],
    intent: ExtractionResult['intent'],
  ): SelectionResolution {
    const activeNeed = getActiveNeed(plan);
    const needsWithProviders = [
      ...(activeNeed?.recommended_providers.length ? [activeNeed] : []),
      ...plan.provider_needs.filter(
        (need) =>
          need.category !== activeNeed?.category &&
          need.recommended_providers.length > 0,
      ),
    ];

    if (needsWithProviders.length === 0) {
      return { resolved: false };
    }

    const selections = selectedProviderHints.length > 0
      ? selectedProviderHints.flatMap((hint) =>
          this.resolveProviderSelections(
            needsWithProviders,
            activeNeed,
            hint,
          ),
        )
      : this.resolveSingleProviderSelection(needsWithProviders, intent);
    const uniqueSelections = this.dedupeSelections(selections);

    if (uniqueSelections.length === 0) {
      return { resolved: false };
    }

    const selectionsByCategory = new Map<string, ProviderSelectionMatch[]>();
    for (const selection of uniqueSelections) {
      const existing = selectionsByCategory.get(selection.selectedNeed.category) ?? [];
      existing.push(selection);
      selectionsByCategory.set(selection.selectedNeed.category, existing);
    }

    const updatedNeeds = Array.from(selectionsByCategory.entries()).map(
      ([category, selectionsForNeed]) => {
        const selectedNeed = selectionsForNeed[0]?.selectedNeed;
        if (!selectedNeed) {
          throw new Error(`Selection group for ${category} had no need.`);
        }
        return {
          ...selectedNeed,
          status: 'selected' as const,
          selected_provider_ids: selectionsForNeed.map(
            (selection) => selection.selectedProvider.id,
          ),
          selected_provider_hints: selectionsForNeed.map(
            (selection) => selection.hint,
          ),
        };
      },
    );

    const updatedPlan = mergePlan(plan, {
      current_node: 'usuario_elige_proveedor',
      active_need_category: plan.active_need_category ?? uniqueSelections[0]?.selectedNeed.category,
      provider_needs: updatedNeeds,
    });

    Object.assign(plan, updatedPlan);
    return {
      resolved: true,
      selectedCategories: uniqueSelections.map((selection) => selection.selectedNeed.category),
    };
  }

  private resolveProviderSelections(
    needsWithProviders: ProviderNeed[],
    activeNeed: ProviderNeed | null,
    effectiveHint: string,
  ): ProviderSelectionMatch[] {
    const byName = this.resolveProviderSelectionsByName(
      needsWithProviders,
      effectiveHint,
    );
    if (byName.length > 0) {
      return byName;
    }

    const ordinalChoices = this.parseSelectionOrdinals(effectiveHint);
    if (ordinalChoices.length === 0) {
      return [];
    }

    const ordinalNeed =
      activeNeed?.recommended_providers.length
        ? activeNeed
        : needsWithProviders.length === 1
          ? needsWithProviders[0] ?? null
          : null;
    if (!ordinalNeed) {
      return [];
    }

    return ordinalChoices.flatMap((ordinalChoice) => {
      const selectedProvider = ordinalNeed.recommended_providers[ordinalChoice - 1] ?? null;
      return selectedProvider
        ? [{
            selectedNeed: ordinalNeed,
            selectedProvider,
            hint: selectedProvider.title,
          }]
        : [];
    });
  }

  private resolveSingleProviderSelection(
    needsWithProviders: ProviderNeed[],
    intent: ExtractionResult['intent'],
  ): ProviderSelectionMatch[] {
    if (intent !== 'confirmar_proveedor') {
      return [];
    }

    const candidates = needsWithProviders.flatMap((need) =>
      need.recommended_providers.map((provider) => ({
        selectedNeed: need,
        selectedProvider: provider,
        hint: provider.title,
      })),
    );

    if (candidates.length !== 1) {
      return [];
    }

    return candidates;
  }

  private resolveProviderSelectionsByName(
    needsWithProviders: ProviderNeed[],
    effectiveHint: string,
  ): ProviderSelectionMatch[] {
    const lowered = this.normalizeSelectionText(effectiveHint);
    if (!lowered) {
      return [];
    }

    const matches: ProviderSelectionMatch[] = [];
    for (const need of needsWithProviders) {
      for (const provider of need.recommended_providers) {
        const matched =
          this.providerAliases(provider).some((alias) =>
            this.normalizedTextContainsAlias(lowered, alias),
          );
        if (matched) {
          matches.push({
            selectedNeed: need,
            selectedProvider: provider,
            hint: provider.title,
          });
        }
      }
    }

    return matches;
  }

  private parseSelectionOrdinals(value: string): number[] {
    const normalized = this.normalizeSelectionText(value);
    const ordinalWords: Array<[RegExp, number]> = [
      [/\b(?:primer|primera|primero|1er|1era|1ero|1ra|1ro|uno|una)\b/u, 1],
      [/\b(?:segunda|segundo|2da|2do|dos)\b/u, 2],
      [/\b(?:tercera|tercero|tercer|3ra|3ro|tres)\b/u, 3],
      [/\b(?:cuarta|cuarto|4ta|4to|cuatro)\b/u, 4],
      [/\b(?:quinta|quinto|5ta|5to|cinco)\b/u, 5],
      [/\b(?:sexta|sexto|6ta|6to|seis)\b/u, 6],
      [/\b(?:septima|septimo|7ma|7mo|siete)\b/u, 7],
      [/\b(?:octava|octavo|8va|8vo|ocho)\b/u, 8],
      [/\b(?:novena|noveno|9na|9no|nueve)\b/u, 9],
      [/\b(?:decima|decimo|10ma|10mo|diez)\b/u, 10],
    ];

    const ordinals = new Set<number>();
    for (const [pattern, ordinal] of ordinalWords) {
      if (pattern.test(normalized)) {
        ordinals.add(ordinal);
      }
    }

    for (const numericMatch of normalized.matchAll(
      /\b(?:opcion|alternativa|proveedor|numero|nro|num)?\s*(\d{1,2})\b/gu,
    )) {
      if (numericMatch[1]) {
        ordinals.add(Number.parseInt(numericMatch[1], 10));
      }
    }

    return Array.from(ordinals).sort((a, b) => a - b);
  }

  private dedupeSelections(selections: ProviderSelectionMatch[]): ProviderSelectionMatch[] {
    const seen = new Set<string>();
    return selections.filter((selection) => {
      const key = `${selection.selectedNeed.category}:${selection.selectedProvider.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private shouldBroadenProviderSearch(
    baselinePlan: PlanSnapshot,
    intent: ExtractionResult['intent'],
    extraction: ExtractionResult,
  ): boolean {
    if (intent !== 'refinar_busqueda' && intent !== 'ver_opciones') {
      return false;
    }

    const activeNeed = getActiveNeed(baselinePlan);
    if (!activeNeed || activeNeed.recommended_providers.length === 0) {
      return false;
    }

    return !this.hasSearchCriteriaChange(baselinePlan, extraction);
  }

  private async executeMultiNeedProviderRetrieval(args: {
    plan: PlanSnapshot;
    queryIntents: ProviderQueryIntent[];
    resetToQueryIntentsOnly: boolean;
    toolUsage: ToolUsage;
    timingMs: {
      provider_search: number;
      provider_enrichment: number;
    };
  }): Promise<{ plan: PlanSnapshot; searchStrategy: SearchStrategyTrace }> {
    const existingByCategory = new Map(
      args.plan.provider_needs.map((need) => [need.category, need]),
    );
    const sortedIntents = [...args.queryIntents].sort(
      (left, right) => left.priority - right.priority,
    );

    const retrievedNeeds = await Promise.all(
      sortedIntents.map(async (queryIntent) => {
        const existingNeed = existingByCategory.get(queryIntent.category) ?? null;
        if (!queryIntent.retrievalReady) {
          const carryExistingNeed = args.resetToQueryIntentsOnly ? null : existingNeed;
          return {
            category: queryIntent.category,
            status: carryExistingNeed?.status ?? 'identified',
            preferences: queryIntent.preferences,
            hard_constraints: queryIntent.hardConstraints,
            missing_fields: queryIntent.missingFields,
            recommended_provider_ids: carryExistingNeed?.recommended_provider_ids ?? [],
            recommended_providers: carryExistingNeed?.recommended_providers ?? [],
            selected_provider_ids: carryExistingNeed?.selected_provider_ids ?? [],
            selected_provider_hints: carryExistingNeed?.selected_provider_hints ?? [],
          } satisfies ProviderNeed;
        }

        args.toolUsage.considered.push('search_providers_by_query_intent');
        args.toolUsage.inputs.push({
          tool: 'search_providers_by_query_intent',
          input: JSON.stringify(
            {
              category: queryIntent.category,
              queryStrings: queryIntent.queryStrings,
              location: args.plan.location,
            },
            null,
            2,
          ),
        });
        const providerSearchStartedAt = Date.now();
        const searchResult = await this.dependencies.providerGateway.searchProvidersByQueryIntent({
          category: queryIntent.category,
          queryStrings: queryIntent.queryStrings,
          location: args.plan.location,
          fitCriteria: queryIntent.fitCriteria,
        });
        args.timingMs.provider_search += Date.now() - providerSearchStartedAt;
        args.toolUsage.called.push('search_providers_by_query_intent');
        args.toolUsage.outputs.push({
          tool: 'search_providers_by_query_intent',
          output: JSON.stringify(searchResult, null, 2),
        });

        const providerEnrichmentStartedAt = Date.now();
        const enriched = await this.enrichProviders(searchResult.providers);
        const ranked = rankProvidersForCriteria(enriched, queryIntent.fitCriteria);
        args.timingMs.provider_enrichment += Date.now() - providerEnrichmentStartedAt;

        return {
          category: queryIntent.category,
          status: ranked.length > 0 ? 'shortlisted' : 'no_providers_available',
          preferences: queryIntent.preferences,
          hard_constraints: queryIntent.hardConstraints,
          missing_fields: [],
          recommended_provider_ids: ranked.map((provider) => provider.id),
          recommended_providers: ranked,
          selected_provider_ids: [],
          selected_provider_hints: [],
        } satisfies ProviderNeed;
      }),
    );

    const retrievedCategories = new Set(retrievedNeeds.map((need) => need.category));
    const untouchedNeeds = args.resetToQueryIntentsOnly
      ? []
      : args.plan.provider_needs.filter(
          (need) => !retrievedCategories.has(need.category),
        );
    const activeNeedCategory =
      sortedIntents[0]?.category ?? args.plan.active_need_category ?? null;

    return {
      plan: replaceProviderNeeds(
        args.plan,
        [...untouchedNeeds, ...retrievedNeeds],
        activeNeedCategory,
      ),
      searchStrategy: sortedIntents.some((queryIntent) => queryIntent.retrievalReady)
        ? 'multi_need_query_intents'
        : 'none',
    };
  }

  private resolveElicitationQueryIntents(
    extraction: ExtractionResult,
  ): ProviderQueryIntent[] {
    const queryIntents = extraction.providerQueryIntents ?? [];

    const allowedCategories = prioritizedProviderCategoriesForEvent(extraction.eventType);
    const extractedExplicitCategories = new Set([
      extraction.vendorCategory,
      extraction.activeNeedCategory,
      ...extraction.vendorCategories,
    ].filter((category): category is ProviderCategory => Boolean(category)));
    const explicitCategories =
      extractedExplicitCategories.size > 0 && extractedExplicitCategories.size <= 3
        ? extractedExplicitCategories
        : new Set<ProviderCategory>();
    const ranked = [...queryIntents]
      .filter((queryIntent) => allowedCategories.includes(queryIntent.category))
      .sort((left, right) => {
        const leftExplicit = explicitCategories.has(left.category) ? 0 : 1;
        const rightExplicit = explicitCategories.has(right.category) ? 0 : 1;
        if (leftExplicit !== rightExplicit) return leftExplicit - rightExplicit;
        const leftRank = allowedCategories.indexOf(left.category);
        const rightRank = allowedCategories.indexOf(right.category);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.priority - right.priority;
      });

    if (!this.hasDetailedElicitationConcept(extraction)) {
      const starterCategories = Array.from(new Set([
        ...starterProviderCategoriesForEvent(extraction.eventType, MAX_STARTER_NEEDS),
        ...explicitCategories,
      ])).slice(0, MAX_STARTER_NEEDS);
      const rankedByCategory = new Map(
        ranked.map((queryIntent) => [queryIntent.category, queryIntent]),
      );

      return starterCategories.map((category, index) => {
        const queryIntent = rankedByCategory.get(category);
        return {
          category,
          label: queryIntent?.label ?? category,
          priority: index + 1,
          queryStrings: queryIntent?.queryStrings ?? [],
          preferences: queryIntent?.preferences ?? extraction.preferences ?? [],
          hardConstraints: queryIntent?.hardConstraints ?? extraction.hardConstraints ?? [],
          retrievalReady: false,
          missingFields: this.uniqueOperationStrings([
            'need_priority_confirmation',
          ]),
          fitCriteria: queryIntent?.fitCriteria ?? {
            eventType: extraction.providerFitCriteria?.eventType ?? extraction.eventType,
            needCategory: category,
            location: extraction.providerFitCriteria?.location ?? extraction.location,
            budgetAmount: extraction.providerFitCriteria?.budgetAmount ?? null,
            budgetCurrency: extraction.providerFitCriteria?.budgetCurrency ?? null,
            mustHave: extraction.providerFitCriteria?.mustHave ?? [],
            shouldAvoid: extraction.providerFitCriteria?.shouldAvoid ?? [],
            rankingNotes: extraction.providerFitCriteria?.rankingNotes ?? '',
          },
        };
      });
    }

    return ranked.slice(0, MAX_DETAILED_ELICITATION_NEEDS);
  }

  private hasDetailedElicitationConcept(extraction: ExtractionResult): boolean {
    if (extraction.intent !== 'elicitar_necesidades') {
      return false;
    }

    return (
      (extraction.hardConstraints?.length ?? 0) > 0 ||
      (extraction.preferences?.length ?? 0) >= 3
    );
  }

  private shouldRouteProviderSearchToElicitation(
    extraction: ExtractionResult,
  ): boolean {
    if (extraction.intent !== 'buscar_proveedores' || !extraction.eventType) {
      return false;
    }
    if (
      (extraction.hardConstraints?.length ?? 0) > 0 ||
      (extraction.preferences?.length ?? 0) >= 3
    ) {
      return false;
    }

    const multiNeedSignals = new Set(
      extraction.vendorCategories.filter(
        (category): category is ProviderCategory => Boolean(category),
      ),
    );

    return (
      multiNeedSignals.size > 1 &&
      extraction.budgetSignal === 'medio'
    );
  }

  private async executeProviderSearch(args: {
    baselinePlan: PlanSnapshot;
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    toolUsage: ToolUsage;
    timingMs: {
      provider_search: number;
    };
  }): Promise<ProviderSearchExecutionResult> {
    const { baselinePlan, extraction, plan, timingMs, toolUsage } = args;

    if (this.shouldBroadenProviderSearch(baselinePlan, extraction.intent, extraction)) {
      const broadenedResult = await this.searchMoreProviders({
        plan,
        toolUsage,
        timingMs,
      });
      if (broadenedResult) {
        return broadenedResult;
      }
    }

    toolUsage.considered.push('search_providers_from_plan');
    toolUsage.inputs.push({
      tool: 'search_providers_from_plan',
      input: JSON.stringify(
        {
          source: 'agent_service',
          activeNeedCategory: plan.active_need_category,
          location: plan.location,
        },
        null,
        2,
      ),
    });
    const providerSearchStartedAt = Date.now();
    const result = await this.dependencies.providerGateway.searchProviders(plan);
    timingMs.provider_search += Date.now() - providerSearchStartedAt;
    toolUsage.called.push('search_providers_from_plan');
    toolUsage.outputs.push({
      tool: 'search_providers_from_plan',
      output: JSON.stringify(result, null, 2),
    });

    return {
      providers: result.providers,
      note: null,
      strategy: 'search_from_plan',
    };
  }

  private hasSearchCriteriaChange(
    baselinePlan: PlanSnapshot,
    extraction: ExtractionResult,
  ): boolean {
    const activeNeed = getActiveNeed(baselinePlan);
    const baselineCategory = this.normalizeCategoryValue(
      activeNeed?.category ?? baselinePlan.active_need_category ?? baselinePlan.vendor_category,
    );
    const extractedCategory = this.normalizeCategoryValue(
      extraction.activeNeedCategory ?? extraction.vendorCategory,
    );

    if (extractedCategory && extractedCategory !== baselineCategory) {
      return true;
    }

    if (
      extraction.location &&
      this.normalizeSelectionText(extraction.location) !==
        this.normalizeSelectionText(baselinePlan.location ?? '')
    ) {
      return true;
    }

    if (
      extraction.budgetSignal &&
      this.normalizeSelectionText(extraction.budgetSignal) !==
        this.normalizeSelectionText(baselinePlan.budget_signal ?? '')
    ) {
      return true;
    }

    if (
      extraction.eventType &&
      this.normalizeSelectionText(extraction.eventType) !==
        this.normalizeSelectionText(baselinePlan.event_type ?? '')
    ) {
      return true;
    }

    if (
      extraction.guestRange &&
      extraction.guestRange !== 'unknown' &&
      extraction.guestRange !== baselinePlan.guest_range
    ) {
      return true;
    }

    if (
      this.hasArrayCriteriaChange(extraction.preferences, activeNeed?.preferences ?? []) ||
      this.hasArrayCriteriaChange(
        extraction.hardConstraints,
        activeNeed?.hard_constraints ?? [],
      )
    ) {
      return true;
    }

    return false;
  }

  private hasArrayCriteriaChange(nextValues: string[], currentValues: string[]): boolean {
    if (nextValues.length === 0) {
      return false;
    }

    const normalizedCurrent = new Set(
      currentValues.map((value) => this.normalizeSelectionText(value)).filter(Boolean),
    );
    const normalizedNext = new Set(
      nextValues.map((value) => this.normalizeSelectionText(value)).filter(Boolean),
    );

    if (normalizedCurrent.size !== normalizedNext.size) {
      return true;
    }

    for (const value of normalizedNext) {
      if (!normalizedCurrent.has(value)) {
        return true;
      }
    }

    return false;
  }

  private truncateDebugText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  private async searchMoreProviders(args: {
    plan: PlanSnapshot;
    toolUsage: ToolUsage;
    timingMs: {
      provider_search: number;
    };
  }): Promise<ProviderSearchExecutionResult | null> {
    const { plan, timingMs, toolUsage } = args;
    const activeNeed = getActiveNeed(plan);
    const category = activeNeed?.category ?? plan.active_need_category ?? plan.vendor_category;
    const currentProviders = activeNeed?.recommended_providers ?? [];

    if (!category || currentProviders.length === 0) {
      return null;
    }

    const existingProviderIds = new Set(currentProviders.map((provider) => provider.id));
    const unseenProviders = await this.collectBroadenedProviders({
      category,
      existingProviderIds,
      location: plan.location,
      timingMs,
      toolUsage,
    });

    if (unseenProviders.length > 0) {
      return {
        providers: unseenProviders.slice(0, TARGET_BROADEN_UNSEEN_RESULTS),
        note: null,
        strategy: 'broaden_existing_shortlist',
      };
    }

    return {
      providers: currentProviders,
      note: 'No encontré más opciones distintas con los criterios actuales.',
      strategy: 'broaden_existing_shortlist',
    };
  }

  private async collectBroadenedProviders(args: {
    category: ProviderCategory;
    existingProviderIds: Set<number>;
    location: string | null;
    timingMs: {
      provider_search: number;
    };
    toolUsage: ToolUsage;
  }): Promise<ProviderSummary[]> {
    const { category, existingProviderIds, location, timingMs, toolUsage } = args;
    const unseenProviders: ProviderSummary[] = [];
    const collectedProviderIds = new Set(existingProviderIds);

    const collectFromSearch = async (searchLocation: string | null, source: string) => {
      for (let page = 1; page <= MAX_BROADEN_SEARCH_PAGES; page += 1) {
        toolUsage.considered.push('search_providers_by_category_location');
        toolUsage.inputs.push({
          tool: 'search_providers_by_category_location',
          input: JSON.stringify(
            {
              source,
              category,
              location: searchLocation,
              page,
            },
            null,
            2,
          ),
        });
        const providerSearchStartedAt = Date.now();
        const result = await this.dependencies.providerGateway.searchProvidersByCategoryLocation({
          category,
          location: searchLocation,
          page,
        });
        timingMs.provider_search += Date.now() - providerSearchStartedAt;
        toolUsage.called.push('search_providers_by_category_location');
        toolUsage.outputs.push({
          tool: 'search_providers_by_category_location',
          output: JSON.stringify(result, null, 2),
        });

        const pageProviders = result.providers;
        for (const provider of pageProviders) {
          if (collectedProviderIds.has(provider.id)) {
            continue;
          }

          collectedProviderIds.add(provider.id);
          unseenProviders.push(provider);
        }

        if (
          unseenProviders.length >= TARGET_BROADEN_UNSEEN_RESULTS ||
          pageProviders.length === 0
        ) {
          break;
        }
      }
    };

    if (location) {
      await collectFromSearch(location, 'agent_service_broaden_location');
    }

    if (unseenProviders.length < TARGET_BROADEN_UNSEEN_RESULTS) {
      await collectFromSearch(null, 'agent_service_broaden_category');
    }

    return unseenProviders;
  }

  private providerAliases(provider: ProviderSummary): string[] {
    const aliases = new Set<string>();
    const title = provider.title.split('|')[0]?.trim() ?? provider.title;
    const normalizedTitle = this.normalizeSelectionText(title);
    if (normalizedTitle) {
      aliases.add(normalizedTitle);
      aliases.add(
        normalizedTitle
          .replace(/(\d)(?=\p{Letter})/gu, '$1 ')
          .replace(/(?<=\p{Letter})(\d)/gu, ' $1'),
      );
    }

    const firstToken = normalizedTitle.split(/\s+/)[0] ?? '';
    if (firstToken.length >= 3) {
      aliases.add(firstToken);
    }

    if (provider.slug) {
      aliases.add(this.normalizeSelectionText(provider.slug.replace(/-/g, ' ')));
    }

    return Array.from(aliases).filter(Boolean);
  }

  private normalizeSelectionText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizedTextContainsAlias(text: string, alias: string): boolean {
    return ` ${text} `.includes(` ${alias} `);
  }

  private async enrichProviders(
    providers: ProviderSummary[],
  ): Promise<ProviderSummary[]> {
    const details = await Promise.all(
      providers.map(async (provider) => {
        const detail = await this.dependencies.providerGateway.getProviderDetail(
          provider.id,
        );

        if (!detail) {
          return normalizeProviderSummary(provider);
        }

        return normalizeProviderSummary({
          ...provider,
          ...detail,
          reason: provider.reason ?? detail.reason ?? null,
        });
      }),
    );

    return details;
  }

  private collectPlanProviders(plan: PlanSnapshot): ProviderSummary[] {
    const seen = new Set<number>();
    const providers: ProviderSummary[] = [];
    for (const need of plan.provider_needs) {
      for (const provider of need.recommended_providers) {
        if (seen.has(provider.id)) {
          continue;
        }
        seen.add(provider.id);
        providers.push(provider);
      }
    }
    return providers;
  }

  private buildNeedUpdates(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): ProviderNeed[] {
    const categories = this.resolvePlanNeedCategories(extraction);
    const currentActiveCategory =
      plan.active_need_category ??
      getActiveNeed(plan)?.category ??
      null;

    if (categories.length === 0 && currentActiveCategory) {
      categories.push(currentActiveCategory);
    }

    if (categories.length === 0) {
      return [];
    }

    const currentNeeds = plan.provider_needs ?? [];

    return categories.map((category) => {
      const currentNeed =
        currentNeeds.find(
          (need) => need.category === category,
        ) ?? null;

      return {
        category,
        status:
          currentNeed?.status ??
          (currentNeed?.recommended_provider_ids.length ? 'shortlisted' : 'identified'),
        preferences: extraction.preferences,
        hard_constraints: extraction.hardConstraints,
        missing_fields: [],
        recommended_provider_ids: currentNeed?.recommended_provider_ids ?? [],
        recommended_providers: currentNeed?.recommended_providers ?? [],
        selected_provider_ids: currentNeed?.selected_provider_ids ?? [],
        selected_provider_hints: currentNeed?.selected_provider_hints ?? [],
      };
    });
  }

  private resolvePlanNeedCategories(extraction: ExtractionResult): ProviderCategory[] {
    const extractedCategories = Array.from(
      new Set(
        [
          extraction.activeNeedCategory,
          extraction.vendorCategory,
          ...extraction.vendorCategories,
        ].filter((category): category is ProviderCategory => Boolean(category)),
      ),
    );
    if (extractedCategories.length === 0) {
      return [];
    }

    const allowedCategories = prioritizedProviderCategoriesForEvent(extraction.eventType);
    const explicitCategories = new Set(
      [
        extraction.activeNeedCategory,
        extraction.vendorCategory,
      ].filter((category): category is ProviderCategory => Boolean(category)),
    );
    const filteredCategories = extractedCategories.filter(
      (category) => allowedCategories.includes(category) || explicitCategories.has(category),
    );
    const rankedCategories = filteredCategories.sort((left, right) => {
      const leftExplicit = explicitCategories.has(left) ? 0 : 1;
      const rightExplicit = explicitCategories.has(right) ? 0 : 1;
      if (leftExplicit !== rightExplicit) {
        return leftExplicit - rightExplicit;
      }

      const leftRank = allowedCategories.indexOf(left);
      const rightRank = allowedCategories.indexOf(right);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return extractedCategories.indexOf(left) - extractedCategories.indexOf(right);
    });

    if (this.shouldUseStarterNeedProjection(extraction, rankedCategories)) {
      return Array.from(new Set([
        ...rankedCategories.filter((category) => explicitCategories.has(category)),
        ...starterProviderCategoriesForEvent(extraction.eventType, MAX_STARTER_NEEDS),
      ])).slice(0, MAX_STARTER_NEEDS);
    }

    return rankedCategories;
  }

  private shouldUseStarterNeedProjection(
    extraction: ExtractionResult,
    categories: ProviderCategory[],
  ): boolean {
    if (extraction.intent === 'elicitar_necesidades') {
      return false;
    }
    if (categories.length <= 3) {
      return false;
    }
    if ((extraction.hardConstraints?.length ?? 0) > 0) {
      return false;
    }
    if ((extraction.preferences?.length ?? 0) >= 3) {
      return false;
    }
    return Boolean(extraction.eventType);
  }

  private shouldAskForEventContext(plan: PlanSnapshot): boolean {
    return !getActiveNeed(plan)?.category;
  }

  private shouldContinueWithAnotherNeed(
    plan: PlanSnapshot,
    selection: SelectionResolution,
  ): boolean {
    if (!selection.resolved) {
      return false;
    }

    const activeNeed = getActiveNeed(plan);
    const activeCategory = this.normalizeCategoryValue(
      activeNeed?.category ?? plan.active_need_category,
    );
    const selectedCategories = selection.selectedCategories
      .map((category) => this.normalizeCategoryValue(category))
      .filter((category): category is string => Boolean(category));

    return (
      Boolean(activeCategory) &&
      selectedCategories.length > 0 &&
      selectedCategories.every((selectedCategory) => activeCategory !== selectedCategory) &&
      (activeNeed?.selected_provider_ids.length ?? 0) === 0
    );
  }

  private hasUnselectedShortlist(plan: PlanSnapshot): ProviderNeed | null {
    return (
      plan.provider_needs.find(
        (need) =>
          need.status === 'shortlisted' &&
          need.recommended_providers.length > 0 &&
          need.selected_provider_ids.length === 0,
      ) ?? null
    );
  }

  // --- Contact field validation & normalization ---

  private readonly SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  private readonly PHONE_ALLOWED_CHARS_REGEX = /^\+?[\d\s().-]+$/;

  /**
   * Normalize a phone number to digits-only international format (E.164 without +).
   * Convention: contact_phone always stores the full international number as digits
   * (e.g. "51954779071" for Peru, "5215551234567" for Mexico).
   * Country code splitting happens at the gateway boundary.
   */
  private normalizePhone(value: string | null | undefined): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    return digits.length > 0 ? digits : null;
  }

  private isValidPhone(digits: string | null): boolean {
    if (!digits) return false;
    return digits.length >= 6 && digits.length <= 15;
  }

  private isValidEmail(value: string | null): boolean {
    if (!value) return false;
    return this.SIMPLE_EMAIL_REGEX.test(value);
  }

  private inferContactPhoneFromMessage(text: string): string | null {
    const patterns = [
      /\+?\d[\d\s().-]{5,14}\d/,
      /\b\d{6,15}\b/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const candidate = this.normalizePhone(match[0]);
        if (this.isValidPhone(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  private validateContactFields(plan: PlanSnapshot, previousPlan: PlanSnapshot): string | null {
    const phoneChanged = plan.contact_phone !== previousPlan.contact_phone;
    const emailChanged = plan.contact_email !== previousPlan.contact_email;

    if (phoneChanged && plan.contact_phone !== null && !this.isValidPhone(plan.contact_phone)) {
      return 'El teléfono debe tener entre 6 y 15 dígitos.';
    }
    if (emailChanged && plan.contact_email !== null && !this.isValidEmail(plan.contact_email)) {
      return 'El correo electrónico no parece válido.';
    }
    return null;
  }

  private inferGuestRangeFromMessage(text: string): PlanSnapshot['guest_range'] {
    const normalized = text.toLowerCase();
    const patterns = [
      /(\d{1,4})\s*(?:invitad(?:os|as)?|personas|asistentes)\b/u,
      /\bsomos\s+(\d{1,4})\b/u,
      /\bpara\s+(\d{1,4})\b/u,
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      const count = Number.parseInt(match?.[1] ?? '', 10);
      if (Number.isFinite(count)) {
        return this.toGuestRange(count);
      }
    }

    return null;
  }

  private toGuestRange(count: number): PlanSnapshot['guest_range'] {
    if (count <= 20) {
      return '1-20';
    }
    if (count <= 50) {
      return '21-50';
    }
    if (count <= 100) {
      return '51-100';
    }
    if (count <= 200) {
      return '101-200';
    }
    return '201+';
  }

  private normalizeCategoryValue(value: string | null | undefined): string | null {
    const canonical = normalizeToProviderCategory(value);
    if (canonical) return canonical;
    const categories = resolveSearchCategories(value);
    return categories[0] ?? null;
  }

  private isVenueLikeCategory(value: string | null | undefined): boolean {
    return normalizeToProviderCategory(value) === 'Locales';
  }

  private resolveEffectiveSelectionHints(
    extraction: ExtractionResult,
    userMessage: string,
    plan: PlanSnapshot,
  ): string[] {
    if (extraction.selectedProviderHints.length > 0) {
      return extraction.selectedProviderHints;
    }

    const hasSelectionIntent =
      extraction.intent === 'confirmar_proveedor' ||
      extraction.secondaryIntents?.includes('confirmar_proveedor');

    if (!hasSelectionIntent) {
      return [];
    }

    const normalizedMessage = this.normalizeSelectionText(userMessage);

    const allProviders = plan.provider_needs.flatMap(
      (need) => need.recommended_providers,
    );

    const hints: string[] = [];
    for (const provider of allProviders) {
      const aliases = this.providerAliases(provider);
      for (const alias of aliases) {
        if (alias.length >= 3 && normalizedMessage.includes(alias)) {
          hints.push(provider.title);
          break;
        }
      }
    }

    return hints;
  }

  private messageHasVenueCue(value: string): boolean {
    const normalized = this.normalizeSelectionText(value);
    return [
      'local',
      'locales',
      'salon',
      'salones',
      'venue',
      'venues',
      'espacio',
      'espacios',
      'solo el espacio',
      'lugar para',
      'lugares para',
    ].some((keyword) => normalized.includes(keyword));
  }

  private renderReply(
    reply: { text: string; structuredMessage?: StructuredMessage },
    providerResults: ProviderSummary[],
    channel: string,
  ): string {
    if (reply.structuredMessage) {
      const renderer = this.dependencies.renderers[channel]
        ?? this.dependencies.renderers['whatsapp'];
      if (renderer) {
        return renderer.render({
          message: reply.structuredMessage,
          providerResults,
        });
      }
    }

    return reply.text;
  }
}
