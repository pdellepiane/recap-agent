import { describe, expect, it } from 'vitest';

import { createEmptyPlan, normalizeRawPlan, mergePlan } from '../src/core/plan';
import {
  deriveConversationContinuity,
  type ConversationHistoryStatus,
} from '../src/runtime/turn-message-context';

describe('derived conversation continuity', () => {
  it('derives purchase support from persisted information state and history', () => {
    const plan = mergePlan(createEmptyPlan({
      planId: 'carina', channel: 'whatsapp', externalUserId: 'carina',
    }), {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: 'entrevista',
        pending_requests: [{
          requestId: 'purchase-1', kind: 'purchase', query: 'estado de mi compra',
          resource: 'orders', orderId: null, aspects: ['payment_status'],
          sensitiveFields: [], authAction: 'none',
        }],
        selection_candidates: [],
      },
    });
    const continuity = deriveConversationContinuity({
      plan,
      recentMessages: [],
      historyStatus: 'empty' satisfies ConversationHistoryStatus,
    });
    expect(continuity.lane).toBe('purchase_support');
    expect(continuity.welcomeAllowed).toBe(false);
  });

  it('keeps Maria mailbox continuity without a persisted anchor', () => {
    const plan = mergePlan(createEmptyPlan({
      planId: 'maria', channel: 'whatsapp', externalUserId: 'maria',
    }), { current_node: 'resolver_consultas_informativas' });
    const continuity = deriveConversationContinuity({
      plan,
      recentMessages: [{
        id: 1, direction: 'inbound', source: null, body: 'Mi correo está lleno',
        status: 'sent', sentAt: null, createdAt: null,
      }],
      historyStatus: 'available',
    });
    expect(continuity.hasPriorContext).toBe(true);
    expect(continuity.welcomeAllowed).toBe(false);
  });

  it('strips legacy support anchors at the plan boundary', () => {
    const normalized = normalizeRawPlan({
      information_state: { support_anchor: { topic: 'mailbox_capacity' } },
    }) as { information_state: Record<string, unknown> };
    expect(normalized.information_state.support_anchor).toBeUndefined();
  });
});
