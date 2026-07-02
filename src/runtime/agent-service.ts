import { ulid } from 'ulid';

import type { DecisionNode } from '../core/decision-nodes';
import { extractionPersistenceNodes } from '../core/decision-nodes';
import { resolveResumeNode } from '../core/decision-flow';
import type { EventType } from '../core/event-type';
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
import type {
  ProviderNeedSubQuery,
  ProviderSubQueryResult,
} from '../core/provider-sub-query';
import {
  normalizeToProviderCategory,
  resolveSearchCategories,
  type ProviderCategory,
} from '../core/provider-category';
import { computeNeedSearchSufficiencies, computeSearchSufficiency } from '../core/sufficiency';
import type {
  CloseActionDebugSummary,
  ContactValidationDebugSummary,
  FaqResolutionDebugSummary,
  ExtractionDebugSummary,
  PlanDebugSummary,
  ProviderCandidateAuditEntry,
  RecommendationFunnelTrace,
  SearchStrategyTrace,
  SelectionResolutionDebugSummary,
  TurnTrace,
} from '../core/trace';
import {
  decisionEvidenceSchema,
  turnDecisionSchema,
  type DecisionEvidence,
  type NeedSufficiency,
  type SessionFocus,
  type TurnDecision,
} from '../core/turn-decision';
import type { AgentRuntime, ExtractionResult, ToolUsage } from './contracts';
import type { TokenUsage } from './contracts';
import type { MessageRenderer } from './message-renderer';
import {
  inferCurrencyFromBudget,
  isProviderEligibleForCriteria,
  parseBudgetAmount,
  rankProvidersForCriteria,
  type ProviderFitCriteria,
} from './provider-fit';
import { createSubQueryFitCriteria, selectProvidersForSubQuery } from './provider-sub-query-selection';
import type {
  ProviderPlanOperation,
  ProviderQueryIntent,
  ProviderReference,
} from './extraction-schemas';
import { parseInternationalPhone } from './phone';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway, UserEventLookupResult } from './provider-gateway';
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

export function selectStarterProviderCategories(args: {
  eventType: EventType | null;
  explicitCategories: ProviderCategory[];
  maxNeeds: number;
}): ProviderCategory[] {
  const explicit = Array.from(new Set(args.explicitCategories));
  return explicit.length > 0 && explicit.length <= 3
    ? explicit.slice(0, args.maxNeeds)
    : starterProviderCategoriesForEvent(args.eventType, args.maxNeeds);
}

type ProviderSearchExecutionResult = {
  providers: ProviderSummary[];
  note: string | null;
  strategy: SearchStrategyTrace;
};

