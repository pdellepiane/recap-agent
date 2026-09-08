/**
 * F4 deterministic close-submission summary for node `crear_lead_cerrar`.
 *
 * When the model already called `finish_plan` this turn with an explicitly
 * captured event date, the reply must confirm the per-provider submission
 * with that date instead of asking for another confirmation. Partial success
 * never claims closure: confirmed providers are reported as sent while
 * blocked or unresolved ones stay truthful without retry. A missing or
 * invalid date, a failed submission, or an unparsable tool output yields no
 * summary so the turn keeps asking for explicit confirmation and a date.
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
  if (input.status === 'failed' || input.contactedProviders.length === 0) return null;
  const confirmed = input.contactedProviders.filter((provider) => provider.success);
  const pending = input.contactedProviders.filter((provider) => !provider.success);
  if (confirmed.length === 0) return null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
  if (status !== 'success' && status !== 'partial') return undefined;
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
