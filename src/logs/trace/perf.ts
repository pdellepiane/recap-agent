import crypto from 'node:crypto';

import type { TurnTrace } from '../../core/trace';

export type AssistantMessageQualityFlag =
  | 'empty_message'
  | 'near_empty_message'
  | 'file_citation_artifact'
  | 'command_like_contact_prompt'
  | 'welcome_menu_template'
  | 'repeated_line';

export type RedactedTracePreview = {
  tool: string;
  length: number;
  hash: string;
  preview_redacted: string;
};

export type ProviderResultPerfSummary = {
  id: number;
  title: string;
  category: string | null;
  location: string | null;
};

export type TurnPerfRecord = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  record_type: 'turn_perf_v1';
  captured_at: string;
  ttl_epoch_seconds: number;
  trace_id: string;
  conversation_id: string | null;
  plan_id: string;
  channel: string;
  external_user_hash: string;
  message_id: string;
  user_message_length: number;
  user_message_hash: string;
  user_message_preview: string;
  assistant_message_length: number | null;
  assistant_message_hash: string | null;
  assistant_message_preview_redacted: string | null;
  assistant_message_quality_flags: AssistantMessageQualityFlag[];
  structured_message_kind: string | null;
  runtime_latency_ms: number;
  timing_ms: TurnTrace['timing_ms'];
  token_usage: TurnTrace['token_usage'];
  response_classifier?: TurnTrace['response_classifier'];
  previous_node: string;
  node_path: string[];
  intent: string | null;
  prompt_bundle_id: string;
  prompt_file_paths: string[];
  tools_considered: string[];
  tools_called_count: number;
  tools_called: string[];
  tool_input_previews_redacted: RedactedTracePreview[];
  tool_output_previews_redacted: RedactedTracePreview[];
  search_strategy: TurnTrace['search_strategy'];
  turn_decision: TurnTrace['turn_decision'];
  route_kind: TurnTrace['route_kind'];
  presentation_scope: TurnTrace['presentation_scope'];
  session_focus_used: boolean;
  session_focus_key_present: boolean;
  state_machine_invariant_status: TurnTrace['state_machine_invariant_status'];
  state_machine_invariant_violations: string[];
  operational_note: string | null;
  extraction_summary: TurnTrace['extraction_summary'];
  plan_summary: TurnTrace['plan_summary'];
  close_action_summary: TurnTrace['close_action_summary'];
  selection_resolution_summary: TurnTrace['selection_resolution_summary'];
  contact_validation_summary: TurnTrace['contact_validation_summary'];
  provider_candidate_audit: TurnTrace['provider_candidate_audit'];
  faq_resolution_summary: TurnTrace['faq_resolution_summary'];
  provider_results_count: number;
  provider_result_ids: number[];
  provider_result_summaries: ProviderResultPerfSummary[];
  missing_fields_count: number;
  missing_fields: string[];
  search_ready: boolean;
  next_node: string;
  plan_persisted: boolean;
  plan_persist_reason: string | null;
  cache_hit_rate: number | null;
  extraction_to_compose_ratio: number | null;
  recommendation_funnel_available_candidates: number | null;
  recommendation_funnel_context_candidates: number | null;
  recommendation_funnel_presentation_limit: number | null;
};

export type CliPerfSummary = {
  trace_id: string;
  conversation_id: string | null;
  runtime_latency_ms: number;
  extraction_latency_ms: number;
  compose_latency_ms: number;
  tools_called_count: number;
  provider_results_count: number;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  cache_hit_rate: number | null;
  extraction_to_compose_ratio: number | null;
  captured_at: string;
  persisted: boolean;
  storage_target: string | null;
  recommendation_context_candidates: number | null;
  recommendation_presentation_limit: number | null;
  response_classifier_action: string | null;
  response_classifier_would_suppress: boolean | null;
  conversation_health_status: string | null;
  conversation_health_reason: string | null;
  human_help_response: string | null;
};