const MAX_BROADEN_SEARCH_PAGES = 5;
const TARGET_BROADEN_UNSEEN_RESULTS = 5;
const MAX_STARTER_NEEDS = 5;
const MAX_DETAILED_ELICITATION_NEEDS = 5;
const MAX_PROVIDER_QUERIES_PER_NEED = 3;

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
    const sessionFocus =
      inbound.sessionId && this.dependencies.planStore.getSessionFocus
        ? await this.dependencies.planStore.getSessionFocus(
            inbound.channel,
            inbound.externalUserId,
            inbound.sessionId,
          )
        : null;
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
          : finishedExtraction.intent === 'consultar_evento_invitado'
            ? 'consultar_evento_invitado'
            : 'necesidad_cubierta';
        let planForReply = existingPlan;
        let finishedInvitedEventLookupResult: UserEventLookupResult | null = null;
        let finishedErrorMessage: string | null = null;
        if (respondNode === 'consultar_evento_invitado') {
          const authResult = await this.resolveInvitedEventAuthentication({
            plan: mergePlan(existingPlan, { current_node: respondNode }),
            userMessage: inbound.text,
            toolUsage,
          });
          planForReply = authResult.plan;
          finishedInvitedEventLookupResult = authResult.lookupResult;
          finishedErrorMessage = authResult.message;
          await this.dependencies.planStore.save({
            plan: planForReply,
            reason: respondNode,
          });
        }
        const bundle = await this.dependencies.promptLoader.loadNodeBundle(respondNode);
        const reply = await this.dependencies.runtime.composeReply({
          currentNode: respondNode,
          previousNode: existingPlan.current_node,
          userMessage: inbound.text,
          plan: planForReply,
          extraction: finishedExtraction,
          missingFields: finishedSufficiency.missingFields,
          searchReady: finishedSufficiency.searchReady,
          providerResults: finishedProviders,
          errorMessage: finishedErrorMessage,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
          invitedEventLookupResult: finishedInvitedEventLookupResult,
        });
        tokenUsage.reply = reply.tokenUsage ?? null;
        tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
        timingMs.compose_reply += Date.now() - extractionStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        return {
          plan: planForReply,
          outbound: this.renderOutbound(reply, finishedProviders, inbound.channel, planForReply.conversation_id),
          trace: this.buildTrace({
            plan: planForReply,
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
            planPersisted: respondNode === 'consultar_evento_invitado',
            planPersistReason: respondNode === 'consultar_evento_invitado' ? respondNode : null,
            timingMs,
            tokenUsage,
            searchStrategy: 'none',
            operationalNote: finishedErrorMessage,
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
    let extraction =
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
    extraction = this.guardGenericElicitation(extraction);
    extraction = this.guardInvitedEventFollowUp(workingPlan, extraction);
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
      {
        deferShortlistedDeletes:
          (extraction.selectedProviderReferences ?? []).length > 0 ||
          this.resolveEffectiveSelectionHints(extraction).length > 0 ||
          extraction.intent === 'cerrar',
      },
    );
    const mergedPlan = operationResult.plan;
    if (operationResult.unresolvedMessage) {
      errorMessage = operationResult.unresolvedMessage;
    }
    const effectiveSelectionHints = this.resolveEffectiveSelectionHints(extraction);
    const shouldResolveProviderSelection =
      !this.isCloseContactFieldTurn(previousNode, extraction, validationError);
    const preliminarySelectionResolution: SelectionResolution = shouldResolveProviderSelection
      ? this.tryResolveSelection(
          mergedPlan,
          extraction.selectedProviderReferences ?? [],
          effectiveSelectionHints,
          extraction.intent,
      )
      : { resolved: false };
    const selectionShouldStop =
      preliminarySelectionResolution.resolved &&
      !this.shouldContinueWithAnotherNeed(mergedPlan, preliminarySelectionResolution);
    timingMs.apply_extraction += Date.now() - applyExtractionStartedAt;
    const sufficiencyStartedAt = Date.now();
    const sufficiency = computeSearchSufficiency(mergedPlan);
    const sufficiencyByNeed = computeNeedSearchSufficiencies(mergedPlan);
    timingMs.compute_sufficiency += Date.now() - sufficiencyStartedAt;
    const decisionEvidence = this.buildDecisionEvidence({
      previousNode,
      extraction,
      planBefore: workingPlan,
      planAfterReduction: mergedPlan,
      sessionFocus,
      sufficiency,
      sufficiencyByNeed,
      hasResolvedSelection: selectionShouldStop,
      hasAmbiguousSelection: false,
      hasReplaceProviderOperation: operationResult.appliedOperations.some(
        (op) => op.type === 'replace_provider',
      ),
    });
    let turnDecision = this.decideNextTurn(decisionEvidence);

    const nodePath: DecisionNode[] = existingPlan
      ? [previousNode, 'existe_plan_guardado', extractionNode]
      : [previousNode, extractionNode];
    let currentNode = extractionNode;
    let providerResults: ProviderSummary[] =
      getActiveNeed(mergedPlan)?.recommended_providers ?? [];
    let searchStrategy: SearchStrategyTrace = 'none';
    let planPersistReason: string | null = null;
    let planPersisted = false;
    let invitedEventLookupResult: UserEventLookupResult | null = null;
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
        extraction,
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
        outbound: this.renderOutbound(reply, providerResults, inbound.channel, planToSave.conversation_id),
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

    if (
      extraction.intent === 'cerrar' ||
      this.shouldHandleCloseTurn(previousNode, extraction, validationError)
    ) {
      const isCloseContactClarification = extraction.closeAction?.type === 'clarify';
      const closeSelectionResolution = shouldResolveProviderSelection
        ? this.tryResolveSelection(
            mergedPlan,
            extraction.selectedProviderReferences ?? [],
            this.resolveEffectiveSelectionHints(extraction),
            extraction.intent,
          )
        : { resolved: false };
      let planToClose = mergedPlan;
      if (closeSelectionResolution.resolved) {
        planToClose = mergedPlan;
      }
      if (extraction.closeAction?.type === 'defer_need') {
        const deferredCategory = extraction.closeAction.category ?? null;
        if (deferredCategory !== null) {
          const deferredNeed = planToClose.provider_needs.find(
            (need) => need.category === deferredCategory,
          );
          if (deferredNeed) {
            planToClose = mergePlan(planToClose, {
              provider_needs: [
                {
                  ...deferredNeed,
                  status: 'deferred',
                  selected_provider_ids: [],
                  selected_provider_hints: [],
                },
              ],
            });
          }
        }
      }

      const unselected = isCloseContactClarification
        ? null
        : this.hasUnselectedShortlist(planToClose);

      if (unselected) {
        currentNode = 'crear_lead_cerrar';
        nodePath.push(currentNode);
        errorMessage = `Antes de cerrar, necesito saber: ¿quieres elegir alguna opción de ${unselected.category} o prefieres dejarla sin proveedor? Responde "ninguna" si no quieres ninguna.`;
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
          extraction,
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
          outbound: this.renderOutbound(reply, providerResults, inbound.channel, planToSave.conversation_id),
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

      currentNode = 'crear_lead_cerrar';
      nodePath.push(currentNode);
      if (extraction.closeAction?.type === 'clarify') {
        errorMessage = extraction.closeAction.reason ?? null;
      }
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
        extraction,
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
        outbound: this.renderOutbound(reply, providerResults, inbound.channel, planToSave.conversation_id),
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
      currentNode = extraction.intent;
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      // Preserve the planning state: only update current_node so resume works.
      const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
      await persistPlan(planToSave, currentNode);
      planPersisted = true;
      planPersistReason = currentNode;

      const promptBundleStartedAt = Date.now();
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
      timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
      const composeReplyStartedAt = Date.now();
      const reply = await this.dependencies.runtime.composeReply({
        currentNode,
        previousNode,
        userMessage: inbound.text,
        plan: planToSave,
        extraction,
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
        outbound: this.renderOutbound(reply, providerResults, inbound.channel, planToSave.conversation_id),
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

    if (extraction.intent === 'consultar_evento_invitado') {
      currentNode = 'consultar_evento_invitado';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }

      const authResult = await this.resolveInvitedEventAuthentication({
        plan: mergePlan(mergedPlan, { current_node: currentNode }),
        userMessage: inbound.text,
        toolUsage,
      });
      const planToSave = authResult.plan;
      errorMessage = authResult.message;
      invitedEventLookupResult = authResult.lookupResult;
      await persistPlan(planToSave, currentNode);
      planPersisted = true;
      planPersistReason = currentNode;

      const promptBundleStartedAt = Date.now();
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
      timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
      const composeReplyStartedAt = Date.now();
      const reply = await this.dependencies.runtime.composeReply({
        currentNode,
        previousNode,
        userMessage: inbound.text,
        plan: planToSave,
        extraction,
        missingFields: sufficiency.missingFields,
        searchReady: sufficiency.searchReady,
        providerResults,
        errorMessage,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage,
        invitedEventLookupResult,
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
        outbound: this.renderOutbound(reply, providerResults, inbound.channel, planToSave.conversation_id),
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

    if (turnDecision.nextNode === 'elicitacion_necesidades') {
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
    } else if (turnDecision.routeKind === 'modify_plan') {
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
        turnDecision = turnDecisionSchema.parse({
          ...turnDecision,
          nextNode: currentNode,
          routeKind: 'present_existing_shortlist',
          providerSearchMode: 'existing_shortlist',
          presentationScope: 'single_need',
          focusNeedCategory: nextNeed.category,
          needsToPresent: [nextNeed.category],
          persistReason: currentNode,
          invariantStatus: 'valid',
          invariantViolations: [],
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
    } else if (turnDecision.routeKind === 'present_existing_shortlist') {
      currentNode = turnDecision.nextNode;
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      const focusCategory = turnDecision.focusNeedCategory;
      planAfterFlow = focusCategory
        ? replaceProviderNeeds(planAfterFlow, planAfterFlow.provider_needs, focusCategory)
        : mergePlan(planAfterFlow, { current_node: currentNode });
      planAfterFlow = mergePlan(planAfterFlow, {
        current_node: currentNode,
      });
      providerResults = turnDecision.presentationScope === 'multi_need'
        ? this.collectPlanProviders(planAfterFlow)
        : getActiveNeed(planAfterFlow)?.recommended_providers ?? [];
      searchStrategy = 'existing_plan_shortlist';
      await persistPlan(planAfterFlow, currentNode);
      planPersisted = true;
      planPersistReason = currentNode;
    } else if (turnDecision.routeKind === 'ask_event_context') {
      currentNode = 'entrevista';
      nodePath.push(currentNode);
      planAfterFlow = mergePlan(mergedPlan, {
        current_node: currentNode,
      });
    } else if (turnDecision.routeKind === 'clarify_missing_fields') {
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
    } else if (turnDecision.routeKind === 'apply_selection') {
      currentNode = 'anadir_a_proveedores_recomendados';
      nodePath.push('usuario_elige_proveedor', currentNode, 'seguir_refinando_guardar_plan');
      currentNode = 'seguir_refinando_guardar_plan';
      turnDecision = turnDecisionSchema.parse({
        ...turnDecision,
        nextNode: currentNode,
        providerSearchMode: 'none',
        presentationScope: 'none',
        persistReason: currentNode,
        invariantStatus: 'valid',
        invariantViolations: [],
      });
      planAfterFlow = mergePlan(planAfterFlow, {
        current_node: currentNode,
      });
      await persistPlan(planAfterFlow, 'seguir_refinando_guardar_plan');
      planPersisted = true;
      planPersistReason = 'seguir_refinando_guardar_plan';
    } else if (turnDecision.routeKind === 'single_need_search') {
        if (turnDecision.focusNeedCategory) {
          planAfterFlow = replaceProviderNeeds(
            planAfterFlow,
            planAfterFlow.provider_needs,
            turnDecision.focusNeedCategory,
          );
        }
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
          const completeFitCriteria = this.completeProviderFitCriteria(
            extraction.providerFitCriteria,
            planAfterFlow,
          );
          providerResults = rankProvidersForCriteria(
            enrichedProviders,
            completeFitCriteria,
          ).filter((provider) =>
            isProviderEligibleForCriteria(provider, completeFitCriteria),
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
            turnDecision = turnDecisionSchema.parse({
              ...turnDecision,
              nextNode: currentNode,
              presentationScope: 'clarification',
              stopReason: 'no_providers_available',
              persistReason: currentNode,
              invariantStatus: 'valid',
              invariantViolations: [],
            });
          } else {
            currentNode = 'recomendar';
            nodePath.push('hay_resultados', currentNode);
            planAfterFlow = mergePlan(planAfterFlow, {
              current_node: currentNode,
            });
            turnDecision = turnDecisionSchema.parse({
              ...turnDecision,
              nextNode: currentNode,
              persistReason: currentNode,
              invariantStatus: 'valid',
              invariantViolations: [],
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
          turnDecision = turnDecisionSchema.parse({
            ...turnDecision,
            nextNode: currentNode,
            routeKind: 'error',
            presentationScope: 'clarification',
            stopReason: errorMessage,
            persistReason: currentNode,
            invariantStatus: 'valid',
            invariantViolations: [],
          });
          await persistPlan(planAfterFlow, currentNode);
          planPersisted = true;
          planPersistReason = currentNode;
        }
    } else {
      currentNode = turnDecision.nextNode;
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      planAfterFlow = mergePlan(planAfterFlow, {
        current_node: currentNode,
      });
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
      extraction,
      missingFields: sufficiency.missingFields,
      searchReady: sufficiency.searchReady,
      providerResults,
      errorMessage,
      promptBundleId: promptBundle.id,
      promptFilePaths: promptBundle.filePaths,
      toolUsage,
      turnDecision,
      invitedEventLookupResult,
    });
    tokenUsage.reply = reply.tokenUsage ?? null;
    tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
    const recommendationFunnel = this.resolveRecommendationFunnel(
      reply.recommendationFunnel ?? null,
      providerResults,
    );
    timingMs.compose_reply += Date.now() - composeReplyStartedAt;

    await persistPlan(planAfterFlow, planPersistReason ?? currentNode);
    await this.saveSessionFocusFromTurn({
      inbound,
      plan: planAfterFlow,
      currentNode,
      providerResults,
    });
    timingMs.total = Date.now() - handleTurnStartedAt;

    return {
      plan: planAfterFlow,
      outbound: this.renderOutbound(reply, providerResults, inbound.channel, planAfterFlow.conversation_id),
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
        turnDecision,
        sessionFocusUsed: Boolean(sessionFocus),
        sessionFocusKeyPresent: Boolean(inbound.sessionId),
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

  private async resolveInvitedEventAuthentication(args: {
    plan: PlanSnapshot;
    userMessage: string;
    toolUsage: ToolUsage;
  }): Promise<{
    plan: PlanSnapshot;
    message: string | null;
    lookupResult: UserEventLookupResult | null;
  }> {
    const email = this.resolveGuestAuthEmail(args.plan, args.userMessage);
    if (!email) {
      return {
        plan: this.resetGuestAuth(args.plan, null),
        message: 'Pide el correo con el que está registrado o asociado a eventos en Sin Envolturas para poder consultarlos.',
        lookupResult: null,
      };
    }

    if (!this.isValidEmail(email)) {
      return {
        plan: this.resetGuestAuth(args.plan, null),
        message: 'El correo no parece válido. Pide que lo envíe completo para consultar sus eventos.',
        lookupResult: null,
      };
    }

    const planForEmail =
      args.plan.guest_auth.email === email
        ? args.plan
        : this.resetGuestAuth(args.plan, email);

    if (this.hasValidGuestAuthToken(planForEmail)) {
      const lookup = await this.lookupAuthenticatedGuestWithTrace(
        planForEmail.guest_auth.token ?? '',
        email,
        args.toolUsage,
      );
      if (lookup.ok) {
        return {
          plan: planForEmail,
          message: null,
          lookupResult: lookup.result,
        };
      }
      return {
        plan: this.resetGuestAuth(planForEmail, email, lookup.error),
        message: 'No pude consultar tus eventos con la sesión guardada. Para proteger tu información, necesito validar tu correo nuevamente.',
        lookupResult: null,
      };
    }

    const code = this.extractGuestLoginCode(args.userMessage);
    if (planForEmail.guest_auth.status === 'code_requested' && code) {
      return await this.verifyGuestCode(planForEmail, email, code, args.toolUsage);
    }

    if (planForEmail.guest_auth.status === 'code_requested') {
      return await this.requestGuestCode(planForEmail, email, args.toolUsage, {
        resend: true,
      });
    }

    return await this.requestGuestCode(planForEmail, email, args.toolUsage);
  }

  private resolveGuestAuthEmail(plan: PlanSnapshot, userMessage: string): string | null {
    return (
      (plan.contact_email && this.isValidEmail(plan.contact_email) ? plan.contact_email : null) ??
      this.extractEmailFromText(userMessage) ??
      (this.isValidEmail(plan.external_user_id) ? plan.external_user_id : null) ??
      plan.contact_email
    );
  }

  private extractEmailFromText(text: string): string | null {
    return text.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/iu)?.[0] ?? null;
  }

  private extractGuestLoginCode(text: string): string | null {
    const matches = text.match(/\b[A-Za-z0-9]{4,8}\b/gu) ?? [];
    return matches.find((match) => /\d/u.test(match)) ?? null;
  }

  private hasValidGuestAuthToken(plan: PlanSnapshot): boolean {
    if (plan.guest_auth.status !== 'authenticated' || !plan.guest_auth.token) {
      return false;
    }
    if (!plan.guest_auth.token_expires_at) {
      return true;
    }
    return Date.parse(plan.guest_auth.token_expires_at) > Date.now();
  }

  private resetGuestAuth(
    plan: PlanSnapshot,
    email: string | null,
    lastError: string | null = null,
  ): PlanSnapshot {
    return mergePlan(plan, {
      guest_auth: {
        status: 'none',
        email,
        token: null,
        token_expires_at: null,
        last_error: lastError,
        requested_at: null,
      },
    });
  }

  private async requestGuestCode(
    plan: PlanSnapshot,
    email: string,
    toolUsage: ToolUsage,
    options: { resend?: boolean } = {},
  ): Promise<{
    plan: PlanSnapshot;
    message: string | null;
    lookupResult: UserEventLookupResult | null;
  }> {
    this.recordDeterministicToolInput(toolUsage, 'request_guest_login_code', { email });
    const result = await this.dependencies.providerGateway.requestGuestLoginCode(email);
    this.recordDeterministicToolOutput(toolUsage, 'request_guest_login_code', result);

    if (result.status === 'sent') {
      return {
        plan: mergePlan(plan, {
          contact_email: email,
          guest_auth: {
            status: 'code_requested',
            email,
            token: null,
            token_expires_at: null,
            last_error: null,
            requested_at: new Date().toISOString(),
          },
        }),
        message: options.resend
          ? 'Se reenvió un código al correo. Pide revisar spam o promociones, confirmar que el correo esté bien escrito, o enviar otro correo si quiere cambiarlo.'
          : 'Se envió un código al correo. Pide el código para continuar.',
        lookupResult: null,
      };
    }

    if (result.status === 'email_not_found') {
      return {
        plan: mergePlan(plan, {
          contact_email: email,
          guest_auth: {
            status: 'email_not_found',
            email,
            token: null,
            token_expires_at: null,
            last_error: result.error,
            requested_at: null,
          },
        }),
        message: 'No se encontró ese correo en Sin Envolturas. No pidas código; pide revisar el correo usado para el evento o registro.',
        lookupResult: null,
      };
    }

    return {
      plan: mergePlan(plan, {
        contact_email: email,
        guest_auth: {
          status: 'failed',
          email,
          token: null,
          token_expires_at: null,
          last_error: result.error,
          requested_at: null,
        },
      }),
      message: 'No se pudo enviar el código por ahora. Pide intentar nuevamente en unos minutos.',
      lookupResult: null,
    };
  }

  private async verifyGuestCode(
    plan: PlanSnapshot,
    email: string,
    code: string,
    toolUsage: ToolUsage,
  ): Promise<{
    plan: PlanSnapshot;
    message: string | null;
    lookupResult: UserEventLookupResult | null;
  }> {
    this.recordDeterministicToolInput(toolUsage, 'verify_guest_login_code', {
      email,
      code: '[redacted]',
    });
    const result = await this.dependencies.providerGateway.verifyGuestLoginCode(email, code);
    this.recordDeterministicToolOutput(toolUsage, 'verify_guest_login_code', {
      ...result,
      token: result.status === 'authenticated' ? '[redacted]' : undefined,
    });

    if (result.status !== 'authenticated') {
      return {
        plan: mergePlan(plan, {
          guest_auth: {
            ...plan.guest_auth,
            status: 'code_requested',
            token: null,
            token_expires_at: null,
            last_error: result.error,
          },
        }),
        message: 'El código no pudo validarse. Pide revisar el código o solicitar otro correo si corresponde.',
        lookupResult: null,
      };
    }

    const authenticatedPlan = mergePlan(plan, {
      contact_email: email,
      guest_auth: {
        status: 'authenticated',
        email,
        token: result.token,
        token_expires_at: result.tokenExpiresAt,
        last_error: null,
        requested_at: plan.guest_auth.requested_at,
      },
    });
    const lookup = await this.lookupAuthenticatedGuestWithTrace(result.token, email, toolUsage);
    if (lookup.ok) {
      return {
        plan: authenticatedPlan,
        message: null,
        lookupResult: lookup.result,
      };
    }

    return {
      plan: this.resetGuestAuth(authenticatedPlan, email, lookup.error),
      message: 'La sesión no pudo consultar eventos. Pide volver a validar el correo para continuar.',
      lookupResult: null,
    };
  }

  private async lookupAuthenticatedGuestWithTrace(
    token: string,
    email: string,
    toolUsage: ToolUsage,
  ): Promise<
    | { ok: true; result: UserEventLookupResult | null }
    | { ok: false; error: string }
  > {
    this.recordDeterministicToolInput(toolUsage, 'lookup_authenticated_guest', {
      email,
      authorization: 'Bearer [redacted]',
    });
    try {
      const result = await this.dependencies.providerGateway.lookupAuthenticatedGuest({
        token,
        email,
      });
      this.recordDeterministicToolOutput(toolUsage, 'lookup_authenticated_guest', result);
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordDeterministicToolOutput(toolUsage, 'lookup_authenticated_guest', {
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  private recordDeterministicToolInput(
    toolUsage: ToolUsage,
    tool: string,
    input: Record<string, unknown>,
  ): void {
    if (!toolUsage.considered.includes(tool)) {
      toolUsage.considered.push(tool);
    }
    toolUsage.inputs.push({
      tool,
      input: JSON.stringify(input, null, 2),
    });
  }

  private recordDeterministicToolOutput(
    toolUsage: ToolUsage,
    tool: string,
    output: unknown,
  ): void {
    if (!toolUsage.called.includes(tool)) {
      toolUsage.called.push(tool);
    }
    toolUsage.outputs.push({
      tool,
      output: JSON.stringify(output, null, 2),
    });
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

  private buildDecisionEvidence(args: {
    previousNode: DecisionNode;
    extraction: ExtractionResult;
    planBefore: PlanSnapshot;
    planAfterReduction: PlanSnapshot;
    sessionFocus: SessionFocus | null;
    sufficiency: { searchReady: boolean; missingFields: string[] };
    sufficiencyByNeed: NeedSufficiency[];
    hasResolvedSelection: boolean;
    hasAmbiguousSelection: boolean;
    hasReplaceProviderOperation: boolean;
  }): DecisionEvidence {
    const focusedNeedCategory =
      args.extraction.activeNeedCategory ??
      args.extraction.vendorCategory ??
      (args.sessionFocus ? args.sessionFocus.activeNeedCategory : null);
    const readyNeedCategories = this.resolveReadyNeedCategories(
      args.extraction,
      args.planAfterReduction,
      args.sufficiencyByNeed,
      args.sessionFocus,
    );

    return decisionEvidenceSchema.parse({
      previousNode: args.previousNode,
      extractionIntent: args.extraction.intent,
      explicitNeedCategoryCount: this.countExplicitNeedCategories(args.extraction),
      extractionProviderQueryIntentCount: args.extraction.providerQueryIntents?.length ?? 0,
      extractionProviderPlanOperationCount: args.extraction.providerPlanOperations?.length ?? 0,
      broadProviderMenuRequested: this.isBroadProviderMenuRequest(args.extraction),
      planBeforeNode: args.planBefore.current_node,
      planAfterNode: args.planAfterReduction.current_node,
      providerNeedCount: args.planAfterReduction.provider_needs.length,
      readyNeedCategories,
      focusedNeedCategory,
      sessionFocus: args.sessionFocus,
      globalMissingFields: args.sufficiency.missingFields,
      sufficiencyByNeed: args.sufficiencyByNeed,
      hasResolvedSelection: args.hasResolvedSelection,
      hasAmbiguousSelection: args.hasAmbiguousSelection,
      hasExistingShortlist: args.planAfterReduction.provider_needs.some(
        (need) => need.recommended_providers.length > 0,
      ),
      hasReplaceProviderOperation: args.hasReplaceProviderOperation,
    });
  }

  private decideNextTurn(evidence: DecisionEvidence): TurnDecision {
    let decision: Omit<TurnDecision, 'invariantStatus' | 'invariantViolations'>;

    if (evidence.extractionIntent === 'pausar') {
      decision = {
        nextNode: 'guardar_cerrar_temporalmente',
        routeKind: 'pause',
        providerSearchMode: 'none',
        presentationScope: 'none',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: null,
        persistReason: 'guardar_cerrar_temporalmente',
      };
    } else if (evidence.extractionIntent === 'consultar_faq') {
      decision = {
        nextNode: 'consultar_faq',
        routeKind: 'faq',
        providerSearchMode: 'none',
        presentationScope: 'faq',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: null,
        persistReason: 'consultar_faq',
      };
    } else if (evidence.extractionIntent === 'consultar_evento_invitado') {
      decision = {
        nextNode: 'consultar_evento_invitado',
        routeKind: 'invited_event_lookup',
        providerSearchMode: 'none',
        presentationScope: 'invited_event_lookup',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: null,
        persistReason: 'consultar_evento_invitado',
      };
    } else if (evidence.extractionIntent === 'cerrar') {
      decision = {
        nextNode: 'crear_lead_cerrar',
        routeKind: 'close',
        providerSearchMode: 'none',
        presentationScope: 'close',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: evidence.sufficiencyByNeed
          .filter((need) => need.hasShortlist)
          .map((need) => need.category),
        stopReason: null,
        persistReason: 'crear_lead_cerrar',
      };
    } else if (evidence.providerNeedCount === 0) {
      decision = {
        nextNode: 'entrevista',
        routeKind: 'ask_event_context',
        providerSearchMode: 'none',
        presentationScope: 'clarification',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: 'no_provider_need_identified',
        persistReason: 'entrevista',
      };
    } else if (
      evidence.hasResolvedSelection &&
      !evidence.hasReplaceProviderOperation
    ) {
      decision = {
        nextNode: 'seguir_refinando_guardar_plan',
        routeKind: 'apply_selection',
        providerSearchMode: 'none',
        presentationScope: 'none',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: null,
        persistReason: 'seguir_refinando_guardar_plan',
      };
    } else if (
      evidence.extractionProviderPlanOperationCount > 0 ||
      evidence.extractionIntent === 'explicar_recomendacion'
    ) {
      decision = {
        nextNode: 'seguir_refinando_guardar_plan',
        routeKind: 'modify_plan',
        providerSearchMode: 'none',
        presentationScope: 'clarification',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: null,
        persistReason: 'seguir_refinando_guardar_plan',
      };
    } else if (
      evidence.readyNeedCategories.length > 1 &&
      (
        evidence.extractionIntent === 'elicitar_necesidades' ||
        evidence.extractionIntent === 'buscar_proveedores'
      )
    ) {
      decision = {
        nextNode: 'elicitacion_necesidades',
        routeKind: 'multi_need_search',
        providerSearchMode: 'multi_need_query_intents',
        presentationScope: 'multi_need',
        focusNeedCategory: evidence.readyNeedCategories[0] ?? evidence.focusedNeedCategory,
        needsToSearch: evidence.readyNeedCategories,
        needsToPresent: evidence.readyNeedCategories,
        stopReason: null,
        persistReason: 'elicitacion_necesidades',
      };
    } else if (
      evidence.extractionIntent === 'elicitar_necesidades' ||
      (
        evidence.extractionIntent === 'buscar_proveedores' &&
        evidence.broadProviderMenuRequested
      )
    ) {
      const needsToPresent = evidence.sufficiencyByNeed.map((need) => need.category);
      decision = {
        nextNode: 'elicitacion_necesidades',
        routeKind: 'ask_event_context',
        providerSearchMode: 'none',
        presentationScope: 'multi_need',
        focusNeedCategory: evidence.focusedNeedCategory ?? needsToPresent[0] ?? null,
        needsToSearch: [],
        needsToPresent,
        stopReason: needsToPresent.length > 0 ? 'need_priority_confirmation' : 'insufficient_need_detail',
        persistReason: 'elicitacion_necesidades',
      };
    } else if (
      evidence.hasExistingShortlist &&
      (
        evidence.extractionIntent === 'ver_opciones' ||
        evidence.extractionIntent === 'explicar_recomendacion' ||
        evidence.extractionIntent === 'detallar_proveedor'
      )
    ) {
      const needsToPresent = evidence.sufficiencyByNeed
        .filter((need) => need.hasShortlist)
        .map((need) => need.category);
      decision = {
        nextNode: needsToPresent.length > 1 ? 'elicitacion_necesidades' : 'recomendar',
        routeKind: 'present_existing_shortlist',
        providerSearchMode: 'existing_shortlist',
        presentationScope: needsToPresent.length > 1 ? 'multi_need' : 'single_need',
        focusNeedCategory: evidence.focusedNeedCategory ?? needsToPresent[0] ?? null,
        needsToSearch: [],
        needsToPresent,
        stopReason: null,
        persistReason: needsToPresent.length > 1 ? 'elicitacion_necesidades' : 'recomendar',
      };
    } else if (evidence.readyNeedCategories.length === 1 && evidence.focusedNeedCategory !== null) {
      decision = {
        nextNode: 'recomendar',
        routeKind: 'single_need_search',
        providerSearchMode: 'single_need_from_plan',
        presentationScope: 'single_need',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: evidence.readyNeedCategories,
        needsToPresent: evidence.readyNeedCategories,
        stopReason: null,
        persistReason: 'recomendar',
      };
    } else if (evidence.globalMissingFields.length > 0) {
      decision = {
        nextNode: 'aclarar_pedir_faltante',
        routeKind: 'clarify_missing_fields',
        providerSearchMode: 'none',
        presentationScope: 'clarification',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: evidence.globalMissingFields.join(', '),
        persistReason: 'aclarar_pedir_faltante',
      };
    } else {
      decision = {
        nextNode: 'entrevista',
        routeKind: 'ask_event_context',
        providerSearchMode: 'none',
        presentationScope: 'clarification',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: 'insufficient_reachable_transition',
        persistReason: 'entrevista',
      };
    }

    return turnDecisionSchema.parse({
      ...decision,
      ...this.validateTurnDecisionInvariants(evidence, decision),
    });
  }

  private countExplicitNeedCategories(extraction: ExtractionResult): number {
    return new Set(
      [
        extraction.activeNeedCategory,
        extraction.vendorCategory,
        ...extraction.vendorCategories,
      ].filter((category): category is ProviderCategory => Boolean(category)),
    ).size;
  }

  private isBroadProviderMenuRequest(extraction: ExtractionResult): boolean {
    return (
      extraction.intent === 'buscar_proveedores' &&
      this.countExplicitNeedCategories(extraction) > 1 &&
      (extraction.providerQueryIntents ?? []).length === 0 &&
      extraction.budgetSignal === 'medio' &&
      (extraction.hardConstraints?.length ?? 0) === 0 &&
      (extraction.preferences?.length ?? 0) < 3
    );
  }

  private resolveReadyNeedCategories(
    extraction: ExtractionResult,
    plan: PlanSnapshot,
    sufficiencyByNeed: NeedSufficiency[],
    sessionFocus: SessionFocus | null,
  ): ProviderCategory[] {
    const readyByPlan = new Set(
      sufficiencyByNeed
        .filter((need) => need.searchReady)
        .map((need) => need.category),
    );
    const readyFromQueryIntents = (extraction.providerQueryIntents ?? [])
      .filter((queryIntent) => this.isStructuredQueryIntentRetrievalReady(queryIntent, extraction))
      .map((queryIntent) => queryIntent.category);
    if (readyFromQueryIntents.length > 0) {
      return Array.from(
        new Set(readyFromQueryIntents.filter((category) => readyByPlan.has(category))),
      );
    }

    const focusedCategory = extraction.activeNeedCategory ?? extraction.vendorCategory;
    if (
      focusedCategory &&
      readyByPlan.has(focusedCategory) &&
      (
        extraction.intent === 'buscar_proveedores' ||
        extraction.intent === 'confirmar_proveedor' ||
        extraction.intent === 'refinar_busqueda'
      )
    ) {
      return plan.provider_needs.some((need) => need.category === focusedCategory)
        ? [focusedCategory]
        : [];
    }

    const sessionFocusCategory = sessionFocus?.activeNeedCategory ?? null;
    if (
      sessionFocusCategory &&
      readyByPlan.has(sessionFocusCategory) &&
      (
        extraction.intent === 'buscar_proveedores' ||
        extraction.intent === 'refinar_busqueda'
      )
    ) {
      return plan.provider_needs.some((need) => need.category === sessionFocusCategory)
        ? [sessionFocusCategory]
        : [];
    }

    return plan.provider_needs
      .filter((need) => readyByPlan.has(need.category))
      .map((need) => need.category);
  }

  private validateTurnDecisionInvariants(
    evidence: DecisionEvidence,
    decision: Omit<TurnDecision, 'invariantStatus' | 'invariantViolations'>,
  ): Pick<TurnDecision, 'invariantStatus' | 'invariantViolations'> {
    const violations: string[] = [];

    if (
      evidence.extractionProviderQueryIntentCount > 1 &&
      decision.providerSearchMode === 'single_need_from_plan' &&
      decision.needsToSearch.length !== 1
    ) {
      violations.push('single_need_search_requires_exactly_one_need');
    }

    if (
      decision.providerSearchMode === 'multi_need_query_intents' &&
      decision.presentationScope !== 'multi_need'
    ) {
      violations.push('multi_need_search_requires_multi_need_presentation');
    }

    if (
      decision.routeKind === 'multi_need_search' &&
      decision.nextNode !== 'elicitacion_necesidades'
    ) {
      violations.push('multi_need_search_must_reach_elicitacion_necesidades');
    }

    return {
      invariantStatus: violations.length === 0 ? 'valid' : 'invalid',
      invariantViolations: violations,
    };
  }

  private fallbackTurnDecision(args: {
    currentNode: DecisionNode;
    searchStrategy: SearchStrategyTrace;
    providerResults: ProviderSummary[];
    focusNeedCategory: ProviderCategory | null;
  }): TurnDecision {
    const presentationScope =
      args.currentNode === 'consultar_faq'
        ? 'faq'
        : args.currentNode === 'consultar_evento_invitado'
          ? 'invited_event_lookup'
        : args.currentNode === 'crear_lead_cerrar'
          ? 'close'
          : args.currentNode === 'elicitacion_necesidades'
            ? 'multi_need'
            : args.currentNode === 'recomendar'
              ? 'single_need'
              : 'none';
    const providerSearchMode =
      args.searchStrategy === 'multi_need_query_intents'
        ? 'multi_need_query_intents'
        : args.searchStrategy === 'existing_plan_shortlist'
          ? 'existing_shortlist'
          : args.searchStrategy === 'search_from_plan'
            ? 'single_need_from_plan'
            : 'none';

    return turnDecisionSchema.parse({
      nextNode: args.currentNode,
      routeKind: args.currentNode === 'consultar_faq'
        ? 'faq'
        : args.currentNode === 'consultar_evento_invitado'
          ? 'invited_event_lookup'
        : args.currentNode === 'crear_lead_cerrar'
          ? 'close'
          : args.currentNode === 'guardar_cerrar_temporalmente'
            ? 'pause'
            : args.currentNode === 'informar_error_reintento'
              ? 'error'
              : providerSearchMode === 'multi_need_query_intents'
                ? 'multi_need_search'
                : providerSearchMode === 'single_need_from_plan'
                  ? 'single_need_search'
                  : 'ask_event_context',
      providerSearchMode,
      presentationScope,
      focusNeedCategory: args.focusNeedCategory,
      needsToSearch: args.focusNeedCategory ? [args.focusNeedCategory] : [],
      needsToPresent: Array.from(new Set(args.providerResults
        .map((provider) => this.normalizeCategoryValue(provider.category ?? null))
        .filter((category): category is ProviderCategory => Boolean(category)))),
      stopReason: null,
      persistReason: args.currentNode,
      invariantStatus: 'valid',
      invariantViolations: [],
    });
  }

  private async saveSessionFocusFromTurn(args: {
    inbound: NormalizedInboundMessage;
    plan: PlanSnapshot;
    currentNode: DecisionNode;
    providerResults: ProviderSummary[];
  }): Promise<void> {
    if (!args.inbound.sessionId || !this.dependencies.planStore.saveSessionFocus) {
      return;
    }

    const lastPresentedCategories = Array.from(new Set(args.providerResults
      .map((provider) => this.normalizeCategoryValue(provider.category ?? null))
      .filter((category): category is ProviderCategory => Boolean(category))));

    await this.dependencies.planStore.saveSessionFocus(
      args.inbound.channel,
      args.inbound.externalUserId,
      {
        sessionId: args.inbound.sessionId,
        activeNeedCategory: args.plan.active_need_category,
        lastPresentedCategories,
        lastPresentedProviderIds: args.providerResults.map((provider) => provider.id),
        lastNode: args.currentNode,
        updatedAt: new Date().toISOString(),
      },
    );
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
    turnDecision?: TurnDecision;
    sessionFocusUsed?: boolean;
    sessionFocusKeyPresent?: boolean;
    operationalNote: string | null;
  }): TurnTrace {
    const contactValidationSummary = this.summarizeContactValidation(args.extraction, args.plan);
    const turnDecision = args.turnDecision ?? this.fallbackTurnDecision({
      currentNode: args.currentNode,
      searchStrategy: args.searchStrategy,
      providerResults: args.providerResults,
      focusNeedCategory: args.plan.active_need_category,
    });
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
      turn_decision: turnDecision,
      route_kind: turnDecision.routeKind,
      presentation_scope: turnDecision.presentationScope,
      session_focus_used: args.sessionFocusUsed ?? false,
      session_focus_key_present: args.sessionFocusKeyPresent ?? false,
      state_machine_invariant_status: turnDecision.invariantStatus,
      state_machine_invariant_violations: turnDecision.invariantViolations,
      operational_note: args.operationalNote,
      extraction_summary: this.summarizeExtraction(args.extraction, contactValidationSummary),
      plan_summary: this.summarizePlan(args.plan, contactValidationSummary),
      close_action_summary: this.summarizeCloseAction(args.extraction),
      selection_resolution_summary: this.summarizeSelectionResolution(args.extraction),
      contact_validation_summary: contactValidationSummary,
      provider_candidate_audit: this.summarizeProviderCandidateAudit(args.providerResults),
      faq_resolution_summary: this.summarizeFaqResolution(args.currentNode, args.extraction, args.toolUsage),
      plan_persisted: args.planPersisted,
      plan_persist_reason: args.planPersistReason,
      timing_ms: args.timingMs,
      token_usage: args.tokenUsage,
    };
  }

  private summarizeExtraction(
    extraction: ExtractionResult,
    contactValidationSummary: ContactValidationDebugSummary,
  ): ExtractionDebugSummary {
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
      contact_validation_error: contactValidationSummary.reason_preview,
    };
  }

  private summarizePlan(
    plan: PlanSnapshot,
    contactValidationSummary: ContactValidationDebugSummary,
  ): PlanDebugSummary {
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
      contact_validation_error: contactValidationSummary.reason_preview,
    };
  }

  private summarizeCloseAction(extraction: ExtractionResult): CloseActionDebugSummary {
    const closeAction = extraction.closeAction ?? null;
    if (!closeAction) {
      return {
        type: null,
        category: null,
        reason_preview: null,
      };
    }

    return {
      type: closeAction.type,
      category: closeAction.type === 'defer_need' ? closeAction.category ?? null : null,
      reason_preview: closeAction.type === 'clarify'
        ? this.truncateDebugText(closeAction.reason ?? '', 160)
        : null,
    };
  }

  private summarizeSelectionResolution(extraction: ExtractionResult): SelectionResolutionDebugSummary {
    const operations = extraction.providerPlanOperations ?? [];
    return {
      selected_provider_references: (extraction.selectedProviderReferences ?? []).map((reference) => ({
        provider_id: reference.providerId,
        category: reference.category,
        has_title: reference.providerTitle !== null,
        has_hint: reference.hint !== null,
      })),
      selected_provider_hints_count: extraction.selectedProviderHints.length,
      provider_plan_operation_types: operations.map((operation) => operation.type),
      provider_plan_operation_categories: operations
        .map((operation) => operation.category)
        .filter((category): category is ProviderCategory => category !== null),
    };
  }

  private summarizeContactValidation(
    extraction: ExtractionResult,
    plan: PlanSnapshot,
  ): ContactValidationDebugSummary {
    const extractionFieldsPresent = {
      name: Boolean(extraction.contactName),
      email: Boolean(extraction.contactEmail),
      phone: Boolean(extraction.contactPhone),
    };
    const planFieldsPresent = {
      name: Boolean(plan.contact_name),
      email: Boolean(plan.contact_email),
      phone: Boolean(plan.contact_phone),
    };

    const extractionPhoneError = this.describePhoneValidationError(extraction.contactPhone);
    if (
      extractionPhoneError !== null &&
      (plan.contact_phone === null || !this.isValidPhone(plan.contact_phone))
    ) {
      return {
        status: 'invalid',
        field: 'phone',
        reason_preview: extractionPhoneError,
        extraction_contact_fields_present: extractionFieldsPresent,
        plan_contact_fields_present: planFieldsPresent,
      };
    }

    if (extraction.contactEmail !== null && !this.isValidEmail(extraction.contactEmail)) {
      return {
        status: 'invalid',
        field: 'email',
        reason_preview: 'El correo electrónico no parece válido.',
        extraction_contact_fields_present: extractionFieldsPresent,
        plan_contact_fields_present: planFieldsPresent,
      };
    }

    if (plan.contact_phone !== null && !this.isValidPhone(plan.contact_phone)) {
      return {
        status: 'invalid',
        field: 'phone',
        reason_preview: 'El teléfono debe incluir código de país y número completo, por ejemplo +51 954779067.',
        extraction_contact_fields_present: extractionFieldsPresent,
        plan_contact_fields_present: planFieldsPresent,
      };
    }

    if (plan.contact_email !== null && !this.isValidEmail(plan.contact_email)) {
      return {
        status: 'invalid',
        field: 'email',
        reason_preview: 'El correo electrónico no parece válido.',
        extraction_contact_fields_present: extractionFieldsPresent,
        plan_contact_fields_present: planFieldsPresent,
      };
    }

    const hasContactSignal = Object.values(extractionFieldsPresent).some(Boolean) ||
      Object.values(planFieldsPresent).some(Boolean);
    return {
      status: hasContactSignal ? 'valid' : 'not_provided',
      field: null,
      reason_preview: null,
      extraction_contact_fields_present: extractionFieldsPresent,
      plan_contact_fields_present: planFieldsPresent,
    };
  }

  private summarizeProviderCandidateAudit(
    providerResults: ProviderSummary[],
  ): ProviderCandidateAuditEntry[] {
    return providerResults.map((provider) => ({
      provider_id: provider.id,
      category: provider.category ?? null,
      location: provider.location ?? null,
      retrieval_source: provider.retrievalSource ?? null,
      retrieval_score: provider.retrievalScore ?? null,
      fit_score: provider.fitScore ?? null,
    }));
  }

  private summarizeFaqResolution(
    currentNode: DecisionNode,
    extraction: ExtractionResult,
    toolUsage: ToolUsage,
  ): FaqResolutionDebugSummary {
    const fileSearchToolNames = new Set(['file_search', 'hosted_file_search']);
    return {
      is_faq_turn: currentNode === 'consultar_faq',
      kb_query_present: Boolean(extraction.kbQuery),
      file_search_called: toolUsage.called.some((toolName) => fileSearchToolNames.has(toolName)),
      file_search_output_count: toolUsage.outputs.filter((output) => fileSearchToolNames.has(output.tool)).length,
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

    if (extraction.intent === 'consultar_evento_invitado') {
      return 'consultar_evento_invitado';
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
    const inferredPhoneCandidate = this.extractContactPhoneCandidate(userMessage);
    const inferredPhone = this.normalizePhone(inferredPhoneCandidate);
    const nextPhone =
      normalizedExtractorPhone ??
      inferredPhone ??
      normalizedChannelPhone ??
      plan.contact_phone;
    const phoneValidationError =
      normalizedExtractorPhone || inferredPhone || normalizedChannelPhone
        ? null
        : this.describePhoneValidationError(guardedExtraction.contactPhone) ??
          this.describePhoneValidationError(inferredPhoneCandidate);

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

    const validationError = phoneValidationError ?? this.validateContactFields(merged, plan);
    if (validationError) {
      // Revert invalid fields to previous plan values so we don't persist garbage
      const reverted = mergePlan(merged, {
        contact_phone: phoneValidationError
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

  private guardGenericElicitation(extraction: ExtractionResult): ExtractionResult {
    if (extraction.intent !== 'elicitar_necesidades') {
      return extraction;
    }
    if (this.hasStructuredPlanningSignal(extraction)) {
      return extraction;
    }

    return {
      ...extraction,
      intent: null,
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: null,
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
    };
  }

  private guardInvitedEventFollowUp(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): ExtractionResult {
    if (plan.current_node !== 'consultar_evento_invitado') {
      return extraction;
    }

    const explicitModeSwitchIntents = new Set([
      'elicitar_necesidades',
      'buscar_proveedores',
      'refinar_busqueda',
      'ver_opciones',
      'confirmar_proveedor',
      'modificar_plan_proveedores',
      'retomar_plan',
      'cerrar',
      'pausar',
      'consultar_faq',
      'consultar_evento_invitado',
    ]);
    if (extraction.intent && explicitModeSwitchIntents.has(extraction.intent)) {
      return extraction;
    }

    const hasProviderContext =
      plan.provider_needs.length > 0 ||
      plan.recommended_providers.length > 0 ||
      plan.recommended_provider_ids.length > 0;
    if (
      hasProviderContext &&
      (
        extraction.intent === 'detallar_proveedor' ||
        extraction.intent === 'explicar_recomendacion'
      )
    ) {
      return extraction;
    }

    return {
      ...extraction,
      intent: 'consultar_evento_invitado',
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: null,
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
    };
  }

  private hasStructuredPlanningSignal(extraction: ExtractionResult): boolean {
    return (
      (extraction.eventType !== null && extraction.eventType !== 'otro') ||
      extraction.location !== null ||
      extraction.budgetSignal !== null ||
      (extraction.guestRange !== null && extraction.guestRange !== 'unknown') ||
      extraction.vendorCategory !== null ||
      extraction.activeNeedCategory !== null ||
      extraction.preferences.length > 0 ||
      extraction.hardConstraints.length > 0 ||
      (extraction.providerQueryIntents ?? []).some(
        (queryIntent) =>
          queryIntent.preferences.length > 0 ||
          queryIntent.hardConstraints.length > 0,
      )
    );
  }

  private applyProviderPlanOperations(
    plan: PlanSnapshot,
    operations: ProviderPlanOperation[],
    options: { deferShortlistedDeletes: boolean } = { deferShortlistedDeletes: false },
  ): {
    plan: PlanSnapshot;
    unresolvedMessage: string | null;
    appliedOperations: ProviderPlanOperation[];
  } {
    const normalizedOperations = this.dropSelectionShadowedReplaceOperations(plan, operations);
    if (normalizedOperations.length === 0) {
      return { plan, unresolvedMessage: null, appliedOperations: [] };
    }

    let nextPlan = plan;
    const appliedOperations: ProviderPlanOperation[] = [];
    for (const operation of normalizedOperations) {
      const result = this.applyProviderPlanOperation(nextPlan, operation, options);
      if (!result.applied) {
        return { plan: nextPlan, unresolvedMessage: result.message, appliedOperations };
      }
      nextPlan = result.plan;
      appliedOperations.push(operation);
    }

    return { plan: nextPlan, unresolvedMessage: null, appliedOperations };
  }

  private dropSelectionShadowedReplaceOperations(
    plan: PlanSnapshot,
    operations: ProviderPlanOperation[],
  ): ProviderPlanOperation[] {
    const selectCategories = new Set(
      operations
        .filter((operation) => operation.type === 'select_provider')
        .map((operation) => operation.category ?? operation.provider?.category ?? null)
        .filter((category): category is ProviderCategory => Boolean(category)),
    );

    if (selectCategories.size === 0) {
      return operations;
    }

    return operations.filter((operation) => {
      if (operation.type !== 'replace_provider') {
        return true;
      }
      const category = operation.category ?? operation.addProvider?.category ?? null;
      if (!category || !selectCategories.has(category)) {
        return true;
      }
      const existingNeed = this.findNeedByCategory(plan, category);
      return (existingNeed?.selected_provider_ids.length ?? 0) > 0;
    });
  }

  private applyProviderPlanOperation(
    plan: PlanSnapshot,
    operation: ProviderPlanOperation,
    options: { deferShortlistedDeletes: boolean },
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
          sub_query_results: existing?.sub_query_results ?? [],
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
        const existing = this.findNeedByCategory(plan, operation.category);
        if (
          options.deferShortlistedDeletes &&
          existing?.status === 'shortlisted' &&
          existing.selected_provider_ids.length === 0
        ) {
          return {
            applied: true,
            plan: this.upsertProviderNeed(
              plan,
              {
                ...existing,
                status: 'deferred',
                selected_provider_ids: [],
                selected_provider_hints: [],
              },
              operation.category,
            ),
          };
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
    selectedProviderReferences: ProviderReference[],
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

    const referenceSelections = selectedProviderReferences.flatMap((reference) =>
      this.resolveProviderReferenceSelection(plan, reference),
    );

    const selections = referenceSelections.length > 0
      ? referenceSelections
      : selectedProviderHints.length > 0
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

  private resolveProviderReferenceSelection(
    plan: PlanSnapshot,
    reference: ProviderReference,
  ): ProviderSelectionMatch[] {
    const resolved = this.resolveProviderReference(
      plan,
      reference,
      reference.category,
    );
    if (!resolved) {
      return [];
    }
    return [
      {
        selectedNeed: resolved.need,
        selectedProvider: resolved.provider,
        hint: resolved.provider.title,
      },
    ];
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
            sub_query_results: carryExistingNeed?.sub_query_results ?? [],
            selected_provider_ids: carryExistingNeed?.selected_provider_ids ?? [],
            selected_provider_hints: carryExistingNeed?.selected_provider_hints ?? [],
          } satisfies ProviderNeed;
        }

        const subQueries = this.resolveProviderSubQueries(queryIntent);
        const subQueryResults = await Promise.all(
          subQueries.map(async (subQuery) => {
            args.toolUsage.considered.push('search_providers_by_query_intent');
            args.toolUsage.inputs.push({
              tool: 'search_providers_by_query_intent',
              input: JSON.stringify(
                {
                  category: subQuery.category,
                  label: subQuery.label,
                  queryStrings: subQuery.queryStrings,
                  location: args.plan.location,
                },
                null,
                2,
              ),
            });
            const providerSearchStartedAt = Date.now();
            const fitCriteria = createSubQueryFitCriteria({
              baseCriteria: this.completeProviderFitCriteria(
                queryIntent.fitCriteria,
                args.plan,
              ),
              subQuery,
            });
            const searchResult = await this.dependencies.providerGateway.searchProvidersByQueryIntent({
              category: subQuery.category,
              queryStrings: subQuery.queryStrings,
              location: args.plan.location,
              fitCriteria,
            });
            args.timingMs.provider_search += Date.now() - providerSearchStartedAt;
            args.toolUsage.called.push('search_providers_by_query_intent');
            args.toolUsage.outputs.push({
              tool: 'search_providers_by_query_intent',
              output: JSON.stringify({
                label: subQuery.label,
                providers: searchResult.providers.map((provider) => ({
                  id: provider.id,
                  title: provider.title,
                  category: provider.category,
                  retrievalScore: provider.retrievalScore ?? null,
                })),
              }, null, 2),
            });

            const providerEnrichmentStartedAt = Date.now();
            const enriched = await this.enrichProviders(searchResult.providers);
            const result = selectProvidersForSubQuery({
              subQuery,
              providers: enriched,
              baseCriteria: this.completeProviderFitCriteria(
                queryIntent.fitCriteria,
                args.plan,
              ),
            });
            args.timingMs.provider_enrichment += Date.now() - providerEnrichmentStartedAt;
            return result;
          }),
        );
        const ranked = this.collectSelectedProvidersFromSubQueries(subQueryResults);

        return {
          category: queryIntent.category,
          status: ranked.length > 0 ? 'shortlisted' : 'no_providers_available',
          preferences: queryIntent.preferences,
          hard_constraints: queryIntent.hardConstraints,
          missing_fields: [],
          recommended_provider_ids: ranked.map((provider) => provider.id),
          recommended_providers: ranked,
          sub_query_results: subQueryResults,
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

  private resolveProviderSubQueries(
    queryIntent: ProviderQueryIntent,
  ): ProviderNeedSubQuery[] {
    return queryIntent.queries.slice(0, MAX_PROVIDER_QUERIES_PER_NEED);
  }

  private collectSelectedProvidersFromSubQueries(
    subQueryResults: ProviderSubQueryResult[],
  ): ProviderSummary[] {
    const selectedById = new Map<number, ProviderSummary>();
    for (const result of subQueryResults) {
      for (const selectedId of result.selected_provider_ids) {
        if (selectedById.has(selectedId)) {
          continue;
        }
        const provider = result.candidates.find((candidate) => candidate.id === selectedId);
        if (provider) {
          selectedById.set(selectedId, provider);
        }
      }
    }
    return Array.from(selectedById.values());
  }

  private slugifySubQueryId(label: string): string {
    const normalized = label
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return normalized || 'consulta';
  }

  private labelFromQueryString(category: ProviderCategory, queryString: string): string {
    const normalized = queryString
      .replace(new RegExp(category, 'gi'), '')
      .replace(/\b(en|para|con|de|la|el|los|las|un|una|boda|lima|personas|proveedor(?:es)?)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.length >= 3 ? normalized : queryString;
  }

  private resolveElicitationQueryIntents(
    extraction: ExtractionResult,
  ): ProviderQueryIntent[] {
    const queryIntents = extraction.providerQueryIntents ?? [];

    const allowedCategories = prioritizedProviderCategoriesForEvent(extraction.eventType);
    const extractedExplicitCategories = new Set(
      queryIntents
        .filter((queryIntent) => queryIntent.retrievalReady)
        .map((queryIntent) => queryIntent.category),
    );
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
      const starterCategories = selectStarterProviderCategories({
        eventType: extraction.eventType,
        explicitCategories: [...explicitCategories],
        maxNeeds: MAX_STARTER_NEEDS,
      });
      const rankedByCategory = new Map(
        ranked.map((queryIntent) => [queryIntent.category, queryIntent]),
      );

      return starterCategories.map((category, index) => {
        const queryIntent = rankedByCategory.get(category);
        return {
          category,
          label: queryIntent?.label ?? category,
          priority: index + 1,
          queries: queryIntent?.queries.slice(0, MAX_PROVIDER_QUERIES_PER_NEED) ?? [
            {
              id: this.slugifySubQueryId(category),
              label: category,
              category,
              queryStrings: [`${category} para evento`],
              mustHave: [],
              shouldAvoid: [],
              maxSelections: 1,
              allowCrossCategory: false,
            },
          ],
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

    return ranked.map((queryIntent, index) => ({
      ...queryIntent,
      queries: queryIntent.queries.slice(0, MAX_PROVIDER_QUERIES_PER_NEED),
      retrievalReady: index < MAX_DETAILED_ELICITATION_NEEDS &&
        this.isStructuredQueryIntentRetrievalReady(queryIntent, extraction),
    }));
  }

  private hasDetailedElicitationConcept(extraction: ExtractionResult): boolean {
    if (
      extraction.intent !== 'elicitar_necesidades' &&
      extraction.intent !== 'buscar_proveedores'
    ) {
      return false;
    }

    const queryIntentDetails = new Set(
      (extraction.providerQueryIntents ?? []).flatMap((queryIntent) => [
        ...queryIntent.preferences,
        ...queryIntent.hardConstraints,
        ...queryIntent.queries.flatMap((query) => query.queryStrings),
      ]).map((detail) => detail.trim().toLowerCase()).filter(Boolean),
    );
    const readyNeedCount = (extraction.providerQueryIntents ?? []).filter(
      (queryIntent) => this.isStructuredQueryIntentRetrievalReady(queryIntent, extraction),
    ).length;
    const queryIntentCount = (extraction.providerQueryIntents ?? []).length;
    const multiQueryNeedCount = (extraction.providerQueryIntents ?? []).filter(
      (queryIntent) => queryIntent.queries.length > 1,
    ).length;

    return (
      (extraction.hardConstraints?.length ?? 0) > 0 ||
      (extraction.preferences?.length ?? 0) >= 3 ||
      (multiQueryNeedCount > 0 && queryIntentDetails.size >= 2) ||
      (
        queryIntentCount > 0 &&
        queryIntentCount <= 8 &&
        readyNeedCount >= 2 &&
        queryIntentDetails.size >= 3
      )
    );
  }

  private isStructuredQueryIntentRetrievalReady(
    queryIntent: ProviderQueryIntent,
    extraction: ExtractionResult,
  ): boolean {
    if (queryIntent.retrievalReady) {
      return true;
    }

    const hasQuery = queryIntent.queries.flatMap((query) => query.queryStrings).some(
      (query) => query.trim().length > 0,
    );
    const hasEventScale =
      extraction.location !== null &&
      (
        extraction.budgetSignal !== null ||
        (extraction.guestRange !== null && extraction.guestRange !== 'unknown')
      );

    return hasQuery && hasEventScale;
  }

  private completeProviderFitCriteria(
    criteria: ProviderFitCriteria,
    plan: PlanSnapshot,
  ): ProviderFitCriteria {
    if (criteria.budgetAmount !== null || !plan.budget_signal) {
      return criteria;
    }
    return {
      ...criteria,
      budgetAmount: parseBudgetAmount(plan.budget_signal),
      budgetCurrency:
        criteria.budgetCurrency ?? inferCurrencyFromBudget(plan.budget_signal),
    };
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
    const genericFirstTokens = new Set([
      'baby',
      'bebe',
      'bebes',
      'eventos',
      'fiestas',
      'grupo',
      'servicios',
    ]);
    if (
      firstToken.length >= 3 &&
      !genericFirstTokens.has(firstToken)
    ) {
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
        sub_query_results: currentNeed?.sub_query_results ?? [],
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

  private shouldHandleCloseTurn(
    previousNode: DecisionNode | null,
    extraction: ExtractionResult,
    validationError: string | null,
  ): boolean {
    const hasContactField =
      extraction.contactName !== null ||
      extraction.contactEmail !== null ||
      extraction.contactPhone !== null;
    return (
      previousNode === 'crear_lead_cerrar' &&
      (hasContactField ||
        validationError !== null ||
        extraction.closeAction?.type === 'clarify' ||
        extraction.closeAction?.type === 'confirm_close' ||
        extraction.closeAction?.type === 'request_contact' ||
        extraction.closeAction?.type === 'abandon_plan')
    );
  }

  private isCloseContactFieldTurn(
    previousNode: DecisionNode | null,
    extraction: ExtractionResult,
    validationError: string | null,
  ): boolean {
    if (previousNode !== 'crear_lead_cerrar') {
      return false;
    }

    if (extraction.closeAction?.type === 'confirm_close') {
      return false;
    }

    return (
      validationError !== null ||
      extraction.contactName !== null ||
      extraction.contactEmail !== null ||
      extraction.contactPhone !== null
    );
  }

  // --- Contact field validation & normalization ---

  private readonly SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  /**
   * Normalize a phone number to digits-only international format (E.164 without +).
   * Convention: contact_phone always stores the full international number as digits
   * (e.g. "51954779071" for Peru, "5215551234567" for Mexico).
   * Country code splitting happens at the gateway boundary.
   */
  private normalizePhone(value: string | null | undefined): string | null {
    const parsed = parseInternationalPhone(value);
    return parsed.status === 'valid' ? parsed.digits : null;
  }

  private isValidPhone(digits: string | null): boolean {
    if (!digits) return false;
    const normalizedDigits = digits.replace(/\D/g, '');
    return parseInternationalPhone(`+${normalizedDigits}`).status === 'valid';
  }

  private isValidEmail(value: string | null): boolean {
    if (!value) return false;
    return this.SIMPLE_EMAIL_REGEX.test(value);
  }

  private inferContactPhoneFromMessage(text: string): string | null {
    const candidate = this.extractContactPhoneCandidate(text);
    return this.normalizePhone(candidate);
  }

  private extractContactPhoneCandidate(text: string): string | null {
    const internationalMatch = text.match(/\+\d[\d\s().-]{5,16}\d/u);
    if (internationalMatch) {
      return internationalMatch[0];
    }

    if (!this.messageHasPhoneCue(text)) {
      return null;
    }

    const patterns = [
      /\b\d[\d\s().-]{5,14}\d\b/u,
      /\b\d{6,15}\b/u,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }
    return null;
  }

  private messageHasPhoneCue(text: string): boolean {
    return /\b(?:tel[eé]fono|celular|whatsapp|contacto|fono)\b/iu.test(text);
  }

  private describePhoneValidationError(value: string | null | undefined): string | null {
    if (!value) return null;
    const parsed = parseInternationalPhone(value);
    if (parsed.status === 'valid') {
      return null;
    }
    if (parsed.reason === 'missing_country_code') {
      return 'El teléfono debe incluir código de país, por ejemplo +51 954779067.';
    }
    if (parsed.reason === 'invalid_length') {
      return 'El teléfono está incompleto o tiene demasiados dígitos; envíalo con código de país, por ejemplo +51 954779067.';
    }
    if (parsed.reason === 'unsupported_country_code') {
      return 'El teléfono debe incluir un código de país compatible, por ejemplo +51, +52 o +1.';
    }
    return 'El teléfono no parece válido; envíalo con código de país, por ejemplo +51 954779067.';
  }

  private validateContactFields(plan: PlanSnapshot, previousPlan: PlanSnapshot): string | null {
    const phoneChanged = plan.contact_phone !== previousPlan.contact_phone;
    const emailChanged = plan.contact_email !== previousPlan.contact_email;

    if (phoneChanged && plan.contact_phone !== null && !this.isValidPhone(plan.contact_phone)) {
      return 'El teléfono debe incluir código de país y número completo, por ejemplo +51 954779067.';
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
  ): string[] {
    return extraction.selectedProviderHints;
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

  private renderOutbound(
    reply: { text: string; structuredMessage?: StructuredMessage },
    providerResults: ProviderSummary[],
    channel: string,
    conversationId: string | null,
  ): NormalizedOutboundMessage {
    const structuredMessageKind = reply.structuredMessage?.type ?? null;
    if (reply.structuredMessage) {
      const renderer = this.dependencies.renderers[channel]
        ?? this.dependencies.renderers['whatsapp'];
      if (renderer) {
        return {
          text: this.sanitizeAssistantOutput(renderer.render({
            message: reply.structuredMessage,
            providerResults,
          })),
          conversationId,
          structuredMessageKind,
        };
      }
    }

    return {
      text: this.sanitizeAssistantOutput(reply.text),
      conversationId,
      structuredMessageKind,
    };
  }

  private sanitizeAssistantOutput(value: string): string {
    const sanitized = value
      .replace(/\bfilecite\s+turn\d+\s+file\s+\d+\b/giu, '')
      .replace(/[ \t]{2,}/gu, ' ')
      .replace(/[ \t]+\n/gu, '\n')
      .trim();

    return sanitized.replace(/\.(?=\s*$)/u, '');
  }
}
