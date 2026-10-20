import { redactArtifactText } from '../runtime/artifact-redaction';
import { mapItemFulfillment } from '../runtime/purchase-disclosure-policy';
import { normalizeBackendCustomerTransactionNumber } from '../core/order-reference';
import type { EvalCase, EvalTurnResult } from './case-schema';

/**
 * Packet O5 — one typed purchase-evidence adapter shared by both evaluation
 * branches (mandatory expectations and optional scorers both reach it
 * through `buildSemanticJudgeContext`).
 *
 * Purchase facts are projected from real typed outcomes only:
 * - fixture-backed cases: typed order/gift records from the declared fixture
 *   world (the same rows the candidate lookup returned);
 * - live-lookup turns: the typed `purchaseFact` on completed purchase
 *   summary evidence.
 * The retired score-as-purchase-total / filename-as-event-label bridge is
 * never read here: a purchase summary entry without a typed fact projects
 * as unknown, never as values decoded from retrieval fields. An absent
 * backend read or a datum-less world is unknown, never a demand for a named
 * value. Provenance, independent effects and the exact turn-visible boundary
 * (only turns at or before the judged turn) are preserved.
 */

export type PurchaseFactProvenance = 'fixture-world' | 'live-lookup';

export type ProjectedPurchaseFactItem = {
  name: string | null;
  quantity: number | null;
  amount: number | null;
  rowTotal: number | null;
  fulfillment: string | null;
};

export type ProjectedPurchaseFactDedication = {
  message: string | null;
  sendPhysical: boolean | null;
  physicalStatus: string | null;
};

/** One labeled amount: the label says what the amount IS. */
export type ProjectedPurchaseAmount = {
  value: number | null;
  currencyCode: string | null;
  currencySymbol: string | null;
};

/** A gift value bound to the item it belongs to. */
export type ProjectedPurchaseGiftValue = ProjectedPurchaseAmount & {
  itemName: string | null;
};

/**
 * Labeled amount set of one purchase: the charged total, the per-item gift
 * values and the customer-reported amount. The reported amount stays null
 * when no record carries one.
 */
export type ProjectedPurchaseAmounts = {
  charged_total: ProjectedPurchaseAmount | null;
  gift_value: ProjectedPurchaseGiftValue[];
  reported_amount: ProjectedPurchaseAmount | null;
};

/** Payment summary projected from the gateway payment block. */
export type ProjectedPurchasePayment = {
  method: string | null;
  amount: number | null;
  paidAt: string | null;
  transactionStatus: string | null;
  gatewayMessage: string | null;
  operationCode: string | null;
  originBank: string | null;
  voucherProvided: boolean | null;
  declineCode: string | null;
};

export type ProjectedPurchaseFact = {
  kind: 'pedido_pendiente' | 'pedido_completado' | 'compra_regalo' | 'carrito' | 'consulta_en_vivo';
  eventLabel: string | null;
  eventDate: string | null;
  createdAt: string | null;
  total: number | null;
  currencyCode: string | null;
  currencySymbol: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  shippingStatus: string | null;
  dedication: ProjectedPurchaseFactDedication | null;
  items: ProjectedPurchaseFactItem[];
  referencePresent: boolean;
  /** Customer transaction reference value; null when the record carries none. */
  reference: string | null;
  /** Host-receipt fact: the record carries a thank-you for this purchase. */
  thanksPresent: boolean;
  /** Thank-you message recorded by the backend. */
  thanksMessage: string | null;
  /** Channel the thank-you was sent through, as recorded. */
  thanksSendMethod: string | null;
  /** Payment summary from the gateway payment block. */
  payment: ProjectedPurchasePayment | null;
  /** Labeled amounts: charged total, per-item gift values, reported amount. */
  amounts: ProjectedPurchaseAmounts;
  provenance: PurchaseFactProvenance;
  /** Verifiable pair for the fact tuple; carried alongside the values. */
  contentHash: string | null;
};

