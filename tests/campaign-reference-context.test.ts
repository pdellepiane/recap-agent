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

function ordinaryMessage(id: number, sentAt: string): AgentConversationMessage {
  return {
    id,
    direction: 'outbound',
    source: 'agent',
    body: `Respuesta ordinaria ${id}.`,
    status: 'delivered',
    whatsappMessageId: null,
    sentAt,
    createdAt: sentAt,
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

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('campaign reference context in the decision input', () => {
  it('references an in-window campaign by ID with a null excerpt instead of duplicating prose', async () => {
    const spec = await testRuntime().buildExtractionRequestSpec(
      extractRequest(messageContextWith([campaignMessage({ id: 7 })])),
    );

    expect(spec.input).toContain('"sourceMessageId":7');
    expect(spec.input).toContain('"source":"admin_campaign"');
    expect(spec.input).toContain('"delivery":"delivered"');
    expect(spec.input).toContain('"bodyExcerpt":null');
    // The history entry carries the join keys plus the single body copy.
    expect(spec.input).toContain('"message_id":7');
    expect(spec.input).toContain('Boda Lucía y Marco');
    const campaignGroup = spec.manifest.factGroups.find(
      (group) => group.key === 'campaign_reference_context',
    );
    expect(campaignGroup).toBeDefined();
    expect(campaignGroup?.bytes ?? 0).toBeGreaterThan(0);
  });

  it('serializes each in-window campaign body exactly once across history and projection', async () => {
    const spec = await testRuntime().buildExtractionRequestSpec(
      extractRequest(messageContextWith([
        campaignMessage({ id: 7, body: 'Recordatorio alfa: Boda Lucía y Marco, 10 de octubre.' }),
        campaignMessage({ id: 8, source: 'frontend_followup', body: 'Seguimiento beta: Boda Ana y Luis, 5 de noviembre.', sentAt: '2026-09-20T10:05:00.000Z' }),
        // A newer ordinary message takes the prior-answer gist slot so the
        // count below isolates history-plus-projection duplication.
        ordinaryMessage(9, '2026-09-20T10:06:00.000Z'),
      ])),
    );

    expect(countOccurrences(spec.input, 'Recordatorio alfa: Boda Lucía y Marco, 10 de octubre.')).toBe(1);
    expect(countOccurrences(spec.input, 'Seguimiento beta: Boda Ana y Luis, 5 de noviembre.')).toBe(1);
    expect(countOccurrences(spec.input, '"bodyExcerpt":null')).toBe(2);
  });

  it('repeats an excerpt only for campaigns outside the selected history window', async () => {
    const { buildCampaignReferenceProjection } = await import('../src/runtime/turn-message-context');
    const old = campaignMessage({
      id: 1,
      body: 'Recordatorio antiguo fuera de ventana: Boda Petra y Pablo.',
      sentAt: '2026-09-10T10:00:00.000Z',
      createdAt: '2026-09-10T10:00:00.000Z',
    });
    const recent = [2, 3, 4, 5, 6, 7].map((id) =>
      ordinaryMessage(id, `2026-09-20T10:0${id - 2}:00.000Z`),
    );
    const inWindow = campaignMessage({
      id: 8,
      body: 'Recordatorio en ventana: Boda Lucía y Marco.',
      sentAt: '2026-09-20T10:06:00.000Z',
      createdAt: '2026-09-20T10:06:00.000Z',
    });
    // Direct projection over eight messages: the six-turn history window
    // covers id 8 but not id 1.
    const projection = buildCampaignReferenceProjection([old, ...recent, inWindow]);
    expect(projection).toHaveLength(2);
    const missed = projection.find((entry) => entry.sourceMessageId === 1);
    const covered = projection.find((entry) => entry.sourceMessageId === 8);
    expect(missed?.bodyExcerpt).toBe('Recordatorio antiguo fuera de ventana: Boda Petra y Pablo.');
    expect(covered?.bodyExcerpt).toBeNull();
    expect(covered?.delivery).toBe('delivered');
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
    expect(spec.input).not.toContain('message_id');
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

describe('source discovery explicit event retention', () => {
  // Row 4 (extractor-input part): a purchase question naming an older event
  // keeps the explicit name and the campaign reference context in the
  // extractor input, so the model can resolve the reference.
  it('keeps the explicit older event name alongside campaign context', async () => {
    const inboundText = 'Consulta por Aniversario Lucia. ¿Ese pedido sigue pendiente?';
    const messageContext = buildTurnMessageContext({
      messages: [
        {
          id: 7,
          direction: 'outbound',
          source: 'admin_campaign',
          body: 'Recordatorio: tu evento Boda Lucía y Marco es el 10 de octubre. Confirma tu asistencia.',
          status: 'delivered',
          whatsappMessageId: null,
          sentAt: '2026-09-20T10:00:00.000Z',
          createdAt: '2026-09-20T10:00:00.000Z',
        },
      ],
      inbound: {
        channel: 'whatsapp',
        externalUserId: 'campaign-user',
        text: inboundText,
        messageId: 'inbound-discovery-1',
        receivedAt: '2026-09-20T11:00:00.000Z',
        contactPhone: '+51900000001',
      },
    });
    const spec = await testRuntime().buildExtractionRequestSpec({
      userMessage: inboundText,
      plan: supportPlan(),
      messageContext,
    });

    expect(spec.input).toContain('Aniversario Lucia');
    expect(spec.input).toContain('admin_campaign');
  });
});

describe('reply evidence planning recognition and topic-switch (Lane B)', () => {
  it('keeps compact planning recognition on transient turns without customer-writing style', async () => {
    const { createEmptyPlan } = await import('../src/core/plan');
    const plan = createEmptyPlan({ planId: 'campaign-new', channel: 'whatsapp', externalUserId: 'campaign-user' });
    const spec = await testRuntime().buildExtractionRequestSpec({
      userMessage: 'Quiero planear mi boda para 100 personas.',
      plan,
      messageContext: localTurnMessageContext('not_configured'),
    });
    // Genuine planning stays recognized on a new turn.
    expect(spec.filePaths).toContain('extractors/planning.txt');
    expect(spec.filePaths).toContain('extractors/base_system.txt');
    // Detail modules wait for typed planning progress.
    expect(spec.filePaths).not.toContain('extractors/provider_management.txt');
    expect(spec.filePaths).not.toContain('extractors/contact.txt');
    expect(spec.filePaths).not.toContain('extractors/close_pause.txt');
    // Extraction emits JSON: customer persona, stylistic examples and
    // conversational anti-patterns never travel on extraction bundles.
    expect(spec.filePaths).not.toContain('shared/agent_personality.txt');
    expect(spec.filePaths).not.toContain('shared/output_style.txt');
    expect(spec.filePaths).not.toContain('shared/common_anti_patterns.txt');
    expect(spec.filePaths).not.toContain('shared/base_system.txt');
  });

  it('established support extraction keeps cross-domain readability without locking topic switches', async () => {
    const spec = await testRuntime().buildExtractionRequestSpec({
      userMessage: 'Confirmo mi asistencia y quiero saber el saldo.',
      plan: supportPlan(),
      messageContext: localTurnMessageContext('not_configured'),
    });
    // A new RSVP or planning request inside a support session still
    // extracts: the lane never locks against topic changes.
    expect(spec.filePaths).toContain('extractors/information.txt');
    expect(spec.filePaths).toContain('extractors/rsvp.txt');
    expect(spec.filePaths).not.toContain('extractors/planning.txt');
    expect(spec.filePaths).not.toContain('extractors/provider_management.txt');
  });
});
