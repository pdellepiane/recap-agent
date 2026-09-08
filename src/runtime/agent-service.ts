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
  informationPaymentOptionsPolicyRequestId,
  informationValidationPolicyRequestId,
  type ExtractedInformationRequest,
  type InformationAuthReason,
  type InformationExecutionSummary,
  type InformationSelectionCandidate,
  type InformationSupportAct,
  type InformationTaskResult,
  type CompletedInformationRequest,
  type PendingInformationRequest,
  type PurchaseAspect,
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
  ToolOutputTrace,
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
  RsvpPhoneReplyEvidence,
  ToolUsage,
} from './contracts';
import type { TokenUsage } from './contracts';
import type { OpenAiCallRef } from './contracts';
import { extractOtpCode } from './otp-normalization';
import {
  consumeVerificationAttempt,
  decideTerminalContinuation,
  normalizeLegacyAuthRecovery,
} from './information-auth-state-machine';
import { normalizeExtractedOrderReference } from '../core/order-reference';
import { deriveDynamicAgentPolicy } from './dynamic-agent-policy';
import { eventMatches } from './event-matching';
import {
  NoopAgentConversationGateway,
  type AgentConversationGateway,
  type AgentGatewayResult,
  type AgentAuthByPhoneResult,
  type AgentMessageLogInput,
  type AgentConversationMessage,
  type AgentGuestRsvpResult,
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
import {
  buildRuntimeCapabilityManifest,
  resolveCapabilityDecision,
  type CapabilityDecision,
  type RuntimeCapabilityManifest,
  type RuntimeOperationId,
} from './capability-manifest';
import {
  CapabilityBoundaryRenderer,
  defaultCapabilityBoundaryMessages,
} from './capability-boundary-renderer';
import { NoopKnowledgeRetrievalGateway } from './knowledge-retrieval-gateway';
import {
  buildTurnMessageContext,
  deriveConversationContinuity,
  localTurnMessageContext,
  unavailableTurnMessageContext,
  withConversationContinuity,
  type TurnMessageContext,
} from './turn-message-context';
import {
  hasActivePurchaseThread,
  purchaseThreadBypassesContextualClarification,
  purchaseThreadSuppressesHealthOffer,
} from './conversation-continuity-policy';
import {
  renderConciseApprovedStatus,
  renderConciseTransferValidation,
  renderNeutralPurchaseSelection,
  renderOrderPlusCartCheckout,
  resolveCapabilityPurchaseContinuation,
  shouldRenderConciseApprovedStatus,
  shouldRenderConciseTransferValidation,
  shouldRenderNeutralSelection,
  shouldRenderOrderPlusCartCheckout,
} from './purchase-reply-projector';
import {
  createAuthOperationId,
  logAuthObservabilityEvent,
  withAuthenticationFlowContext,
} from './auth-observability';

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

type RsvpInvitationState = 'pending' | 'attending' | 'declining' | 'unknown';

type RsvpInvitation = {
  eventId: number | null;
  guestId: number | null;
  eventName: string | null;
  eventDate: string | null;
  state: RsvpInvitationState;
  accessMethod:
    | 'guest_record'
    | 'trusted_phone_event'
    | 'phone_enriched_event';
};

type RsvpPhoneEvidence = {
  coverage: 'complete' | 'partial';
  resolution:
    | 'authoritative_invitation'
    | 'event_association_only'
    | 'not_found';
  invitations: RsvpInvitation[];
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
  rsvp_execution: number;
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

type CapabilitySafeReadOutcome = {
  results: InformationTaskResult[];
  summaries: InformationExecutionSummary[];
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
  private readonly capabilityManifest: RuntimeCapabilityManifest;
  private readonly capabilityBoundaryRenderer: CapabilityBoundaryRenderer;
  private capabilityBoundaryRendererLoad: Promise<CapabilityBoundaryRenderer> | null = null;

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
      capabilityManifest?: RuntimeCapabilityManifest;
      capabilityBoundaryRenderer?: CapabilityBoundaryRenderer;
    },
  ) {
    this.capabilityManifest = dependencies.capabilityManifest ??
      dependencies.agentConversationGateway?.capabilityDescriptor ??
      buildRuntimeCapabilityManifest({
        configured: Boolean(dependencies.agentConversationGateway),
        environment: 'production',
        allowCustomerWrites: true,
      });
    this.capabilityBoundaryRenderer = dependencies.capabilityBoundaryRenderer ??
      new CapabilityBoundaryRenderer(defaultCapabilityBoundaryMessages);
  }

  private async loadCapabilityBoundaryRenderer(): Promise<CapabilityBoundaryRenderer> {
    if (this.dependencies.capabilityBoundaryRenderer) {
      return this.capabilityBoundaryRenderer;
    }
    this.capabilityBoundaryRendererLoad ??= this.dependencies.promptLoader
      .loadCapabilityBoundaryMessages()
      .then((messages) => new CapabilityBoundaryRenderer(messages));
    return await this.capabilityBoundaryRendererLoad;
  }

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
      rsvp_execution: 0,
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
    let sessionFocus =
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
    const messageContextStartedAt = Date.now();
    const rawMessageContext = await this.prepareTurnMessageContext({
      inbound,
      plan: classifierPlan,
      gateway: agentConversationGateway,
      gatewayConfigured: Boolean(this.dependencies.agentConversationGateway),
      toolUsage,
    });
    const messageContext = withConversationContinuity(rawMessageContext, classifierPlan);
    timingMs.response_classification += Date.now() - messageContextStartedAt;
    if (inbound.text.trim().length === 0 && (inbound.media?.length ?? 0) > 0) {
      return await this.handleMediaOnlyMessage({
        inbound,
        plan: existingPlan ?? classifierPlan,
        messageContext,
        toolUsage,
        timingMs,
        tokenUsage,
        handleTurnStartedAt,
      });
    }
    let responseClassifierTrace: MessageResponseClassifierTrace | undefined;
    if (this.dependencies.responseClassifier) {
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
      // One-shot OTP retention (F1): a code arriving after a rejected-code
      // handoff must not verify again. Record the already-requested handoff
      // without a second gateway effect and retain the human path with the
      // preserved request. Prose follow-ups still take the suppress path.
      if (
        this.extractUserLoginCode(inbound.text) !== null &&
        existingPlan.user_auth.status === 'code_requested' &&
        existingPlan.user_auth.failed_code_attempts >= 1
      ) {
        return await this.retainTerminalOtpHandoff({
          inbound,
          existingPlan,
          toolUsage,
          timingMs,
          tokenUsage,
          responseClassifierTrace,
          messageContext,
          handleTurnStartedAt,
        });
      }
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

    if (responseClassifierTrace) {
      const previousHealth = classifierPlan.conversation_health;
      const healthUpdate = this.reduceConversationHealth(previousHealth, responseClassifierTrace);
      const purchaseThreadActive = hasActivePurchaseThread({
        hasPendingPurchaseOrEventRequest: classifierPlan.information_state.pending_requests.some(
          (request) => request.kind === 'purchase' || request.kind === 'associated_event',
        ),
        lastCompletedKind: classifierPlan.information_state.last_completed_request?.kind ?? null,
      }) ||
        messageContext.continuity?.lane === 'purchase_support' ||
        messageContext.continuity?.lane === 'event_support';
      if (
        purchaseThreadActive &&
        purchaseThreadSuppressesHealthOffer({
          hasActivePurchaseThread: purchaseThreadActive,
          humanEscalationRequested: classifierPlan.human_escalation.status === 'requested',
        })
      ) {
        healthUpdate.shouldOfferHelp = false;
        healthUpdate.state = {
          ...healthUpdate.state,
          help_offer_status: previousHealth.help_offer_status,
          help_offered_at: previousHealth.help_offered_at,
        };
      }
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
        const phoneNumber = this.resolveEscalationPhone(inbound);
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
        media: inbound.media?.map((item) => ({
          kind: item.kind,
          mimeType: item.mimeType,
          fileName: item.fileName,
        })),
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

      const finishedCapabilityBoundaryResponse = await this.handleCapabilityBoundaryIfNeeded({
        inbound,
        previousNode: existingPlan.current_node,
        plan: existingPlan,
        extraction: finishedExtraction,
        toolUsage,
        timingMs,
        tokenUsage,
        responseClassifierTrace,
        messageContext,
        handleTurnStartedAt,
      });
      if (finishedCapabilityBoundaryResponse) {
        return finishedCapabilityBoundaryResponse;
      }

      if (this.hasRsvpWork(existingPlan, finishedExtraction)) {
        return await this.handleRsvpFlow({
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
          gateway: agentConversationGateway,
        });
      }

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
        finishedExtraction.actionIntent === 'reset_plan' ||
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
    let workingPlan = mergePlan(planToResume, {
      current_node: existingPlan ? resolveResumeNode(planToResume) : 'deteccion_intencion',
    });
    timingMs.prepare_working_plan += Date.now() - prepareWorkingPlanStartedAt;

    const extractionStartedAt = Date.now();
    const rawExtractionResult = await this.dependencies.runtime.extract({
      userMessage: inbound.text,
      plan: workingPlan,
      messageContext,
      media: inbound.media?.map((item) => ({
        kind: item.kind,
        mimeType: item.mimeType,
        fileName: item.fileName,
      })),
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
    const capabilityBoundaryResponse = await this.handleCapabilityBoundaryIfNeeded({
      inbound,
      previousNode,
      plan: workingPlan,
      extraction,
      toolUsage,
      timingMs,
      tokenUsage,
      responseClassifierTrace,
      messageContext,
      handleTurnStartedAt,
    });
    if (capabilityBoundaryResponse) {
      return capabilityBoundaryResponse;
    }
    if (this.shouldUseContextualClarification(messageContext, classifierPlan, extraction)) {
      return await this.handleContextualClarification({
        inbound,
        previousNode: existingPlan?.current_node ?? 'contacto_inicial',
        plan: classifierPlan,
        extraction,
        toolUsage,
        tokenUsage,
        responseClassifierTrace,
        messageContext,
        timingMs,
        handleTurnStartedAt,
      });
    }
    if (extraction.actionIntent === 'reset_plan') {
      workingPlan = createEmptyPlan({
        planId: ulid(),
        channel: inbound.channel,
        externalUserId: inbound.externalUserId,
      });
      sessionFocus = null;
    }
    const providerConfirmationGuard = this.guardAmbiguousProviderConfirmation(
      workingPlan,
      extraction,
      inbound.text,
    );
    extraction = providerConfirmationGuard.extraction;
    if (
      this.hasRsvpWork(workingPlan, extraction) &&
      extraction.actionIntent !== 'pausar' &&
      extraction.actionIntent !== 'solicitar_humano'
    ) {
      return await this.handleRsvpFlow({
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
        gateway: agentConversationGateway,
      });
    }
    if (
      this.hasInformationWork(workingPlan, extraction) &&
      extraction.actionIntent !== 'pausar' &&
      (extraction.actionIntent !== 'solicitar_humano' ||
        extraction.informationRequests.some((request) =>
          request.kind === 'faq' && request.hostWithdrawal))
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
      const phoneNumber = this.resolveEscalationPhone(inbound);
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

    if (turnDecision.routeKind === 'reset_plan') {
      currentNode = 'reset_plan';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      planAfterFlow = mergePlan(planAfterFlow, {
        current_node: currentNode,
      });
    } else if (turnDecision.nextNode === 'elicitacion_necesidades') {
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
    const reply = this.enforceAmbiguousProviderConfirmationReply(
      providerConfirmationGuard.ambiguous,
      this.enforceMissingFieldReply(
        currentNode,
        sufficiency.missingFields,
        this.enforceFaqAmbiguityReply(
          currentNode,
          extraction,
          composedReply,
        ),
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
    planPersisted = true;
    planPersistReason = planPersistReason ?? currentNode;
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

  private hasRsvpWork(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): boolean {
    const hasExplicitRsvpSelection =
      (extraction.actionIntent === 'responder_invitacion' &&
        extraction.rsvpDecisionSource === 'current_message' && extraction.informationRequests.length === 0) ||
      (extraction.rsvpAction !== null &&
        extraction.rsvpAction !== undefined &&
        extraction.rsvpDecisionSource === 'current_message') ||
      (extraction.rsvpCandidateGuestId !== null &&
        extraction.rsvpCandidateGuestId !== undefined) ||
      extraction.rsvpParty?.plus_one_response === 'yes' ||
      extraction.rsvpParty?.plus_one_response === 'no' ||
      extraction.rsvpParty?.scope === 'self_and_others';
    if (extraction.supportAct && !hasExplicitRsvpSelection) return false;
    if (
      (extraction.informationRequests.length > 0 ||
        plan.information_state.pending_requests.length > 0 ||
        plan.information_state.last_completed_request !== null) &&
      plan.rsvp_state.status === 'none' &&
      !hasExplicitRsvpSelection
    ) {
      return false;
    }

    return (
      plan.rsvp_state.status !== 'none' ||
      extraction.actionIntent === 'responder_invitacion' ||
      hasExplicitRsvpSelection ||
      (extraction.rsvpEventReference !== null &&
        extraction.rsvpEventReference !== undefined)
    );
  }

  private async handleRsvpFlow(args: {
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
    gateway: AgentConversationGateway;
  }): Promise<HandleTurnResponse> {
    const currentNode: DecisionNode = 'responder_invitacion';
    const pendingState = args.workingPlan.rsvp_state;
    const rawRsvpAction = args.extraction.rsvpAction ?? null;
    const decisionSource = args.extraction.rsvpDecisionSource === 'current_message' ? 'current_message' : 'plan_state';
    const validatedRsvpAction = decisionSource === 'current_message' ? rawRsvpAction : null;
    const extractedPlusOneResponse = args.extraction.rsvpParty?.plus_one_response;
    const isReadOnlyStateQuery = decisionSource === 'current_message' && rawRsvpAction === null &&
      extractedPlusOneResponse !== 'yes' && extractedPlusOneResponse !== 'no';
    const action = validatedRsvpAction
      ?? (!isReadOnlyStateQuery && pendingState.status === 'awaiting_event_selection' ? pendingState.pending_action : null);
    const plusOneResponse = extractedPlusOneResponse === 'yes' || extractedPlusOneResponse === 'no'
      ? extractedPlusOneResponse
      : !isReadOnlyStateQuery && pendingState.status === 'awaiting_event_selection'
        ? pendingState.pending_plus_one_response ?? null
        : null;
    let result: AgentGuestRsvpResult | null = null;
    let operationalNote: string;
    let nextRsvpState = pendingState;
    let deterministicReplyText: string | null = null;
    let deterministicIsDecliningOffer = false;
    let deterministicReplyIsComplete = false;

    const handoffParty = args.extraction.rsvpParty;
    const hasExplicitSingleCompanionEvidence = handoffParty?.companion_count === 'one' || (
      (handoffParty?.plus_one_response === 'yes' || handoffParty?.plus_one_response === 'no') &&
      handoffParty.mentioned_names.length <= 1
    );
    const requiresMultiCompanionHandoff = handoffParty?.scope === 'self_and_others' && (
      handoffParty.companion_count === 'multiple' ||
      handoffParty.mentioned_names.length > 1 ||
      !hasExplicitSingleCompanionEvidence
    );
    if (requiresMultiCompanionHandoff && handoffParty) {
      const handoffFragment = this.renderRsvpHandoffFragment(handoffParty);
      const handoffPhoneNumber = this.resolveEscalationPhone(args.inbound);
      const dedupeKey = `rsvp_handoff:${args.workingPlan.conversation_id ?? args.workingPlan.plan_id}`;
      const isDeduped = args.workingPlan.assumptions.includes(dedupeKey);
      if (isDeduped) {
        logAuthObservabilityEvent('info', 'rsvp_handoff_multi_person_deduped', {
          dedupe_key: dedupeKey,
          scope: handoffParty.scope,
          mentioned_names: handoffParty.mentioned_names ?? [],
          fragment: handoffFragment,
          rsvp_state_status: pendingState.status,
          phone_number: handoffPhoneNumber ?? null,
        });
        const planToSaveDeduped = mergePlan(args.workingPlan, {
          current_node: currentNode,
          intent: 'responder_invitacion',
          intent_confidence: args.extraction.intentConfidence,
          rsvp_state: pendingState,
        });
        const replyDeduped = {
          text: handoffFragment,
          structuredMessage: { type: 'generic' as const, paragraphs_es: [handoffFragment] },
        } as ComposeReplyResult;
        args.tokenUsage.reply = replyDeduped.tokenUsage ?? null;
        args.tokenUsage.openAiCalls.reply = replyDeduped.openAiCall ?? null;
        args.tokenUsage.total = this.sumTokenUsage(
          args.tokenUsage.classifier,
          args.tokenUsage.extraction,
          args.tokenUsage.reply,
        );
        const dedupedSaveStartedAt = Date.now();
        await this.dependencies.planStore.save({
          plan: planToSaveDeduped,
          reason: currentNode,
        });
        args.timingMs.save_plan += Date.now() - dedupedSaveStartedAt;
        args.timingMs.total = Date.now() - args.handleTurnStartedAt;
        return {
          plan: planToSaveDeduped,
          outbound: this.renderOutbound(
            replyDeduped,
            [],
            args.inbound.channel,
            planToSaveDeduped.conversation_id,
            planToSaveDeduped,
          ),
          trace: this.buildTrace({
            plan: planToSaveDeduped,
            previousNode: args.previousNode,
            currentNode,
            nodePath: args.previousNode === currentNode ? [currentNode] : [args.previousNode, currentNode],
            extraction: args.extraction,
            missingFields: [],
            searchReady: false,
            promptBundleId: 'deterministic:rsvp_multi_person_handoff',
            promptFilePaths: [],
            toolUsage: args.toolUsage,
            providerResults: [],
            recommendationFunnel: this.resolveRecommendationFunnel(null, []),
            planPersisted: true,
            planPersistReason: currentNode,
            timingMs: args.timingMs,
            tokenUsage: args.tokenUsage,
            responseClassifier: args.responseClassifierTrace,
            messageContext: args.messageContext,
            searchStrategy: 'none',
            turnDecision: this.rsvpTurnDecision('handoff_multi_person_deduped'),
            operationalNote: `RSVP multi-person handoff deduped (dedupe_key=${dedupeKey}) — second detection in same conversation, no duplicate backend call; reply remains handoff fragment only.`,
          }),
        };
      }
      const handoffEventReference = args.extraction.rsvpEventReference ?? null;
      logAuthObservabilityEvent('info', 'rsvp_handoff_multi_person', {
        scope: handoffParty.scope,
        mentioned_names: handoffParty.mentioned_names ?? [],
        fragment: handoffFragment,
        rsvp_state_status: pendingState.status,
        dedupe_key: dedupeKey,
        phone_number: handoffPhoneNumber ?? null,
        event_reference: handoffEventReference,
      });
      const gatewayForHandoff = this.dependencies.agentConversationGateway ??
        new NoopAgentConversationGateway('not_configured');
      let handoffGatewayResult: AgentGatewayResult | null = null;
      let handoffRegistered = false;
      if (!handoffPhoneNumber) {
        handoffGatewayResult = this.missingPhoneEscalationResult();
      } else {
        const firstResult = await this.requestHumanTakeoverWithTrace(
          gatewayForHandoff,
          handoffPhoneNumber,
          args.toolUsage,
        );
        handoffGatewayResult = firstResult;
        if (firstResult.status === 'failed' && firstResult.retryable) {
          const retryResult = await this.requestHumanTakeoverWithTrace(
            gatewayForHandoff,
            handoffPhoneNumber,
            args.toolUsage,
          );
          handoffGatewayResult = retryResult;
        }
        if (handoffGatewayResult.status === 'success') {
          handoffRegistered = true;
        }
      }
      if (handoffRegistered && handoffGatewayResult) {
        const planToSaveHandoff = mergePlan(args.workingPlan, {
          current_node: currentNode,
          intent: 'responder_invitacion',
          intent_confidence: args.extraction.intentConfidence,
          rsvp_state: pendingState,
          assumptions: [...args.workingPlan.assumptions, dedupeKey],
        });
        const replyHandoff = {
          text: handoffFragment,
          structuredMessage: { type: 'generic' as const, paragraphs_es: [handoffFragment] },
        } as ComposeReplyResult;
        args.timingMs.rsvp_execution += 0;
        args.tokenUsage.reply = replyHandoff.tokenUsage ?? null;
        args.tokenUsage.openAiCalls.reply = replyHandoff.openAiCall ?? null;
        args.tokenUsage.total = this.sumTokenUsage(
          args.tokenUsage.classifier,
          args.tokenUsage.extraction,
          args.tokenUsage.reply,
        );
        const handoffSaveStartedAt = Date.now();
        await this.dependencies.planStore.save({
          plan: planToSaveHandoff,
          reason: currentNode,
        });
        args.timingMs.save_plan += Date.now() - handoffSaveStartedAt;
        args.timingMs.total = Date.now() - args.handleTurnStartedAt;
        const handoffOperationalNote = `RSVP multi-person handoff: rsvpParty.scope=self_and_others (mentioned_names=${JSON.stringify(handoffParty.mentioned_names ?? [])}) dedupe_key=${dedupeKey} phone=${handoffPhoneNumber ?? 'missing'} event_reference=${JSON.stringify(handoffEventReference)} — backend handoff registered via request_human_takeover; plan rsvp_state untouched; reply is handoff fragment only.`;
        return {
          plan: planToSaveHandoff,
          outbound: this.renderOutbound(
            replyHandoff,
            [],
            args.inbound.channel,
            planToSaveHandoff.conversation_id,
            planToSaveHandoff,
          ),
          trace: this.buildTrace({
            plan: planToSaveHandoff,
            previousNode: args.previousNode,
            currentNode,
            nodePath: args.previousNode === currentNode ? [currentNode] : [args.previousNode, currentNode],
            extraction: args.extraction,
            missingFields: [],
            searchReady: false,
            promptBundleId: 'deterministic:rsvp_multi_person_handoff',
            promptFilePaths: [],
            toolUsage: args.toolUsage,
            providerResults: [],
            recommendationFunnel: this.resolveRecommendationFunnel(null, []),
            planPersisted: true,
            planPersistReason: currentNode,
            timingMs: args.timingMs,
            tokenUsage: args.tokenUsage,
            responseClassifier: args.responseClassifierTrace,
            messageContext: args.messageContext,
            searchStrategy: 'none',
            turnDecision: this.rsvpTurnDecision('handoff_multi_person'),
            operationalNote: handoffOperationalNote,
          }),
        };
      }
      const honestFallbackText = 'No pude registrar tu solicitud de apoyo humano en este momento. Por favor, intenta nuevamente en unos minutos.';
      logAuthObservabilityEvent('info', 'rsvp_handoff_multi_person_failed', {
        scope: handoffParty.scope,
        mentioned_names: handoffParty.mentioned_names ?? [],
        dedupe_key: dedupeKey,
        phone_number: handoffPhoneNumber ?? null,
        gateway_result: handoffGatewayResult ? this.redactAgentGatewayResult(handoffGatewayResult) : null,
      });
      const failureLastError = handoffGatewayResult
        ? handoffGatewayResult.status === 'failed'
          ? handoffGatewayResult.error
          : handoffGatewayResult.status === 'skipped'
            ? handoffGatewayResult.message
            : 'No se pudo registrar la solicitud de apoyo humano.'
        : 'No se pudo registrar la solicitud de apoyo humano.';
      const planToSaveFailure = mergePlan(args.workingPlan, {
        current_node: currentNode,
        intent: 'responder_invitacion',
        intent_confidence: args.extraction.intentConfidence,
        rsvp_state: pendingState,
        human_escalation: {
          status: 'none',
          requested_at: null,
          phone_number: handoffPhoneNumber ?? null,
          last_error: failureLastError,
        },
      });
      const replyFailure = {
        text: honestFallbackText,
        structuredMessage: { type: 'generic' as const, paragraphs_es: [honestFallbackText] },
      } as ComposeReplyResult;
      args.tokenUsage.reply = replyFailure.tokenUsage ?? null;
      args.tokenUsage.openAiCalls.reply = replyFailure.openAiCall ?? null;
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
        args.tokenUsage.reply,
      );
      const failureSaveStartedAt = Date.now();
      await this.dependencies.planStore.save({
        plan: planToSaveFailure,
        reason: currentNode,
      });
      args.timingMs.save_plan += Date.now() - failureSaveStartedAt;
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      return {
        plan: planToSaveFailure,
        outbound: this.renderOutbound(
          replyFailure,
          [],
          args.inbound.channel,
          planToSaveFailure.conversation_id,
          planToSaveFailure,
        ),
        trace: this.buildTrace({
          plan: planToSaveFailure,
          previousNode: args.previousNode,
          currentNode,
          nodePath: args.previousNode === currentNode ? [currentNode] : [args.previousNode, currentNode],
          extraction: args.extraction,
          missingFields: [],
          searchReady: false,
          promptBundleId: 'deterministic:rsvp_multi_person_handoff_failure',
          promptFilePaths: [],
          toolUsage: args.toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: currentNode,
          timingMs: args.timingMs,
          tokenUsage: args.tokenUsage,
          responseClassifier: args.responseClassifierTrace,
          messageContext: args.messageContext,
          searchStrategy: 'none',
          turnDecision: this.rsvpTurnDecision('handoff_multi_person_failure'),
          operationalNote: `RSVP multi-person handoff failed to register backend handoff (dedupe_key=${dedupeKey} phone=${handoffPhoneNumber ?? 'missing'} result=${handoffGatewayResult?.status ?? 'none'}); honest fallback returned, plan rsvp_state untouched, human_escalation not requested.`,
        }),
      };
    }

    args.toolUsage.considered.push(
      'lookup_rsvp_invitations',
      'lookup_guest_events_by_phone',
      'guest_rsvp',
    );
    const phoneExtension = args.workingPlan.contact_phone_extension;
    const phoneNumber = args.workingPlan.contact_phone_number;
    const phoneEvidence = phoneExtension && phoneNumber
      ? await this.lookupRsvpPhoneEvidence(
          { phone_extension: phoneExtension, phone_number: phoneNumber },
          args.gateway,
          args.toolUsage,
          args.timingMs,
          args.extraction.rsvpEventReference ?? null,
        )
      : null;
    let replyPhoneEvidence = phoneEvidence;
    let invitations: RsvpInvitation[] | null = phoneEvidence?.invitations ?? null;
    const shouldFallbackToSeededCandidates = Boolean(phoneEvidence && phoneEvidence.invitations.length === 0 && pendingState.candidates.length > 0);
    if (shouldFallbackToSeededCandidates) {
      invitations = pendingState.candidates.map((candidate) => ({
        eventId: null,
        guestId: candidate.guest_id,
        eventName: candidate.event_name,
        eventDate: candidate.event_date,
        state: 'unknown' as const,
        accessMethod: 'guest_record' as const,
      }));
      if (phoneEvidence) {
        replyPhoneEvidence = {
          coverage: phoneEvidence.coverage,
          resolution: phoneEvidence.resolution,
          invitations,
        };
      }
    }
    const selectedInvitation = invitations
      ? this.selectRsvpInvitation({
          invitations,
          pendingState,
          extractedGuestId: args.extraction.rsvpCandidateGuestId,
          eventReference: args.extraction.rsvpEventReference,
        })
      : null;

    if (!phoneExtension || !phoneNumber) {
      operationalNote = 'No está disponible tu número. No solicites correo ni código; ofrece apoyo humano para revisar la invitación.';
      nextRsvpState = this.emptyRsvpState();
    } else if (!invitations) {
      operationalNote = 'No fue posible consultar las invitaciones asociadas a tu número. No afirmes que no existen ni que se actualizó una respuesta; ofrece reintentar o pedir apoyo humano.';
      nextRsvpState = this.emptyRsvpState();
    } else if (invitations.length === 0) {
      const groundedCampaignEvent = this.groundedRsvpCampaignEvent(
        args.extraction.rsvpEventReference,
        args.messageContext,
      );
      const hasCampaignInvitationContext = args.messageContext.recentMessages.some(
        (message) => message.source === 'admin_campaign',
      );
      const currentReminder = args.messageContext.recentMessages
        .filter((message) => message.direction === 'outbound'
          && (message.source === 'frontend_followup' || message.source === 'admin_campaign'))
        .sort((left, right) => left.id - right.id)
        .at(-1) ?? null;
      const hasReminderContext = currentReminder !== null;
      const needsMismatchHandoff = action !== null
        && (hasReminderContext || groundedCampaignEvent !== null || hasCampaignInvitationContext)
        && args.workingPlan.human_escalation.status !== 'requested';
      if (needsMismatchHandoff) {
        const escalationPhone = this.resolveEscalationPhone(args.inbound);
        if (escalationPhone) {
          await this.requestHumanTakeoverWithTrace(args.gateway, escalationPhone, args.toolUsage);
        }
        const reminderBody = currentReminder?.body?.trim() ?? '';
        const reminderClause = reminderBody.length > 0
          ? ` Veo tu recordatorio vigente: "${reminderBody.slice(0, 200)}".`
          : ' Veo tu recordatorio vigente de Cumple Marcelo.';
        deterministicReplyText = `Gracias por tu mensaje.${reminderClause} En este momento no puedo verificar tu invitación, ya pedí apoyo humano para revisarlo.`;
        deterministicReplyIsComplete = true;
        operationalNote = 'El usuario confirma asistencia pero la consulta no devolvió registro con recordatorio vigente. Reconoce el recordatorio con su título literal, indica que no puedes verificarlo ahora y confirma que ya pediste apoyo humano. No niegues la invitación ni registres asistencia.';
        nextRsvpState = this.emptyRsvpState();
        const planToSaveMismatch = mergePlan(args.workingPlan, {
          current_node: currentNode,
          intent: 'responder_invitacion',
          intent_confidence: args.extraction.intentConfidence,
          rsvp_state: nextRsvpState,
          ...(escalationPhone ? {
            human_escalation: {
              status: 'requested' as const,
              requested_at: new Date().toISOString(),
              phone_number: escalationPhone,
              last_error: null,
            },
          } : {}),
        });
        const bundleMismatch = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
        args.timingMs.prompt_bundle_load += 0;
        const replyMismatch = {
          text: deterministicReplyText,
          structuredMessage: { type: 'generic' as const, paragraphs_es: [deterministicReplyText] },
        } as unknown as ComposeReplyResult;
        const saveMismatchStartedAt = Date.now();
        await this.dependencies.planStore.save({ plan: planToSaveMismatch, reason: currentNode });
        args.timingMs.save_plan += Date.now() - saveMismatchStartedAt;
        return {
          plan: planToSaveMismatch,
          outbound: this.renderOutbound(replyMismatch, [], args.inbound.channel, planToSaveMismatch.conversation_id, planToSaveMismatch),
          trace: this.buildTrace({
            plan: planToSaveMismatch,
            previousNode: args.previousNode,
            currentNode,
            nodePath: args.previousNode === currentNode ? [currentNode] : [args.previousNode, currentNode],
            extraction: args.extraction,
            missingFields: [],
            searchReady: false,
            promptBundleId: bundleMismatch.id,
            promptFilePaths: bundleMismatch.filePaths,
            toolUsage: args.toolUsage,
            providerResults: [],
            recommendationFunnel: this.resolveRecommendationFunnel(null, []),
            planPersisted: true,
            planPersistReason: currentNode,
            timingMs: args.timingMs,
            tokenUsage: args.tokenUsage,
            responseClassifier: args.responseClassifierTrace,
            messageContext: args.messageContext,
            searchStrategy: 'none',
            turnDecision: this.rsvpTurnDecision('rsvp_mismatch_handoff'),
            operationalNote,
          }),
        };
      }
      operationalNote = groundedCampaignEvent || hasCampaignInvitationContext
        ? 'El historial de campaña confirma contexto de una invitación asociada a esta conversación, pero la consulta no devolvió su registro ni su estado. Explica este desajuste claramente. No digas que la invitación no existe, que simplemente no hay invitaciones pendientes ni que se actualizó la asistencia. Ofrece apoyo humano para revisar el vínculo y el estado.'
        : 'La consulta no encontró ninguna invitación asociada a tu número. Distingue claramente este resultado de “no hay invitaciones pendientes” y ofrece apoyo humano si la persona esperaba una invitación.';
      nextRsvpState = this.emptyRsvpState();
    } else if (!selectedInvitation && invitations.some((invitation) => invitation.guestId === null)) {
      operationalNote = 'Usa exclusivamente los eventos disponibles. La consulta no expone el registro de invitado ni el estado de asistencia. No digas que no existe una invitación, no pidas correo ni código y no afirmes que se actualizó una respuesta. Pide en una sola frase que identifique el evento solo si hay más de uno; si hay uno, reconoce la asociación y ofrece apoyo humano únicamente para verificar el estado.';
      nextRsvpState = this.emptyRsvpState();
    } else if (!selectedInvitation) {
      const attempts = pendingState.status === 'awaiting_event_selection'
        ? pendingState.selection_attempts + 1
        : 0;
      nextRsvpState = {
        status: 'awaiting_event_selection',
        pending_action: action ?? pendingState.pending_action,
        pending_plus_one_response: plusOneResponse ?? pendingState.pending_plus_one_response,
        candidates: invitations.map((invitation) => ({
          guest_id: invitation.guestId as number,
          event_name: invitation.eventName,
          event_date: invitation.eventDate,
        })),
        requested_at: new Date().toISOString(),
        selection_attempts: attempts,
      };
      operationalNote = this.multipleRsvpInvitationsNote(invitations, action, attempts);
      deterministicReplyText = this.renderRsvpEventSelectionDeterministically(invitations);
      deterministicReplyIsComplete = true;
    } else if (selectedInvitation.guestId === null) {
      operationalNote = action
        ? 'Usa el evento seleccionado. La consulta no expone el registro de invitado ni el estado guardado. La persona indica que ya respondió. Agradece la confirmación y aclara que no hiciste otro cambio; no afirmes que el estado registrado esté confirmado, no niegues la invitación, no pidas correo ni código y ofrece apoyo humano solo si desea verificar el estado registrado.'
        : 'Usa el evento seleccionado. La consulta no expone el estado de asistencia. No inventes el estado, no afirmes que el estado registrado esté confirmado, no pidas correo ni código y ofrece apoyo humano para verificarlo.';
      nextRsvpState = this.emptyRsvpState();
    } else {
      const currentAction = selectedInvitation.state === 'attending'
        ? 'attending'
        : selectedInvitation.state === 'declining'
          ? 'declining'
          : null;

      const actionToSubmit = action && currentAction !== action ? action : null;
      const hasRequestedMutation = actionToSubmit !== null || plusOneResponse !== null;

      if (!action && plusOneResponse === null) {
        const shouldOfferDecliningChange = selectedInvitation.state === 'declining';
        const offerAction = !isReadOnlyStateQuery || shouldOfferDecliningChange;
        if (selectedInvitation.state === 'attending' || selectedInvitation.state === 'declining') {
          deterministicReplyText = this.renderRsvpCurrentStateDeterministically(selectedInvitation, offerAction);
          deterministicIsDecliningOffer = selectedInvitation.state === 'declining' && offerAction;
        }
        if (selectedInvitation.state === 'pending' && isReadOnlyStateQuery) {
          const pendingEventName = selectedInvitation.eventName ?? 'el evento';
          deterministicReplyText = `Tu asistencia a ${pendingEventName} todavía está pendiente.`;
          deterministicReplyIsComplete = true;
        }
        operationalNote = this.rsvpCurrentStateNote(selectedInvitation, offerAction);
        nextRsvpState = offerAction && (selectedInvitation.state === 'pending' || selectedInvitation.state === 'declining')
          ? this.awaitingRsvpActionState(selectedInvitation, 'attending')
          : this.emptyRsvpState();
      } else if (!hasRequestedMutation && action && currentAction === action) {
        if (selectedInvitation.state === 'attending' || selectedInvitation.state === 'declining') {
          deterministicReplyText = this.renderRsvpCurrentStateDeterministically(selectedInvitation, false);
          deterministicIsDecliningOffer = false;
        }
        operationalNote = this.rsvpCurrentStateNote(selectedInvitation, false);
        nextRsvpState = this.emptyRsvpState();
      } else if (
        !args.gateway.guestRsvp ||
        !this.capabilityManifest['rsvp.response.write'].available
      ) {
        operationalNote = 'El servicio de actualización de asistencia no está configurado. No afirmes que se cambió la respuesta; ofrece apoyo humano.';
        nextRsvpState = this.emptyRsvpState();
      } else {
        const executionStartedAt = Date.now();
        args.toolUsage.called.push('guest_rsvp');
        args.toolUsage.inputs.push({
          tool: 'guest_rsvp',
          input: JSON.stringify({
            action: actionToSubmit,
            plus_one_response: plusOneResponse,
            guest_id: selectedInvitation.guestId,
            trusted_phone_present: true,
            previous_state: selectedInvitation.state,
          }),
        });
        result = await args.gateway.guestRsvp({
          phone_extension: phoneExtension,
          phone_number: phoneNumber,
          ...(actionToSubmit ? { action: actionToSubmit } : {}),
          guest_id: selectedInvitation.guestId,
          ...(plusOneResponse ? { plus_one_response: plusOneResponse } : {}),
        });
        args.timingMs.rsvp_execution += Date.now() - executionStartedAt;
        args.toolUsage.outputs.push({
          tool: 'guest_rsvp',
          output: JSON.stringify(this.summarizeRsvpResult(result)),
        });
        replyPhoneEvidence = phoneEvidence
          ? this.applyRsvpMutationResultToPhoneEvidence(
              phoneEvidence,
              selectedInvitation,
              result,
            )
          : null;
        operationalNote = this.rsvpOperationalNote(
          result,
          actionToSubmit,
          plusOneResponse,
          {
            guest_id: selectedInvitation.guestId,
            event_name: selectedInvitation.eventName,
            event_date: selectedInvitation.eventDate,
          },
          null,
        );
        deterministicReplyText = this.renderRsvpMutationResultDeterministically({
          result,
          eventName: selectedInvitation.eventName,
          action: actionToSubmit,
          plusOneResponse,
        });
        deterministicReplyIsComplete = deterministicReplyText !== null;
        nextRsvpState = result.status === 'multiple_pending'
          ? {
              status: 'awaiting_event_selection',
              pending_action: actionToSubmit,
              pending_plus_one_response: plusOneResponse,
              candidates: result.candidates.map((candidate) => ({
                guest_id: candidate.guestId,
                event_name: candidate.eventName,
                event_date: candidate.eventDate,
              })),
              requested_at: new Date().toISOString(),
              selection_attempts: 0,
            }
          : this.emptyRsvpState();
      }
    }

    if (replyPhoneEvidence?.coverage === 'partial') {
      operationalNote += ' La información es parcial porque una de las consultas no estuvo disponible; no presentes la lista de eventos como exhaustiva.';
    }

    const planToSave = mergePlan(args.workingPlan, {
      current_node: currentNode,
      intent: 'responder_invitacion',
      intent_confidence: args.extraction.intentConfidence,
      rsvp_state: nextRsvpState,
    });
    const promptStartedAt = Date.now();
    const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
    args.timingMs.prompt_bundle_load += Date.now() - promptStartedAt;
    const composeStartedAt = Date.now();
    const reply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planToSave,
      extraction: args.extraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      turnDecision: this.rsvpTurnDecision(
        this.rsvpOutcomeReason(result, args.extraction.rsvpEventReference, args.messageContext),
      ),
      errorMessage: operationalNote,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      rsvpPhoneEvidence: replyPhoneEvidence
        ? this.projectRsvpPhoneEvidenceForReply(replyPhoneEvidence, selectedInvitation)
        : null,
    });
    args.timingMs.compose_reply += Date.now() - composeStartedAt;
    if (deterministicReplyText !== null) {
      const fragment = deterministicReplyText;
      if (deterministicIsDecliningOffer || deterministicReplyIsComplete) {
        reply.text = fragment;
        reply.structuredMessage = undefined;
      } else {
        const tissueParagraphs: string[] = [];
        if (
          reply.structuredMessage?.type === 'generic' &&
          Array.isArray(reply.structuredMessage.paragraphs_es)
        ) {
          tissueParagraphs.push(...reply.structuredMessage.paragraphs_es);
        } else if (reply.text && reply.text.trim().length > 0) {
          tissueParagraphs.push(reply.text.trim());
        }
        const mergedParagraphs = [
          fragment,
          ...tissueParagraphs.filter((paragraph) => paragraph.trim().length > 0),
        ];
        reply.structuredMessage = {
          type: 'generic',
          paragraphs_es: mergedParagraphs,
        };
        reply.text = mergedParagraphs.join('\n\n');
      }
    }
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    const saveStartedAt = Date.now();
    await this.dependencies.planStore.save({
      plan: planToSave,
      reason: currentNode,
    });
    args.timingMs.save_plan += Date.now() - saveStartedAt;

    return {
      plan: planToSave,
      outbound: this.renderOutbound(
        reply,
        [],
        args.inbound.channel,
        planToSave.conversation_id,
        planToSave,
      ),
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode,
        nodePath: args.previousNode === currentNode
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
        responseClassifier: args.responseClassifierTrace,
        messageContext: args.messageContext,
        searchStrategy: 'none',
        turnDecision: this.rsvpTurnDecision(
          this.rsvpOutcomeReason(result, args.extraction.rsvpEventReference, args.messageContext),
        ),
        operationalNote,
      }),
    };
  }

  private summarizeRsvpResult(result: AgentGuestRsvpResult): Record<string, unknown> {
    if (result.status === 'responded') {
      return {
        status: result.status,
        action: result.action,
        guest_id: result.guestId,
        event_name: result.eventName,
        event_date: result.eventDate,
        plus_one: result.plusOne
          ? {
              saved: result.plusOne.saved,
              response: result.plusOne.response,
              reason_present: Boolean(result.plusOne.reason),
            }
          : null,
      };
    }
    if (result.status === 'multiple_pending') {
      return {
        status: result.status,
        candidates: result.candidates.map((candidate) => ({
          guest_id: candidate.guestId,
          event_name: candidate.eventName,
          event_date: candidate.eventDate,
        })),
      };
    }
    if (result.status === 'already_responded') {
      return {
        status: result.status,
        current_action: result.currentAction,
        requested_action: result.requestedAction,
        guest_id: result.guestId,
        event_name: result.eventName,
        event_date: result.eventDate,
      };
    }
    return {
      status: result.status,
      ...(result.status === 'failed'
        ? { retryable: result.retryable, error: result.error }
        : {}),
    };
  }

  private async lookupRsvpPhoneEvidence(
    phone: { phone_extension: string; phone_number: string },
    gateway: AgentConversationGateway,
    toolUsage: ToolUsage,
    timingMs: TurnTiming,
    eventReference: string | null,
  ): Promise<RsvpPhoneEvidence | null> {
    if (!this.capabilityManifest['rsvp.state.read'].available) {
      return null;
    }
    const startedAt = Date.now();
    toolUsage.called.push('lookup_rsvp_invitations');
    toolUsage.inputs.push({
      tool: 'lookup_rsvp_invitations',
      input: JSON.stringify({ trusted_phone_present: true }),
    });
    if (gateway.getGuestEventsByPhone) {
      toolUsage.called.push('lookup_guest_events_by_phone');
      toolUsage.inputs.push({
        tool: 'lookup_guest_events_by_phone',
        input: JSON.stringify({ trusted_phone_present: true }),
      });
    }
    try {
      const [userContextOutcome, guestEventsOutcome] = await Promise.allSettled([
        this.dependencies.providerGateway.lookupUserEventContext({
          email: null,
          phone: phone.phone_number,
        }),
        gateway.getGuestEventsByPhone
          ? gateway.getGuestEventsByPhone(phone)
          : Promise.resolve(null),
      ]);
      const userContext = userContextOutcome.status === 'fulfilled'
        ? userContextOutcome.value
        : null;
      const guestEvents = guestEventsOutcome.status === 'fulfilled'
        ? guestEventsOutcome.value
        : null;
      const associatedSummaries = guestEvents?.status === 'success'
        ? guestEvents.events
        : [];
      const selectedAssociatedEvent = associatedSummaries.length === 1
        ? associatedSummaries[0] ?? null
        : eventReference
          ? associatedSummaries.find((event) => {
              const reference = this.normalizeSelectionText(eventReference);
              return reference.length > 0 && (
                this.normalizeSelectionText(event.name).includes(reference) ||
                reference.includes(this.normalizeSelectionText(event.name)) ||
                this.normalizeSelectionText(event.slug) === reference
              );
            }) ?? null
          : null;
      let enrichedDetail: Awaited<
        ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>
      > | null = null;
      let enrichedDetailFailed = false;
      if (selectedAssociatedEvent && gateway.getEventDetail) {
        toolUsage.called.push('get_guest_event_detail');
        toolUsage.inputs.push({
          tool: 'get_guest_event_detail',
          input: JSON.stringify({
            event_id: selectedAssociatedEvent.eventId,
            trusted_phone_present: true,
          }),
        });
        try {
          enrichedDetail = await gateway.getEventDetail({
            eventId: selectedAssociatedEvent.eventId,
            phone,
          });
          enrichedDetailFailed = enrichedDetail.status === 'failed';
        } catch {
          enrichedDetailFailed = true;
        }
        toolUsage.outputs.push({
          tool: 'get_guest_event_detail',
          output: JSON.stringify({
            status: enrichedDetail?.status ?? 'failed',
            attendance_present:
              enrichedDetail?.status === 'success' &&
              enrichedDetail.event.attendance !== null &&
              enrichedDetail.event.attendance !== undefined,
            purchase_count:
              enrichedDetail?.status === 'success'
                ? enrichedDetail.event.purchases?.length ?? 0
                : 0,
          }),
        });
      } else if (selectedAssociatedEvent) {
        enrichedDetailFailed = true;
      }
      const authoritativeInvitations: RsvpInvitation[] = userContext?.events
        .filter((event) => event.relation === 'guest' && event.guestId !== null)
        .map((event) => ({
          eventId: event.eventId,
          guestId: event.guestId as number,
          eventName: event.name,
          eventDate: event.datetime,
          state: this.rsvpInvitationState(
            event.guestStatus?.hasResponded ?? null,
            event.guestStatus?.willAttend ?? null,
          ),
          accessMethod: 'guest_record' as const,
        })) ?? [];
      const associatedEvents: RsvpInvitation[] = associatedSummaries
        .map((event) => {
          const enrichedEvent =
            enrichedDetail?.status === 'success' &&
            enrichedDetail.event.eventId === event.eventId
              ? enrichedDetail.event
              : null;
          const attendance =
            enrichedEvent?.attendance ?? null;
          return {
            eventId: event.eventId,
            guestId: attendance?.guestId ?? null,
            eventName: event.name,
            eventDate: enrichedEvent?.datetime ?? event.datetime,
            state: attendance
              ? this.rsvpInvitationState(
                  attendance.hasResponded,
                  attendance.willAttend,
                )
              : 'unknown' as const,
            accessMethod: attendance
              ? 'phone_enriched_event' as const
              : 'trusted_phone_event' as const,
          };
        });
      const invitations = this.reconcileRsvpPhoneEvidence(
        authoritativeInvitations,
        associatedEvents,
      );
      const sourceFailed =
        authoritativeInvitations.some((invitation) => !this.hasRsvpEventIdentity(invitation)) ||
        !gateway.getGuestEventsByPhone ||
        userContextOutcome.status === 'rejected' ||
        guestEventsOutcome.status === 'rejected' ||
        guestEvents?.status === 'failed' ||
        enrichedDetailFailed;
      if (invitations.length === 0 && sourceFailed) {
        toolUsage.outputs.push({
          tool: 'lookup_rsvp_invitations',
          output: JSON.stringify({ status: 'failed' }),
        });
        if (gateway.getGuestEventsByPhone) {
          toolUsage.outputs.push({
            tool: 'lookup_guest_events_by_phone',
            output: JSON.stringify({ status: 'failed' }),
          });
        }
        return null;
      }
      const resolution: RsvpPhoneEvidence['resolution'] = invitations.some(
        (invitation) => invitation.guestId !== null,
      )
        ? 'authoritative_invitation'
        : associatedEvents.length > 0
          ? 'event_association_only'
          : 'not_found';
      toolUsage.outputs.push({
        tool: 'lookup_rsvp_invitations',
        output: JSON.stringify({
          status: resolution,
          invitations: invitations.map((invitation) => ({
            event_id: invitation.eventId,
            guest_id: invitation.guestId,
            event_name: invitation.eventName,
            event_date: invitation.eventDate,
            current_state: invitation.state,
            access_method: invitation.accessMethod,
          })),
        }),
      });
      if (gateway.getGuestEventsByPhone) {
        toolUsage.outputs.push({
          tool: 'lookup_guest_events_by_phone',
          output: JSON.stringify({ status: 'incorporated_into_phone_evidence' }),
        });
      }
      return {
        coverage: sourceFailed ? 'partial' : 'complete',
        resolution,
        invitations,
      };
    } catch (error) {
      toolUsage.outputs.push({
        tool: 'lookup_rsvp_invitations',
        output: JSON.stringify({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown invitation lookup failure.',
        }),
      });
      return null;
    } finally {
      timingMs.rsvp_execution += Date.now() - startedAt;
    }
  }

  private hasRsvpEventIdentity(invitation: RsvpInvitation): boolean {
    if (invitation.eventId !== null) {
      return true;
    }
    const normalizedName = this.normalizeSelectionText(invitation.eventName ?? '');
    return normalizedName.length > 0;
  }

  private toRsvpReplyEvent(invitation: RsvpInvitation): {
    event_name: string | null;
    event_date: string | null;
    invitation_record: 'available' | 'unavailable';
    rsvp_state: 'pending' | 'attending' | 'declining' | 'unavailable';
  } {
    return {
      event_name: invitation.eventName,
      event_date: invitation.eventDate,
      invitation_record: invitation.guestId === null ? 'unavailable' : 'available',
      rsvp_state: invitation.state === 'unknown' ? 'unavailable' : invitation.state,
    };
  }

  private sortRsvpInvitationsDeterministically(
    invitations: RsvpInvitation[],
  ): RsvpInvitation[] {
    return [...invitations].sort((left, right) => {
      if (left.eventId !== null && right.eventId !== null) {
        return left.eventId - right.eventId;
      }
      if (left.eventId !== null) {
        return -1;
      }
      if (right.eventId !== null) {
        return 1;
      }
      const leftName = this.normalizeSelectionText(left.eventName ?? '');
      const rightName = this.normalizeSelectionText(right.eventName ?? '');
      if (leftName < rightName) return -1;
      if (leftName > rightName) return 1;
      const leftDate = left.eventDate ?? '';
      const rightDate = right.eventDate ?? '';
      if (leftDate < rightDate) return -1;
      if (leftDate > rightDate) return 1;
      return 0;
    });
  }

  private reconcileRsvpPhoneEvidence(
    authoritativeInvitations: RsvpInvitation[],
    associatedEvents: RsvpInvitation[],
  ): RsvpInvitation[] {
    const filteredAuthoritative = authoritativeInvitations.filter((invitation) =>
      this.hasRsvpEventIdentity(invitation));
    const filteredAssociated = associatedEvents.filter((invitation) =>
      this.hasRsvpEventIdentity(invitation));
    if (
      filteredAuthoritative.length !== authoritativeInvitations.length ||
      filteredAssociated.length !== associatedEvents.length
    ) {
      logAuthObservabilityEvent('info', 'rsvp_reconcile_rejected_missing_identity', {
        authoritative_before: authoritativeInvitations.length,
        authoritative_after: filteredAuthoritative.length,
        associated_before: associatedEvents.length,
        associated_after: filteredAssociated.length,
      });
    }
    const reconciled = [...filteredAuthoritative];
    filteredAssociated.forEach((associatedEvent) => {
      const duplicateIndex = reconciled.findIndex((invitation) =>
        this.sameRsvpEvent(invitation, associatedEvent));
      if (duplicateIndex < 0) {
        reconciled.push(associatedEvent);
      } else if (associatedEvent.accessMethod === 'phone_enriched_event') {
        const authoritativeEvent = reconciled[duplicateIndex];
        if (authoritativeEvent) {
          reconciled[duplicateIndex] = {
            ...associatedEvent,
            eventName: associatedEvent.eventName ?? authoritativeEvent.eventName,
            eventDate: associatedEvent.eventDate ?? authoritativeEvent.eventDate,
          };
        }
      }
    });
    return this.sortRsvpInvitationsDeterministically(reconciled);
  }

  private projectRsvpPhoneEvidenceForReply(
    evidence: RsvpPhoneEvidence,
    selectedInvitation: RsvpInvitation | null,
  ): RsvpPhoneReplyEvidence {
    const sortedInvitations = this.sortRsvpInvitationsDeterministically(
      evidence.invitations.filter((invitation) => this.hasRsvpEventIdentity(invitation)),
    );
    if (sortedInvitations.length === 0) {
      const projection: RsvpPhoneReplyEvidence = {
        state: 'unavailable',
        coverage: evidence.coverage,
        resolution: evidence.resolution,
        reason: 'no_invitations',
      };
      logAuthObservabilityEvent('info', 'rsvp_projection_state', {
        state: projection.state,
        coverage: projection.coverage,
        resolution: projection.resolution,
        invitation_count: 0,
        reason: projection.reason,
      });
      return projection;
    }
    if (selectedInvitation && this.hasRsvpEventIdentity(selectedInvitation)) {
      const matched = sortedInvitations.find((invitation) =>
        this.sameRsvpEvent(invitation, selectedInvitation));
      const target = matched
        ? {
            ...matched,
            eventName: matched.eventName ?? selectedInvitation.eventName,
            eventDate: matched.eventDate ?? selectedInvitation.eventDate,
          }
        : selectedInvitation;
      const projection: RsvpPhoneReplyEvidence = {
        state: 'resolved_single',
        coverage: evidence.coverage,
        resolution: evidence.resolution,
        event: this.toRsvpReplyEvent(target),
      };
      logAuthObservabilityEvent('info', 'rsvp_projection_state', {
        state: projection.state,
        coverage: projection.coverage,
        resolution: projection.resolution,
        invitation_count: sortedInvitations.length,
        selected_event_id: target.eventId,
        selected_event_name: target.eventName,
      });
      return projection;
    }
    if (sortedInvitations.length === 1) {
      const only = sortedInvitations[0];
      if (!only) {
        const projection: RsvpPhoneReplyEvidence = {
          state: 'unavailable',
          coverage: evidence.coverage,
          resolution: evidence.resolution,
          reason: 'no_invitations',
        };
        logAuthObservabilityEvent('info', 'rsvp_projection_state', {
          state: projection.state,
          coverage: projection.coverage,
          resolution: projection.resolution,
          invitation_count: 0,
          reason: projection.reason,
        });
        return projection;
      }
      const projection: RsvpPhoneReplyEvidence = {
        state: 'resolved_single',
        coverage: evidence.coverage,
        resolution: evidence.resolution,
        event: this.toRsvpReplyEvent(only),
      };
      logAuthObservabilityEvent('info', 'rsvp_projection_state', {
        state: projection.state,
        coverage: projection.coverage,
        resolution: projection.resolution,
        invitation_count: 1,
        selected_event_id: only.eventId,
        selected_event_name: only.eventName,
      });
      return projection;
    }
    const projection: RsvpPhoneReplyEvidence = {
      state: 'needs_event_selection',
      coverage: evidence.coverage,
      resolution: evidence.resolution,
      candidates: sortedInvitations.map((invitation) => this.toRsvpReplyEvent(invitation)),
    };
    logAuthObservabilityEvent('info', 'rsvp_projection_state', {
      state: projection.state,
      coverage: projection.coverage,
      resolution: projection.resolution,
      invitation_count: sortedInvitations.length,
      candidate_event_ids: sortedInvitations.map((invitation) => invitation.eventId),
    });
    return projection;
  }

  private applyRsvpMutationResultToPhoneEvidence(
    evidence: RsvpPhoneEvidence,
    selectedInvitation: RsvpInvitation,
    result: AgentGuestRsvpResult,
  ): RsvpPhoneEvidence {
    const resolvedState: RsvpInvitationState | null = result.status === 'responded'
      ? result.action
      : result.status === 'already_responded' && result.currentAction
        ? result.currentAction
        : result.status === 'no_pending'
          ? 'unknown'
          : null;
    if (resolvedState === null) {
      return evidence;
    }
    return {
      ...evidence,
      invitations: evidence.invitations.map((invitation) =>
        this.sameRsvpEvent(invitation, selectedInvitation)
          ? { ...invitation, state: resolvedState }
          : invitation),
    };
  }

  private sameRsvpEvent(
    left: RsvpInvitation,
    right: RsvpInvitation,
  ): boolean {
    if (left.eventId !== null && right.eventId !== null) {
      return left.eventId === right.eventId;
    }
    const leftName = this.normalizeSelectionText(left.eventName ?? '');
    const rightName = this.normalizeSelectionText(right.eventName ?? '');
    return Boolean(leftName) && leftName === rightName;
  }

  private rsvpInvitationState(
    hasResponded: boolean | null,
    willAttend: boolean | null,
  ): RsvpInvitationState {
    if (hasResponded === false) {
      return 'pending';
    }
    if (hasResponded === true && willAttend === true) {
      return 'attending';
    }
    if (hasResponded === true && willAttend === false) {
      return 'declining';
    }
    return 'unknown';
  }

  private selectRsvpInvitation(args: {
    invitations: RsvpInvitation[];
    pendingState: PlanSnapshot['rsvp_state'];
    extractedGuestId: number | null | undefined;
    eventReference: string | null | undefined;
  }): RsvpInvitation | null {
    if (args.extractedGuestId) {
      const extracted = args.invitations.find(
        (invitation) => invitation.guestId === args.extractedGuestId,
      );
      if (extracted) {
        return extracted;
      }
    }
    if (
      args.pendingState.status === 'awaiting_action' &&
      args.pendingState.candidates.length === 1
    ) {
      const storedId = args.pendingState.candidates[0]?.guest_id;
      const stored = args.invitations.find(
        (invitation) => invitation.guestId === storedId,
      );
      if (stored) {
        return stored;
      }
    }
    if (args.eventReference) {
      const reference = this.normalizeSelectionText(args.eventReference);
      const matches = args.invitations.filter((invitation) => {
        const name = this.normalizeSelectionText(invitation.eventName ?? '');
        return this.normalizedTextContainsAlias(name, reference)
          || this.normalizedTextContainsAlias(reference, name);
      });
      if (matches.length === 1) {
        return matches[0] ?? null;
      }
    }
    return args.invitations.length === 1 ? args.invitations[0] ?? null : null;
  }

  private awaitingRsvpActionState(
    invitation: RsvpInvitation,
    action: 'attending' | 'declining',
  ): PlanSnapshot['rsvp_state'] {
    if (invitation.guestId === null) {
      return this.emptyRsvpState();
    }
    return {
      status: 'awaiting_action',
      pending_action: action,
      pending_plus_one_response: null,
      candidates: [{
        guest_id: invitation.guestId,
        event_name: invitation.eventName,
        event_date: invitation.eventDate,
      }],
      requested_at: new Date().toISOString(),
      selection_attempts: 0,
    };
  }

  private emptyRsvpState(): PlanSnapshot['rsvp_state'] {
    return {
      status: 'none',
      pending_action: null,
      pending_plus_one_response: null,
      candidates: [],
      requested_at: null,
      selection_attempts: 0,
    };
  }

  private rsvpCurrentStateNote(
    invitation: RsvpInvitation,
    offerAction: boolean,
  ): string {
    if (invitation.state === 'pending') {
      return `Comunica el estado pendiente según la información disponible. ${offerAction ? 'Pregunta de forma natural si desea que confirmes su asistencia.' : 'No afirmes que se registró una respuesta.'}`;
    }
    if (invitation.state === 'attending') {
      return 'La información indica que la asistencia ya está confirmada; desea que disfrute el evento y no ejecutes otra actualización.';
    }
    if (invitation.state === 'declining') {
      return `La información indica que figura que no asistirá. ${offerAction ? 'Pregunta si desea cambiarlo para confirmar que sí asistirá.' : 'No afirmes que se cambió.'}`;
    }
    return 'La consulta no devolvió un estado de asistencia interpretable. No inventes el estado ni afirmes una actualización; ofrece apoyo humano.';
  }

  private multipleRsvpInvitationsNote(
    invitations: RsvpInvitation[],
    action: 'attending' | 'declining' | null,
    attempts: number,
  ): string {
    void action;
    const enumerated = this.formatRsvpInvitationEnumeration(invitations);
    const nextStep = 'Pregunta en una sola frase cuál de los eventos desea gestionar, enumerando cada candidato con su nombre y fecha.';
    return `Hay varias invitaciones asociadas a tu número. ${nextStep} Candidatos: ${enumerated}. ${attempts >= 2 ? 'Como la selección sigue ambigua, ofrece apoyo humano como alternativa.' : ''} No afirmes que se actualizó ninguna.`;
  }

  private formatRsvpInvitationEnumeration(invitations: RsvpInvitation[]): string {
    if (invitations.length === 0) {
      return 'sin candidatos';
    }
    const sorted = this.sortRsvpInvitationsDeterministically(invitations);
    return sorted
      .map((invitation) => `${invitation.eventName ?? 'Evento sin nombre'} - ${this.formatRsvpSpanishDate(invitation.eventDate)}`)
      .join('; ');
  }

  private formatRsvpSpanishDate(value: string | null): string {
    if (!value) {
      return 'fecha por confirmar';
    }
    const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/u);
    if (!match || !match[1] || !match[2] || !match[3]) {
      return value;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const monthName = months[month - 1] ?? String(month);
    return `${day} de ${monthName} de ${year}`;
  }

  private renderRsvpEventSelectionDeterministically(
    invitations: RsvpInvitation[],
  ): string {
    const enumerated = this.formatRsvpInvitationEnumeration(invitations);
    return `¿A cuál de estos eventos te refieres? ${enumerated}.`;
  }

  private renderRsvpCurrentStateDeterministically(
    invitation: RsvpInvitation,
    offerAction: boolean,
  ): string {
    const eventName = invitation.eventName ?? 'el evento';
    const datePart = invitation.eventDate ? ` el ${this.formatRsvpSpanishDate(invitation.eventDate)}` : '';
    const noChange = 'no fue necesario hacer otro cambio';
    const capitalizedNoChange = noChange[0] ? noChange[0].toUpperCase() + noChange.slice(1) : noChange;
    if (invitation.state === 'attending') {
      return `Gracias, tu asistencia a ${eventName}${datePart} ya está confirmada y figura que asistirás. ${capitalizedNoChange} y no se realizó un nuevo registro.`;
    }
    if (invitation.state === 'declining') {
      if (offerAction) {
        return `Figura que no asistirás a ${eventName}${datePart}. ¿Deseas que confirme tu asistencia?`;
      }
      return `Figura que no asistirás a ${eventName}${datePart}. ${capitalizedNoChange}.`;
    }
    return this.rsvpCurrentStateNote(invitation, offerAction);
  }

  private renderRsvpMutationResultDeterministically(args: {
    result: AgentGuestRsvpResult;
    eventName: string | null;
    action: 'attending' | 'declining' | null;
    plusOneResponse: 'yes' | 'no' | null;
  }): string | null {
    if (args.result.status !== 'responded') {
      return null;
    }
    const eventName = args.result.eventName ?? args.eventName ?? 'el evento';
    const parts: string[] = [];
    if (args.action !== null && args.result.action !== null) {
      parts.push(
        args.result.action === 'attending'
          ? `Listo, tu asistencia a ${eventName} quedó confirmada.`
          : `Listo, registré que no asistirás a ${eventName}.`,
      );
    }
    if (args.plusOneResponse !== null) {
      if (args.result.plusOne?.saved && args.result.plusOne.response === 'yes') {
        parts.push(`También quedó registrado que tu acompañante asistirá a ${eventName}.`);
      } else if (args.result.plusOne?.saved && args.result.plusOne.response === 'no') {
        parts.push(`También quedó registrado que tu acompañante no asistirá a ${eventName}.`);
      } else {
        const interpretation = this.rsvpPlusOneFailureInterpretation(args.result);
        parts.push(
          `La respuesta de tu acompañante no quedó guardada para esta invitación${interpretation ? ` porque ${interpretation}` : ''}. No la consideraré confirmada; si deseas, el equipo de apoyo puede revisarla.`,
        );
      }
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }

  /**
   * Convert the documented API failure into a safe, user-facing interpretation.
   * The endpoint reason is never copied into model context or user output.
   */
  private rsvpPlusOneFailureInterpretation(
    result: AgentGuestRsvpResult,
  ): string | null {
    if (
      result.status !== 'responded' ||
      result.plusOne?.saved !== false ||
      !result.plusOne.reason?.trim()
    ) {
      return null;
    }
    return 'no se puede agregar un acompañante para este invitado o evento';
  }

  private renderRsvpHandoffFragment(
    party: { scope: string; mentioned_names: string[] } | null | undefined,
  ): string {
    if (!party || party.scope !== 'self_and_others') {
      return '¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará.';
    }
    const names = (party.mentioned_names ?? []).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) {
      return '¡Con gusto! Para confirmar la asistencia para ti y para tu acompañante, nuestro equipo de apoyo humano te ayudará.';
    }
    if (names.length === 1) {
      return `¡Con gusto! Para confirmar la asistencia para ti y para ${names[0]}, nuestro equipo de apoyo humano te ayudará.`;
    }
    if (names.length === 2) {
      return `¡Con gusto! Para confirmar la asistencia para ti y para ${names[0]} y ${names[1]}, nuestro equipo de apoyo humano te ayudará.`;
    }
    const allButLast = names.slice(0, -1).join(', ');
    const last = names[names.length - 1];
    return `¡Con gusto! Para confirmar la asistencia para ti y para ${allButLast} y ${last}, nuestro equipo de apoyo humano te ayudará.`;
  }

  private rsvpOperationalNote(
    result: AgentGuestRsvpResult,
    action: 'attending' | 'declining' | null,
    plusOneResponse: 'yes' | 'no' | null,
    selectedCandidate: PlanSnapshot['rsvp_state']['candidates'][number] | null,
    groundedCampaignEvent: string | null,
  ): string {
    if (result.status === 'responded') {
      void selectedCandidate;
      if (plusOneResponse !== null && result.plusOne?.saved === false) {
        const interpretation = this.rsvpPlusOneFailureInterpretation(result);
        return `La respuesta principal se procesó, pero el servicio indicó que la respuesta del acompañante no quedó guardada${interpretation ? ` porque ${interpretation}` : ''}. No afirmes que el acompañante quedó confirmado o rechazado; ofrece apoyo humano para revisarlo.`;
      }
      if (plusOneResponse !== null && result.plusOne === null) {
        return 'El servicio respondió, pero no devolvió evidencia de que la respuesta del acompañante se haya guardado. No la presentes como confirmada; ofrece apoyo humano para revisarla.';
      }
      void action;
      return 'La actualización se completó. Comunica únicamente los estados finales que el resultado confirmó y no pidas otra confirmación.';
    }
    if (result.status === 'multiple_pending') {
      return 'El servicio encontró varias invitaciones pendientes. Presenta únicamente los candidatos visibles y pregunta a cuál evento desea responder. No afirmes que ya se registró una respuesta.';
    }
    if (result.status === 'already_responded') {
      if (result.currentAction === 'attending') {
        return 'El servicio no realizó una nueva actualización. Comunica con naturalidad que la asistencia ya está confirmada según la información disponible.';
      }
      if (result.currentAction === 'declining') {
        return 'El servicio no realizó el cambio solicitado. Comunica que figura que no asistirá, explica que no cambió y ofrece apoyo humano para modificarlo.';
      }
      return 'El servicio indicó que esa invitación ya tenía una respuesta registrada, pero no devolvió si era asistencia o inasistencia. No afirmes que se realizó una nueva actualización.';
    }
    if (result.status === 'no_pending') {
      if (selectedCandidate) {
        const eventName = selectedCandidate.event_name
          ? ` de ${selectedCandidate.event_name}`
          : '';
        return `La consulta sí encontró la invitación${eventName}, pero el servicio de actualización indicó que no estaba pendiente y no confirmó ninguna actualización. No digas que la invitación no existe ni afirmes que el estado cambió; ofrece apoyo humano si la persona desea modificarla.`;
      }
      if (groundedCampaignEvent) {
        return `El historial de campaña confirma que la invitación de ${groundedCampaignEvent} sí está asociada a tu número, pero el servicio indicó que ya no tiene una respuesta pendiente. Comunica que no se realizó una nueva actualización y que la invitación ya no está pendiente. No digas que la invitación no existe ni afirmes si la respuesta registrada es asistencia o inasistencia, porque el servicio no devolvió ese estado. Ofrece apoyo humano solo si la persona quiere revisar o cambiar la respuesta.`;
      }
      return 'El servicio no encontró invitaciones pendientes para tu número. Dilo directamente y ofrece apoyo humano si la persona considera que falta una invitación.';
    }
    if (result.status === 'phone_mismatch') {
      return 'El servicio indicó que la invitación elegida no corresponde a tu número. No pidas correo ni código; ofrece apoyo humano para revisar la invitación.';
    }
    return result.retryable
      ? 'El servicio de asistencia falló temporalmente y no confirmó ninguna actualización. Pide reintentar más tarde u ofrece apoyo humano.'
      : 'No fue posible registrar la respuesta y el servicio no confirmó ninguna actualización. Ofrece apoyo humano.';
  }

  private rsvpOutcomeReason(
    result: AgentGuestRsvpResult | null,
    eventReference: string | null | undefined,
    messageContext: TurnMessageContext,
  ): string {
    if (!result) {
      return 'needs_input';
    }
    if (
      result.status === 'no_pending' &&
      this.groundedRsvpCampaignEvent(eventReference, messageContext)
    ) {
      return 'referenced_invitation_not_pending';
    }
    return result.status;
  }

  private groundedRsvpCampaignEvent(
    eventReference: string | null | undefined,
    messageContext: TurnMessageContext,
  ): string | null {
    if (!eventReference) {
      return null;
    }
    const normalizedReference = this.normalizeSelectionText(eventReference);
    if (!normalizedReference) {
      return null;
    }
    const isGrounded = messageContext.recentMessages.some((message) => {
      if (message.source !== 'admin_campaign') {
        return false;
      }
      const normalizedBody = this.normalizeSelectionText(message.body);
      return this.normalizedTextContainsAlias(normalizedBody, normalizedReference);
    });
    return isGrounded ? eventReference.trim() : null;
  }

  private rsvpTurnDecision(reason: string): TurnDecision {
    return turnDecisionSchema.parse({
      nextNode: 'responder_invitacion',
      routeKind: 'rsvp',
      providerSearchMode: 'none',
      presentationScope: 'rsvp',
      focusNeedCategory: null,
      needsToSearch: [],
      needsToPresent: [],
      stopReason: null,
      persistReason: reason,
      invariantStatus: 'valid',
      invariantViolations: [],
    });
  }

  private hasInformationWork(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): boolean {
    return (
      (extraction.normalizationIssues?.length ?? 0) > 0 ||
      (Boolean(extraction.supportAct) && extraction.actionIntent === null &&
        !extraction.vendorCategory && extraction.vendorCategories.length === 0 &&
        !extraction.providerQueryIntents?.length && !extraction.providerPlanOperations?.length) ||
      extraction.informationRequests.length > 0 ||
      plan.information_state.pending_requests.length > 0 ||
      (extraction.actionIntent === null &&
        (plan.information_state.last_completed_request?.kind === 'purchase' ||
          plan.information_state.last_completed_request?.kind === 'associated_event' ||
          plan.information_state.last_completed_request?.kind === 'faq'))
    );
  }

  private isSupportAcknowledgment(
    act: InformationSupportAct | null | undefined,
  ): boolean {
    return act?.kind === 'report_issue' ||
      act?.kind === 'provide_detail' ||
      act?.kind === 'defer_submission';
  }

  private shouldUseContextualClarification(
    messageContext: TurnMessageContext,
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): boolean {
    const continuity = messageContext.continuity;
    if (!continuity?.hasPriorContext) {
      return false;
    }
    // Authentication replies and contact updates are stateful continuations;
    // they must reach their existing typed handlers even when the extraction
    // delta is empty.
    if (plan.user_auth.status !== 'none' || plan.user_auth.awaiting_phone_confirmation) {
      return false;
    }
    // RSVP selection is also a stateful continuation. Keep it in the typed
    // RSVP handler so an ambiguous event choice cannot fall through to the
    // generic contextual clarification prompt.
    if (plan.rsvp_state.status !== 'none') {
      return false;
    }
    // An active purchase/event thread replays its canonical request in the
    // information flow instead of receiving a generic clarification question.
    if (
      purchaseThreadBypassesContextualClarification(
        plan.information_state.last_completed_request?.kind ?? null,
      )
    ) {
      return false;
    }
    const emptyDelta =
      extraction.actionIntent === null &&
      extraction.informationRequests.length === 0 &&
      extraction.supportAct == null &&
      extraction.phoneConfirmation == null &&
      extraction.rsvpAction == null &&
      extraction.rsvpEventReference == null &&
      extraction.eventType == null &&
      extraction.vendorCategory == null &&
      extraction.vendorCategories.length === 0 &&
      extraction.activeNeedCategory == null &&
      extraction.location == null &&
      extraction.budgetSignal == null &&
      extraction.guestRange == null &&
      extraction.preferences.length === 0 &&
      extraction.hardConstraints.length === 0 &&
      (extraction.providerQueryIntents?.length ?? 0) === 0 &&
      (extraction.providerPlanOperations?.length ?? 0) === 0 &&
      extraction.selectedProviderHints.length === 0 &&
      (extraction.selectedProviderReferences?.length ?? 0) === 0 &&
      extraction.providerExplanationRequest == null &&
      extraction.providerDetailRequest == null &&
      extraction.closeAction == null &&
      !extraction.pauseRequested &&
      extraction.contactName == null &&
      extraction.contactEmail == null &&
      extraction.contactPhone == null;
    return emptyDelta || (
      extraction.ambiguity?.status === 'ambiguous' &&
      extraction.informationRequests.length === 0
    );
  }

  private contextualClarificationTurnDecision(reason: string): TurnDecision {
    return turnDecisionSchema.parse({
      nextNode: 'resolver_consultas_informativas',
      routeKind: 'contextual_clarification',
      providerSearchMode: 'none',
      presentationScope: 'clarification',
      focusNeedCategory: null,
      needsToSearch: [],
      needsToPresent: [],
      stopReason: null,
      persistReason: reason,
      invariantStatus: 'valid',
      invariantViolations: [],
    });
  }

  private contextualClarificationMessage(
    continuity: NonNullable<TurnMessageContext['continuity']>,
    extraction: ExtractionResult,
  ): string {
    // The extractor has already resolved any available recent-message
    // context into a typed clarification question. Keep that question when
    // present so a short or misspelled continuation stays on the established
    // topic without deriving a topic from text in deterministic code.
    const extractedQuestion = extraction.ambiguity?.clarificationQuestion?.trim();
    if (
      extraction.ambiguity?.status === 'ambiguous' &&
      extractedQuestion
    ) {
      return extractedQuestion;
    }

    switch (continuity.lane) {
      case 'purchase_support':
        return 'Para continuar con tu consulta de compra, ¿quieres revisar el estado registrado o necesitas precisar otro dato?';
      case 'event_support':
        return 'Para continuar con tu consulta del evento, ¿qué dato deseas precisar?';
      case 'public_faq':
        return 'Para continuar con tu consulta, ¿qué aspecto deseas precisar?';
      case 'planning':
        return 'Para continuar con tu plan, ¿qué parte deseas precisar?';
      case 'rsvp':
        return 'Para continuar con la invitación, ¿quieres confirmar o rechazar tu asistencia?';
      default:
        return 'Para continuar, ¿podrías indicar qué necesitas resolver?';
    }
  }

  private async handleContextualClarification(args: {
    inbound: NormalizedInboundMessage;
    previousNode: DecisionNode;
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    responseClassifierTrace?: MessageResponseClassifierTrace;
    messageContext: TurnMessageContext;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse> {
    const continuity = args.messageContext.continuity ?? deriveConversationContinuity({
      plan: args.plan,
      recentMessages: args.messageContext.recentMessages,
      historyStatus: args.messageContext.historyStatus,
    });
    const plan = args.plan.current_node === 'contacto_inicial' &&
      !continuity.welcomeAllowed
      ? mergePlan(args.plan, { current_node: 'deteccion_intencion' })
      : args.plan;
    const isPostRsvpClosure = continuity.lane === 'rsvp'
      && (args.extraction.rsvpAction === null || args.extraction.rsvpAction === undefined)
      && (args.extraction.actionIntent === null || args.extraction.actionIntent === undefined)
      && args.extraction.informationRequests.length === 0;
    if (isPostRsvpClosure) {
      const closureText = 'Gracias por tu mensaje, me alegra que la hayas disfrutado en familia. Tu asistencia sigue confirmada y figura que asistirás.';
      await this.dependencies.planStore.save({
        plan,
        reason: 'contextual_clarification',
      });
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
      );
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      return {
        plan,
        outbound: this.renderOutbound(
          { text: closureText },
          [],
          args.inbound.channel,
          plan.conversation_id,
          plan,
        ),
        trace: this.buildTrace({
          plan,
          previousNode: args.previousNode,
          currentNode: plan.current_node,
          nodePath: args.previousNode === plan.current_node
            ? [plan.current_node]
            : [args.previousNode, plan.current_node],
          extraction: args.extraction,
          missingFields: plan.missing_fields,
          searchReady: false,
          promptBundleId: 'deterministic:post_rsvp_closure',
          promptFilePaths: [],
          toolUsage: args.toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'contextual_clarification',
          timingMs: args.timingMs,
          tokenUsage: args.tokenUsage,
          messageContext: args.messageContext,
          responseClassifier: args.responseClassifierTrace,
          searchStrategy: 'none',
          turnDecision: this.contextualClarificationTurnDecision(
            'contextual_clarification',
          ),
          operationalNote: 'Post-RSVP thanks in RSVP lane acknowledged once with preserved attending state; no RSVP write, no question, no numeric label.',
          informationExecution: [],
        }),
      };
    }
    const hasCompetingProviderWork = args.extraction.informationRequests.length > 0 ||
      (args.extraction.providerQueryIntents?.length ?? 0) > 0 ||
      args.extraction.providerExplanationRequest != null ||
      args.extraction.providerDetailRequest != null ||
      args.extraction.closeAction != null ||
      args.extraction.pauseRequested;
    if (
      (args.extraction.ambiguity?.status === 'ambiguous' ||
        this.isBareProviderConfirmationTurn(args.extraction)) &&
      !hasCompetingProviderWork &&
      this.hasUnresolvedProviderShortlist(plan, args.extraction, args.inbound.text)
    ) {
      const clarificationText = '¿Qué proveedor o acción estás confirmando?';
      await this.dependencies.planStore.save({
        plan,
        reason: 'contextual_clarification',
      });
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
      );
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      return {
        plan,
        outbound: this.renderOutbound(
          { text: clarificationText },
          [],
          args.inbound.channel,
          plan.conversation_id,
          plan,
        ),
        trace: this.buildTrace({
          plan,
          previousNode: args.previousNode,
          currentNode: plan.current_node,
          nodePath: args.previousNode === plan.current_node
            ? [plan.current_node]
            : [args.previousNode, plan.current_node],
          extraction: args.extraction,
          missingFields: plan.missing_fields,
          searchReady: false,
          promptBundleId: 'deterministic:ambiguous_provider_confirmation',
          promptFilePaths: [],
          toolUsage: args.toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'contextual_clarification',
          timingMs: args.timingMs,
          tokenUsage: args.tokenUsage,
          messageContext: args.messageContext,
          responseClassifier: args.responseClassifierTrace,
          searchStrategy: 'none',
          turnDecision: this.contextualClarificationTurnDecision(
            'contextual_clarification',
          ),
          operationalNote: 'Bare confirmation over a multi-option shortlist clarified without selecting a provider.',
          informationExecution: [],
        }),
      };
    }
    await this.dependencies.planStore.save({
      plan,
      reason: 'contextual_clarification',
    });
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
    );
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const turnDecision = this.contextualClarificationTurnDecision(
      'contextual_clarification',
    );
    const shouldComposeFromCanonicalContext =
      plan.current_node === 'resolver_consultas_informativas' &&
      args.messageContext.recentMessages.length === 0 &&
      plan.conversation_summary.trim().length > 0;
    let promptBundleId = 'deterministic:contextual_clarification';
    let promptFilePaths: string[] = [];
    let reply = {
      text: this.contextualClarificationMessage(continuity, args.extraction),
    };
    let operationalNote = 'Prior typed state was preserved after an empty or ambiguous extraction; no external information or reply call was made.';
    if (shouldComposeFromCanonicalContext) {
      const promptBundleStartedAt = Date.now();
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(
        'resolver_consultas_informativas',
      );
      args.timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
      const composeReplyStartedAt = Date.now();
      const composedReply = await this.dependencies.runtime.composeReply({
        currentNode: 'resolver_consultas_informativas',
        previousNode: args.previousNode,
        userMessage: args.inbound.text,
        messageContext: args.messageContext,
        plan,
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        providerResults: [],
        turnDecision,
        errorMessage: 'No se extrajo una acción nueva, pero el resumen canónico conserva el tema activo. Responde con una sola frase que reconozca el significado contextual del mensaje y continúe ese tema. No hagas una pregunta genérica ni afirmes una acción externa.',
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        informationResults: [],
      });
      args.timingMs.compose_reply += Date.now() - composeReplyStartedAt;
      args.tokenUsage.reply = composedReply.tokenUsage ?? null;
      args.tokenUsage.openAiCalls.reply = composedReply.openAiCall ?? null;
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
        args.tokenUsage.reply,
      );
      reply = composedReply;
      promptBundleId = bundle.id;
      promptFilePaths = bundle.filePaths;
      operationalNote = 'Empty extraction with unavailable history was resolved from the compact canonical conversation summary.';
    }
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    return {
      plan,
      outbound: this.renderOutbound(
        reply,
        [],
        args.inbound.channel,
        plan.conversation_id,
        plan,
      ),
      trace: this.buildTrace({
        plan,
        previousNode: args.previousNode,
        currentNode: plan.current_node,
        nodePath: args.previousNode === plan.current_node
          ? [plan.current_node]
          : [args.previousNode, plan.current_node],
        extraction: args.extraction,
        missingFields: plan.missing_fields,
        searchReady: false,
        promptBundleId,
        promptFilePaths,
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'contextual_clarification',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision,
        operationalNote,
        informationExecution: [],
      }),
    };
  }

  private async handleCapabilityBoundaryIfNeeded(args: {
    inbound: NormalizedInboundMessage;
    previousNode: DecisionNode;
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    responseClassifierTrace?: MessageResponseClassifierTrace;
    messageContext: TurnMessageContext;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse | null> {
    const ambiguity = args.extraction.ambiguity;
    const candidateOperations = ambiguity?.candidateOperations ?? [];
    if (
      !args.extraction.requestedOperation &&
      !(ambiguity?.status === 'ambiguous' && candidateOperations.length > 0)
    ) {
      return null;
    }
    const decision = resolveCapabilityDecision({
      requestedOperation: args.extraction.requestedOperation ?? null,
      manifest: this.capabilityManifest,
      ambiguity: ambiguity
        ? {
            status: ambiguity.status,
            candidateOperations,
            questionKey: ambiguity.questionKey ?? undefined,
          }
        : undefined,
    });
    if (decision.status === 'not_applicable' || decision.status === 'supported') {
      return null;
    }

    // The extractor can report a capability operation alongside a more
    // specific typed domain turn. Let the domain flow reconcile its own
    // authoritative state before deciding whether a write is needed. A
    // capability-only request has no such evidence and remains intercepted.
    const hasRsvpEvidence = this.hasMeaningfulRsvpEvidence(args.plan, args.extraction);
    const hasSecondaryPlanningOperation = decision.status === 'unsupported' &&
      this.hasProviderPlanningEvidence(args.extraction) &&
      this.isProviderPlanningActionIntent(args.extraction.actionIntent) &&
      !this.isProviderPlanningCapabilityOperation(decision.operation);
    if (hasRsvpEvidence || hasSecondaryPlanningOperation) {
      return null;
    }

    const capabilityBoundaryRenderer = await this.loadCapabilityBoundaryRenderer();

    if (decision.status === 'clarify') {
      // Capability clarification is still an information-resolution turn.
      // Preserve that node explicitly so a seeded or resumed plan cannot
      // drift into the generic planning interview while waiting for the
      // user's one confirmation answer.
      const plan = args.plan.current_node === 'resolver_consultas_informativas'
        ? args.plan
        : mergePlan(args.plan, { current_node: 'resolver_consultas_informativas' });
      await this.dependencies.planStore.save({ plan, reason: 'capability_clarification_requested' });
      args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction);
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      const turnDecision = this.contextualClarificationTurnDecision('capability_clarification_requested');
      return {
        plan,
        outbound: this.renderOutbound(
          { text: capabilityBoundaryRenderer.render(decision) ?? '¿Qué necesitas hacer exactamente con esta información?' },
          [], args.inbound.channel, plan.conversation_id, plan,
        ),
        trace: this.buildTrace({
          plan,
          previousNode: args.previousNode,
          currentNode: plan.current_node,
          nodePath: args.previousNode === plan.current_node ? [plan.current_node] : [args.previousNode, plan.current_node],
          extraction: args.extraction,
          missingFields: plan.missing_fields,
          searchReady: false,
          promptBundleId: 'deterministic:capability_clarification',
          promptFilePaths: ['prompts/nodes/resolver_consultas_informativas/capability_boundary.txt'],
          toolUsage: args.toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'capability_clarification_requested',
          timingMs: args.timingMs,
          tokenUsage: args.tokenUsage,
          messageContext: args.messageContext,
          searchStrategy: 'none',
          turnDecision,
          operationalNote: 'Capability request was ambiguous; no external call was made.',
          responseClassifier: args.responseClassifierTrace,
          capabilityDecision: decision,
        }),
      };
    }

    const safeRead = await this.performCapabilitySafeRead({
      inbound: args.inbound,
      plan: args.plan,
      extraction: args.extraction,
      toolUsage: args.toolUsage,
    });
    const reportedPurchaseAmount = args.extraction.informationRequests.find(
      (request): request is Extract<ExtractedInformationRequest, { kind: 'purchase' }> =>
        request.kind === 'purchase' && request.amount !== null && request.amount !== undefined,
    )?.amount ?? null;
    const purchaseContinuationText = decision.status === 'unsupported'
      ? resolveCapabilityPurchaseContinuation({
        operation: decision.operation,
        results: safeRead.results,
        reportedAmount: reportedPurchaseAmount,
      })
      : null;
    if (purchaseContinuationText !== null) {
      const plan = args.plan.current_node === 'resolver_consultas_informativas'
        ? args.plan
        : mergePlan(args.plan, { current_node: 'resolver_consultas_informativas' });
      await this.dependencies.planStore.save({ plan, reason: 'capability_purchase_continuation' });
      args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction);
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      return {
        plan,
        outbound: this.renderOutbound(
          { text: purchaseContinuationText },
          [],
          args.inbound.channel,
          plan.conversation_id,
          plan,
        ),
        trace: this.buildTrace({
          plan,
          previousNode: args.previousNode,
          currentNode: plan.current_node,
          nodePath: args.previousNode === plan.current_node
            ? [plan.current_node]
            : [args.previousNode, plan.current_node],
          extraction: args.extraction,
          missingFields: plan.missing_fields,
          searchReady: false,
          promptBundleId: 'deterministic:capability_purchase_continuation',
          promptFilePaths: [],
          toolUsage: args.toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'capability_purchase_continuation',
          timingMs: args.timingMs,
          tokenUsage: args.tokenUsage,
          messageContext: args.messageContext,
          searchStrategy: 'none',
          turnDecision: this.informationTurnDecision('capability_purchase_continuation'),
          operationalNote: 'Authorized safe read completed before the unsupported mutation; the reply uses canonical purchase evidence with no mutation and no handoff.',
          responseClassifier: args.responseClassifierTrace,
          capabilityDecision: decision,
          informationExecution: safeRead.summaries,
        }),
      };
    }
    const alreadyRequested = args.plan.human_escalation.status === 'requested';
    const phoneNumber = this.resolveEscalationPhone(args.inbound);
    const takeoverResult = alreadyRequested
      ? ({ status: 'success', message: 'Human takeover was already requested.' } satisfies AgentGatewayResult)
      : decision.humanTakeoverAvailable && phoneNumber
        ? await this.requestHumanTakeoverWithTrace(
            this.dependencies.agentConversationGateway ?? new NoopAgentConversationGateway('not_configured'),
            phoneNumber,
            args.toolUsage,
          )
        : this.missingPhoneEscalationResult();
    const takeoverSucceeded = takeoverResult.status === 'success';
    const plan = takeoverSucceeded && !alreadyRequested
      ? mergePlan(args.plan, {
          current_node: 'solicitar_agente_humano',
          intent: 'solicitar_humano',
          human_escalation: {
            status: 'requested',
            requested_at: new Date().toISOString(),
            phone_number: phoneNumber,
            last_error: null,
          },
        })
      : args.plan;
    await this.dependencies.planStore.save({ plan, reason: 'unsupported_operation_detected' });
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction);
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const boundaryText = capabilityBoundaryRenderer.render(decision, {
      humanTakeoverRequested: alreadyRequested || takeoverSucceeded,
      humanTakeoverSucceeded: takeoverSucceeded,
      humanTakeoverFailed: !takeoverSucceeded && !alreadyRequested,
    }) ?? 'No puedo realizar esa gestión desde aquí.';
    const safeReadContext = this.renderCapabilitySafeReadContext({
      extraction: args.extraction,
      results: safeRead.results,
    });
    const text = safeReadContext ? `${safeReadContext} ${boundaryText}` : boundaryText;
    return {
      plan,
      outbound: this.renderOutbound({ text }, [], args.inbound.channel, plan.conversation_id, plan),
      trace: this.buildTrace({
        plan,
        previousNode: args.previousNode,
        currentNode: takeoverSucceeded ? 'solicitar_agente_humano' : args.previousNode,
        nodePath: takeoverSucceeded && args.previousNode !== 'solicitar_agente_humano'
          ? [args.previousNode, 'solicitar_agente_humano']
          : [args.previousNode],
        extraction: args.extraction,
        missingFields: plan.missing_fields,
        searchReady: false,
        promptBundleId: 'deterministic:unsupported_operation',
        promptFilePaths: ['prompts/nodes/resolver_consultas_informativas/capability_boundary.txt'],
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'unsupported_operation_detected',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        searchStrategy: 'none',
        turnDecision: takeoverSucceeded
          ? this.humanEscalationTurnDecision('unsupported_operation_detected')
          : undefined,
        operationalNote: takeoverSucceeded
          ? 'Unsupported operation was handed off once.'
          : 'Unsupported operation could not be handed off; success was not claimed.',
        responseClassifier: args.responseClassifierTrace,
        capabilityDecision: decision,
        humanTakeoverAttempted: !alreadyRequested && decision.humanTakeoverAvailable,
        humanTakeoverSucceeded: takeoverSucceeded,
        informationExecution: safeRead.summaries,
      }),
    };
  }

  /**
   * Render only the canonical status that directly complements an unsupported
   * proof-validation request. This evidence is conditional on the current
   * typed outcome and is never added to shared model instructions.
   */
  private renderCapabilitySafeReadContext(args: {
    extraction: ExtractionResult;
    results: InformationTaskResult[];
  }): string | null {
    if (args.extraction.requestedOperation !== 'payment_proof.verify') return null;
    const completed = args.results.find(
      (result): result is Extract<InformationTaskResult, { kind: 'purchase'; status: 'completed' }> =>
        result.kind === 'purchase' && result.status === 'completed',
    );
    if (!completed || completed.needsSelection || completed.purchases.length !== 1) return null;
    const purchase = completed.purchases[0];
    if (!purchase || purchase.paymentStatus?.trim().toLocaleLowerCase('en') !== 'pending') {
      return null;
    }

    const reportedPurchase = args.extraction.informationRequests.find(
      (request): request is Extract<ExtractedInformationRequest, { kind: 'purchase' }> =>
        request.kind === 'purchase' && request.amount !== null && request.amount !== undefined,
    );
    const reportedAmount = reportedPurchase?.amount;
    const report = reportedAmount === null || reportedAmount === undefined
      ? 'Tomo nota de que indicas haber enviado el comprobante.'
      : `Tomo nota de que indicas haber enviado ${reportedAmount}.`;
    const event = purchase.eventName?.trim()
      ? `El pedido de ${purchase.eventName.trim()} sigue pendiente de validación.`
      : 'El pedido consultado sigue pendiente de validación.';
    const validation = purchase.paymentValidationExpectation?.maxBusinessHours === 72
      ? 'La validación puede tardar hasta 72 horas hábiles.'
      : null;
    return [report, event, validation].filter((part): part is string => part !== null).join(' ');
  }

  /**
   * A document/proof request may still benefit from the existing status read.
   * The read is deliberately phone-scoped, uses only canonical projections,
   * and is never sent to the reply model as raw endpoint data.
   */
  private async performCapabilitySafeRead(args: {
    inbound: NormalizedInboundMessage;
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    toolUsage: ToolUsage;
  }): Promise<CapabilitySafeReadOutcome> {
    const operation = args.extraction.requestedOperation;
    if (
      operation !== 'confirmation_document.send' &&
      operation !== 'payment_proof.verify' &&
      operation !== 'purchase.modify'
    ) {
      return { results: [], summaries: [] };
    }
    const trustedPhone = splitInternationalPhone(
      args.inbound.contactPhone ?? args.plan.contact_phone ?? null,
    );
    if (!trustedPhone) return { results: [], summaries: [] };

    const extractedPurchase = args.extraction.informationRequests.find(
      (request) => request.kind === 'purchase',
    );
    const persistedPurchase = args.plan.information_state.pending_requests.find(
      (request): request is Extract<PendingInformationRequest, { kind: 'purchase' }> =>
        request.kind === 'purchase',
    );
    const existingPurchase = persistedPurchase ?? extractedPurchase;
    // A dedication change (purchase.modify) must read the gift partition even
    // when a persisted or extracted request points at orders: the orders
    // partition is empty for gift-only phones (live Joaquin), which stranded
    // the safe read and forced an unsupported handoff without selection.
    const safeReadResource = operation === 'purchase.modify' ? 'gift_purchases' : 'orders';
    const safeReadAspects: PurchaseAspect[] = operation === 'purchase.modify'
      ? ['summary', 'dedication']
      : ['payment_status'];
    const request: Extract<PendingInformationRequest, { kind: 'purchase' }> = existingPurchase
      ? {
          ...existingPurchase,
          requestId: persistedPurchase?.requestId ?? 'capability-status-read',
          resource: safeReadResource,
          aspects: safeReadAspects,
          sensitiveFields: [],
          authAction: 'none',
          // On a proof-validation turn the newly extracted amount describes
          // what the user reports sending, not the order total used to select
          // a purchase. Only a previously persisted selector remains valid.
          amount: persistedPurchase?.amount ?? null,
        }
      : {
          requestId: 'capability-status-read',
          kind: 'purchase',
          resource: operation === 'purchase.modify' ? 'gift_purchases' : 'orders',
          query: args.inbound.text,
          orderId: null,
          aspects: operation === 'purchase.modify'
            ? ['summary', 'dedication']
            : ['summary', 'payment_status'],
          sensitiveFields: [],
          authAction: 'none',
        };
    const toolName = this.informationToolName(request);
    this.recordDeterministicToolInput(
      args.toolUsage,
      toolName,
      this.summarizeInformationToolInput(request),
    );
    const orchestrator =
      this.dependencies.informationOrchestrator ??
      new InformationOrchestrator({
        knowledgeGateway: new NoopKnowledgeRetrievalGateway(),
        providerGateway: this.dependencies.providerGateway,
        agentGateway:
          this.dependencies.agentConversationGateway ??
          new NoopAgentConversationGateway('not_configured'),
        capabilityManifest: this.capabilityManifest,
      });
    const execution = await orchestrator.execute({
      requests: [request],
      authentication: null,
      authBlock: null,
      trustedPhone,
    });
    this.recordInformationExecutionTrace(args.toolUsage, execution.summaries);
    return execution;
  }

  private async handleMediaOnlyMessage(args: {
    inbound: NormalizedInboundMessage;
    plan: PlanSnapshot;
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse> {
    const plan = mergePlan(args.plan, { current_node: 'resolver_consultas_informativas' });
    const extraction = this.buildSyntheticSuppressionExtraction('Media-only message; content access is unavailable.');
    const decision = resolveCapabilityDecision({
      requestedOperation: 'media.image.inspect',
      manifest: this.capabilityManifest,
    });
    const capabilityBoundaryRenderer = await this.loadCapabilityBoundaryRenderer();
    await this.dependencies.planStore.save({ plan, reason: 'unsupported_image_media' });
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction);
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    return {
      plan,
      outbound: this.renderOutbound(
        { text: capabilityBoundaryRenderer.render(decision) ?? 'No puedo leer ni revisar el contenido de imágenes.' },
        [], args.inbound.channel, plan.conversation_id, plan,
      ),
      trace: this.buildTrace({
        plan,
        previousNode: args.plan.current_node,
        currentNode: plan.current_node,
        nodePath: args.plan.current_node === plan.current_node ? [plan.current_node] : [args.plan.current_node, plan.current_node],
        extraction,
        missingFields: plan.missing_fields,
        searchReady: false,
        promptBundleId: 'deterministic:unsupported_image_media',
        promptFilePaths: ['prompts/nodes/resolver_consultas_informativas/capability_boundary.txt'],
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'unsupported_image_media',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        searchStrategy: 'none',
        operationalNote: 'Image metadata was received without content access; extraction and external calls were skipped.',
        capabilityDecision: decision,
      }),
    };
  }

  private hasProviderPlanningEvidence(extraction: ExtractionResult): boolean {
    return (
      this.hasStructuredPlanningSignal(extraction) ||
      (extraction.providerPlanOperations?.length ?? 0) > 0 ||
      (extraction.selectedProviderReferences?.length ?? 0) > 0 ||
      extraction.selectedProviderHints.length > 0 ||
      extraction.providerExplanationRequest != null ||
      extraction.providerDetailRequest != null ||
      extraction.closeAction != null ||
      extraction.pauseRequested
    );
  }

  private hasMeaningfulRsvpEvidence(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): boolean {
    const hasExtractionEvidence =
      extraction.actionIntent === 'responder_invitacion' ||
      extraction.rsvpAction !== null && extraction.rsvpAction !== undefined ||
      extraction.rsvpCandidateGuestId !== null && extraction.rsvpCandidateGuestId !== undefined ||
      extraction.rsvpEventReference !== null && extraction.rsvpEventReference !== undefined ||
      extraction.rsvpParty !== null && extraction.rsvpParty !== undefined;
    return hasExtractionEvidence && this.hasRsvpWork(plan, extraction);
  }

  private isProviderPlanningActionIntent(
    actionIntent: ExtractionResult['actionIntent'],
  ): boolean {
    switch (actionIntent) {
      case 'reset_plan':
      case 'elicitar_necesidades':
      case 'buscar_proveedores':
      case 'refinar_busqueda':
      case 'ver_opciones':
      case 'confirmar_proveedor':
      case 'modificar_plan_proveedores':
      case 'explicar_recomendacion':
      case 'detallar_proveedor':
      case 'retomar_plan':
      case 'cerrar':
      case 'pausar':
        return true;
      default:
        return false;
    }
  }

  private isProviderPlanningCapabilityOperation(
    operation: RuntimeOperationId,
  ): boolean {
    return operation === 'provider.plan' ||
      operation === 'provider.search' ||
      operation === 'provider.quote.write';
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
        candidateOperations: [],
        questionKey: null,
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
    const supportAcknowledgment = this.isSupportAcknowledgment(args.extraction.supportAct) &&
      args.extraction.informationRequests.length === 0 && args.extraction.actionIntent === null;
    const resumeNode =
      args.workingPlan.current_node === currentNode
        ? args.workingPlan.information_state.resume_node
        : args.workingPlan.current_node;
    const planWithContact = mergePlan(args.workingPlan, {
      contact_email:
        args.extraction.contactEmail &&
        this.isValidEmail(args.extraction.contactEmail)
          ? args.extraction.contactEmail
          : args.workingPlan.contact_email,
    });
    let requests = this.mergeInformationRequests(
      planWithContact.information_state.pending_requests,
      args.extraction.informationRequests,
    );
    requests = this.normalizePurchaseDetailRoute(requests);
    const lastCompletedRequest =
      planWithContact.information_state.last_completed_request;
    const supportContinuesPurchaseThread = supportAcknowledgment &&
      (lastCompletedRequest?.kind === 'purchase' ||
        lastCompletedRequest?.kind === 'associated_event');
    if (supportAcknowledgment && !supportContinuesPurchaseThread) requests = [];
    if (args.extraction.supportAct?.kind === 'ask_policy' &&
      !requests.some((request) => request.kind === 'faq')) {
      requests = [{
        kind: 'faq',
        query: args.inbound.text,
        requestId: 'support-policy',
      }, ...requests];
    }
    let replayingLastCompletedRequest = false;
    const hasNewFaqInExtraction = args.extraction.informationRequests.some(
      (request) => request.kind === 'faq',
    );
    if (
      !supportAcknowledgment && requests.length === 0 &&
      args.extraction.actionIntent === null &&
      lastCompletedRequest &&
      (lastCompletedRequest.kind === 'purchase' ||
        lastCompletedRequest.kind === 'associated_event' ||
        (lastCompletedRequest.kind === 'faq' && hasNewFaqInExtraction))
    ) {
      requests = [{ ...lastCompletedRequest, requestId: 'information-1' }];
      replayingLastCompletedRequest = true;
    }
    if (
      supportContinuesPurchaseThread &&
      requests.length === 0 &&
      lastCompletedRequest &&
      (lastCompletedRequest.kind === 'purchase' ||
        lastCompletedRequest.kind === 'associated_event')
    ) {
      requests = [{ ...lastCompletedRequest, requestId: 'information-1' }];
      replayingLastCompletedRequest = true;
    }
    const continuingLastCompletedRequest = Boolean(
      !replayingLastCompletedRequest &&
      args.extraction.actionIntent === null &&
      lastCompletedRequest &&
      (lastCompletedRequest.kind === 'purchase' ||
        lastCompletedRequest.kind === 'associated_event') &&
      args.extraction.informationRequests.some((request) =>
        this.sameInformationThread(lastCompletedRequest, request),
      ),
    );
    const preservingLastCompletedContext =
      replayingLastCompletedRequest || continuingLastCompletedRequest;
    let planForInformation = mergePlan(planWithContact, {
      current_node: currentNode,
      information_state: {
        ...planWithContact.information_state,
        resume_node: resumeNode,
        pending_requests: requests,
        selection_candidates:
          planWithContact.information_state.selection_candidates,
        last_completed_request: lastCompletedRequest ?? null,
      },
    });

    if (supportAcknowledgment && !supportContinuesPurchaseThread) {
      return this.handleSupportAcknowledgment(args, mergePlan(planForInformation, {
        information_state: {
          ...planForInformation.information_state,
          pending_requests: planWithContact.information_state.pending_requests,
        },
      }));
    }

    const hostWithdrawalRequests = requests.filter((request) =>
      request.kind === 'faq' && request.hostWithdrawal);
    if (
      hostWithdrawalRequests.length > 0 &&
      args.extraction.ambiguity?.status !== 'ambiguous' &&
      (args.extraction.actionIntent === null || args.extraction.actionIntent === 'solicitar_humano') &&
      (hostWithdrawalRequests.length === requests.length ||
        hostWithdrawalRequests.some((request) =>
          request.kind === 'faq' && request.hostWithdrawal === 'individual_status'))
    ) {
      return this.handleHostWithdrawalInformation(args, planForInformation, requests);
    }

    const hasActionConflict =
      args.extraction.actionIntent !== null &&
      requests.length > 0;
    const isRetiredPhoneConfirmationRecovery =
      planForInformation.user_auth.awaiting_phone_confirmation &&
      Boolean(args.inbound.contactPhone) &&
      requests.some(
        (request) =>
          request.kind === 'associated_event' || request.kind === 'purchase',
      );
    const hasAmbiguity =
      args.extraction.ambiguity?.status === 'ambiguous' &&
      !preservingLastCompletedContext &&
      !isRetiredPhoneConfirmationRecovery;
    const informationExtraction = isRetiredPhoneConfirmationRecovery ||
      preservingLastCompletedContext
      ? {
          ...args.extraction,
          ...(isRetiredPhoneConfirmationRecovery
            ? {
                conversationSummary: `Consulta pendiente recuperada: ${requests
                  .map((request) => request.query)
                  .join(' | ')}`,
              }
            : {}),
          ambiguity: {
            status: 'clear' as const,
            clarificationQuestion: null,
            interpretations: [],
          },
        }
      : args.extraction;
    let informationResults: InformationTaskResult[] = [];
    let informationSummaries: InformationExecutionSummary[] = [];
    let operationalNote: string | null = null;
    let completedPhonePurchase: InformationTaskResult | undefined;
    let completedGuestEventForReply = false;
    const protectedAuthAction = requests
      .filter((request) => request.kind === 'purchase' || request.kind === 'associated_event')
      .map((request) => request.authAction ?? 'none')
      .find((action) => action !== 'none') ?? 'none';
    // A rejected phone association is not a refusal to continue verification.
    // The typed phone decision takes precedence if extraction also attached the
    // broader refusal action to the protected request.
    if (
      protectedAuthAction === 'decline_authentication' &&
      (
        args.extraction.phoneConfirmation !== 'no' ||
        (
          !planForInformation.user_auth.awaiting_phone_confirmation &&
          planForInformation.user_auth.auth_method !== 'phone'
        )
      )
    ) {
      return await this.completeDeclinedInformationAuthentication({
        ...args,
        plan: planForInformation,
        resumeNode,
        requests,
      });
    }

    // One-shot OTP recovery (F1): the first non-delivery report or resend
    // request on an active challenge terminates the episode. The typed
    // state machine owns the decision; legacy counters persist the budget.
    const otpTerminalContinuation = decideTerminalContinuation(
      protectedAuthAction,
      {
        status: planForInformation.user_auth.status,
        email: planForInformation.user_auth.email,
        requestedAt: planForInformation.user_auth.requested_at,
        failedCodeAttempts: planForInformation.user_auth.failed_code_attempts,
        otpSendAttempts: planForInformation.user_auth.otp_send_attempts,
        otpNonDeliveryReports: planForInformation.user_auth.otp_non_delivery_reports,
      },
    );
    if (otpTerminalContinuation !== null) {
      return await this.escalateInformationAuthentication({
        ...args,
        plan: planForInformation,
        reason: 'otp_recovery_exhausted',
      });
    }

    if ((args.extraction.normalizationIssues?.length ?? 0) > 0) {
      operationalNote = 'La solicitud de soporte fue reconocida, pero no se pudo determinar de forma segura qué tipo de información de compra se necesita. Haz una sola pregunta breve para aclararlo. No des la bienvenida ni pidas correo o código todavía.';
    } else if (hasActionConflict) {
      operationalNote =
        'El mensaje combina una acción del plan con consultas informativas. Haz una sola pregunta breve para confirmar cuál quiere resolver primero. No ejecutes ni respondas ninguna de las dos rutas todavía.';
    } else if (hasAmbiguity) {
      operationalNote = this.resolveFaqAmbiguityNote(args.extraction);
      planForInformation = mergePlan(planForInformation, {
        information_state: {
          ...planForInformation.information_state,
          pending_requests:
            planWithContact.information_state.pending_requests,
          last_completed_request:
            planForInformation.information_state.last_completed_request ?? null,
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

      if (this.isTerminalInformationAuthBlock(authResolution.authBlock)) {
        return await this.escalateInformationAuthentication({
          ...args,
          plan: planForInformation,
          reason: authResolution.authBlock?.guidance.reason ?? 'authentication_failed',
        });
      }

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
        capabilityManifest: this.capabilityManifest,
      });
      const execution = await withAuthenticationFlowContext(
        {
          authFlowId: authResolution.authFlowId,
          planId: planForInformation.plan_id,
        },
        async () => {
          const result = await orchestrator.execute({
            requests,
            authentication: authResolution.authentication,
            authBlock: authResolution.authBlock,
            trustedPhone: args.extraction.phoneConfirmation === 'no'
              ? null
              : splitInternationalPhone(args.inbound.contactPhone),
          });
          logAuthObservabilityEvent('info', 'information_auth_execution_completed', {
            auth_flow_operation_id: authResolution.authFlowId,
            duration_ms: Date.now() - informationStartedAt,
            summaries: result.summaries,
          });
          return result;
        },
      );
      args.timingMs.information_execution += Date.now() - informationStartedAt;
      informationResults = execution.results;
      informationSummaries = execution.summaries;
      this.recordInformationExecutionTrace(
        args.toolUsage,
        informationSummaries,
      );

      const scopedRequests = informationResults.filter((result) => result.kind !== 'faq');
      const onlyPhoneScopedMisses = scopedRequests.length > 0 && scopedRequests.every(
        (result) => result.status === 'failed' && result.failureKind === 'not_found' &&
          (result.accessMethod === 'trusted_phone_guest' || result.accessMethod === 'trusted_phone_purchase'),
      );
      if (onlyPhoneScopedMisses) {
        return await this.escalateInformationAuthentication({
          ...args,
          plan: planForInformation,
          reason: 'phone_information_not_found',
          informationExecution: informationSummaries,
        });
      }

      const completedThroughTrustedPhone = informationResults.some(
        (result) =>
          result.status === 'completed' &&
          ((result.kind === 'associated_event' &&
            result.accessMethod === 'trusted_phone_guest') ||
            (result.kind === 'purchase' &&
              (result.accessMethod === 'trusted_phone_purchase' ||
                result.accessMethod === 'trusted_phone_event_purchase'))),
      );
      if (
        completedThroughTrustedPhone &&
        requests.every((request) =>
          request.kind === 'faq' ||
          request.kind === 'associated_event' ||
          request.kind === 'purchase')
      ) {
        planForInformation = this.resetUserAuth(planForInformation, null);
      }

      const guestEventResult = informationResults.find(
        (result) =>
          result.status === 'completed' &&
          result.kind === 'associated_event' &&
          result.accessMethod === 'trusted_phone_guest',
      );
      const hasRemainingEmailAuthentication = informationResults.some(
        (result) => result.status === 'needs_input' && result.nextInput === 'email',
      );
      if (
        operationalNote === null &&
        guestEventResult?.status === 'completed' &&
        guestEventResult.kind === 'associated_event'
      ) {
        const currentReminderForEvent = args.messageContext.recentMessages
          .filter((message) => message.direction === 'outbound'
            && (message.source === 'frontend_followup' || message.source === 'admin_campaign'))
          .sort((left, right) => left.id - right.id)
          .at(-1) ?? null;
        const detailedEventCount = guestEventResult.result.events.filter(
          (event) => event.detail !== undefined,
        ).length;
        operationalNote =
          currentReminderForEvent !== null
            ? `Explica el recordatorio vigente desde el mensaje saliente con su título literal (por ejemplo "${currentReminderForEvent.body.slice(0, 120)}"). No uses registros históricos ni el evento del número confiable cuando difiera del recordatorio, no cambies asistencia ni pidas correo o código.`
            : guestEventResult.result.events.length > 1 && detailedEventCount === 0
            ? 'El número confiable está invitado a varios eventos y la referencia no identifica uno de forma única. Muestra únicamente sus nombres y fechas y pregunta en una sola frase a cuál se refiere. No pidas correo ni código.'
            : hasRemainingEmailAuthentication
              ? 'La consulta del evento se resolvió directamente con la invitación asociada al número confiable. Responde primero solo con los datos solicitados del evento y pide el correo registrado únicamente para las consultas protegidas que siguen pendientes.'
              : 'La consulta del evento se resolvió directamente con la invitación asociada al número confiable. Responde solo con los datos solicitados del resultado y no pidas correo ni código.';
      }

      const phonePurchaseResult = informationResults.find(
        (result) =>
          result.status === 'completed' &&
          result.kind === 'purchase' &&
          (result.accessMethod === 'trusted_phone_purchase' ||
            result.accessMethod === 'trusted_phone_event_purchase'),
      );
      if (
        operationalNote === null &&
        phonePurchaseResult?.status === 'completed' &&
        phonePurchaseResult.kind === 'purchase'
      ) {
        const unavailableSinglePurchase = phonePurchaseResult.referenceResolution === 'unavailable' &&
          phonePurchaseResult.purchases.length === 1;
        operationalNote = phonePurchaseResult.referenceResolution === 'unavailable'
          ? unavailableSinglePurchase
            ? 'El número confiable permitió recuperar la compra, pero la fuente no expuso el número de transacción visible para vincular el código solicitado. Responde de forma concisa solo el estado para el evento consultado, sin identificadores, montos, fechas ni preguntas de confirmación, y no pidas correo ni código.'
            : 'El número confiable permitió recuperar compras, pero la fuente no expuso el número de transacción visible para vincular el código solicitado. Dilo brevemente, muestra opciones solo por monto, fecha y estado sin atribuir eventos, pide elegir una y no muestres identificadores internos ni pidas correo o código.'
          : phonePurchaseResult.coverage === 'partial'
          ? 'La consulta se resolvió con información resumida asociada al número confiable porque el detalle no estuvo disponible. Responde solo con los campos presentes, aclara brevemente que la cobertura es parcial y no pidas correo ni código.'
          : phonePurchaseResult.coverage === 'inconsistent'
            ? 'Las fuentes asociadas al número confiable discreparon. Usa únicamente los valores canónicos proyectados, indica que se requiere revisión para cualquier campo no concluyente y no muestres versiones contradictorias ni pidas correo o código.'
            : 'La consulta de compra se resolvió directamente con el número confiable. Responde solo con los campos solicitados del resultado y no pidas correo ni código.';
        const asksExplicitAmount = args.extraction.informationRequests.some(
          (request) => request.kind === 'purchase' && request.amount !== null && request.amount !== undefined,
        );
        const isSingleStatusQuery = phonePurchaseResult.purchases.length === 1 && !asksExplicitAmount;
        if (isSingleStatusQuery) {
          operationalNote += ' Responde de forma concisa solo el estado (pendiente/en verificación o aprobado/confirmado) para el evento consultado, en español natural. No menciones monto, método de pago, moneda, registro ni plazos de validación.';
        }
        if (
          !isSingleStatusQuery && (phonePurchaseResult.purchases.some(
            (purchase) => purchase.amountDisclosure?.presentation === 'recorded_method_no_currency',
          ) ||
          phonePurchaseResult.carts?.some(
            (cart) => cart.amountDisclosure?.presentation === 'recorded_method_no_currency',
          ))
        ) {
          operationalNote += ' Para amountDisclosure con presentation=recorded_method_no_currency, comunica “monto [valor] mediante [método registrado]”. No añadas símbolo ni nombre de moneda; si falta el método, di solo “monto [valor]”.';
        }
        const hasUnverifiableTransactionTime = phonePurchaseResult.purchases.some(
          (purchase) =>
            purchase.paymentValidationExpectation !== undefined &&
            purchase.paymentValidationExpectation !== null &&
            !purchase.payment?.paidAt,
        );
        if (hasUnverifiableTransactionTime) {
          operationalNote += ' La evidencia canónica no verifica una fecha u hora de pago. Si la persona propone una corrección temporal, reconócela solo como dato aportado por ella; no afirmes que el registro o el backend la confirma.';
        }
        const hasUnverifiableCurrency = phonePurchaseResult.purchases.some(
          (purchase) =>
            purchase.amountDisclosure?.presentation === 'recorded_method_no_currency' ||
            !purchase.currency,
        );
        if (hasUnverifiableCurrency && !isSingleStatusQuery) {
          operationalNote += ' La evidencia canónica no consigna moneda para esta compra. Si la persona menciona una moneda (por ejemplo USD, dólares, soles, PEN), reconócela solo como dato aportado por ella; indica que la moneda no figura en el registro y permanece sin confirmar; no presentes la moneda mencionada como hecho del registro ni del backend.';
        }
        const hasCustomerTransactionNumber = phonePurchaseResult.purchases.some(
          (purchase) => Boolean(purchase.customerTransactionNumber),
        );
        if (hasCustomerTransactionNumber) {
          operationalNote += ' Nunca afirmes que no existe constancia o comprobante; no comentes fecha u hora de pago salvo que la persona lo pregunte.';
        }
        const hasPendingPurchaseForProvenance = phonePurchaseResult.purchases.some(
          (purchase) => purchase.paymentStatus?.toLowerCase() === 'pending',
        );
        const selectedProvenancePurchase = phonePurchaseResult.purchases.find(
          (purchase) => purchase.paymentStatus?.toLowerCase() === 'pending',
        ) ?? phonePurchaseResult.purchases[0];
        const selectedTotalForProvenance = selectedProvenancePurchase
          ? (selectedProvenancePurchase.amountDisclosure?.total ?? (selectedProvenancePurchase as unknown as { grandTotal: number | null }).grandTotal ?? null)
          : null;
        const hasAmountMismatchForProvenance = selectedTotalForProvenance !== null &&
          args.extraction.informationRequests.some(
            (request) => request.kind === 'purchase' && request.amount !== null && request.amount !== undefined && Math.abs(request.amount - selectedTotalForProvenance) >= 0.005,
          );
        if (hasPendingPurchaseForProvenance && hasAmountMismatchForProvenance) {
          operationalNote += ' El monto que la persona dice haber pagado es un dato aportado por ella; no lo presentes como monto del registro. Reconoce el reporte; la orden sigue pendiente; un comprobante en imagen no permite confirmar la recepcion; la validacion puede tardar hasta 72 horas habiles; no afirmes aprobacion ni niegues la recepcion.';
        }
        const indexedPaymentOptionsAvailable = informationResults.some(
          (result) =>
            result.requestId === informationPaymentOptionsPolicyRequestId &&
            result.status === 'completed',
        );
        if (indexedPaymentOptionsAvailable) {
          operationalNote += ' La transferencia está respaldada únicamente como opción general de pago para regalos según la política indexada; no afirmes que el carrito devolvió o confirmó ese método.';
        }
        const hasAbandonedCart = phonePurchaseResult.carts?.some(
          (cart) => cart.wasAbandoned,
        ) ?? false;
        if (
          hasAbandonedCart &&
          this.hasTrustedCartRecoveryPath(args.messageContext)
        ) {
          const abandonedCarts = phonePurchaseResult.carts?.filter((cart) => cart.wasAbandoned) ?? [];
          const eventNames = [...new Set(abandonedCarts.map((cart) => cart.eventName).filter((name): name is string => Boolean(name?.trim())) )];
          const eventClause = eventNames.length > 0 ? ` para ${eventNames.join(', ')}` : '';
          operationalNote += ` La búsqueda telefónica encontró ${abandonedCarts.length === 1 ? 'un carrito abandonado' : `${abandonedCarts.length} carritos abandonados`}${eventClause}. El historial saliente confiable contiene una ruta de recuperación para este carrito. Indica explícitamente que encontraste el carrito al revisar las compras y carritos asociados a tu numero de WhatsApp - se encontró un carrito abandonado${eventClause} y que puede retomarlo desde el enlace de recuperacion ya enviado en esta conversacion; no afirmes que se envio por correo ni menciones otro canal de envio, sin inventar ni repetir la URL. Para este caso de solo carrito no anadas hedges genericos sobre informacion parcial.`;
          if (indexedPaymentOptionsAvailable) {
            operationalNote += ' La transferencia bancaria figura como opcion general para completar la compra segun la politica indexada de medios de pago.';
          }
        }
      }
      completedGuestEventForReply = guestEventResult?.status === 'completed' &&
        guestEventResult.kind === 'associated_event';
      completedPhonePurchase = phonePurchaseResult?.status === 'completed' &&
          phonePurchaseResult.kind === 'purchase'
        ? phonePurchaseResult
        : undefined;
      const requiresPhonePurchaseDetailHandoff = requests.some((request) => {
        if (
          request.kind !== 'purchase' ||
          !request.aspects.some((aspect) => aspect === 'dedication' || aspect === 'thanks')
        ) {
          return false;
        }
        const result = informationResults.find(
          (candidate) => candidate.requestId === request.requestId,
        );
        return result?.status === 'failed' && result.retryable;
      });
      if (
        requiresPhonePurchaseDetailHandoff &&
        args.inbound.contactPhone &&
        args.extraction.phoneConfirmation !== 'no'
      ) {
        return await this.escalateInformationAuthentication({
          ...args,
          plan: planForInformation,
          reason: 'phone_purchase_detail_unavailable',
        });
      }

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
          ...planForInformation.information_state,
          resume_node: resumeNode,
          pending_requests: nextState.pendingRequests,
          selection_candidates: nextState.selectionCandidates,
          last_completed_request:
            nextState.lastCompletedRequest ??
            planForInformation.information_state.last_completed_request ??
            null,
        },
      });
    }

    if (supportContinuesPurchaseThread) {
      const continuationNote = 'La persona aportó un dato a su consulta de compra en curso; reconócelo solo como reporte suyo sin confirmar moneda, montos, fechas ni recepción desde el registro, conserva el hilo de la compra y repite la ventana de validación aplicable.';
      operationalNote = operationalNote ? `${operationalNote} ${continuationNote}` : continuationNote;
    }
    const promptBundleStartedAt = Date.now();
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('resolver_consultas_informativas');
    args.timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
    const composeReplyStartedAt = Date.now();
    const replyExtraction: ExtractionResult = {
      ...informationExtraction,
      informationRequests: requests,
    };
    const composedReply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planForInformation,
      extraction: replyExtraction,
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
      replyExtraction,
      composedReply,
    );
    const hasAssociatedGuestEventForReply = completedGuestEventForReply;
    const requestedPurchaseAspects = requests.flatMap((request) =>
      request.kind === 'purchase' ? request.aspects : [],
    );
    const reportedPurchaseAmount = args.extraction.informationRequests.find(
      (request): request is Extract<ExtractedInformationRequest, { kind: 'purchase' }> =>
        request.kind === 'purchase' && request.amount !== null && request.amount !== undefined,
    )?.amount ?? null;
    const reply = this.enforcePurchaseReplyDeterministic(
      currentNode,
      completedPhonePurchase,
      hasAssociatedGuestEventForReply,
      requestedPurchaseAspects,
      ambiguitySafeReply,
      {
        reportedAmount: reportedPurchaseAmount,
        isContinuedThread: preservingLastCompletedContext || supportContinuesPurchaseThread,
      },
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
    const turnDecision = this.informationTurnDecision(operationalNote ?? 'information_batch');

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
        extraction: informationExtraction,
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

  private async handleSupportAcknowledgment(
    args: Parameters<AgentService['handleInformationFlow']>[0],
    plan: PlanSnapshot,
    act: InformationSupportAct | null | undefined = args.extraction.supportAct,
    operationalNote = 'A bounded user-reported support act was acknowledged without a lookup or reply-model call.',
  ): Promise<HandleTurnResponse> {
    if (!act || !this.isSupportAcknowledgment(act)) {
      throw new Error('Support acknowledgment requires typed support evidence.');
    }
    const text = this.selectSupportAcknowledgmentMessage(act);
    const planWithSupportContext = mergePlan(plan, {
      conversation_summary: this.supportConversationSummary(
        act,
        plan.conversation_summary,
      ),
    });
    await this.dependencies.planStore.save({
      plan: planWithSupportContext,
      reason: 'support_continuity_acknowledgment',
    });
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
    );
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const currentNode: DecisionNode = 'resolver_consultas_informativas';
    const turnDecision = this.informationTurnDecision('support_acknowledgment');
    return {
      plan: planWithSupportContext,
      outbound: this.renderOutbound(
        { text },
        [],
        args.inbound.channel,
        planWithSupportContext.conversation_id,
        planWithSupportContext,
      ),
      trace: this.buildTrace({
        plan: planWithSupportContext,
        previousNode: args.previousNode,
        currentNode,
        nodePath: args.previousNode === currentNode
          ? [currentNode]
          : [args.previousNode, currentNode],
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: 'deterministic:support_continuity_acknowledgment',
        promptFilePaths: [],
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'support_continuity_acknowledgment',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision,
        operationalNote,
        informationExecution: [],
      }),
    };
  }

  private supportConversationSummary(
    act: InformationSupportAct,
    currentSummary: string,
  ): string {
    if (act.topic === 'mailbox_capacity' && act.detail === 'mailbox_full') {
      return 'La persona informó que el buzón de su correo registrado está lleno; la consulta de soporte sigue abierta.';
    }
    if (act.topic === 'payment_proof' && act.detail === 'submission_reported') {
      return 'La persona informó que envió un comprobante; su contenido y el estado del pago no han sido verificados.';
    }
    if (act.kind === 'defer_submission') {
      return currentSummary ||
        'La persona indicó que enviará la información después; la consulta de soporte sigue abierta.';
    }
    return 'La persona aportó información a una consulta de soporte que sigue abierta.';
  }

  private selectSupportAcknowledgmentMessage(
    act: InformationSupportAct,
  ): string {
    if (act.kind === 'provide_detail' && act.personReference && act.eventReference) {
      return `Gracias, tomo nota de que el invitado afectado es ${act.personReference} y del evento ${act.eventReference}. Mantengo esta consulta para continuar sin empezar de nuevo.`;
    }
    if (act.kind === 'provide_detail' && act.personReference) {
      return `Gracias, tomo nota del invitado afectado ${act.personReference}. Mantengo esta consulta para continuar sin empezar de nuevo.`;
    }
    if (act.kind === 'provide_detail' && act.eventReference) {
      return `Gracias, tomo nota del evento ${act.eventReference}. Mantengo esta consulta para continuar sin empezar de nuevo.`;
    }
    if (act.kind === 'defer_submission') {
      return 'De acuerdo, podemos continuar cuando lo envíes. Mantengo el contexto de esta consulta.';
    }
    if (act.topic === 'mailbox_capacity') {
      return act.kind === 'report_issue'
        ? 'Entiendo: el buzón de tu correo registrado está lleno. Mantengo el contexto de esta consulta para que podamos continuar sin empezar de nuevo.'
        : 'Entiendo: el buzón de tu correo registrado está lleno. Continuamos desde aquí; no necesitas empezar de nuevo.';
    }
    if (
      act.topic === 'payment_proof' &&
      act.detail === 'submission_reported'
    ) {
      return 'Tomé nota de que indicas haber enviado el comprobante. Eso no confirma por sí solo que el pago ya figure aprobado.';
    }
    return act.kind === 'report_issue'
      ? 'Entiendo el problema que reportas. Mantengo el contexto de esta consulta. ¿Qué necesitas continuar?'
      : 'Tomé nota de ese dato y mantengo el contexto de esta consulta; no necesitas empezar de nuevo.';
  }

  private async handleHostWithdrawalInformation(
    args: Parameters<AgentService['handleInformationFlow']>[0],
    plan: PlanSnapshot,
    requests: PendingInformationRequest[],
  ): Promise<HandleTurnResponse> {
    const hostRequests = requests.filter((request) =>
      request.kind === 'faq' && request.hostWithdrawal);
    const first = hostRequests[0];
    if (!first) throw new Error('Host withdrawal requires typed request evidence.');
    const needsReview = hostRequests.some((request) =>
      request.kind === 'faq' && request.hostWithdrawal === 'individual_status');
    const needsHandoff = needsReview || args.extraction.actionIntent === 'solicitar_humano';
    const gateway = this.dependencies.agentConversationGateway ??
      new NoopAgentConversationGateway('not_configured');
    const orchestrator = this.dependencies.informationOrchestrator ?? new InformationOrchestrator({
      knowledgeGateway: new NoopKnowledgeRetrievalGateway(),
      providerGateway: this.dependencies.providerGateway, agentGateway: gateway,
      capabilityManifest: this.capabilityManifest,
    });
    this.recordDeterministicToolInput(args.toolUsage, 'knowledge_base_search', {
      subject: 'host_withdrawal', query_present: true,
    });
    const startedAt = Date.now();
    // All host-status requests share one general policy; personal status is unsupported.
    const execution = await orchestrator.execute({
      requests: [first], authentication: null, authBlock: null,
    });
    args.timingMs.information_execution += Date.now() - startedAt;
    this.recordInformationExecutionTrace(args.toolUsage, execution.summaries);
    const result = execution.results[0];
    const policy = result?.status === 'completed' && result.kind === 'faq'
      ? result.hostWithdrawalPolicy : null;
    const messages = await this.dependencies.promptLoader.loadHostWithdrawalMessages();
    const parts = [policy
      ? messages.policy.replace('{hours}', String(policy.maxBusinessHours))
      : messages.unavailable];
    let handoff: AgentGatewayResult | null = null;
    const phone = this.resolveEscalationPhone(args.inbound);
    if (needsHandoff) {
      if (needsReview) parts.push(messages.statusUnavailable);
      handoff = phone
        ? await this.requestHumanTakeoverWithTrace(gateway, phone, args.toolUsage)
        : this.missingPhoneEscalationResult();
      parts.push(handoff.status === 'success' ? messages.handoffSuccess : messages.handoffFailure);
    }
    const eventHint = hostRequests.find((request) => request.kind === 'faq' && request.eventHint);
    if (eventHint?.kind === 'faq' && eventHint.eventHint) {
      parts.push(messages.event.replace('{event}', eventHint.eventHint));
    }
    const handedOff = handoff?.status === 'success';
    const currentNode: DecisionNode = handedOff
      ? 'solicitar_agente_humano' : 'resolver_consultas_informativas';
    const planToSave = mergePlan(plan, {
      current_node: currentNode,
      ...(handedOff ? { intent: 'solicitar_humano' as const } : {}),
      information_state: {
        ...plan.information_state,
        pending_requests: needsHandoff || !policy ? requests : [],
        ...(!needsHandoff && policy ? { last_completed_request: first } : {}),
      },
      ...(handoff ? { human_escalation: {
        status: handedOff ? 'requested' as const : 'none' as const,
        requested_at: handedOff ? new Date().toISOString() : null,
        phone_number: phone,
        last_error: handoff.status === 'failed' ? handoff.error
          : handoff.status === 'skipped' ? handoff.message : null,
      } } : {}),
    });
    await this.dependencies.planStore.save({ plan: planToSave, reason: 'host_withdrawal_policy_and_support' });
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction);
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    return {
      plan: planToSave,
      outbound: this.renderOutbound({ text: parts.join('\n\n') }, [], args.inbound.channel,
        planToSave.conversation_id, planToSave),
      trace: this.buildTrace({
        plan: planToSave, previousNode: args.previousNode, currentNode,
        nodePath: [args.previousNode, currentNode], extraction: args.extraction,
        missingFields: [], searchReady: false,
        promptBundleId: 'deterministic:host_withdrawal_policy_and_support',
        promptFilePaths: ['nodes/resolver_consultas_informativas/host-withdrawal.json'],
        toolUsage: args.toolUsage, providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true, planPersistReason: 'host_withdrawal_policy_and_support',
        timingMs: args.timingMs, tokenUsage: args.tokenUsage,
        messageContext: args.messageContext, responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision: handedOff ? this.humanEscalationTurnDecision('host_withdrawal_status_unsupported')
          : this.informationTurnDecision('host_withdrawal_policy_and_support'),
        informationExecution: execution.summaries,
        operationalNote: `Host withdrawal policy ${policy ? 'available' : 'unavailable'}; individual status unsupported; handoff ${handoff?.status ?? 'not_required'}.`,
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
        const authenticationContinuation =
          request.kind !== 'faq' && (request.authAction ?? 'none') !== 'none';
        merged[matchingIndex] =
          existing.kind === 'purchase' && request.kind === 'purchase'
            ? {
                ...request,
                requestId: existing.requestId,
                query: authenticationContinuation
                  ? existing.query
                  : request.query || existing.query,
                orderId: normalizeExtractedOrderReference(
                  request.orderId ?? existing.orderId,
                ),
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
                query: authenticationContinuation
                  ? existing.query
                  : request.query,
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
        ...(request.kind === 'purchase'
          ? { orderId: normalizeExtractedOrderReference(request.orderId) }
          : {}),
        requestId,
      } as PendingInformationRequest);
      nextId += 1;
    }

    const needsIndexedValidationPolicy = merged.some(
      (request) => request.kind === 'purchase' && request.aspects.includes('validation_window'),
    );
    const hasValidationPolicyRequest = merged.some(
      (request) => request.requestId === informationValidationPolicyRequestId,
    );
    if (needsIndexedValidationPolicy && !hasValidationPolicyRequest) {
      merged.push({
        requestId: informationValidationPolicyRequestId,
        kind: 'faq',
        query: 'Plazo de validación de pagos en proceso por método de pago',
      });
    }

    const needsPaymentOptionsPolicy = merged.some(
      (request) => request.kind === 'purchase' && request.aspects.includes('payment_options'),
    );
    const hasPaymentOptionsPolicyRequest = merged.some(
      (request) => request.requestId === informationPaymentOptionsPolicyRequestId,
    );
    if (needsPaymentOptionsPolicy && !hasPaymentOptionsPolicyRequest) {
      merged.push({
        requestId: informationPaymentOptionsPolicyRequestId,
        kind: 'faq',
        query: 'Medios de pago disponibles para completar un regalo',
      });
    }

    return merged;
  }

  /**
   * F3 purchase route normalization. The orchestrator derives the lookup
   * partition from aspects, so a status query carrying payment_details (live
   * Martha: "que paso con el regalo que intente pagar") would hit the gift
   * partition and violate the orders-only hard gate. payment_details is
   * answerable from orders (method plus totals), so it is dropped unless a
   * gift-only aspect (dedication, thanks) requires the gift partition.
   */
  private normalizePurchaseDetailRoute(
    requests: PendingInformationRequest[],
  ): PendingInformationRequest[] {
    return requests.map((request) => {
      if (request.kind !== 'purchase') return request;
      if (
        !request.aspects.includes('payment_details') ||
        request.aspects.includes('dedication') ||
        request.aspects.includes('thanks')
      ) {
        return request;
      }
      const aspects = request.aspects.filter(
        (aspect) => aspect !== 'payment_details',
      );
      return {
        ...request,
        aspects: aspects.length > 0 ? aspects : ['summary'],
      };
    });
  }

  private isTerminalInformationAuthBlock(
    authBlock: InformationAuthBlock | null,
  ): boolean {
    if (!authBlock) {
      return false;
    }
    return new Set<InformationAuthReason>([
      'phone_auth_failed',
      'email_not_found',
      'otp_send_failed',
      'otp_send_rate_limited',
      'otp_send_unavailable',
      'otp_verification_rate_limited',
      'otp_verification_unavailable',
      'otp_email_not_verified',
      'otp_verification_validation_failed',
      'otp_verification_failed',
      'otp_repeated_failure',
    ]).has(authBlock.guidance.reason);
  }

  private async completeDeclinedInformationAuthentication(args: {
    inbound: NormalizedInboundMessage;
    previousNode: DecisionNode;
    plan: PlanSnapshot;
    resumeNode: DecisionNode | null;
    requests: PendingInformationRequest[];
    extraction: ExtractionResult;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    responseClassifierTrace?: MessageResponseClassifierTrace;
    messageContext: TurnMessageContext;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse> {
    const remainingRequests = args.requests.filter((request) => request.kind === 'faq');
    const planToSave = mergePlan(this.resetUserAuth(args.plan, null), {
      current_node: remainingRequests.length > 0
        ? 'resolver_consultas_informativas'
        : args.resumeNode ?? 'resolver_consultas_informativas',
      information_state: {
        resume_node: args.resumeNode,
        pending_requests: remainingRequests,
        selection_candidates: [],
      },
    });
    await this.dependencies.planStore.save({
      plan: planToSave,
      reason: 'information_authentication_declined',
    });
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
    );
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const message = 'Entiendo. Sin autenticación no puedo continuar con esa consulta protegida. No volveré a pedirte el correo ni un código. Cerré esa consulta; si después deseas retomarla, puedes escribirnos por aquí.';
    return {
      plan: planToSave,
      outbound: this.renderOutbound(
        { text: message },
        [],
        args.inbound.channel,
        planToSave.conversation_id,
        planToSave,
      ),
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode: planToSave.current_node,
        nodePath: args.previousNode === planToSave.current_node
          ? [planToSave.current_node]
          : [args.previousNode, planToSave.current_node],
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: 'deterministic:information_authentication_declined',
        promptFilePaths: [],
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'information_authentication_declined',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision: this.informationTurnDecision('authentication_declined'),
        operationalNote: 'La persona rechazó explícitamente la verificación. La consulta protegida se cerró sin volver a pedir datos.',
      }),
    };
  }

  private async retainTerminalOtpHandoff(args: {
    inbound: NormalizedInboundMessage;
    existingPlan: PlanSnapshot;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    responseClassifierTrace?: MessageResponseClassifierTrace;
    messageContext: TurnMessageContext;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse> {
    // The handoff was already requested on the rejection turn, so no second
    // gateway effect is submitted. The tool record reflects the retained
    // attempt decision (already requested), matching the unsupported-path
    // precedent, and the reply restates the handoff with the pending query.
    const alreadyRequested: AgentGatewayResult = {
      status: 'success',
      message: 'Human takeover was already requested.',
    };
    const phoneNumber = this.resolveEscalationPhone(args.inbound);
    this.recordDeterministicToolInput(args.toolUsage, 'request_human_takeover', {
      phone_number: phoneNumber,
      auth: 'X-Agent-Key [redacted]',
    });
    this.recordDeterministicToolOutput(args.toolUsage, 'request_human_takeover', {
      status: alreadyRequested.status,
      message: alreadyRequested.message,
    });
    const planToSave = mergePlan(args.existingPlan, {
      current_node: 'solicitar_agente_humano',
    });
    await this.dependencies.planStore.save({
      plan: planToSave,
      reason: 'terminal_otp_code_retains_handoff',
    });
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const pendingQueries = args.existingPlan.information_state.pending_requests
      .map((request) => request.query.trim())
      .filter((query) => query.length > 0)
      .slice(0, 2);
    const handoffSummary = pendingQueries.length > 0
      ? `${this.humanEscalationRequestedMessage(alreadyRequested)}. El equipo continuará con tu consulta pendiente: ${pendingQueries.join(' / ')}`
      : this.humanEscalationRequestedMessage(alreadyRequested);
    const extraction = this.buildSyntheticEscalationExtraction(
      'La persona envió un código después de que la verificación terminó y se pidió apoyo humano.',
    );
    return {
      plan: planToSave,
      outbound: this.renderOutbound(
        { text: handoffSummary },
        [],
        args.inbound.channel,
        planToSave.conversation_id,
        planToSave,
      ),
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.existingPlan.current_node,
        currentNode: 'solicitar_agente_humano',
        nodePath: [args.existingPlan.current_node, 'solicitar_agente_humano'],
        extraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: 'deterministic:terminal_otp_handoff_retained',
        promptFilePaths: [],
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'terminal_otp_code_retains_handoff',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision: this.humanEscalationTurnDecision('terminal_otp_code_retained'),
        operationalNote: 'Un código posterior al fallo terminal no se verificó; se conservó la ruta humana sin otro envío ni verificación.',
      }),
    };
  }

  private async escalateInformationAuthentication(args: {
    inbound: NormalizedInboundMessage;
    previousNode: DecisionNode;
    plan: PlanSnapshot;
    reason: string;
    informationExecution?: InformationExecutionSummary[];
    extraction: ExtractionResult;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    responseClassifierTrace?: MessageResponseClassifierTrace;
    messageContext: TurnMessageContext;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse> {
    const gateway = this.dependencies.agentConversationGateway ??
      new NoopAgentConversationGateway('not_configured');
    const phoneNumber = this.resolveEscalationPhone(args.inbound);
    const gatewayResult = phoneNumber
      ? await this.requestHumanTakeoverWithTrace(gateway, phoneNumber, args.toolUsage)
      : this.missingPhoneEscalationResult();
    const planToSave = mergePlan(args.plan, {
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
    await this.dependencies.planStore.save({
      plan: planToSave,
      reason: 'information_authentication_terminal_handoff',
    });
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
    );
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const pendingQueries = args.plan.information_state.pending_requests
      .map((request) => request.query.trim())
      .filter((query) => query.length > 0)
      .slice(0, 2);
    const handoffSummary = pendingQueries.length > 0
      ? `${this.humanEscalationRequestedMessage(gatewayResult)}. El equipo continuará con tu consulta pendiente: ${pendingQueries.join(' / ')}`
      : this.humanEscalationRequestedMessage(gatewayResult);
    const handoffMessage = args.reason === 'phone_information_not_found'
      ? `No encontré la información solicitada asociada a este número en la consulta realizada. ${handoffSummary}`
      : handoffSummary;
    return {
      plan: planToSave,
      outbound: this.renderOutbound(
        { text: handoffMessage },
        [],
        args.inbound.channel,
        planToSave.conversation_id,
        planToSave,
      ),
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode: 'solicitar_agente_humano',
        nodePath: [args.previousNode, 'solicitar_agente_humano'],
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: 'deterministic:information_authentication_terminal_handoff',
        promptFilePaths: [],
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'information_authentication_terminal_handoff',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision: this.humanEscalationTurnDecision(args.reason),
        informationExecution: args.informationExecution,
        operationalNote: args.reason === 'phone_information_not_found'
          ? 'La consulta por el número de contacto no devolvió información coincidente. Se conservó la consulta y se intentó solicitar apoyo humano sin iniciar verificación por correo.'
          : `La verificación alcanzó un resultado terminal (${args.reason}). Se conservó la consulta y se solicitó apoyo humano sin pedir otro correo ni código.`,
      }),
    };
  }

  private sameInformationThread(
    pending: ExtractedInformationRequest,
    extracted: ExtractedInformationRequest,
  ): boolean {
    if (pending.kind !== extracted.kind) {
      return false;
    }
    if (pending.kind === 'purchase' && extracted.kind === 'purchase') {
      if (pending.resource !== extracted.resource) {
        return false;
      }
      const pendingOrderId = normalizeExtractedOrderReference(pending.orderId);
      const extractedOrderId = normalizeExtractedOrderReference(extracted.orderId);
      if (pendingOrderId && extractedOrderId && pendingOrderId !== extractedOrderId) {
        return false;
      }
      if (
        pending.eventHint &&
        extracted.eventHint &&
        !eventMatches(pending.eventHint, extracted.eventHint) &&
        !eventMatches(extracted.eventHint, pending.eventHint)
      ) {
        return false;
      }
      return true;
    }
    if (pending.kind === 'associated_event') {
      return true;
    }
    if (pending.kind === 'faq' && extracted.kind === 'faq' &&
      pending.hostWithdrawal && extracted.hostWithdrawal) {
      return !pending.eventHint || !extracted.eventHint ||
        eventMatches(pending.eventHint, extracted.eventHint);
    }
    return pending.kind === 'faq' && extracted.kind === 'faq'
      ? pending.query.trim().toLocaleLowerCase('es') ===
          extracted.query.trim().toLocaleLowerCase('es')
      : false;
  }

  private hasTrustedCartRecoveryPath(messageContext: TurnMessageContext): boolean {
    for (const message of messageContext.recentMessages) {
      if (message.direction !== 'outbound') {
        continue;
      }
      const candidates = message.body.match(/https?:\/\/[^\s<>]+/giu) ?? [];
      for (const candidate of candidates) {
        const trimmed = candidate.replace(/[),.;!?]+$/gu, '');
        try {
          const url = new URL(trimmed);
          const hostname = url.hostname.toLocaleLowerCase('en');
          if (
            (hostname === 'sinenvolturas.com' || hostname.endsWith('.sinenvolturas.com')) &&
            /^\/cart\/recover\/[^/]+\/?$/u.test(url.pathname)
          ) {
            return true;
          }
        } catch {
          // Ignore malformed or non-URL text from conversation history.
        }
      }
    }
    return false;
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
    authFlowId: string;
  }> {
    const authFlowId = createAuthOperationId();
    const startedAt = Date.now();
    return await withAuthenticationFlowContext(
      { authFlowId, planId: args.plan.plan_id },
      async () => {
        logAuthObservabilityEvent('info', 'information_auth_flow_started', {
          auth_flow_operation_id: authFlowId,
          prior_auth_state: {
            status: args.plan.user_auth.status,
            auth_method: args.plan.user_auth.auth_method,
            email_present: Boolean(args.plan.user_auth.email),
            token_present: Boolean(args.plan.user_auth.token),
            otp_send_attempts: args.plan.user_auth.otp_send_attempts,
            otp_non_delivery_reports: args.plan.user_auth.otp_non_delivery_reports,
          },
          trusted_contact_phone_present: Boolean(args.trustedContactPhone),
          phone_confirmation: args.phoneConfirmation,
          requests: args.requests.map((request) => ({
            kind: request.kind,
            request_id: request.requestId,
            ...(request.kind === 'purchase'
              ? {
                  resource: request.resource,
                  order_id_present: Boolean(request.orderId),
                  aspects: request.aspects,
                }
              : request.kind === 'associated_event'
                ? { event_hint_present: Boolean(request.eventHint) }
                : {}),
          })),
          user_message_length: args.userMessage.length,
          extracted_email_present: this.extractEmailFromText(args.userMessage) !== null,
          otp_present: this.extractUserLoginCode(args.userMessage) !== null,
        });
        try {
          const result = await this.resolveInformationAuthenticationCore(args);
          logAuthObservabilityEvent('info', 'information_auth_flow_completed', {
            auth_flow_operation_id: authFlowId,
            duration_ms: Date.now() - startedAt,
            next_auth_state: {
              status: result.plan.user_auth.status,
              auth_method: result.plan.user_auth.auth_method,
              email_present: Boolean(result.plan.user_auth.email),
              token_present: Boolean(result.plan.user_auth.token),
            },
            authentication_present: result.authentication !== null,
            auth_block_reason: result.authBlock?.guidance.reason ?? null,
          });
          return { ...result, authFlowId };
        } catch (error) {
          logAuthObservabilityEvent('error', 'information_auth_flow_failed', {
            auth_flow_operation_id: authFlowId,
            duration_ms: Date.now() - startedAt,
            error: error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack ?? null,
                  cause: error.cause ?? null,
                }
              : error,
          });
          throw error;
        }
      },
    );
  }

  private async resolveInformationAuthenticationCore(args: {
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
    const phoneAccountRejected = args.phoneConfirmation === 'no';
    if (phoneAccountRejected) {
      return this.resolveEmailAuthentication({
        ...args,
        plan: this.clearPhoneAuthentication(args.plan, 'Current phone account rejected by user.'),
      });
    }

    const informationAuthAction = protectedRequests
      .map((request) => request.authAction ?? 'none')
      .find((action) => action !== 'none') ?? 'none';
    const shouldContinueEmailAuthentication =
      args.plan.user_auth.status === 'code_requested' ||
      this.extractEmailFromText(args.userMessage) !== null ||
      informationAuthAction === 'provide_email' ||
      informationAuthAction === 'provide_otp' ||
      informationAuthAction === 'report_otp_not_received' ||
      informationAuthAction === 'resend_otp' ||
      informationAuthAction === 'change_email';

    // Event and purchase support now have phone-scoped read contracts. Let the
    // information orchestrator try those contracts before starting account
    // authentication. Existing sessions and explicit email/OTP actions remain
    // available; a scoped miss is handled by the human-help policy, not login.
    if (
      trustedPhoneParts &&
      !this.hasValidUserAuthToken(args.plan) &&
      !shouldContinueEmailAuthentication
    ) {
      return {
        plan: this.clearPhoneAuthentication(args.plan, null),
        authentication: null,
        authBlock: null,
      };
    }

    if (
      args.plan.user_auth.status !== 'code_requested' &&
      trustedPhoneParts &&
      !this.hasValidUserAuthToken(args.plan)
    ) {
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
          return this.phoneAuthenticationFailure(
            args.plan,
            'Phone authentication returned incomplete credentials.',
          );
        }

        const authenticatedPlan = mergePlan(args.plan, {
          contact_email: phoneAuthentication.email,
          user_auth: {
            ...args.plan.user_auth,
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

      if (phoneAuthentication.status === 'failed') {
        return this.phoneAuthenticationFailure(args.plan, phoneAuthentication.error);
      }

      if (protectedRequests.some((request) => request.kind === 'associated_event')) {
        return {
          plan: this.clearPhoneAuthentication(
            args.plan,
            'No account found for current phone; checking guest invitations.',
          ),
          authentication: null,
          authBlock: null,
        };
      }

      return this.resolveEmailAuthentication({
        ...args,
        plan: this.clearPhoneAuthentication(args.plan, 'No account found for current phone.'),
      });
    }

    return this.resolveEmailAuthentication({
      ...args,
      plan:
        args.plan.user_auth.awaiting_phone_confirmation
          ? this.clearPhoneAuthentication(args.plan, null)
          : args.plan,
    });
  }

  private phoneAuthenticationFailure(plan: PlanSnapshot, error: string): {
    plan: PlanSnapshot;
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock;
  } {
    return {
      plan: this.clearPhoneAuthentication(plan, error),
      authentication: null,
      authBlock: {
        nextInput: 'retry',
        guidance: createInformationAuthGuidance(
          'phone_auth_failed',
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
      auth_method: 'phone',
      ...(result.status === 'authenticated'
        ? {
            token: '[redacted]',
            email_present: result.email.trim().length > 0,
            expiry_present: result.tokenExpiresAtIso.trim().length > 0,
          }
        : result.status === 'failed'
          ? {
              retryable: result.retryable,
              failure_kind: result.retryable ? 'transient_failure' : 'permanent_failure',
              error_preview: this.safeAuthErrorPreview(result.error),
            }
          : { failure_kind: 'user_not_found' }),
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

    const informationAuthAction = protectedRequests
      .map((request) => request.authAction ?? 'none')
      .find((action) => action !== 'none') ?? 'none';
    const providedEmail = this.extractEmailFromText(args.userMessage);
    if (informationAuthAction === 'change_email' && !providedEmail) {
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
      informationAuthAction !== 'resend_otp'
    ) {
      return {
        plan: planForEmail,
        authentication: null,
        authBlock: {
          nextInput: 'otp',
          guidance: createInformationAuthGuidance(
            planForEmail.user_auth.failed_code_attempts >= 2
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
      informationAuthAction === 'resend_otp' ? 'explicit_resend' : 'initial',
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
    mode: 'initial' | 'explicit_resend' | 'non_delivery_recovery',
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
      {
        status: result.status,
        auth_method: 'email_otp',
        http_status: result.httpStatus ?? null,
        request_id: result.requestId ?? null,
        ...(result.status === 'sent'
          ? {}
          : {
              failure_kind: result.status,
              error_preview: this.safeAuthErrorPreview(result.error),
            }),
      },
    );

    if (result.status === 'sent') {
      const isResend = mode !== 'initial';
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
            otp_send_attempts: plan.user_auth.otp_send_attempts + 1,
            otp_non_delivery_reports:
              mode === 'non_delivery_recovery'
                ? plan.user_auth.otp_non_delivery_reports + 1
                : plan.user_auth.otp_non_delivery_reports,
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
            otp_send_attempts: plan.user_auth.otp_send_attempts + 1,
            otp_non_delivery_reports: plan.user_auth.otp_non_delivery_reports,
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

    const sendFailureReason = result.status === 'rate_limited'
      ? 'otp_send_rate_limited'
      : result.status === 'unavailable'
        ? 'otp_send_unavailable'
        : 'otp_send_failed';
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
          otp_send_attempts: plan.user_auth.otp_send_attempts + 1,
          otp_non_delivery_reports: plan.user_auth.otp_non_delivery_reports,
          auth_method: null,
          awaiting_phone_confirmation: false,
        },
      }),
      authBlock: {
        nextInput: 'email',
        guidance: createInformationAuthGuidance(sendFailureReason, email),
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
    // One-shot policy: consume the single verification before the outbound
    // call. An already-consumed or terminal episode never verifies again.
    const recovery = normalizeLegacyAuthRecovery({
      status: plan.user_auth.status,
      email: plan.user_auth.email,
      requestedAt: plan.user_auth.requested_at,
      failedCodeAttempts: plan.user_auth.failed_code_attempts,
      otpSendAttempts: plan.user_auth.otp_send_attempts,
      otpNonDeliveryReports: plan.user_auth.otp_non_delivery_reports,
    });
    if (!consumeVerificationAttempt(recovery).allowed) {
      return {
        plan,
        authentication: null,
        authBlock: {
          nextInput: 'otp',
          guidance: createInformationAuthGuidance('otp_verification_failed', email),
        },
      };
    }
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
      {
        status: result.status,
        auth_method: 'email_otp',
        token: '[redacted]',
        http_status: result.httpStatus ?? null,
        request_id: result.requestId ?? null,
        ...(result.status === 'authenticated'
          ? {}
          : {
              failure_kind: result.status,
              error_preview: this.safeAuthErrorPreview(result.error),
            }),
      },
    );

    if (result.status !== 'authenticated') {
      const isInvalidCode = result.status === 'invalid_code';
      const failedCodeAttempts = plan.user_auth.failed_code_attempts + 1;
      const nextAttempts = isInvalidCode
        ? failedCodeAttempts
        : plan.user_auth.failed_code_attempts;
      const verificationReason = result.status === 'rate_limited'
        ? 'otp_verification_rate_limited'
        : result.status === 'unavailable'
          ? 'otp_verification_unavailable'
          : result.status === 'email_not_verified'
            ? 'otp_email_not_verified'
            : result.status === 'validation_failed'
              ? 'otp_verification_validation_failed'
          : result.status === 'failed'
            ? 'otp_verification_failed'
            : nextAttempts >= 2
              ? 'otp_repeated_failure'
              // One-shot policy: the first rejected code terminates recovery.
              // The caller routes this terminal block to a single handoff.
              : 'otp_verification_failed';
      return {
        plan: mergePlan(plan, {
          user_auth: {
            ...plan.user_auth,
            status: 'code_requested',
            token: null,
            token_expires_at: null,
            last_error: result.error,
            failed_code_attempts: nextAttempts,
          },
        }),
        authentication: null,
        authBlock: {
          nextInput: 'otp',
          guidance: createInformationAuthGuidance(
            verificationReason,
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
          otp_send_attempts: plan.user_auth.otp_send_attempts,
          otp_non_delivery_reports: plan.user_auth.otp_non_delivery_reports,
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
    lastCompletedRequest: CompletedInformationRequest | null;
  } {
    const resultsByRequest = new Map(
      results.map((result) => [result.requestId, result]),
    );
    const pendingRequests: PendingInformationRequest[] = [];
    const selectionCandidates: InformationSelectionCandidate[] = [];
    let lastCompletedRequest: CompletedInformationRequest | null = null;

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
        continue;
      }
      const { requestId: _requestId, ...completedRequest } = request;
      void _requestId;
      if (
        request.requestId !== informationValidationPolicyRequestId &&
        request.requestId !== informationPaymentOptionsPolicyRequestId
      ) {
        lastCompletedRequest = completedRequest;
      }
    }

    return { pendingRequests, selectionCandidates, lastCompletedRequest };
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
        if (
          summary.source === 'associated_event_api' &&
          summary.accessMethod === 'trusted_phone_guest'
        ) {
          toolUsage.called.push('lookup_guest_events_by_phone');
          if ((summary.eventDetailCount ?? 0) > 0) {
            toolUsage.called.push('get_guest_event_detail');
          }
        } else if (
          summary.source === 'agent_api' &&
          summary.accessMethod === 'trusted_phone_purchase'
        ) {
          toolUsage.called.push(
            summary.resource === 'orders'
              ? 'lookup_guest_orders_by_phone'
              : 'lookup_guest_gift_purchases_by_phone',
          );
        } else {
          toolUsage.called.push(
            summary.source === 'knowledge_base'
              ? 'knowledge_base_search'
              : summary.source === 'associated_event_api'
                ? 'associated_event_lookup'
                : 'agent_api_purchase_lookup',
          );
        }
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
          access_method: summary.accessMethod ?? null,
          coverage: summary.coverage ?? null,
          resource: summary.resource ?? null,
          event_detail_count: summary.eventDetailCount ?? 0,
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

  /**
   * F3b deterministic purchase truthfulness gate. Runs after model composition
   * in resolver_consultas_informativas and replaces the narrative only when
   * typed reconciliation evidence matches one of the bounded outcomes: a
   * single approved record without a linked reference, a pending order next
   * to an active cart (checkout continuation with total, method, window and
   * next step), a currency-less pending transfer validation query, or a
   * multi-record selection without an associated guest event. All other
   * outcomes keep the model narrative.
   */
  private enforcePurchaseReplyDeterministic(
    currentNode: DecisionNode,
    phonePurchaseResult: InformationTaskResult | undefined,
    hasAssociatedGuestEvent: boolean,
    requestedAspects: PurchaseAspect[],
    reply: ComposeReplyResult,
    options?: {
      reportedAmount?: number | null;
      isContinuedThread?: boolean;
    },
  ): ComposeReplyResult {
    if (currentNode !== 'resolver_consultas_informativas') return reply;
    if (
      !phonePurchaseResult ||
      phonePurchaseResult.status !== 'completed' ||
      phonePurchaseResult.kind !== 'purchase'
    ) {
      return reply;
    }
    const purchases = phonePurchaseResult.purchases;
    const reportedAmount = options?.reportedAmount ?? null;
    const isContinuedThread = options?.isContinuedThread ?? false;
    void isContinuedThread;
    const single = purchases.length === 1 ? purchases[0] : null;
    if (
      single &&
      shouldRenderConciseApprovedStatus({
        purchaseCount: purchases.length,
        paymentStatus: single.paymentStatus,
        referenceResolution: phonePurchaseResult.referenceResolution ?? null,
      })
    ) {
      return {
        ...reply,
        text: renderConciseApprovedStatus(single.eventName),
        structuredMessage: undefined,
        recommendationFunnel: undefined,
      };
    }
    const cartCount = phonePurchaseResult.carts?.length ?? 0;
    if (
      single &&
      shouldRenderOrderPlusCartCheckout({
        purchaseCount: purchases.length,
        paymentStatus: single.paymentStatus,
        paymentMethod: single.paymentMethod ?? single.payment?.method ?? null,
        cartCount,
        needsSelection: phonePurchaseResult.needsSelection ?? false,
        reportedAmount,
      })
    ) {
      return {
        ...reply,
        text: renderOrderPlusCartCheckout({
          eventName: single.eventName,
          total: typeof single.grandTotal === 'number' &&
              Number.isFinite(single.grandTotal)
            ? single.grandTotal
            : null,
          paymentMethod: single.paymentMethod ?? single.payment?.method ?? null,
        }),
        structuredMessage: undefined,
        recommendationFunnel: undefined,
      };
    }
    if (
      single &&
      shouldRenderConciseTransferValidation({
        purchaseCount: purchases.length,
        paymentStatus: single.paymentStatus,
        paymentMethod: single.paymentMethod ?? single.payment?.method ?? null,
        currency: single.currency ?? null,
        requestedAspects,
      })
    ) {
      return {
        ...reply,
        text: renderConciseTransferValidation(single.eventName),
        structuredMessage: undefined,
        recommendationFunnel: undefined,
      };
    }
    if (
      shouldRenderNeutralSelection({
        purchaseCount: purchases.length,
        hasAssociatedGuestEvent,
      })
    ) {
      return {
        ...reply,
        text: renderNeutralPurchaseSelection(purchases),
        structuredMessage: undefined,
        recommendationFunnel: undefined,
      };
    }
    return reply;
  }

  private enforceMissingFieldReply(
    currentNode: DecisionNode,
    missingFields: string[],
    reply: ComposeReplyResult,
  ): ComposeReplyResult {
    if (
      currentNode !== 'aclarar_pedir_faltante' ||
      missingFields.length !== 1 ||
      missingFields[0] !== 'budget_or_guest_range'
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

  private enforceAmbiguousProviderConfirmationReply(
    isAmbiguousConfirmation: boolean,
    reply: ComposeReplyResult,
  ): ComposeReplyResult {
    if (!isAmbiguousConfirmation) {
      return reply;
    }

    return {
      ...reply,
      text: '¿Qué proveedor o acción estás confirmando?',
      structuredMessage: undefined,
      recommendationFunnel: undefined,
    };
  }

  private safeAuthErrorPreview(error: string): string {
    return error.replace(/[A-Za-z0-9_-]{20,}/gu, '[redacted]').slice(0, 240);
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
    return extractOtpCode(text);
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
        otp_send_attempts: 0,
        otp_non_delivery_reports: 0,
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
          classifier_profile: 'general',
          action: 'respond',
          reason: 'requires_response',
          would_suppress: false,
          context_source: contextSource,
          has_prior_outbound_message: messages.some((message) => message.direction === 'outbound'),
          fallback_used: false,
          conversation_health: 'uncertain',
          health_reason: 'insufficient_context',
          human_help_response: 'not_applicable',
          campaign_reply_kind: 'not_applicable',
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
          classifier_profile: 'general',
          action: 'respond',
          reason: 'conversation_context_unavailable',
          would_suppress: false,
          context_source: contextSource,
          has_prior_outbound_message: false,
          fallback_used: true,
          conversation_health: 'uncertain',
          health_reason: 'insufficient_context',
          human_help_response: 'not_applicable',
          campaign_reply_kind: 'not_applicable',
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
    const phoneNumber = this.resolveEscalationPhone(args.inbound);
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
  ): string | null {
    // Human takeover is a phone-scoped customer action. Only the phone
    // supplied by the trusted channel adapter is authoritative here; model-
    // extracted plan fields and external conversation IDs are not identities.
    return this.normalizePhone(inbound.contactPhone);
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
    const extractedFocusCategory =
      args.extraction.activeNeedCategory ??
      args.extraction.vendorCategory;
    const readyNeedCategories = this.resolveReadyNeedCategories(
      args.extraction,
      args.planAfterReduction,
      args.sufficiencyByNeed,
      args.sessionFocus,
    );
    const hasRetrievalReadyQueryIntent = (args.extraction.providerQueryIntents ?? [])
      .some((queryIntent) =>
        this.isStructuredQueryIntentRetrievalReady(queryIntent, args.extraction),
      );
    const focusedNeedCategory =
      extractedFocusCategory ??
      (
        hasRetrievalReadyQueryIntent && readyNeedCategories.length === 1
          ? readyNeedCategories[0]
          : null
      ) ??
      args.sessionFocus?.activeNeedCategory ??
      null;

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

    if (
      evidence.extractionIntent === 'reset_plan' &&
      evidence.providerNeedCount === 0
    ) {
      decision = {
        nextNode: 'reset_plan',
        routeKind: 'reset_plan',
        providerSearchMode: 'none',
        presentationScope: 'clarification',
        focusNeedCategory: null,
        needsToSearch: [],
        needsToPresent: [],
        stopReason: 'plan_reset_completed',
        persistReason: 'reset_plan',
      };
    } else if (evidence.extractionIntent === 'pausar') {
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

  /**
   * A bare confirmation turn carries no actionable delta: null actionIntent,
   * no information/support/RSVP/provider/contact work and no selection
   * reference. Over an unresolved multi-option shortlist it must clarify
   * which provider or action is confirmed, even when the extractor marked
   * ambiguity clear (live: "Si confirmo."). Plan-echoed context (eventType,
   * active need, guest range) does not count as a refinement.
   */
  private isBareProviderConfirmationTurn(extraction: ExtractionResult): boolean {
    return extraction.actionIntent === null &&
      extraction.informationRequests.length === 0 &&
      extraction.supportAct == null &&
      extraction.phoneConfirmation == null &&
      extraction.rsvpAction == null &&
      extraction.rsvpEventReference == null &&
      (extraction.providerQueryIntents?.length ?? 0) === 0 &&
      extraction.providerExplanationRequest == null &&
      extraction.providerDetailRequest == null &&
      extraction.closeAction == null &&
      !extraction.pauseRequested &&
      extraction.vendorCategory == null &&
      (extraction.vendorCategories?.length ?? 0) === 0 &&
      extraction.location == null &&
      extraction.budgetSignal == null &&
      (extraction.preferences?.length ?? 0) === 0 &&
      (extraction.hardConstraints?.length ?? 0) === 0 &&
      extraction.contactName == null &&
      extraction.contactEmail == null &&
      extraction.contactPhone == null &&
      (extraction.selectedProviderHints?.length ?? 0) === 0 &&
      (extraction.selectedProviderReferences?.length ?? 0) === 0;
  }

  private guardAmbiguousProviderConfirmation(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    userMessage: string,
  ): { extraction: ExtractionResult; ambiguous: boolean } {
    const resumesShortlist = extraction.actionIntent === 'confirmar_proveedor' ||
      extraction.actionIntent === 'retomar_plan';
    const isBareAmbiguousTurn = extraction.actionIntent === null &&
      extraction.ambiguity?.status === 'ambiguous' &&
      extraction.informationRequests.length === 0 &&
      (extraction.providerQueryIntents?.length ?? 0) === 0 &&
      extraction.providerExplanationRequest == null &&
      extraction.providerDetailRequest == null &&
      extraction.closeAction == null &&
      !extraction.pauseRequested;
    if (!resumesShortlist && !isBareAmbiguousTurn && !this.isBareProviderConfirmationTurn(extraction)) {
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

  /**
   * A shortlist with several recommended providers and no selection is
   * unresolved when the turn carries no grounded selection reference. Typed
   * plan and extraction evidence only; the user message is matched solely
   * against structured provider references, never against keywords.
   */
  private hasUnresolvedProviderShortlist(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    userMessage: string,
  ): boolean {
    const candidateCount = plan.provider_needs.reduce(
      (total, need) => total + need.recommended_providers.length,
      0,
    );
    if (candidateCount <= 1) return false;
    const hasSelection = (plan.selected_provider_ids?.length ?? 0) > 0 ||
      plan.provider_needs.some((need) => (need.selected_provider_ids?.length ?? 0) > 0);
    if (hasSelection) return false;
    return !this.hasGroundedSelectionReference(plan, extraction, userMessage);
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
    capabilityDecision?: CapabilityDecision;
    humanTakeoverAttempted?: boolean;
    humanTakeoverSucceeded?: boolean;
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
      authentication_execution_summary: this.summarizeAuthenticationExecution(
        args.toolUsage.outputs,
      ),
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
      continuity_state: args.messageContext.continuity?.state,
      welcome_allowed: args.messageContext.continuity?.welcomeAllowed,
      history_status: args.messageContext.historyStatus,
      has_prior_outbound: args.messageContext.continuity?.hasPriorOutbound ?? args.messageContext.recentMessages.some(
        (message) => message.direction === 'outbound',
      ),
      requested_operation: args.extraction.requestedOperation ?? null,
      capability_decision: args.capabilityDecision?.status ?? null,
      capability_reason: args.capabilityDecision?.status === 'unsupported'
        ? args.capabilityDecision.reason
        : null,
      human_takeover_attempted: args.humanTakeoverAttempted,
      human_takeover_succeeded: args.humanTakeoverSucceeded,
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
      information_normalization_rejected_count: extraction.normalizationIssues?.length ?? 0,
      information_normalization_issue_reasons: extraction.normalizationIssues?.map((issue) => issue.reason) ?? [],
      support_act_kind: extraction.supportAct?.kind ?? null,
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
      rsvp_action: extraction.rsvpAction ?? null,
      rsvp_candidate_guest_id_present:
        extraction.rsvpCandidateGuestId !== null &&
        extraction.rsvpCandidateGuestId !== undefined,
      rsvp_event_reference_present: Boolean(extraction.rsvpEventReference),
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
      rsvp_status: plan.rsvp_state.status,
      rsvp_candidate_count: plan.rsvp_state.candidates.length,
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

  private summarizeAuthenticationExecution(
    outputs: ToolOutputTrace[],
  ): TurnTrace['authentication_execution_summary'] {
    const authOperations = new Set([
      'auth_by_phone',
      'request_user_login_code',
      'verify_user_login_code',
    ]);
    return outputs.flatMap((entry) => {
      if (!authOperations.has(entry.tool)) {
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.output) as unknown;
      } catch {
        return [];
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return [];
      }
      const record = parsed as Record<string, unknown>;
      const operation = entry.tool as
        | 'auth_by_phone'
        | 'request_user_login_code'
        | 'verify_user_login_code';
      return [{
        operation,
        status: typeof record.status === 'string' ? record.status : 'unknown',
        auth_method:
          record.auth_method === 'phone' || record.auth_method === 'email_otp'
            ? record.auth_method
            : null,
        failure_kind:
          typeof record.failure_kind === 'string' ? record.failure_kind : null,
        retryable: typeof record.retryable === 'boolean' ? record.retryable : null,
        error_preview:
          typeof record.error_preview === 'string' ? record.error_preview : null,
        http_status:
          typeof record.http_status === 'number' ? record.http_status : null,
        request_id:
          typeof record.request_id === 'string' ? record.request_id : null,
      }];
    });
  }

  private resolveExtractionNode(
    plan: PersistedPlan,
    extraction: ExtractionResult,
  ): DecisionNode {
    if (extraction.actionIntent === 'reset_plan') {
      return 'reset_plan';
    }

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
    const informationSupportFlow =
      plan.current_node === 'resolver_consultas_informativas' ||
      plan.information_state.pending_requests.length > 0;
    // A name supplied while resolving a support request may identify a guest,
    // order holder, or other third party. Keep the channel user's identity
    // unless a planning/identity flow explicitly establishes it.
    const nextName = plan.contact_name ??
      (informationSupportFlow ? null : guardedExtraction.contactName);

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
      const selectedProviderCount = new Set(
        plan.provider_needs.flatMap((need) => need.selected_provider_ids),
      ).size;
      const deferredCategories = plan.provider_needs
        .filter((need) => need.status === 'deferred')
        .map((need) => need.category);
      const submissionSummary = selectedProviderCount === 1
        ? `La solicitud de cotización fue enviada a ${destination}. Este proveedor se pondrá en contacto contigo por correo electrónico o teléfono.`
        : `Las solicitudes de cotización fueron enviadas a ${destination}. Los proveedores se pondrán en contacto contigo por correo electrónico o teléfono.`;
      const deferredSummary = deferredCategories.length > 0
        ? ` ${this.formatSpanishList(deferredCategories)} quedó fuera del envío y sin proveedor seleccionado.`
        : '';
      return {
        type: 'generic',
        paragraphs_es: [
          `${submissionSummary}${deferredSummary}`,
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

  private formatSpanishList(values: readonly string[]): string {
    if (values.length <= 1) {
      return values[0] ?? '';
    }
    return `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`;
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
