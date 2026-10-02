import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import { OpenAiMessageResponseClassifier } from '../src/runtime/message-response-classifier';
import { PromptLoader } from '../src/runtime/prompt-loader';

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

describe('OpenAiMessageResponseClassifier', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses Structured Outputs with bounded context, history window, and a suppression decision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'observe',
      promptLoader,
    });
    const response = await classifier.classify({
      inboundText: `${'inicio '.repeat(150)}${'final '.repeat(150)}`,
      plan: createEmptyPlan({
        planId: 'classifier-plan',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [
        {
          id: 1,
          direction: 'outbound',
          source: 'agent',
          body: 'x'.repeat(600),
          status: 'sent',
          sentAt: null,
          createdAt: null,
        },
      ],
      contextSource: 'agent_api',
    });

    expect(response.trace).toMatchObject({
      mode: 'observe',
      action: 'suppress_acknowledgement',
      would_suppress: true,
      context_source: 'agent_api',
      has_prior_outbound_message: true,
      fallback_used: false,
    });
    expect(response.tokenUsage).toMatchObject({ total_tokens: 17 });
    expect(response.openAiCall).toMatchObject({
      responseId: 'resp_test',
      requestId: 'req_test',
      model: 'gpt-5.6-luna',
      attemptCount: 1,
      requestMetrics: {
        toolCount: 0,
        schemaPropertyCount: 9,
        transport: {
          observedRequestCount: 1,
          requests: [{ stage: 'classifier', statusCode: 200, succeeded: true }],
        },
      },
    });
    const calls = fetchMock.mock.calls as unknown as Array<[
      string,
      { body?: unknown; signal?: AbortSignal },
    ]>;
    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    const request = JSON.parse(String(calls[0]?.[1]?.body)) as {
      model: string;
      store: boolean;
      max_output_tokens: number;
      prompt_cache_key: string;
      prompt_cache_options: { mode: string; ttl: string };
      reasoning: { effort: string };
      text: { format: { type: string }; verbosity: string };
      input: Array<{ content: string }>;
    };
    expect(request.text.format.type).toBe('json_schema');
    expect(request.text.verbosity).toBe('low');
    expect(request.reasoning.effort).toBe('low');
    expect(request.max_output_tokens).toBe(2048);
    expect(request.prompt_cache_key).toMatch(/^classifier:/u);
    expect(request.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(request.store).toBe(true);
    const classifierInput = JSON.parse(request.input[1]?.content ?? '{}') as {
      inbound_message: string;
      recent_messages: Array<{ body: string }>;
    };
    expect(classifierInput.inbound_message.length).toBeLessThanOrEqual(1_200);
    expect(classifierInput.recent_messages[0]?.body.length).toBeLessThanOrEqual(400);

    const windowMock = vi.fn().mockResolvedValue(responseForDecision({
      action: 'respond',
      reason: 'requires_response',
    }));
    vi.stubGlobal('fetch', windowMock);
    const windowClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    await windowClassifier.classify({
      inboundText: 'Necesito ayuda con mi evento.',
      plan: createEmptyPlan({
        planId: 'classifier-last-five',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: Array.from({ length: 7 }, (_, index) => ({
        id: index + 1,
        direction: index % 2 === 0 ? 'outbound' as const : 'inbound' as const,
        source: 'agent',
        body: `message-${index + 1}`,
        status: 'sent',
        sentAt: null,
        createdAt: null,
      })),
      contextSource: 'agent_api',
    });

    const windowCalls = windowMock.mock.calls as unknown as Array<[string, { body?: unknown }]>;
    const windowRequest = JSON.parse(String(windowCalls[0]?.[1]?.body)) as {
      input: Array<{ content: string }>;
    };
    const windowInput = JSON.parse(windowRequest.input[1]?.content ?? '{}') as {
      recent_messages: Array<{ body: string }>;
    };
    expect(windowInput.recent_messages.map((message) => message.body)).toEqual([
      'message-3',
      'message-4',
      'message-5',
      'message-6',
      'message-7',
    ]);
  });

  it('fails open with an explicit unavailable decision on unusable output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const response = await classifier.classify({
      inboundText: '¿Puedes ayudarme con catering?',
      plan: createEmptyPlan({
        planId: 'classifier-fallback',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'local_plan',
    });

    expect(response.trace).toMatchObject({
      action: 'respond',
      reason: 'classifier_unavailable',
      fallback_used: true,
      would_suppress: false,
    });
    expect(response.tokenUsage).toBeNull();

    // Enabled reasoning shares the output budget with the structured
    // schema: an incomplete response must stay an explicit failure path
    // (respond + classifier_unavailable), never a fabricated decision.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_incomplete',
      object: 'response',
      created_at: 1,
      status: 'incomplete',
      model: 'gpt-5.6-luna',
      output: [],
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        total_tokens: 17,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 5 },
      },
      incomplete_details: { reason: 'max_output_tokens' },
      parallel_tool_calls: true,
      store: true,
      temperature: 1,
      top_p: 1,
      truncation: 'disabled',
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_incomplete',
      },
    })));
    const incompleteClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const incomplete = await incompleteClassifier.classify({
      inboundText: 'Gracias',
      plan: createEmptyPlan({
        planId: 'classifier-incomplete',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'agent_api',
    });

    expect(incomplete.trace).toMatchObject({
      action: 'respond',
      reason: 'classifier_unavailable',
      fallback_used: true,
      would_suppress: false,
    });
    expect(incomplete.tokenUsage).toBeNull();
  });

  it('propagates permanent quota exhaustion with one HTTP request and no fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: 'You exceeded your current quota.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });

    await expect(classifier.classify({
      inboundText: 'Necesito ayuda.',
      plan: createEmptyPlan({
        planId: 'classifier-quota',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'local_plan',
    })).rejects.toMatchObject({
      status: 429,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient rate limit and respects a zero retry delay', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: 'Rate limited.',
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        },
      }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after-ms': '0',
        },
      }))
      .mockResolvedValueOnce(responseForDecision({
        action: 'respond',
        reason: 'requires_response',
      }));
    vi.stubGlobal('fetch', fetchMock);
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });

    const response = await classifier.classify({
      inboundText: 'Necesito ayuda.',
      plan: createEmptyPlan({
        planId: 'classifier-rate-limit',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'local_plan',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.trace.reason).toBe('requires_response');
    expect(response.openAiCall?.requestMetrics.transport?.observedRequestCount).toBe(2);
  });

  it('accepts high-confidence automated suppression with or without outbound context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_automated_response',
      reason: 'automated_response',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const response = await classifier.classify({
      inboundText: 'Bienvenido. Selecciona una opción del menú.',
      plan: createEmptyPlan({
        planId: 'classifier-invariant',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'agent_api',
    });

    expect(response.trace).toMatchObject({
      action: 'suppress_automated_response',
      reason: 'automated_response',
      automation_confidence: 'high',
      has_prior_outbound_message: false,
      fallback_used: false,
      would_suppress: true,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_automated_response',
      reason: 'automated_response',
    })));
    const contextualClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const contextual = await contextualClassifier.classify({
      inboundText: 'Gracias por comunicarte. Elige una opción para continuar.',
      plan: createEmptyPlan({
        planId: 'classifier-automated-response',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [{
        id: 1,
        direction: 'outbound',
        source: 'agent',
        body: 'Hola, ¿en qué podemos ayudarte?',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      }],
      contextSource: 'agent_api',
    });

    expect(contextual.trace).toMatchObject({
      action: 'suppress_automated_response',
      reason: 'automated_response',
      would_suppress: true,
      has_prior_outbound_message: true,
      fallback_used: false,
    });
  });

  it('honors model suppression decisions without outbound context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const ack = await classifier.classify({
      inboundText: 'Gracias',
      plan: createEmptyPlan({
        planId: 'classifier-contextual-acknowledgement',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'agent_api',
    });

    expect(ack.trace).toMatchObject({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
      has_prior_outbound_message: false,
      fallback_used: false,
      would_suppress: true,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_reaction',
      reason: 'reaction',
    })));
    const reactionClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const reaction = await reactionClassifier.classify({
      inboundText: '🤗🌷',
      plan: createEmptyPlan({
        planId: 'classifier-emoji-only-reaction',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'agent_api',
    });

    expect(reaction.trace).toMatchObject({
      action: 'suppress_reaction',
      reason: 'reaction',
      has_prior_outbound_message: false,
      fallback_used: false,
      would_suppress: true,
    });
  });

  it('forces replies while an RSVP decision or a human-help offer is pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const plan = createEmptyPlan({
      planId: 'classifier-rsvp-pending',
      channel: 'terminal_whatsapp',
      externalUserId: '51991347878',
    });
    plan.current_node = 'responder_invitacion';
    plan.rsvp_state = {
      status: 'awaiting_action',
      pending_action: null,
      candidates: [],
      requested_at: '2026-08-13T15:00:00.000Z',
      selection_attempts: 0,
    };

    const rsvp = await classifier.classify({
      inboundText: 'Sí, asistiré',
      plan,
      messages: [],
      contextSource: 'agent_api',
    });

    expect(rsvp.trace).toMatchObject({
      action: 'respond',
      would_suppress: false,
      fallback_used: true,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
      conversation_health: 'progressing',
      health_reason: 'normal_progress',
      human_help_response: 'decline',
    })));
    const helpClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const helpPlan = createEmptyPlan({
      planId: 'classifier-help-offer',
      channel: 'terminal_whatsapp',
      externalUserId: '51991347878',
    });
    helpPlan.conversation_health.help_offer_status = 'offered';

    const help = await helpClassifier.classify({
      inboundText: 'Prefiero continuar por aquí',
      plan: helpPlan,
      messages: [{
        id: 1,
        direction: 'outbound',
        source: 'agent',
        body: '¿Quieres que te pase con una persona del equipo?',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      }],
      contextSource: 'agent_api',
    });

    expect(help.trace).toMatchObject({
      action: 'respond',
      reason: 'help_offer_response_requires_reply',
      human_help_response: 'decline',
      fallback_used: true,
      would_suppress: false,
    });
  });

  it('instructs the model to preserve actionable RSVP decisions before RSVP state exists', () => {
    const prompt = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'prompts/nodes/deteccion_intencion/response_classifier.txt',
      ),
      'utf8',
    );

    expect(prompt).toContain(
      'cuando el estado aún sea `none`',
    );
    expect(prompt).toContain(
      'Debe pasar a extracción estructurada',
    );
    expect(prompt).toContain(
      'nunca la suprimas como simple acuse de recibo',
    );
  });

  it('forces actionable campaign replies through extraction from typed campaign evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
      campaign_reply_kind: 'rsvp_decision',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });

    const response = await classifier.classify({
      inboundText: 'Gracias, confirmo asistencia',
      plan: createEmptyPlan({
        planId: 'classifier-campaign-rsvp',
        channel: 'whatsapp',
        externalUserId: '51904523314',
      }),
      messages: [
        {
          id: 1,
          direction: 'outbound',
          source: 'admin_campaign',
          body: 'Este es un recordatorio del evento: Julisabeth y Andrés.',
          status: 'sent',
          sentAt: null,
          createdAt: null,
        },
      ],
      contextSource: 'agent_api',
    });

    expect(response.trace).toMatchObject({
      action: 'respond',
      reason: 'campaign_action_requires_extraction',
      classifier_profile: 'campaign_reply',
      campaign_reply_kind: 'rsvp_decision',
      would_suppress: false,
      fallback_used: true,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
      campaign_reply_kind: 'question_or_request',
    })));
    const questionClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const question = await questionClassifier.classify({
      inboundText: 'Gracias. ¿Cómo configuro el seguimiento?',
      plan: createEmptyPlan({
        planId: 'classifier-campaign-question',
        channel: 'whatsapp',
        externalUserId: '51995983277',
      }),
      messages: [{
        id: 1,
        direction: 'outbound',
        source: 'admin_campaign',
        body: 'Puedes agendar una llamada y configuramos el seguimiento contigo.',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      }],
      contextSource: 'agent_api',
    });

    expect(question.trace).toMatchObject({
      action: 'respond',
      reason: 'campaign_action_requires_extraction',
      campaign_reply_kind: 'question_or_request',
      would_suppress: false,
      fallback_used: true,
    });
  });

  it('suppresses the reported campaign decline without reopening the conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
      campaign_reply_kind: 'declines_campaign_offer',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });

    const response = await classifier.classify({
      inboundText: 'Gracias, no por ahora',
      plan: createEmptyPlan({
        planId: 'classifier-campaign-decline',
        channel: 'whatsapp',
        externalUserId: '51995983277',
      }),
      messages: [{
        id: 1,
        direction: 'outbound',
        source: 'admin_campaign',
        body: 'Vimos que activaste el Seguimiento de invitados por WhatsApp, pero aún no terminaste de configurarlo. Si prefieres que te ayudemos, puedes agendar una llamada con nuestro equipo.',
        status: 'sent',
        sentAt: '2026-08-22T00:00:40.000Z',
        createdAt: '2026-08-22T00:00:40.000Z',
      }],
      contextSource: 'agent_api',
    });

    expect(response.trace).toMatchObject({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
      classifier_profile: 'campaign_reply',
      campaign_reply_kind: 'declines_campaign_offer',
      would_suppress: true,
      fallback_used: false,
      prompt_file_paths: [
        'nodes/deteccion_intencion/response_classifier_campaign.txt',
      ],
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body?: unknown }]>;
    const request = JSON.parse(String(calls[0]?.[1]?.body)) as {
      input: Array<{ content: string }>;
    };
    const classifierInput = JSON.parse(request.input[1]?.content ?? '{}') as {
      campaign_message?: { source?: string; body?: string };
      plan_context?: unknown;
      recent_messages?: unknown;
    };
    expect(classifierInput.campaign_message).toMatchObject({
      source: 'admin_campaign',
    });
    expect(classifierInput.campaign_message?.body).toContain('Seguimiento de invitados');
    expect(classifierInput).not.toHaveProperty('plan_context');
    expect(classifierInput).not.toHaveProperty('recent_messages');
    expect(response.openAiCall?.requestMetrics.instructionBytes).toBeLessThan(4_000);
  });

  it('selects the campaign or general profile by newest campaign evidence', async () => {
    // A newer agent message over an older campaign uses the general profile.
    const generalFetch = vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
    }));
    vi.stubGlobal('fetch', generalFetch);
    const generalClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });

    const general = await generalClassifier.classify({
      inboundText: 'Gracias',
      plan: createEmptyPlan({
        planId: 'classifier-old-campaign',
        channel: 'whatsapp',
        externalUserId: '51995983277',
      }),
      messages: [
        {
          id: 1,
          direction: 'outbound',
          source: 'admin_campaign',
          body: 'Campaña anterior.',
          status: 'sent',
          sentAt: null,
          createdAt: null,
        },
        {
          id: 2,
          direction: 'outbound',
          source: 'agent',
          body: 'Ya actualicé tu información.',
          status: 'sent',
          sentAt: null,
          createdAt: null,
        },
      ],
      contextSource: 'agent_api',
    });

    expect(general.trace).toMatchObject({
      action: 'suppress_acknowledgement',
      classifier_profile: 'general',
      campaign_reply_kind: 'not_applicable',
      would_suppress: true,
      fallback_used: false,
    });
    expect(general.trace.prompt_file_paths).toEqual([
      'nodes/deteccion_intencion/response_classifier.txt',
    ]);

    // A later reminder refreshing the campaign keeps typed campaign classification.
    const campaignFetch = vi.fn().mockResolvedValue(responseForDecision({
      action: 'respond',
      reason: 'requires_response',
      campaign_reply_kind: 'rsvp_decision',
    }));
    vi.stubGlobal('fetch', campaignFetch);
    const campaignClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });

    const campaign = await campaignClassifier.classify({
      inboundText: 'Gracias, confirmo asistencia',
      plan: createEmptyPlan({
        planId: 'classifier-refreshed-campaign',
        channel: 'whatsapp',
        externalUserId: '51904523314',
      }),
      messages: [
        {
          id: 1,
          direction: 'outbound',
          source: 'admin_campaign',
          body: 'Invitación inicial al evento.',
          status: 'sent',
          sentAt: null,
          createdAt: null,
        },
        {
          id: 2,
          direction: 'outbound',
          source: 'agent',
          body: 'Mensaje anterior del agente.',
          status: 'sent',
          sentAt: null,
          createdAt: null,
        },
        {
          id: 3,
          direction: 'outbound',
          source: 'frontend_followup',
          body: 'Recordatorio actualizado de la invitación.',
          status: 'sent',
          sentAt: null,
          createdAt: null,
        },
      ],
      contextSource: 'agent_api',
    });

    expect(campaign.trace).toMatchObject({
      action: 'respond',
      classifier_profile: 'campaign_reply',
      campaign_reply_kind: 'rsvp_decision',
      would_suppress: false,
    });
    const calls = campaignFetch.mock.calls as unknown as Array<[string, { body?: unknown }]>;
    const request = JSON.parse(String(calls[0]?.[1]?.body)) as {
      input: Array<{ content: string }>;
    };
    const classifierInput = JSON.parse(request.input[1]?.content ?? '{}') as {
      campaign_message?: { source?: string; body?: string };
    };
    expect(classifierInput.campaign_message).toMatchObject({
      source: 'frontend_followup',
      body: 'Recordatorio actualizado de la invitación.',
    });
  });

  it('resolves automated suppression by confidence and sender scope', async () => {
    // High-confidence current-sender corporate reception normalizes to suppression.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'respond',
      reason: 'requires_response',
      automation_confidence: 'high',
      automation_pattern: 'generic_corporate_reception',
      automation_scope: 'current_sender',
    })));
    const receptionClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const reception = await receptionClassifier.classify({
      inboundText: 'Gracias por comunicarte con GoCleaning. ¿Cómo podemos ayudarte?',
      plan: createEmptyPlan({
        planId: 'classifier-generic-corporate-reception',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [{
        id: 1,
        direction: 'outbound',
        source: 'agent',
        body: 'Hola, quisiera consultar sus servicios de limpieza para un evento.',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      }],
      contextSource: 'agent_api',
    });

    expect(reception.trace).toMatchObject({
      action: 'suppress_automated_response',
      reason: 'automated_response',
      automation_confidence: 'high',
      automation_pattern: 'generic_corporate_reception',
      automation_scope: 'current_sender',
      fallback_used: true,
      would_suppress: true,
    });

    // Quoted or discussed automation stays a reply.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'respond',
      reason: 'requires_response',
      automation_confidence: 'high',
      automation_pattern: 'interactive_menu',
      automation_scope: 'quoted_or_discussed',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const quoted = await classifier.classify({
      inboundText: 'Me enviaron el menú del proveedor. ¿Qué opción elijo?',
      plan: createEmptyPlan({
        planId: 'classifier-quoted-automation',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'agent_api',
    });

    expect(quoted.trace).toMatchObject({
      action: 'respond',
      automation_confidence: 'high',
      automation_pattern: 'interactive_menu',
      automation_scope: 'quoted_or_discussed',
      fallback_used: false,
      would_suppress: false,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_automated_response',
      reason: 'automated_response',
      automation_confidence: 'uncertain',
    })));
    const uncertainClassifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      mode: 'enforce',
      promptLoader,
    });
    const uncertain = await uncertainClassifier.classify({
      inboundText: 'Gracias por escribir. En breve te respondemos.',
      plan: createEmptyPlan({
        planId: 'classifier-automation-confidence',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [{
        id: 1,
        direction: 'outbound',
        source: 'agent',
        body: 'Hola, quisiera información.',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      }],
      contextSource: 'agent_api',
    });

    expect(uncertain.trace).toMatchObject({
      action: 'respond',
      reason: 'automation_confidence_insufficient',
      automation_confidence: 'uncertain',
      fallback_used: true,
      would_suppress: false,
    });
  });

  it('keeps the labelled corpus balanced for automated responses and lookalikes', () => {
    const corpusPath = path.resolve(
      process.cwd(),
      'evals/classifiers/reply-suppression-seed.jsonl',
    );
    const records = fs.readFileSync(corpusPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    const labels = records.map((record) => {
      if (!record || typeof record !== 'object' || !('label' in record)) {
        throw new Error('Classifier corpus record is missing label.');
      }
      return (record as { label: unknown }).label;
    });

    expect(
      labels.filter((label) => label === 'suppress_automated_response').length,
    ).toBeGreaterThanOrEqual(13);
    expect(labels.filter((label) => label === 'respond').length).toBeGreaterThanOrEqual(12);
  });
});

