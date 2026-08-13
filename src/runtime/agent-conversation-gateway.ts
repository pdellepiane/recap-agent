import { z } from 'zod';

import type {
  PurchaseInformation,
  PurchaseResource,
} from '../core/information';
import { rsvpActionValues, type RsvpAction } from '../core/rsvp';

export type AgentMessageDirection = 'inbound' | 'outbound';

export type AgentConversationMessage = {
  id: number;
  direction: AgentMessageDirection;
  source: string | null;
  body: string;
  status: string;
  whatsappMessageId?: string | null;
  sentAt: string | null;
  createdAt: string | null;
};

export type AgentGatewayResult =
  | {
      status: 'success';
      message: string | null;
    }
  | {
      status: 'skipped';
      reason: 'disabled' | 'not_configured' | 'missing_phone_number';
      message: string;
    }
  | {
      status: 'failed';
      error: string;
      retryable: boolean;
    };

type AgentGatewaySkippedResult = Extract<AgentGatewayResult, { status: 'skipped' }>;
type HttpRequestFailure = Extract<AgentGatewayResult, { status: 'failed' }> & {
  httpStatus: number | null;
  responseFormat: 'json' | 'non_json' | null;
  errorEnvelope: boolean;
  errorCode?: string | null;
  data?: unknown;
};

export type AgentMessageLogInput = {
  phoneNumber: string;
  body: string;
  direction: AgentMessageDirection;
  whatsappMessageId?: string | null;
  sentAt?: string | null;
};

export type AgentPurchaseLookupResult =
  | {
      status: 'success';
      resource: PurchaseResource;
      purchases: PurchaseInformation[];
    }
  | {
      status: 'not_found';
      resource: PurchaseResource;
      orderId: string;
    }
  | {
      status: 'route_unavailable';
      resource: PurchaseResource;
      retryable: boolean;
      error: string;
    }
  | {
      status: 'unauthorized';
      resource: PurchaseResource;
      error: string;
    }
  | {
      status: 'failed';
      resource: PurchaseResource;
      retryable: boolean;
      failureKind: 'invalid_response' | 'request_failed';
      error: string;
    };

export type AgentAuthByPhoneInput = {
  phone_extension: string;
  phone_number: string;
};

export type AgentAuthByPhoneResult =
  | {
      status: 'authenticated';
      token: string;
      tokenExpiresAtIso: string;
      email: string;
    }
  | {
      status: 'user_not_found';
    }
  | {
      status: 'failed';
      error: string;
      retryable: boolean;
    };

export type AgentUpdatePhoneResult =
  | {
      status: 'success';
    }
  | {
      status: 'phone_linked_to_other_account';
    }
  | {
      status: 'failed';
      error: string;
      retryable: boolean;
    };

export type RsvpCandidate = {
  guestId: number;
  eventName: string | null;
  eventDate: string | null;
};

export type AgentGuestRsvpInput = AgentAuthByPhoneInput & {
  action: RsvpAction;
  guest_id?: number;
};

export type AgentGuestRsvpResult =
  | {
      status: 'responded';
      action: RsvpAction;
      guestId: number | null;
      eventName: string | null;
      eventDate: string | null;
    }
  | {
      status: 'multiple_pending';
      candidates: RsvpCandidate[];
    }
  | { status: 'already_responded' }
  | { status: 'no_pending' }
  | { status: 'phone_mismatch' }
  | {
      status: 'failed';
      error: string;
      retryable: boolean;
    };

