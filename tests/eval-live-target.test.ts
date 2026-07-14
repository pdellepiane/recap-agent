import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/dynamo-plan-store', () => {
  const savedPlans: unknown[] = [];
  return {
    savedPlans,
    DynamoPlanStore: class {
      async save(input: unknown) {
        savedPlans.push(input);
      }

      async getByExternalUser() {
        return {
          plan_id: 'plan-live',
          channel: 'terminal_whatsapp_eval',
          external_user_id: 'eval-user',
          conversation_id: 'conv-live',
          current_node: 'recomendar',
          intent: 'buscar_proveedores',
          intent_confidence: 0.9,
          event_type: 'boda',
          vendor_category: 'Fotografía y video',
          active_need_category: 'Fotografía y video',
          location: 'Lima',
          budget_signal: null,
          guest_range: '51-100',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          provider_needs: [],
          recommended_provider_ids: [33],
          recommended_providers: [],
          selected_provider_ids: [],
          selected_provider_hints: [],
          assumptions: [],
          conversation_summary: 'Live test plan.',
          last_user_goal: null,
          open_questions: [],
          updated_at: new Date().toISOString(),
        };
      }
    },
  };
});

describe('live lambda eval target', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('CHANNEL_API_KEY', 'test-channel-api-key');
  });

  it('normalizes the lambda response and hydrates the persisted plan', async () => {
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        async json() {
          return {
            message: 'Tengo opciones de fotografía en Lima.',
            conversation_id: 'conv-live',
            plan_id: 'plan-live',
            current_node: 'recomendar',
            trace: {
              trace_id: 'trace-live',
              conversation_id: 'conv-live',
              plan_id: 'plan-live',
              previous_node: 'aclarar_pedir_faltante',
              next_node: 'recomendar',
              node_path: ['aclarar_pedir_faltante', 'buscar_proveedores', 'recomendar'],
              intent: 'buscar_proveedores',
              missing_fields: [],
              search_ready: true,
              prompt_bundle_id: 'bundle-live',
              prompt_file_paths: ['prompts/nodes/recomendar/system.txt'],
              tools_considered: ['search_providers_from_plan'],
              tools_called: ['search_providers_from_plan'],
              tool_outputs: [
                {
                  tool: 'search_providers_from_plan',
                  output: '{"providers":[{"id":33,"title":"Spotlight Studio"}]}',
                },
              ],
              provider_results: [
                {
                  id: 33,
                  title: 'Spotlight Studio',
                  slug: 'spotlight-studio',
                  category: 'Fotografía y video',
                  location: 'Lima, Perú',
                  priceLevel: null,
                  rating: '0.0',
                  reason: 'coincide',
                  detailUrl: 'https://sinenvolturas.com/proveedores/spotlight-studio',
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
              plan_persisted: true,
              plan_persist_reason: 'recomendar',
              timing_ms: {
                total: 1200,
                load_plan: 10,
                prepare_working_plan: 5,
                extraction: 350,
                apply_extraction: 10,
                compute_sufficiency: 5,
                provider_search: 200,
                provider_enrichment: 120,
                prompt_bundle_load: 10,
                compose_reply: 450,
                save_plan: 40,
              },
              token_usage: {
                extraction: null,
                reply: null,
                total: null,
              },
            },
            perf: {
              trace_id: 'trace-live',
              conversation_id: 'conv-live',
              runtime_latency_ms: 1200,
              extraction_latency_ms: 350,
              compose_latency_ms: 450,
              tools_called_count: 1,
              provider_results_count: 1,
              total_tokens: null,
              cached_input_tokens: null,
              cache_hit_rate: null,
              extraction_to_compose_ratio: 0.7777777778,
              captured_at: new Date().toISOString(),
            },
          };
        },
      }),
    );

    const result = await runLiveLambdaCase({
      currentCase: {
        id: 'live.case',
        suite: 'live_smoke',
        version: 1,
        description: 'Live lambda test case.',
        imports: [],
        tags: [],
        priority: 'p1',
        status: 'active',
        targetModes: ['live_lambda'],
        variables: {},
        inputs: [{ text: 'quiero fotografos en lima' }],
        expectations: [],
        scorers: [],
        notes: [],
      },
      config: {
        label: 'live-dev-lambda',
        target: 'live_lambda',
        notes: [],
        environmentOverrides: {},
        liveLambda: {
          functionUrl: 'https://example.test/lambda',
          channel: 'terminal_whatsapp_eval',
        },
      },
      artifactDir: '.eval-runs-test',
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.trace.tools_called).toEqual(['search_providers_from_plan']);
    expect(result.turns[0]?.perf?.runtime_latency_ms).toBe(1200);
    expect(result.turns[0]?.plan.event_type).toBe('boda');
  }, 15_000);

  it('passes seed plans, session ids, and preserves live token usage across multiple turns', async () => {
    const storageModule = await import('../src/storage/dynamo-plan-store');
    const savedPlans = (storageModule as unknown as { savedPlans: unknown[] }).savedPlans;
    savedPlans.length = 0;
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');
    const requestBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        expect(new Headers(init.headers).get('x-api-key')).toBe('test-channel-api-key');
        const bodyText =
          typeof init.body === 'string' ? init.body : await new Response(init.body).text();
        const parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
        requestBodies.push(parsedBody);
        const turnIndex = requestBodies.length - 1;
        return {
          ok: true,
          async json() {
            return {
              message: turnIndex === 0 ? 'Confirmé tu selección.' : 'Necesito tu teléfono con código de país.',
              conversation_id: 'conv-live-token',
              plan_id: 'plan-live-token',
              current_node: turnIndex === 0 ? 'seguir_refinando_guardar_plan' : 'crear_lead_cerrar',
              trace: {
                trace_id: `trace-live-token-${turnIndex}`,
                conversation_id: 'conv-live-token',
                plan_id: 'plan-live-token',
                previous_node: turnIndex === 0 ? 'recomendar' : 'crear_lead_cerrar',
                next_node: turnIndex === 0 ? 'seguir_refinando_guardar_plan' : 'crear_lead_cerrar',
                node_path: turnIndex === 0
                  ? ['recomendar', 'usuario_elige_proveedor', 'seguir_refinando_guardar_plan']
                  : ['crear_lead_cerrar'],
                intent: turnIndex === 0 ? 'confirmar_proveedor' : 'cerrar',
                missing_fields: [],
                search_ready: true,
                prompt_bundle_id: 'bundle-live-token',
                prompt_file_paths: ['prompts/nodes/crear_lead_cerrar/system.txt'],
                tools_considered: [],
                tools_called: [],
                tool_inputs: [],
                tool_outputs: [],
                provider_results: [],
                recommendation_funnel: {
                  available_candidates: 0,
                  context_candidates: 0,
                  context_candidate_ids: [],
                  presentation_limit: 6,
                },
                search_strategy: 'none',
                plan_persisted: true,
                plan_persist_reason: turnIndex === 0 ? 'seguir_refinando_guardar_plan' : 'crear_lead_cerrar',
                timing_ms: {
                  total: 1000,
                  load_plan: 10,
                  prepare_working_plan: 5,
                  extraction: 300,
                  apply_extraction: 10,
                  compute_sufficiency: 5,
                  provider_search: 0,
                  provider_enrichment: 0,
                  prompt_bundle_load: 10,
                  compose_reply: 500,
                  save_plan: 20,
                },
                token_usage: {
                  extraction: {
                    input_tokens: 100,
                    output_tokens: 20,
                    total_tokens: 120,
                    cached_input_tokens: 0,
                  },
                  reply: {
                    input_tokens: 130,
                    output_tokens: 30,
                    total_tokens: 160,
                    cached_input_tokens: 0,
                  },
                  total: {
                    input_tokens: 230,
                    output_tokens: 50,
                    total_tokens: 280,
                    cached_input_tokens: 0,
                  },
                },
              },
              perf: {
                trace_id: `trace-live-token-${turnIndex}`,
                conversation_id: 'conv-live-token',
                runtime_latency_ms: 1000,
                extraction_latency_ms: 300,
                compose_latency_ms: 500,
                tools_called_count: 0,
                provider_results_count: 0,
                total_tokens: 280,
                cached_input_tokens: 0,
                cache_hit_rate: 0,
                extraction_to_compose_ratio: 0.6,
                captured_at: new Date().toISOString(),
              },
            };
          },
        };
      }),
    );

    const result = await runLiveLambdaCase({
      currentCase: {
        id: 'live.token.seeded',
        suite: 'live_feedback_token_regression',
        version: 1,
        description: 'Live token seeded multi-turn test case.',
        imports: [],
        tags: [],
        priority: 'p1',
        status: 'active',
        targetModes: ['live_lambda'],
        variables: {},
        inputs: [
          { text: 'quiero usar la primera opción', sessionId: 'session-token-test' },
          { text: 'mi teléfono es 51954779071', sessionId: 'session-token-test' },
        ],
        seedPlan: {
          current_node: 'recomendar',
          event_type: 'boda',
          location: 'Lima',
          guest_range: '51-100',
          active_need_category: 'Fotografía y video',
          vendor_category: 'Fotografía y video',
        },
        expectations: [],
        scorers: [],
        notes: [],
      },
      config: {
        label: 'live-dev-lambda',
        target: 'live_lambda',
        notes: [],
        environmentOverrides: {},
        liveLambda: {
          functionUrl: 'https://example.test/lambda',
          channel: 'terminal_whatsapp_eval',
        },
      },
      artifactDir: '.eval-runs-test',
    });

    expect(savedPlans).toHaveLength(1);
    expect(requestBodies.map((body) => body.session_id)).toEqual([
      'session-token-test',
      'session-token-test',
    ]);
    expect(result.turns).toHaveLength(2);
    expect(result.turns.every((turn) => (turn.trace.token_usage.total?.total_tokens ?? 0) > 0)).toBe(true);
    expect(result.turns.every((turn) => (turn.perf?.total_tokens ?? 0) > 0)).toBe(true);
  }, 15_000);
});
