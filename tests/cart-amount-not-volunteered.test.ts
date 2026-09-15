import { describe, expect, it } from 'vitest';

import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { projectCompletedPurchaseForModel } from '../src/runtime/purchase-reply-projector';

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
    const result = projectCompletedPurchaseForModel({
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
    } as never, { requestedAspects: ['summary'] });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('150');
    expect(serialized).not.toContain('subtotal');
    // amountDisclosure should be null or absent, never 150
    expect(serialized).toContain('"outcome_kind":"cart_only"');
  });

  it('cart-only reply projection omits giftsQuantity and gift-count fact', async () => {
    const projected = projectCompletedPurchaseForModel({
      requestId: 'cart-only', kind: 'purchase', status: 'completed', resource: 'orders',
      purchases: [],
      carts: [{
      cartId: 'cart-sonia-001',
      status: 'abandoned',
      wasAbandoned: true,
      eventId: 5001,
      eventName: 'Carlos and Adriana',
      eventDate: '2026-09-25',
      subtotal: 150,
      amountDisclosure: null,
      giftsQuantity: 2,
      gifts_quantity: 2,
      createdAt: '2026-08-26 18:00:00',
      }],
      needsSelection: false, coverage: 'partial', referenceResolution: 'not_requested',
    } as never, { requestedAspects: ['summary'] });
    expect(JSON.stringify(projected)).not.toContain('giftsQuantity');
    expect(JSON.stringify(projected)).not.toContain('gifts_quantity');
    expect(JSON.stringify(projected)).not.toContain('2 regalos');
    expect(JSON.stringify(projected).toLowerCase()).not.toContain('regalo');
    expect(projected).toMatchObject({ outcome_kind: 'cart_only' });
  });
});
