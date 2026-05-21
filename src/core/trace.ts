import type { DecisionNode } from './decision-nodes';
import type { ProviderSummary } from './provider';
import type { TurnDecision } from './turn-decision';

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
  selected_provider_hints: string[];
  preferences: string[];
  hard_constraints: string[];
  assumptions: string[];
  provider_query_intents_count: number;
  provider_plan_operations_count: number;
  provider_explanation_requested: boolean;
  provider_detail_requested: boolean;
  conversation_summary_preview: string;
  pause_requested: boolean;
  contact_fields_present: {
    name: boolean;
    email: boolean;
    phone: boolean;
  };
  contact_validation_error: string | null;
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
    selected_provider_ids: number[];
  }>;
  selected_provider_ids: number[];
  missing_fields: string[];
  conversation_summary_preview: string;
  open_question_count: number;
  contact_fields_present: {
    name: boolean;
    email: boolean;
    phone: boolean;
  };
  contact_validation_error: string | null;
};

export type CloseActionDebugSummary = {
  type: 'confirm_close' | 'defer_need' | 'request_contact' | 'abandon_plan' | 'clarify' | null;
  category: string | null;
  reason_preview: string | null;
};

export type SelectionResolutionDebugSummary = {
  selected_provider_references: Array<{
    provider_id: number | null;
    category: string | null;
    has_title: boolean;
    has_hint: boolean;
  }>;
  selected_provider_hints_count: number;
  provider_plan_operation_types: string[];
  provider_plan_operation_categories: string[];
};

export type ContactValidationDebugSummary = {
  status: 'not_provided' | 'valid' | 'invalid';
  field: 'phone' | 'email' | null;
  reason_preview: string | null;
  extraction_contact_fields_present: {
    name: boolean;
    email: boolean;
    phone: boolean;
  };
  plan_contact_fields_present: {
    name: boolean;
    email: boolean;
    phone: boolean;
  };
};

export type ProviderCandidateAuditEntry = {
  provider_id: number;
  category: string | null;
  location: string | null;
  retrieval_source: string | null;
  retrieval_score: number | null;
  fit_score: number | null;
};

export type FaqResolutionDebugSummary = {
  is_faq_turn: boolean;
  kb_query_present: boolean;
  file_search_called: boolean;
  file_search_output_count: number;
};

export type SearchStrategyTrace =
  | 'none'
  | 'search_from_plan'
  | 'broaden_existing_shortlist'
  | 'existing_plan_shortlist'
  | 'multi_need_query_intents';

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
  turn_decision: TurnDecision;
  route_kind: TurnDecision['routeKind'];
  presentation_scope: TurnDecision['presentationScope'];
  session_focus_used: boolean;
  session_focus_key_present: boolean;
  state_machine_invariant_status: TurnDecision['invariantStatus'];
  state_machine_invariant_violations: string[];
  operational_note: string | null;
  extraction_summary: ExtractionDebugSummary;
  plan_summary: PlanDebugSummary;
  close_action_summary: CloseActionDebugSummary;
  selection_resolution_summary: SelectionResolutionDebugSummary;
  contact_validation_summary: ContactValidationDebugSummary;
  provider_candidate_audit: ProviderCandidateAuditEntry[];
  faq_resolution_summary: FaqResolutionDebugSummary;
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
