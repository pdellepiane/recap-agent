import type {
  CartInformation,
  InformationTaskResult,
  PurchaseAspect,
  PurchaseInformation,
} from '../core/information';
import { preserveServerTimestamp } from './purchase-reconciliation';

/**
 * S09 purchase reply projection for node `resolver_consultas_informativas`.
 *
 * Consumes S08 reconciliation outcomes (reconciled purchases, distinct carts,
 * coverage, selection state, reference resolution) and produces the minimal
 * model-visible factual reply input.
 *
 * Owned scope is the projector and outcome prompts only. Service and composer
 * integration stays with the integrator, so this module has no imports from
 * agent-service or openai-agent-runtime.
 */

export type PurchaseReplyCoverage = 'complete' | 'partial' | 'inconsistent';

export type PurchaseReplyReferenceResolution =
  | 'not_requested'
  | 'matched'
  | 'unavailable';

export type PurchaseReplyUserReported = {
  amount?: number | null;
  currency?: string | null;
  paidAt?: string | null;
};

export type PurchaseReplySelectionInput = {
  purchases: PurchaseInformation[];
  carts: CartInformation[];
  needsSelection: boolean;
  coverage: PurchaseReplyCoverage;
  referenceResolution: PurchaseReplyReferenceResolution;
  requestedAspects: PurchaseAspect[];
  referenceAuthorized: boolean;
  userReported: PurchaseReplyUserReported;
};

export type CartReplyView = {
  recordType: 'cart';
  status: string;
  eventName: string | null;
  eventDate: string | null;
  createdAt: string | null;
  /**
   * C1 cart/order separation. A cart carries no payment state of its own:
   * these explicit nulls keep the pending-order payment status and amount
   * on the order record so the reply never attributes them to the cart.
   */
  paymentStatus: null;
  amount: null;
};

export type AmountMismatchView = {
  reported: number;
  recorded: number;
};

export type OrderReplyView = {
  recordType: 'order';
  paymentStatus: string | null;
  amount: {
    total: number | null;
    paid: number | null;
    /**
     * C1 order-total vs remaining-balance distinction. No verified
     * balance-due field exists in the record, so the remaining balance is
     * always unverifiable here: `total` is the order total, never the
     * amount owed, and differences must never be computed from it.
     */
    remaining: null;
    remainingVerifiable: false;
    currency: string | null;
    currencySymbol: string | null;
    method: string | null;
  } | null;
  amountMismatch: AmountMismatchView | null;
  eventName: string | null;
  eventDate: string | null;
  createdAt: string | null;
  /**
   * R6 labeled payment time. The raw server string is preserved verbatim
   * (never converted, never relabeled as event/creation time). Null when
   * the record carries no payment timestamp.
   */
  paymentAt: string | null;
  /**
   * R6 timezone provenance. Record timestamps carry no verified timezone,
   * so the reply must never claim a local zone or convert the stored hour.
   */
  eventTimezone: 'unknown' | null;
  paymentTimezone: 'unknown' | null;
  /**
   * R6 typed validation policy. Present only when a pending-validation or
   * balance question requested it and the record carries the sourced
   * expectation, so policy and method metadata travel together in one view.
   */
  validationWindow: { maxBusinessHours: 72 } | null;
  transactionReference: string | null;
  currency: string | null;
  currencySymbol: string | null;
  userReported: {
    amount: number | null;
    currency: string | null;
    paidAt: string | null;
  };
};

export type OrderCandidateView = {
  candidateIndex: number;
  eventName: string | null;
  eventDate: string | null;
  paymentStatus: string | null;
  amount: number | null;
  /**
   * R6 currency provenance. Null means unknown/withheld: the reply must
   * never attach a symbol or code (no S/ from locale or receipt guesses).
   */
  currency: string | null;
  currencyAvailability: 'available' | 'unknown';
  /** Disclosed recorded method, or null when the record withholds it. */
  method: string | null;
  /**
   * R6 selection repair never exposes transaction/internal IDs. Candidates
   * are distinguished by event, date, amount, currency availability and
   * status only, so this is always null.
   */
  transactionReference: null;
};

export type PurchaseReplyOutcome =
  | { kind: 'cart_only'; cart: CartReplyView }
  | { kind: 'order_unique'; order: OrderReplyView }
  | { kind: 'order_plus_cart'; order: OrderReplyView; cart: CartReplyView }
  | { kind: 'selection'; candidates: OrderCandidateView[] }
  | { kind: 'conflict' }
  | { kind: 'empty' };

function trustedText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim().length > 0 ? value : null;
}

function trustedAmount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * F3 canonical disclosure readers. The orchestrator projection nulls
 * grandTotal, paymentMethod and currency on the outward record and moves the
 * trusted values into amountDisclosure, so gates must prefer the disclosure
 * before falling back to the direct fields (live Luis/Claudia records).
 */