export interface AgentConversationGateway {
  logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult>;
  getRecentMessages(phoneNumber: string): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  >;
  requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult>;
  getOrders?(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult>;
  getGiftPurchases?(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult>;
  authByPhone(input: AgentAuthByPhoneInput): Promise<AgentAuthByPhoneResult>;
  updatePhone(args: AgentAuthByPhoneInput & { token: string }): Promise<AgentUpdatePhoneResult>;
  guestRsvp?(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult>;
}

export class NoopAgentConversationGateway implements AgentConversationGateway {
  constructor(
    private readonly reason: 'not_configured' = 'not_configured',
  ) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return this.skipped('Agent API message logging is not configured.');
  }

  async getRecentMessages(phoneNumber: string): Promise<Exclude<AgentGatewayResult, { status: 'success' }>> {
    void phoneNumber;
    return this.skipped('Agent API conversation context is not configured.');
  }

  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    void phoneNumber;
    return this.skipped('Agent API human takeover is not configured.');
  }

  async getOrders(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult> {
    void args;
    return this.unavailablePurchaseResult('orders');
  }

  async getGiftPurchases(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult> {
    void args;
    return this.unavailablePurchaseResult('gift_purchases');
  }

  async authByPhone(input: AgentAuthByPhoneInput): Promise<AgentAuthByPhoneResult> {
    void input;
    return {
      status: 'failed',
      error: 'Agent API phone authentication is not configured.',
      retryable: false,
    };
  }

  async updatePhone(
    args: AgentAuthByPhoneInput & { token: string },
  ): Promise<AgentUpdatePhoneResult> {
    void args;
    return {
      status: 'failed',
      error: 'Agent API phone update is not configured.',
      retryable: false,
    };
  }

  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    void input;
    return {
      status: 'failed',
      error: 'Agent API RSVP is not configured.',
      retryable: false,
    };
  }

  private unavailablePurchaseResult(
    resource: PurchaseResource,
  ): AgentPurchaseLookupResult {
    return {
      status: 'failed',
      resource,
      retryable: false,
      failureKind: 'request_failed',
      error: 'Agent API purchase lookup is not configured.',
    };
  }

  private skipped(message: string): AgentGatewaySkippedResult {
    return {
      status: 'skipped',
      reason: this.reason,
      message,
    };
  }
}

const envelopeSchema = z.object({
  status: z.boolean(),
  data: z.unknown().nullable().optional(),
  errors: z.unknown().nullable().optional(),
  error: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
});

const authByPhoneDataSchema = z.object({
  credentials: z.object({
    access_token: z.string().trim().min(1),
    expires_in: z.number().int().min(1_000_000_000),
  }),
  user: z.object({
    id: z.number().optional(),
    name: z.string().optional(),
    email: z.string().email(),
  }),
});

const rsvpEventSchema = z.object({
  name: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
  date: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
}).passthrough();

const rsvpResponseDataSchema = z.object({
  guest_id: z.number().int().positive().nullable().optional(),
  action: z.enum(rsvpActionValues).optional(),
  event_name: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
  event: rsvpEventSchema.nullable().optional(),
}).passthrough();

const rsvpCandidateSchema = z.object({
  guest_id: z.number().int().positive(),
  event_name: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
  event: rsvpEventSchema.nullable().optional(),
}).passthrough();

type RsvpCandidateWire = z.infer<typeof rsvpCandidateSchema>;

const rsvpCandidateEnvelopeSchema = z.union([
  z.object({ candidates: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ pending: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ invitations: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.array(rsvpCandidateSchema).min(2),
]);

const messageSchema = z.object({
  id: z.number(),
  direction: z.enum(['inbound', 'outbound']),
  source: z.string().nullable().optional(),
  body: z.string(),
  status: z.string(),
  whatsapp_message_id: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const messagesDataSchema = z.object({
  messages: z.array(messageSchema),
});

const nullableStringSchema = z.string().nullable().optional();
const nullableNumberSchema = z.number().nullable().optional();

const purchaseItemSchema = z.object({
  gift_name: nullableStringSchema,
  quantity: nullableNumberSchema,
  amount: nullableNumberSchema,
  row_total: nullableNumberSchema,
  type: nullableStringSchema,
});

const destinationAccountSchema = z.object({
  holder: nullableStringSchema,
  bank: nullableStringSchema,
  number: nullableStringSchema,
  cci: nullableStringSchema,
  type: nullableStringSchema,
});

const paymentSchema = z.object({
  method: nullableStringSchema,
  amount: nullableNumberSchema,
  payment_id: nullableStringSchema,
  transaction_status: nullableStringSchema,
  gateway_message: nullableStringSchema,
  op_code: nullableStringSchema,
  origin_bank: nullableStringSchema,
  destination_account: destinationAccountSchema.nullable().optional(),
  voucher: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  paid_at: nullableStringSchema,
});

const orderSchema = z.object({
  id: z.string().min(1),
  name: nullableStringSchema,
  email: nullableStringSchema,
  payment_status: nullableStringSchema,
  shipping_status: nullableStringSchema,
  grand_total: nullableNumberSchema,
  payment_method: nullableStringSchema,
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  event_name: nullableStringSchema,
  event_date: nullableStringSchema,
  event_url: nullableStringSchema,
  items: z.array(purchaseItemSchema).default([]),
  created_at: nullableStringSchema,
});

const giftPurchaseSchema = z.object({
  id: z.string().min(1),
  payment_status: nullableStringSchema,
  shipping_status: nullableStringSchema,
  grand_total: nullableNumberSchema,
  is_thanked: z.boolean().nullable().optional(),
  payment: paymentSchema.nullable().optional(),
  decline_code: nullableStringSchema,
  admin_comment: nullableStringSchema,
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  event_name: nullableStringSchema,
  event_date: nullableStringSchema,
  event_url: nullableStringSchema,
  items: z.array(purchaseItemSchema).default([]),
  dedication: z
    .object({
      message: nullableStringSchema,
      is_private: z.boolean().nullable().optional(),
      send_physical: z.boolean().nullable().optional(),
      physical_status: nullableStringSchema,
    })
    .nullable()
    .optional(),
  thanks: z
    .object({
      message: nullableStringSchema,
      send_method: nullableStringSchema,
    })
    .nullable()
    .optional(),
  created_at: nullableStringSchema,
});

const ordersDataSchema = z.object({
  orders: z.array(orderSchema),
});

const giftPurchasesDataSchema = z.object({
  purchases: z.array(giftPurchaseSchema),
});

export class HttpAgentConversationGateway implements AgentConversationGateway {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
      maxRetries: number;
      messageLoggingEnabled: boolean;
    },
  ) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    if (!this.options.messageLoggingEnabled) {
      return {
        status: 'skipped',
        reason: 'disabled',
        message: 'Agent API message logging is disabled.',
      };
    }
    const payload: Record<string, unknown> = {
      phone_number: input.phoneNumber,
      body: input.body,
      direction: input.direction,
    };
    if (input.whatsappMessageId) {
      payload.whatsapp_message_id = input.whatsappMessageId;
    }
    if (input.sentAt) {
      payload.sent_at = input.sentAt;
    }

    const response = await this.request('/messages', {
      method: 'POST',
      body: payload,
    });
    if (response.status !== 'success') {
      return this.publicFailure(response);
    }
    return {
      status: 'success',
      message: 'Message logged.',
    };
  }

  async getRecentMessages(phoneNumber: string): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    const params = new URLSearchParams({ phone_number: phoneNumber });
    const response = await this.request(`/conversations/messages?${params.toString()}`, {
      method: 'GET',
    });
    if (response.status !== 'success') {
      return this.publicFailure(response);
    }

    const parsed = messagesDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        status: 'failed',
        error: 'Agent API messages response had an unexpected shape.',
        retryable: false,
      };
    }

    return {
      status: 'success',
      messages: parsed.data.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        source: message.source ?? null,
        body: message.body,
        status: message.status,
        whatsappMessageId: message.whatsapp_message_id ?? null,
        sentAt: message.sent_at ?? null,
        createdAt: message.created_at ?? null,
      })),
    };
  }

  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    const response = await this.request('/conversations/request-human', {
      method: 'POST',
      body: { phone_number: phoneNumber },
    });
    if (response.status !== 'success') {
      return this.publicFailure(response);
    }
    return {
      status: 'success',
      message: 'Human takeover requested.',
    };
  }

  async getOrders(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult> {
    const response = await this.requestPurchase(
      'orders',
      args.token,
      args.orderId,
    );
    if (response.status !== 'success') {
      return response;
    }

    const parsed = ordersDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        status: 'failed',
        resource: 'orders',
        retryable: false,
        failureKind: 'invalid_response',
        error: 'Agent API orders response had an unexpected shape.',
      };
    }

    return {
      status: 'success',
      resource: 'orders',
      purchases: parsed.data.orders.map((order) => ({
        orderId: order.id,
        paymentStatus: order.payment_status ?? null,
        shippingStatus: order.shipping_status ?? null,
        grandTotal: order.grand_total ?? null,
        paymentMethod: order.payment_method ?? null,
        eventName: order.event_name ?? null,
        eventDate: order.event_date ?? null,
        eventUrl: order.event_url ?? null,
        createdAt: order.created_at ?? null,
        items: order.items.map((item) => ({
          giftName: item.gift_name ?? null,
          quantity: item.quantity ?? null,
          amount: item.amount ?? null,
          rowTotal: item.row_total ?? null,
          type: item.type ?? null,
        })),
      })),
    };
  }

  async getGiftPurchases(args: {
    token: string;
    orderId?: string | null;
  }): Promise<AgentPurchaseLookupResult> {
    const response = await this.requestPurchase(
      'gift_purchases',
      args.token,
      args.orderId,
    );
    if (response.status !== 'success') {
      return response;
    }

    const parsed = giftPurchasesDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        status: 'failed',
        resource: 'gift_purchases',
        retryable: false,
        failureKind: 'invalid_response',
        error: 'Agent API gift-purchases response had an unexpected shape.',
      };
    }

    return {
      status: 'success',
      resource: 'gift_purchases',
      purchases: parsed.data.purchases.map((purchase) => ({
        orderId: purchase.id,
        paymentStatus: purchase.payment_status ?? null,
        shippingStatus: purchase.shipping_status ?? null,
        grandTotal: purchase.grand_total ?? null,
        paymentMethod: purchase.payment?.method ?? null,
        eventName: purchase.event_name ?? null,
        eventDate: purchase.event_date ?? null,
        eventUrl: purchase.event_url ?? null,
        createdAt: purchase.created_at ?? null,
        items: purchase.items.map((item) => ({
          giftName: item.gift_name ?? null,
          quantity: item.quantity ?? null,
          amount: item.amount ?? null,
          rowTotal: item.row_total ?? null,
          type: item.type ?? null,
        })),
        payment: purchase.payment
          ? {
              method: purchase.payment.method ?? null,
              amount: purchase.payment.amount ?? null,
              paidAt: purchase.payment.paid_at ?? null,
              paymentId: purchase.payment.payment_id ?? null,
              transactionStatus: purchase.payment.transaction_status ?? null,
              gatewayMessage: purchase.payment.gateway_message ?? null,
              operationCode: purchase.payment.op_code ?? null,
              originBank: purchase.payment.origin_bank ?? null,
              destinationAccount: purchase.payment.destination_account
                ? {
                    holder: purchase.payment.destination_account.holder ?? null,
                    bank: purchase.payment.destination_account.bank ?? null,
                    number: purchase.payment.destination_account.number ?? null,
                    cci: purchase.payment.destination_account.cci ?? null,
                    type: purchase.payment.destination_account.type ?? null,
                  }
                : null,
              voucherImage: purchase.payment.voucher ?? null,
            }
          : null,
        declineCode: purchase.decline_code ?? null,
        adminComment: purchase.admin_comment ?? null,
        dedication: purchase.dedication
          ? {
              message: purchase.dedication.message ?? null,
              isPrivate: purchase.dedication.is_private ?? null,
              sendPhysical: purchase.dedication.send_physical ?? null,
              physicalStatus: purchase.dedication.physical_status ?? null,
            }
          : null,
        thanks: purchase.thanks
          ? {
              message: purchase.thanks.message ?? null,
              sendMethod: purchase.thanks.send_method ?? null,
            }
          : null,
        isThanked: purchase.is_thanked ?? null,
      })),
    };
  }

  async authByPhone(input: AgentAuthByPhoneInput): Promise<AgentAuthByPhoneResult> {
    const response = await this.request('/auth-by-phone', {
      method: 'POST',
      body: {
        phone_extension: input.phone_extension,
        phone_number: input.phone_number,
      },
    });

    if (response.status !== 'success') {
      if (response.httpStatus === 404 && response.errorCode === 'user_not_found') {
        return { status: 'user_not_found' };
      }
      return {
        status: 'failed',
        error: response.error,
        retryable: response.retryable,
      };
    }

    const parsed = authByPhoneDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        status: 'failed',
        error: 'Agent API phone authentication response had an unexpected shape.',
        retryable: false,
      };
    }

    const expiryMilliseconds = parsed.data.credentials.expires_in * 1_000;
    const expiryDate = new Date(expiryMilliseconds);
    if (
      !Number.isSafeInteger(expiryMilliseconds) ||
      Number.isNaN(expiryDate.getTime())
    ) {
      return {
        status: 'failed',
        error: 'Agent API phone authentication response had an invalid expiry.',
        retryable: false,
      };
    }
    if (expiryDate.getTime() <= Date.now()) {
      return {
        status: 'failed',
        error: 'Agent API phone authentication response had an expired expiry.',
        retryable: false,
      };
    }
    const tokenExpiresAtIso = expiryDate.toISOString();

    return {
      status: 'authenticated',
      token: parsed.data.credentials.access_token,
      tokenExpiresAtIso,
      email: parsed.data.user.email,
    };
  }

  async updatePhone(
    args: AgentAuthByPhoneInput & { token: string },
  ): Promise<AgentUpdatePhoneResult> {
    const response = await this.request('/user/update-phone', {
      method: 'POST',
      authorizationToken: args.token,
      body: {
        phone_extension: args.phone_extension,
        phone_number: args.phone_number,
      },
    });

    if (response.status === 'success') {
      return { status: 'success' };
    }
    if (
      response.httpStatus === 409 &&
      response.errorCode === 'phone_linked_to_other_account'
    ) {
      return { status: 'phone_linked_to_other_account' };
    }
    return {
      status: 'failed',
      error: response.error,
      retryable: response.retryable,
    };
  }

  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    const response = await this.request('/guest/rsvp', {
      method: 'POST',
      body: {
        phone_extension: input.phone_extension,
        phone_number: input.phone_number,
        action: input.action,
        ...(input.guest_id !== undefined ? { guest_id: input.guest_id } : {}),
      },
    });

    if (response.status === 'success') {
      const parsed = rsvpResponseDataSchema.safeParse(response.data);
      if (!parsed.success) {
        return {
          status: 'failed',
          error: 'Agent API RSVP response had an unexpected shape.',
          retryable: false,
        };
      }
      return {
        status: 'responded',
        action: parsed.data.action ?? input.action,
        guestId: parsed.data.guest_id ?? input.guest_id ?? null,
        eventName:
          parsed.data.event_name ??
          parsed.data.event?.name ??
          parsed.data.event?.title ??
          null,
        eventDate:
          parsed.data.event_date ??
          parsed.data.event?.date ??
          parsed.data.event?.event_date ??
          null,
      };
    }

    const candidates = this.parseRsvpCandidates(response.data);
    if (candidates) {
      return {
        status: 'multiple_pending',
        candidates,
      };
    }
    if (response.errorCode === 'multiple_pending') {
      return {
        status: 'failed',
        error: 'Agent API RSVP multiple-pending response had an unexpected shape.',
        retryable: false,
      };
    }
    if (response.httpStatus === 404) {
      return { status: 'no_pending' };
    }
    if (response.httpStatus === 403 || response.errorCode === 'phone_mismatch') {
      return { status: 'phone_mismatch' };
    }
    if (response.errorCode === 'already_responded') {
      return { status: 'already_responded' };
    }
    return {
      status: 'failed',
      error: response.error,
      retryable: response.retryable,
    };
  }

  private parseRsvpCandidates(data: unknown): RsvpCandidate[] | null {
    const parsed = rsvpCandidateEnvelopeSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }
    const candidateData: RsvpCandidateWire[] = Array.isArray(parsed.data)
      ? parsed.data
      : 'candidates' in parsed.data
        ? parsed.data.candidates as RsvpCandidateWire[]
        : 'pending' in parsed.data
          ? parsed.data.pending as RsvpCandidateWire[]
          : parsed.data.invitations;
    return candidateData.map((candidate) => ({
      guestId: candidate.guest_id,
      eventName:
        candidate.event_name ??
        candidate.event?.name ??
        candidate.event?.title ??
        null,
      eventDate:
        candidate.event_date ??
        candidate.event?.date ??
        candidate.event?.event_date ??
        null,
    }));
  }

  private async requestPurchase(
    resource: PurchaseResource,
    token: string,
    orderId?: string | null,
  ): Promise<
    | { status: 'success'; data: unknown }
    | Exclude<AgentPurchaseLookupResult, { status: 'success' }>
  > {
    const endpoint = resource === 'orders' ? '/orders' : '/gift-purchases';
    const params = new URLSearchParams();
    if (orderId) {
      params.set('order_id', orderId);
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const response = await this.request(`${endpoint}${suffix}`, {
      method: 'GET',
      authorizationToken: token,
    });
    if (response.status === 'success') {
      return response;
    }

    if (response.httpStatus === 401) {
      return {
        status: 'unauthorized',
        resource,
        error: response.error,
      };
    }

    if (response.httpStatus === 404) {
      if (orderId && response.errorEnvelope) {
        return {
          status: 'not_found',
          resource,
          orderId,
        };
      }
      return {
        status: 'route_unavailable',
        resource,
        retryable: false,
        error: response.error,
      };
    }

    return {
      status: 'failed',
      resource,
      retryable: response.retryable,
      failureKind: 'request_failed',
      error: response.error,
    };
  }

  private async request(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: Record<string, unknown>;
      authorizationToken?: string;
    },
  ): Promise<
    | { status: 'success'; data: unknown }
    | HttpRequestFailure
  > {
    const attempts = Math.max(1, this.options.maxRetries + 1);
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(`${this.options.baseUrl}${path}`, {
          method: options.method,
          headers: {
            'X-Agent-Key': this.options.apiKey,
            ...(options.authorizationToken
              ? { Authorization: `Bearer ${options.authorizationToken}` }
              : {}),
            ...(options.body ? { 'content-type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const parsedBody = await this.parseBody(response);
        if (!response.ok) {
          const retryable = this.isRetryableStatus(response.status);
          if (retryable && attempt < attempts) {
            lastError = this.httpError(response.status, parsedBody);
            await this.backoff(attempt);
            continue;
          }
          return {
            status: 'failed',
            error: this.httpError(response.status, parsedBody),
            retryable,
            httpStatus: response.status,
            responseFormat: this.isJsonBody(response, parsedBody)
              ? 'json'
              : 'non_json',
            errorEnvelope: envelopeSchema.safeParse(parsedBody).success,
            errorCode: this.errorCode(parsedBody),
            data: this.envelopeData(parsedBody),
          };
        }

        const envelope = envelopeSchema.safeParse(parsedBody);
        if (!envelope.success) {
          return {
            status: 'failed',
            error: 'Agent API response had an unexpected envelope.',
            retryable: false,
            httpStatus: response.status,
            responseFormat: 'json',
            errorEnvelope: false,
            errorCode: this.errorCode(parsedBody),
          };
        }
        if (!envelope.data.status) {
          return {
            status: 'failed',
            error:
              this.errorMessage(envelope.data.error) ??
              'Agent API returned status=false.',
            retryable: false,
            httpStatus: response.status,
            responseFormat: 'json',
            errorEnvelope: true,
            errorCode: this.errorCode(parsedBody),
            data: envelope.data.data ?? null,
          };
        }

        return {
          status: 'success',
          data: envelope.data.data ?? null,
        };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < attempts) {
          await this.backoff(attempt);
          continue;
        }
        return {
          status: 'failed',
          error: lastError,
          retryable: true,
          httpStatus: null,
          responseFormat: null,
          errorEnvelope: false,
          errorCode: null,
        };
      }
    }

    return {
      status: 'failed',
      error: lastError ?? 'Agent API request failed.',
      retryable: true,
      httpStatus: null,
      responseFormat: null,
      errorEnvelope: false,
      errorCode: null,
    };
  }

  private publicFailure(
    failure: HttpRequestFailure,
  ): Extract<AgentGatewayResult, { status: 'failed' }> {
    return {
      status: 'failed',
      error: failure.error,
      retryable: failure.retryable,
    };
  }

  private isJsonBody(response: Response, body: unknown): boolean {
    return (
      response.headers.get('content-type')?.includes('application/json') === true ||
      (body !== null && typeof body === 'object')
    );
  }

  private async parseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return await response.text().catch(() => '');
    }
    return await response.json().catch(() => null);
  }

  private httpError(status: number, body: unknown): string {
    const parsed = envelopeSchema.safeParse(body);
    if (parsed.success) {
      const message = this.errorMessage(parsed.data.error);
      if (message) {
        return `Agent API request failed with ${status}: ${message}`;
      }
    }
    return `Agent API request failed with ${status}.`;
  }

  private errorMessage(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'detail', 'error']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
    return null;
  }

  private envelopeData(body: unknown): unknown {
    const parsed = envelopeSchema.safeParse(body);
    return parsed.success ? (parsed.data.data ?? null) : null;
  }

  private errorCode(body: unknown): string | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    const record = body as Record<string, unknown>;
    const directCode = this.readErrorCode(record);
    if (directCode) {
      return directCode;
    }
    for (const key of ['error', 'errors', 'data']) {
      const nested = this.errorCode(record[key]);
      if (nested) {
        return nested;
      }
    }
    if (Array.isArray(record.errors)) {
      for (const entry of record.errors) {
        const nested = this.errorCode(entry);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  }

  private readErrorCode(value: Record<string, unknown>): string | null {
    for (const key of ['code', 'error_code', 'errorCode']) {
      const code = value[key];
      if (typeof code === 'string' && code.trim()) {
        return code;
      }
    }
    return null;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async backoff(attempt: number): Promise<void> {
    const delayMs = Math.min(100 * 2 ** Math.max(0, attempt - 1), 1_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
