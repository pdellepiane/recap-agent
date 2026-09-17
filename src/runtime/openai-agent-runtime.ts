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

import type { ActionIntent, PersistedPlan } from '../core/plan';
import { getActiveNeed } from '../core/plan';
import { normalizeExtractedOrderReference } from '../core/order-reference';
import {
  informationPaymentOptionsPolicyRequestId,
  informationValidationPolicyRequestId,
  type InformationNormalizationIssue,
  type InformationTaskResult,
  type KnowledgeEvidence,
  type PurchaseAspect,
} from '../core/information';
import {
  prioritizedProviderCategoriesForEvent,
  starterProviderCategoriesForEvent,
} from '../core/event-provider-priorities';
import { executeFinishPlanTool } from './finish-plan-tool';
import type { ProviderQuoteEffect } from './plan-completion-executor';
import { ModelComposedFailureError } from './model-composition';
import {
  buildCloseSubmissionReceipt,
  resolveCloseBlockers,
  resolveExplicitEventDate,
  type CloseBlocker,
  type CloseSubmissionInput,
} from './close-submission-summary';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ContinuityProjection,
  ExtractResult,
  ExtractRequest,
  OpenAiCallRef,
  OpenAiRequestMetrics,
  OpenAiTransportMetrics,
  ModelOriginReceipt,
  TokenUsage,
} from './contracts';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { ProviderSummary } from '../core/provider';
import type { ToolName } from './prompt-manifest';
import type { RecommendationFunnelTrace } from '../core/trace';
import type { AgentFeatureFlags } from './config';
import {
  genericMessageSchema,
  multiNeedRecommendationMessageSchema,
  pendingTaskOutcomeSchema,
  recommendationMessageSchema,
  welcomeMessageSchema,
  type PendingTaskOutcome,
} from './structured-message';
import { providerCategorySchema, categoryBucketNames } from '../core/provider-category';
import type { ProviderCategory } from '../core/provider-category';
import { projectCompletedPurchaseForModel } from './purchase-reply-projector';
import {
  projectPurchaseBalanceLimitation,
  selectPurchaseReplyOutcome,
} from './purchase-reply-projector';
import { isApprovalBoundaryAnsweredByRecord } from './purchase-reconciliation';
import {
  createDynamicExtractionSchema,
  normalizeRequestedOperation,
  resolvePurchaseResourceForAspects,
  type OpenAiInformationRequest,
  type StructuredExtraction,
} from './extraction-schemas';
import { repairVoidCloseAction } from './close-flow-schemas';
import type {
  RuntimeCapabilityManifest,
  RuntimeOperationId,
} from './capability-manifest';
import { buildRuntimeCapabilityManifest } from './capability-manifest';
import {
  deriveEstablishedExtractionDomain,
  projectExtraction,
  type ExtractionProjection,
} from './extraction-projection';
import {
  buildCompilerRequestManifest,
  deriveReplyCompilerContext,
  moduleFilesFor,
  orderInputSections,
  replyOmitsCapabilityCatalogue,
  replyOmitsOperationalNote,
  resolveWaitFollowupEvidence,
  selectExtractionModules,
  selectExtractionTools,
  selectReplyModules,
  selectReplyTools,
  type CompilerRequestManifest,
  type InputSection,
  type ManifestFactGroup,
  type ManifestToolEntry,
  type ModuleSelectionContext,
  type SelectedModule,
  type WaitFollowupEvidence,
} from './model-request-projector';
import {
  instructionModuleRegistry,
} from './prompt-manifest';
import { providerFitCriteriaSchema } from './provider-fit';
import {
  deriveDynamicAgentPolicy,
  derivePlanCapabilities,
  resolveDynamicTools,
  type DynamicAgentPolicy,
} from './dynamic-agent-policy';
import {
  buildExtractorConversationHistory,
  buildModelVisibleConversationHistory,
  buildPriorAnswerGist,
  deriveConversationContinuity,
} from './turn-message-context';
import { openAiRetryPolicy } from './openai-retry';
import { executeOpenAiStage } from './openai-stage-execution';
import { DEFAULT_PROMPT_CACHE_OPTIONS } from './openai-model-defaults';
import {
  captureOpenAiTransport,
  installOpenAiTransportCapture,
} from '../audit/openai-transport-capture';
import { buildModelOriginReceipt } from './model-composition';
import {
  MAX_PROJECTED_IMAGE_ATTACHMENTS,
  MAX_PROJECTED_IMAGE_URLS,
  isFileRefActive,
} from '../core/image-attachments';
import type { ImageAttachmentRef } from '../core/image-attachments';
import type { ImageFileAttachment, ImageObservation, ImageUrlAttachment } from './contracts';
import type { CustomerContextProjection } from './customer-context';
import { purchaseProfileCarriesBalanceFacts } from './customer-context';

const SUPPORT_EMAIL = 'hola@sinenvolturas.com';

/**
 * S2 pending-task outcome read. Returns the model-reported outcome only
 * when it is one of the typed values; anything else (absent, unknown
 * string, non-object message) reads as null. Callers additionally require
 * the pre-turn pending reference so an outcome can never clear an unrelated
 * older pending request. No keyword or string-similarity inference.
 */
export function readPendingTaskOutcome(message: unknown): PendingTaskOutcome | null {
  if (typeof message !== 'object' || message === null) return null;
  const outcome = (message as { pending_task_outcome?: unknown }).pending_task_outcome;
  if (outcome === undefined) return null;
  const parsed = pendingTaskOutcomeSchema.safeParse(outcome);
  return parsed.success ? parsed.data : null;
}

/**
 * Typed provider image-access failure (R3). Thrown ONLY by the reply
 * provider boundary when a compose call that transmitted native image
 * content (image_url or Files file_id) fails because the provider cannot
 * access that image. Carries the structured provider fields and the failed
 * attempt transport so callers can merge both attempts into totals instead
 * of overwriting the failure with success-only numbers.
 *
 * Never constructed for auth (401/403), rate limits, timeouts, generic
 * outages, guardrail trips or schema failures: those rethrow untouched.
 */
export class ProviderImageAccessError extends Error {
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly providerParam: string | null;
  readonly providerType: string | null;
  readonly failedTransport: OpenAiTransportMetrics | null;

