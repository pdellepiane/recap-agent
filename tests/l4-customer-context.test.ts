import { describe, expect, it } from 'vitest';

import type {
  CartInformation,
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseInformation,
} from '../src/core/information';
import type { UserEventLookupResult } from '../src/runtime/provider-gateway';
import {
  assembleCustomerContext,
  classifyAddress,
  hasConfirmedOutcome,
  invalidateSectionAfterWrite,
  isolationScopeKey,
  projectCustomerContext,
  rankCandidatesByRelevance,
  recordActionOutcome,
  redactCustomerUrlForLog,
  redactSnapshotForLog,
  requiredSectionsReady,
  resolveRelevantTarget,
  type CustomerContextSnapshot,
  type CustomerExecution,
} from '../src/runtime/customer-context';
import { enrichmentBounds, enrichmentVisitKey } from '../src/core/information';
import type {
  AgentConversationGateway,
  AgentEventDetailInput,
  AgentEventDetailResult,
  AgentGuestEventSummary,
} from '../src/runtime/agent-conversation-gateway';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';

const NOW = '2026-09-11T12:00:00.000Z';

function purchase(
  orderId: string,
  overrides: Partial<PurchaseInformation> = {},
): PurchaseInformation {
  return {
    orderId,
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 150,
    paymentMethod: 'transfer',
    eventName: 'Claudia and Luis Felipe',
    eventDate: null,
    eventUrl: null,
    createdAt: null,
    items: [],
    ...overrides,
  };
}

function cart(
  cartId: string,
  overrides: Partial<CartInformation> = {},
): CartInformation {
  return {
    cartId,
    status: 'abandoned',
    wasAbandoned: true,
    eventName: 'Carlos and Adriana',
    items: [],
    ...overrides,
  };
}

function purchaseResult(
  requestId: string,
  purchases: PurchaseInformation[],
  carts: CartInformation[] = [],
): InformationTaskResult {
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
    carts,
  };
}

function purchaseSummary(requestId: string, durationMs: number): InformationExecutionSummary {
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
    durationMs,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    resource: 'orders',
  };
}

function eventResult(requestId: string, events: UserEventLookupResult['events']): InformationTaskResult {
  return {
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
  };
}

function guestEvent(eventId: number, name: string, country: string | null = null) {
  return {
    relation: 'guest' as const,
    guestId: 42,
    eventId,
    slug: 'slug',
    url: null,
    name,
    place: null,
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
  };
}

function failedResult(
  requestId: string,
  kind: 'purchase' | 'associated_event',
  failureKind: 'request_failed' | 'not_found' | 'not_configured' | 'unauthorized',
): InformationTaskResult {
  return {
    requestId,
    kind,
    status: 'failed',
    retryable: failureKind === 'request_failed',
    failureKind,
    message: 'lookup failed',
    accessMethod: 'trusted_phone_purchase',
  };
}

function failedSummary(
  requestId: string,
  kind: 'purchase' | 'associated_event',
  durationMs: number,
): InformationExecutionSummary {
  return {
    requestId,
    kind,
    status: 'failed',
    source: 'agent_api',
    outcomeCode: 'request_failed',
    retryable: true,
    queryHash: 'q',
    evidence: [],
    resultCount: 0,
    durationMs,
  };
}

function snapshotWithPurchaseAndCart(): CustomerContextSnapshot {
  const execution: CustomerExecution = {
    results: [purchaseResult('req-1', [purchase('ord-1'), purchase('ord-2')], [cart('cart-9')])],
    summaries: [purchaseSummary('req-1', 120)],
  };
  return assembleCustomerContext({
    execution,
    identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
    currentContext: null,
    nowIso: NOW,
  });
}

