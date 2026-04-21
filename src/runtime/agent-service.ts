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
import { computeSearchSufficiency } from '../core/sufficiency';
import type { TurnTrace } from '../core/trace';
import type { AgentRuntime, ExtractionResult } from './contracts';
import type { TokenUsage } from './contracts';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
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

type ProviderSelectionCandidate = ProviderSelectionMatch & {
  searchableText: string;
};

export class AgentService {
  constructor(
    private readonly dependencies: {
      planStore: PlanStore;
      runtime: AgentRuntime;
      providerGateway: ProviderGateway;
      promptLoader: PromptLoader;
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
    const existingPlan = await this.dependencies.planStore.getByExternalUser(
      inbound.channel,
      inbound.externalUserId,
    );
    timingMs.load_plan += Date.now() - loadPlanStartedAt;

    if (existingPlan && isPlanFinished(existingPlan)) {
      const finishedPlan = existingPlan;
      const finishedSufficiency = computeSearchSufficiency(finishedPlan);
      const finishedProviders =
        getActiveNeed(finishedPlan)?.recommended_providers ?? [];
      timingMs.total = Date.now() - handleTurnStartedAt;
      return {
        plan: finishedPlan,
        outbound: {
          text: 'Este plan de evento ya está cerrado y en la fase de contacto con proveedores. Cuando expire el período de enfriamiento de 24 horas podrás iniciar un plan nuevo desde cero.',
          conversationId: finishedPlan.conversation_id,
        },
        trace: {
          trace_id: ulid(),
          conversation_id: finishedPlan.conversation_id,
          plan_id: finishedPlan.plan_id,
          previous_node: finishedPlan.current_node,
          next_node: finishedPlan.current_node,
          node_path: [
            finishedPlan.current_node,
            'existe_plan_guardado',
            finishedPlan.current_node,
          ],
          intent: finishedPlan.intent,
          missing_fields: finishedSufficiency.missingFields,
          search_ready: finishedSufficiency.searchReady,
          prompt_bundle_id: 'skipped_finished_plan',
          prompt_file_paths: [],
          tools_considered: toolUsage.considered,
          tools_called: toolUsage.called,
          tool_inputs: toolUsage.inputs,
          tool_outputs: toolUsage.outputs,
          provider_results: finishedProviders,
          recommendation_funnel: this.resolveRecommendationFunnel(
            null,
            finishedProviders,
          ),
          plan_persisted: false,
          plan_persist_reason: null,
          timing_ms: timingMs,
          token_usage: {
            extraction: null,
            reply: null,
            total: null,
          },
        },
      };
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
    const workingPlan = mergePlan(loadedPlan, {
      current_node: existingPlan ? resolveResumeNode(existingPlan) : 'deteccion_intencion',
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

    const applyExtractionStartedAt = Date.now();
    const extractionNode = this.resolveExtractionNode(workingPlan, extraction);
    const mergedPlan = this.applyExtraction(
      workingPlan,
      extraction,
      extractionNode,
      inbound.text,
    );
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
    let errorMessage: string | null = null;
    let planPersistReason: string | null = null;
    let planPersisted = false;
    let planFinishTtlEpochSeconds: number | undefined;
    const persistPlan = async (plan: PlanSnapshot, reason: string) => {
      const savePlanStartedAt = Date.now();
      await this.dependencies.planStore.save({
        plan,
        reason,
        ...(planFinishTtlEpochSeconds !== undefined
          ? { ttlEpochSeconds: planFinishTtlEpochSeconds }
          : {}),
      });
      timingMs.save_plan += Date.now() - savePlanStartedAt;
    };

    if (extraction.pauseRequested || extraction.intent === 'pausar' || extraction.intent === 'cerrar') {
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
        onPlanFinished: (epoch) => {
          planFinishTtlEpochSeconds = epoch;
        },
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
          text: reply.text,
          conversationId: planToSave.conversation_id,
        },
        trace: {
          trace_id: ulid(),
          conversation_id: planToSave.conversation_id,
          plan_id: planToSave.plan_id,
          previous_node: previousNode,
          next_node: currentNode,
          node_path: nodePath,
          intent: planToSave.intent,
          missing_fields: sufficiency.missingFields,
          search_ready: sufficiency.searchReady,
          prompt_bundle_id: bundle.id,
          prompt_file_paths: bundle.filePaths,
          tools_considered: toolUsage.considered,
          tools_called: toolUsage.called,
          tool_inputs: toolUsage.inputs,
          tool_outputs: toolUsage.outputs,
          provider_results: providerResults,
          recommendation_funnel: recommendationFunnel,
          plan_persisted: true,
          plan_persist_reason: planPersistReason,
          timing_ms: timingMs,
          token_usage: tokenUsage,
        },
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
        inbound.text,
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
          toolUsage.considered.push('search_providers_from_plan');
          toolUsage.inputs.push({
            tool: 'search_providers_from_plan',
            input: JSON.stringify(
              {
                source: 'agent_service',
                activeNeedCategory: planAfterFlow.active_need_category,
                location: planAfterFlow.location,
              },
              null,
              2,
            ),
          });
          const providerSearchStartedAt = Date.now();
          const searchResult = await this.dependencies.providerGateway.searchProviders(
            planAfterFlow,
          );
          timingMs.provider_search += Date.now() - providerSearchStartedAt;
          toolUsage.called.push('search_providers_from_plan');
          toolUsage.outputs.push({
            tool: 'search_providers_from_plan',
            output: JSON.stringify(searchResult, null, 2),
          });
          const providerEnrichmentStartedAt = Date.now();
          providerResults = await this.enrichProviders(searchResult.providers);
          timingMs.provider_enrichment += Date.now() - providerEnrichmentStartedAt;
          const activeNeed = getActiveNeed(planAfterFlow);
          planAfterFlow = mergePlan(planAfterFlow, {
            active_need_category:
              activeNeed?.category ?? planAfterFlow.active_need_category,
            provider_needs: activeNeed
              ? [
                  {
                    ...activeNeed,
                    recommended_provider_ids: providerResults.map(
                      (provider) => provider.id,
                    ),
                    recommended_providers: providerResults,
                    missing_fields: [],
                    selected_provider_id: null,
                    selected_provider_hint: null,
                    status:
                      providerResults.length > 0 ? 'shortlisted' : 'search_ready',
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
      onPlanFinished: (epoch) => {
        planFinishTtlEpochSeconds = epoch;
      },
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
        text: reply.text,
        conversationId: planAfterFlow.conversation_id,
      },
      trace: {
        trace_id: ulid(),
        conversation_id: planAfterFlow.conversation_id,
        plan_id: planAfterFlow.plan_id,
        previous_node: previousNode,
        next_node: currentNode,
        node_path: nodePath,
        intent: planAfterFlow.intent,
        missing_fields: sufficiency.missingFields,
        search_ready: sufficiency.searchReady,
        prompt_bundle_id: promptBundle.id,
        prompt_file_paths: promptBundle.filePaths,
        tools_considered: toolUsage.considered,
        tools_called: toolUsage.called,
        tool_inputs: toolUsage.inputs,
        tool_outputs: toolUsage.outputs,
        provider_results: providerResults,
        recommendation_funnel: recommendationFunnel,
        plan_persisted: planPersisted,
        plan_persist_reason: planPersistReason,
        timing_ms: timingMs,
        token_usage: tokenUsage,
      },
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

  private resolveExtractionNode(
    plan: PersistedPlan,
    extraction: ExtractionResult,
  ): DecisionNode {
    if (!plan.intent && !plan.event_type) {
      return 'deteccion_intencion';
    }

    if (extraction.intent === 'refinar_busqueda') {
      return 'refinar_criterios';
    }

    if (extraction.intent === 'confirmar_proveedor') {
      return 'usuario_elige_proveedor';
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
  ): PlanSnapshot {
    const guardedExtraction = this.guardImplicitVenueNeed(plan, extraction, userMessage);
    const extractedGuestRange =
      guardedExtraction.guestRange === 'unknown' ? null : guardedExtraction.guestRange;
    const normalizedGuestRange =
      this.inferGuestRangeFromMessage(userMessage) ??
      extractedGuestRange ??
      plan.guest_range;
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
      provider_needs: this.buildNeedUpdates(plan, guardedExtraction),
      last_user_goal: guardedExtraction.intent ?? plan.last_user_goal,
    });

    const sufficiency = computeSearchSufficiency(candidate);
    return mergePlan(candidate, {
      missing_fields: sufficiency.missingFields,
    });
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
    userMessage: string,
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

    const inferredHint = this.inferSelectionHint(
      needsWithProviders.flatMap((need) => need.recommended_providers),
      intent,
      userMessage,
    );
    const effectiveHint =
      selectedProviderHint?.trim() ||
      inferredHint;

    const selection =
      effectiveHint
        ? (
            this.resolveProviderSelection(
              needsWithProviders,
              activeNeed,
              effectiveHint,
            ) ??
            this.inferDescriptiveSelection(
              needsWithProviders,
              intent,
              userMessage,
            )
          )
        : this.inferDescriptiveSelection(
            needsWithProviders,
            intent,
            userMessage,
          );

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

  private inferSelectionHint(
    providers: ProviderSummary[],
    intent: ExtractionResult['intent'],
    userMessage: string,
  ): string | null {
    const normalizedMessage = this.normalizeSelectionText(userMessage);
    if (!this.hasSelectionIntent(intent, normalizedMessage)) {
      return null;
    }

    const matches = providers.filter((provider) =>
      this.providerAliases(provider).some((alias) =>
        this.normalizedTextContainsAlias(normalizedMessage, alias),
      ),
    );

    if (matches.length === 1) {
      const preferredAlias =
        this.providerAliases(matches[0]).find((alias) =>
          this.normalizedTextContainsAlias(normalizedMessage, alias),
        ) ??
        matches[0].title;
      return preferredAlias;
    }

    const ordinalChoice = this.parseSelectionOrdinal(normalizedMessage);
    if (ordinalChoice) {
      return String(ordinalChoice);
    }

    return null;
  }

  private inferDescriptiveSelection(
    needsWithProviders: ProviderNeed[],
    intent: ExtractionResult['intent'],
    userMessage: string,
  ): ProviderSelectionMatch | null {
    const normalizedMessage = this.normalizeSelectionText(userMessage);
    if (!this.hasSelectionIntent(intent, normalizedMessage)) {
      return null;
    }

    const tokens = this.selectionReferenceTokens(normalizedMessage);
    if (tokens.length === 0) {
      return null;
    }

    const candidates = this.buildSelectionCandidates(needsWithProviders);
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: this.scoreSelectionCandidate(candidate.searchableText, tokens),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    const best = scored[0] ?? null;
    if (!best || best.score < 2) {
      return null;
    }

    const secondScore = scored[1]?.score ?? 0;
    if (secondScore > 0 && best.score - secondScore < 2) {
      return null;
    }

    return {
      selectedNeed: best.candidate.selectedNeed,
      selectedProvider: best.candidate.selectedProvider,
    };
  }

  private hasSelectionIntent(
    intent: ExtractionResult['intent'],
    normalizedMessage: string,
  ): boolean {
    return (
      intent === 'confirmar_proveedor' ||
      [
        'quiero ',
        'usar ',
        'utilizar ',
        'vamos con',
        'me quedo con',
        'elijo',
        'escogo',
        'dame ',
        'tomo ',
        'tomemos ',
        'prefiero ',
        'me gusta ',
        'me interesa ',
        'elige ',
        'selecciona ',
        'dejame ',
        'dejemos ',
      ].some((pattern) => normalizedMessage.includes(pattern))
    );
  }

  private buildSelectionCandidates(
    needsWithProviders: ProviderNeed[],
  ): ProviderSelectionCandidate[] {
    return needsWithProviders.flatMap((need) =>
      need.recommended_providers.map((provider) => ({
        selectedNeed: need,
        selectedProvider: provider,
        searchableText: this.normalizeSelectionText(
          [
            provider.title,
            provider.slug,
            provider.category,
            provider.reason,
            provider.promoBadge,
            provider.promoSummary,
            provider.descriptionSnippet,
            provider.serviceHighlights.join(' '),
            provider.termsHighlights.join(' '),
          ]
            .filter((value): value is string => Boolean(value))
            .join(' '),
        ),
      })),
    );
  }

  private scoreSelectionCandidate(
    searchableText: string,
    tokens: string[],
  ): number {
    return tokens.reduce(
      (score, token) => score + (searchableText.includes(token) ? 1 : 0),
      0,
    );
  }

  private selectionReferenceTokens(normalizedMessage: string): string[] {
    const ignored = new Set([
      'quiero',
      'usar',
      'utilizar',
      'vamos',
      'quedo',
      'con',
      'elijo',
      'escogo',
      'dame',
      'tomo',
      'tomemos',
      'prefiero',
      'gusta',
      'interesa',
      'elige',
      'selecciona',
      'dejame',
      'dejemos',
      'opcion',
      'proveedor',
      'propuesta',
      'servicio',
      'servicios',
      'alternativa',
      'necesito',
      'tambien',
      'para',
      'una',
      'uno',
      'ese',
      'esa',
      'eso',
      'este',
      'esta',
      'tipo',
      'mas',
      'del',
      'por',
      'favor',
    ]);

    return Array.from(
      new Set(
        normalizedMessage
          .split(' ')
          .map((token) => token.trim())
          .filter((token) => token.length >= 3 && !ignored.has(token)),
      ),
    );
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
        ]
          .map((category) => category?.trim().toLowerCase())
          .filter((category): category is string => Boolean(category)),
      ),
    );
    const currentActiveCategory =
      plan.active_need_category?.trim().toLowerCase() ??
      getActiveNeed(plan)?.category?.trim().toLowerCase() ??
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
          (need) => need.category.trim().toLowerCase() === category,
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
    const normalized = value?.trim().toLowerCase() ?? '';
    return normalized || null;
  }

  private isVenueLikeCategory(value: string | null | undefined): boolean {
    const normalized = this.normalizeSelectionText(value ?? '');
    if (!normalized) {
      return false;
    }

    return [
      'local',
      'locales',
      'salon',
      'salones',
      'venue',
      'venues',
      'espacio',
      'espacios',
      'lugar',
      'lugares',
    ].some((keyword) => normalized.includes(keyword));
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
}
