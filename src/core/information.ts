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

/**
 * Typed disposition for a support statement that does not necessarily need
 * an information lookup. These values are deliberately bounded so support
 * continuity cannot become a second free-text memory store.
 */
export const informationSupportActKindValues = [
  'report_issue',
  'provide_detail',
  'defer_submission',
  'ask_policy',
] as const;
export type InformationSupportActKind =
  (typeof informationSupportActKindValues)[number];

export const informationSupportTopicValues = [
  'mailbox_capacity',
  'payment_proof',
  'purchase_status',
  'account_access',
  'unknown',
] as const;
export type InformationSupportTopic =
  (typeof informationSupportTopicValues)[number];

export const informationSupportDetailValues = [
  'mailbox_full',
  'submission_deferred',
  'submission_reported',
  'status_pending',
  'status_approved',
  'unknown',
] as const;
export type InformationSupportDetail =
  (typeof informationSupportDetailValues)[number];

export const informationSupportActSchema = z.object({
  kind: z.enum(informationSupportActKindValues),
  topic: z.enum(informationSupportTopicValues),
  detail: z.enum(informationSupportDetailValues),
  // User-supplied context for a support continuation. These are evidence
  // fields, not a second persisted memory store; they are retained only for
  // the current turn's deterministic acknowledgement.
  eventReference: z.string().trim().min(1).nullable().optional(),
  personReference: z.string().trim().min(1).nullable().optional(),
});

export type InformationSupportAct = z.infer<typeof informationSupportActSchema>;

export const informationNormalizationIssueReasonValues = [
  'missing_resource',
] as const;
export type InformationNormalizationIssueReason =
  (typeof informationNormalizationIssueReasonValues)[number];

export type InformationNormalizationIssue = {
  requestKind: 'purchase';
  field: 'resource';
  reason: InformationNormalizationIssueReason;
};

export const faqInformationRequestSchema = z.object({
  kind: z.literal('faq'),
  query: z.string().min(1),
  hostWithdrawal: z.enum(['policy_only', 'individual_status']).nullable().optional(),
  eventHint: z.string().nullable().optional(),
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

export const authRecoveryTerminalReasonValues = [
  'send_failed',
  'non_delivery_reported',
  'resend_requested',
  'email_change_requested',
  'auth_refused',
  'verification_failed',
  'legacy_terminated',
] as const;

export type AuthRecoveryTerminalReason = (typeof authRecoveryTerminalReasonValues)[number];

export const authRecoveryStateSchema = z.object({
  sendAttempted: z.boolean().default(false),
  verificationAttempted: z.boolean().default(false),
  terminalReason: z.enum(authRecoveryTerminalReasonValues).nullable().default(null),
  challengeEmail: z.string().nullable().default(null),
  challengeRequestedAt: z.string().nullable().default(null),
  preservedRequest: pendingInformationRequestSchema.nullable().default(null),
});

export type AuthRecoveryState = z.infer<typeof authRecoveryStateSchema>;

export function emptyAuthRecoveryState(): AuthRecoveryState {
  return {
    sendAttempted: false,
    verificationAttempted: false,
    terminalReason: null,
    challengeEmail: null,
    challengeRequestedAt: null,
    preservedRequest: null,
  };
}

/** Monotonic merge for core persistence: budget flags and terminal state are sticky. */
export function mergeAuthRecoveryState(
  current: AuthRecoveryState,
  incoming: AuthRecoveryState,
): AuthRecoveryState {
  return {
    sendAttempted: current.sendAttempted || incoming.sendAttempted,
    verificationAttempted: current.verificationAttempted || incoming.verificationAttempted,
    terminalReason: current.terminalReason ?? incoming.terminalReason,
    challengeEmail: current.challengeEmail ?? incoming.challengeEmail,
    challengeRequestedAt: current.challengeRequestedAt ?? incoming.challengeRequestedAt,
    preservedRequest: current.preservedRequest ?? incoming.preservedRequest,
  };
}

/**
 * One-time normalization of legacy user_auth evidence into recovery state.
 * Never clears an already terminal episode; caller merges monotonically.
 */
export function seedAuthRecoveryFromUserAuth(input: {
  status: string;
  email: string | null;
  requestedAt: string | null;
  failedCodeAttempts: number;
  otpSendAttempts: number;
  otpNonDeliveryReports: number;
}): AuthRecoveryState {
  const challenged = input.status === 'code_requested' ||
    input.otpSendAttempts > 0 ||
    (input.email !== null && input.requestedAt !== null && input.status !== 'none');
  const failed = input.status === 'failed' ||
    input.failedCodeAttempts > 0 ||
    input.otpNonDeliveryReports > 0;
  if (failed) {
    return {
      sendAttempted: true,
      verificationAttempted: input.failedCodeAttempts > 0,
      terminalReason: 'legacy_terminated',
      challengeEmail: input.email,
      challengeRequestedAt: input.requestedAt,
      preservedRequest: null,
    };
  }
  if (challenged) {
    return {
      sendAttempted: true,
      verificationAttempted: false,
      terminalReason: null,
      challengeEmail: input.email,
      challengeRequestedAt: input.requestedAt,
      preservedRequest: null,
    };
  }
  return emptyAuthRecoveryState();
}

export const userAuthStatusValues = [
  'none',
  'code_requested',
  'authenticated',
  'email_not_found',
  'failed',
] as const;

export const phoneConfirmationValues = ['yes', 'no', 'unclear'] as const;
export type PhoneConfirmation = (typeof phoneConfirmationValues)[number];

export const humanHelpIntentValues = ['none', 'request', 'accept_offer', 'retry', 'decline_offer'] as const;
export type HumanHelpIntent = (typeof humanHelpIntentValues)[number];

export const humanHelpIntentSchema = z.enum(humanHelpIntentValues);

export function isAbsentPhoneConfirmation(value: PhoneConfirmation | null | undefined): boolean {
  return value == null || value === 'unclear';
}

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
  /** Authoritative cart currency evidence; never mixed into order amounts. */
  currency?: string | null;
  /** Display metadata for the cart currency; never a code substitute. */
  currencySymbol?: string | null;
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
  /** Display metadata for the disclosed currency; never a code substitute. */
  currencySymbol: string | null;
  paymentMethod: string | null;
  presentation: 'explicit_currency' | 'recorded_method_no_currency';
};

export type PurchaseInformation = {
  orderId: string;
  /** Partition provenance is present for phone-scoped order candidates. */
  partition?: PurchasePartition;
  eventId?: number | string | null;
  currency?: string | null;
  /** Display metadata for the authoritative currency code. */
  currencySymbol?: string | null;
  /** True when currency_code conflicts with the legacy currency field. */
  currencyConflict?: boolean;
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
      hostWithdrawalPolicy?: { maxBusinessHours: number } | null;
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