export function disclosedPurchaseTotal(
  purchase: PurchaseInformation,
): number | null {
  return trustedAmount(purchase.grandTotal) ??
    trustedAmount(purchase.amountDisclosure?.total ?? null);
}

export function disclosedPurchaseMethod(
  purchase: PurchaseInformation,
): string | null {
  return trustedText(purchase.paymentMethod ?? purchase.payment?.method ?? null) ??
    trustedText(purchase.amountDisclosure?.paymentMethod ?? null);
}

/**
 * C1 currency provenance readers. The orchestrator projection nulls the
 * outward `currency`/`currencySymbol` and moves the trusted values into
 * `amountDisclosure`, so reply gates must prefer the disclosure before
 * falling back to the direct fields (live PEN/S/ records). Display metadata
 * never stands in for a withheld currency claim.
 */
export function disclosedPurchaseCurrency(
  purchase: PurchaseInformation,
): string | null {
  return trustedText(purchase.currency) ??
    trustedText(purchase.amountDisclosure?.currency ?? null);
}

export function disclosedPurchaseCurrencySymbol(
  purchase: PurchaseInformation,
): string | null {
  const currency = disclosedPurchaseCurrency(purchase);
  if (currency === null) return null;
  return trustedText(purchase.currencySymbol) ??
    trustedText(purchase.amountDisclosure?.currencySymbol ?? null);
}

function toCartView(cart: CartInformation): CartReplyView {
  // A cart is its own record type. Order amounts and statuses can never
  // attach to it, and its own subtotal is checkout evidence, not a reply fact.
  return {
    recordType: 'cart',
    status: cart.status,
    eventName: trustedText(cart.eventName),
    eventDate: preserveServerTimestamp(cart.eventDate ?? null),
    createdAt: preserveServerTimestamp(cart.createdAt ?? null),
    paymentStatus: null,
    amount: null,
  };
}

function toOrderView(
  purchase: PurchaseInformation,
  requestedAspects: PurchaseAspect[],
  referenceAuthorized: boolean,
  userReported: PurchaseReplyUserReported,
): OrderReplyView {
  const requested = new Set(requestedAspects);
  const wantsStatus = requested.has('summary') ||
    requested.has('payment_status') ||
    requested.has('decline');
  const wantsAmount = requested.has('summary') ||
    requested.has('validation_window') ||
    requested.has('payment_status');
  // payment_details is the payment-time question: its time evidence is
  // paymentAt below, never the amount block. Projecting a total/currency
  // the question never asked for invites unrelated balance/currency
  // caveats on time-only answers.
  // Payment method reaches the reply only when explicitly requested. An
  // approved summary never needs the method type.
  const wantsMethod = requested.has('payment_details') ||
    requested.has('validation_window');
  const total = disclosedPurchaseTotal(purchase);
  const paid = trustedAmount(purchase.payment?.amount);
  const currency = disclosedPurchaseCurrency(purchase);
  const currencySymbol = disclosedPurchaseCurrencySymbol(purchase);
  // R6: the authorized requested method comes from the disclosure reader,
  // which prefers the trusted disclosure over fields the projection nulled.
  // Approved-status-only minimality is preserved via wantsMethod below.
  const method = disclosedPurchaseMethod(purchase);
  const paymentAt = requested.has('payment_details')
    ? preserveServerTimestamp(purchase.payment?.paidAt ?? null)
    : null;
  const eventDate = preserveServerTimestamp(purchase.eventDate);
  const wantsValidationWindow = requested.has('validation_window');
  const reportedAmount = typeof userReported.amount === 'number' &&
      Number.isFinite(userReported.amount)
    ? userReported.amount
    : null;
  const mismatch = reportedAmount !== null && total !== null && Math.abs(reportedAmount - total) >= 0.005
    ? { reported: reportedAmount, recorded: total }
    : null;
  const reference = referenceAuthorized
    ? trustedText(purchase.customerTransactionNumber)
    : null;
  return {
    recordType: 'order',
    paymentStatus: wantsStatus ? purchase.paymentStatus : null,
    amount: wantsAmount
      ? {
        // Reported amounts stay user-reported. Only trusted totals enter here.
        // `remaining` is never computed: no verified balance-due field exists.
        total,
        paid,
        remaining: null,
        remainingVerifiable: false as const,
        currency,
        // Display metadata never stands in for a withheld currency claim.
        currencySymbol,
        method: wantsMethod ? method : null,
      }
      : null,
    amountMismatch: mismatch,
    // Event associations exist only when the trusted record supplies them.
    eventName: trustedText(purchase.eventName),
    eventDate,
    createdAt: preserveServerTimestamp(purchase.createdAt),
    paymentAt,
    eventTimezone: eventDate !== null ? 'unknown' as const : null,
    paymentTimezone: paymentAt !== null ? 'unknown' as const : null,
    validationWindow: wantsValidationWindow && purchase.paymentValidationExpectation !== undefined &&
        purchase.paymentValidationExpectation !== null
      ? { maxBusinessHours: 72 as const }
      : null,
    transactionReference: reference,
    currency,
    currencySymbol,
    userReported: {
      amount: reportedAmount,
      currency: typeof userReported.currency === 'string' && userReported.currency.trim().length > 0
        ? userReported.currency
        : null,
      paidAt: typeof userReported.paidAt === 'string' && userReported.paidAt.trim().length > 0
        ? userReported.paidAt
        : null,
    },
  };
}

