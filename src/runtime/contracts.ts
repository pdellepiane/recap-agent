import type { DecisionNode } from '../core/decision-nodes';
import type { EventType } from '../core/event-type';
import type { PersistedPlan, PlanIntent } from '../core/plan';
import type { ProviderCategory } from '../core/provider-category';
import type { ProviderSummary } from '../core/provider';
import type { ToolOutputTrace } from '../core/trace';
import type { ToolInputTrace } from '../core/trace';
import type { TurnDecision } from '../core/turn-decision';

import type { StructuredMessage } from './structured-message';
import type { UserEventLookupResult } from './provider-gateway';
import type { ProviderFitCriteria } from './provider-fit';
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

export type ExtractionResult = {
  intent: PlanIntent | null;
  secondaryIntents?: PlanIntent[];
  intentConfidence: number | null;
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
  kbQuery?: string | null;
  providerQueryIntents?: ProviderQueryIntent[];
  providerPlanOperations?: ProviderPlanOperation[];
  providerExplanationRequest?: ProviderExplanationRequest | null;
  providerDetailRequest?: ProviderDetailRequest | null;
};

export type ExtractRequest = {
  userMessage: string;
  plan: PersistedPlan;
};

export type ComposeReplyRequest = {
  currentNode: DecisionNode;
  previousNode: DecisionNode;
  userMessage: string;
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
  invitedEventLookupResult?: UserEventLookupResult | null;
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
};

export type ExtractResult = {
  extraction: ExtractionResult;
  tokenUsage: TokenUsage | null;
};

export interface AgentRuntime {
  extract(request: ExtractRequest): Promise<ExtractResult | ExtractionResult>;
  composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult>;
}
