import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { hostWithdrawalPolicyQuery, parseHostWithdrawalPolicy } from './host-withdrawal-policy';

import {
  createInformationAuthGuidance,
  enrichmentBounds,
  enrichmentVisitKey,
  firstFullArticleSourceUrl,
  purchaseDiscoveryChildId,
  type CartInformation,
  type InformationAuthGuidance,
  type InformationExecutionSummary,
  type InformationTaskResult,
  type PendingInformationRequest,
  type PurchasePartition,
  type PurchaseRecordSource,
  type PurchaseInformation,
  type PurchaseResource,
  type PurchaseSourceCoverage,
} from '../core/information';
import { parseOrderReference } from '../core/order-reference';
import type {
  AgentAuthByPhoneInput,
  AgentConversationGateway,
  AgentEventDetailResult,
  AgentPhonePurchaseLookupResult,
  AgentGuestEventSummary,
  AgentGuestEventsResult,
  AgentPurchaseLookupResult,
} from './agent-conversation-gateway';
import type { KnowledgeRetrievalGateway } from './knowledge-retrieval-gateway';
import type { ProviderGateway, UserEventLookupResult } from './provider-gateway';
import {
  creditFulfillmentPolicyForItems,
  mapItemFulfillment,
  pendingPaymentValidationExpectation,
} from './purchase-disclosure-policy';
import {
  eventMatches as sharedEventMatches,
} from './event-matching';
import {
  reconcileTwoRecords,
} from './purchase-reconciliation';
import type {
  RuntimeCapabilityManifest,
  RuntimeOperationId,
} from './capability-manifest';
import {
  assembleCustomerContext,
  mergeExecutionIntoSnapshot,
  type CurrentContextEvidence,
  type CustomerContextSnapshot,
  type CustomerReadMetrics,
  type IdentityEvidence,
} from './customer-context';

type PurchaseRequest = Extract<
  PendingInformationRequest,
  { kind: 'purchase' }
>;

/**
 * Phone-scoped Agent API capabilities are optional while the backend rollout
 * is in progress. Keeping this narrow local view lets the orchestrator remain
 * compatible with gateways that have not enabled the new routes yet.
 */
type PhoneEventDetailSuccess = Extract<
  AgentEventDetailResult,
  { status: 'success' }
> & {
  /** New enriched responses expose these alongside `event`. */
  attendance?: {
    guestId: number;
    name: string;
    hasResponded: boolean;
    willAttend: boolean | null;
    responseDate: string | null;
  } | null;
  purchases?: PurchaseInformation[];
};

export type HydratedEventDetail = PhoneEventDetailSuccess;

type PhoneEventDetailResult =
  | PhoneEventDetailSuccess
  | Exclude<AgentEventDetailResult, { status: 'success' }>;

type EventDetailCache = Map<string, Promise<PhoneEventDetailResult>>;

type PhoneContextSnapshot = {
  /** Keyed by source + partition + stable order id, never by ID alone. */
  purchasesByOrderId: Map<string, PurchaseInformation>;
  cartsById: Map<string, CartInformation>;
  inconsistentOrderIds: Set<string>;
};

/**
 * Phone-authorized guest-event root fetched once per purchase-only turn
 * through the same shared flight the event path consumes. Associations,
 * bounded hydrated details, failures and truncation travel here so the
 * purchase execution below reuses them instead of re-running scoped
 * discovery. Built with the existing hydration and event mapping only.
 */
type SeededGuestRoot = {
  events: AgentGuestEventSummary[];
  details: Map<number, HydratedEventDetail>;
  failures: Array<{ eventId: number; failureKind: EventDetailHydrationFailureKind }>;
  truncatedByBound: boolean;
  phoneNumber: string;
};

/**
 * Partition metadata is kept outside PurchaseInformation so it cannot leak
 * into the reply projection. Gateways may expose either the camel-case or
 * snake-case envelope while the endpoint rollout is in progress.
 */
type PartitionedPurchaseLookup = {
  purchases: PurchaseInformation[];
  carts: CartInformation[];
  hasPartitions: boolean;
  conflictingOrderIds: Set<string>;
};

async function settleWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: Array<PromiseSettledResult<R> | undefined> = Array.from(
    { length: values.length },
    () => undefined,
  );
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      const value = values[index];
      try {
        results[index] = { status: 'fulfilled', value: await operation(value, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }));
  return results.filter(
    (result): result is PromiseSettledResult<R> => result !== undefined,
  );
}

function phonePurchaseKey(
  purchase: PurchaseInformation,
  source: PurchaseRecordSource,
  partition: PurchasePartition,
  variant = 0,
): string {
  return JSON.stringify([source, partition, purchase.orderId, variant]);
}

function phonePurchasesForIds(
  snapshot: PhoneContextSnapshot,
  orderIds: ReadonlySet<string>,
): PurchaseInformation[] {
  return [...snapshot.purchasesByOrderId.values()].filter((purchase) =>
    orderIds.has(purchase.orderId),
  );
}

function hasPurchaseFactConflict(
  left: PurchaseInformation,
  right: PurchaseInformation,
): boolean {
  const provenance = new Set([
    'recordSource',
    'accessScope',
    'partition',
    'itemSourceConflict',
    'creditFulfillmentPolicy',
    'currencyConflict',
  ]);
  const authoritative = (value: unknown): boolean =>
    value !== null && value !== undefined &&
    !(typeof value === 'string' && value.trim() === '') &&
    !(Array.isArray(value) && value.length === 0);
  for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (provenance.has(field)) continue;
    const leftValue = (left as unknown as Record<string, unknown>)[field];
    const rightValue = (right as unknown as Record<string, unknown>)[field];
    if (authoritative(leftValue) && authoritative(rightValue) &&
      JSON.stringify(leftValue) !== JSON.stringify(rightValue)) return true;
  }
  return false;
}

type SuccessfulPurchaseLookup =
  | Extract<AgentPhonePurchaseLookupResult, { status: 'success' }>
  | Extract<AgentPurchaseLookupResult, { status: 'success' }>;

type PurchaseTaskResult = Extract<
  InformationTaskResult,
  { kind: 'purchase'; status: 'completed' }
> & {
  /** Optional because authenticated legacy lookups do not carry carts. */
  carts?: CartInformation[];
};

export type InformationAuthentication = {
  token: string;
  email: string;
};

export type InformationAuthBlock = {
  nextInput: 'email' | 'otp' | 'phone_confirmation' | 'retry';
  guidance: InformationAuthGuidance;
};

export type InformationExecution = {
  results: InformationTaskResult[];
  summaries: InformationExecutionSummary[];
  /** Updated canonical customer facts when a prepared profile was supplied. */
  customerContext?: CustomerContextSnapshot;
};

type MutableCustomerReadMetrics = {
  totalReads: number;
  activeReads: number;
  peakConcurrency: number;
  readsByOperation: Record<string, number>;
};

export type EventDetailHydrationFailureKind =
  | 'not_found'
  | 'request_failed'
  | 'not_configured'
  | 'deadline_exceeded';

export type EventDetailHydrationOutcome = {
  /** Event details hydrated this pass, keyed by stable event id. */
  details: Map<number, HydratedEventDetail>;
  /** Event-scoped purchases surfaced by hydrated details (2nd edge). */
  purchases: PurchaseInformation[];
  failures: Array<{ eventId: number; failureKind: EventDetailHydrationFailureKind }>;
  readsAttempted: number;
  truncatedByBound: boolean;
};

export type CustomerLinkedEnrichment = {
  /** Gift-detail purchases fetched for explicitly targeted orders (edge 1). */
  readonly giftPurchases: readonly PurchaseInformation[];
  /** Event details fetched for explicitly targeted events (edge 2). */
  readonly eventDetails: ReadonlyMap<number, HydratedEventDetail>;
  readonly readsAttempted: number;
  readonly truncatedByBound: boolean;
  /** Required linked detail that stayed unavailable (explicit target). */
  readonly unavailable: readonly string[];
  readonly failures: ReadonlyArray<{ target: string; failureKind: string }>;
};

/**
 * Transaction numbers are visible within an authorized customer scope.
 * The caller establishes account or trusted-phone authorization; an exact
 * requested reference also validates a narrower lookup.
 */
export function transactionReferenceVisible(
  purchase: Pick<PurchaseInformation, 'customerTransactionNumber'>,
  options?: {
    readonly transactionReferenceAuthorized?: boolean;
    readonly requestedCustomerTransactionNumber?: string | null;
  },
): boolean {
  if (options?.transactionReferenceAuthorized === true) return true;
  const requested = options?.requestedCustomerTransactionNumber ?? null;
  const record = purchase.customerTransactionNumber ?? null;
  return requested !== null && record !== null && record === requested;
}

/**
 * Typed purchase evidence for completed purchase summaries. One entry per
 * order carrying the O5 purchaseFact the live judge projects; the hash
 * binds the order identity to the fact bytes. Private dedication text is
 * redacted (operational send/physical state still travels). Carts are
 * never passed here: checkout evidence is not order evidence.
 */
export function projectPurchaseEvidenceItems(
  purchases: PurchaseInformation[],
): InformationExecutionSummary['evidence'] {
  return purchases.map((purchase) => {
    const dedication = purchase.dedication;
    const purchaseFact = {
      eventLabel: purchase.eventName,
      total: purchase.grandTotal,
      currency: purchase.currency ?? null,
      currencySymbol: purchase.currencySymbol ?? null,
      paymentMethod: purchase.paymentMethod,
      paymentStatus: purchase.paymentStatus,
      shippingStatus: purchase.shippingStatus,
      eventDate: purchase.eventDate,
      createdAt: purchase.createdAt,
      referencePresent: typeof purchase.customerTransactionNumber === 'string' &&
        purchase.customerTransactionNumber.length > 0,
      ...(dedication
        ? {
          dedication: {
            message: dedication.isPrivate === true ? null : dedication.message,
            sendPhysical: dedication.sendPhysical,
            physicalStatus: dedication.physicalStatus,
          },
        }
        : {}),
      items: purchase.items.map((item) => ({
        name: item.giftName,
        quantity: item.quantity,
        amount: item.amount,
        rowTotal: item.rowTotal,
        fulfillment: item.fulfillment?.kind ?? null,
      })),
    };
    return {
      fileId: '',
      filename: '',
      score: 0,
      contentHash: crypto.createHash('sha256')
        .update(JSON.stringify({ orderId: purchase.orderId, fact: purchaseFact }))
        .digest('hex'),
      purchaseFact,
    };
  });
}

export class InformationOrchestrator {
  private activeCustomerReads = 0;
  private readonly customerReadWaiters: Array<() => void> = [];
  private readonly customerReadMetrics = new AsyncLocalStorage<MutableCustomerReadMetrics>();

  constructor(
    private readonly dependencies: {
      knowledgeGateway: KnowledgeRetrievalGateway;
      providerGateway: ProviderGateway;
      agentGateway: AgentConversationGateway;
      capabilityManifest?: RuntimeCapabilityManifest;
    },
  ) {}

  /** Four in-flight customer reads maximum; waiting work is never discarded. */
  private async withCustomerRead<T>(operation: string, read: () => Promise<T>): Promise<T> {
    if (this.activeCustomerReads >= enrichmentBounds.maxConcurrentReads) {
      await new Promise<void>((resolve) => this.customerReadWaiters.push(resolve));
    } else {
      this.activeCustomerReads += 1;
    }
    const metrics = this.customerReadMetrics.getStore();
    if (metrics) {
      metrics.totalReads += 1;
      metrics.activeReads += 1;
      metrics.peakConcurrency = Math.max(metrics.peakConcurrency, metrics.activeReads);
      metrics.readsByOperation[operation] = (metrics.readsByOperation[operation] ?? 0) + 1;
    }
    try {
      return await read();
    } finally {
      if (metrics) metrics.activeReads -= 1;
      const next = this.customerReadWaiters.shift();
      if (next) {
        next();
      } else {
        this.activeCustomerReads -= 1;
      }
    }
  }

  private capabilityAvailable(
    operation: RuntimeOperationId,
    fallback = true,
  ): boolean {
    const manifest = this.dependencies.capabilityManifest ??
      this.dependencies.agentGateway.capabilityDescriptor;
    return manifest?.[operation].available ?? fallback;
  }

  private gatewayMethodConfigured(method: keyof AgentConversationGateway): boolean {
    return typeof Reflect.get(this.dependencies.agentGateway, method) === 'function';
  }

  /**
   * Requested sources for one purchase read. A discovery request names both
   * real sources; an established source names only itself. Aspects never
   * expand this list.
   */
  private requestedPurchaseSources(
    request: PurchaseRequest,
  ): PurchaseResource[] {
    return request.resource === 'purchase_discovery'
      ? ['orders', 'gift_purchases']
      : [request.resource];
  }

  private purchaseOperationForSource(source: PurchaseResource): RuntimeOperationId {
    return source === 'orders' ? 'purchase.orders.read' : 'purchase.gift_detail.read';
  }

  /**
   * Phone-authorized sources available for this request. A discovery read
   * proceeds when at least one source is available; unavailable sources
   * become coverage below, never a bypass attempt.
   */
  private phonePurchaseSources(request: PurchaseRequest): PurchaseResource[] {
    return this.requestedPurchaseSources(request).filter((source) =>
      this.capabilityAvailable(
        this.purchaseOperationForSource(source),
        this.gatewayMethodConfigured(
          source === 'orders' ? 'getGuestOrdersByPhone' : 'getGuestGiftPurchasesByPhone',
        ),
      ),
    );
  }

  /** Authenticated-account sources available for this request. */
  private accountPurchaseSources(request: PurchaseRequest): PurchaseResource[] {
    return this.requestedPurchaseSources(request).filter((source) =>
      this.capabilityAvailable(
        this.purchaseOperationForSource(source),
        this.gatewayMethodConfigured(
          source === 'orders' ? 'getOrders' : 'getGiftPurchases',
        ),
      ),
    );
  }

  /** Capability reason for an unavailable discovery source (coverage, not a read). */
  private unavailableSourceStatus(
    source: PurchaseResource,
  ): 'unauthorized' | 'unavailable' {
    const manifest = this.dependencies.capabilityManifest ??
      this.dependencies.agentGateway.capabilityDescriptor;
    const reason = manifest?.[this.purchaseOperationForSource(source)]?.reason;
    if (reason === 'not_authorized') return 'unauthorized';
    return 'unavailable';
  }

  /**
   * Exact customer transaction reference the turn supplied (COD code in
   * orderId or a bare-code query). Identity evidence only; amounts, names
   * and event hints never qualify.
   */
  private parseRequestedCustomerTransactionNumber(
    request: PurchaseRequest,
  ): string | null {
    const parsedOrderIdReference = parseOrderReference(request.orderId);
    const parsedQueryReference = parseOrderReference(request.query);
    // The extractor normally places a bare COD reference in orderId, but a
    // bare-code query without orderId is still an explicit customer
    // reference. Only a customer_transaction parse qualifies; anything else
    // in the query is never treated as a backend id filter.
    if (parsedOrderIdReference?.kind === 'customer_transaction') {
      return parsedOrderIdReference.transactionNumber;
    }
    if (parsedQueryReference?.kind === 'customer_transaction') {
      return parsedQueryReference.transactionNumber;
    }
    return null;
  }