describe('l4 customer snapshot assembly', () => {
  it('reports not_requested for every section without an execution', () => {
    const snapshot = assembleCustomerContext({
      execution: null,
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.identityAccess.status).toBe('not_requested');
    expect(snapshot.currentContext.status).toBe('not_requested');
    expect(snapshot.purchasesCarts.status).toBe('not_requested');
    expect(snapshot.invitationsEvents.status).toBe('not_requested');
    expect(snapshot.actionOutcomes.status).toBe('not_requested');
    expect(requiredSectionsReady(snapshot, ['purchases_carts'])).toBe(false);
  });

  it('keeps a ready purchase usable while an unrelated lookup fails', () => {
    const execution: CustomerExecution = {
      results: [
        purchaseResult('req-1', [purchase('ord-1')]),
        failedResult('req-2', 'associated_event', 'request_failed'),
      ],
      summaries: [purchaseSummary('req-1', 120), failedSummary('req-2', 'associated_event', 5000)],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.purchasesCarts.status).toBe('ready');
    expect(snapshot.invitationsEvents.status).toBe('failed');
    expect(requiredSectionsReady(snapshot, ['purchases_carts'])).toBe(true);
    expect(requiredSectionsReady(snapshot, ['purchases_carts', 'invitations_events'])).toBe(false);
    expect(snapshot.timingsMs['req-1']).toBe(120);
    expect(snapshot.timingsMs['req-2']).toBe(5000);
  });

  it('marks a failed required section honestly instead of claiming absence', () => {
    const execution: CustomerExecution = {
      results: [failedResult('req-1', 'purchase', 'request_failed')],
      summaries: [failedSummary('req-1', 'purchase', 300)],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.purchasesCarts.status).toBe('failed');
    expect(requiredSectionsReady(snapshot, ['purchases_carts'])).toBe(false);
    const projection = projectCustomerContext(snapshot, { focus: 'payment' });
    expect(projection.purchases).toEqual([]);
    expect(projection.commonRefs.orderIds).toEqual([]);
  });

  it('reports not_found only on a successful authoritative read', () => {
    const empty: CustomerExecution = {
      results: [
        {
          requestId: 'req-1',
          kind: 'purchase',
          status: 'completed',
          resource: 'orders',
          purchases: [],
          needsSelection: false,
        },
      ],
      summaries: [
        {
          ...purchaseSummary('req-1', 80),
          outcomeCode: 'completed_without_results',
          resultCount: 0,
        },
      ],
    };
    const snapshot = assembleCustomerContext({
      execution: empty,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.purchasesCarts.status).toBe('not_found');
    expect(requiredSectionsReady(snapshot, ['purchases_carts'])).toBe(true);
  });

  it('never invents addresses and keeps country-only data incomplete', () => {
    const countryOnly = classifyAddress({
      kind: 'venue',
      source: 'event_detail',
      country: 'Perú',
    });
    expect(countryOnly.completeness).toBe('country_only');
    expect(countryOnly.street).toBeNull();
    const execution: CustomerExecution = {
      results: [
        eventResult('req-9', [guestEvent(5, 'Fiesta Sol', 'Perú')]),
      ],
      summaries: [
        {
          requestId: 'req-9',
          kind: 'associated_event',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'q',
          evidence: [],
          resultCount: 1,
          durationMs: 90,
          accessMethod: 'trusted_phone_guest',
          eventDetailCount: 1,
        },
      ],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.invitations[0]?.address?.completeness).toBe(
      'country_only',
    );
    expect(snapshot.invitationsEvents.invitations[0]?.address?.street).toBeNull();
  });

  it('maps the first resolved moment venue into the existing street field', () => {
    const execution: CustomerExecution = {
      results: [
        eventResult('req-venue', [{
          ...guestEvent(702201, 'Julisabeth y Andrés', null),
          place: 'Lima',
          detail: {
            withTime: false,
            timezone: null,
            city: 'Lima',
            celebrateds: [],
            moments: [{
              label: 'Recepción y Fiesta',
              description: 'Recepción y fiesta en Hacienda Recoveco',
              datetime: '2026-11-15',
              withTime: false,
              locationDescription: 'Hacienda Recoveco',
              locationReference: 'Avenida Manuel Valle en Lima',
              locationUrl: null,
              locationCoords: null,
              position: 0,
            }],
            dresscode: null,
            commonAsked: [],
            contactInfo: [],
          },
        }]),
      ],
      summaries: [
        {
          requestId: 'req-venue',
          kind: 'associated_event',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'q',
          evidence: [],
          resultCount: 1,
          durationMs: 90,
          accessMethod: 'trusted_phone_guest',
          eventDetailCount: 1,
        },
      ],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.invitations[0]?.address?.street).toBe(
      'Hacienda Recoveco, Avenida Manuel Valle en Lima',
    );
    expect(snapshot.invitationsEvents.invitations[0]?.address?.city).toBe('Lima');
  });
});

describe('l4 relevance projection and minimum disclosure', () => {
  it('keeps every authorized record in one canonical profile under any focus', () => {
    const snapshot = snapshotWithPurchaseAndCart();
    expect(snapshot.purchasesCarts.carts).toHaveLength(1);
    const payment = projectCustomerContext(snapshot, {
      focus: 'payment',
      relevantOrderIds: ['ord-1'],
    });
    expect(payment.purchases.map((entry) => entry.orderId)).toEqual(['ord-1', 'ord-2']);
    expect(payment.carts.map((entry) => entry.cartId)).toEqual(['cart-9']);
    expect(payment.detailedPurchases.map((entry) => entry.orderId)).toEqual(['ord-1', 'ord-2']);
    // Relevance travels by reference: the requested record leads, the rest
    // stays visible for inference instead of being hidden.
    expect(payment.purchases[0]?.orderId).toBe('ord-1');
    const cartView = projectCustomerContext(snapshot, { focus: 'cart' });
    expect(cartView.carts).toHaveLength(1);
    expect(cartView.purchases).toHaveLength(2);
    expect(cartView.detailedPurchases).toHaveLength(2);
  });

  it('leaves inactive sections absent from the projection', () => {
    const snapshot = snapshotWithPurchaseAndCart();
    const payment = projectCustomerContext(snapshot, {
      focus: 'payment',
      relevantOrderIds: ['ord-1'],
    });
    expect(payment.invitations).toEqual([]);
    expect(payment.commonRefs.eventIds).toEqual([]);
  });

  it('surfaces a changed customer fact in that entity only, without duplicating it', () => {
    const base = snapshotWithPurchaseAndCart();
    const changed = assembleCustomerContext({
      execution: {
        results: [
          purchaseResult(
            'req-1',
            [purchase('ord-1'), purchase('ord-2', { grandTotal: 999 })],
            [cart('cart-9')],
          ),
        ],
        summaries: [purchaseSummary('req-1', 120)],
      },
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    const query = { focus: 'payment' as const, relevantOrderIds: ['ord-1'] };
    const baseProjection = projectCustomerContext(base, query);
    const changedProjection = projectCustomerContext(changed, query);
    // The new authorized fact is visible instead of hidden...
    expect(JSON.stringify(changedProjection)).not.toBe(JSON.stringify(baseProjection));
    // ...but only inside ord-2's own entity evidence.
    const entityEvidence = (
      projection: ReturnType<typeof projectCustomerContext>,
      orderId: string,
    ): string => JSON.stringify({
      purchases: projection.purchases.filter((entry) => entry.orderId === orderId),
      detailed: projection.detailedPurchases.filter((entry) => entry.orderId === orderId),
      candidates: projection.candidates.filter((entry) => entry.orderId === orderId),
    });
    expect(entityEvidence(changedProjection, 'ord-1')).toBe(entityEvidence(baseProjection, 'ord-1'));
    expect(entityEvidence(changedProjection, 'ord-2')).not.toBe(entityEvidence(baseProjection, 'ord-2'));
    // One home per fact: a single serialization per section with totals
    // that never conflict with the detail disclosure.
    const orderIds = changedProjection.purchases.map((entry) => entry.orderId);
    expect(new Set(orderIds).size).toBe(orderIds.length);
    for (const candidate of changedProjection.candidates) {
      if (candidate.kind !== 'order' || candidate.orderId === undefined) continue;
      const detail = changedProjection.detailedPurchases.find(
        (entry) => entry.orderId === candidate.orderId,
      );
      const detailTotal = detail?.amountDisclosure?.total ?? detail?.grandTotal ?? null;
      if (candidate.total !== undefined && detailTotal !== null) {
        expect(candidate.total).toBe(detailTotal);
      }
    }
    // Relevance still travels by reference: the requested order leads.
    expect(changedProjection.purchases[0]?.orderId).toBe('ord-1');
    const relevantChanged = assembleCustomerContext({
      execution: {
        results: [
          purchaseResult(
            'req-1',
            [purchase('ord-1', { paymentStatus: 'approved' }), purchase('ord-2')],
            [cart('cart-9')],
          ),
        ],
        summaries: [purchaseSummary('req-1', 120)],
      },
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(JSON.stringify(projectCustomerContext(relevantChanged, query))).not.toBe(
      JSON.stringify(projectCustomerContext(base, query)),
    );
  });

  it('never selects the first record automatically among several', () => {
    const two = resolveRelevantTarget({
      orderIds: ['ord-1', 'ord-2'],
      eventIds: [],
    });
    expect(two.kind).toBe('candidates');
    const explicit = resolveRelevantTarget({
      orderIds: ['ord-1', 'ord-2'],
      eventIds: [],
      relevantOrderIds: ['ord-2'],
    });
    expect(explicit).toEqual({ kind: 'target', orderId: 'ord-2', eventId: null });
    const single = resolveRelevantTarget({ orderIds: ['ord-1'], eventIds: [] });
    expect(single.kind).toBe('target');
    expect(resolveRelevantTarget({ orderIds: [], eventIds: [] }).kind).toBe('none');
  });
});

describe('l4 identity isolation and write refresh', () => {
  it('never keys protected data by display name alone', () => {
    expect(isolationScopeKey({ displayName: 'Martha' })).toBeNull();
    expect(isolationScopeKey({})).toBeNull();
    expect(isolationScopeKey({ customerRef: '+51900000001', displayName: 'Martha' })).toBe(
      'customer:+51900000001',
    );
    expect(isolationScopeKey({ customerRef: '+51900000001' })).toBe(
      isolationScopeKey({ customerRef: '+51900000001' }),
    );
    expect(isolationScopeKey({ customerRef: '+51900000001' })).not.toBe(
      isolationScopeKey({ customerRef: '+51900000002' }),
    );
  });

  it('invalidates the affected section after a write and dedupes receipts', () => {
    const snapshot = snapshotWithPurchaseAndCart();
    const invalidated = invalidateSectionAfterWrite(snapshot, 'purchases_carts');
    expect(invalidated.purchasesCarts.status).toBe('loading');
    expect(invalidated.purchasesCarts.purchases).toEqual([]);
    expect(snapshot.purchasesCarts.purchases).toHaveLength(2);
    const recorded = recordActionOutcome(invalidated, {
      operation: 'rsvp.confirm',
      target: 'event:5',
      receipt: 'confirmed',
      observedAt: NOW,
      dedupeKey: 'rsvp:5:guest-42',
    });
    expect(hasConfirmedOutcome(recorded, 'rsvp:5:guest-42')).toBe(true);
    expect(hasConfirmedOutcome(snapshot, 'rsvp:5:guest-42')).toBe(false);
    const repeated = recordActionOutcome(recorded, {
      operation: 'rsvp.confirm',
      target: 'event:5',
      receipt: 'confirmed',
      observedAt: NOW,
      dedupeKey: 'rsvp:5:guest-42',
    });
    expect(repeated.actionOutcomes.outcomes).toHaveLength(1);
  });

  it('redacts raw links from logs while keeping section evidence', () => {
    const snapshot = snapshotWithPurchaseAndCart();
    const redacted = redactSnapshotForLog(snapshot);
    expect(JSON.stringify(redacted)).not.toContain('cart-9');
    expect(redacted).toMatchObject({
      purchasesCarts: { status: 'ready', purchaseCount: 2, cartCount: 1 },
    });
    expect(redactCustomerUrlForLog('https://files.example.com/r/abc?token=secret')).toBe(
      'https://files.example.com/...[redacted]',
    );
    expect(redactCustomerUrlForLog('not a url')).toBe('[invalid-url]');
  });
});

describe('l4 packet C — pagination and history provenance', () => {
  it('never marks unexhausted pagination complete', () => {
    const execution: CustomerExecution = {
      results: [purchaseResult('req-1', [purchase('ord-1')])],
      summaries: [{
        ...purchaseSummary('req-1', 120),
        paginationExhausted: false,
        historyLimit: 'recent_orders_window',
      }],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.purchasesCarts.status).toBe('ready');
    expect(snapshot.purchasesCarts.completeness).toBe('partial');
    expect(snapshot.purchasesCarts.paginationExhausted).toBe(false);
    expect(snapshot.purchasesCarts.historyLimit).toBe('recent_orders_window');
  });

  it('keeps unknown pagination unknown instead of inventing it', () => {
    const snapshot = snapshotWithPurchaseAndCart();
    expect(snapshot.purchasesCarts.paginationExhausted).toBeNull();
    expect(snapshot.purchasesCarts.historyLimit).toBeNull();
    expect(snapshot.purchasesCarts.completeness).toBe('complete');
  });

  it('marks the event section partial when its pages are unexhausted', () => {
    const execution: CustomerExecution = {
      results: [eventResult('req-9', [guestEvent(5, 'Fiesta Sol', 'Perú')])],
      summaries: [{
        requestId: 'req-9',
        kind: 'associated_event',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'q',
        evidence: [],
        resultCount: 1,
        durationMs: 90,
        accessMethod: 'trusted_phone_guest',
        eventDetailCount: 0,
        paginationExhausted: false,
      }],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.completeness).toBe('partial');
    expect(snapshot.invitationsEvents.paginationExhausted).toBe(false);
  });
});

describe('l4 packet C — semantic target selection', () => {
  it('lets an explicit years-old order override a recent pending order', () => {
    const ranked = rankCandidatesByRelevance(
      [
        {
          orderId: 'ord-new',
          eventName: 'Fiesta Nueva',
          paymentStatus: 'pending',
          createdAt: '2026-09-01T00:00:00.000Z',
          eventDate: null,
        },
        {
          orderId: 'ord-old',
          eventName: 'Fiesta Antigua',
          paymentStatus: 'approved',
          createdAt: '2021-05-01T00:00:00.000Z',
          eventDate: null,
        },
      ],
      { explicitOrderId: 'ord-old', explicitEventHint: null, questionFocus: 'payment' },
    );
    expect(ranked.map((candidate) => candidate.orderId)).toEqual(['ord-old', 'ord-new']);
    const target = resolveRelevantTarget({
      orderIds: ['ord-new', 'ord-old'],
      eventIds: [],
      relevantOrderIds: ['ord-old'],
    });
    expect(target).toEqual({ kind: 'target', orderId: 'ord-old', eventId: null });
  });

  it('treats a recent pending order plus voucher as hypothesis, never proof', () => {
    const ranked = rankCandidatesByRelevance(
      [
        {
          orderId: 'ord-recent-pending',
          eventName: 'Fiesta Sol',
          paymentStatus: 'pending',
          createdAt: '2026-09-01T00:00:00.000Z',
          eventDate: null,
        },
        {
          orderId: 'ord-older',
          eventName: 'Fiesta Luna',
          paymentStatus: 'pending',
          createdAt: '2025-01-01T00:00:00.000Z',
          eventDate: null,
        },
      ],
      { explicitOrderId: null, explicitEventHint: null, questionFocus: 'payment' },
    );
    expect(ranked).toHaveLength(2);
    const unresolved = resolveRelevantTarget({
      orderIds: ['ord-recent-pending', 'ord-older'],
      eventIds: [],
    });
    expect(unresolved.kind).toBe('candidates');
  });

  it('keeps multiple pendings and shared event names ambiguous', () => {
    expect(resolveRelevantTarget({
      orderIds: ['ord-1', 'ord-2'],
      eventIds: [],
    }).kind).toBe('candidates');
    const ranked = rankCandidatesByRelevance(
      [
        { orderId: 'a', eventName: 'Fiesta Sol', paymentStatus: 'pending', createdAt: null, eventDate: '2024-06-01' },
        { orderId: 'b', eventName: 'Fiesta Sol', paymentStatus: 'pending', createdAt: null, eventDate: '2023-06-01' },
      ],
      { explicitOrderId: null, explicitEventHint: 'Fiesta Sol', questionFocus: 'general' },
    );
    expect(ranked).toHaveLength(2);
  });

  it('resolves an explicit older pending target over an approved newest record', () => {
    const target = resolveRelevantTarget({
      orderIds: ['ord-new-approved', 'ord-old-pending'],
      eventIds: [],
      relevantOrderIds: ['ord-old-pending'],
    });
    expect(target).toEqual({ kind: 'target', orderId: 'ord-old-pending', eventId: null });
  });

  it('keeps every candidate on a dateless question instead of guessing by date', () => {
    const ranked = rankCandidatesByRelevance(
      [
        { orderId: 'a', eventName: 'Fiesta Sol', paymentStatus: 'pending', createdAt: '2026-01-01', eventDate: null },
        { orderId: 'b', eventName: 'Fiesta Luna', paymentStatus: 'pending', createdAt: '2024-01-01', eventDate: null },
      ],
      { explicitOrderId: null, explicitEventHint: null, questionFocus: 'general' },
    );
    expect(ranked.map((candidate) => candidate.orderId)).toHaveLength(2);
  });

  it('keeps every candidate visible on a dateless question while writes stay gated', () => {
    const snapshot = snapshotWithPurchaseAndCart();
    const projection = projectCustomerContext(snapshot, { focus: 'payment' });
    expect(projection.purchases.map((entry) => entry.orderId)).toEqual(['ord-1', 'ord-2']);
    expect(projection.detailedPurchases).toHaveLength(2);
    expect(projection.commonRefs.orderIds).toEqual(['ord-1', 'ord-2']);
    // No automatic target: the unresolved pair stays candidates, so no
    // mutation target is inferred from visibility alone.
    expect(resolveRelevantTarget({ orderIds: ['ord-1', 'ord-2'], eventIds: [] }).kind).toBe('candidates');
  });

  it('keys bounded traversal visits by type, id and scope', () => {
    expect(enrichmentVisitKey('event', 5, 'trusted_phone_guest')).toBe(
      'event:5:trusted_phone_guest',
    );
    expect(enrichmentVisitKey('event', 5, 'trusted_phone_guest')).not.toBe(
      enrichmentVisitKey('event', 5, 'public'),
    );
    expect(enrichmentVisitKey('event', 5, 'trusted_phone_guest')).not.toBe(
      enrichmentVisitKey('order', 5, 'trusted_phone_guest'),
    );
    expect(enrichmentBounds.maxRelationshipEdges).toBe(2);
    expect(enrichmentBounds.maxConcurrentReads).toBe(4);
  });
});

function eventSummary(id: number, name: string): AgentGuestEventSummary {
  return {
    eventId: id,
    name,
    slug: `slug-${id}`,
    url: null,
    datetime: null,
    type: null,
    typeDetail: null,
    stage: null,
    city: null,
    country: null,
    currency: null,
  };
}

function detailSuccess(eventId: number, name: string, city = 'Cusco'): AgentEventDetailResult {
  return {
    status: 'success',
    event: {
      eventId,
      name,
      slug: `slug-${eventId}`,
      url: null,
      datetime: null,
      type: null,
      typeDetail: null,
      stage: null,
      city,
      country: 'Perú',
      currency: null,
      withTime: false,
      timezone: null,
      celebrateds: [],
      moments: [],
      dresscode: null,
      commonAsked: [],
      contactInfo: [],
      attendance: null,
      purchases: [],
    },
  };
}

function eventGateway(
  events: AgentGuestEventSummary[],
  detail: (eventId: number) => AgentEventDetailResult,
  calls: number[],
): AgentConversationGateway {
  return {
    logMessage: async () => ({ status: 'skipped', reason: 'not_configured', message: 'skip' }),
    getRecentMessages: async () => ({ status: 'skipped', reason: 'not_configured', message: 'skip' }),
    requestHumanTakeover: async () => ({ status: 'skipped', reason: 'not_configured', message: 'skip' }),
    authByPhone: async () => ({ status: 'failed', error: 'unused', retryable: false }),
    updatePhone: async () => ({ status: 'failed', error: 'unused', retryable: false }),
    getGuestEventsByPhone: async () => ({ status: 'success', events }),
    getEventDetail: async (input: AgentEventDetailInput) => {
      calls.push(input.eventId ?? -1);
      return detail(input.eventId ?? -1);
    },
  } as unknown as AgentConversationGateway;
}

function hydrationOrchestrator(gateway: AgentConversationGateway): InformationOrchestrator {
  return new InformationOrchestrator({
    knowledgeGateway: {} as unknown as KnowledgeRetrievalGateway,
    providerGateway: {} as unknown as ProviderGateway,
    agentGateway: gateway,
  });
}

const HYDRATION_PHONE = { phone_extension: '+51', phone_number: '900000001' };

describe('l4 packet C — bounded event hydration', () => {
  it('hydrates hint-matched shared-name events within the read bound', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [1, 2, 3, 4, 5, 6].map((id) => eventSummary(id, 'Fiesta Sol')),
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const outcome = await orchestrator.hydrateRelevantEventDetails({
      events: [1, 2, 3, 4, 5, 6].map((id) => eventSummary(id, 'Fiesta Sol')),
      eventHint: 'Fiesta Sol',
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest',
    });
    expect(outcome.details.size).toBe(4);
    expect(outcome.readsAttempted).toBe(4);
    expect(outcome.truncatedByBound).toBe(true);
    expect(outcome.failures).toEqual([]);
    expect(calls).toHaveLength(4);
  });

  it('terminates cyclic duplicate references through the visited set', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(7, 'Fiesta Sol'), eventSummary(7, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const outcome = await orchestrator.hydrateRelevantEventDetails({
      events: [eventSummary(7, 'Fiesta Sol'), eventSummary(7, 'Fiesta Sol')],
      eventHint: 'Fiesta Sol',
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest',
    });
    expect(outcome.readsAttempted).toBe(1);
    expect(outcome.details.size).toBe(1);
    expect(calls).toEqual([7]);
  });

  it('hydrates authorized alternatives for a dateless reference-free question', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(1, 'Fiesta Sol'), eventSummary(2, 'Fiesta Luna')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const outcome = await orchestrator.hydrateRelevantEventDetails({
      events: [eventSummary(1, 'Fiesta Sol'), eventSummary(2, 'Fiesta Luna')],
      eventHint: null,
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest',
    });
    // Bounded alternative reads preserve venue facts before asking; reading
    // them selects no mutation target.
    expect(outcome.readsAttempted).toBe(2);
    expect(outcome.details.size).toBe(2);
    expect(outcome.truncatedByBound).toBe(false);
    expect(calls).toEqual([1, 2]);
  });

  it('hydrates authorized alternatives when the hint matches nothing', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(1, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const outcome = await orchestrator.hydrateRelevantEventDetails({
      events: [eventSummary(1, 'Fiesta Sol')],
      eventHint: 'Evento Desconocido',
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest',
    });
    // A failed name match never becomes venue-unavailable: the known
    // alternative rides the profile for model resolution.
    expect(outcome.readsAttempted).toBe(1);
    expect(outcome.details.size).toBe(1);
    expect(calls).toEqual([1]);
  });

  it('stops at the invocation deadline without throwing', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(1, 'Fiesta Sol'), eventSummary(2, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const outcome = await orchestrator.hydrateRelevantEventDetails({
      events: [eventSummary(1, 'Fiesta Sol'), eventSummary(2, 'Fiesta Sol')],
      eventHint: 'Fiesta Sol',
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest',
      deadlineMs: Date.now() - 1000,
    });
    expect(outcome.readsAttempted).toBe(0);
    expect(outcome.details.size).toBe(0);
    expect(outcome.truncatedByBound).toBe(true);
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures[0]?.failureKind).toBe('deadline_exceeded');
    expect(calls).toEqual([]);
  });

  it('stops when the relationship-edge bound is exhausted', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(1, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const outcome = await orchestrator.hydrateRelevantEventDetails({
      events: [eventSummary(1, 'Fiesta Sol')],
      eventHint: 'Fiesta Sol',
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest',
      depth: 2,
    });
    expect(outcome.readsAttempted).toBe(0);
    expect(outcome.truncatedByBound).toBe(true);
    expect(calls).toEqual([]);
  });

  it('records a read failure instead of throwing', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(9, 'Fiesta Sol')],
      () => ({ status: 'failed', error: 'boom', retryable: true }),
      calls,
    ));
    const outcome = await orchestrator.hydrateRelevantEventDetails({
      events: [eventSummary(9, 'Fiesta Sol')],
      eventHint: 'Fiesta Sol',
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest',
    });
    expect(outcome.details.size).toBe(0);
    expect(outcome.failures).toEqual([{ eventId: 9, failureKind: 'request_failed' }]);
  });

  it('preserves the known association when detail reads fail', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(11, 'Fiesta Sol'), eventSummary(12, 'Fiesta Sol')],
      () => ({ status: 'failed', error: 'boom', retryable: true }),
      calls,
    ));
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'ev-1',
        kind: 'associated_event',
        query: 'Fiesta Sol',
        eventHint: 'Fiesta Sol',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: HYDRATION_PHONE,
    });
    const result = execution.results[0];
    expect(result?.status).toBe('completed');
    if (result?.status === 'completed' && result.kind === 'associated_event') {
      expect(result.result.events).toHaveLength(2);
      expect(result.result.events.every((event) => event.detail === undefined)).toBe(true);
    } else {
      throw new Error('Expected a completed associated_event result.');
    }
  });

  it('projects hydrated venue detail without asking for confirmation', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(8, 'Fiesta Sol'), eventSummary(10, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'ev-1',
        kind: 'associated_event',
        query: 'Fiesta Sol',
        eventHint: 'Fiesta Sol',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: HYDRATION_PHONE,
    });
    expect(calls).toHaveLength(2);
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.status).toBe('ready');
    const projection = projectCustomerContext(snapshot, {
      focus: 'rsvp',
      relevantEventIds: [8],
    });
    // Both authorized invitations ride one canonical profile; the requested
    // event leads by reference instead of hiding the other.
    expect(projection.invitations).toHaveLength(2);
    expect(projection.invitations[0]?.eventId).toBe(8);
    expect(projection.invitations[0]?.address?.city).toBe('Cusco');
    expect(projection.commonRefs.eventIds).toHaveLength(2);
  });

  it('keeps invitation attendance visible under every focus with identity intact', () => {
    // The canonical profile never hides an authorized attendance fact by
    // focus: general turns see the same typed state as RSVP turns, and the
    // current question (not the profile) selects what the answer covers.
    const execution: CustomerExecution = {
      results: [eventResult('ev-1', [guestEvent(8, 'Fiesta Sol')])],
      summaries: [{
        requestId: 'ev-1',
        kind: 'associated_event',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'q',
        evidence: [],
        resultCount: 1,
        durationMs: 50,
      }],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.status).toBe('ready');

    const general = projectCustomerContext(snapshot, { focus: 'general', relevantEventIds: [8] });
    expect(general.invitations).toHaveLength(1);
    expect(general.invitations[0]?.eventName).toBe('Fiesta Sol');
    expect(general.invitations[0]?.rsvpState).toBe('pending');

    const rsvp = projectCustomerContext(snapshot, { focus: 'rsvp', relevantEventIds: [8] });
    expect(rsvp.invitations).toHaveLength(1);
    expect(rsvp.invitations[0]?.rsvpState).toBe('pending');
  });
});

