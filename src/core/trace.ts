import type { DecisionNode } from './decision-nodes';
import type { ProviderSummary } from './provider';

export type ToolOutputTrace = {
  tool: string;
  output: string;
};

export type ToolInputTrace = {
  tool: string;
  input: string;
};

export type RecommendationFunnelTrace = {
  available_candidates: number;
  context_candidates: number;
  context_candidate_ids: number[];
  presentation_limit: number;
};

export type ExtractionDebugSummary = {
  intent_confidence: number | null;
  event_type: string | null;
  vendor_category: string | null;
  vendor_categories: string[];
  active_need_category: string | null;
  location: string | null;
  budget_signal: string | null;
  guest_range: string | null;
  selected_provider_hint: string | null;
  preferences: string[];
  hard_constraints: string[];
  assumptions: string[];
  conversation_summary_preview: string;
  pause_requested: boolean;
  contact_fields_present: {
    name: boolean;
    email: boolean;
    phone: boolean;
  };
};

export type PlanDebugSummary = {
  current_node: DecisionNode;
  lifecycle_state: string;
  event_type: string | null;
  vendor_category: string | null;
  active_need_category: string | null;
  location: string | null;
  budget_signal: string | null;
  guest_range: string | null;
  provider_need_categories: string[];
  provider_need_count: number;
  provider_need_statuses: Array<{
    category: string;
    status: string;
    has_recommendations: boolean;
    selected_provider_id: number | null;
  }>;
  selected_provider_id: number | null;
  missing_fields: string[];
  conversation_summary_preview: string;
  open_question_count: number;
  contact_fields_present: {
    name: boolean;
    email: boolean;
    phone: boolean;
  };
};

export type SearchStrategyTrace = 'none' | 'search_from_plan' | 'broaden_existing_shortlist';

export type TurnTrace = {
  trace_id: string;
  conversation_id: string | null;
  plan_id: string;
  previous_node: DecisionNode;
  next_node: DecisionNode;
  node_path: DecisionNode[];
  intent: string | null;
  missing_fields: string[];
  search_ready: boolean;
  prompt_bundle_id: string;
  prompt_file_paths: string[];
  tools_considered: string[];
  tools_called: string[];
  tool_inputs: ToolInputTrace[];
  tool_outputs: ToolOutputTrace[];
  provider_results: ProviderSummary[];
  recommendation_funnel: RecommendationFunnelTrace;
  search_strategy: SearchStrategyTrace;
  operational_note: string | null;
  extraction_summary: ExtractionDebugSummary;
  plan_summary: PlanDebugSummary;
  plan_persisted: boolean;
  plan_persist_reason: string | null;
  timing_ms: {
    total: number;
    load_plan: number;
    prepare_working_plan: number;
    extraction: number;
    apply_extraction: number;
    compute_sufficiency: number;
    provider_search: number;
    provider_enrichment: number;
    prompt_bundle_load: number;
    compose_reply: number;
    save_plan: number;
  };
  token_usage: {
    extraction: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cached_input_tokens?: number;
    } | null;
    reply: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cached_input_tokens?: number;
    } | null;
    total: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cached_input_tokens?: number;
    } | null;
  };
};