  /**
   * Load the full authorized customer profile before extraction. These
   * internal reads do not depend on an extraction route, resource, aspect or
   * record reference; subsequent task execution reuses this snapshot.
   */
  async prepareCustomerContext(args: {
    readonly authentication: InformationAuthentication | null;
    readonly trustedPhone: AgentAuthByPhoneInput | null;
    readonly identity: IdentityEvidence | null;
    readonly currentContext: CurrentContextEvidence | null;
    readonly deadlineMs: number | null;
  }): Promise<CustomerContextSnapshot> {
    const nowIso = new Date().toISOString();
    const authorized = args.authentication !== null || args.trustedPhone !== null;
    const noReads: CustomerReadMetrics = {
      totalReads: 0,
      peakConcurrency: 0,
      readsByOperation: {},
    };
    if (!authorized) {
      const unavailable = assembleCustomerContext({
        execution: null,
        identity: null,
        currentContext: args.currentContext,
        nowIso,
      });
      return {
        ...unavailable,
        identityAccess: {
          ...unavailable.identityAccess,
          status: 'unavailable',
          source: 'authorization',
        },
        purchasesCarts: {
          ...unavailable.purchasesCarts,
          status: 'unavailable',
          source: 'authorization',
        },
        invitationsEvents: {
          ...unavailable.invitationsEvents,
          status: 'unavailable',
          source: 'authorization',
        },
        readMetrics: noReads,
      };
    }

    if (args.deadlineMs !== null && Date.now() >= args.deadlineMs) {
      const expired = assembleCustomerContext({
        execution: null,
        identity: args.identity ?? {
          customerRef: null,
          scope: args.authentication ? 'account' : 'trusted_phone_purchase',
          source: 'agent_api',
        },
        currentContext: args.currentContext,
        nowIso,
      });
      return {
        ...expired,
        purchasesCarts: { ...expired.purchasesCarts, status: 'failed', source: 'deadline' },
        invitationsEvents: { ...expired.invitationsEvents, status: 'failed', source: 'deadline' },
        readMetrics: noReads,
      };
    }

    const metrics: MutableCustomerReadMetrics = {
      totalReads: 0,
      activeReads: 0,
      peakConcurrency: 0,
      readsByOperation: {},
    };
    return this.customerReadMetrics.run(metrics, async () => {
      const readScope = async (
        scope: 'account' | 'trusted_phone_purchase',
      ): Promise<InformationExecution> => {
        const suffix = scope === 'account' ? 'account' : 'phone';
        const requests: PendingInformationRequest[] = [
          {
            requestId: `customer-context-${suffix}-purchases`,
            kind: 'purchase',
            resource: 'purchase_discovery',
            query: 'customer context',
            orderId: null,
            authAction: 'none',
          },
          {
            requestId: `customer-context-${suffix}-events`,
            kind: 'associated_event',
            query: 'customer context',
            eventHint: null,
            authAction: 'none',
          },
        ];
        return this.execute({
          requests,
          authentication: scope === 'account' ? args.authentication : null,
          authBlock: null,
          trustedPhone: scope === 'trusted_phone_purchase' ? args.trustedPhone : null,
          deadlineMs: args.deadlineMs,
          hydrateAllAuthorizedEventDetails: true,
        });
      };
      const [executions, phoneAccountEvents] = await Promise.all([
        Promise.all([
        ...(args.authentication ? [readScope('account')] : []),
        ...(args.trustedPhone ? [readScope('trusted_phone_purchase')] : []),
        ]),
        args.trustedPhone
          ? this.readVerifiedPhoneAccountEvents(args.trustedPhone)
          : Promise.resolve(null),
      ]);
      const execution: InformationExecution = {
        results: [
          ...executions.flatMap((entry) => entry.results),
          ...(phoneAccountEvents ? [phoneAccountEvents.result] : []),
        ],
        summaries: [
          ...executions.flatMap((entry) => entry.summaries),
          ...(phoneAccountEvents ? [phoneAccountEvents.summary] : []),
        ],
      };
      const preferredScope = args.authentication ? 'account' : 'trusted_phone_purchase';
      const identity: IdentityEvidence = {
        ...(args.identity ?? {
          customerRef: null,
          scope: preferredScope,
          source: 'agent_api',
        }),
        scope: preferredScope,
        email: args.identity?.email ?? args.authentication?.email ?? null,
        phone: args.identity?.phone ?? (args.trustedPhone
          ? `${args.trustedPhone.phone_extension}${args.trustedPhone.phone_number}`
          : null),
        authorizedScopes: [
          ...(args.authentication ? ['account'] : []),
          ...(args.trustedPhone ? ['trusted_phone_purchase'] : []),
        ],
      };
      const snapshot = assembleCustomerContext({
        execution,
        identity,
        currentContext: args.currentContext,
        nowIso,
      });
      const readMetrics: CustomerReadMetrics = {
        totalReads: metrics.totalReads,
        peakConcurrency: metrics.peakConcurrency,
        readsByOperation: { ...metrics.readsByOperation },
      };
      return { ...snapshot, readMetrics };
    });
  }

