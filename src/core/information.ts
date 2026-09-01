import { z } from 'zod';

import type { UserEventLookupResult } from '../runtime/provider-gateway';
import { decisionNodeSchema } from './decision-nodes';

export const purchaseResourceValues = ['orders', 'gift_purchases'] as const;
export type PurchaseResource = (typeof purchaseResourceValues)[number];

/** Provenance of an order record in the phone-scoped orders response. */
export const purchasePartitionValues = [
  'pending_orders',
  'completed_orders',
  'legacy_orders',
] as const;
export type PurchasePartition = (typeof purchasePartitionValues)[number];

export const purchaseAspectValues = [
  'summary',
  'payment_status',
  'payment_details',
  'payment_options',
  'validation_window',
  'shipping',
  'dedication',
  'thanks',
  'decline',
] as const;
export type PurchaseAspect = (typeof purchaseAspectValues)[number];

export const informationValidationPolicyRequestId = 'information-validation-policy';
export const informationPaymentOptionsPolicyRequestId = 'information-payment-options-policy';

export const sensitivePurchaseFieldValues = [
  'payment_id',
  'transaction_status',
  'gateway_message',
  'operation_code',
  'origin_bank',
  'destination_account',
  'voucher_image',
  'decline_code',
  'admin_comment',
] as const;
export type SensitivePurchaseField = (typeof sensitivePurchaseFieldValues)[number];

export const purchaseAuthActionValues = [
  'none',
  'provide_email',
  'provide_otp',
  'report_otp_not_received',
  'resend_otp',
  'change_email',
  'accountless_user',
  'decline_authentication',
] as const;
export type PurchaseAuthAction = (typeof purchaseAuthActionValues)[number];

export const faqInformationRequestSchema = z.object({
  kind: z.literal('faq'),
  query: z.string().min(1),
});

export const associatedEventInformationRequestSchema = z.object({
  kind: z.literal('associated_event'),
  query: z.string().min(1),
  eventHint: z.string().nullable(),
  authAction: z.enum(purchaseAuthActionValues).optional(),
});

export const purchaseInformationRequestSchema = z.object({
  kind: z.literal('purchase'),
  resource: z.enum(purchaseResourceValues),
  query: z.string().min(1),
  orderId: z.string().nullable(),
  aspects: z.array(z.enum(purchaseAspectValues)).min(1),
  sensitiveFields: z.array(z.enum(sensitivePurchaseFieldValues)),
  authAction: z.enum(purchaseAuthActionValues),
  // Typed selectors are populated only when the user states them explicitly.
  eventHint: z.string().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
});

export const extractedInformationRequestSchema = z.discriminatedUnion('kind', [
  faqInformationRequestSchema,
  associatedEventInformationRequestSchema,
  purchaseInformationRequestSchema,
]);

export type ExtractedInformationRequest = z.infer<
  typeof extractedInformationRequestSchema
>;

export const pendingInformationRequestSchema = z.discriminatedUnion('kind', [
  faqInformationRequestSchema.extend({
    requestId: z.string().min(1),
  }),
  associatedEventInformationRequestSchema.extend({
    requestId: z.string().min(1),
  }),
  purchaseInformationRequestSchema.extend({
    requestId: z.string().min(1),
  }),
]);

export type PendingInformationRequest = z.infer<
  typeof pendingInformationRequestSchema
>;

export const completedInformationRequestSchema = extractedInformationRequestSchema;
export type CompletedInformationRequest = z.infer<
  typeof completedInformationRequestSchema
>;

export const informationSelectionCandidateSchema = z.object({
  requestId: z.string().min(1),
  resource: z.enum(purchaseResourceValues),
  orders: z.array(
    z.object({
      orderId: z.string().min(1),
      eventName: z.string().nullable(),
      createdAt: z.string().nullable(),
      grandTotal: z.number().nullable(),
      paymentStatus: z.string().nullable(),
    }),
  ),
});

export type InformationSelectionCandidate = z.infer<
  typeof informationSelectionCandidateSchema
>;

export const informationStateSchema = z.object({
  resume_node: decisionNodeSchema.nullable(),
  pending_requests: z.array(pendingInformationRequestSchema),
  selection_candidates: z.array(informationSelectionCandidateSchema),
  last_completed_request: completedInformationRequestSchema.nullable().optional(),
});

export type InformationState = z.infer<typeof informationStateSchema>;

export const userAuthStatusValues = [
  'none',
  'code_requested',
  'authenticated',
  'email_not_found',
  'failed',
] as const;

export const phoneConfirmationValues = ['yes', 'no', 'unclear'] as const;
export type PhoneConfirmation = (typeof phoneConfirmationValues)[number];

