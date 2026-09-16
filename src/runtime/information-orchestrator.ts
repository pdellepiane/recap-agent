import crypto from 'node:crypto';
import { hostWithdrawalPolicyQuery, parseHostWithdrawalPolicy } from './host-withdrawal-policy';

import {
  createInformationAuthGuidance,
  enrichmentBounds,
  enrichmentVisitKey,
  type CartInformation,
  type InformationAuthGuidance,
  type InformationExecutionSummary,
  type InformationTaskResult,
  type PendingInformationRequest,
  type PurchasePartition,
  type PurchaseInformation,
  type SensitivePurchaseField,
} from '../core/information';
import { parseOrderReference } from '../core/order-reference';
import { resolvePurchaseResourceForAspects } from './extraction-schemas';
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
  hasPhysicalFulfillment,
  pendingPaymentValidationExpectation,
} from './purchase-disclosure-policy';
import {
  eventMatches as sharedEventMatches,
} from './event-matching';
import {
  detectConflictingFields,
  reconcileTwoRecords,
} from './purchase-reconciliation';
import type {
  RuntimeCapabilityManifest,
  RuntimeOperationId,
} from './capability-manifest';

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
  purchasesByOrderId: Map<string, PurchaseInformation>;
  purchaseSourceByOrderId: Map<string, 'orders' | 'gift_purchases' | 'event'>;
  purchasePartitionByOrderId: Map<string, PurchasePartition>;
  cartsById: Map<string, CartInformation>;
  inconsistentOrderIds: Set<string>;
};

/**
 * Partition metadata is kept outside PurchaseInformation so it cannot leak
 * into the reply projection. Gateways may expose either the camel-case or
 * snake-case envelope while the endpoint rollout is in progress.
 */
type PartitionedPurchaseLookup = {
  purchases: PurchaseInformation[];
  partitionByOrderId: Map<string, PurchasePartition>;
  carts: CartInformation[];
  hasPartitions: boolean;
  conflictingOrderIds: Set<string>;
};

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

export class InformationOrchestrator {
  constructor(
    private readonly dependencies: {
      knowledgeGateway: KnowledgeRetrievalGateway;
      providerGateway: ProviderGateway;
      agentGateway: AgentConversationGateway;
      capabilityManifest?: RuntimeCapabilityManifest;
    },
  ) {}

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

