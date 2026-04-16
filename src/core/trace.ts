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
