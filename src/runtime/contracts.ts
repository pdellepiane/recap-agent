import type { DecisionNode } from '../core/decision-nodes';
import type { EventType } from '../core/event-type';
import type { ActionIntent, PersistedPlan, PlanSnapshot } from '../core/plan';
import type { ProviderCategory } from '../core/provider-category';
import type { ProviderSummary } from '../core/provider';
import type { ToolOutputTrace } from '../core/trace';
import type { ToolInputTrace } from '../core/trace';
import type { TurnDecision } from '../core/turn-decision';
import type {
  ExtractedInformationRequest,
  HumanHelpIntent,
  InformationNormalizationIssue,
  InformationSupportAct,
  InformationTaskResult,
  PhoneConfirmation,
} from '../core/information';

import type { StructuredMessage } from './structured-message';
import type { ProviderFitCriteria } from './provider-fit';
import type { TurnMessageContext } from './turn-message-context';
import type {
  CloseAction,
} from './close-flow-schemas';
import type {
  ProviderDetailRequest,
  ProviderExplanationRequest,
  ProviderPlanOperation,
  ProviderQueryIntent,
  ProviderReference,
} from './extraction-schemas';
import type { RequestedOperation } from './extraction-schemas';
import type { RuntimeOperationId } from './capability-manifest';
import type { CapabilityDecision } from './capability-manifest';
import type { RsvpAction, RsvpDecisionSource, RsvpParty } from '../core/rsvp';
import type { InboundImage } from '../core/inbound-image';
import type { PlanOwner } from '../core/plan';
import type { CustomerContextProjection, CustomerEnrichmentSummary } from './customer-context';

/** S7 bounded-enrichment provenance re-export for typed reply evidence. */
export type { CustomerEnrichmentSummary };

export type OpenAiRequestMetrics = {
  instructionBytes: number;
  inputBytes: number;
  toolCount: number;
  schemaPropertyCount: number;
  /** Exact transport observations. Omitted means the transport was not observed. */
  transport?: OpenAiTransportMetrics;
};

export type OpenAiTransportRequest = {
  sequence: number;
  stage: 'classifier' | 'extraction' | 'reply' | 'image' | 'knowledge_retrieval' | 'provider_vector_search' | 'unknown';
  requestId: string | null;
  responseId: string | null;
  statusCode: number | null;
  succeeded: boolean | null;
  totalPayloadBytes: number | null;
  instructionBytes: number | null;
  inputBytes: number | null;
  toolBytes: number | null;
  outputSchemaBytes: number | null;
  requestBodySha256: string | null;
};

export type OpenAiTransportMetrics = {
  observedRequestCount: number;
  totalPayloadBytes: number | null;
  instructionBytes: number | null;
  inputBytes: number | null;
  toolBytes: number | null;
  outputSchemaBytes: number | null;
  requests: readonly OpenAiTransportRequest[];
};

export type OpenAiCallRef = {
  responseId: string | null;
  requestId: string | null;
  model: string;
  attemptCount: number;
  requestMetrics: OpenAiRequestMetrics;
};

export type ExtractionResult = {
  reportedEventRole?: 'host' | 'guest' | null;
  actionIntent: ActionIntent | null;
  /** Semantic capability/domain disposition emitted by the extractor. */
  requestedOperation?: RequestedOperation | null;
  informationRequests: ExtractedInformationRequest[];
  supportAct?: InformationSupportAct | null;
  humanHelpIntent?: HumanHelpIntent | null;
  normalizationIssues?: InformationNormalizationIssue[];
  phoneConfirmation?: PhoneConfirmation | null;
  rsvpAction?: RsvpAction | null;
  rsvpDecisionSource?: RsvpDecisionSource | null;
  rsvpCandidateGuestId?: number | null;
  rsvpEventReference?: string | null;
  rsvpParty?: RsvpParty | null;
  intentConfidence: number | null;
  ambiguity?: {
    status: 'clear' | 'ambiguous';
    clarificationQuestion: string | null;
    interpretations?: string[];
    candidateOperations?: RuntimeOperationId[];
    questionKey?: 'status_or_document' | 'status_or_proof_review' | 'type_missing' | null;
  };
  eventType: EventType | null;
  vendorCategory: ProviderCategory | null;
  vendorCategories: ProviderCategory[];
  activeNeedCategory: ProviderCategory | null;
  location: string | null;
  budgetSignal: string | null;
  guestRange: PersistedPlan['guest_range'];
  preferences: string[];
  hardConstraints: string[];
  assumptions: string[];
  conversationSummary: string;
  selectedProviderHints: string[];
  selectedProviderReferences?: ProviderReference[];
  closeAction?: CloseAction | null;
  pauseRequested: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  providerFitCriteria?: ProviderFitCriteria | null;
  providerQueryIntents?: ProviderQueryIntent[];
  providerPlanOperations?: ProviderPlanOperation[];
  providerExplanationRequest?: ProviderExplanationRequest | null;
  providerDetailRequest?: ProviderDetailRequest | null;
  /**
   * Structured image-reference evidence for follow-up turns. Decided by the
   * extractor from the full message meaning and conversation context, never
   * by keyword matching in code. `prior_single` names the referenced prior
   * image message(s); `prior_uncertain` exposes up to two plausible images;
   * `none` means the turn needs no pixels (unrelated FAQ/cart must not
   * receive recent receipts).
   */
  imageReference?: {
    status: 'none' | 'prior_single' | 'prior_uncertain';
    referencedMessageIds: string[];
  } | null;
};