export type SubjectScopedPurchaseRecord = {
  kind: 'pedido_pendiente' | 'pedido_completado' | 'compra_regalo' | 'carrito';
  eventName: string;
  eventDate: string;
  createdAt: string;
  amount: number | null;
  currencyCode: string | null;
  currencySymbol: string | null;
  method: string | null;
  paymentStatus: string | null;
  shippingStatus: string | null;
  dedication: ProjectedPurchaseFactDedication | null;
  items: ProjectedPurchaseFactItem[];
  customerReferencePresent: boolean;
  /** Customer transaction reference value; null when the record carries none. */
  customerReference: string | null;
  /** Host-receipt fact read from the record. */
  thanksPresent: boolean;
  /** Thank-you message recorded by the backend. */
  thanksMessage: string | null;
  /** Channel the thank-you was sent through, as recorded. */
  thanksSendMethod: string | null;
  /** Payment summary read from the record. */
  payment: ProjectedPurchasePayment | null;
  /** Labeled amounts read from the record. */
  amounts: ProjectedPurchaseAmounts;
};

export type FixturePurchaseWorld = {
  guestOrders?: Record<string, { pending_orders?: unknown[]; completed_orders?: unknown[]; carts?: unknown[] }>;
  guestGiftPurchases?: Record<string, { purchases?: unknown[] }>;
};

/**
 * Shared Spanish formatter for one projected fact. Redaction policy matches
 * the candidate path: labels and method are redacted text, numeric totals
 * and status/date tokens travel raw. The customer reference travels only as
 * an explicitly customer-visible reference, which the source authorized;
 * internal identifiers never travel.
 */
export function formatProjectedPurchaseFact(record: ProjectedPurchaseFact, index: number): string {
  const amount = record.total === null || Number.isNaN(record.total) ? 'desconocido' : String(record.total);
  const currency = record.currencyCode ?? record.currencySymbol
    ? `${record.currencyCode ?? 'codigo_ausente'} (${record.currencySymbol ?? 'simbolo_ausente'})`
    : 'ausente';
  const num = (value: number | null): string =>
    value === null || Number.isNaN(value) ? '?' : String(value);
  const items = record.items.length === 0
    ? 'ninguno'
    : record.items.map((item) =>
      `${redactArtifactText(item.name ?? '') || 'sin_nombre'} x${num(item.quantity)} ` +
      `monto=${num(item.amount)} total_fila=${num(item.rowTotal)} (${item.fulfillment ?? 'desconocido'})`,
    ).join(' | ');
  const dedication = record.dedication === null
    ? 'ausente'
    : `mensaje=${redactArtifactText(record.dedication.message ?? '') || 'sin_mensaje'} ` +
      `envio_fisico=${record.dedication.sendPhysical === null ? 'desconocido' : String(record.dedication.sendPhysical)} ` +
      `estado_fisico=${record.dedication.physicalStatus ?? 'desconocido'}`;
  const charged = record.amounts.charged_total;
  const chargedText = charged === null
    ? 'desconocido'
    : `${num(charged.value)} (${charged.currencyCode ?? 'codigo_ausente'} ${charged.currencySymbol ?? 'simbolo_ausente'})`;
  const giftValues = record.amounts.gift_value.map((gift) =>
    `${redactArtifactText(gift.itemName ?? '') || 'sin_nombre'}=${num(gift.value)} ` +
    `(${gift.currencyCode ?? 'codigo_ausente'} ${gift.currencySymbol ?? 'simbolo_ausente'})`);
  const reported = record.amounts.reported_amount;
  const reportedText = reported === null
    ? 'desconocido'
    : `${num(reported.value)} (${reported.currencyCode ?? 'codigo_ausente'} ${reported.currencySymbol ?? 'simbolo_ausente'})`;
  const payment = record.payment === null
    ? 'ausente'
    : [
      `metodo=${redactArtifactText(record.payment.method ?? '') || 'desconocido'}`,
      `monto=${num(record.payment.amount)}`,
      `pagado=${record.payment.paidAt || 'desconocida'}`,
      `resultado_gateway=${record.payment.transactionStatus ?? 'desconocido'}`,
      `voucher=${record.payment.voucherProvided === null ? 'desconocido' : record.payment.voucherProvided ? 'si' : 'no'}`,
      `operacion=${redactArtifactText(record.payment.operationCode ?? '') || 'desconocida'}`,
      `banco_origen=${redactArtifactText(record.payment.originBank ?? '') || 'desconocido'}`,
      `decline=${redactArtifactText(record.payment.declineCode ?? '') || 'desconocido'}`,
      `mensaje_gateway=${redactArtifactText(record.payment.gatewayMessage ?? '') || 'desconocido'}`,
    ].join(' ');
  const thanks = record.thanksPresent
    ? `presente mensaje=${redactArtifactText(record.thanksMessage ?? '') || 'sin_mensaje'} ` +
      `metodo_envio=${redactArtifactText(record.thanksSendMethod ?? '') || 'desconocido'}`
    : 'ausente';
  const reference = record.referencePresent
    ? `presente valor=${record.reference ?? 'desconocido'}`
    : 'ausente';
  return `${record.kind}[#${index + 1}]: evento=${redactArtifactText(record.eventLabel ?? '') || 'sin_etiqueta'} ` +
    `fecha_evento=${record.eventDate || 'desconocida'} fecha_creacion=${record.createdAt || 'desconocida'} ` +
    `monto=${amount} moneda=${currency} metodo=${redactArtifactText(record.paymentMethod ?? '') || 'desconocido'} ` +
    `estado_pago=${record.paymentStatus ?? 'desconocido'} estado_envio=${record.shippingStatus ?? 'desconocido'} ` +
    `montos=[total_cargado=${chargedText} valores_regalo=[${giftValues.join(' | ')}] monto_reportado=${reportedText}] ` +
    `pago=[${payment}] agradecimiento=[${thanks}] ` +
    `dedicatoria=[${dedication}] articulos=[${items}] referencia_cliente=${reference}`;
}