export function buildTurnPerfRecord(args: {
  trace: TurnTrace;
  channel: string;
  externalUserId: string;
  messageId: string;
  userMessage: string;
  assistantMessage?: string | null;
  includeAssistantMessagePreview?: boolean;
  structuredMessageKind?: string | null;
  capturedAt?: Date;
  retentionDays: number;
}): TurnPerfRecord {
  const capturedAt = args.capturedAt ?? new Date();
  const capturedAtIso = capturedAt.toISOString();
  const ttlEpochSeconds = Math.floor(capturedAt.getTime() / 1000) + (args.retentionDays * 24 * 60 * 60);
  const conversationKey = args.trace.conversation_id ?? args.trace.plan_id;
  const totalTokenUsage = args.trace.token_usage.total;
  const cachedInputTokens = totalTokenUsage?.cached_input_tokens ?? null;
  const cacheHitRate = totalTokenUsage && cachedInputTokens !== null && totalTokenUsage.input_tokens > 0
    ? clamp01(cachedInputTokens / totalTokenUsage.input_tokens)
    : null;
  const extractionToComposeRatio =
    args.trace.timing_ms.compose_reply > 0
      ? args.trace.timing_ms.extraction / args.trace.timing_ms.compose_reply
      : null;

  const funnel = args.trace.recommendation_funnel;
  const assistantMessage = args.assistantMessage ?? null;

  return {
    pk: `CONVERSATION#${conversationKey}`,
    sk: `TURN#${capturedAtIso}#${args.trace.trace_id}`,
    gsi1pk: `CHANNEL_USER#${args.channel}#${sha256(args.externalUserId)}`,
    gsi1sk: `TURN#${capturedAtIso}#${args.trace.trace_id}`,
    record_type: 'turn_perf_v1',
    captured_at: capturedAtIso,
    ttl_epoch_seconds: ttlEpochSeconds,
    trace_id: args.trace.trace_id,
    conversation_id: args.trace.conversation_id,
    plan_id: args.trace.plan_id,
    channel: args.channel,
    external_user_hash: sha256(args.externalUserId),
    message_id: args.messageId,
    user_message_length: args.userMessage.length,
    user_message_hash: sha256(args.userMessage),
    user_message_preview: truncateText(args.userMessage, 160),
    assistant_message_length: assistantMessage?.length ?? null,
    assistant_message_hash: assistantMessage ? sha256(assistantMessage) : null,
    assistant_message_preview_redacted: assistantMessage && args.includeAssistantMessagePreview
      ? truncateText(redactSensitiveText(assistantMessage), 240)
      : null,
    assistant_message_quality_flags: assistantMessage
      ? detectAssistantMessageQualityFlags(assistantMessage)
      : [],
    structured_message_kind: args.structuredMessageKind ?? null,
    runtime_latency_ms: args.trace.timing_ms.total,
    timing_ms: args.trace.timing_ms,
    token_usage: args.trace.token_usage,
    response_classifier: args.trace.response_classifier,
    previous_node: args.trace.previous_node,
    node_path: args.trace.node_path,
    intent: args.trace.intent,
    prompt_bundle_id: args.trace.prompt_bundle_id,
    prompt_file_paths: args.trace.prompt_file_paths,
    tools_considered: args.trace.tools_considered,
    tools_called_count: args.trace.tools_called.length,
    tools_called: args.trace.tools_called,
    tool_input_previews_redacted: args.trace.tool_inputs.map((entry) =>
      toRedactedTracePreview(entry.tool, entry.input),
    ),
    tool_output_previews_redacted: args.trace.tool_outputs.map((entry) =>
      toRedactedTracePreview(entry.tool, entry.output),
    ),
    search_strategy: args.trace.search_strategy,
    turn_decision: args.trace.turn_decision,
    route_kind: args.trace.route_kind,
    presentation_scope: args.trace.presentation_scope,
    session_focus_used: args.trace.session_focus_used,
    session_focus_key_present: args.trace.session_focus_key_present,
    state_machine_invariant_status: args.trace.state_machine_invariant_status,
    state_machine_invariant_violations: args.trace.state_machine_invariant_violations,
    operational_note: args.trace.operational_note,
    extraction_summary: args.trace.extraction_summary,
    plan_summary: args.trace.plan_summary,
    close_action_summary: args.trace.close_action_summary,
    selection_resolution_summary: args.trace.selection_resolution_summary,
    contact_validation_summary: args.trace.contact_validation_summary,
    provider_candidate_audit: args.trace.provider_candidate_audit,
    faq_resolution_summary: args.trace.faq_resolution_summary,
    provider_results_count: args.trace.provider_results.length,
    provider_result_ids: args.trace.provider_results.map((provider) => provider.id),
    provider_result_summaries: args.trace.provider_results.map((provider) => ({
      id: provider.id,
      title: provider.title,
      category: provider.category ?? null,
      location: provider.location ?? null,
    })),
    missing_fields_count: args.trace.missing_fields.length,
    missing_fields: args.trace.missing_fields,
    search_ready: args.trace.search_ready,
    next_node: args.trace.next_node,
    plan_persisted: args.trace.plan_persisted,
    plan_persist_reason: args.trace.plan_persist_reason,
    cache_hit_rate: cacheHitRate,
    extraction_to_compose_ratio: extractionToComposeRatio,
    recommendation_funnel_available_candidates: funnel?.available_candidates ?? null,
    recommendation_funnel_context_candidates: funnel?.context_candidates ?? null,
    recommendation_funnel_presentation_limit: funnel?.presentation_limit ?? null,
  };
}

