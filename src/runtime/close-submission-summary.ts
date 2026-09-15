export type CloseSubmissionError =
  | 'missing_contact_info'
  | 'invalid_contact_info'
  | 'no_selected_providers'
  | 'missing_event_date'
  | 'invalid_event_date';

export type CloseSubmissionProviderReceipt = {
  providerId: number;
  category: string;
  status: 'confirmed' | 'failed' | 'unresolved';
  eventDate: string;
  receiptId: string | null;
  attemptCount: number;
};

export type CloseSubmissionStatus = 'success' | 'partial' | 'failed';

export type CloseSubmissionInput = {
  status: CloseSubmissionStatus;
  eventDate: string | null;
  providers: readonly CloseSubmissionProviderReceipt[];
  error: CloseSubmissionError | null;
};

export type FinishPlanTurnOutcome = {
  status: CloseSubmissionStatus;
  eventDate: string | null;
  providers: CloseSubmissionProviderReceipt[];
  error: CloseSubmissionError | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Validate the model-selected calendar date against user-authored evidence.
 * Model arguments and prompt examples are not independent date provenance.
 */
export function resolveExplicitEventDate(modelValue: unknown, userMessage: unknown): string | null {
  if (typeof userMessage !== 'string') return null;
  const candidates = userMessage.match(
    /\d{4}-\d{2}-\d{2}|\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}/giu,
  ) ?? [];
  const dates = [...new Set(candidates.flatMap((candidate) => {
    const parsed = parseSingleDateText(candidate);
    return parsed === null ? [] : [parsed];
  }))];
  const selected = typeof modelValue === 'string' ? parseSingleDateText(modelValue) : null;
  if (selected !== null) return dates.includes(selected) ? selected : null;
  return dates.length === 1 ? dates[0] : null;
}

const CLOSE_ERRORS = new Set<CloseSubmissionError>([
  'missing_contact_info', 'invalid_contact_info', 'no_selected_providers',
  'missing_event_date', 'invalid_event_date',
]);

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
  const eventDate = rawDate === null
    ? null
    : typeof rawDate === 'string' ? parseSingleDateText(rawDate) : undefined;
  if (eventDate === undefined) return undefined;
  if (rawDate !== null && eventDate === null) return undefined;
  const rawEffects = parsed['effects'];
  if (!Array.isArray(rawEffects)) return undefined;
  const providers: CloseSubmissionProviderReceipt[] = [];
  for (const entry of rawEffects) {
    if (!isRecord(entry)) return undefined;
    const providerId = entry['providerId'];
    const category = entry['category'];
    const status = entry['status'];
    const rawEffectDate = entry['eventDate'];
    const effectDate = typeof rawEffectDate === 'string' ? parseSingleDateText(rawEffectDate) : null;
    const receiptId = entry['receiptId'];
    const attemptCount = entry['attemptCount'];
    if (
      typeof providerId !== 'number' || typeof category !== 'string' ||
      (status !== 'confirmed' && status !== 'failed' && status !== 'unresolved') ||
      effectDate === null || (typeof receiptId !== 'string' && receiptId !== null) ||
      typeof attemptCount !== 'number' || !Number.isSafeInteger(attemptCount) || attemptCount < 1
    ) {
      return undefined;
    }
    providers.push({ providerId, category, status, eventDate: effectDate, receiptId, attemptCount });
  }
  const rawError = parsed['error'];
  const error = typeof rawError === 'string' && CLOSE_ERRORS.has(rawError as CloseSubmissionError)
    ? rawError as CloseSubmissionError
    : null;
  if (providers.length === 0 && status !== 'failed' && error === null) return undefined;
  if (providers.length > 0) {
    const confirmed = providers.filter((provider) => provider.status === 'confirmed').length;
    const expectedStatus = confirmed === providers.length
      ? 'success'
      : confirmed > 0 ? 'partial' : 'failed';
    if (status !== expectedStatus) return undefined;
  }
  return { status, eventDate, providers, error };
}

export function buildCloseSubmissionReceipt(
  outputs: readonly { tool: string; output: string }[],
): CloseSubmissionInput | null {
  const last = outputs.filter((entry) => entry.tool === 'finish_plan').at(-1);
  if (!last) return null;
  const outcome = parseFinishPlanTurnOutcome(last.output);
  return outcome ?? null;
}

/**
 * R5 authoritative close blockers. Computes the remaining unmet close
 * preconditions from merged validated state (never from raw extraction
 * nulls): incomplete contact, missing user-backed event date, no eligible
 * selection, or a shortlisted need still awaiting choice. Typed evidence
 * for the reply model only; never reply prose and never intent routing.
 */
export type CloseBlocker =
  | 'missing_contact_fields'
  | 'missing_event_date'
  | 'no_selected_providers'
  | 'unresolved_provider_choice';

export function resolveCloseBlockers(args: {
  readonly contactComplete: boolean;
  readonly eventDateAvailable: boolean;
  readonly hasEligibleSelection: boolean;
  readonly hasUnresolvedShortlist: boolean;
}): CloseBlocker[] {
  const blockers: CloseBlocker[] = [];
  if (!args.eventDateAvailable) blockers.push('missing_event_date');
  if (!args.contactComplete) blockers.push('missing_contact_fields');
  if (!args.hasEligibleSelection) blockers.push('no_selected_providers');
  if (args.hasUnresolvedShortlist) blockers.push('unresolved_provider_choice');
  return blockers;
}