export function toProjectedFact(record: SubjectScopedPurchaseRecord): ProjectedPurchaseFact {
  return {
    kind: record.kind,
    eventLabel: record.eventName.length > 0 ? record.eventName : null,
    eventDate: record.eventDate.length > 0 ? record.eventDate : null,
    createdAt: record.createdAt.length > 0 ? record.createdAt : null,
    total: record.amount,
    currencyCode: record.currencyCode,
    currencySymbol: record.currencySymbol,
    paymentMethod: record.method,
    paymentStatus: record.paymentStatus,
    shippingStatus: record.shippingStatus,
    dedication: record.dedication,
    items: record.items,
    referencePresent: record.customerReferencePresent,
    reference: record.customerReference,
    thanksPresent: record.thanksPresent,
    thanksMessage: record.thanksMessage,
    thanksSendMethod: record.thanksSendMethod,
    payment: record.payment,
    amounts: record.amounts,
    provenance: 'fixture-world',
    contentHash: null,
  };
}

export function buildFixturePurchaseFactLines(
  scenario: string,
  records: SubjectScopedPurchaseRecord[],
): string[] {
  if (records.length === 0) {
    return [`proyeccion_compra=sin_registros_telefonicos mundo=${scenario} (desconocido, nunca exito ni confirmacion)`];
  }
  return [
    `proyeccion_compra visible para el candidato (mundo fixture ${scenario}, registros telefonicos del sujeto devueltos por la busqueda; repetirlos con consulta completada es grounded):`,
    ...records.map((record, index) => formatProjectedPurchaseFact(toProjectedFact(record), index)),
  ];
}

export function phoneKeysMatch(left: string, right: string): boolean {
  const leftDigits = left.replace(/\D/gu, '');
  const rightDigits = right.replace(/\D/gu, '');
  if (leftDigits.length < 7 || rightDigits.length < 7) {
    return leftDigits === rightDigits;
  }
  const tail = Math.min(9, leftDigits.length, rightDigits.length);
  return leftDigits.slice(-tail) === rightDigits.slice(-tail);
}

export function collectCaseSubjectPhones(currentCase: EvalCase, selectedIndex: number): string[] {
  const phones: string[] = [];
  for (const input of currentCase.inputs.slice(0, selectedIndex + 1)) {
    const contactPhone = input.contactPhone;
    if (typeof contactPhone === 'string' && contactPhone.length > 0 && !contactPhone.startsWith('$')) {
      phones.push(contactPhone);
    }
  }
  const seedPhone = (currentCase.seedPlan as { contact_phone?: unknown } | undefined)?.contact_phone;
  if (typeof seedPhone === 'string' && seedPhone.length > 0 && !seedPhone.startsWith('$')) {
    phones.push(seedPhone);
  }
  return phones;
}

/**
 * Pure typed projection of the fixture world rows for the case subject.
 * Throws on malformed worlds so the caller reports a diagnosable projection
 * defect instead of success or confirmation.
 */
