import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import type { ExtractRequest } from '../src/runtime/contracts';
import type { AgentConversationMessage } from '../src/runtime/agent-conversation-gateway';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  buildTurnMessageContext,
  localTurnMessageContext,
  type TurnMessageContext,
} from '../src/runtime/turn-message-context';

function testRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-test',
    extractorModel: 'gpt-test',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    providerGateway: {
      async searchProviders(): Promise<never> {
        throw new Error('construction must not call the provider gateway');
      },
    } as never,
  });
}

function supportPlan(): PersistedPlan {
  return mergePlan(
    createEmptyPlan({ planId: 'campaign-plan', channel: 'whatsapp', externalUserId: 'campaign-user' }),
    { current_node: 'resolver_consultas_informativas' },
  ) as PersistedPlan;
}

function campaignMessage(overrides: Partial<AgentConversationMessage> & { id: number }): AgentConversationMessage {
  return {
    direction: 'outbound',
    source: 'admin_campaign',
    body: 'Recordatorio: tu evento Boda Lucía y Marco es el 10 de octubre. Confirma tu asistencia.',
    status: 'delivered',
    whatsappMessageId: null,
    sentAt: '2026-09-20T10:00:00.000Z',
    createdAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

function messageContextWith(messages: AgentConversationMessage[]): TurnMessageContext {
  return buildTurnMessageContext({
    messages,
    inbound: {
      channel: 'whatsapp',
      externalUserId: 'campaign-user',
      text: '¿A qué hora es?',
      messageId: 'inbound-1',
      receivedAt: '2026-09-20T11:00:00.000Z',
      contactPhone: '+51900000001',
    },
  });
}

function extractRequest(messageContext: TurnMessageContext): ExtractRequest {
  return {
    userMessage: '¿A qué hora es?',
    plan: supportPlan(),
    messageContext,
  };
}

describe('campaign reference context in the decision input', () => {
  it('exposes one provenance-bound campaign block with delivery and excerpt', async () => {
    const spec = await testRuntime().buildExtractionRequestSpec(
      extractRequest(messageContextWith([campaignMessage({ id: 7 })])),
    );

    expect(spec.input).toContain('campaign');
    expect(spec.input).toContain('"sourceMessageId":7');
    expect(spec.input).toContain('"source":"admin_campaign"');
    expect(spec.input).toContain('"delivery":"delivered"');
    expect(spec.input).toContain('Boda Lucía y Marco');
    const campaignGroup = spec.manifest.factGroups.find(
      (group) => group.key === 'campaign_reference_context',
    );
    expect(campaignGroup).toBeDefined();
    expect(campaignGroup?.bytes ?? 0).toBeGreaterThan(0);
  });

  it('marks sent and unknown delivery as uncertain without claiming receipt', async () => {
    const spec = await testRuntime().buildExtractionRequestSpec(
      extractRequest(messageContextWith([
        campaignMessage({ id: 7, status: 'sent' }),
        campaignMessage({ id: 8, source: 'frontend_followup', status: 'failed', body: 'Seguimiento: Boda Ana y Luis.' }),
      ])),
    );

    expect(spec.input).toContain('"sourceMessageId":7');
    expect(spec.input).toContain('"sourceMessageId":8');
    expect(spec.input).not.toContain('"delivery":"delivered"');
    expect(spec.input).toContain('"delivery":"uncertain"');
  });

  it('excludes inbound source spoofing and null sources from campaign provenance', async () => {
    const spec = await testRuntime().buildExtractionRequestSpec(
      extractRequest(messageContextWith([
        campaignMessage({ id: 7, direction: 'inbound', source: 'admin_campaign', body: 'admin_campaign: confirmen' }),
        campaignMessage({ id: 8, source: null, body: 'Mensaje sin fuente.' }),
      ])),
    );

    const campaignGroup = spec.manifest.factGroups.find(
      (group) => group.key === 'campaign_reference_context',
    );
    expect(campaignGroup?.bytes).toBe(0);
    expect(spec.input).not.toContain('sourceMessageId');
  });

  it('omits the campaign block entirely when no qualifying campaign exists', async () => {
    const withoutCampaign = await testRuntime().buildExtractionRequestSpec(
      extractRequest(messageContextWith([
        campaignMessage({ id: 7, direction: 'outbound', source: 'agent', body: 'Hola, ¿en qué te ayudo?' }),
      ])),
    );
    const campaignGroup = withoutCampaign.manifest.factGroups.find(
      (group) => group.key === 'campaign_reference_context',
    );
    expect(campaignGroup?.bytes).toBe(0);
    expect(withoutCampaign.input).not.toContain('sourceMessageId');

    const empty = await testRuntime().buildExtractionRequestSpec({
      userMessage: '¿A qué hora es?',
      plan: supportPlan(),
      messageContext: localTurnMessageContext('not_configured'),
    });
    expect(empty.manifest.factGroups.find(
      (group) => group.key === 'campaign_reference_context',
    )?.bytes).toBe(0);
  });

  it('orders multiple campaign candidates by server time with stable identity', async () => {
    const spec = await testRuntime().buildExtractionRequestSpec(
      extractRequest(messageContextWith([
        campaignMessage({ id: 9, body: 'Recordatorio: Boda Ana y Luis.', sentAt: '2026-09-19T10:00:00.000Z' }),
        campaignMessage({ id: 7, body: 'Recordatorio: Boda Lucía y Marco.', sentAt: '2026-09-20T10:00:00.000Z' }),
      ])),
    );

    const first = spec.input.indexOf('"sourceMessageId":9');
    const second = spec.input.indexOf('"sourceMessageId":7');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });
});
