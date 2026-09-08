/**
 * F4 deterministic close-submission summary for node `crear_lead_cerrar`.
 *
 * When the model already called `finish_plan` this turn with an explicitly
 * captured event date, the reply must confirm the per-provider submission
 * with that date instead of asking for another confirmation. Partial success
 * never claims closure: confirmed providers are reported as sent while
 * blocked or unresolved ones stay truthful without retry. A failed-all
 * submission with an explicit date reports the block truthfully with a human
 * handoff instead of asking for another confirmation. A missing or invalid
 * date, an empty provider list, or an unparsable tool output yields no
 * summary so the turn keeps asking for an explicit date.
 */

export type FinishPlanContactedProvider = {
  providerId: number;
  category: string;
  success: boolean;
  error?: string;
};

export type CloseSubmissionStatus = 'success' | 'partial' | 'failed';

export type CloseSubmissionInput = {
  status: CloseSubmissionStatus;
  eventDate: string | null;
  contactedProviders: readonly FinishPlanContactedProvider[];
  displayByCategory: Readonly<Record<string, string>>;
};

export type FinishPlanTurnOutcome = {
  status: CloseSubmissionStatus;
  eventDate: string | null;
  contactedProviders: FinishPlanContactedProvider[];
};

const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function formatSpanishEventDate(value: string | null): string | null {
  if (value === null) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${day} de ${SPANISH_MONTHS[month - 1]} de ${year}`;
}

function displayName(
  provider: FinishPlanContactedProvider,
  displayByCategory: Readonly<Record<string, string>>,
): string {
  return displayByCategory[provider.category] ?? `${provider.category} ${provider.providerId}`;
}

function joinSpanishList(names: string[]): string {
  const unique = Array.from(new Set(names));
  if (unique.length <= 2) return unique.join(' y ');
  return `${unique.slice(0, -1).join(', ')} y ${unique[unique.length - 1]}`;
}

export function buildCloseSubmissionSummary(input: CloseSubmissionInput): string | null {
  const longDate = formatSpanishEventDate(input.eventDate);
  if (longDate === null) return null;
  if (input.contactedProviders.length === 0) return null;
  const confirmed = input.contactedProviders.filter((provider) => provider.success);
  const pending = input.contactedProviders.filter((provider) => !provider.success);
  if (confirmed.length === 0) {
    return buildBlockedSubmissionSummary(longDate, input.contactedProviders, input.displayByCategory);
  }
  const sentNames = joinSpanishList(
    confirmed.map((provider) => displayName(provider, input.displayByCategory)),
  );
  const sentClause = confirmed.length === 1
    ? `La solicitud de cotización fue enviada a ${sentNames} para tu evento del ${longDate}.`
    : `Las solicitudes de cotización fueron enviadas a ${sentNames} para tu evento del ${longDate}.`;
  const contactClause = ' Los proveedores se pondrán en contacto contigo por correo electrónico o teléfono.';
  if (pending.length === 0) {
    return `${sentClause}${contactClause}`;
  }
  const pendingNames = joinSpanishList(
    pending.map((provider) => displayName(provider, input.displayByCategory)),
  );
  return `${sentClause}${contactClause} Para ${pendingNames} no pude confirmar el envío todavía, así que esa parte sigue sin cerrar.`;
}

const CONFIRM_QUESTION_PATTERN = /¿Confirmas que envíe[^?]*\?/u;

export function applyCloseSubmissionToText(text: string, summary: string | null): string {
  if (summary === null) return text;
  if (!CONFIRM_QUESTION_PATTERN.test(text)) return text;
  return text.replace(CONFIRM_QUESTION_PATTERN, summary);
}

function buildBlockedSubmissionSummary(
  longDate: string,
  providers: readonly FinishPlanContactedProvider[],
  displayByCategory: Readonly<Record<string, string>>,
): string {
  const names = joinSpanishList(
    providers.map((provider) => displayName(provider, displayByCategory)),
  );
  const requests = providers.length === 1
    ? `la solicitud de cotización a ${names}`
    : `las solicitudes de cotización a ${names}`;
  return `Para tu evento del ${longDate} no pude enviar ${requests}: el envío quedó bloqueado. Puedo comunicarte con una persona del equipo para continuar con el cierre.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const SPANISH_MONTH_INDEX: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${year}-${monthText}-${dayText}`;
}

function parseSingleDateText(value: string): string | null {
  const text = value.trim();
  if (text.length === 0) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (iso?.[1] && iso?.[2] && iso?.[3]) {
    return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const spanish = text.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/iu);
  if (spanish?.[1] && spanish?.[2] && spanish?.[3]) {
    const month = SPANISH_MONTH_INDEX[spanish[2].toLocaleLowerCase('es')];
    if (!month) return null;
    return toIsoDate(Number(spanish[3]), month, Number(spanish[1]));
  }
  const numeric = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/u);
  if (numeric?.[1] && numeric?.[2] && numeric?.[3]) {
    return toIsoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  }
  return null;
}

/**
 * F4 deterministic explicit-date resolver for `finish_plan`.
 *
 * The model must pass the user-supplied date as AAAA-MM-DD, but live turns
 * show it can arrive as Spanish long form or be unusable. This resolver
 * normalizes the model value first, then falls back to the first explicit
 * date found in the user message. It never substitutes today and returns
 * null when neither source carries an explicit calendar-valid date, so the
 * executor keeps failing closed with missing_event_date.
 */
export function resolveExplicitEventDate(modelValue: unknown, userMessage: unknown): string | null {
  if (typeof modelValue === 'string') {
    const normalized = parseSingleDateText(modelValue);
    if (normalized !== null) return normalized;
  }
  if (typeof userMessage === 'string') {
    const spanish = userMessage.match(/\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}/iu);
    if (spanish?.[0]) {
      const normalized = parseSingleDateText(spanish[0]);
      if (normalized !== null) return normalized;
    }
    const numeric = userMessage.match(/\d{1,2}[/-]\d{1,2}[/-]\d{4}/u);
    if (numeric?.[0]) {
      const normalized = parseSingleDateText(numeric[0]);
      if (normalized !== null) return normalized;
    }
    const iso = userMessage.match(/\d{4}-\d{2}-\d{2}/u);
    if (iso?.[0]) {
      const normalized = parseSingleDateText(iso[0]);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

export function parseFinishPlanTurnOutcome(outputJson: string): FinishPlanTurnOutcome | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputJson) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const status = parsed['status'];
  if (status !== 'success' && status !== 'partial' && status !== 'failed') return undefined;
  const rawDate = parsed['eventDate'];
  const eventDate = typeof rawDate === 'string' ? rawDate : null;
  const rawProviders = parsed['contacted_providers'];
  if (!Array.isArray(rawProviders)) return undefined;
  const contactedProviders: FinishPlanContactedProvider[] = [];
  for (const entry of rawProviders) {
    if (!isRecord(entry)) return undefined;
    const providerId = entry['providerId'];
    const category = entry['category'];
    const success = entry['success'];
    if (typeof providerId !== 'number' || typeof category !== 'string' || typeof success !== 'boolean') {
      return undefined;
    }
    const provider: FinishPlanContactedProvider = { providerId, category, success };
    if (typeof entry['error'] === 'string') provider.error = entry['error'];
    contactedProviders.push(provider);
  }
  return { status, eventDate, contactedProviders };
}