export type ExtractRequest = {
  userMessage: string;
  plan: PersistedPlan;
  messageContext: TurnMessageContext;
  /**
   * Inbound linkage for the current-vs-prior image relation only. Lets the
   * extractor projection mark which stored attachment (if any) arrived with
   * this turn. Carries no batch, package, timer or ordering semantics.
   */
  currentMessageId?: string | null;
  /** Trusted channel metadata only; media bytes and provider URLs are excluded. */
  media?: readonly {
    kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    mimeType: string | null;
    fileName: string | null;
  }[];
};

export type RsvpPhoneReplyEvidence =  | {
      state: 'resolved_single';
      coverage: 'complete' | 'partial';
      resolution: 'authoritative_invitation' | 'event_association_only' | 'not_found';
      event: {
        event_name: string | null;
        event_date: string | null;
        invitation_record: 'available' | 'unavailable';
        rsvp_state: 'pending' | 'attending' | 'declining' | 'unavailable';
      };
    }
  | {
      state: 'needs_event_selection';
      coverage: 'complete' | 'partial';
      resolution: 'authoritative_invitation' | 'event_association_only' | 'not_found';
      candidates: Array<{
        event_name: string | null;
        event_date: string | null;
        invitation_record: 'available' | 'unavailable';
        rsvp_state: 'pending' | 'attending' | 'declining' | 'unavailable';
      }>;
    }
  | {
      state: 'unavailable';
      coverage: 'complete' | 'partial';
      resolution: 'authoritative_invitation' | 'event_association_only' | 'not_found';
      reason: 'no_invitations' | 'missing_event_identity' | 'lookup_failed';
    };

export type ImageUrlAttachment = {
  url: string;
  messageId: string;
};

/**
 * Persisted file-ID attachment projected as native image content. The file
 * ID travels only as SDK image content, never as model-visible text.
 */
export type ImageFileAttachment = {
  fileId: string;
  messageId: string;
};

/**
 * R8 same-day image observation summary. Same-day context enrichment for
 * matching against profile/DB: whether a usable image was seen today, how
 * legible it is to this reply (projected pixels, retained reference, or
 * unavailable), which message it links to, and whether typed evidence
 * mentions a deposit/voucher. Never carries structured amounts, dates,
 * phones or pixel-read values. Facts only, never reply prose.
 */
export type ImageObservation = {
  /** True when a usable image ref from today (or this turn) exists. */
  seenToday: boolean;
  /** Projected pixels ride this call; retained means stored, not projected. */
  legibility: 'projected' | 'retained' | 'unavailable';
  /** Current turn carries its own image; prior means an earlier same-day ref. */
  linkage: 'current' | 'prior' | 'none';
  /** Typed voucher/support evidence mentions a deposit, never pixel content. */
  depositMentioned: boolean;
};

/**
 * Minimum inbound-continuity reference for the model-owned send/suppress
 * decision. Derived from already-persisted typed state (owner pending refs,
 * open questions, information pending/completed, delivered history) plus the
 * current extraction; it introduces no new store and no fragment-state
 * machine. Absent (null/undefined) means the runtime derives the same
 * reference from plan plus message context, so image and normal paths share
 * one projection either way. Facts only, never reply prose.
 */
