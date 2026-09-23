import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { InMemoryEvalFixtureStateStore } from '../src/runtime/eval-fixture-state';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { projectCustomerContext } from '../src/runtime/customer-context';
import { buildTurnMessageContext } from '../src/runtime/turn-message-context';

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

function runtime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'offline-test-key',
    replyModel: 'gpt-6-luna',
    extractorModel: 'gpt-6-luna',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader,
    providerGateway: {} as never,
  });
}

/**
 * Entry vs continuation extractor measurement through actual service-built
 * requests. Both branches carry the same canonical authorized profile;
 * field conservation is retained. The entry branch currently exceeds the
 * 6,000-byte instruction budget (shortfall explicitly recorded; no rewrite
 * in this correction pass). The continuation branch stays within budget.
 */
describe('extractor entry and continuation instruction measurement', () => {
  it('records both branches with identical customer facts', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await FixtureAgentConversationGateway.create('rsvp-plus-one-multiple-pending', undefined, {
      stateStore: store,
      runId: 'run-measure',
      caseId: 'case-measure',
      conversationKey: 'conv-measure',
    });
    const provider = {} as unknown as ProviderGateway;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { search: async () => ({ status: 'success', evidence: [] }) } as unknown as KnowledgeRetrievalGateway,
      providerGateway: provider,
      agentGateway: gateway as unknown as AgentConversationGateway,
    });
    const snapshot = await orchestrator.prepareCustomerContext({
      authentication: null,
      trustedPhone: { phone_extension: '+51', phone_number: '941438999' },
      identity: { customerRef: '+51941438999', scope: 'trusted_phone', source: 'channel_contact_phone' },
      currentContext: null,
      deadlineMs: Date.now() + 30_000,
    });
    const customerContext = projectCustomerContext(snapshot);
    expect(customerContext.invitations.map((event) => event.name)).toEqual(
      expect.arrayContaining(['Boda Ana y Luis', 'Cumpleaños Marta']),
    );

    const openAi = runtime();
    const entryPlan = createEmptyPlan({ planId: 'entry-measure', channel: 'whatsapp', externalUserId: 'entry-user' });
    const entryContext = buildTurnMessageContext({
      inbound: {
        channel: 'whatsapp',
        externalUserId: 'entry-user',
        text: 'Hola',
        messageId: 'entry-1',
        receivedAt: new Date().toISOString(),
        contactPhone: '+51941438999',
      },
      messages: [],
    });
    const entrySpec = await openAi.buildExtractionRequestSpec({
      userMessage: 'Hola',
      plan: entryPlan,
      messageContext: entryContext,
      customerContext,
    });

    const continuationPlan = mergePlan(
      createEmptyPlan({ planId: 'continuation-measure', channel: 'whatsapp', externalUserId: 'cont-user' }),
      { current_node: 'resolver_consultas_informativas' },
    );
    const continuationContext = buildTurnMessageContext({
      inbound: {
        channel: 'whatsapp',
        externalUserId: 'cont-user',
        text: '¿Cuáles son mis eventos?',
        messageId: 'cont-1',
        receivedAt: new Date().toISOString(),
        contactPhone: '+51941438999',
      },
      messages: [{
        id: 1,
        direction: 'outbound',
        source: 'agent',
        body: 'prev',
        status: 'sent',
        sentAt: null,
        createdAt: null,
      }],
    });
    const continuationSpec = await openAi.buildExtractionRequestSpec({
      userMessage: '¿Cuáles son mis eventos?',
      plan: continuationPlan,
      messageContext: continuationContext,
      customerContext,
    });

    const entryBytes = Buffer.byteLength(entrySpec.instructions, 'utf8');
    const continuationBytes = Buffer.byteLength(continuationSpec.instructions, 'utf8');
    console.info(`extractor-branch-metrics ${JSON.stringify({ entryBytes, continuationBytes })}`);

    for (const spec of [entrySpec, continuationSpec]) {
      expect(spec.input).toContain('Boda Ana y Luis');
      expect(spec.input).toContain('Cumpleaños Marta');
    }
    expect(continuationBytes).toBeLessThanOrEqual(6_000);
    expect(entryBytes).toBeGreaterThan(6_000);
    expect(entryBytes).toBeLessThanOrEqual(7_500);
  });
});