function toCandidateView(
  purchase: PurchaseInformation,
  candidateIndex: number,
): OrderCandidateView {
  const currency = disclosedPurchaseCurrency(purchase);
  return {
    candidateIndex,
    eventName: trustedText(purchase.eventName),
    eventDate: preserveServerTimestamp(purchase.eventDate),
    paymentStatus: purchase.paymentStatus,
    amount: disclosedPurchaseTotal(purchase),
    currency,
    currencyAvailability: currency !== null ? 'available' : 'unknown',
    method: disclosedPurchaseMethod(purchase),
    // Transaction/internal IDs never repair a selection question.
    transactionReference: null,
  };
}

function sameEvent(a: CartInformation, b: PurchaseInformation): boolean {
  if (a.eventId !== null && a.eventId !== undefined && b.eventId !== null && b.eventId !== undefined) {
    if (a.eventId === b.eventId) return true;
  }
  const cartName = trustedText(a.eventName)?.toLocaleLowerCase('es') ?? null;
  const orderName = trustedText(b.eventName)?.toLocaleLowerCase('es') ?? null;
  return cartName !== null && orderName !== null && cartName === orderName;
}

export function selectPurchaseReplyOutcome(
  input: PurchaseReplySelectionInput,
): PurchaseReplyOutcome {
  if (input.coverage === 'inconsistent') return { kind: 'conflict' };
  if (input.purchases.length === 0 && input.carts.length === 0) return { kind: 'empty' };
  if (input.purchases.length === 0) {
    const cart = input.carts[0];
    if (!cart) return { kind: 'empty' };
    return { kind: 'cart_only', cart: toCartView(cart) };
  }
  if (input.needsSelection || input.purchases.length > 1) {
    return {
      kind: 'selection',
      candidates: input.purchases.map((purchase, index) =>
        toCandidateView(purchase, index)
      ),
    };
  }
  const single = input.purchases[0];
  if (!single) return { kind: 'empty' };
  // A unique trusted record is stated directly. An unavailable
  // customer-reference lookup must not create false uncertainty.
  const order = toOrderView(single, input.requestedAspects, input.referenceAuthorized, input.userReported);
  const sameEventCart = input.carts.find((cart) => sameEvent(cart, single));
  if (sameEventCart) {
    return { kind: 'order_plus_cart', order, cart: toCartView(sameEventCart) };
  }
  return { kind: 'order_unique', order };
}

function toModelOrder(order: OrderReplyView): Record<string, unknown> {
  const view: Record<string, unknown> = { ...order };
  // R7 grounding: absent currency is projected as explicit unknown negative
  // evidence (currencyAvailability + currency_unknown caveat) so the model
  // stops filling S/ from locale guesses. The 72h validation window note is
  // untouched. Empty user-reported slots stay omitted.
  if (view.currency === null) {
    delete view.currency;
    view.currencyAvailability = 'unknown';
    // Unknown-currency negative evidence is projected only when an amount
    // is actually disclosed: a time-only answer carries no amount, so an
    // unsolicited currency caveat must not be invited.
    if (view.amount !== null) {
      view.currency_unknown = true;
    }
  } else {
    view.currencyAvailability = 'available';
  }
  if (view.currencySymbol === null) delete view.currencySymbol;
  if (view.paymentAt === null) delete view.paymentAt;
  if (view.eventTimezone === null) delete view.eventTimezone;
  if (view.paymentTimezone === null) delete view.paymentTimezone;
  if (view.validationWindow === null) delete view.validationWindow;
  const amount = { ...(order.amount ?? {}) } as Record<string, unknown>;
  for (const key of ['currency', 'currencySymbol', 'method', 'paid'] as const) {
    if (amount[key] === null) delete amount[key];
  }
  view.amount = amount;
  const reported = { ...order.userReported };
  if (reported.amount === null) delete (reported as Record<string, unknown>).amount;
  if (reported.currency === null) delete (reported as Record<string, unknown>).currency;
  if (reported.paidAt === null) delete (reported as Record<string, unknown>).paidAt;
  view.userReported = reported;
  return view;
}

