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

  it('rejects a suppression result when no outbound context exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseForDecision({
      action: 'suppress_reaction',
      reason: 'reaction',
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
        planId: 'classifier-invariant',
        channel: 'terminal_whatsapp',
        externalUserId: '51991347878',
      }),
      messages: [],
      contextSource: 'local_plan',
    });

    expect(response.trace).toMatchObject({
      action: 'respond',
      reason: 'missing_outbound_context',
      fallback_used: true,
      would_suppress: false,
    });
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
});

function responseForDecision(decision: {
  action: 'respond' | 'suppress_acknowledgement' | 'suppress_reaction';
  reason: 'requires_response' | 'acknowledgement' | 'reaction';
  conversation_health?: 'progressing' | 'uncertain' | 'stalled' | 'frustrated';
  health_reason?: 'normal_progress' | 'repeated_question' | 'repeated_correction' | 'unresolved_error' | 'circular_conversation' | 'explicit_frustration' | 'insufficient_context';
  human_help_response?: 'not_applicable' | 'accept' | 'decline' | 'unclear';
}): Response {
  const completeDecision = {
    conversation_health: 'progressing',
    health_reason: 'normal_progress',
    human_help_response: 'not_applicable',
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
