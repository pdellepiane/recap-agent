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
 * model-visible reply input plus deterministic Spanish renderers.
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
    currency: string | null;
    currencySymbol: string | null;
    method: string | null;
  } | null;
  amountMismatch: AmountMismatchView | null;
  eventName: string | null;
  eventDate: string | null;
  createdAt: string | null;
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
  transactionReference: string | null;
};

export type PurchaseReplyOutcome =
  | { kind: 'cart_only'; cart: CartReplyView }
  | { kind: 'order_unique'; order: OrderReplyView }
  | { kind: 'order_plus_cart'; order: OrderReplyView; cart: CartReplyView }
  | { kind: 'selection'; candidates: OrderCandidateView[] }
  | { kind: 'conflict' }
  | { kind: 'empty' };

export type PurchaseNarrativeClaims = {
  claimsSettledTotal: boolean;
  settledFromUserReport: boolean;
  claimsSuccess: boolean;
  receiptPresent: boolean;
};

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

function toCartView(cart: CartInformation): CartReplyView {
  // A cart is its own record type. Order amounts and statuses can never
  // attach to it, and its own subtotal is checkout evidence, not a reply fact.
  return {
    recordType: 'cart',
    status: cart.status,
    eventName: trustedText(cart.eventName),
    eventDate: preserveServerTimestamp(cart.eventDate ?? null),
    createdAt: preserveServerTimestamp(cart.createdAt ?? null),
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
    requested.has('payment_details') ||
    requested.has('validation_window') ||
    requested.has('payment_status');
  // Payment method reaches the reply only when explicitly requested. An
  // approved summary never needs the method type.
  const wantsMethod = requested.has('payment_details') ||
    requested.has('validation_window');
  const total = trustedAmount(purchase.grandTotal);
  const paid = trustedAmount(purchase.payment?.amount);
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
        total,
        paid,
        currency: purchase.currency ?? null,
        // Display metadata never stands in for a withheld currency claim.
        currencySymbol: purchase.currency ? purchase.currencySymbol ?? null : null,
        method: wantsMethod ? purchase.paymentMethod ?? purchase.payment?.method ?? null : null,
      }
      : null,
    amountMismatch: mismatch,
    // Event associations exist only when the trusted record supplies them.
    eventName: trustedText(purchase.eventName),
    eventDate: preserveServerTimestamp(purchase.eventDate),
    createdAt: preserveServerTimestamp(purchase.createdAt),
    transactionReference: reference,
    currency: purchase.currency ?? null,
    currencySymbol: purchase.currency ? purchase.currencySymbol ?? null : null,
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
  referenceAuthorized: boolean,
): OrderCandidateView {
  return {
    candidateIndex,
    eventName: trustedText(purchase.eventName),
    eventDate: preserveServerTimestamp(purchase.eventDate),
    paymentStatus: purchase.paymentStatus,
    amount: trustedAmount(purchase.grandTotal),
    transactionReference: referenceAuthorized
      ? trustedText(purchase.customerTransactionNumber)
      : null,
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
        toCandidateView(purchase, index, input.referenceAuthorized)
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
  // Absent currency is omitted, never projected as a caveat. Empty
  // user-reported slots are omitted as well.
  if (view.currency === null) delete view.currency;
  if (view.currencySymbol === null) delete view.currencySymbol;
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

function describeOrder(order: OrderReplyView): string {
  const event = order.eventName ?? 'tu evento';
  if (order.paymentStatus?.trim().toLocaleLowerCase('en') === 'approved') {
    return `Tu regalo para ${event} ya quedo aprobado.`;
  }
  if (order.paymentStatus?.trim().toLocaleLowerCase('en') === 'declined') {
    return `Tu regalo para ${event} aparece como rechazado. Puedo comunicarte con una persona del equipo para revisarlo.`;
  }
  const amount = order.amount?.total !== null && order.amount?.total !== undefined
    ? ` de ${order.amount.total}`
    : '';
  const mismatch = order.amountMismatch !== null
    ? ' Tomo el monto que me indicas como un dato reportado por ti; el registro conserva su propio total y no lo reemplazo.'
    : '';
  const reported = order.userReported.currency !== null || order.userReported.paidAt !== null
    ? ' Los datos de moneda y hora que me compartes quedan como tu reporte; no puedo confirmarlos con el registro disponible.'
    : '';
  return `Tu regalo${amount} para ${event} sigue pendiente de validacion.${mismatch}${reported}`;
}

export function renderPurchaseReplyDeterministic(outcome: PurchaseReplyOutcome): string {
  switch (outcome.kind) {
    case 'cart_only':
      return `Tienes un carrito activo para ${outcome.cart.eventName ?? 'tu evento'}. Todavia no es un pedido: te falta completar el pago.`;
    case 'order_unique':
      return describeOrder(outcome.order);
    case 'order_plus_cart':
      return `${describeOrder(outcome.order)} Ademas tienes un carrito activo para ${outcome.cart.eventName ?? 'el mismo evento'}, que es un registro distinto y todavia no es un pedido.`;
    case 'selection': {
      const options = outcome.candidates.map((candidate) => {
        const event = candidate.eventName ?? 'un evento sin nombre registrado';
        const status = candidate.paymentStatus ?? 'sin estado registrado';
        return `opcion ${candidate.candidateIndex + 1}: ${event} (${status})`;
      }).join('; ');
      return `Encontre varios registros asociados a este numero: ${options}. Dime a cual te refieres.`;
    }
    case 'conflict':
      return 'Encontre informacion contradictoria entre registros del mismo pedido y no puedo confirmar su estado ahora. Puedo comunicarte con una persona del equipo para revisarlo.';
    case 'empty':
      return 'No encontre compras asociadas a este numero en la consulta realizada. Puedo comunicarte con una persona del equipo para revisarlo.';
  }
}

export function checkPurchaseNarrativeClaims(
  outcome: PurchaseReplyOutcome,
  claims: PurchaseNarrativeClaims,
): 'ok' | 'fallback' {
  void outcome;
  // Structured claim contract for bounded narrative composition: a settled
  // total claimed from a user report, or any success claim without a
  // matching receipt, is invalid. Invalid output uses the deterministic
  // renderer; there is no corrective model call.
  if (claims.settledFromUserReport && claims.claimsSettledTotal) return 'fallback';
  if (claims.claimsSuccess && !claims.receiptPresent) return 'fallback';
  return 'ok';
}

export function resolvePurchaseReplyText(
  outcome: PurchaseReplyOutcome,
  narrative: string | null,
  claims: PurchaseNarrativeClaims,
): string {
  if (narrative !== null && checkPurchaseNarrativeClaims(outcome, claims) === 'ok') {
    return narrative;
  }
  return renderPurchaseReplyDeterministic(outcome);
}

/**
 * F3b deterministic truthfulness gates. Each predicate uses only typed
 * reconciliation evidence (counts, canonical status, reference resolution,
 * trusted method/currency, requested aspects). Renderers use only trusted
 * record fields with server-local timestamps and never surface customer
 * transaction references, gateway data, or user-reported values as facts.
 */

export function shouldRenderConciseApprovedStatus(args: {
  purchaseCount: number;
  paymentStatus: string | null;
  referenceResolution: string | null;
}): boolean {
  return args.purchaseCount === 1 &&
    (args.paymentStatus?.trim().toLocaleLowerCase('en') ?? '') === 'approved' &&
    args.referenceResolution === 'unavailable';
}

export function renderConciseApprovedStatus(eventName: string | null): string {
  const event = eventName?.trim() ? eventName.trim() : 'tu evento';
  return `Tu regalo para ${event} ya quedó aprobado.`;
}

export function shouldRenderNeutralSelection(args: {
  purchaseCount: number;
  hasAssociatedGuestEvent: boolean;
}): boolean {
  return args.purchaseCount > 1 && !args.hasAssociatedGuestEvent;
}

/**
 * E reference-matched determinism. When the requested customer reference
 * matches exactly one record, the reply is stated from that record alone so
 * the model cannot attribute the reference to another order. No reference
 * echo, selection question, email/OTP request, or backend identifier.
 */
export function shouldRenderReferenceMatchedSingle(args: {
  purchaseCount: number;
  referenceResolution: string | null;
}): boolean {
  return args.purchaseCount === 1 && args.referenceResolution === 'matched';
}

export function renderReferenceMatchedSingle(args: {
  eventName: string | null;
  paymentStatus: string | null;
}): string {
  const event = args.eventName?.trim() ? args.eventName.trim() : 'tu evento';
  const status = (args.paymentStatus ?? '').trim().toLocaleLowerCase('en');
  if (status === 'approved') return `Tu regalo para ${event} ya quedó aprobado.`;
  if (status === 'declined') {
    return `Tu regalo para ${event} aparece como rechazado. Puedo comunicarte con una persona del equipo para revisarlo.`;
  }
  return `Tu regalo para ${event} figura con pago pendiente.`;
}

/**
 * E reference-unavailable determinism. When the requested reference matches
 * no record but several candidates exist, ask exactly one grounded selection
 * question naming each candidate by its public event label. Never claim a
 * match, select automatically, request email/OTP, or reveal backend ids.
 */
export function shouldRenderReferenceSelection(args: {
  purchaseCount: number;
  referenceResolution: string | null;
}): boolean {
  return args.purchaseCount > 1 && args.referenceResolution === 'unavailable';
}

export function renderReferenceSelection(
  purchases: Array<{ eventName: string | null; paymentStatus: string | null }>,
): string {
  const options = purchases.map((purchase, index) => {
    const event = purchase.eventName?.trim()
      ? purchase.eventName.trim()
      : 'un evento sin nombre registrado';
    return `opción ${index + 1}: ${event} (${describeSelectionStatus(purchase.paymentStatus)})`;
  }).join('; ');
  return `Encontré ${purchases.length} registros asociados a este número y la referencia no corresponde a ninguno: ${options}. ¿A cuál te refieres?`;
}
function describeSelectionStatus(status: string | null): string {
  const normalized = status?.trim().toLocaleLowerCase('en') ?? '';
  if (normalized === 'pending') return 'pendiente';
  if (normalized === 'approved') return 'aprobado';
  if (normalized === 'declined') return 'rechazado';
  const trimmed = status?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : 'sin estado registrado';
}

export function renderNeutralPurchaseSelection(
  purchases: PurchaseInformation[],
): string {
  const options = purchases.map((purchase, index) => {
    const total = trustedAmount(purchase.grandTotal);
    const method = trustedText(purchase.paymentMethod ?? purchase.payment?.method ?? null);
    const when = preserveServerTimestamp(purchase.eventDate) ??
      preserveServerTimestamp(purchase.createdAt) ??
      'fecha no registrada';
    const amount = total !== null ? `monto ${total}` : 'monto no registrado';
    const via = method ? ` mediante ${method}` : '';
    return `opción ${index + 1}: ${amount}${via}, fecha ${when}, estado ${describeSelectionStatus(purchase.paymentStatus)}`;
  }).join('; ');
  return `Encontré ${purchases.length} registros asociados a este número: ${options}. ¿A cuál te refieres?`;
}

const TRANSFER_METHOD_TOKENS = ['transfer', 'transferencia'];

export function shouldRenderConciseTransferValidation(args: {
  purchaseCount: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  requestedAspects: PurchaseAspect[];
}): boolean {
  if (args.purchaseCount !== 1) return false;
  if ((args.paymentStatus?.trim().toLocaleLowerCase('en') ?? '') !== 'pending') return false;
  const method = (args.paymentMethod ?? '').toLocaleLowerCase('en');
  if (!TRANSFER_METHOD_TOKENS.some((token) => method.includes(token))) return false;
  if (args.currency !== null && args.currency.trim().length > 0) return false;
  const aspects = new Set(args.requestedAspects);
  if (!aspects.has('validation_window')) return false;
  if (aspects.has('payment_details')) return false;
  return true;
}

export function renderConciseTransferValidation(eventName: string | null): string {
  const event = eventName?.trim() ? eventName.trim() : 'tu evento';
  return `Tu regalo para ${event} sigue pendiente de validación por transferencia. La validación puede tardar hasta 72 horas hábiles.`;
}

const WINDOW_METHOD_PATTERN = /transfer|yape|plin/iu;

function isWindowMethod(method: string | null): boolean {
  return method === null || WINDOW_METHOD_PATTERN.test(method);
}

function formatPaymentMethod(method: string | null): string | null {
  const trimmed = method?.trim() ?? '';
  if (trimmed.length === 0) return null;
  return trimmed.replace(/_+/gu, ' ');
}

/**
 * F3 order-plus-cart checkout gate. A single pending order next to an active
 * cart is the Alex/Luis checkout-continuation shape: the reply must keep both
 * records distinct, report the trusted total with method and no currency
 * symbol, state that no balance can be confirmed, and give the checkout next
 * step. Voucher reports (reportedAmount) stay on the model path.
 */
export function shouldRenderOrderPlusCartCheckout(args: {
  purchaseCount: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
  cartCount: number;
  needsSelection: boolean;
  reportedAmount: number | null;
}): boolean {
  if (args.purchaseCount !== 1) return false;
  if (args.cartCount < 1) return false;
  if (args.needsSelection) return false;
  if (args.reportedAmount !== null) return false;
  return (args.paymentStatus?.trim().toLocaleLowerCase('en') ?? '') === 'pending';
}

export function renderOrderPlusCartCheckout(args: {
  eventName: string | null;
  total: number | null;
  paymentMethod: string | null;
}): string {
  const event = args.eventName?.trim() ? args.eventName.trim() : 'tu evento';
  const method = formatPaymentMethod(args.paymentMethod);
  const totalClause = args.total !== null ? ` por ${args.total}` : '';
  const methodClause = method !== null ? ` mediante ${method}` : '';
  const windowClause = isWindowMethod(method)
    ? ' La validación puede tardar hasta 72 horas hábiles.'
    : '';
  return `El pedido de ${event}${totalClause}${methodClause} sigue pendiente de validación; no puedo confirmar el saldo restante con el registro disponible. Además tienes un carrito activo para ${event}, que es un registro distinto y todavía no es un pedido: para completar el pago, continúa el checkout del carrito.${windowClause}`;
}

/**
 * F3 transfer validation on status-only queries. The indexed 72h window must
 * reach the reply even when the extractor did not ask validation_window
 * explicitly. payment_details keeps the model path so amount disclosure is
 * preserved.
 */
export function shouldRenderTransferValidationForStatusQuery(args: {
  purchaseCount: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  requestedAspects: PurchaseAspect[];
  reportedAmount: number | null;
}): boolean {
  if (args.purchaseCount !== 1) return false;
  if ((args.paymentStatus?.trim().toLocaleLowerCase('en') ?? '') !== 'pending') return false;
  const method = (args.paymentMethod ?? '').toLocaleLowerCase('en');
  if (!method.includes('transfer')) return false;
  if (args.currency !== null && args.currency.trim().length > 0) return false;
  if (args.reportedAmount !== null) return false;
  const aspects = new Set(args.requestedAspects);
  if (aspects.has('payment_details')) return false;
  if (aspects.has('dedication') || aspects.has('thanks')) return false;
  return true;
}

/**
 * F3 correction grounding on continued purchase threads. When a pending
 * record without currency is revisited (currency/time corrections, constancia
 * questions), the reply states record facts: currency and timezone are absent,
 * so user-shared values stay user-reported and exact datetime is unconfirmed.
 */
export function shouldRenderPendingCorrectionGrounding(args: {
  purchaseCount: number;
  paymentStatus: string | null;
  currency: string | null;
  isContinuedThread: boolean;
  reportedAmount: number | null;
}): boolean {
  if (!args.isContinuedThread) return false;
  if (args.purchaseCount !== 1) return false;
  if (args.reportedAmount !== null) return false;
  if ((args.paymentStatus?.trim().toLocaleLowerCase('en') ?? '') !== 'pending') return false;
  return args.currency === null || args.currency.trim().length === 0;
}

export function renderPendingCorrectionGrounding(eventName: string | null): string {
  const event = eventName?.trim() ? eventName.trim() : 'tu evento';
  return `Tu pago para ${event} sigue pendiente y en verificación. Tomo los datos de moneda y fecha que me compartes solo como tu reporte: el registro no consigna moneda ni zona horaria, así que no puedo confirmar la moneda ni una fecha u hora exacta.`;
}

/**
 * F3c voucher continuity reply for a single pending order. The reported
 * amount stays user-reported, receipt from an image is never confirmed, the
 * order remains pending, and the indexed validation window is repeated.
 */
export function renderVoucherContinuityReply(args: {
  reportedAmount: number | null;
  eventName: string | null;
}): string {
  const report = args.reportedAmount !== null
    ? `Tomo nota de que indicas haber enviado ${args.reportedAmount}.`
    : 'Tomo nota de que indicas haber enviado el comprobante.';
  const event = args.eventName?.trim()
    ? `El pedido de ${args.eventName.trim()} sigue pendiente de validación.`
    : 'El pedido consultado sigue pendiente de validación.';
  return `${report} ${event} Un comprobante en imagen no permite confirmar la recepción. La validación puede tardar hasta 72 horas hábiles.`;
}

/**
 * F4 reported-amount pending order with a same-event cart. When the user
 * reports an amount for the current pending transfer order (initial status
 * query or shortfall-payment report), the reply must name the pending order
 * explicitly, keep the trusted registry total distinct from the user report,
 * and never compute a balance or surface the historical declined record.
 * The first answer states the pending order without a validation window;
 * a continued thread repeats the transfer window in the same sentence as
 * the registered method. No approval is ever claimed while pending.
 */
export function shouldRenderReportedPendingOrder(args: {
  purchaseCount: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  cartCount: number;
  needsSelection: boolean;
  reportedAmount: number | null;
}): boolean {
  if (args.purchaseCount !== 1) return false;
  if (args.needsSelection) return false;
  if (args.cartCount < 1) return false;
  if (args.reportedAmount === null) return false;
  if ((args.paymentStatus?.trim().toLocaleLowerCase('en') ?? '') !== 'pending') return false;
  const method = (args.paymentMethod ?? '').toLocaleLowerCase('en');
  if (!TRANSFER_METHOD_TOKENS.some((token) => method.includes(token))) return false;
  if (args.currency !== null && args.currency.trim().length > 0) return false;
  return true;
}

export function renderReportedPendingInitial(args: {
  eventName: string | null;
  total: number | null;
  paymentMethod: string | null;
  reportedAmount: number | null;
}): string {
  const event = args.eventName?.trim() ? args.eventName.trim() : 'tu evento';
  const totalClause = args.total !== null ? ` por ${args.total}` : '';
  const method = formatPaymentMethod(args.paymentMethod);
  const methodClause = method !== null ? ` mediante ${method}` : '';
  return `El pedido de ${event}${totalClause}${methodClause} sigue pendiente. Tomo el monto que me indicas como tu reporte; el registro conserva su propio total.`;
}

export function renderReportedShortfallPending(args: {
  eventName: string | null;
  paymentMethod: string | null;
  reportedAmount: number | null;
}): string {
  const event = args.eventName?.trim() ? args.eventName.trim() : 'tu evento';
  const method = formatPaymentMethod(args.paymentMethod);
  const report = args.reportedAmount !== null
    ? `Tomo nota de que indicas haber enviado ${args.reportedAmount}. `
    : 'Tomo nota de tu reporte. ';
  const methodClause = method !== null ? ` por ${method}` : '';
  return `${report}El pedido de ${event} sigue pendiente de validación${methodClause}; la validación puede tardar hasta 72 horas hábiles.`;
}

function describeCapabilitySelectionOptions(
  purchases: PurchaseInformation[],
): string {
  return purchases.map((purchase, index) => {
    const total = trustedAmount(purchase.grandTotal);
    const method = trustedText(purchase.paymentMethod ?? purchase.payment?.method ?? null);
    const when = preserveServerTimestamp(purchase.eventDate) ??
      preserveServerTimestamp(purchase.createdAt) ??
      'fecha no registrada';
    const amount = total !== null ? `monto ${total}` : 'monto no registrado';
    const via = method ? ` mediante ${method}` : '';
    return `opción ${index + 1}: ${amount}${via}, fecha ${when}, estado ${describeSelectionStatus(purchase.paymentStatus)}`;
  }).join('; ');
}

/**
 * F3c capability safe-read continuation for purchase.modify and
 * payment_proof.verify. Returns a deterministic Spanish reply when the
 * authorized safe read produced usable purchase evidence, so an unsupported
 * mutation never blocks the safe read: multiple records ask for a selection,
 * a single pending record continues the voucher/balance thread. A voucher
 * report (live Luis turn 1) stays on the pending order with image and window
 * grounding instead of handing off. Null means the turn falls through to the
 * regular unsupported handoff. No mutation is ever performed here.
 */
export function resolveCapabilityPurchaseContinuation(args: {
  operation: string | null;
  results: InformationTaskResult[];
  reportedAmount: number | null;
}): string | null {
  if (args.operation !== 'purchase.modify' && args.operation !== 'payment_proof.verify') return null;
  const completed = args.results.find((result) =>
    result.kind === 'purchase' && result.status === 'completed'
  );
  if (!completed || completed.kind !== 'purchase' || completed.status !== 'completed') {
    return null;
  }
  const purchases = completed.purchases;
  if (purchases.length === 0) return null;
  if (purchases.length > 1 || completed.needsSelection === true) {
    if (args.operation !== 'purchase.modify') return null;
    const eventNames = purchases.map((purchase) => purchase.eventName?.trim() ?? '');
    const sharedEvent = eventNames[0];
    const uniformEvent = sharedEvent !== undefined && sharedEvent.length > 0 &&
      eventNames.every((name) => name === sharedEvent);
    const options = describeCapabilitySelectionOptions(purchases);
    if (uniformEvent) {
      return `Para ${sharedEvent} encontré ${purchases.length} registros: ${options}. ¿A cuál te refieres?`;
    }
    return `Encontré ${purchases.length} registros asociados a este número: ${options}. ¿A cuál te refieres?`;
  }
  const single = purchases[0];
  if (!single) return null;
  if ((single.paymentStatus?.trim().toLocaleLowerCase('en') ?? '') !== 'pending') return null;
  return renderVoucherContinuityReply({
    reportedAmount: args.reportedAmount,
    eventName: single.eventName,
  });
}
