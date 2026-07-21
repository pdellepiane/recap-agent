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

  it('uses Structured Outputs, bounded context, and a suppression decision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
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
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body?: unknown }]>;
    const request = JSON.parse(String(calls[0]?.[1]?.body)) as {
      text: { format: { type: string } };
      input: Array<{ content: string }>;
    };
    expect(request.text.format.type).toBe('json_schema');
    const classifierInput = JSON.parse(request.input[1]?.content ?? '{}') as {
      inbound_message: string;
      recent_messages: Array<{ body: string }>;
    };
    expect(classifierInput.inbound_message.length).toBeLessThanOrEqual(1_200);
    expect(classifierInput.recent_messages[0]?.body.length).toBeLessThanOrEqual(400);
  });

  it('fails open when the API response cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
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
  });

  it('accepts high-confidence automated suppression without outbound context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_automated_response',
      reason: 'automated_response',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
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
  });

  it('still requires outbound context for acknowledgement suppression', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
      mode: 'enforce',
      promptLoader,
    });
    const response = await classifier.classify({
      inboundText: 'Gracias',
      plan: createEmptyPlan({
        planId: 'classifier-contextual-acknowledgement',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'agent_api',
    });

    expect(response.trace).toMatchObject({
      action: 'respond',
      reason: 'missing_outbound_context',
      has_prior_outbound_message: false,
      fallback_used: true,
      would_suppress: false,
    });
  });

  it('normalizes high-confidence current-sender corporate reception evidence to suppression', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'respond',
      reason: 'requires_response',
      automation_confidence: 'high',
      automation_pattern: 'generic_corporate_reception',
      automation_scope: 'current_sender',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
      mode: 'enforce',
      promptLoader,
    });
    const response = await classifier.classify({
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

    expect(response.trace).toMatchObject({
      action: 'suppress_automated_response',
      reason: 'automated_response',
      automation_confidence: 'high',
      automation_pattern: 'generic_corporate_reception',
      automation_scope: 'current_sender',
      fallback_used: true,
      would_suppress: true,
    });
  });

  it('does not suppress high-confidence automation quoted by a human', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'respond',
      reason: 'requires_response',
      automation_confidence: 'high',
      automation_pattern: 'interactive_menu',
      automation_scope: 'quoted_or_discussed',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
      mode: 'enforce',
      promptLoader,
    });
    const response = await classifier.classify({
      inboundText: 'Me enviaron el menú del proveedor. ¿Qué opción elijo?',
      plan: createEmptyPlan({
        planId: 'classifier-quoted-automation',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'agent_api',
    });

    expect(response.trace).toMatchObject({
      action: 'respond',
      automation_confidence: 'high',
      automation_pattern: 'interactive_menu',
      automation_scope: 'quoted_or_discussed',
      fallback_used: false,
      would_suppress: false,
    });
  });

  it('rejects automated suppression without explicit high confidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_automated_response',
      reason: 'automated_response',
      automation_confidence: 'uncertain',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
      mode: 'enforce',
      promptLoader,
    });
    const response = await classifier.classify({
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

    expect(response.trace).toMatchObject({
      action: 'respond',
      reason: 'automation_confidence_insufficient',
      automation_confidence: 'uncertain',
      fallback_used: true,
      would_suppress: false,
    });
  });

  it('accepts a high-confidence automated-response suppression with outbound context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_automated_response',
      reason: 'automated_response',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
      mode: 'enforce',
      promptLoader,
    });
    const response = await classifier.classify({
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

    expect(response.trace).toMatchObject({
      action: 'suppress_automated_response',
      reason: 'automated_response',
      would_suppress: true,
      has_prior_outbound_message: true,
      fallback_used: false,
    });
  });

  it('passes only the latest five history messages to the model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseForDecision({
      action: 'respond',
      reason: 'requires_response',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
      mode: 'enforce',
      promptLoader,
    });
    await classifier.classify({
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

    const calls = fetchMock.mock.calls as unknown as Array<[string, { body?: unknown }]>;
    const request = JSON.parse(String(calls[0]?.[1]?.body)) as {
      input: Array<{ content: string }>;
    };
    const classifierInput = JSON.parse(request.input[1]?.content ?? '{}') as {
      recent_messages: Array<{ body: string }>;
    };
    expect(classifierInput.recent_messages.map((message) => message.body)).toEqual([
      'message-3',
      'message-4',
      'message-5',
      'message-6',
      'message-7',
    ]);
  });

  it('forces a reply while a human-help offer is awaiting an answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_acknowledgement',
      reason: 'acknowledgement',
      conversation_health: 'progressing',
      health_reason: 'normal_progress',
      human_help_response: 'decline',
    })));
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-5.4-nano',
      mode: 'enforce',
      promptLoader,
    });
    const plan = createEmptyPlan({
      planId: 'classifier-help-offer',
      channel: 'terminal_whatsapp',
      externalUserId: '51991347878',
    });
    plan.conversation_health.help_offer_status = 'offered';

    const response = await classifier.classify({
      inboundText: 'Prefiero continuar por aquí',
      plan,
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

    expect(response.trace).toMatchObject({
      action: 'respond',
      reason: 'help_offer_response_requires_reply',
      human_help_response: 'decline',
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
    ...decision,
  };
  return new Response(JSON.stringify({
    id: 'resp_test',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-5.4-nano',
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
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    parallel_tool_calls: true,
    store: true,
    temperature: 1,
    top_p: 1,
    truncation: 'disabled',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
