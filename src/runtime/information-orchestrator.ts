import crypto from 'node:crypto';

import {
  createInformationAuthGuidance,
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

export class InformationOrchestrator {
  constructor(
    private readonly dependencies: {
      knowledgeGateway: KnowledgeRetrievalGateway;
      providerGateway: ProviderGateway;
      agentGateway: AgentConversationGateway;
    },
  ) {}

  async execute(args: {
    requests: PendingInformationRequest[];
    authentication: InformationAuthentication | null;
    authBlock: InformationAuthBlock | null;
    trustedPhone?: AgentAuthByPhoneInput | null;
  }): Promise<InformationExecution> {
    const canUseTrustedPhone =
      !args.authBlock || args.authBlock.guidance.reason === 'email_required';
    const phoneGateway = this.dependencies.agentGateway;
    const phonePurchaseLookups = new Map<
      string,
      Promise<AgentPhonePurchaseLookupResult | undefined>
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
            : result.status === 'failed' &&
                result.kind === 'purchase' &&
                'accessMethod' in result &&
                typeof (result as { accessMethod?: string }).accessMethod === 'string'
            ? {
                accessMethod: (result as { accessMethod?: InformationExecutionSummary['accessMethod'] }).accessMethod ?? 'authenticated_account',
                coverage: null,
                resource: (request as { resource?: InformationExecutionSummary['resource'] }).resource,
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
  ): Promise<InformationTaskResult> {
    if (request.kind === 'faq') {
      const retrieval = await this.dependencies.knowledgeGateway.search(request.query);
      if (retrieval.status === 'success') {
        return {
          requestId: request.requestId,
          kind: 'faq',
          status: 'completed',
          evidence: retrieval.evidence,
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
        );
      }
      if (guestEvents.status === 'failed') {
        return {
          requestId: request.requestId,
          kind: 'associated_event',
          status: 'failed',
          retryable: guestEvents.retryable,
          failureKind: this.dependencies.agentGateway.getGuestEventsByPhone
            ? 'request_failed'
            : 'not_configured',
          message: guestEvents.retryable
            ? 'No pude consultar los eventos asociados a tu número en este momento. Puedo intentarlo nuevamente.'
            : 'La consulta de eventos asociados al número no está disponible en este momento. Puedo comunicarte con una persona del equipo.',
        };
      }
    }

    if (!authentication) {
      if (
        request.kind === 'purchase' &&
        trustedPhone &&
        (!authBlock || authBlock.guidance.reason === 'email_required')
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

  private async executeGuestEventRequest(
    request: Extract<PendingInformationRequest, { kind: 'associated_event' }>,
    events: AgentGuestEventSummary[],
    trustedPhone: AgentAuthByPhoneInput | null,
    phoneGateway: AgentConversationGateway,
    eventDetailLookups: EventDetailCache,
    phoneContext: PhoneContextSnapshot,
  ): Promise<InformationTaskResult> {
    const selected = this.selectGuestEvent(events, request.eventHint);
    if (!selected) {
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

    if (!phoneGateway.getEventDetail || !trustedPhone) {
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
  ): Promise<PhoneEventDetailResult> {
    if (!phoneGateway.getEventDetail) {
      return {
        status: 'failed',
        error: 'Agent API event detail lookup is not configured.',
        retryable: false,
      };
    }
    const cacheKey = `${eventId}:${trustedPhone ? `${trustedPhone.phone_extension}:${trustedPhone.phone_number}` : 'public'}`;
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

  private selectGuestEvent(
    events: AgentGuestEventSummary[],
    eventHint: string | null,
  ): AgentGuestEventSummary | null {
    if (events.length === 1) {
      return events[0] ?? null;
    }
    if (!eventHint) {
      return null;
    }
    const normalizedHint = this.normalizeEventReference(eventHint);
    if (!normalizedHint) {
      return null;
    }
    const matches = events.filter((event) => {
      const normalizedName = this.normalizeEventReference(event.name);
      const normalizedSlug = this.normalizeEventReference(event.slug);
      return normalizedName === normalizedHint ||
        normalizedSlug === normalizedHint ||
        normalizedName.includes(normalizedHint) ||
        normalizedHint.includes(normalizedName);
    });
    return matches.length === 1 ? matches[0] ?? null : null;
  }

  private guestEventsResult(
    events: AgentGuestEventSummary[],
    detail: Extract<
      Awaited<ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>>,
      { status: 'success' }
    >['event'] | null,
    phoneNumber: string,
    enrichedDetail?: PhoneEventDetailSuccess,
  ): UserEventLookupResult {
    const attendance = enrichedDetail?.attendance ?? enrichedDetail?.event.attendance;
    const purchases = enrichedDetail?.purchases ?? enrichedDetail?.event.purchases ?? [];
    return {
      lookup: { email: null, phone: phoneNumber },
      user: null,
      events: events.map((event) => ({
        relation: 'guest',
        guestId:
          enrichedDetail?.event.eventId === event.eventId
            ? attendance?.guestId ?? null
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
          enrichedDetail?.event.eventId === event.eventId &&
          attendance
            ? {
                hasResponded: attendance.hasResponded,
                willAttend: attendance.willAttend,
                hasCouple: null,
                responseDate: attendance.responseDate,
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
          enrichedDetail?.event.eventId === event.eventId
            ? purchases.map((purchase) => ({
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
        ...(detail && detail.eventId === event.eventId
          ? {
              place: detail.city,
              name: detail.name,
              slug: detail.slug,
              url: detail.url,
              type: detail.type,
              datetime: detail.datetime,
              stage: detail.stage,
              currency: detail.currency,
              country: detail.country,
              detail: {
                withTime: detail.withTime,
                timezone: detail.timezone,
                city: detail.city,
                celebrateds: detail.celebrateds,
                moments: detail.moments,
                dresscode: detail.dresscode,
                commonAsked: detail.commonAsked,
                contactInfo: detail.contactInfo,
              },
            }
          : {}),
      })),
      counts: {
        ownerEvents: 0,
        guestEvents: events.length,
        hostEvents: 0,
        celebratedEvents: 0,
        recentOrders: purchases.length,
      },
    };
  }

  private normalizeEventReference(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/gu, ' ')
      .trim();
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
              'No encontre una compra que coincida con la referencia indicada entre las asociadas a este numero. Si me compartes otro dato del evento puedo revisarlo nuevamente.',
            accessMethod: 'trusted_phone_purchase',
          } as unknown as InformationTaskResult;
        }
        return {
          requestId: request.requestId,
          kind: 'purchase',
          status: 'failed',
          retryable: false,
          failureKind: 'not_found',
          message:
            'No encontré compras asociadas a este número. Si usaste otro número o un correo diferente, indícamelo y puedo orientarte con esa búsqueda.',
          accessMethod: 'trusted_phone_purchase',
        } as unknown as InformationTaskResult;
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
          'No encontré esa compra asociada a este número. Si usaste otro número o un correo diferente, indícamelo y puedo orientarte con esa búsqueda.',
        accessMethod: 'trusted_phone_purchase',
      } as unknown as InformationTaskResult;
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
    const lookupResource: 'orders' | 'gift_purchases' = request.aspects.some(
      (aspect) =>
        aspect === 'dedication' ||
        aspect === 'thanks' ||
        aspect === 'payment_details',
    )
      ? 'gift_purchases'
      : 'orders';
    if (
      (lookupResource === 'orders' && !phoneGateway.getGuestOrdersByPhone) ||
      (lookupResource === 'gift_purchases' &&
        !phoneGateway.getGuestGiftPurchasesByPhone)
    ) {
      return undefined;
    }
    const parsedReference = parseOrderReference(request.orderId);
    const requestedCustomerTransactionNumber =
      parsedReference?.kind === 'customer_transaction'
        ? parsedReference.transactionNumber
        : null;
    const lookupOrderId = parsedReference?.kind === 'backend_order_id'
      ? parsedReference.orderId
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
      phoneGateway.getGuestOrdersByPhone
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
    if (this.purchaseRecordsConflict(current, incoming)) {
      snapshot.inconsistentOrderIds.add(incoming.orderId);
    }
    const priority = { orders: 0, event: 1, gift_purchases: 2 } as const;
    const preferred = priority[source] >= priority[currentSource] ? incoming : current;
    const fallback = preferred === incoming ? current : incoming;
    snapshot.purchasesByOrderId.set(
      incoming.orderId,
      this.mergePurchaseRecords(preferred, fallback),
    );
    snapshot.purchaseSourceByOrderId.set(
      incoming.orderId,
      priority[source] >= priority[currentSource] ? source : currentSource,
    );
    const currentPartition = snapshot.purchasePartitionByOrderId.get(incoming.orderId);
    snapshot.purchasePartitionByOrderId.set(
      incoming.orderId,
      priority[source] >= priority[currentSource]
        ? partition
        : currentPartition ?? 'legacy_orders',
    );
  }

  private mergePurchaseRecords(
    preferred: PurchaseInformation,
    fallback: PurchaseInformation,
  ): PurchaseInformation {
    return {
      ...fallback,
      ...preferred,
      eventId: preferred.eventId ?? fallback.eventId ?? null,
      currency: preferred.currency ?? fallback.currency ?? null,
      paymentStatus: preferred.paymentStatus ?? fallback.paymentStatus,
      customerTransactionNumber:
        preferred.customerTransactionNumber ?? fallback.customerTransactionNumber,
      shippingStatus: preferred.shippingStatus ?? fallback.shippingStatus,
      grandTotal: preferred.grandTotal ?? fallback.grandTotal,
      paymentMethod: preferred.paymentMethod ?? fallback.paymentMethod,
      eventName: preferred.eventName ?? fallback.eventName,
      eventDate: preferred.eventDate ?? fallback.eventDate,
      eventUrl: preferred.eventUrl ?? fallback.eventUrl,
      createdAt: preferred.createdAt ?? fallback.createdAt,
      items: preferred.items.length > 0 ? preferred.items : fallback.items,
      payment: preferred.payment ?? fallback.payment,
      paymentValidationExpectation:
        preferred.paymentValidationExpectation ?? fallback.paymentValidationExpectation ?? null,
      declineCode: preferred.declineCode ?? fallback.declineCode,
      adminComment: preferred.adminComment ?? fallback.adminComment,
      dedication: preferred.dedication ?? fallback.dedication,
      thanks: preferred.thanks ?? fallback.thanks,
      isThanked: preferred.isThanked ?? fallback.isThanked,
    };
  }

  private purchaseRecordsConflict(
    left: PurchaseInformation,
    right: PurchaseInformation,
  ): boolean {
    const pairs: Array<[unknown, unknown]> = [
      [left.paymentStatus, right.paymentStatus],
      [left.customerTransactionNumber, right.customerTransactionNumber],
      [left.shippingStatus, right.shippingStatus],
      [left.grandTotal, right.grandTotal],
      [left.paymentMethod, right.paymentMethod],
      [left.eventName, right.eventName],
      [left.eventDate, right.eventDate],
      [left.createdAt, right.createdAt],
      [left.items.length > 0 ? left.items : null, right.items.length > 0 ? right.items : null],
    ];
    return pairs.some(([leftValue, rightValue]) =>
      leftValue !== null && leftValue !== undefined &&
      rightValue !== null && rightValue !== undefined &&
      JSON.stringify(leftValue) !== JSON.stringify(rightValue));
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
        return canonical ? this.projectPurchase(canonical, request) : projected;
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
  ): { purchases: PurchaseInformation[]; needsSelection: boolean } {
    const hasEventSelector = Boolean(request.eventHint?.trim());
    const hasAmountSelector = request.amount !== null && request.amount !== undefined;
    const requestedDate = this.requestDateSelector(request);
    const hasDateSelector = Boolean(requestedDate);
    const hasSelector = hasEventSelector || hasAmountSelector || hasDateSelector;
    const normalizedEvent = hasEventSelector
      ? this.normalizeEventReference(request.eventHint ?? '')
      : '';

    const matches = hasSelector
      ? purchases.filter((purchase) => {
          if (
            normalizedEvent &&
            !this.eventMatches(purchase.eventName, normalizedEvent)
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
    const pending = purchases.filter(
      (purchase) => partitionByOrderId.get(purchase.orderId) === 'pending_orders',
    );
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

  private eventMatches(eventName: string | null | undefined, normalizedHint: string): boolean {
    if (!eventName) return false;
    const normalizedName = this.normalizeEventReference(eventName);
    return normalizedName === normalizedHint ||
      normalizedName.includes(normalizedHint) ||
      normalizedHint.includes(normalizedName);
  }

  private filterCartCandidates(
    carts: CartInformation[],
    request: PurchaseRequest,
  ): CartInformation[] {
    const normalizedEvent = request.eventHint?.trim()
      ? this.normalizeEventReference(request.eventHint)
      : '';
    const amount = request.amount;
    return carts.filter((cart) => {
      if (normalizedEvent && !this.eventMatches(cart.eventName, normalizedEvent)) {
        return false;
      }
      if (amount !== null && amount !== undefined) {
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
  ): Promise<AgentPurchaseLookupResult | undefined> {
    return request.resource === 'orders'
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
    const disclosedMethod = includeAmount
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
      amountDisclosure: typeof cart.subtotal === 'number'
        ? {
            total: cart.subtotal,
            paid: null,
            currency: null,
            paymentMethod: null,
            presentation: 'recorded_method_no_currency',
          }
        : null,
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
    if (result.status !== 'completed' || result.kind !== 'faq') return [];
    return result.evidence.map((entry) => ({
      fileId: entry.fileId,
      filename: entry.filename,
      score: entry.score,
      contentHash: this.hash(entry.text),
    }));
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
