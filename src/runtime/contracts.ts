import type { DecisionNode } from '../core/decision-nodes';
import type { PersistedPlan, PlanIntent } from '../core/plan';
import type { ProviderCategory } from '../core/provider-category';
import type { ProviderSummary } from '../core/provider';
import type { ToolOutputTrace } from '../core/trace';
import type { ToolInputTrace } from '../core/trace';

import type { StructuredMessage } from './structured-message';
import type { ProviderFitCriteria } from './provider-fit';

export type ExtractionResult = {
  intent: PlanIntent | null;
  intentConfidence: number | null;
  eventType: string | null;
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
  selectedProviderHint: string | null;
  pauseRequested: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  providerFitCriteria?: ProviderFitCriteria | null;
  kbQuery?: string | null;
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
  missingFields: string[];
  searchReady: boolean;
  providerResults: ProviderSummary[];
  errorMessage: string | null;
  promptBundleId: string;
  promptFilePaths: string[];
  toolUsage: ToolUsage;
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
