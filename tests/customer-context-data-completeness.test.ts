import { describe, expect, it } from 'vitest';

import type {
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseInformation,
} from '../src/core/information';
import type {
  AgentConversationGateway,
  AgentEventDetail,
  AgentGuestEventSummary,
} from '../src/runtime/agent-conversation-gateway';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { assembleCustomerContext, projectCustomerContext } from '../src/runtime/customer-context';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';

const phone = { phone_extension: '+51', phone_number: '900000001' };

function guestEvent(eventId: number): AgentGuestEventSummary {
  return {
    eventId,
    name: `Event ${eventId}`,
    slug: `event-${eventId}`,
    url: null,
    datetime: null,
    type: 'wedding',
    typeDetail: null,
    stage: 'active',
    city: null,
    country: 'Peru',
    currency: 'PEN',
  };
}

function detail(eventId: number): AgentEventDetail {
  return {
    ...guestEvent(eventId),
    withTime: false,
    timezone: null,
    celebrateds: [],
    moments: [],
    dresscode: null,
    commonAsked: [],
    contactInfo: [],
    attendance: null,
    purchases: [],
  };
}

function orchestrator(gateway: AgentConversationGateway): InformationOrchestrator {
  return new InformationOrchestrator({
    knowledgeGateway: {} as KnowledgeRetrievalGateway,
    providerGateway: {} as ProviderGateway,
    agentGateway: gateway,
  });
}

describe('complete customer context data reads', () => {
  it('loads every event detail from the authorized phone root with bounded concurrency', async () => {
    const eventIds = [101, 102, 103, 104, 105, 106];
    const detailCalls: number[] = [];
    let activeDetails = 0;
    let peakDetails = 0;
    const gateway = {
      async getGuestOrdersByPhone() {
        return { status: 'success', resource: 'orders', purchases: [], carts: [] } as const;
      },
      async getGuestGiftPurchasesByPhone() {
        return { status: 'success', resource: 'gift_purchases', purchases: [] } as const;
      },
      async getGuestEventsByPhone() {
        return { status: 'success', events: eventIds.map(guestEvent) } as const;
      },
      async getEventDetail(input: { eventId?: number }) {
        const eventId = input.eventId ?? -1;
        detailCalls.push(eventId);
        activeDetails += 1;
        peakDetails = Math.max(peakDetails, activeDetails);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeDetails -= 1;
        return { status: 'success', event: detail(eventId) } as const;
      },
    } as unknown as AgentConversationGateway;

    const snapshot = await orchestrator(gateway).prepareCustomerContext({
      authentication: null,
      trustedPhone: phone,
      identity: {
        customerRef: '+51900000001',
        scope: 'trusted_phone_purchase',
        source: 'trusted_phone',
      },
      currentContext: null,
      deadlineMs: null,
    });

    expect(detailCalls.sort()).toEqual(eventIds);
    expect(peakDetails).toBeLessThanOrEqual(4);
    expect(snapshot.readMetrics?.readsByOperation['agent.event_detail']).toBe(6);
    expect(snapshot.invitationsEvents.invitations).toHaveLength(6);
    expect(snapshot.invitationsEvents.completeness).toBe('partial');
    expect(projectCustomerContext(snapshot).invitations).toHaveLength(6);
  });

  // No-identity zero-read coverage lives in
  // complete-customer-context-serialized.test.ts ('represents missing
  // authorization explicitly and performs zero protected reads'), which pins
  // the same unavailable sections and zero totalReads plus per-operation
  // zero-call counts and the serialized extraction/reply profiles.

  it('keeps same-ID records from distinct source roots as separate canonical facts', () => {
    const orders: PurchaseInformation = {
      orderId: 'shared-id',
      paymentStatus: 'paid',
      shippingStatus: 'sent',
      grandTotal: 20,
      paymentMethod: 'card',
      eventName: 'Birthday',
      eventDate: null,
      eventUrl: null,
      createdAt: '2020-01-01T00:00:00Z',
      items: [],
      recordSource: 'orders',
      accessScope: 'authenticated_account',
    };
    const eventOrder: NonNullable<UserEventLookupResult['recentOrders']>[number] = {
      id: 2,
      eventId: 3,
      eventName: 'Birthday',
      eventDate: null,
      eventUrl: null,
      currency: 'PEN',
      currencySymbol: 'S/',
      incrementId: 'shared-id',
      giftType: 'gift',
      grandTotal: 35,
      paymentStatus: 'pending',
      shippingStatus: null,
      createdAt: '2021-01-01T00:00:00Z',
      paymentMethod: 'transfer',
    };
    const execution = {
      results: [
        {
          requestId: 'orders', kind: 'purchase', status: 'completed', resource: 'orders',
          lookupResource: 'orders', purchases: [orders], needsSelection: false,
          accessMethod: 'authenticated_account',
        },
        {
          requestId: 'events', kind: 'associated_event', status: 'completed', accessMethod: 'authenticated_account',
          result: {
            lookup: { email: 'person@example.com' }, user: null, events: [], recentOrders: [eventOrder],
            counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 1 },
          },
        },
      ] as InformationTaskResult[],
      summaries: [
        { requestId: 'orders', kind: 'purchase', status: 'completed', source: 'agent_api', outcomeCode: 'completed_with_results', retryable: null, queryHash: 'x', evidence: [], resultCount: 1, durationMs: 1 },
        { requestId: 'events', kind: 'associated_event', status: 'completed', source: 'associated_event_api', outcomeCode: 'completed_with_results', retryable: null, queryHash: 'x', evidence: [], resultCount: 1, durationMs: 1 },
      ] satisfies InformationExecutionSummary[],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: 'account:1', scope: 'account', source: 'agent_api' },
      currentContext: null,
      nowIso: '2026-09-23T00:00:00.000Z',
    });
    const projected = projectCustomerContext(snapshot);

    expect(projected.purchases).toHaveLength(2);
    expect(projected.purchases.map((record) => [record.recordSource, record.grandTotal])).toEqual([
      ['orders', 20],
      ['user_lookup', 35],
    ]);
  });
});
