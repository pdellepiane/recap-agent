import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { buildExecutionIdentitySeed } from '../src/evals/targets/live-lambda';
vi.mock('../src/aws/local-identity', () => ({ assertRequiredLocalAwsIdentity: vi.fn() }));

vi.mock('@aws-sdk/client-cloudformation', () => ({
  DescribeStacksCommand: class {},
  CloudFormationClient: class {
    async send() {
      return { Stacks: [{ Outputs: [
        { OutputKey: 'DeploymentEnvironment', OutputValue: 'development' },
        { OutputKey: 'FunctionUrl', OutputValue: 'https://example.test/lambda' },
        { OutputKey: 'PlansTableName', OutputValue: 'recap-agent-runtime-dev-plans' },
      ] }] };
    }
  },
}));

vi.mock('../src/storage/dynamo-plan-store', () => {
  const savedPlans: unknown[] = [];
  let saveError: Error | null = null;
  let livePlan: Record<string, unknown> | null = null;
  return {
    savedPlans,
    setSaveError(error: Error | null) {
      saveError = error;
    },
    setLivePlan(plan: Record<string, unknown> | null) {
      livePlan = plan;
    },
    DynamoPlanStore: class {
      async save(input: unknown) {
        if (saveError) {
          throw saveError;
        }
        savedPlans.push(input);
      }

      async getByExternalUser() {
        if (livePlan) return livePlan;
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
    vi.stubEnv('DEV_CHANNEL_API_KEY', 'test-channel-api-key');
  });

  it('fails loudly when a live seed plan cannot be persisted', async () => {
    const storageModule = await import('../src/storage/dynamo-plan-store');
    const setSaveError = planStoreTestHooks(storageModule).setSaveError;
    setSaveError(new Error('expired development credentials'));
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');

    try {
      await expect(runLiveLambdaCase({
        currentCase: {
          id: 'live.seed-failure',
          suite: 'live_behavior_regression',
          version: 1,
          description: 'Seed failure must not look like an empty model response.',
          imports: [],
          tags: [],
          priority: 'p1',
          status: 'active',
          targetModes: ['live_lambda'],
          variables: {},
          inputs: [{ text: 'Sí confirmo.' }],
          seedPlan: { current_node: 'recomendar' },
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
      })).rejects.toThrow(
        'Unable to seed the live evaluation plan for live.seed-failure: expired development credentials',
      );
    } finally {
      setSaveError(null);
    }
  }, 15_000);

  it('normalizes the lambda response and hydrates the persisted plan', async () => {
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        async json() {
            return {
            message: 'Tengo opciones de fotografía en Lima.',
            output_origin: { status: 'verified', candidateSha256: '1'.repeat(64), deliveredSha256: '0'.repeat(64), transformationVersion: 'transport-v2', mismatchFields: [] },
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
                  output: '{"providers":[{"id":33,"title":"Spotlight Studio"}],"code":"847261","access_token":"access-token-canary"}',
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
              route_kind: 'single_need_search',
              operational_note: 'Safe trace detail.',
              plan_persisted: true,
              plan_persist_reason: 'recomendar',
              timing_ms: {
                total: 1200,
                load_plan: 10,
                prepare_working_plan: 5,
                extraction: 350,
                apply_extraction: 10,
                compute_sufficiency: 5,
                rsvp_execution: 17,
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
              conversation_hash: 'a'.repeat(64),
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
            plan: sensitiveLivePlan(),
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
        inputs: [{ text: 'quiero fotografos en lima', contactPhone: '+51973296571' }],
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
    expect(result.turns[0]?.outputOrigin?.status).toBe('mismatch');
    expect(result.turns[0]?.trace.route_kind).toBe('single_need_search');
    // Package C contract: free-text operational notes stay omitted from safe
    // traces; judges use typed packets instead.
    expect(result.turns[0]?.trace.operational_note).toBe('[omitted]');
    expect(result.turns[0]?.trace.timing_ms.rsvp_execution).toBe(17);
    expect(result.turns[0]?.perf?.runtime_latency_ms).toBe(1200);
    expect(result.turns[0]?.perf?.conversation_hash).toBe('a'.repeat(64));
    expect(result.turns[0]?.plan.event_type).toBe('boda');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('access-token-canary');
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9.live.signature');
    expect(serialized).not.toContain('+51973296571');
    expect(serialized).not.toContain('847261');
    expect(result.turns[0]?.plan).toMatchObject({
      contact_phone: null,
      user_auth: {
        status: 'authenticated',
        auth_method: 'phone',
        token: null,
      },
    });
    expect(result.turns[0]).not.toHaveProperty('rawTargetResponse');
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
        expect(new Headers(init.headers).get('authorization')).toBe(
          'Bearer test-channel-api-key',
        );
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
                conversation_hash: 'b'.repeat(64),
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
    // O1 execution identity: the repeated logical session maps identically
    // to one physical session per execution, never the literal input ID.
    const expectedSession = `live.token.seeded-session-${buildExecutionIdentitySeed('live-dev-lambda', 'live-dev-lambda', 'live.token.seeded')}--s1`;
    expect(requestBodies.map((body) => body.session_id)).toEqual([
      expectedSession,
      expectedSession,
    ]);
    expect(requestBodies.every((body) => !Object.hasOwn(body, 'operation'))).toBe(true);
    expect(result.turns).toHaveLength(2);
    expect(result.turns.every((turn) => (turn.trace.token_usage.total?.total_tokens ?? 0) > 0)).toBe(true);
    expect(result.turns.every((turn) => (turn.perf?.total_tokens ?? 0) > 0)).toBe(true);
  }, 15_000);
});

type PlanStoreTestHooks = {
  setSaveError: (error: Error | null) => void;
  setLivePlan: (plan: Record<string, unknown> | null) => void;
};

function planStoreTestHooks(module: object): PlanStoreTestHooks {
  return module as unknown as PlanStoreTestHooks;
}

function sensitiveLivePlan() {
  return mergePlan(
    createEmptyPlan({
      planId: 'sensitive-live-plan',
      channel: 'whatsapp',
      externalUserId: 'sensitive-live-user',
    }),
    {
      event_type: 'boda',
      contact_phone: '51973296571',
      human_escalation: {
        status: 'none',
        requested_at: null,
        phone_number: '51973296571',
        last_error: null,
      },
      user_auth: {
        status: 'authenticated',
        token: 'eyJhbGciOiJIUzI1NiJ9.live.signature',
        token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        auth_method: 'phone',
      },
    },
  );
}

describe('live-target wire output observation', () => {
  it('marks a replaced wire message as mismatch instead of trusting the declared hash', async () => {
    const { hashPrivateOutput } = await import('../src/audit/output-origin');
    const { independentlyObserveWireOutput } = await import('../src/evals/targets/live-lambda');
    const candidate = 'Respuesta original del modelo.';
    const observed = independentlyObserveWireOutput('Texto reemplazado en el cable.', {
      status: 'verified',
      candidateSha256: hashPrivateOutput(candidate),
      deliveredSha256: hashPrivateOutput(candidate),
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    });
    expect(observed.status).toBe('mismatch');
    expect(observed.mismatchFields).toContain('candidate_sha256');
    expect(observed.mismatchFields).toContain('delivered_sha256');
    expect(observed.deliveredSha256).toBe(hashPrivateOutput('Texto reemplazado en el cable.'));
  });

  it('marks a missing declared receipt as missing with the recomputed delivered hash', async () => {
    const { hashPrivateOutput } = await import('../src/audit/output-origin');
    const { independentlyObserveWireOutput } = await import('../src/evals/targets/live-lambda');
    const observed = independentlyObserveWireOutput('Texto entregado por cable.', undefined);
    expect(observed.status).toBe('missing');
    expect(observed.candidateSha256).toBeNull();
    expect(observed.deliveredSha256).toBe(hashPrivateOutput('Texto entregado por cable.'));
    expect(observed.mismatchFields).toContain('candidate_output_origin');
  });

  it('keeps raw model text out of the evidence while preserving verified equality', async () => {
    const { hashPrivateOutput } = await import('../src/audit/output-origin');
    const { independentlyObserveWireOutput } = await import('../src/evals/targets/live-lambda');
    const wire = 'Texto entregado por cable.';
    const observed = independentlyObserveWireOutput(wire, {
      status: 'verified',
      candidateSha256: hashPrivateOutput(wire),
      deliveredSha256: hashPrivateOutput(wire),
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    });
    expect(observed.status).toBe('verified');
    expect(JSON.stringify(observed)).not.toContain(wire);
  });
});

describe('live-target fixture outbound observation', () => {
  beforeEach(async () => {
    const storageModule = await import('../src/storage/dynamo-plan-store');
    planStoreTestHooks(storageModule).setLivePlan(null);
  });

  function fixtureTrace(turnIndex: number) {
    return {
      trace_id: `trace-fixture-${turnIndex}`,
      conversation_id: 'conv-fixture',
      plan_id: 'plan-fixture',
      previous_node: 'aclarar_pedir_faltante',
      next_node: 'recomendar',
      node_path: ['aclarar_pedir_faltante', 'recomendar'],
      intent: 'buscar_proveedores',
      missing_fields: [],
      search_ready: true,
      prompt_bundle_id: 'bundle-fixture',
      prompt_file_paths: ['prompts/nodes/recomendar/system.txt'],
      tools_considered: [],
      tools_called: [],
      tool_outputs: [],
      provider_results: [],
      plan_persisted: true,
      plan_persist_reason: 'recomendar',
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
      token_usage: { extraction: null, reply: null, total: null },
    };
  }

  it('records the sent receipt through the live caller when private evidence matches', async () => {
    const { hashPrivateOutput } = await import('../src/audit/output-origin');
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');
    const { InMemoryEvalFixtureStateStore } = await import('../src/runtime/eval-fixture-state');
    const storageModule = await import('../src/storage/dynamo-plan-store');
    const setLivePlan = planStoreTestHooks(storageModule).setLivePlan;
    const replyText = 'Tengo opciones de fotografia en Lima.';
    // O1 wire identity: the invocation message id carries the execution seed.
    const sentMessageId = `live.fixture.receipt-0-${buildExecutionIdentitySeed('live-dev-lambda', 'live-dev-lambda', 'live.fixture.receipt')}`;
    const { createEmptyPlan } = await import('../src/core/plan');
    const privatePlan = {
      ...createEmptyPlan({ planId: 'plan-fixture', channel: 'terminal_whatsapp_eval', externalUserId: 'eval-user' }),
      last_outbound_context: {
        message_id: sentMessageId,
        text: replyText,
        text_truncated: false,
        recorded_at: new Date().toISOString(),
        delivery_evidence: 'constructed' as const,
      },
    };
    setLivePlan(privatePlan);
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const bodyText = typeof init.body === 'string' ? init.body : await new Response(init.body).text();
      requestBodies.push(JSON.parse(bodyText) as Record<string, unknown>);
      return {
        ok: true,
        headers: new Headers(),
        async json() {
          return {
            message: replyText,
            message_original_sha256: hashPrivateOutput(replyText),
            delivery: { action: 'send', reason: 'model_reply' },
            conversation_id: 'conv-fixture',
            plan_id: 'plan-fixture',
            current_node: 'recomendar',
            trace: fixtureTrace(0),
          };
        },
      };
    }));
    try {
      const store = new InMemoryEvalFixtureStateStore();
      const result = await runLiveLambdaCase({
        currentCase: {
          id: 'live.fixture.receipt',
          suite: 'live_behavior_regression',
          version: 1,
          description: 'Fixture receipt integration.',
          imports: [],
          tags: [],
          priority: 'p1',
          status: 'active',
          targetModes: ['live_lambda'],
          variables: {},
          inputs: [{ text: 'quiero fotografos en lima', contactPhone: '+51973296571' }],
          backendFixture: { scenario: 'image-clean-world' },
          expectations: [],
          scorers: [],
          notes: [],
        },
        config: {
          label: 'live-dev-lambda',
          target: 'live_lambda',
          notes: [],
          environmentOverrides: {},
          liveLambda: { functionUrl: 'https://example.test/lambda', channel: 'terminal_whatsapp_eval' },
        },
        artifactDir: '.eval-runs-test',
        fixtureStore: store,
      });
      expect(result.turns).toHaveLength(1);
      // S1 wire identity for the S3 silence seam travels on the turn.
      expect(result.turns[0]?.observedMessageId).toBe(sentMessageId);
      // The wire marker carries the actual evaluation identity, never
      // scenario-derived defaults.
      expect(requestBodies[0]?.backendFixture).toMatchObject({
        scenario: 'image-clean-world',
        runId: 'live-dev-lambda',
        caseId: 'live.fixture.receipt',
      });
      const sentUser = requestBodies[0]?.user_id as string;
      const stored = await store.listMessages(
        'live-dev-lambda',
        'live.fixture.receipt',
        `terminal_whatsapp_eval#${sentUser}`,
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        direction: 'outbound',
        delivery: 'sent',
        body: replyText,
        scenario: 'image-clean-world',
      });
    } finally {
      setLivePlan(null);
    }
  }, 15_000);

  it('fails the harness when a claimed send has no matching private record', async () => {
    const { hashPrivateOutput } = await import('../src/audit/output-origin');
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');
    const { InMemoryEvalFixtureStateStore } = await import('../src/runtime/eval-fixture-state');
    const replyText = 'Tengo opciones de fotografia en Lima.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      async json() {
        return {
          message: replyText,
          message_original_sha256: hashPrivateOutput(replyText),
          delivery: { action: 'send', reason: 'model_reply' },
          conversation_id: 'conv-fixture',
          plan_id: 'plan-fixture',
          current_node: 'recomendar',
          trace: fixtureTrace(0),
        };
      },
    }));
    // The mocked plan store returns a plan without last_outbound_context:
    // a claimed send with no private record is a harness error, never a
    // fabricated reply.
    await expect(runLiveLambdaCase({
      currentCase: {
        id: 'live.fixture.mismatch',
        suite: 'live_behavior_regression',
        version: 1,
        description: 'Harness error on missing record.',
        imports: [],
        tags: [],
        priority: 'p1',
        status: 'active',
        targetModes: ['live_lambda'],
        variables: {},
        inputs: [{ text: 'quiero fotografos en lima', contactPhone: '+51973296571' }],
        backendFixture: { scenario: 'image-clean-world' },
        expectations: [],
        scorers: [],
        notes: [],
      },
      config: {
        label: 'live-dev-lambda',
        target: 'live_lambda',
        notes: [],
        environmentOverrides: {},
        liveLambda: { functionUrl: 'https://example.test/lambda', channel: 'terminal_whatsapp_eval' },
      },
      artifactDir: '.eval-runs-test',
      fixtureStore: new InMemoryEvalFixtureStateStore(),
    })).rejects.toThrow('Harness error');
  }, 15_000);

  it('never marks suppressed responses as sent', async () => {
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');
    const { InMemoryEvalFixtureStateStore } = await import('../src/runtime/eval-fixture-state');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      async json() {
        return {
          message: null,
          delivery: { action: 'suppress', reason: 'image_only_no_outstanding_task' },
          conversation_id: 'conv-fixture',
          plan_id: 'plan-fixture',
          current_node: 'contacto_inicial',
          trace: { ...fixtureTrace(0), plan_persist_reason: 'image_file_silence' },
        };
      },
    }));
    const store = new InMemoryEvalFixtureStateStore();
    const result = await runLiveLambdaCase({
      currentCase: {
        id: 'live.fixture.suppressed',
        suite: 'live_behavior_regression',
        version: 1,
        description: 'Suppressed turns record nothing.',
        imports: [],
        tags: [],
        priority: 'p1',
        status: 'active',
        targetModes: ['live_lambda'],
        variables: {},
        inputs: [{ text: '', contactPhone: '+51987654321' }],
        backendFixture: { scenario: 'image-clean-world' },
        expectations: [],
        scorers: [],
        notes: [],
      },
      config: {
        label: 'live-dev-lambda',
        target: 'live_lambda',
        notes: [],
        environmentOverrides: {},
        liveLambda: { functionUrl: 'https://example.test/lambda', channel: 'terminal_whatsapp_eval' },
      },
      artifactDir: '.eval-runs-test',
      fixtureStore: store,
    });
    expect(result.turns).toHaveLength(1);
    // No receipt was recorded for the suppressed turn.
    const stored = await store.list('live-dev-lambda', 'live.fixture.suppressed');
    expect(stored).toHaveLength(0);
  }, 15_000);

  it('gates every receipt conjunct without fabricating replies', async () => {
    const { hashPrivateOutput } = await import('../src/audit/output-origin');
    const { recordFixtureOutboundObservation } = await import('../src/evals/targets/live-lambda');
    const { InMemoryEvalFixtureStateStore } = await import('../src/runtime/eval-fixture-state');
    const base = {
      store: new InMemoryEvalFixtureStateStore(),
      runId: 'run-gate',
      caseId: 'case-gate',
      conversationKey: 'conv#user',
      scenario: 'image-clean-world',
      phone: '+51987654321',
      sentMessageId: 'case-gate-0',
      responseText: 'Respuesta real.',
      observedOriginalSha256: hashPrivateOutput('Respuesta real.'),
    };
    const contextFor = (text: string, messageId = 'case-gate-0', truncated = false) => ({
      message_id: messageId,
      text,
      text_truncated: truncated,
      recorded_at: new Date().toISOString(),
      delivery_evidence: 'constructed' as const,
    });
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: { last_outbound_context: contextFor('Respuesta real.') }, deliveryAction: 'send',
    })).resolves.toBe('recorded');
    // Retry of the same turn stays idempotent.
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: { last_outbound_context: contextFor('Respuesta real.') }, deliveryAction: 'send',
    })).resolves.toBe('recorded');
    const stored = await base.store.listMessages('run-gate', 'case-gate', 'conv#user');
    expect(stored).toHaveLength(1);
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: null, deliveryAction: 'send',
    })).rejects.toThrow('Harness error');
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: { last_outbound_context: contextFor('Respuesta real.', 'other-id') }, deliveryAction: 'send',
    })).rejects.toThrow('does not match invocation');
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: { last_outbound_context: contextFor('Respuesta real.', 'case-gate-0', true) }, deliveryAction: 'send',
    })).rejects.toThrow('truncated');
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: { last_outbound_context: contextFor('Texto distinto.') }, deliveryAction: 'send',
    })).rejects.toThrow('does not match the independently observed response hash');
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: { last_outbound_context: contextFor('Respuesta real.') }, deliveryAction: 'suppress',
    })).resolves.toBe('skipped_no_send');
    await expect(recordFixtureOutboundObservation({
      ...base, privatePlan: { last_outbound_context: contextFor('Respuesta real.') }, deliveryAction: 'send', phone: null,
    })).resolves.toBe('skipped_no_phone');
  });

  it('validates image-only silence from the private plan when the wire plan is redacted', async () => {
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');
    const { getPrivatePlanForEvidence } = await import('../src/evals/evaluation-state');
    const { validateImageOnlySilence } = await import('../src/evals/silence');
    const { collectOriginGateFailures } = await import('../src/evals/runner');
    const { createEmptyPlan, mergePlan } = await import('../src/core/plan');
    const { projectSafePlan } = await import('../src/runtime/artifact-redaction');
    const storageModule = await import('../src/storage/dynamo-plan-store');
    const setLivePlan = planStoreTestHooks(storageModule).setLivePlan;
    const caseId = 'live.image.silence.private';
    // O1 wire identity: the invocation message id carries the execution seed.
    const sentMessageId = `${caseId}-0-${buildExecutionIdentitySeed('live-dev-lambda', 'live-dev-lambda', caseId)}`;
    const secretToken = 'eyJhbGciOiJIUzI1NiJ9.image-silence-private.signature';
    const privatePlan = {
      ...mergePlan(
        createEmptyPlan({ planId: 'plan-image-silence', channel: 'terminal_whatsapp_eval', externalUserId: 'eval-user' }),
        { user_auth: { status: 'authenticated', token: secretToken, auth_method: 'phone' } },
      ),
      image_attachments: [{
        kind: 'file',
        fileId: 'file-image-silence-123',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        mimeType: 'image/jpeg',
        byteLength: 1234,
        contentDigest: 'a'.repeat(64),
        messageId: sentMessageId,
        receivedAt: new Date().toISOString(),
      }],
    };
    setLivePlan(privatePlan as unknown as Record<string, unknown>);
    // Real CLI responses carry the redacted public projection on the wire:
    // raw file IDs/URLs/digests omitted, last-response text scrubbed.
    const wirePlan = projectSafePlan(privatePlan as unknown as Parameters<typeof projectSafePlan>[0]);
    expect(wirePlan.image_attachments).toEqual([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      async json() {
        return {
          message: null,
          delivery: { action: 'suppress', reason: 'image_only_no_outstanding_task' },
          conversation_id: 'conv-image-silence',
          plan_id: 'plan-image-silence',
          current_node: 'contacto_inicial',
          trace: { ...fixtureTrace(0), plan_persist_reason: 'image_file_silence' },
          plan: wirePlan,
        };
      },
    }));
    try {
      const result = await runLiveLambdaCase({
        currentCase: {
          id: caseId,
          suite: 'live_behavior_regression',
          version: 1,
          description: 'Image-only silence with redacted wire plan.',
          imports: [],
          tags: [],
          priority: 'p1',
          status: 'active',
          targetModes: ['live_lambda'],
          variables: {},
          inputs: [{ text: '', image: { data: 'aGVsbG8=', mime_type: 'image/jpeg' } }],
          expectations: [],
          scorers: [],
          notes: [],
        },
        config: {
          label: 'live-dev-lambda',
          target: 'live_lambda',
          notes: [],
          environmentOverrides: {},
          liveLambda: { functionUrl: 'https://example.test/lambda', channel: 'terminal_whatsapp_eval' },
        },
        artifactDir: '.eval-runs-test',
      });
      expect(result.turns).toHaveLength(1);
      const turn = result.turns[0];
      expect(turn?.observedMessageId).toBe(sentMessageId);
      // Serialized turn carries the redacted public projection only.
      expect(turn?.plan.image_attachments).toEqual([]);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('file-image-silence-123');
      expect(serialized).not.toContain(secretToken);
      if (turn === undefined) throw new Error('Missing live image-silence turn.');
      // Private evidence keeps the typed active ref linked to this invocation.
      const evidence = getPrivatePlanForEvidence(turn);
      const refs = (evidence as unknown as { image_attachments?: unknown }).image_attachments;
      expect(Array.isArray(refs) && (refs as unknown[]).length).toBe(1);
      // Silence validates against the private snapshot, not the redacted wire.
      expect(validateImageOnlySilence(turn, {
        observedMessageId: turn?.observedMessageId ?? null,
        nowMs: Date.now(),
      }).exempt).toBe(true);
      expect(collectOriginGateFailures(result.turns)).toEqual([]);
    } finally {
      setLivePlan(null);
    }
  }, 15_000);

  it('threads config.run_id into the wire marker instead of the label fallback', async () => {
    const { runLiveLambdaCase } = await import('../src/evals/targets/live-lambda');
    const { InMemoryEvalFixtureStateStore } = await import('../src/runtime/eval-fixture-state');
    const { hashPrivateOutput } = await import('../src/audit/output-origin');
    const storageModule = await import('../src/storage/dynamo-plan-store');
    const setLivePlan = planStoreTestHooks(storageModule).setLivePlan;
    const { createEmptyPlan } = await import('../src/core/plan');
    const replyText = 'Respuesta con run id explicito.';
    const caseId = 'live.runid.threading';
    const runId = 'eval-2026-09-14-run-thread-01';
    // O1 wire identity: the invocation message id carries the execution seed.
    const sentMessageId = `${caseId}-0-${buildExecutionIdentitySeed(runId, 'live-dev-lambda', caseId)}`;
    setLivePlan({
      ...createEmptyPlan({ planId: 'plan-runid', channel: 'terminal_whatsapp_eval', externalUserId: 'eval-user' }),
      last_outbound_context: {
        message_id: sentMessageId,
        text: replyText,
        text_truncated: false,
        recorded_at: new Date().toISOString(),
        delivery_evidence: 'constructed' as const,
      },
    } as unknown as Record<string, unknown>);
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const bodyText = typeof init.body === 'string' ? init.body : await new Response(init.body).text();
      requestBodies.push(JSON.parse(bodyText) as Record<string, unknown>);
      return {
        ok: true,
        headers: new Headers(),
        async json() {
          return {
            message: replyText,
            message_original_sha256: hashPrivateOutput(replyText),
            delivery: { action: 'send', reason: 'model_reply' },
            conversation_id: 'conv-runid',
            plan_id: 'plan-runid',
            current_node: 'recomendar',
            trace: fixtureTrace(0),
          };
        },
      };
    }));
    try {
      const store = new InMemoryEvalFixtureStateStore();
      await runLiveLambdaCase({
        currentCase: {
          id: caseId,
          suite: 'live_behavior_regression',
          version: 1,
          description: 'Run id threading.',
          imports: [],
          tags: [],
          priority: 'p1',
          status: 'active',
          targetModes: ['live_lambda'],
          variables: {},
          inputs: [{ text: 'hola', contactPhone: '+51973296571' }],
          backendFixture: { scenario: 'image-clean-world' },
          expectations: [],
          scorers: [],
          notes: [],
        },
        config: {
          run_id: runId,
          label: 'live-dev-lambda',
          target: 'live_lambda',
          notes: [],
          environmentOverrides: {},
          liveLambda: { functionUrl: 'https://example.test/lambda', channel: 'terminal_whatsapp_eval' },
        },
        artifactDir: '.eval-runs-test',
        fixtureStore: store,
      });
      expect(requestBodies[0]?.backendFixture).toMatchObject({ runId, caseId });
      const sentUser = requestBodies[0]?.user_id as string;
      const stored = await store.listMessages(runId, caseId, `terminal_whatsapp_eval#${sentUser}`);
      expect(stored).toHaveLength(1);
      // The label fallback scope stays empty: effects are partitioned by run.
      expect(await store.listMessages('live-dev-lambda', caseId, `terminal_whatsapp_eval#${sentUser}`)).toHaveLength(0);
    } finally {
      setLivePlan(null);
    }
  }, 15_000);
});