export type ContinuityProjection = {
  /** Unanswered user question carried by typed pending state, if any. */
  pendingQuestion: string | null;
  /** Unanswered owner task ref carried by typed pending state, if any. */
  pendingTask: string | null;
  /** True when a typed information request is still pending. */
  hasPendingInformation: boolean;
  /** True when a typed information request already completed. */
  hasCompletedInformation: boolean;
  /** True when real delivered history shows a prior outbound answer. */
  hasPriorOutbound: boolean;
};

export type ComposeReplyRequest = {
  currentNode: DecisionNode;
  previousNode: DecisionNode;
  userMessage: string;
  messageContext: TurnMessageContext;
  plan: PersistedPlan;
  extraction: ExtractionResult;
  missingFields: string[];
  searchReady: boolean;
  providerResults: ProviderSummary[];
  turnDecision?: TurnDecision;
  errorMessage: string | null;
  /**
   * G1/G3: reply instructions are owned by the model-request compiler
   * (model-request-projector.ts) loading tracked files via PromptLoader.
   * promptBundleId/promptFilePaths below stay a pending-identity marker;
   * they never select instructions. Telemetry names the compiler-reported
   * identity from ComposeReplyResult.compilerPrompt / origin.bundleId.
   */
  promptBundleId: string;
  promptFilePaths: string[];
  toolUsage: ToolUsage;
  informationResults?: InformationTaskResult[];
  /** Typed outcome facts for clarification, media, and access branches. */
  capabilityDecision?: CapabilityDecision | null;
  handoffOutcome?: 'handoff_requested' | 'handoff_failed' | 'handoff_unknown' | 'handoff_duplicate' | 'handoff_skipped_missing_phone' | 'handoff_skipped_unavailable' | null;
  imageEvidence?: {
    status: 'available' | 'unavailable';
    reason: string | null;
    captionPresent: boolean;
    inspectionOutcome?: 'readable' | 'unreadable' | 'human_help';
    /** Which inbound image source this evidence describes. */
    source?: 'base64' | 'url' | 'file' | null;
    /** True when a URL attachment ref was persisted for later projection. */
    refStored?: boolean;
    /** True when a persisted file ref was projected into this model call. */
    fileRefProjected?: boolean;
    /**
     * R8 same-day image observation summary (deposit seen, legibility,
     * message linkage; never structured amounts). Absent on unrelated turns
     * so their requests stay byte-identical. Facts only, never reply prose.
     */
    observation?: ImageObservation | null;
  } | null;
  authenticationOutcome?: {
    status: 'declined' | 'terminal';
    reason: string;
    protectedRequestsClosed: boolean;
    publicInformationRequestsRemaining: number;
    handoffOutcome: 'handoff_requested' | 'handoff_failed' | 'handoff_unknown' | 'handoff_duplicate' | 'handoff_skipped_missing_phone' | 'handoff_skipped_unavailable' | null;
    noFurtherCredentialRequests?: boolean;
    /**
     * C1 scoped-search framing. True when the terminal outcome follows a
     * phone-scoped lookup miss (no match in scope), not an account or
     * credential verdict. The reply must describe the scoped limitation,
     * never an account absence or a global non-existence claim.
     */
    scopedPhoneSearchMiss?: boolean;
  } | null;
  rsvpPhoneEvidence?: RsvpPhoneReplyEvidence | null;
  /**
   * Typed marker that this reply carries completed RSVP work whose outcome
   * details travel in errorMessage alongside the typed rsvpPhoneEvidence
   * (or a typed handoffOutcome when no invitation was resolved). Present
   * only on turns where the RSVP lane completed work, so unrelated turns
   * stay byte-identical. Facts only, never reply prose.
   */
  rsvpWorkCompleted?: boolean;
  /**
   * L4 Customer operations projection: common references plus the
   * question-relevant snapshot detail. Absent (null/undefined) means the
   * turn is not a Customer operations turn and nothing is projected, so
   * unrelated turns stay byte-identical.
   */
  customerContext?: CustomerContextProjection | null;
  /** L4 persisted owner serving this turn. Absent means transient selection. */
  owner?: PlanOwner | null;
  /**
   * Minimum inbound-continuity reference for this owner call. The caller
   * resolves it from persisted pending/answered state; when absent the
   * runtime derives the same reference from plan plus message context.
   * Present on image and normal turns alike. Facts only, never prose.
   */
  continuity?: ContinuityProjection | null;
  /**
   * Active owner pending-question reference for this turn, when the turn
   * carries owner_pending_question. The runtime validates the model-reported
   * pending_task_outcome against this same task. Absent on unrelated turns
   * so their requests stay byte-identical. Facts only, never prose.
   */
  pendingQuestionRef?: string | null;
  /**
   * Native image URLs for this owner model call. The caller always resolves
   * projection explicitly (even empty, meaning no image travels); undefined
   * projects nothing. Stored references are never resent on recency alone.
   * Raw URLs travel only as native image content, never as prompt text.
   */
  imageUrlAttachments?: readonly ImageUrlAttachment[];
  /**
   * Persisted file-ID attachments for this owner model call. Same
   * explicit-projection rule as URLs: the caller resolves relevance (even
   * empty); undefined projects nothing. File IDs travel only as native SDK
   * image content, never as model-visible text.
   */
  imageFileAttachments?: readonly ImageFileAttachment[];
  /** Persist a confirmed completion before subsequent model generation can fail. */
  onPlanCompleted?: (plan: PlanSnapshot) => Promise<void>;
};