export function buildFixturePurchaseRecords(
  parsed: FixturePurchaseWorld,
  subjectPhones: string[],
): SubjectScopedPurchaseRecord[] {
  const records: SubjectScopedPurchaseRecord[] = [];
  const seenIds = new Set<string>();
  const subjectKey = (container: Record<string, unknown> | undefined): string[] =>
    container && typeof container === 'object'
      ? Object.keys(container).filter((key) => subjectPhones.some((phone) => phoneKeysMatch(phone, key)))
      : [];
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const textField = (record: Record<string, unknown>, keys: string[]): string => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return '';
  };
  const numField = (record: Record<string, unknown>, keys: string[]): number | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
  };
  const isNonEmptyString = (value: unknown): boolean =>
    typeof value === 'string' && value.length > 0;
  const nullableBool = (value: unknown): boolean | null =>
    typeof value === 'boolean' ? value : null;
  const itemFacts = (value: unknown): ProjectedPurchaseFactItem[] => {
    if (!Array.isArray(value)) return [];
    const facts: ProjectedPurchaseFactItem[] = [];
    for (const entry of value) {
      const item = asRecord(entry);
      if (!item) continue;
      const rawType = typeof item['type'] === 'string' ? item['type'] : null;
      facts.push({
        name: typeof item['gift_name'] === 'string' && item['gift_name'].length > 0 ? item['gift_name'] : null,
        quantity: numField(item, ['quantity']),
        amount: numField(item, ['amount']),
        rowTotal: numField(item, ['row_total']),
        fulfillment: mapItemFulfillment(rawType).kind,
      });
    }
    return facts;
  };
  const dedicationFact = (value: unknown): ProjectedPurchaseFactDedication | null => {
    const dedication = asRecord(value);
    if (!dedication) return null;
    return {
      message: typeof dedication['message'] === 'string' && dedication['message'].length > 0
        ? dedication['message']
        : null,
      sendPhysical: nullableBool(dedication['send_physical']),
      physicalStatus: typeof dedication['physical_status'] === 'string' && dedication['physical_status'].length > 0
        ? dedication['physical_status']
        : null,
    };
  };
  const amountFacts = (
    chargedTotal: number | null,
    currencyCode: string | null,
    currencySymbol: string | null,
    items: ProjectedPurchaseFactItem[],
  ): ProjectedPurchaseAmounts => ({
    charged_total: chargedTotal === null
      ? null
      : { value: chargedTotal, currencyCode, currencySymbol },
    gift_value: items.flatMap((item) =>
      typeof item.rowTotal === 'number' && Number.isFinite(item.rowTotal)
        ? [{
          value: item.rowTotal,
          currencyCode,
          currencySymbol,
          itemName: item.name,
        }]
        : []),
    reported_amount: null,
  });
  const paymentFact = (
    payment: Record<string, unknown> | null,
    record: Record<string, unknown>,
  ): ProjectedPurchasePayment | null => {
    const declineCode = textField(record, ['decline_code']) || null;
    if (!payment && declineCode === null) return null;
    const voucher = payment === null ? undefined : payment['voucher'];
    const voucherProvided = voucher === undefined || voucher === null
      ? null
      : Array.isArray(voucher)
        ? voucher.length > 0
        : typeof voucher === 'string' ? voucher.length > 0 : null;
    return {
      method: payment ? textField(payment, ['method']) || null : null,
      amount: payment ? numField(payment, ['amount']) : null,
      paidAt: payment ? textField(payment, ['paid_at']) || null : null,
      transactionStatus: payment ? textField(payment, ['transaction_status']) || null : null,
      gatewayMessage: payment ? textField(payment, ['gateway_message']) || null : null,
      operationCode: payment ? textField(payment, ['op_code']) || null : null,
      originBank: payment ? textField(payment, ['origin_bank']) || null : null,
      voucherProvided,
      declineCode,
    };
  };
  const thanksFacts = (
    record: Record<string, unknown>,
  ): { present: boolean; message: string | null; sendMethod: string | null } => {
    const thanks = asRecord(record['thanks']);
    const message = thanks
      ? typeof thanks['message'] === 'string' && thanks['message'].length > 0
        ? thanks['message']
        : null
      : null;
    const sendMethod = thanks
      ? typeof thanks['send_method'] === 'string' && thanks['send_method'].length > 0
        ? thanks['send_method']
        : null
      : null;
    const isThanked = nullableBool(record['is_thanked']);
    return {
      present: isThanked === true ||
        (message !== null && message.length > 0) ||
        (sendMethod !== null && sendMethod.length > 0),
      message,
      sendMethod,
    };
  };
  const pushOrder = (value: unknown, kind: SubjectScopedPurchaseRecord['kind']): void => {
    const record = asRecord(value);
    if (!record) return;
    const id = typeof record['id'] === 'string' ? record['id'] : null;
    if (id && seenIds.has(id)) return;
    if (id) seenIds.add(id);
    const payment = asRecord(record['payment']);
    const currencyCode = textField(record, ['currency_code']) || null;
    const currencySymbol = textField(record, ['currency_symbol']) || null;
    const amount = numField(record, ['grand_total']) ?? (payment ? numField(payment, ['amount']) : null);
    const items = itemFacts(record['items']);
    const thanks = thanksFacts(record);
    records.push({
      kind,
      eventName: textField(record, ['event_name']),
      eventDate: textField(record, ['event_date']),
      createdAt: textField(record, ['created_at']),
      amount,
      currencyCode,
      currencySymbol,
      method: textField(record, ['payment_method']) || (payment ? textField(payment, ['method']) : '') || null,
      paymentStatus: textField(record, ['payment_status']) || null,
      shippingStatus: textField(record, ['shipping_status']) || null,
      dedication: dedicationFact(record['dedication']),
      items,
      // increment_id is the customer-facing reference; its value travels
      // only when the normalizer recognizes an explicitly customer-visible
      // reference, never as an internal identifier.
      customerReferencePresent: isNonEmptyString(record['increment_id']),
      customerReference: normalizeBackendCustomerTransactionNumber(
        typeof record['increment_id'] === 'string' || typeof record['increment_id'] === 'number'
          ? record['increment_id']
          : null,
      ),
      thanksPresent: thanks.present,
      thanksMessage: thanks.message,
      thanksSendMethod: thanks.sendMethod,
      payment: paymentFact(payment, record),
      amounts: amountFacts(amount, currencyCode, currencySymbol, items),
    });
  };
  for (const key of subjectKey(parsed.guestOrders)) {
    const container = parsed.guestOrders?.[key];
    for (const order of container?.pending_orders ?? []) pushOrder(order, 'pedido_pendiente');
    for (const order of container?.completed_orders ?? []) pushOrder(order, 'pedido_completado');
    for (const cart of container?.carts ?? []) {
      const record = asRecord(cart);
      if (!record) continue;
      const cartCurrencyCode = textField(record, ['currency_code']) || null;
      const cartCurrencySymbol = textField(record, ['currency_symbol']) || null;
      const cartItems = itemFacts(record['items']);
      records.push({
        kind: 'carrito',
        eventName: textField(record, ['event_name']),
        eventDate: textField(record, ['event_date']),
        createdAt: textField(record, ['created_at']),
        amount: numField(record, ['subtotal']),
        currencyCode: cartCurrencyCode,
        currencySymbol: cartCurrencySymbol,
        method: null,
        paymentStatus: textField(record, ['status']) || null,
        shippingStatus: null,
        dedication: null,
        items: cartItems,
        customerReferencePresent: false,
        customerReference: null,
        thanksPresent: false,
        thanksMessage: null,
        thanksSendMethod: null,
        payment: null,
        // A cart is not a charged order: it carries no charged total.
        amounts: amountFacts(null, cartCurrencyCode, cartCurrencySymbol, cartItems),
      });
    }
  }
  for (const key of subjectKey(parsed.guestGiftPurchases)) {
    for (const purchase of parsed.guestGiftPurchases?.[key]?.purchases ?? []) {
      pushOrder(purchase, 'compra_regalo');
    }
  }
  return records;
}