describe('l4 packet S7 — bounded linked-detail enrichment', () => {
  it('selects only explicit known IDs and caps reads at four', async () => {
    const { selectEnrichmentTargets } = await import('../src/runtime/customer-context');
    const explicit = selectEnrichmentTargets({
      knownOrderIds: ['ord-old', 'ord-new'],
      knownEventIds: [5, 9],
      relevantOrderIds: ['ord-old'],
      relevantEventIds: [5],
    });
    expect(explicit.orderIds).toEqual(['ord-old']);
    expect(explicit.eventIds).toEqual([5]);
    expect(explicit.truncatedByBound).toBe(false);
    const ambiguous = selectEnrichmentTargets({
      knownOrderIds: ['ord-old', 'ord-new'],
      knownEventIds: [5, 9],
      relevantOrderIds: [],
      relevantEventIds: [],
    });
    expect(ambiguous.orderIds).toEqual([]);
    expect(ambiguous.eventIds).toEqual([]);
    const unknown = selectEnrichmentTargets({
      knownOrderIds: ['ord-old'],
      knownEventIds: [5],
      relevantOrderIds: ['ord-stranger', 'ord-old'],
      relevantEventIds: ['999'],
    });
    expect(unknown.orderIds).toEqual(['ord-old']);
    expect(unknown.eventIds).toEqual([]);
    const many = selectEnrichmentTargets({
      knownOrderIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      knownEventIds: [],
      relevantOrderIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      relevantEventIds: [],
    });
    expect(many.orderIds).toHaveLength(4);
    expect(many.truncatedByBound).toBe(true);
  });

  it('retains an explicit years-old target with no date cutoff', async () => {
    const { selectEnrichmentTargets } = await import('../src/runtime/customer-context');
    const targets = selectEnrichmentTargets({
      knownOrderIds: ['ord-2021-old', 'ord-2026-new'],
      knownEventIds: [],
      relevantOrderIds: ['ord-2021-old'],
      relevantEventIds: [],
    });
    expect(targets.orderIds).toEqual(['ord-2021-old']);
  });

  it('reuses same-turn detail instead of re-issuing the read', async () => {
    const { selectEnrichmentTargets } = await import('../src/runtime/customer-context');
    const targets = selectEnrichmentTargets({
      knownOrderIds: ['ord-detail', 'ord-summary'],
      knownEventIds: [5, 9],
      relevantOrderIds: ['ord-detail', 'ord-summary'],
      relevantEventIds: [5, 9],
      alreadyDetailedOrderIds: ['ord-detail'],
      alreadyDetailedEventIds: [5],
    });
    expect(targets.orderIds).toEqual(['ord-summary']);
    expect(targets.eventIds).toEqual([9]);
    expect(targets.truncatedByBound).toBe(false);
  });

  it('exposes absent gateway capability as unavailable without guessing an API', async () => {
    const calls: number[] = [];
    const gateway = eventGateway([eventSummary(5, 'Fiesta Sol')], (id) => detailSuccess(id, 'Sol'), calls);
    const withoutDetail = { ...gateway, getEventDetail: undefined } as unknown as AgentConversationGateway;
    const orchestrator = hydrationOrchestrator(withoutDetail);
    const outcome = await orchestrator.enrichCustomerLinkedDetail({
      orderIds: [],
      eventIds: [5],
      authentication: null,
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest:+51900000001',
    });
    expect(outcome.eventDetails.size).toBe(0);
    expect(outcome.unavailable).toContain('event:5');
    expect(outcome.readsAttempted).toBe(1);
  });

  it('fetches duplicate/cyclic IDs once within one pass', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(7, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const visited = new Set<string>();
    const cache = new Map();
    const first = await orchestrator.enrichCustomerLinkedDetail({
      orderIds: [],
      eventIds: [7, 7, '7'],
      authentication: null,
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest:+51900000001',
      detailCache: cache,
      visited,
    });
    expect(first.eventDetails.size).toBe(1);
    expect(first.readsAttempted).toBe(1);
    expect(calls).toEqual([7]);
    const second = await orchestrator.enrichCustomerLinkedDetail({
      orderIds: [],
      eventIds: [7],
      authentication: null,
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest:+51900000001',
      detailCache: cache,
      visited,
    });
    expect(second.readsAttempted).toBe(0);
    expect(calls).toEqual([7]);
  });

  it('enforces the relationship-edge bound and the invocation deadline', async () => {
    const calls: number[] = [];
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(1, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      calls,
    ));
    const deep = await orchestrator.enrichCustomerLinkedDetail({
      orderIds: [],
      eventIds: [1],
      authentication: null,
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest:+51900000001',
      depth: 2,
    });
    expect(deep.truncatedByBound).toBe(true);
    expect(deep.readsAttempted).toBe(0);
    expect(calls).toEqual([]);
    const expired = await orchestrator.enrichCustomerLinkedDetail({
      orderIds: [],
      eventIds: [1],
      authentication: null,
      trustedPhone: HYDRATION_PHONE,
      scope: 'trusted_phone_guest:+51900000001',
      deadlineMs: Date.now() - 1000,
    });
    expect(expired.readsAttempted).toBe(0);
    expect(expired.truncatedByBound).toBe(true);
    expect(expired.failures).toEqual([{ target: 'event:1', failureKind: 'deadline_exceeded' }]);
  });

  it('expands inline payment/items without another HTTP call and keeps country-only incomplete', async () => {
    const { expandInlinePurchaseDetail } = await import('../src/runtime/customer-context');
    const calls: number[] = [];
    void calls;
    const full = purchase('ord-1', {
      payment: { method: 'transfer', amount: 150, paidAt: '2026-09-01T00:00:00.000Z' },
      items: [{ giftName: 'Regalo', quantity: 1, amount: 150, rowTotal: 150, type: 'gift' }],
    });
    const expanded = expandInlinePurchaseDetail(full);
    expect(expanded.payment?.amount).toBe(150);
    expect(expanded.items).toHaveLength(1);
    expect(expanded).not.toBe(full);
    const countryOnly = classifyAddress({ kind: 'venue', source: 'event_detail', country: 'Perú' });
    expect(countryOnly.street).toBeNull();
    expect(countryOnly.completeness).toBe('country_only');
  });

  it('keeps an accountless call without phone or token unavailable instead of inventing access', async () => {
    const orchestrator = hydrationOrchestrator(eventGateway(
      [eventSummary(5, 'Fiesta Sol')],
      (id) => detailSuccess(id, 'Fiesta Sol'),
      [],
    ));
    const outcome = await orchestrator.enrichCustomerLinkedDetail({
      orderIds: ['ord-1'],
      eventIds: [],
      authentication: null,
      trustedPhone: null,
      scope: 'public',
    });
    expect(outcome.giftPurchases).toEqual([]);
    expect(outcome.unavailable).toContain('order:ord-1');
  });
});

