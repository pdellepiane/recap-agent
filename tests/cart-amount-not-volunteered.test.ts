import { describe, expect, it } from 'vitest';

import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';

describe('cart amount not volunteered', () => {
  it('information orchestrator does not expose cart subtotal via amountDisclosure', async () => {
    const fakeGateway: AgentConversationGateway = {
      logMessage: async () => ({ status: 'skipped', reason: 'disabled', message: 'disabled' }),
      getRecentMessages: async () => ({ status: 'skipped', reason: 'disabled', message: 'disabled' }),
      requestHumanTakeover: async () => ({ status: 'skipped', reason: 'disabled', message: 'disabled' }),
      authByPhone: async () => ({ status: 'failed', error: 'not configured', retryable: false }),
      updatePhone: async () => ({ status: 'success' }),
      getGuestOrdersByPhone: async () => ({
        status: 'success',
        resource: 'orders',
        purchases: [],
        carts: [
          {
            cartId: 'cart-sonia-001',
            status: 'abandoned',
            wasAbandoned: true,
            eventId: 5001,
            eventName: 'Carlos and Adriana',
            eventDate: '2026-09-25',
            subtotal: 150,
            giftsQuantity: 2,
            items: [],
            createdAt: '2026-08-26 18:00:00',
          },
        ],
        orderPartitions: { pending: [], completed: [] },
      }),
    } as unknown as AgentConversationGateway;

    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: {
        async search() {
          return { status: 'failed', reason: 'not_configured', retryable: false, error: 'not configured' };
        },
      },
      providerGateway: {} as ProviderGateway,
      agentGateway: fakeGateway,
    });

    const execution = await orchestrator.execute({
      requests: [
        {
          requestId: 'information-1',
          kind: 'purchase',
          resource: 'orders',
          query: 'Tengo un carrito abandonado de Carlos y Adriana. Quiero saber si puedo pagar por transferencia.',
          orderId: null,
          aspects: ['summary'],
          sensitiveFields: [],
          authAction: 'none',
        },
      ],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '965765765' },
    });

    const result = execution.results[0];
    expect(result.status).toBe('completed');
    if (result.status === 'completed' && result.kind === 'purchase') {
      expect(result.carts).toBeDefined();
      const cart = result.carts?.[0];
      expect(cart).toBeDefined();
      // amountDisclosure must be null so the reply model never receives 150
      expect(cart?.amountDisclosure).toBeNull();
      expect(cart?.subtotal).toBeNull();
      // ensure no amountDisclosure with total 150 leaks
      expect(JSON.stringify(result)).not.toContain('150');
    }
  });

  it('openai projection does not emit cart amount when amountDisclosure is null', async () => {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test',
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
      replyProviderLimit: 5,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 5,
      promptLoader: {
        loadExtractorBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
        loadNodeBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
      } as never,
      providerGateway: {} as never,
    });

    // Access private projector via any
    const projector = (runtime as unknown as { projectInformationResultForReply: (r: unknown) => unknown }).projectInformationResultForReply.bind(runtime);
    const result = projector({
      requestId: 'information-1',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [],
      carts: [
        {
          cartId: 'cart-sonia-001',
          status: 'abandoned',
          wasAbandoned: true,
          eventId: 5001,
          eventName: 'Carlos and Adriana',
          eventDate: '2026-09-25',
          subtotal: null,
          amountDisclosure: null,
          giftsQuantity: 2,
          createdAt: '2026-08-26 18:00:00',
          items: [],
        },
      ],
      needsSelection: false,
      coverage: 'partial',
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('150');
    expect(serialized).not.toContain('subtotal');
    // amountDisclosure should be null or absent, never 150
    const carts = (result as { carts?: Array<{ amountDisclosure?: unknown }> }).carts;
    expect(carts?.[0]?.amountDisclosure).toBeNull();
  });
});
