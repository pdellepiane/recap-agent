import { redactArtifactText } from '../runtime/artifact-redaction';
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
  referencePresent: boolean;
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
  customerReferencePresent: boolean;
};

export type FixturePurchaseWorld = {
  guestOrders?: Record<string, { pending_orders?: unknown[]; completed_orders?: unknown[]; carts?: unknown[] }>;
  guestGiftPurchases?: Record<string, { purchases?: unknown[] }>;
};

/**
 * Shared Spanish formatter for one projected fact. Redaction policy matches
 * the candidate path: labels and method are redacted text, numeric totals
 * and status/date tokens travel raw, reference values never travel
 * (presence only).
 */
export function formatProjectedPurchaseFact(record: ProjectedPurchaseFact, index: number): string {
  const amount = record.total === null || Number.isNaN(record.total) ? 'desconocido' : String(record.total);
  const currency = record.currencyCode ?? record.currencySymbol
    ? `${record.currencyCode ?? 'codigo_ausente'} (${record.currencySymbol ?? 'simbolo_ausente'})`
    : 'ausente';
  return `${record.kind}[#${index + 1}]: evento=${redactArtifactText(record.eventLabel ?? '') || 'sin_etiqueta'} ` +
    `fecha_evento=${record.eventDate || 'desconocida'} fecha_creacion=${record.createdAt || 'desconocida'} ` +
    `monto=${amount} moneda=${currency} metodo=${redactArtifactText(record.paymentMethod ?? '') || 'desconocido'} ` +
    `estado_pago=${record.paymentStatus ?? 'desconocido'} referencia_cliente=${record.referencePresent ? 'presente' : 'ausente'}`;
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
    referencePresent: record.customerReferencePresent,
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
  const pushOrder = (value: unknown, kind: SubjectScopedPurchaseRecord['kind']): void => {
    const record = asRecord(value);
    if (!record) return;
    const id = typeof record['id'] === 'string' ? record['id'] : null;
    if (id && seenIds.has(id)) return;
    if (id) seenIds.add(id);
    const payment = asRecord(record['payment']);
    records.push({
      kind,
      eventName: textField(record, ['event_name']),
      eventDate: textField(record, ['event_date']),
      createdAt: textField(record, ['created_at']),
      amount: numField(record, ['grand_total']) ?? (payment ? numField(payment, ['amount']) : null),
      currencyCode: textField(record, ['currency_code']) || null,
      currencySymbol: textField(record, ['currency_symbol']) || null,
      method: textField(record, ['payment_method']) || (payment ? textField(payment, ['method']) : '') || null,
      paymentStatus: textField(record, ['payment_status']) || null,
      // increment_id is the customer-facing reference; its value never
      // travels (minimum disclosure + consistent redaction), presence only.
      customerReferencePresent: isNonEmptyString(record['increment_id']),
    });
  };
  for (const key of subjectKey(parsed.guestOrders)) {
    const container = parsed.guestOrders?.[key];
    for (const order of container?.pending_orders ?? []) pushOrder(order, 'pedido_pendiente');
    for (const order of container?.completed_orders ?? []) pushOrder(order, 'pedido_completado');
    for (const cart of container?.carts ?? []) {
      const record = asRecord(cart);
      if (!record) continue;
      records.push({
        kind: 'carrito',
        eventName: textField(record, ['event_name']),
        eventDate: textField(record, ['event_date']),
        createdAt: textField(record, ['created_at']),
        amount: numField(record, ['subtotal']),
        currencyCode: textField(record, ['currency_code']) || null,
        currencySymbol: textField(record, ['currency_symbol']) || null,
        method: null,
        paymentStatus: textField(record, ['status']) || null,
        customerReferencePresent: false,
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
    eventDate?: unknown;
    createdAt?: unknown;
    referencePresent?: unknown;
  } | null;
};

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableTotal(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
          referencePresent: fact.referencePresent === true,
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
