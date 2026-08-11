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
  AgentConversationGateway,
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
  nextInput: 'email' | 'otp' | 'phone_confirmation';
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
  }): Promise<InformationExecution> {
    const settled = await Promise.allSettled(
      args.requests.map(async (request) => {
        const startedAt = Date.now();
        const result = await this.executeRequest(
          request,
          args.authentication,
          args.authBlock,
        );
        return {
          result,
          summary: {
            requestId: request.requestId,
            kind: request.kind,
            status: result.status,
            source: this.sourceFor(request),
            resultCount: this.resultCount(result),
            durationMs: Date.now() - startedAt,
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
}