  private async readVerifiedPhoneAccountEvents(
    phone: AgentAuthByPhoneInput,
  ): Promise<{ result: InformationTaskResult; summary: InformationExecutionSummary }> {
    const requestId = 'customer-context-phone-account-events';
    const queryHash = crypto.createHash('sha256')
      .update('verified-phone-account-events')
      .digest('hex');
    const startedAt = Date.now();
    const failed = (failureKind: 'unauthorized' | 'request_failed') => ({
      result: {
        requestId,
        kind: 'associated_event' as const,
        status: 'failed' as const,
        retryable: failureKind === 'request_failed',
        failureKind,
        accessMethod: 'trusted_phone_guest' as const,
        message: 'The verified phone account event source is unavailable.',
      },
      summary: {
        requestId,
        kind: 'associated_event' as const,
        status: 'failed' as const,
        source: 'associated_event_api' as const,
        outcomeCode: failureKind,
        retryable: failureKind === 'request_failed',
        queryHash,
        evidence: [],
        resultCount: 0,
        durationMs: Date.now() - startedAt,
        accessMethod: 'trusted_phone_guest' as const,
      },
    });
    try {
      const lookup = await this.withCustomerRead('provider.phone_user_events', () =>
        this.dependencies.providerGateway.lookupUserEventContext({
          email: null,
          phone: phone.phone_number,
        }),
      );
      if (!lookup) {
        return {
          result: {
            requestId, kind: 'associated_event', status: 'completed',
            accessMethod: 'trusted_phone_guest',
            result: {
              lookup: { email: null, phone: phone.phone_number },
              user: null, events: [], recentOrders: [],
              counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0,
                celebratedEvents: 0, recentOrders: 0 },
            },
          },
          summary: {
            requestId, kind: 'associated_event', status: 'completed',
            source: 'associated_event_api', outcomeCode: 'completed_without_results',
            retryable: null, queryHash, evidence: [], resultCount: 0,
            durationMs: Date.now() - startedAt, accessMethod: 'trusted_phone_guest',
          },
        };
      }
      const actual = lookup.user?.fullPhone?.replace(/\D/gu, '') ?? '';
      const expected = `${phone.phone_extension}${phone.phone_number}`.replace(/\D/gu, '');
      if (actual !== expected) {
        if (lookup.user === null && lookup.events.length === 0) {
          return {
            result: {
              requestId, kind: 'associated_event', status: 'completed',
              accessMethod: 'trusted_phone_guest',
              result: { ...lookup, recentOrders: [], counts: { ...lookup.counts, recentOrders: 0 } },
            },
            summary: {
              requestId, kind: 'associated_event', status: 'completed',
              source: 'associated_event_api', outcomeCode: 'completed_without_results',
              retryable: null, queryHash, evidence: [], resultCount: 0,
              durationMs: Date.now() - startedAt, accessMethod: 'trusted_phone_guest',
            },
          };
        }
        return failed('unauthorized');
      }
      // The phone confirms association, not account authentication. Include
      // event identity/logistics and roles; keep account and financial fields
      // behind the authenticated account scope.
      const events = lookup.events.map((event) => ({
        ...event,
        amountCollected: null,
        amountTransferred: null,
        transactionsCount: null,
        hostPermission: null,
        hostStatus: null,
        guestStatus: null,
        orders: [],
        orderIds: [],
      }));
      const result: InformationTaskResult = {
        requestId,
        kind: 'associated_event',
        status: 'completed',
        accessMethod: 'trusted_phone_guest',
        result: {
          ...lookup,
          user: null,
          events,
          recentOrders: [],
          counts: { ...lookup.counts, recentOrders: 0 },
        },
      };
      return { result, summary: {
        requestId,
        kind: 'associated_event',
        status: 'completed',
        source: 'associated_event_api',
        outcomeCode: events.length > 0 ? 'completed_with_results' : 'completed_without_results',
        retryable: null,
        queryHash,
        evidence: [],
        resultCount: events.length,
        durationMs: Date.now() - startedAt,
        accessMethod: 'trusted_phone_guest',
      } };
    } catch {
      return failed('request_failed');
    }
  }

  async execute(args: {
    requests: PendingInformationRequest[];
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock | null;
    trustedPhone?: AgentAuthByPhoneInput | null;
    preparedCustomerContext?: CustomerContextSnapshot;
    /** The preparation path hydrates every known event ID before extraction. */
    hydrateAllAuthorizedEventDetails?: boolean;
    /** Current invocation deadline (epoch ms). Past it, bounded detail reads stop. */
    deadlineMs?: number | null;
  }): Promise<InformationExecution> {
    const canUseTrustedPhone =
      !args.authBlock || args.authBlock.guidance.reason === 'email_required';
    const phoneGateway = this.dependencies.agentGateway;
    const phonePurchaseLookups = new Map<
      string,
      Promise<AgentPhonePurchaseLookupResult | undefined>
    >();
    // P1 auth-scoped per-turn caches: repeated scoped lookups run once per
    // turn. Phone keys carry the verified phone scope; account keys carry a
    // token hash scope so an auth change can never reuse broader cached
    // access. Event detail keys carry the same access scope.
    const accountPurchaseLookups = new Map<
      string,
      Promise<AgentPurchaseLookupResult | undefined>
    >();
    const eventDetailLookups: EventDetailCache = new Map();
    const phoneContext: PhoneContextSnapshot = {
      purchasesByOrderId: new Map(),
      cartsById: new Map(),
      inconsistentOrderIds: new Set(),
    };
    const guestEventsPromise =
      !args.preparedCustomerContext &&
      !args.authentication &&
      canUseTrustedPhone &&
      args.trustedPhone &&
      this.capabilityAvailable('event.association.read', this.gatewayMethodConfigured('getGuestEventsByPhone')) &&
      args.requests.some((request) => request.kind === 'associated_event' || request.kind === 'purchase')
        ? this.lookupGuestEvents(args.trustedPhone)
        : null;
    const outcomes = new Map<number, { result: InformationTaskResult; durationMs: number }>();
    const executeIndexes = async (
      indexes: number[],
      seededRootPromise: Promise<SeededGuestRoot | null> | null = null,
    ): Promise<void> => {
      const settled = await Promise.allSettled(
        indexes.map(async (index) => {
          const request = args.requests[index];
          if (!request) {
            throw new Error('Information request index is unavailable.');
          }
        const startedAt = Date.now();
        const result = await this.executeRequest(
          request,
          args.authentication,
          args.authBlock,
          guestEventsPromise,
          args.trustedPhone ?? null,
          phoneGateway,
          phonePurchaseLookups,
          eventDetailLookups,
          phoneContext,
          args.deadlineMs ?? null,
          accountPurchaseLookups,
          seededRootPromise,
          args.preparedCustomerContext,
          args.hydrateAllAuthorizedEventDetails === true,
        );
          return { result, durationMs: Date.now() - startedAt };
        }),
      );
      settled.forEach((entry, settledIndex) => {
        const requestIndex = indexes[settledIndex];
        const request = requestIndex === undefined ? undefined : args.requests[requestIndex];
        if (requestIndex === undefined || !request) {
          return;
        }
      if (entry.status === 'fulfilled') {
          outcomes.set(requestIndex, entry.value);
        return;
      }
        outcomes.set(requestIndex, {
          durationMs: 0,
          result: {
            requestId: request.requestId,
            kind: request.kind,
            status: 'failed',
            retryable: true,
            failureKind: 'request_failed',
            message:
              entry.reason instanceof Error
                ? entry.reason.message
                : 'No se pudo completar esta consulta.',
          },
        });
      });
    };

    const nonPurchaseIndexes = args.requests
      .map((request, index) => ({ request, index }))
      .filter(({ request }) => request.kind !== 'purchase')
      .map(({ index }) => index);
    const purchaseIndexes = args.requests
      .map((request, index) => ({ request, index }))
      .filter(({ request }) => request.kind === 'purchase')
      .map(({ index }) => index);
    // Entry roots together: purchase turns share the same phone-authorized
    // guest-event root that associated_event requests consume, so
    // event-scoped purchases are reused within the turn instead of running
    // a second scoped discovery. The seeding runs together with the
    // non-purchase requests over the same single shared flight (bounded
    // existing hydration, read-only); purchase requests below reuse the
    // merged snapshot results plus their own authorized purchase roots.
    // Turns without purchase work or with their own associated_event
    // request seed nothing here. Independent root reads (guest events,
    // bounded detail hydration, purchase roots) start together where
    // dependencies allow: the purchase path awaits the shared seed while
    // its own purchase-root gateway call is already in flight.
    const rootSeedPromise = this.seedPhoneContextFromGuestRoot({
      requests: args.requests,
      guestEventsPromise,
      trustedPhone: args.trustedPhone ?? null,
      eventDetailLookups,
      phoneContext,
      deadlineMs: args.deadlineMs ?? null,
    });
    // Ordering dependency: a purchase alongside its own associated_event
    // request reuses that request's merged event-scoped purchases, so it
    // runs after the non-purchase work. Purchase-only turns have no such
    // dependency (the seed is the only phone-context writer), so their
    // purchase-root gateway calls start together with the bounded
    // hydration instead of waiting on it.
    if (
      args.requests.some((request) => request.kind === 'associated_event') &&
      !args.authentication
    ) {
      await executeIndexes(nonPurchaseIndexes);
      await rootSeedPromise;
      await executeIndexes(purchaseIndexes, rootSeedPromise);
    } else {
      const purchaseRun = executeIndexes(purchaseIndexes, rootSeedPromise);
      await Promise.all([executeIndexes(nonPurchaseIndexes), purchaseRun]);
      await rootSeedPromise;
    }

    const results = this.reconcilePhoneContextResults(
      args.requests,
      args.requests.map((request, index) =>
        outcomes.get(index)?.result ?? {
          requestId: request.requestId,
          kind: request.kind,
          status: 'failed' as const,
          retryable: true,
          failureKind: 'request_failed' as const,
          message: 'No se pudo completar esta consulta.',
        }),
      phoneContext,
    );
    const summaries = results.map((result, index): InformationExecutionSummary => {
      const request = args.requests[index];
      if (!request) {
        throw new Error('Information result has no matching request.');
      }
      // Trace contract (Lane C F1): a summary names one real backend
      // source or none at all. Discovery spans sources, so it always
      // omits `resource`; per-source facts travel in `sourceCoverage`
      // and evidence purchaseFacts. Emitting the request-only
      // `purchase_discovery` value would fail live-trace parsing.
      const lookupResource =
        result.kind === 'purchase' && 'lookupResource' in result
          ? result.lookupResource
          : undefined;
      const requestedResource =
        request.kind === 'purchase' ? request.resource : undefined;
      const summaryResource =
        requestedResource === 'purchase_discovery'
          ? undefined
          : (lookupResource ?? requestedResource);
      return {
        requestId: request.requestId,
        kind: request.kind,
        status: result.status,
        source: this.sourceFor(request),
        outcomeCode: this.outcomeCode(result),
        retryable: result.status === 'failed' ? result.retryable : null,
        queryHash: this.hash(request.query),
        evidence: this.evidenceReferences(result),
        resultCount: this.resultCount(result),
        durationMs: outcomes.get(index)?.durationMs ?? 0,
        ...(result.openAiTransport ? { openAiTransport: result.openAiTransport } : {}),
        ...(result.kind === 'purchase' &&
        (result.status === 'completed' || result.status === 'failed') &&
        result.sourceCoverage
          ? { sourceCoverage: result.sourceCoverage }
          : {}),
        ...(result.status === 'completed' && result.kind === 'associated_event'
          ? {
              accessMethod: result.accessMethod ?? 'authenticated_account',
              eventDetailCount: result.result.events.filter(
                (event) => event.detail !== undefined,
              ).length,
            }
          : result.status === 'completed' && result.kind === 'purchase'
            ? {
                accessMethod: result.accessMethod ?? 'authenticated_account',
                ...(result.coverage === undefined ? {} : { coverage: result.coverage }),
                ...(summaryResource ? { resource: summaryResource } : {}),
              }
            : result.status === 'failed' && result.accessMethod
            ? {
                accessMethod: result.accessMethod,
                coverage: null,
                ...(summaryResource ? { resource: summaryResource } : {}),
              }
            : {}),
      };
    });

    const customerContext = args.preparedCustomerContext
      ? mergeExecutionIntoSnapshot({
        base: args.preparedCustomerContext,
        execution: { results, summaries },
        identity: null,
        currentContext: null,
        nowIso: new Date().toISOString(),
      })
      : undefined;
    return { results, summaries, ...(customerContext ? { customerContext } : {}) };
  }

  private async executeRequest(
    request: PendingInformationRequest,
    authentication: InformationAuthentication | null,
    authBlock: InformationAuthBlock | null,
    guestEventsPromise: Promise<AgentGuestEventsResult> | null,
    trustedPhone: AgentAuthByPhoneInput | null,
    phoneGateway: AgentConversationGateway,
    phonePurchaseLookups: Map<
      string,
      Promise<AgentPhonePurchaseLookupResult | undefined>
    >,
    eventDetailLookups: EventDetailCache,
    phoneContext: PhoneContextSnapshot,
    deadlineMs: number | null,
    accountPurchaseLookups?: Map<string, Promise<AgentPurchaseLookupResult | undefined>>,
    seededRootPromise?: Promise<SeededGuestRoot | null> | null,
    preparedCustomerContext?: CustomerContextSnapshot,
    hydrateAllAuthorizedEventDetails = false,
  ): Promise<InformationTaskResult> {
    if (request.kind === 'faq') {
      if (!this.capabilityAvailable('faq.read')) {
        return {
          requestId: request.requestId,
          kind: 'faq',
          status: 'failed',
          retryable: false,
          failureKind: 'not_configured',
          message: 'La consulta de información general no está disponible en este momento. Puedo comunicarte con una persona del equipo.',
        };
      }
      const retrieval = request.hostWithdrawal
        ? await this.dependencies.knowledgeGateway.search(hostWithdrawalPolicyQuery, { rewriteQuery: false })
        : await this.dependencies.knowledgeGateway.search(request.query);
      if (retrieval.status === 'success') {
        if (request.hostWithdrawal) {
          const parsed = parseHostWithdrawalPolicy(retrieval.evidence);
          return {
            requestId: request.requestId, kind: 'faq', status: 'completed',
            evidence: parsed.evidence, hostWithdrawalPolicy: parsed.policy,
            openAiTransport: retrieval.openAiTransport,
          };
        }
        return {
          requestId: request.requestId,
          kind: 'faq',
          status: 'completed',
          evidence: retrieval.evidence,
          citationUrl: firstFullArticleSourceUrl(retrieval.evidence),
          openAiTransport: retrieval.openAiTransport,
        };
      }
      return {
        requestId: request.requestId,
        kind: 'faq',
        status: 'failed',
        retryable: retrieval.retryable,
        failureKind:
          retrieval.reason === 'not_configured'
            ? 'not_configured'
            : 'request_failed',
        message:
          'No pude consultar la información general en este momento. Puedo intentarlo nuevamente o comunicarte con una persona del equipo.',
        ...(retrieval.openAiTransport ? { openAiTransport: retrieval.openAiTransport } : {}),
      };
    }

    if (
      !authentication &&
      authBlock &&
      !(authBlock.guidance.reason === 'email_required' && trustedPhone)
    ) {
      return {
        requestId: request.requestId,
        kind: request.kind,
        status: 'needs_input',
        nextInput: authBlock.nextInput,
        guidance: authBlock.guidance,
      };
    }

    if (preparedCustomerContext && request.kind === 'purchase') {
      return this.purchaseResultFromPreparedContext(request, preparedCustomerContext);
    }
    if (preparedCustomerContext && request.kind === 'associated_event') {
      return this.eventResultFromPreparedContext(request, preparedCustomerContext);
    }

    if (
      request.kind === 'associated_event' &&
      !authentication &&
      guestEventsPromise
    ) {
      const guestEvents = await guestEventsPromise;
      if (guestEvents.status === 'success' && guestEvents.events.length > 0) {
        return await this.executeGuestEventRequest(
          request,
          guestEvents.events,
          trustedPhone ?? null,
          phoneGateway,
          eventDetailLookups,
          phoneContext,
          deadlineMs,
          hydrateAllAuthorizedEventDetails,
        );
      }
      if (guestEvents.status === 'failed') {
        return {
          requestId: request.requestId,
          kind: 'associated_event',
          status: 'failed',
          retryable: guestEvents.retryable,
          accessMethod: 'trusted_phone_guest',
          failureKind: this.gatewayMethodConfigured('getGuestEventsByPhone')
            ? 'request_failed'
            : 'not_configured',
          message: guestEvents.retryable
            ? 'No pude consultar los eventos asociados a tu número en este momento. Puedo intentarlo nuevamente.'
            : 'La consulta de eventos asociados al número no está disponible en este momento. Puedo comunicarte con una persona del equipo.',
        };
      }
      // A completed phone lookup with no association is not a request to log in.
      // Preserve scoped absence for the service's human-help policy and trace.
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: false,
        accessMethod: 'trusted_phone_guest',
        failureKind: 'not_found',
        message: 'No encontré eventos asociados a este número en la consulta realizada. Se necesita apoyo del equipo para revisar esta consulta.',
      };
    }

    if (
      request.kind === 'associated_event' &&
      !authentication &&
      !guestEventsPromise &&
      !this.capabilityAvailable('event.association.read', this.gatewayMethodConfigured('getGuestEventsByPhone'))
    ) {
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: false,
        failureKind: 'not_configured',
        message: 'La consulta de eventos asociados no está disponible en este momento. Puedo comunicarte con una persona del equipo.',
      };
    }

    if (!authentication) {
      if (
        request.kind === 'purchase' &&
        trustedPhone &&
        (!authBlock || authBlock.guidance.reason === 'email_required') &&
        this.phonePurchaseSources(request).length > 0
      ) {
        return await this.executePhonePurchaseRequest(
          request,
          trustedPhone,
          phoneGateway,
          phonePurchaseLookups,
          phoneContext,
          seededRootPromise ?? null,
        );
      }
      return {
        requestId: request.requestId,
        kind: request.kind,
        status: 'needs_input',
        nextInput: authBlock?.nextInput ?? 'email',
        guidance:
          authBlock?.guidance ??
          createInformationAuthGuidance('email_required', null),
      };
    }

    if (
      request.kind === 'purchase' &&
      this.accountPurchaseSources(request).length === 0
    ) {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: false,
        failureKind: 'not_configured',
        message: 'La consulta de compras no está disponible en este momento. Puedo comunicarte con una persona del equipo.',
      };
    }

    if (request.kind === 'associated_event') {
      try {
        const result = await this.withCustomerRead('provider.user_events', () =>
          this.dependencies.providerGateway.lookupAuthenticatedUserEvents({
            token: authentication.token,
            email: authentication.email,
          }),
        );
        if (!result) {
          return {
            requestId: request.requestId,
            kind: 'associated_event',
            status: 'failed',
            retryable: false,
            failureKind: 'not_found',
            message:
              'No encontré eventos asociados a ese correo. Revisa que sea el correo usado en Sin Envolturas.',
          };
        }
        return {
          requestId: request.requestId,
          kind: 'associated_event',
          status: 'completed',
          result,
          accessMethod: 'authenticated_account',
        };
      } catch (error) {
        const unauthorized =
          error instanceof Error && /\b401\b/u.test(error.message);
        return {
          requestId: request.requestId,
          kind: 'associated_event',
          status: 'failed',
          retryable: true,
          failureKind: unauthorized ? 'unauthorized' : 'request_failed',
          message: unauthorized
            ? 'La sesión venció o no pudo validarse. Necesito verificar tu correo nuevamente.'
            : 'No pude consultar tus eventos en este momento. Puedo intentarlo nuevamente.',
        };
      }
    }

    if (request.kind === 'purchase' && request.resource === 'purchase_discovery') {
      return await this.executeDiscoveryAccountPurchaseRequest(
        request,
        authentication,
        accountPurchaseLookups,
      );
    }
    if (request.kind !== 'purchase' || request.resource === 'purchase_discovery') {
      throw new Error('Unreachable: discovery and non-purchase requests return before single-source execution.');
    }

    const lookup = await this.lookupPurchase(
      request,
      authentication.token,
      request.orderId,
      accountPurchaseLookups,
    );
    if (!lookup) {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: false,
        failureKind: 'not_configured',
        message:
          'La consulta de compras no está configurada. Puedo comunicarte con una persona del equipo.',
        lookupResource: request.resource,
      };
    }

    // No exact-order re-read: the verified endpoint contract returns
    // the same record shape with or without the order filter, so a
    // discovery result already answers from its own facts. A second read
    // would spend a backend call to relearn nothing.
    if (lookup.status === 'success') {
      const evidence = this.partitionedPurchaseLookup(lookup);
      const candidates = this.filterPurchaseCandidates(evidence.purchases);
      const carts = evidence.carts;
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: request.resource,
        lookupResource: request.resource,
        purchases: candidates.purchases.map((purchase) =>
          this.projectPurchase(purchase, request, { transactionReferenceAuthorized: true }),
        ),
        needsSelection: !request.orderId && candidates.needsSelection,
        coverage: carts.length > 0 && candidates.purchases.length === 0
          ? 'partial'
          : 'complete',
      };
    }

    if (lookup.status === 'not_found') {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: false,
        failureKind: 'not_found',
        message:
          'No encontré esa orden entre las compras de la cuenta autenticada. Revisa el número de orden.',
        lookupResource: request.resource,
      };
    }

    if (lookup.status === 'unauthorized') {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: true,
        failureKind: 'unauthorized',
        message:
          'La sesión venció o no pudo validarse. Necesito verificar tu correo nuevamente.',
        lookupResource: request.resource,
      };
    }

    if (lookup.status === 'route_unavailable') {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: false,
        failureKind: 'route_unavailable',
        message:
          'La consulta de compras no está disponible en este momento. Puedo comunicarte con una persona del equipo para revisar tu caso.',
        lookupResource: request.resource,
      };
    }

    return {
      requestId: request.requestId,
      kind: 'purchase',
      status: 'failed',
      retryable: lookup.retryable,
      failureKind: lookup.failureKind,
      message:
        'No pude consultar la compra en este momento. Puedo intentarlo nuevamente o comunicarte con una persona del equipo.',
      lookupResource: request.resource,
    };
  }

  private purchaseResultFromPreparedContext(
    request: PurchaseRequest,
    snapshot: CustomerContextSnapshot,
  ): InformationTaskResult {
    const section = snapshot.purchasesCarts;
    const accessMethod = snapshot.identityAccess.authorizedScopes.includes('account')
      ? 'authenticated_account' as const
      : 'trusted_phone_purchase' as const;
    const sourceCoverage = section.sourceCoverage?.map((entry) => ({
      ...entry,
      childId: purchaseDiscoveryChildId(request.requestId, entry.source),
    }));
    if (section.status === 'failed') {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: true,
        failureKind: 'request_failed',
        message: 'No se pudo completar la consulta de las fuentes disponibles.',
        accessMethod,
        ...(sourceCoverage ? { sourceCoverage } : {}),
      };
    }
    if (section.status === 'unavailable' || section.status === 'not_requested') {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: false,
        failureKind: 'not_configured',
        message: 'La consulta de compras no está disponible en este momento.',
        accessMethod,
        ...(sourceCoverage ? { sourceCoverage } : {}),
      };
    }
    const requestedReference = this.parseRequestedCustomerTransactionNumber(request);
    const requestedId = parseOrderReference(request.orderId);
    const requestedMatches = requestedReference !== null
      ? section.purchases.filter((purchase) =>
        purchase.customerTransactionNumber === requestedReference,
      )
      : requestedId?.kind === 'backend_order_id'
        ? section.purchases.filter((purchase) => purchase.orderId === requestedId.orderId)
        : [];
    const referenceWasRequested = requestedReference !== null || requestedId !== null;
    const referenceMatched = requestedMatches.length > 0;
    return {
      requestId: request.requestId,
      kind: 'purchase',
      status: 'completed',
      resource: request.resource,
      ...(request.resource === 'purchase_discovery' ? {} : { lookupResource: request.resource }),
      ...(sourceCoverage ? { sourceCoverage } : {}),
      purchases: referenceMatched ? requestedMatches : [...section.purchases],
      carts: [...section.carts],
      needsSelection: referenceWasRequested && (!referenceMatched || requestedMatches.length > 1),
      accessMethod,
      ...(referenceWasRequested
        ? {
            referenceResolution: referenceMatched ? 'matched' as const : 'unavailable' as const,
            ...(requestedReference !== null
              ? { requestedCustomerTransactionNumber: requestedReference }
              : {}),
          }
        : {}),
      ...(section.completeness === null
        ? {}
        : { coverage: section.completeness === 'complete' ? 'complete' as const : 'partial' as const }),
    };
  }

  private eventResultFromPreparedContext(
    request: Extract<PendingInformationRequest, { kind: 'associated_event' }>,
    snapshot: CustomerContextSnapshot,
  ): InformationTaskResult {
    const section = snapshot.invitationsEvents;
    const accessMethod = snapshot.identityAccess.authorizedScopes.includes('account')
      ? 'authenticated_account' as const
      : 'trusted_phone_guest' as const;
    if (section.status === 'not_found') {
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: false,
        failureKind: 'not_found',
        accessMethod,
        message: 'La consulta autorizada no encontró eventos asociados.',
      };
    }
    if (section.status === 'failed' || section.status === 'unavailable' || section.status === 'not_requested') {
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: section.status === 'failed',
        failureKind: section.status === 'unavailable' ? 'not_configured' : 'request_failed',
        accessMethod,
        message: 'No se pudo completar la consulta autorizada de eventos.',
      };
    }
    const events = [...section.invitations];
    return {
      requestId: request.requestId,
      kind: 'associated_event',
      status: 'completed',
      result: {
        lookup: accessMethod === 'authenticated_account'
          ? { email: snapshot.identityAccess.email ?? '' }
          : { phone: snapshot.identityAccess.phone ?? '' },
        user: null,
        events,
        counts: {
          ownerEvents: events.filter((event) => event.relation === 'owner').length,
          guestEvents: events.filter((event) => event.relation === 'guest').length,
          hostEvents: events.filter((event) => event.relation === 'host').length,
          celebratedEvents: events.filter((event) => event.relation === 'celebrated').length,
          recentOrders: events.reduce((count, event) => count + (event.orderIds?.length ?? 0), 0),
        },
      },
      accessMethod,
    };
  }

  private async lookupGuestEvents(
    phone: AgentAuthByPhoneInput,
  ): Promise<AgentGuestEventsResult> {
    if (!this.dependencies.agentGateway.getGuestEventsByPhone) {
      return {
        status: 'failed',
        error: 'Agent API guest event lookup is not configured.',
        retryable: false,
      };
    }
    try {
      return await this.withCustomerRead('agent.guest_events', () =>
        this.dependencies.agentGateway.getGuestEventsByPhone!(phone),
      );
    } catch {
      return {
        status: 'failed',
        error: 'Guest event lookup failed.',
        retryable: true,
      };
    }
  }

  /**
   * Entry-root seeding for purchase turns. When the turn carries purchase
   * work but no associated_event request, the shared phone-authorized
   * guest-event root (same single flight the event path consumes) seeds the
   * per-turn phone context once through the existing bounded hydration,
   * keyed by the purchase event hints. Event-scoped purchases merge into
   * the canonical snapshot through the existing merge; associations,
   * hydrated details, failures and truncation return as a structured
   * outcome so the purchase execution below transfers them through the
   * existing purchase result into profile assembly (no fabricated request
   * or summary, existing event mapping only). Read-only gateway reads
   * only, shared per-turn detail cache, invocation deadline honored;
   * failures record nothing and never throw, so the purchase path falls
   * back to its own roots unchanged.
   */
  private async seedPhoneContextFromGuestRoot(args: {
    requests: PendingInformationRequest[];
    guestEventsPromise: Promise<AgentGuestEventsResult> | null;
    trustedPhone: AgentAuthByPhoneInput | null;
    eventDetailLookups: EventDetailCache;
    phoneContext: PhoneContextSnapshot;
    deadlineMs: number | null;
  }): Promise<SeededGuestRoot | null> {
    if (!args.guestEventsPromise) return null;
    if (args.requests.some((request) => request.kind === 'associated_event')) return null;
    if (!args.requests.some((request) => request.kind === 'purchase')) return null;
    let guestEvents: AgentGuestEventsResult;
    try {
      guestEvents = await args.guestEventsPromise;
    } catch {
      return null;
    }
    if (guestEvents.status !== 'success' || guestEvents.events.length === 0) return null;
    const hydration = await this.hydrateRelevantEventDetails({
      events: guestEvents.events,
      trustedPhone: args.trustedPhone,
      scope: 'trusted_phone_guest',
      detailCache: args.eventDetailLookups,
      deadlineMs: args.deadlineMs,
    });
    for (const purchase of hydration.purchases) {
      this.mergePhonePurchase(args.phoneContext, purchase, 'event_detail');
    }
    return {
      events: [...guestEvents.events],
      details: hydration.details,
      failures: hydration.failures,
      truncatedByBound: hydration.truncatedByBound,
      phoneNumber: args.trustedPhone?.phone_number ?? '',
    };
  }

  /**
   * Load detail for every event returned by an authorized root. Four
   * simultaneous reads bound backend pressure; the worker queue is not
   * truncated. Scoped cache/visited keys deduplicate repeated IDs, and the
   * invocation deadline preserves completed facts while marking unfinished
   * IDs partial.
   */
  async hydrateRelevantEventDetails(args: {
    events: readonly AgentGuestEventSummary[];
    trustedPhone: AgentAuthByPhoneInput | null;
    scope: string;
    detailCache?: EventDetailCache;
    deadlineMs?: number | null;
  }): Promise<EventDetailHydrationOutcome> {
    const outcome: EventDetailHydrationOutcome = {
      details: new Map(),
      purchases: [],
      failures: [],
      readsAttempted: 0,
      truncatedByBound: false,
    };
    // The event hint selects no profile records. Hydrate every authorized
    // event ID returned by the root; the worker pool bounds simultaneous
    // reads without limiting the total queue.
    const targets = args.events;
    const cache: EventDetailCache = args.detailCache ?? new Map<
      string,
      Promise<PhoneEventDetailResult>
    >();
    const visited = new Set<string>();
    const readable: AgentGuestEventSummary[] = [];
    for (const event of targets) {
      const key = enrichmentVisitKey('event', event.eventId, args.scope);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      if (args.deadlineMs !== null && args.deadlineMs !== undefined && Date.now() >= args.deadlineMs) {
        outcome.failures.push({ eventId: event.eventId, failureKind: 'deadline_exceeded' });
        outcome.truncatedByBound = true;
        continue;
      }
      readable.push(event);
    }
    const settled = await settleWithConcurrency(
      readable,
      enrichmentBounds.maxConcurrentReads,
      async (event) => {
        outcome.readsAttempted += 1;
        if (args.deadlineMs !== null && args.deadlineMs !== undefined && Date.now() >= args.deadlineMs) {
          return {
            event,
            detail: { status: 'failed', error: 'deadline_exceeded', retryable: true } as const,
          };
        }
        const detail = await this.lookupEventDetail(
          event.eventId,
          args.trustedPhone,
          this.dependencies.agentGateway,
          cache,
          args.scope,
        );
        return { event, detail };
      },
    );
    for (const [index, entry] of settled.entries()) {
      if (entry.status === 'rejected') {
        const event = readable[index];
        if (event) {
          outcome.failures.push({ eventId: event.eventId, failureKind: 'request_failed' });
        }
        continue;
      }
      const { event, detail } = entry.value;
      if (detail.status === 'success') {
        outcome.details.set(event.eventId, detail);
        for (const purchase of detail.event.purchases ?? []) {
          outcome.purchases.push(purchase);
        }
      } else if (detail.status === 'not_found') {
        outcome.failures.push({ eventId: event.eventId, failureKind: 'not_found' });
      } else if (detail.error === 'deadline_exceeded') {
        outcome.failures.push({ eventId: event.eventId, failureKind: 'deadline_exceeded' });
        outcome.truncatedByBound = true;
      } else if (detail.error.includes('not configured')) {
        outcome.failures.push({ eventId: event.eventId, failureKind: 'not_configured' });
      } else {
        outcome.failures.push({ eventId: event.eventId, failureKind: 'request_failed' });
      }
    }
    return outcome;
  }

  /**
   * Load known linked order/event detail through the existing authorized
   * routes. Four simultaneous reads bound backend pressure, while the entire
   * deduplicated queue is retained. The caller's authorization scope and the
   * current deadline apply to every read.
   */
  async enrichCustomerLinkedDetail(args: {
    orderIds: readonly string[];
    eventIds: readonly (number | string)[];
    authentication: InformationAuthentication | null;
    trustedPhone: AgentAuthByPhoneInput | null;
    /** Access scope authorizing the reads (account, trusted phone, public). */
    scope: string;
    detailCache?: EventDetailCache;
    visited?: Set<string>;
    deadlineMs?: number | null;
  }): Promise<CustomerLinkedEnrichment> {
    const giftPurchases: PurchaseInformation[] = [];
    const eventDetails = new Map<number, HydratedEventDetail>();
    const unavailable: string[] = [];
    const failures: Array<{ target: string; failureKind: string }> = [];
    let readsAttempted = 0;
    let truncatedByBound = false;
    const cache: EventDetailCache = args.detailCache ?? new Map<string, Promise<PhoneEventDetailResult>>();
    const visited: Set<string> = args.visited ?? new Set();
    const deadlineMs = args.deadlineMs ?? null;

    const pastDeadline = (): boolean =>
      deadlineMs !== null && deadlineMs !== undefined && Date.now() >= deadlineMs;

    type PlannedRead =
      | { kind: 'gift'; orderId: string; visitKey: string }
      | { kind: 'event'; eventId: number; rawId: number | string; visitKey: string };
    const planned: PlannedRead[] = [];
    for (const orderId of args.orderIds) {
      const visitKey = enrichmentVisitKey('order', orderId, args.scope);
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      planned.push({ kind: 'gift', orderId, visitKey });
    }
    for (const rawId of args.eventIds) {
      const numeric = typeof rawId === 'number' ? rawId : Number(String(rawId));
      if (!Number.isFinite(numeric)) {
        unavailable.push(`event:${String(rawId)}`);
        continue;
      }
      const visitKey = enrichmentVisitKey('event', numeric, args.scope);
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      planned.push({ kind: 'event', eventId: numeric, rawId, visitKey });
    }

    const fetchGiftDetail = async (
      orderId: string,
    ): Promise<PurchaseInformation[] | { unavailable: true } | { failure: string }> => {
      if (pastDeadline()) return { failure: 'deadline_exceeded' };
      const authentication = args.authentication;
      const trustedPhone = args.trustedPhone;
      if (authentication) {
        if (
          !this.capabilityAvailable('purchase.gift_detail.read', this.gatewayMethodConfigured('getGiftPurchases')) ||
          !this.dependencies.agentGateway.getGiftPurchases
        ) {
          return { unavailable: true };
        }
        try {
          const lookup = await this.withCustomerRead('agent.gift_detail', () =>
            this.dependencies.agentGateway.getGiftPurchases!({
              token: authentication.token,
              orderId,
            }),
          );
          if (lookup.status === 'success') return lookup.purchases;
          if (lookup.status === 'not_found') return { unavailable: true };
          return { failure: 'request_failed' };
        } catch {
          return { failure: 'request_failed' };
        }
      }
      if (trustedPhone) {
        if (
          !this.capabilityAvailable('purchase.gift_detail.read', this.gatewayMethodConfigured('getGuestGiftPurchasesByPhone')) ||
          !this.dependencies.agentGateway.getGuestGiftPurchasesByPhone
        ) {
          return { unavailable: true };
        }
        try {
          const lookup = await this.withCustomerRead('agent.guest_gift_detail', () =>
            this.dependencies.agentGateway.getGuestGiftPurchasesByPhone!({
              phone_extension: trustedPhone.phone_extension,
              phone_number: trustedPhone.phone_number,
              orderId,
            }),
          );
          if (lookup.status === 'success') return lookup.purchases;
          if (lookup.status === 'not_found') return { unavailable: true };
          return { failure: 'request_failed' };
        } catch {
          return { failure: 'request_failed' };
        }
      }
      return { unavailable: true };
    };

    const settled = await settleWithConcurrency(
      planned,
      enrichmentBounds.maxConcurrentReads,
      async (read) => {
        if (pastDeadline()) {
          return { read, outcome: { failure: 'deadline_exceeded' } as const };
        }
        readsAttempted += 1;
        if (read.kind === 'gift') {
          const result = await fetchGiftDetail(read.orderId);
          return { read, outcome: result };
        }
        const detail = await this.lookupEventDetail(
          read.eventId,
          args.trustedPhone ?? null,
          this.dependencies.agentGateway,
          cache,
          args.scope,
        );
        return { read, outcome: detail };
      },
    );
    for (const entry of settled) {
      if (entry.status === 'rejected') continue;
      const { read, outcome } = entry.value as {
        read: PlannedRead;
        outcome: unknown;
      };
      if (read.kind === 'gift') {
        const result = outcome as
          | PurchaseInformation[]
          | { unavailable: true }
          | { failure: string }
          | PhoneEventDetailResult;
        if (Array.isArray(result)) {
          for (const purchase of result) giftPurchases.push(purchase);
        } else if (typeof result === 'object' && result !== null && 'unavailable' in result) {
          unavailable.push(`order:${read.orderId}`);
        } else if (typeof result === 'object' && result !== null && 'failure' in result) {
          const kind = (result as { failure: string }).failure;
          failures.push({ target: `order:${read.orderId}`, failureKind: kind });
          if (kind === 'deadline_exceeded') truncatedByBound = true;
        }
        continue;
      }
      const detail = outcome as PhoneEventDetailResult | { failure: string };
      if (typeof detail === 'object' && detail !== null && 'failure' in detail) {
        failures.push({ target: `event:${String(read.rawId)}`, failureKind: detail.failure });
        if (detail.failure === 'deadline_exceeded') truncatedByBound = true;
      } else if (detail.status === 'success') {
        eventDetails.set(read.eventId, detail);
      } else if (detail.status === 'not_found') {
        unavailable.push(`event:${String(read.rawId)}`);
      } else if (detail.error.includes('not configured')) {
        unavailable.push(`event:${String(read.rawId)}`);
      } else {
        failures.push({ target: `event:${String(read.rawId)}`, failureKind: 'request_failed' });
      }
    }
    if (pastDeadline() && planned.length > 0) truncatedByBound = true;
    return {
      giftPurchases,
      eventDetails,
      readsAttempted,
      truncatedByBound,
      unavailable,
      failures,
    };
  }

  private async executeGuestEventRequest(
    request: Extract<PendingInformationRequest, { kind: 'associated_event' }>,
    events: AgentGuestEventSummary[],
    trustedPhone: AgentAuthByPhoneInput | null,
    phoneGateway: AgentConversationGateway,
    eventDetailLookups: EventDetailCache,
    phoneContext: PhoneContextSnapshot,
    deadlineMs: number | null,
    hydrateAllAuthorizedEventDetails = false,
  ): Promise<InformationTaskResult> {
    const selected = this.selectGuestEvent(events, request.eventHint);
    if (!selected || hydrateAllAuthorizedEventDetails) {
      // Profile preparation hydrates every known event ID, while ordinary
      // unresolved event requests use the same complete root to disambiguate.
      // Failures keep known associations and are reflected in coverage.
      const hydration = await this.hydrateRelevantEventDetails({
        events,
        trustedPhone,
        scope: 'trusted_phone_guest',
        detailCache: eventDetailLookups,
        deadlineMs,
      });
      for (const purchase of hydration.purchases) {
        this.mergePhonePurchase(phoneContext, purchase, 'event_detail');
      }
      if (hydration.details.size === 0) {
        return {
          requestId: request.requestId,
          kind: 'associated_event',
          status: 'completed',
          accessMethod: 'trusted_phone_guest',
          result: this.guestEventsResult(
            events,
            null,
            trustedPhone?.phone_number ?? '',
          ),
        };
      }
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'completed',
        accessMethod: 'trusted_phone_guest',
        result: this.guestEventsResult(
          events,
          null,
          trustedPhone?.phone_number ?? '',
          undefined,
          hydration.details,
        ),
      };
    }

    if (
      !phoneGateway.getEventDetail ||
      !trustedPhone ||
      !this.capabilityAvailable('event.detail.read', this.gatewayMethodConfigured('getEventDetail'))
    ) {
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: false,
        failureKind: 'not_configured',
        message: 'La consulta de detalles del evento no está disponible en este momento. Puedo comunicarte con una persona del equipo.',
      };
    }

    let detail: PhoneEventDetailResult;
    try {
      detail = await this.lookupEventDetail(
        selected.eventId,
        trustedPhone,
        phoneGateway,
        eventDetailLookups,
        'trusted_phone_guest',
      );
    } catch {
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: true,
        failureKind: 'request_failed',
        message: 'No pude consultar el detalle del evento en este momento. Puedo intentarlo nuevamente.',
      };
    }

    if (detail.status !== 'success') {
      // A 5xx from the enriched route must not discard a known guest/event
      // association. Retry once as a public event read, then retain the
      // summary if the public route is also unavailable.
      if (detail.status === 'failed' && detail.retryable) {
        let publicDetail: PhoneEventDetailResult | null = null;
        try {
          publicDetail = await this.lookupEventDetail(
            selected.eventId,
            null,
            phoneGateway,
            eventDetailLookups,
            'public',
          );
        } catch {
          publicDetail = null;
        }
        if (publicDetail?.status === 'success') {
          return {
            requestId: request.requestId,
            kind: 'associated_event',
            status: 'completed',
            accessMethod: 'trusted_phone_guest',
            result: this.guestEventsResult(
              [selected],
              publicDetail.event,
              trustedPhone.phone_number,
            ),
          };
        }
        return {
          requestId: request.requestId,
          kind: 'associated_event',
          status: 'completed',
          accessMethod: 'trusted_phone_guest',
          result: this.guestEventsResult(
            [selected],
            null,
            trustedPhone.phone_number,
          ),
        };
      }
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: detail.status === 'failed' ? detail.retryable : false,
        failureKind: detail.status === 'not_found' ? 'not_found' : 'request_failed',
        message: detail.status === 'not_found'
          ? 'Encontré el evento asociado al número, pero su detalle ya no está disponible.'
          : 'No pude consultar el detalle del evento en este momento. Puedo intentarlo nuevamente.',
      };
    }

    for (const purchase of detail.event.purchases ?? []) {
        this.mergePhonePurchase(phoneContext, purchase, 'event_detail');
    }

    return {
      requestId: request.requestId,
      kind: 'associated_event',
      status: 'completed',
      accessMethod: 'trusted_phone_guest',
      result: this.guestEventsResult(
        [selected],
        detail.event,
        trustedPhone.phone_number,
        detail,
      ),
    };
  }

  private async lookupEventDetail(
    eventId: number,
    trustedPhone: AgentAuthByPhoneInput | null,
    phoneGateway: AgentConversationGateway,
    eventDetailLookups: EventDetailCache,
    accessScope?: string | null,
  ): Promise<PhoneEventDetailResult> {
    if (
      !phoneGateway.getEventDetail ||
      !this.capabilityAvailable('event.detail.read', this.gatewayMethodConfigured('getEventDetail'))
    ) {
      return {
        status: 'failed',
        error: 'Agent API event detail lookup is not configured.',
        retryable: false,
      };
    }
    // P1 auth-scoped cache key: the same event id under a different access
    // scope never reuses cached detail, and a public fallback never
    // collides with an authorized scoped read.
    const scope = accessScope ?? (trustedPhone ? 'trusted_phone_guest' : 'public');
    const cacheKey = `${scope}:${eventId}:${trustedPhone ? `${trustedPhone.phone_extension}:${trustedPhone.phone_number}` : 'public'}`;
    const existing = eventDetailLookups.get(cacheKey);
    if (existing) {
      return await existing;
    }
    const lookup = this.withCustomerRead('agent.event_detail', () =>
      phoneGateway.getEventDetail!({
        eventId,
        ...(trustedPhone ? { phone: trustedPhone } : {}),
      }),
    );
    eventDetailLookups.set(cacheKey, lookup);
    return await lookup;
  }

  /**
   * I1 requested-event precedence for information reads. An explicit hint
   * resolves against the authorized summaries: a unique match wins, while
   * zero or multiple matches resolve to nothing (never the sole unrelated
   * event). Without a hint a single summary may serve; several stay
   * unresolved for disambiguation.
   */
  private selectGuestEvent(
    events: AgentGuestEventSummary[],
    eventHint: string | null,
  ): AgentGuestEventSummary | null {
    if (eventHint) {
      const matches = events.filter((event) => {
        return sharedEventMatches(event.name, eventHint) ||
          sharedEventMatches(event.slug, eventHint);
      });
      return matches.length === 1 ? matches[0] ?? null : null;
    }
    if (events.length === 1) {
      return events[0] ?? null;
    }
    return null;
  }

  private guestEventsResult(
    events: AgentGuestEventSummary[],
    detail: Extract<
      Awaited<ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>>,
      { status: 'success' }
    >['event'] | null,
    phoneNumber: string,
    enrichedDetail?: PhoneEventDetailSuccess,
    extraDetails?: Map<number, HydratedEventDetail>,
  ): UserEventLookupResult {
    const attendance = enrichedDetail?.attendance ?? enrichedDetail?.event.attendance;
    const purchases = enrichedDetail?.purchases ?? enrichedDetail?.event.purchases ?? [];
    return {
      lookup: { email: null, phone: phoneNumber },
      user: null,
      events: events.map((event) => {
        const extra = extraDetails?.get(event.eventId);
        const effectiveDetail = detail && detail.eventId === event.eventId
          ? detail
          : (extra?.event ?? null);
        const effectiveEnriched = enrichedDetail?.event.eventId === event.eventId
          ? enrichedDetail
          : extra;
        const effectiveAttendance = effectiveEnriched?.attendance ??
          effectiveEnriched?.event.attendance ??
          (effectiveEnriched === undefined ? attendance : undefined);
        const effectivePurchases = effectiveEnriched?.purchases ??
          effectiveEnriched?.event.purchases ??
          (effectiveEnriched === undefined ? purchases : []);
        return {
        relation: 'guest',
        source: 'agent_guest_events',
        accessScope: 'trusted_phone_guest',
        guestId:
          effectiveEnriched?.event.eventId === event.eventId
            ? effectiveAttendance?.guestId ?? null
            : null,
        eventId: event.eventId,
        slug: event.slug,
        url: event.url,
        name: event.name,
        place: event.city,
        type: event.type,
        datetime: event.datetime,
        stage: event.stage,
        isVisible: null,
        isPublic: null,
        currency: event.currency,
        country: event.country,
        guestStatus:
          effectiveEnriched?.event.eventId === event.eventId &&
          effectiveAttendance
            ? {
                hasResponded: effectiveAttendance.hasResponded,
                willAttend: effectiveAttendance.willAttend,
                hasCouple: null,
                responseDate: effectiveAttendance.responseDate,
              }
            : null,
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
        orderIds: effectiveEnriched?.event.eventId === event.eventId
          ? effectivePurchases.map((purchase) => purchase.orderId)
          : [],
        ...(effectiveDetail && effectiveDetail.eventId === event.eventId
          ? {
              place: effectiveDetail.city,
              name: effectiveDetail.name,
              slug: effectiveDetail.slug,
              url: effectiveDetail.url,
              type: effectiveDetail.type,
              datetime: effectiveDetail.datetime,
              stage: effectiveDetail.stage,
              currency: effectiveDetail.currency,
              country: effectiveDetail.country,
              detail: {
                withTime: effectiveDetail.withTime,
                timezone: effectiveDetail.timezone,
                city: effectiveDetail.city,
                celebrateds: effectiveDetail.celebrateds,
                moments: effectiveDetail.moments,
                dresscode: effectiveDetail.dresscode,
                commonAsked: effectiveDetail.commonAsked,
                contactInfo: effectiveDetail.contactInfo,
              },
            }
          : {}),
        };
      }),
      counts: {
        ownerEvents: 0,
        guestEvents: events.length,
        hostEvents: 0,
        celebratedEvents: 0,
        recentOrders: purchases.length,
      },
    };
  }

  private partitionedPurchaseLookup(
    result: SuccessfulPurchaseLookup,
  ): PartitionedPurchaseLookup {
    const phoneResult = 'orderPartitions' in result || 'carts' in result ? result : null;
    const pending = phoneResult?.orderPartitions?.pending ?? [];
    const completed = phoneResult?.orderPartitions?.completed ?? [];
    const carts = phoneResult?.carts ?? [];
    const hasPartitions = phoneResult?.orderPartitions !== undefined ||
      phoneResult?.carts !== undefined;
    const purchases: PurchaseInformation[] = [];
    const conflictingOrderIds = new Set<string>();

    const add = (entries: PurchaseInformation[], partition: PurchasePartition): void => {
      for (const purchase of entries) {
        const effectivePartition = purchase.partition ?? partition;
        const record: PurchaseInformation = {
          ...purchase,
          recordSource: result.resource,
          partition: effectivePartition,
        };
        const sameId = purchases.filter((existing) => existing.orderId === purchase.orderId);
        const duplicate = sameId.find((existing) =>
          existing.recordSource === record.recordSource &&
          existing.partition === record.partition &&
          JSON.stringify(existing) === JSON.stringify(record),
        );
        if (duplicate) continue;
        if (sameId.some((existing) =>
          existing.recordSource !== record.recordSource ||
          existing.partition !== record.partition ||
          hasPurchaseFactConflict(existing, record),
        )) {
          conflictingOrderIds.add(purchase.orderId);
        }
        purchases.push(record);
      }
    };
    add(pending, 'pending_orders');
    add(completed, 'completed_orders');

    // Legacy `purchases` is a compatibility fallback only. Once a partition
    // envelope is present it must not reintroduce records omitted by the
    // selected partitions.
    if (!hasPartitions) {
      add(result.purchases, 'legacy_orders');
    }
    return { purchases, carts, hasPartitions, conflictingOrderIds };
  }

  private async executePhonePurchaseRequest(
    request: PurchaseRequest,
    trustedPhone: AgentAuthByPhoneInput,
    phoneGateway: AgentConversationGateway,
    phonePurchaseLookups: Map<
      string,
      Promise<AgentPhonePurchaseLookupResult | undefined>
    >,
    phoneContext: PhoneContextSnapshot,
    seededRootPromise?: Promise<SeededGuestRoot | null> | null,
  ): Promise<InformationTaskResult> {
    if (request.resource === 'purchase_discovery') {
      return await this.executeDiscoveryPhonePurchaseRequest(
        request,
        trustedPhone,
        phoneGateway,
        phonePurchaseLookups,
        phoneContext,
        seededRootPromise,
      );
    }
    // Independent root reads run together: the applicable authorized
    // purchase root starts while the shared guest-event seed (same flight
    // the event path consumes) is still hydrating. Both settle below
    // before the stable-order-ID merge, so neither waits idly on the
    // other where dependencies allow.
    const lookupPromise = this.lookupPhonePurchase(
      request,
      trustedPhone,
      phoneGateway,
      phonePurchaseLookups,
    );
    const seeded = seededRootPromise ? await seededRootPromise : null;
    const eventScopedPurchases = this.eventScopedPurchasesForRequest(
      request,
      phoneContext,
    );
    const linkedEvents = seeded && seeded.events.length > 0
      ? this.guestEventsResult(
        seeded.events,
        null,
        seeded.phoneNumber,
        undefined,
        seeded.details,
      )
      : null;
    const linkedFailures = seeded
      ? seeded.failures.map((failure) => ({ ...failure }))
      : [];
    const linkedTruncated = seeded?.truncatedByBound ?? false;
    const seededIncomplete = seeded !== null &&
      (linkedTruncated || linkedFailures.length > 0);
    const withLinked = <T extends object>(result: T): T & {
      linkedEvents?: UserEventLookupResult;
      linkedEventFailures?: Array<{ eventId: number; failureKind: string }>;
      linkedEventsTruncated?: boolean;
    } => linkedEvents
      ? {
        ...result,
        linkedEvents,
        ...(linkedFailures.length > 0 ? { linkedEventFailures: linkedFailures } : {}),
        ...(linkedTruncated ? { linkedEventsTruncated: true } : {}),
      }
      : result;
    if (eventScopedPurchases.length > 0 || linkedEvents !== null) {
      // Still acquire the applicable authorized purchase root when the
      // hydration found purchases (existing partition selection and
      // capability checks inside lookupPhonePurchase, never every
      // endpoint): event-scoped A merges with purchase-root A+B by stable
      // order ID below. An early return here would bypass that lookup
      // even when partial, so it never returns before the merge.
      const lookup = await lookupPromise;
      if (lookup && lookup.result.status === 'success') {
        const evidence = this.partitionedPurchaseLookup(lookup.result);
        for (const orderId of evidence.conflictingOrderIds) {
          phoneContext.inconsistentOrderIds.add(orderId);
        }
        for (const cart of evidence.carts) {
          phoneContext.cartsById.set(cart.cartId, cart);
        }
        const candidates = this.filterPurchaseCandidates(
          evidence.purchases,
          lookup.requestedCustomerTransactionNumber,
        );
        for (const purchase of candidates.purchases) {
          this.mergePhonePurchase(
            phoneContext,
            purchase,
            purchase.recordSource ?? lookup.sourceResource,
            purchase.partition,
          );
        }
        // Stable-order-ID union within scope: event-scoped plus
        // purchase-root candidates read back canonically (enriched
        // missing fields, preserved source conflicts via the snapshot).
        const combinedIds = new Set<string>([
          ...eventScopedPurchases.map((purchase) => purchase.orderId),
          ...candidates.purchases.map((purchase) => purchase.orderId),
        ]);
        if (request.orderId) {
          const combined = phonePurchasesForIds(
            phoneContext,
            new Set([request.orderId]),
          );
          if (combined.length === 0) {
            return withLinked({
              requestId: request.requestId,
              kind: 'purchase' as const,
              status: 'completed' as const,
              resource: request.resource,
              purchases: [],
              needsSelection: false,
              accessMethod: 'trusted_phone_event_purchase' as const,
              coverage: 'partial' as const,
            });
          }
          if (combined.length === 0) {
            return withLinked({
              requestId: request.requestId,
              kind: 'purchase' as const,
              status: 'completed' as const,
              resource: request.resource,
              purchases: [],
              needsSelection: false,
              accessMethod: 'trusted_phone_event_purchase' as const,
              coverage: 'partial' as const,
            });
          }
          return withLinked({
            requestId: request.requestId,
            kind: 'purchase',
            status: 'completed',
            resource: request.resource,
            lookupResource: lookup.sourceResource,
            purchases: combined.map((purchase) => this.projectPurchase(purchase, request, {
              transactionReferenceAuthorized: true,
              requestedCustomerTransactionNumber: lookup.requestedCustomerTransactionNumber ?? null,
            })),
            needsSelection: false,
            accessMethod: 'trusted_phone_event_purchase',
            coverage: seededIncomplete || lookup.coverage === 'partial' ? 'partial' : 'complete',
            carts: evidence.carts.map((cart) => this.projectCart(cart, 'trusted_phone_purchase')),
            ...(lookup.referenceResolution === 'not_requested'
              ? {}
              : {
                referenceResolution: lookup.referenceResolution,
                requestedCustomerTransactionNumber:
                  lookup.requestedCustomerTransactionNumber,
              }),
          });
        }
        const combined = phonePurchasesForIds(phoneContext, combinedIds);
        // A failed optional source never erases ready facts: the merged
        // set answers with partial coverage below. Detail success never
        // proves purchase completeness: seeded-only success without the
        // purchase root still reports partial via seededIncomplete only
        // when a bound/failure exists; otherwise the merged root decides.
        return withLinked({
          requestId: request.requestId,
          kind: 'purchase',
          status: 'completed',
          resource: request.resource,
          lookupResource: lookup.sourceResource,
          purchases: combined.map((purchase) =>
            this.projectPurchase(purchase, request, {
              transactionReferenceAuthorized: true,
              requestedCustomerTransactionNumber: lookup.requestedCustomerTransactionNumber ?? null,
            }),
          ),
          // Lane B: merged-root multiplicity is factual metadata; only an
          // explicit validated-reference mismatch asserts selection.
          needsSelection: false,
          accessMethod: 'trusted_phone_event_purchase',
          coverage: seededIncomplete || lookup.coverage === 'partial' ? 'partial' : 'complete',
          carts: evidence.carts.map((cart) => this.projectCart(cart, 'trusted_phone_purchase')),
          ...(lookup.referenceResolution === 'not_requested'
            ? {}
            : {
              referenceResolution: lookup.referenceResolution,
              requestedCustomerTransactionNumber:
                lookup.requestedCustomerTransactionNumber,
            }),
        });
      }
      // The purchase root is unavailable or failed: ready event-scoped
      // facts stay usable with honest partial coverage instead of failing
      // the whole read. Unauthorized/misconfigured roots without any
      // event-scoped purchase fall through to the normal contract below.
      if (eventScopedPurchases.length > 0) {
        return withLinked({
          requestId: request.requestId,
          kind: 'purchase',
          status: 'completed',
          resource: request.resource,
          purchases: eventScopedPurchases.map((purchase) =>
            this.projectPurchase(purchase, request, { transactionReferenceAuthorized: true }),
          ),
          // Lane B: event-scoped multiplicity is factual metadata; only an
          // explicit validated-reference mismatch asserts selection.
          needsSelection: false,
          accessMethod: 'trusted_phone_event_purchase',
          coverage: 'partial',
        });
      }
      if (linkedEvents !== null) {
        // Associations/details without event-scoped purchases still reach
        // the profile through linkedEvents; the purchase section reports
        // the failed root honestly below instead of claiming completeness.
      }
    }
    const lookup = await lookupPromise;
    if (!lookup) {
      // The capability is optional during rollout. Preserve the normal
      // authentication contract when this deployment has not picked it up.
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'needs_input',
        nextInput: 'email',
        guidance: createInformationAuthGuidance('email_required', null),
      };
    }

    if (lookup.result.status === 'success') {
      const evidence = this.partitionedPurchaseLookup(lookup.result);
      for (const orderId of evidence.conflictingOrderIds) {
        phoneContext.inconsistentOrderIds.add(orderId);
      }
      for (const cart of evidence.carts) {
        phoneContext.cartsById.set(cart.cartId, cart);
      }
      const carts = evidence.carts;
      const candidates = this.filterPurchaseCandidates(
        evidence.purchases,
        lookup.requestedCustomerTransactionNumber,
      );
      const purchases = candidates.purchases;
      // An empty order partition is not a global absence of information: an
      // active or abandoned cart is valid phone-scoped checkout evidence.
      if (purchases.length === 0 && carts.length > 0) {
        const result: PurchaseTaskResult = {
          requestId: request.requestId,
          kind: 'purchase',
          status: 'completed',
          resource: request.resource,
          lookupResource: lookup.sourceResource,
          purchases: [],
          needsSelection: false,
          accessMethod: 'trusted_phone_purchase',
          coverage: 'partial',
          carts: carts.map((cart) => this.projectCart(cart, 'trusted_phone_purchase')),
        };
        return result;
      }
      // The filter retains every authorized record, so an empty result
      // means the backend scope itself is empty — never a hint mismatch.
      if (purchases.length === 0) {
        return {
          requestId: request.requestId,
          kind: 'purchase',
          status: 'failed',
          retryable: false,
          failureKind: 'not_found',
          message:
            'No encontré compras coincidentes asociadas a este número en la consulta realizada. Se necesita apoyo del equipo para revisarlo.',
          accessMethod: 'trusted_phone_purchase',
          lookupResource: lookup.sourceResource,
        };
      }
      for (const purchase of purchases) {
        this.mergePhonePurchase(
          phoneContext,
          purchase,
          lookup.sourceResource,
          purchase.partition,
        );
      }
      const result: PurchaseTaskResult = {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: request.resource,
        lookupResource: lookup.sourceResource,
        purchases: purchases.map((purchase) =>
          this.projectPurchase(purchase, request, {
            transactionReferenceAuthorized: true,
            requestedCustomerTransactionNumber: lookup.requestedCustomerTransactionNumber ?? null,
          }),
        ),
        needsSelection:
          lookup.referenceResolution === 'unavailable' || candidates.needsSelection,
        accessMethod: 'trusted_phone_purchase',
        coverage: lookup.coverage,
        carts: carts.map((cart) => this.projectCart(cart, 'trusted_phone_purchase')),
        ...(lookup.referenceResolution === 'not_requested'
          ? {}
          : {
              referenceResolution: lookup.referenceResolution,
              requestedCustomerTransactionNumber:
                lookup.requestedCustomerTransactionNumber,
            }),
      };
      return result;
    }

    if (lookup.result.status === 'not_found') {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        retryable: false,
        failureKind: 'not_found',
        message:
          'No encontré esa compra asociada a este número en la consulta realizada. Se necesita apoyo del equipo para revisarlo.',
        accessMethod: 'trusted_phone_purchase',
        lookupResource: lookup.sourceResource,
      };
    }

    return {
      requestId: request.requestId,
      kind: 'purchase',
      status: 'failed',
      retryable: lookup.result.status === 'retryable_failure',
      failureKind:
        lookup.result.status === 'unauthorized'
          ? 'unauthorized'
          : lookup.result.status === 'invalid_response'
            ? 'invalid_response'
            : 'request_failed',
      message:
        'No pude consultar la compra asociada a este número en este momento. Puedo comunicarte con una persona del equipo para revisarlo.',
      accessMethod: 'trusted_phone_purchase',
      lookupResource: lookup.sourceResource,
    };
  }

  /**
   * Generic discovery expansion for the authenticated-account path. Every
   * available authorized source is read once through the shared per-turn
   * scoped map and the independent reads run together. Unauthorized and
   * unavailable sources become coverage entries, never bypass attempts. No
   * reflexive retries: one bounded read per source, then stop.
   */
  private async executeDiscoveryAccountPurchaseRequest(
    request: PurchaseRequest,
    authentication: InformationAuthentication,
    accountPurchaseLookups?: Map<
      string,
      Promise<AgentPurchaseLookupResult | undefined>
    >,
  ): Promise<InformationTaskResult> {
    const requested = this.requestedPurchaseSources(request);
    const available = this.accountPurchaseSources(request);
    const coverage: PurchaseSourceCoverage[] = requested
      .filter((source) => !available.includes(source))
      .map((source) => ({
        source,
        childId: purchaseDiscoveryChildId(request.requestId, source),
        status: this.unavailableSourceStatus(source),
        count: 0,
      }));
    const settled = await Promise.all(
      available.map(async (source) => {
        try {
          return {
            source,
            lookup: await this.lookupPurchase(
              { ...request, resource: source },
              authentication.token,
              request.orderId,
              accountPurchaseLookups,
            ),
          };
        } catch {
          return {
            source,
            lookup: {
              status: 'failed',
              resource: source,
              retryable: true,
              failureKind: 'request_failed',
              error: 'Customer source read failed.',
            } as const,
          };
        }
      }),
    );
    const merged = new Map<string, PurchaseInformation>();
    const carts = new Map<string, CartInformation>();
    const failures: AgentPurchaseLookupResult[] = [];
    for (const { source, lookup } of settled) {
      const childId = purchaseDiscoveryChildId(request.requestId, source);
      if (!lookup) {
        coverage.push({ source, childId, status: 'unavailable', count: 0 });
        continue;
      }
      if (lookup.status === 'success') {
        const evidence = this.partitionedPurchaseLookup(lookup);
        const candidates = this.filterPurchaseCandidates(evidence.purchases);
        coverage.push({
          source,
          childId,
          status: candidates.purchases.length > 0 ? 'completed' : 'empty',
          count: candidates.purchases.length,
        });
        for (const purchase of candidates.purchases) {
          const scopedPurchase: PurchaseInformation = {
            ...purchase,
            accessScope: 'authenticated_account',
          };
          const key = JSON.stringify([
            scopedPurchase.recordSource ?? source,
            scopedPurchase.partition ?? null,
            scopedPurchase.orderId,
          ]);
          if (!merged.has(key)) merged.set(key, scopedPurchase);
        }
        for (const cart of evidence.carts) {
          if (!carts.has(cart.cartId)) carts.set(cart.cartId, cart);
        }
        continue;
      }
      if (lookup.status === 'not_found') {
        coverage.push({ source, childId, status: 'empty', count: 0 });
        continue;
      }
      if (lookup.status === 'unauthorized') {
        coverage.push({ source, childId, status: 'unauthorized', count: 0 });
        failures.push(lookup);
        continue;
      }
      if (lookup.status === 'route_unavailable') {
        coverage.push({ source, childId, status: 'unavailable', count: 0 });
        failures.push(lookup);
        continue;
      }
      coverage.push({ source, childId, status: 'failed', count: 0 });
      failures.push(lookup);
    }
    const purchases = [...merged.values()];
    const cartList = [...carts.values()].map((cart) => this.projectCart(cart, 'authenticated_account'));
    if (purchases.length === 0 && cartList.length === 0) {
      const allRequestedSourcesRead = coverage.every((entry) =>
        entry.status === 'completed' || entry.status === 'empty',
      );
      if (!request.orderId && this.parseRequestedCustomerTransactionNumber(request) === null &&
        allRequestedSourcesRead && failures.length === 0) {
        return {
          requestId: request.requestId,
          kind: 'purchase',
          status: 'completed',
          resource: 'purchase_discovery',
          sourceCoverage: this.orderedCoverage(request.requestId, coverage),
          purchases: [],
          needsSelection: false,
          accessMethod: 'authenticated_account',
          coverage: this.discoveryCoverage(coverage),
          carts: [],
        };
      }
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'failed',
        ...this.discoveryLookupFailure('account', failures.length > 0
          ? failures
          : this.discoveryCoverageFailures(coverage)),
        sourceCoverage: this.orderedCoverage(request.requestId, coverage),
      };
    }
    if (purchases.length === 0) {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: 'purchase_discovery',
        sourceCoverage: this.orderedCoverage(request.requestId, coverage),
        purchases: [],
        needsSelection: false,
        accessMethod: 'authenticated_account',
        coverage: 'partial',
        carts: cartList,
      };
    }
    // No exact-order re-read: each root already answered from its own facts.
    return {
      requestId: request.requestId,
      kind: 'purchase',
      status: 'completed',
      resource: 'purchase_discovery',
      sourceCoverage: this.orderedCoverage(request.requestId, coverage),
      purchases: purchases.map((purchase) =>
        this.projectPurchase(purchase, request, { transactionReferenceAuthorized: true }),
      ),
      // Lane B: discovery multiplicity is factual metadata (per-source
      // coverage plus every purchase already travel); only an explicit
      // validated-reference mismatch asserts selection.
      needsSelection: false,
      accessMethod: 'authenticated_account',
      coverage: this.discoveryCoverage(coverage),
      carts: cartList,
    };
  }

  /**
   * Generic discovery expansion for the phone-authorized path. Per-source
   * root reads start together with the shared guest-event seed; event-scoped
   * purchases merge with root candidates by stable order ID. An exact
   * customer reference matches once across the merged scope: a match narrows
   * to the matching records, an unmatched reference retains the scope with
   * the mismatch preserved as explicit evidence (never a silent retarget).
   */
  private async executeDiscoveryPhonePurchaseRequest(
    request: PurchaseRequest,
    trustedPhone: AgentAuthByPhoneInput,
    phoneGateway: AgentConversationGateway,
    phonePurchaseLookups: Map<
      string,
      Promise<AgentPhonePurchaseLookupResult | undefined>
    >,
    phoneContext: PhoneContextSnapshot,
    seededRootPromise?: Promise<SeededGuestRoot | null> | null,
  ): Promise<InformationTaskResult> {
    const requested = this.requestedPurchaseSources(request);
    const available = this.phonePurchaseSources(request);
    if (available.length === 0) {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'needs_input',
        nextInput: 'email',
        guidance: createInformationAuthGuidance('email_required', null),
      };
    }
    const coverage: PurchaseSourceCoverage[] = requested
      .filter((source) => !available.includes(source))
      .map((source) => ({
        source,
        childId: purchaseDiscoveryChildId(request.requestId, source),
        status: this.unavailableSourceStatus(source),
        count: 0,
      }));
    const legPromises = available.map(async (source) => {
      try {
        return {
          source,
          lookup: await this.lookupPhonePurchase(
            { ...request, resource: source },
            trustedPhone,
            phoneGateway,
            phonePurchaseLookups,
            { skipReferenceResolution: true },
          ),
        };
      } catch {
        return {
          source,
          lookup: {
            result: {
              status: 'failed',
              resource: source,
              retryable: true,
              failureKind: 'request_failed',
              error: 'Customer source read failed.',
            } as const,
            coverage: 'partial' as const,
            sourceResource: source,
            referenceResolution: 'not_requested' as const,
            requestedCustomerTransactionNumber: null,
          },
        };
      }
    });
    const legRun = Promise.all(legPromises);
    const seeded = seededRootPromise ? await seededRootPromise : null;
    const eventScopedPurchases = this.eventScopedPurchasesForRequest(
      request,
      phoneContext,
    );
    const linkedEvents = seeded && seeded.events.length > 0
      ? this.guestEventsResult(
        seeded.events,
        null,
        seeded.phoneNumber,
        undefined,
        seeded.details,
      )
      : null;
    const linkedFailures = seeded
      ? seeded.failures.map((failure) => ({ ...failure }))
      : [];
    const linkedTruncated = seeded?.truncatedByBound ?? false;
    const seededIncomplete = seeded !== null &&
      (linkedTruncated || linkedFailures.length > 0);
    const withLinked = <T extends object>(result: T): T & {
      linkedEvents?: UserEventLookupResult;
      linkedEventFailures?: Array<{ eventId: number; failureKind: string }>;
      linkedEventsTruncated?: boolean;
    } => linkedEvents
      ? {
        ...result,
        linkedEvents,
        ...(linkedFailures.length > 0 ? { linkedEventFailures: linkedFailures } : {}),
        ...(linkedTruncated ? { linkedEventsTruncated: true } : {}),
      }
      : result;
    const legs = await legRun;
    const candidateIds = new Set<string>();
    const cartCandidates = new Map<string, CartInformation>();
    const failures: AgentPhonePurchaseLookupResult[] = [];
    for (const { source, lookup } of legs) {
      const childId = purchaseDiscoveryChildId(request.requestId, source);
      if (!lookup) {
        coverage.push({ source, childId, status: 'unavailable', count: 0 });
        continue;
      }
      const outcome = lookup.result;
      if (outcome.status === 'success') {
        const evidence = this.partitionedPurchaseLookup(outcome);
        for (const orderId of evidence.conflictingOrderIds) {
          phoneContext.inconsistentOrderIds.add(orderId);
        }
        for (const cart of evidence.carts) {
          phoneContext.cartsById.set(cart.cartId, cart);
        }
        const candidates = this.filterPurchaseCandidates(evidence.purchases);
        for (const purchase of candidates.purchases) {
          this.mergePhonePurchase(
            phoneContext,
            purchase,
            lookup.sourceResource,
          purchase.partition,
          );
          candidateIds.add(purchase.orderId);
        }
        coverage.push({
          source,
          childId,
          status: candidates.purchases.length > 0 ? 'completed' : 'empty',
          count: candidates.purchases.length,
        });
        continue;
      }
      if (outcome.status === 'not_found') {
        coverage.push({ source, childId, status: 'empty', count: 0 });
        continue;
      }
      if (outcome.status === 'unauthorized') {
        coverage.push({ source, childId, status: 'unauthorized', count: 0 });
        failures.push(outcome);
        continue;
      }
      coverage.push({ source, childId, status: 'failed', count: 0 });
      failures.push(outcome);
    }
    const requestedReference = this.parseRequestedCustomerTransactionNumber(request);
    const scopedIds = new Set<string>([
      ...eventScopedPurchases.map((purchase) => purchase.orderId),
      ...candidateIds,
    ]);
    // A backend order ID narrows to that record; a customer transaction
    // reference (COD code) never narrows by raw string and instead matches
    // once across the merged scope below.
    const orderIdReference = parseOrderReference(request.orderId);
    const backendOrderId = orderIdReference?.kind === 'backend_order_id'
      ? orderIdReference.orderId
      : orderIdReference === null
        ? request.orderId
        : null;
    if (backendOrderId) {
      const matching = phonePurchasesForIds(phoneContext, new Set([backendOrderId]));
      if (matching.length === 0) {
        return withLinked({
          requestId: request.requestId,
          kind: 'purchase' as const,
          status: 'failed' as const,
          ...this.discoveryLookupFailure('trusted_phone', failures),
          accessMethod: 'trusted_phone_purchase' as const,
          sourceCoverage: this.orderedCoverage(request.requestId, coverage),
        });
      }
      return withLinked({
        requestId: request.requestId,
        kind: 'purchase' as const,
        status: 'completed' as const,
        resource: 'purchase_discovery' as const,
        sourceCoverage: this.orderedCoverage(request.requestId, coverage),
        purchases: matching.map((purchase) => this.projectPurchase(purchase, request, {
          transactionReferenceAuthorized: true,
          requestedCustomerTransactionNumber: requestedReference,
        })),
        needsSelection: false,
        accessMethod: 'trusted_phone_event_purchase' as const,
        coverage: this.discoveryCoverage(coverage, seededIncomplete),
        carts: [...phoneContext.cartsById.values()].map((cart) =>
          this.projectCart(cart, 'trusted_phone_purchase'),
        ),
      });
    }
    let combined = phonePurchasesForIds(phoneContext, scopedIds);
    // A failed optional source never erases ready facts; event-scoped facts
    // stay usable with honest partial coverage.
    let referenceResolution: 'matched' | 'unavailable' | 'not_requested' = 'not_requested';
    if (requestedReference) {
      const matches = combined.filter(
        (purchase) => purchase.customerTransactionNumber === requestedReference,
      );
      if (matches.length > 0) {
        combined = matches;
        referenceResolution = 'matched';
      } else {
        referenceResolution = 'unavailable';
      }
    }
    for (const cart of phoneContext.cartsById.values()) {
      if (!cartCandidates.has(cart.cartId)) cartCandidates.set(cart.cartId, cart);
    }
    const carts = [...cartCandidates.values()];
    if (combined.length === 0 && carts.length === 0) {
      const allRequestedSourcesRead = coverage.every((entry) =>
        entry.status === 'completed' || entry.status === 'empty',
      );
      if (!request.orderId && requestedReference === null && allRequestedSourcesRead &&
        failures.length === 0) {
        return withLinked({
          requestId: request.requestId,
          kind: 'purchase' as const,
          status: 'completed' as const,
          resource: 'purchase_discovery' as const,
          sourceCoverage: this.orderedCoverage(request.requestId, coverage),
          purchases: [],
          needsSelection: false,
          accessMethod: 'trusted_phone_purchase' as const,
          coverage: this.discoveryCoverage(coverage, seededIncomplete),
          carts: [],
        });
      }
      return withLinked({
        requestId: request.requestId,
        kind: 'purchase' as const,
        status: 'failed' as const,
        ...this.discoveryLookupFailure('trusted_phone', failures.length > 0
          ? failures
          : this.discoveryCoverageFailures(coverage)),
        accessMethod: 'trusted_phone_purchase' as const,
        sourceCoverage: this.orderedCoverage(request.requestId, coverage),
        ...(requestedReference
          ? {
            requestedCustomerTransactionNumber: requestedReference,
            referenceResolution: 'unavailable' as const,
          }
          : {}),
      });
    }
    if (combined.length === 0) {
      return withLinked({
        requestId: request.requestId,
        kind: 'purchase' as const,
        status: 'completed' as const,
        resource: 'purchase_discovery' as const,
        sourceCoverage: this.orderedCoverage(request.requestId, coverage),
        purchases: [],
        needsSelection: false,
        accessMethod: 'trusted_phone_purchase' as const,
        coverage: 'partial' as const,
        carts: carts.map((cart) => this.projectCart(cart, 'trusted_phone_purchase')),
      });
    }
    return withLinked({
      requestId: request.requestId,
      kind: 'purchase' as const,
      status: 'completed' as const,
      resource: 'purchase_discovery' as const,
      sourceCoverage: this.orderedCoverage(request.requestId, coverage),
      purchases: combined.map((purchase) =>
        this.projectPurchase(purchase, request, {
          transactionReferenceAuthorized: true,
          requestedCustomerTransactionNumber: requestedReference,
        }),
      ),
      // Lane B: the genuine validated-reference mismatch is preserved as
      // the selection fact; merged multiplicity alone never asserts it.
      needsSelection: referenceResolution === 'unavailable',
      accessMethod: eventScopedPurchases.length > 0 || linkedEvents !== null
        ? 'trusted_phone_event_purchase'
        : 'trusted_phone_purchase',
      coverage: this.discoveryCoverage(coverage, seededIncomplete),
      carts: carts.map((cart) => this.projectCart(cart, 'trusted_phone_purchase')),
      ...(referenceResolution === 'not_requested'
        ? {}
        : {
          referenceResolution,
          requestedCustomerTransactionNumber: requestedReference,
        }),
    });
  }

  /** Coverage in stable source order for deterministic traces. */
  private orderedCoverage(
    requestId: string,
    coverage: PurchaseSourceCoverage[],
  ): PurchaseSourceCoverage[] {
    const order: readonly PurchaseResource[] = ['orders', 'gift_purchases'];
    return [...coverage].sort((left, right) => {
      const indexOf = (entry: PurchaseSourceCoverage): number => {
        const position = order.indexOf(entry.source);
        return position < 0 ? order.length : position;
      };
      if (indexOf(left) !== indexOf(right)) return indexOf(left) - indexOf(right);
      return left.childId.localeCompare(right.childId);
    }).map((entry) => ({
      ...entry,
      childId: purchaseDiscoveryChildId(requestId, entry.source),
    }));
  }

  /**
   * Overall discovery coverage. `complete` only when every requested source
   * produced a definitive read (completed or empty) with no seed truncation;
   * any unauthorized, unavailable or failed source makes it `partial`.
   */
  private discoveryCoverage(
    coverage: PurchaseSourceCoverage[],
    seededIncomplete = false,
  ): 'complete' | 'partial' {
    if (seededIncomplete) return 'partial';
    return coverage.every((entry) => entry.status === 'completed' || entry.status === 'empty')
      ? 'complete'
      : 'partial';
  }

  /**
   * Failure contract for an empty discovery scope. Mirrors the single-source
   * failure mapping of each access path: transport failures stay retryable,
   * authorization stays re-authenticatable, unavailable capability stays
   * terminal, and an all-empty scope is a scoped absence — never an
   * account-wide claim beyond the sources actually read.
   */
  private discoveryLookupFailure(
    scope: 'account' | 'trusted_phone',
    failures: ReadonlyArray<AgentPurchaseLookupResult | AgentPhonePurchaseLookupResult>,
  ): {
    retryable: boolean;
    failureKind: 'not_configured' | 'not_found' | 'unauthorized' | 'route_unavailable' | 'invalid_response' | 'request_failed';
    message: string;
  } {
    const first = failures[0];
    if (!first) {
      return {
        retryable: false,
        failureKind: 'not_found',
        message: scope === 'account'
          ? 'No encontré compras coincidentes en las fuentes consultadas de la cuenta autenticada. Revisa los datos de la consulta.'
          : 'No encontré compras coincidentes asociadas a este número en la consulta realizada. Se necesita apoyo del equipo para revisarlo.',
      };
    }
    if (first.status === 'unauthorized') {
      return {
        retryable: scope === 'account',
        failureKind: 'unauthorized',
        message: scope === 'account'
          ? 'La sesión venció o no pudo validarse. Necesito verificar tu correo nuevamente.'
          : 'No pude consultar la compra asociada a este número en este momento. Puedo comunicarte con una persona del equipo para revisarlo.',
      };
    }
    if (first.status === 'route_unavailable') {
      return {
        retryable: false,
        failureKind: scope === 'account' ? 'route_unavailable' : 'request_failed',
        message: scope === 'account'
          ? 'La consulta de compras no está disponible en este momento. Puedo comunicarte con una persona del equipo para revisar tu caso.'
          : 'No pude consultar la compra asociada a este número en este momento. Puedo comunicarte con una persona del equipo para revisarlo.',
      };
    }
    if (first.status === 'retryable_failure') {
      return {
        retryable: true,
        failureKind: 'request_failed',
        message: scope === 'account'
          ? 'No pude consultar la compra en este momento. Puedo intentarlo nuevamente o comunicarte con una persona del equipo.'
          : 'No pude consultar la compra asociada a este número en este momento. Puedo comunicarte con una persona del equipo para revisarlo.',
      };
    }
    if (first.status === 'failed') {
      return {
        retryable: first.retryable,
        failureKind: first.failureKind,
        message: scope === 'account'
          ? 'No pude consultar la compra en este momento. Puedo intentarlo nuevamente o comunicarte con una persona del equipo.'
          : 'No pude consultar la compra asociada a este número en este momento. Puedo comunicarte con una persona del equipo para revisarlo.',
      };
    }
    if (first.status === 'invalid_response' || first.status === 'invalid_request') {
      return {
        retryable: false,
        failureKind: scope === 'account' ? 'request_failed' : 'invalid_response',
        message: scope === 'account'
          ? 'No pude consultar la compra en este momento. Puedo intentarlo nuevamente o comunicarte con una persona del equipo.'
          : 'No pude consultar la compra asociada a este número en este momento. Puedo comunicarte con una persona del equipo para revisarlo.',
      };
    }
    return {
      retryable: false,
      failureKind: 'request_failed',
      message: scope === 'account'
        ? 'No pude consultar la compra en este momento. Puedo intentarlo nuevamente o comunicarte con una persona del equipo.'
        : 'No pude consultar la compra asociada a este número en este momento. Puedo comunicarte con una persona del equipo para revisarlo.',
    };
  }

  /** Preserve an unavailable/unauthorized/failed source when no records remain. */
  private discoveryCoverageFailures(
    coverage: readonly PurchaseSourceCoverage[],
  ): AgentPurchaseLookupResult[] {
    return coverage.flatMap((entry): AgentPurchaseLookupResult[] => {
      if (entry.status === 'unauthorized') {
        return [{ status: 'unauthorized', resource: entry.source, error: 'Source authorization was unavailable.' }];
      }
      if (entry.status === 'unavailable') {
        return [{ status: 'route_unavailable', resource: entry.source, retryable: false, error: 'Source was unavailable.' }];
      }
      if (entry.status === 'failed') {
        return [{ status: 'failed', resource: entry.source, retryable: true, failureKind: 'request_failed', error: 'Source read failed.' }];
      }
      return [];
    });
  }

  /**
   * One source contract: a phone-scoped purchase request reads exactly its
   * structured resource. Aspects select answer facts, never the route, and
   * no pin bypass exists. One read per request; the per-turn scoped lookup
   * map still collapses repeated scoped reads into a single call. Discovery
   * legs pass skipReferenceResolution so the exact-reference match runs
   * once across the merged sources instead of narrowing each source alone.
   */
  private async lookupPhonePurchase(
    request: PurchaseRequest,
    trustedPhone: AgentAuthByPhoneInput,
    phoneGateway: AgentConversationGateway,
    phonePurchaseLookups: Map<
      string,
      Promise<AgentPhonePurchaseLookupResult | undefined>
    >,
    options?: {
      skipReferenceResolution?: boolean;
    },
  ): Promise<{
    result: AgentPhonePurchaseLookupResult;
    coverage: 'complete' | 'partial';
    sourceResource: 'orders' | 'gift_purchases';
    referenceResolution: 'not_requested' | 'matched' | 'unavailable';
    requestedCustomerTransactionNumber: string | null;
  } | undefined> {
    if (request.resource === 'purchase_discovery') {
      throw new Error('lookupPhonePurchase reads one established source; discovery legs narrow first.');
    }
    const lookupResource: 'orders' | 'gift_purchases' = request.resource;
    if (
      (lookupResource === 'orders' && !this.gatewayMethodConfigured('getGuestOrdersByPhone')) ||
      (lookupResource === 'gift_purchases' &&
        !this.gatewayMethodConfigured('getGuestGiftPurchasesByPhone'))
    ) {
      return undefined;
    }
    if (!this.capabilityAvailable(
      lookupResource === 'orders' ? 'purchase.orders.read' : 'purchase.gift_detail.read',
      true,
    )) {
      return undefined;
    }
    const parsedOrderIdReference = parseOrderReference(request.orderId);
    const requestedCustomerTransactionNumber =
      this.parseRequestedCustomerTransactionNumber(request);
    const lookupOrderId = parsedOrderIdReference?.kind === 'backend_order_id'
      ? parsedOrderIdReference.orderId
      : null;
    const key = [
      lookupResource,
      trustedPhone.phone_extension,
      trustedPhone.phone_number,
      lookupOrderId ?? '*',
    ].join(':');
    const existing = phonePurchaseLookups.get(key);
    const skipReferenceResolution = options?.skipReferenceResolution === true;
    const rawLookup = (
      result: AgentPhonePurchaseLookupResult,
      sourceResource: 'orders' | 'gift_purchases',
      coverage: 'complete' | 'partial',
    ): {
      result: AgentPhonePurchaseLookupResult;
      coverage: 'complete' | 'partial';
      sourceResource: 'orders' | 'gift_purchases';
      referenceResolution: 'not_requested' | 'matched' | 'unavailable';
      requestedCustomerTransactionNumber: string | null;
    } => ({
      result,
      coverage,
      sourceResource,
      referenceResolution: 'not_requested',
      requestedCustomerTransactionNumber: null,
    });
    if (existing) {
      const result = await existing;
      if (!result) {
        return undefined;
      }
      return skipReferenceResolution
        ? rawLookup(result, lookupResource, 'complete')
        : this.resolveCustomerTransactionLookup(
          result,
          lookupResource,
          requestedCustomerTransactionNumber,
          'complete',
        );
    }
    const lookupPromise = this.withCustomerRead(`agent.guest_${lookupResource}`, () =>
      lookupResource === 'orders'
      ? phoneGateway.getGuestOrdersByPhone!({
          phone_extension: trustedPhone.phone_extension,
          phone_number: trustedPhone.phone_number,
          orderId: lookupOrderId,
        })
      : phoneGateway.getGuestGiftPurchasesByPhone!({
          phone_extension: trustedPhone.phone_extension,
          phone_number: trustedPhone.phone_number,
          orderId: lookupOrderId,
        }),
    ).catch((): AgentPhonePurchaseLookupResult => ({
      status: 'failed',
      resource: lookupResource,
      retryable: true,
      failureKind: 'request_failed',
      error: 'Customer source read failed.',
    }));
    phonePurchaseLookups.set(key, lookupPromise);
    const lookup = await lookupPromise;
    const coverage: 'complete' | 'partial' = 'complete';
    const sourceResource: 'orders' | 'gift_purchases' = lookupResource;
    return skipReferenceResolution
      ? rawLookup(lookup, sourceResource, coverage)
      : this.resolveCustomerTransactionLookup(
        lookup,
        sourceResource,
        requestedCustomerTransactionNumber,
        coverage,
      );
  }

  private resolveCustomerTransactionLookup(
    result: AgentPhonePurchaseLookupResult,
    sourceResource: 'orders' | 'gift_purchases',
    requestedCustomerTransactionNumber: string | null,
    coverage: 'complete' | 'partial',
  ): {
    result: AgentPhonePurchaseLookupResult;
    coverage: 'complete' | 'partial';
    sourceResource: 'orders' | 'gift_purchases';
    referenceResolution: 'not_requested' | 'matched' | 'unavailable';
    requestedCustomerTransactionNumber: string | null;
  } {
    if (!requestedCustomerTransactionNumber || result.status !== 'success') {
      return {
        result,
        coverage,
        sourceResource,
        referenceResolution: requestedCustomerTransactionNumber
          ? 'unavailable'
          : 'not_requested',
        requestedCustomerTransactionNumber,
      };
    }
    const partitioned = this.partitionedPurchaseLookup(result);
    const availablePurchases = partitioned.purchases;
    const purchasesWithCustomerReference = result.purchases.filter(
      (purchase) => Boolean(purchase.customerTransactionNumber),
    );
    const partitionedReferences = availablePurchases.filter(
      (purchase) => Boolean(purchase.customerTransactionNumber),
    );
    const references = partitioned.hasPartitions
      ? partitionedReferences
      : purchasesWithCustomerReference;
    if (references.length === 0) {
      return {
        result,
        coverage: 'partial',
        sourceResource,
        referenceResolution: 'unavailable',
        requestedCustomerTransactionNumber,
      };
    }
    const matches = references.filter(
      (purchase) =>
        purchase.customerTransactionNumber === requestedCustomerTransactionNumber,
    );
    if (matches.length === 0) {
      return {
        // A reference present on some other record does not identify the
        // requested reference. Preserve every authorized candidate so the
        // reply can distinguish them without claiming a false match.
        result,
        coverage,
        sourceResource,
        referenceResolution: 'unavailable',
        requestedCustomerTransactionNumber,
      };
    }
    return {
      result: {
        ...result,
        purchases: matches,
      },
      coverage,
      sourceResource,
      referenceResolution: 'matched',
      requestedCustomerTransactionNumber,
    };
  }

  private eventScopedPurchasesForRequest(
    request: PurchaseRequest,
    snapshot: PhoneContextSnapshot,
  ): PurchaseInformation[] {
    return [...snapshot.purchasesByOrderId.values()].filter((purchase) =>
      purchase.recordSource === 'event_detail' &&
      (!request.orderId || purchase.orderId === request.orderId),
    );
  }

  private mergePhonePurchase(
    snapshot: PhoneContextSnapshot,
    incoming: PurchaseInformation,
    source: PurchaseRecordSource,
    partition: PurchasePartition = 'legacy_orders',
  ): void {
    const stamped: PurchaseInformation = {
      ...incoming,
      recordSource: source,
      accessScope: incoming.accessScope ?? 'trusted_phone_purchase',
      ...(partition ? { partition } : {}),
    };
    const sameId = [...snapshot.purchasesByOrderId.values()].filter((purchase) =>
      purchase.orderId === stamped.orderId,
    );
    const current = sameId.find((purchase) =>
      purchase.recordSource === source &&
      (purchase.partition ?? 'legacy_orders') === partition,
    );
    const conflicting = sameId.some((purchase) => hasPurchaseFactConflict(purchase, stamped));
    if (conflicting) snapshot.inconsistentOrderIds.add(stamped.orderId);
    if (current) {
      if (!hasPurchaseFactConflict(current, stamped)) {
        const outcome = reconcileTwoRecords(
          current,
          source,
          partition,
          stamped,
          source,
          partition,
        );
        snapshot.purchasesByOrderId.set(
          phonePurchaseKey(current, source, partition),
          outcome.canonical,
        );
        return;
      }
      let variant = 1;
      while (snapshot.purchasesByOrderId.has(phonePurchaseKey(stamped, source, partition, variant))) {
        variant += 1;
      }
      snapshot.purchasesByOrderId.set(
        phonePurchaseKey(stamped, source, partition, variant),
        stamped,
      );
      return;
    }
    const key = phonePurchaseKey(stamped, source, partition);
    const exactDuplicate = sameId.some((purchase) => JSON.stringify(purchase) === JSON.stringify(stamped));
    if (!exactDuplicate) snapshot.purchasesByOrderId.set(key, stamped);
  }

  private reconcilePhoneContextResults(
    requests: PendingInformationRequest[],
    results: InformationTaskResult[],
    snapshot: PhoneContextSnapshot,
  ): InformationTaskResult[] {
    const requestById = new Map(requests.map((request) => [request.requestId, request]));
    return results.map((result) => {
      if (
        result.status !== 'completed' ||
        result.kind !== 'purchase' ||
        (result.accessMethod !== 'trusted_phone_purchase' &&
          result.accessMethod !== 'trusted_phone_event_purchase')
      ) {
        return result;
      }
      const request = requestById.get(result.requestId);
      if (!request || request.kind !== 'purchase') {
        return result;
      }
      return {
        ...result,
        coverage: result.purchases.some((purchase) =>
          snapshot.inconsistentOrderIds.has(purchase.orderId))
          ? 'inconsistent'
          : result.coverage ?? 'complete',
      };
    });
  }

  private filterPurchaseCandidates(
    purchases: PurchaseInformation[],
    requestedCustomerTransactionNumber: string | null = null,
  ): { purchases: PurchaseInformation[]; needsSelection: boolean } {
    // An explicit customer reference is authoritative identity evidence. A
    // match narrows to the matching records; an unmatched reference retains
    // the authorized scope with selection so the reply asks instead of
    // implying a link or silently selecting a non-matching record.
    if (requestedCustomerTransactionNumber) {
      const referenceMatches = purchases.filter(
        (purchase) => purchase.customerTransactionNumber === requestedCustomerTransactionNumber,
      );
      if (referenceMatches.length > 0) {
        return {
          purchases: referenceMatches,
          needsSelection: referenceMatches.length > 1,
        };
      }
      return { purchases, needsSelection: true };
    }
    // Descriptive hints (eventHint/amount/date) never filter candidates:
    // the reply model resolves natural references from the retained
    // authorized records and asks a meaningful distinction when several
    // remain.
    // Lane B: candidate count is factual metadata (the result already
    // carries every purchase), never a semantic unresolved-selection
    // assertion. Only an explicit validated-reference mismatch above sets
    // needsSelection here.
    return {
      purchases,
      needsSelection: false,
    };
  }

  private async lookupPurchase(
    request: PurchaseRequest,
    token: string,
    orderId: string | null,
    cache?: Map<string, Promise<AgentPurchaseLookupResult | undefined>>,
  ): Promise<AgentPurchaseLookupResult | undefined> {
    // One source contract: authenticated reads keep the declared
    // resource, the same structured value the phone path reads. One
    // partition per request; discovery legs arrive already narrowed to one
    // source by the expansion, never by re-reading here.
    // P1: repeated scoped lookups run once per turn under a token-hash
    // scope so an auth change can never reuse broader cached access.
    if (request.resource === 'purchase_discovery') {
      throw new Error('lookupPurchase reads one established source; discovery legs narrow first.');
    }
    const partition = request.resource;
    if (
      (partition === 'orders' && !this.dependencies.agentGateway.getOrders) ||
      (partition === 'gift_purchases' && !this.dependencies.agentGateway.getGiftPurchases)
    ) {
      return undefined;
    }
    if (!this.capabilityAvailable(
      partition === 'orders' ? 'purchase.orders.read' : 'purchase.gift_detail.read',
      true,
    )) {
      return undefined;
    }
    const scopeKey = cache
      ? [
        'account',
        crypto.createHash('sha256').update(token).digest('hex').slice(0, 16),
        partition,
        orderId ?? '*',
      ].join(':')
      : null;
    if (scopeKey && cache) {
      const existing = cache.get(scopeKey);
      if (existing) {
        return await existing;
      }
      const operation = partition === 'orders' ? 'agent.orders' : 'agent.gift_purchases';
      const pending = this.withCustomerRead(operation, async () => (
        partition === 'orders'
          ? await this.dependencies.agentGateway.getOrders!({ token, orderId })
          : await this.dependencies.agentGateway.getGiftPurchases!({ token, orderId })
      )).catch((): AgentPurchaseLookupResult => ({
        status: 'failed',
        resource: partition,
        retryable: true,
        failureKind: 'request_failed',
        error: 'Customer source read failed.',
      }));
      cache.set(scopeKey, pending);
      return await pending;
    }
    return this.withCustomerRead(
      partition === 'orders' ? 'agent.orders' : 'agent.gift_purchases',
      () => partition === 'orders'
        ? this.dependencies.agentGateway.getOrders!({ token, orderId })
        : this.dependencies.agentGateway.getGiftPurchases!({ token, orderId }),
    ).catch((): AgentPurchaseLookupResult => ({
      status: 'failed',
      resource: partition,
      retryable: true,
      failureKind: 'request_failed',
      error: 'Customer source read failed.',
    }));
  }

  private projectPurchase(
    purchase: PurchaseInformation,
    _request: PurchaseRequest,
    options?: {
      readonly transactionReferenceAuthorized?: boolean;
      readonly requestedCustomerTransactionNumber?: string | null;
    },
  ): PurchaseInformation {
    const items = purchase.items.map((item) => ({
      ...item,
      fulfillment: mapItemFulfillment(item.type),
    }));
    const payment = purchase.payment
      ? (() => {
        const {
          voucherImage,
          paymentId: _paymentId,
          ...facts
        } = purchase.payment;
        void _paymentId;
        return {
          ...facts,
          ...(voucherImage !== undefined
            ? {
              voucherProvided: voucherImage === null
                ? null
                : Array.isArray(voucherImage)
                  ? voucherImage.length > 0
                  : voucherImage.length > 0,
            }
            : {}),
        };
      })()
      : purchase.payment;
    const {
      customerTransactionNumber: _transactionReference,
      adminComment: _adminComment,
      ...customerFacts
    } = purchase;
    void _transactionReference;
    void _adminComment;
    const creditFulfillmentPolicy = creditFulfillmentPolicyForItems(items);
    return {
      ...customerFacts,
      recordSource: purchase.recordSource ?? (
        _request.resource === 'gift_purchases' ? 'gift_purchases' : 'orders'
      ),
      accessScope: purchase.accessScope ?? (options?.transactionReferenceAuthorized
        ? 'authenticated_account'
        : 'trusted_phone_purchase'),
      customerTransactionNumber: transactionReferenceVisible(purchase, options)
        ? purchase.customerTransactionNumber ?? null
        : null,
      items,
      payment,
      dedication: purchase.dedication ? { ...purchase.dedication } : null,
      thanks: purchase.thanks ? { ...purchase.thanks } : purchase.thanks,
      paymentValidationExpectation: pendingPaymentValidationExpectation(purchase),
      ...(creditFulfillmentPolicy !== undefined ? { creditFulfillmentPolicy } : {}),
    };
  }

  private projectCart(
    cart: CartInformation,
    accessScope: string,
  ): CartInformation {
    return {
      ...cart,
      recordSource: 'orders',
      accessScope: cart.accessScope ?? accessScope,
      items: cart.items.map((item) => ({ ...item })),
    };
  }

  private sourceFor(
    request: PendingInformationRequest,
  ): InformationExecutionSummary['source'] {
    if (request.kind === 'faq') {
      return 'knowledge_base';
    }
    if (request.kind === 'associated_event') {
      return 'associated_event_api';
    }
    return 'agent_api';
  }

  private resultCount(result: InformationTaskResult): number {
    if (result.status !== 'completed') {
      return 0;
    }
    if (result.kind === 'faq') {
      return result.evidence.length;
    }
    if (result.kind === 'associated_event') {
      return result.result.events.length;
    }
    return result.purchases.length;
  }

  private outcomeCode(
    result: InformationTaskResult,
  ): InformationExecutionSummary['outcomeCode'] {
    if (result.status === 'needs_input') {
      return 'awaiting_authentication';
    }
    if (result.status === 'failed') {
      return result.failureKind;
    }
    return this.resultCount(result) > 0
      ? 'completed_with_results'
      : 'completed_without_results';
  }

  private evidenceReferences(
    result: InformationTaskResult,
  ): InformationExecutionSummary['evidence'] {
    if (result.status !== 'completed') return [];
    if (result.kind === 'faq') {
      return result.evidence.map((entry) => ({
        fileId: entry.fileId,
        filename: entry.filename,
        score: entry.score,
        contentHash: this.hash(entry.text),
        ...(entry.fullArticle === true ? { fullArticle: true as const } : {}),
      }));
    }
    if (result.kind === 'purchase') {
      return projectPurchaseEvidenceItems(result.purchases);
    }
    return [];
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