type SummaryEvidenceItem = {
  filename?: unknown;
  score?: unknown;
  contentHash?: unknown;
  purchaseFact?: {
    eventLabel?: unknown;
    total?: unknown;
    currency?: unknown;
    currencySymbol?: unknown;
    paymentMethod?: unknown;
    paymentStatus?: unknown;
    shippingStatus?: unknown;
    eventDate?: unknown;
    createdAt?: unknown;
    referencePresent?: unknown;
    reference?: unknown;
    thanksPresent?: unknown;
    thanksMessage?: unknown;
    thanksSendMethod?: unknown;
    payment?: {
      method?: unknown;
      amount?: unknown;
      paidAt?: unknown;
      transactionStatus?: unknown;
      gatewayMessage?: unknown;
      operationCode?: unknown;
      originBank?: unknown;
      voucherProvided?: unknown;
      declineCode?: unknown;
    } | null;
    amounts?: {
      charged_total?: {
        value?: unknown;
        currency?: unknown;
        currencySymbol?: unknown;
      } | null;
      gift_value?: Array<{
        value?: unknown;
        currency?: unknown;
        currencySymbol?: unknown;
        itemName?: unknown;
      }>;
      reported_amount?: {
        value?: unknown;
        currency?: unknown;
        currencySymbol?: unknown;
      } | null;
    } | null;
    dedication?: {
      message?: unknown;
      sendPhysical?: unknown;
      physicalStatus?: unknown;
    } | null;
    items?: Array<{
      name?: unknown;
      quantity?: unknown;
      amount?: unknown;
      rowTotal?: unknown;
      fulfillment?: unknown;
    }>;
  } | null;
};

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableTotal(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectedAmount(value: unknown): ProjectedPurchaseAmount | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entry = value as { value?: unknown; currency?: unknown; currencySymbol?: unknown };
  return {
    value: nullableTotal(entry.value),
    currencyCode: nullableString(entry.currency),
    currencySymbol: nullableString(entry.currencySymbol),
  };
}

