import { z } from 'zod';

import type {
  CartInformation,
  PurchasePaymentDetails,
  PurchasePartition,
  PurchaseInformation,
  PurchaseResource,
} from '../core/information';
import { rsvpActionValues, type RsvpAction } from '../core/rsvp';
import { normalizeBackendCustomerTransactionNumber } from '../core/order-reference';
import { normalizePurchaseCurrency } from './purchase-currency';
import {
  createAuthOperationId,
  getRequestCorrelationId,
  logAuthObservabilityEvent,
  responseHeadersForAuthLog,
} from './auth-observability';
import {
  buildRuntimeCapabilityManifest,
  type RuntimeCapabilityManifest,
} from './capability-manifest';

export {
  buildRuntimeCapabilityManifest,
  runtimeOperationIds,
  runtimeWriteOperationIds,
  type CapabilityDecision,
  type RuntimeCapabilityAvailabilityReason,
  type RuntimeCapabilityDescriptor,
  type RuntimeCapabilityManifest,
  type RuntimeOperationId,
} from './capability-manifest';
import { normalizeServerTimestamp } from '../core/server-timestamp';
import {
  agentEventDetailWireShape,
  agentGiftPurchasesWireShape,
  agentGuestEventsWireShape,
  agentOrderWireShape,
  agentPartitionedOrdersWireShape,
  agentRecentMessagesWireShape,
  reportUnmappedWireKeys,
  type UnmappedWireKeySink,
  type WireObjectShape,
} from './wire-key-diagnostics';

export { normalizeServerTimestamp as normalizePurchaseTimestamp } from '../core/server-timestamp';

export type AgentMessageDirection = 'inbound' | 'outbound';

export type AgentConversationMessage = {
  id: number;
  eventId?: number | null;
  direction: AgentMessageDirection;
  source: string | null;
  body: string;
  status: string;
  whatsappMessageId?: string | null;
  sentAt: string | null;
  createdAt: string | null;
};

export type HandoffGatewayOutcome = 'failed' | 'unknown';

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
      outcome?: HandoffGatewayOutcome;
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

/**
 * A purchase lookup made with the channel-trusted phone identity.
 *
 * This deliberately has a separate result type from the authenticated lookup:
 * a phone-scoped 404 means that this phone is not associated with the record,
 * not that the account has no records at all.
 */
