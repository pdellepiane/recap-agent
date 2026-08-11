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
  createInformationAuthGuidance,
  type ExtractedInformationRequest,
  type InformationExecutionSummary,
  type InformationSelectionCandidate,
  type InformationTaskResult,
  type PendingInformationRequest,
} from '../core/information';
import {
  createEmptyPlan,
  getActiveNeed,
  isPlanFinished,
  mergePlan,
  replaceProviderNeeds,
  type ConversationHealthState,
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
import type {
  AgentRuntime,
  ComposeReplyResult,
  ExtractionResult,
  ToolUsage,
} from './contracts';
import type { TokenUsage } from './contracts';
import type { OpenAiCallRef } from './contracts';
import { deriveDynamicAgentPolicy } from './dynamic-agent-policy';
import {
  NoopAgentConversationGateway,
  type AgentConversationGateway,
  type AgentGatewayResult,
  type AgentAuthByPhoneResult,
  type AgentMessageLogInput,
  type AgentConversationMessage,
} from './agent-conversation-gateway';
import type {
  MessageResponseClassifier,
  MessageResponseClassifierTrace,
} from './message-response-classifier';
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
import { parseInternationalPhone, splitInternationalPhone } from './phone';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { StructuredMessage } from './structured-message';
import type { PlanStore } from '../storage/plan-store';
import {
  InformationOrchestrator,
  type InformationAuthBlock,
  type InformationAuthentication,
} from './information-orchestrator';
import { NoopKnowledgeRetrievalGateway } from './knowledge-retrieval-gateway';
import {
  buildTurnMessageContext,
  localTurnMessageContext,
  unavailableTurnMessageContext,
  type TurnMessageContext,
} from './turn-message-context';

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

type TurnTiming = {
  total: number;
  load_plan: number;
  response_classification: number;
  prepare_working_plan: number;
  extraction: number;
  apply_extraction: number;
  compute_sufficiency: number;
  information_execution: number;
  provider_search: number;
  provider_enrichment: number;
  prompt_bundle_load: number;
  compose_reply: number;
  save_plan: number;
};

type TurnTokenUsage = {
  classifier: TokenUsage | null;
  extraction: TokenUsage | null;
  reply: TokenUsage | null;
  total: TokenUsage | null;
  openAiCalls: {
    classifier: OpenAiCallRef | null;
    extraction: OpenAiCallRef | null;
    reply: OpenAiCallRef | null;
  };
};

const MAX_BROADEN_SEARCH_PAGES = 5;
const TARGET_BROADEN_UNSEEN_RESULTS = 5;
const MAX_STARTER_NEEDS = 5;
const MAX_DETAILED_ELICITATION_NEEDS = 5;
const MAX_PROVIDER_QUERIES_PER_NEED = 3;

const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export function isFutureIsoTimestamp(value: string | null): boolean {
  if (!value || !isoDateTimePattern.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

export function hasValidUserAuthToken(
  plan: Pick<PlanSnapshot, 'user_auth'>,
): boolean {
  return (
    plan.user_auth.status === 'authenticated' &&
    Boolean(plan.user_auth.token) &&
    isFutureIsoTimestamp(plan.user_auth.token_expires_at)
  );
}

export class AgentService {
  constructor(
    private readonly dependencies: {
      planStore: PlanStore;
      runtime: AgentRuntime;
      providerGateway: ProviderGateway;
      agentConversationGateway?: AgentConversationGateway;
      informationOrchestrator?: InformationOrchestrator;
      responseClassifier?: MessageResponseClassifier;
      promptLoader: PromptLoader;
      renderers: Record<string, MessageRenderer>;
    },
  ) {}

  async handleTurn(
    inbound: NormalizedInboundMessage,
  ): Promise<HandleTurnResponse> {
    return await this.handleTurnCore(inbound);
  }

  private async handleTurnCore(
    inbound: NormalizedInboundMessage,
  ): Promise<HandleTurnResponse> {
    const handleTurnStartedAt = Date.now();
    const toolUsage = {
      considered: [] as string[],
      called: [] as string[],
      inputs: [] as { tool: string; input: string }[],
      outputs: [] as { tool: string; output: string }[],
    };
    const timingMs: TurnTiming = {
      total: 0,
      load_plan: 0,
      response_classification: 0,
      prepare_working_plan: 0,
      extraction: 0,
      apply_extraction: 0,
      compute_sufficiency: 0,
      information_execution: 0,
      provider_search: 0,
      provider_enrichment: 0,
      prompt_bundle_load: 0,
      compose_reply: 0,
      save_plan: 0,
    };
    const tokenUsage: TurnTokenUsage = {
      classifier: null,
      extraction: null,
      reply: null,
      total: null,
      openAiCalls: {
        classifier: null,
        extraction: null,
        reply: null,
      },
    };
    const agentConversationGateway =
      this.dependencies.agentConversationGateway ??
      new NoopAgentConversationGateway('not_configured');
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

    let classifierPlan = existingPlan ?? createEmptyPlan({
      planId: ulid(),
      channel: inbound.channel,
      externalUserId: inbound.externalUserId,
    });
    const normalizedChannelPhone = this.normalizePhone(inbound.contactPhone);
    if (normalizedChannelPhone) {
      const channelPhoneParts = splitInternationalPhone(inbound.contactPhone);
      classifierPlan = mergePlan(classifierPlan, {
        contact_phone: normalizedChannelPhone,
        ...(channelPhoneParts
          ? {
              contact_phone_extension: channelPhoneParts.phone_extension,
              contact_phone_number: channelPhoneParts.phone_number,
            }
          : {}),
      });
      if (existingPlan) {
        existingPlan = classifierPlan;
      }
    }
    const hasUnsupportedImageMedia = inbound.media?.some(
      (item) => item.kind === 'image',
    ) ?? false;
    const messageContextStartedAt = Date.now();
    const messageContext = await this.prepareTurnMessageContext({
      inbound,
      plan: classifierPlan,
      gateway: agentConversationGateway,
      gatewayConfigured: Boolean(this.dependencies.agentConversationGateway),
      toolUsage,
    });
    timingMs.response_classification += Date.now() - messageContextStartedAt;
    let responseClassifierTrace: MessageResponseClassifierTrace | undefined;
    if (this.dependencies.responseClassifier && !hasUnsupportedImageMedia) {
      const preflightStartedAt = Date.now();
      const preflight = await this.runResponseClassifierPreflight({
        inbound,
        plan: classifierPlan,
        messageContext,
        toolUsage,
        skipClassification: existingPlan?.human_escalation.status === 'requested',
      });
      timingMs.response_classification += Date.now() - preflightStartedAt;
      tokenUsage.classifier = preflight.tokenUsage;
      tokenUsage.openAiCalls.classifier = preflight.openAiCall ?? null;
      tokenUsage.total = this.sumTokenUsage(tokenUsage.classifier);
      responseClassifierTrace = preflight.trace;
    }

    if (existingPlan?.human_escalation.status === 'requested') {
      const planToSave = mergePlan(existingPlan, {
        current_node: 'solicitar_agente_humano',
      });
      const savePlanStartedAt = Date.now();
      await this.dependencies.planStore.save({
        plan: planToSave,
        reason: 'human_escalation_soft_pause',
      });
      timingMs.save_plan += Date.now() - savePlanStartedAt;
      timingMs.total = Date.now() - handleTurnStartedAt;
      const extraction = this.buildSyntheticEscalationExtraction(
        'El usuario escribió después de que se pidió una revisión humana.',
      );
      const outbound = this.suppressOutbound(planToSave.conversation_id, 'human_escalation_active');
      return {
        plan: planToSave,
        outbound,
        trace: this.buildTrace({
          plan: planToSave,
          previousNode: existingPlan.current_node,
          currentNode: 'solicitar_agente_humano',
          nodePath: [existingPlan.current_node, 'solicitar_agente_humano'],
          extraction,
          missingFields: [],
          searchReady: false,
          promptBundleId: 'deterministic:human_escalation_soft_pause',
          promptFilePaths: [],
          toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'human_escalation_soft_pause',
          timingMs,
          tokenUsage,
          messageContext,
          searchStrategy: 'none',
          turnDecision: this.humanEscalationTurnDecision('human_escalation_soft_pause'),
          operationalNote: 'Conversation is soft-paused after human escalation.',
          responseClassifier: responseClassifierTrace,
        }),
      };
    }

    if (hasUnsupportedImageMedia) {
      const previousNode = existingPlan?.current_node ?? 'contacto_inicial';
      const planToSave = mergePlan(classifierPlan, {
        current_node: 'resolver_consultas_informativas',
        intent_confidence: 1,
      });
      const savePlanStartedAt = Date.now();
      await this.dependencies.planStore.save({
        plan: planToSave,
        reason: 'unsupported_image_media',
      });
      timingMs.save_plan += Date.now() - savePlanStartedAt;
      timingMs.total = Date.now() - handleTurnStartedAt;
      const extraction = this.buildSyntheticUnsupportedImageExtraction();
      const message =
        'Por ahora no puedo leer imágenes. Escribe aquí el dato que aparece y podré orientarte';
      return {
        plan: planToSave,
        outbound: this.renderOutbound(
          { text: message },
          [],
          inbound.channel,
          planToSave.conversation_id,
          planToSave,
        ),
        trace: this.buildTrace({
          plan: planToSave,
          previousNode,
          currentNode: 'resolver_consultas_informativas',
          nodePath: previousNode === 'resolver_consultas_informativas'
            ? ['resolver_consultas_informativas']
            : [previousNode, 'resolver_consultas_informativas'],
          extraction,
          missingFields: planToSave.missing_fields,
          searchReady: false,
          promptBundleId: 'deterministic:unsupported_image_media',
          promptFilePaths: [],
          toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'unsupported_image_media',
          timingMs,
          tokenUsage,
          messageContext,
          searchStrategy: 'none',
          operationalNote:
            'Trusted channel media metadata reported an image; media retrieval and interpretation are not enabled.',
        }),
      };
    }

    if (responseClassifierTrace) {
      const previousHealth = classifierPlan.conversation_health;
      const healthUpdate = this.reduceConversationHealth(previousHealth, responseClassifierTrace);
      classifierPlan = mergePlan(classifierPlan, {
        conversation_health: healthUpdate.state,
      });
      if (existingPlan) {
        existingPlan = classifierPlan;
      }

      if (
        previousHealth.help_offer_status === 'offered' &&
        responseClassifierTrace.human_help_response === 'accept'
      ) {
        const phoneNumber = this.resolveEscalationPhone(inbound, classifierPlan);
        const gatewayResult = phoneNumber
          ? await this.requestHumanTakeoverWithTrace(
              agentConversationGateway,
              phoneNumber,
              toolUsage,
            )
          : this.missingPhoneEscalationResult();
        const planToSave = mergePlan(classifierPlan, {
          current_node: 'solicitar_agente_humano',
          intent: 'solicitar_humano',
          human_escalation: {
            status: 'requested',
            requested_at: new Date().toISOString(),
            phone_number: phoneNumber,
            last_error: gatewayResult.status === 'failed'
              ? gatewayResult.error
              : gatewayResult.status === 'skipped'
                ? gatewayResult.message
                : null,
          },
        });
        const savePlanStartedAt = Date.now();
        await this.dependencies.planStore.save({
          plan: planToSave,
          reason: 'human_help_offer_accepted',
        });
        timingMs.save_plan += Date.now() - savePlanStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        const extraction = this.buildSyntheticEscalationExtraction(
          'El usuario aceptó la oferta de apoyo humano.',
        );
        return {
          plan: planToSave,
          outbound: this.renderOutbound(
            { text: this.humanEscalationRequestedMessage(gatewayResult) },
            [],
            inbound.channel,
            planToSave.conversation_id,
            planToSave,
          ),
          trace: this.buildTrace({
            plan: planToSave,
            previousNode: classifierPlan.current_node,
            currentNode: 'solicitar_agente_humano',
            nodePath: [classifierPlan.current_node, 'solicitar_agente_humano'],
            extraction,
            missingFields: [],
            searchReady: false,
            promptBundleId: 'deterministic:human_help_offer_accepted',
            promptFilePaths: [],
            toolUsage,
            providerResults: [],
            recommendationFunnel: this.resolveRecommendationFunnel(null, []),
            planPersisted: true,
            planPersistReason: 'human_help_offer_accepted',
            timingMs,
            tokenUsage,
            messageContext,
            searchStrategy: 'none',
            turnDecision: this.humanEscalationTurnDecision('human_help_offer_accepted'),
            operationalNote: this.humanEscalationOperationalNote(gatewayResult),
            responseClassifier: responseClassifierTrace,
          }),
        };
      }

      if (healthUpdate.shouldOfferHelp) {
        const planToSave = mergePlan(classifierPlan, {
          current_node: 'ofrecer_agente_humano',
        });
        const savePlanStartedAt = Date.now();
        await this.dependencies.planStore.save({
          plan: planToSave,
          reason: 'conversation_health_help_offer',
        });
        timingMs.save_plan += Date.now() - savePlanStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        const extraction = this.buildSyntheticConversationHealthExtraction();
        return {
          plan: planToSave,
          outbound: this.renderOutbound(
            { text: this.conversationHealthHelpOfferMessage() },
            [],
            inbound.channel,
            planToSave.conversation_id,
            planToSave,
          ),
          trace: this.buildTrace({
            plan: planToSave,
            previousNode: classifierPlan.current_node,
            currentNode: 'ofrecer_agente_humano',
            nodePath: [classifierPlan.current_node, 'ofrecer_agente_humano'],
            extraction,
            missingFields: planToSave.missing_fields,
            searchReady: false,
            promptBundleId: 'deterministic:conversation_health_help_offer',
            promptFilePaths: [
              'prompts/nodes/ofrecer_agente_humano/system.txt',
              'prompts/nodes/ofrecer_agente_humano/response_contract.txt',
              'prompts/nodes/ofrecer_agente_humano/tool_policy.txt',
            ],
            toolUsage,
            providerResults: [],
            recommendationFunnel: this.resolveRecommendationFunnel(null, []),
            planPersisted: true,
            planPersistReason: 'conversation_health_help_offer',
            timingMs,
            tokenUsage,
            messageContext,
            searchStrategy: 'none',
            turnDecision: this.conversationHealthTurnDecision(responseClassifierTrace.health_reason),
            operationalNote: 'Conversation health monitor offered optional human help.',
            responseClassifier: responseClassifierTrace,
          }),
        };
      }
    }

    if (
      responseClassifierTrace?.mode === 'enforce' &&
      responseClassifierTrace.would_suppress
    ) {
      const planToSave = existingPlan ?? classifierPlan;
      const savePlanStartedAt = Date.now();
      await this.dependencies.planStore.save({
        plan: planToSave,
        reason: 'response_classifier_suppressed',
      });
      timingMs.save_plan += Date.now() - savePlanStartedAt;
      timingMs.total = Date.now() - handleTurnStartedAt;
      const extraction = this.buildSyntheticSuppressionExtraction(responseClassifierTrace.reason);
      return {
        plan: planToSave,
        outbound: this.suppressOutbound(
          planToSave.conversation_id,
          responseClassifierTrace.action,
        ),
        trace: this.buildTrace({
          plan: planToSave,
          previousNode: existingPlan?.current_node ?? 'contacto_inicial',
          currentNode: planToSave.current_node,
          nodePath: [planToSave.current_node],
          extraction,
          missingFields: planToSave.missing_fields,
          searchReady: false,
          promptBundleId: responseClassifierTrace.prompt_bundle_id ?? 'classifier:fallback',
          promptFilePaths: responseClassifierTrace.prompt_file_paths,
          toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'response_classifier_suppressed',
          timingMs,
          tokenUsage,
          messageContext,
          searchStrategy: 'none',
          operationalNote: 'Reply delivery was suppressed by the response classifier.',
          responseClassifier: responseClassifierTrace,
        }),
      };
    }

    if (existingPlan && isPlanFinished(existingPlan)) {
      const extractionStartedAt = Date.now();
      const rawExtractionResult = await this.dependencies.runtime.extract({
        userMessage: inbound.text,
        plan: existingPlan,
        messageContext,
      });
      let finishedExtraction =
        'extraction' in rawExtractionResult
          ? rawExtractionResult.extraction
          : rawExtractionResult;
      tokenUsage.extraction =
        'tokenUsage' in rawExtractionResult
          ? (rawExtractionResult.tokenUsage ?? null)
          : null;
      tokenUsage.openAiCalls.extraction =
        'openAiCall' in rawExtractionResult
          ? (rawExtractionResult.openAiCall ?? null)
          : null;
      timingMs.extraction += Date.now() - extractionStartedAt;
      finishedExtraction =
        this.normalizeInformationExtractionAmbiguity(finishedExtraction);

      if (this.hasInformationWork(existingPlan, finishedExtraction)) {
        return await this.handleInformationFlow({
          inbound,
          previousNode: existingPlan.current_node,
          workingPlan: existingPlan,
          extraction: finishedExtraction,
          toolUsage,
          timingMs,
          tokenUsage,
          responseClassifierTrace,
          messageContext,
          handleTurnStartedAt,
        });
      }

      const isPlanningIntent =
        finishedExtraction.actionIntent === 'buscar_proveedores' ||
        finishedExtraction.actionIntent === 'retomar_plan' ||
        finishedExtraction.actionIntent === 'ver_opciones' ||
        finishedExtraction.actionIntent === 'refinar_busqueda' ||
        finishedExtraction.actionIntent === 'confirmar_proveedor';

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
        const respondNode: DecisionNode = 'necesidad_cubierta';
        const planForReply = existingPlan;
        const finishedErrorMessage: string | null = null;
        const bundle = await this.dependencies.promptLoader.loadNodeBundle(respondNode);
        const composedReply = await this.dependencies.runtime.composeReply({
          currentNode: respondNode,
          previousNode: existingPlan.current_node,
          userMessage: inbound.text,
          messageContext,
          plan: planForReply,
          extraction: finishedExtraction,
          missingFields: finishedSufficiency.missingFields,
          searchReady: finishedSufficiency.searchReady,
          providerResults: finishedProviders,
          errorMessage: finishedErrorMessage,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
        });
        const reply = this.enforceFaqAmbiguityReply(
          respondNode,
          finishedExtraction,
          composedReply,
        );
        tokenUsage.reply = reply.tokenUsage ?? null;
        tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
        tokenUsage.total = this.sumTokenUsage(
          tokenUsage.classifier,
          tokenUsage.extraction,
          tokenUsage.reply,
        );
        timingMs.compose_reply += Date.now() - extractionStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        return {
          plan: planForReply,
          outbound: this.renderOutbound(
            reply,
            finishedProviders,
            inbound.channel,
            planForReply.conversation_id,
            planForReply,
          ),
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
            planPersisted: false,
            planPersistReason: null,
            timingMs,
            tokenUsage,
            messageContext,
            responseClassifier: responseClassifierTrace,
            searchStrategy: 'none',
            operationalNote: finishedErrorMessage,
          }),
        };
      }
    }

    const previousNode = existingPlan?.current_node ?? 'contacto_inicial';
    const loadedPlan = existingPlan ?? classifierPlan;

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
      messageContext,
    });
    let extraction =
      'extraction' in rawExtractionResult
        ? rawExtractionResult.extraction
        : rawExtractionResult;
    tokenUsage.extraction =
      'tokenUsage' in rawExtractionResult
        ? (rawExtractionResult.tokenUsage ?? null)
        : null;
    tokenUsage.openAiCalls.extraction =
      'openAiCall' in rawExtractionResult
        ? (rawExtractionResult.openAiCall ?? null)
        : null;
    timingMs.extraction += Date.now() - extractionStartedAt;

    let errorMessage: string | null = null;
    const applyExtractionStartedAt = Date.now();
    extraction = this.guardGenericElicitation(extraction);
    extraction = this.normalizeInformationExtractionAmbiguity(extraction);
    extraction = this.guardCloseIntentWithoutEstablishedPlan(
      workingPlan,
      extraction,
    );
    extraction = this.preserveContactPhoneCandidate(extraction, inbound.text);
    const providerConfirmationGuard = this.guardAmbiguousProviderConfirmation(
      workingPlan,
      extraction,
      inbound.text,
    );
    extraction = providerConfirmationGuard.extraction;
    if (
      this.hasInformationWork(workingPlan, extraction) &&
      extraction.actionIntent !== 'pausar' &&
      extraction.actionIntent !== 'solicitar_humano'
    ) {
      return await this.handleInformationFlow({
        inbound,
        previousNode,
        workingPlan,
        extraction,
        toolUsage,
        timingMs,
        tokenUsage,
        responseClassifierTrace,
        messageContext,
        handleTurnStartedAt,
      });
    }
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
          extraction.actionIntent === 'cerrar',
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
      ? providerConfirmationGuard.ambiguous
        ? { resolved: false }
        : this.tryResolveSelection(
          mergedPlan,
          extraction.selectedProviderReferences ?? [],
          effectiveSelectionHints,
          extraction.actionIntent,
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
      hasAmbiguousSelection: providerConfirmationGuard.ambiguous,
      hasReplaceProviderOperation: operationResult.appliedOperations.some(
        (op) => op.type === 'replace_provider',
      ),
    });
    let turnDecision = this.decideNextTurn(decisionEvidence, mergedPlan);

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

    if (extraction.actionIntent === 'solicitar_humano') {
      currentNode = 'solicitar_agente_humano';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      const phoneNumber = this.resolveEscalationPhone(inbound, mergedPlan);
      const requestedAt = new Date().toISOString();
      const gatewayResult = phoneNumber
        ? await this.requestHumanTakeoverWithTrace(
            agentConversationGateway,
            phoneNumber,
            toolUsage,
          )
        : this.missingPhoneEscalationResult();
      const planToSave = mergePlan(mergedPlan, {
        current_node: currentNode,
        intent: 'solicitar_humano',
        human_escalation: {
          status: 'requested',
          requested_at: requestedAt,
          phone_number: phoneNumber,
          last_error: gatewayResult.status === 'failed'
            ? gatewayResult.error
            : gatewayResult.status === 'skipped'
              ? gatewayResult.message
              : null,
        },
      });
      await persistPlan(planToSave, currentNode);
      planPersisted = true;
      planPersistReason = currentNode;
      timingMs.total = Date.now() - handleTurnStartedAt;
      const outbound = this.renderOutbound(
        { text: this.humanEscalationRequestedMessage(gatewayResult) },
        [],
        inbound.channel,
        planToSave.conversation_id,
        planToSave,
      );
      return {
        plan: planToSave,
        outbound,
        trace: this.buildTrace({
          plan: planToSave,
          previousNode,
          currentNode,
          nodePath,
          extraction,
          missingFields: [],
          searchReady: false,
          promptBundleId: 'deterministic:solicitar_agente_humano',
          promptFilePaths: [],
          toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted,
          planPersistReason,
          timingMs,
          tokenUsage,
          messageContext,
          responseClassifier: responseClassifierTrace,
          searchStrategy,
          turnDecision: this.humanEscalationTurnDecision(currentNode),
          operationalNote: this.humanEscalationOperationalNote(gatewayResult),
        }),
      };
    }

    if (extraction.pauseRequested || extraction.actionIntent === 'pausar') {
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
        messageContext,
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
      tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      tokenUsage.total = this.sumTokenUsage(
        tokenUsage.classifier,
        tokenUsage.extraction,
        tokenUsage.reply,
      );
      const recommendationFunnel = this.resolveRecommendationFunnel(
        reply.recommendationFunnel ?? null,
        providerResults,
      );
      timingMs.compose_reply += Date.now() - composeReplyStartedAt;

      await persistPlan(planToSave, planPersistReason ?? currentNode);
      timingMs.total = Date.now() - handleTurnStartedAt;

      return {
        plan: planToSave,
        outbound: this.renderOutbound(
          reply,
          providerResults,
          inbound.channel,
          planToSave.conversation_id,
          planToSave,
        ),
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
          messageContext,
          responseClassifier: responseClassifierTrace,
          searchStrategy,
          operationalNote: errorMessage,
        }),
      };
    }

    if (
      extraction.actionIntent === 'cerrar' ||
      this.shouldHandleCloseTurn(previousNode, extraction, validationError)
    ) {
      const isCloseContactClarification = extraction.closeAction?.type === 'clarify';
      const closeSelectionResolution = shouldResolveProviderSelection
        ? this.tryResolveSelection(
            mergedPlan,
            extraction.selectedProviderReferences ?? [],
            this.resolveEffectiveSelectionHints(extraction),
            extraction.actionIntent,
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
          messageContext,
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
        tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
        tokenUsage.total = this.sumTokenUsage(
          tokenUsage.classifier,
          tokenUsage.extraction,
          tokenUsage.reply,
        );
        const recommendationFunnel = this.resolveRecommendationFunnel(
          reply.recommendationFunnel ?? null,
          providerResults,
        );
        timingMs.compose_reply += Date.now() - composeReplyStartedAt;

        await persistPlan(planToSave, planPersistReason ?? currentNode);
        timingMs.total = Date.now() - handleTurnStartedAt;

        return {
          plan: planToSave,
          outbound: this.renderOutbound(
            reply,
            providerResults,
            inbound.channel,
            planToSave.conversation_id,
            planToSave,
          ),
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
            messageContext,
            responseClassifier: responseClassifierTrace,
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
        messageContext,
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
      tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      tokenUsage.total = this.sumTokenUsage(
        tokenUsage.classifier,
        tokenUsage.extraction,
        tokenUsage.reply,
      );
      const recommendationFunnel = this.resolveRecommendationFunnel(
        reply.recommendationFunnel ?? null,
        providerResults,
      );
      timingMs.compose_reply += Date.now() - composeReplyStartedAt;

      await persistPlan(planToSave, planPersistReason ?? currentNode);
      timingMs.total = Date.now() - handleTurnStartedAt;

      return {
        plan: planToSave,
        outbound: this.renderOutbound(
          reply,
          providerResults,
          inbound.channel,
          planToSave.conversation_id,
          planToSave,
        ),
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
          messageContext,
          responseClassifier: responseClassifierTrace,
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
    const composedReply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode,
      userMessage: inbound.text,
      messageContext,
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
    });
    const reply = this.enforceMissingFieldReply(
      currentNode,
      sufficiency.missingFields,
      this.enforceFaqAmbiguityReply(
        currentNode,
        extraction,
        composedReply,
      ),
    );
    tokenUsage.reply = reply.tokenUsage ?? null;
    tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      tokenUsage.total = this.sumTokenUsage(
        tokenUsage.classifier,
        tokenUsage.extraction,
        tokenUsage.reply,
      );
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
      outbound: this.renderOutbound(
        reply,
        providerResults,
        inbound.channel,
        planAfterFlow.conversation_id,
        planAfterFlow,
      ),
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
        messageContext,
        responseClassifier: responseClassifierTrace,
        searchStrategy,
        turnDecision,
        sessionFocusUsed: Boolean(sessionFocus),
        sessionFocusKeyPresent: Boolean(inbound.sessionId),
        operationalNote: errorMessage,
      }),
    };
  }

  private hasInformationWork(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): boolean {
    return (
      extraction.informationRequests.length > 0 ||
      plan.information_state.pending_requests.length > 0
    );
  }

  private normalizeInformationExtractionAmbiguity(
    extraction: ExtractionResult,
  ): ExtractionResult {
    if (
      extraction.ambiguity?.status !== 'ambiguous' ||
      extraction.informationRequests.length === 0 ||
      extraction.informationRequests.some((request) => request.kind === 'faq')
    ) {
      return extraction;
    }

    return {
      ...extraction,
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
    };
  }

  private async handleInformationFlow(args: {
    inbound: NormalizedInboundMessage;
    previousNode: DecisionNode;
    workingPlan: PlanSnapshot;
    extraction: ExtractionResult;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    responseClassifierTrace?: MessageResponseClassifierTrace;
    messageContext: TurnMessageContext;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse> {
    const currentNode: DecisionNode = 'resolver_consultas_informativas';
    const resumeNode =
      args.workingPlan.current_node === currentNode
        ? args.workingPlan.information_state.resume_node
        : args.workingPlan.current_node;
    const planWithContact = mergePlan(args.workingPlan, {
      contact_email:
        args.extraction.contactEmail && this.isValidEmail(args.extraction.contactEmail)
          ? args.extraction.contactEmail
          : args.workingPlan.contact_email,
    });
    const requests = this.mergeInformationRequests(
      planWithContact.information_state.pending_requests,
      args.extraction.informationRequests,
    );
    let planForInformation = mergePlan(planWithContact, {
      current_node: currentNode,
      information_state: {
        resume_node: resumeNode,
        pending_requests: requests,
        selection_candidates:
          planWithContact.information_state.selection_candidates,
      },
    });

    const hasActionConflict =
      args.extraction.actionIntent !== null &&
      requests.length > 0;
    const hasAmbiguity = args.extraction.ambiguity?.status === 'ambiguous';
    let informationResults: InformationTaskResult[] = [];
    let informationSummaries: InformationExecutionSummary[] = [];
    let operationalNote: string | null = null;

    if (hasActionConflict) {
      operationalNote =
        'El mensaje combina una acción del plan con consultas informativas. Haz una sola pregunta breve para confirmar cuál quiere resolver primero. No ejecutes ni respondas ninguna de las dos rutas todavía.';
    } else if (hasAmbiguity) {
      operationalNote = this.resolveFaqAmbiguityNote(args.extraction);
      planForInformation = mergePlan(planForInformation, {
        information_state: {
          ...planForInformation.information_state,
          pending_requests:
            planWithContact.information_state.pending_requests,
        },
      });
    } else {
      const informationStartedAt = Date.now();
      const authResolution = await this.resolveInformationAuthentication({
        plan: planForInformation,
        userMessage: args.inbound.text,
        requests,
        toolUsage: args.toolUsage,
        trustedContactPhone: args.inbound.contactPhone ?? null,
        phoneConfirmation: args.extraction.phoneConfirmation ?? null,
      });
      planForInformation = authResolution.plan;

      requests.forEach((request) => {
        this.recordDeterministicToolInput(
          args.toolUsage,
          this.informationToolName(request),
          this.summarizeInformationToolInput(request),
        );
      });

      const orchestrator =
        this.dependencies.informationOrchestrator ??
        new InformationOrchestrator({
          knowledgeGateway: new NoopKnowledgeRetrievalGateway(),
          providerGateway: this.dependencies.providerGateway,
          agentGateway:
            this.dependencies.agentConversationGateway ??
            new NoopAgentConversationGateway('not_configured'),
        });
      const execution = await orchestrator.execute({
        requests,
        authentication: authResolution.authentication,
        authBlock: authResolution.authBlock,
      });
      args.timingMs.information_execution += Date.now() - informationStartedAt;
      informationResults = execution.results;
      informationSummaries = execution.summaries;
      this.recordInformationExecutionTrace(
        args.toolUsage,
        informationSummaries,
      );

      if (
        informationResults.some(
          (result) =>
            result.status === 'failed' &&
            (result.kind === 'purchase' ||
              result.kind === 'associated_event') &&
            result.failureKind === 'unauthorized',
        )
      ) {
        planForInformation = this.resetUserAuth(
          planForInformation,
          planForInformation.user_auth.email,
          'Agent API rejected the stored user session.',
        );
      }

      const nextState = this.reduceInformationState(
        requests,
        informationResults,
      );
      planForInformation = mergePlan(planForInformation, {
        information_state: {
          resume_node: resumeNode,
          pending_requests: nextState.pendingRequests,
          selection_candidates: nextState.selectionCandidates,
        },
      });
    }

    const promptBundleStartedAt = Date.now();
    const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
    args.timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
    const composeReplyStartedAt = Date.now();
    const composedReply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planForInformation,
      extraction: args.extraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      turnDecision: this.informationTurnDecision(
        operationalNote ?? 'information_batch',
      ),
      errorMessage: operationalNote,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      informationResults,
    });
    const ambiguitySafeReply = this.enforceFaqAmbiguityReply(
      currentNode,
      args.extraction,
      composedReply,
    );
    const phoneConfirmationReply = this.enforcePhoneConfirmationReply(
      planForInformation,
      ambiguitySafeReply,
    );
    const reply = this.enforceRepeatedOtpRecoveryReply(
      informationResults,
      planForInformation,
      phoneConfirmationReply,
    );
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    args.timingMs.compose_reply += Date.now() - composeReplyStartedAt;

    const savePlanStartedAt = Date.now();
    await this.dependencies.planStore.save({
      plan: planForInformation,
      reason: currentNode,
    });
    args.timingMs.save_plan += Date.now() - savePlanStartedAt;
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const turnDecision = this.informationTurnDecision(
      operationalNote ?? 'information_batch',
    );

    return {
      plan: planForInformation,
      outbound: this.renderOutbound(
        reply,
        [],
        args.inbound.channel,
        planForInformation.conversation_id,
        planForInformation,
      ),
      trace: this.buildTrace({
        plan: planForInformation,
        previousNode: args.previousNode,
        currentNode,
        nodePath:
          args.previousNode === currentNode
            ? [currentNode]
            : [args.previousNode, currentNode],
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: currentNode,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision,
        operationalNote,
        informationExecution: informationSummaries,
      }),
    };
  }

  private mergeInformationRequests(
    pending: PendingInformationRequest[],
    extracted: ExtractedInformationRequest[],
  ): PendingInformationRequest[] {
    const merged = [...pending];
    let nextId = merged.length + 1;

    for (const request of extracted) {
      const matchingIndex = merged.findIndex((candidate) =>
        this.sameInformationThread(candidate, request),
      );
      if (matchingIndex >= 0) {
        const existing = merged[matchingIndex];
        if (!existing) {
          continue;
        }
        merged[matchingIndex] =
          existing.kind === 'purchase' && request.kind === 'purchase'
            ? {
                ...request,
                requestId: existing.requestId,
                query: request.query || existing.query,
                orderId: request.orderId ?? existing.orderId,
                aspects: Array.from(
                  new Set([...existing.aspects, ...request.aspects]),
                ),
                sensitiveFields: Array.from(
                  new Set([
                    ...existing.sensitiveFields,
                    ...request.sensitiveFields,
                  ]),
                ),
              }
            : {
                ...request,
                requestId: existing.requestId,
              };
        continue;
      }

      let requestId = `information-${nextId}`;
      while (merged.some((candidate) => candidate.requestId === requestId)) {
        nextId += 1;
        requestId = `information-${nextId}`;
      }
      merged.push({
        ...request,
        requestId,
      } as PendingInformationRequest);
      nextId += 1;
    }

    return merged;
  }

  private sameInformationThread(
    pending: PendingInformationRequest,
    extracted: ExtractedInformationRequest,
  ): boolean {
    if (pending.kind !== extracted.kind) {
      return false;
    }
    if (pending.kind === 'purchase' && extracted.kind === 'purchase') {
      return pending.resource === extracted.resource;
    }
    if (pending.kind === 'associated_event') {
      return true;
    }
    return pending.kind === 'faq' && extracted.kind === 'faq'
      ? pending.query.trim().toLocaleLowerCase('es') ===
          extracted.query.trim().toLocaleLowerCase('es')
      : false;
  }

  private async resolveInformationAuthentication(args: {
    plan: PlanSnapshot;
    userMessage: string;
    requests: PendingInformationRequest[];
    toolUsage: ToolUsage;
    trustedContactPhone: string | null;
    phoneConfirmation: 'yes' | 'no' | 'unclear' | null;
  }): Promise<{
    plan: PlanSnapshot;
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock | null;
  }> {
    const protectedRequests = args.requests.filter(
      (request) =>
        request.kind === 'associated_event' || request.kind === 'purchase',
    );
    if (protectedRequests.length === 0) {
      return {
        plan: args.plan,
        authentication: null,
        authBlock: null,
      };
    }

    const trustedPhoneParts = splitInternationalPhone(args.trustedContactPhone);
    if (args.plan.user_auth.status !== 'code_requested' && trustedPhoneParts) {
      if (args.plan.user_auth.awaiting_phone_confirmation) {
        if (args.phoneConfirmation === 'unclear' || args.phoneConfirmation === null) {
          return this.phoneConfirmationRequired(args.plan);
        }

        const planWithoutPhoneConfirmation = mergePlan(args.plan, {
          user_auth: {
            ...args.plan.user_auth,
            awaiting_phone_confirmation: false,
          },
        });
        if (args.phoneConfirmation === 'yes') {
          const phoneAuthentication = await this.authenticateByPhone(
            trustedPhoneParts,
            args.toolUsage,
          );
          if (phoneAuthentication.status === 'authenticated') {
            if (
              !phoneAuthentication.token.trim() ||
              !this.isValidEmail(phoneAuthentication.email) ||
              !isFutureIsoTimestamp(phoneAuthentication.tokenExpiresAtIso)
            ) {
              return this.resolveEmailAuthentication({
                ...args,
                plan: this.clearPhoneAuthentication(
                  planWithoutPhoneConfirmation,
                  'Phone authentication returned incomplete credentials.',
                ),
              });
            }

            const authenticatedPlan = mergePlan(planWithoutPhoneConfirmation, {
              contact_email: phoneAuthentication.email,
              user_auth: {
                ...planWithoutPhoneConfirmation.user_auth,
                status: 'authenticated',
                email: phoneAuthentication.email,
                token: phoneAuthentication.token,
                token_expires_at: phoneAuthentication.tokenExpiresAtIso,
                last_error: null,
                requested_at: null,
                failed_code_attempts: 0,
                auth_method: 'phone',
                awaiting_phone_confirmation: false,
              },
            });
            return {
              plan: authenticatedPlan,
              authentication: {
                token: phoneAuthentication.token,
                email: phoneAuthentication.email,
              },
              authBlock: null,
            };
          }
        }

        return this.resolveEmailAuthentication({
          ...args,
          plan: this.clearPhoneAuthentication(
            planWithoutPhoneConfirmation,
            null,
          ),
        });
      }

      if (!this.hasValidUserAuthToken(args.plan)) {
        return this.phoneConfirmationRequired(
          mergePlan(args.plan, {
            user_auth: {
              ...args.plan.user_auth,
              awaiting_phone_confirmation: true,
            },
          }),
        );
      }
    }

    return this.resolveEmailAuthentication({
      ...args,
      plan:
        args.plan.user_auth.awaiting_phone_confirmation
          ? this.clearPhoneAuthentication(args.plan, null)
          : args.plan,
    });
  }

  private phoneConfirmationRequired(plan: PlanSnapshot): {
    plan: PlanSnapshot;
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock;
  } {
    return {
      plan,
      authentication: null,
      authBlock: {
        nextInput: 'phone_confirmation',
        guidance: createInformationAuthGuidance(
          'phone_confirmation_required',
          null,
        ),
      },
    };
  }

  private clearPhoneAuthentication(
    plan: PlanSnapshot,
    lastError: string | null,
  ): PlanSnapshot {
    return mergePlan(plan, {
      user_auth: {
        ...plan.user_auth,
        status: 'none',
        token: null,
        token_expires_at: null,
        last_error: lastError,
        auth_method: null,
        awaiting_phone_confirmation: false,
      },
    });
  }

  private async authenticateByPhone(
    phone: { phone_extension: string; phone_number: string },
    toolUsage: ToolUsage,
  ): Promise<AgentAuthByPhoneResult> {
    this.recordDeterministicToolInput(toolUsage, 'auth_by_phone', {
      phone_parts_present: true,
      auth: 'X-Agent-Key [redacted]',
    });
    let result: AgentAuthByPhoneResult;
    try {
      result = await (
        this.dependencies.agentConversationGateway ??
        new NoopAgentConversationGateway('not_configured')
      ).authByPhone(phone);
    } catch (error) {
      result = {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Phone authentication failed.',
        retryable: true,
      };
    }
    this.recordDeterministicToolOutput(toolUsage, 'auth_by_phone', {
      status: result.status,
      ...(result.status === 'authenticated'
        ? {
            token: '[redacted]',
            email_present: result.email.trim().length > 0,
            expiry_present: result.tokenExpiresAtIso.trim().length > 0,
          }
        : {}),
    });
    return result;
  }

  private async resolveEmailAuthentication(args: {
    plan: PlanSnapshot;
    userMessage: string;
    requests: PendingInformationRequest[];
    toolUsage: ToolUsage;
    trustedContactPhone: string | null;
    phoneConfirmation: 'yes' | 'no' | 'unclear' | null;
  }): Promise<{
    plan: PlanSnapshot;
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock | null;
  }> {
    const protectedRequests = args.requests.filter(
      (request) =>
        request.kind === 'associated_event' || request.kind === 'purchase',
    );

    const purchaseAuthAction = protectedRequests.find(
      (request): request is Extract<PendingInformationRequest, { kind: 'purchase' }> =>
        request.kind === 'purchase',
    )?.authAction;
    const providedEmail = this.extractEmailFromText(args.userMessage);
    if (purchaseAuthAction === 'change_email' && !providedEmail) {
      return {
        plan: this.resetUserAuth(args.plan, null),
        authentication: null,
        authBlock: {
          nextInput: 'email',
          guidance: createInformationAuthGuidance(
            'email_change_required',
            null,
          ),
        },
      };
    }
    const email = this.resolveUserAuthEmail(args.plan, args.userMessage);
    if (!email || !this.isValidEmail(email)) {
      return {
        plan: this.resetUserAuth(args.plan, null),
        authentication: null,
        authBlock: {
          nextInput: 'email',
          guidance: createInformationAuthGuidance('email_required', null),
        },
      };
    }

    let planForEmail =
      args.plan.user_auth.email === email
        ? args.plan
        : this.resetUserAuth(args.plan, email);

    if (this.hasValidUserAuthToken(planForEmail)) {
      return {
        plan: planForEmail,
        authentication: {
          token: planForEmail.user_auth.token ?? '',
          email,
        },
        authBlock: null,
      };
    }

    const code = this.extractUserLoginCode(args.userMessage);
    if (planForEmail.user_auth.status === 'code_requested' && code) {
      const verification = await this.verifyUserCodeForInformation(
        planForEmail,
        email,
        code,
        args.toolUsage,
        splitInternationalPhone(args.trustedContactPhone),
      );
      return verification;
    }

    if (
      planForEmail.user_auth.status === 'code_requested' &&
      purchaseAuthAction !== 'resend_otp'
    ) {
      return {
        plan: planForEmail,
        authentication: null,
        authBlock: {
          nextInput: 'otp',
          guidance: createInformationAuthGuidance(
            purchaseAuthAction === 'report_otp_not_received'
              ? 'otp_not_received'
              : planForEmail.user_auth.failed_code_attempts >= 2
                ? 'otp_repeated_failure'
                : planForEmail.user_auth.failed_code_attempts === 1
                  ? 'otp_invalid'
                  : 'otp_pending',
            email,
          ),
        },
      };
    }

    const requested = await this.requestUserCodeForInformation(
      planForEmail,
      email,
      args.toolUsage,
      purchaseAuthAction === 'resend_otp',
    );
    planForEmail = requested.plan;
    return {
      plan: planForEmail,
      authentication: null,
      authBlock: requested.authBlock,
    };
  }

  private async requestUserCodeForInformation(
    plan: PlanSnapshot,
    email: string,
    toolUsage: ToolUsage,
    isResend: boolean,
  ): Promise<{
    plan: PlanSnapshot;
    authBlock: InformationAuthBlock;
  }> {
    this.recordDeterministicToolInput(
      toolUsage,
      'request_user_login_code',
      { email_present: true },
    );
    const result = await this.dependencies.providerGateway.requestUserLoginCode(email);
    this.recordDeterministicToolOutput(
      toolUsage,
      'request_user_login_code',
      { status: result.status },
    );

    if (result.status === 'sent') {
      return {
        plan: mergePlan(plan, {
          contact_email: email,
          user_auth: {
            status: 'code_requested',
            email,
            token: null,
            token_expires_at: null,
            last_error: null,
            requested_at: new Date().toISOString(),
            failed_code_attempts: 0,
            auth_method: null,
            awaiting_phone_confirmation: false,
          },
        }),
        authBlock: {
          nextInput: 'otp',
          guidance: createInformationAuthGuidance(
            isResend ? 'otp_resent' : 'otp_sent',
            email,
          ),
        },
      };
    }

    if (result.status === 'email_not_found') {
      return {
        plan: mergePlan(plan, {
          contact_email: email,
          user_auth: {
            status: 'email_not_found',
            email,
            token: null,
            token_expires_at: null,
            last_error: result.error,
            requested_at: null,
            failed_code_attempts: 0,
            auth_method: null,
            awaiting_phone_confirmation: false,
          },
        }),
        authBlock: {
          nextInput: 'email',
          guidance: createInformationAuthGuidance('email_not_found', email),
        },
      };
    }

    return {
      plan: mergePlan(plan, {
        user_auth: {
          status: 'failed',
          email,
          token: null,
          token_expires_at: null,
          last_error: result.error,
          requested_at: null,
          failed_code_attempts: 0,
          auth_method: null,
          awaiting_phone_confirmation: false,
        },
      }),
      authBlock: {
        nextInput: 'email',
        guidance: createInformationAuthGuidance('otp_send_failed', email),
      },
    };
  }

  private async verifyUserCodeForInformation(
    plan: PlanSnapshot,
    email: string,
    code: string,
    toolUsage: ToolUsage,
    trustedPhone: { phone_extension: string; phone_number: string } | null,
  ): Promise<{
    plan: PlanSnapshot;
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock | null;
  }> {
    this.recordDeterministicToolInput(
      toolUsage,
      'verify_user_login_code',
      { email_present: true, code: '[redacted]' },
    );
    const result =
      await this.dependencies.providerGateway.verifyUserLoginCode(email, code);
    this.recordDeterministicToolOutput(
      toolUsage,
      'verify_user_login_code',
      { status: result.status, token: '[redacted]' },
    );

    if (result.status !== 'authenticated') {
      const failedCodeAttempts = plan.user_auth.failed_code_attempts + 1;
      return {
        plan: mergePlan(plan, {
          user_auth: {
            ...plan.user_auth,
            status: 'code_requested',
            token: null,
            token_expires_at: null,
            last_error: result.error,
            failed_code_attempts: failedCodeAttempts,
          },
        }),
        authentication: null,
        authBlock: {
          nextInput: 'otp',
          guidance: createInformationAuthGuidance(
            failedCodeAttempts >= 2 ? 'otp_repeated_failure' : 'otp_invalid',
            email,
          ),
        },
      };
    }

    const authenticatedPlan = mergePlan(plan, {
        contact_email: email,
        user_auth: {
          status: 'authenticated',
          email,
          token: result.token,
          token_expires_at: result.tokenExpiresAt,
          last_error: null,
          requested_at: plan.user_auth.requested_at,
          failed_code_attempts: 0,
          auth_method: 'email',
          awaiting_phone_confirmation: false,
        },
      });
    if (trustedPhone) {
      await this.updatePhoneAfterEmailAuthentication(
        authenticatedPlan,
        trustedPhone,
        toolUsage,
      );
    }

    return {
      plan: authenticatedPlan,
      authentication: {
        token: result.token,
        email,
      },
      authBlock: null,
    };
  }

  private async updatePhoneAfterEmailAuthentication(
    plan: PlanSnapshot,
    phone: { phone_extension: string; phone_number: string },
    toolUsage: ToolUsage,
  ): Promise<void> {
    const token = plan.user_auth.token?.trim() ?? '';
    if (!token) {
      return;
    }
    this.recordDeterministicToolInput(toolUsage, 'update_phone', {
      phone_parts_present: true,
      auth: 'X-Agent-Key + Bearer JWT [redacted]',
    });
    let result: Awaited<ReturnType<AgentConversationGateway['updatePhone']>>;
    try {
      result = await (
        this.dependencies.agentConversationGateway ??
        new NoopAgentConversationGateway('not_configured')
      ).updatePhone({
        token,
        phone_extension: phone.phone_extension,
        phone_number: phone.phone_number,
      });
    } catch (error) {
      result = {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Phone update failed.',
        retryable: true,
      };
    }
    this.recordDeterministicToolOutput(toolUsage, 'update_phone', {
      status: result.status,
    });
  }

  private reduceInformationState(
    requests: PendingInformationRequest[],
    results: InformationTaskResult[],
  ): {
    pendingRequests: PendingInformationRequest[];
    selectionCandidates: InformationSelectionCandidate[];
  } {
    const resultsByRequest = new Map(
      results.map((result) => [result.requestId, result]),
    );
    const pendingRequests: PendingInformationRequest[] = [];
    const selectionCandidates: InformationSelectionCandidate[] = [];

    for (const request of requests) {
      const result = resultsByRequest.get(request.requestId);
      if (!result) {
        pendingRequests.push(request);
        continue;
      }
      if (result.status === 'needs_input' || result.status === 'failed') {
        pendingRequests.push(request);
        continue;
      }
      if (
        result.kind === 'purchase' &&
        result.needsSelection
      ) {
        pendingRequests.push(request);
        selectionCandidates.push({
          requestId: request.requestId,
          resource: result.resource,
          orders: result.purchases.map((purchase) => ({
            orderId: purchase.orderId,
            eventName: purchase.eventName,
            createdAt: purchase.createdAt,
            grandTotal: purchase.grandTotal,
            paymentStatus: purchase.paymentStatus,
          })),
        });
      }
    }

    return { pendingRequests, selectionCandidates };
  }

  private informationToolName(
    request: PendingInformationRequest,
  ): string {
    if (request.kind === 'faq') {
      return 'knowledge_base_search';
    }
    if (request.kind === 'associated_event') {
      return 'associated_event_lookup';
    }
    return request.resource === 'orders'
      ? 'agent_api_orders'
      : 'agent_api_gift_purchases';
  }

  private summarizeInformationToolInput(
    request: PendingInformationRequest,
  ): Record<string, unknown> {
    if (request.kind === 'faq') {
      return {
        request_id: request.requestId,
        query_present: request.query.trim().length > 0,
      };
    }
    if (request.kind === 'associated_event') {
      return {
        request_id: request.requestId,
        event_hint_present: Boolean(request.eventHint),
      };
    }
    return {
      request_id: request.requestId,
      resource: request.resource,
      order_id_present: Boolean(request.orderId),
      aspects: request.aspects,
      sensitive_fields_requested: request.sensitiveFields,
    };
  }

  private recordInformationExecutionTrace(
    toolUsage: ToolUsage,
    summaries: InformationExecutionSummary[],
  ): void {
    for (const summary of summaries) {
      if (summary.status !== 'needs_input') {
        toolUsage.called.push(
          summary.source === 'knowledge_base'
            ? 'knowledge_base_search'
            : summary.source === 'associated_event_api'
              ? 'associated_event_lookup'
              : 'agent_api_purchase_lookup',
        );
      }
      toolUsage.outputs.push({
        tool:
          summary.source === 'knowledge_base'
            ? 'knowledge_base_search'
            : summary.source === 'associated_event_api'
              ? 'associated_event_lookup'
              : 'agent_api_purchase_lookup',
        output: JSON.stringify({
          request_id: summary.requestId,
          kind: summary.kind,
          status: summary.status,
          result_count: summary.resultCount,
          duration_ms: summary.durationMs,
        }),
      });
    }
  }

  private informationTurnDecision(reason: string): TurnDecision {
    return turnDecisionSchema.parse({
      nextNode: 'resolver_consultas_informativas',
      routeKind: 'information_batch',
      providerSearchMode: 'none',
      presentationScope: 'information_batch',
      focusNeedCategory: null,
      needsToSearch: [],
      needsToPresent: [],
      stopReason: null,
      persistReason: reason,
      invariantStatus: 'valid',
      invariantViolations: [],
    });
  }

  private sumTokenUsage(...usages: Array<TokenUsage | null>): TokenUsage | null {
    if (!usages.some((usage) => usage)) {
      return null;
    }

    return {
      input_tokens: usages.reduce((total, usage) => total + (usage?.input_tokens ?? 0), 0),
      output_tokens: usages.reduce((total, usage) => total + (usage?.output_tokens ?? 0), 0),
      total_tokens: usages.reduce((total, usage) => total + (usage?.total_tokens ?? 0), 0),
      cached_input_tokens: usages.reduce(
        (total, usage) => total + (usage?.cached_input_tokens ?? 0),
        0,
      ),
      cache_write_input_tokens: usages.reduce(
        (total, usage) => total + (usage?.cache_write_input_tokens ?? 0),
        0,
      ),
    };
  }

  private resolveFaqAmbiguityNote(extraction: ExtractionResult): string | null {
    if (extraction.ambiguity?.status !== 'ambiguous') {
      return null;
    }

    return 'La extracción estructurada marcó esta pregunta como ambigua. Responde solamente con una pregunta breve que aclare a qué se refiere el usuario. No contestes ninguna de las interpretaciones posibles ni agregues datos de la base de conocimiento.';
  }

  private enforceFaqAmbiguityReply(
    currentNode: DecisionNode,
    extraction: ExtractionResult,
    reply: ComposeReplyResult,
  ): ComposeReplyResult {
    if (
      (
        currentNode !== 'resolver_consultas_informativas'
      ) ||
      extraction.ambiguity?.status !== 'ambiguous'
    ) {
      return reply;
    }

    const candidate = extraction.ambiguity.clarificationQuestion?.trim() ?? '';
    const interpretations = Array.from(new Set(
      (extraction.ambiguity.interpretations ?? [])
        .map((interpretation) => interpretation.trim())
        .filter((interpretation) =>
          interpretation.length > 0 &&
          interpretation.length <= 100 &&
          !interpretation.includes('\n') &&
          !interpretation.includes('?') &&
          !interpretation.includes('¿'),
        ),
    )).slice(0, 3);
    const questionMarkCount = candidate.match(/\?/gu)?.length ?? 0;
    const openingQuestionMarkCount = candidate.match(/¿/gu)?.length ?? 0;
    const isValidSingleQuestion =
      candidate.length > 0 &&
      candidate.length <= 240 &&
      !candidate.includes('\n') &&
      questionMarkCount === 1 &&
      openingQuestionMarkCount <= 1;
    const interpretationQuestion = interpretations.length >= 2
      ? `¿Quieres saber ${interpretations.length === 2
        ? `${interpretations[0]} o ${interpretations[1]}`
        : `${interpretations[0]}, ${interpretations[1]} o ${interpretations[2]}`}?`
      : null;
    const clarificationQuestion =
      interpretationQuestion ??
      (isValidSingleQuestion
        ? candidate
        : '¿Podrías indicar a qué información te refieres?');

    return {
      ...reply,
      text: clarificationQuestion,
      structuredMessage: undefined,
      recommendationFunnel: undefined,
    };
  }

  private enforceMissingFieldReply(
    currentNode: DecisionNode,
    missingFields: string[],
    reply: ComposeReplyResult,
  ): ComposeReplyResult {
    if (
      currentNode !== 'aclarar_pedir_faltante' ||
      !missingFields.includes('budget_or_guest_range')
    ) {
      return reply;
    }

    return {
      ...reply,
      text: '',
      structuredMessage: {
        type: 'generic',
        paragraphs_es: [
          'Para continuar con la búsqueda, ¿cuántos invitados esperas aproximadamente o qué presupuesto tienes?',
        ],
      },
    };
  }

  private enforceRepeatedOtpRecoveryReply(
    informationResults: InformationTaskResult[],
    plan: PlanSnapshot,
    reply: ComposeReplyResult,
  ): ComposeReplyResult {
    const hasRepeatedFailure = informationResults.some(
      (result) =>
        result.status === 'needs_input' &&
        result.guidance.reason === 'otp_repeated_failure',
    );
    if (!hasRepeatedFailure) {
      return reply;
    }

    const giftPaymentRequest = plan.information_state.pending_requests.find(
      (request) =>
        request.kind === 'purchase' &&
        request.resource === 'gift_purchases' &&
        request.aspects.includes('payment_details'),
    );
    const pendingQuery = giftPaymentRequest
      ? 'tu consulta sobre si el pago del regalo llegó a sus destinatarios y sobre su estado'
      : 'tu consulta pendiente';

    return {
      ...reply,
      text: '',
      structuredMessage: {
        type: 'generic',
        paragraphs_es: [
          `El código volvió a ser rechazado aunque tiene el formato esperado. Para no pedirte más intentos, conservaré ${pendingQuery}. Puedo solicitar apoyo humano para revisarla.`,
        ],
      },
    };
  }

  private enforcePhoneConfirmationReply(
    plan: PlanSnapshot,
    reply: ComposeReplyResult,
  ): ComposeReplyResult {
    if (!plan.user_auth.awaiting_phone_confirmation) {
      return reply;
    }

    const message =
      '¿El número desde el que escribes por WhatsApp está registrado en tu cuenta?';
    return {
      ...reply,
      text: message,
      structuredMessage: {
        type: 'generic',
        paragraphs_es: [message],
      },
    };
  }

  private resolveUserAuthEmail(plan: PlanSnapshot, userMessage: string): string | null {
    const contactEmail = this.normalizeUserEmailSpacing(plan.contact_email);
    const messageEmail = this.extractEmailFromText(userMessage);
    const externalUserEmail = this.normalizeUserEmailSpacing(plan.external_user_id);

    return (
      messageEmail ??
      (this.isValidEmail(contactEmail) ? contactEmail : null) ??
      (this.isValidEmail(externalUserEmail) ? externalUserEmail : null) ??
      contactEmail
    );
  }

  private extractEmailFromText(text: string): string | null {
    const normalized = this.normalizeUserEmailSpacing(text);
    return normalized?.match(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/iu,
    )?.[0] ?? null;
  }

  private normalizeUserEmailSpacing(value: string | null): string | null {
    if (!value) {
      return null;
    }

    return value.trim().replace(/\s*@\s*/gu, '@');
  }

  private extractUserLoginCode(text: string): string | null {
    const matches = text.match(/\b[A-Za-z0-9]{4,8}\b/gu) ?? [];
    return matches.find((match) => /\d/u.test(match)) ?? null;
  }

  private hasValidUserAuthToken(plan: PlanSnapshot): boolean {
    return hasValidUserAuthToken(plan);
  }

  private resetUserAuth(
    plan: PlanSnapshot,
    email: string | null,
    lastError: string | null = null,
  ): PlanSnapshot {
    return mergePlan(plan, {
      user_auth: {
        status: 'none',
        email,
        token: null,
        token_expires_at: null,
        last_error: lastError,
        requested_at: null,
        failed_code_attempts: 0,
        auth_method: null,
        awaiting_phone_confirmation: false,
      },
    });
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

  private async runResponseClassifierPreflight(args: {
    inbound: NormalizedInboundMessage;
    plan: PlanSnapshot;
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    skipClassification: boolean;
  }): Promise<{
    trace: MessageResponseClassifierTrace;
    tokenUsage: TokenUsage | null;
    openAiCall?: OpenAiCallRef | null;
  }> {
    const classifier = this.dependencies.responseClassifier;
    if (!classifier) {
      throw new Error('Response classifier was not configured.');
    }

    const messages = args.messageContext.recentMessages;
    const contextSource = args.messageContext.contextSource;

    if (args.skipClassification) {
      return {
        trace: {
          mode: classifier.mode,
          action: 'respond',
          reason: 'requires_response',
          would_suppress: false,
          context_source: contextSource,
          has_prior_outbound_message: messages.some((message) => message.direction === 'outbound'),
          fallback_used: false,
          conversation_health: 'uncertain',
          health_reason: 'insufficient_context',
          human_help_response: 'not_applicable',
          automation_confidence: 'uncertain',
          automation_pattern: 'none',
          automation_scope: 'none_or_uncertain',
          prompt_bundle_id: null,
          prompt_file_paths: [],
        },
        tokenUsage: null,
      };
    }

    if (args.messageContext.historyStatus === 'unavailable') {
      return {
        trace: {
          mode: classifier.mode,
          action: 'respond',
          reason: 'conversation_context_unavailable',
          would_suppress: false,
          context_source: contextSource,
          has_prior_outbound_message: false,
          fallback_used: true,
          conversation_health: 'uncertain',
          health_reason: 'insufficient_context',
          human_help_response: 'not_applicable',
          automation_confidence: 'uncertain',
          automation_pattern: 'none',
          automation_scope: 'none_or_uncertain',
          prompt_bundle_id: null,
          prompt_file_paths: [],
        },
        tokenUsage: null,
      };
    }

    this.recordDeterministicToolInput(args.toolUsage, 'classify_reply_delivery', {
      model: 'configured',
      context_source: contextSource,
      history_status: args.messageContext.historyStatus,
      recent_message_count: messages.length,
    });
    const result = await classifier.classify({
      inboundText: args.inbound.text,
      plan: args.plan,
      messages,
      contextSource,
    });
    this.recordDeterministicToolOutput(
      args.toolUsage,
      'classify_reply_delivery',
      result.trace,
    );
    return result;
  }

  private async prepareTurnMessageContext(args: {
    inbound: NormalizedInboundMessage;
    plan: PlanSnapshot;
    gateway: AgentConversationGateway;
    gatewayConfigured: boolean;
    toolUsage: ToolUsage;
  }): Promise<TurnMessageContext> {
    const phoneNumber = this.resolveEscalationPhone(args.inbound, args.plan);
    if (!args.gatewayConfigured) {
      return localTurnMessageContext('not_configured');
    }
    if (!phoneNumber) {
      return localTurnMessageContext('missing_phone_number');
    }

    const recent = await this.getAgentConversationMessagesWithTrace(
      args.gateway,
      phoneNumber,
      args.toolUsage,
    );
    await this.logAgentMessageWithTrace(
      args.gateway,
      {
        phoneNumber,
        body: args.inbound.text,
        direction: 'inbound',
        whatsappMessageId: args.inbound.messageId,
        sentAt: args.inbound.receivedAt,
      },
      args.toolUsage,
    );

    if (recent.status !== 'success') {
      return recent.status === 'failed'
        ? unavailableTurnMessageContext()
        : localTurnMessageContext('not_configured');
    }
    return buildTurnMessageContext({
      messages: recent.messages,
      inbound: args.inbound,
    });
  }

  private async getAgentConversationMessagesWithTrace(
    gateway: AgentConversationGateway,
    phoneNumber: string,
    toolUsage: ToolUsage,
  ): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<Awaited<ReturnType<AgentConversationGateway['getRecentMessages']>>, { status: 'success' }>
  > {
    this.recordDeterministicToolInput(toolUsage, 'get_agent_conversation_messages', {
      phone_number: phoneNumber,
      auth: 'X-Agent-Key [redacted]',
    });
    let result: Awaited<ReturnType<AgentConversationGateway['getRecentMessages']>>;
    try {
      result = await gateway.getRecentMessages(phoneNumber);
    } catch (error) {
      result = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    this.recordDeterministicToolOutput(toolUsage, 'get_agent_conversation_messages', {
      status: result.status,
      ...(result.status === 'success'
        ? {
            message_count: result.messages.length,
            directions: result.messages.map((message) => message.direction),
            sources: result.messages.map((message) => message.source),
          }
        : this.redactAgentGatewayResult(result)),
    });
    return result;
  }

  private async logAgentMessageWithTrace(
    gateway: AgentConversationGateway,
    input: AgentMessageLogInput,
    toolUsage: ToolUsage,
  ): Promise<AgentGatewayResult> {
    this.recordDeterministicToolInput(toolUsage, 'log_agent_conversation_message', {
      phone_number: input.phoneNumber,
      direction: input.direction,
      body_length: input.body.length,
      whatsapp_message_id: input.whatsappMessageId ?? null,
    });
    let result: AgentGatewayResult;
    try {
      result = await gateway.logMessage(input);
    } catch (error) {
      result = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    this.recordDeterministicToolOutput(
      toolUsage,
      'log_agent_conversation_message',
      this.redactAgentGatewayResult(result),
    );
    return result;
  }

  private async requestHumanTakeoverWithTrace(
    gateway: AgentConversationGateway,
    phoneNumber: string,
    toolUsage: ToolUsage,
  ): Promise<AgentGatewayResult> {
    this.recordDeterministicToolInput(toolUsage, 'request_human_takeover', {
      phone_number: phoneNumber,
      auth: 'X-Agent-Key [redacted]',
    });
    const result = await gateway.requestHumanTakeover(phoneNumber);
    this.recordDeterministicToolOutput(
      toolUsage,
      'request_human_takeover',
      this.redactAgentGatewayResult(result),
    );
    return result;
  }

  private missingPhoneEscalationResult(): AgentGatewayResult {
    return {
      status: 'skipped',
      reason: 'missing_phone_number',
      message: 'Human escalation requires a phone number for the Agent API.',
    };
  }

  private redactAgentGatewayResult(result: AgentGatewayResult): Record<string, unknown> {
    if (result.status === 'success') {
      return {
        status: result.status,
        message: result.message,
      };
    }
    if (result.status === 'skipped') {
      return {
        status: result.status,
        reason: result.reason,
        message: result.message,
      };
    }
    return {
      status: result.status,
      error: result.error,
      retryable: result.retryable,
    };
  }

  private resolveEscalationPhone(
    inbound: NormalizedInboundMessage,
    plan: PlanSnapshot,
  ): string | null {
    return this.normalizePhone(inbound.contactPhone) ??
      this.normalizePhone(plan.contact_phone) ??
      this.normalizePhone(inbound.externalUserId);
  }

  private humanEscalationRequestedMessage(result: AgentGatewayResult): string {
    if (result.status === 'success') {
      return 'Listo, ya pedí apoyo. Una persona del equipo se unirá a esta conversación y te responderá por aquí. Mientras tanto, dejaré la conversación en sus manos';
    }

    return 'No pude registrar la solicitud automáticamente, pero dejé esta conversación para revisión manual. Una persona del equipo podrá continuar por aquí';
  }

  private conversationHealthHelpOfferMessage(): string {
    return 'Siento que no estamos avanzando como deberíamos. ¿Quieres que una persona del equipo se una a esta conversación para ayudarte?';
  }

  private reduceConversationHealth(
    previous: ConversationHealthState,
    trace: MessageResponseClassifierTrace,
  ): { state: ConversationHealthState; shouldOfferHelp: boolean } {
    if (trace.fallback_used) {
      return { state: previous, shouldOfferHelp: false };
    }

    const assessedAt = new Date().toISOString();
    if (previous.help_offer_status === 'offered') {
      if (trace.human_help_response === 'decline') {
        return {
          state: {
            status: 'progressing',
            reason: 'normal_progress',
            consecutive_non_progress_turns: 0,
            help_offer_status: 'declined',
            help_offered_at: previous.help_offered_at,
            last_assessed_at: assessedAt,
          },
          shouldOfferHelp: false,
        };
      }
      return {
        state: {
          ...previous,
          status: trace.conversation_health,
          reason: trace.health_reason,
          last_assessed_at: assessedAt,
        },
        shouldOfferHelp: false,
      };
    }

    const isNonProgress =
      trace.conversation_health === 'stalled' ||
      trace.conversation_health === 'frustrated';
    const consecutiveNonProgressTurns = isNonProgress
      ? previous.consecutive_non_progress_turns + 1
      : trace.conversation_health === 'progressing'
        ? 0
        : previous.consecutive_non_progress_turns;
    const offerStatus =
      previous.help_offer_status === 'declined' && trace.conversation_health === 'progressing'
        ? 'none'
        : previous.help_offer_status;
    const shouldOfferHelp =
      offerStatus === 'none' &&
      (trace.conversation_health === 'frustrated' || consecutiveNonProgressTurns >= 2);

    return {
      state: {
        status: trace.conversation_health,
        reason: trace.health_reason,
        consecutive_non_progress_turns: consecutiveNonProgressTurns,
        help_offer_status: shouldOfferHelp ? 'offered' : offerStatus,
        help_offered_at: shouldOfferHelp ? assessedAt : previous.help_offered_at,
        last_assessed_at: assessedAt,
      },
      shouldOfferHelp,
    };
  }

  private humanEscalationOperationalNote(result: AgentGatewayResult): string {
    if (result.status === 'success') {
      return 'Human takeover was requested through the Agent API.';
    }
    if (result.status === 'skipped') {
      return `Local human escalation soft-pause only: ${result.reason}.`;
    }
    return `Human escalation API call failed: ${result.error}`;
  }

  private humanEscalationTurnDecision(reason: string): TurnDecision {
    return turnDecisionSchema.parse({
      nextNode: 'solicitar_agente_humano',
      routeKind: 'human_escalation',
      providerSearchMode: 'none',
      presentationScope: 'human_escalation',
      focusNeedCategory: null,
      needsToSearch: [],
      needsToPresent: [],
      stopReason: reason,
      persistReason: 'solicitar_agente_humano',
      invariantStatus: 'valid',
      invariantViolations: [],
    });
  }

  private conversationHealthTurnDecision(reason: string): TurnDecision {
    return turnDecisionSchema.parse({
      nextNode: 'ofrecer_agente_humano',
      routeKind: 'human_help_offer',
      providerSearchMode: 'none',
      presentationScope: 'human_help_offer',
      focusNeedCategory: null,
      needsToSearch: [],
      needsToPresent: [],
      stopReason: reason,
      persistReason: 'conversation_health_help_offer',
      invariantStatus: 'valid',
      invariantViolations: [],
    });
  }

  private buildSyntheticEscalationExtraction(summary: string): ExtractionResult {
    return {
      actionIntent: 'solicitar_humano',
      informationRequests: [],
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
      conversationSummary: summary,
      selectedProviderHints: [],
      selectedProviderReferences: [],
      closeAction: null,
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
        rankingNotes: 'No aplica: el turno está escalado a revisión humana.',
      },
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
    };
  }

  private buildSyntheticSuppressionExtraction(reason: string): ExtractionResult {
    return this.buildSyntheticEscalationExtraction(
      `The response classifier suppressed delivery: ${reason}.`,
    );
  }

  private buildSyntheticConversationHealthExtraction(): ExtractionResult {
    return {
      ...this.buildSyntheticEscalationExtraction(
        'El monitor de salud conversacional ofreció apoyo humano opcional.',
      ),
      actionIntent: null,
      intentConfidence: 1,
    };
  }

  private buildSyntheticUnsupportedImageExtraction(): ExtractionResult {
    return {
      ...this.buildSyntheticEscalationExtraction(
        'Trusted channel metadata reported an image attachment.',
      ),
      actionIntent: null,
      intentConfidence: 1,
      informationRequests: [
        {
          kind: 'faq',
          query: 'capacidad para leer imágenes',
        },
      ],
      providerFitCriteria: null,
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
      extractionIntent: args.extraction.actionIntent,
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

  private decideNextTurn(
    evidence: DecisionEvidence,
    plan: PersistedPlan,
  ): TurnDecision {
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
    } else if (evidence.extractionIntent === 'solicitar_humano') {
      decision = {
        nextNode: 'solicitar_agente_humano',
        routeKind: 'human_escalation',
        providerSearchMode: 'none',
        presentationScope: 'human_escalation',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: null,
        persistReason: 'solicitar_agente_humano',
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
    } else if (evidence.hasAmbiguousSelection) {
      decision = {
        nextNode: 'aclarar_pedir_faltante',
        routeKind: 'clarify_missing_fields',
        providerSearchMode: 'none',
        presentationScope: 'clarification',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: evidence.sufficiencyByNeed
          .filter((need) => need.hasShortlist)
          .map((need) => need.category),
        stopReason: 'provider_selection_ambiguous',
        persistReason: 'aclarar_pedir_faltante',
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
      evidence.extractionProviderPlanOperationCount > 0 &&
      evidence.globalMissingFields.length > 0 &&
      !evidence.hasExistingShortlist
    ) {
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
      evidence.extractionIntent === 'retomar_plan' &&
      evidence.hasExistingShortlist
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

    const invariantResult = this.validateTurnDecisionInvariants(
      evidence,
      decision,
      plan,
    );
    if (invariantResult.invariantStatus === 'invalid') {
      const nextNode: DecisionNode = evidence.globalMissingFields.length > 0
        ? 'aclarar_pedir_faltante'
        : 'entrevista';
      return turnDecisionSchema.parse({
        nextNode,
        routeKind: evidence.globalMissingFields.length > 0
          ? 'clarify_missing_fields'
          : 'ask_event_context',
        providerSearchMode: 'none',
        presentationScope: 'clarification',
        focusNeedCategory: evidence.focusedNeedCategory,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: `dynamic_state_unavailable:${decision.nextNode}`,
        persistReason: nextNode,
        ...invariantResult,
      });
    }

    return turnDecisionSchema.parse({
      ...decision,
      ...invariantResult,
    });
  }

  private guardAmbiguousProviderConfirmation(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    userMessage: string,
  ): { extraction: ExtractionResult; ambiguous: boolean } {
    if (extraction.actionIntent !== 'confirmar_proveedor') {
      return { extraction, ambiguous: false };
    }

    const candidateCount = plan.provider_needs.reduce(
      (total, need) => total + need.recommended_providers.length,
      0,
    );
    if (candidateCount <= 1) {
      return { extraction, ambiguous: false };
    }

    if (this.hasGroundedSelectionReference(plan, extraction, userMessage)) {
      return { extraction, ambiguous: false };
    }

    return {
      ambiguous: true,
      extraction: {
        ...extraction,
        ambiguity: {
          status: 'ambiguous',
          clarificationQuestion: null,
          interpretations: [],
        },
        selectedProviderHints: [],
        selectedProviderReferences: [],
        providerPlanOperations: (
          extraction.providerPlanOperations ?? []
        ).filter((operation) => operation.type !== 'select_provider'),
      },
    };
  }

  private hasGroundedSelectionReference(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    userMessage: string,
  ): boolean {
    const normalizedMessage = this.normalizeSelectionText(userMessage);
    const messageTokens = new Set(
      normalizedMessage.split(/\s+/u).filter((token) => token.length >= 4),
    );
    const evidenceValues = [
      ...extraction.selectedProviderHints,
      ...(extraction.selectedProviderReferences ?? []).flatMap((reference) => [
        reference.providerTitle,
        reference.hint,
      ]),
    ].filter((value): value is string => Boolean(value?.trim()));

    const matchesGroundingText = (value: string): boolean => {
      const normalizedEvidence = this.normalizeSelectionText(value);
      if (
        normalizedEvidence.length >= 3 &&
        normalizedMessage.includes(normalizedEvidence)
      ) {
        return true;
      }
      const sharedTokens = new Set(
        normalizedEvidence
          .split(/\s+/u)
          .filter((token) => token.length >= 4 && messageTokens.has(token)),
      );
      return sharedTokens.size >= 2;
    };
    if (evidenceValues.some(matchesGroundingText)) {
      return true;
    }

    const activeNeed = getActiveNeed(plan);
    const needsWithProviders = [
      ...(activeNeed?.recommended_providers.length ? [activeNeed] : []),
      ...plan.provider_needs.filter(
        (need) =>
          need.category !== activeNeed?.category &&
          need.recommended_providers.length > 0,
      ),
    ];
    const providersFromReferences = (
      extraction.selectedProviderReferences ?? []
    ).flatMap((reference) => {
      const resolved = this.resolveProviderReference(
        plan,
        reference,
        reference.category,
      );
      return resolved ? [resolved.provider] : [];
    });
    const providersFromHints = extraction.selectedProviderHints.flatMap((hint) =>
      this.resolveProviderSelections(needsWithProviders, activeNeed, hint)
        .map((selection) => selection.selectedProvider),
    );
    const referencedProviders = new Map(
      [...providersFromReferences, ...providersFromHints]
        .map((provider) => [provider.id, provider]),
    );

    return Array.from(referencedProviders.values()).some((provider) => {
      const owningNeed = plan.provider_needs.find((need) =>
        need.recommended_provider_ids.includes(provider.id),
      );
      return [
        provider.title,
        provider.location,
        provider.reason,
        provider.descriptionSnippet,
        provider.promoSummary,
        ...provider.serviceHighlights,
        ...provider.termsHighlights,
        ...(owningNeed?.preferences ?? []),
        ...(owningNeed?.hard_constraints ?? []),
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .some(matchesGroundingText);
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
      extraction.actionIntent === 'buscar_proveedores' &&
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
        extraction.actionIntent === 'buscar_proveedores' ||
        extraction.actionIntent === 'confirmar_proveedor' ||
        extraction.actionIntent === 'refinar_busqueda'
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
        extraction.actionIntent === 'buscar_proveedores' ||
        extraction.actionIntent === 'refinar_busqueda'
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
    plan: PersistedPlan,
  ): Pick<TurnDecision, 'invariantStatus' | 'invariantViolations'> {
    const violations: string[] = [];
    const policy = deriveDynamicAgentPolicy(plan);

    if (!policy.allowedNextNodes.includes(decision.nextNode)) {
      violations.push(`next_node_not_available:${decision.nextNode}`);
    }

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
      args.currentNode === 'resolver_consultas_informativas'
        ? 'information_batch'
        : args.currentNode === 'solicitar_agente_humano'
          ? 'human_escalation'
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
      routeKind: args.currentNode === 'resolver_consultas_informativas'
        ? 'information_batch'
        : args.currentNode === 'solicitar_agente_humano'
          ? 'human_escalation'
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
    tokenUsage: TurnTokenUsage;
    responseClassifier?: MessageResponseClassifierTrace;
    messageContext: TurnMessageContext;
    searchStrategy: SearchStrategyTrace;
    turnDecision?: TurnDecision;
    sessionFocusUsed?: boolean;
    sessionFocusKeyPresent?: boolean;
    operationalNote: string | null;
    informationExecution?: InformationExecutionSummary[];
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
      intent: args.extraction.actionIntent,
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
      information_execution_summary: args.informationExecution ?? [],
      plan_persisted: args.planPersisted,
      plan_persist_reason: args.planPersistReason,
      timing_ms: args.timingMs,
      token_usage: {
        classifier: args.tokenUsage.classifier,
        extraction: args.tokenUsage.extraction,
        reply: args.tokenUsage.reply,
        total: args.tokenUsage.total,
      },
      openai_calls: {
        classifier: args.tokenUsage.openAiCalls.classifier,
        extraction: args.tokenUsage.openAiCalls.extraction,
        reply: args.tokenUsage.openAiCalls.reply,
      },
      response_classifier: args.responseClassifier,
      message_context: {
        history_status: args.messageContext.historyStatus,
        context_source: args.messageContext.contextSource,
        retrieved_message_count: args.messageContext.retrievedMessageCount,
        recent_message_count: args.messageContext.recentMessages.length,
        excluded_current_message_count:
          args.messageContext.excludedCurrentMessageCount,
        directions: args.messageContext.recentMessages.map(
          (message) => message.direction,
        ),
        sources: args.messageContext.recentMessages.map(
          (message) => message.source,
        ),
        entry_source: args.messageContext.entryMessage?.source ?? null,
      },
    };
  }

  private summarizeExtraction(
    extraction: ExtractionResult,
    contactValidationSummary: ContactValidationDebugSummary,
  ): ExtractionDebugSummary {
    return {
      intent_confidence: extraction.intentConfidence,
      information_request_count: extraction.informationRequests.length,
      information_request_kinds: extraction.informationRequests.map(
        (request) => request.kind,
      ),
      ambiguity_status: extraction.ambiguity?.status ?? null,
      clarification_question_present: Boolean(
        extraction.ambiguity?.clarificationQuestion,
      ),
      ambiguity_interpretation_count:
        extraction.ambiguity?.interpretations?.length ?? 0,
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
      user_auth_status: plan.user_auth.status,
      pending_information_request_count:
        plan.information_state.pending_requests.length,
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

  private resolveExtractionNode(
    plan: PersistedPlan,
    extraction: ExtractionResult,
  ): DecisionNode {
    if (!plan.intent && !plan.event_type) {
      return 'deteccion_intencion';
    }

    if (extraction.actionIntent === 'refinar_busqueda' || extraction.actionIntent === 'ver_opciones') {
      return 'refinar_criterios';
    }

    if (extraction.actionIntent === 'elicitar_necesidades') {
      return 'elicitacion_necesidades';
    }

    if (
      extraction.actionIntent === 'modificar_plan_proveedores' ||
      extraction.actionIntent === 'explicar_recomendacion' ||
      extraction.actionIntent === 'detallar_proveedor'
    ) {
      return 'seguir_refinando_guardar_plan';
    }

    if (extraction.actionIntent === 'confirmar_proveedor') {
      return 'usuario_elige_proveedor';
    }

    if (extraction.actionIntent === 'solicitar_humano') {
      return 'solicitar_agente_humano';
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
    const guardedExtraction = this.guardImplicitVenueNeed(plan, extraction);
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
    const nextPhoneParts = splitInternationalPhone(nextPhone);
    const phoneValidationError =
      normalizedExtractorPhone || inferredPhone || normalizedChannelPhone
        ? null
        : this.describePhoneValidationError(guardedExtraction.contactPhone) ??
          this.describePhoneValidationError(inferredPhoneCandidate);

    const nextEmail = guardedExtraction.contactEmail ?? plan.contact_email;
    const nextName = guardedExtraction.contactName ?? plan.contact_name;

    const candidate = mergePlan(plan, {
      current_node: extractionNode,
      intent: guardedExtraction.actionIntent ?? plan.intent,
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
      ...(nextPhoneParts
        ? {
            contact_phone_extension: nextPhoneParts.phone_extension,
            contact_phone_number: nextPhoneParts.phone_number,
          }
        : {}),
      provider_needs: this.buildNeedUpdates(plan, guardedExtraction),
      last_user_goal: guardedExtraction.actionIntent ?? plan.last_user_goal,
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
        ...(phoneValidationError
          ? {
              contact_phone_extension: plan.contact_phone_extension,
              contact_phone_number: plan.contact_phone_number,
            }
          : {}),
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
  ): ExtractionResult {
    const hasStructuredVenueEvidence =
      normalizeToProviderCategory(extraction.providerFitCriteria?.needCategory) === 'Locales' ||
      (extraction.providerQueryIntents ?? []).some(
        (queryIntent) => queryIntent.category === 'Locales',
      );
    if (
      getActiveNeed(plan)?.category ||
      hasStructuredVenueEvidence
    ) {
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
    if (extraction.actionIntent !== 'elicitar_necesidades') {
      return extraction;
    }
    if (this.hasStructuredPlanningSignal(extraction)) {
      return extraction;
    }

    return {
      ...extraction,
      actionIntent: null,
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
    intent: ExtractionResult['actionIntent'],
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
    intent: ExtractionResult['actionIntent'],
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
    intent: ExtractionResult['actionIntent'],
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
      extraction.actionIntent !== 'elicitar_necesidades' &&
      extraction.actionIntent !== 'buscar_proveedores'
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

    if (this.shouldBroadenProviderSearch(baselinePlan, extraction.actionIntent, extraction)) {
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
    if (extraction.actionIntent === 'elicitar_necesidades') {
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

  private guardCloseIntentWithoutEstablishedPlan(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): ExtractionResult {
    const hasEstablishedPlan =
      plan.event_type !== null ||
      plan.provider_needs.length > 0;
    if (extraction.actionIntent !== 'cerrar' || hasEstablishedPlan) {
      return extraction;
    }

    return {
      ...extraction,
      actionIntent: null,
      closeAction: null,
    };
  }

  private preserveContactPhoneCandidate(
    extraction: ExtractionResult,
    userMessage: string,
  ): ExtractionResult {
    if (extraction.contactPhone !== null) {
      return extraction;
    }

    const candidate = this.extractContactPhoneCandidate(userMessage);
    return candidate === null
      ? extraction
      : { ...extraction, contactPhone: candidate };
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
      /\b\d{1,5}\b/u,
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

  private renderOutbound(
    reply: { text: string; structuredMessage?: StructuredMessage },
    providerResults: ProviderSummary[],
    channel: string,
    conversationId: string | null,
    plan?: PlanSnapshot,
  ): NormalizedOutboundMessage {
    const structuredMessage = this.enforceContactRequestFields(
      reply.structuredMessage,
      plan,
    );
    const structuredMessageKind = structuredMessage?.type ?? null;
    if (structuredMessage) {
      const renderer = this.dependencies.renderers[channel]
        ?? this.dependencies.renderers['whatsapp'];
      if (renderer) {
        return {
          text: this.sanitizeAssistantOutput(renderer.render({
            message: structuredMessage,
            providerResults,
          })),
          conversationId,
          structuredMessageKind,
          delivery: {
            action: 'send',
            reason: 'reply_composed',
          },
        };
      }
    }

    return {
      text: this.sanitizeAssistantOutput(reply.text),
      conversationId,
      structuredMessageKind,
      delivery: {
        action: 'send',
        reason: 'reply_composed',
      },
    };
  }

  private enforceContactRequestFields(
    message: StructuredMessage | undefined,
    plan: PlanSnapshot | undefined,
  ): StructuredMessage | undefined {
    if (!message || !plan) {
      return message;
    }

    if (plan.lifecycle_state === 'finished') {
      const destination = this.selectedProviderDestination(plan);
      return {
        type: 'generic',
        paragraphs_es: [
          `Las solicitudes de cotización fueron enviadas a ${destination}. Los proveedores se pondrán en contacto contigo por correo electrónico o teléfono.`,
        ],
      };
    }

    const hasCompleteContact = Boolean(
      plan.contact_name && plan.contact_email && plan.contact_phone,
    );
    if (hasCompleteContact && message.type === 'close_confirmation') {
      return {
        ...message,
        summary_es: this.completeContactConfirmation(plan),
      };
    }
    if (hasCompleteContact && message.type === 'contact_request') {
      return {
        type: 'generic',
        paragraphs_es: [this.completeContactConfirmation(plan)],
      };
    }
    if (message.type !== 'contact_request') {
      return message;
    }

    const requestedFields = (message.requested_fields_es ?? []).filter(
      (field) =>
        (field === 'full_name' && !plan.contact_name) ||
        (field === 'email' && !plan.contact_email) ||
        (field === 'phone' && !plan.contact_phone),
    );
    return {
      ...message,
      requested_fields_es: requestedFields,
    };
  }

  private completeContactConfirmation(plan: PlanSnapshot): string {
    const destination = this.selectedProviderDestination(plan);
    return `Ya tengo tu nombre, correo electrónico y teléfono. ¿Confirmas que envíe la solicitud de cotización a ${destination}?`;
  }

  private selectedProviderDestination(plan: PlanSnapshot): string {
    const selectedNames = plan.provider_needs.flatMap((need) => {
      const titles = need.recommended_providers
        .filter((provider) => need.selected_provider_ids.includes(provider.id))
        .map((provider) => provider.title);
      return titles.length > 0 ? titles : need.selected_provider_hints;
    });
    const uniqueNames = Array.from(new Set(selectedNames));
    const destination = uniqueNames.length > 0
      ? uniqueNames.join(', ')
      : 'los proveedores seleccionados';
    return destination;
  }

  private suppressOutbound(
    conversationId: string | null,
    reason: string,
  ): NormalizedOutboundMessage {
    return {
      text: null,
      conversationId,
      structuredMessageKind: null,
      delivery: {
        action: 'suppress',
        reason,
      },
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