describe('l4 packet P1 — canonical profile and lookup reuse', () => {
  it('coalesces duplicate route results without losing detail', async () => {
    const {
      coalescePurchasesByStableId,
    } = await import('../src/runtime/customer-context');
    const summary = purchase('ord-1', { items: [], payment: null });
    const detail = purchase('ord-1', {
      items: [{ giftName: 'Regalo', quantity: 1, amount: 150, rowTotal: 150, type: 'gift' }],
      payment: { method: 'transfer', amount: 150, paidAt: '2026-09-01T00:00:00.000Z' },
    });
    const merged = coalescePurchasesByStableId([
      { purchase: summary, accessMethod: 'trusted_phone_purchase' },
      { purchase: detail, accessMethod: 'trusted_phone_purchase' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.items).toHaveLength(1);
    expect(merged[0]?.payment?.amount).toBe(150);
    const execution: CustomerExecution = {
      results: [
        purchaseResult('req-1', [summary]),
        purchaseResult('req-2', [detail]),
      ],
      summaries: [purchaseSummary('req-1', 40), purchaseSummary('req-2', 50)],
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.purchasesCarts.detailedPurchases).toHaveLength(1);
    expect(snapshot.purchasesCarts.detailedPurchases[0]?.items).toHaveLength(1);
  });

  it('keeps conflicting fresh records explicit instead of picking a side', async () => {
    const { coalescePurchasesByStableId } = await import('../src/runtime/customer-context');
    const merged = coalescePurchasesByStableId([
      { purchase: purchase('ord-1', { paymentStatus: 'pending' }), accessMethod: 'trusted_phone_purchase' },
      { purchase: purchase('ord-1', { paymentStatus: 'approved' }), accessMethod: 'trusted_phone_purchase' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.paymentStatus).toBeNull();
  });

  it('never merges across incompatible access scopes', async () => {
    const { coalescePurchasesByStableId, purchaseScopesCompatible } = await import('../src/runtime/customer-context');
    expect(purchaseScopesCompatible('trusted_phone_purchase', 'trusted_phone_event_purchase')).toBe(true);
    expect(purchaseScopesCompatible('trusted_phone_purchase', 'authenticated_account')).toBe(false);
    expect(purchaseScopesCompatible('authenticated_account', 'authenticated_account')).toBe(true);
    const merged = coalescePurchasesByStableId([
      { purchase: purchase('ord-1'), accessMethod: 'trusted_phone_purchase' },
      { purchase: purchase('ord-1'), accessMethod: 'authenticated_account' },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('keeps same event with different guests in distinct attendance slots', async () => {
    const { coalesceInvitationsBySlot, attendanceSlotKey } = await import('../src/runtime/customer-context');
    expect(attendanceSlotKey(5, 42, 'trusted_phone_guest')).not.toBe(
      attendanceSlotKey(5, 43, 'trusted_phone_guest'),
    );
    const merged = coalesceInvitationsBySlot([
      {
        invitation: {
          eventId: 5, eventName: 'Fiesta Sol', role: 'guest', rsvpState: 'pending',
          address: null,
        },
        guestId: 42,
        accessScope: 'trusted_phone_guest',
      },
      {
        invitation: {
          eventId: 5, eventName: 'Fiesta Sol', role: 'guest', rsvpState: 'attending',
          address: null,
        },
        guestId: 43,
        accessScope: 'trusted_phone_guest',
      },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('preserves known data when a failed route arrives and never asserts absence', async () => {
    const { mergeExecutionIntoSnapshot, createEntryCustomerSnapshot } = await import('../src/runtime/customer-context');
    const base = createEntryCustomerSnapshot({
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    const ready = assembleCustomerContext({
      execution: {
        results: [purchaseResult('req-1', [purchase('ord-1')])],
        summaries: [purchaseSummary('req-1', 40)],
      },
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    const enriched = mergeExecutionIntoSnapshot({
      base,
      execution: {
        results: [purchaseResult('req-1', [purchase('ord-1')])],
        summaries: [purchaseSummary('req-1', 40)],
      },
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(enriched.purchasesCarts.status).toBe('ready');
    void ready;
    const preserved = mergeExecutionIntoSnapshot({
      base: enriched,
      execution: {
        results: [failedResult('req-2', 'purchase', 'request_failed')],
        summaries: [failedSummary('req-2', 'purchase', 10)],
      },
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(preserved.purchasesCarts.status).toBe('ready');
    expect(preserved.purchasesCarts.detailedPurchases).toHaveLength(1);
  });

  it('skips prefetch for pure public FAQ turns', async () => {
    const { isPurePublicFaqTurn, createEntryCustomerSnapshot } = await import('../src/runtime/customer-context');
    expect(isPurePublicFaqTurn([{ kind: 'faq' }, { kind: 'faq' }])).toBe(true);
    expect(isPurePublicFaqTurn([{ kind: 'faq' }, { kind: 'purchase' }])).toBe(false);
    expect(isPurePublicFaqTurn([])).toBe(false);
    const entry = createEntryCustomerSnapshot({
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    expect(entry.purchasesCarts.status).toBe('not_requested');
    expect(entry.invitationsEvents.status).toBe('not_requested');
    expect(entry.identityAccess.status).toBe('ready');
  });

  it('observes read-after-write refresh over an invalidated section', async () => {
    const { mergeExecutionIntoSnapshot } = await import('../src/runtime/customer-context');
    const ready = assembleCustomerContext({
      execution: {
        results: [purchaseResult('req-1', [purchase('ord-1')])],
        summaries: [purchaseSummary('req-1', 40)],
      },
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    const invalidated = invalidateSectionAfterWrite(ready, 'purchases_carts');
    expect(invalidated.purchasesCarts.status).toBe('loading');
    const refreshed = mergeExecutionIntoSnapshot({
      base: invalidated,
      execution: {
        results: [purchaseResult('req-2', [purchase('ord-1', { paymentStatus: 'approved' })])],
        summaries: [purchaseSummary('req-2', 30)],
      },
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(refreshed.purchasesCarts.status).toBe('ready');
    expect(refreshed.purchasesCarts.detailedPurchases[0]?.paymentStatus).toBe('approved');
  });
});