export const userAuthStateSchema = z.object({
  status: z.enum(userAuthStatusValues),
  email: z.string().nullable().default(null),
  token: z.string().nullable().default(null),
  token_expires_at: z.string().nullable().default(null),
  last_error: z.string().nullable().default(null),
  requested_at: z.string().nullable().default(null),
  failed_code_attempts: z.number().int().nonnegative().default(0),
  otp_send_attempts: z.number().int().nonnegative().default(0),
  otp_non_delivery_reports: z.number().int().nonnegative().default(0),
  auth_method: z.enum(['phone', 'email']).nullable().default(null),
  awaiting_phone_confirmation: z.boolean().default(false),
});

export type UserAuthState = z.infer<typeof userAuthStateSchema>;

export type KnowledgeEvidence = {
  fileId: string;
  filename: string;
  score: number;
  text: string;
};

export type PurchaseItem = {
  giftName: string | null;
  quantity: number | null;
  amount: number | null;
  rowTotal: number | null;
  type: string | null;
};

/** A phone-scoped cart is deliberately not a purchase/order. */
export type CartInformation = {
  cartId: string;
  status: string;
  wasAbandoned: boolean;
  eventId?: number | string | null;
  eventName?: string | null;
  eventDate?: string | null;
  eventUrl?: string | null;
  subtotal?: number | null;
  amountDisclosure?: PurchaseAmountDisclosure | null;
  giftsQuantity?: number | null;
  createdAt?: string | null;
  items: PurchaseItem[];
};

export type PurchasePaymentDetails = {
  method: string | null;
  amount: number | null;
  paidAt: string | null;
  paymentId?: string | null;
  transactionStatus?: string | null;
  gatewayMessage?: string | null;
  operationCode?: string | null;
  originBank?: string | null;
  destinationAccount?: {
    holder: string | null;
    bank: string | null;
    number: string | null;
    cci: string | null;
    type: string | null;
  } | null;
  voucherImage?: string | string[] | null;
};

export type PendingPaymentValidationExpectation = {
  maxBusinessHours: 72;
  appliesTo: 'indexed_validation_methods';
};

export type PurchaseAmountDisclosure = {
  total: number | null;
  paid: number | null;
  currency: string | null;
  paymentMethod: string | null;
  presentation: 'explicit_currency' | 'recorded_method_no_currency';
};

export type PurchaseInformation = {
  orderId: string;
  /** Partition provenance is present for phone-scoped order candidates. */
  partition?: PurchasePartition;
  eventId?: number | string | null;
  currency?: string | null;
  /** Customer-visible numeric transaction reference, displayed as COD<number>. */
  customerTransactionNumber?: string | null;
  paymentStatus: string | null;
  shippingStatus: string | null;
  grandTotal: number | null;
  paymentMethod: string | null;
  eventName: string | null;
  eventDate: string | null;
  eventUrl: string | null;
  createdAt: string | null;
  items: PurchaseItem[];
  payment?: PurchasePaymentDetails | null;
  paymentValidationExpectation?: PendingPaymentValidationExpectation | null;
  /** Single reconciled amount representation intended for model disclosure. */
  amountDisclosure?: PurchaseAmountDisclosure | null;
  declineCode?: string | null;
  adminComment?: string | null;
  dedication?: {
    message: string | null;
    isPrivate: boolean | null;
    sendPhysical: boolean | null;
    physicalStatus: string | null;
  } | null;
  thanks?: {
    message: string | null;
    sendMethod: string | null;
  } | null;
  isThanked?: boolean | null;
};

export const informationAuthReasonValues = [
  'phone_confirmation_required',
  'phone_auth_failed',
  'email_required',
  'email_change_required',
  'otp_sent',
  'otp_resent',
  'otp_pending',
  'otp_not_received',
  'email_not_found',
  'otp_send_failed',
  'otp_send_rate_limited',
  'otp_send_unavailable',
  'otp_invalid',
  'otp_verification_rate_limited',
  'otp_verification_unavailable',
  'otp_email_not_verified',
  'otp_verification_validation_failed',
  'otp_verification_failed',
  'otp_repeated_failure',
] as const;

export const informationAuthRequirementValues = [
  'confirm_current_whatsapp_phone',
  'explain_account_information_access',
  'explain_account_ownership_security',
  'show_destination_email',
  'wait_up_to_one_minute',
  'check_main_inbox',
  'check_junk_mail',
  'explain_images_not_supported',
  'copy_and_paste_code_here',
  'offer_code_resend',
  'offer_email_change',
  'offer_human_support',
] as const;

export type InformationAuthReason =
  (typeof informationAuthReasonValues)[number];

export type InformationAuthGuidance = {
  reason: InformationAuthReason;
  email: string | null;
  requirements: (typeof informationAuthRequirementValues)[number][];
};