export function projectPurchaseReplyForModel(
  outcome: PurchaseReplyOutcome,
): Record<string, unknown> {
  // Internal identifiers, bank routing, vouchers and gateway data never
  // enter model input, even when the trusted record carries them.
  switch (outcome.kind) {
    case 'cart_only':
      return { recordType: 'cart', cart: outcome.cart };
    case 'order_unique':
      return { recordType: 'order', order: toModelOrder(outcome.order) };
    case 'order_plus_cart':
      return { recordType: 'order_plus_cart', order: toModelOrder(outcome.order), cart: outcome.cart };
    case 'selection':
      return { recordType: 'selection', candidates: outcome.candidates };
    case 'conflict':
      return { recordType: 'conflict' };
    case 'empty':
      return { recordType: 'empty' };
  }
}

export type PurchaseReplyEvidenceContext = {
  requestedAspects: PurchaseAspect[];
  referenceAuthorized?: boolean;
  userReported?: PurchaseReplyUserReported;
  permittedNextAction?: string | null;
  missingInputs?: string[];
  ambiguousInputs?: string[];
};

function defaultPurchaseNextAction(outcome: PurchaseReplyOutcome): string {
  switch (outcome.kind) {
    case 'selection':
      return 'select_purchase';
    case 'cart_only':
    case 'order_plus_cart':
      return 'complete_checkout';
    case 'conflict':
      return 'human_support';
    case 'order_unique':
      return outcome.order.paymentStatus?.trim().toLocaleLowerCase('en') === 'pending'
        ? 'await_validation'
        : 'none';
    case 'empty':
      // No records is a factual answer, not a blocked route: a visible
      // receipt alone never proves backend approval and never implies team
      // support on its own, so no next action is permitted here. Genuinely
      // unavailable routes still offer their step through guidance or
      // capability outcomes, never through this default.
      return 'none';
  }
}

/**
 * Projects a completed purchase read as typed grounding for the reply model.
 * It deliberately contains no answer text: status, amounts, disclosure
 * permissions, reference resolution and next-action codes remain facts.
 */
export function projectCompletedPurchaseForModel(
  result: Extract<InformationTaskResult, { kind: 'purchase'; status: 'completed' }>,
  context: PurchaseReplyEvidenceContext,
): Record<string, unknown> {
  const purchases = result.purchases.slice(0, 3);
  const outcome = selectPurchaseReplyOutcome({
    purchases,
    carts: result.carts ?? [],
    needsSelection: result.needsSelection,
    coverage: result.coverage ?? 'complete',
    referenceResolution: result.referenceResolution ?? 'not_requested',
    requestedAspects: context.requestedAspects,
    referenceAuthorized: context.referenceAuthorized ?? false,
    userReported: context.userReported ?? {},
  });
  const deniedDisclosures = [
    'internal_identifiers',
    'unrequested_fields',
    ...(context.referenceAuthorized ? [] : ['transaction_reference']),
  ];
  // R6 question-relevant next action. A cart on the outcome never drags a
  // payment/voucher discussion back to checkout: without an explicit
  // checkout (payment_options) question the action follows the order
  // (await_validation while pending, none otherwise), never
  // pay-the-pending-order-again. An explicit checkout request keeps the
  // cart next action. An explicit caller override always wins.
  const wantsCheckout = context.requestedAspects.includes('payment_options');
  let permittedNextAction = context.permittedNextAction ??
    defaultPurchaseNextAction(outcome);
  if (context.permittedNextAction === undefined || context.permittedNextAction === null) {
    if (outcome.kind === 'order_plus_cart' && !wantsCheckout) {
      permittedNextAction = outcome.order.paymentStatus?.trim().toLocaleLowerCase('en') === 'pending'
        ? 'await_validation'
        : 'none';
    }
  }
  return {
    requestId: result.requestId,
    kind: result.kind,
    status: result.status,
    resource: result.resource,
    access_method: result.accessMethod ?? null,
    coverage: result.coverage ?? 'complete',
    outcome_kind: outcome.kind,
    outcome: projectPurchaseReplyForModel(outcome),
    reference_status: {
      requested: result.requestedCustomerTransactionNumber != null,
      resolution: result.referenceResolution ?? 'not_requested',
      authorized: context.referenceAuthorized ?? false,
      candidate_count: purchases.length,
    },
    disclosures: {
      permitted_aspects: [...context.requestedAspects],
      denied: deniedDisclosures,
    },
    permitted_next_action: permittedNextAction,
    missing_inputs: Array.from(new Set([
      ...(context.missingInputs ?? []),
      ...(outcome.kind === 'selection' ? ['purchase_selection'] : []),
    ])),
    ambiguous_inputs: [...(context.ambiguousInputs ?? [])],
  };
}
