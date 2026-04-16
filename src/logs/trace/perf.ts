import crypto from 'node:crypto';

import type { TurnTrace } from '../../core/trace';

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
  runtime_latency_ms: number;
  timing_ms: TurnTrace['timing_ms'];
  token_usage: TurnTrace['token_usage'];
  tools_called_count: number;
  tools_called: string[];
  provider_results_count: number;
  missing_fields_count: number;
  search_ready: boolean;
  next_node: string;
  plan_persisted: boolean;
  plan_persist_reason: string | null;
  cache_hit_rate: number | null;
  extraction_to_compose_ratio: number | null;
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
};

export function buildTurnPerfRecord(args: {
  trace: TurnTrace;
  channel: string;
  externalUserId: string;
  messageId: string;
  userMessage: string;
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
    runtime_latency_ms: args.trace.timing_ms.total,
    timing_ms: args.trace.timing_ms,
    token_usage: args.trace.token_usage,
    tools_called_count: args.trace.tools_called.length,
    tools_called: args.trace.tools_called,
    provider_results_count: args.trace.provider_results.length,
    missing_fields_count: args.trace.missing_fields.length,
    search_ready: args.trace.search_ready,
    next_node: args.trace.next_node,
    plan_persisted: args.trace.plan_persisted,
    plan_persist_reason: args.trace.plan_persist_reason,
    cache_hit_rate: cacheHitRate,
    extraction_to_compose_ratio: extractionToComposeRatio,
  };
}

export function toCliPerfSummary(record: TurnPerfRecord): CliPerfSummary {
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
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
