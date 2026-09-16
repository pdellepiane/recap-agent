import { describe, expect, it } from 'vitest';

import type {
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseInformation,
} from '../src/core/information';
import {
  assembleCustomerContext,
  attendanceSlotKey,
  coalesceInvitationsBySlot,
  projectCustomerContext,
  stripTransactionIdForModel,
  type CustomerExecution,
} from '../src/runtime/customer-context';
import {
  projectPurchaseReplyForModel,
  selectPurchaseReplyOutcome,
} from '../src/runtime/purchase-reply-projector';
import { hasCurrentMessageRsvpReference } from '../src/runtime/agent-service';

const NOW = '2026-09-16T12:00:00.000Z';

function purchase(
  orderId: string,
  overrides: Partial<PurchaseInformation> = {},
): PurchaseInformation {
  return {
    orderId,
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 227.76,
    paymentMethod: 'transfer',
    eventName: 'Claudia and Luis Felipe',
    eventDate: null,
    eventUrl: null,
    createdAt: null,
    items: [],
    ...overrides,
  };
}

function purchaseResult(requestId: string, purchases: PurchaseInformation[]): InformationTaskResult {
  return {
    requestId,
    kind: 'purchase',
    status: 'completed',
    resource: 'orders',
    lookupResource: 'orders',
    purchases,
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    carts: [],
  };
}

function purchaseSummary(requestId: string): InformationExecutionSummary {
  return {
    requestId,
    kind: 'purchase',
    status: 'completed',
    source: 'agent_api',
    outcomeCode: 'completed_with_results',
    retryable: null,
    queryHash: 'q',
    evidence: [],
    resultCount: 1,
    durationMs: 120,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    paginationExhausted: null,
    historyLimit: null,
  };
}

function moment(
  label: string,
  locationDescription: string | null,
  locationReference: string | null,
  position: number,
) {
  return {
    label,
    description: null,
    datetime: null,
    withTime: false,
    locationDescription,
    locationReference,
    locationUrl: null,
    locationCoords: null,
    position,
  };
}

function guestEventWithMoments(
  eventId: number,
  moments: ReturnType<typeof moment>[],
  country: string | null = null,
) {
  return {
    relation: 'guest' as const,
    guestId: 42,
    eventId,
    slug: 'slug',
    url: null,
    name: 'Julisabeth y Andrés',
    place: 'Lima',
    type: null,
    datetime: null,
    stage: null,
    isVisible: null,
    isPublic: null,
    currency: null,
    country,
    guestStatus: {
      hasResponded: false,
      willAttend: null,
      hasCouple: null,
      responseDate: null,
    },
    hostType: null,
    hostPermission: null,
    hostStatus: null,
    celebratedType: null,
    amountCollected: null,
    amountTransferred: null,
    transactionsCount: null,
    invitedGuestCount: null,
    confirmedGuestCount: null,
    orders: [],
    detail: {
      withTime: false,
      timezone: null,
      celebrateds: [],
      moments,
      dresscode: null,
      commonAsked: [],
      contactInfo: [],
    },
  };
}

function eventExecution(requestId: string, events: ReturnType<typeof guestEventWithMoments>[]): CustomerExecution {
  return {
    results: [
      {
        requestId,
        kind: 'associated_event',
        status: 'completed',
        result: {
          lookup: { email: null, phone: '+51900000000' },
          user: null,
          events,
          counts: {
            ownerEvents: 0,
            guestEvents: events.length,
            hostEvents: 0,
            celebratedEvents: 0,
            recentOrders: 0,
          },
        },
        accessMethod: 'trusted_phone_guest',
      } as unknown as InformationTaskResult,
    ],
    summaries: [
      {
        requestId,
        kind: 'associated_event',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'q',
        evidence: [],
        resultCount: events.length,
        durationMs: 90,
        accessMethod: 'trusted_phone_guest',
        eventDetailCount: events.length,
      } as InformationExecutionSummary,
    ],
  };
}

