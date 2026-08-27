import crypto from 'node:crypto';

import {
  createInformationAuthGuidance,
  type InformationAuthGuidance,
  type InformationExecutionSummary,
  type InformationTaskResult,
  type PendingInformationRequest,
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
  canDisclosePaymentDestination,
  hasPhysicalFulfillment,
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
  inconsistentOrderIds: Set<string>;
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

    if (
      lookup.status === 'success' &&
      !request.orderId &&
      lookup.purchases.length === 1
    ) {
      const onlyOrder = lookup.purchases[0];
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
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: request.resource,
        lookupResource: request.resource,
        purchases: lookup.purchases.map((purchase) =>
          this.projectPurchase(purchase, request),
        ),
        needsSelection: !request.orderId && lookup.purchases.length > 1,
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
      const purchases = lookup.result.purchases;
      if (purchases.length === 0) {
        return {
          requestId: request.requestId,
          kind: 'purchase',
          status: 'failed',
          retryable: false,
          failureKind: 'not_found',
          message:
            'No encontré compras asociadas a este número. Si usaste otro número o un correo diferente, indícamelo y puedo orientarte con esa búsqueda.',
        };
      }
      for (const purchase of purchases) {
        this.mergePhonePurchase(
          phoneContext,
          purchase,
          lookup.sourceResource,
        );
      }
      return {
        requestId: request.requestId,
        kind: 'purchase',
        status: 'completed',
        resource: request.resource,
        lookupResource: lookup.sourceResource,
        purchases: purchases.map((purchase) =>
          this.projectPurchase(purchase, request),
        ),
        needsSelection:
          lookup.referenceResolution === 'unavailable' ||
          (!request.orderId && purchases.length > 1) ||
          (lookup.referenceResolution === 'matched' && purchases.length > 1),
        accessMethod: 'trusted_phone_purchase',
        coverage: lookup.coverage,
        ...(lookup.referenceResolution === 'not_requested'
          ? {}
          : {
              referenceResolution: lookup.referenceResolution,
              requestedCustomerTransactionNumber:
                lookup.requestedCustomerTransactionNumber,
            }),
      };
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
    const purchasesWithCustomerReference = result.purchases.filter(
      (purchase) => Boolean(purchase.customerTransactionNumber),
    );
    if (purchasesWithCustomerReference.length === 0) {
      return {
        result,
        coverage: 'partial',
        sourceResource,
        referenceResolution: 'unavailable',
        requestedCustomerTransactionNumber,
      };
    }
    const matches = purchasesWithCustomerReference.filter(
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
  ): void {
    const current = snapshot.purchasesByOrderId.get(incoming.orderId);
    const currentSource = snapshot.purchaseSourceByOrderId.get(incoming.orderId);
    if (!current || !currentSource) {
      snapshot.purchasesByOrderId.set(incoming.orderId, incoming);
      snapshot.purchaseSourceByOrderId.set(incoming.orderId, source);
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
  }

  private mergePurchaseRecords(
    preferred: PurchaseInformation,
    fallback: PurchaseInformation,
  ): PurchaseInformation {
    return {
      ...fallback,
      ...preferred,
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

    return {
      orderId: purchase.orderId,
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
      grandTotal: aspectSet.has('summary') || includePayment ? purchase.grandTotal : null,
      paymentMethod:
        aspectSet.has('summary') || includePayment ? purchase.paymentMethod : null,
      eventName: purchase.eventName,
      eventDate: purchase.eventDate,
      eventUrl: purchase.eventUrl,
      createdAt: purchase.createdAt,
      items: aspectSet.has('summary') ? purchase.items : [],
      ...(includePayment
        ? {
            payment: purchase.payment
              ? {
                  method: purchase.payment.method,
                  amount: purchase.payment.amount,
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
                  ...(sensitive.has('origin_bank')
                    ? { originBank: purchase.payment.originBank ?? null }
                    : {}),
                  ...(sensitive.has('destination_account') &&
                  canDisclosePaymentDestination(purchase)
                    ? {
                        destinationAccount:
                          purchase.payment.destinationAccount ?? null,
                      }
                    : {}),
                  ...(sensitive.has('voucher_image')
                    ? { voucherImage: purchase.payment.voucherImage ?? null }
                    : {}),
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
