import type { DecisionNode } from '../core/decision-nodes';
import type { EventType } from '../core/event-type';
import type { ActionIntent, PersistedPlan } from '../core/plan';
import type { ProviderCategory } from '../core/provider-category';
import type { ProviderSummary } from '../core/provider';
import type { ToolOutputTrace } from '../core/trace';
import type { ToolInputTrace } from '../core/trace';
import type { TurnDecision } from '../core/turn-decision';
import type {
  ExtractedInformationRequest,
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
import type { RsvpAction, RsvpDecisionSource, RsvpParty } from '../core/rsvp';
import type { InboundImage } from '../core/inbound-image';

export type OpenAiRequestMetrics = {
  instructionBytes: number;
  inputBytes: number;
  toolCount: number;
  schemaPropertyCount: number;
};

export type OpenAiCallRef = {
  responseId: string;
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
};

export type ExtractRequest = {
  userMessage: string;
  plan: PersistedPlan;
  messageContext: TurnMessageContext;
  /** Trusted channel metadata only; media bytes and provider URLs are excluded. */
  media?: readonly {
    kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    mimeType: string | null;
    fileName: string | null;
  }[];
};

export type RsvpPhoneReplyEvidence =
  | {
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
  promptBundleId: string;
  promptFilePaths: string[];
  toolUsage: ToolUsage;
  informationResults?: InformationTaskResult[];
  rsvpPhoneEvidence?: RsvpPhoneReplyEvidence | null;
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
    image: Extract<InboundImage, { status: 'available' }>;
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