describe('runtime relevance venue hydration', () => {
  it('labels multiple venue moments without mixing ceremony and reception', () => {
    const snapshot = assembleCustomerContext({
      execution: eventExecution('req-multi', [
        guestEventWithMoments(702201, [
          moment('Ceremonia', 'Parroquia San Felipe', null, 0),
          moment('Recepción y Fiesta', 'Hacienda Recoveco', 'Avenida Manuel Valle en Lima', 1),
        ]),
      ]),
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    const street = snapshot.invitationsEvents.invitations[0]?.address?.street;
    expect(street).toContain('Parroquia San Felipe');
    expect(street).toContain('Recepción y Fiesta: Hacienda Recoveco, Avenida Manuel Valle en Lima');
  });

  it('keeps the single-moment street form byte-stable', () => {
    const snapshot = assembleCustomerContext({
      execution: eventExecution('req-single', [
        guestEventWithMoments(702201, [
          moment('Recepción y Fiesta', 'Hacienda Recoveco', 'Avenida Manuel Valle en Lima', 0),
        ]),
      ]),
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.invitations[0]?.address?.street).toBe(
      'Hacienda Recoveco, Avenida Manuel Valle en Lima',
    );
  });

  it('never uses the event country as street', () => {
    const snapshot = assembleCustomerContext({
      execution: eventExecution('req-country', [guestEventWithMoments(5, [], 'Perú')]),
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.invitations[0]?.address?.street).toBeNull();
    expect(snapshot.invitationsEvents.invitations[0]?.address?.completeness).toBe('country_only');
  });
});

describe('runtime relevance purchase projection', () => {
  it('strips transaction references from model-visible detail only', () => {
    const record = purchase('ord-1', { customerTransactionNumber: 'COD12345' });
    const snapshot = assembleCustomerContext({
      execution: { results: [purchaseResult('req-1', [record])], summaries: [purchaseSummary('req-1')] },
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.purchasesCarts.detailedPurchases[0]?.customerTransactionNumber).toBe('COD12345');
    const projection = projectCustomerContext(snapshot, {
      focus: 'payment',
      relevantOrderIds: ['ord-1'],
    });
    expect(projection.detailedPurchases[0]?.customerTransactionNumber).toBeNull();
    expect(projection.detailedPurchases[0]?.orderId).toBe('ord-1');
    expect(stripTransactionIdForModel(purchase('ord-9')).customerTransactionNumber ?? null).toBeNull();
  });

  it('never computes a remaining balance from an unknown paid amount', () => {
    const record = purchase('ord-1', {
      payment: null,
      amountDisclosure: {
        total: 227.76,
        paid: null,
        currency: 'PEN',
        currencySymbol: 'S/',
        paymentMethod: 'transfer',
        presentation: 'explicit_currency',
      },
    });
    const outcome = selectPurchaseReplyOutcome({
      purchases: [record],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: ['summary', 'payment_status'],
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    if (outcome.kind !== 'order_unique') return;
    expect(outcome.order.amount?.total).toBe(227.76);
    expect(outcome.order.amount?.paid).toBeNull();
    expect(outcome.order.amount?.remaining).toBeNull();
    expect(outcome.order.amount?.remainingVerifiable).toBe(false);
    const projected = projectPurchaseReplyForModel(outcome) as {
      order: { amount: { total: number | null; remaining: null } };
    };
    expect(projected.order.amount.total).toBe(227.76);
    expect(projected.order.amount.remaining).toBeNull();
  });
});

describe('runtime relevance rsvp reference reads', () => {
  it('enables reads from typed references independent of rsvpAction', () => {
    expect(
      hasCurrentMessageRsvpReference({
        rsvpDecisionSource: 'current_message',
        rsvpEventReference: 'Otra celebración prueba',
        rsvpCandidateGuestId: null,
      }),
    ).toBe(true);
    expect(
      hasCurrentMessageRsvpReference({
        rsvpDecisionSource: 'current_message',
        rsvpEventReference: null,
        rsvpCandidateGuestId: 42,
      }),
    ).toBe(true);
  });

  it('rejects plan-state references and bare intent without references', () => {
    expect(
      hasCurrentMessageRsvpReference({
        rsvpDecisionSource: 'plan_state',
        rsvpEventReference: 'Otra celebración prueba',
        rsvpCandidateGuestId: null,
      }),
    ).toBe(false);
    expect(
      hasCurrentMessageRsvpReference({
        rsvpDecisionSource: 'current_message',
        rsvpEventReference: null,
        rsvpCandidateGuestId: null,
      }),
    ).toBe(false);
  });
});

describe('runtime relevance identity isolation', () => {
  it('never merges same-event facts across different guests', () => {
    const left = attendanceSlotKey(702201, 42, 'trusted_phone_guest');
    const right = attendanceSlotKey(702201, 43, 'trusted_phone_guest');
    expect(left).not.toBe(right);
    const merged = coalesceInvitationsBySlot([
      {
        invitation: {
          eventId: 702201,
          eventName: 'Julisabeth y Andrés',
          role: 'guest',
          rsvpState: 'pending',
          address: null,
        },
        guestId: 42,
        accessScope: 'trusted_phone_guest',
      },
      {
        invitation: {
          eventId: 702201,
          eventName: 'Julisabeth y Andrés',
          role: 'guest',
          rsvpState: 'attending',
          address: null,
        },
        guestId: 43,
        accessScope: 'trusted_phone_guest',
      },
    ]);
    expect(merged).toHaveLength(2);
  });
});
