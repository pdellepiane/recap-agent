import { ulid } from 'ulid';
import { applyHandoffResult, decideHumanHelpAttempt, resolveHandoffGatewayStatus } from './human-help-policy';
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
import type { InboundImage } from '../core/inbound-image';
import { decodeValidatedBase64Bytes } from '../core/inbound-image';
import {
  appendImageAttachmentRef,
  contentDigestForBytes,
  findReusableFileRef,
  imageFileFingerprint,
  imageUrlFingerprint,
  isFileRefActive,
  redactFileIdForLog,
  redactImageUrlForLog,
  selectActiveImageAttachmentRefs,
  type FileAttachmentRef,
  type ImageAttachmentRef,
} from '../core/image-attachments';
import type { ImageFileStore } from './image-file-store';
import { ImageFileUploadError } from './image-file-store';
import {
  ProviderImageAccessError,
  buildImageObservation,
  isProviderImageDownloadAccessFailure,
} from './openai-agent-runtime';
import type { ImageObservation } from './contracts';
import type { ImageFileAttachment } from './contracts';
import {
  createInformationAuthGuidance,
  enrichmentVisitKey,
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
  type PurchaseInformation,
} from '../core/information';
import {
  buildLastOutboundContext,
  createEmptyPlan,
  getActiveNeed,
  isPlanFinished,
  MAX_LAST_OUTBOUND_TEXT_BYTES,
  mergePlan,
  replaceProviderNeeds,
  truncateTextToUtf8Bytes,
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
  ComposeReplyRequest,
  ComposeReplyResult,
  ContinuityProjection,
  ExtractionResult,
  ModelOriginReceipt,
  RsvpPhoneReplyEvidence,
  ToolUsage,
} from './contracts';
import type { TokenUsage } from './contracts';
import type { OpenAiCallRef } from './contracts';
import type { OpenAiTransportMetrics } from './contracts';
import { missingOutputOrigin, observeOutputOrigin } from '../audit/output-origin';
import { extractOtpCode } from './otp-normalization';
import {
  consumeVerificationAttempt,
  decideTerminalContinuation,
  effectiveAuthRecovery,
  isTerminalAuthRecovery,
  mergeAuthRecovery,
  preserveRecoveryAcrossReset,
  type AuthRecoveryTerminalReason,
  type InformationAuthRecoveryState,
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
import { readPendingTaskOutcome } from './openai-agent-runtime';
import { isApprovalBoundaryAnsweredByRecord } from './purchase-reconciliation';
import {
  inferCurrencyFromBudget,
  isProviderEligibleForCriteria,
  parseBudgetAmount,
  rankProvidersForCriteria,
  type ProviderFitCriteria,
} from './provider-fit';
import { createSubQueryFitCriteria, selectProvidersForSubQuery } from './provider-sub-query-selection';
import { missingSelectionTraceOperations } from './selection-trace-operations';
import type {
  ProviderPlanOperation,
  ProviderQueryIntent,
  ProviderReference,
} from './extraction-schemas';
import { resolvePurchaseResourceForAspects } from './extraction-schemas';
import { parseInternationalPhone, splitInternationalPhone } from './phone';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { StructuredMessage } from './structured-message';
import type { PlanStore } from '../storage/plan-store';
import { conversationPartitionKey } from '../storage/conversation-key';
import {
  InMemoryRsvpEffectStore,
  executeRsvpEffectVerified,
  type RsvpEffectStore,
  type RsvpVerifiedEffect,
} from './rsvp-effect-executor';
import {
  InformationOrchestrator,
  type HydratedEventDetail,
  type InformationAuthBlock,
  type InformationAuthentication,
} from './information-orchestrator';
import {
  buildRuntimeCapabilityManifest,
  isServableInformationRead,
  resolveCapabilityDecision,
  type CapabilityDecision,
  type RuntimeCapabilityDescriptor,
  type RuntimeCapabilityManifest,
  type RuntimeOperationId,
} from './capability-manifest';
import { NoopKnowledgeRetrievalGateway } from './knowledge-retrieval-gateway';
import {
  buildTurnMessageContext,
  deriveConversationContinuity,
  localTurnMessageContext,
  orderMessagesByServerTime,
  recentConversationMessageLimit,
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
  applyDocumentedTransportTransforms,
  canonicalModelContent,
  composeModelReply,
  hashCanonicalModelContent,
  ModelComposedFailureError,
  modelProviderIdsOf,
  modelSpansOf,
  providerMetadataDiffers,
} from './model-composition';
import {
  buildExpectedDeliveredText,
  ReferenceRenderError,
} from '../audit/expected-render';
import {
  assembleCustomerContext,
  enrichmentScopeKey,
  expandInlinePurchaseDetail,
  projectCustomerContext,
  rankCandidatesByRelevance,
  resolveRelevantTarget,
  selectEnrichmentTargets,
  type CustomerContextProjection,
  type CustomerEnrichmentSummary,
  type CustomerProjectionFocus,
} from './customer-context';
import {
  applyOwnerForTurn,
  type CustomerCapabilitySignals,
  type OwnerDomainSignals,
} from './owner-routing';
import { projectSupportHandoffEvidence } from './reply-evidence-projector';
import { buildFinishPlanSummary, buildProviderQuoteReceipts } from './finish-plan-debug';
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

/**
 * R7 S12 close misclassification repair (service mirror of the runtime
 * helper). A `request_contact` close action with fully seeded typed state
 * (complete contact, eligible selection, user-backed event date, active
 * plan) must dispatch the effect, not re-ask contact. Returns the effective
 * action type for the dispatch decision.
 */
export function effectiveCloseActionForDispatch(args: {
  readonly closeActionType: string | null;
  readonly contactComplete: boolean;
  readonly hasEligibleSelection: boolean;
  readonly eventDateAvailable: boolean;
  readonly lifecycleActive: boolean;
}): string | null {
  if (
    (args.closeActionType === 'request_contact' || args.closeActionType === 'proceed_confirmed') &&
    args.contactComplete &&
    args.hasEligibleSelection &&
    args.eventDateAvailable &&
    args.lifecycleActive
  ) {
    return 'proceed_confirmed';
  }
  return args.closeActionType;
}

/**
 * R7 accountless disambiguation: when a purchase/event request exists and a
 * channel contact phone is available, the turn must execute the phone-scoped
 * lookup instead of asking the user to identify themselves. Typed evidence
 * only; no keyword matching.
 */
export function shouldAttemptPhoneLookupBeforeAsking(args: {
  readonly hasPurchaseOrEventRequest: boolean;
  readonly contactPhonePresent: boolean;
  readonly alreadyAuthenticated: boolean;
}): boolean {
  return args.hasPurchaseOrEventRequest &&
    args.contactPhonePresent &&
    !args.alreadyAuthenticated;
}

/**
 * R7 multi-request retention: every extracted + persisted information
 * request must advance. Returns the merged request list with no drops
 * (dedupe by requestId only). A spanish_only or email-need turn never drops
 * the email/auth need from the set.
 */
export function retainAllInformationRequests<T extends { requestId: string }>(
  persisted: readonly T[],
  extracted: readonly T[],
): T[] {
  const seen = new Set(persisted.map((request) => request.requestId));
  const merged = [...persisted];
  for (const request of extracted) {
    if (!seen.has(request.requestId)) {
      seen.add(request.requestId);
      merged.push(request);
    }
  }
  return merged;
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

/**
 * Explicit image attachment carried by an image turn. URL turns project the
 * link as native image content (never downloaded, proxied, rehosted or
 * converted); base64 turns project the persisted Files reference (never
 * bytes). The reference is persisted before any reply is composed.
 */
type ImageTurnContext = {
  kind: 'url' | 'file';
  messageId: string;
  refStored: boolean;
  captionPresent: boolean;
  /** URL turns only. Absent on file turns. */
  url?: string;
  /** File turns only: persisted Files reference. Absent on URL turns. */
  fileId?: string;
  /** File turns only: true when an existing upload was reused. */
  reusedUpload?: boolean;
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

/**
 * Provider credential failures (401/403 or authentication/permission error
 * names). These propagate from every image path and are never relabeled as
 * image unavailability. Failure-kind validation only; no text inspected.
 */
export function isAuthenticationFailure(error: unknown): boolean {
  const status = readProviderErrorStatus(error);
  if (status === 401 || status === 403) return true;
  if (error instanceof Error) {
    return error.name === 'AuthenticationError' || error.name === 'PermissionDeniedError';
  }
  return false;
}

/**
 * Narrow provider file-access failure: the persisted file or URL cannot be
 * fetched by the model (invalid image payload or a download 404). Only this
 * kind becomes unavailable image evidence when a response is needed. Auth,
 * plan-store and generic model failures are not file-access failures.
 *
 * R3: the observed live failure is a status-400 BadRequestError whose
 * provider diagnostic reads `Error while downloading file. Upstream status
 * code: 404.` with structured code/param absent (reproduced end to end
 * through the installed SDK; `.name` is `'Error'`, so name predicates
 * miss it). That shape is recognized here through the provider boundary's
 * typed error (normal path) or its narrow provider-diagnostic parser
 * (direct/stub errors that bypass the boundary). The parser inspects
 * provider error text only, never user text. Generic 400s, 401/403, 429,
 * 500s, timeouts and storage failures never match.
 */
export function isImageFileAccessFailure(error: unknown): boolean {
  if (error instanceof ProviderImageAccessError) return true;
  if (isAuthenticationFailure(error)) return false;
  if (error instanceof ModelComposedFailureError) return false;
  const status = readProviderErrorStatus(error);
  if (status === 404) return true;
  if (status === 401 || status === 403) return false;
  if (error instanceof Error) {
    if (error.name === 'NotFoundError') return true;
    const code = readProviderErrorCode(error);
    if (code !== null && /invalid_image|image_download|image_url|file_not_found/iu.test(code)) return true;
  }
  if (isProviderImageDownloadAccessFailure(error)) return true;
  return false;
}

function readProviderErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function readProviderErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as { code?: unknown; error?: unknown };
  if (typeof record.code === 'string' && record.code.length > 0) return record.code;
  if (typeof record.error === 'object' && record.error !== null) {
    const nested = (record.error as { code?: unknown }).code;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return null;
}

/**
 * R3 fallback accounting. Merges the failed image-attempt transport carried
 * by a typed `ProviderImageAccessError` with the retry attempt call ref so
 * totals keep BOTH attempts: attemptCount counts the failed call plus the
 * retry, and transport sums observed requests/payload bytes with both
 * per-request entries retained. The failed attempt is never overwritten
 * with success-only numbers. Without failed transport the retry stands.
 */
function mergeFallbackTransportMetrics(
  failed: OpenAiTransportMetrics | null,
  retry: OpenAiTransportMetrics | null,
): OpenAiTransportMetrics | null {
  if (failed === null) return retry;
  if (retry === null) return failed;
  const sumBytes = (first: number | null, second: number | null): number | null =>
    first !== null && second !== null ? first + second : (first ?? second);
  return {
    observedRequestCount: failed.observedRequestCount + retry.observedRequestCount,
    totalPayloadBytes: sumBytes(failed.totalPayloadBytes, retry.totalPayloadBytes),
    instructionBytes: sumBytes(failed.instructionBytes, retry.instructionBytes),
    inputBytes: sumBytes(failed.inputBytes, retry.inputBytes),
    toolBytes: sumBytes(failed.toolBytes, retry.toolBytes),
    outputSchemaBytes: sumBytes(failed.outputSchemaBytes, retry.outputSchemaBytes),
    requests: [...failed.requests, ...retry.requests],
  };
}

export class AgentService {
  private readonly capabilityManifest: RuntimeCapabilityManifest;

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
      /**
       * Packet B: durable RSVP effect receipts. Production injects
       * DynamoRsvpEffectStore on the existing plans table. Absent (unit
       * tests), verification still runs with a transient per-turn store and
       * deduplication coverage is reported unavailable — the in-memory
       * double is never production durability.
       */
      rsvpEffectStore?: RsvpEffectStore;
      /**
       * Narrow Files adapter for base64 persistence. Absent in unit-test
       * doubles; a base64 turn without a store degrades to unavailable
       * image evidence instead of failing the turn.
       */
      imageFileStore?: ImageFileStore;
    },
  ) {
    this.capabilityManifest = dependencies.capabilityManifest ??
      dependencies.agentConversationGateway?.capabilityDescriptor ??
      buildRuntimeCapabilityManifest({
        configured: Boolean(dependencies.agentConversationGateway),
        environment: 'production',
        allowCustomerWrites: true,
      });
  }

  async handleTurn(
    inbound: NormalizedInboundMessage,
  ): Promise<HandleTurnResponse> {
    const result = await this.handleTurnCore(inbound);
    return await this.finalizeLastOutboundRecord(inbound, result);
  }

  /**
   * S2 centralized continuity finalization. Runs in the public wrapper after
   * the core result (and its render/origin verification) inside the
   * caller-held chat lease. Builds last_outbound_context from this turn's
   * verified successful rendered text only and performs one final save only
   * when that metadata actually changes. Earlier durable effect/plan saves
   * stay in their branches; a final-save failure never reruns effects (it
   * propagates with branch effects already durable). Constructed provenance
   * is kept distinct from independently confirmed delivery: a successful
   * Lambda return never claims end-user receipt.
   */
  private async finalizeLastOutboundRecord(
    inbound: NormalizedInboundMessage,
    result: HandleTurnResponse,
  ): Promise<HandleTurnResponse> {
    if (result.outbound.delivery.action !== 'send') return result;
    if (typeof result.outbound.text !== 'string' || result.outbound.text.length === 0) {
      return result;
    }
    const finalized = this.withLastOutboundContext(
      result.plan,
      result.outbound,
      inbound.messageId,
    );
    if (finalized === result.plan) return result;
    const current = result.plan.last_outbound_context ?? null;
    const next = finalized.last_outbound_context ?? null;
    if (
      current !== null && next !== null &&
      current.message_id === next.message_id &&
      current.text === next.text &&
      current.text_truncated === next.text_truncated &&
      current.delivery_evidence === next.delivery_evidence
    ) {
      return result;
    }
    await this.dependencies.planStore.save({
      plan: finalized,
      reason: 'last_outbound_finalized',
    });
    // The branch reason stays authoritative for the turn: the final save
    // only carries the latest-response record, so trace persistence reason
    // keeps describing the turn's durable work, not this metadata save.
    return {
      plan: finalized,
      outbound: result.outbound,
      trace: {
        ...result.trace,
        plan_persisted: true,
      },
    };
  }

  /**
   * S2 outcome-gated pending clearing. The curated owner pending question
   * clears only when the pre-turn pending reference is present, the model
   * reported pending_task_outcome answered against that same task, and the
   * outbound is a verified send. A generated clarification, suppress,
   * origin failure, inaccessible-image response or changed target never
   * clears. No keyword or string-similarity inference.
   */
  private shouldClearPendingQuestion(args: {
    preTurnPendingQuestion: string | null;
    structuredMessage: StructuredMessage | undefined;
    outbound: NormalizedOutboundMessage;
  }): boolean {
    const pending = args.preTurnPendingQuestion?.trim();
    if (!pending) return false;
    if (args.outbound.delivery.action !== 'send') return false;
    return readPendingTaskOutcome(args.structuredMessage) === 'answered';
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
    // R2 latest-response fallback: when backend history lacks the current
    // thread, the latest successful rendered response still informs
    // answered-vs-pending state. Never overwrites newer backend history.
    const rawWithFallback = this.applyLastOutboundFallback(rawMessageContext, classifierPlan);
    const messageContext = withConversationContinuity(rawWithFallback, classifierPlan);
    timingMs.response_classification += Date.now() - messageContextStartedAt;
    if (inbound.image) {
      return await this.handleImageTurn({
        inbound,
        plan: existingPlan ?? classifierPlan,
        messageContext,
        toolUsage,
        timingMs,
        tokenUsage,
        handleTurnStartedAt,
      });
    }
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
      // Narrowed soft-pause: a genuinely new question detected by the typed
      // response classifier, or a turn on a thread with retained image refs
      // that can still answer, falls through to normal handling instead of
      // blanket suppression. Empty follow-ups and same-thread continuations
      // without those signals stay suppressed below.
      const classifierAsksResponse = responseClassifierTrace?.action === 'respond' &&
        responseClassifierTrace?.reason === 'requires_response';
      const hasRetainedImageRefs = (existingPlan.image_attachments?.length ?? 0) > 0;
      if (!classifierAsksResponse && !hasRetainedImageRefs) {
      // Terminal OTP retention: a code arriving after terminal recovery was
      // persisted must not verify again. Retain the human path without a
      // second effect. Prose follow-ups still take the suppress path.
      if (
        isTerminalAuthRecovery(this.effectiveAuthRecovery(existingPlan)) &&
        this.extractUserLoginCode(inbound.text) !== null
      ) {
        return await this.retainTerminalOtpHandoff({
          inbound,
          existingPlan: this.withSeededAuthRecovery(existingPlan),
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
        const handoffEvidence = projectSupportHandoffEvidence({
          result: gatewayResult,
          phonePresent: phoneNumber !== null,
          confirmedReceipt: gatewayResult.status === 'success',
        });
        const bundle = await this.dependencies.promptLoader.loadNodeBundle('solicitar_agente_humano');
        const composeReplyStartedAt = Date.now();
        let reply: ComposeReplyResult;
        try {
          reply = await composeModelReply(this.dependencies.runtime, {
            currentNode: 'solicitar_agente_humano',
            previousNode: classifierPlan.current_node,
            userMessage: inbound.text,
            messageContext,
            plan: planToSave,
            extraction,
            missingFields: [],
            searchReady: false,
            providerResults: [],
            turnDecision: this.humanEscalationTurnDecision('human_help_offer_accepted'),
            errorMessage: handoffEvidence.operationalNote,
            promptBundleId: bundle.id,
            promptFilePaths: bundle.filePaths,
            toolUsage,
            handoffOutcome: handoffEvidence.handoffOutcome,
          });
        } catch (error) {
          timingMs.compose_reply += Date.now() - composeReplyStartedAt;
          timingMs.total = Date.now() - handleTurnStartedAt;
          return {
            plan: planToSave,
            outbound: this.failureOutbound(
              planToSave.conversation_id,
              'human_help_offer_accepted_composition_failed',
              observeOutputOrigin({
                candidateText: null,
                deliveredText: null,
                transformationVersion: 'transport-v2',
                mismatchFields: ['model_output'],
              }),
            ),
            trace: this.buildTrace({
              plan: planToSave,
              previousNode: classifierPlan.current_node,
              currentNode: 'solicitar_agente_humano',
              nodePath: [classifierPlan.current_node, 'solicitar_agente_humano'],
              extraction,
              missingFields: [],
              searchReady: false,
              promptBundleId: bundle.id,
              promptFilePaths: bundle.filePaths,
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
              operationalNote: `Human help offer accepted composition failed (${error instanceof Error ? error.name : 'unknown'}); typed operational failure delivered without prose.`,
              responseClassifier: responseClassifierTrace,
            }),
          };
        }
        tokenUsage.reply = reply.tokenUsage ?? null;
        tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
        tokenUsage.total = this.sumTokenUsage(
          tokenUsage.classifier,
          tokenUsage.extraction,
          tokenUsage.reply,
        );
        timingMs.compose_reply += Date.now() - composeReplyStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        return {
          plan: planToSave,
          outbound: this.renderOutbound(
            reply,
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
            promptBundleId: bundle.id,
            promptFilePaths: bundle.filePaths,
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
        const bundle = await this.dependencies.promptLoader.loadNodeBundle('ofrecer_agente_humano');
        const composeReplyStartedAt = Date.now();
        let reply: ComposeReplyResult;
        try {
          reply = await composeModelReply(this.dependencies.runtime, {
            currentNode: 'ofrecer_agente_humano',
            previousNode: classifierPlan.current_node,
            userMessage: inbound.text,
            messageContext,
            plan: planToSave,
            extraction,
            missingFields: planToSave.missing_fields,
            searchReady: false,
            providerResults: [],
            turnDecision: this.conversationHealthTurnDecision(responseClassifierTrace.health_reason),
            errorMessage: null,
            promptBundleId: bundle.id,
            promptFilePaths: bundle.filePaths,
            toolUsage,
          });
        } catch (error) {
          timingMs.compose_reply += Date.now() - composeReplyStartedAt;
          timingMs.total = Date.now() - handleTurnStartedAt;
          return {
            plan: planToSave,
            outbound: this.failureOutbound(
              planToSave.conversation_id,
              'conversation_health_help_offer_composition_failed',
              observeOutputOrigin({
                candidateText: null,
                deliveredText: null,
                transformationVersion: 'transport-v2',
                mismatchFields: ['model_output'],
              }),
            ),
            trace: this.buildTrace({
              plan: planToSave,
              previousNode: classifierPlan.current_node,
              currentNode: 'ofrecer_agente_humano',
              nodePath: [classifierPlan.current_node, 'ofrecer_agente_humano'],
              extraction,
              missingFields: planToSave.missing_fields,
              searchReady: false,
              promptBundleId: bundle.id,
              promptFilePaths: bundle.filePaths,
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
              operationalNote: `Conversation health help offer composition failed (${error instanceof Error ? error.name : 'unknown'}); typed operational failure delivered without prose.`,
              responseClassifier: responseClassifierTrace,
            }),
          };
        }
        tokenUsage.reply = reply.tokenUsage ?? null;
        tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
        tokenUsage.total = this.sumTokenUsage(
          tokenUsage.classifier,
          tokenUsage.extraction,
          tokenUsage.reply,
        );
        timingMs.compose_reply += Date.now() - composeReplyStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        return {
          plan: planToSave,
          outbound: this.renderOutbound(
            reply,
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
            promptBundleId: bundle.id,
            promptFilePaths: bundle.filePaths,
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
        currentMessageId: inbound.messageId,
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

      // On a finished plan with selected providers, confirmation or repeat
      // close continues the outcome; use evidence including
      // close_submission_performed_this_turn: false instead of resetting.
      const isPlanningIntent =
        finishedExtraction.actionIntent === 'reset_plan' ||
        finishedExtraction.actionIntent === 'buscar_proveedores' ||
        finishedExtraction.actionIntent === 'retomar_plan' ||
        finishedExtraction.actionIntent === 'ver_opciones' ||
        finishedExtraction.actionIntent === 'refinar_busqueda';

      if (isPlanningIntent) {
        const freshPlan = createEmptyPlan({
          planId: ulid(),
          channel: inbound.channel,
          externalUserId: inbound.externalUserId,
        });
        // Recovery and handoff dedupe survive event-plan resets and session
        // changes; a reset never clears attempts or terminal recovery.
        existingPlan = mergePlan(freshPlan, {
          auth_recovery: preserveRecoveryAcrossReset(
            this.effectiveAuthRecovery(existingPlan),
          ),
          human_help_receipt: existingPlan.human_help_receipt ?? null,
        });
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
        const reply = composedReply;
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
      currentMessageId: inbound.messageId,
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
    // Close-vs-pause reconciliation on typed extraction only, never user
    // text. An explicit close ("ahora cerremos el plan") always continues
    // the existing close flow: a conflicting pause mark dissolves. There
    // is no explicit pause state — pausing is the user not writing — so a
    // pause mark dissolves too and the turn continues normal handling.
    // Genuine close intent and close data are preserved; nothing here
    // matches keywords or recites provider names.
    if (extraction.actionIntent === 'cerrar') {
      if (extraction.pauseRequested) {
        extraction = { ...extraction, pauseRequested: false };
      }
    } else if (extraction.actionIntent === 'pausar' || extraction.pauseRequested) {
      extraction = { ...extraction, actionIntent: null, pauseRequested: false };
    }
    extraction = this.preserveContactPhoneCandidate(extraction, inbound.text);
    // D1: unclear equals absent; yes/no only when typed auth state is relevant.
    // Pure shortlist omits phone-auth fields: normalize to absent.
    {
      const effectivePhone = this.effectivePhoneConfirmation(workingPlan, extraction);
      const rawPhone = extraction.phoneConfirmation ?? null;
      if (effectivePhone !== rawPhone) {
        extraction = { ...extraction, phoneConfirmation: effectivePhone };
      }
    }
    // D2: mailbox report alone stays support. Explicit human routing requires
    // typed humanHelpIntent; actionIntent alone cannot override supportAct.
    if (this.isSupportWinOverHuman(workingPlan, extraction)) {
      extraction = { ...extraction, actionIntent: null };
    } else if (extraction.actionIntent === 'solicitar_humano' && !this.isExplicitHumanRequest(workingPlan, extraction)) {
      extraction = { ...extraction, actionIntent: null };
    }
    const authControl = extraction.phoneConfirmation === 'no' || extraction.informationRequests.some(
      (request) => (request.kind === 'purchase' || request.kind === 'associated_event') &&
        request.authAction === 'decline_authentication');
    if (authControl) {
      return await this.handleInformationFlow({ inbound, previousNode, workingPlan, extraction,
        toolUsage, timingMs, tokenUsage, responseClassifierTrace, messageContext, handleTurnStartedAt });
    }
    // D1: a close/confirm over an unresolved multi-option shortlist is an
    // ambiguous confirmation, not a capability write or a close. Defuse the
    // close markers before capability arbitration so the domain clarification
    // path answers with the bounded question instead of closing or claiming
    // an unsupported operation. Grounded selections still close normally.
    if (
      (extraction.actionIntent === 'cerrar' || extraction.closeAction != null) &&
      this.hasUnresolvedProviderShortlist(workingPlan, extraction, inbound.text)
    ) {
      const clarificationExtraction = this.guardAmbiguousProviderConfirmation(
        workingPlan,
        {
          ...extraction,
          actionIntent: null,
          closeAction: null,
          selectedProviderHints: [],
          selectedProviderReferences: [],
        },
        inbound.text,
      ).extraction;
      return await this.handleContextualClarification({
        inbound,
        previousNode: existingPlan?.current_node ?? 'contacto_inicial',
        plan: workingPlan,
        extraction: clarificationExtraction,
        toolUsage,
        tokenUsage,
        responseClassifierTrace,
        messageContext,
        timingMs,
        handleTurnStartedAt,
      });
    }
    const capabilityBoundaryResponse = await this.handleCapabilityBoundaryIfNeeded({      inbound,
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
      const resetBase = createEmptyPlan({
        planId: ulid(),
        channel: inbound.channel,
        externalUserId: inbound.externalUserId,
      });
      // Recovery and dedupe survive plan reset/session change.
      workingPlan = mergePlan(resetBase, {
        auth_recovery: preserveRecoveryAcrossReset(
          this.effectiveAuthRecovery(workingPlan),
        ),
        human_help_receipt: workingPlan.human_help_receipt ?? null,
      });
      sessionFocus = null;
    }
    const providerConfirmationGuard = this.guardAmbiguousProviderConfirmation(
      workingPlan,
      extraction,
      inbound.text,
    );
    extraction = providerConfirmationGuard.extraction;
    // L4 persistent ownership: resolve the serving owner from typed turn
    // evidence and persist it on the working plan so downstream flows save
    // it. At most one silent transfer per turn; the recipient alone acts.
    workingPlan = this.persistTurnOwner({
      plan: workingPlan,
      extraction,
      contactPhone: inbound.contactPhone,
    });
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
    let mergedPlan = operationResult.plan;
    if (operationResult.unresolvedMessage) {
      errorMessage = operationResult.unresolvedMessage;
    }
    // R2 cold-start continuity: an evidence-seeking question asked on a
    // fresh thread takes no clarification turn (no prior context), so the
    // unresolved user question is preserved here for its later image. Every
    // downstream normal exit derives from mergedPlan and carries it; later
    // answers clear it. Never overwrites an already-pending question.
    if (extraction.ambiguity?.questionKey === 'status_or_proof_review') {
      mergedPlan = this.stashOwnerPendingQuestion(mergedPlan, inbound.text, { overwrite: true });
    }
    const effectiveSelectionHints = this.resolveEffectiveSelectionHints(extraction);
    const shouldResolveProviderSelection =
      !this.isCloseContactFieldTurn(previousNode, extraction, validationError, mergedPlan);
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

    if (this.isExplicitHumanRequest(mergedPlan, extraction)) {
      currentNode = 'solicitar_agente_humano';
      if (nodePath[nodePath.length - 1] !== currentNode) {
        nodePath.push(currentNode);
      }
      const phoneNumber = this.resolveEscalationPhone(inbound);
      const requestedAt = new Date().toISOString();
      // Dedupe-preserving explicit help handling: failed/skipped/unknown
      // receipts are never auto-retried. Only a definitively failed handoff
      // may retry on a new explicit inbound request; unknown stays unretried.
      const priorHelpReceipt = mergedPlan.human_help_receipt ?? null;
      const helpDecision = decideHumanHelpAttempt({
        conversationId: mergedPlan.plan_id,
        inboundId: inbound.messageId, scope: 'protected_request', trustedPhone: phoneNumber,
        gatewayCapable: this.capabilityManifest['human.takeover.write'].available,
        prior: priorHelpReceipt,
        explicitRetry: priorHelpReceipt?.outcome === 'handoff_failed' &&
          priorHelpReceipt.inboundId !== inbound.messageId,
      });
      let gatewayResult: AgentGatewayResult;
      let nextReceipt = priorHelpReceipt;
      if (helpDecision.action === 'attempt' && phoneNumber) {
        gatewayResult = await this.requestHumanTakeoverWithTrace(
          agentConversationGateway,
          phoneNumber,
          toolUsage,
        );
        // Never fabricate a receipt for an unattempted effect: skipped
        // gateway results persist only the reason, not a failed receipt.
        nextReceipt = gatewayResult.status === 'skipped'
          ? priorHelpReceipt
          : applyHandoffResult({ dedupeKey: helpDecision.dedupeKey, inboundId: inbound.messageId,
            phone: phoneNumber, gatewayStatus: resolveHandoffGatewayStatus({
              status: gatewayResult.status === 'success' ? 'success' : 'failed',
              outcome: gatewayResult.status === 'failed' ? gatewayResult.outcome : undefined,
            }) });
      } else if (priorHelpReceipt?.outcome === 'handoff_requested') {
        gatewayResult = { status: 'success', message: 'retained_confirmed_handoff' };
      } else if (phoneNumber === null) {
        gatewayResult = this.missingPhoneEscalationResult();
      } else {
        gatewayResult = { status: 'skipped', reason: 'not_configured', message: helpDecision.reason };
      }
      const helpRequested = nextReceipt?.outcome === 'handoff_requested' ||
        gatewayResult.status === 'success';
      const helpLastError = helpRequested
        ? null
        : gatewayResult.status === 'failed'
          ? gatewayResult.error
          : gatewayResult.status === 'skipped'
            ? gatewayResult.message
            : (nextReceipt?.outcome ?? helpDecision.reason);
      const planToSave = mergePlan(mergedPlan, {
        current_node: currentNode,
        intent: 'solicitar_humano',
        human_help_receipt: nextReceipt,
        human_escalation: {
          status: helpRequested ? 'requested' : 'none',
          requested_at: helpRequested ? (nextReceipt?.updatedAt ?? requestedAt) : null,
          phone_number: phoneNumber,
          last_error: helpLastError,
        },
      });
      await persistPlan(planToSave, currentNode);
      planPersisted = true;
      planPersistReason = currentNode;
      timingMs.total = Date.now() - handleTurnStartedAt;
      const handoffEvidence = projectSupportHandoffEvidence({
        result: gatewayResult,
        phonePresent: phoneNumber !== null,
        confirmedReceipt: nextReceipt?.outcome === 'handoff_requested',
      });
      const bundle = await this.dependencies.promptLoader.loadNodeBundle('solicitar_agente_humano');
      const composeReplyStartedAt = Date.now();
      let reply: ComposeReplyResult;
      try {
        reply = await composeModelReply(this.dependencies.runtime, {
          currentNode: 'solicitar_agente_humano',
          previousNode,
          userMessage: inbound.text,
          messageContext,
          plan: planToSave,
          extraction,
          missingFields: [],
          searchReady: false,
          providerResults: [],
          turnDecision: this.humanEscalationTurnDecision(currentNode),
          errorMessage: handoffEvidence.operationalNote,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage,
          handoffOutcome: handoffEvidence.handoffOutcome,
        });
      } catch (error) {
        timingMs.compose_reply += Date.now() - composeReplyStartedAt;
        timingMs.total = Date.now() - handleTurnStartedAt;
        return {
          plan: planToSave,
          outbound: this.failureOutbound(
            planToSave.conversation_id,
            'explicit_human_request_composition_failed',
            observeOutputOrigin({
              candidateText: null,
              deliveredText: null,
              transformationVersion: 'transport-v2',
              mismatchFields: ['model_output'],
            }),
          ),
          trace: this.buildTrace({
            plan: planToSave,
            previousNode,
            currentNode,
            nodePath,
            extraction,
            missingFields: [],
            searchReady: false,
            promptBundleId: bundle.id,
            promptFilePaths: bundle.filePaths,
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
            operationalNote: `Explicit human request composition failed (${error instanceof Error ? error.name : 'unknown'}); typed operational failure delivered without prose.`,
          }),
        };
      }
      tokenUsage.reply = reply.tokenUsage ?? null;
      tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      tokenUsage.total = this.sumTokenUsage(
        tokenUsage.classifier,
        tokenUsage.extraction,
        tokenUsage.reply,
      );
      timingMs.compose_reply += Date.now() - composeReplyStartedAt;
      timingMs.total = Date.now() - handleTurnStartedAt;
      const outbound = this.renderOutbound(
        reply,
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
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
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

    if (
      extraction.actionIntent === 'cerrar' ||
      this.shouldHandleCloseTurn(previousNode, extraction, validationError) ||
      this.shouldContinueCloseAfterRefinement(previousNode, extraction, mergedPlan)
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
        errorMessage = null;
        const planToSave = mergePlan(planToClose, { current_node: currentNode });
        await persistPlan(planToSave, 'crear_lead_cerrar');
        planPersisted = true;
        planPersistReason = 'crear_lead_cerrar';
        // R5: the blocked close still projects only the eligible selection.
        // A deferred need's rejected cards never substitute for it.
        providerResults = this.collectCloseEligibleProviders(planToSave);

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
            toolUsage,
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
      let planToSave = mergePlan(planToClose, { current_node: currentNode });
      await persistPlan(planToSave, 'crear_lead_cerrar');
      planPersisted = true;
      planPersistReason = 'crear_lead_cerrar';
      // R5: the close continuation projects the eligible selection across
      // all non-deferred needs. The active need's shortlist (possibly a
      // deferred category) never substitutes for it and deferred needs are
      // never silently selected by this projection.
      providerResults = this.collectCloseEligibleProviders(planToSave);

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
        onPlanCompleted: async (completedPlan) => {
          planToSave = completedPlan;
          planPersistReason = 'quote_submission_confirmed';
          await persistPlan(completedPlan, planPersistReason);
        },
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
          toolUsage,
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
      if (turnDecision.routeKind === 'present_existing_shortlist') {
        // Packet C deferred-closure preservation: resuming an existing
        // shortlist presents it; it never re-runs retrieval, which would
        // rebuild needs from event-type defaults and drop recorded
        // selections and deferrals absent an explicit user reopen.
        planAfterFlow = mergePlan(planAfterFlow, {
          current_node: currentNode,
        });
        providerResults = this.collectPlanProviders(planAfterFlow);
        searchStrategy = 'existing_plan_shortlist';
        await persistPlan(planAfterFlow, currentNode);
        planPersisted = true;
        planPersistReason = currentNode;
      } else {
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
      }
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
    // Secondary capability question surviving alongside planning work: the
    // boundary yields these turns to the planning owner, so project the
    // available capability evidence here instead of dropping it. Supported
    // and non-applicable decisions stay absent so unrelated turns keep
    // byte-identical model input.
    const planningCapabilityDecision = resolveCapabilityDecision({
      requestedOperation: extraction.requestedOperation ?? null,
      manifest: this.capabilityManifest,
      ambiguity: extraction.ambiguity
        ? {
            status: extraction.ambiguity.status,
            candidateOperations: extraction.ambiguity.candidateOperations ?? [],
            questionKey: extraction.ambiguity.questionKey ?? undefined,
          }
        : undefined,
    });
    const planningCapabilityEvidence =
      planningCapabilityDecision.status === 'unsupported' ||
      planningCapabilityDecision.status === 'clarify'
        ? planningCapabilityDecision
        : undefined;
    const composedReply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode,
      userMessage: inbound.text,
      messageContext,
      plan: planAfterFlow,
      onPlanCompleted: async (completedPlan) => {
        planAfterFlow = completedPlan;
        await persistPlan(completedPlan, 'quote_submission_confirmed');
      },
      extraction,
      missingFields: sufficiency.missingFields,
      searchReady: sufficiency.searchReady,
      providerResults,
      errorMessage,
      promptBundleId: promptBundle.id,
      promptFilePaths: promptBundle.filePaths,
      toolUsage,
      turnDecision,
      capabilityDecision: planningCapabilityEvidence,
    });
    const reply = composedReply;
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
        toolUsage,
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
        capabilityDecision: planningCapabilityEvidence,
      }),
    };
  }

  /**
   * L4 persistent ownership seam. Derives owner domain signals from typed
   * extraction and plan state only (never message keywords) and persists
   * the serving owner plus its Customer assistance capability slice on the
   * working plan. Established turns keep their owner without a router call;
   * transfers are silent, at most one per turn, and FAQ to person-specific
   * assistance stays gated on grounded identity/access.
   */
  private persistTurnOwner(args: {
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    contactPhone: string | null | undefined;
  }): PlanSnapshot {
    const plan = args.plan;
    const extraction = args.extraction;
    const informationRequests = extraction.informationRequests ?? [];
    const pendingRequests = plan.information_state.pending_requests ?? [];
    const hasPendingProtected = pendingRequests.some(
      (request) => request.kind === 'purchase' || request.kind === 'associated_event',
    );
    const hasExtractedProtected = informationRequests.some(
      (request) => request.kind === 'purchase' || request.kind === 'associated_event',
    );
    const rsvpWork = this.hasRsvpWork(plan, extraction);
    // FAQ ownership follows new general-information work only. A bare
    // continuation (last completed replay, thanks, acknowledgement) carries
    // no new domain and must not churn the established owner.
    const faqWork =
      informationRequests.some((request) => request.kind === 'faq') ||
      extraction.supportAct?.kind === 'ask_policy';
    const customerWork =
      rsvpWork ||
      hasPendingProtected ||
      hasExtractedProtected ||
      (extraction.supportAct !== null &&
        extraction.supportAct !== undefined &&
        extraction.supportAct.kind !== 'ask_policy');
    const planningIntents = new Set([
      'reset_plan',
      'elicitar_necesidades',
      'buscar_proveedores',
      'refinar_busqueda',
      'ver_opciones',
      'confirmar_proveedor',
      'modificar_plan_proveedores',
      'explicar_recomendacion',
      'detallar_proveedor',
      'retomar_plan',
      'cerrar',
    ]);
    const planningWork =
      (extraction.actionIntent !== null &&
        extraction.actionIntent !== undefined &&
        planningIntents.has(extraction.actionIntent)) ||
      (extraction.vendorCategory !== null && extraction.vendorCategory !== undefined) ||
      extraction.vendorCategories.length > 0 ||
      (extraction.providerQueryIntents?.length ?? 0) > 0 ||
      (extraction.providerPlanOperations?.length ?? 0) > 0 ||
      extraction.selectedProviderHints.length > 0 ||
      (extraction.selectedProviderReferences?.length ?? 0) > 0 ||
      (extraction.closeAction !== null && extraction.closeAction !== undefined) ||
      extraction.pauseRequested;
    const signals: OwnerDomainSignals = {
      planningWork,
      faqWork,
      customerWork,
      identityAccessGrounded: hasValidUserAuthToken(plan) ||
        splitInternationalPhone(args.contactPhone ?? plan.contact_phone ?? null) !== null,
      protectedTaskRequested: hasExtractedProtected || hasPendingProtected,
    };
    const capabilitySignals: CustomerCapabilitySignals = {
      purchaseWork: hasExtractedProtected ||
        extraction.requestedOperation === 'confirmation_document.send' ||
        extraction.requestedOperation === 'payment_proof.verify' ||
        extraction.requestedOperation === 'purchase.modify',
      rsvpWork,
      authWork: plan.user_auth.status === 'code_requested' ||
        (extraction.phoneConfirmation !== null &&
          extraction.phoneConfirmation !== undefined &&
          extraction.phoneConfirmation !== 'unclear') ||
        informationRequests.some(
          (request) =>
            (request.kind === 'purchase' || request.kind === 'associated_event') &&
            request.authAction !== undefined &&
            request.authAction !== 'none',
        ),
      supportWork: extraction.supportAct !== null && extraction.supportAct !== undefined,
    };
    // S2: the curated pending question is prior-turn state only. The current
    // turn's extractor ambiguity text is never persisted here: it travels in
    // the extraction snapshot for this turn's reply, while evidence-seeking
    // paths stash the inbound user question explicitly downstream when this
    // turn demonstrably needs later evidence.
    const pendingTask = this.ownerPendingTaskRef(plan, extraction, {
      rsvpWork,
      hasProtected: hasExtractedProtected || hasPendingProtected,
      faqWork,
    });
    // R2 stale-task reconciliation: the task ref is recomputed from live
    // typed state every turn, so an explicitly different value (including
    // null once its backing request resolved) overwrites the persisted one.
    // Equal values pass nothing to avoid plan churn. The curated pending
    // question is NOT reconciled here: it survives unrelated intermediate
    // turns until a later turn answers it.
    const currentPendingTask = plan.owner_pending_task ?? null;
    return applyOwnerForTurn({
      plan,
      signals,
      capabilitySignals,
      transfersThisTurn: 0,
      ...(pendingTask !== currentPendingTask ? { pendingTask } : {}),
    }).plan;
  }

  /**
   * Compact typed task ref for the transfer packet. Reuses persisted
   * request ids and typed RSVP state; introduces no new store.
   */
  private ownerPendingTaskRef(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    flags: { rsvpWork: boolean; hasProtected: boolean; faqWork: boolean },
  ): string | null {
    const pending = plan.information_state.pending_requests[0];
    if (pending) {
      return `${pending.kind}:${pending.requestId}`;
    }
    const extracted = (extraction.informationRequests ?? []).find(
      (request) => request.kind === 'purchase' || request.kind === 'associated_event',
    );
    if (extracted && flags.hasProtected) {
      return `${extracted.kind}:extracted`;
    }
    if (flags.rsvpWork) {
      return `rsvp:${plan.rsvp_state.pending_action ?? 'selection'}`;
    }
    if (flags.faqWork) {
      return 'faq:open';
    }
    // Secondary capability question alongside planning work (for example an
    // email-send request next to a catering need): the transfer packet keeps
    // the operation ref so the serving owner answers it honestly instead of
    // dropping it. Reconciled to null once no longer requested. Never a new
    // agent and never a functionality guarantee.
    const requestedOperation = extraction.requestedOperation ?? null;
    if (requestedOperation !== null) {
      return `capability:${requestedOperation}`;
    }
    return null;
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
    // A lingering RSVP state never hijacks a turn carrying other-domain
    // work without explicit RSVP evidence: the actual question is answered
    // by its own flow, which looks up and answers in the same turn. An
    // explicit RSVP decision still resumes the persisted state below.
    if (
      (extraction.informationRequests.length > 0 ||
        plan.information_state.pending_requests.length > 0 ||
        plan.information_state.last_completed_request !== null) &&
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
    // Packet C stale replay guard: a persisted pending RSVP decision resumes
    // only when the current turn carries its own RSVP signal (a
    // current-message decision, an event reference, or a candidate guest
    // id). Gratitude and other no-new-request turns never replay a stale
    // pending action into a write, and never re-arm a resolved selection.
    const hasCurrentRsvpSignal = decisionSource === 'current_message' ||
      args.extraction.rsvpEventReference != null ||
      (args.extraction.rsvpCandidateGuestId ?? null) !== null;
    const action = validatedRsvpAction
      ?? (!isReadOnlyStateQuery && hasCurrentRsvpSignal && pendingState.status === 'awaiting_event_selection' ? pendingState.pending_action : null);
    const plusOneResponse = extractedPlusOneResponse === 'yes' || extractedPlusOneResponse === 'no'
      ? extractedPlusOneResponse
      : !isReadOnlyStateQuery && hasCurrentRsvpSignal && pendingState.status === 'awaiting_event_selection'
        ? pendingState.pending_plus_one_response ?? null
        : null;
    let result: AgentGuestRsvpResult | null = null;
    let operationalNote: string;
    let nextRsvpState = pendingState;

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
      const handoffPhoneNumber = this.resolveEscalationPhone(args.inbound);
      const dedupeKey = `rsvp_handoff:${args.workingPlan.conversation_id ?? args.workingPlan.plan_id}`;
      const isDeduped = args.workingPlan.assumptions.includes(dedupeKey);
      let handoffGatewayResult: AgentGatewayResult | null = null;
      let handoffStatus: 'registered' | 'deduped' | 'failed' = isDeduped ? 'deduped' : 'failed';
      if (!isDeduped) {
        const gatewayForHandoff = this.dependencies.agentConversationGateway ??
          new NoopAgentConversationGateway('not_configured');
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
            handoffGatewayResult = await this.requestHumanTakeoverWithTrace(
              gatewayForHandoff,
              handoffPhoneNumber,
              args.toolUsage,
            );
          }
          if (handoffGatewayResult.status === 'success') {
            handoffStatus = 'registered';
          }
        }
      }
      const handoffOperationalNote = JSON.stringify({
        outcome: 'rsvp_multi_person_handoff',
        status: handoffStatus,
        scope: handoffParty.scope,
        mentioned_names: handoffParty.mentioned_names ?? [],
        companion_count: handoffParty.companion_count ?? null,
        dedupe_key: dedupeKey,
        phone_present: handoffPhoneNumber !== null,
        gateway_result: handoffGatewayResult
          ? this.redactAgentGatewayResult(handoffGatewayResult)
          : null,
        next_action: handoffStatus === 'registered' ? 'await_human_follow_up' : 'retry_or_human_review',
        // C1 multi-person honesty: `status` tracks the human-support
        // request, never attendance. No attendance was registered by this
        // turn and the API supports a single companion, so the reply
        // acknowledges the request, states the single-companion scope, and
        // leaves the follow-up to the team without claiming registration.
        attendance_registered: false,
        companion_scope: 'single_companion_only',
        support_follow_up: handoffStatus === 'registered' ? 'requested' : 'pending',
      });
      const planToSaveHandoff = mergePlan(args.workingPlan, {
        current_node: currentNode,
        intent: 'responder_invitacion',
        intent_confidence: args.extraction.intentConfidence,
        rsvp_state: pendingState,
        ...(handoffStatus === 'registered' && handoffPhoneNumber ? {
          assumptions: [...args.workingPlan.assumptions, dedupeKey],
        } : handoffStatus === 'failed' ? {
          human_escalation: {
            status: 'none' as const,
            requested_at: null,
            phone_number: handoffPhoneNumber,
            last_error: handoffGatewayResult
              ? handoffGatewayResult.status === 'failed'
                ? handoffGatewayResult.error
                : handoffGatewayResult.status === 'skipped'
                  ? handoffGatewayResult.message
                  : null
              : null,
          },
        } : {}),
      });
      const promptStartedAt = Date.now();
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
      args.timingMs.prompt_bundle_load += Date.now() - promptStartedAt;
      const composeStartedAt = Date.now();
      const reply = await composeModelReply(this.dependencies.runtime, {
        currentNode,
        previousNode: args.previousNode,
        userMessage: args.inbound.text,
        messageContext: args.messageContext,
        plan: planToSaveHandoff,
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        providerResults: [],
        turnDecision: this.rsvpTurnDecision(`handoff_multi_person_${handoffStatus}`),
        errorMessage: handoffOperationalNote,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        rsvpPhoneEvidence: null,
        replyBundle: bundle,
      });
      args.timingMs.compose_reply += Date.now() - composeStartedAt;
      args.tokenUsage.reply = reply.tokenUsage ?? null;
      args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
        args.tokenUsage.reply,
      );
      const saveStartedAt = Date.now();
      await this.dependencies.planStore.save({ plan: planToSaveHandoff, reason: currentNode });
      args.timingMs.save_plan += Date.now() - saveStartedAt;
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      return {
        plan: planToSaveHandoff,
        outbound: this.renderOutbound(
          reply,
          [],
          args.inbound.channel,
          planToSaveHandoff.conversation_id,
          planToSaveHandoff,
          args.toolUsage,
        ),
        trace: this.buildTrace({
          plan: planToSaveHandoff,
          previousNode: args.previousNode,
          currentNode,
          nodePath: args.previousNode === currentNode ? [currentNode] : [args.previousNode, currentNode],
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
          turnDecision: this.rsvpTurnDecision(`handoff_multi_person_${handoffStatus}`),
          operationalNote: handoffOperationalNote,
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
      operationalNote = JSON.stringify({
        outcome: 'phone_unavailable',
        invitation_lookup_performed: false,
        next_action: 'human_review',
      });
      nextRsvpState = this.emptyRsvpState();
    } else if (!invitations) {
      operationalNote = JSON.stringify({
        outcome: 'invitation_lookup_failed',
        invitation_lookup_performed: true,
        next_action: 'retry_or_human_review',
      });
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
        let escalationStatus: 'requested' | 'unavailable' = 'unavailable';
        if (escalationPhone) {
          const escalationResult = await this.requestHumanTakeoverWithTrace(
            args.gateway,
            escalationPhone,
            args.toolUsage,
          );
          escalationStatus = escalationResult.status === 'success' ? 'requested' : 'unavailable';
        }
        operationalNote = JSON.stringify({
          outcome: 'invitation_lookup_mismatch',
          requested_action: action,
          invitation_lookup_count: 0,
          reminder_context: currentReminder?.body?.trim().slice(0, 200) ?? null,
          campaign_event: groundedCampaignEvent,
          human_handoff: escalationStatus,
          next_action: 'human_review',
        });
        nextRsvpState = this.emptyRsvpState();
        if (escalationStatus === 'requested' && escalationPhone) {
          args.workingPlan = mergePlan(args.workingPlan, {
            human_escalation: {
              status: 'requested',
              requested_at: new Date().toISOString(),
              phone_number: escalationPhone,
              last_error: null,
            },
          });
        }
       } else {
         operationalNote = JSON.stringify({
           outcome: groundedCampaignEvent || hasCampaignInvitationContext
             ? 'campaign_invitation_without_lookup_record'
             : 'no_invitation_record',
           invitation_lookup_count: 0,
           campaign_event: groundedCampaignEvent,
           campaign_context: hasCampaignInvitationContext,
           next_action: 'human_review_or_retry',
         });
       }
       nextRsvpState = this.emptyRsvpState();
    } else if (!selectedInvitation && invitations.some((invitation) => invitation.guestId === null)) {
      operationalNote = JSON.stringify({
        outcome: 'invitation_record_unavailable',
        invitations: invitations.map((invitation) => ({
          event_name: invitation.eventName,
          event_date: invitation.eventDate,
          invitation_record: 'unavailable',
          invitation_state: invitation.state,
        })),
        next_action: invitations.length > 1 ? 'select_one_event' : 'human_review',
      });
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
      operationalNote = JSON.stringify({
        outcome: 'event_selection_required',
        candidates: invitations.map((invitation) => ({
          event_id: invitation.eventId,
          event_name: invitation.eventName,
          event_date: invitation.eventDate,
          invitation_state: invitation.state,
        })),
        selection_attempts: attempts,
        next_action: 'select_one_event',
      });
    } else if (selectedInvitation.guestId === null) {
      operationalNote = JSON.stringify({
        outcome: 'invitation_state_unavailable',
        selected_event: {
          event_name: selectedInvitation.eventName,
          event_date: selectedInvitation.eventDate,
          invitation_record: 'unavailable',
        },
        requested_action: action,
        next_action: 'human_review',
      });
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
        // Packet C gratitude guard: the established read-only behavior is
        // kept, except a stale plan_state replay or a turn with no current
        // RSVP intent (gratitude/no-new-request) never stages an offer
        // merely because current attendance is declining. The reply still
        // states the resolved current state from evidence.
        const hasCurrentRsvpIntent = args.extraction.actionIntent === 'responder_invitacion';
        const shouldOfferDecliningChange = selectedInvitation.state === 'declining' && hasCurrentRsvpIntent;
        const staleReplayWithoutIntent = decisionSource !== 'current_message' && !hasCurrentRsvpIntent;
        const offerAction = (!isReadOnlyStateQuery || shouldOfferDecliningChange) &&
          !staleReplayWithoutIntent;
        operationalNote = this.rsvpCurrentStateNote(selectedInvitation, offerAction);
        nextRsvpState = offerAction && (selectedInvitation.state === 'pending' || selectedInvitation.state === 'declining')
          ? this.awaitingRsvpActionState(selectedInvitation, 'attending')
          : this.emptyRsvpState();
      } else if (!hasRequestedMutation && action && currentAction === action) {
        operationalNote = this.rsvpCurrentStateNote(selectedInvitation, false);
        nextRsvpState = this.emptyRsvpState();
      } else if (
        !args.gateway.guestRsvp ||
        !this.capabilityManifest['rsvp.response.write'].available
      ) {
        operationalNote = JSON.stringify({
          outcome: 'response_write_unavailable',
          requested_action: actionToSubmit,
          plus_one_response: plusOneResponse,
          next_action: 'human_review',
        });
        nextRsvpState = this.emptyRsvpState();
      } else {
        // Packet B: the single verified RSVP executor. One tool operation:
        // bound intent, at most one write, one fresh authorized read-back
        // through the existing gateway (bypassing the current-turn profile
        // cache), and a persisted requested-versus-observed receipt before
        // the reply is composed. Observed phone evidence is updated only
        // from the verified fresh read, never from the requested action.
        const executionStartedAt = Date.now();
        const durableStore = this.dependencies.rsvpEffectStore ?? null;
        const effectStore: RsvpEffectStore = durableStore ?? new InMemoryRsvpEffectStore();
        const verification = await executeRsvpEffectVerified({
          operation: {
            conversationKey: conversationPartitionKey(args.inbound.channel, args.inbound.externalUserId),
            messageId: args.inbound.messageId,
            guestId: selectedInvitation.guestId,
            eventId: selectedInvitation.eventId,
            action: actionToSubmit,
            plusOneResponse,
            phoneExtension,
            phoneNumber,
          },
          gateway: args.gateway,
          store: effectStore,
          dedupCoverage: args.inbound.nativeMessageId === true && durableStore !== null
            ? 'native'
            : 'unavailable',
          validateLease: args.inbound.validateTurnLease ?? undefined,
          leaseOwnerId: args.inbound.turnLease?.ownerId ?? undefined,
        });
        args.timingMs.rsvp_execution += Date.now() - executionStartedAt;
        // Replay integrity: the trace reports only calls performed in THIS
        // invocation. A replayed historical receipt carries historical
        // write/read counts but performed nothing now; logging them would
        // invent a fictional read/write trace.
        const performedWriteThisInvocation = !verification.replayed && verification.writeCount > 0;
        const performedReadThisInvocation = !verification.replayed &&
          verification.freshRead && verification.readCount > 0;
        if (performedWriteThisInvocation) {
          args.toolUsage.called.push('guest_rsvp');
          args.toolUsage.inputs.push({
            tool: 'guest_rsvp',
            input: JSON.stringify({
              action: actionToSubmit,
              plus_one_response: plusOneResponse,
              guest_id: selectedInvitation.guestId,
              event_id: selectedInvitation.eventId,
              trusted_phone_present: true,
              previous_state: selectedInvitation.state,
            }),
          });
        }
        result = verification.gatewayStatus
          ? this.verificationGatewayResult(verification, actionToSubmit, plusOneResponse, selectedInvitation)
          : null;
        if (performedReadThisInvocation) {
          args.toolUsage.called.push('get_guest_event_detail');
          args.toolUsage.inputs.push({
            tool: 'get_guest_event_detail',
            input: JSON.stringify({
              event_id: selectedInvitation.eventId,
              trusted_phone_present: true,
              verification_read: true,
            }),
          });
          args.toolUsage.outputs.push({
            tool: 'get_guest_event_detail',
            output: JSON.stringify({
              status: verification.readStatus,
              attendance_confirmed: verification.attendanceConfirmed,
              fresh_read: verification.freshRead,
            }),
          });
        }
        args.toolUsage.outputs.push({
          tool: 'guest_rsvp',
          output: JSON.stringify(this.summarizeRsvpVerification(verification)),
        });
        replyPhoneEvidence = phoneEvidence
          ? this.applyVerifiedRsvpReadToPhoneEvidence(
              phoneEvidence,
              verification,
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
          verification,
        );
        nextRsvpState = result?.status === 'multiple_pending'
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
      operationalNote = JSON.stringify({
        base_outcome: operationalNote,
        evidence_coverage: 'partial',
        next_action: 'use_only_visible_events',
      });
    }

    const planToSave = mergePlan(args.workingPlan, {
      current_node: currentNode,
      intent: 'responder_invitacion',
      intent_confidence: args.extraction.intentConfidence,
      rsvp_state: nextRsvpState,
    });
    const replyExtraction = this.reconcileResolvedRsvpSelectionAmbiguity({
      extraction: args.extraction,
      pendingState,
      selectedInvitation,
    });
    const promptStartedAt = Date.now();
    const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
    args.timingMs.prompt_bundle_load += Date.now() - promptStartedAt;
    const composeStartedAt = Date.now();
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode,
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planToSave,
      extraction: replyExtraction,
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
        ? this.projectRsvpPhoneEvidenceForReply(
            replyPhoneEvidence,
            selectedInvitation,
            args.extraction.rsvpEventReference ?? null,
          )
        : null,
      replyBundle: bundle,
    });
    args.timingMs.compose_reply += Date.now() - composeStartedAt;
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    const saveStartedAt = Date.now();
    // Packet B: the RSVP effect-path plan write carries the current turn
    // lease condition when a lease is present and the store supports it.
    const turnLeaseOwner = args.inbound.turnLease?.ownerId ?? null;
    if (turnLeaseOwner && this.dependencies.planStore.saveFenced) {
      await this.dependencies.planStore.saveFenced({
        plan: planToSave,
        reason: currentNode,
        leaseOwnerId: turnLeaseOwner,
        nowMs: Date.now(),
      });
    } else {
      await this.dependencies.planStore.save({
        plan: planToSave,
        reason: currentNode,
      });
    }
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
      // C1 plus-one honesty: when the companion response was not saved, the
      // sanitized backend reason travels with the summary so the reply can
      // state that nothing was saved, give the reason, and offer human
      // support instead of claiming a false registration. Single-token
      // codes (internal identifiers) stay withheld behind reason_present;
      // only prose reasons reach the model.
      const rawPlusOneReason = typeof result.plusOne?.reason === 'string'
        ? result.plusOne.reason.trim()
        : '';
      const plusOneReason = rawPlusOneReason.length > 0 && /\s/u.test(rawPlusOneReason)
        ? rawPlusOneReason.slice(0, 200)
        : null;
      return {
        status: result.status,
        action: result.action,
        guest_id: result.guestId,
        event_id: result.eventId ?? null,
        event_name: result.eventName,
        event_date: result.eventDate,
        plus_one: result.plusOne
          ? {
              saved: result.plusOne.saved,
              response: result.plusOne.response,
              reason_present: Boolean(result.plusOne.reason),
              ...(plusOneReason !== null ? { reason: plusOneReason } : {}),
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
        event_id: result.eventId ?? null,
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
      // I1 enrichment is unique-compatible-match. An explicit reference
      // resolves against the summaries and enriches only its unique match;
      // zero or multiple matches enrich nothing (never the first hit, never
      // a sole unrelated event). Without a reference a single summary may
      // enrich; several stay bare for disambiguation. Bounded: at most one
      // detail read, never every event.
      const normalizedReference = this.normalizeSelectionText(eventReference ?? '');
      const referenceMatches = normalizedReference.length > 0
        ? associatedSummaries.filter((event) => {
            return this.normalizedTextContainsAlias(this.normalizeSelectionText(event.name), normalizedReference) ||
              this.normalizedTextContainsAlias(normalizedReference, this.normalizeSelectionText(event.name)) ||
              this.normalizeSelectionText(event.slug) === normalizedReference;
          })
        : [];
      const selectedAssociatedEvent = normalizedReference.length > 0
        ? referenceMatches.length === 1 ? referenceMatches[0] ?? null : null
        : associatedSummaries.length === 1
          ? associatedSummaries[0] ?? null
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
        // I2: same event ID is proven identity, but attendance still
        // belongs to a guest. A different non-null guest is a separate
        // invitation for the same event: keep both, never conflate.
        // When sameRsvpGuest proves identity, authority stays with the
        // guest record: no accessMethod flip, and a host-set decided state
        // (willAttend-backed attending/declining) stands over stale
        // enriched detail. An undecided host record (pending/unknown) is a
        // display gap the fresh enriched values fill. Post-mutation display
        // still flows through the verified fresh-read update downstream.
        if (authoritativeEvent && this.sameRsvpGuest(authoritativeEvent, associatedEvent)) {
          const authoritativeDecided =
            authoritativeEvent.state === 'attending' ||
            authoritativeEvent.state === 'declining';
          reconciled[duplicateIndex] = {
            ...associatedEvent,
            accessMethod: authoritativeEvent.accessMethod,
            state: authoritativeDecided ? authoritativeEvent.state : associatedEvent.state,
            guestId: associatedEvent.guestId ?? authoritativeEvent.guestId,
            eventName: associatedEvent.eventName ?? authoritativeEvent.eventName,
            eventDate: associatedEvent.eventDate ?? authoritativeEvent.eventDate,
          };
        } else {
          reconciled.push(associatedEvent);
        }
      }
    });
    return this.sortRsvpInvitationsDeterministically(reconciled);
  }

  /**
   * I2 guest-identity guard for attendance. Equal non-null guest IDs share
   * identity; an unknown guest does not disprove identity once the event ID
   * already matched. Different known guests never merge.
   */
  private sameRsvpGuest(
    left: RsvpInvitation,
    right: RsvpInvitation,
  ): boolean {
    if (left.guestId !== null && right.guestId !== null) {
      return left.guestId === right.guestId;
    }
    return true;
  }

  /**
   * I1/I2 reply projection. A resolved selection projects directly: the
   * selection already resolved its own same-identity record upstream, so no
   * event-ID re-lookup substitutes another record's attendance. An explicit
   * event reference left unresolved never presents another event as the
   * requested one: the single unrelated invitation stays a selection
   * candidate instead of a resolved answer.
   */
  private projectRsvpPhoneEvidenceForReply(
    evidence: RsvpPhoneEvidence,
    selectedInvitation: RsvpInvitation | null,
    explicitEventReference?: string | null,
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
      // I2: the verified fresh read updates the evidence list in place, so
      // the selected record resolves within the current evidence by full
      // guest+event identity: the verified state shows, and a different
      // guest's same-event record can never substitute for it via an
      // event-ID-only lookup. Falls back to the selected record when the
      // evidence carries no such entry.
      const target = sortedInvitations.find((invitation) =>
        this.sameRsvpEvent(invitation, selectedInvitation) &&
        this.sameRsvpGuest(invitation, selectedInvitation)) ??
        selectedInvitation;
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
      // I1: an unresolved explicit reference must not resolve into this
      // unrelated single invitation. Present it as the selection candidate
      // so the reply asks for the distinguishing fact instead of
      // answering with another event's details.
      if (!selectedInvitation && this.normalizeSelectionText(explicitEventReference ?? '').length > 0) {
        const selection: RsvpPhoneReplyEvidence = {
          state: 'needs_event_selection',
          coverage: evidence.coverage,
          resolution: evidence.resolution,
          candidates: [this.toRsvpReplyEvent(only)],
        };
        logAuthObservabilityEvent('info', 'rsvp_projection_state', {
          state: selection.state,
          coverage: selection.coverage,
          resolution: selection.resolution,
          invitation_count: 1,
          candidate_event_ids: [only.eventId],
        });
        return selection;
      }
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

  /**
   * Packet B + replay integrity: observed phone evidence is updated ONLY
   * from a verified fresh read acquired in THIS invocation (same guest AND
   * same event id). A write echo, the requested action, an event-name match
   * alone, or a replayed historical receipt never rewrites observed state.
   * Unconfirmed outcomes leave evidence untouched.
   */
  private applyVerifiedRsvpReadToPhoneEvidence(
    evidence: RsvpPhoneEvidence,
    verification: RsvpVerifiedEffect,
  ): RsvpPhoneEvidence {
    const observed = verification.observed;
    if (
      verification.status !== 'verified' ||
      verification.replayed ||
      !verification.freshRead ||
      !observed || observed.source !== 'fresh_read' ||
      observed.guestId === null || observed.eventId === null ||
      observed.attendance === null
    ) {
      return evidence;
    }
    const verifiedState: RsvpInvitationState = observed.attendance;
    const verifiedGuestId: number = observed.guestId;
    const verifiedEventId: number = observed.eventId;
    return {
      ...evidence,
      invitations: evidence.invitations.map((invitation) =>
        invitation.guestId === verifiedGuestId &&
        invitation.eventId !== null && invitation.eventId === verifiedEventId
          ? { ...invitation, state: verifiedState }
          : invitation),
    };
  }

  /**
   * Packet B: reconstructs the gateway-shaped result the downstream reason
   * mapping expects from the verified outcome. The status vocabulary is
   * unchanged; identity fields carry observed (not requested) values.
   */
  private verificationGatewayResult(
    verification: RsvpVerifiedEffect,
    action: 'attending' | 'declining' | null,
    plusOneResponse: 'yes' | 'no' | null,
    selectedInvitation: RsvpInvitation,
  ): AgentGuestRsvpResult {
    const status = verification.gatewayStatus;
    if (status === 'multiple_pending') {
      return { status: 'multiple_pending', candidates: [] };
    }
    if (status === 'already_responded') {
      return {
        status: 'already_responded',
        currentAction: verification.observed?.attendance ?? null,
        requestedAction: action,
        guestId: verification.observed?.guestId ?? selectedInvitation.guestId,
        eventId: verification.observed?.eventId ?? selectedInvitation.eventId,
        eventName: selectedInvitation.eventName,
        eventDate: selectedInvitation.eventDate,
      };
    }
    if (status === 'responded') {
      // Gateway vocabulary is preserved for the downstream reason mapping,
      // but identity comes from observed-or-requested values (never an
      // untrusted echo). Non-verified echoes keep the companion echo for the
      // note; the verification block carries the unconfirmed facts.
      const observedAttendance = verification.observed?.attendance ?? null;
      const resolvedAction = observedAttendance ?? action;
      return {
        status: 'responded',
        action: resolvedAction,
        willAttend: observedAttendance === 'attending'
          ? true
          : observedAttendance === 'declining'
            ? false
            : action === 'attending'
              ? true
              : action === 'declining'
                ? false
                : null,
        guestId: verification.observed?.guestId ?? selectedInvitation.guestId,
        eventId: verification.observed?.eventId ?? selectedInvitation.eventId,
        eventName: selectedInvitation.eventName,
        eventDate: selectedInvitation.eventDate,
        plusOne: verification.plusOneEcho
          ? {
              saved: verification.plusOneEcho.saved,
              response: verification.plusOneEcho.response ?? plusOneResponse,
              reason: verification.plusOneEcho.reason ??
                (verification.plusOneEcho.saved ? null : 'verification_unavailable'),
            }
          : plusOneResponse
            ? { saved: false, response: plusOneResponse, reason: 'verification_unavailable' }
            : null,
      };
    }
    if (status === 'no_pending') {
      return { status: 'no_pending' };
    }
    if (status === 'phone_mismatch') {
      return { status: 'phone_mismatch' };
    }
    if (status === 'failed') {
      return {
        status: 'failed',
        error: verification.failureReason ?? 'rsvp effect unconfirmed',
        retryable: false,
      };
    }
    return {
      status: 'failed',
      error: verification.failureReason ?? 'rsvp effect unconfirmed',
      retryable: false,
    };
  }

  /**
   * Packet B: echo reasons follow the same disclosure rule as the backend
   * summary — single-token internal codes stay withheld, only prose reasons
   * reach the model.
   */
  private sanitizeRsvpEchoReason(reason: string | null): string | null {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    return trimmed.length > 0 && /\s/u.test(trimmed) ? trimmed.slice(0, 200) : null;
  }

  private summarizeRsvpVerification(verification: RsvpVerifiedEffect): Record<string, unknown> {    return {
      verification_status: verification.status,
      gateway_status: verification.gatewayStatus,
      requested: {
        guest_id: verification.requested.guestId,
        event_id: verification.requested.eventId,
        action: verification.requested.action,
        plus_one_response: verification.requested.plusOneResponse,
      },
      observed: verification.observed
        ? {
            guest_id: verification.observed.guestId,
            event_id: verification.observed.eventId,
            attendance: verification.observed.attendance,
            source: verification.observed.source,
          }
        : null,
      attendance_confirmed: verification.attendanceConfirmed,
      effect_applied: verification.effectApplied,
      observed_without_attribution: verification.observedWithoutAttribution,
      companion: {
        confirmed: verification.companionConfirmed,
        verification: verification.companionVerification,
        // Echo only, sanitized like the backend summary: single-token
        // internal codes stay withheld behind reason_present semantics;
        // only prose reasons reach the model.
        echo: verification.plusOneEcho
          ? {
              saved: verification.plusOneEcho.saved,
              response: verification.plusOneEcho.response,
              reason: this.sanitizeRsvpEchoReason(verification.plusOneEcho.reason),
            }
          : null,
      },
      mismatch: verification.mismatch,
      read_status: verification.readStatus,
      write_count: verification.writeCount,
      read_count: verification.readCount,
      persisted_before_reply: verification.persistedBeforeReply,
      replayed: verification.replayed,
      fresh_read: verification.freshRead,
      dedup_coverage: verification.dedupCoverage,
      persistence: verification.persistence,
      failure_reason: verification.failureReason,
    };
  }

  /**
   * I2 identity binding: established event IDs decide. Both IDs present and
   * equal means the same event; a missing ID keeps records separate (a
   * shared name never proves identity). Authoritative linkage beyond these
   * records is the only exception and lives outside this comparator.
   */
  private sameRsvpEvent(
    left: RsvpInvitation,
    right: RsvpInvitation,
  ): boolean {
    if (left.eventId === null || right.eventId === null) {
      return false;
    }
    return left.eventId === right.eventId;
  }

  /**
   * I3 host-policy attendance: a boolean willAttend is authoritative
   * attendance and takes precedence everywhere. hasResponded is provenance
   * metadata only (a host policy change can set willAttend without a guest
   * response). Null willAttend invents nothing: pending only when the guest
   * has explicitly not responded yet, otherwise unknown.
   */
  private rsvpInvitationState(
    hasResponded: boolean | null,
    willAttend: boolean | null,
  ): RsvpInvitationState {
    if (willAttend === true) {
      return 'attending';
    }
    if (willAttend === false) {
      return 'declining';
    }
    if (hasResponded === false) {
      return 'pending';
    }
    return 'unknown';
  }

  /**
   * I1 requested-event precedence. A current explicit structured event
   * reference resolves FIRST against authorized candidates: a unique
   * compatible candidate wins; multiple or zero matches never fall back to
   * a stored pending or a sole unrelated event. A shared-name tie with a
   * single guest-bound attendance record (an invitation bound to a guest
   * carrying a willAttend-backed attending/declining state) resolves to that
   * record; zero or several stay unresolved. A current extracted guest
   * ID must be a member of the candidates and compatible with the explicit
   * reference; disagreement is unresolved (null), never pick-either.
   * Stored pending identity is usable only when the request switches no
   * target. No keyword routing: matching reuses grounded alias comparison.
   */
  private selectRsvpInvitation(args: {
    invitations: RsvpInvitation[];
    pendingState: PlanSnapshot['rsvp_state'];
    extractedGuestId: number | null | undefined;
    eventReference: string | null | undefined;
  }): RsvpInvitation | null {
    const reference = this.normalizeSelectionText(args.eventReference ?? '');
    const hasExplicitReference = reference.length > 0;
    const extractedGuestId = args.extractedGuestId ?? null;
    if (hasExplicitReference) {
      let matches = args.invitations.filter((invitation) => {
        const name = this.normalizeSelectionText(invitation.eventName ?? '');
        return this.normalizedTextContainsAlias(name, reference)
          || this.normalizedTextContainsAlias(reference, name);
      });
      if (extractedGuestId !== null) {
        if (!args.invitations.some((invitation) => invitation.guestId === extractedGuestId)) {
          return null;
        }
        matches = matches.filter((invitation) => invitation.guestId === extractedGuestId);
      }
      if (matches.length === 1) {
        return matches[0] ?? null;
      }
      // Explicit-name tie-break: a shared name never proves identity, but a
      // single guest-bound attendance record (an invitation bound to a guest
      // carrying a willAttend-backed attending/declining state) is the
      // requested event's consistent display. Genuine ambiguity (zero or
      // several such records) stays unresolved.
      if (matches.length > 1) {
        const authoritative = matches.filter((invitation) =>
          invitation.guestId !== null &&
          (invitation.state === 'attending' || invitation.state === 'declining'));
        if (authoritative.length === 1) {
          return authoritative[0] ?? null;
        }
      }
      return null;
    }
    if (extractedGuestId !== null) {
      return args.invitations.find((invitation) => invitation.guestId === extractedGuestId) ?? null;
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

  /**
   * Packet C + Tito selection-ambiguity reconciliation. When the phone
   * lookup resolved the missing event behind a stale or fresh ambiguity,
   * the event-selection question is settled for reply composition. The
   * specific missing event reconciles against fresh evidence regardless of
   * which prior node stored it: a resolved single selection with guest
   * identity clears a null or type_missing (celebration identity) question.
   * Any other typed ambiguity concern (document/proof keys, candidate
   * operations) belongs to a different missing entity and is left intact.
   * Typed state only; no phrase detection.
   */
  private reconcileResolvedRsvpSelectionAmbiguity(args: {
    extraction: ExtractionResult;
    pendingState: PlanSnapshot['rsvp_state'];
    selectedInvitation: RsvpInvitation | null;
  }): ExtractionResult {
    const { extraction, selectedInvitation } = args;
    void args.pendingState;
    if (!selectedInvitation || selectedInvitation.guestId === null) return extraction;
    const ambiguity = extraction.ambiguity;
    if (!ambiguity || ambiguity.status !== 'ambiguous') return extraction;
    if ((ambiguity.candidateOperations ?? []).length > 0) return extraction;
    const questionKey = ambiguity.questionKey ?? null;
    if (questionKey !== null && questionKey !== 'type_missing') return extraction;
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

  private rsvpCurrentStateNote(
    invitation: RsvpInvitation,
    offerAction: boolean,
  ): string {
    return JSON.stringify({
      outcome: 'current_state',
      event: {
        event_id: invitation.eventId,
        event_name: invitation.eventName,
        event_date: invitation.eventDate,
      },
      invitation_record: invitation.guestId === null ? 'unavailable' : 'available',
      invitation_state: invitation.state,
      offer_action: offerAction,
      mutation_performed: false,
      next_action: offerAction ? 'await_user_decision' : 'none',
    });
  }

  private rsvpOperationalNote(
    result: AgentGuestRsvpResult | null,
    action: 'attending' | 'declining' | null,
    plusOneResponse: 'yes' | 'no' | null,
    selectedCandidate: PlanSnapshot['rsvp_state']['candidates'][number] | null,
    groundedCampaignEvent: string | null,
    verification?: RsvpVerifiedEffect,
  ): string {
    return JSON.stringify({
      outcome: 'mutation_result',
      requested_action: action,
      requested_plus_one_response: plusOneResponse,
      selected_candidate: selectedCandidate,
      grounded_campaign_event: groundedCampaignEvent,
      backend_result: result ? this.summarizeRsvpResult(result) : null,
      // Packet B verification receipt: typed facts only. Only a verified
      // attendance authorizes a confirmation; companion persistence is
      // unverifiable through the existing backend read and never claimed.
      verification: verification ? this.summarizeRsvpVerification(verification) : null,
      next_action: verification
        ? verification.status === 'verified'
          ? verification.effectApplied
            ? 'communicate_confirmed_state'
            : 'communicate_existing_state'
          : result?.status === 'multiple_pending'
            ? 'select_one_event'
            : 'human_review_or_retry'
        : result?.status === 'responded'
          ? 'communicate_confirmed_state'
          : result?.status === 'multiple_pending'
            ? 'select_one_event'
            : result?.status === 'already_responded'
              ? 'communicate_existing_state'
              : 'human_review_or_retry',
    });
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
    options?: { forImageGate?: boolean },
  ): boolean {
    // A close-flow contact turn belongs to close handling even when the
    // extractor also labels it a support detail: providing requested contact
    // data is not a support act, and the support path would drop the update.
    if (
      plan.current_node === 'crear_lead_cerrar' &&
      extraction.informationRequests.length === 0 &&
      (extraction.contactName !== null ||
        extraction.contactEmail !== null ||
        extraction.contactPhone !== null ||
        extraction.closeAction !== null)
    ) {
      return false;
    }
    // R2 image gate: a merely completed thread is not outstanding work. An
    // image supplementing an already answered question persists silently
    // unless new requests, pending requests or a credential challenge need
    // it; text-turn routing still replays completed threads.
    if (options?.forImageGate !== true &&
      (extraction.actionIntent === null &&
        (plan.information_state.last_completed_request?.kind === 'purchase' ||
          plan.information_state.last_completed_request?.kind === 'associated_event' ||
          plan.information_state.last_completed_request?.kind === 'faq'))
    ) {
      return true;
    }
    return (
      (extraction.normalizationIssues?.length ?? 0) > 0 ||
      // A text question the extractor tied to a prior image is information
      // work: it belongs on the resolver bundle with image evidence instead
      // of falling through to generic event-context routing. Typed linkage
      // only; unrelated turns (status none) are unaffected.
      ((extraction.imageReference?.status === 'prior_single' ||
        extraction.imageReference?.status === 'prior_uncertain') &&
        (plan.image_attachments?.length ?? 0) > 0) ||
      (Boolean(extraction.supportAct) && extraction.actionIntent === null &&
        !extraction.vendorCategory && extraction.vendorCategories.length === 0 &&
        !extraction.providerQueryIntents?.length && !extraction.providerPlanOperations?.length) ||
      extraction.informationRequests.length > 0 ||
      plan.information_state.pending_requests.length > 0
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
    // Image turns stay on the resolver bundle with their own evidence; a
    // persisted image ref or a current image reference never detours to the
    // generic clarification bundle.
    if ((plan.image_attachments?.length ?? 0) > 0) {
      return false;
    }
    if (extraction.imageReference != null && extraction.imageReference.status !== 'none') {
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
      this.isAbsentPhoneConfirmation(extraction.phoneConfirmation) &&
      (extraction.humanHelpIntent == null || extraction.humanHelpIntent === 'none') &&
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
    const hasCompetingProviderWork = args.extraction.informationRequests.length > 0 ||
      (args.extraction.providerQueryIntents?.length ?? 0) > 0 ||
      args.extraction.providerExplanationRequest != null ||
      args.extraction.providerDetailRequest != null ||
      args.extraction.closeAction != null ||
      args.extraction.pauseRequested;
    const providerClarification = (
      args.extraction.ambiguity?.status === 'ambiguous' ||
      this.isBareProviderConfirmationTurn(args.extraction)
    ) && !hasCompetingProviderWork &&
      this.hasUnresolvedProviderShortlist(args.plan, args.extraction, args.inbound.text);
    const clarificationExtraction = providerClarification
      ? this.guardAmbiguousProviderConfirmation(args.plan, args.extraction, args.inbound.text).extraction
      : args.extraction;
    const plan = providerClarification
      ? mergePlan(args.plan, { current_node: 'aclarar_pedir_faltante' })
      : args.plan.current_node === 'contacto_inicial' && !continuity.welcomeAllowed
        ? mergePlan(args.plan, { current_node: 'deteccion_intencion' })
        : args.plan;
    const turnDecision = this.contextualClarificationTurnDecision(
      providerClarification ? 'provider_selection_clarification' : 'contextual_clarification',
    );
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('aclarar_pedir_faltante');
    // R2: clarification replies share the resolved attachment projection and
    // the continuity reference. An image-seeking clarification defers for
    // later evidence, so the unresolved user question is preserved for the
    // later image; other clarifications leave pending state untouched.
    const ownerProjection = this.resolveOwnerImageProjectionForReply({
      plan,
      extraction: clarificationExtraction,
    });
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode: 'aclarar_pedir_faltante',
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan,
      extraction: clarificationExtraction,
      missingFields: plan.missing_fields,
      searchReady: false,
      providerResults: [],
      turnDecision,
      errorMessage: null,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      continuity: this.resolveContinuityProjection(plan, args.messageContext),
      pendingQuestionRef: plan.owner_pending_question ?? null,
      imageEvidence: this.imageEvidenceForProjection({ projection: ownerProjection }),
      imageUrlAttachments: ownerProjection.urls,
      imageFileAttachments: ownerProjection.files,
    });
    const planToSave = args.extraction.ambiguity?.questionKey === 'status_or_proof_review'
      ? this.stashOwnerPendingQuestion(plan, args.inbound.text, { overwrite: true })
      : plan;
    // S2: render first for the verified outbound; a clarification never
    // clears the pending question and the public handleTurn wrapper
    // finalizes the latest-response record centrally.
    const outbound = this.renderOutbound(
      reply, [], args.inbound.channel, planToSave.conversation_id, planToSave, args.toolUsage,
    );
    await this.dependencies.planStore.save({ plan: planToSave, reason: turnDecision.persistReason ?? 'contextual_clarification' });
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    return {
      plan: planToSave,
      outbound,
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode: plan.current_node,
        nodePath: args.previousNode === plan.current_node
          ? [plan.current_node]
          : [args.previousNode, plan.current_node],
        extraction: args.extraction,
        missingFields: plan.missing_fields,
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: turnDecision.persistReason,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision,
        operationalNote: null,
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
    // D1: a bare confirmation over an unresolved multi-option shortlist is a
    // domain selection ambiguity, not a capability question. Yield to the
    // shortlist guard so the bounded provider/action question is asked.
    if (
      !args.extraction.requestedOperation &&
      this.hasUnresolvedProviderShortlist(args.plan, args.extraction, args.inbound.text)
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
    // An unavailable document operation alongside a purchase request is not
    // re-seeded as capability ambiguity: the available purchase read serves
    // the fact through the information flow (with a capability safe read
    // below), so the decision stands and never preempts that flow.
    const effectiveDecision = decision;
    if (effectiveDecision.status === 'not_applicable' || effectiveDecision.status === 'supported') {
      return null;
    }

    // The extractor can report a capability operation alongside a more
    // specific typed domain turn. Let the domain flow reconcile its own
    // authoritative state before deciding whether a write is needed. A
    // capability-only request has no such evidence and remains intercepted.
    const hasRsvpEvidence = this.hasMeaningfulRsvpEvidence(args.plan, args.extraction);
    const hasSecondaryPlanningOperation = effectiveDecision.status === 'unsupported' &&
      this.hasProviderPlanningEvidence(args.extraction) &&
      this.isProviderPlanningActionIntent(args.extraction.actionIntent) &&
      !this.isProviderPlanningCapabilityOperation(effectiveDecision.operation);
    if (hasRsvpEvidence || hasSecondaryPlanningOperation) {
      return null;
    }

    // W1-10 L1 evidence-only yields. A location/name selection over a retained
    // shortlist (confirmar_proveedor with typed selection evidence) is a
    // domain selection turn even when the extractor also reports an
    // unavailable provider operation such as provider.quote.write; the
    // selection flow reconciles first and the model confirms in Spanish. A
    // contact field on crear_lead_cerrar is close data even when the
    // extractor labels it an auth operation (auth.email_otp); the close flow
    // persists it instead of discarding the turn. Capability-only requests
    // with no such typed evidence remain intercepted.
    if (effectiveDecision.status === 'unsupported' &&
      args.extraction.actionIntent === 'confirmar_proveedor' &&
      this.hasProviderSelectionEvidence(args.extraction)) {
      return null;
    }
    // A close turn (cerrar with a typed close action) is close-flow data even
    // when the extractor also reports an unavailable provider operation such
    // as provider.quote.write; the close flow asks for contact through the
    // model instead of discarding the turn. Capability-only requests with no
    // such typed evidence remain intercepted.
    if (effectiveDecision.status === 'unsupported' &&
      args.extraction.actionIntent === 'cerrar' &&
      args.extraction.closeAction != null &&
      this.isProviderPlanningCapabilityOperation(effectiveDecision.operation)) {
      return null;
    }
    if (effectiveDecision.status === 'unsupported' &&
      args.plan.current_node === 'crear_lead_cerrar' &&
      this.hasCloseContactField(args.extraction) &&
      this.isAuthCapabilityOperation(effectiveDecision.operation)) {
      return null;
    }
    if (effectiveDecision.status === 'unsupported' &&
      args.plan.lifecycle_state === 'finished' &&
      this.hasFinishedCloseEvidence(args.plan)) {
      return null;
    }
    if (effectiveDecision.status === 'clarify' &&
      this.hasProviderPlanningEvidence(args.extraction) &&
      (this.isProviderPlanningActionIntent(args.extraction.actionIntent) ||
        (args.extraction.providerQueryIntents?.length ?? 0) > 0 ||
        (args.extraction.providerPlanOperations?.length ?? 0) > 0)) {
      return null;
    }
    if (effectiveDecision.status === 'clarify' &&
      (args.plan.information_state.last_completed_request?.kind === 'purchase' ||
        args.plan.information_state.last_completed_request?.kind === 'associated_event') &&
      (this.isSupportAcknowledgment(args.extraction.supportAct) ||
        args.extraction.informationRequests.length > 0)) {
      return null;
    }

    // A live purchase/event request serves its own fact through the
    // information flow: residual capability ambiguity (for example a mixed
    // write clarify with no servable read) never preempts it. Typed request
    // kinds only; no phrase detection.
    if (effectiveDecision.status === 'clarify' &&
      args.extraction.informationRequests.some((request) =>
        request.kind === 'purchase' || request.kind === 'associated_event')) {
      return null;
    }

    if (effectiveDecision.status === 'clarify') {
      // Capability clarification is still an information-resolution turn.
      // Preserve that node explicitly so a seeded or resumed plan cannot
      // drift into the generic planning interview while waiting for the
      // user's one confirmation answer.
      const plan = args.plan.current_node === 'resolver_consultas_informativas'
        ? args.plan
        : mergePlan(args.plan, { current_node: 'resolver_consultas_informativas' });
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(plan.current_node);
      // R2: capability replies share the resolved attachment projection and
      // the continuity reference. The pre-compose save moves after render;
      // a compose failure still persists the plan before propagating.
      const ownerProjection = this.resolveOwnerImageProjectionForReply({
        plan,
        extraction: args.extraction,
      });
      let reply: ComposeReplyResult;
      try {
        reply = await composeModelReply(this.dependencies.runtime, {
          currentNode: plan.current_node,
          previousNode: args.previousNode,
          userMessage: args.inbound.text,
          messageContext: args.messageContext,
          plan,
          extraction: args.extraction,
          missingFields: plan.missing_fields,
          searchReady: false,
          providerResults: [],
          turnDecision: this.contextualClarificationTurnDecision('capability_clarification_requested'),
          errorMessage: null,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage: args.toolUsage,
          capabilityDecision: effectiveDecision,
          continuity: this.resolveContinuityProjection(plan, args.messageContext),
          imageEvidence: this.imageEvidenceForProjection({ projection: ownerProjection }),
          imageUrlAttachments: ownerProjection.urls,
          imageFileAttachments: ownerProjection.files,
        });
      } catch (error) {
        await this.dependencies.planStore.save({ plan, reason: 'capability_clarification_requested' });
        throw error;
      }
      args.tokenUsage.reply = reply.tokenUsage ?? null;
      args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
        args.tokenUsage.reply,
      );
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      const turnDecision = this.contextualClarificationTurnDecision('capability_clarification_requested');
      // S2: render first for the verified outbound; the public handleTurn
      // wrapper finalizes the latest-response record centrally.
      const outbound = this.renderOutbound(
        reply, [], args.inbound.channel, plan.conversation_id, plan, args.toolUsage,
      );
      const planToSave = plan;
      await this.dependencies.planStore.save({ plan: planToSave, reason: 'capability_clarification_requested' });
      return {
        plan: planToSave,
        outbound,
        trace: this.buildTrace({
          plan: planToSave,
          previousNode: args.previousNode,
          currentNode: plan.current_node,
          nodePath: args.previousNode === plan.current_node ? [plan.current_node] : [args.previousNode, plan.current_node],
          extraction: args.extraction,
          missingFields: plan.missing_fields,
          searchReady: false,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
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
          operationalNote: null,
          responseClassifier: args.responseClassifierTrace,
          capabilityDecision: effectiveDecision,
        }),
      };
    }

    const safeRead = await this.performCapabilitySafeRead({
      inbound: args.inbound,
      plan: args.plan,
      extraction: args.extraction,
      toolUsage: args.toolUsage,
    });
    const completedPurchaseSafeRead = safeRead.results.find(
      (result): result is Extract<InformationTaskResult, { kind: 'purchase'; status: 'completed' }> =>
        result.kind === 'purchase' && result.status === 'completed',
    );
    if (completedPurchaseSafeRead) {
      const plan = args.plan.current_node === 'resolver_consultas_informativas'
        ? args.plan
        : mergePlan(args.plan, { current_node: 'resolver_consultas_informativas' });
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(
        'resolver_consultas_informativas',
      );
      // R2: capability replies share the resolved attachment projection and
      // the continuity reference.
      const ownerProjection = this.resolveOwnerImageProjectionForReply({
        plan,
        extraction: args.extraction,
      });
      const reply = await composeModelReply(this.dependencies.runtime, {
        currentNode: 'resolver_consultas_informativas',
        previousNode: args.previousNode,
        userMessage: args.inbound.text,
        messageContext: args.messageContext,
        plan,
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        providerResults: [],
        turnDecision: this.informationTurnDecision('purchase_evidence_after_capability_read'),
        errorMessage: null,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        informationResults: safeRead.results,
        replyBundle: bundle,
        continuity: this.resolveContinuityProjection(plan, args.messageContext),
        imageEvidence: this.imageEvidenceForProjection({ projection: ownerProjection }),
        imageUrlAttachments: ownerProjection.urls,
        imageFileAttachments: ownerProjection.files,
      });
      // S2: render first for the verified outbound; the public handleTurn
      // wrapper finalizes the latest-response record centrally.
      const outbound = this.renderOutbound(
        reply,
        [],
        args.inbound.channel,
        plan.conversation_id,
        plan,
      );
      const planToSave = plan;
      await this.dependencies.planStore.save({
        plan: planToSave,
        reason: 'purchase_evidence_after_capability_read',
      });
      args.tokenUsage.reply = reply.tokenUsage ?? null;
      args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
        args.tokenUsage.reply,
      );
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      return {
        plan: planToSave,
        outbound,
        trace: this.buildTrace({
          plan: planToSave,
          previousNode: args.previousNode,
          currentNode: plan.current_node,
          nodePath: args.previousNode === plan.current_node
            ? [plan.current_node]
            : [args.previousNode, plan.current_node],
          extraction: args.extraction,
          missingFields: [],
          searchReady: false,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage: args.toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'purchase_evidence_after_capability_read',
          timingMs: args.timingMs,
          tokenUsage: args.tokenUsage,
          messageContext: args.messageContext,
          searchStrategy: 'none',
          turnDecision: this.informationTurnDecision('purchase_evidence_after_capability_read'),
          operationalNote: null,
          responseClassifier: args.responseClassifierTrace,
          capabilityDecision: effectiveDecision,
          informationExecution: safeRead.summaries,
        }),
      };
    }
    const alreadyRequested = args.plan.human_escalation.status === 'requested';
    const phoneNumber = this.resolveEscalationPhone(args.inbound);
    const takeoverResult = alreadyRequested
      ? ({ status: 'success', message: 'Human takeover was already requested.' } satisfies AgentGatewayResult)
      : effectiveDecision.humanTakeoverAvailable && phoneNumber
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
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('resolver_consultas_informativas');
    // R2: capability replies share the resolved attachment projection and
    // the continuity reference. The pre-compose save moves after render; a
    // compose failure still persists the plan before propagating.
    const ownerProjection = this.resolveOwnerImageProjectionForReply({
      plan,
      extraction: args.extraction,
    });
    let reply: ComposeReplyResult;
    try {
      reply = await composeModelReply(this.dependencies.runtime, {
        currentNode: 'resolver_consultas_informativas',
        previousNode: args.previousNode,
        userMessage: args.inbound.text,
        messageContext: args.messageContext,
        plan,
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        providerResults: [],
        turnDecision: takeoverSucceeded
          ? this.humanEscalationTurnDecision('unsupported_operation_detected')
          : this.informationTurnDecision('unsupported_operation_detected'),
        errorMessage: null,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        informationResults: safeRead.results,
        capabilityDecision: effectiveDecision,
        handoffOutcome: takeoverSucceeded || alreadyRequested ? 'handoff_requested' : 'handoff_failed',
        continuity: this.resolveContinuityProjection(plan, args.messageContext),
        imageEvidence: this.imageEvidenceForProjection({ projection: ownerProjection }),
        imageUrlAttachments: ownerProjection.urls,
        imageFileAttachments: ownerProjection.files,
      });
    } catch (error) {
      await this.dependencies.planStore.save({ plan, reason: 'unsupported_operation_detected' });
      throw error;
    }
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    // S2: render first for the verified outbound; the public handleTurn
    // wrapper finalizes the latest-response record centrally.
    const outbound = this.renderOutbound(reply, [], args.inbound.channel, plan.conversation_id, plan, args.toolUsage);
    const planToSave = plan;
    await this.dependencies.planStore.save({ plan: planToSave, reason: 'unsupported_operation_detected' });
    return {
      plan: planToSave,
      outbound,
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode: takeoverSucceeded ? 'solicitar_agente_humano' : args.previousNode,
        nodePath: takeoverSucceeded && args.previousNode !== 'solicitar_agente_humano'
          ? [args.previousNode, 'solicitar_agente_humano']
          : [args.previousNode],
        extraction: args.extraction,
        missingFields: plan.missing_fields,
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
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
        operationalNote: null,
        responseClassifier: args.responseClassifierTrace,
        capabilityDecision: effectiveDecision,
        humanTakeoverAttempted: !alreadyRequested && effectiveDecision.status === 'unsupported' && effectiveDecision.humanTakeoverAvailable,
        humanTakeoverSucceeded: takeoverSucceeded,
        informationExecution: safeRead.summaries,
      }),
    };
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
    const extraction = this.buildNeutralMediaExtraction('Media-only message; content access is unavailable.');
    const decision = resolveCapabilityDecision({
      requestedOperation: 'media.image.inspect',
      manifest: this.capabilityManifest,
    });
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('resolver_consultas_informativas');
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode: plan.current_node,
      previousNode: args.plan.current_node,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan,
      extraction,
      missingFields: plan.missing_fields,
      searchReady: false,
      providerResults: [],
      turnDecision: this.informationTurnDecision('unsupported_image_media'),
      errorMessage: null,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      imageEvidence: {
        status: 'unavailable',
        reason: 'media_unavailable',
        captionPresent: false,
      },
    });
    await this.dependencies.planStore.save({ plan, reason: 'unsupported_image_media' });
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction, args.tokenUsage.reply);
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    return {
      plan,
      outbound: this.renderOutbound(
        reply, [], args.inbound.channel, plan.conversation_id, plan, args.toolUsage,
      ),
      trace: this.buildTrace({
        plan,
        previousNode: args.plan.current_node,
        currentNode: plan.current_node,
        nodePath: args.plan.current_node === plan.current_node ? [plan.current_node] : [args.plan.current_node, plan.current_node],
        extraction,
        missingFields: plan.missing_fields,
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'unsupported_image_media',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        searchStrategy: 'none',
        operationalNote: null,
        capabilityDecision: decision,
      }),
    };
  }

  /**
   * Image turns delivered by the channel adapter (S17). The backend pushes
   * image bytes or a delivery error; caption and image always stay in one
   * turn, pending conversation state is preserved, and binary content never
   * reaches plan persistence, logs, traces or evaluation reports.
   */
  private async handleImageTurn(args: {
    inbound: NormalizedInboundMessage;
    plan: PlanSnapshot;
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
  }): Promise<HandleTurnResponse> {
    const image: InboundImage | undefined = args.inbound.image;
    const caption = args.inbound.text;
    const plan = args.plan.current_node === 'resolver_consultas_informativas'
      ? args.plan
      : mergePlan(args.plan, { current_node: 'resolver_consultas_informativas' });
    const canInspect = image?.status === 'available' &&
      // URL images ride the owner reply call as native image content, and
      // base64 images ride the persisted file reference the same way; the
      // describe-by-default inspection call is retired and no turn invokes
      // runtime.inspectImage. The descriptor below is trace metadata only.
      image?.mimeType !== null &&
      typeof this.dependencies.runtime.inspectImage === 'function';
    const imageInspectDescriptor: RuntimeCapabilityDescriptor = canInspect
      ? { id: 'media.image.inspect', available: true, reason: 'enabled' }
      : { id: 'media.image.inspect', available: false, reason: 'media_unavailable' };
    const manifest: RuntimeCapabilityManifest = {
      ...this.capabilityManifest,
      'media.image.inspect': imageInspectDescriptor,
    };
    const decision = resolveCapabilityDecision({
      requestedOperation: 'media.image.inspect',
      manifest,
    });
    if (!image || image.status === 'unavailable') {
      const reason = image?.reason ?? 'media_unavailable';
      const unavailablePlan = plan;
      const bundle = await this.dependencies.promptLoader.loadNodeBundle(unavailablePlan.current_node);
      const extraction = this.buildNeutralMediaExtraction(reason);
      const reply = await composeModelReply(this.dependencies.runtime, {
        currentNode: unavailablePlan.current_node,
        previousNode: args.plan.current_node,
        userMessage: caption,
        messageContext: args.messageContext,
        plan: unavailablePlan,
        extraction,
        missingFields: plan.missing_fields,
        searchReady: false,
        providerResults: [],
        turnDecision: this.informationTurnDecision('image_unavailable'),
        errorMessage: null,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        continuity: this.resolveContinuityProjection(unavailablePlan, args.messageContext),
        imageEvidence: this.withImageObservation(
          { status: 'unavailable', reason, captionPresent: caption.trim().length > 0 },
          {
            plan: unavailablePlan,
            pixelsProjected: false,
            depositMentioned: false,
          },
        ),
      });
      args.tokenUsage.reply = reply.tokenUsage ?? null;
      args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
      args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction, args.tokenUsage.reply);
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      // S2: an inaccessible-image response never clears the pending
      // question; the public handleTurn wrapper finalizes the
      // latest-response record centrally.
      const outbound = this.renderOutbound(reply, [], args.inbound.channel, unavailablePlan.conversation_id, unavailablePlan, args.toolUsage);
      const planToSave = unavailablePlan;
      await this.dependencies.planStore.save({ plan: planToSave, reason: 'image_unavailable' });
      return {
        plan: planToSave,
        outbound,
        trace: this.buildTrace({
          plan: planToSave,
          previousNode: args.plan.current_node,
          currentNode: unavailablePlan.current_node,
          nodePath: args.plan.current_node === unavailablePlan.current_node ? [unavailablePlan.current_node] : [args.plan.current_node, unavailablePlan.current_node],
          extraction,
          missingFields: unavailablePlan.missing_fields,
          searchReady: false,
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
          toolUsage: args.toolUsage,
          providerResults: [],
          recommendationFunnel: this.resolveRecommendationFunnel(null, []),
          planPersisted: true,
          planPersistReason: 'image_unavailable',
          timingMs: args.timingMs,
          tokenUsage: args.tokenUsage,
          messageContext: args.messageContext,
          searchStrategy: 'none',
          operationalNote: null,
          capabilityDecision: decision,
        }),
      };
    }

    if (image.source === 'url') {
      // URL turns keep the established plan node: handleUrlImageTurn runs
      // real extraction plus persisted owner routing instead of forcing the
      // informative node.
      return await this.handleUrlImageTurn({
        inbound: args.inbound,
        image,
        caption,
        plan: args.plan,
        previousNode: args.plan.current_node,
        messageContext: args.messageContext,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        handleTurnStartedAt: args.handleTurnStartedAt,
        capabilityDecision: decision,
      });
    }

    // Remaining available source: validated base64. Persist through Files and
    // ride the established owner path. The describe-by-default inspection
    // flow is retired; explicit describe requests are answered by the owner
    // with the persisted attachment projected natively.
    return await this.handleBase64ImageTurn({
      inbound: args.inbound,
      image,
      caption,
      plan: args.plan,
      previousNode: args.plan.current_node,
      messageContext: args.messageContext,
      toolUsage: args.toolUsage,
      timingMs: args.timingMs,
      tokenUsage: args.tokenUsage,
      handleTurnStartedAt: args.handleTurnStartedAt,
      capabilityDecision: decision,
    });
  }

  /**
   * Base64 image turns (persistent-image amendment). Validated bytes upload
   * through Files (purpose vision, one-day expiry) inside the existing
   * per-conversation turn lease, so check-references/upload/save share the
   * turn coordination: a simultaneous later turn cannot overtake a partially
   * persisted attachment. The file reference persists before any reply is
   * composed; the turn then runs the established owner path with the file
   * projected natively. No inspection call, no description history, no
   * base64 in plans/logs/traces.
   *
   * Residual window: a process crash after a successful remote upload but
   * before the plan save orphans the file until its one-day expiry. A
   * successful upload followed by a failed save triggers best-effort
   * deletion plus a retryable failure (no false success). This is recorded,
   * not promised away: no distributed-transaction framework is built.
   */
  private async handleBase64ImageTurn(args: {
    inbound: NormalizedInboundMessage;
    image: Extract<InboundImage, { status: 'available'; source: 'base64' }>;
    caption: string;
    plan: PlanSnapshot;
    previousNode: PlanSnapshot['current_node'];
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
    capabilityDecision: CapabilityDecision;
  }): Promise<HandleTurnResponse> {
    const captionPresent = args.caption.trim().length > 0;
    const storedRefs = args.plan.image_attachments ?? [];

    // Duplicate delivery reuses the persisted ref: never re-upload, and never
    // accept a caller-supplied file ID (inbound base64 carries none by
    // construction of the wire schema).
    const duplicate = storedRefs.find(
      (ref): ref is FileAttachmentRef =>
        ref.kind === 'file' && ref.messageId === args.inbound.messageId,
    );
    if (duplicate !== undefined) {
      this.recordDeterministicToolInput(args.toolUsage, 'image_file_context', {
        mime_type: duplicate.mimeType,
        byte_length: duplicate.byteLength,
        caption_present: captionPresent,
        content_digest_fp: duplicate.contentDigest.slice(0, 16),
        duplicate_delivery: true,
      });
      return await this.runPersistedFileTurnWithRef({
        ...args,
        plan: args.plan,
        fileRef: duplicate,
        uploadedNewFileId: null,
      });
    }

    const decoded = decodeValidatedBase64Bytes(args.image);
    const mimeType = args.image.mimeType;
    if (
      decoded === null ||
      (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp')
    ) {
      return await this.replyImageUnavailable({
        inbound: args.inbound,
        caption: args.caption,
        plan: args.plan,
        previousNode: args.previousNode,
        messageContext: args.messageContext,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        handleTurnStartedAt: args.handleTurnStartedAt,
        capabilityDecision: args.capabilityDecision,
        reason: 'media_unavailable',
      });
    }
    const digest = contentDigestForBytes(decoded);
    this.recordDeterministicToolInput(args.toolUsage, 'image_file_context', {
      mime_type: mimeType,
      byte_length: decoded.length,
      caption_present: captionPresent,
      content_digest_fp: digest.slice(0, 16),
      duplicate_delivery: false,
    });

    // Upload reuse within the conversation: identical bytes share one file
    // with its original expiry (never silently refreshed), preserving
    // distinct message linkage per delivery.
    const nowMs = Date.now();
    const reusable = findReusableFileRef(storedRefs, digest, nowMs);
    if (reusable !== null) {
      const fileRef: FileAttachmentRef = {
        ...reusable,
        messageId: args.inbound.messageId,
        receivedAt: args.inbound.receivedAt,
      };
      this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
        reused_upload: true,
        file_fingerprint: imageFileFingerprint(reusable.fileId),
      });
      return await this.runPersistedFileTurnWithRef({
        ...args,
        plan: args.plan,
        fileRef,
        uploadedNewFileId: null,
      });
    }

    const store = this.dependencies.imageFileStore;
    if (!store) {
      this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
        stage: 'upload_skipped_no_store',
        reply_received: false,
      });
      return await this.replyImageUnavailable({
        inbound: args.inbound,
        caption: args.caption,
        plan: args.plan,
        previousNode: args.previousNode,
        messageContext: args.messageContext,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        handleTurnStartedAt: args.handleTurnStartedAt,
        capabilityDecision: args.capabilityDecision,
        reason: 'upload_failed',
      });
    }
    let uploaded: { fileId: string; expiresAt: string; byteLength: number };
    try {
      uploaded = await store.uploadImage({ bytes: decoded, mimeType });
    } catch (error) {
      // S5: only malformed-media upload failures degrade to unavailable image
      // evidence. Provider credential failures and transport/retryable
      // failures (connection, timeout, rate limit, 5xx) propagate truthfully
      // and are never relabeled as an unreadable image. Non-upload exceptions
      // propagate untouched.
      if (!(error instanceof ImageFileUploadError)) throw error;
      if (error.causeName === 'AuthenticationError' || error.causeName === 'PermissionDeniedError') {
        this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
          stage: 'upload_failed_auth',
          error_name: error.causeName,
          retryable: error.retryable,
          reply_received: false,
        });
        throw error;
      }
      if (error.retryable) {
        this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
          stage: 'upload_failed_retryable',
          error_name: error.causeName,
          retryable: true,
          reply_received: false,
        });
        throw error;
      }
      this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
        stage: 'upload_failed',
        error_name: error.causeName,
        retryable: error.retryable,
        reply_received: false,
      });
      return await this.replyImageUnavailable({
        inbound: args.inbound,
        caption: args.caption,
        plan: args.plan,
        previousNode: args.previousNode,
        messageContext: args.messageContext,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        handleTurnStartedAt: args.handleTurnStartedAt,
        capabilityDecision: args.capabilityDecision,
        reason: 'upload_failed',
      });
    }
    this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
      reused_upload: false,
      file_fingerprint: imageFileFingerprint(uploaded.fileId),
      byte_length: uploaded.byteLength,
    });
    const fileRef: FileAttachmentRef = {
      kind: 'file',
      fileId: uploaded.fileId,
      expiresAt: uploaded.expiresAt,
      mimeType,
      byteLength: uploaded.byteLength,
      contentDigest: digest,
      messageId: args.inbound.messageId,
      receivedAt: args.inbound.receivedAt,
    };
    return await this.runPersistedFileTurnWithRef({
      ...args,
      plan: args.plan,
      fileRef,
      uploadedNewFileId: uploaded.fileId,
    });
  }

  /**
   * Persists the file ref, then runs the established owner turn. A
   * successful upload followed by a failed save triggers best-effort file
   * deletion and a retryable failure with no false success reply. A model-
   * stage failure is handled inside the owner turn (unavailable evidence
   * with both attempts recorded) and keeps the persisted reference.
   */
  private async runPersistedFileTurnWithRef(args: {
    inbound: NormalizedInboundMessage;
    caption: string;
    plan: PlanSnapshot;
    previousNode: PlanSnapshot['current_node'];
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
    capabilityDecision: CapabilityDecision;
    fileRef: FileAttachmentRef;
    uploadedNewFileId: string | null;
  }): Promise<HandleTurnResponse> {
    const captionPresent = args.caption.trim().length > 0;
    const planWithRef = mergePlan(args.plan, {
      image_attachments: appendImageAttachmentRef(
        args.plan.image_attachments ?? [],
        args.fileRef,
      ),
    });
    const refStored = (planWithRef.image_attachments ?? []).some(
      (ref) => ref.kind === 'file' && ref.messageId === args.inbound.messageId,
    );
    const imageTurn: ImageTurnContext = {
      kind: 'file',
      messageId: args.inbound.messageId,
      refStored,
      captionPresent,
      fileId: args.fileRef.fileId,
      reusedUpload: args.uploadedNewFileId === null,
    };
    try {
      return await this.runPersistedImageOwnerTurn({ ...args, plan: planWithRef, imageTurn });
    } catch (error) {
      // S5: only a typed image-access failure keeps the persisted reference
      // (the retry answers from other evidence). Every other failure —
      // credentials, generic model failures, timeouts, server errors — skips
      // the unavailable-evidence fallback and the plan save, so a fresh
      // upload would orphan without best-effort deletion.
      if (args.uploadedNewFileId !== null && !isImageFileAccessFailure(error)) {
        await this.bestEffortDeleteImageFile(args.uploadedNewFileId, args.toolUsage);
      }
      throw error;
    }
  }

  /** Best-effort orphan cleanup; deletion failures are recorded, never thrown. */
  private async bestEffortDeleteImageFile(fileId: string, toolUsage: ToolUsage): Promise<void> {
    const store = this.dependencies.imageFileStore;
    if (!store) return;
    try {
      await store.deleteImage(fileId);
      this.recordDeterministicToolOutput(toolUsage, 'image_file_context', {
        stage: 'orphan_cleanup_deleted',
        file_fingerprint: imageFileFingerprint(fileId),
      });
    } catch (error) {
      this.recordDeterministicToolOutput(toolUsage, 'image_file_context', {
        stage: 'orphan_cleanup_failed',
        file_fingerprint: imageFileFingerprint(fileId),
        error_name: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /**
   * Established owner turn shared by persisted image turns: real extraction
   * on the uploaded caption plus persisted owner routing, then the owner's
   * full task/evidence flow with current purchase results. Only a
   * model-stage extraction failure falls back to a synthetic extraction;
   * persistence errors propagate and are never relabeled.
   */
  private async runPersistedImageOwnerTurn(args: {
    inbound: NormalizedInboundMessage;
    caption: string;
    plan: PlanSnapshot;
    previousNode: PlanSnapshot['current_node'];
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
    capabilityDecision: CapabilityDecision;
    imageTurn: ImageTurnContext;
  }): Promise<HandleTurnResponse> {
    const extractionStartedAt = Date.now();
    let extraction: ExtractionResult;
    try {
      const rawExtractionResult = await this.dependencies.runtime.extract({
        userMessage: args.caption,
        plan: args.plan,
        messageContext: args.messageContext,
        currentMessageId: args.inbound.messageId,
      });
      extraction = 'extraction' in rawExtractionResult
        ? rawExtractionResult.extraction
        : rawExtractionResult;
      args.tokenUsage.extraction = 'tokenUsage' in rawExtractionResult
        ? (rawExtractionResult.tokenUsage ?? null)
        : null;
      args.tokenUsage.openAiCalls.extraction = 'openAiCall' in rawExtractionResult
        ? (rawExtractionResult.openAiCall ?? null)
        : null;
    } catch (error) {
      // Credential failures propagate truthfully instead of falling back to
      // a synthetic extraction. Other model-stage extraction failures keep
      // the native projection with the attempt recorded as such.
      if (isAuthenticationFailure(error)) {
        this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
          stage: 'extraction_failed_auth',
          error_name: error instanceof Error ? error.name : 'unknown',
          ref_stored: args.imageTurn.refStored,
        });
        throw error;
      }
      // Model-stage extraction failure is not image unavailability: the
      // image stays projected natively and the attempt is recorded as such.
      this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
        stage: 'extraction_failed',
        error_name: error instanceof Error ? error.name : 'unknown',
        ref_stored: args.imageTurn.refStored,
      });
      extraction = this.buildFileImageTurnExtraction(args.caption);
    }
    args.timingMs.extraction += Date.now() - extractionStartedAt;
    extraction = this.normalizeInformationExtractionAmbiguity(extraction);
    // Image-only empty-text turns carry no user question: an ambiguous
    // extraction here is synthetic clarification, never an outstanding task.
    // Clearing it before owner persistence keeps it from stashing a pending
    // question that would force a reply; genuine task evidence (information
    // requests, typed pending state) still routes to the owner flow below.
    if (
      args.caption.trim().length === 0 &&
      (args.plan.owner_pending_question?.trim().length ?? 0) === 0
    ) {
      extraction = {
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
    const workingPlan = this.persistTurnOwner({
      plan: args.plan,
      extraction,
      contactPhone: args.inbound.contactPhone,
    });
    // Image-only turns with no outstanding task persist silently: the file
    // reference is already in workingPlan, so saving it keeps the pixels
    // available for a later question without spending a generation. An image
    // that fulfills a task never takes this path: task evidence (model
    // extraction or typed pending state) routes to the owner flow below.
    if (args.caption.trim().length === 0 && !this.hasOutstandingImageTask(workingPlan, extraction)) {
      return await this.persistSilentImageTurn({
        inbound: args.inbound,
        previousNode: args.previousNode,
        workingPlan,
        extraction,
        messageContext: args.messageContext,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        handleTurnStartedAt: args.handleTurnStartedAt,
        capabilityDecision: args.capabilityDecision,
        imageTurn: args.imageTurn,
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
        inbound: args.inbound,
        previousNode: args.previousNode,
        workingPlan,
        extraction,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        handleTurnStartedAt: args.handleTurnStartedAt,
        imageTurn: args.imageTurn,
      });
    }
    return await this.replyOnEstablishedImageNode({
      inbound: args.inbound,
      previousNode: args.previousNode,
      workingPlan,
      extraction,
      messageContext: args.messageContext,
      toolUsage: args.toolUsage,
      timingMs: args.timingMs,
      tokenUsage: args.tokenUsage,
      handleTurnStartedAt: args.handleTurnStartedAt,
      capabilityDecision: args.capabilityDecision,
      imageTurn: args.imageTurn,
    });
  }

  /**
   * Outstanding-task evidence for an image-only turn. Typed persisted state
   * plus model-extracted task evidence decide; no message text is inspected
   * for keywords and no generic open field (open_questions, unrelated OTP or
   * RSVP state) automatically makes an image answer-worthy. The curated
   * owner_pending_question carries the unresolved user question needing
   * later evidence; the established model receives the pending task plus
   * image availability and decides the semantic relation. An image arriving
   * while a request, curated question, task, RSVP selection or credential
   * challenge is outstanding continues that task instead of persisting
   * silently.
   */
  private hasOutstandingImageTask(plan: PlanSnapshot, extraction: ExtractionResult): boolean {
    if (this.hasInformationWork(plan, extraction, { forImageGate: true })) return true;
    if (plan.owner_pending_task !== null || plan.owner_pending_question !== null) return true;
    if (plan.rsvp_state.status !== 'none' || plan.rsvp_state.pending_action !== null) return true;
    if (plan.user_auth.status === 'code_requested') return true;
    return false;
  }

  /**
   * Typed silent persistence for an image-only turn with no outstanding
   * task. Saves the plan carrying the fresh attachment reference, records
   * the source decision (transport kind, redacted shape, reason) in tool
   * evidence, and returns a suppress disposition with no assistant text and
   * no generation call. Silence is legitimate persistence, never a masked
   * generation failure: this path runs zero model calls after extraction.
   */
  private async persistSilentImageTurn(args: {
    inbound: NormalizedInboundMessage;
    previousNode: PlanSnapshot['current_node'];
    workingPlan: PlanSnapshot;
    extraction: ExtractionResult;
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
    capabilityDecision: CapabilityDecision;
    imageTurn: ImageTurnContext;
  }): Promise<HandleTurnResponse> {
    const toolLabel = args.imageTurn.kind === 'file' ? 'image_file_context' : 'image_url_context';
    const redactedShape = this.redactedImageTurnShape(args.imageTurn);
    const persistReason = args.imageTurn.kind === 'file' ? 'image_file_silence' : 'image_url_silence';
    this.recordDeterministicToolOutput(args.toolUsage, toolLabel, {
      stage: 'silent_persisted',
      reason: 'image_only_no_outstanding_task',
      ref_stored: args.imageTurn.refStored,
      shape: redactedShape,
    });
    const savePlanStartedAt = Date.now();
    await this.dependencies.planStore.save({ plan: args.workingPlan, reason: persistReason });
    args.timingMs.save_plan += Date.now() - savePlanStartedAt;
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    return {
      plan: args.workingPlan,
      outbound: this.suppressOutbound(
        args.workingPlan.conversation_id,
        'image_only_no_outstanding_task',
      ),
      trace: this.buildTrace({
        plan: args.workingPlan,
        previousNode: args.previousNode,
        currentNode: args.workingPlan.current_node,
        nodePath: args.previousNode === args.workingPlan.current_node
          ? [args.workingPlan.current_node]
          : [args.previousNode, args.workingPlan.current_node],
        extraction: args.extraction,
        missingFields: args.workingPlan.missing_fields,
        searchReady: false,
        promptBundleId: 'deterministic:image_only_silence',
        promptFilePaths: [],
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: persistReason,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        searchStrategy: 'none',
        operationalNote: `Image-only turn persisted silently (${redactedShape}). No outstanding task needed a reply; the reference stays available for a later question.`,
        capabilityDecision: args.capabilityDecision,
      }),
    };
  }

  private buildFileImageTurnExtraction(caption: string): ExtractionResult {
    return {
      ...this.buildNeutralMediaExtraction(
        'File image turn with native projection; the caption is the user message.',
      ),
      conversationSummary: caption.trim().length > 0
        ? `File image with caption: ${caption.trim().slice(0, 500)}`
        : 'File image without caption.',
    };
  }

  /**
   * Unavailable-image reply for file-path failures (invalid bytes, missing
   * store, upload failure). Same evidence shape as the inbound-level
   * unavailable branch; the turn still records a completion tool record and
   * preserves all model attempts. Persistence errors propagate untouched.
   */
  private async replyImageUnavailable(args: {
    inbound: NormalizedInboundMessage;
    caption: string;
    plan: PlanSnapshot;
    previousNode: PlanSnapshot['current_node'];
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
    capabilityDecision: CapabilityDecision;
    reason: string;
  }): Promise<HandleTurnResponse> {
    const captionPresent = args.caption.trim().length > 0;
    const unavailablePlan = args.plan.current_node === 'resolver_consultas_informativas'
      ? args.plan
      : mergePlan(args.plan, { current_node: 'resolver_consultas_informativas' });
    const bundle = await this.dependencies.promptLoader.loadNodeBundle(unavailablePlan.current_node);
    const extraction = this.buildNeutralMediaExtraction(args.reason);
    this.recordDeterministicToolInput(args.toolUsage, 'image_file_context', {
      status: 'unavailable',
      reason: args.reason,
      caption_present: captionPresent,
    });
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode: unavailablePlan.current_node,
      previousNode: args.previousNode,
      userMessage: args.caption,
      messageContext: args.messageContext,
      plan: unavailablePlan,
      extraction,
      missingFields: unavailablePlan.missing_fields,
      searchReady: false,
      providerResults: [],
      turnDecision: this.informationTurnDecision('image_unavailable'),
      errorMessage: null,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      continuity: this.resolveContinuityProjection(unavailablePlan, args.messageContext),
      imageEvidence: this.withImageObservation(
        { status: 'unavailable', reason: args.reason, captionPresent },
        {
          plan: unavailablePlan,
          pixelsProjected: false,
          depositMentioned: false,
        },
      ),
    });
    this.recordDeterministicToolOutput(args.toolUsage, 'image_file_context', {
      status: 'unavailable',
      reason: args.reason,
      reply_received: true,
    });
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction, args.tokenUsage.reply);
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    // S2: an inaccessible-image response never clears the pending question;
    // the public handleTurn wrapper finalizes the latest-response record.
    const outbound = this.renderOutbound(reply, [], args.inbound.channel, unavailablePlan.conversation_id, unavailablePlan, args.toolUsage);
    const planToSave = unavailablePlan;
    await this.dependencies.planStore.save({ plan: planToSave, reason: 'image_unavailable' });
    return {
      plan: planToSave,
      outbound,
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode: unavailablePlan.current_node,
        nodePath: args.previousNode === unavailablePlan.current_node ? [unavailablePlan.current_node] : [args.previousNode, unavailablePlan.current_node],
        extraction,
        missingFields: unavailablePlan.missing_fields,
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: 'image_unavailable',
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        searchStrategy: 'none',
        operationalNote: null,
        capabilityDecision: args.capabilityDecision,
      }),
    };
  }

  /**
   * Follow-up projection for text-only turns from structured extraction
   * evidence (never message keywords): `prior_single` projects refs linked
   * to the referenced prior messages (linkage validated against stored
   * refs); `prior_uncertain` exposes up to two plausible recent images;
   * `none`/absent projects nothing, so unrelated FAQ/cart turns never
   * receive recent receipts. A `prior_single` without message linkage
   * carries the single stored image when exactly one usable ref exists
   * (deterministic single-candidate carry, still typed linkage status, no
   * wording rule); with several stored refs the linkage stays ambiguous
   * and projects nothing (it must not fall back to recent images).
   * Expired file refs are excluded; when a referenced image exists
   * but expired, the caller reports expiry so the model answers from the
   * profile and record, asking only for the specific missing fact when one
   * is needed. Never a resend demand and never an image or URL request.
   */
  private selectFollowUpImageProjection(args: {
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    nowMs: number;
  }): {
    urls: Array<{ url: string; messageId: string }>;
    files: ImageFileAttachment[];
    expiredReferenced: boolean;
  } {
    const empty = {
      urls: [] as Array<{ url: string; messageId: string }>,
      files: [] as ImageFileAttachment[],
      expiredReferenced: false,
    };
    const reference = args.extraction.imageReference;
    if (!reference || reference.status === 'none') return empty;
    const stored = args.plan.image_attachments ?? [];
    const isUsable = (ref: ImageAttachmentRef): boolean =>
      ref.kind === 'url' || isFileRefActive(ref, args.nowMs);
    if (reference.status === 'prior_single' && reference.referencedMessageIds.length === 0) {
      // Deterministic single-candidate carry: one usable stored image must
      // be the referenced prior, so it rides the follow-up. Several stored
      // refs keep the linkage ambiguous and project nothing.
      const usable = stored.filter(isUsable);
      if (usable.length !== 1) {
        return empty;
      }
      return { ...this.splitImageProjection(usable.slice(0, 1)), expiredReferenced: false };
    }
    let candidates: ImageAttachmentRef[];
    if (reference.status === 'prior_single' && reference.referencedMessageIds.length > 0) {
      const wanted = new Set(reference.referencedMessageIds);
      candidates = stored.filter((ref) => wanted.has(ref.messageId));
      const expiredHit = candidates.some((ref) => ref.kind === 'file' && !isFileRefActive(ref, args.nowMs));
      candidates = candidates.filter(isUsable);
      const projected = this.splitImageProjection(
        [...candidates].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0)).slice(0, 2),
      );
      return { ...projected, expiredReferenced: projected.files.length === 0 && projected.urls.length === 0 && expiredHit };
    }
    const projected = this.splitImageProjection(
      selectActiveImageAttachmentRefs(stored, args.nowMs, 2),
    );
    return { ...projected, expiredReferenced: false };
  }

  private splitImageProjection(refs: readonly ImageAttachmentRef[]): {
    urls: Array<{ url: string; messageId: string }>;
    files: ImageFileAttachment[];
  } {
    const urls: Array<{ url: string; messageId: string }> = [];
    const files: ImageFileAttachment[] = [];
    for (const ref of refs) {
      if (ref.kind === 'url') {
        urls.push({ url: ref.url, messageId: ref.messageId });
      } else {
        files.push({ fileId: ref.fileId, messageId: ref.messageId });
      }
    }
    return { urls, files };
  }

  /**
   * R2 single resolved attachment projection shared by every owner reply
   * path (image turns, information, clarification, capability, support and
   * host-withdrawal replies). Current image turns project their own
   * attachment; text-only turns project stored refs only when the extractor
   * linked the question to a prior image. At most two native images ride a
   * reply request; unrelated turns project nothing.
   */
  private resolveOwnerImageProjectionForReply(args: {
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    imageTurn?: ImageTurnContext;
    nowMs?: number;
  }): {
    urls: Array<{ url: string; messageId: string }>;
    files: ImageFileAttachment[];
    expiredReferenced: boolean;
  } {
    if (args.imageTurn !== undefined) {
      if (args.imageTurn.kind === 'url' && args.imageTurn.url !== undefined) {
        return {
          urls: [{ url: args.imageTurn.url, messageId: args.imageTurn.messageId }],
          files: [],
          expiredReferenced: false,
        };
      }
      if (args.imageTurn.kind === 'file' && args.imageTurn.fileId !== undefined) {
        return {
          urls: [],
          files: [{ fileId: args.imageTurn.fileId, messageId: args.imageTurn.messageId }],
          expiredReferenced: false,
        };
      }
      return { urls: [], files: [], expiredReferenced: false };
    }
    return this.selectFollowUpImageProjection({
      plan: args.plan,
      extraction: args.extraction,
      nowMs: args.nowMs ?? Date.now(),
    });
  }

  /**
   * Typed image evidence matching a resolved projection. Facts only, never
   * reply prose. Undefined means no image travels on this reply.
   */
  private imageEvidenceForProjection(args: {
    imageTurn?: ImageTurnContext;
    projection: {
      urls: Array<{ url: string; messageId: string }>;
      files: ImageFileAttachment[];
      expiredReferenced: boolean;
    };
    /**
     * R8 same-day observation memory: the plan carrying the persisted image
     * refs plus the typed deposit mention. Absent on non-image paths (their
     * evidence stays byte-identical); present on image/info turns so current
     * and same-day follow-up replies share one observation summary.
     */
    plan?: PlanSnapshot;
    depositMentioned?: boolean;
  }): ComposeReplyRequest['imageEvidence'] {
    const observationFor = (imageAvailable: boolean): ImageObservation | undefined => {
      if (args.plan === undefined) return undefined;
      return buildImageObservation({
        imageAvailable,
        pixelsProjected: args.projection.urls.length + args.projection.files.length > 0,
        currentTurnCarriesImage: args.imageTurn !== undefined,
        storedRefs: args.plan.image_attachments ?? [],
        nowMs: Date.now(),
        depositMentioned: args.depositMentioned ?? false,
      }) ?? undefined;
    };
    if (args.imageTurn !== undefined) {
      const observation = observationFor(true);
      return {
        status: 'available',
        reason: null,
        captionPresent: args.imageTurn.captionPresent,
        source: args.imageTurn.kind,
        refStored: args.imageTurn.refStored,
        ...(observation !== undefined ? { observation } : {}),
      };
    }
    if (args.projection.urls.length > 0 || args.projection.files.length > 0) {
      const observation = observationFor(true);
      return {
        status: 'available',
        reason: null,
        captionPresent: false,
        source: args.projection.files.length > 0 ? 'file' : 'url',
        refStored: true,
        fileRefProjected: args.projection.files.length > 0,
        ...(observation !== undefined ? { observation } : {}),
      };
    }
    if (args.projection.expiredReferenced) {
      const observation = observationFor(false);
      return {
        status: 'unavailable',
        reason: 'image_expired',
        captionPresent: false,
        ...(observation !== undefined ? { observation } : {}),
      };
    }
    return undefined;
  }

  /**
   * R8 typed deposit mention for the image observation summary. Voucher /
   * submission-report support evidence only; never message keywords and
   * never pixel content.
   */
  private isDepositMentioned(extraction: Pick<ExtractionResult, 'supportAct'>): boolean {
    const act = extraction.supportAct;
    if (act === null || act === undefined) return false;
    return act.topic === 'payment_proof' || act.detail === 'submission_reported';
  }

  /**
   * R8 attaches the same-day image observation summary to an already-built
   * image evidence object (image-turn paths only). Returns the evidence
   * untouched when no same-day image links to this turn, so those replies
   * stay byte-identical. Facts only, never reply prose.
   */
  private withImageObservation(
    imageEvidence: NonNullable<ComposeReplyRequest['imageEvidence']>,
    args: {
      plan: PlanSnapshot;
      imageTurn?: ImageTurnContext;
      pixelsProjected: boolean;
      depositMentioned: boolean;
    },
  ): NonNullable<ComposeReplyRequest['imageEvidence']> {
    const observation = buildImageObservation({
      imageAvailable: imageEvidence.status === 'available',
      pixelsProjected: args.pixelsProjected,
      currentTurnCarriesImage: args.imageTurn !== undefined,
      storedRefs: args.plan.image_attachments ?? [],
      nowMs: Date.now(),
      depositMentioned: args.depositMentioned,
    }) ?? undefined;
    if (observation === undefined) return imageEvidence;
    return { ...imageEvidence, observation };
  }

  /** Redacted shape for traces: hosts for URLs, fingerprints for files. */
  private redactedImageTurnShape(imageTurn: ImageTurnContext): string {
    if (imageTurn.kind === 'url' && imageTurn.url) {
      return `${redactImageUrlForLog(imageTurn.url)} (${imageUrlFingerprint(imageTurn.url)})`;
    }
    return redactFileIdForLog(imageTurn.fileId ?? '');
  }

  /**
   * URL image turns (lean-conversation amendment). The URL ref is stored
   * (linkage only, never bytes) and the turn runs the established owner
   * path: real extraction, persisted owner, then the owner's full
   * task/evidence flow with current purchase results. The relevant URL rides
   * the owner reply call as native image content. No inspection call, no
   * downloader, no proxy, no rehost, no base64 conversion, no description
   * history. Only a model-stage failure degrades to the image_unavailable
   * evidence path; persistence errors propagate and are never relabeled. A
   * visible voucher is evidence only, never payment proof.
   */
  private async handleUrlImageTurn(args: {
    inbound: NormalizedInboundMessage;
    image: Extract<InboundImage, { status: 'available'; source: 'url' }>;
    caption: string;
    plan: PlanSnapshot;
    previousNode: PlanSnapshot['current_node'];
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
    capabilityDecision: CapabilityDecision;
  }): Promise<HandleTurnResponse> {
    const captionPresent = args.caption.trim().length > 0;
    const planWithRef = mergePlan(args.plan, {
      image_attachments: appendImageAttachmentRef(args.plan.image_attachments ?? [], {
        url: args.image.url,
        messageId: args.inbound.messageId,
        receivedAt: args.inbound.receivedAt,
      }),
    });
    const refStored = (planWithRef.image_attachments ?? []).some(
      (ref) => ref.kind === 'url' && ref.messageId === args.inbound.messageId && ref.url === args.image.url,
    );
    // Signed URLs are credentials: shape evidence only, never the raw link.
    this.recordDeterministicToolInput(args.toolUsage, 'image_url_context', {
      url_host_redacted: redactImageUrlForLog(args.image.url),
      url_fingerprint: imageUrlFingerprint(args.image.url),
      url_bytes: Buffer.byteLength(args.image.url, 'utf8'),
      caption_present: captionPresent,
      ref_stored: refStored,
    });
    const imageTurn: ImageTurnContext = {
      kind: 'url',
      url: args.image.url,
      messageId: args.inbound.messageId,
      refStored,
      captionPresent,
    };
    const extractionStartedAt = Date.now();
    let extraction: ExtractionResult;
    try {
      const rawExtractionResult = await this.dependencies.runtime.extract({
        userMessage: args.caption,
        plan: planWithRef,
        messageContext: args.messageContext,
        currentMessageId: args.inbound.messageId,
      });
      extraction = 'extraction' in rawExtractionResult
        ? rawExtractionResult.extraction
        : rawExtractionResult;
      args.tokenUsage.extraction = 'tokenUsage' in rawExtractionResult
        ? (rawExtractionResult.tokenUsage ?? null)
        : null;
      args.tokenUsage.openAiCalls.extraction = 'openAiCall' in rawExtractionResult
        ? (rawExtractionResult.openAiCall ?? null)
        : null;
    } catch (error) {
      // Credential failures propagate truthfully instead of falling back to
      // a synthetic extraction. Other model-stage extraction failures keep
      // the native projection with the attempt recorded as such.
      if (isAuthenticationFailure(error)) {
        this.recordDeterministicToolOutput(args.toolUsage, 'image_url_context', {
          stage: 'extraction_failed_auth',
          error_name: error instanceof Error ? error.name : 'unknown',
          ref_stored: refStored,
        });
        throw error;
      }
      // Model-stage extraction failure is not image unavailability: the
      // image stays projected natively and the attempt is recorded as such.
      this.recordDeterministicToolOutput(args.toolUsage, 'image_url_context', {
        stage: 'extraction_failed',
        error_name: error instanceof Error ? error.name : 'unknown',
        ref_stored: refStored,
      });
      extraction = this.buildUrlImageTurnExtraction(args.caption);
    }
    args.timingMs.extraction += Date.now() - extractionStartedAt;
    extraction = this.normalizeInformationExtractionAmbiguity(extraction);
    const workingPlan = this.persistTurnOwner({
      plan: planWithRef,
      extraction,
      contactPhone: args.inbound.contactPhone,
    });
    // Image-only URL turns persist silently when no task is outstanding: the
    // URL reference is already in workingPlan. A task-fulfilling image keeps
    // the owner flow below even with empty text.
    if (!captionPresent && !this.hasOutstandingImageTask(workingPlan, extraction)) {
      return await this.persistSilentImageTurn({
        inbound: args.inbound,
        previousNode: args.previousNode,
        workingPlan,
        extraction,
        messageContext: args.messageContext,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        handleTurnStartedAt: args.handleTurnStartedAt,
        capabilityDecision: args.capabilityDecision,
        imageTurn,
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
        inbound: args.inbound,
        previousNode: args.previousNode,
        workingPlan,
        extraction,
        toolUsage: args.toolUsage,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        handleTurnStartedAt: args.handleTurnStartedAt,
        imageTurn,
      });
    }
    return await this.replyOnEstablishedImageNode({
      inbound: args.inbound,
      previousNode: args.previousNode,
      workingPlan,
      extraction,
      messageContext: args.messageContext,
      toolUsage: args.toolUsage,
      timingMs: args.timingMs,
      tokenUsage: args.tokenUsage,
      handleTurnStartedAt: args.handleTurnStartedAt,
      capabilityDecision: args.capabilityDecision,
      imageTurn,
    });
  }

  /**
   * Established-node reply for URL image turns without information work.
   * Uses the persisted owner node and the real extraction (never a forced
   * node or synthetic extraction). Only a model-stage compose failure falls
   * back to image_unavailable evidence with both attempts recorded; the plan
   * save stays outside the failure catch so persistence errors propagate.
   */
  private async replyOnEstablishedImageNode(args: {
    inbound: NormalizedInboundMessage;
    previousNode: PlanSnapshot['current_node'];
    workingPlan: PlanSnapshot;
    extraction: ExtractionResult;
    messageContext: TurnMessageContext;
    toolUsage: ToolUsage;
    timingMs: TurnTiming;
    tokenUsage: TurnTokenUsage;
    handleTurnStartedAt: number;
    capabilityDecision: CapabilityDecision;
    imageTurn: ImageTurnContext;
  }): Promise<HandleTurnResponse> {
    const bundle = await this.dependencies.promptLoader.loadNodeBundle(args.workingPlan.current_node);
    const redactedShape = this.redactedImageTurnShape(args.imageTurn);
    const toolLabel = args.imageTurn.kind === 'file' ? 'image_file_context' : 'image_url_context';
    const turnDecisionLabel = args.imageTurn.kind === 'file' ? 'image_file_context' : 'image_url_context';
    const composeWithEvidence = async (
      imageEvidence: NonNullable<ComposeReplyRequest['imageEvidence']>,
      attachments: {
        urls: Array<{ url: string; messageId: string }>;
        files: ImageFileAttachment[];
      },
    ): Promise<ComposeReplyResult> => {
      const reply = await composeModelReply(this.dependencies.runtime, {
        currentNode: args.workingPlan.current_node,
        previousNode: args.previousNode,
        userMessage: args.inbound.text,
        messageContext: args.messageContext,
        plan: args.workingPlan,
        extraction: args.extraction,
        missingFields: args.workingPlan.missing_fields,
        searchReady: false,
        providerResults: [],
        turnDecision: this.informationTurnDecision(
          imageEvidence.status === 'available' ? turnDecisionLabel : 'image_unavailable',
        ),
        errorMessage: null,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        owner: args.workingPlan.owner ?? null,
        continuity: this.resolveContinuityProjection(args.workingPlan, args.messageContext),
        pendingQuestionRef: args.workingPlan.owner_pending_question ?? null,
        imageEvidence: this.withImageObservation(imageEvidence, {
          plan: args.workingPlan,
          imageTurn: args.imageTurn,
          pixelsProjected: attachments.urls.length + attachments.files.length > 0,
          depositMentioned: this.isDepositMentioned(args.extraction),
        }),
        imageUrlAttachments: attachments.urls,
        imageFileAttachments: attachments.files,
      });
      return reply;
    };
    const currentTurnProjection = this.resolveOwnerImageProjectionForReply({
      plan: args.workingPlan,
      extraction: args.extraction,
      imageTurn: args.imageTurn,
    });
    let reply: ComposeReplyResult;
    let replyExtraction = args.extraction;
    let persistReason = args.imageTurn.kind === 'file' ? 'image_file_turn_processed' : 'image_url_turn_processed';
    // Available-path success consumes the pending work (the image answered
    // or continued it); only then may the curated pending question clear. A
    // fallback reply from other evidence keeps the question pending.
    let consumedPendingQuestion = false;
    let operationalNote =
      args.imageTurn.kind === 'file'
        ? `Image file projected natively (${redactedShape}). No bytes were stored in the plan; a visible voucher is evidence only, never payment proof.`
        : `Image URL projected natively (${redactedShape}). No bytes were stored; a visible voucher is evidence only, never payment proof.`;
    try {
      reply = await composeWithEvidence(
        {
          status: 'available',
          reason: null,
          captionPresent: args.imageTurn.captionPresent,
          source: args.imageTurn.kind,
          refStored: args.imageTurn.refStored,
        },
        currentTurnProjection,
      );
      this.recordDeterministicToolOutput(args.toolUsage, toolLabel, {
        reply_received: true,
        ref_stored: args.imageTurn.refStored,
      });
      consumedPendingQuestion = true;
    } catch (error) {
      // Credential failures propagate truthfully: no unavailable-evidence
      // fallback may mask an invalid provider key as an unreadable image.
      if (isAuthenticationFailure(error)) {
        this.recordDeterministicToolOutput(args.toolUsage, toolLabel, {
          stage: 'reply_failed_auth',
          error_name: error instanceof Error ? error.name : 'unknown',
          ref_stored: args.imageTurn.refStored,
        });
        throw error;
      }
      // S5: ONLY a typed image-access failure (invalid image payload,
      // download 404, exact download diagnostic) retries once without pixels.
      // Model composition/schema/guardrail errors, credentials,
      // quota/rate-limit, timeouts and server errors keep their actual
      // classification and rethrow here. Failure-kind validation only.
      if (!isImageFileAccessFailure(error)) {
        this.recordDeterministicToolOutput(args.toolUsage, toolLabel, {
          stage: 'reply_failed_non_image_access',
          error_name: error instanceof Error ? error.name : 'unknown',
          ref_stored: args.imageTurn.refStored,
        });
        throw error;
      }
      // The typed image-access failure becomes unavailable evidence when a
      // response is needed. Both attempts stay recorded; the label keeps the
      // reply_failed prefix so attempt accounting is stable.
      this.recordDeterministicToolOutput(args.toolUsage, toolLabel, {
        stage: 'reply_failed_file_access',
        error_name: error instanceof Error ? error.name : 'unknown',
        file_access: true,
        ref_stored: args.imageTurn.refStored,
      });
      replyExtraction = this.buildNeutralMediaExtraction('image_unavailable');
      reply = await composeWithEvidence(
        {
          status: 'unavailable',
          reason: 'image_unavailable',
          captionPresent: args.imageTurn.captionPresent,
          source: args.imageTurn.kind,
          refStored: args.imageTurn.refStored,
        },
        { urls: [], files: [] },
      );
      // R3: the retry keeps the failed attempt in totals instead of
      // overwriting it with success-only numbers.
      reply = this.withFallbackCallEvidence(error, reply);
      this.recordDeterministicToolOutput(args.toolUsage, toolLabel, {
        fallback_reply_received: true,
        ref_stored: args.imageTurn.refStored,
        // S5: the failed attempt never yields token usage, so the retry
        // usage is at most partial evidence — never a complete accounting.
        // Missing usage is recorded as unavailable, never zero.
        token_usage: reply.tokenUsage ? 'partial' : 'unavailable',
      });
      persistReason = args.imageTurn.kind === 'file' ? 'image_file_unavailable' : 'image_url_unavailable';
      operationalNote =
        `Image unavailable (${redactedShape}); answered from other evidence. State preserved, no payment effect.`;
    }
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    // R2 render-before-save: the outbound is rendered first so the
    // latest-response record carries this turn's successful rendered text.
    // Suppress/failure outbound records nothing and keeps pending state.
    const outbound = this.renderOutbound(
      reply, [], args.inbound.channel, args.workingPlan.conversation_id, args.workingPlan, args.toolUsage,
    );
    // S2: the curated pending question clears only on an available-path
    // reply that the model marks answered against this turn's pending task
    // with a verified send. Fallback (inaccessible-image), clarification,
    // suppress, origin-failure and changed-target turns keep it. The public
    // handleTurn wrapper finalizes the latest-response record centrally.
    const preTurnPendingQuestion = args.workingPlan.owner_pending_question ?? null;
    let planToSave = args.workingPlan;
    if (
      consumedPendingQuestion &&
      this.shouldClearPendingQuestion({
        preTurnPendingQuestion,
        structuredMessage: reply.structuredMessage,
        outbound,
      })
    ) {
      planToSave = this.clearAnsweredOwnerPendingQuestion(planToSave);
    }
    await this.dependencies.planStore.save({ plan: planToSave, reason: persistReason });
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    return {
      plan: planToSave,
      outbound,
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode: args.workingPlan.current_node,
        nodePath: args.previousNode === args.workingPlan.current_node
          ? [args.workingPlan.current_node]
          : [args.previousNode, args.workingPlan.current_node],
        extraction: replyExtraction,
        missingFields: args.workingPlan.missing_fields,
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason: persistReason,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        searchStrategy: 'none',
        operationalNote,
        capabilityDecision: args.capabilityDecision,
      }),
    };
  }

  /**
   * Minimum inbound-continuity reference shared by image and normal owner
   * calls. Reuses persisted pending refs, open questions, information
   * pending/completed state and real delivered history; introduces no new
   * store, no batch fields and no fragment-state machine. Failed or
   * suppressed turns never clear the pending refs they carry: preservation
   * holds by not overwriting, and no caller marks a question answered from
   * a failed or suppressed turn. Facts only, never reply prose.
   */
  private resolveContinuityProjection(
    plan: PlanSnapshot,
    messageContext: TurnMessageContext,
  ): ContinuityProjection {
    return {
      pendingQuestion: plan.owner_pending_question ?? plan.open_questions[0] ?? null,
      pendingTask: plan.owner_pending_task ?? null,
      hasPendingInformation: plan.information_state.pending_requests.length > 0,
      hasCompletedInformation: plan.information_state.last_completed_request != null,
      hasPriorOutbound: messageContext.continuity?.hasPriorOutbound ??
        messageContext.recentMessages.some((message) => message.direction === 'outbound'),
    };
  }

  /**
   * S2 centralized latest-response record. Builds last_outbound_context from
   * successful rendered model text only (with its constructed provenance).
   * Called solely by the public handleTurn wrapper after core result/render
   * verification. Suppress and failure outbound carry no text and return the
   * plan untouched, so a failed or suppressed turn never marks a pending
   * question answered and a truncated excerpt never proves an answer. No
   * image bytes are accepted.
   */
  private withLastOutboundContext(
    plan: PlanSnapshot,
    outbound: NormalizedOutboundMessage,
    inboundMessageId: string,
  ): PlanSnapshot {
    if (outbound.delivery.action !== 'send') return plan;
    if (typeof outbound.text !== 'string' || outbound.text.length === 0) return plan;
    const record = buildLastOutboundContext({
      messageId: inboundMessageId,
      text: outbound.text,
      recordedAt: new Date().toISOString(),
    });
    if (!record) return plan;
    return mergePlan(plan, { last_outbound_context: record });
  }

  /**
   * S2 fallback exposure. Merges the latest successful rendered response
   * into history when its real linkage is absent and no newer authoritative
   * outbound supersedes it. Old campaign or inbound-only messages are never
   * a reason to omit it. Original linkage travels as whatsappMessageId with
   * constructed status (typed constructed/truncated metadata lives on the
   * plan record); no magic id is used. Dedupe runs by message identity
   * (whatsappMessageId), then timestamp/order evidence. A truncated record
   * rides as context only, never as proof a question was answered.
   */
  private applyLastOutboundFallback(
    context: TurnMessageContext,
    plan: PlanSnapshot,
  ): TurnMessageContext {
    const last = plan.last_outbound_context;
    if (!last) return context;
    const recent = context.recentMessages;
    if (recent.some((message) => message.whatsappMessageId === last.message_id)) {
      return context;
    }
    const recordedMs = Date.parse(last.recorded_at);
    for (const message of recent) {
      if (message.direction !== 'outbound') continue;
      const sentMs = Date.parse(message.sentAt ?? message.createdAt ?? '');
      if (Number.isFinite(sentMs) && Number.isFinite(recordedMs) && sentMs >= recordedMs) {
        return context;
      }
    }
    const maxId = recent.reduce((max, message) => Math.max(max, message.id), 0);
    const merged = orderMessagesByServerTime([
      ...recent,
      {
        id: maxId + 1,
        direction: 'outbound' as const,
        source: null,
        body: last.text,
        status: 'constructed',
        whatsappMessageId: last.message_id,
        sentAt: last.recorded_at,
        createdAt: last.recorded_at,
      },
    ]);
    return {
      ...context,
      recentMessages: merged.slice(-recentConversationMessageLimit),
    };
  }

  /**
   * R2 unresolved-question persistence. Reuses owner_pending_question (no
   * second store) for a user question that needs later evidence (receipt
   * image, pending request outcome). Keeps only the inbound question text,
   * bounded. By default an already-pending question is never overwritten
   * (the earlier question came first and stays authoritative until
   * answered); evidence-seeking paths pass overwrite because this turn's
   * user question demonstrably needs the later image while any existing
   * value can only be this turn's clarification text (the clarification
   * itself is preserved in the latest-response record).
   */
  private stashOwnerPendingQuestion(
    plan: PlanSnapshot,
    inboundText: string,
    options?: { overwrite?: boolean },
  ): PlanSnapshot {
    const current = plan.owner_pending_question;
    if (options?.overwrite !== true && current !== null && current.trim().length > 0) return plan;
    const question = inboundText.trim();
    if (question.length === 0) return plan;
    const bounded = truncateTextToUtf8Bytes(question, MAX_LAST_OUTBOUND_TEXT_BYTES);
    if (bounded.text.length === 0) return plan;
    return mergePlan(plan, { owner_pending_question: bounded.text });
  }

  /**
   * Clears the curated pending question once a later turn answers it. Called
   * only on successful sends that consumed the pending work. Suppress and
   * failure paths never call this, so they never mark a question answered.
   */
  private clearAnsweredOwnerPendingQuestion(plan: PlanSnapshot): PlanSnapshot {
    if (plan.owner_pending_question === null) return plan;
    return mergePlan(plan, { owner_pending_question: null });
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

  /**
   * W1-10 L1: typed provider-selection evidence. A location or name reference
   * resolved from the retained shortlist (hints or id/title references).
   */
  private hasProviderSelectionEvidence(extraction: ExtractionResult): boolean {
    return (extraction.selectedProviderReferences?.length ?? 0) > 0 ||
      extraction.selectedProviderHints.length > 0;
  }

  /**
   * W1-10 L1: typed close-contact evidence. A name, email, or phone arriving
   * on the close node is close data for the close flow to persist.
   */
  private hasCloseContactField(extraction: ExtractionResult): boolean {
    return extraction.contactName !== null ||
      extraction.contactEmail !== null ||
      extraction.contactPhone !== null;
  }

  /**
   * W1-10 L1: auth-scoped capability operations. Only these yield to the
   * close-contact turn; any other unsupported operation stays intercepted.
   */
  private isAuthCapabilityOperation(operation: RuntimeOperationId): boolean {
    return operation === 'auth.phone' ||
      operation === 'auth.email_otp' ||
      operation === 'auth.phone_update.write' ||
      operation === 'auth.otp.send' ||
      operation === 'auth.otp.verify';
  }

  private hasFinishedCloseEvidence(plan: PlanSnapshot): boolean {
    return plan.provider_needs.some(
      (need) => (need.selected_provider_ids?.length ?? 0) > 0,
    );
  }

  /**
   * L3 invariant validation (E08). Model-produced ambiguity is authoritative
   * semantic evidence: an ambiguous status with purchase/support
   * interpretations stays ambiguous until new user evidence resolves it. This
   * step only validates the evidence shape (defaults, interpretation and
   * candidate caps). It never clears ambiguity and never converts one
   * executable request into another.
   *
   * Override classification for this lane:
   * - removed reinterpretation: blanket ambiguous-to-clear flip for
   *   non-faq information requests (Carina stays ambiguous until clarified).
   * - kept preservation: support ask_policy to faq execution (same user
   *   query text, no new semantics), last-completed replay of persisted
   *   typed requests on empty deltas, ID/reference normalization.
   * - kept validation: isExplicitHumanRequest/isSupportWinOverHuman typed
   *   guards, phone-confirmation relevance, auth decline routing.
   */
  private normalizeInformationExtractionAmbiguity(
    extraction: ExtractionResult,
  ): ExtractionResult {
    const ambiguity = extraction.ambiguity ?? {
      status: 'clear' as const,
      clarificationQuestion: null,
      interpretations: [],
      candidateOperations: [],
      questionKey: null,
    };
    return {
      ...extraction,
      ambiguity: {
        status: ambiguity.status,
        clarificationQuestion: ambiguity.clarificationQuestion ?? null,
        interpretations: (ambiguity.interpretations ?? []).slice(0, 3),
        candidateOperations: (ambiguity.candidateOperations ?? []).slice(0, 3),
        questionKey: ambiguity.questionKey ?? null,
      },
    };
  }

  /**
   * L4 customer operations projection for the reply model. Assembles the
   * typed snapshot from this turn's authorized bounded reads (the existing
   * orchestrator execution through the authorized cache/gateway path) and
   * projects only current-question-relevant detail: a payment question never
   * receives cart facts and a cart question never receives payment details.
   * Returns null when there is no authorized identity or no customer work,
   * so unrelated turns stay byte-identical. No profile model is introduced
   * and the whole snapshot is never sent.
   *
   * S7: before assembly, performs bounded asynchronous linked-detail
   * enrichment (authorized order -> gift detail; invitation/event -> event
   * detail) through the existing orchestrator access checks and
   * already-fetched IDs, within two edges / four reads / per-turn
   * access-scoped visited-cache / shared invocation deadline. Inline
   * payment/items/venue/address fields expand as typed data without another
   * HTTP call. Optional failures never block ready facts; required
   * unavailable detail stays explicitly unavailable in enrichment metadata.
   */
  private async resolveCustomerContextForReply(args: {
    plan: PlanSnapshot;
    extraction: ExtractionResult;
    requests: PendingInformationRequest[];
    informationResults: InformationTaskResult[];
    informationSummaries: InformationExecutionSummary[];
    contactPhone: string | null | undefined;
    orchestrator?: InformationOrchestrator | null;
    authentication?: InformationAuthentication | null;
    deadlineMs?: number | null;
  }): Promise<CustomerContextProjection | null> {
    const purchaseRequests = args.requests.filter(
      (request): request is Extract<PendingInformationRequest, { kind: 'purchase' }> =>
        request.kind === 'purchase',
    );
    const eventRequests = args.requests.filter((request) => request.kind === 'associated_event');
    const hasRsvpSignals = args.extraction.actionIntent === 'responder_invitacion' ||
      (args.extraction.rsvpAction !== null && args.extraction.rsvpAction !== undefined) ||
      (args.extraction.rsvpCandidateGuestId !== null && args.extraction.rsvpCandidateGuestId !== undefined) ||
      (args.extraction.rsvpEventReference !== null && args.extraction.rsvpEventReference !== undefined) ||
      (args.extraction.rsvpParty !== null && args.extraction.rsvpParty !== undefined);
    if (purchaseRequests.length === 0 && eventRequests.length === 0 && !hasRsvpSignals) {
      return null;
    }
    const trustedPhone = splitInternationalPhone(args.contactPhone ?? null);
    const nowIso = new Date().toISOString();
    const identity = trustedPhone
      ? {
        customerRef: (args.contactPhone ?? '').trim(),
        scope: 'trusted_phone',
        source: 'channel_contact_phone',
        fetchedAt: nowIso,
      }
      : hasValidUserAuthToken(args.plan) && args.plan.user_auth.email
        ? {
          customerRef: args.plan.user_auth.email,
          scope: 'account',
          source: 'authenticated_account',
          fetchedAt: nowIso,
        }
        : null;
    if (!identity) return null;
    const relevantOrderIds = Array.from(new Set(purchaseRequests.flatMap((request) => {
      const normalized = normalizeExtractedOrderReference(request.orderId);
      return normalized ? [normalized] : [];
    })));
    const relevantEventIds = Array.from(new Set([
      ...purchaseRequests.flatMap((request) => request.eventHint?.trim() ? [request.eventHint.trim()] : []),
      ...eventRequests.flatMap((request) => request.eventHint?.trim() ? [request.eventHint.trim()] : []),
    ]));
    const knownOrderIds = Array.from(new Set(args.informationResults.flatMap((result) => {
      if (result.status !== 'completed' || result.kind !== 'purchase') return [];
      return result.purchases.map((purchase) => purchase.orderId);
    })));
    const knownEventEntries = args.informationResults.flatMap((result) => {
      if (result.status !== 'completed' || result.kind !== 'associated_event') return [];
      return result.result.events.flatMap((event) =>
        event.eventId === null || event.eventId === undefined
          ? []
          : [{ id: event.eventId as number | string, name: event.name ?? null } as const],
      );
    });
    const knownEventIds = Array.from(new Set(args.informationResults.flatMap((result) => {
      if (result.status !== 'completed' || result.kind !== 'associated_event') return [];
      return result.result.events.flatMap((event) => event.eventId === null || event.eventId === undefined ? [] : [event.eventId]);
    })));
    const target = resolveRelevantTarget({
      orderIds: knownOrderIds,
      eventIds: knownEventIds,
      relevantOrderIds,
      relevantEventIds,
    });
    const focus = this.deriveCustomerProjectionFocus(purchaseRequests, hasRsvpSignals);
    const explicitOrderId = relevantOrderIds[0] ?? null;
    const explicitEventHint = relevantEventIds[0] ?? null;
    // Unresolved candidates stay discoverable for a focused read or
    // clarification, ordered explicit-first (explicit reference dominates
    // observed state and recency; recency only breaks ties). Nothing is
    // dropped, so an older explicit target is never hidden by newer history.
    // No pending/answered tracking is added here: continuity reuses the
    // existing pending-request and outbound-history state.
    let unresolvedCandidateOrderIds: string[] = [];
    let unresolvedCandidateEventIds: (number | string)[] = [];
    if (target.kind === 'candidates') {
      const knownPurchasesById = new Map(args.informationResults.flatMap((result) => {
        if (result.status !== 'completed' || result.kind !== 'purchase') return [];
        return result.purchases.map((purchase) => [purchase.orderId, purchase] as const);
      }));
      unresolvedCandidateOrderIds = rankCandidatesByRelevance(
        target.orderIds.map((orderId) => {
          const known = knownPurchasesById.get(orderId);
          return {
            orderId,
            eventName: known?.eventName ?? null,
            paymentStatus: known?.paymentStatus ?? null,
            createdAt: known?.createdAt ?? null,
            eventDate: known?.eventDate ?? null,
          };
        }),
        { explicitOrderId, explicitEventHint, questionFocus: focus },
      ).map((candidate) => candidate.orderId);
      const knownEventsById = new Map(args.informationResults.flatMap((result) => {
        if (result.status !== 'completed' || result.kind !== 'associated_event') return [];
        return result.result.events.flatMap((event) =>
          event.eventId === null || event.eventId === undefined
            ? []
            : [[String(event.eventId), event] as const],
        );
      }));
      unresolvedCandidateEventIds = rankCandidatesByRelevance(
        target.eventIds.map((eventId) => {
          const known = knownEventsById.get(String(eventId));
          return {
            orderId: String(eventId),
            eventName: known?.name ?? null,
            paymentStatus: null,
            createdAt: known?.datetime ?? null,
            eventDate: known?.datetime ?? null,
          };
        }),
        { explicitOrderId, explicitEventHint, questionFocus: focus },
      ).map((candidate) => {
        const original = target.eventIds.find((id) => String(id) === candidate.orderId);
        return original ?? candidate.orderId;
      });
    }
    // S7 same-turn reuse: an explicit target whose completed result already
    // carries gift detail (fetched through the gift_purchases route earlier
    // in this turn) or event detail (hydrated `detail` on the event) is
    // excluded so enrichment never re-issues that read. Orders fetched only
    // through the summary route still qualify for gift-detail enrichment.
    const detailedOrderIds = Array.from(new Set(args.informationResults.flatMap((result) => {
      if (result.status !== 'completed' || result.kind !== 'purchase') return [];
      const resource = (result as { resource?: unknown }).resource;
      const lookupResource = (result as { lookupResource?: unknown }).lookupResource;
      if (resource !== 'gift_purchases' && lookupResource !== 'gift_purchases') return [];
      return result.purchases.map((purchase) => purchase.orderId);
    })));
    const detailedEventIds = Array.from(new Set(args.informationResults.flatMap((result) => {
      if (result.status !== 'completed' || result.kind !== 'associated_event') return [];
      return result.result.events.flatMap((event) =>
        event.eventId === null || event.eventId === undefined || event.detail == null
          ? []
          : [event.eventId],
      );
    })));
    const enrichmentTargets = selectEnrichmentTargets({
      knownOrderIds,
      knownEventIds,
      relevantOrderIds,
      relevantEventIds: this.resolveExplicitEventIds(knownEventEntries, relevantEventIds),
      alreadyDetailedOrderIds: detailedOrderIds,
      alreadyDetailedEventIds: detailedEventIds,
    });
    let enrichedResults = args.informationResults;
    let enrichment: CustomerEnrichmentSummary | null = null;
    if (
      (enrichmentTargets.orderIds.length > 0 || enrichmentTargets.eventIds.length > 0) &&
      args.orchestrator
    ) {
      const trustedPhone = splitInternationalPhone(args.contactPhone ?? null);
      const accessScope = enrichmentScopeKey(identity.scope ?? 'unknown', identity.customerRef);
      try {
        // S7 per-turn reuse: seed the visited set with the access-scoped keys
        // of reads already completed this turn so the orchestrator never
        // re-issues them (the orchestrator's own visited dedupe applies once
        // the set is shared instead of fresh per call). Bounds, the shared
        // invocation deadline and depth are unchanged.
        const visited = new Set<string>();
        for (const orderId of detailedOrderIds) {
          visited.add(enrichmentVisitKey('order', orderId, accessScope));
        }
        for (const eventId of detailedEventIds) {
          visited.add(enrichmentVisitKey('event', eventId, accessScope));
        }
        const linked = await args.orchestrator.enrichCustomerLinkedDetail({
          orderIds: enrichmentTargets.orderIds,
          eventIds: enrichmentTargets.eventIds,
          authentication: args.authentication ?? null,
          trustedPhone,
          scope: accessScope,
          detailCache: new Map(),
          visited,
          deadlineMs: args.deadlineMs ?? null,
          depth: 1,
        });
        enrichedResults = this.mergeLinkedEnrichment(args.informationResults, linked);
        enrichment = {
          readsAttempted: linked.readsAttempted,
          truncatedByBound: enrichmentTargets.truncatedByBound || linked.truncatedByBound,
          unavailable: [...linked.unavailable],
          failures: linked.failures.map((failure) => ({ ...failure })),
        };
      } catch {
        enrichment = {
          readsAttempted: 0,
          truncatedByBound: enrichmentTargets.truncatedByBound,
          unavailable: [],
          failures: [],
        };
      }
    } else if (enrichmentTargets.truncatedByBound) {
      enrichment = {
        readsAttempted: 0,
        truncatedByBound: true,
        unavailable: [],
        failures: [],
      };
    }
    const snapshot = assembleCustomerContext({
      execution: { results: enrichedResults, summaries: args.informationSummaries },
      identity,
      currentContext: {
        relevantEventIds,
        relevantOrderIds,
        pendingQuestion: args.plan.open_questions[0] ??
          args.plan.owner_pending_question ??
          null,
        unresolvedCandidateOrderIds,
        unresolvedCandidateEventIds,
      },
      nowIso,
    });
    return projectCustomerContext(snapshot, {
      focus,
      relevantOrderIds,
      relevantEventIds,
    }, enrichment);
  }

  /**
   * S7 single-copy merge of bounded linked detail into the already-fetched
   * execution. Gift purchases merge into their matching order (inline
   * payment/items/dedication/thanks expand without another HTTP call);
   * unmatched gift rows are ignored so unrelated history never expands.
   * Event details hydrate matching invitation venues (city/country/name plus
   * typed detail) without inventing a street: missing street stays
   * country_only downstream. Pure merge, no writes, sparse single-copy.
   */
  private mergeLinkedEnrichment(
    results: InformationTaskResult[],
    linked: {
      readonly giftPurchases: readonly PurchaseInformation[];
      readonly eventDetails: ReadonlyMap<number, HydratedEventDetail>;
    },
  ): InformationTaskResult[] {
    if (linked.giftPurchases.length === 0 && linked.eventDetails.size === 0) {
      return results;
    }
    const giftByOrderId = new Map(
      linked.giftPurchases.map((purchase) => [purchase.orderId, purchase] as const),
    );
    return results.map((result) => {
      if (result.status !== 'completed') return result;
      if (result.kind === 'purchase') {
        let changed = false;
        const purchases = result.purchases.map((purchase) => {
          const enriched = giftByOrderId.get(purchase.orderId);
          if (!enriched) return purchase;
          changed = true;
          const inline = expandInlinePurchaseDetail(enriched);
          return {
            ...purchase,
            paymentStatus: inline.paymentStatus ?? purchase.paymentStatus,
            grandTotal: purchase.grandTotal,
            paymentMethod: purchase.paymentMethod,
            eventName: inline.eventName ?? purchase.eventName,
            eventDate: inline.eventDate ?? purchase.eventDate,
            eventUrl: inline.eventUrl ?? purchase.eventUrl,
            items: inline.items.length > 0 ? inline.items : purchase.items,
            payment: inline.payment ?? purchase.payment,
            dedication: inline.dedication ?? purchase.dedication,
            thanks: inline.thanks ?? purchase.thanks,
            isThanked: inline.isThanked ?? purchase.isThanked,
          };
        });
        return changed ? { ...result, purchases } : result;
      }
      if (result.kind === 'associated_event') {
        let changed = false;
        const events = result.result.events.map((event) => {
          if (event.eventId === null || event.eventId === undefined) return event;
          const detail = linked.eventDetails.get(Number(event.eventId));
          if (!detail) return event;
          changed = true;
          return {
            ...event,
            name: detail.event.name ?? event.name,
            place: detail.event.city ?? event.place,
            country: detail.event.country ?? event.country,
            ...(detail.event.city || detail.event.country
              ? {
                detail: {
                  withTime: detail.event.withTime,
                  timezone: detail.event.timezone,
                  city: detail.event.city,
                  celebrateds: detail.event.celebrateds,
                  moments: detail.event.moments,
                  dresscode: detail.event.dresscode,
                  commonAsked: detail.event.commonAsked,
                  contactInfo: detail.event.contactInfo,
                },
              }
              : {}),
          };
        });
        return changed ? { ...result, result: { ...result.result, events } } : result;
      }
      return result;
    });
  }

  /**
   * S7 hint-to-ID resolution among already-authorized summaries only. An
   * explicit numeric reference matches by ID; an event-name hint matches by
   * the shared event matcher against known authorized names. A name never
   * authorizes a new lookup: hints without a known match resolve to nothing
   * so ambiguous turns enrich nothing. No date cutoff, no recency.
   */
  private resolveExplicitEventIds(
    knownEvents: ReadonlyArray<{ readonly id: number | string; readonly name: string | null }>,
    hints: readonly string[],
  ): (number | string)[] {
    const resolved: (number | string)[] = [];
    for (const hint of hints) {
      const trimmed = hint.trim();
      if (!trimmed) continue;
      const idMatch = knownEvents.find((entry) => String(entry.id) === trimmed);
      if (idMatch) {
        resolved.push(idMatch.id);
        continue;
      }
      for (const entry of knownEvents) {
        if (eventMatches(entry.name, trimmed)) {
          resolved.push(entry.id);
        }
      }
    }
    return Array.from(new Set(resolved.map((id) => String(id)))).map(
      (key) => knownEvents.find((entry) => String(entry.id) === key)?.id ?? key,
    );
  }

  /**
   * S6 typed focus for minimum disclosure. Cart relevance comes ONLY from
   * structured purchase aspects/query evidence expressing checkout/cart work
   * (the `payment_options` aspect the extractor emits for cart checkout and
   * payment-option questions). Image presence, support continuations and
   * voucher reports are never cart-intent proxies: a payment question with
   * an image stays payment-focused, and payment+receipt / payment+thanks
   * (dedication/thanks aspects) stay payment-focused. An explicit cart
   * checkout is supported; a request genuinely about both receives both
   * (general). No keyword detection, no new classifier.
   */
  private deriveCustomerProjectionFocus(
    purchaseRequests: ReadonlyArray<{ aspects: readonly PurchaseAspect[] }>,
    hasRsvpSignals: boolean,
  ): CustomerProjectionFocus {
    const hasPurchaseWork = purchaseRequests.length > 0;
    if (hasRsvpSignals && !hasPurchaseWork) return 'rsvp';
    const orderAspects: ReadonlySet<string> = new Set([
      'summary',
      'payment_status',
      'payment_details',
      'validation_window',
      'shipping',
      'dedication',
      'thanks',
      'decline',
    ]);
    const orderSignal = purchaseRequests.some((request) =>
      request.aspects.some((aspect) => orderAspects.has(aspect)),
    );
    const cartSignal = purchaseRequests.some((request) =>
      request.aspects.some((aspect) => aspect === 'payment_options'),
    );
    if (orderSignal && !cartSignal) return 'payment';
    if (cartSignal && !orderSignal) return 'cart';
    return 'general';
  }

  /**
   * Explicit relevant attachment selection. Only references linked to the
   * current inbound message travel to the model; stored references from
   * earlier turns are never resent on recency alone. Later-turn reuse needs
   * demonstrated linkage, which this turn does not claim.
   */
  private selectRelevantImageAttachments(
    plan: PlanSnapshot,
    currentMessageId: string,
  ): Array<{ url: string; messageId: string }> {
    return (plan.image_attachments ?? [])
      .filter((ref): ref is Extract<ImageAttachmentRef, { kind: 'url' }> =>
        ref.kind === 'url' && ref.messageId === currentMessageId)
      .map((ref) => ({ url: ref.url, messageId: ref.messageId }));
  }

  /**
   * Single-image ambiguity resolution for the information skip. When the
   * extractor linked the question to one prior image (prior_single), the
   * image itself is the answerable target: an available image lets the model
   * answer from pixels plus record (a visible receipt is described, never
   * confirmed as approval), and an expired reference states unreadability as
   * an answerable fact with the record behind it. Only genuine
   * multi-candidate ambiguity (no single linked image) skips execution to
   * ask. Typed linkage only; image-turn gates are untouched.
   */
  private priorSingleImageResolvesAmbiguity(extraction: ExtractionResult): boolean {
    return (extraction.imageReference?.status ?? 'none') === 'prior_single';
  }

  /**
   * Mixed-availability ambiguity carrying an available servable read does
   * not divert the information flow to a clarification question when a live
   * purchase/event request can serve the fact: the lookup executes and the
   * record answers. Typed candidate IDs, manifest availability and request
   * kinds only; no phrase detection, no new state.
   */
  private availableReadServesAmbiguousRequest(extraction: ExtractionResult): boolean {
    const candidates = extraction.ambiguity?.candidateOperations ?? [];
    if (candidates.length === 0) return false;
    const hasLiveRequest = extraction.informationRequests.some((request) =>
      request.kind === 'purchase' || request.kind === 'associated_event');
    if (!hasLiveRequest) return false;
    return candidates.some((candidate) =>
      isServableInformationRead(candidate) &&
      this.capabilityManifest[candidate]?.available === true);
  }

  /**
   * Approval-boundary ambiguity carries an answerable record question, not a
   * genuine choice. A status_or_proof_review ambiguity asks which of two
   * invented tasks was intended, but the receipt amount alone never proves
   * approval and the record shows whether any purchase stands approved. When
   * typed receipt context exists (retained image attachments, an image
   * reference, a live purchase/event request, or a last-completed
   * purchase/event read) and a purchase read capability is available, the
   * lookup executes and the record answers instead of asking. Typed evidence
   * only; no phrase detection, no new state.
   */
  private approvalBoundaryServesAmbiguousRequest(args: {
    extraction: ExtractionResult;
    plan: PlanSnapshot;
  }): boolean {
    const ambiguity = args.extraction.ambiguity;
    if (ambiguity?.status !== 'ambiguous') return false;
    if (ambiguity.questionKey !== 'status_or_proof_review') return false;
    const receiptContext =
      (args.plan.image_attachments?.length ?? 0) > 0 ||
      (args.extraction.imageReference != null &&
        args.extraction.imageReference.status !== 'none') ||
      args.extraction.informationRequests.some((request) =>
        request.kind === 'purchase' || request.kind === 'associated_event') ||
      args.plan.information_state.last_completed_request?.kind === 'purchase' ||
      args.plan.information_state.last_completed_request?.kind === 'associated_event';
    if (!receiptContext) return false;
    return this.capabilityManifest['purchase.orders.read']?.available === true ||
      this.capabilityManifest['purchase.gift_detail.read']?.available === true;
  }

  /**
   * Reply-input reconciliation for the approval boundary (mirror of the
   * runtime ambiguity/context projection, both delegating to the
   * single-owner predicate in purchase-reconciliation). When a
   * status_or_proof_review ambiguity reaches composition, the record
   * already answers whether any purchase stands approved: a completed
   * outcome (even an empty one) always settles it, a scoped attempted read
   * that found nothing settles it when retained receipt context is
   * present, and the established receipt boundary settles it even when no
   * purchase read executed — the reply answers from receipt guidance
   * instead of asking which task was meant. Returns the extraction with
   * that answered ambiguity cleared; anything else returns it unchanged.
   * Intake normalization still never clears ambiguity; only this
   * evidence-bound reply projection does.
   */
  private reconcileApprovalBoundaryAmbiguity(args: {
    extraction: ExtractionResult;
    informationResults: InformationTaskResult[];
    imageEvidence: ComposeReplyRequest['imageEvidence'];
    plan: PlanSnapshot;
  }): ExtractionResult {
    const ambiguity = args.extraction.ambiguity;
    if (ambiguity?.status !== 'ambiguous') return args.extraction;
    if (ambiguity.questionKey !== 'status_or_proof_review') return args.extraction;
    // Single-owner predicate in purchase-reconciliation: the record (or the
    // established receipt boundary when no purchase read executed) settles
    // whether any purchase stands approved. Intake normalization still never
    // clears ambiguity; only this evidence-bound reply projection does.
    const receiptContext =
      args.imageEvidence != null ||
      (args.plan.image_attachments?.length ?? 0) > 0 ||
      (args.extraction.imageReference != null &&
        args.extraction.imageReference.status !== 'none');
    const answeredByRecord = isApprovalBoundaryAnsweredByRecord({
      informationResults: args.informationResults,
      receiptContext,
    });
    if (!answeredByRecord) return args.extraction;
    return {
      ...args.extraction,
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
    imageTurn?: ImageTurnContext;
  }): Promise<HandleTurnResponse> {
    const declined = args.extraction.informationRequests.some((request) =>
      (request.kind === 'purchase' || request.kind === 'associated_event') && request.authAction === 'decline_authentication');
    const hasPhoneIdentity = args.workingPlan.user_auth.auth_method === 'phone' ||
      args.workingPlan.user_auth.awaiting_phone_confirmation;
    if (args.extraction.phoneConfirmation === 'no' && (hasPhoneIdentity || !declined) ||
      (declined && hasPhoneIdentity)) {
      // Identity rejection wins over provider clarification and conflicting
      // support detail. Persist terminal refusal so no OTP can reopen it.
      // A declined protected request on an established phone identity rejects
      // that association even without an explicit phone denial: no other
      // authentication can continue on the rejected identity, so the pending
      // question is preserved for the human handoff. Pure refusals without a
      // phone identity still close below with no forced handoff.
      const rejectedBase = this.persistTerminalRecovery(args.workingPlan, 'auth_refused');
      return await this.escalateInformationAuthentication({ ...args,
        plan: this.clearPhoneAuthentication(rejectedBase, 'identity_rejected'), reason: 'identity_rejected' });
    }
    if (declined) {
      return await this.completeDeclinedInformationAuthentication({ ...args, plan: args.workingPlan,
        resumeNode: args.workingPlan.information_state.resume_node,
        requests: this.mergeInformationRequests(args.workingPlan.information_state.pending_requests, args.extraction.informationRequests) });
    }
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
    // A typed purchase-status policy question is a record question, not a
    // KB question: synthesize a purchase status read so the verified record
    // outcome reaches the reply through the existing aspect machinery. Other
    // ask_policy topics keep the support-policy FAQ synthesis untouched.
    const supportAct = args.extraction.supportAct;
    if (supportAct?.kind === 'ask_policy' && supportAct.topic === 'purchase_status' &&
      !requests.some((request) => request.kind === 'purchase')) {
      requests = [{
        kind: 'purchase',
        resource: 'orders',
        query: args.inbound.text,
        orderId: null,
        aspects: ['payment_status'],
        sensitiveFields: [],
        authAction: 'none',
        requestId: 'support-policy',
      }, ...requests];
    } else if (supportAct?.kind === 'ask_policy' && supportAct.topic !== 'purchase_status' &&
      !requests.some((request) => request.kind === 'faq')) {
      requests = [{
        kind: 'faq',
        query: args.inbound.text,
        requestId: 'support-policy',
      }, ...requests];
    }
    // Approval-boundary record read: a status_or_proof_review ambiguity on
    // retained receipt context without any purchase/event request still needs
    // the record to answer whether anything stands approved. Synthesize the
    // scoped status read through the existing aspect machinery so the
    // boundary is answered from evidence instead of asking which of two
    // invented tasks was intended. Typed ambiguity plus plan evidence only;
    // acknowledgements synthesize nothing.
    if (
      !supportAcknowledgment &&
      !requests.some((request) =>
        request.kind === 'purchase' || request.kind === 'associated_event') &&
      this.approvalBoundaryServesAmbiguousRequest({
        extraction: args.extraction,
        plan: planWithContact,
      })
    ) {
      requests = [{
        kind: 'purchase',
        resource: 'orders',
        query: args.inbound.text,
        orderId: null,
        aspects: ['payment_status'],
        sensitiveFields: [],
        authAction: 'none',
        requestId: 'approval-boundary',
      }, ...requests];
    }
    const replayingLastCompletedRequest = false;
    const continuingLastCompletedRequest = Boolean(
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

    // R4: a structured provide_detail.eventReference continues the uniquely
    // identified pending withdrawal request. Preserve ID/subject/host role;
    // no event-name keyword inference. Mere thanks/deferral without detail
    // still acknowledges below; ambiguous targets stay ambiguous.
    const withdrawalDetailRef = args.extraction.supportAct?.kind === 'provide_detail'
      ? args.extraction.supportAct.eventReference?.trim() ?? null
      : null;
    const pendingWithdrawalAnchors = planWithContact.information_state.pending_requests.filter(
      (request) => request.kind === 'faq' && request.hostWithdrawal,
    );
    const hasUniqueWithdrawalAnchor = pendingWithdrawalAnchors.length === 1 &&
      withdrawalDetailRef !== null && withdrawalDetailRef.length > 0 &&
      args.extraction.ambiguity?.status !== 'ambiguous';
    if (supportAcknowledgment && !supportContinuesPurchaseThread && hasUniqueWithdrawalAnchor) {
      const anchor = pendingWithdrawalAnchors[0];
      if (anchor?.kind === 'faq') {
        const resumedWithdrawal = { ...anchor, eventHint: withdrawalDetailRef };
        const resumedRequests = planWithContact.information_state.pending_requests.map((request) =>
          request.kind === 'faq' && request.hostWithdrawal && request.requestId === anchor.requestId
            ? resumedWithdrawal
            : request,
        );
        const resumedPlan = mergePlan(planWithContact, {
          current_node: currentNode,
          information_state: {
            ...planWithContact.information_state,
            resume_node: resumeNode,
            pending_requests: resumedRequests,
            selection_candidates: planWithContact.information_state.selection_candidates,
            last_completed_request: lastCompletedRequest ?? null,
          },
        });
        const resumedExtraction: ExtractionResult = {
          ...args.extraction,
          informationRequests: [{
            kind: 'faq',
            query: resumedWithdrawal.query,
            hostWithdrawal: resumedWithdrawal.hostWithdrawal ?? null,
            eventHint: resumedWithdrawal.eventHint ?? null,
          }],
        };
        return this.handleHostWithdrawalInformation(
          { ...args, extraction: resumedExtraction },
          resumedPlan,
          resumedRequests,
        );
      }
    }

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
      !isRetiredPhoneConfirmationRecovery &&
      !this.priorSingleImageResolvesAmbiguity(args.extraction) &&
      !this.availableReadServesAmbiguousRequest(args.extraction) &&
      !this.approvalBoundaryServesAmbiguousRequest({
        extraction: args.extraction,
        plan: planForInformation,
      });
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
    const protectedAuthAction = requests
      .filter((request) => request.kind === 'purchase' || request.kind === 'associated_event')
      .map((request) => request.authAction ?? 'none')
      .find((action) => action !== 'none') ?? 'none';
    if (protectedAuthAction === 'decline_authentication') {
      return await this.completeDeclinedInformationAuthentication({
        ...args,
        plan: planForInformation,
        resumeNode,
        requests,
      });
    }

    // Seed typed recovery once, then merge monotonically. Terminal is checked
    // after extraction/normalization and before any email/OTP recovery,
    // regardless of escalation status or six-digit presence. Rejection and
    // refusal precedence is kept above; unrelated public questions route
    // normally below without clearing the record.
    planForInformation = this.withSeededAuthRecovery(planForInformation);
    const effectiveRecovery = this.effectiveAuthRecovery(planForInformation);
    const hasProtectedWork = this.hasProtectedInformationWork(requests);
    const inboundCode = this.extractUserLoginCode(args.inbound.text);

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
      const terminalPlan = mergePlan(
        this.persistTerminalRecovery(planForInformation, otpTerminalContinuation),
        {
          user_auth: {
            otp_non_delivery_reports:
              protectedAuthAction === 'report_otp_not_received'
                ? planForInformation.user_auth.otp_non_delivery_reports + 1
                : planForInformation.user_auth.otp_non_delivery_reports,
          },
        },
      );
      return await this.escalateInformationAuthentication({
        ...args,
        plan: terminalPlan,
        reason: otpTerminalContinuation,
      });
    }

    // An email-change request on a challenged episode ends recovery instead
    // of collecting alternative addresses.
    if (protectedAuthAction === 'change_email' && effectiveRecovery.sendAttempted) {
      return await this.escalateInformationAuthentication({
        ...args,
        plan: this.persistTerminalRecovery(planForInformation, 'email_change_requested'),
        reason: 'email_change_requested',
      });
    }

    // Already-terminal episodes stay terminal: protected continuations and
    // codes retain the human path with no verify/send/retry copy. Failed,
    // skipped, and unknown handoffs cannot reset recovery here. The exact
    // persisted terminal reason travels through; never overwrite it with a
    // generic non-delivery label.
    if (effectiveRecovery.terminalReason !== null && (hasProtectedWork || inboundCode !== null)) {
      return await this.escalateInformationAuthentication({
        ...args,
        plan: planForInformation,
        reason: effectiveRecovery.terminalReason,
      });
    }

    if ((args.extraction.normalizationIssues?.length ?? 0) > 0) {
      operationalNote = 'La solicitud de soporte fue reconocida, pero no se pudo determinar de forma segura qué tipo de información de compra se necesita. Haz una sola pregunta breve para aclararlo. No des la bienvenida ni pidas correo o código todavía.';
    } else if (hasActionConflict) {
      operationalNote =
        'El mensaje combina una acción del plan con consultas informativas. Haz una sola pregunta breve para confirmar cuál quiere resolver primero. No ejecutes ni respondas ninguna de las dos rutas todavía.';
    } else if (hasAmbiguity) {
      operationalNote = null;
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
            // R7 accountless disambiguation: the phone-scoped lookup must
            // run whenever a contact phone is known. Fall back to the
            // persisted plan phone when the inbound turn carries none, so
            // an accountless turn executes instead of asking.
            trustedPhone: args.extraction.phoneConfirmation === 'no'
              ? null
              : splitInternationalPhone(args.inbound.contactPhone) ??
                splitInternationalPhone(planForInformation.contact_phone ?? null),
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
      // Narrowed auto-handoff on phone-scoped miss: never escalate when
      // retained media can answer the turn, and only escalate when the
      // authorization genuinely involves user-supplied identity (inbound
      // phone, active auth, or an explicit human request). Anonymous misses
      // and media-answerable turns fall through to the normal reply path.
      const hasRetainedMediaForMiss = Boolean(args.imageTurn) ||
        (planForInformation.image_attachments?.length ?? 0) > 0 ||
        (args.extraction.imageReference != null && args.extraction.imageReference.status !== 'none');
      const missRequiresUserAuthorization = Boolean(args.inbound.contactPhone?.trim()) ||
        planForInformation.user_auth.status !== 'none' ||
        this.isExplicitHumanRequest(planForInformation, args.extraction);
      if (onlyPhoneScopedMisses && !hasRetainedMediaForMiss && missRequiresUserAuthorization) {
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
        const isSingleStatusQuery = phonePurchaseResult.purchases.length === 1 && !asksExplicitAmount &&
          requests.filter((request) => request.kind === 'purchase').every((request) =>
            request.kind === 'purchase' && request.aspects.length === 1 && request.aspects[0] === 'payment_status');
        if (isSingleStatusQuery) {
          operationalNote += ' Responde de forma concisa solo el estado (pendiente/en verificación o aprobado/confirmado) para el evento consultado, en español natural. No menciones monto, método de pago, moneda, registro ni plazos de validación.';
        }
        // S6: no TypeScript phrase template here. The projected order view
        // already carries the trusted total, recorded method and currency
        // provenance as typed facts (amountDisclosure presentation), and the
        // node response contract owns the presentation policy. Facts only.
        const hasUnverifiableTransactionTime = phonePurchaseResult.purchases.some(
          (purchase) =>
            purchase.paymentValidationExpectation !== undefined &&
            purchase.paymentValidationExpectation !== null &&
            !purchase.payment?.paidAt,
        );
        // R6: a status-only question carries no method/policy directions.
        if (hasUnverifiableTransactionTime && !isSingleStatusQuery) {
          operationalNote += ' La evidencia canónica no verifica una fecha u hora de pago. Si la persona propone una corrección temporal, reconócela solo como dato aportado por ella; no afirmes que el registro o el backend la confirma.';
        }
        // C1 grounded-correction framing: when the record carries no
        // currency (presentation recorded_method_no_currency), a currency
        // the person asserts is their own correction, never a backend
        // confirmation. The record timestamp, when present, has no verified
        // time zone, so an exact local date/time must never be claimed.
        const hasUnconfirmedRecordCurrency = !isSingleStatusQuery && phonePurchaseResult.purchases.some(
          (purchase) => purchase.amountDisclosure?.presentation === 'recorded_method_no_currency',
        );
        if (!isSingleStatusQuery && (hasUnverifiableTransactionTime || hasUnconfirmedRecordCurrency)) {
          operationalNote += ' Si la persona corrige la moneda o la fecha y hora, reconoce su corrección como dato aportado por ella y explica que esos dos detalles no pueden confirmarse con el registro disponible; no inventes moneda ni zona horaria.';
        }
        const hasCustomerTransactionNumber = phonePurchaseResult.purchases.some(
          (purchase) => Boolean(purchase.customerTransactionNumber),
        );
        if (hasCustomerTransactionNumber) {
          operationalNote += ' Nunca afirmes que no existe constancia o comprobante; no comentes fecha u hora de pago salvo que la persona lo pregunte.';
        }
        // Typed purchase facts (paymentStatus, paymentValidationExpectation)
        // travel on the projected result; the node response contract owns
        // their presentation, so no advisory prose is appended here.
        // C1 purchase selection framing: candidates are record data only.
        // Present each with its projected distinguishing fields, ask one
        // explicit question naming which purchase is meant, and never infer
        // invitations, attendance, or event associations beyond the record.
        if (!isSingleStatusQuery && phonePurchaseResult.needsSelection) {
          operationalNote += ' Hay varias compras registradas y se necesita que la persona elija una: presenta cada candidata solo con evento, fecha, monto y estado proyectados y formula una sola pregunta explícita sobre a cuál se refiere; no infieras invitaciones ni asociaciones más allá del registro.';
        }
        // S6: cart and checkout policy travel only on an explicit
        // checkout/cart question. Structured purchase aspects expressing
        // checkout work (`payment_options`) or a cart-only outcome (no
        // orders, carts present) authorize them; a payment receipt never
        // reveals an abandoned cart and never carries transfer policy.
        const wantsCheckout = requests.some((request) =>
          request.kind === 'purchase' && request.aspects.includes('payment_options'),
        );
        const cartOnlyOutcome = phonePurchaseResult.purchases.length === 0 &&
          (phonePurchaseResult.carts?.length ?? 0) > 0;
        const indexedPaymentOptionsAvailable = informationResults.some(
          (result) =>
            result.requestId === informationPaymentOptionsPolicyRequestId &&
            result.status === 'completed',
        );
        if (indexedPaymentOptionsAvailable && wantsCheckout) {
          operationalNote += ' La transferencia está respaldada únicamente como opción general de pago para regalos según la política indexada; no afirmes que el carrito devolvió o confirmó ese método.';
        }
        const hasAbandonedCart = phonePurchaseResult.carts?.some(
          (cart) => cart.wasAbandoned,
        ) ?? false;
        if (
          hasAbandonedCart &&
          (wantsCheckout || cartOnlyOutcome) &&
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
        args.inbound.contactPhone
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

    // S6: no "repeat the window" prescription here. A support
    // continuation reuses the replayed purchase thread whose typed facts
    // (pending status, validation expectation, user-reported provenance)
    // already travel in the projected outcome; the support-continuity node
    // prompt owns the acknowledgment policy. Facts only.
    const promptBundleStartedAt = Date.now();
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('resolver_consultas_informativas');
    args.timingMs.prompt_bundle_load += Date.now() - promptBundleStartedAt;
    const composeReplyStartedAt = Date.now();
    const replyExtraction: ExtractionResult = {
      ...informationExtraction,
      informationRequests: requests,
    };
    const customerContext = await this.resolveCustomerContextForReply({
      plan: planForInformation,
      extraction: replyExtraction,
      requests,
      informationResults,
      informationSummaries,
      contactPhone: args.inbound.contactPhone,
      orchestrator: this.dependencies.informationOrchestrator ?? new InformationOrchestrator({
        knowledgeGateway: new NoopKnowledgeRetrievalGateway(),
        providerGateway: this.dependencies.providerGateway,
        agentGateway:
          this.dependencies.agentConversationGateway ??
          new NoopAgentConversationGateway('not_configured'),
        capabilityManifest: this.capabilityManifest,
      }),
      authentication: hasValidUserAuthToken(planForInformation) &&
          typeof planForInformation.user_auth.token === 'string' &&
          typeof planForInformation.user_auth.email === 'string'
        ? {
          token: planForInformation.user_auth.token,
          email: planForInformation.user_auth.email,
        }
        : null,
      deadlineMs: args.handleTurnStartedAt + 7000,
    });
    const imageRedactedShape = args.imageTurn
      ? this.redactedImageTurnShape(args.imageTurn)
      : null;
    // R2 single resolved projection: current image turns project their own
    // attachment; text-only turns project stored refs only when the
    // extractor linked the question to a prior image (unrelated turns
    // project nothing, explicitly).
    const ownerProjection = this.resolveOwnerImageProjectionForReply({
      plan: planForInformation,
      extraction: replyExtraction,
      imageTurn: args.imageTurn,
    });
    const defaultImageEvidence = this.imageEvidenceForProjection({
      imageTurn: args.imageTurn,
      projection: ownerProjection,
      plan: planForInformation,
      depositMentioned: this.isDepositMentioned(replyExtraction),
    });
    // Approval-boundary reconciliation for the reply input: a
    // status_or_proof_review ambiguity asks which of two invented tasks was
    // intended, but a terminal purchase outcome already settles whether any
    // purchase stands approved while a visible receipt alone never proves
    // approval. Clearing the answered ambiguity here (reply projection only;
    // intake normalization never clears) lifts both the clarification skip
    // and the reply-side ask bind so the record answers. Typed evidence
    // only; no phrase detection, no new state.
    const boundaryResolvedExtraction = this.reconcileApprovalBoundaryAmbiguity({
      extraction: replyExtraction,
      informationResults,
      imageEvidence: defaultImageEvidence,
      plan: planForInformation,
    });
    const composeInformationReply = (overrides: {
      imageEvidence?: ComposeReplyRequest['imageEvidence'];
      imageUrlAttachments?: ComposeReplyRequest['imageUrlAttachments'];
      imageFileAttachments?: ComposeReplyRequest['imageFileAttachments'];
      extraction?: ExtractionResult;
      turnDecision?: TurnDecision;
      errorMessage?: string | null;
    }): Promise<ComposeReplyResult> => composeModelReply(this.dependencies.runtime, {
      currentNode,
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planForInformation,
      extraction: overrides.extraction ?? boundaryResolvedExtraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      turnDecision: overrides.turnDecision ?? this.informationTurnDecision(
        operationalNote ?? 'information_batch',
      ),
      errorMessage: overrides.errorMessage ?? operationalNote,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      informationResults,
      customerContext,
      owner: planForInformation.owner ?? null,
      continuity: this.resolveContinuityProjection(planForInformation, args.messageContext),
      pendingQuestionRef: args.workingPlan.owner_pending_question ?? null,
      imageEvidence: overrides.imageEvidence ?? defaultImageEvidence,
      imageUrlAttachments: overrides.imageUrlAttachments ?? ownerProjection.urls,
      imageFileAttachments: overrides.imageFileAttachments ?? ownerProjection.files,
      replyBundle: bundle,
    });
    let composedReply: ComposeReplyResult;
    let deliveredTurnDecision = this.informationTurnDecision(operationalNote ?? 'information_batch');
    let deliveredOperationalNote = operationalNote;
    let deliveredExtraction = informationExtraction;
    let planPersistReason: string = currentNode;
    try {
      composedReply = await composeInformationReply({});
    } catch (error) {
      // S5: both current and retained image paths retry once without pixels
      // ONLY on the typed image-access failure, with no repeat extraction,
      // backend operation, upload or handoff. Credential failures and every
      // other stage (model composition/schema/guardrail, quota/rate-limit,
      // timeout, server errors, persistence) propagate and are never relabeled
      // as image unavailability.
      if (args.imageTurn && isAuthenticationFailure(error)) {
        const authLabel = args.imageTurn.kind === 'file' ? 'image_file_context' : 'image_url_context';
        this.recordDeterministicToolOutput(args.toolUsage, authLabel, {
          stage: 'reply_failed_auth',
          error_name: error instanceof Error ? error.name : 'unknown',
          ref_stored: args.imageTurn.refStored,
        });
        throw error;
      }
      // S5: a text-only turn retries ONLY a referenced-image access failure
      // when this compose transmitted retained attachments. A current image
      // turn retries ONLY the same typed image-access failure: generic model
      // failures keep their actual classification and propagate.
      const carriedRetainedImages = args.imageTurn === undefined &&
        (ownerProjection.urls.length > 0 || ownerProjection.files.length > 0);
      if (args.imageTurn === undefined) {
        if (!carriedRetainedImages || !isImageFileAccessFailure(error)) throw error;
      } else if (!isImageFileAccessFailure(error)) {
        throw error;
      }
      const fallbackSource = args.imageTurn?.kind ??
        (ownerProjection.files.length > 0 ? 'file' : 'url');
      const fallbackToolLabel = fallbackSource === 'file' ? 'image_file_context' : 'image_url_context';
      // Both attempts stay recorded; the label keeps the reply_failed
      // prefix so attempt accounting is stable. Only the typed image-access
      // failure reaches this fallback, so file_access is always true.
      this.recordDeterministicToolOutput(args.toolUsage, fallbackToolLabel, {
        stage: 'reply_failed_file_access',
        error_name: error instanceof Error ? error.name : 'unknown',
        file_access: true,
        ...(args.imageTurn ? { ref_stored: args.imageTurn.refStored } : { retained_projection: true }),
      });
      deliveredExtraction = this.buildNeutralMediaExtraction('image_unavailable');
      deliveredTurnDecision = this.informationTurnDecision('image_unavailable');
      // A retained reference never promises indefinite access: the shape
      // names the retained reference that the provider could not fetch.
      const failedShape = imageRedactedShape ?? 'retained reference';
      deliveredOperationalNote =
        `Image unavailable (${failedShape}); answered from other evidence. State preserved, no payment effect.`;
      composedReply = await composeInformationReply({
        extraction: deliveredExtraction,
        turnDecision: deliveredTurnDecision,
        errorMessage: deliveredOperationalNote,
        imageEvidence: this.withImageObservation(
          {
            status: 'unavailable',
            reason: 'image_unavailable',
            captionPresent: args.imageTurn?.captionPresent ?? false,
            source: fallbackSource,
            refStored: args.imageTurn?.refStored ?? true,
          },
          {
            plan: planForInformation,
            imageTurn: args.imageTurn,
            pixelsProjected: false,
            depositMentioned: this.isDepositMentioned(replyExtraction),
          },
        ),
        imageUrlAttachments: [],
        imageFileAttachments: [],
      });
      // R3: the retry keeps the failed attempt in totals instead of
      // overwriting it with success-only numbers.
      composedReply = this.withFallbackCallEvidence(error, composedReply);
      this.recordDeterministicToolOutput(args.toolUsage, fallbackToolLabel, {
        fallback_reply_received: true,
        // S5: the failed attempt never yields token usage, so the retry
        // usage is at most partial evidence — never a complete accounting.
        // Missing usage is recorded as unavailable, never zero.
        token_usage: composedReply.tokenUsage ? 'partial' : 'unavailable',
        ...(args.imageTurn ? { ref_stored: args.imageTurn.refStored } : { retained_projection: true }),
      });
      planPersistReason = fallbackSource === 'file' ? 'image_file_unavailable' : 'image_url_unavailable';
    }
    const reply = composedReply;
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    args.timingMs.compose_reply += Date.now() - composeReplyStartedAt;
    // S2 pending-question continuity: work left pending keeps the unresolved
    // user question for later evidence (image or follow-up). A completed turn
    // clears the curated question only when the model reports
    // pending_task_outcome answered against this turn's pending task with a
    // verified send and an unchanged owner target. A clarification,
    // suppress, origin failure, inaccessible-image response or owner transfer
    // keeps it. The public handleTurn wrapper finalizes the latest-response
    // record centrally.
    let planToSave = planForInformation;
    if (planToSave.information_state.pending_requests.length > 0) {
      planToSave = this.stashOwnerPendingQuestion(planToSave, args.inbound.text);
    } else if (planToSave.information_state.last_completed_request != null) {
      const preTurnPendingQuestion = args.workingPlan.owner_pending_question ?? null;
      const ownerUnchanged = planToSave.owner === args.workingPlan.owner;
      const outboundForPending = this.renderOutbound(
        reply,
        [],
        args.inbound.channel,
        planToSave.conversation_id,
        planToSave,
      );
      if (
        ownerUnchanged &&
        this.shouldClearPendingQuestion({
          preTurnPendingQuestion,
          structuredMessage: reply.structuredMessage,
          outbound: outboundForPending,
        })
      ) {
        planToSave = this.clearAnsweredOwnerPendingQuestion(planToSave);
      }
    }
    // S2: render first for the verified outbound; the wrapper finalizes the
    // latest-response record with one save when it actually changes.
    const outbound = this.renderOutbound(
      reply,
      [],
      args.inbound.channel,
      planToSave.conversation_id,
      planToSave,
    );
    const savePlanStartedAt = Date.now();
    await this.dependencies.planStore.save({
      plan: planToSave,
      reason: planPersistReason,
    });
    args.timingMs.save_plan += Date.now() - savePlanStartedAt;
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const turnDecision = deliveredTurnDecision;

    return {
      plan: planToSave,
      outbound,
      trace: this.buildTrace({
        plan: planToSave,
        previousNode: args.previousNode,
        currentNode,
        nodePath:
          args.previousNode === currentNode
            ? [currentNode]
            : [args.previousNode, currentNode],
        extraction: deliveredExtraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        providerResults: [],
        recommendationFunnel: this.resolveRecommendationFunnel(null, []),
        planPersisted: true,
        planPersistReason,
        timingMs: args.timingMs,
        tokenUsage: args.tokenUsage,
        messageContext: args.messageContext,
        responseClassifier: args.responseClassifierTrace,
        searchStrategy: 'none',
        turnDecision,
        operationalNote: deliveredOperationalNote,
        informationExecution: informationSummaries,
      }),
    };
  }

  private async handleSupportAcknowledgment(
    args: Parameters<AgentService['handleInformationFlow']>[0],
    plan: PlanSnapshot,
    act: InformationSupportAct | null | undefined = args.extraction.supportAct,
    operationalNote = 'A bounded user-reported support act was acknowledged from scoped evidence by the reply model.',
  ): Promise<HandleTurnResponse> {
    if (!act || !this.isSupportAcknowledgment(act)) {
      throw new Error('Support acknowledgment requires typed support evidence.');
    }
    const planWithSupportContext = mergePlan(plan, {
      conversation_summary: this.supportConversationSummary(
        act,
        plan.conversation_summary,
      ),
    });
    const currentNode: DecisionNode = 'resolver_consultas_informativas';
    const turnDecision = this.informationTurnDecision('support_acknowledgment');
    const bundle = await this.dependencies.promptLoader.loadSupportContinuityBundle();
    args.timingMs.prompt_bundle_load += 0;
    // R2: support replies share the resolved attachment projection and the
    // continuity reference, so a follow-up question that lands here keeps
    // its linked image instead of losing it.
    const ownerProjection = this.resolveOwnerImageProjectionForReply({
      plan: planWithSupportContext,
      extraction: args.extraction,
      imageTurn: args.imageTurn,
    });
    let reply: ComposeReplyResult;
    try {
      reply = await composeModelReply(this.dependencies.runtime, {
        currentNode,
        previousNode: args.previousNode,
        userMessage: args.inbound.text,
        messageContext: args.messageContext,
        plan: planWithSupportContext,
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        providerResults: [],
        turnDecision,
        errorMessage: null,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: args.toolUsage,
        owner: planWithSupportContext.owner ?? null,
        continuity: this.resolveContinuityProjection(planWithSupportContext, args.messageContext),
        imageEvidence: this.imageEvidenceForProjection({
          imageTurn: args.imageTurn,
          projection: ownerProjection,
        }),
        imageUrlAttachments: ownerProjection.urls,
        imageFileAttachments: ownerProjection.files,
        replyBundle: bundle,
      });
    } catch (error) {
      // The pre-compose save moved after render; a compose failure still
      // persists the plan before returning the typed operational failure.
      // Failure outbound records no latest-response text.
      await this.dependencies.planStore.save({
        plan: planWithSupportContext,
        reason: 'support_continuity_acknowledgment',
      });
      args.timingMs.total = Date.now() - args.handleTurnStartedAt;
      args.tokenUsage.total = this.sumTokenUsage(
        args.tokenUsage.classifier,
        args.tokenUsage.extraction,
      );
      return {
        plan: planWithSupportContext,
        outbound: this.failureOutbound(
          planWithSupportContext.conversation_id,
          'support_acknowledgment_composition_failed',
          observeOutputOrigin({
            candidateText: null,
            deliveredText: null,
            transformationVersion: 'transport-v2',
            mismatchFields: ['model_output'],
          }),
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
          promptBundleId: bundle.id,
          promptFilePaths: bundle.filePaths,
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
          operationalNote: `Support acknowledgment composition failed (${error instanceof Error ? error.name : 'unknown'}); typed operational failure delivered without prose.`,
          informationExecution: [],
        }),
      };
    }
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    args.timingMs.compose_reply += 0;
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    // S2: render first for the verified outbound; the public handleTurn
    // wrapper finalizes the latest-response record centrally.
    const outbound = this.renderOutbound(
      { text: reply.text, structuredMessage: reply.structuredMessage },
      [],
      args.inbound.channel,
      planWithSupportContext.conversation_id,
      planWithSupportContext,
      undefined,
      reply.origin,
    );
    const planToSave = planWithSupportContext;
    await this.dependencies.planStore.save({
      plan: planToSave,
      reason: 'support_continuity_acknowledgment',
    });
    return {
      plan: planToSave,
      outbound,
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

  /**
   * Host withdrawal turns are model-composed from typed evidence, never from
   * joined canned messages. The indexed policy (sourced processing window),
   * the unsupported individual-status flag, the event reference from the
   * typed request, and the actual handoff outcome travel as structured facts
   * into the existing owner model composition. Effect semantics (node move,
   * pending-request retention, escalation record) and single-request policy
   * execution are preserved.
   */
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
    let handoff: AgentGatewayResult | null = null;
    const phone = this.resolveEscalationPhone(args.inbound);
    if (needsHandoff) {
      handoff = phone
        ? await this.requestHumanTakeoverWithTrace(gateway, phone, args.toolUsage)
        : this.missingPhoneEscalationResult();
    }
    const handedOff = handoff?.status === 'success';
    const handoffOutcome = handoff === null
      ? null
      : handedOff
        ? 'handoff_requested' as const
        : handoff.status === 'failed'
          ? 'handoff_failed' as const
          : 'handoff_unknown' as const;
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
    const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
    const composeStartedAt = Date.now();
    // R2: host-withdrawal replies share the resolved attachment projection
    // and the continuity reference.
    const ownerProjection = this.resolveOwnerImageProjectionForReply({
      plan: planToSave,
      extraction: args.extraction,
      imageTurn: args.imageTurn,
    });
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode,
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planToSave,
      extraction: args.extraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      turnDecision: handedOff ? this.humanEscalationTurnDecision('host_withdrawal_status_unsupported')
        : this.informationTurnDecision('host_withdrawal_policy_and_support'),
      errorMessage: null,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      informationResults: execution.results,
      handoffOutcome,
      owner: planToSave.owner ?? null,
      replyBundle: bundle,
      continuity: this.resolveContinuityProjection(planToSave, args.messageContext),
      imageEvidence: this.imageEvidenceForProjection({
        imageTurn: args.imageTurn,
        projection: ownerProjection,
      }),
      imageUrlAttachments: ownerProjection.urls,
      imageFileAttachments: ownerProjection.files,
    });
    args.timingMs.compose_reply += Date.now() - composeStartedAt;
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(
      args.tokenUsage.classifier,
      args.tokenUsage.extraction,
      args.tokenUsage.reply,
    );
    // S2: render first for the verified outbound; the public handleTurn
    // wrapper finalizes the latest-response record centrally.
    const outbound = this.renderOutbound(
      reply,
      [],
      args.inbound.channel,
      planToSave.conversation_id,
      planToSave,
    );
    const finalPlan = planToSave;
    await this.dependencies.planStore.save({ plan: finalPlan, reason: 'host_withdrawal_policy_and_support' });
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    return {
      plan: finalPlan,
      outbound,
      trace: this.buildTrace({
        plan: finalPlan, previousNode: args.previousNode, currentNode,
        nodePath: [args.previousNode, currentNode], extraction: args.extraction,
        missingFields: [], searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
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
   * Packet C purchase route normalization. Requested answer aspects are
   * preserved verbatim through normalization, including payment_details:
   * the explicit payment-time question must survive extraction-to-reply.
   * The read partition is derived from the typed aspects through the shared
   * extraction-contract helper: gift detail aspects (dedication, thanks,
   * payment_details) read gift_purchases, every other question keeps its
   * declared resource. One partition only, never both; no aspect is ever
   * removed to force a route. Unknown payment time stays unknown
   * downstream; the reply addresses that uncertainty instead of inferring
   * it from event time or order creation.
   */
  private normalizePurchaseDetailRoute(
    requests: PendingInformationRequest[],
  ): PendingInformationRequest[] {
    return requests.map((request) => {
      if (request.kind !== 'purchase') return request;
      const aspects = request.aspects.length > 0 ? request.aspects : (['summary'] as const);
      return {
        ...request,
        aspects: [...aspects],
        resource: resolvePurchaseResourceForAspects(request.resource, aspects),
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
    // Refusal closes the protected request without renewing the OTP budget:
    // persist terminal auth_refused monotonically before closing.
    const refusedBase = this.persistTerminalRecovery(args.plan, 'auth_refused');
    const planToSave = mergePlan(this.resetUserAuth(refusedBase, null), {
      current_node: remainingRequests.length > 0
        ? 'resolver_consultas_informativas'
        : args.resumeNode ?? 'resolver_consultas_informativas',
      auth_recovery: this.effectiveAuthRecovery(refusedBase),
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
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('resolver_consultas_informativas');
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode: 'resolver_consultas_informativas',
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planToSave,
      extraction: args.extraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      turnDecision: this.informationTurnDecision('information_authentication_declined'),
      errorMessage: null,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      authenticationOutcome: {
        status: 'declined',
        reason: 'authentication_declined',
        protectedRequestsClosed: true,
        publicInformationRequestsRemaining: remainingRequests.length,
        handoffOutcome: null,
        noFurtherCredentialRequests: true,
      },
      informationResults: [],
    });
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction, args.tokenUsage.reply);
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
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
        currentNode: planToSave.current_node,
        nodePath: args.previousNode === planToSave.current_node
          ? [planToSave.current_node]
          : [args.previousNode, planToSave.current_node],
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
         promptBundleId: bundle.id,
         promptFilePaths: bundle.filePaths,
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
         operationalNote: null,
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
    // The handoff was already decided on the terminal turn, so no second
    // gateway effect is submitted. A retained decision belongs in diagnostics,
    // not tools_called: no fake takeover input/output is recorded here.
    // Failed/skipped/unknown receipts are preserved as-is; this path never
    // resets recovery and never offers another OTP.
    const planToSave = mergePlan(
      this.withSeededAuthRecovery(args.existingPlan),
      {
        current_node: 'solicitar_agente_humano',
      },
    );
    await this.dependencies.planStore.save({
      plan: planToSave,
      reason: 'terminal_otp_code_retains_handoff',
    });
    args.timingMs.total = Date.now() - args.handleTurnStartedAt;
    const extraction = this.buildSyntheticEscalationExtraction(
      'La persona envió un código después de que la verificación terminó y se pidió apoyo humano.',
    );
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('resolver_consultas_informativas');
    // C1 retained-handoff truthfulness: report the handoff outcome decided on
    // the terminal turn from the persisted receipt, never a fresh request.
    // Failed, unknown and undispatched receipts stay distinct so the reply
    // states what actually happened; the pending question is preserved.
    // R4: repeat carries the exact persisted terminal reason, never a
    // generic label that would overwrite verification_failed.
    const retainedReceiptOutcome = args.existingPlan.human_help_receipt?.outcome ?? null;
    const retainedTerminalReason = this.effectiveAuthRecovery(args.existingPlan).terminalReason ??
      'otp_recovery_exhausted';
    const retainedHandoffOutcome = retainedReceiptOutcome === 'handoff_requested'
      ? 'handoff_requested' as const
      : retainedReceiptOutcome === 'handoff_failed'
        ? 'handoff_failed' as const
        : retainedReceiptOutcome === 'outcome_unknown'
          ? 'handoff_unknown' as const
          : null;
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode: 'resolver_consultas_informativas',
      previousNode: args.existingPlan.current_node,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planToSave,
      extraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      turnDecision: this.humanEscalationTurnDecision('terminal_otp_code_retained'),
      errorMessage: null,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      authenticationOutcome: {
        status: 'terminal',
        reason: retainedTerminalReason,
        protectedRequestsClosed: false,
        publicInformationRequestsRemaining: 0,
        handoffOutcome: retainedHandoffOutcome,
      },
      handoffOutcome: retainedHandoffOutcome,
    });
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction, args.tokenUsage.reply);
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
        previousNode: args.existingPlan.current_node,
        currentNode: 'solicitar_agente_humano',
        nodePath: [args.existingPlan.current_node, 'solicitar_agente_humano'],
        extraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
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
        operationalNote: null,
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
    const gateway = this.dependencies.agentConversationGateway ?? new NoopAgentConversationGateway('not_configured');
    const phoneNumber = this.resolveEscalationPhone(args.inbound);
    // Explicit help retry affects only the help effect, never OTP eligibility:
    // only a new inbound message with an explicit human request may retry a
    // definitively failed handoff. Unknown stays unretried by policy.
    const priorReceipt = args.plan.human_help_receipt ?? null;
    const isExplicitHelpRetry = this.isExplicitHumanRequest(args.plan, args.extraction) &&
      priorReceipt?.outcome === 'handoff_failed';
    const decision = decideHumanHelpAttempt({ conversationId: args.plan.plan_id,
      inboundId: args.inbound.messageId, scope: 'protected_request', trustedPhone: phoneNumber,
      gatewayCapable: this.capabilityManifest['human.takeover.write'].available,
      prior: priorReceipt, explicitRetry: isExplicitHelpRetry });
    let receipt = args.plan.human_help_receipt ?? null;
    let gatewayResult: AgentGatewayResult = { status: 'skipped', reason: 'not_configured', message: decision.reason };
    if (decision.action === 'attempt' && phoneNumber) {
      // Persist uncertainty before dispatch. A timeout/crash can never trigger an automatic retry.
      receipt = applyHandoffResult({ dedupeKey: decision.dedupeKey, inboundId: args.inbound.messageId,
        phone: phoneNumber, gatewayStatus: 'unknown' });
      await this.dependencies.planStore.save({ plan: mergePlan(args.plan, { human_help_receipt: receipt }),
        reason: 'human_help_intent' });
      try {
        gatewayResult = await this.requestHumanTakeoverWithTrace(gateway, phoneNumber, args.toolUsage);
        // Never fabricate a receipt for an unattempted effect: a skipped
        // gateway result keeps the prior receipt and records only the reason.
        if (gatewayResult.status !== 'skipped') {
          receipt = applyHandoffResult({ dedupeKey: decision.dedupeKey, inboundId: args.inbound.messageId,
            phone: phoneNumber, gatewayStatus: resolveHandoffGatewayStatus({
              status: gatewayResult.status === 'success' ? 'success' : 'failed',
              outcome: gatewayResult.status === 'failed' ? gatewayResult.outcome : undefined,
            }) });
        }
      } catch {
        // The pre-dispatch receipt remains unknown: no claim of success or automatic retry.
      }
    } else if (receipt?.outcome === 'handoff_requested') {
      gatewayResult = { status: 'success', message: 'retained_confirmed_handoff' };
    }
    const requested = receipt?.outcome === 'handoff_requested';
    const terminalLastError = requested
      ? null
      : gatewayResult.status === 'failed'
        ? gatewayResult.error
        : gatewayResult.status === 'skipped' &&
          gatewayResult.message !== decision.reason
          ? gatewayResult.message
          : receipt?.outcome ?? decision.reason;
    const planToSave = mergePlan(args.plan, {
      current_node: 'solicitar_agente_humano', intent: 'solicitar_humano', human_help_receipt: receipt,
      human_escalation: { status: requested ? 'requested' : 'none',
        requested_at: requested ? receipt?.updatedAt ?? null : null,
        phone_number: phoneNumber, last_error: terminalLastError },
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
    const bundle = await this.dependencies.promptLoader.loadNodeBundle('resolver_consultas_informativas');
    const handoffOutcome = requested
      ? 'handoff_requested' as const
      : receipt?.outcome === 'outcome_unknown'
        ? 'handoff_unknown' as const
        : receipt?.outcome === 'handoff_failed'
          ? 'handoff_failed' as const
          : null;
    const reply = await composeModelReply(this.dependencies.runtime, {
      currentNode: 'resolver_consultas_informativas',
      previousNode: args.previousNode,
      userMessage: args.inbound.text,
      messageContext: args.messageContext,
      plan: planToSave,
      extraction: args.extraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      turnDecision: this.humanEscalationTurnDecision(args.reason),
      errorMessage: null,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage: args.toolUsage,
      authenticationOutcome: {
        status: 'terminal',
        reason: args.reason,
        // C1 terminal-handoff truthfulness: the pending protected requests
        // are retained in state (this path never clears them), so the reply
        // must preserve the pending question instead of claiming closure.
        // `scopedPhoneSearchMiss` frames phone_information_not_found as a
        // scoped-lookup limitation, never an account verdict.
        protectedRequestsClosed: false,
        publicInformationRequestsRemaining: args.informationExecution?.filter(
          (summary) => summary.kind === 'faq' && summary.status === 'completed',
        ).length ?? 0,
        handoffOutcome,
        ...(args.reason === 'phone_information_not_found'
          ? { scopedPhoneSearchMiss: true }
          : {}),
      },
      handoffOutcome,
      informationResults: [],
    });
    args.tokenUsage.reply = reply.tokenUsage ?? null;
    args.tokenUsage.openAiCalls.reply = reply.openAiCall ?? null;
    args.tokenUsage.total = this.sumTokenUsage(args.tokenUsage.classifier, args.tokenUsage.extraction, args.tokenUsage.reply);
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
        currentNode: 'solicitar_agente_humano',
        nodePath: [args.previousNode, 'solicitar_agente_humano'],
        extraction: args.extraction,
        missingFields: [],
        searchReady: false,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
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
        operationalNote: null,
        humanTakeoverAttempted: decision.action === 'attempt', humanTakeoverSucceeded: requested,
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
      // Explicit entity identity: a different explicit event starts its own
      // thread. Mirrors the purchase eventHint comparison through the shared
      // eventMatches helper; unhinted turns still continue the thread. Typed
      // hints only, never user-text matching.
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
      return { plan: this.clearPhoneAuthentication(args.plan, 'identity_rejected'),
        authentication: null, authBlock: { nextInput: 'retry', guidance: createInformationAuthGuidance('phone_auth_failed', null) } };
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

    // Terminal episodes never return the generic otp_invalid/otp_pending
    // recovery branch; only a still-valid, unconsumed episode may ask for
    // its first code. Terminal callers escalate without retry copy.
    if (isTerminalAuthRecovery(this.effectiveAuthRecovery(planForEmail))) {
      const terminalPlan = this.withSeededAuthRecovery(planForEmail);
      return {
        plan: terminalPlan,
        authentication: null,
        authBlock: {
          nextInput: 'otp',
          guidance: createInformationAuthGuidance('otp_verification_failed', email),
        },
      };
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
      plan: mergePlan(
        this.persistTerminalRecovery(plan, 'send_failed', {
          sendAttempted: true,
        }),
        {
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
        },
      ),
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
    // The effective recovery merges persisted typed state with the legacy
    // seed so terminal stays terminal across resets and sessions.
    const recovery = this.effectiveAuthRecovery(plan);
    if (!consumeVerificationAttempt(recovery).allowed) {
      return {
        plan: this.withSeededAuthRecovery(plan),
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
        plan: mergePlan(
          this.persistTerminalRecovery(plan, 'verification_failed', {
            verificationAttempted: true,
          }),
          {
            user_auth: {
              status: 'code_requested',
              token: null,
              token_expires_at: null,
              last_error: result.error,
              failed_code_attempts: nextAttempts,
            },
          },
        ),
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

  /**
   * R3 fallback accounting. Returns the retry reply with its call ref
   * merged to include the failed image attempt: attemptCount counts both
   * calls and transport carries both attempts' observations. Reply text,
   * usage and origin are untouched; the failed attempt is never dropped.
   * S5: the failed attempt never yields token usage, so callers record
   * `token_usage: partial|unavailable` in fallback evidence; this merge
   * never invents zero usage or claims a complete accounting.
   */
  private withFallbackCallEvidence(
    failedError: unknown,
    reply: ComposeReplyResult,
  ): ComposeReplyResult {
    const failedTransport = failedError instanceof ProviderImageAccessError
      ? failedError.failedTransport
      : null;
    const retryCall = reply.openAiCall ?? null;
    const mergedTransport = mergeFallbackTransportMetrics(
      failedTransport,
      retryCall?.requestMetrics.transport ?? null,
    );
    if (mergedTransport === null) return reply;
    if (retryCall === null) {
      return {
        ...reply,
        openAiCall: {
          responseId: null,
          requestId: null,
          model: 'unknown',
          attemptCount: mergedTransport.observedRequestCount + 1,
          requestMetrics: {
            instructionBytes: mergedTransport.instructionBytes ?? 0,
            inputBytes: mergedTransport.inputBytes ?? 0,
            toolCount: 0,
            schemaPropertyCount: 0,
            transport: mergedTransport,
          },
        },
      };
    }
    return {
      ...reply,
      openAiCall: {
        ...retryCall,
        attemptCount: retryCall.attemptCount + 1,
        requestMetrics: { ...retryCall.requestMetrics, transport: mergedTransport },
      },
    };
  }

  private sumTokenUsage(...usages: Array<TokenUsage | null>): TokenUsage | null {    if (!usages.some((usage) => usage)) {
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

  private legacyAuthFields(plan: PlanSnapshot): {
    status: string;
    email: string | null;
    requestedAt: string | null;
    failedCodeAttempts: number;
    otpSendAttempts: number;
    otpNonDeliveryReports: number;
  } {
    return {
      status: plan.user_auth.status,
      email: plan.user_auth.email,
      requestedAt: plan.user_auth.requested_at,
      failedCodeAttempts: plan.user_auth.failed_code_attempts,
      otpSendAttempts: plan.user_auth.otp_send_attempts,
      otpNonDeliveryReports: plan.user_auth.otp_non_delivery_reports,
    };
  }

  private effectiveAuthRecovery(plan: PlanSnapshot): InformationAuthRecoveryState {
    return effectiveAuthRecovery({
      persisted: plan.auth_recovery,
      legacy: this.legacyAuthFields(plan),
    });
  }

  private withSeededAuthRecovery(plan: PlanSnapshot): PlanSnapshot {
    const effective = this.effectiveAuthRecovery(plan);
    if (
      effective.sendAttempted === plan.auth_recovery.sendAttempted &&
      effective.verificationAttempted === plan.auth_recovery.verificationAttempted &&
      effective.terminalReason === plan.auth_recovery.terminalReason &&
      (effective.challengeEmail ?? null) === (plan.auth_recovery.challengeEmail ?? null) &&
      (effective.challengeRequestedAt ?? null) === (plan.auth_recovery.challengeRequestedAt ?? null)
    ) {
      return plan;
    }
    return mergePlan(plan, { auth_recovery: effective });
  }

  private persistTerminalRecovery(
    plan: PlanSnapshot,
    terminalReason: AuthRecoveryTerminalReason,
    extra?: Partial<InformationAuthRecoveryState>,
  ): PlanSnapshot {
    const effective = this.effectiveAuthRecovery(plan);
    if (effective.terminalReason !== null) {
      return mergePlan(plan, {
        auth_recovery: mergeAuthRecovery(plan.auth_recovery, {
          ...effective,
          ...extra,
        }),
      });
    }
    return mergePlan(plan, {
      auth_recovery: {
        ...effective,
        sendAttempted: true,
        ...extra,
        terminalReason,
      },
    });
  }

  private hasProtectedInformationWork(
    requests: Array<{ kind: string }>,
  ): boolean {
    return requests.some(
      (request) => request.kind === 'purchase' || request.kind === 'associated_event',
    );
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

  /**
   * Neutral extraction for media-error turns (malformed bytes, missing
   * store, failed upload, unavailable pixels, provider image-access
   * fallback). Carries transport availability only: no human intent, no
   * confidence claim, no planning categories and no ranking criteria. The
   * model answers from authorized existing evidence when sufficient and
   * otherwise asks only for the specific missing factual information; it
   * never requests an image, re-upload or URL. Existing references keep
   * their recorded expiry; expiry bounds media availability, never
   * historical purchases or conversational facts.
   */
  private buildNeutralMediaExtraction(reason: string): ExtractionResult {
    return {
      actionIntent: null,
      informationRequests: [],
      intentConfidence: null,
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
      conversationSummary: `Image unavailable (${reason}); transport only, no pixels projected.`,
      selectedProviderHints: [],
      selectedProviderReferences: [],
      closeAction: null,
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: null,
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
    };
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

  /**
   * Neutral extraction fallback for URL image turns whose model extraction
   * itself failed. The caption stays the user message; it is not rewritten
   * into retrieval requests, so image questions are answered from visible
   * content instead of FAQ evidence rules. Used only after recording the
   * extraction failure, never as a substitute for the established path.
   */
  private buildUrlImageTurnExtraction(caption: string): ExtractionResult {
    return {
      ...this.buildNeutralMediaExtraction(
        'URL image turn with native projection; the caption is the user message.',
      ),
      conversationSummary: caption.trim().length > 0
        ? `URL image with caption: ${caption.trim().slice(0, 500)}`
        : 'URL image without caption.',
    };
  }

  private buildSyntheticUnsupportedImageExtraction(): ExtractionResult {    return {
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
   * D1: unclear phone evidence is equivalent to absent. yes/no are actionable
   * only where typed auth state makes them relevant; otherwise ignored.
   * D2: explicit human routing requires typed humanHelpIntent evidence.
   */
  private isAbsentPhoneConfirmation(value: ExtractionResult['phoneConfirmation']): boolean {
    return value == null || value === 'unclear';
  }

  private isPhoneConfirmationRelevant(plan: PlanSnapshot, extraction: ExtractionResult): boolean {
    if (plan.user_auth.awaiting_phone_confirmation) return true;
    if (plan.user_auth.status !== 'none') return true;
    if (plan.user_auth.auth_method != null) return true;
    if (plan.information_state.pending_requests.some((request) => request.kind === 'purchase' || request.kind === 'associated_event')) return true;
    if (extraction.informationRequests.some((request) => request.kind === 'purchase' || request.kind === 'associated_event')) return true;
    // W1-07: a typed identity rejection ('no') targets the channel-derived
    // phone identity itself, which the adapter records on the plan on every
    // WhatsApp turn. Honor it even with no prior phone-auth state so a
    // fresh-session wrong-account statement reaches the human-first handoff
    // instead of a generic greeting. 'yes' still needs a real phone-auth
    // context (D1 pure-shortlist guard preserved). Accountless reads keep
    // precedence via the earlier accountlessRead return in
    // effectivePhoneConfirmation. No keywords, no fixture identifiers.
    if ((extraction.phoneConfirmation ?? null) === 'no' &&
      (plan.contact_phone_number != null || plan.contact_phone != null)) return true;
    return false;
  }

  private effectivePhoneConfirmation(plan: PlanSnapshot, extraction: ExtractionResult): 'yes' | 'no' | null {
    const raw = extraction.phoneConfirmation ?? null;
    if (raw == null || raw === 'unclear') return null;
    const accountlessRead = extraction.informationRequests.some((request) =>
      (request.kind === 'purchase' || request.kind === 'associated_event') &&
      request.authAction === 'accountless_user');
    if (accountlessRead && plan.user_auth.auth_method !== 'phone' &&
      !plan.user_auth.awaiting_phone_confirmation) return null;
    if (!this.isPhoneConfirmationRelevant(plan, extraction)) return null;
    return raw;
  }

  private isPureShortlistTurn(plan: PlanSnapshot, extraction: ExtractionResult): boolean {
    const candidateCount = plan.provider_needs.reduce((total, need) => total + need.recommended_providers.length, 0);
    if (candidateCount < 2) return false;
    const hasProtectedRequest = extraction.informationRequests.some((request) => request.kind === 'purchase' || request.kind === 'associated_event') ||
      plan.information_state.pending_requests.some((request) => request.kind === 'purchase' || request.kind === 'associated_event');
    if (hasProtectedRequest) return false;
    if (plan.user_auth.awaiting_phone_confirmation) return false;
    if (plan.user_auth.status !== 'none') return false;
    return true;
  }

  private isOfferPending(plan: PlanSnapshot): boolean {
    return plan.conversation_health.help_offer_status === 'offered';
  }

  private effectiveHumanHelpIntent(plan: PlanSnapshot, extraction: ExtractionResult): 'none' | 'request' | 'accept_offer' | 'retry' | 'decline_offer' {
    const raw = extraction.humanHelpIntent ?? null;
    if (raw == null) return 'none';
    if (raw === 'accept_offer' && !this.isOfferPending(plan)) return 'none';
    return raw;
  }

  private isExplicitHumanRequest(plan: PlanSnapshot, extraction: ExtractionResult): boolean {
    const intent = this.effectiveHumanHelpIntent(plan, extraction);
    if (intent === 'request' || intent === 'retry') return extraction.actionIntent === 'solicitar_humano';
    if (intent === 'accept_offer') return extraction.actionIntent === 'solicitar_humano' && this.isOfferPending(plan);
    // Legacy extractions without the typed field: actionIntent alone routes
    // unless a support act claims the turn (mailbox report alone stays support).
    if (extraction.humanHelpIntent == null) {
      if (extraction.actionIntent !== 'solicitar_humano') return false;
      if (extraction.supportAct != null) return false;
      return true;
    }
    return false;
  }

  private isSupportWinOverHuman(plan: PlanSnapshot, extraction: ExtractionResult): boolean {
    if (extraction.supportAct == null) return false;
    return !this.isExplicitHumanRequest(plan, extraction);
  }

  /**
   * A confirmation turn carries no actionable delta: no information/support/
   * RSVP/provider/contact work and no selection reference. Plan-echoed
   * context (eventType, active need, guest range) does not count as a
   * refinement.
   */
  private hasNoConfirmationDelta(extraction: ExtractionResult): boolean {
    return extraction.informationRequests.length === 0 &&
      extraction.supportAct == null &&
      this.isAbsentPhoneConfirmation(extraction.phoneConfirmation) &&
      (extraction.humanHelpIntent == null || extraction.humanHelpIntent === 'none') &&
      extraction.rsvpAction == null &&
      extraction.rsvpEventReference == null &&
      (extraction.providerQueryIntents?.length ?? 0) === 0 &&
      (extraction.providerPlanOperations?.length ?? 0) === 0 &&
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

  /**
   * A bare confirmation turn (null intent, no delta) or a hollow browse
   * intent (ver_opciones, buscar, refinar or modificar with no executable
   * delta) over an unresolved multi-option shortlist must clarify which
   * provider or action is confirmed, even when the extractor marked ambiguity
   * clear (live: "Si confirmo."). Hollow intents cannot execute anything, so
   * clarification is the only safe move; intents with real deltas keep their
   * routes.
   */
  private isBareProviderConfirmationTurn(extraction: ExtractionResult): boolean {
    if (!this.hasNoConfirmationDelta(extraction)) return false;
    return extraction.actionIntent === null ||
      extraction.actionIntent === 'ver_opciones' ||
      extraction.actionIntent === 'buscar_proveedores' ||
      extraction.actionIntent === 'refinar_busqueda' ||
      extraction.actionIntent === 'modificar_plan_proveedores';
  }

  /**
   * Packet C deferred-closure guard scope. Only needs that are still an
   * active choice count toward provider-selection ambiguity: deferred needs
   * stay deferred and needs with recorded selections stay selected unless
   * the user explicitly reopens them. Completed/deferred records are never
   * turned back into a selection question by historical recommendations.
   * Typed plan state only; no phrase detection.
   */
  private unresolvedProviderShortlistNeeds(
    plan: PlanSnapshot,
  ): PlanSnapshot['provider_needs'] {
    return plan.provider_needs.filter(
      (need) =>
        need.status !== 'deferred' &&
        (need.selected_provider_ids?.length ?? 0) === 0 &&
        need.recommended_providers.length > 0,
    );
  }

  private guardAmbiguousProviderConfirmation(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    userMessage: string,
  ): { extraction: ExtractionResult; ambiguous: boolean } {
    // Packet C: only an actual unresolved selection requested by the user
    // enters this guard. retomar_plan resumes or closes existing state; it
    // is never a shortlist selection request, so it must not overwrite
    // ambiguity with historical recommendations.
    const requestsSelection = extraction.actionIntent === 'confirmar_proveedor';
    const isBareAmbiguousTurn = extraction.actionIntent === null &&
      extraction.ambiguity?.status === 'ambiguous' &&
      extraction.informationRequests.length === 0 &&
      (extraction.providerQueryIntents?.length ?? 0) === 0 &&
      extraction.providerExplanationRequest == null &&
      extraction.providerDetailRequest == null &&
      extraction.closeAction == null &&
      !extraction.pauseRequested;
    if (!requestsSelection && !isBareAmbiguousTurn && !this.isBareProviderConfirmationTurn(extraction)) {
      return { extraction, ambiguous: false };
    }

    const candidateCount = this.unresolvedProviderShortlistNeeds(plan).reduce(
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
          interpretations: this.providerConfirmationAlternatives(plan, extraction),
          candidateOperations: extraction.ambiguity?.candidateOperations,
          questionKey: extraction.ambiguity?.questionKey ?? null,
        },
        selectedProviderHints: [],
        selectedProviderReferences: [],
        providerPlanOperations: (
          extraction.providerPlanOperations ?? []
        ).filter((operation) => operation.type !== 'select_provider'),
      },
    };
  }

  private providerConfirmationAlternatives(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
  ): string[] {
    // C1 adversarial-ambiguity grounding: only typed plan alternatives are
    // supplied (shortlisted need categories plus an explicit capability
    // operation when present). Raw extractor interpretations are ungrounded
    // model conflicts and must not reach the clarification evidence, or the
    // reply requotes provider options instead of asking a concise question.
    // Packet C: alternatives come only from still-unresolved needs; selected
    // and deferred needs never reappear as active choices.
    const providerAlternatives = this.unresolvedProviderShortlistNeeds(plan).flatMap((need) =>
      need.recommended_providers.map((provider) =>
        `provider:shortlisted:${provider.category}`,
      ),
    );
    const operationAlternative = extraction.requestedOperation
      ? [`operation:${extraction.requestedOperation}`]
      : [];
    return [
      ...operationAlternative,
      ...providerAlternatives,
    ].slice(0, 9);
  }

  /**
   * A shortlist with several recommended providers and no selection is
   * unresolved when the turn carries no grounded selection reference. Typed
   * plan and extraction evidence only; the user message is matched solely
   * against structured provider references, never against keywords. Packet
   * C: selected and deferred needs are settled records, not active choices,
   * so only still-unresolved needs count.
   */
  private hasUnresolvedProviderShortlist(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    userMessage: string,
  ): boolean {
    const candidateCount = this.unresolvedProviderShortlistNeeds(plan).reduce(
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
      finish_plan_summary: buildFinishPlanSummary(args.toolUsage),
      provider_quote_receipts: buildProviderQuoteReceipts(args.toolUsage),
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
      selection_resolution_summary: this.summarizeSelectionResolution(args.extraction, args.plan),
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
      auth_recovery_terminal_reason: plan.auth_recovery.terminalReason ?? null,
      auth_recovery_send_attempted: plan.auth_recovery.sendAttempted,
      auth_recovery_verification_attempted: plan.auth_recovery.verificationAttempted,
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

  private summarizeSelectionResolution(extraction: ExtractionResult, plan: PlanSnapshot): SelectionResolutionDebugSummary {
    const operations = extraction.providerPlanOperations ?? [];
    // Trace-only parity: hint-resolved selections (semantic cheaper/location
    // references) record the selection in the plan without an LLM-emitted
    // providerPlanOperation. Reflect select_provider in the trace summary so
    // the recorded selection stays observable. Plan application and routing
    // never consume these synthetic entries.
    const planSelected = plan.provider_needs
      .filter((need) => need.selected_provider_ids.length > 0)
      .map((need) => need.category);
    const referenceSelected = (extraction.selectedProviderReferences ?? [])
      .map((reference) => reference.category)
      .filter((category): category is NonNullable<typeof category> => category !== null);
    const selectedCategories = Array.from(new Set([...planSelected, ...referenceSelected]));
    const hasSelectionEvidence =
      (extraction.selectedProviderReferences ?? []).length > 0 ||
      extraction.selectedProviderHints.length > 0;
    const traceOperations =
      selectedCategories.length > 0 && hasSelectionEvidence
        ? [
          ...operations,
          ...missingSelectionTraceOperations({
            existing: operations,
            selectedCategories,
          }),
        ]
        : operations;
    return {
      selected_provider_references: (extraction.selectedProviderReferences ?? []).map((reference) => ({
        provider_id: reference.providerId,
        category: reference.category,
        has_title: reference.providerTitle !== null,
        has_hint: reference.hint !== null,
      })),
      selected_provider_hints_count: extraction.selectedProviderHints.length,
      provider_plan_operation_types: traceOperations.map((operation) => operation.type),
      provider_plan_operation_categories: traceOperations
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
    // A deferred need never keeps active focus: clearing it here (with the
    // non-deferred fallback in replaceProviderNeeds) keeps deferred
    // categories from being re-foregrounded or re-asked.
    return replaceProviderNeeds(
      plan,
      nextNeeds,
      nextNeed.status === 'deferred' ? null : activeNeedCategory,
    );
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

  /**
   * R5 close-eligible providers: selected providers resolved across all
   * non-deferred needs, in plan order. The close reply must see the actual
   * eligible selection (e.g. Photography) instead of the active need's
   * shortlist (which may be a deferred category's rejected card). Deferred
   * needs stay deferred: never re-mandated, never quoted here.
   */
  private collectCloseEligibleProviders(plan: PlanSnapshot): ProviderSummary[] {
    const seen = new Set<number>();
    const providers: ProviderSummary[] = [];
    for (const need of plan.provider_needs) {
      if (need.status === 'deferred') {
        continue;
      }
      for (const selectedId of need.selected_provider_ids) {
        if (seen.has(selectedId)) {
          continue;
        }
        const provider = need.recommended_providers.find((item) => item.id === selectedId);
        if (!provider) {
          continue;
        }
        seen.add(provider.id);
        providers.push(provider);
      }
    }
    return providers;
  }

  private collectPlanProviders(plan: PlanSnapshot): ProviderSummary[] {
    const seen = new Set<number>();
    const providers: ProviderSummary[] = [];
    for (const need of plan.provider_needs) {
      // Deferred needs stay deferred: their rejected cards never re-enter
      // reply candidates.
      if (need.status === 'deferred') {
        continue;
      }
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
        extraction.closeAction?.type === 'proceed_confirmed' ||
        extraction.closeAction?.type === 'request_contact' ||
        extraction.closeAction?.type === 'abandon_plan')
    );
  }

  /**
   * C1 close continuation after refinement. When the previous turn closed a
   * selection/defer round on `seguir_refinando_guardar_plan` and this turn
   * only carries close contact data (no new selection, operation or pause)
   * while merged contact is complete and a provider stands selected, the
   * turn continues the close instead of falling through to a generic
   * interview that re-asks deferred needs. Typed plan and extraction
   * evidence only; deferred needs stay deferred via the close path.
   */
  private shouldContinueCloseAfterRefinement(
    previousNode: DecisionNode | null,
    extraction: ExtractionResult,
    mergedPlan: PlanSnapshot,
  ): boolean {
    // A contact-completing turn after refinement continues the close even
    // when the previous turn misrouted to generic interview: the selection
    // round is fully closed (every need selected or deferred, no open
    // shortlist) so no planning question competes with the close. Typed
    // plan and extraction evidence only; mid-planning turns with open
    // shortlists still fall through to generic routing.
    const closeReadyPrevious = previousNode === 'seguir_refinando_guardar_plan' ||
      (previousNode === 'entrevista' &&
        this.unresolvedProviderShortlistNeeds(mergedPlan).length === 0);
    if (!closeReadyPrevious) return false;
    if (!this.hasCloseContactField(extraction)) return false;
    if (extraction.pauseRequested || extraction.requestedOperation) return false;
    const closeActionType = extraction.closeAction?.type ?? null;
    if (
      closeActionType !== null &&
      closeActionType !== 'confirm_close' &&
      closeActionType !== 'proceed_confirmed' &&
      // R7 S12: seeded request_contact continues the close (dispatch path).
      !(closeActionType === 'request_contact' &&
        Boolean(mergedPlan.contact_name && mergedPlan.contact_email && mergedPlan.contact_phone) &&
        mergedPlan.provider_needs.some(
          (need) => (need.selected_provider_ids?.length ?? 0) > 0,
        ))
    ) {
      return false;
    }
    if ((extraction.selectedProviderHints?.length ?? 0) > 0) return false;
    if ((extraction.selectedProviderReferences?.length ?? 0) > 0) return false;
    if ((extraction.providerPlanOperations?.length ?? 0) > 0) return false;
    const contactComplete = Boolean(
      mergedPlan.contact_name && mergedPlan.contact_email && mergedPlan.contact_phone,
    );
    if (!contactComplete) return false;
    return mergedPlan.provider_needs.some(
      (need) => (need.selected_provider_ids?.length ?? 0) > 0,
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
    mergedPlan?: PlanSnapshot,
  ): boolean {
    if (previousNode !== 'crear_lead_cerrar') {
      return false;
    }

    if (
      extraction.closeAction?.type === 'confirm_close' ||
      extraction.closeAction?.type === 'proceed_confirmed'
    ) {
      return false;
    }

    // R7 S12: a request_contact with fully seeded typed state dispatches
    // the effect (effective proceed_confirmed), never re-asks contact.
    // Date proxy: an established event type on the plan means the event
    // date context is seeded (the close blocker path still verifies the
    // explicit date before dispatching the write).
    if (extraction.closeAction?.type === 'request_contact' && mergedPlan) {
      const effective = effectiveCloseActionForDispatch({
        closeActionType: extraction.closeAction.type,
        contactComplete: Boolean(
          mergedPlan.contact_name && mergedPlan.contact_email && mergedPlan.contact_phone,
        ),
        hasEligibleSelection: mergedPlan.provider_needs.some(
          (need) => need.status !== 'deferred' && need.selected_provider_ids.length > 0,
        ),
        eventDateAvailable: mergedPlan.event_type !== null,
        lifecycleActive: mergedPlan.lifecycle_state === 'active',
      });
      if (effective === 'proceed_confirmed') return false;
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
    reply: { text: string; structuredMessage?: StructuredMessage; origin?: ModelOriginReceipt | null },
    providerResults: ProviderSummary[],
    channel: string,
    conversationId: string | null,
    plan?: PlanSnapshot,
    toolUsage?: ToolUsage,
    origin: ModelOriginReceipt | null = null,
  ): NormalizedOutboundMessage {
    const modelOrigin = origin ?? reply.origin ?? null;
    const structuredMessage = reply.structuredMessage;
    const structuredMessageKind = structuredMessage?.type ?? null;
    if (structuredMessage) {
      const renderer = this.dependencies.renderers[channel]
        ?? this.dependencies.renderers['whatsapp'];
      if (renderer) {
        const text = applyDocumentedTransportTransforms(renderer.render({
          message: structuredMessage,
          providerResults,
        }));
        const outputOrigin = modelOrigin === null
          ? missingOutputOrigin(text)
          : this.observeModelDelivery({
            origin: modelOrigin,
            structuredMessage,
            deliveredText: text,
            providerResults,
            channel,
          });
        if (outputOrigin.status === 'mismatch') {
          return this.failureOutbound(conversationId, 'model_origin_mismatch', outputOrigin);
        }
        return {
          text,
          outputOrigin,
          conversationId,
          structuredMessageKind,
          delivery: {
            action: 'send',
            reason: 'reply_composed',
          },
        };
      }
    }

    const text = applyDocumentedTransportTransforms(reply.text);
    const outputOrigin = modelOrigin === null
      ? missingOutputOrigin(text)
      : this.observeModelDelivery({
        origin: modelOrigin,
        structuredMessage,
        deliveredText: text,
        providerResults,
        channel,
      });
    if (outputOrigin.status === 'mismatch') {
      return this.failureOutbound(conversationId, 'model_origin_mismatch', outputOrigin);
    }
    return {
      text,
      outputOrigin,
      conversationId,
      structuredMessageKind,
      delivery: {
        action: 'send',
        reason: 'reply_composed',
      },
    };
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

  private failureOutbound(
    conversationId: string | null,
    reason: string,
    outputOrigin?: ReturnType<typeof missingOutputOrigin>,
  ): NormalizedOutboundMessage {
    return {
      text: null,
      ...(outputOrigin ? { outputOrigin } : {}),
      conversationId,
      structuredMessageKind: null,
      delivery: {
        action: 'failure',
        reason,
      },
    };
  }

  /**
   * Delivery observation across the complete AgentService -> renderer boundary.
   * Rebuilds the expected channel render with the independent reference
   * serializer over the immutable receipt snapshot and snapshotted authorized
   * mechanical fields, never the supplied delivery renderer. Separately
   * verifies current structured prose fields against the original model
   * fields. `candidateText` is always that expected render, never a hash
   * copied from `deliveredText`. Ordered containment alone is never
   * sufficient: full expected-render equality is required, plus snapshot
   * prose equality covering every prose-carrying field including match
   * labels. Unknown versions, missing snapshots, ungrounded provider ids,
   * swapped provider metadata, blank output and changed raw model output all
   * fail closed with mismatch evidence (renderOutbound converts mismatch into
   * a model_origin_mismatch failure delivery). transport-v2 only; v1 is
   * historical and never validates as new.
   */
  private observeModelDelivery(args: {
    origin: ModelOriginReceipt;
    structuredMessage: StructuredMessage | undefined;
    deliveredText: string;
    providerResults: ProviderSummary[];
    channel: string;
  }): ReturnType<typeof missingOutputOrigin> {
    const { origin, structuredMessage, deliveredText, providerResults, channel } = args;
    const mismatchFields: string[] = [];
    if (origin.transformationVersion !== 'transport-v2') {
      mismatchFields.push('transformation_version');
    }
    const snapshotCanonical = canonicalModelContent(origin.modelMessage);
    if (
      snapshotCanonical === null ||
      origin.modelContentSha256 === undefined ||
      hashCanonicalModelContent(snapshotCanonical) !== origin.modelContentSha256
    ) {
      mismatchFields.push('model_content_hash');
    }
    const currentCanonical = canonicalModelContent(structuredMessage);
    if (currentCanonical === null || currentCanonical !== snapshotCanonical) {
      mismatchFields.push('model_paragraphs');
    } else {
      const expectedSpans = modelSpansOf(origin.modelMessage);
      const currentSpans = structuredMessage ? modelSpansOf(structuredMessage) : null;
      if (
        expectedSpans === null || currentSpans === null ||
        currentSpans.length !== expectedSpans.length ||
        currentSpans.some((paragraph, index) => paragraph !== expectedSpans[index])
      ) {
        mismatchFields.push('model_paragraphs');
      }
    }
    const snapshotIds = new Set((origin.providerFields ?? []).map((field) => field.id));
    for (const id of modelProviderIdsOf(origin.modelMessage)) {
      if (!snapshotIds.has(id)) {
        mismatchFields.push('provider_id');
        break;
      }
    }
    const liveIds = new Set(providerResults.map((provider) => provider.id));
    for (const id of modelProviderIdsOf(origin.modelMessage)) {
      if (!liveIds.has(id)) {
        mismatchFields.push('provider_id');
        break;
      }
    }
    if (
      (origin.providerFields ?? []).length > 0 &&
      providerMetadataDiffers(origin.providerFields, providerResults)
    ) {
      mismatchFields.push('provider_metadata');
    }
    let candidateText = '';
    try {
      candidateText = buildExpectedDeliveredText({
        message: origin.modelMessage,
        providerFields: origin.providerFields ?? [],
        channel,
      });
    } catch (error) {
      if (error instanceof ReferenceRenderError) {
        mismatchFields.push('expected_render');
      } else {
        throw error;
      }
    }
    if (candidateText.length === 0 || deliveredText.length === 0) {
      mismatchFields.push('delivered_text');
    } else if (candidateText !== deliveredText) {
      mismatchFields.push('delivered_text');
    }
    return observeOutputOrigin({
      candidateText,
      deliveredText,
      transformationVersion: origin.transformationVersion,
      mismatchFields,
    });
  }

}