function projectedAmounts(value: unknown): ProjectedPurchaseAmounts {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { charged_total: null, gift_value: [], reported_amount: null };
  }
  const entry = value as {
    charged_total?: unknown;
    gift_value?: unknown;
    reported_amount?: unknown;
  };
  const giftValue = Array.isArray(entry.gift_value) ? entry.gift_value : [];
  return {
    charged_total: projectedAmount(entry.charged_total ?? null),
    gift_value: giftValue.flatMap((gift) => {
      const amount = projectedAmount(gift);
      if (amount === null) return [];
      const itemName = typeof gift === 'object' && gift !== null && !Array.isArray(gift)
        ? (gift as { itemName?: unknown }).itemName
        : null;
      return [{ ...amount, itemName: nullableString(itemName) }];
    }),
    reported_amount: projectedAmount(entry.reported_amount ?? null),
  };
}

function projectedPayment(value: unknown): ProjectedPurchasePayment | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entry = value as {
    method?: unknown;
    amount?: unknown;
    paidAt?: unknown;
    transactionStatus?: unknown;
    gatewayMessage?: unknown;
    operationCode?: unknown;
    originBank?: unknown;
    voucherProvided?: unknown;
    declineCode?: unknown;
  };
  return {
    method: nullableString(entry.method),
    amount: nullableTotal(entry.amount),
    paidAt: nullableString(entry.paidAt),
    transactionStatus: nullableString(entry.transactionStatus),
    gatewayMessage: nullableString(entry.gatewayMessage),
    operationCode: nullableString(entry.operationCode),
    originBank: nullableString(entry.originBank),
    voucherProvided: typeof entry.voucherProvided === 'boolean' ? entry.voucherProvided : null,
    declineCode: nullableString(entry.declineCode),
  };
}

/**
 * Typed live-lookup projection. Reads only the typed `purchaseFact` on
 * purchase summary evidence; retrieval filename/score fields are never
 * decoded into values. Entries without a typed fact (backend not read or
 * no datum) contribute no values: unknown, never success.
 */