function toRedactedTracePreview(tool: string, value: string): RedactedTracePreview {
  return {
    tool,
    length: value.length,
    hash: sha256(value),
    preview_redacted: truncateText(redactSensitiveText(value), 360),
  };
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replace(/\bhttps?:\/\/\S+/giu, '[url]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/gu, '[phone]')
    .replace(/\b\d{4,8}\b/gu, '[code]');
}

export function detectAssistantMessageQualityFlags(value: string): AssistantMessageQualityFlag[] {
  const flags: AssistantMessageQualityFlag[] = [];
  const normalized = value.trim();
  const lower = normalized.toLowerCase();

  if (normalized.length === 0) {
    flags.push('empty_message');
  } else if (normalized.length < 12) {
    flags.push('near_empty_message');
  }

  if (/\bfilecite\s+turn\d+\s+file\s+\d+\b/iu.test(value)) {
    flags.push('file_citation_artifact');
  }

  if (/\b(?:comp[aá]rteme|env[ií]ame)\b/iu.test(value)) {
    flags.push('command_like_contact_prompt');
  }

  const welcomeSignals = [
    'puedo ayudarte a',
    'armar un plan',
    'buscar proveedores',
    'consultar datos de tu evento',
  ].filter((signal) => lower.includes(signal)).length;
  if (welcomeSignals >= 2) {
    flags.push('welcome_menu_template');
  }

  const repeatedLineCount = countRepeatedMeaningfulLines(normalized);
  if (repeatedLineCount > 0) {
    flags.push('repeated_line');
  }

  return flags;
}

export function toCliPerfSummary(
  record: TurnPerfRecord,
  meta?: { persisted?: boolean; storageTarget?: string | null },
): CliPerfSummary {
  return {
    trace_id: record.trace_id,
    conversation_id: record.conversation_id,
    runtime_latency_ms: record.runtime_latency_ms,
    extraction_latency_ms: record.timing_ms.extraction,
    compose_latency_ms: record.timing_ms.compose_reply,
    tools_called_count: record.tools_called_count,
    provider_results_count: record.provider_results_count,
    total_tokens: record.token_usage.total?.total_tokens ?? null,
    cached_input_tokens: record.token_usage.total?.cached_input_tokens ?? null,
    cache_hit_rate: record.cache_hit_rate,
    extraction_to_compose_ratio: record.extraction_to_compose_ratio,
    captured_at: record.captured_at,
    persisted: meta?.persisted ?? false,
    storage_target: meta?.storageTarget ?? null,
    recommendation_context_candidates: record.recommendation_funnel_context_candidates,
    recommendation_presentation_limit: record.recommendation_funnel_presentation_limit,
    response_classifier_action: record.response_classifier?.action ?? null,
    response_classifier_would_suppress: record.response_classifier?.would_suppress ?? null,
    conversation_health_status: record.response_classifier?.conversation_health ?? null,
    conversation_health_reason: record.response_classifier?.health_reason ?? null,
    human_help_response: record.response_classifier?.human_help_response ?? null,
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function countRepeatedMeaningfulLines(value: string): number {
  const seen = new Set<string>();
  let repeated = 0;
  for (const line of value.split(/\r?\n/u)) {
    const normalized = line.trim().toLowerCase();
    if (normalized.length < 16) {
      continue;
    }
    if (seen.has(normalized)) {
      repeated += 1;
      continue;
    }
    seen.add(normalized);
  }
  return repeated;
}