  async execute(args: {
    requests: PendingInformationRequest[];
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock | null;
    trustedPhone?: AgentAuthByPhoneInput | null;
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
      purchaseSourceByOrderId: new Map(),
      purchasePartitionByOrderId: new Map(),
      cartsById: new Map(),
      inconsistentOrderIds: new Set(),
    };
    const guestEventsPromise =
      !args.authentication &&
      canUseTrustedPhone &&
      args.trustedPhone &&
      this.capabilityAvailable('event.association.read', this.gatewayMethodConfigured('getGuestEventsByPhone')) &&
      args.requests.some((request) => request.kind === 'associated_event')
        ? this.lookupGuestEvents(args.trustedPhone)
        : null;
    const outcomes = new Map<number, { result: InformationTaskResult; durationMs: number }>();
    const executeIndexes = async (indexes: number[]): Promise<void> => {
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
    await executeIndexes(nonPurchaseIndexes);
    await executeIndexes(purchaseIndexes);

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
                coverage: result.coverage ?? 'complete',
                resource: result.lookupResource ?? result.resource,
              }
            : result.status === 'failed' && result.accessMethod
            ? {
                accessMethod: result.accessMethod,
                coverage: null,
                ...(request.kind === 'purchase' ? { resource: result.lookupResource ?? request.resource } : {}),
              }
            : {}),
      };
    });

    return { results, summaries };
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
        this.capabilityAvailable(
          request.resource === 'orders' ? 'purchase.orders.read' : 'purchase.gift_detail.read',
          this.gatewayMethodConfigured(
            request.resource === 'orders'
              ? 'getGuestOrdersByPhone'
              : 'getGuestGiftPurchasesByPhone',
          ),
        )
      ) {
        return await this.executePhonePurchaseRequest(
          request,
          trustedPhone,
          phoneGateway,
          phonePurchaseLookups,
          phoneContext,
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
      !this.capabilityAvailable(
        request.resource === 'orders' ? 'purchase.orders.read' : 'purchase.gift_detail.read',
        this.gatewayMethodConfigured(
          request.resource === 'orders' ? 'getOrders' : 'getGiftPurchases',
        ),
      )
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
        const result = await this.dependencies.providerGateway.lookupAuthenticatedUserEvents({
          token: authentication.token,
          email: authentication.email,
        });
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
          result: this.removePurchaseDataFromEventResult(result),
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

    let lookup = await this.lookupPurchase(
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
      };
    }

    const initialEvidence = lookup.status === 'success'
      ? this.partitionedPurchaseLookup(lookup)
      : null;
    if (!request.orderId && initialEvidence?.purchases.length === 1) {
      const onlyOrder = initialEvidence.purchases[0];
      if (onlyOrder) {
        lookup =
          await this.lookupPurchase(
            request,
            authentication.token,
            onlyOrder.orderId,
            accountPurchaseLookups,
          ) ?? lookup;
      }
    }

    if (lookup.status === 'success') {
      const evidence = this.partitionedPurchaseLookup(lookup);
      const candidates = this.filterPurchaseCandidates(
        evidence.purchases,
        request,
        evidence.partitionByOrderId,
      );
      const carts = this.filterCartCandidates(evidence.carts, request);
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: request.resource,
        lookupResource: request.resource,
        purchases: candidates.purchases.map((purchase) =>
          this.projectPurchase(purchase, request),
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
      return await this.dependencies.agentGateway.getGuestEventsByPhone(phone);
    } catch {
      return {
        status: 'failed',
        error: 'Guest event lookup failed.',
        retryable: true,
      };
    }
  }

  /**
   * Bounded invitation -> event/venue detail expansion over documented
   * gateway reads only (getEventDetail). At most two relationship edges per
   * pass (summary -> detail here; detail -> purchases returned for the
   * caller to merge), four concurrent reads, an access-scoped visited set
   * so cyclic order -> event -> order links terminate, the current
   * invocation deadline, and a per-turn cache for identical reads. P3: the
   * hint is the extraction-supplied eventHint carrying the validated
   * inferred target (explicit reference, active-question entity, campaign
   * context, compatible state and temporal proximity as validated by the
   * caller) — explicit-hint-only gating is removed, so a validated inferred
   * hint hydrates the same as an explicit one. Only hint-matched
   * names/slugs are hydrated: a hint-free question keeps summaries so the
   * reply can clarify instead of guessing. Failures are recorded, never
   * thrown, and a bound or deadline never claims a complete profile.
   */
  async hydrateRelevantEventDetails(args: {
    events: readonly AgentGuestEventSummary[];
    eventHint: string | null;
    trustedPhone: AgentAuthByPhoneInput | null;
    scope: string;
    detailCache?: EventDetailCache;
    deadlineMs?: number | null;
    depth?: number;
  }): Promise<EventDetailHydrationOutcome> {
    const outcome: EventDetailHydrationOutcome = {
      details: new Map(),
      purchases: [],
      failures: [],
      readsAttempted: 0,
      truncatedByBound: false,
    };
    const hint = args.eventHint?.trim() ? args.eventHint : null;
    if (!hint) {
      return outcome;
    }
    if ((args.depth ?? 0) >= enrichmentBounds.maxRelationshipEdges) {
      outcome.truncatedByBound = true;
      return outcome;
    }
    const matched = args.events.filter((event) =>
      sharedEventMatches(event.name, hint) || sharedEventMatches(event.slug, hint),
    );
    if (matched.length === 0) {
      return outcome;
    }
    const targets = matched.slice(0, enrichmentBounds.maxConcurrentReads);
    outcome.truncatedByBound = matched.length > targets.length;
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
    const settled = await Promise.allSettled(
      readable.map(async (event) => {
        outcome.readsAttempted += 1;
        const detail = await this.lookupEventDetail(
          event.eventId,
          args.trustedPhone,
          this.dependencies.agentGateway,
          cache,
          args.scope,
        );
        return { event, detail };
      }),
    );
    for (const entry of settled) {
      if (entry.status === 'rejected') {
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
      } else if (detail.error.includes('not configured')) {
        outcome.failures.push({ eventId: event.eventId, failureKind: 'not_configured' });
      } else {
        outcome.failures.push({ eventId: event.eventId, failureKind: 'request_failed' });
      }
    }
    return outcome;
  }

  /**
   * S7 bounded linked-detail enrichment before final owner composition.
   * Follows at most two relationship edges (authorized order -> gift purchase
   * detail; associated invitation/event -> event detail) with at most four
   * reads in flight, a per-turn access-scoped visited/cache key and the
   * shared invocation deadline. Reuses the existing orchestrator capability
   * and gateway access checks plus already-fetched IDs: known IDs and
   * authorized scopes are prerequisites, so a name or recency never
   * authorizes a lookup. Duplicate IDs/cycles fetch once. Optional failures
   * are recorded, never thrown; required unavailable detail stays explicitly
   * unavailable. Read-only: never writes. Absent gateway capability is
   * exposed as unavailable, never a guessed API.
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
    depth?: number;
  }): Promise<CustomerLinkedEnrichment> {
    const giftPurchases: PurchaseInformation[] = [];
    const eventDetails = new Map<number, HydratedEventDetail>();
    const unavailable: string[] = [];
    const failures: Array<{ target: string; failureKind: string }> = [];
    let readsAttempted = 0;
    let truncatedByBound = false;
    if ((args.depth ?? 0) >= enrichmentBounds.maxRelationshipEdges) {
      return {
        giftPurchases,
        eventDetails,
        readsAttempted,
        truncatedByBound: true,
        unavailable,
        failures,
      };
    }
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
    const bounded = planned.slice(0, enrichmentBounds.maxConcurrentReads);
    if (planned.length > bounded.length) truncatedByBound = true;

    const fetchGiftDetail = async (
      orderId: string,
    ): Promise<PurchaseInformation[] | { unavailable: true } | { failure: string }> => {
      if (pastDeadline()) return { failure: 'deadline_exceeded' };
      if (args.authentication) {
        if (
          !this.capabilityAvailable('purchase.gift_detail.read', this.gatewayMethodConfigured('getGiftPurchases')) ||
          !this.dependencies.agentGateway.getGiftPurchases
        ) {
          return { unavailable: true };
        }
        try {
          const lookup = await this.dependencies.agentGateway.getGiftPurchases({
            token: args.authentication.token,
            orderId,
          });
          if (lookup.status === 'success') return lookup.purchases;
          if (lookup.status === 'not_found') return { unavailable: true };
          return { failure: 'request_failed' };
        } catch {
          return { failure: 'request_failed' };
        }
      }
      if (args.trustedPhone) {
        if (
          !this.capabilityAvailable('purchase.gift_detail.read', this.gatewayMethodConfigured('getGuestGiftPurchasesByPhone')) ||
          !this.dependencies.agentGateway.getGuestGiftPurchasesByPhone
        ) {
          return { unavailable: true };
        }
        try {
          const lookup = await this.dependencies.agentGateway.getGuestGiftPurchasesByPhone({
            phone_extension: args.trustedPhone.phone_extension,
            phone_number: args.trustedPhone.phone_number,
            orderId,
          });
          if (lookup.status === 'success') return lookup.purchases;
          if (lookup.status === 'not_found') return { unavailable: true };
          return { failure: 'request_failed' };
        } catch {
          return { failure: 'request_failed' };
        }
      }
      return { unavailable: true };
    };

    const settled = await Promise.allSettled(
      bounded.map(async (read) => {
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
          args.trustedPhone,
          this.dependencies.agentGateway,
          cache,
          args.scope,
        );
        return { read, outcome: detail };
      }),
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
    if (pastDeadline() && (bounded.length > 0)) truncatedByBound = true;
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
  ): Promise<InformationTaskResult> {
    const selected = this.selectGuestEvent(events, request.eventHint);
    if (!selected) {
      // Shared names or several candidates: hydrate explicitly relevant
      // details (bounded) so the reply can disambiguate with facts instead
      // of asking for information that can be read. Without an explicit
      // reference the summaries stay bare for clarification. Failures keep
      // the known association; they never fail the whole read.
      const hydration = await this.hydrateRelevantEventDetails({
        events,
        eventHint: request.eventHint,
        trustedPhone,
        scope: 'trusted_phone_guest',
        detailCache: eventDetailLookups,
        deadlineMs,
      });
      for (const purchase of hydration.purchases) {
        this.mergePhonePurchase(phoneContext, purchase, 'event');
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
      this.mergePhonePurchase(phoneContext, purchase, 'event');
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
    const lookup = phoneGateway.getEventDetail({
      eventId,
      ...(trustedPhone ? { phone: trustedPhone } : {}),
    });
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
        orders:
          effectiveEnriched?.event.eventId === event.eventId
            ? effectivePurchases.map((purchase) => ({
                id: null,
                incrementId: purchase.orderId,
                giftType: purchase.items[0]?.type ?? null,
                grandTotal: purchase.grandTotal,
                paymentStatus: purchase.paymentStatus,
                shippingStatus: purchase.shippingStatus,
                createdAt: purchase.createdAt,
                paymentMethod: purchase.paymentMethod,
              }))
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
    const partitionByOrderId = new Map<string, PurchasePartition>();
    const conflictingOrderIds = new Set<string>();

    const add = (entries: PurchaseInformation[], partition: PurchasePartition): void => {
      for (const purchase of entries) {
        const existingPartition = partitionByOrderId.get(purchase.orderId);
        if (existingPartition) {
          if (existingPartition !== (purchase.partition ?? partition)) {
            conflictingOrderIds.add(purchase.orderId);
          }
          continue;
        }
        purchases.push(purchase);
        partitionByOrderId.set(purchase.orderId, purchase.partition ?? partition);
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
    return { purchases, partitionByOrderId, carts, hasPartitions, conflictingOrderIds };
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
  ): Promise<InformationTaskResult> {
    const eventScopedPurchases = this.eventScopedPurchasesForRequest(
      request,
      phoneContext,
    );
    if (eventScopedPurchases.length > 0) {
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: request.resource,
        purchases: eventScopedPurchases.map((purchase) =>
          this.projectPurchase(purchase, request),
        ),
        needsSelection: !request.orderId && eventScopedPurchases.length > 1,
        accessMethod: 'trusted_phone_event_purchase',
        coverage: 'complete',
      };
    }
    const lookup = await this.lookupPhonePurchase(
      request,
      trustedPhone,
      phoneGateway,
      phonePurchaseLookups,
    );
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
      const carts = this.filterCartCandidates(evidence.carts, request);
      const candidates = this.filterPurchaseCandidates(
        evidence.purchases,
        request,
        evidence.partitionByOrderId,
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
          carts: carts.map((cart) => this.projectCart(cart)),
        };
        return result;
      }
      if (purchases.length === 0) {
        const hasExplicitSelector =
          Boolean(request.eventHint?.trim()) ||
          (request.amount !== null && request.amount !== undefined) ||
          Boolean(this.requestDateSelector(request));
        if (hasExplicitSelector && evidence.purchases.length > 0) {
          return {
            requestId: request.requestId,
            kind: 'purchase',
            status: 'failed',
            retryable: false,
            failureKind: 'not_found',
            message:
              'No encontré una compra que coincida con la referencia indicada entre las asociadas a este número. Se necesita apoyo del equipo para revisar esa referencia.',
            accessMethod: 'trusted_phone_purchase',
            lookupResource: lookup.sourceResource,
          };
        }
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
          evidence.partitionByOrderId.get(purchase.orderId),
        );
      }
      const result: PurchaseTaskResult = {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: request.resource,
        lookupResource: lookup.sourceResource,
        purchases: purchases.map((purchase) =>
          this.projectPurchase(purchase, request),
        ),
        needsSelection:
          lookup.referenceResolution === 'unavailable' || candidates.needsSelection,
        accessMethod: 'trusted_phone_purchase',
        coverage: lookup.coverage,
        carts: carts.map((cart) => this.projectCart(cart)),
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
    };
  }

  /**
   * Single-partition purchase selection for phone-scoped reads, derived from
   * the typed aspects alone: requested gift detail (dedication, thanks, the
   * requested payment time in payment_details) reads the gift-detail route,
   * every other question reads orders. One partition only, never both: no
   * sentence matching, no dual reads. The authenticated read below keeps its
   * declared resource (already coerced to the aspects upstream), so summary
   * questions stay on their route on both paths.
   */
  private selectPurchasePartition(
    request: PurchaseRequest,
  ): 'orders' | 'gift_purchases' {
    return request.aspects.some(
      (aspect) => aspect === 'dedication' || aspect === 'thanks' || aspect === 'payment_details',
    )
      ? 'gift_purchases'
      : 'orders';
  }

  private async lookupPhonePurchase(
    request: PurchaseRequest,
    trustedPhone: AgentAuthByPhoneInput,
    phoneGateway: AgentConversationGateway,
    phonePurchaseLookups: Map<
      string,
      Promise<AgentPhonePurchaseLookupResult | undefined>
    >,
  ): Promise<{
    result: AgentPhonePurchaseLookupResult;
    coverage: 'complete' | 'partial';
    sourceResource: 'orders' | 'gift_purchases';
    referenceResolution: 'not_requested' | 'matched' | 'unavailable';
    requestedCustomerTransactionNumber: string | null;
  } | undefined> {
    const lookupResource: 'orders' | 'gift_purchases' =
      this.selectPurchasePartition(request);
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
    const parsedQueryReference = parseOrderReference(request.query);
    // The extractor normally places a bare COD reference in orderId, but a
    // bare-code query without orderId is still an explicit customer
    // reference. Only a customer_transaction parse qualifies; anything else
    // in the query is never treated as a backend id filter.
    const requestedCustomerTransactionNumber =
      parsedOrderIdReference?.kind === 'customer_transaction'
        ? parsedOrderIdReference.transactionNumber
        : parsedQueryReference?.kind === 'customer_transaction'
          ? parsedQueryReference.transactionNumber
          : null;
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
    if (existing) {
      const result = await existing;
      if (!result) {
        return undefined;
      }
      return this.resolveCustomerTransactionLookup(
        result,
        lookupResource,
        requestedCustomerTransactionNumber,
        'complete',
      );
    }
    const lookupPromise = lookupResource === 'orders'
      ? phoneGateway.getGuestOrdersByPhone!({
          phone_extension: trustedPhone.phone_extension,
          phone_number: trustedPhone.phone_number,
          orderId: lookupOrderId,
        })
      : phoneGateway.getGuestGiftPurchasesByPhone!({
          phone_extension: trustedPhone.phone_extension,
          phone_number: trustedPhone.phone_number,
          orderId: lookupOrderId,
        });
    phonePurchaseLookups.set(key, lookupPromise);
    let lookup = await lookupPromise;
    let coverage: 'complete' | 'partial' = 'complete';
    let sourceResource: 'orders' | 'gift_purchases' = lookupResource;

    // Gift purchases is the detailed route. If it is temporarily failing,
    // one summary/status request can still be answered through guest orders.
    if (
      lookupResource === 'gift_purchases' &&
      this.isSummaryOrStatusRequest(request) &&
      this.isRetryableLookupFailure(lookup) &&
      phoneGateway.getGuestOrdersByPhone &&
      this.capabilityAvailable('purchase.orders.read', true)
    ) {
      const fallbackKey = [
        'orders',
        trustedPhone.phone_extension,
        trustedPhone.phone_number,
        lookupOrderId ?? '*',
      ].join(':');
      const fallbackExisting = phonePurchaseLookups.get(fallbackKey);
      const fallbackPromise = fallbackExisting ?? phoneGateway.getGuestOrdersByPhone({
        phone_extension: trustedPhone.phone_extension,
        phone_number: trustedPhone.phone_number,
        orderId: lookupOrderId,
      });
      if (!fallbackExisting) {
        phonePurchaseLookups.set(fallbackKey, fallbackPromise);
      }
      const fallback = await fallbackPromise;
      if (fallback?.status === 'success' && fallback.purchases.length > 0) {
        lookup = fallback;
        coverage = 'partial';
        sourceResource = 'orders';
      }
    }
    return this.resolveCustomerTransactionLookup(
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
        result: {
          status: 'not_found',
          resource: result.resource,
          orderId: requestedCustomerTransactionNumber,
        },
        coverage,
        sourceResource,
        referenceResolution: 'matched',
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
    if (request.orderId) {
      const purchase = snapshot.purchasesByOrderId.get(request.orderId);
      return purchase && snapshot.purchaseSourceByOrderId.get(request.orderId) === 'event'
        ? [purchase]
        : [];
    }
    return [...snapshot.purchasesByOrderId.entries()]
      .filter(([orderId]) => snapshot.purchaseSourceByOrderId.get(orderId) === 'event')
      .map(([, purchase]) => purchase);
  }

  private mergePhonePurchase(
    snapshot: PhoneContextSnapshot,
    incoming: PurchaseInformation,
    source: 'orders' | 'gift_purchases' | 'event',
    partition: PurchasePartition = 'legacy_orders',
  ): void {
    const current = snapshot.purchasesByOrderId.get(incoming.orderId);
    const currentSource = snapshot.purchaseSourceByOrderId.get(incoming.orderId);
    if (!current || !currentSource) {
      snapshot.purchasesByOrderId.set(incoming.orderId, incoming);
      snapshot.purchaseSourceByOrderId.set(incoming.orderId, source);
      snapshot.purchasePartitionByOrderId.set(incoming.orderId, partition);
      return;
    }
    const currentPartition = snapshot.purchasePartitionByOrderId.get(incoming.orderId) ?? 'legacy_orders';
    const outcome = reconcileTwoRecords(
      current,
      currentSource,
      currentPartition,
      incoming,
      source,
      partition,
    );
    if (outcome.status === 'conflict') {
      snapshot.inconsistentOrderIds.add(incoming.orderId);
    }
    snapshot.purchasesByOrderId.set(incoming.orderId, outcome.canonical);
    snapshot.purchaseSourceByOrderId.set(
      incoming.orderId,
      outcome.provenance['orderId']?.source ?? source,
    );
    snapshot.purchasePartitionByOrderId.set(
      incoming.orderId,
      outcome.canonical.partition ?? partition,
    );
  }

  private mergePurchaseRecords(
    preferred: PurchaseInformation,
    fallback: PurchaseInformation,
  ): PurchaseInformation {
    const outcome = reconcileTwoRecords(
      fallback,
      'orders',
      fallback.partition ?? 'legacy_orders',
      preferred,
      'gift_purchases',
      preferred.partition ?? 'legacy_orders',
    );
    return outcome.canonical;
  }

  private purchaseRecordsConflict(
    left: PurchaseInformation,
    right: PurchaseInformation,
  ): boolean {
    return detectConflictingFields(left, right).length > 0;
  }

  private reconcilePhoneContextResults(
    requests: PendingInformationRequest[],
    results: InformationTaskResult[],
    snapshot: PhoneContextSnapshot,
  ): InformationTaskResult[] {
    const requestById = new Map(requests.map((request) => [request.requestId, request]));
    return results.map((result) => {
      if (result.status === 'completed' && result.kind === 'associated_event') {
        return {
          ...result,
          result: this.removePurchaseDataFromEventResult(result.result),
        };
      }
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
      const purchases = result.purchases.map((projected) => {
        const canonical = snapshot.purchasesByOrderId.get(projected.orderId);
        if (!canonical) return projected;
        // Partition conflicts (same order id in pending and completed) never
        // become a confident preferred status: strip settlement-critical
        // fields so the reply must request review instead of asserting one side.
        const conflicted = snapshot.inconsistentOrderIds.has(projected.orderId);
        const effective = conflicted
          ? { ...canonical, paymentStatus: null, grandTotal: null, paymentMethod: null, amountDisclosure: null }
          : canonical;
        return this.projectPurchase(effective, request);
      });
      return {
        ...result,
        purchases,
        coverage: purchases.some((purchase) =>
          snapshot.inconsistentOrderIds.has(purchase.orderId))
          ? 'inconsistent'
          : result.coverage ?? 'complete',
      };
    });
  }

  private isSummaryOrStatusRequest(request: PurchaseRequest): boolean {
    return request.aspects.every((aspect) =>
      aspect === 'summary' ||
      aspect === 'payment_status' ||
      aspect === 'shipping' ||
      aspect === 'decline'
    );
  }

  private filterPurchaseCandidates(
    purchases: PurchaseInformation[],
    request: PurchaseRequest,
    partitionByOrderId: ReadonlyMap<string, PurchasePartition> = new Map(),
    requestedCustomerTransactionNumber: string | null = null,
  ): { purchases: PurchaseInformation[]; needsSelection: boolean } {
    const hasEventSelector = Boolean(request.eventHint?.trim());
    const hasAmountSelector = request.amount !== null && request.amount !== undefined;
    const requestedDate = this.requestDateSelector(request);
    const hasDateSelector = Boolean(requestedDate);
    const hasSelector = hasEventSelector || hasAmountSelector || hasDateSelector;

    // An explicit customer reference is authoritative identity evidence. A
    // unique match narrows structurally; an unmatched reference over several
    // records keeps every candidate with selection so the reply asks instead
    // of implying a link through the pending partition.
    if (requestedCustomerTransactionNumber) {
      const referenceMatches = purchases.filter(
        (purchase) => purchase.customerTransactionNumber === requestedCustomerTransactionNumber,
      );
      if (referenceMatches.length === 1) {
        return { purchases: referenceMatches, needsSelection: false };
      }
      if (referenceMatches.length === 0 && purchases.length > 1) {
        return { purchases, needsSelection: true };
      }
    }

    // Typed guard: a reported payment amount in an active thread is payment evidence, not purchase identity.
    // When the pending partition has exactly one order and the question is a current-payment question,
    // ignore a lone amount selector without eventHint/orderId. Residual edge: an explicit historical-amount
    // question with a single pending order will still resolve to that pending order.
    // Partition semantics: backend ships pending_orders as pending+declined+error+null, so terminal
    // payment_status=declined must be excluded from the guard count - otherwise any declined order in the
    // partition permanently disables the guard for that phone.
    const pendingForGuard = purchases.filter(
      (purchase) =>
        partitionByOrderId.get(purchase.orderId) === 'pending_orders' &&
        purchase.paymentStatus?.toLocaleLowerCase('es') !== 'declined',
    );
    if (
      !request.orderId &&
      !hasEventSelector &&
      pendingForGuard.length === 1 &&
      this.isCurrentPaymentQuestion(request)
    ) {
      return { purchases: pendingForGuard, needsSelection: false };
    }

    if (hasEventSelector && hasAmountSelector) {
      const eventMatched = purchases.filter((purchase) =>
        this.eventMatches(purchase.eventName, request.eventHint ?? ''),
      );
      if (eventMatched.length === 1) {
        const amountMatchesAny = purchases.some((purchase) => {
          const knownAmounts = [purchase.grandTotal, purchase.payment?.amount].filter(
            (amount): amount is number => amount !== null && amount !== undefined,
          );
          return knownAmounts.some((amount) => Math.abs(amount - (request.amount ?? 0)) < 0.005);
        });
        if (!amountMatchesAny) {
          return { purchases: eventMatched, needsSelection: false };
        }
      }
    }

    const matches = hasSelector
      ? purchases.filter((purchase) => {
          if (
            hasEventSelector &&
            !this.eventMatches(purchase.eventName, request.eventHint ?? '')
          ) {
            return false;
          }
          if (hasAmountSelector) {
            const knownAmounts = [purchase.grandTotal, purchase.payment?.amount]
              .filter((amount): amount is number => amount !== null && amount !== undefined);
            if (
              knownAmounts.length === 0 ||
              !knownAmounts.some((amount) => Math.abs(amount - (request.amount ?? 0)) < 0.005)
            ) {
              return false;
            }
          }
          if (requestedDate && !this.dateMatches(purchase.eventDate, requestedDate)) {
            return false;
          }
          return true;
        })
      : purchases;

    // Explicit typed evidence is authoritative. Never widen a failed match
    // back to the complete phone history, since that can expose an unrelated
    // historical purchase. An unresolved explicit reference is represented as
    // an empty, non-definitive result by the caller.
    if (hasSelector) {
      return {
        purchases: matches,
        needsSelection: matches.length > 1,
      };
    }

    // A unique pending partition is safe to use for a current status/payment
    // question. This is partition semantics, not a recency heuristic.
    const pending = pendingForGuard;
    if (pending.length === 1 && this.isCurrentPaymentQuestion(request)) {
      return { purchases: pending, needsSelection: false };
    }
    return {
      purchases,
      needsSelection: purchases.length > 1,
    };
  }

  private isCurrentPaymentQuestion(request: PurchaseRequest): boolean {
    return request.aspects.some((aspect) =>
      aspect === 'payment_status' || aspect === 'payment_details' || aspect === 'summary',
    );
  }

  private requestDateSelector(request: PurchaseRequest): string | null {
    const candidate = request as PurchaseRequest & {
      date?: string | null;
      eventDate?: string | null;
    };
    const value = candidate.eventDate ?? candidate.date;
    return typeof value === 'string' && value.trim() ? this.dateReference(value) : null;
  }

  private dateMatches(eventDate: string | null, requestedDate: string): boolean {
    return eventDate ? this.dateReference(eventDate) === requestedDate : false;
  }

  private dateReference(value: string): string {
    const isoDate = value.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0];
    return isoDate ?? value.trim().toLocaleLowerCase('es');
  }

  private eventMatches(
    eventName: string | null | undefined,
    hint: string | null | undefined,
  ): boolean {
    return sharedEventMatches(eventName, hint);
  }

  private filterCartCandidates(
    carts: CartInformation[],
    request: PurchaseRequest,
  ): CartInformation[] {
    const hasEventSelector = Boolean(request.eventHint?.trim());
    const amount = request.amount;
    // Mirror purchase guard: when the unique pending order is selected, the reported amount is payment
    // evidence, not cart identity. Do not amount-filter the same-event cart in that typed case.
    // Amount+eventHint selector behavior remains unchanged. Residual edge documented in filterPurchaseCandidates.
    const skipAmountFilter =
      !request.orderId &&
      !hasEventSelector &&
      amount !== null &&
      amount !== undefined &&
      this.isCurrentPaymentQuestion(request);
    if (hasEventSelector && amount !== null && amount !== undefined) {
      const eventMatched = carts.filter((cart) =>
        this.eventMatches(cart.eventName, request.eventHint ?? ''),
      );
      if (eventMatched.length === 1) {
        const amountMatchesAny = carts.some(
          (cart) => typeof cart.subtotal === 'number' && Math.abs(cart.subtotal - amount) < 0.005,
        );
        if (!amountMatchesAny) {
          return eventMatched;
        }
      }
    }
    return carts.filter((cart) => {
      if (
        hasEventSelector &&
        !this.eventMatches(cart.eventName, request.eventHint ?? '')
      ) {
        return false;
      }
      if (!skipAmountFilter && amount !== null && amount !== undefined) {
        if (typeof cart.subtotal !== 'number' || Math.abs(cart.subtotal - amount) >= 0.005) {
          return false;
        }
      }
      const requestedDate = this.requestDateSelector(request);
      if (requestedDate && (!cart.eventDate || this.dateReference(cart.eventDate) !== requestedDate)) {
        return false;
      }
      return true;
    });
  }

  private isRetryableLookupFailure(
    lookup: AgentPhonePurchaseLookupResult,
  ): boolean {
    return lookup.status === 'retryable_failure';
  }

  private async lookupPurchase(
    request: PurchaseRequest,
    token: string,
    orderId: string | null,
    cache?: Map<string, Promise<AgentPurchaseLookupResult | undefined>>,
  ): Promise<AgentPurchaseLookupResult | undefined> {
    // Authenticated reads keep the declared resource, which normalization
    // already coerced to the typed aspects (gift detail aspects read the
    // gift route). One partition only, never both. P1: repeated scoped
    // lookups run once per turn under a token-hash scope so an auth change
    // can never reuse broader cached access.
    const partition = resolvePurchaseResourceForAspects(
      request.resource,
      request.aspects,
    );
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
      const pending = (async (): Promise<AgentPurchaseLookupResult | undefined> => (
        partition === 'orders'
          ? await this.dependencies.agentGateway.getOrders?.({ token, orderId })
          : await this.dependencies.agentGateway.getGiftPurchases?.({
            token,
            orderId,
          })
      ))();
      cache.set(scopeKey, pending);
      return await pending;
    }
    return partition === 'orders'
      ? await this.dependencies.agentGateway.getOrders?.({ token, orderId })
      : await this.dependencies.agentGateway.getGiftPurchases?.({
          token,
          orderId,
        });
  }

  private removePurchaseDataFromEventResult(
    result: UserEventLookupResult,
  ): UserEventLookupResult {
    return {
      ...result,
      events: result.events.map((event) => ({
        ...event,
        amountCollected: null,
        amountTransferred: null,
        transactionsCount: null,
        orders: [],
      })),
      counts: {
        ...result.counts,
        recentOrders: 0,
      },
    };
  }

  private projectPurchase(
    purchase: PurchaseInformation,
    request: PurchaseRequest,
  ): PurchaseInformation {
    const aspectSet = new Set(request.aspects);
    const sensitive = new Set<SensitivePurchaseField>(request.sensitiveFields);
    const includePayment = aspectSet.has('payment_details');
    const physicalFulfillment = hasPhysicalFulfillment(purchase);
    const includeAmount = aspectSet.has('summary') || includePayment;
    const disclosedTotal = includeAmount ? purchase.grandTotal : null;
    const disclosedPaid = includePayment ? purchase.payment?.amount ?? null : null;
    // Payment type grounds the pending-validation window message, so it is
    // disclosed for payment_details requests and pending purchases. Approved
    // summaries omit it: status answers never need the method type, and the
    // accountless summary gate forbids introducing card wording.
    const isPendingPurchase = purchase.paymentStatus?.trim().toLocaleLowerCase('en') === 'pending';
    const disclosedMethod = includePayment || isPendingPurchase
      ? purchase.paymentMethod ?? purchase.payment?.method ?? null
      : null;
    const shouldDiscloseAmount =
      disclosedTotal !== null ||
      disclosedPaid !== null ||
      aspectSet.has('validation_window') ||
      aspectSet.has('payment_status');
    const amountDisclosure = shouldDiscloseAmount
      ? {
          total: disclosedTotal,
          paid: disclosedPaid,
          currency: purchase.currency ?? null,
          currencySymbol: purchase.currency ? purchase.currencySymbol ?? null : null,
          paymentMethod: disclosedMethod,
          presentation: purchase.currency
            ? 'explicit_currency' as const
            : 'recorded_method_no_currency' as const,
        }
      : null;

    return {
      orderId: purchase.orderId,
      eventId: purchase.eventId ?? null,
      currency: null,
      customerTransactionNumber: purchase.customerTransactionNumber ?? null,
      paymentStatus:
        aspectSet.has('summary') || aspectSet.has('payment_status') || aspectSet.has('decline')
          ? purchase.paymentStatus
          : null,
      shippingStatus:
        physicalFulfillment &&
        (aspectSet.has('summary') || aspectSet.has('shipping'))
          ? purchase.shippingStatus
          : null,
      grandTotal: null,
      paymentMethod: null,
      amountDisclosure,
      paymentValidationExpectation: pendingPaymentValidationExpectation(purchase),
      eventName: purchase.eventName,
      eventDate: purchase.eventDate,
      eventUrl: purchase.eventUrl,
      createdAt: purchase.createdAt,
      items: aspectSet.has('summary') ? purchase.items : [],
      ...(includePayment
        ? {
            payment: purchase.payment
              ? {
                  method: null,
                  amount: null,
                  paidAt: purchase.payment.paidAt,
                  ...(sensitive.has('payment_id')
                    ? { paymentId: purchase.payment.paymentId ?? null }
                    : {}),
                  ...(sensitive.has('transaction_status')
                    ? { transactionStatus: purchase.payment.transactionStatus ?? null }
                    : {}),
                  ...(sensitive.has('gateway_message')
                    ? { gatewayMessage: purchase.payment.gatewayMessage ?? null }
                    : {}),
                  ...(sensitive.has('operation_code')
                    ? { operationCode: purchase.payment.operationCode ?? null }
                    : {}),
                  // Bank routing identifiers and uploaded vouchers are never
                  // part of the model-facing evidence, even when requested.
                }
              : null,
          }
        : {}),
      ...(aspectSet.has('decline')
        ? {
            declineCode: purchase.declineCode ?? null,
            adminComment: purchase.adminComment ?? null,
          }
        : {}),
      ...(aspectSet.has('dedication')
        ? {
            dedication: purchase.dedication
              ? {
                  ...purchase.dedication,
                  physicalStatus: physicalFulfillment
                    ? purchase.dedication.physicalStatus
                    : null,
                }
              : null,
          }
        : {}),
      ...(aspectSet.has('thanks')
        ? {
            thanks: purchase.thanks ?? null,
            isThanked: purchase.isThanked ?? null,
          }
        : {}),
    };
  }

  private projectCart(cart: CartInformation): CartInformation {
    return {
      cartId: cart.cartId,
      status: cart.status,
      wasAbandoned: cart.wasAbandoned,
      eventId: cart.eventId ?? null,
      eventName: cart.eventName ?? null,
      eventDate: cart.eventDate ?? null,
      subtotal: null,
      amountDisclosure: null,
      giftsQuantity: cart.giftsQuantity ?? null,
      // Offset-less timestamps are normalized to null by the gateway.
      createdAt: cart.createdAt ?? null,
      items: cart.items.map((item) => ({
        giftName: item.giftName ?? null,
        quantity: item.quantity ?? null,
        amount: item.amount ?? null,
        rowTotal: item.rowTotal ?? null,
        type: item.type ?? null,
      })),
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
      }));
    }
    // Packet O5 typed purchase facts for judge evidence (supersedes the
    // R05 filename/score bridge). One entry per candidate-visible purchase:
    // amounts, currency presence, method, status and event labels travel as
    // typed purchaseFact fields; order ids, phones, emails and reference
    // values never travel (reference presence only). filename carries no
    // event label and score carries no amount for purchase entries;
    // contentHash still covers the fact tuple as the verifiable pair. No
    // product behavior change: reply projection is untouched, only the
    // summary evidence fills.
    if (result.kind === 'purchase') {
      return result.purchases.map((purchase) => {
        const total = purchase.amountDisclosure?.total ?? purchase.grandTotal ?? null;
        const currency = purchase.amountDisclosure?.currency ?? purchase.currency ?? null;
        const currencySymbol = purchase.amountDisclosure?.currencySymbol ?? purchase.currencySymbol ?? null;
        const paymentMethod = purchase.amountDisclosure?.paymentMethod ?? purchase.paymentMethod ?? null;
        const factTuple = [
          total === null ? 'monto_desconocido' : `monto_${total}`,
          currency === null ? 'moneda_ausente' : `moneda_${currency}`,
          `metodo_${paymentMethod ?? 'desconocido'}`,
          `estado_${purchase.paymentStatus ?? 'desconocido'}`,
          `evento_${purchase.eventName ?? 'sin_etiqueta'}`,
          `fecha_${purchase.eventDate ?? 'desconocida'}`,
        ].join('|');
        return {
          fileId: '',
          filename: '',
          score: 0,
          contentHash: this.hash(factTuple),
          purchaseFact: {
            eventLabel: purchase.eventName ?? null,
            total,
            currency,
            currencySymbol,
            paymentMethod,
            paymentStatus: purchase.paymentStatus ?? null,
            eventDate: purchase.eventDate ?? null,
            createdAt: purchase.createdAt ?? null,
            referencePresent: typeof purchase.customerTransactionNumber === 'string' &&
              purchase.customerTransactionNumber.length > 0,
          },
        };
      });
    }
    return [];
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
