import { describe, expect, it } from 'vitest';

import {
  buildTurnPerfRecord,
  detectSpanishPolicyTermHits,
  detectAssistantMessageQualityFlags,
  redactSensitiveText,
  toCliPerfSummary,
} from '../src/logs/trace/perf';

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
        tool_inputs: [
          {
            tool: 'search_providers_from_plan',
            input: '{"email":"planner@example.com","phone":"+51 954779067","category":"Catering"}',
          },
        ],
        tool_outputs: [
          {
            tool: 'search_providers_from_plan',
            output: '{"providers":[{"id":7,"title":"La Botanería"}],"url":"https://example.com/private"}',
          },
        ],
        provider_results: [
          {
            id: 7,
            title: 'La Botanería',
            slug: 'la-botaneria',
            category: 'Catering',
            location: 'Lima',
            priceLevel: 'mid',
            rating: '4.8',
            reason: 'coincide',
            detailUrl: 'https://sinenvolturas.com/proveedores/la-botaneria',
            websiteUrl: null,
            minPrice: null,
            maxPrice: null,
            promoBadge: null,
            promoSummary: null,
            descriptionSnippet: null,
            serviceHighlights: [],
            termsHighlights: [],
          },
        ],
        recommendation_funnel: {
          available_candidates: 4,
          context_candidates: 2,
          context_candidate_ids: [1, 2],
          presentation_limit: 5,
        },
        search_strategy: 'search_from_plan',
        turn_decision: {
          nextNode: 'recomendar',
          routeKind: 'single_need_search',
          providerSearchMode: 'single_need_from_plan',
          presentationScope: 'single_need',
          focusNeedCategory: 'Catering',
          needsToSearch: ['Catering'],
          needsToPresent: ['Catering'],
          stopReason: null,
          persistReason: 'recomendar',
          invariantStatus: 'valid',
          invariantViolations: [],
        },
        route_kind: 'single_need_search',
        presentation_scope: 'single_need',
        session_focus_used: false,
        session_focus_key_present: false,
        state_machine_invariant_status: 'valid',
        state_machine_invariant_violations: [],
        operational_note: 'No encontré más opciones distintas con los criterios actuales.',
        extraction_summary: {
          information_request_count: 0,
          information_request_kinds: [],
          intent_confidence: 0.9,
          event_type: 'boda',
          vendor_category: 'Catering',
          vendor_categories: ['Catering'],
          active_need_category: 'Catering',
          location: 'Lima',
          budget_signal: '$$',
          guest_range: '21-50',
          selected_provider_hints: [],
          preferences: [],
          hard_constraints: [],
          assumptions: [],
          provider_query_intents_count: 0,
          provider_plan_operations_count: 0,
          provider_explanation_requested: false,
          provider_detail_requested: false,
          conversation_summary_preview: 'Boda en Lima con catering.',
          pause_requested: false,
          contact_fields_present: { name: false, email: false, phone: false },
          contact_validation_error: null,
        },
        plan_summary: {
          user_auth_status: 'none',
          pending_information_request_count: 0,
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
              selected_provider_ids: [],
            },
          ],
          selected_provider_ids: [],
          missing_fields: [],
          conversation_summary_preview: 'Boda en Lima con catering.',
          open_question_count: 0,
          contact_fields_present: { name: false, email: false, phone: false },
          contact_validation_error: null,
        },
        close_action_summary: {
          type: null,
          category: null,
          reason_preview: null,
        },
        selection_resolution_summary: {
          selected_provider_references: [],
          selected_provider_hints_count: 0,
          provider_plan_operation_types: [],
          provider_plan_operation_categories: [],
        },
        contact_validation_summary: {
          status: 'not_provided',
          field: null,
          reason_preview: null,
          extraction_contact_fields_present: { name: false, email: false, phone: false },
          plan_contact_fields_present: { name: false, email: false, phone: false },
        },
        provider_candidate_audit: [
          {
            provider_id: 7,
            category: 'Catering',
            location: 'Lima',
            retrieval_source: 'hybrid',
            retrieval_score: 0.82,
            fit_score: 91,
          },
        ],
        information_execution_summary: [],
        message_context: {
          history_status: 'available',
          context_source: 'agent_api',
          retrieved_message_count: 3,
          recent_message_count: 2,
          excluded_current_message_count: 1,
          directions: ['outbound', 'inbound'],
          sources: ['admin_campaign', null],
          entry_source: 'admin_campaign',
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
        openai_calls: {
          classifier: null,
          extraction: {
            responseId: 'resp_extract_test',
            requestId: 'req_extract_test',
            model: 'gpt-5.6-luna',
            attemptCount: 1,
            requestMetrics: {
              instructionBytes: 100,
              inputBytes: 200,
              toolCount: 0,
              schemaPropertyCount: 12,
            },
          },
          reply: null,
        },
      },
      channel: 'terminal_whatsapp',
      externalUserId: 'user-1',
      messageId: 'msg-1',
      userMessage: 'hola',
      receivedAt: '2026-04-15T23:59:59.000Z',
      sessionId: 'session-secret-1',
      contactPhonePresent: true,
      deliveryAction: 'send',
      media: [
        {
          kind: 'image',
          providerMediaId: 'media-secret-1',
          mimeType: 'image/jpeg',
          sha256: '81d3bd8a8db4868c9520ed47186e8b7c5789e61ff79f7f834be6950b808a90d3',
          fileName: null,
        },
      ],
      assistantMessage: 'Compárteme tu teléfono +51 954779067 y revisa https://example.com filecite turn1 file 0',
      includeAssistantMessagePreview: true,
      structuredMessageKind: 'contact_request',
      capturedAt,
      retentionDays: 30,
    });

    expect(record.pk).toMatch(/^CONVERSATION#[a-f0-9]{64}$/u);
    expect(record.conversation_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(record)).not.toContain('conv-1');
    expect(record.record_type).toBe('turn_perf_v1');
    expect(record.cache_hit_rate).toBe(0.3);
    expect(record.extraction_to_compose_ratio).toBe(0.6);
    expect(record.external_user_hash).toHaveLength(64);
    expect(record.user_message_hash).toHaveLength(64);
    expect(record.user_message_preview).toBe('hola');
    expect(record.openai_calls.extraction?.responseId).toBe('resp_extract_test');
    expect(record.media_count).toBe(1);
    expect(record.media_kinds).toEqual(['image']);
    expect(record.media_mime_types).toEqual(['image/jpeg']);
    expect(record.provider_media_id_hashes[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(record)).not.toContain('media-secret-1');
    expect(record.assistant_message_length).toBeGreaterThan(0);
    expect(record.assistant_message_hash).toHaveLength(64);
    expect(record.assistant_message_preview_redacted).toContain('[phone]');
    expect(record.assistant_message_preview_redacted).toContain('[url]');
    expect(record.assistant_message_quality_flags).toEqual([
      'file_citation_artifact',
      'command_like_contact_prompt',
    ]);
    expect(record.structured_message_kind).toBe('contact_request');
    expect(record.tool_input_previews_redacted[0]?.preview_redacted).toContain('[email]');
    expect(record.tool_input_previews_redacted[0]?.preview_redacted).toContain('[phone]');
    expect(record.tool_output_previews_redacted[0]?.preview_redacted).toContain('[url]');
    expect(record.provider_result_summaries).toEqual([
      {
        id: 7,
        title: 'La Botanería',
        category: 'Catering',
        location: 'Lima',
      },
    ]);
    expect(record.search_strategy).toBe('search_from_plan');
    expect(record.prompt_bundle_id).toBe('bundle-1');
    expect(record.prompt_file_paths).toEqual(['prompts/nodes/recomendar/system.txt']);
    expect(record.operational_note).toBe('No encontré más opciones distintas con los criterios actuales.');
    expect(record.provider_candidate_audit).toEqual([
      {
        provider_id: 7,
        category: 'Catering',
        location: 'Lima',
        retrieval_source: 'hybrid',
        retrieval_score: 0.82,
        fit_score: 91,
      },
    ]);
    expect(record.contact_validation_summary.status).toBe('not_provided');
    expect(record.information_execution_summary).toEqual([]);
    expect(record.feedback_signals).toMatchObject({
      schema_version: 1,
      input: {
        shape: 'text_and_media',
        ingress_delay_ms: 1000,
        session_context_present: true,
        contact_phone_context_present: true,
      },
      routing: {
        decision_source: 'model_assisted',
        ambiguity_status: null,
        clarification_question_present: false,
        ambiguity_interpretation_count: 0,
      },
      execution: {
        model_call_stages: [],
        model_call_count: 0,
        tools_called_count: 1,
      },
      output: {
        delivery_action: 'send',
        link_count: 1,
      },
      storage_boundaries: {
        raw_message_stored_in_feedback_signals: false,
        raw_media_stored_in_feedback_signals: false,
        provider_media_id_stored_raw_in_feedback_signals: false,
      },
    });
    expect(record.feedback_signals.correlation.message_id_hash).toHaveLength(64);
    expect(record.feedback_signals.correlation.session_id_hash).toHaveLength(64);
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
      conversation_hash: 'conversation-hash',
      plan_id: 'plan-1',
      channel: 'terminal_whatsapp',
      external_user_hash: 'hash',
      message_id: 'msg-1',
      user_message_length: 4,
      user_message_hash: 'hash-msg',
      user_message_preview: 'hola',
      media_count: 0,
      media_kinds: [],
      media_mime_types: [],
      provider_media_id_hashes: [],
      assistant_message_length: null,
      assistant_message_hash: null,
      assistant_message_preview_redacted: null,
      assistant_message_quality_flags: [],
      structured_message_kind: null,
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
      openai_calls: {
        classifier: null,
        extraction: null,
        reply: null,
      },
      message_context: {
        history_status: 'empty',
        context_source: 'agent_api',
        retrieved_message_count: 0,
        recent_message_count: 0,
        excluded_current_message_count: 0,
        directions: [],
        sources: [],
        entry_source: null,
      },
      tools_called_count: 1,
      previous_node: 'entrevista',
      node_path: ['entrevista', 'recomendar'],
      intent: 'buscar_proveedores',
      prompt_bundle_id: 'bundle-1',
      prompt_file_paths: ['prompts/nodes/recomendar/system.txt'],
      tools_considered: ['search_providers_from_plan'],
      tools_called: ['search_providers_from_plan'],
      tool_input_previews_redacted: [],
      tool_output_previews_redacted: [],
      search_strategy: 'search_from_plan',
      turn_decision: {
        nextNode: 'recomendar',
        routeKind: 'single_need_search',
        providerSearchMode: 'single_need_from_plan',
        presentationScope: 'single_need',
        focusNeedCategory: 'Catering',
        needsToSearch: ['Catering'],
        needsToPresent: ['Catering'],
        stopReason: null,
        persistReason: 'recomendar',
        invariantStatus: 'valid',
        invariantViolations: [],
      },
      route_kind: 'single_need_search',
      presentation_scope: 'single_need',
      session_focus_used: false,
      session_focus_key_present: false,
      state_machine_invariant_status: 'valid',
      state_machine_invariant_violations: [],
      operational_note: null,
      extraction_summary: {
        information_request_count: 0,
        information_request_kinds: [],
        intent_confidence: 0.9,
        event_type: 'boda',
        vendor_category: 'Catering',
        vendor_categories: ['Catering'],
        active_need_category: 'Catering',
        location: 'Lima',
        budget_signal: '$$',
        guest_range: '21-50',
        selected_provider_hints: [],
        preferences: [],
        hard_constraints: [],
        assumptions: [],
        provider_query_intents_count: 0,
        provider_plan_operations_count: 0,
        provider_explanation_requested: false,
        provider_detail_requested: false,
        conversation_summary_preview: 'Boda en Lima con catering.',
        pause_requested: false,
        contact_fields_present: { name: false, email: false, phone: false },
        contact_validation_error: null,
      },
      plan_summary: {
        user_auth_status: 'none',
        pending_information_request_count: 0,
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
            selected_provider_ids: [],
          },
        ],
        selected_provider_ids: [],
        missing_fields: [],
        conversation_summary_preview: 'Boda en Lima con catering.',
        open_question_count: 0,
        contact_fields_present: { name: false, email: false, phone: false },
        contact_validation_error: null,
      },
      close_action_summary: {
        type: null,
        category: null,
        reason_preview: null,
      },
      selection_resolution_summary: {
        selected_provider_references: [],
        selected_provider_hints_count: 0,
        provider_plan_operation_types: [],
        provider_plan_operation_categories: [],
      },
      contact_validation_summary: {
        status: 'not_provided',
        field: null,
        reason_preview: null,
        extraction_contact_fields_present: { name: false, email: false, phone: false },
        plan_contact_fields_present: { name: false, email: false, phone: false },
      },
      provider_candidate_audit: [],
      information_execution_summary: [],
      provider_results_count: 2,
      provider_result_ids: [1, 2],
      provider_result_summaries: [
        { id: 1, title: 'Uno', category: 'Catering', location: 'Lima' },
        { id: 2, title: 'Dos', category: 'Catering', location: 'Lima' },
      ],
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
        feedback_signals: {
          schema_version: 1,
          correlation: {
            message_id_hash: 'message-hash',
            session_id_hash: null,
          },
          input: {
            shape: 'text_only',
            has_text: true,
            text_length: 4,
            media_count: 0,
            media_kinds: [],
            media_mime_types: [],
            received_at: '2026-04-16T00:00:00.000Z',
            ingress_delay_ms: 0,
            session_context_present: false,
            contact_phone_context_present: false,
          },
          routing: {
            previous_node: 'entrevista',
            next_node: 'recomendar',
            intent: 'buscar_proveedores',
            intent_confidence: 0.9,
            ambiguity_status: 'clear',
            clarification_question_present: false,
            ambiguity_interpretation_count: 0,
            route_kind: 'single_need_search',
            faq_turn: false,
            decision_source: 'model_assisted',
            operational_note_present: false,
          },
          execution: {
            model_call_stages: [],
            model_call_count: 0,
            tools_called_count: 1,
            information_capability_count: 0,
            information_partial_failure: false,
            runtime_latency_ms: 999,
          },
          output: {
            delivery_action: 'send',
            character_count: 0,
            word_count: 0,
            question_count: 0,
            link_count: 0,
            list_item_count: 0,
            structured_message_kind: null,
            quality_flags: [],
            spanish_policy_term_hits: [],
          },
          storage_boundaries: {
            raw_message_stored_in_feedback_signals: false,
            raw_media_stored_in_feedback_signals: false,
            provider_media_id_stored_raw_in_feedback_signals: false,
          },
        },
      });

    expect(summary.runtime_latency_ms).toBe(999);
    expect(summary.total_tokens).toBe(1100);
    expect(summary.cache_hit_rate).toBe(0.2);
    expect(summary.extraction_to_compose_ratio).toBe(0.75);
    expect(summary.feedback_signals.schema_version).toBe(1);
  });

  it('redacts sensitive assistant output and flags wording regressions', () => {
    const redacted = redactSensitiveText(
      'Escribe a ana@example.com, llama al +51 954 779 067, usa 123456 y abre https://example.com.',
    );

    expect(redacted).toBe(
      'Escribe a [email], llama al [phone], usa [code] y abre [url]',
    );
    expect(detectAssistantMessageQualityFlags(
      [
        'Puedo ayudarte a armar un plan.',
        'También puedo buscar proveedores.',
        'Compárteme tu teléfono.',
        'filecite turn1 file 0',
      ].join('\n'),
    )).toEqual([
      'file_citation_artifact',
      'command_like_contact_prompt',
      'welcome_menu_template',
    ]);
    expect(detectSpanishPolicyTermHits(
      'Confirma el RSVP por email en este chat. https://example.com/marketplace',
    )).toEqual(['RSVP', 'email', 'chat']);
  });
});
