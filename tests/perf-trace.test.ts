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
        recommendation_funnel: {
          available_candidates: 4,
          context_candidates: 2,
          context_candidate_ids: [1, 2],
          presentation_limit: 5,
        },
        search_strategy: 'search_from_plan',
        operational_note: 'No encontré más opciones distintas con los criterios actuales.',
        extraction_summary: {
          intent_confidence: 0.9,
          event_type: 'boda',
          vendor_category: 'Catering',
          vendor_categories: ['Catering'],
          active_need_category: 'Catering',
          location: 'Lima',
          budget_signal: '$$',
          guest_range: '21-50',
          selected_provider_hint: null,
          preferences: [],
          hard_constraints: [],
          assumptions: [],
          conversation_summary_preview: 'Boda en Lima con catering.',
          pause_requested: false,
          contact_fields_present: { name: false, email: false, phone: false },
          contact_validation_error: null,
        },
        plan_summary: {
          current_node: 'recomendar',
          lifecycle_state: 'active',
          event_type: 'boda',
          vendor_category: 'Catering',
          active_need_category: 'Catering',
          location: 'Lima',
          budget_signal: '$$',
          guest_range: '21-50',
          provider_need_categories: ['Catering'],
          provider_need_count: 1,
          provider_need_statuses: [
            {
              category: 'Catering',
              status: 'shortlisted',
              has_recommendations: true,
              selected_provider_id: null,
            },
          ],
          selected_provider_id: null,
          missing_fields: [],
          conversation_summary_preview: 'Boda en Lima con catering.',
          open_question_count: 0,
          contact_fields_present: { name: false, email: false, phone: false },
          contact_validation_error: null,
        },
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
    expect(record.user_message_hash).toHaveLength(64);
    expect(record.user_message_preview).toBe('hola');
    expect(record.search_strategy).toBe('search_from_plan');
    expect(record.prompt_bundle_id).toBe('bundle-1');
    expect(record.prompt_file_paths).toEqual(['prompts/nodes/recomendar/system.txt']);
    expect(record.operational_note).toBe('No encontré más opciones distintas con los criterios actuales.');
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
      user_message_hash: 'hash-msg',
      user_message_preview: 'hola',
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
      previous_node: 'entrevista',
      node_path: ['entrevista', 'recomendar'],
      intent: 'buscar_proveedores',
      prompt_bundle_id: 'bundle-1',
      prompt_file_paths: ['prompts/nodes/recomendar/system.txt'],
      tools_considered: ['search_providers_from_plan'],
      tools_called: ['search_providers_from_plan'],
      search_strategy: 'search_from_plan',
      operational_note: null,
      extraction_summary: {
        intent_confidence: 0.9,
        event_type: 'boda',
        vendor_category: 'Catering',
        vendor_categories: ['Catering'],
        active_need_category: 'Catering',
        location: 'Lima',
        budget_signal: '$$',
        guest_range: '21-50',
        selected_provider_hint: null,
        preferences: [],
        hard_constraints: [],
        assumptions: [],
        conversation_summary_preview: 'Boda en Lima con catering.',
        pause_requested: false,
        contact_fields_present: { name: false, email: false, phone: false },
        contact_validation_error: null,
      },
      plan_summary: {
        current_node: 'recomendar',
        lifecycle_state: 'active',
        event_type: 'boda',
        vendor_category: 'Catering',
        active_need_category: 'Catering',
        location: 'Lima',
        budget_signal: '$$',
        guest_range: '21-50',
        provider_need_categories: ['Catering'],
        provider_need_count: 1,
        provider_need_statuses: [
          {
            category: 'Catering',
            status: 'shortlisted',
            has_recommendations: true,
            selected_provider_id: null,
          },
        ],
        selected_provider_id: null,
        missing_fields: [],
        conversation_summary_preview: 'Boda en Lima con catering.',
        open_question_count: 0,
        contact_fields_present: { name: false, email: false, phone: false },
        contact_validation_error: null,
      },
      provider_results_count: 2,
      provider_result_ids: [1, 2],
      missing_fields_count: 0,
      missing_fields: [],
      search_ready: true,
      next_node: 'recomendar',
        plan_persisted: true,
        plan_persist_reason: 'recomendar',
        cache_hit_rate: 0.2,
        extraction_to_compose_ratio: 0.75,
        recommendation_funnel_available_candidates: 4,
        recommendation_funnel_context_candidates: 2,
        recommendation_funnel_presentation_limit: 5,
      });

    expect(summary.runtime_latency_ms).toBe(999);
    expect(summary.total_tokens).toBe(1100);
    expect(summary.cache_hit_rate).toBe(0.2);
    expect(summary.extraction_to_compose_ratio).toBe(0.75);
  });
});
