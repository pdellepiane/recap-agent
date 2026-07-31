import { z } from 'zod';

import type { UserEventLookupResult } from '../runtime/provider-gateway';
import { decisionNodeSchema } from './decision-nodes';

export const purchaseResourceValues = ['orders', 'gift_purchases'] as const;
export type PurchaseResource = (typeof purchaseResourceValues)[number];

export const purchaseAspectValues = [
  'summary',
  'payment_status',
  'payment_details',
  'shipping',
  'dedication',
  'thanks',
  'decline',
] as const;
export type PurchaseAspect = (typeof purchaseAspectValues)[number];

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
});

export const purchaseInformationRequestSchema = z.object({
  kind: z.literal('purchase'),
  resource: z.enum(purchaseResourceValues),
  query: z.string().min(1),
  orderId: z.string().nullable(),
  aspects: z.array(z.enum(purchaseAspectValues)).min(1),
  sensitiveFields: z.array(z.enum(sensitivePurchaseFieldValues)),
  authAction: z.enum(purchaseAuthActionValues),
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
});

export type InformationState = z.infer<typeof informationStateSchema>;

export const userAuthStatusValues = [
  'none',
  'code_requested',
  'authenticated',
  'email_not_found',
  'failed',
] as const;

export const userAuthStateSchema = z.object({
  status: z.enum(userAuthStatusValues),
  email: z.string().nullable(),
  token: z.string().nullable(),
  token_expires_at: z.string().nullable(),
  last_error: z.string().nullable(),
  requested_at: z.string().nullable(),
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

export type PurchaseInformation = {
  orderId: string;
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
    }
  | {
      requestId: string;
      kind: 'purchase';
      status: 'completed';
      resource: PurchaseResource;
      purchases: PurchaseInformation[];
      needsSelection: boolean;
    }
  | {
      requestId: string;
      kind: 'associated_event' | 'purchase';
      status: 'needs_input';
      nextInput: 'email' | 'otp' | 'order_selection';
      message: string;
    }
  | {
      requestId: string;
      kind: 'faq' | 'associated_event' | 'purchase';
      status: 'failed';
      retryable: boolean;
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
  resultCount: number;
  durationMs: number;
};