function responseForDecision(decision: {
  action:
    | 'respond'
    | 'suppress_acknowledgement'
    | 'suppress_reaction'
    | 'suppress_automated_response';
  reason: 'requires_response' | 'acknowledgement' | 'reaction' | 'automated_response';
  conversation_health?: 'progressing' | 'uncertain' | 'stalled' | 'frustrated';
  health_reason?: 'normal_progress' | 'repeated_question' | 'repeated_correction' | 'unresolved_error' | 'circular_conversation' | 'explicit_frustration' | 'insufficient_context';
  human_help_response?: 'not_applicable' | 'accept' | 'decline' | 'unclear';
  automation_confidence?: 'not_automated' | 'uncertain' | 'high';
  automation_pattern?:
    | 'none'
    | 'generic_corporate_reception'
    | 'interactive_menu'
    | 'away_or_hours_notice'
    | 'routing_or_queue'
    | 'automated_confirmation'
    | 'repeated_template'
    | 'explicit_virtual_assistant';
  automation_scope?: 'current_sender' | 'quoted_or_discussed' | 'none_or_uncertain';
  campaign_reply_kind?:
    | 'not_applicable'
    | 'rsvp_decision'
    | 'declines_campaign_offer'
    | 'acknowledgement_only'
    | 'reaction_only'
    | 'question_or_request'
    | 'other_actionable'
    | 'unclear';
}): Response {
  const completeDecision = {
    conversation_health: 'progressing',
    health_reason: 'normal_progress',
    human_help_response: 'not_applicable',
    automation_confidence: decision.action === 'suppress_automated_response'
      ? 'high'
      : 'not_automated',
    automation_pattern: decision.action === 'suppress_automated_response'
      ? 'interactive_menu'
      : 'none',
    automation_scope: decision.action === 'suppress_automated_response'
      ? 'current_sender'
      : 'none_or_uncertain',
    campaign_reply_kind: 'not_applicable',
    ...decision,
  };
  return new Response(JSON.stringify({
    id: 'resp_test',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [
      {
        id: 'msg_test',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify(completeDecision),
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 12,
      output_tokens: 5,
      total_tokens: 17,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    parallel_tool_calls: true,
    store: true,
    temperature: 1,
    top_p: 1,
    truncation: 'disabled',
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_test',
    },
  });
}