export function projectLivePurchaseFacts(turns: EvalTurnResult[]): ProjectedPurchaseFact[] {
  const facts: ProjectedPurchaseFact[] = [];
  for (const turn of turns) {
    const lookups = Array.isArray(turn.trace.information_execution_summary)
      ? turn.trace.information_execution_summary
      : [];
    for (const entry of lookups) {
      if (entry.kind !== 'purchase') continue;
      const evidence = (Array.isArray(entry.evidence) ? entry.evidence : []) as SummaryEvidenceItem[];
      for (const item of evidence) {
        const fact = item?.purchaseFact;
        if (!fact || typeof fact !== 'object') continue;
        const dedication = fact.dedication !== null && typeof fact.dedication === 'object'
          ? {
            message: nullableString(fact.dedication.message),
            sendPhysical: typeof fact.dedication.sendPhysical === 'boolean'
              ? fact.dedication.sendPhysical
              : null,
            physicalStatus: nullableString(fact.dedication.physicalStatus),
          }
          : null;
        facts.push({
          kind: 'consulta_en_vivo',
          eventLabel: nullableString(fact.eventLabel),
          eventDate: nullableString(fact.eventDate),
          createdAt: nullableString(fact.createdAt),
          total: nullableTotal(fact.total),
          currencyCode: nullableString(fact.currency),
          currencySymbol: nullableString(fact.currencySymbol),
          paymentMethod: nullableString(fact.paymentMethod),
          paymentStatus: nullableString(fact.paymentStatus),
          shippingStatus: nullableString(fact.shippingStatus),
          dedication,
          items: Array.isArray(fact.items)
            ? fact.items.map((entry) => ({
              name: nullableString(entry?.name),
              quantity: nullableTotal(entry?.quantity),
              amount: nullableTotal(entry?.amount),
              rowTotal: nullableTotal(entry?.rowTotal),
              fulfillment: nullableString(entry?.fulfillment),
            }))
            : [],
          referencePresent: fact.referencePresent === true,
          reference: nullableString(fact.reference),
          thanksPresent: fact.thanksPresent === true,
          thanksMessage: nullableString(fact.thanksMessage),
          thanksSendMethod: nullableString(fact.thanksSendMethod),
          payment: projectedPayment(fact.payment ?? null),
          amounts: projectedAmounts(fact.amounts ?? null),
          provenance: 'live-lookup',
          contentHash: typeof item.contentHash === 'string' && item.contentHash.length > 0
            ? item.contentHash
            : null,
        });
      }
    }
  }
  return facts;
}

type PurchaseLookupStatus = {
  turnIndex: number;
  status: string;
  source: string;
  outcomeCode: string;
  resultCount: number;
};

function collectPurchaseLookupStatuses(turns: EvalTurnResult[]): PurchaseLookupStatus[] {
  const statuses: PurchaseLookupStatus[] = [];
  for (const turn of turns) {
    const lookups = Array.isArray(turn.trace.information_execution_summary)
      ? turn.trace.information_execution_summary
      : [];
    for (const entry of lookups) {
      if (entry.kind !== 'purchase') continue;
      statuses.push({
        turnIndex: turn.turnIndex,
        status: String(entry.status ?? 'unknown'),
        source: String(entry.source ?? 'unknown'),
        outcomeCode: String(entry.outcomeCode ?? 'unknown'),
        resultCount: typeof entry.resultCount === 'number' ? entry.resultCount : 0,
      });
    }
  }
  return statuses;
}

export function hasCompletedPurchaseLookup(turns: EvalTurnResult[]): boolean {
  return turns.some((turn) =>
    (Array.isArray(turn.trace.information_execution_summary)
      ? turn.trace.information_execution_summary
      : []).some((entry) => entry.kind === 'purchase'),
  );
}

/**
 * Live-lookup purchase evidence block for the judge. Lookup status lines
 * come from the typed summary outcomes; values come only from typed facts,
 * with the contentHash as the verifiable pair. No typed fact means unknown
 * (backend not read or no datum), never success and never a demand for a
 * named value.
 */
export function buildLivePurchaseFactLines(turns: EvalTurnResult[]): string[] {
  const statuses = collectPurchaseLookupStatuses(turns);
  if (statuses.length === 0) {
    return ['evidencia_compra=ninguna (sin busquedas de compra en los turnos evaluados; lo ausente es desconocido, nunca exito ni confirmacion)'];
  }
  const lines = statuses.map((lookup) =>
    `evidencia_compra turno ${lookup.turnIndex} (valores de busqueda en vivo visibles para el candidato; repetirlos con consulta completada es grounded): ` +
    `estado=${lookup.status} fuente=${lookup.source} resultado=${lookup.outcomeCode} resultados=${lookup.resultCount}`,
  );
  const facts = projectLivePurchaseFacts(turns);
  if (facts.length === 0) {
    lines.push('evidencia_compra_datos=no_disponibles (busqueda de compra sin hechos tipados: backend no leido o sin dato; desconocido, nunca exito ni confirmacion; no se exige ningun dato nombrado)');
    return lines;
  }
  lines.push(
    ...facts.map((fact, index) =>
      `${formatProjectedPurchaseFact(fact, index)}${fact.contentHash ? ` hash=${fact.contentHash}` : ''}`),
  );
  return lines;
}
