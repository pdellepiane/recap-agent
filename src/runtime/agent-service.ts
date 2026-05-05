import { ulid } from 'ulid';

import type { DecisionNode } from '../core/decision-nodes';
import { extractionPersistenceNodes } from '../core/decision-nodes';
import { resolveResumeNode } from '../core/decision-flow';
import type {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
} from '../core/messages';
import {
  createEmptyPlan,
  getActiveNeed,
  isPlanFinished,
  mergePlan,
  type PersistedPlan,
  type PlanSnapshot,
  type ProviderNeed,
} from '../core/plan';
import { normalizeProviderSummary, type ProviderSummary } from '../core/provider';
import {
  normalizeToProviderCategory,
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
      selectedCategory: string;
    };

type ProviderSelectionMatch = {
  selectedNeed: ProviderNeed;
  selectedProvider: ProviderSummary;
};

type ProviderSearchExecutionResult = {
  providers: ProviderSummary[];
  note: string | null;
  strategy: SearchStrategyTrace;
};

const MAX_BROADEN_SEARCH_PAGES = 5;
const TARGET_BROADEN_UNSEEN_RESULTS = 5;

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
    const { plan: mergedPlan, validationError } = this.applyExtraction(
      workingPlan,
      extraction,
      extractionNode,
      inbound.text,
      inbound.contactPhone,
    );
    if (validationError) {
      errorMessage = validationError;
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
      nodePath.push(currentNode);
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
          selected_provider_id: null,
          selected_provider_hint: null,
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
      nodePath.push(currentNode);
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

    if (this.shouldAskForEventContext(mergedPlan)) {
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
        const selectionResolution = this.tryResolveSelection(
          planAfterFlow,
          extraction.selectedProviderHint,
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
                    selected_provider_id: null,
                    selected_provider_hint: null,
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
      selected_provider_hint: extraction.selectedProviderHint,
      preferences: extraction.preferences,
      hard_constraints: extraction.hardConstraints,
      assumptions: extraction.assumptions,
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
        selected_provider_id: need.selected_provider_id,
      })),
      selected_provider_id: plan.selected_provider_id,
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
      selected_provider_hint: plan.selected_provider_hint,
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

  private tryResolveSelection(
    plan: PlanSnapshot,
    selectedProviderHint: string | null,
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

    const effectiveHint = selectedProviderHint?.trim() ?? null;

    const selection = effectiveHint
      ? this.resolveProviderSelection(
          needsWithProviders,
          activeNeed,
          effectiveHint,
        )
      : this.resolveSingleProviderSelection(needsWithProviders, intent);

    if (!selection) {
      return { resolved: false };
    }

    const updatedNeed: ProviderNeed = {
      ...selection.selectedNeed,
      status: 'selected',
      selected_provider_id: selection.selectedProvider.id,
      selected_provider_hint: effectiveHint ?? selection.selectedProvider.title,
    };

    const updatedPlan = mergePlan(plan, {
      current_node: 'usuario_elige_proveedor',
      active_need_category: plan.active_need_category ?? selection.selectedNeed.category,
      provider_needs: [updatedNeed],
    });

    Object.assign(plan, updatedPlan);
    return {
      resolved: true,
      selectedCategory: selection.selectedNeed.category,
    };
  }

  private resolveProviderSelection(
    needsWithProviders: ProviderNeed[],
    activeNeed: ProviderNeed | null,
    effectiveHint: string,
  ): ProviderSelectionMatch | null {
    const byName = this.resolveProviderSelectionByName(
      needsWithProviders,
      effectiveHint,
    );
    if (byName) {
      return byName;
    }

    const ordinalChoice = this.parseSelectionOrdinal(effectiveHint);
    if (!ordinalChoice) {
      return null;
    }

    const ordinalNeed =
      activeNeed?.recommended_providers.length
        ? activeNeed
        : needsWithProviders.length === 1
          ? needsWithProviders[0] ?? null
          : null;
    const selectedProvider =
      ordinalNeed?.recommended_providers[ordinalChoice - 1] ?? null;

    if (!ordinalNeed || !selectedProvider) {
      return null;
    }

    return {
      selectedNeed: ordinalNeed,
      selectedProvider,
    };
  }

  private resolveSingleProviderSelection(
    needsWithProviders: ProviderNeed[],
    intent: ExtractionResult['intent'],
  ): ProviderSelectionMatch | null {
    if (intent !== 'confirmar_proveedor') {
      return null;
    }

    const candidates = needsWithProviders.flatMap((need) =>
      need.recommended_providers.map((provider) => ({
        selectedNeed: need,
        selectedProvider: provider,
      })),
    );

    if (candidates.length !== 1) {
      return null;
    }

    return candidates[0] ?? null;
  }

  private resolveProviderSelectionByName(
    needsWithProviders: ProviderNeed[],
    effectiveHint: string,
  ): ProviderSelectionMatch | null {
    const lowered = this.normalizeSelectionText(effectiveHint);
    if (!lowered) {
      return null;
    }

    for (const need of needsWithProviders) {
      const matchedProvider =
        need.recommended_providers.find((provider) =>
          this.providerAliases(provider).some((alias) =>
            this.normalizedTextContainsAlias(lowered, alias),
          ),
        ) ?? null;

      if (matchedProvider) {
        return {
          selectedNeed: need,
          selectedProvider: matchedProvider,
        };
      }
    }

    return null;
  }

  private parseSelectionOrdinal(value: string): number | null {
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

    const match = ordinalWords.find(([pattern]) => pattern.test(normalized));
    if (match) {
      return match[1];
    }

    const numericMatch = normalized.match(
      /\b(?:opcion|alternativa|proveedor|numero|nro|num)?\s*(\d{1,2})\b/u,
    );
    if (numericMatch?.[1]) {
      return Number.parseInt(numericMatch[1], 10);
    }

    return null;
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

  private buildNeedUpdates(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): ProviderNeed[] {
    const categories = Array.from(
      new Set(
        [
          extraction.activeNeedCategory,
          extraction.vendorCategory,
          ...extraction.vendorCategories,
        ].filter((category): category is ProviderCategory => Boolean(category)),
      ),
    );
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
        selected_provider_id: currentNeed?.selected_provider_id ?? null,
        selected_provider_hint: currentNeed?.selected_provider_hint ?? null,
      };
    });
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
    const selectedCategory = this.normalizeCategoryValue(selection.selectedCategory);

    return (
      Boolean(activeCategory) &&
      Boolean(selectedCategory) &&
      activeCategory !== selectedCategory &&
      !activeNeed?.selected_provider_id
    );
  }

  private hasUnselectedShortlist(plan: PlanSnapshot): ProviderNeed | null {
    return (
      plan.provider_needs.find(
        (need) =>
          need.status === 'shortlisted' &&
          need.recommended_providers.length > 0 &&
          need.selected_provider_id === null,
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
    return normalizeToProviderCategory(value);
  }

  private isVenueLikeCategory(value: string | null | undefined): boolean {
    return normalizeToProviderCategory(value) === 'Locales';
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