export function createInformationAuthGuidance(
  reason: InformationAuthReason,
  email: string | null,
): InformationAuthGuidance {
  const requirements: InformationAuthGuidance['requirements'] = [];

  if (reason === 'phone_confirmation_required') {
    requirements.push('confirm_current_whatsapp_phone');
  }
  if (reason === 'phone_auth_failed') {
    requirements.push('offer_human_support');
  }

  if (reason === 'email_required' || reason === 'email_change_required') {
    requirements.push('explain_account_information_access');
  }
  if (reason === 'otp_not_received') {
    requirements.push('explain_account_ownership_security');
  }
  if (email) {
    requirements.push('show_destination_email');
  }
  if (
    reason === 'otp_sent' ||
    reason === 'otp_resent' ||
    reason === 'otp_pending' ||
    reason === 'otp_not_received'
  ) {
    requirements.push(
      'wait_up_to_one_minute',
      'check_main_inbox',
      'check_junk_mail',
    );
  }
  if (reason === 'otp_sent' || reason === 'otp_resent') {
    requirements.push(
      'explain_images_not_supported',
      'copy_and_paste_code_here',
    );
  }
  if (reason === 'otp_not_received') {
    requirements.push('offer_code_resend', 'offer_email_change');
  }
  if (reason === 'otp_send_rate_limited') {
    requirements.push('offer_code_resend');
  }
  if (reason === 'otp_send_unavailable') {
    requirements.push('offer_human_support');
  }
  if (reason === 'otp_invalid') {
    requirements.push('offer_code_resend', 'offer_email_change');
  }
  if (reason === 'otp_verification_rate_limited') {
    requirements.push('offer_code_resend');
  }
  if (
    reason === 'otp_verification_unavailable' ||
    reason === 'otp_email_not_verified' ||
    reason === 'otp_verification_validation_failed' ||
    reason === 'otp_verification_failed'
  ) {
    requirements.push('offer_human_support');
  }
  if (reason === 'otp_repeated_failure') {
    requirements.push('offer_human_support');
  }

  return { reason, email, requirements };
}

export type InformationTaskResult =
  | {
      requestId: string;
      kind: 'faq';
      status: 'completed';
      evidence: KnowledgeEvidence[];
    }
  | {
      requestId: string;
      kind: 'associated_event';
      status: 'completed';
      result: UserEventLookupResult;
      accessMethod?: 'authenticated_account' | 'trusted_phone_guest';
    }
  | {
      requestId: string;
      kind: 'purchase';
      status: 'completed';
      resource: PurchaseResource;
      lookupResource?: PurchaseResource;
      purchases: PurchaseInformation[];
      /** Carts remain distinct checkout evidence and are never coerced into orders. */
      carts?: CartInformation[];
      needsSelection: boolean;
      accessMethod?:
        | 'authenticated_account'
        | 'trusted_phone_purchase'
        | 'trusted_phone_event_purchase';
      coverage?: 'complete' | 'partial' | 'inconsistent';
      referenceResolution?: 'matched' | 'unavailable';
      requestedCustomerTransactionNumber?: string | null;
    }
  | {
      requestId: string;
      kind: 'associated_event' | 'purchase';
      status: 'needs_input';
      nextInput: 'email' | 'otp' | 'phone_confirmation' | 'retry';
      guidance: InformationAuthGuidance;
    }
  | {
      requestId: string;
      kind: 'faq' | 'associated_event' | 'purchase';
      status: 'failed';
      retryable: boolean;
      /** Identifies a scoped lookup even when it returned no records. */
      accessMethod?: 'trusted_phone_guest' | 'trusted_phone_purchase';
      lookupResource?: PurchaseResource;
      failureKind:
        | 'not_configured'
        | 'not_found'
        | 'unauthorized'
        | 'route_unavailable'
        | 'invalid_response'
        | 'request_failed';
      message: string;
    };

export type InformationExecutionSummary = {
  requestId: string;
  kind: InformationTaskResult['kind'];
  status: InformationTaskResult['status'];
  source: 'knowledge_base' | 'associated_event_api' | 'agent_api';
  outcomeCode:
    | 'completed_with_results'
    | 'completed_without_results'
    | 'awaiting_authentication'
    | 'not_configured'
    | 'not_found'
    | 'unauthorized'
    | 'route_unavailable'
    | 'invalid_response'
    | 'request_failed';
  retryable: boolean | null;
  queryHash: string;
  evidence: Array<{
    fileId: string;
    filename: string;
    score: number;
    contentHash: string;
  }>;
  resultCount: number;
  durationMs: number;
  accessMethod?:
    | 'authenticated_account'
    | 'trusted_phone_guest'
    | 'trusted_phone_purchase'
    | 'trusted_phone_event_purchase'
    | null;
  coverage?: 'complete' | 'partial' | 'inconsistent' | null;
  eventDetailCount?: number;
  resource?: PurchaseResource;
};
