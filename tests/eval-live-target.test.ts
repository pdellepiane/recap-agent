import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/dynamo-plan-store', () => {
  return {
    DynamoPlanStore: class {
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
          vendor_category: 'fotografía',
          active_need_category: 'fotografía',
          location: 'Lima',
          budget_signal: null,
          guest_range: '51-100',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          provider_needs: [],
          recommended_provider_ids: [33],
          recommended_providers: [],
          selected_provider_id: null,
          selected_provider_hint: null,
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
    expect(result.turns[0]?.plan.event_type).toBe('boda');
  });
});
