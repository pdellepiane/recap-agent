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
import type {
  AgentAuthByPhoneInput,
  AgentConversationGateway,
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
    const guestEventsPromise =
      !args.authentication &&
      args.trustedPhone &&
      args.requests.some((request) => request.kind === 'associated_event')
        ? this.lookupGuestEvents(args.trustedPhone)
        : null;
    const settled = await Promise.allSettled(
      args.requests.map(async (request) => {
        const startedAt = Date.now();
        const result = await this.executeRequest(
          request,
          args.authentication,
          args.authBlock,
          guestEventsPromise,
          args.trustedPhone ?? null,
        );
        return {
          result,
          summary: {
            requestId: request.requestId,
            kind: request.kind,
            status: result.status,
            source: this.sourceFor(request),
            outcomeCode: this.outcomeCode(result),
            retryable: result.status === 'failed' ? result.retryable : null,
            queryHash: this.hash(request.query),
            evidence: this.evidenceReferences(result),
            resultCount: this.resultCount(result),
            durationMs: Date.now() - startedAt,
            ...(result.status === 'completed' && result.kind === 'associated_event'
              ? {
                  accessMethod: result.accessMethod ?? 'authenticated_account',
                  eventDetailCount: result.result.events.filter(
                    (event) => event.detail !== undefined,
                  ).length,
                }
              : {}),
          } satisfies InformationExecutionSummary,
        };
      }),
    );

    const results: InformationTaskResult[] = [];
    const summaries: InformationExecutionSummary[] = [];

    settled.forEach((entry, index) => {
      if (entry.status === 'fulfilled') {
        results.push(entry.value.result);
        summaries.push(entry.value.summary);
        return;
      }

      const request = args.requests[index];
      if (!request) {
        return;
      }
      results.push({
        requestId: request.requestId,
        kind: request.kind,
        status: 'failed',
        retryable: true,
        failureKind: 'request_failed',
        message:
          entry.reason instanceof Error
            ? entry.reason.message
            : 'No se pudo completar esta consulta.',
      });
      summaries.push({
        requestId: request.requestId,
        kind: request.kind,
        status: 'failed',
        source: this.sourceFor(request),
        outcomeCode: 'request_failed',
        retryable: true,
        queryHash: this.hash(request.query),
        evidence: [],
        resultCount: 0,
        durationMs: 0,
      });
    });

    return { results, summaries };
  }

  private async executeRequest(
    request: PendingInformationRequest,
    authentication: InformationAuthentication | null,
    authBlock: InformationAuthBlock | null,
    guestEventsPromise: Promise<AgentGuestEventsResult> | null,
    trustedPhone: AgentAuthByPhoneInput | null,
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
          trustedPhone?.phone_number ?? '',
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
    phoneNumber: string,
  ): Promise<InformationTaskResult> {
    const selected = this.selectGuestEvent(events, request.eventHint);
    if (!selected) {
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'completed',
        accessMethod: 'trusted_phone_guest',
        result: this.guestEventsResult(events, null, phoneNumber),
      };
    }

    if (!this.dependencies.agentGateway.getEventDetail) {
      return {
        requestId: request.requestId,
        kind: 'associated_event',
        status: 'failed',
        retryable: false,
        failureKind: 'not_configured',
        message: 'La consulta de detalles del evento no está disponible en este momento. Puedo comunicarte con una persona del equipo.',
      };
    }

    let detail: Awaited<ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>>;
    try {
      detail = await this.dependencies.agentGateway.getEventDetail({
        eventId: selected.eventId,
      });
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

    return {
      requestId: request.requestId,
      kind: 'associated_event',
      status: 'completed',
      accessMethod: 'trusted_phone_guest',
      result: this.guestEventsResult([selected], detail.event, phoneNumber),
    };
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
  ): UserEventLookupResult {
    return {
      lookup: { email: null, phone: phoneNumber },
      user: null,
      events: events.map((event) => ({
        relation: 'guest',
        guestId: null,
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
        guestStatus: null,
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
        recentOrders: 0,
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