export type AgentPhonePurchaseLookupResult =
  | {
      status: 'success';
      resource: PurchaseResource;
      purchases: PurchaseInformation[];
      /** New phone-order responses keep order provenance and carts separate. */
      orderPartitions?: {
        pending: PurchaseInformation[];
        completed: PurchaseInformation[];
      };
      carts?: CartInformation[];
    }
  | {
      status: 'not_found';
      resource: PurchaseResource;
      orderId: string | null;
    }
  | {
      status: 'unauthorized';
      resource: PurchaseResource;
      error: string;
    }
  | {
      status: 'invalid_request' | 'invalid_response';
      resource: PurchaseResource;
      error: string;
    }
  | {
      status: 'retryable_failure';
      resource: PurchaseResource;
      retryable: true;
      error: string;
    }
  | {
      status: 'route_unavailable';
      resource: PurchaseResource;
      retryable: boolean;
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

export type AgentGuestEventSummary = {
  eventId: number;
  name: string;
  slug: string;
  url: string | null;
  datetime: string | null;
  type: string | null;
  typeDetail: string | null;
  stage: string | null;
  city: string | null;
  country: string | null;
  currency: string | null;
};

export type AgentEventDetail = AgentGuestEventSummary & {
  withTime: boolean;
  timezone: string | null;
  celebrateds: Array<{
    name: string;
    type: string | null;
  }>;
  moments: Array<{
    label: string;
    description: string | null;
    datetime: string | null;
    withTime: boolean;
    locationDescription: string | null;
    locationReference: string | null;
    locationUrl: string | null;
    locationCoords: string | null;
    position: number;
  }>;
  dresscode: {
    type: string | null;
    description: string | null;
  } | null;
  commonAsked: Array<{
    question: string;
    answer: string;
  }>;
  contactInfo: Array<{
    label: string;
    value: string;
  }>;
  /** Present for phone-enriched requests; absent on legacy test doubles. */
  attendance?: AgentGuestAttendance | null;
  /** Event-scoped gift purchases returned by phone-enriched event lookup. */
  purchases?: PurchaseInformation[];
};

export type AgentGuestAttendance = {
  guestId: number;
  name: string;
  hasResponded: boolean;
  willAttend: boolean | null;
  responseDate: string | null;
};

export type AgentGuestEventsResult =
  | { status: 'success'; events: AgentGuestEventSummary[] }
  | { status: 'not_found' }
  | { status: 'failed'; error: string; retryable: boolean };

export type AgentEventDetailResult =
  | { status: 'success'; event: AgentEventDetail }
  | { status: 'not_found' }
  | { status: 'failed'; error: string; retryable: boolean };

export type AgentEventDetailInput = {
  eventId?: number;
  slug?: string;
  phone?: AgentAuthByPhoneInput;
  trustedPhone?: AgentAuthByPhoneInput | null;
  phone_extension?: string;
  phone_number?: string;
};

export type RsvpCandidate = {
  guestId: number;
  eventId?: number | null;
  eventName: string | null;
  eventDate: string | null;
};

export type AgentGuestRsvpInput = AgentAuthByPhoneInput & {
  action?: RsvpAction;
  guest_id?: number;
  plus_one_response?: 'yes' | 'no';
  plus_one_name?: string | null;
  plus_one_email?: string | null;
  plus_one_phone_no?: string | null;
  plus_one_phone_ext?: string | null;
};

export type AgentGuestRsvpResult =
  | {
      status: 'responded';
      action: RsvpAction | null;
      willAttend: boolean | null;
      guestId: number | null;
      eventId?: number | null;
      eventName: string | null;
      eventDate: string | null;
      plusOne?: {
        saved: boolean;
        response: 'yes' | 'no' | null;
        reason: string | null;
      } | null;
    }
  | {
      status: 'multiple_pending';
      candidates: RsvpCandidate[];
    }
  | {
      status: 'already_responded';
      currentAction: RsvpAction | null;
      requestedAction: RsvpAction | null;
      guestId: number | null;
      eventId?: number | null;
      eventName: string | null;
      eventDate: string | null;
    }
  | { status: 'no_pending' }
  | { status: 'phone_mismatch' }
  | {
      status: 'failed';
      error: string;
      retryable: boolean;
    };

export interface AgentConversationGateway {
  /** Read-only capability projection used by extraction and reply boundaries. */
  readonly capabilityDescriptor?: RuntimeCapabilityManifest;
  /** Alias retained for callers that describe this as a capability manifest. */
  readonly capabilities?: RuntimeCapabilityManifest;
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
  getGuestOrdersByPhone?(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult>;
  getGuestGiftPurchasesByPhone?(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult>;
  authByPhone(input: AgentAuthByPhoneInput): Promise<AgentAuthByPhoneResult>;
  getGuestEventsByPhone?(input: AgentAuthByPhoneInput): Promise<AgentGuestEventsResult>;
  getEventDetail?(input: AgentEventDetailInput): Promise<AgentEventDetailResult>;
  updatePhone(args: AgentAuthByPhoneInput & { token: string }): Promise<AgentUpdatePhoneResult>;
  guestRsvp?(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult>;
}

export class NoopAgentConversationGateway implements AgentConversationGateway {
  readonly capabilityDescriptor: RuntimeCapabilityManifest;
  readonly capabilities: RuntimeCapabilityManifest;

  constructor(
    private readonly reason: 'not_configured' = 'not_configured',
  ) {
    this.capabilityDescriptor = buildRuntimeCapabilityManifest({ configured: false });
    this.capabilities = this.capabilityDescriptor;
  }

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

  async getGuestOrdersByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    void args;
    return this.unavailablePhonePurchaseResult('orders');
  }

  async getGuestGiftPurchasesByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    void args;
    return this.unavailablePhonePurchaseResult('gift_purchases');
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

  async getGuestEventsByPhone(input: AgentAuthByPhoneInput): Promise<AgentGuestEventsResult> {
    void input;
    return {
      status: 'failed',
      error: 'Agent API guest event lookup is not configured.',
      retryable: false,
    };
  }

  async getEventDetail(input: AgentEventDetailInput): Promise<AgentEventDetailResult> {
    void input;
    return {
      status: 'failed',
      error: 'Agent API event detail lookup is not configured.',
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

  private unavailablePhonePurchaseResult(
    resource: PurchaseResource,
  ): AgentPhonePurchaseLookupResult {
    return {
      status: 'retryable_failure',
      resource,
      retryable: true,
      error: 'Agent API phone-scoped purchase lookup is not configured.',
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
  event_id: z.number().int().positive().nullable().optional(),
  action: z.enum(rsvpActionValues).optional(),
  already_responded: z.boolean().optional(),
  will_attend: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
  event_name: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
  event: rsvpEventSchema.nullable().optional(),
  plus_one: z.object({
    saved: z.boolean(),
    response: z.enum(['yes', 'no']).nullable().optional(),
    reason: z.string().trim().min(1).nullable().optional(),
  }).nullable().optional(),
}).passthrough();

const rsvpCombinedResponseDataSchema = z.object({
  rsvp: rsvpResponseDataSchema.nullable().optional(),
  plus_one: z.object({
    saved: z.boolean(),
    response: z.enum(['yes', 'no']).nullable().optional(),
    reason: z.string().trim().min(1).nullable().optional(),
  }).nullable().optional(),
}).passthrough();

const rsvpCandidateSchema = z.object({
  guest_id: z.number().int().positive(),
  event_id: z.number().int().positive().nullable().optional(),
  event_name: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
  event: rsvpEventSchema.nullable().optional(),
}).passthrough();

type RsvpCandidateWire = z.infer<typeof rsvpCandidateSchema>;

const rsvpCandidateEnvelopeSchema = z.union([
  z.object({ pending_guests: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ candidates: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ pending: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ invitations: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.array(rsvpCandidateSchema).min(2),
]);

const guestEventSchema = z.object({
  event_id: z.number().int().positive(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  url: z.string().trim().min(1).nullable().optional(),
  datetime: z.string().trim().min(1).nullable().optional(),
  type: z.string().trim().min(1).nullable().optional(),
  type_detail: z.string().trim().min(1).nullable().optional(),
  stage: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  country: z.string().trim().min(1).nullable().optional(),
  currency: z.string().trim().min(1).nullable().optional(),
  role: z.literal('guest'),
});

const guestEventsDataSchema = z.object({
  events: z.array(guestEventSchema),
});

const eventCountrySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  short_code: z.string().trim().min(1),
});

const eventDetailSchema = z.object({
  event_id: z.number().int().positive(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  url: z.string().trim().min(1).nullable().optional(),
  type: z.string().trim().min(1).nullable().optional(),
  type_detail: z.string().trim().min(1).nullable().optional(),
  datetime: z.string().trim().min(1).nullable().optional(),
  with_time: z.boolean(),
  timezone: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  country: eventCountrySchema.nullable().optional(),
  currency: z.string().trim().min(1).nullable().optional(),
  stage: z.string().trim().min(1).nullable().optional(),
  celebrateds: z.array(z.object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1).nullable().optional(),
  })).default([]),
  moments: z.array(z.object({
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable().optional(),
    datetime: z.string().trim().min(1).nullable().optional(),
    with_time: z.boolean(),
    location_description: z.string().trim().min(1).nullable().optional(),
    location_reference: z.string().trim().min(1).nullable().optional(),
    location_url: z.string().trim().min(1).nullable().optional(),
    location_coords: z.string().trim().min(1).nullable().optional(),
    position: z.number().int().nonnegative(),
  })).default([]),
  dresscode: z.object({
    type: z.string().trim().min(1).nullable().optional(),
    description: z.string().trim().min(1).nullable().optional(),
  }).nullable().optional(),
  common_asked: z.array(z.object({
    question: z.string().trim().min(1),
    answer: z.string().trim().min(1),
  })).default([]),
  contact_info: z.union([
    z.array(z.object({
      label: z.string().trim().min(1),
      value: z.string().trim().min(1),
    })),
    z.record(z.string(), z.string().trim().min(1).nullable()),
  ]).default([]),
});

const attendanceSchema = z.object({
  guest_id: z.number().int().positive(),
  name: z.string().trim().min(1),
  has_responded: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  will_attend: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable(),
  response_date: z.string().trim().min(1).nullable(),
});

const messageSchema = z.object({
  id: z.number(),
  event_id: z.number().int().positive().nullable().optional(),
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
  increment_id: z.union([z.string(), z.number()]).nullable().optional(),
  name: nullableStringSchema,
  email: nullableStringSchema,
  payment_status: nullableStringSchema,
  shipping_status: nullableStringSchema,
  grand_total: nullableNumberSchema,
  payment_method: nullableStringSchema,
  payment: paymentSchema.nullable().optional(),
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  currency: nullableStringSchema.optional(),
  currency_code: nullableStringSchema.optional(),
  currency_symbol: nullableStringSchema.optional(),
  event_name: nullableStringSchema,
  event_date: nullableStringSchema,
  event_url: nullableStringSchema,
  items: z.array(purchaseItemSchema).default([]),
  created_at: nullableStringSchema,
});

const cartSchema = z.object({
  cart_id: z.union([z.string().trim().min(1), z.number().int().positive()]),
  status: z.string().trim().min(1),
  was_abandoned: z.boolean(),
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  event_name: nullableStringSchema,
  event_date: nullableStringSchema,
  event_url: nullableStringSchema,
  subtotal: nullableNumberSchema,
  currency: nullableStringSchema.optional(),
  currency_code: nullableStringSchema.optional(),
  currency_symbol: nullableStringSchema.optional(),
  gifts_quantity: nullableNumberSchema,
  items: z.array(purchaseItemSchema).default([]),
  created_at: nullableStringSchema,
});

const giftPurchaseSchema = z.object({
  id: z.string().min(1),
  increment_id: z.union([z.string(), z.number()]).nullable().optional(),
  payment_status: nullableStringSchema,
  shipping_status: nullableStringSchema,
  grand_total: nullableNumberSchema,
  is_thanked: z.boolean().nullable().optional(),
  payment: paymentSchema.nullable().optional(),
  decline_code: nullableStringSchema,
  admin_comment: nullableStringSchema,
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  currency: nullableStringSchema.optional(),
  currency_code: nullableStringSchema.optional(),
  currency_symbol: nullableStringSchema.optional(),
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

const partitionedOrdersDataSchema = z.object({
  // The partition parser validates each key below independently. Keeping
  // these unknown here is important: malformed legacy `orders` must not make
  // an otherwise valid partitioned response unusable.
  orders: z.unknown().optional(),
  completed_orders: z.unknown().optional(),
  pending_orders: z.unknown().optional(),
  carts: z.unknown().optional(),
});

const giftPurchasesDataSchema = z.object({
  purchases: z.array(giftPurchaseSchema),
});

const eventDetailDataSchema = z.object({
  event: eventDetailSchema,
  attendance: attendanceSchema.nullable().default(null),
  purchases: z.array(giftPurchaseSchema).default([]),
});

type OrderWire = z.infer<typeof orderSchema>;
type GiftPurchaseWire = z.infer<typeof giftPurchaseSchema>;
type CartWire = z.infer<typeof cartSchema>;

function normalizePhoneInput(
  input: AgentAuthByPhoneInput,
): AgentAuthByPhoneInput | null {
  const extensionDigits = input.phone_extension.replace(/\D/gu, '');
  const phoneDigits = input.phone_number.replace(/\D/gu, '');
  if (!extensionDigits || !phoneDigits) {
    return null;
  }
  return {
    phone_extension: `+${extensionDigits}`,
    phone_number: phoneDigits,
  };
}

/**
 * Packet B: nested event identity from passthrough RSVP payloads. Event name
 * alone never binds identity; only a positive integer event id counts.
 */
function readRsvpNestedEventId(event: unknown): number | null {
  if (typeof event !== 'object' || event === null) {
    return null;
  }
  const eventId = (event as Record<string, unknown>).event_id;
  return typeof eventId === 'number' && Number.isInteger(eventId) && eventId > 0
    ? eventId
    : null;
}

export class HttpAgentConversationGateway implements AgentConversationGateway {
  readonly capabilityDescriptor: RuntimeCapabilityManifest;
  readonly capabilities: RuntimeCapabilityManifest;

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
      maxRetries: number;
      messageLoggingEnabled: boolean;
      allowCustomerWrites?: boolean;
      environment?: 'development' | 'production';
      onUnmappedWireKey?: UnmappedWireKeySink;
    },
  ) {
    this.capabilityDescriptor = buildRuntimeCapabilityManifest({
      configured: Boolean(options.baseUrl.trim() && options.apiKey.trim()),
      environment: options.environment ?? (options.allowCustomerWrites === false ? 'development' : 'production'),
      allowCustomerWrites: options.allowCustomerWrites,
      disabledOperations: [],
    });
    this.capabilities = this.capabilityDescriptor;
  }

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

    this.diagnoseWireKeys('/conversations/messages', response.data, agentRecentMessagesWireShape);
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
        ...(message.event_id ? { eventId: message.event_id } : {}),
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

    this.diagnoseWireKeys('/orders', response.data, agentOrderWireShape);
    const purchases = this.parseOrders(response.data);
    if (!purchases) {
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
      purchases,
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

    this.diagnoseWireKeys('/gift-purchases', response.data, agentGiftPurchasesWireShape);
    const purchases = this.parseGiftPurchases(response.data);
    if (!purchases) {
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
      purchases,
    };
  }

  async getGuestOrdersByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    return this.getGuestPurchaseByPhone('orders', args);
  }

  async getGuestGiftPurchasesByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    return this.getGuestPurchaseByPhone('gift_purchases', args);
  }

  async authByPhone(input: AgentAuthByPhoneInput): Promise<AgentAuthByPhoneResult> {
    const phone = normalizePhoneInput(input);
    if (!phone) {
      return {
        status: 'failed',
        error: 'Agent API phone authentication requires a valid phone identity.',
        retryable: false,
      };
    }
    const response = await this.request('/auth-by-phone', {
      method: 'POST',
      body: {
        phone_extension: phone.phone_extension,
        phone_number: phone.phone_number,
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

  async getGuestEventsByPhone(
    input: AgentAuthByPhoneInput,
  ): Promise<AgentGuestEventsResult> {
    const phone = normalizePhoneInput(input);
    if (!phone) {
      return {
        status: 'failed',
        error: 'Agent API guest event lookup requires a valid phone identity.',
        retryable: false,
      };
    }
    const params = new URLSearchParams({
      phone_extension: phone.phone_extension,
      phone_number: phone.phone_number,
    });
    const response = await this.request(`/guest/events?${params.toString()}`, {
      method: 'GET',
    });
    if (response.status !== 'success') {
      if (response.httpStatus === 404) {
        return { status: 'not_found' };
      }
      return {
        status: 'failed',
        error: response.error,
        retryable: response.retryable,
      };
    }

    this.diagnoseWireKeys('/guest/events', response.data, agentGuestEventsWireShape);
    const parsed = guestEventsDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        status: 'failed',
        error: 'Agent API guest events response had an unexpected shape.',
        retryable: false,
      };
    }

    return {
      status: 'success',
      events: parsed.data.events.map((event) => ({
        eventId: event.event_id,
        name: event.name,
        slug: event.slug,
        url: event.url ?? null,
        datetime: normalizeServerTimestamp(event.datetime),
        type: event.type ?? null,
        typeDetail: event.type_detail ?? null,
        stage: event.stage ?? null,
        city: event.city ?? null,
        country: event.country ?? null,
        currency: event.currency ?? null,
      })),
    };
  }

  async getEventDetail(input: AgentEventDetailInput): Promise<AgentEventDetailResult> {
    const eventId = input.eventId;
    const slug = input.slug?.trim() || null;
    if (eventId === undefined && !slug) {
      return {
        status: 'failed',
        error: 'Agent API event detail lookup requires an event id or slug.',
        retryable: false,
      };
    }
    if (eventId !== undefined && (!Number.isSafeInteger(eventId) || eventId <= 0)) {
      return {
        status: 'failed',
        error: 'Agent API event detail lookup received an invalid event id.',
        retryable: false,
      };
    }
    const hasDirectPhone = input.phone_extension !== undefined || input.phone_number !== undefined;
    const suppliedPhone = input.trustedPhone ?? input.phone ?? (hasDirectPhone
      ? {
          phone_extension: input.phone_extension ?? '',
          phone_number: input.phone_number ?? '',
        }
      : null);
    if (hasDirectPhone && (!input.phone_extension || !input.phone_number)) {
      return {
        status: 'failed',
        error: 'Agent API event detail phone lookup requires both phone fields.',
        retryable: false,
      };
    }
    const phone = suppliedPhone ? normalizePhoneInput(suppliedPhone) : null;
    if (suppliedPhone && !phone) {
      return {
        status: 'failed',
        error: 'Agent API event detail lookup received an invalid phone identity.',
        retryable: false,
      };
    }
    const params = new URLSearchParams(
      eventId !== undefined ? { event_id: String(eventId) } : { slug: slug as string },
    );
    if (phone) {
      params.set('phone_extension', phone.phone_extension);
      params.set('phone_number', phone.phone_number);
    }
    const response = await this.request(`/event?${params.toString()}`, {
      method: 'GET',
    });
    if (response.status !== 'success') {
      if (response.httpStatus === 404) {
        return { status: 'not_found' };
      }
      return {
        status: 'failed',
        error: response.error,
        retryable: response.retryable,
      };
    }

    this.diagnoseWireKeys('/event', response.data, agentEventDetailWireShape);
    const parsed = eventDetailDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        status: 'failed',
        error: 'Agent API event detail response had an unexpected shape.',
        retryable: false,
      };
    }
    const event = parsed.data.event;
    return {
      status: 'success',
      event: {
        eventId: event.event_id,
        name: event.name,
        slug: event.slug,
        url: event.url ?? null,
        datetime: normalizeServerTimestamp(event.datetime),
        type: event.type ?? null,
        typeDetail: event.type_detail ?? null,
        stage: event.stage ?? null,
        city: event.city ?? null,
        country: event.country?.name ?? null,
        currency: event.currency ?? null,
        withTime: event.with_time,
        timezone: event.timezone ?? null,
        celebrateds: event.celebrateds.map((celebrated) => ({
          name: celebrated.name,
          type: celebrated.type ?? null,
        })),
        moments: event.moments.map((moment) => ({
          label: moment.label,
          description: moment.description ?? null,
          datetime: normalizeServerTimestamp(moment.datetime),
          withTime: moment.with_time,
          locationDescription: moment.location_description ?? null,
          locationReference: moment.location_reference ?? null,
          locationUrl: moment.location_url ?? null,
          locationCoords: moment.location_coords ?? null,
          position: moment.position,
        })),
        dresscode: event.dresscode
          ? {
              type: event.dresscode.type ?? null,
              description: event.dresscode.description ?? null,
            }
          : null,
        commonAsked: event.common_asked,
        contactInfo: Array.isArray(event.contact_info)
          ? event.contact_info
          : Object.entries(event.contact_info)
              .filter((entry): entry is [string, string] => entry[1] !== null)
              .map(([label, value]) => ({ label, value })),
        attendance: parsed.data.attendance
          ? {
              guestId: parsed.data.attendance.guest_id,
              name: parsed.data.attendance.name,
              hasResponded: parsed.data.attendance.has_responded === true || parsed.data.attendance.has_responded === 1,
              willAttend: parsed.data.attendance.will_attend === null
                ? null
                : parsed.data.attendance.will_attend === true || parsed.data.attendance.will_attend === 1,
              responseDate: normalizeServerTimestamp(parsed.data.attendance.response_date),
            }
          : null,
        purchases: parsed.data.purchases.map((purchase) => this.mapGiftPurchase(purchase, 'event_detail')),
      },
    };
  }

  async updatePhone(
    args: AgentAuthByPhoneInput & { token: string },
  ): Promise<AgentUpdatePhoneResult> {
    const phone = normalizePhoneInput(args);
    if (!phone) {
      return {
        status: 'failed',
        error: 'Agent API phone update requires a valid phone identity.',
        retryable: false,
      };
    }
    const response = await this.request('/user/update-phone', {
      method: 'POST',
      authorizationToken: args.token,
      body: {
        phone_extension: phone.phone_extension,
        phone_number: phone.phone_number,
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
    const phone = normalizePhoneInput(input);
    if (!phone) {
      return {
        status: 'failed',
        error: 'Agent API RSVP requires a valid phone identity.',
        retryable: false,
      };
    }
    if (!input.action && !input.plus_one_response) {
      return {
        status: 'failed',
        error: 'Agent API RSVP requires an attendance or plus-one decision.',
        retryable: false,
      };
    }
    if (input.plus_one_response &&
      (input.guest_id === undefined ||
        !Number.isInteger(input.guest_id) ||
        input.guest_id <= 0)) {
      return {
        status: 'failed',
        error: 'Agent API plus-one RSVP requires a valid guest id.',
        retryable: false,
      };
    }
    const response = await this.request('/guest/rsvp', {
      method: 'POST',
      body: {
        phone_extension: phone.phone_extension,
        phone_number: phone.phone_number,
        ...(input.action ? { action: input.action } : {}),
        ...(input.guest_id !== undefined ? { guest_id: input.guest_id } : {}),
        ...(input.plus_one_response
          ? { plus_one_response: input.plus_one_response }
          : {}),
        ...(input.plus_one_name !== undefined
          ? { plus_one_name: input.plus_one_name }
          : {}),
        ...(input.plus_one_email !== undefined
          ? { plus_one_email: input.plus_one_email }
          : {}),
        ...(input.plus_one_phone_no !== undefined
          ? { plus_one_phone_no: input.plus_one_phone_no }
          : {}),
        ...(input.plus_one_phone_ext !== undefined
          ? { plus_one_phone_ext: input.plus_one_phone_ext }
          : {}),
      },
    });

    if (response.status === 'success') {
      const candidates = this.parseRsvpCandidates(response.data);
      if (candidates) {
        return {
          status: 'multiple_pending',
          candidates,
        };
      }
      const rawData = response.data;
      const combined = rsvpCombinedResponseDataSchema.safeParse(rawData);
      const isCombined =
        rawData !== null &&
        typeof rawData === 'object' &&
        !Array.isArray(rawData) &&
        ('rsvp' in rawData || 'plus_one' in rawData);
      const parsed = rsvpResponseDataSchema.safeParse(
        isCombined && combined.success
          ? {
              ...(combined.data.rsvp ??
                (rawData as Record<string, unknown>)),
              plus_one: combined.data.plus_one ?? null,
            }
          : rawData,
      );
      if (!parsed.success) {
        return {
          status: 'failed',
          error: 'Agent API RSVP response had an unexpected shape.',
          retryable: false,
        };
      }
      const plusOne = parsed.data.plus_one ?? null;
      if (input.plus_one_response && !plusOne) {
        return {
          status: 'failed',
          error: 'Agent API RSVP response did not confirm the plus-one state.',
          retryable: false,
        };
      }
      const returnedWillAttend = parsed.data.will_attend === true || parsed.data.will_attend === 1
        ? true
        : parsed.data.will_attend === false || parsed.data.will_attend === 0
          ? false
          : null;
      // Preserve a companion receipt even when the attendance echo is
      // absent or disagrees. The verified executor compares the requested
      // attendance with a fresh read before any success claim.
      // Packet B: a returned guest identity different from the requested one
      // is a mismatch rejection, never a fallback to the requested id. Event
      // name alone never binds identity; the executor re-checks event id too.
      const returnedGuestId = parsed.data.guest_id ?? null;
      if (input.guest_id !== undefined && returnedGuestId !== null && returnedGuestId !== input.guest_id) {
        return {
          status: 'failed',
          error: 'Agent API RSVP response returned a different guest identity.',
          retryable: false,
        };
      }
      return {
        status: 'responded',
        action: parsed.data.action ?? input.action ?? null,
        willAttend: returnedWillAttend,
        guestId: returnedGuestId ?? input.guest_id ?? null,
        eventId: parsed.data.event_id ?? readRsvpNestedEventId(parsed.data.event) ?? null,
        eventName:
          parsed.data.event_name ??
          parsed.data.event?.name ??
          parsed.data.event?.title ??
          null,
        eventDate: normalizeServerTimestamp(
          parsed.data.event_date ??
          parsed.data.event?.date ??
          parsed.data.event?.event_date,
        ),
        plusOne: plusOne
          ? {
              saved: plusOne.saved,
              response: plusOne.response ?? input.plus_one_response ?? null,
              reason: plusOne.reason ?? null,
            }
          : null,
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
      return {
        status: 'already_responded',
        currentAction: null,
        requestedAction: input.action ?? null,
        guestId: input.guest_id ?? null,
        eventId: null,
        eventName: null,
        eventDate: null,
      };
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
      : 'pending_guests' in parsed.data
        ? parsed.data.pending_guests as RsvpCandidateWire[]
        : 'candidates' in parsed.data
        ? parsed.data.candidates as RsvpCandidateWire[]
        : 'pending' in parsed.data
          ? parsed.data.pending as RsvpCandidateWire[]
          : parsed.data.invitations;
    return candidateData.map((candidate) => ({
      guestId: candidate.guest_id,
      eventId: candidate.event_id ?? readRsvpNestedEventId(candidate.event) ?? null,
      eventName:
        candidate.event_name ??
        candidate.event?.name ??
        candidate.event?.title ??
        null,
      eventDate: normalizeServerTimestamp(
        candidate.event_date ??
        candidate.event?.date ??
        candidate.event?.event_date,
      ),
    }));
  }

  private parseOrders(data: unknown): PurchaseInformation[] | null {
    const parsed = ordersDataSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.orders.map((order) => this.mapOrder(order, 'legacy_orders'));
  }

  /**
   * Parse the phone-scoped response without allowing the legacy `orders` array
   * to compete with the partitioned source. The legacy array is retained only
   * when no new partition key is present, for transport compatibility.
   */
  private parseGuestOrders(data: unknown): {
    purchases: PurchaseInformation[];
    orderPartitions: {
      pending: PurchaseInformation[];
      completed: PurchaseInformation[];
    };
    carts: CartInformation[];
    partitioned: boolean;
  } | null {
    const parsed = partitionedOrdersDataSchema.safeParse(data);
    if (!parsed.success || !data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const source = data as Record<string, unknown>;
    const partitioned =
      Object.prototype.hasOwnProperty.call(source, 'completed_orders') ||
      Object.prototype.hasOwnProperty.call(source, 'pending_orders') ||
      Object.prototype.hasOwnProperty.call(source, 'carts');
    if (!partitioned) {
      if (!Object.prototype.hasOwnProperty.call(source, 'orders')) {
        return null;
      }
      const legacy = ordersDataSchema.safeParse(data);
      if (!legacy.success) return null;
      const purchases = legacy.data.orders.map((order) =>
        this.mapOrder(order, 'legacy_orders'),
      );
      return {
        purchases,
        orderPartitions: { pending: [], completed: [] },
        carts: [],
        partitioned: false,
      };
    }

    // An explicitly supplied partition must be an array. Each partition is
    // validated independently and legacy orders are intentionally ignored.
    const pendingParsed = Object.prototype.hasOwnProperty.call(source, 'pending_orders')
      ? z.array(orderSchema).safeParse(source.pending_orders)
      : { success: true as const, data: [] as OrderWire[] };
    const completedParsed = Object.prototype.hasOwnProperty.call(source, 'completed_orders')
      ? z.array(orderSchema).safeParse(source.completed_orders)
      : { success: true as const, data: [] as OrderWire[] };
    const cartsParsed = Object.prototype.hasOwnProperty.call(source, 'carts')
      ? z.array(cartSchema).safeParse(source.carts)
      : { success: true as const, data: [] as CartWire[] };
    if (!pendingParsed.success || !completedParsed.success || !cartsParsed.success) {
      return null;
    }
    const pending = pendingParsed.data.map((order) =>
      this.mapOrder(order, 'pending_orders'),
    );
    const completed = completedParsed.data.map((order) =>
      this.mapOrder(order, 'completed_orders'),
    );
    const carts = cartsParsed.data.map((cart) => this.mapCart(cart));
    return {
      purchases: [...pending, ...completed],
      orderPartitions: { pending, completed },
      carts,
      partitioned: true,
    };
  }

  private mapOrder(
    order: OrderWire,
    partition: PurchasePartition,
  ): PurchaseInformation {
    const money = normalizePurchaseCurrency(order);
    return {
      orderId: order.id,
      recordSource: 'orders',
      partition,
      eventId: order.event_id ?? null,
      currency: money.currency,
      currencySymbol: money.currencySymbol,
      currencyConflict: money.currencyConflict,
      customerTransactionNumber: normalizeBackendCustomerTransactionNumber(
        order.increment_id,
      ),
      paymentStatus: order.payment_status ?? null,
      shippingStatus: order.shipping_status ?? null,
      grandTotal: order.grand_total ?? null,
      paymentMethod: order.payment_method ?? null,
      eventName: order.event_name ?? null,
      eventDate: normalizeServerTimestamp(order.event_date),
      eventUrl: order.event_url ?? null,
      createdAt: normalizeServerTimestamp(order.created_at),
      items: order.items.map((item) => ({
        giftName: item.gift_name ?? null,
        quantity: item.quantity ?? null,
        amount: item.amount ?? null,
        rowTotal: item.row_total ?? null,
        type: item.type ?? null,
      })),
      ...(order.payment ? { payment: this.mapPayment(order.payment) } : {}),
    };
  }

  private mapCart(cart: CartWire): CartInformation {
    const money = normalizePurchaseCurrency(cart);
    return {
      cartId: String(cart.cart_id),
      status: cart.status,
      wasAbandoned: cart.was_abandoned,
      eventId: cart.event_id ?? null,
      eventName: cart.event_name ?? null,
      eventDate: normalizeServerTimestamp(cart.event_date),
      eventUrl: cart.event_url ?? null,
      subtotal: cart.subtotal ?? null,
      currency: money.currency,
      currencySymbol: money.currencySymbol,
      giftsQuantity: cart.gifts_quantity ?? null,
      createdAt: normalizeServerTimestamp(cart.created_at),
      items: cart.items.map((item) => ({
        giftName: item.gift_name ?? null,
        quantity: item.quantity ?? null,
        amount: item.amount ?? null,
        rowTotal: item.row_total ?? null,
        type: item.type ?? null,
      })),
    };
  }

  private parseGiftPurchases(data: unknown): PurchaseInformation[] | null {
    const parsed = giftPurchasesDataSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.purchases.map((purchase) => this.mapGiftPurchase(purchase));
  }

  private mapGiftPurchase(
    purchase: GiftPurchaseWire,
    recordSource: 'gift_purchases' | 'event_detail' = 'gift_purchases',
  ): PurchaseInformation {
    const money = normalizePurchaseCurrency(purchase);
    return {
      orderId: purchase.id,
      recordSource,
      eventId: purchase.event_id ?? null,
      currency: money.currency,
      currencySymbol: money.currencySymbol,
      currencyConflict: money.currencyConflict,
      customerTransactionNumber: normalizeBackendCustomerTransactionNumber(
        purchase.increment_id,
      ),
      paymentStatus: purchase.payment_status ?? null,
      shippingStatus: purchase.shipping_status ?? null,
      grandTotal: purchase.grand_total ?? null,
      paymentMethod: purchase.payment?.method ?? null,
      eventName: purchase.event_name ?? null,
      eventDate: normalizeServerTimestamp(purchase.event_date),
      eventUrl: purchase.event_url ?? null,
      createdAt: normalizeServerTimestamp(purchase.created_at),
      items: purchase.items.map((item) => ({
        giftName: item.gift_name ?? null,
        quantity: item.quantity ?? null,
        amount: item.amount ?? null,
        rowTotal: item.row_total ?? null,
        type: item.type ?? null,
      })),
      payment: purchase.payment ? this.mapPayment(purchase.payment) : null,
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
    };
  }

  private mapPayment(payment: z.infer<typeof paymentSchema>): PurchasePaymentDetails {
    const voucher = payment.voucher;
    return {
      method: payment.method ?? null,
      amount: payment.amount ?? null,
      paidAt: normalizeServerTimestamp(payment.paid_at),
      paymentId: payment.payment_id ?? null,
      transactionStatus: payment.transaction_status ?? null,
      gatewayMessage: payment.gateway_message ?? null,
      operationCode: payment.op_code ?? null,
      originBank: payment.origin_bank ?? null,
      voucherProvided: voucher === undefined ? null : voucher === null
        ? null
        : Array.isArray(voucher) ? voucher.length > 0 : voucher.length > 0,
      destinationAccount: payment.destination_account
        ? {
          holder: payment.destination_account.holder ?? null,
          bank: payment.destination_account.bank ?? null,
          number: payment.destination_account.number ?? null,
          cci: payment.destination_account.cci ?? null,
          type: payment.destination_account.type ?? null,
        }
        : null,
    };
  }

  private async getGuestPurchaseByPhone(
    resource: PurchaseResource,
    args: {
      phone_extension: string;
      phone_number: string;
      orderId?: string | null;
    },
  ): Promise<AgentPhonePurchaseLookupResult> {
    const phone = normalizePhoneInput(args);
    if (!phone) {
      return {
        status: 'invalid_request',
        resource,
        error: 'Agent API phone lookup requires a valid phone identity.',
      };
    }
    const endpoint = resource === 'orders' ? '/guest/orders' : '/guest/gift-purchases';
    const params = new URLSearchParams({
      phone_extension: phone.phone_extension,
      phone_number: phone.phone_number,
    });
    if (args.orderId) {
      params.set('order_id', args.orderId);
    }
    const response = await this.request(`${endpoint}?${params.toString()}`, {
      method: 'GET',
    });
    if (response.status !== 'success') {
      if (response.httpStatus === 404 && response.errorEnvelope) {
        return {
          status: 'not_found',
          resource,
          orderId: args.orderId ?? null,
        };
      }
      if (response.httpStatus === 401 || response.httpStatus === 403) {
        return { status: 'unauthorized', resource, error: response.error };
      }
      if (response.httpStatus === 400 || response.httpStatus === 422) {
        return { status: 'invalid_request', resource, error: response.error };
      }
      return {
        status: 'retryable_failure',
        resource,
        retryable: true,
        error: response.error,
      };
    }

    const guestOrders = resource === 'orders'
      ? this.parseGuestOrders(response.data)
      : null;
    this.diagnoseWireKeys(
      resource === 'orders' ? '/guest/orders' : '/guest/gift-purchases',
      response.data,
      resource === 'orders' ? agentPartitionedOrdersWireShape : agentGiftPurchasesWireShape,
    );
    const purchases = resource === 'orders'
      ? guestOrders?.purchases ?? null
      : this.parseGiftPurchases(response.data);
    if (!purchases) {
      return {
        status: 'invalid_response',
        resource,
        error: `Agent API ${resource === 'orders' ? 'orders' : 'gift-purchases'} response had an unexpected shape.`,
      };
    }
    if (resource === 'orders' && guestOrders) {
      return {
        status: 'success',
        resource,
        purchases,
        ...(guestOrders.partitioned
          ? {
              orderPartitions: guestOrders.orderPartitions,
              carts: guestOrders.carts,
            }
          : {}),
      };
    }
    return { status: 'success', resource, purchases };
  }

  private diagnoseWireKeys(
    endpoint: string,
    value: unknown,
    shape: WireObjectShape,
  ): void {
    reportUnmappedWireKeys(endpoint, value, shape, this.options.onUnmappedWireKey);
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
    if (options.method !== 'GET' && this.options.allowCustomerWrites === false) {
      return {
        status: 'failed', error: 'Customer writes are disabled in this environment.',
        retryable: false, httpStatus: null, responseFormat: null, errorEnvelope: false,
      };
    }
    const attempts = Math.max(1, this.options.maxRetries + 1);
    let lastError: string | null = null;
    const url = `${this.options.baseUrl}${path}`;
    const observeAuthExchange =
      path.startsWith('/auth-by-phone') ||
      path.startsWith('/user/update-phone') ||
      path.startsWith('/guest/events') ||
      path.startsWith('/guest/rsvp') ||
      path.startsWith('/event?') ||
      path.startsWith('/orders') ||
      path.startsWith('/gift-purchases') ||
      Boolean(options.authorizationToken);
    const operationId = observeAuthExchange ? createAuthOperationId() : null;
    const requestStartedAt = Date.now();
    const correlationId = getRequestCorrelationId();
    const requestHeaders = {
      'X-Agent-Key': this.options.apiKey,
      ...(options.authorizationToken
        ? { Authorization: `Bearer ${options.authorizationToken}` }
        : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(correlationId ? { 'x-recap-correlation-id': correlationId } : {}),
    };
    if (operationId) {
      logAuthObservabilityEvent('info', 'auth_http_request_started', {
        auth_http_operation_id: operationId,
        service: 'agent_api',
        operation: this.authOperationForPath(path),
        method: options.method,
        route: path.split('?')[0],
        max_attempts: attempts,
        request_headers_present: Object.keys(requestHeaders),
        request_body_fields: options.body ? Object.keys(options.body) : [],
        ...(correlationId ? { correlation_id: correlationId } : {}),
      });
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      const attemptStartedAt = Date.now();
      try {
        const response = await fetch(url, {
          method: options.method,
          headers: requestHeaders,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const parsedBody = await this.parseBody(response);
        if (operationId) {
          logAuthObservabilityEvent(
            response.ok ? 'info' : 'error',
            'auth_http_response_received',
            {
              auth_http_operation_id: operationId,
              service: 'agent_api',
              operation: this.authOperationForPath(path),
              method: options.method,
              route: path.split('?')[0],
              attempt,
              max_attempts: attempts,
              attempt_duration_ms: Date.now() - attemptStartedAt,
              total_duration_ms: Date.now() - requestStartedAt,
              response_status: response.status,
              response_ok: response.ok,
              response_headers: responseHeadersForAuthLog(response.headers),
              response_body_summary: this.observabilityBodySummary(parsedBody),
            },
          );
        }
        if (!response.ok) {
          const retryable = this.isRetryableStatus(response.status);
          if (retryable && attempt < attempts) {
            lastError = this.httpError(response.status, parsedBody);
            if (operationId) {
              logAuthObservabilityEvent('info', 'auth_http_retry_scheduled', {
                auth_http_operation_id: operationId,
                service: 'agent_api',
                operation: this.authOperationForPath(path),
                completed_attempt: attempt,
                next_attempt: attempt + 1,
                response_status: response.status,
                failure_class: this.failureClassForStatus(response.status),
              });
            }
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
        if (operationId) {
          logAuthObservabilityEvent('error', 'auth_http_attempt_failed', {
            auth_http_operation_id: operationId,
            service: 'agent_api',
            operation: this.authOperationForPath(path),
            method: options.method,
            route: path.split('?')[0],
            attempt,
            max_attempts: attempts,
            attempt_duration_ms: Date.now() - attemptStartedAt,
            total_duration_ms: Date.now() - requestStartedAt,
            retry_scheduled: attempt < attempts,
            failure_class: 'transport_error',
          });
        }
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

  private authOperationForPath(path: string): string {
    if (path.startsWith('/auth-by-phone')) return 'authenticate_by_phone';
    if (path.startsWith('/user/update-phone')) return 'update_phone_after_email_auth';
    if (path.startsWith('/guest/events')) return 'lookup_guest_events_by_phone';
    if (path.startsWith('/guest/rsvp')) return 'respond_guest_rsvp';
    if (path.startsWith('/event?')) return 'lookup_guest_event_detail';
    if (path.startsWith('/guest/orders')) return 'lookup_guest_orders_by_phone';
    if (path.startsWith('/guest/gift-purchases')) return 'lookup_guest_gift_purchases_by_phone';
    if (path.startsWith('/orders')) return 'lookup_authenticated_orders';
    if (path.startsWith('/gift-purchases')) return 'lookup_authenticated_gift_purchases';
    return 'authenticated_agent_api_request';
  }

  private observabilityBodySummary(body: unknown): Record<string, unknown> {
    if (body === null || body === undefined) {
      return { kind: 'null' };
    }
    if (Array.isArray(body)) {
      return { kind: 'array', item_count: body.length };
    }
    if (typeof body !== 'object') {
      return { kind: typeof body };
    }
    const record = body as Record<string, unknown>;
    const summary: Record<string, unknown> = {
      kind: 'object',
      fields: Object.keys(record),
    };
    if (typeof record.status === 'boolean') {
      summary.status = record.status;
    }
    for (const key of ['orders', 'purchases', 'messages', 'events']) {
      const value = record[key];
      if (Array.isArray(value)) {
        summary[`${key}_count`] = value.length;
      }
    }
    return summary;
  }

  private failureClassForStatus(status: number): string {
    if (status === 401 || status === 403) return 'authorization_error';
    if (status === 404) return 'not_found';
    if (status === 422 || status === 400) return 'invalid_request';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server_error';
    return 'http_error';
  }

  private publicFailure(
    failure: HttpRequestFailure,
  ): Extract<AgentGatewayResult, { status: 'failed' }> {
    const outcome: HandoffGatewayOutcome = failure.httpStatus === null ? 'unknown' : 'failed';
    return {
      status: 'failed',
      error: failure.error,
      retryable: failure.retryable,
      outcome,
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
