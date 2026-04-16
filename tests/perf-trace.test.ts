import { describe, expect, it } from 'vitest';

import { buildTurnPerfRecord, toCliPerfSummary } from '../src/logs/trace/perf';

describe('perf trace module', () => {
  it('builds a stable turn perf record with derived ratios', () => {
    const capturedAt = new Date('2026-04-16T00:00:00.000Z');
    const record = buildTurnPerfRecord({
      trace: {
        trace_id: 'trace-1',
        conversation_id: 'conv-1',
        plan_id: 'plan-1',
        previous_node: 'entrevista',
        next_node: 'recomendar',
        node_path: ['entrevista', 'buscar_proveedores', 'recomendar'],
        intent: 'buscar_proveedores',
        missing_fields: [],
        search_ready: true,
        prompt_bundle_id: 'bundle-1',
        prompt_file_paths: ['prompts/nodes/recomendar/system.txt'],
        tools_considered: ['search_providers_from_plan'],
        tools_called: ['search_providers_from_plan'],
        tool_inputs: [],
        tool_outputs: [],
        provider_results: [],
        plan_persisted: true,
        plan_persist_reason: 'recomendar',
        timing_ms: {
          total: 1200,
          load_plan: 10,
          prepare_working_plan: 5,
          extraction: 300,
          apply_extraction: 10,
          compute_sufficiency: 5,
          provider_search: 200,
          provider_enrichment: 120,
          prompt_bundle_load: 20,
          compose_reply: 500,
          save_plan: 30,
        },
        token_usage: {
          extraction: null,
          reply: null,
          total: {
            input_tokens: 2000,
            output_tokens: 300,
            total_tokens: 2300,
            cached_input_tokens: 600,
          },
        },
      },
      channel: 'terminal_whatsapp',
      externalUserId: 'user-1',
      messageId: 'msg-1',
      userMessage: 'hola',
      capturedAt,
      retentionDays: 30,
    });

    expect(record.pk).toBe('CONVERSATION#conv-1');
    expect(record.record_type).toBe('turn_perf_v1');
    expect(record.cache_hit_rate).toBe(0.3);
    expect(record.extraction_to_compose_ratio).toBe(0.6);
    expect(record.external_user_hash).toHaveLength(64);
    expect(record.ttl_epoch_seconds).toBe(1778889600);
  });

  it('normalizes a perf record into a CLI summary', () => {
    const summary = toCliPerfSummary({
      pk: 'CONVERSATION#conv-1',
      sk: 'TURN#2026-04-16T00:00:00.000Z#trace-1',
      gsi1pk: 'CHANNEL_USER#terminal_whatsapp#hash',
      gsi1sk: 'TURN#2026-04-16T00:00:00.000Z#trace-1',
      record_type: 'turn_perf_v1',
      captured_at: '2026-04-16T00:00:00.000Z',
      ttl_epoch_seconds: 1,
      trace_id: 'trace-1',
      conversation_id: 'conv-1',
      plan_id: 'plan-1',
      channel: 'terminal_whatsapp',
      external_user_hash: 'hash',
      message_id: 'msg-1',
      user_message_length: 4,
      runtime_latency_ms: 999,
      timing_ms: {
        total: 999,
        load_plan: 1,
        prepare_working_plan: 1,
        extraction: 300,
        apply_extraction: 1,
        compute_sufficiency: 1,
        provider_search: 1,
        provider_enrichment: 1,
        prompt_bundle_load: 1,
        compose_reply: 400,
        save_plan: 1,
      },
      token_usage: {
        extraction: null,
        reply: null,
        total: {
          input_tokens: 1000,
          output_tokens: 100,
          total_tokens: 1100,
          cached_input_tokens: 200,
        },
      },
      tools_called_count: 1,
      tools_called: ['search_providers_from_plan'],
      provider_results_count: 2,
      missing_fields_count: 0,
      search_ready: true,
      next_node: 'recomendar',
      plan_persisted: true,
      plan_persist_reason: 'recomendar',
      cache_hit_rate: 0.2,
      extraction_to_compose_ratio: 0.75,
    });

    expect(summary.runtime_latency_ms).toBe(999);
    expect(summary.total_tokens).toBe(1100);
    expect(summary.cache_hit_rate).toBe(0.2);
    expect(summary.extraction_to_compose_ratio).toBe(0.75);
  });
});