/**
 * Authorized mechanical provider fields captured for origin verification.
 * These are evidence values the channel renderer projects into provider
 * cards (identity, link and data slots). They carry no conversational prose;
 * every prose-carrying model field (including match labels) lives in
 * `modelMessage` and is verified as model content. The freeform provider
 * promo summary is model evidence only (it travels to the model as context
 * and surfaces in model-written prose): it is never an authorized
 * mechanical field, so only the short promo badge renders mechanically.
 */
export type AuthorizedProviderRenderField = {
  readonly id: number;
  readonly title: string;
  readonly category: string | null;
  readonly location: string | null;
  readonly priceLevel: string | null;
  readonly promoBadge: string | null;
  readonly detailUrl: string | null;
};

/**
 * L1 output-origin receipt. Carries this turn's actual model paragraphs (kept
 * for hash-only wire evidence readers) plus an immutable snapshot of the raw
 * structured model output and the authorized mechanical provider fields used
 * for rendering. Delivery rebuilds the expected channel render from that
 * snapshot and validated provider IDs BEFORE comparing it with the delivered
 * text, and separately verifies current structured prose fields against the
 * snapshot. `modelContentSha256` is the hash over canonical model content
 * (prose plus provider ids in render order); the expected-render hash travels
 * as `candidateSha256` in output-origin evidence, never copied from delivery.
 * Unknown transformation versions fail closed.
 */
export type ModelOriginReceipt = {
  readonly modelParagraphs: readonly string[];
  readonly modelMessage: StructuredMessage;
  readonly providerFields: readonly AuthorizedProviderRenderField[];
  readonly modelContentSha256: string;
  readonly bundleId: string;
  readonly transformationVersion: 'transport-v2';
};

export type ComposeReplyResult = {
  text: string;
  structuredMessage?: StructuredMessage;
  tokenUsage?: TokenUsage | null;
  recommendationFunnel?: {
    available_candidates: number;
    context_candidates: number;
    context_candidate_ids: number[];
    presentation_limit: number;
  };
  openAiCall?: OpenAiCallRef | null;
  origin?: ModelOriginReceipt | null;
  /**
   * G1/G3 runtime-reported compiler identity for the request actually
   * sent: compiler bundle id plus the tracked module files loaded.
   * Telemetry names this identity; stub runtimes omit it and callers fall
   * back to the origin bundle id. Exactly one prompt identity per request.
   */
  compilerPrompt?: {
    readonly bundleId: string;
    readonly filePaths: readonly string[];
  };
};

export type ToolUsage = {
  considered: string[];
  called: string[];
  inputs: ToolInputTrace[];
  outputs: ToolOutputTrace[];
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
};

export type ExtractResult = {
  extraction: ExtractionResult;
  tokenUsage: TokenUsage | null;
  openAiCall?: OpenAiCallRef | null;
};

export interface AgentRuntime {
  inspectImage?(request: {
    image: Extract<InboundImage, { status: 'available'; source: 'base64' }>;
    caption: string;
  }): Promise<{
    outcome: 'readable' | 'unreadable' | 'human_help';
    answer: string;
    tokenUsage: TokenUsage | null;
    openAiCall: OpenAiCallRef | null;
    promptBundleId: string;
  }>;
  extract(request: ExtractRequest): Promise<ExtractResult | ExtractionResult>;
  composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult>;
}
