import type { DecisionNode } from './decision-nodes';

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
  plan_persisted: boolean;
  plan_persist_reason: string | null;
};