  constructor(
    message: string,
    options: {
      status: number | null;
      providerCode: string | null;
      providerParam: string | null;
      providerType: string | null;
      failedTransport: OpenAiTransportMetrics | null;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'ProviderImageAccessError';
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.providerParam = options.providerParam;
    this.providerType = options.providerType;
    this.failedTransport = options.failedTransport;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Narrow provider download diagnostic observed on the live 400 failure
 * (eval-2026-09-11T18-13-10-185Z-31697069, case
 * live_behavior.image_url_unavailable_evidence, Lambda HTTP 500 body
 * `400 Error while downloading file. Upstream status code: 404.`).
 *
 * Reproduced end to end through the installed SDK with a mocked HTTP 400:
 * the thrown error is `BadRequestError` (constructor) with `.name`
 * `'Error'`, `.status` 400, `.code`/`.param` null (structured code absent),
 * `.type` `'invalid_request_error'`, `.message`
 * `400 Error while downloading file. Upstream status code: 404.`. Name and
 * code predicates therefore miss it; this parser matches ONLY the provider
 * download/upstream diagnostic phrasing in provider error text (top-level
 * or nested `.error` message). It never inspects user text and never
 * routes intent: input is the thrown error object only.
 */
const PROVIDER_DOWNLOAD_DIAGNOSTIC = /error\s+while\s+downloading\b/iu;
const PROVIDER_UPSTREAM_DIAGNOSTIC = /upstream\s+status\b/iu;

function readErrorMessageText(error: unknown): string | null {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return null;
}

function readNestedProviderMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const nested = (error as { error?: unknown }).error;
  if (typeof nested !== 'object' || nested === null) return null;
  const message = (nested as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : null;
}

function readProviderErrorStatusValue(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function readProviderErrorCodeValue(error: unknown): string | null {
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
 * Duck-typed narrow image-download access failure. True ONLY for a
 * status-400 provider error whose provider diagnostic text carries the
 * observed download/upstream phrasing. Generic 400s, 401/403, 429, 500s,
 * timeouts and schema failures never match. Inspects provider error text
 * only, never user text.
 */
export function isProviderImageDownloadAccessFailure(error: unknown): boolean {
  if (readProviderErrorStatusValue(error) !== 400) return false;
  const texts = [readErrorMessageText(error), readNestedProviderMessage(error)];
  return texts.some(
    (text) =>
      text !== null &&
      PROVIDER_DOWNLOAD_DIAGNOSTIC.test(text) &&
      PROVIDER_UPSTREAM_DIAGNOSTIC.test(text),
  );
}

function readProviderErrorType(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as { type?: unknown; error?: unknown };
  if (typeof record.type === 'string' && record.type.length > 0) return record.type;
  if (typeof record.error === 'object' && record.error !== null) {
    const nested = (record.error as { type?: unknown }).type;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return null;
}

function readProviderErrorParam(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as { param?: unknown; error?: unknown };
  if (typeof record.param === 'string' && record.param.length > 0) return record.param;
  if (typeof record.error === 'object' && record.error !== null) {
    const nested = (record.error as { param?: unknown }).param;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return null;
}

/**
 * Provider-boundary normalization for reply image access. Returns a typed
 * `ProviderImageAccessError` ONLY when the failing compose call transmitted
 * native image content AND the error is a narrow image-access failure:
 * status 404, a structured image/file code, or the observed 400 download
 * diagnostic. Auth/rate-limit/timeout/generic-outage/guardrail/schema
 * errors return null (rethrow untouched). The failed attempt transport is
 * attached so totals keep both attempts.
 */
export function toProviderImageAccessError(
  error: unknown,
  options: { hadImageAttachments: boolean; failedTransport: OpenAiTransportMetrics | null },
): ProviderImageAccessError | null {
  if (!options.hadImageAttachments) return null;
  if (error instanceof ProviderImageAccessError) return error;
  if (error instanceof ModelComposedFailureError) return null;
  const status = readProviderErrorStatusValue(error);
  if (status === 401 || status === 403) return null;
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return null;
  }
  const code = readProviderErrorCodeValue(error);
  const codeMatches = code !== null && /invalid_image|image_download|image_url|file_not_found/iu.test(code);
  const is404 = status === 404;
  const isDownloadFailure = isProviderImageDownloadAccessFailure(error);
  if (!is404 && !codeMatches && !isDownloadFailure) return null;
  const message = readErrorMessageText(error) ?? 'Provider image access failed.';
  return new ProviderImageAccessError(message, {
    status,
    providerCode: code,
    providerParam: readProviderErrorParam(error),
    providerType: readProviderErrorType(error),
    failedTransport: options.failedTransport,
    cause: error,
  });
}

type RuntimeContext = {
  toolUsage: ComposeReplyRequest['toolUsage'];
};

/**
 * P3 canonical-profile reference for RSVP evidence. Only the reason-only
 * unavailable state collapses to this reference (it carries no per-record
 * facts, so nothing is hidden): state, coverage, resolution, reason plus a
 * pointer to the profile. All other states travel as full RSVP evidence
 * next to the untouched profile, because without event/guest IDs a
 * name/date match cannot prove same-record identity.
 */
export type RsvpProfileReference =
  | {
      state: 'resolved_single';
      profile_ref: 'customer_context';
      coverage: 'complete' | 'partial';
      resolution: 'authoritative_invitation' | 'event_association_only' | 'not_found';
    }
  | {
      state: 'needs_event_selection';
      profile_ref: 'customer_context';
      coverage: 'complete' | 'partial';
      resolution: 'authoritative_invitation' | 'event_association_only' | 'not_found';
      candidate_count: number;
    }
  | {
      state: 'unavailable';
      profile_ref: 'customer_context';
      coverage: 'complete' | 'partial';
      resolution: 'authoritative_invitation' | 'event_association_only' | 'not_found';
      reason: 'no_invitations' | 'missing_event_identity' | 'lookup_failed';
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
  user_message: string | null;
  decision: Record<string, unknown> | null;
  extraction: Record<string, unknown>;
  plan: Record<string, unknown>;
  information_results: unknown[];
  capability_outcome?: {
    status: string;
    operation: string | null;
    reason: string | null;
    required_input: string[];
    allowed_next: string;
  } | null;
  handoff_outcome?: string | null;
  image_evidence?: {
    status: 'available' | 'unavailable';
    reason: string | null;
    caption_present: boolean;
    inspection_outcome?: 'readable' | 'unreadable' | 'human_help';
    source?: 'base64' | 'url' | 'file';
    image_url_count?: number;
    image_url_hosts?: string[];
    image_url_bytes?: number[];
    image_file_count?: number;
    /**
     * R8 same-day image observation summary (deposit seen, legibility,
     * message linkage; never structured amounts). Present only when a
     * same-day image links to this turn. Facts only, never reply prose.
     */
    observation?: ImageObservation | null;
  } | null;
  authentication_outcome?: {
    status: 'declined' | 'terminal';
    reason: string;
    protected_requests_closed: boolean;
    public_information_requests_remaining: number;
    handoff_outcome: string | null;
    no_further_credential_requests?: boolean;
  } | null;
  close_submission_receipt?: CloseSubmissionInput | null;
  rsvp_phone_evidence: ComposeReplyRequest['rsvpPhoneEvidence'] | RsvpProfileReference | null;
  rsvp_party: {
    scope: string;
    mentioned_names: string[];
    companion_count: 'one' | 'multiple' | 'unknown';
    plus_one_response: 'yes' | 'no' | 'unknown';
    plus_one_support_offer_required?: boolean;
  } | null;
  /**
   * R6 unambiguous event-time fact for the model-owned sentence. The stored
   * value, its hour24 reading and the unknown timezone travel together so a
   * stated time keeps the source hour with no guessed conversion. Present
   * only on responder_invitacion when phone evidence carries a date.
   */
  rsvp_event_time?: {
    value: string;
    hour24: string;
    timezone: 'unknown';
  } | null;
  /**
   * Completed-RSVP effect facts (verified write receipt). Parsed from the
   * completed-work outcome the RSVP lane persisted before reply composition,
   * projected here as typed evidence so the facts ride the canonical turn
   * evidence on every turn — including authentication-only and
   * operational-note-suppressed turns where the free-form note is dropped.
   * Present only when RSVP work completed with a verification receipt, so
   * unrelated turns stay byte-identical. Facts only, never reply prose.
   */
  rsvp_completed_effect?: {
    outcome: string | null;
    verification_status: string;
    requested_attendance_change_verified: boolean;
    effect_applied?: boolean;
    gateway_status?: string;
    observed?: {
      guest_id: number | null;
      event_id: number | null;
      attendance: string | null;
    } | null;
    replayed?: boolean;
    fresh_read?: boolean;
  } | null;
  turn_state: {
    focus_need_category: PersistedPlan['active_need_category'];
    missing_fields: string[];
    search_ready: boolean;
    /**
     * W1-04 L1 evidence-only facts. Verbatim user-reported support names from
     * the extraction raw strings (never the normalized event_type), the open
     * support-query flag, and the voucher/backend validation flags. Present
     * only when their typed evidence exists so unrelated turns stay
     * byte-identical. Facts for the model to verbalize, never reply prose.
     */
    reported_guest_name?: string | null;
    reported_event_name?: string | null;
    voucher_image_cannot_confirm_receipt?: boolean;
    backend_validation_pending?: boolean;
    /**
     * W1-07 L1 evidence-only facts. Typed host-withdrawal request state:
     * indexed policy hours from the completed faq result, the unsupported
     * individual-status flag, and the handoff flag mirroring the typed
     * needsHandoff rule. Present only when a faq+hostWithdrawal request
     * exists so unrelated turns stay byte-identical. Facts for the model
     * to verbalize, never reply prose.
     */
    host_withdrawal_policy_hours?: number | null;
    host_withdrawal_status_unverifiable?: boolean;
    host_withdrawal_handoff_requested?: boolean;
    /**
     * W1-10 L1 evidence-only facts. Typed close-flow contact state on
     * crear_lead_cerrar: the persisted contact email already provided (so the
     * model must not re-ask it) and the exactly-once dispatch precondition
     * (complete contact, selected provider, explicit proceed confirmation,
     * plan still active) so the model dispatches finish_plan once. Present
     * only on the close node when their typed evidence exists so unrelated
     * turns stay byte-identical. Facts for the model to verbalize, never
     * reply prose.
     */
    contact_email_already_provided?: boolean;
    /**
     * R5 evidence-only fact. The persisted contact phone is already present,
     * so the model must not re-ask it after a name/email delta whose raw
     * extraction carries phone null. Present only on crear_lead_cerrar when
     * the phone exists so unrelated turns stay byte-identical. Facts for
     * the model to verbalize, never reply prose.
     */
    contact_phone_already_provided?: boolean;
    close_ready_to_dispatch?: boolean;
    /**
     * Lean-conversation evidence-only facts. Completed close already-sent on
     * finished plans with selected providers (so a retry reports the existing
     * outcome instead of dispatching again); purchase selection needs an
     * explicit event hint or order reference before asserting event-specific
     * details; reported shortfall payment keeps the order pending with the
     * indexed 72 business hour validation window. Present only when their
     * typed evidence exists so unrelated turns stay byte-identical. Facts
     * for the model to verbalize, never reply prose.
     */
    close_already_sent?: boolean;
    /**
     * Existing-completion fact: the submission happened in a previous turn,
     * this turn executes no new provider write and exposes no finish tool.
     * Facts only, never reply prose.
     */
     close_submission_performed_this_turn?: boolean;
     reported_payment_pending_validation?: boolean;
     close_contact_missing_fields?: string[];
     /**
      * C1 close-contact completeness. True when name, email and phone are
      * all present in the plan, so the reply continues or completes the
      * close instead of re-asking contact fields. Facts only, never prose.
      */
     close_contact_complete?: boolean;
     close_unresolved_provider_needs?: Array<{
       category: string;
       candidate_provider_ids: number[];
     }>;
     /**
      * R5 authoritative close projection. The single source of truth for the
      * close turn: every eligible selected provider across all non-deferred
      * needs (never top-level active-need IDs as a substitute), deferred
      * categories (never re-mandated, never quoted), user-backed event-date
      * availability, the pending explicit close intention, and the remaining
      * typed blockers. Present only on crear_lead_cerrar so unrelated turns
      * stay byte-identical. Facts only, never reply prose.
      */
     close_selected_providers?: Array<{ category: ProviderCategory; provider_ids: number[] }>;
     close_deferred_categories?: ProviderCategory[];
     close_event_date_available?: boolean;
     close_pending_intention?: string | null;
     close_remaining_blockers?: CloseBlocker[];
     /**
      * Attempted-check facts for unavailable-image replies. The image check
      * is always present here; purchase-record evidence travels only when a
      * purchase read was actually attempted on this turn, carrying its real
      * outcome, provenance and results. An attempted read that returned
      * nothing is an empty result; a failed or unattempted read is never an
      * empty-backend claim. Facts for the model to verbalize, never prose.
      */
     record_checks?: {
       image_check: { outcome: 'unavailable'; reason: string };
       purchase_records?: {
         lookups_attempted: number;
         results_returned: number;
         outcomes: Array<{
           status: 'completed' | 'needs_input' | 'failed';
           access_method: string | null;
           result_count: number;
           failure_kind: string | null;
         }>;
       };
     };
     /**
      * Inbound-continuity facts for the model-owned send/suppress decision.
      * The model distinguishes an unanswered pending question (answer when
      * evidence suffices, preserve when it does not), a supplemental image
      * over an already answered thread (persist silently, no repeat), a new
      * question or correction (answer, never suppress for a prior answer),
      * and thanks without a task (legitimate silence). Present only when
      * their typed evidence exists so unrelated turns stay byte-identical.
      * Facts for the model to verbalize, never reply prose.
      */
     continuity_pending_question?: string | null;
     continuity_pending_task?: string | null;
     continuity_has_prior_answer?: boolean;
   };
  provider_candidates: Array<Record<string, unknown>>;
  recommendation_funnel: RecommendationFunnelTrace | null;
  /**
   * L4 Customer operations projection. Present only when the caller
   * supplied a projection for this turn; absent otherwise so unrelated
   * turns stay byte-identical.
   */
  customer_context?: CustomerContextProjection | null;
  /**
   * Wait-aware reply evidence. Present only when this turn waited on the
   * conversation lease behind a fresh prior reply (typed wait fact plus
   * bounded prior reference). Absent otherwise so unrelated turns stay
   * byte-identical. Facts only, never reply prose.
   */
  wait_followup?: WaitFollowupEvidence | null;
};

/**
 * Route-specific extraction evidence (F1): when a code challenge is active
 * for a pending protected request, the extractor must continue that request
 * with the matching authAction instead of returning an empty delta. Selected
 * deterministically from validated typed state; the model still decides the
 * action. Returns null on every other turn so unaffected routes prove no
 * byte growth.
 */
export function otpContinuationEvidence(args: {
  readonly authStatus: string;
  readonly hasPendingProtectedRequest: boolean;
}): string | null {
  if (args.authStatus !== 'code_requested' || !args.hasPendingProtectedRequest) {
    return null;
  }
  return 'Verificación pendiente: hay un código solicitado para la consulta protegida. Si el mensaje no trae el código ni un correo, continúa esa consulta en informationRequests con el authAction que corresponda (report_otp_not_received, resend_otp, change_email, decline_authentication o provide_otp); en ese caso no devuelvas un delta vacío.';
}

/**
 * W1-10 L1 evidence-only close continuity facts. Projects the persisted
 * contact-email/phone already-provided flags and the exactly-once close
 * dispatch precondition from typed close state. Present only on
 * crear_lead_cerrar when their typed evidence exists so unrelated turns stay
 * byte-identical. Facts only, never reply prose (R02). No keyword matching,
 * no fixture identifiers (R09).
 *
 * R5: the saved-phone flag stops the model from re-asking a persisted phone
 * after a name/email delta whose raw extraction carries phone null. The
 * authoritative missing-fields list (never raw extraction nulls) decides
 * what is actually asked.
 */
export function closeContinuityFacts(args: {
  readonly currentNode: string;
  readonly contactEmail: string | null;
  readonly contactPhone?: string | null;
  readonly contactComplete: boolean;
  readonly selectedProviderPresent: boolean;
  readonly closeActionType: string | null;
  readonly lifecycleState: string;
  readonly hasUserEventDate?: boolean;
}): Pick<
  ReplyTurnEvidence['turn_state'],
  'contact_email_already_provided' | 'contact_phone_already_provided' | 'close_ready_to_dispatch'
> {
  if (args.currentNode !== 'crear_lead_cerrar') return {};
  const facts: Pick<
    ReplyTurnEvidence['turn_state'],
    'contact_email_already_provided' | 'contact_phone_already_provided' | 'close_ready_to_dispatch'
  > = {};
  if (args.contactEmail !== null && args.contactEmail.trim().length > 0) {
    facts.contact_email_already_provided = true;
  }
  if (args.contactPhone !== null && args.contactPhone !== undefined && args.contactPhone.trim().length > 0) {
    facts.contact_phone_already_provided = true;
  }
  if (
    args.contactComplete &&
    args.selectedProviderPresent &&
    args.closeActionType === 'proceed_confirmed' &&
    args.lifecycleState === 'active' &&
    args.hasUserEventDate === true
  ) {
    facts.close_ready_to_dispatch = true;
  }
  return facts;
}

/**
 * R7 RSVP plus-one human-support offer (system.txt:13). When the turn
 * involves several companions (the system admits a single plus-one), the
 * reply must include the human-support offer alongside the RSVP answer.
 * The saved:false failure path already carries its own offer line; this
 * flag covers the multi-companion shape. Typed extraction evidence only;
 * no keyword matching.
 */
export function rsvpPlusOneSupportOfferRequired(args: {
  readonly companionCount: 'one' | 'multiple' | 'unknown' | null | undefined;
  readonly plusOneResponse: 'yes' | 'no' | 'unknown' | null | undefined;
  readonly hasRsvpWork: boolean;
}): boolean {
  if (!args.hasRsvpWork) return false;
  return args.companionCount === 'multiple';
}

/**
 * R7 S12 close misclassification repair. A `request_contact` close action
 * with fully seeded typed state (complete contact, eligible selection,
 * user-backed event date, active plan) carries the same dispatch
 * precondition as `proceed_confirmed` and must dispatch the effect instead
 * of asking for contact again. Returns the effective action type.
 */
export function normalizeCloseActionForDispatch(args: {
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
 * C1 close-contact evidence for the reply model. Returns the missing contact
 * fields alongside an explicit completeness flag so the reply continues or
 * completes the close instead of re-asking fields the plan already holds.
 * Facts only, never reply prose.
 */
export function closeContactEvidenceForReply(plan: {
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
}): { missingFields: string[]; complete: boolean } {
  const missingFields = (['contact_name', 'contact_email', 'contact_phone'] as const).filter(
    (field) => !plan[field],
  );
  return { missingFields: [...missingFields], complete: missingFields.length === 0 };
}

/**
 * R5 authoritative close selection. Every provider need that is NOT deferred
 * and carries selected provider IDs, in plan order. Deferred needs stay
 * deferred: they are never re-mandated and never silently selected. Typed
 * plan state only; no keyword matching, no fixture identifiers.
 */
export function collectCloseEligibleSelectedNeeds(plan: {
  readonly provider_needs: ReadonlyArray<{
    readonly category: ProviderCategory;
    readonly status: string;
    readonly selected_provider_ids: readonly number[];
  }>;
}): Array<{ category: ProviderCategory; provider_ids: number[] }> {
  const selected: Array<{ category: ProviderCategory; provider_ids: number[] }> = [];
  for (const need of plan.provider_needs) {
    if (need.status === 'deferred') continue;
    if (need.selected_provider_ids.length === 0) continue;
    selected.push({ category: need.category, provider_ids: [...need.selected_provider_ids] });
  }
  return selected;
}

/** R5 deferred categories: needs the user explicitly set aside. Never quoted, never re-mandated. */
export function collectCloseDeferredCategories(plan: {
  readonly provider_needs: ReadonlyArray<{ readonly category: ProviderCategory; readonly status: string }>;
}): ProviderCategory[] {
  return plan.provider_needs
    .filter((need) => need.status === 'deferred')
    .map((need) => need.category);
}

/**
 * Native image content for the owner reply call. URL attachments ride as
 * `{type: input_image, image: URL}`; persisted file references ride as
 * `{type: input_image, image: {id: fileId}}` (the installed SDK serializes
 * the latter as `{type: input_image, file_id}` on the Responses wire).
 * Raw URLs and file IDs travel only here, never as prompt text.
 */
export type ReplyImageContentItem =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image: string; detail: 'auto' }
  | { type: 'input_image'; image: { id: string }; detail: 'auto' };

export function buildReplyImageContent(
  text: string,
  attachments: readonly ImageUrlAttachment[],
): ReplyImageContentItem[] {
  return [
    { type: 'input_text', text },
    ...attachments.map((attachment): ReplyImageContentItem => ({
      type: 'input_image',
      image: attachment.url,
      detail: 'auto',
    })),
  ];
}

/** File-ID image items appended after the text item by the caller. */
export function buildReplyFileImageItems(
  attachments: readonly ImageFileAttachment[],
): ReplyImageContentItem[] {
  return attachments.map((attachment): ReplyImageContentItem => ({
    type: 'input_image',
    image: { id: attachment.fileId },
    detail: 'auto',
  }));
}

/**
 * Test mirror of the installed SDK converter: asserts the wire shape the
 * SDK produces from our content items without sending network traffic.
 * Authoritative file_id evidence still comes from the installed-SDK capture
 * test (fetch-mocked Responses body), never from this mirror alone.
 */
export function toResponsesWireImageItem(
  item: ReplyImageContentItem,
): Record<string, unknown> {
  if (item.type === 'input_text') return { type: 'input_text', text: item.text };
  if (typeof item.image === 'string') {
    return { type: 'input_image', image_url: item.image, detail: item.detail };
  }
  return { type: 'input_image', file_id: item.image.id, detail: item.detail };
}

/**
 * Pure URL-projection policy (testable): an explicit caller list (even
 * empty) wins and is the only selection path. Stored references are never
 * resent on recency or open-need heuristics alone: later-turn reuse needs
 * demonstrated linkage supplied by the caller (the service selects only
 * references linked to the current inbound message). Storing alone never
 * grants model access.
 */
export function resolveProjectedImageAttachments(args: {
  explicit: readonly ImageUrlAttachment[] | undefined;
  currentNode: string;
  storedRefs: readonly ImageAttachmentRef[];
  openNeed: boolean;
}): ImageUrlAttachment[] {
  if (args.explicit !== undefined) {
    return args.explicit.slice(0, MAX_PROJECTED_IMAGE_URLS);
  }
  return [];
}

/**
 * Explicit-only file-ID projection (same rule as URLs): the caller resolves
 * relevance from structured evidence and stored refs; undefined projects
 * nothing. Stored file refs are never resent on recency alone.
 */
export function resolveProjectedImageFileAttachments(args: {
  explicit: readonly ImageFileAttachment[] | undefined;
}): ImageFileAttachment[] {
  if (args.explicit === undefined) return [];
  return args.explicit.slice(0, MAX_PROJECTED_IMAGE_ATTACHMENTS);
}

/**
 * R8 same-day image observation summary (pure, testable). Images are
 * same-day context enrichment for matching against profile/DB, never
 * structured extraction of amounts/dates/phones from pixels: the summary
 * carries deposit-seen (from typed voucher/support evidence, never pixels),
 * legibility and message linkage only. Persistence is the already-stored
 * image attachment refs (message linkage + receive time); this derives the
 * observation for the reply, scoped to the same UTC day so follow-up turns
 * within the day reuse it and cross-day refs create no duties. Returns null
 * when no same-day image links to this turn so unrelated turns stay
 * byte-identical.
 */
export type ImageObservationInput = {
  /** This turn's image evidence status (pixels seen or projectable). */
  readonly imageAvailable: boolean;
  /** Native pixels ride this reply call. */
  readonly pixelsProjected: boolean;
  /** This turn carries its own image (vs a retained prior reference). */
  readonly currentTurnCarriesImage: boolean;
  /** Already-persisted attachment refs (message linkage + receive time). */
  readonly storedRefs: readonly ImageAttachmentRef[];
  readonly nowMs: number;
  /** Typed voucher/support evidence mentions a deposit, never pixel content. */
  readonly depositMentioned: boolean;
};

export function buildImageObservation(
  input: ImageObservationInput,
): ImageObservation | null {
  const today = new Date(input.nowMs).toISOString().slice(0, 10);
  const sameDayUsable = input.storedRefs.filter((ref) => {
    if (typeof ref.receivedAt !== 'string' || ref.receivedAt.slice(0, 10) !== today) return false;
    return ref.kind === 'url' || isFileRefActive(ref, input.nowMs);
  });
  const seenToday = input.imageAvailable || sameDayUsable.length > 0;
  if (!seenToday) return null;
  if (input.currentTurnCarriesImage && input.imageAvailable) {
    return {
      seenToday: true,
      legibility: input.pixelsProjected ? 'projected' : 'retained',
      linkage: 'current',
      depositMentioned: input.depositMentioned,
    };
  }
  return {
    seenToday: true,
    legibility: input.pixelsProjected ? 'projected' : 'retained',
    linkage: 'prior',
    depositMentioned: input.depositMentioned,
  };
}

/**
 * Bounded image-attachment index for extraction text. Carries message
 * linkage, receive time, active/expired status and current/prior relation
 * ONLY. No raw file IDs, URLs, bytes, captions or descriptions travel here;
 * the model selects prior_single/prior_uncertain/none from this visible
 * linkage and the runtime validates membership plus access before projecting
 * any pixels. Exported for offline tests and byte measurement.
 */
export type ImageAttachmentIndexEntry = {
  message_id: string;
  received_at: string;
  status: 'active' | 'expired';
  relation: 'current' | 'prior';
};

export function buildImageAttachmentIndexForExtraction(args: {
  attachments: readonly ImageAttachmentRef[] | undefined;
  currentMessageId: string | null | undefined;
  nowMs: number;
  limit?: number;
}): ImageAttachmentIndexEntry[] {
  const refs = [...(args.attachments ?? [])].slice(-(args.limit ?? 5));
  return refs.map((ref) => ({
    message_id: ref.messageId,
    received_at: ref.receivedAt,
    status: ref.kind === 'url' || isFileRefActive(ref, args.nowMs) ? 'active' : 'expired',
    relation: args.currentMessageId != null && ref.messageId === args.currentMessageId
      ? 'current'
      : 'prior',
  }));
}

/**
 * R6 unambiguous event-time fact. Parses the stored hour verbatim (hour24
 * as stored, e.g. 05:00 stays 05:00, never 17:00) with no timezone
 * conversion: record timestamps carry no verified timezone, so the zone is
 * always unknown. Returns null when the record carries no readable time so
 * unrelated turns stay byte-identical. Facts only, never reply prose.
 */
export function describeRsvpEventTime(
  value: string | null | undefined,
): { value: string; hour24: string; timezone: 'unknown' } | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const stored = value.trim();
  const match = stored.match(/[T ](\d{2}):(\d{2})(?::(\d{2}))?\b/u);
  if (!match) return { value: stored, hour24: 'unknown', timezone: 'unknown' };
  return { value: stored, hour24: `${match[1]}:${match[2]}`, timezone: 'unknown' };
}

/**
 * G1/G3 actual-request specs. The single typed construction boundary for the
 * request actually sent: compiler-selected instruction modules loaded via
 * PromptLoader, ordered input sections, executable tools and the local
 * relevance manifest. buildExtractionRequestSpec/buildReplyRequestSpec are
 * the production path used by extract()/composeReply() (no dual builder,
 * no extra model call); tests exercise these directly without live calls.
 */
export type ExtractionRequestSpec = {
  readonly bundleId: string;
  readonly filePaths: readonly string[];
  readonly instructions: string;
  readonly modules: readonly SelectedModule[];
  readonly input: string;
  readonly manifest: CompilerRequestManifest;
};

export type ReplyRequestSpec = {
  readonly bundleId: string;
  readonly filePaths: readonly string[];
  readonly instructions: string;
  readonly modules: readonly SelectedModule[];
  readonly input: string;
  readonly scopedTools: readonly ToolName[];
  readonly manifest: CompilerRequestManifest;
};

/**
 * Typed provenance for extraction input sections. Keys map to the evidence
 * that produced them; never customer payloads, only field paths.
 */
function extractionSectionSource(key: string): string {
  const sources: Record<string, string> = {
    history_status: 'messageContext.historyStatus',
    extractor_history: 'messageContext.recentMessages',
    prior_answer_gist: 'messageContext.recentMessages',
    pending_question_ref: 'plan.owner_pending_question',
    user_message: 'inbound.text',
    media_metadata: 'inbound.media',
    plan_snapshot: 'plan lane facts',
    allowed_actions: 'extractionProjection.allowedActionIntents',
    category_context: 'plan.event_type (transient owners only)',
    continuity_evidence: 'messageContext.continuity',
    image_presence: 'plan.image_attachments',
    otp_evidence: 'plan.user_auth + plan.information_state.pending_requests',
    operation_boundary_rule: 'compiler invariant',
    ambiguity_history_rule: 'compiler invariant',
    delta_rule: 'compiler invariant',
  };
  return sources[key] ?? 'compiler invariant';
}

/**
 * Step-D lane guard: the two established non-planning reply lanes whose node
 * contracts forbid provider recommendations and plan edits. Their reply
 * evidence carries no plan-derived provider focus.
 */
function isEstablishedNonPlanningReplyLane(
  node: ComposeReplyRequest['currentNode'],
): boolean {
  return node === 'resolver_consultas_informativas' || node === 'responder_invitacion';
}

export class OpenAiAgentRuntime implements AgentRuntime {  private readonly runner: Runner;
  private readonly imageRunner: Runner;

  constructor(
    private readonly options: {
      apiKey: string;
      replyModel: string;
      extractorModel: string;
      extractorTimeoutMs?: number;
      replyTimeoutMs?: number;
      replyProviderLimit: number;
      presentationProviderLimit: number;
      providerDetailLookupLimit: number;
      promptLoader: PromptLoader;
      providerGateway: ProviderGateway;
      capabilityManifest?: RuntimeCapabilityManifest;
      /**
       * Wait-aware reply recency bound. Caps how fresh the preceding reply
       * record must be for the no-repeat evidence plus directive to apply.
       * Absent means the typed config default (10 minutes).
       */
      priorReplyFreshnessMs?: number;
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
    installOpenAiTransportCapture(openAIClient);
    this.runner = new Runner({
      modelProvider: new OpenAIProvider({ openAIClient }),
    });
    this.imageRunner = new Runner({ modelProvider: new OpenAIProvider({ openAIClient }),
      tracingDisabled: true, traceIncludeSensitiveData: false });
  }

  async inspectImage(request: Parameters<NonNullable<AgentRuntime['inspectImage']>>[0]) {
    if (request.image.source !== 'base64') {
      throw new Error('inspectImage only handles base64 image input; URL images use the owner reply call.');
    }
    const bundle = await this.options.promptLoader.loadImageBundle();
    const schema = z.object({ outcome: z.enum(['readable', 'unreadable', 'human_help']), answer: z.string() });
    const agent = new Agent({ name: 'image_inspection', model: this.options.replyModel,
      instructions: bundle.instructions, outputType: schema,
      modelSettings: { ...this.buildModelSettings({ model: this.options.replyModel,
        cacheKey: `image:${bundle.id}` }), store: false },
    });
    const input = [{ role: 'user' as const, content: [
      { type: 'input_text' as const, text: request.caption || 'Describe brevemente esta imagen.' },
      { type: 'input_image' as const, image: `data:${request.image.mimeType};base64,${request.image.data}`, detail: 'auto' },
    ] }];
    const metrics = this.buildRequestMetrics({ instructions: bundle.instructions,
      input: JSON.stringify(input), toolCount: 0, schemaPropertyCount: 2 });
    // Do not log provider errors: they can contain portions of the image input.
    let transportMetrics: OpenAiTransportMetrics | undefined;
    const captured = await captureOpenAiTransport('image',
      async () => await this.imageRunner.run(agent, input, {
        maxTurns: 1, signal: AbortSignal.timeout(this.options.replyTimeoutMs ?? 35_000),
      }),
      (metrics) => { transportMetrics = metrics; });
    const result = captured.value;
    const output = schema.parse(result.finalOutput);
    return { ...output, tokenUsage: this.extractTokenUsage(result),
      openAiCall: this.extractOpenAiCallRef(captured.value, this.options.replyModel,
        { ...metrics, transport: transportMetrics }), promptBundleId: bundle.id };
  }

  /**
   * Build an isolated runtime for a fixture or another gateway while keeping
   * the same model, prompt, timeout, and feature configuration. This keeps
   * the manifest used during extraction/reply projection identical to the
   * manifest enforced by the service for that backend.
   */
  withCapabilityManifest(
    capabilityManifest: RuntimeCapabilityManifest,
    providerGateway: ProviderGateway = this.options.providerGateway,
  ): OpenAiAgentRuntime {
    return new OpenAiAgentRuntime({
      ...this.options,
      capabilityManifest,
      providerGateway,
    });
  }

  async extract(request: ExtractRequest): Promise<ExtractResult> {
    const policy = deriveDynamicAgentPolicy(request.plan);
    const features = this.resolveFeatureFlags();
    // L3 single production request builder: the established lane (derived
    // from typed plan state, never feature flags or message keywords) narrows
    // the schema profile, prompt files and allowed intents through
    // projectExtraction. Established purchase/support/RSVP turns omit
    // planning-only fields; unsupported operations stay expressible through
    // the capabilityBoundary field.
    const projection = this.buildExtractionProjection(request.plan, policy, features);
    const capabilities = projection.profile;
    const allowedActionIntents = projection.allowedActionIntents;
    const runExtraction = async (): Promise<ExtractResult> => {
      // G1/G2 single construction boundary: the compiler-selected modules
      // loaded via PromptLoader are the instructions actually sent.
      // Image-linkage guidance stays conditional so imageless turns stay
      // byte-identical. Auth extraction-decision guidance travels through
      // the extraction_information module (auth_control.txt); the reply
      // stage carries only its own scoped limitation wording.
      const spec = await this.buildExtractionRequestSpec(request, policy, projection);
      const bundle = { id: spec.bundleId, instructions: spec.instructions };
      const outputSchema = createDynamicExtractionSchema({
        allowedActionIntents,
        capabilities,
        // Minimum disclosure: follow-up image linkage is expressible only
        // while the plan stores image attachments.
        includeImageReference: (request.plan.image_attachments?.length ?? 0) > 0,
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

      const input = spec.input;
      const requestMetrics = this.buildRequestMetrics({
        instructions: bundle.instructions,
        input,
        toolCount: 0,
        schemaPropertyCount: Object.keys(outputSchema.shape).length,
      });

      try {
        let transportMetrics: OpenAiTransportMetrics | undefined;
        const captured = await captureOpenAiTransport('extraction',
          async () => await executeOpenAiStage({
            stage: 'extraction',
            model: this.options.extractorModel,
            timeoutMs: this.options.extractorTimeoutMs ?? 35_000,
            operation: async (signal) => await this.runner.run(extractor, input, { signal }),
          }),
          (metrics) => { transportMetrics = metrics; });
        const result = captured.value;
        return {
          extraction: this.normalizeExtraction(
            result.finalOutput as StructuredExtraction,
          ),
          tokenUsage: this.extractTokenUsage(result),
          openAiCall: this.extractOpenAiCallRef(
            result,
            this.options.extractorModel,
            { ...requestMetrics, transport: transportMetrics },
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
    };

    return runExtraction();
  }

  /**
   * L3 single production request builder. One projection selects the
   * extractor schema profile, prompt files, allowed intents and operations
   * from typed plan state plus the runtime capability manifest. Feature
   * flags stay a coarse config gate; the established lane decides the
   * minimal domain actually requested.
   */
  private buildExtractionProjection(
    plan: PersistedPlan,
    policy: DynamicAgentPolicy,
    features: AgentFeatureFlags,
  ): ExtractionProjection {
    const featureAllowedIntents = policy.allowedActionIntents.filter(
      (actionIntent) =>
        (features.providerPlanning || !this.isProviderPlanningIntent(actionIntent)) &&
        (features.rsvp || actionIntent !== 'responder_invitacion'),
    );
    const manifest = this.options.capabilityManifest ??
      buildRuntimeCapabilityManifest({
        featureFlags: {
          faq: features.faq,
          invitedEventLookup: features.invitedEventLookup,
          purchaseInformation: features.purchaseInformation,
          rsvp: features.rsvp,
          providerPlanning: features.providerPlanning,
          providerSearch: features.providerSearch,
          providerQuoteRequests: features.providerQuoteRequests,
        },
      });
    const established = deriveEstablishedExtractionDomain(plan);
    return projectExtraction({
      plan,
      manifest,
      requestedDomain: established === 'purchase'
        ? 'purchase'
        : established === 'rsvp'
          ? 'rsvp'
          : null,
      candidateOperations: [],
      allowedActionIntents: featureAllowedIntents,
    });
  }

  private normalizeExtraction(
    extraction: Partial<StructuredExtraction>,
  ): ExtractResult['extraction'] {
    const normalizationIssues: InformationNormalizationIssue[] = [];
    const extractedInformationRequests = extraction.informationRequests ?? [];
    const informationRequests = extractedInformationRequests.flatMap((request) =>
      this.normalizeInformationRequest(request, normalizationIssues),
    );
    return {
      actionIntent: extraction.actionIntent ?? null,
      requestedOperation: normalizeRequestedOperation(
        extraction.requestedOperation,
        extractedInformationRequests,
        extraction.supportAct,
      ),
      reportedEventRole: extraction.reportedEventRole ?? null,
      informationRequests,
      supportAct: extraction.supportAct ?? null,
      humanHelpIntent: extraction.humanHelpIntent ?? null,
      normalizationIssues,
      phoneConfirmation: extraction.phoneConfirmation ?? null,
      rsvpAction: extraction.rsvpAction ?? null,
      rsvpDecisionSource: (extraction.rsvpDecisionSource === 'current_message' ? 'current_message' : 'plan_state'),
      rsvpCandidateGuestId: extraction.rsvpCandidateGuestId ?? null,
      rsvpEventReference: extraction.rsvpEventReference ?? null,
      rsvpParty: extraction.rsvpParty ?? null,
      intentConfidence: extraction.intentConfidence ?? null,
      ambiguity: extraction.ambiguity ?? {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
        candidateOperations: [],
        questionKey: null,
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
      closeAction: repairVoidCloseAction(extraction.closeAction ?? null),
      pauseRequested: extraction.pauseRequested ?? false,
      contactName: extraction.contactName ?? null,
      contactEmail: extraction.contactEmail ?? null,
      contactPhone: extraction.contactPhone ?? null,
      providerFitCriteria: extraction.providerFitCriteria ?? null,
      providerQueryIntents: extraction.providerQueryIntents ?? [],
      providerPlanOperations: extraction.providerPlanOperations ?? [],
      providerExplanationRequest: extraction.providerExplanationRequest ?? null,
      providerDetailRequest: extraction.providerDetailRequest ?? null,
      imageReference: extraction.imageReference ?? null,
    };
  }

  private normalizeInformationRequest(
    request: OpenAiInformationRequest,
    normalizationIssues: InformationNormalizationIssue[] = [],
  ): ExtractResult['extraction']['informationRequests'] {
    if (request.kind === 'faq') {
      return [{ kind: 'faq', query: request.query,
        ...(request.hostWithdrawal ? {
          hostWithdrawal: request.hostWithdrawal,
          eventHint: request.eventHint,
        } : {}),
      }];
    }
    if (request.kind === 'associated_event') {
      return [
        {
          kind: 'associated_event',
          query: request.query,
          eventHint: request.eventHint,
          ...(request.authAction ? { authAction: request.authAction } : {}),
        },
      ];
    }
    if (!request.resource) {
      normalizationIssues.push({
        requestKind: 'purchase',
        field: 'resource',
        reason: 'missing_resource',
      });
      return [];
    }
    return [
      {
        kind: 'purchase',
        resource: resolvePurchaseResourceForAspects(
          request.resource,
          request.aspects.length > 0 ? request.aspects : (['summary'] as const),
        ),
        query: request.query,
        orderId: normalizeExtractedOrderReference(request.orderId),
        ...(request.eventHint ? { eventHint: request.eventHint.trim() } : {}),
        ...(request.amount !== null && request.amount !== undefined
          ? { amount: request.amount }
          : {}),
        aspects:
          request.aspects.length > 0 ? request.aspects : ['summary'],
        sensitiveFields: request.sensitiveFields,
        authAction: request.authAction ?? 'none',
      },
    ];
  }

  async composeReply(
    request: ComposeReplyRequest,
  ): Promise<ComposeReplyResult> {
    // G1/G3 single construction boundary: the compiler-selected modules
    // loaded via PromptLoader are the instructions actually sent. The node
    // bundle fallback is retired; every caller is served by the compiler.
    const spec = await this.buildReplyRequestSpec(request);
    const bundle = { id: spec.bundleId, instructions: spec.instructions };
    const scopedTools = [...spec.scopedTools];
    const tools = this.createTools(request, scopedTools);

    request.toolUsage.considered.push(...scopedTools);

    const outputSchema = this.resolveOutputSchema(request);
    const agent = new Agent<RuntimeContext, typeof outputSchema>({
      name: `reply_${request.currentNode}`,
      model: this.options.replyModel,
      instructions: () => bundle.instructions,
      tools,
      inputGuardrails: [this.createJailbreakInputGuardrail()],
      outputType: outputSchema,
      outputGuardrails: [this.createSupportEmailGuardrail<typeof outputSchema>()],
      modelSettings: this.buildReplyModelSettings(request, bundle.id),
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

    const replyImageUrls = this.resolveReplyImageUrls(request);
    const replyImageFiles = this.resolveReplyImageFiles(request);
    const input = spec.input;
    const inputPayload = replyImageUrls.length === 0 && replyImageFiles.length === 0
      ? input
      : [{
        role: 'user' as const,
        content: [
          ...buildReplyImageContent(input, replyImageUrls),
          ...buildReplyFileImageItems(replyImageFiles),
        ],
      }];
    const requestMetrics = this.buildRequestMetrics({
      instructions: bundle.instructions,
      input: typeof inputPayload === 'string' ? inputPayload : JSON.stringify(inputPayload),
      toolCount: tools.length,
      schemaPropertyCount: Object.keys(outputSchema.shape).length,
    });

    let finalOutput: unknown;
    let runResult: unknown;
    let transportMetrics: OpenAiTransportMetrics | undefined;
    try {
      const captured = await captureOpenAiTransport('reply',
        async () => await executeOpenAiStage({
          stage: 'reply',
          model: this.options.replyModel,
          timeoutMs: this.options.replyTimeoutMs ?? 22_000,
          operation: async (signal) => await this.runner.run(agent, inputPayload, {
            context: {
              toolUsage: request.toolUsage,
            },
            signal,
          }),
        }),
        (metrics) => { transportMetrics = metrics; });
      const result = captured.value;
      finalOutput = result.finalOutput;
      runResult = result;
    } catch (error) {
      if (error instanceof InputGuardrailTripwireTriggered) {
        throw new ModelComposedFailureError('guardrail_trip');
      }
      if (error instanceof OutputGuardrailTripwireTriggered) {
        finalOutput = error.result.agentOutput;
        runResult = error;
      } else {
        // R3 provider boundary: a narrow image-access failure on a call
        // that transmitted native image content normalizes to a typed
        // error carrying the failed attempt transport. Every other
        // failure (auth, rate limit, timeout, generic outage, schema)
        // rethrows untouched and is never an image diagnosis.
        const imageAccessError = toProviderImageAccessError(error, {
          hadImageAttachments: replyImageUrls.length > 0 || replyImageFiles.length > 0,
          failedTransport: transportMetrics ?? null,
        });
        if (imageAccessError !== null) throw imageAccessError;
        throw error;
      }
    }
    const parseSchema = outputSchema;
    const structured = parseSchema.parse(
      this.normalizeSupportEmails(finalOutput),
    );
    const composedReply = {
      text: '',
      structuredMessage: structured,
      tokenUsage: this.extractTokenUsage(runResult),
      recommendationFunnel,
      openAiCall: this.extractOpenAiCallRef(
        runResult,
        this.options.replyModel,
        { ...requestMetrics, transport: transportMetrics },
      ),
    };
    const origin: ModelOriginReceipt | null = buildModelOriginReceipt(
      composedReply,
      bundle.id,
      request.providerResults,
    );
    return {
      ...composedReply,
      origin,
      compilerPrompt: { bundleId: spec.bundleId, filePaths: [...spec.filePaths] },
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
    const cacheWriteInputTokens = this.resolveCacheWriteInputTokens(usage);

    if (
      inputTokens === null &&
      outputTokens === null &&
      totalTokens === null &&
      cachedInputTokens === null &&
      cacheWriteInputTokens === null
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
      cache_write_input_tokens: cacheWriteInputTokens ?? 0,
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
    return this.resolveInputDetailTokens(
      source,
      ['cached_tokens', 'cached_input_tokens', 'cachedInputTokens'],
      ['cached_tokens', 'cachedTokens'],
    );
  }

  private resolveCacheWriteInputTokens(source: Record<string, unknown>): number | null {
    return this.resolveInputDetailTokens(
      source,
      ['cache_write_tokens', 'cache_write_input_tokens', 'cacheWriteInputTokens'],
      ['cache_write_tokens', 'cacheWriteTokens'],
    );
  }

  private resolveInputDetailTokens(
    source: Record<string, unknown>,
    topLevelKeys: string[],
    detailKeys: string[],
  ): number | null {
    const topLevel = this.readNumericField(source, [
      ...topLevelKeys,
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
      const value = this.readInputTokensFromDetails(details, detailKeys);
      if (value !== null) {
        return value;
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
        const requestValue = this.readInputTokensFromDetails(
          requestEntry.input_tokens_details ?? requestEntry.inputTokensDetails,
          detailKeys,
        );
        if (requestValue !== null) {
          aggregateCachedTokens += requestValue;
          foundCachedTokens = true;
        }
      }
      if (foundCachedTokens) {
        return aggregateCachedTokens;
      }
    }

    return null;
  }

  private readInputTokensFromDetails(details: unknown, detailKeys: string[]): number | null {
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
        const cached = this.readNumericField(nested, detailKeys);
        if (cached !== null) {
          aggregateCachedTokens += cached;
          foundCachedTokens = true;
        }
      }
      return foundCachedTokens ? aggregateCachedTokens : null;
    }

    if (typeof details === 'object') {
      const nested = details as Record<string, unknown>;
      return this.readNumericField(nested, detailKeys);
    }

    return null;
  }

  /**
   * G2 extraction compiler context from typed lane state only. Transient
   * owners keep compact cross-domain recognition; established
   * purchase/support/RSVP lanes drop the inactive planning module. Provider
   * detail travels only with typed planning progress (active plan or
   * shortlist). Single derivation shared by instruction loading and input
   * category gating.
   */
  private deriveExtractionCompilerContext(plan: PersistedPlan): ModuleSelectionContext {
    const established = deriveEstablishedExtractionDomain(plan);
    const capabilities = derivePlanCapabilities(plan);
    return {
      stage: 'extraction',
      owner: established === null ? 'unknown' : 'customer_assistance',
      establishedDomain: established,
      tasks: established === null
        ? ['purchase', 'venue', 'rsvp', 'faq_policy', 'planning']
        : ['purchase', 'venue', 'rsvp', 'faq_policy'],
      approvalBoundary: false,
      hasPlanningDetail: capabilities.hasActivePlan || capabilities.hasShortlist,
    };
  }

  /**
   * G1/G3 actual extraction request construction without a model call.
   * Production path for extract(): selected module files load here and
   * become the instructions actually sent. Tests exercise this directly.
   */
  async buildExtractionRequestSpec(
    request: ExtractRequest,
    policy?: DynamicAgentPolicy,
    projection?: ExtractionProjection,
  ): Promise<ExtractionRequestSpec> {
    const resolvedPolicy = policy ?? deriveDynamicAgentPolicy(request.plan);
    const resolvedProjection = projection ??
      this.buildExtractionProjection(request.plan, resolvedPolicy, this.resolveFeatureFlags());
    const compilerContext = this.deriveExtractionCompilerContext(request.plan);
    const modules = selectExtractionModules(compilerContext);
    const includeImageReference = (request.plan.image_attachments?.length ?? 0) > 0;
    const files = moduleFilesFor(modules);
    // Minimum disclosure: follow-up image-linkage guidance travels only
    // while the plan stores image attachments. Imageless turns stay
    // byte-identical; the conditional file is attributed to the
    // cross-domain module in the manifest.
    const instructionFiles = includeImageReference &&
        !files.includes('extractors/image_reference.txt')
      ? [...files, 'extractors/image_reference.txt']
      : files;
    const bundle = await this.options.promptLoader.loadModuleFilesBundle(
      instructionFiles,
      selectExtractionTools(),
    );
    const sections = this.buildExtractorInputSections(request, resolvedPolicy, resolvedProjection);
    const input = orderInputSections(sections);
    const bytesByFile = new Map(
      bundle.filePaths.map((file, index) => [file, bundle.fileBytes[index] ?? 0] as const),
    );
    const imageReferenceBytes = includeImageReference
      ? bytesByFile.get('extractors/image_reference.txt') ?? 0
      : 0;
    const manifest = buildCompilerRequestManifest({
      selectedModules: modules,
      byteSizeOf: (id) =>
        instructionModuleRegistry[id].files.reduce(
          (total, file) => total + (bytesByFile.get(file) ?? 0),
          id === 'extraction_cross_domain' ? imageReferenceBytes : 0,
        ),
      tools: [],
      factGroups: sections.map((section) => ({
        key: section.key,
        source: extractionSectionSource(section.key),
        reason: 'typed turn evidence for the extraction delta',
        bytes: section.content === null ? 0 : Buffer.byteLength(section.content, 'utf8'),
      })),
    });
    return {
      bundleId: bundle.id,
      filePaths: bundle.filePaths,
      instructions: bundle.instructions,
      modules,
      input,
      manifest,
    };
  }

  private composeExtractorInput(
    request: ExtractRequest,
    policy: DynamicAgentPolicy,
    projection?: ExtractionProjection,
  ): string {
    return orderInputSections(this.buildExtractorInputSections(request, policy, projection));
  }

  private buildExtractorInputSections(
    request: ExtractRequest,
    policy: DynamicAgentPolicy,
    projection?: ExtractionProjection,
  ): InputSection[] {
    const planSnapshot = this.buildExtractorPlanSnapshot(request.plan, request.currentMessageId ?? null);
    // G2: module + category selection is owned by the shared compiler.
    // Established purchase/support/RSVP turns carry no provider category
    // priorities and no planning module; the model reads the current lane
    // from the plan snapshot and pending work, not planning suggestions.
    const extractionModules = selectExtractionModules(
      this.deriveExtractionCompilerContext(request.plan),
    );
    const extractionModuleIds = new Set(extractionModules.map((module) => module.id));
    const suggestedCategories = extractionModuleIds.has('extraction_planning') &&
      this.deriveExtractionCompilerContext(request.plan).hasPlanningDetail
      ? this.buildEventCategoryPromptContext(
        request.plan.event_type,
        'extractor',
      )
      : null;
    const allowedActionsLine = projection != null
      ? `${projection.textualAllowedActions} No extraigas acciones fuera de esta lista.`
      : `Acciones disponibles en este turno: ${policy.allowedActionIntents.join(', ')}. No extraigas acciones fuera de esta lista.`;
    const continuityEvidence = this.buildExtractorContinuityEvidence(request);
    const imagePresence = this.buildExtractorImagePresence(request);    const otpEvidence = otpContinuationEvidence({
      authStatus: request.plan.user_auth.status,
      hasPendingProtectedRequest: request.plan.information_state.pending_requests.some(
        (pending) => pending.kind === 'purchase' || pending.kind === 'associated_event',
      ),
    });
    return [
      { key: 'history_status', content: `Estado del historial: ${request.messageContext.historyStatus}.` },
      { key: 'extractor_history', content: `Historial reciente para el extractor, cuerpos completos sin truncar orden medio (JSON, maximo 6 turnos x 2000 bytes = 12000 bytes): ${JSON.stringify(buildExtractorConversationHistory(request.messageContext))}` },
      { key: 'prior_answer_gist', content: `Respuesta anterior del asistente (gist, JSON): ${JSON.stringify(buildPriorAnswerGist(request.messageContext))}` },
      { key: 'pending_question_ref', content: `Pregunta pendiente previa (ref, JSON): ${JSON.stringify(request.plan.owner_pending_question ?? null)}` },
      { key: 'user_message', content: `Mensaje del usuario: ${request.userMessage}` },
      {
        key: 'media_metadata',
        content: request.media && request.media.length > 0
          ? `Metadatos de archivos recibidos (no se pueden abrir ni interpretar; JSON): ${JSON.stringify(request.media.map((item) => ({ kind: item.kind, mimeType: item.mimeType, filename: item.fileName })))}.`
          : null,
      },
      { key: 'plan_snapshot', content: `Plan base (JSON compacto): ${JSON.stringify(planSnapshot)}` },
      { key: 'allowed_actions', content: allowedActionsLine },
      { key: 'category_context', content: suggestedCategories },
      { key: 'continuity_evidence', content: continuityEvidence },
      { key: 'image_presence', content: imagePresence },
      { key: 'otp_evidence', content: otpEvidence },
      { key: 'operation_boundary_rule', content: 'requestedOperation identifica una operación concreta de capability_boundary.txt; no indica disponibilidad. Usa null cuando no se solicita una operación concreta. Decide por el significado completo y el contexto, nunca por palabras aisladas.' },
      { key: 'ambiguity_history_rule', content: 'Regla de ambiguedad con historial: interpreta el mensaje con el historial reciente solo cuando el mensaje sostiene un tema; un agradecimiento, cierre o mensaje sin peticion no es una solicitud: devuelve un delta vacio. El saludo solo esta permitido en conversacion realmente nueva.' },
      { key: 'delta_rule', content: 'Extrae solo cambios nuevos del turno. Devuelve un delta vacio cuando el turno no trae cambios ni preguntas nuevas; el runtime conservara el estado persistido.' },
    ];
    // G2 note: section sequence is unchanged (stable invariants first,
    // dynamic last); only the boundary moved. Pure thanks still yields an
    // empty delta while gratitude carrying a decision stays processed
    // through the rules above.
  }

  private buildExtractorContinuityEvidence(
    request: ExtractRequest,
  ): string | null {
    const continuity = request.messageContext.continuity ?? deriveConversationContinuity({
      plan: request.plan,
      recentMessages: request.messageContext.recentMessages,
      historyStatus: request.messageContext.historyStatus,
    });

    // This projection is intentionally limited to the established,
    // anchorless information-support lane. Authentication and pending
    // lookups have their own typed continuation rules and must not inherit
    // this clarification guidance.
    if (
      request.plan.current_node !== 'resolver_consultas_informativas' ||
      request.plan.user_auth.status !== 'none' ||
      request.plan.information_state.pending_requests.length > 0 ||
      request.plan.information_state.last_completed_request != null ||
      (continuity.lane !== 'public_faq' && continuity.lane !== 'unresolved') ||
      !continuity.hasPriorContext
    ) {
      return null;
    }

    return `Evidencia condicional de continuidad (JSON): ${JSON.stringify({
      state: continuity.state,
      lane: continuity.lane,
      has_prior_context: continuity.hasPriorContext,
      welcome_allowed: continuity.welcomeAllowed,
      history_status: continuity.historyStatus,
      prior_answer_gist: buildPriorAnswerGist(request.messageContext),
      pending_question: request.plan.owner_pending_question ?? null,
    })}. El mensaje actual es un seguimiento de esta ruta: extrae el tema que el historial reciente permita sostener como solicitud concreta (incluida la pregunta pendiente que siga sin respuesta) en lugar de marcar ambiguedad; solo cuando el historial no permita sostener ningun tema devuelve ambiguedad con una sola pregunta util. Si el turno es solo agradecimiento o cierre sin peticion, devuelve un delta vacio. No saludes, no reinicies y no inventes una nueva intencion o consulta. El saludo solo esta permitido cuando welcome_allowed es true.`;
  }

  private buildExtractorImagePresence(
    request: ExtractRequest,
  ): string | null {
    // Presence plus message linkage only: whether the current turn carries
    // an image and which stored message ids it may link to (current/prior).
    // No receive times, no status menus; the linkage instruction lives in
    // the image-reference prompt. Imageless turns stay byte-identical; no
    // raw file IDs, URLs or bytes.
    const attachments = request.plan.image_attachments ?? [];
    const hasImageMedia = (request.media ?? []).some((item) => item.kind === 'image');
    if (attachments.length === 0 && !hasImageMedia) return null;
    const index = buildImageAttachmentIndexForExtraction({
      attachments,
      currentMessageId: request.currentMessageId ?? null,
      nowMs: Date.now(),
    });
    const currentActive = index.some(
      (entry) => entry.relation === 'current' && entry.status === 'active',
    );
    const linkage = index.map((entry) => ({
      message_id: entry.message_id,
      relation: entry.relation,
    }));
    return [
      `Imagen actual: ${currentActive ? 'disponible' : 'no disponible'}.`,
      `Imágenes guardadas (JSON): ${JSON.stringify(linkage)}.`,
    ].join(' ');
  }

  private buildExtractorPlanSnapshot(plan: PersistedPlan, currentMessageId: string | null): Record<string, unknown> {
    // L3 minimum disclosure: established purchase/support/RSVP turns carry
    // only their lane facts plus contact, summary and pending questions.
    // Planning-only fields stay omitted so unrelated planning state cannot
    // leak into (or change the bytes of) an information or RSVP request.
    const established = deriveEstablishedExtractionDomain(plan);
    const actionIntent =
      plan.current_node === 'resolver_consultas_informativas'
        ? null
        : plan.intent;
    // R2: bounded attachment index travels with every lane snapshot that
    // stores refs (empty indexes are dropped by omission below, so imageless
    // turns stay byte-identical). Raw file IDs, URLs and bytes never travel.
    const imageIndex = buildImageAttachmentIndexForExtraction({
      attachments: plan.image_attachments ?? [],
      currentMessageId,
      nowMs: Date.now(),
    });
    const laneFacts: Record<string, unknown> = {
      current_node: plan.current_node,
      action_intent: actionIntent,
      contact_name: plan.contact_name,
      contact_email: plan.contact_email,
      contact_phone: plan.contact_phone,
      conversation_summary: this.truncateText(plan.conversation_summary, 180),
      open_questions: plan.open_questions.slice(0, 3),
    };
    if (established === 'purchase' || established === 'support') {
      return this.omitNeutralSnapshotValues({
        ...laneFacts,
        image_attachments: imageIndex,
        information_state: {
          pending_requests: plan.information_state.pending_requests,
          selection_candidates: plan.information_state.selection_candidates,
          authentication_status: plan.user_auth.status,
          authenticated_email: plan.user_auth.email,
        },
      });
    }
    if (established === 'rsvp') {
      return this.omitNeutralSnapshotValues({
        ...laneFacts,
        image_attachments: imageIndex,
        rsvp_state: plan.rsvp_state,
      });
    }
    return {
      current_node: plan.current_node,
      action_intent: actionIntent,
      ...(imageIndex.length > 0 ? { image_attachments: imageIndex } : {}),
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
      rsvp_state: plan.rsvp_state,
    };
  }

  /**
   * L3: drop neutral values (null, empty text, empty lists) from narrowed
   * lane snapshots. Only already-extracted facts travel; the runtime
   * preserves persisted state for everything the turn leaves unchanged.
   */
  private omitNeutralSnapshotValues(
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(snapshot)) {
      if (value == null) continue;
      if (typeof value === 'string' && value.trim().length === 0) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      projected[key] = value;
    }
    return projected;
  }

  private buildModelSettings(args: {
    model: string;
    cacheKey: string;
  }): {
    promptCacheOptions: typeof DEFAULT_PROMPT_CACHE_OPTIONS;
    providerData: Record<string, unknown>;
    store: true;
    reasoning?: { effort: 'low' };
    text?: { verbosity: 'low' };
    retry?: {
      maxRetries: number;
      backoff: { initialDelayMs: number; maxDelayMs: number; multiplier: number; jitter: boolean };
      policy: typeof openAiRetryPolicy;
    };
  } {
    const baseSettings: {
      promptCacheOptions: typeof DEFAULT_PROMPT_CACHE_OPTIONS;
      providerData: Record<string, unknown>;
      store: true;
      reasoning?: { effort: 'low' };
      text?: { verbosity: 'low' };
      retry?: {
        maxRetries: number;
        backoff: { initialDelayMs: number; maxDelayMs: number; multiplier: number; jitter: boolean };
        policy: typeof openAiRetryPolicy;
      };
    } = {
      promptCacheOptions: DEFAULT_PROMPT_CACHE_OPTIONS,
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
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
      };
    }

    return baseSettings;
  }

  private isGpt5Model(model: string): boolean {
    return model.toLowerCase().startsWith('gpt-5');
  }

  /**
   * Binding-clarification skip for the reply input. The extractor ambiguity
   * note binds the model to ask instead of answering; typed evidence already
   * resolving the question lifts that bind so the model answers from
   * evidence. Two typed shapes only, mirroring response_contract.txt:29: a
   * resolved single image reference with available pixels, or candidate
   * operations whose targets already carry completed projected evidence
   * (answered information, a resolved RSVP record, or reply providers).
   * Genuine multi-candidate ambiguity without such evidence keeps the note.
   * Facts only, never reply prose.
   */
  private ambiguityAnsweredByProjectedEvidence(request: ComposeReplyRequest): boolean {
    if (
      request.imageEvidence?.status === 'available' &&
      request.extraction.imageReference?.status === 'prior_single'
    ) {
      return true;
    }
    if (this.approvalBoundaryAnsweredByRecord(request)) {
      return true;
    }
    const candidates = request.extraction.ambiguity?.candidateOperations ?? [];
    if (candidates.length === 0) {
      return false;
    }
    if ((request.informationResults ?? []).some((result) => result.status === 'completed')) {
      return true;
    }
    if (request.rsvpPhoneEvidence?.state === 'resolved_single') {
      return true;
    }
    return request.providerResults.length > 0;
  }

  /**
   * Approval-boundary resolution for the reply input. Delegates to the
   * single-owner predicate in purchase-reconciliation (receipt amount alone
   * never proves approval; the record or the established receipt boundary
   * settles it). Anything else keeps the ambiguity note. Typed evidence
   * only; no phrase detection. Facts only, never reply prose.
   */
  private approvalBoundaryAnsweredByRecord(
    request: ComposeReplyRequest,
  ): boolean {
    if (request.extraction.ambiguity?.questionKey !== 'status_or_proof_review') {
      return false;
    }
    const receiptContext =
      request.imageEvidence != null ||
      (request.plan.image_attachments?.length ?? 0) > 0 ||
      (request.extraction.imageReference != null &&
        request.extraction.imageReference.status !== 'none');
    return isApprovalBoundaryAnsweredByRecord({
      informationResults: request.informationResults ?? [],
      receiptContext,
    });
  }

  /**
   * G3: typed reply-compiler context from node and structured evidence.
   * Single derivation lives in model-request-projector.ts so instruction
   * loading, input gating and stub doubles share it; this wrapper keeps the
   * call sites unchanged.
   */
  private deriveReplyCompilerContext(
    request: ComposeReplyRequest,
  ): ModuleSelectionContext {
    const base = deriveReplyCompilerContext(request);
    // The wait-followup directive module loads only with the evidence
    // present, keeping stable prompt prefixes and cache keys otherwise.
    if (this.waitFollowupEvidenceFor(request) === null) return base;
    return { ...base, tasks: [...base.tasks, 'wait_followup'] };
  }

  /**
   * Wait-aware reply evidence for this turn, or null when the turn did not
   * wait behind a fresh prior reply. Single derivation shared by module
   * selection and evidence projection so the directive never loads without
   * its evidence. Facts only, never reply prose.
   */
  private waitFollowupEvidenceFor(
    request: ComposeReplyRequest,
  ): WaitFollowupEvidence | null {
    return resolveWaitFollowupEvidence({
      turnWait: request.messageContext.turnWait ?? null,
      lastOutbound: request.plan.last_outbound_context ?? null,
      nowMs: Date.now(),
      freshnessMs: this.options.priorReplyFreshnessMs,
    });
  }

  private composeConversationInput(
    request: ComposeReplyRequest,
    recommendationFunnel: RecommendationFunnelTrace,
    replyImageUrls: readonly ImageUrlAttachment[] = [],
    replyImageFiles: readonly ImageFileAttachment[] = [],
  ): string {
    return this.buildReplyInputParts(request, recommendationFunnel, replyImageUrls, replyImageFiles)
      .filter((part): part is { key: string; source: string; content: string } => part.content !== null)
      .map((part) => part.content)
      .join('\n\n');
  }

  /**
   * G1/G3 actual reply request construction without a model call.
   * Production path for composeReply(): selected module files load here and
   * become the instructions actually sent, scoped tools are the tools
   * actually exposed, and the manifest describes that exact request.
   * Tests exercise this directly.
   */
  async buildReplyRequestSpec(
    request: ComposeReplyRequest,
  ): Promise<ReplyRequestSpec> {
    const replyCompiler = this.deriveReplyCompilerContext(request);
    const modules = selectReplyModules(replyCompiler);
    const files = moduleFilesFor(modules);
    const maximumTools = selectReplyTools(replyCompiler, request.currentNode);
    const allowedTools = resolveDynamicTools({
      plan: request.plan,
      maximumTools,
      searchReady: request.searchReady,
      providerResults: request.providerResults,
      capabilityManifest: this.options.capabilityManifest,
      currentNode: request.currentNode,
      closeConfirmed: request.extraction?.closeAction?.type === 'proceed_confirmed',
    });
    // An extracted confirmation does not supply a missing event date.
    const groundedDate = resolveExplicitEventDate(null, this.closeDateEvidence(request));
    const scopedTools = groundedDate === null
      ? allowedTools.filter((name) => name !== 'finish_plan')
      : allowedTools;
    const bundle = await this.options.promptLoader.loadModuleFilesBundle(files, maximumTools);
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
    const replyImageUrls = this.resolveReplyImageUrls(request);
    const replyImageFiles = this.resolveReplyImageFiles(request);
    const parts = this.buildReplyInputParts(
      request,
      recommendationFunnel,
      replyImageUrls,
      replyImageFiles,
      scopedTools,
    );
    const input = parts
      .filter((part): part is { key: string; source: string; content: string } => part.content !== null)
      .map((part) => part.content)
      .join('\n\n');
    const bytesByFile = new Map(
      bundle.filePaths.map((file, index) => [file, bundle.fileBytes[index] ?? 0] as const),
    );
    const manifest = buildCompilerRequestManifest({
      selectedModules: modules,
      byteSizeOf: (id) =>
        instructionModuleRegistry[id].files.reduce(
          (total, file) => total + (bytesByFile.get(file) ?? 0),
          0,
        ),
      tools: scopedTools.map((name): ManifestToolEntry => ({
        name,
        reason: `executable reply tool for ${replyCompiler.owner} tasks ${replyCompiler.tasks.join(',') || 'none'}`,
      })),
      factGroups: parts.map((part): ManifestFactGroup => ({
        key: part.key,
        source: part.source,
        reason: 'typed turn evidence for the reply decision',
        bytes: part.content === null ? 0 : Buffer.byteLength(part.content, 'utf8'),
      })),
    });
    return {
      bundleId: bundle.id,
      filePaths: bundle.filePaths,
      instructions: bundle.instructions,
      modules,
      input,
      scopedTools,
      manifest,
    };
  }

  /**
   * G3: tool guidance text names exactly the scoped tools exposed on this
   * call. The spec path passes the resolved tools deterministically (no new
   * model call); legacy callers without resolved tools fall back to the
   * considered list.
   */
  private buildReplyInputParts(
    request: ComposeReplyRequest,
    recommendationFunnel: RecommendationFunnelTrace,
    replyImageUrls: readonly ImageUrlAttachment[] = [],
    replyImageFiles: readonly ImageFileAttachment[] = [],
    resolvedTools?: readonly ToolName[],
  ): Array<{ key: string; source: string; content: string | null }> {
    const authenticationOnlyReply =
      this.isAuthenticationOnlyInformationReply(request);
    const resolvedInformationReply =
      request.currentNode === 'resolver_consultas_informativas' ||
      request.currentNode === 'responder_invitacion';
    const authorizedToolNames = resolvedTools ?? request.toolUsage.considered;
    const allowedTools =
      authorizedToolNames.length > 0
        ? authorizedToolNames.join(', ')
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
    // R5: the close turn is a single source of truth. Focus follows the
    // eligible selection across all non-deferred needs, never the active
    // need (which may be a deferred category with an empty top-level
    // selection). Deferred categories are never foregrounded.
    const isCloseReply = request.currentNode === 'crear_lead_cerrar';
    const closeEligibleNeeds = isCloseReply ? collectCloseEligibleSelectedNeeds(request.plan) : [];
    // Step-D projection narrowing: established information/RSVP lanes never
    // act on provider focus (their node contracts forbid recommendations and
    // plan edits), so a coincidental planning selection must not leak into
    // their reply evidence. Planning lanes keep the previous fallback.
    const focusNeedCategory = isEstablishedNonPlanningReplyLane(request.currentNode)
      ? request.turnDecision?.focusNeedCategory ?? null
      : isCloseReply
        ? (closeEligibleNeeds[0]?.category ?? request.turnDecision?.focusNeedCategory ?? null)
        : request.turnDecision?.focusNeedCategory ?? activeNeed?.category ?? null;

    const evidence = this.buildReplyTurnEvidence({
      request,
      focusNeedCategory,
      providerResults,
      recommendationFunnel: stripProviders ? null : recommendationFunnel,
      authenticationOnlyReply,
    });
    // Packet D: an image-evidence reply (pixels available or unavailable)
    // never carries planning-category suggestions or the capability
    // catalog, on any node. Those projections manufactured unrelated
    // planning intent on media turns; the model answers from the image
    // plus authorized existing evidence, or asks only for the specific
    // missing factual information. Never an image or URL request.
    const hasImageEvidence = request.imageEvidence != null;
    // G3: reply module selection is owned by the shared compiler. Mixed
    // tasks compose every applicable module; escalation stays an outcome
    // attached to its task and never suppresses a completed answer module.
    const replyCompiler = this.deriveReplyCompilerContext(request);
    const replyModules = selectReplyModules(replyCompiler);
    const replyModuleIds = new Set(replyModules.map((module) => module.id));
    const omitBroadCatalogue = authenticationOnlyReply || resolvedInformationReply || isCloseReply || hasImageEvidence ||
      replyOmitsCapabilityCatalogue(replyCompiler.owner) ||
      replyModuleIds.has('reply_handoff_outcome') ||
      request.handoffOutcome != null;
    // S3: a free-form operational note is dropped when the turn already
    // carries the same outcome as typed evidence the node contract renders
    // (capability decision, handoff result, auth outcome). Genuine errors
    // without typed outcomes keep their note instead of going silent. A
    // completed-RSVP carryover is exempt: its outcome details (requested
    // action, verification state, attendance effect) live only in the note
    // next to the typed invitation evidence, so suppressing it on mixed
    // RSVP+information/image or terminal turns would drop the completed
    // action from the reply input.
    const hasTypedOutcome = (request.capabilityDecision !== null &&
      request.capabilityDecision !== undefined) ||
      request.handoffOutcome != null ||
      request.authenticationOutcome != null || request.imageEvidence != null;
    const omitOperationalNote = replyOmitsOperationalNote({ hasTypedOutcome }) &&
      request.rsvpWorkCompleted !== true;
    // FAQ empty-evidence boundary: only when knowledge returned a completed
    // FAQ result with no evidence (policy results carry their own facts).
    // Reuses the retired contract wording verbatim; non-empty FAQ turns and
    // unrelated lanes stay byte-identical.
    const hasEmptyFaqEvidence = (request.informationResults ?? []).some(
      (result) => result.kind === 'faq' && result.status === 'completed' &&
        (result.evidence?.length ?? 0) === 0 &&
        result.hostWithdrawalPolicy === undefined,
    );
    const parts: Array<{ key: string; source: string; content: string | null }> = [
      { key: 'turn_evidence', source: 'buildReplyTurnEvidence', content: `Evidencia canónica del turno (JSON): ${JSON.stringify(evidence, null, 2)}` },
      {
        key: 'ambiguity_note',
        source: 'extraction.ambiguity',
        content: request.extraction.ambiguity?.status === 'ambiguous' &&
        !this.ambiguityAnsweredByProjectedEvidence(request)
          ? 'Contrasta las interpretaciones con los hechos e imágenes disponibles. Responde si la evidencia resuelve la referencia; pregunta solo si persisten alternativas que cambian la respuesta o la acción.'
          : null,
      },
      {
        key: 'faq_empty_note',
        source: 'informationResults.faq',
        content: hasEmptyFaqEvidence
          ? 'Para FAQ, responde únicamente con la evidencia recuperada. Si evidence está vacío, di que no tienes esa información específica y ofrece apoyo humano.'
          : null,
      },
      // R5: the close prompt carries the actual close outcome/next field
      // only. Planning-category suggestions and the capability catalog are
      // unrelated branches on this node; the node contract owns close policy.
      // S3: handoff/auth/support turns never receive planning categories or
      // the broad catalogue even when tools are textually listed as none.
      {
        key: 'category_context',
        source: 'plan.event_type',
        content: omitBroadCatalogue
          ? null
          : this.buildEventCategoryPromptContext(request.plan.event_type, 'reply'),
      },
      {
        key: 'capability_catalogue',
        source: 'capabilityManifest',
        content: omitBroadCatalogue
          ? null
          : `Capacidades habilitadas para este nodo:\n${this.summarizeEnabledCapabilities(request.currentNode)}`,
      },
    ];

    // G3 relevance: the interview category appendix travels only with the
    // planning owner module. Support turns running on stale planning nodes
    // answer from typed evidence, never from a category menu.
    if (request.currentNode === 'entrevista' && replyModuleIds.has('reply_planning_owner')) {
      parts.push({
        key: 'interview_categories',
        source: 'providerCategoryBuckets',
        content: `Categorías de proveedores disponibles: ${categoryBucketNames.join(', ')}. No inventar categorías fuera de esta lista.`,
      });
    }

    if (!authenticationOnlyReply && !resolvedInformationReply) {
      parts.push({
        key: 'authorized_tools',
        source: 'resolved reply tools',
        content: `Herramientas autorizadas en este nodo: ${allowedTools}`,
      });
    }

    if (request.errorMessage && !authenticationOnlyReply && !omitOperationalNote) {
      parts.push({
        key: 'operational_note',
        source: 'errorMessage (no typed outcome)',
        content: `Nota operativa: ${request.errorMessage}`,
      });
    }

    if ((replyImageUrls.length > 0 || replyImageFiles.length > 0) && !authenticationOnlyReply) {
      const imageCount = replyImageUrls.length + replyImageFiles.length;
      // R2 single canonical occurrence: pixels ride as native image content
      // and the node contract carries the image policy; this pointer only
      // states relevance. No links, IDs or prose directions here.
      parts.push({
        key: 'image_pointer',
        source: 'projected image attachments',
        content: `Imágenes adjuntas (${imageCount}): úsalas solo si aportan a la tarea actual o si la persona pregunta por lo visible.`,
      });
    }

    return parts;
  }
  // S6 single serialization: the canonical customer_context evidence block
  // above is the only customerContext serialization. No second JSON append
  // travels as prose; the node contract carries the usage policy.

  /**
   * URL/file shape evidence for the model context: counts, byte sizes and
   * hosts. Raw customer media links and file IDs never enter evidence, logs
   * or traces.
   */
  private buildImageUrlEvidenceFacts(
    request: ComposeReplyRequest,
  ): { image_url_count?: number; image_url_hosts?: string[]; image_url_bytes?: number[]; image_file_count?: number } {
    const resolved = this.resolveReplyImageUrls(request);
    const resolvedFiles = this.resolveReplyImageFiles(request);
    const facts: { image_url_count?: number; image_url_hosts?: string[]; image_url_bytes?: number[]; image_file_count?: number } = {};
    if (resolvedFiles.length > 0) facts.image_file_count = resolvedFiles.length;
    if (resolved.length === 0) return facts;
    const hosts: string[] = [];
    const bytes: number[] = [];
    for (const attachment of resolved) {
      try {
        const host = new URL(attachment.url).hostname.toLowerCase();
        if (!hosts.includes(host)) hosts.push(host);
      } catch {
        hosts.push('[invalid]');
      }
      bytes.push(Buffer.byteLength(attachment.url, 'utf8'));
    }
    return { image_url_count: resolved.length, image_url_hosts: hosts, image_url_bytes: bytes };
  }

  private resolveReplyImageUrls(request: ComposeReplyRequest): ImageUrlAttachment[] {
    // Explicit-only selection: the caller resolves relevance. Stored
    // references are never resent on recency or open-need heuristics alone.
    return resolveProjectedImageAttachments({
      explicit: request.imageUrlAttachments,
      currentNode: request.currentNode,
      storedRefs: request.plan.image_attachments ?? [],
      openNeed: (request.extraction.informationRequests?.length ?? 0) > 0 ||
        (request.plan.information_state.pending_requests?.length ?? 0) > 0,
    });
  }

  private resolveReplyImageFiles(request: ComposeReplyRequest): ImageFileAttachment[] {
    // Explicit-only selection, same rule as URLs: relevance is resolved by
    // the caller from structured evidence plus stored file refs.
    return resolveProjectedImageFileAttachments({
      explicit: request.imageFileAttachments,
    });
  }

  private buildReplyTurnEvidence(args: {
    request: ComposeReplyRequest;
    focusNeedCategory: PersistedPlan['active_need_category'];
    providerResults: ProviderSummary[];
    recommendationFunnel: RecommendationFunnelTrace | null;
    authenticationOnlyReply: boolean;
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
    const hasRsvpPhoneEvidence =
      args.request.currentNode === 'responder_invitacion' &&
      args.request.rsvpPhoneEvidence !== null &&
      args.request.rsvpPhoneEvidence !== undefined;
    const supportContinuity = this.buildSupportContinuityFacts(args.request);
    const voucherContinuity = this.buildVoucherContinuityFacts(args.request);
    const recordCheckFacts = this.buildRecordCheckFacts(args.request);
    const hostWithdrawalContinuity = this.buildHostWithdrawalFacts(args.request);
    const leanContinuity = this.buildLeanConversationFacts(args.request);
    const inboundContinuity = this.buildContinuityFacts(args.request);
    const closeContactEvidence = closeContactEvidenceForReply(args.request.plan);
    const closeContactComplete = closeContactEvidence.complete;
    // R5 single source of truth: eligible selection counts non-deferred needs
    // only; deferred selections never exist and top-level active-need IDs
    // never substitute for all selected needs.
    const closeEligibleSelectedNeeds = collectCloseEligibleSelectedNeeds(args.request.plan);
    const closeDeferredCategories = args.request.currentNode === 'crear_lead_cerrar'
      ? collectCloseDeferredCategories(args.request.plan)
      : [];
    const closeEventDateAvailable = args.request.currentNode === 'crear_lead_cerrar'
      ? resolveExplicitEventDate(null, this.closeDateEvidence(args.request)) !== null
      : false;
    const closeContinuity = closeContinuityFacts({
      currentNode: args.request.currentNode,
      contactEmail: args.request.plan.contact_email,
      contactPhone: args.request.plan.contact_phone,
      contactComplete: closeContactComplete,
      selectedProviderPresent: closeEligibleSelectedNeeds.length > 0,
      closeActionType: args.request.extraction.closeAction?.type ?? null,
      lifecycleState: args.request.plan.lifecycle_state,
      hasUserEventDate: args.request.currentNode === 'crear_lead_cerrar'
        ? closeEventDateAvailable
        : resolveExplicitEventDate(null, this.closeDateEvidence(args.request)) !== null,
    });
    const closeContactMissingFields = args.request.currentNode === 'crear_lead_cerrar'
      ? closeContactEvidence.missingFields
      : [];
    const unresolvedProviderNeeds = args.request.currentNode === 'crear_lead_cerrar'
      ? args.request.plan.provider_needs
        .filter((need) => need.status === 'shortlisted' && need.selected_provider_ids.length === 0)
        .map((need) => ({
          category: need.category,
          candidate_provider_ids: need.recommended_providers.map((provider) => provider.id),
        }))
      : [];
    const closeRemainingBlockers = args.request.currentNode === 'crear_lead_cerrar'
      ? resolveCloseBlockers({
        contactComplete: closeContactComplete,
        eventDateAvailable: closeEventDateAvailable,
        hasEligibleSelection: closeEligibleSelectedNeeds.length > 0,
        hasUnresolvedShortlist: unresolvedProviderNeeds.length > 0,
      })
      : [];
    // R5: on the close node the model sees only eligible selected providers.
    // Rejected deferred recommendation cards (e.g. a deferred Catering
    // shortlist) never reach provider_candidates.
    const closeEligibleProviderIds = new Set(
      closeEligibleSelectedNeeds.flatMap((need) => need.provider_ids),
    );
    const evidenceProviders = args.request.currentNode === 'crear_lead_cerrar'
      ? args.providerResults.filter((provider) => closeEligibleProviderIds.has(provider.id))
      : args.providerResults;
    // P3 no-merge projection: RSVP per-record facts and profile
    // invitations stay separate evidence (no IDs, so no identity merge);
    // only reason-only unavailable collapses to a profile reference.
    const rsvpProfile = this.resolveRsvpProfileProjection(args.request);
    // Wait-aware reply evidence shares the single module-selection
    // derivation, so the directive never loads without its evidence.
    const waitFollowup = this.waitFollowupEvidenceFor(args.request);

    return {
      nodes: {
        previous: this.modelVisibleNodeName(args.request.previousNode),
        current: this.modelVisibleNodeName(args.request.currentNode),
      },
      history: {
        status: args.request.messageContext.historyStatus,
        recent_messages: args.authenticationOnlyReply || hasRsvpPhoneEvidence
          ? []
          : buildModelVisibleConversationHistory(args.request.messageContext),
      },
      user_message: args.authenticationOnlyReply ? null : args.request.userMessage,
      decision,
      extraction: args.authenticationOnlyReply
        ? {}
        : hasRsvpPhoneEvidence
          ? this.buildMinimalRsvpExtractionSnapshot(args.request.extraction)
        : this.buildReplyExtractionSnapshot(
            args.request.extraction,
            args.request.currentNode,
          ),
      plan: args.authenticationOnlyReply
        ? { current_node: args.request.plan.current_node }
        : hasRsvpPhoneEvidence
          ? this.buildMinimalRsvpPlanSnapshot(args.request.plan)
        : this.buildPromptPlanSnapshot(
            args.request.plan,
            args.focusNeedCategory,
            args.request.currentNode,
            args.request.extraction.ambiguity?.status === 'ambiguous',
          ),
      information_results: (args.request.informationResults ?? []).map((result) =>
        this.projectInformationResultForReplyWithProfile(result, args.request),
      ),
      capability_outcome: args.request.capabilityDecision
        ? {
            status: args.request.capabilityDecision.status,
            operation: 'operation' in args.request.capabilityDecision
              ? args.request.capabilityDecision.operation
              : null,
            reason: 'reason' in args.request.capabilityDecision
              ? args.request.capabilityDecision.reason
              : null,
            required_input: [],
            allowed_next: args.request.capabilityDecision.status === 'clarify'
              ? 'clarify'
              : args.request.capabilityDecision.status === 'unsupported'
                ? 'handoff_once'
                : 'continue',
          }
        : null,
      // Step-D projection narrowing: terminal/declined auth turns already
      // carry the handoff inside authentication_outcome, so the duplicated
      // top-level block is omitted there. Non-auth handoff paths keep it.
      ...(args.request.authenticationOutcome
        ? {}
        : { handoff_outcome: args.request.handoffOutcome ?? null }),
      image_evidence: args.request.imageEvidence
        ? {
            status: args.request.imageEvidence.status,
            reason: args.request.imageEvidence.reason,
            caption_present: args.request.imageEvidence.captionPresent,
            ...(args.request.imageEvidence.inspectionOutcome
              ? { inspection_outcome: args.request.imageEvidence.inspectionOutcome }
              : {}),
            ...(args.request.imageEvidence.source
              ? { source: args.request.imageEvidence.source }
              : {}),
            ...(args.request.imageEvidence.observation
              ? { observation: args.request.imageEvidence.observation }
              : {}),
            ...this.buildImageUrlEvidenceFacts(args.request),
          }
        : null,
      authentication_outcome: args.request.authenticationOutcome
        ? {
            status: args.request.authenticationOutcome.status,
            reason: args.request.authenticationOutcome.reason,
            protected_requests_closed: args.request.authenticationOutcome.protectedRequestsClosed,
            public_information_requests_remaining:
              args.request.authenticationOutcome.publicInformationRequestsRemaining,
            handoff_outcome: args.request.authenticationOutcome.handoffOutcome,
            ...(args.request.authenticationOutcome.noFurtherCredentialRequests === true
              ? { no_further_credential_requests: true }
              : {}),
            ...(args.request.authenticationOutcome.scopedPhoneSearchMiss === true
              ? { scoped_phone_search_miss: true }
              : {}),
          }
        : null,
      ...(args.request.currentNode === 'crear_lead_cerrar'
        ? { close_submission_receipt: buildCloseSubmissionReceipt(args.request.toolUsage.outputs) }
        : {}),
      rsvp_phone_evidence: rsvpProfile.evidence,
      rsvp_party: args.request.currentNode === 'responder_invitacion' && args.request.extraction.rsvpParty
          ? {
            scope: args.request.extraction.rsvpParty.scope,
            mentioned_names: args.request.extraction.rsvpParty.mentioned_names,
            companion_count: args.request.extraction.rsvpParty.companion_count ?? 'unknown',
            plus_one_response: args.request.extraction.rsvpParty.plus_one_response ?? 'unknown',
            // R7: plus-one/support offer flag travels with the party facts
            // so the model-owned sentence includes the human-support offer.
            ...(rsvpPlusOneSupportOfferRequired({
              companionCount: args.request.extraction.rsvpParty.companion_count ?? 'unknown',
              plusOneResponse: args.request.extraction.rsvpParty.plus_one_response ?? 'unknown',
              hasRsvpWork: true,
            }) ? { plus_one_support_offer_required: true } : {}),
          }
        : null,
      ...this.buildRsvpTimeFacts(args.request),
      ...this.buildRsvpCompletedEffectFacts(args.request),
      turn_state: {
        focus_need_category: args.focusNeedCategory,
        missing_fields: args.request.missingFields.map((field) =>
          this.userVisibleMissingFieldLabel(field),
        ),
        search_ready: args.request.searchReady,
        ...supportContinuity,
        ...voucherContinuity,
        ...recordCheckFacts,
        ...hostWithdrawalContinuity,
        ...leanContinuity,
        ...inboundContinuity,
        ...closeContinuity,
        ...(args.request.currentNode === 'crear_lead_cerrar'
          ? {
            close_contact_missing_fields: closeContactMissingFields,
            close_unresolved_provider_needs: unresolvedProviderNeeds,
            ...(closeContactComplete ? { close_contact_complete: true } : {}),
            close_selected_providers: closeEligibleSelectedNeeds,
            close_deferred_categories: closeDeferredCategories,
            close_event_date_available: closeEventDateAvailable,
            close_pending_intention: args.request.extraction.closeAction?.type ?? null,
            close_remaining_blockers: closeRemainingBlockers,
          }
          : {}),
      },
      provider_candidates: evidenceProviders.map((provider, index) =>
        this.buildProviderEvidence(provider, index + 1),
      ),
      recommendation_funnel: args.recommendationFunnel,
      ...(rsvpProfile.profile !== null && rsvpProfile.profile !== undefined
        ? { customer_context: rsvpProfile.profile }
        : {}),
      ...(waitFollowup !== null ? { wait_followup: waitFollowup } : {}),
    };
  }

  /**
   * W1-04 L1 evidence-only support continuity facts. Projects the verbatim
   * user-reported guest/event names from the extraction raw strings
   * (supportAct person/eventReference, never the normalized event_type).
   * A support act does not establish a review or
   * an unresolved task. Returns no keys without a support act so unrelated turns
   * stay byte-identical. Facts only, never reply prose (R02).
   */
  private buildSupportContinuityFacts(
    request: ComposeReplyRequest,
  ): Pick<
    ReplyTurnEvidence['turn_state'],
    'reported_guest_name' | 'reported_event_name'
  > {
    const act = request.extraction.supportAct ?? null;
    if (act === null) return {};
    const guestName = act.personReference?.trim() ? act.personReference.trim() : null;
    const eventName = act.eventReference?.trim() ? act.eventReference.trim() : null;
    const facts: Pick<
      ReplyTurnEvidence['turn_state'],
      'reported_guest_name' | 'reported_event_name'
    > = {};
    if (guestName !== null) facts.reported_guest_name = guestName;
    if (eventName !== null) facts.reported_event_name = eventName;
    return facts;
  }

  /**
   * W1-04 L1 evidence-only voucher continuity facts. When typed evidence shows
   * a voucher/submission report (payment_proof topic or submission_reported
   * detail, or a reported purchase amount on a continued support thread) over
   * a completed pending purchase, projects the image-cannot-confirm and
   * backend-validation-pending facts so the model verbalizes them. Returns no
   * keys otherwise. No keyword matching, no fixture identifiers (R09).
   */
  private buildVoucherContinuityFacts(
    request: ComposeReplyRequest,
  ): Pick<
    ReplyTurnEvidence['turn_state'],
    'voucher_image_cannot_confirm_receipt' | 'backend_validation_pending'
  > {
    const act = request.extraction.supportAct ?? null;
    if (act === null) return {};
    const voucherReport = act.topic === 'payment_proof' ||
      act.detail === 'submission_reported';
    const reportedPurchaseAmount = request.extraction.informationRequests.some((item) =>
      item.kind === 'purchase' && item.amount !== null && item.amount !== undefined
    );
    const continuedSupportThread = act.kind === 'report_issue' ||
      act.kind === 'provide_detail' ||
      act.kind === 'defer_submission';
    if (!voucherReport && !(continuedSupportThread && reportedPurchaseAmount)) return {};
    const hasPendingPurchase = (request.informationResults ?? []).some((result) =>
      result.kind === 'purchase' &&
      result.status === 'completed' &&
      result.purchases.some((purchase) =>
        (purchase.paymentStatus ?? '').trim().toLocaleLowerCase('en') === 'pending'
      )
    );
    if (!hasPendingPurchase) return {};
    return {
      voucher_image_cannot_confirm_receipt: true,
      backend_validation_pending: true,
    };
  }

  /**
   * Attempted-check facts for unavailable-image replies. Projects the typed
   * record of the checks actually attempted on this turn (image availability
   * with its typed reason) so the model grounds truthful uncertainty with a
   * bounded fact-ask instead of vague recovery. Purchase-record evidence is
   * omitted entirely when no purchase read was attempted: zero unperformed
   * reads can never read as an empty backend. When purchase reads ran, each
   * outcome travels with its real status, provenance and result count, so an
   * attempted read that returned nothing stays distinguishable from a failed
   * or unavailable one. Returns no keys when the image is available or no
   * image evidence travels, so unrelated turns stay byte-identical. Facts
   * only, never reply prose.
   */
  private buildRecordCheckFacts(
    request: ComposeReplyRequest,
  ): Pick<ReplyTurnEvidence['turn_state'], 'record_checks'> {
    if (request.imageEvidence?.status !== 'unavailable') return {};
    const purchaseLookups = (request.informationResults ?? []).filter(
      (
        result,
      ): result is InformationTaskResult & { kind: 'purchase' } =>
        result.kind === 'purchase',
    );
    const imageCheck = {
      outcome: 'unavailable' as const,
      reason: request.imageEvidence.reason ?? 'unknown',
    };
    if (purchaseLookups.length === 0) {
      return { record_checks: { image_check: imageCheck } };
    }
    const outcomes = purchaseLookups.map((result) => {
      if (result.status === 'completed') {
        return {
          status: 'completed' as const,
          access_method: result.accessMethod ?? null,
          result_count: result.purchases.length,
          failure_kind: null as string | null,
        };
      }
      if (result.status === 'needs_input') {
        return {
          status: 'needs_input' as const,
          access_method: null as string | null,
          result_count: 0,
          failure_kind: null as string | null,
        };
      }
      return {
        status: 'failed' as const,
        access_method: result.accessMethod ?? null,
        result_count: 0,
        failure_kind: result.failureKind,
      };
    });
    const resultsReturned = outcomes.reduce(
      (total, outcome) => total + outcome.result_count,
      0,
    );
    return {
      record_checks: {
        image_check: imageCheck,
        purchase_records: {
          lookups_attempted: purchaseLookups.length,
          results_returned: resultsReturned,
          outcomes,
        },
      },
    };
  }

  private buildLeanConversationFacts(
    request: ComposeReplyRequest,
  ): Pick<
    ReplyTurnEvidence['turn_state'],
    'close_already_sent' |
    'close_submission_performed_this_turn' |
    'reported_payment_pending_validation'
  > {
    const facts: Pick<
      ReplyTurnEvidence['turn_state'],
      'close_already_sent' |
      'close_submission_performed_this_turn' |
      'reported_payment_pending_validation'
    > = {};
    const hasSelectedProviders = request.plan.provider_needs.some((need) =>
      (need.selected_provider_ids?.length ?? 0) > 0,
    );
    if (request.plan.lifecycle_state === 'finished' && hasSelectedProviders) {
      facts.close_already_sent = true;
      facts.close_submission_performed_this_turn = false;
    }
    const act = request.extraction.supportAct ?? null;
    const continuedThread = act !== null && (
      act.kind === 'report_issue' ||
      act.kind === 'provide_detail' ||
      act.kind === 'defer_submission'
    );
    const reportedBudget = request.extraction.budgetSignal !== null &&
      request.extraction.budgetSignal !== undefined &&
      request.extraction.budgetSignal.trim().length > 0;
    if (continuedThread && reportedBudget) {
      const hasPendingPurchase = (request.informationResults ?? []).some((result) =>
        result.kind === 'purchase' &&
        result.status === 'completed' &&
        result.purchases.some((purchase) =>
          (purchase.paymentStatus ?? '').trim().toLocaleLowerCase('en') === 'pending',
        ),
      );
      if (hasPendingPurchase) {
        facts.reported_payment_pending_validation = true;
      }
    }
    return facts;
  }

  /**
   * Inbound-continuity facts for the model-owned send/suppress decision.
   * Resolved from the explicit caller projection when present, otherwise
   * derived from the same persisted typed state (owner pending refs, open
   * questions, information pending/completed, delivered history), so image
   * and normal turns share one projection. Returns no keys when no pending
   * question, pending task, or prior answer exists so unrelated turns stay
   * byte-identical. Facts only, never reply prose. No keyword matching, no
   * fixture identifiers, no timers.
   */
  private buildContinuityFacts(
    request: ComposeReplyRequest,
  ): Pick<
    ReplyTurnEvidence['turn_state'],
    'continuity_pending_question' | 'continuity_pending_task' | 'continuity_has_prior_answer'
  > {
    const explicit: ContinuityProjection | null = request.continuity ?? null;
    const plan = request.plan;
    const pendingQuestion = explicit?.pendingQuestion ??
      plan.owner_pending_question ??
      plan.open_questions[0] ??
      null;
    const pendingTask = explicit?.pendingTask ?? plan.owner_pending_task ?? null;
    const hasCompletedInformation = explicit?.hasCompletedInformation ??
      plan.information_state.last_completed_request != null;
    const continuity = request.messageContext.continuity ?? deriveConversationContinuity({
      plan,
      recentMessages: request.messageContext.recentMessages,
      historyStatus: request.messageContext.historyStatus,
    });
    const hasPriorOutbound = explicit?.hasPriorOutbound ?? continuity.hasPriorOutbound;
    const facts: Pick<
      ReplyTurnEvidence['turn_state'],
      'continuity_pending_question' | 'continuity_pending_task' | 'continuity_has_prior_answer'
    > = {};
    if (pendingQuestion !== null && pendingQuestion.trim().length > 0) {
      facts.continuity_pending_question = pendingQuestion.trim().slice(0, 280);
    }
    if (pendingTask !== null && pendingTask.trim().length > 0) {
      facts.continuity_pending_task = pendingTask.trim().slice(0, 280);
    }
    if (hasPriorOutbound || hasCompletedInformation) {
      facts.continuity_has_prior_answer = true;
    }
    return facts;
  }

  /**
   * W1-07 L1 evidence-only host-withdrawal facts. Projects the indexed
   * policy hours from the completed faq result plus the unsupported
   * individual-status and handoff flags from the typed faq+hostWithdrawal
   * requests (mirroring the needsReview/needsHandoff rule in
   * handleHostWithdrawalInformation). Returns no keys when no hostWithdrawal
   * request exists so unrelated turns stay byte-identical. Facts only,
   * never reply prose (R02). No keyword matching, no fixture identifiers.
   */
  private buildHostWithdrawalFacts(
    request: ComposeReplyRequest,
  ): Pick<
    ReplyTurnEvidence['turn_state'],
    'host_withdrawal_policy_hours' | 'host_withdrawal_status_unverifiable' | 'host_withdrawal_handoff_requested'
  > {
    const hostRequests = request.extraction.informationRequests.filter((item) =>
      item.kind === 'faq' && item.hostWithdrawal);
    if (hostRequests.length === 0) return {};
    let policyHours: number | null = null;
    for (const result of request.informationResults ?? []) {
      if (result.kind === 'faq' && result.status === 'completed') {
        const hours = result.hostWithdrawalPolicy?.maxBusinessHours ?? null;
        if (typeof hours === 'number' && Number.isFinite(hours)) {
          policyHours = hours;
          break;
        }
      }
    }
    const needsReview = hostRequests.some((item) =>
      item.kind === 'faq' && item.hostWithdrawal === 'individual_status');
    const needsHandoff = needsReview ||
      request.extraction.actionIntent === 'solicitar_humano';
    const facts: Pick<
      ReplyTurnEvidence['turn_state'],
      'host_withdrawal_policy_hours' | 'host_withdrawal_status_unverifiable' | 'host_withdrawal_handoff_requested'
    > = {};
    if (policyHours !== null) facts.host_withdrawal_policy_hours = policyHours;
    if (needsReview) facts.host_withdrawal_status_unverifiable = true;
    if (needsHandoff) facts.host_withdrawal_handoff_requested = true;
    return facts;
  }

  /**
   * R6 RSVP time facts. Projects the stored event date verbatim with its
   * hour24 reading and unknown timezone for the model-owned sentence.
   * Present on responder_invitacion when phone evidence carries a date, and
   * on information turns carrying completed RSVP work (mixed turns), so the
   * completed action keeps its event time even after a profile collapse.
   * Unrelated turns stay byte-identical. Facts only, never prose.
   */
  private buildRsvpTimeFacts(
    request: ComposeReplyRequest,
  ): Pick<ReplyTurnEvidence, 'rsvp_event_time'> {
    if (
      request.currentNode !== 'responder_invitacion' &&
      !(request.currentNode === 'resolver_consultas_informativas' &&
        request.rsvpWorkCompleted === true)
    ) {
      return {};
    }
    const evidence = request.rsvpPhoneEvidence;
    if (!evidence || evidence.state === 'unavailable') return {};
    const rawDate = evidence.state === 'resolved_single'
      ? evidence.event.event_date
      : evidence.candidates.map((candidate) => candidate.event_date).find((date) => date !== null) ?? null;
    const fact = describeRsvpEventTime(rawDate);
    if (!fact) return {};
    // A date-only record carries no verified hour: project no fact so the
    // model-owned sentence states no hour instead of a midnight default.
    if (fact.hour24 === 'unknown') return {};
    return { rsvp_event_time: fact };
  }

  /**
   * Completed-RSVP effect facts. The RSVP lane persists a JSON outcome
   * carrying the verified write receipt (verification_status,
   * requested_attendance_change_verified, observed attendance) before reply
   * composition; that string doubles as the free-form operational note and is
   * dropped on authentication-only or typed-outcome turns. This projection
   * parses the same outcome into typed evidence so the verification facts
   * always ride the canonical turn evidence, independently of both the
   * operational-note suppression and the authentication-only filter. Only
   * verification-bearing outcomes project (read-only/selection/handoff
   * outcomes already ride their own typed evidence). Unrelated turns stay
   * byte-identical. Facts only, never reply prose. No keyword matching: the
   * outcome is structured JSON validated field by field.
   */
  private buildRsvpCompletedEffectFacts(
    request: ComposeReplyRequest,
  ): Pick<ReplyTurnEvidence, 'rsvp_completed_effect'> {
    if (request.rsvpWorkCompleted !== true) return {};
    if (!request.errorMessage) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.errorMessage);
    } catch {
      return {};
    }
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const outcome = typeof record['outcome'] === 'string' ? record['outcome'] : null;
    const verificationValue = record['verification'];
    const verificationRecord = typeof verificationValue === 'object' && verificationValue !== null
      ? verificationValue as Record<string, unknown>
      : null;
    const source = verificationRecord ?? record;
    const verificationStatus = source['verification_status'];
    const attendanceVerified = source['requested_attendance_change_verified'];
    if (typeof verificationStatus !== 'string' || typeof attendanceVerified !== 'boolean') {
      return {};
    }
    const effect: NonNullable<ReplyTurnEvidence['rsvp_completed_effect']> = {
      outcome,
      verification_status: verificationStatus,
      requested_attendance_change_verified: attendanceVerified,
    };
    const effectApplied = source['effect_applied'];
    if (typeof effectApplied === 'boolean') effect.effect_applied = effectApplied;
    const gatewayStatus = source['gateway_status'];
    if (typeof gatewayStatus === 'string') effect.gateway_status = gatewayStatus;
    const observedValue = source['observed'];
    if (observedValue === null) {
      effect.observed = null;
    } else if (typeof observedValue === 'object' && observedValue !== null) {
      const observed = observedValue as Record<string, unknown>;
      const guestId = observed['guest_id'];
      const eventId = observed['event_id'];
      const attendance = observed['attendance'];
      effect.observed = {
        guest_id: typeof guestId === 'number' ? guestId : null,
        event_id: typeof eventId === 'number' ? eventId : null,
        attendance: typeof attendance === 'string' ? attendance : null,
      };
    }
    const replayed = source['replayed'];
    if (typeof replayed === 'boolean') effect.replayed = replayed;
    const freshRead = source['fresh_read'];
    if (typeof freshRead === 'boolean') effect.fresh_read = freshRead;
    return { rsvp_completed_effect: effect };
  }

  private buildMinimalRsvpExtractionSnapshot(
    extraction: ComposeReplyRequest['extraction'],
  ): Record<string, unknown> {
    return {
      action_intent: extraction.actionIntent,
      rsvp_action: extraction.rsvpAction ?? null,
      decision_source: (extraction.rsvpDecisionSource === 'current_message' ? 'current_message' : 'plan_state'),
      rsvp_party: extraction.rsvpParty
        ? {
            scope: extraction.rsvpParty.scope,
            mentioned_names: extraction.rsvpParty.mentioned_names,
            companion_count: extraction.rsvpParty.companion_count ?? 'unknown',
            plus_one_response: extraction.rsvpParty.plus_one_response ?? 'unknown',
          }
        : null,
          ambiguity: extraction.ambiguity
          ? {
              status: extraction.ambiguity.status,
              candidate_operations: extraction.ambiguity.candidateOperations ?? [],
              question_key: extraction.ambiguity.questionKey ?? null,
            }
        : null,
    };
  }

  private buildMinimalRsvpPlanSnapshot(
    plan: PersistedPlan,
  ): Record<string, unknown> {
    return {
      current_node: plan.current_node,
      contact_phone_present: Boolean(
        plan.contact_phone_extension && plan.contact_phone_number,
      ),
      rsvp_state: {
        status: plan.rsvp_state.status,
        pending_action: plan.rsvp_state.pending_action,
        selection_attempts: plan.rsvp_state.selection_attempts,
      },
    };
  }

  private isAuthenticationOnlyInformationReply(
    request: ComposeReplyRequest,
  ): boolean {
    const results = request.informationResults ?? [];
    return request.currentNode === 'resolver_consultas_informativas' &&
      results.length > 0 &&
      results.every((result) => result.status === 'needs_input');
  }

  private modelVisibleNodeName(node: ComposeReplyRequest['currentNode']): string {
    return node;
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

  private buildReplyExtractionSnapshot(
    extraction: ComposeReplyRequest['extraction'],
    node: ComposeReplyRequest['currentNode'],
  ): Record<string, unknown> {
    // R5: the close turn sees one authoritative close intent, never redundant
    // raw contact nulls. A name/email delta with phone null must not read as
    // a missing phone: merged plan completeness (turn_state + plan.contact)
    // is the only contact truth. Selection state also lives in the plan
    // projection; raw hints never substitute for it.
    if (node === 'crear_lead_cerrar') {
      return {
        action_intent: extraction.actionIntent,
        close_action: extraction.closeAction ?? null,
        contact_delta: {
          name_present: extraction.contactName !== null,
          email_present: extraction.contactEmail !== null,
          phone_present: extraction.contactPhone !== null,
        },
        ambiguity: extraction.ambiguity
          ? {
              status: extraction.ambiguity.status,
              interpretations: extraction.ambiguity.interpretations ?? [],
            }
          : null,
      };
    }
    if (node === 'resolver_consultas_informativas') {
      return {
        action_intent: extraction.actionIntent,
        requested_operation: extraction.requestedOperation ?? null,
        information_requests: extraction.informationRequests,
        support_act: extraction.supportAct ?? null,
        phone_confirmation: extraction.phoneConfirmation ?? null,
        ...(extraction.contactEmail ? { contact_email: extraction.contactEmail } : {}),
        ...(extraction.imageReference && extraction.imageReference.status !== 'none'
          ? {
            image_reference: {
              status: extraction.imageReference.status,
              referenced_message_ids: extraction.imageReference.referencedMessageIds,
            },
          }
          : {}),
        ambiguity: extraction.ambiguity
          ? {
              status: extraction.ambiguity.status,
              interpretations: extraction.ambiguity.interpretations ?? [],
            }
          : null,
      };
    }

    if (node === 'responder_invitacion') {
      return {
        action_intent: extraction.actionIntent,
        rsvp_action: extraction.rsvpAction ?? null,
        decision_source: (extraction.rsvpDecisionSource === 'current_message' ? 'current_message' : 'plan_state'),
        rsvp_candidate_guest_id: extraction.rsvpCandidateGuestId ?? null,
        rsvp_event_reference: extraction.rsvpEventReference ?? null,
        rsvp_party: extraction.rsvpParty
          ? {
              scope: extraction.rsvpParty.scope,
              mentioned_names: extraction.rsvpParty.mentioned_names,
              companion_count: extraction.rsvpParty.companion_count ?? 'unknown',
              plus_one_response: extraction.rsvpParty.plus_one_response ?? 'unknown',
            }
          : null,
        ambiguity: extraction.ambiguity
          ? {
              status: extraction.ambiguity.status,
              interpretations: extraction.ambiguity.interpretations ?? [],
            }
          : null,
      };
    }

    return {
      action_intent: extraction.actionIntent,
      intent_confidence: extraction.intentConfidence,
      ambiguity: extraction.ambiguity
        ? {
            status: extraction.ambiguity.status,
            interpretations: extraction.ambiguity.interpretations ?? [],
          }
        : null,
      information_requests: extraction.informationRequests,
      phone_confirmation: extraction.phoneConfirmation ?? null,
      rsvp_action: extraction.rsvpAction ?? null,
      rsvp_candidate_guest_id: extraction.rsvpCandidateGuestId ?? null,
      rsvp_event_reference: extraction.rsvpEventReference ?? null,
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
    const base = this.resolveBaseOutputSchema(request);
    // S2 pending-task outcome: turns carrying owner_pending_question expose
    // a small conditional result field on the existing reply schema. The
    // active question reference travels in the request (explicit
    // pendingQuestionRef, else continuity, else plan); unrelated turns keep
    // the base schema byte-identical with no extra model call.
    if (this.activePendingQuestionRef(request) === null) return base;
    return base.extend({ pending_task_outcome: pendingTaskOutcomeSchema.optional() });
  }

  /**
   * Active owner pending-question reference for this turn, if the turn
   * carries one. Explicit request ref wins; otherwise the shared continuity
   * projection; otherwise the plan. Null means unrelated turn: no outcome
   * field, no extra call, no prompt change.
   */
  private activePendingQuestionRef(request: ComposeReplyRequest): string | null {
    const explicit = request.pendingQuestionRef?.trim();
    if (explicit && explicit.length > 0) return explicit;
    const projected = request.continuity?.pendingQuestion?.trim();
    if (projected && projected.length > 0) return projected;
    const stored = request.plan.owner_pending_question?.trim();
    return stored && stored.length > 0 ? stored : null;
  }

  private resolveBaseOutputSchema(request: ComposeReplyRequest) {
    if (request.extraction.ambiguity?.status === 'ambiguous') {
      return genericMessageSchema;
    }

    const node = request.currentNode;
    // R2: a fresh image carrying a question is an established owner turn, not
    // a welcome turn. The welcome schema must not swallow the image question
    // merely because current_node is still contacto_inicial.
    const hasImageForReply = request.imageEvidence?.status === 'available' ||
      (request.imageUrlAttachments?.length ?? 0) > 0 ||
      (request.imageFileAttachments?.length ?? 0) > 0;
    if (hasImageForReply && (node === 'contacto_inicial' || node === 'entrevista')) {
      return genericMessageSchema;
    }
    if (
      (node === 'contacto_inicial' || node === 'entrevista') &&
      request.messageContext.continuity?.welcomeAllowed === false
    ) {
      return genericMessageSchema;
    }
    if ((node === 'contacto_inicial' || node === 'entrevista') && request.extraction.reportedEventRole) {
      return genericMessageSchema;
    }
    if (node === 'contacto_inicial') {
      // R7: a stale contacto_inicial node with established plan context is
      // a mid-conversation turn, never a greeting. True starts only.
      if (this.hasPlanningContext(request.plan)) {
        return genericMessageSchema;
      }
      return welcomeMessageSchema;
    }
    // R7: mid-conversation entrevista never welcomes. Welcome schema only
    // on a true conversation start (welcomeAllowed true with no persisted
    // plan context); every other entrevista turn uses the generic schema
    // so the reply is a history-grounded clarification, never a greeting.
    if (node === 'entrevista') {
      if (
        request.messageContext.continuity?.welcomeAllowed === true &&
        !this.hasPlanningContext(request.plan)
      ) {
        return welcomeMessageSchema;
      }
      return genericMessageSchema;
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
      return genericMessageSchema;
    }
    return genericMessageSchema;
  }

  private summarizeEnabledCapabilities(node: ComposeReplyRequest['currentNode']): string {
    return this.resolveEnabledCapabilityLines()
      .filter((line) => {
        if (node === 'resolver_consultas_informativas') {
          return line.startsWith('Responder preguntas') ||
            line.startsWith('Consultar información de eventos') ||
            line.startsWith('Consultar tus pedidos') ||
            line.startsWith('Consultar detalles de regalos');
        }
        if (node === 'responder_invitacion') {
          return line.startsWith('Registrar la asistencia');
        }
        return true;
      })
      .map((line) => `- ${line}`)
      .join('\n');
  }

  private resolveEnabledCapabilityLines(): string[] {
    const capabilities = this.resolveFeatureFlags();
    const operationAvailable = (
      operation: Parameters<typeof this.capabilityIsAvailable>[0],
      fallback: boolean,
    ): boolean => this.capabilityIsAvailable(operation, fallback);
    const lines: string[] = [];

    if (operationAvailable('provider.plan', capabilities.providerPlanning)) {
      lines.push('Planificar un evento desde cero o continuar un plan guardado.');
    }
    if (
      operationAvailable('provider.plan', capabilities.providerPlanning) &&
      operationAvailable('provider.search', capabilities.providerSearch)
    ) {
      lines.push('Detectar varias necesidades de proveedores y buscar o recomendar opciones de la plataforma de proveedores.');
    }
    if (
      operationAvailable('provider.plan', capabilities.providerPlanning) &&
      operationAvailable('provider.quote.write', capabilities.providerQuoteRequests)
    ) {
      lines.push('Ayudar a elegir proveedores y preparar solicitudes de cotización/contacto.');
    }
    if (operationAvailable('faq.read', capabilities.faq)) {
      lines.push('Responder preguntas generales sobre Sin Envolturas y ofrecer atención humana cuando el caso requiera revisar operaciones.');
    }
    if (
      operationAvailable('event.association.read', capabilities.invitedEventLookup) &&
      operationAvailable('event.detail.read', capabilities.invitedEventLookup)
    ) {
      lines.push('Consultar información de eventos asociados al usuario, como confirmación de asistencia, relación con el evento y anfitriones.');
    }
    if (
      operationAvailable('rsvp.state.read', capabilities.rsvp) &&
      operationAvailable('rsvp.response.write', capabilities.rsvp)
    ) {
      lines.push('Registrar la asistencia o inasistencia de una persona invitada usando el número del canal y la confirmación explícita de la persona.');
    }
    if (
      operationAvailable('purchase.orders.read', capabilities.purchaseInformation) &&
      operationAvailable('purchase.gift_detail.read', capabilities.purchaseInformation)
    ) {
      lines.push('Consultar tus pedidos recientes o buscar uno directamente por su número después de verificar primero tu número actual de WhatsApp; si no es posible, se usa el correo con un código de un solo uso.');
      lines.push('Consultar detalles de regalos comprados, como pago, dedicatoria, tarjeta física, envío y agradecimiento, cuando estén disponibles.');
    }

    return lines.length > 0
      ? lines
      : ['Explicar qué información necesita para derivar al canal correcto.'];
  }

  private capabilityIsAvailable(
    operation: RuntimeOperationId,
    fallback: boolean,
  ): boolean {
    return this.options.capabilityManifest?.[operation].available ?? fallback;
  }

  private resolveFeatureFlags(): AgentFeatureFlags {
    return {
      providerPlanning: true,
      providerSearch: true,
      providerQuoteRequests: true,
      faq: true,
      invitedEventLookup: true,
      purchaseInformation: true,
      rsvp: true,
      ...this.options.features,
    };
  }

  private isProviderPlanningIntent(actionIntent: ActionIntent): boolean {
    return actionIntent !== 'solicitar_humano' && actionIntent !== 'responder_invitacion';
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
      // Deferred needs stay deferred: their rejected cards never re-enter
      // reply candidates.
      if (need.status === 'deferred') {
        continue;
      }
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
    compilerBundleId: string,
  ) {
    // The cache key names the instructions actually sent so shared prefixes
    // stay stable across turns with the same module identity.
    const settings = this.buildModelSettings({
      model: this.options.replyModel,
      cacheKey: `reply:${request.currentNode}:${compilerBundleId}`,
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
      phoneConfirmation: null,
      rsvpAction: null,
      rsvpDecisionSource: 'plan_state',
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
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

    let completionEffects: readonly ProviderQuoteEffect[] = [];
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
          'Cierra el plan definitivamente. Envía solicitudes de cotización (/quote) a cada proveedor seleccionado por necesidad usando los datos de contacto ya guardados en el plan (contact_name, contact_email, contact_phone). Requiere event_date respaldada por una fecha explícita del usuario; nunca una fecha inventada ni tomada de instrucciones. Requiere al menos un proveedor seleccionado y datos de contacto completos.',
        parameters: z.object({ event_date: z.string().min(1) }).strict(),
        execute: async ({ event_date }: { event_date: string }) => {
          const resolvedDate = resolveExplicitEventDate(event_date, this.closeDateEvidence(request));
          this.recordToolInput(toolUsage, 'finish_plan', { event_date: resolvedDate ?? event_date });
          toolUsage.called.push('finish_plan');
          const result = await executeFinishPlanTool({
            plan,
            providerGateway: this.options.providerGateway,
            eventDate: resolvedDate,
            priorEffects: completionEffects,
          });
          if ('effects' in result) completionEffects = result.effects;
           if ('planUpdate' in result && result.planUpdate !== null) {
             await request.onPlanCompleted?.(result.planUpdate);
           }
           this.recordToolOutput(toolUsage, 'finish_plan', result);
           if ('detail' in result) {
             return {
               status: result.status,
               error: result.error,
               eventDate: null,
               effects: [],
             };
           }
           return {
             status: result.status,
             eventDate: result.eventDate,
             effects: result.effects.map((effect) => ({
               providerId: effect.providerId,
               category: effect.category,
               status: effect.status,
               eventDate: effect.eventDate,
               receiptId: effect.receiptId,
               attemptCount: effect.attemptCount,
             })),
           };
         },
      }),
    } satisfies Record<ToolName, ReturnType<typeof tool>>;

    return allowedTools.map((name) => toolMap[name]);
  }

  private closeDateEvidence(request: ComposeReplyRequest): string {
    return [request.userMessage, ...request.messageContext.recentMessages
      .filter((message) => message.direction === 'inbound')
      .map((message) => message.body)].join('\n');
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
    node: ComposeReplyRequest['currentNode'],
    neutralizeUnselectedProviders = false,
  ): Record<string, unknown> {
    // S3: handoff and support-terminal nodes carry the same narrow
    // information snapshot as the resolver node: requested task status,
    // unresolved alternatives and auth state only. Planning fields,
    // provider needs and catalogue context never travel on these turns;
    // the handoff outcome module owns the result facts.
    if (
      node === 'resolver_consultas_informativas' ||
      node === 'solicitar_agente_humano' ||
      node === 'ofrecer_agente_humano' ||
      node === 'informar_error_reintento'
    ) {
      return {
        current_node: plan.current_node,
        ...(plan.contact_email ? { contact_email: plan.contact_email } : {}),
        information_state: {
          pending_requests: plan.information_state.pending_requests,
          selection_candidates: plan.information_state.selection_candidates,
          authentication_status: plan.user_auth.status,
          ...(plan.user_auth.email ? { authenticated_email: plan.user_auth.email } : {}),
          ...(plan.user_auth.failed_code_attempts !== null && plan.user_auth.failed_code_attempts !== undefined ? { failed_code_attempts: plan.user_auth.failed_code_attempts } : {}),
        },
      };
    }

    if (node === 'responder_invitacion') {
      return {
        current_node: plan.current_node,
        contact_phone_present: Boolean(plan.contact_phone_extension && plan.contact_phone_number),
        rsvp_state: plan.rsvp_state,
      };
    }

    // R5 authoritative close projection. One compact merged truth replaces
    // the raw-contact dump and the active-need shortlist: validated contact
    // completeness with the single missing-fields list, ALL eligible selected
    // providers across non-deferred needs with their titles, and deferred
    // categories with no recommendation cards. Top-level selected IDs are
    // never a substitute for per-need selection, so they are omitted here.
    if (node === 'crear_lead_cerrar') {
      const closeContact = closeContactEvidenceForReply(plan);
      return {
        lifecycle_state: plan.lifecycle_state,
        current_node: this.modelVisibleNodeName(plan.current_node),
        contact: {
          name: plan.contact_name,
          email: plan.contact_email,
          phone: plan.contact_phone,
          complete: closeContact.complete,
          missing_fields: [...closeContact.missingFields],
        },
        close_selected_providers: plan.provider_needs
          .filter((need) => need.status !== 'deferred' && need.selected_provider_ids.length > 0)
          .map((need) => ({
            category: need.category,
            provider_ids: [...need.selected_provider_ids],
            provider_titles: need.selected_provider_ids
              .map((selectedProviderId) =>
                need.recommended_providers.find((provider) => provider.id === selectedProviderId)?.title ?? null,
              )
              .filter((title): title is string => Boolean(title)),
          })),
        close_deferred_categories: plan.provider_needs
          .filter((need) => need.status === 'deferred')
          .map((need) => need.category),
      };
    }

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
      rsvp_state: plan.rsvp_state,
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
        recommended_provider_ids: need.status === 'deferred' ? [] : need.recommended_provider_ids.slice(0, 6),
        recommended_provider_titles: need.status === 'deferred' || neutralizeUnselectedProviders
          ? []
          : need.recommended_providers.slice(0, 3).map((provider) => provider.title),
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

  /**
   * P3 single-serialization projection. When the canonical customer_context
   * profile is present, overlapping customer facts in completed purchase /
   * associated_event results are replaced with a reference to the profile:
   * independent effect/outcome facts (status, coverage, outcome kind,
   * reference counts, access provenance, disclosures, next action,
   * missing/ambiguous inputs) are preserved, the duplicated customer-data
   * payload travels only in customer_context. FAQ evidence, needs_input
   * guidance and failed messages carry no customer facts and travel
   * unchanged. When no profile is present the full projection travels, so
   * owners without a profile keep their evidence. No compatibility shim:
   * consumers read customer_context for facts on profile turns. No extra
   * model pass, no new histories or tools.
   */
  private projectInformationResultForReplyWithProfile(
    result: InformationTaskResult,
    request: ComposeReplyRequest,
  ): unknown {
    if (request.customerContext == null) {
      return this.projectInformationResultForReply(result, request);
    }
    if (result.status === 'completed' && result.kind === 'purchase') {
      const purchaseRequests = request.extraction.informationRequests.filter(
        (informationRequest) => informationRequest.kind === 'purchase',
      );
      const reportedPurchase = purchaseRequests.find(
        (informationRequest) => informationRequest.amount !== null &&
          informationRequest.amount !== undefined,
      );
      const requestedAspects = purchaseRequests.flatMap(
        (informationRequest) => informationRequest.aspects,
      );
      // The projector's concrete object shape is intentionally treated as evidence data here.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const full = projectCompletedPurchaseForModel(result, {
        requestedAspects,
        referenceAuthorized: result.accessMethod === 'authenticated_account',
        userReported: {
          amount: reportedPurchase?.amount ?? null,
        },
        permittedNextAction: request.extraction.requestedOperation === 'purchase.modify'
          ? 'human_support'
          : null,
        missingInputs: result.needsSelection ? ['purchase_selection'] : [],
        ambiguousInputs: request.extraction.ambiguity?.status === 'ambiguous'
          ? ['purchase_interpretation']
          : [],
      }) as Record<string, unknown>;
      const { outcome: _droppedCustomerPayload, ...reference } = full;
      void _droppedCustomerPayload;
      // Lane A: the canonical profile carries raw totals without the
      // explicit balance distinction, so a bare profile_ref would let the
      // order total read as an amount owed. Retain a compact typed
      // limitation (existing projection, no arithmetic) unless the
      // referenced profile record already carries the required facts.
      const singleOrderId = result.purchases.length === 1
        ? result.purchases[0]?.orderId ?? null
        : null;
      const balanceLimitation = projectPurchaseBalanceLimitation(
        selectPurchaseReplyOutcome({
          purchases: result.purchases.slice(0, 3),
          carts: result.carts ?? [],
          needsSelection: result.needsSelection,
          coverage: result.coverage ?? 'complete',
          referenceResolution: result.referenceResolution ?? 'not_requested',
          requestedAspects,
          referenceAuthorized: result.accessMethod === 'authenticated_account',
          userReported: {
            amount: reportedPurchase?.amount ?? null,
          },
        }),
        singleOrderId,
      );
      if (
        balanceLimitation !== null &&
        !purchaseProfileCarriesBalanceFacts(request.customerContext, [balanceLimitation.orderId])
      ) {
        return { ...reference, profile_ref: 'customer_context', purchase_balance: balanceLimitation };
      }
      return { ...reference, profile_ref: 'customer_context' };
    }
    if (result.status === 'completed' && result.kind === 'associated_event') {
      const stripped = this.stripRawFields(result) as Record<string, unknown>;
      const nested = (stripped.result ?? {}) as Record<string, unknown>;
      const events = Array.isArray(nested.events) ? nested.events : [];
      const eventIds = events.flatMap((event) => {
        const id = (event as Record<string, unknown>).eventId;
        return typeof id === 'number' || typeof id === 'string' ? [id] : [];
      });
      return {
        requestId: stripped.requestId,
        kind: stripped.kind,
        status: stripped.status,
        profile_ref: 'customer_context',
        event_count: events.length,
        event_ids: eventIds,
        ...('accessMethod' in stripped ? { access_method: stripped.accessMethod } : {}),
      };
    }
    return this.projectInformationResultForReply(result, request);
  }

  /**
   * P3 RSVP single-serialization projection without identity heuristics.
   * RSVP evidence carries no event/guest IDs — only names and dates — so a
   * name/date match cannot establish that an RSVP fact and a profile
   * invitation are the same record, and conflicting attendance would be left
   * unresolved. Until IDs exist, RSVP evidence and profile invitations stay
   * SEPARATE evidence: the full RSVP facts travel unchanged next to the
   * untouched profile, and the model answers from both. The only collapse is
   * the reason-only unavailable state (nothing hidden: it carries no
   * per-record facts, just coverage/resolution/reason plus the profile
   * pointer). An explicit verified same-record binding may collapse again
   * once IDs make it available; name matching never does.
   */
  private resolveRsvpProfileProjection(
    request: ComposeReplyRequest,
  ): {
    evidence: ReplyTurnEvidence['rsvp_phone_evidence'];
    profile: CustomerContextProjection | null;
  } {
    const evidence = request.rsvpPhoneEvidence ?? null;
    const profile = request.customerContext ?? null;
    if (evidence === null || profile == null) {
      return { evidence, profile };
    }
    if (evidence.state === 'unavailable') {
      return {
        evidence: {
          state: 'unavailable',
          profile_ref: 'customer_context',
          coverage: evidence.coverage,
          resolution: evidence.resolution,
          reason: evidence.reason,
        },
        profile,
      };
    }
    return { evidence, profile };
  }

  /**
   * FAQ evidence projection for the reply model. Retrieval can return
   * several relevant articles (gift terms, payment methods, card-rejection
   * guidance); projecting only the first let the model answer from an
   * unrelated article. Up to three deduplicated excerpts travel under a
   * fixed total text budget with their source filenames, through this
   * existing projection path. A single excerpt keeps its previous
   * truncation, so unaffected turns stay byte-identical. No new lookup,
   * no new state, no reply prose.
   */
  private projectFaqEvidenceForReply(
    evidence: KnowledgeEvidence[],
  ): Array<{ filename: string; text: string }> {
    const MAX_EXCERPTS = 3;
    const SINGLE_EXCERPT_CHARS = 1_200;
    const MAX_TOTAL_CHARS = 1_800;
    const seen = new Set<string>();
    const unique: KnowledgeEvidence[] = [];
    for (const entry of evidence) {
      if (entry.text.length === 0) continue;
      const key = `${entry.filename}::${entry.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(entry);
    }
    const selected = unique.slice(0, MAX_EXCERPTS);
    const perExcerptChars = selected.length <= 1
      ? SINGLE_EXCERPT_CHARS
      : Math.floor(MAX_TOTAL_CHARS / selected.length);
    return selected.map((entry) => ({
      filename: entry.filename,
      text: this.truncateText(entry.text, Math.min(SINGLE_EXCERPT_CHARS, perExcerptChars)),
    }));
  }

  private projectInformationResultForReply(
    result: InformationTaskResult,
    request: ComposeReplyRequest,
  ): unknown {
    if (result.status === 'failed' && result.failureKind === 'not_found') {
      // Scoped absence is evidence, not an escalation or a prewritten reply.
      const { message: _message, ...facts } = result; // eslint-disable-line @typescript-eslint/no-unused-vars
      return this.stripRawFields(facts);
    }
    if (result.status === 'completed' && result.kind === 'faq') {
      if (result.hostWithdrawalPolicy !== undefined) {
        return {
          requestId: result.requestId, kind: result.kind, status: result.status,
          subject: 'host_withdrawal',
          processingPolicy: result.hostWithdrawalPolicy,
          individualStatus: 'not_available',
        };
      }
      if (result.requestId === informationValidationPolicyRequestId) {
        return {
          requestId: result.requestId,
          kind: result.kind,
          status: result.status,
          policy: {
            maxBusinessHours: 72,
            source: 'indexed_knowledge_base',
          },
        };
      }
      if (result.requestId === informationPaymentOptionsPolicyRequestId) {
        return {
          requestId: result.requestId,
          kind: result.kind,
          status: result.status,
          policy: {
            bankTransferAvailable: true,
            scope: 'general_gift_checkout',
            source: 'indexed_knowledge_base',
          },
        };
      }
      return {
        requestId: result.requestId,
        kind: result.kind,
        status: result.status,
        evidence: this.projectFaqEvidenceForReply(result.evidence),
      };
    }
    if (result.status === 'completed' && result.kind === 'associated_event') {
      // Event-fact answers (date/place) never volunteer RSVP attendance:
      // the RSVP lane owns attendance evidence through its own lookup.
      // Names, dates and places ride the reply; guestStatus stays out so a
      // read-only question cannot manufacture an unrequested attendance
      // claim. Both event fact sets stay preserved; the reply answers from
      // the requested one.
      return this.stripRawFields({
        ...result,
        result: {
          ...result.result,
          events: result.result.events.map((event) => ({ ...event, guestStatus: null })),
        },
      });
    }
    if (result.status !== 'completed' || result.kind !== 'purchase') {
      return this.stripRawFields(result);
    }

    const purchaseRequests = request.extraction.informationRequests.filter(
      (informationRequest) => informationRequest.kind === 'purchase',
    );
    const requestedAspects: PurchaseAspect[] = purchaseRequests.flatMap(
      (informationRequest) => informationRequest.aspects,
    );
    const reportedPurchase = purchaseRequests.find(
      (informationRequest) => informationRequest.amount !== null &&
        informationRequest.amount !== undefined,
    );
    return this.stripRawFields(projectCompletedPurchaseForModel(result, {
      requestedAspects,
      referenceAuthorized: result.accessMethod === 'authenticated_account',
      userReported: {
        amount: reportedPurchase?.amount ?? null,
      },
      permittedNextAction: request.extraction.requestedOperation === 'purchase.modify'
        ? 'human_support'
        : null,
      missingInputs: result.needsSelection ? ['purchase_selection'] : [],
      ambiguousInputs: request.extraction.ambiguity?.status === 'ambiguous'
        ? ['purchase_interpretation']
        : [],
    }));
  }

  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }
}
