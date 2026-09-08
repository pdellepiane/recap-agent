import type { ToolInputTrace, ToolOutputTrace } from '../core/trace';

export type FinishPlanSummaryTrace = {
  status: 'success' | 'partial' | 'failed' | null;
  eventDate: string | null;
  confirmedCount: number;
  pendingProviderIds: number[];
  errorKind: string | null;
};

export type ProviderQuoteReceiptTrace = {
  providerId: number;
  eventDate: string;
  resultStatus: 'confirmed' | 'failed' | 'unresolved';
  attempt: number;
};

type ToolUsageLike = {
  inputs: ToolInputTrace[];
  outputs: ToolOutputTrace[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function classifyFinishPlanErrorKind(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return 'failed';
  const text = value.toLowerCase();
  if (text.length === 0) return null;
  if (text.includes('missing_event_date') || text.includes('missing event date')) return 'missing_event_date';
  if (text.includes('invalid_event_date') || text.includes('invalid event date')) return 'invalid_event_date';
  if (text.includes('missing_contact') || text.includes('missing contact')) return 'missing_contact_info';
  if (text.includes('invalid_contact') || text.includes('invalid contact')) return 'invalid_contact_info';
  if (text.includes('no_selected') || text.includes('no selected')) return 'no_selected_providers';
  if (text.includes('unknown')) return 'unresolved';
  if (text.includes('block') || text.includes('bloque')) return 'blocked_write';
  return 'failed';
}

function readLastFinishOutput(toolUsage: ToolUsageLike): Record<string, unknown> | null {
  const outputs = toolUsage.outputs.filter((entry) => entry.tool === 'finish_plan');
  const last = outputs[outputs.length - 1];
  if (!last) return null;
  const parsed = parseJson(last.output);
  return isRecord(parsed) ? parsed : null;
}

export function buildFinishPlanSummary(toolUsage: ToolUsageLike): FinishPlanSummaryTrace | null {
  const parsed = readLastFinishOutput(toolUsage);
  if (!parsed) return null;
  const status = parsed['status'];
  if (status !== 'success' && status !== 'partial' && status !== 'failed') return null;
  const rawDate = parsed['eventDate'];
  const eventDate = isValidDate(rawDate) ? rawDate : null;
  const rawProviders = parsed['contacted_providers'];
  const providers = Array.isArray(rawProviders) ? rawProviders : null;
  if (!providers) return null;
  let confirmedCount = 0;
  const pendingProviderIds: number[] = [];
  let errorKind: string | null = null;
  if (status === 'failed' && providers.length === 0) {
    errorKind = classifyFinishPlanErrorKind(parsed['error'] ?? parsed['detail']);
  }
  for (const entry of providers) {
    if (!isRecord(entry)) continue;
    const providerId = entry['providerId'];
    const success = entry['success'];
    if (typeof providerId !== 'number' || typeof success !== 'boolean') continue;
    if (success) {
      confirmedCount += 1;
    } else {
      pendingProviderIds.push(providerId);
      errorKind = errorKind ?? classifyFinishPlanErrorKind(entry['error'] ?? status);
    }
  }
  return { status, eventDate, confirmedCount, pendingProviderIds, errorKind };
}

export function buildProviderQuoteReceipts(toolUsage: ToolUsageLike): ProviderQuoteReceiptTrace[] {
  const parsed = readLastFinishOutput(toolUsage);
  if (!parsed) return [];
  const rawFallback: unknown = parsed['eventDate'];
  const fallbackDate = isValidDate(rawFallback) ? rawFallback : null;
  const rawEffects = parsed['effects'];
  if (Array.isArray(rawEffects) && rawEffects.length > 0) {
    const receipts: ProviderQuoteReceiptTrace[] = [];
    for (const entry of rawEffects) {
      if (!isRecord(entry)) continue;
      const providerId: unknown = entry['providerId'];
      if (typeof providerId !== 'number') continue;
      const rawEventDate: unknown = entry['eventDate'];
      const eventDate = isValidDate(rawEventDate) ? rawEventDate : fallbackDate;
      if (!eventDate) continue;
      const status = entry['status'];
      const resultStatus = status === 'confirmed' || status === 'failed' || status === 'unresolved' ? status : 'failed';
      const attemptRaw = entry['attemptCount'];
      const attempt = typeof attemptRaw === 'number' && Number.isSafeInteger(attemptRaw) && attemptRaw > 0 ? attemptRaw : 1;
      receipts.push({ providerId, eventDate, resultStatus, attempt });
    }
    return receipts;
  }
  const rawProviders = parsed['contacted_providers'];
  if (!Array.isArray(rawProviders) || !fallbackDate) return [];
  const receipts: ProviderQuoteReceiptTrace[] = [];
  for (const entry of rawProviders) {
    if (!isRecord(entry)) continue;
    const providerId = entry['providerId'];
    const success = entry['success'];
    if (typeof providerId !== 'number' || typeof success !== 'boolean') continue;
    receipts.push({
      providerId,
      eventDate: fallbackDate,
      resultStatus: success ? 'confirmed' : 'failed',
      attempt: 1,
    });
  }
  return receipts;
}
