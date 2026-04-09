import type { DecisionNode } from '../core/decision-nodes';
import type { PersistedPlan, PlanIntent } from '../core/plan';
import type { ProviderSummary } from '../core/provider';

export type ExtractionResult = {
  intent: PlanIntent | null;
  intentConfidence: number | null;
  eventType: string | null;
  vendorCategory: string | null;
  vendorCategories: string[];
  activeNeedCategory: string | null;
  location: string | null;
  budgetSignal: string | null;
  guestRange: PersistedPlan['guest_range'];
  preferences: string[];
  hardConstraints: string[];
  assumptions: string[];
  conversationSummary: string;
  selectedProviderHint: string | null;
  pauseRequested: boolean;
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
};

export type ToolUsage = {
  considered: string[];
  called: string[];
};

export interface AgentRuntime {
  extract(request: ExtractRequest): Promise<ExtractionResult>;
  composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult>;
}
