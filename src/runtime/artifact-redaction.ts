import type { PlanSnapshot } from '../core/plan';

export type ArtifactJsonValue =
  | string
  | number
  | boolean
  | null
  | ArtifactJsonValue[]
  | { [key: string]: ArtifactJsonValue };

const sensitiveKeyPattern = /^(?:access[_-]?token|refresh[_-]?token|bearer[_-]?token|jwt|token|otp|one[_-]?time[_-]?password|passcode|verification[_-]?code|code|email|contact[_-]?email|phone|contact[_-]?phone|phone[_-]?extension|phone[_-]?number|full[_-]?phone|phoneNumber|phoneExtension)$/iu;

/**
 * Projects structured JSON without applying content heuristics to structural values.
 * Sensitive data is removed only when its property name identifies the value.
 */
export function redactArtifactValue(value: unknown): ArtifactJsonValue {
  return projectValue(value);
}

export function redactArtifactRecord(value: unknown): Record<string, ArtifactJsonValue> {
  const redacted = redactArtifactValue(value);
  return isRecord(redacted) ? redacted : {};
}

/**
 * Contextual redaction is reserved for user/assistant free text. Callers must not
 * use this helper for IDs, hashes, timestamps, status values, or typed responses.
 */
export function redactArtifactText(value: string): string {
  return value
    .replace(/\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted-token]')
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|bearer[_-]?token|jwt|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/giu, '$1[redacted-token]')
    .replace(/(["']?(?:otp|passcode|verification[_-]?code|code)["']?\s*[:=]\s*["']?)[^\s,"'}]+/giu, '$1[redacted-code]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[redacted-email]')
    .replace(/(?<![\d-])\+?(?!\d{4}-\d{2}-\d{2}(?:T|\b))\d[\d\s().-]{7,}\d/gu, '[redacted-phone]')
    .replace(/(?<![-\d])(?!(?:19|20)\d{2}(?!\d))\d{4,8}(?![-\d])/gu, '[redacted-code]');
}

/**
 * Projects trace diagnostics for terminal/assessment output. Each known tool
 * carries a bounded allowlisted summary; unknown tools stay omitted.
 * Safety net: any summary leaking email/JWT/stack reverts to omitted.
 */
export function projectSafeTrace(value: unknown): Record<string, ArtifactJsonValue> {
  const projected = redactArtifactRecord(value);
  return {
    ...projected,
    ...(Array.isArray(projected.tool_inputs)
      ? {
          tool_inputs: projected.tool_inputs.map((entry) =>
            isRecord(entry)
              ? {
                  ...entry,
                  input: projectToolInput(entry),
                }
              : entry,
          ),
        }
      : {}),
    ...(Array.isArray(projected.tool_outputs)
      ? {
          tool_outputs: projected.tool_outputs.map((entry) =>
            isRecord(entry)
              ? {
                  ...entry,
                  output: projectToolOutput(entry),
                }
              : entry,
          ),
        }
      : {}),
  };
}

const FINISH_PLAN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isFinishPlanDate(value: unknown): value is string {
  if (typeof value !== 'string' || !FINISH_PLAN_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function parseTraceJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function classifyErrorKind(value: unknown): string {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (text.includes('missing_event_date')) return 'missing_event_date';
  if (text.includes('invalid_event_date')) return 'invalid_event_date';
  if (text.includes('missing_contact')) return 'missing_contact_info';
  if (text.includes('invalid_contact')) return 'invalid_contact_info';
  if (text.includes('no_selected')) return 'no_selected_providers';
  if (text.includes('unknown')) return 'unresolved';
  if (text.includes('block') || text.includes('bloque')) return 'blocked_write';
  return 'failed';
}

function projectToolInput(entry: Record<string, ArtifactJsonValue>): ArtifactJsonValue {
  const tool = entry['tool'];
  if (typeof tool !== 'string') return '[omitted]';
  if (tool === 'finish_plan') return projectFinishPlanInput(entry);
  const parsed = parseTraceJson(entry['input']);
  if (!parsed) return '[omitted]';
  const summary = summarizeToolInput(tool, parsed);
  if (!summary) return '[omitted]';
  return emitSummary(summary);
}

function projectToolOutput(entry: Record<string, ArtifactJsonValue>): ArtifactJsonValue {
  const tool = entry['tool'];
  if (typeof tool !== 'string') return '[omitted]';
  if (tool === 'finish_plan') return projectFinishPlanOutput(entry);
  const parsed = parseTraceJson(entry['output']);
  if (!parsed) return '[omitted]';
  const summary = summarizeToolOutput(tool, parsed);
  if (!summary) return '[omitted]';
  return emitSummary(summary);
}

function emitSummary(summary: Record<string, unknown>): ArtifactJsonValue {
  const text = JSON.stringify(summary);
  if (leaksBannedValue(text)) return '[omitted]';
  return text;
}

function leaksBannedValue(text: string): boolean {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(text)) return true;
  if (/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u.test(text)) return true;
  if (/\n\s*at\s/u.test(text)) return true;
  if (/(?:queue|ticket|synth-[a-z0-9-]{16,})/iu.test(text)) return true;
  return false;
}

function safeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function safeEnum(value: unknown, maxLen = 48): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLen) return null;
  if (!/^[a-z0-9_.-]+$/iu.test(value)) return null;
  return value;
}

function safeCategory(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  if (!/^[a-z0-9_ ñáéíóú-]+$/iu.test(value)) return null;
  return value;
}

function strLen(value: unknown): number | null {
  return typeof value === 'string' ? Math.min(value.length, 5000) : null;
}

function summarizeToolInput(tool: string, parsed: Record<string, unknown>): Record<string, unknown> | null {
  switch (tool) {
    case 'list_categories':
    case 'list_locations':
    case 'search_providers_from_plan':
    case 'get_relevant_providers':
      return {};
    case 'get_category_by_slug': {
      const slug = safeEnum(parsed['slug'], 64);
      return slug ? { slug } : null;
    }
    case 'search_providers_by_keyword': {
      const page = safeInt(parsed['page']);
      const len = strLen(parsed['keyword']);
      if (len === null) return null;
      return { keyword_length: len, page };
    }
    case 'search_providers_by_category_location': {
      const category = safeCategory(parsed['category']);
      if (!category) return null;
      return { category, location_length: strLen(parsed['location']), page: safeInt(parsed['page']) };
    }
    case 'search_providers_by_query_intent': {
      const category = safeCategory(parsed['category']);
      if (!category) return null;
      const queries = parsed['queryStrings'];
      return {
        category,
        query_count: Array.isArray(queries) ? queries.length : null,
        location_present: parsed['location'] !== null && parsed['location'] !== undefined,
        fit_criteria_present: parsed['fitCriteria'] !== null && parsed['fitCriteria'] !== undefined,
      };
    }
    case 'get_provider_detail':
    case 'get_provider_detail_and_track_view':
    case 'get_related_providers':
    case 'list_provider_reviews': {
      const providerId = safeInt(parsed['provider_id'] ?? parsed['providerId']);
      return providerId !== null ? { provider_id: providerId } : null;
    }
    case 'get_event_vendor_context': {
      const eventId = safeInt(parsed['event_id'] ?? parsed['eventId']);
      return eventId !== null ? { event_id: eventId } : null;
    }
    case 'list_event_favorite_providers': {
      const eventId = safeInt(parsed['event_id'] ?? parsed['eventId']);
      if (eventId === null) return null;
      return {
        event_id: eventId,
        page: safeInt(parsed['page']),
        category_id: safeInt(parsed['category_id'] ?? parsed['categoryId']),
        sort_present: parsed['sort_by'] !== null && parsed['sort_by'] !== undefined,
      };
    }
    case 'list_user_events_vendor_context':
      return { user_ref_present: parsed['user_id'] !== null && parsed['user_id'] !== undefined };
    case 'create_quote_request': {
      const providerId = safeInt(parsed['provider_id'] ?? parsed['providerId']);
      if (providerId === null) return null;
      const rawDate = parsed['event_date'] ?? parsed['eventDate'];
      return {
        provider_id: providerId,
        event_date: isFinishPlanDate(rawDate) ? rawDate : null,
        guests_range_length: strLen(parsed['guests_range'] ?? parsed['guestsRange']),
        description_length: strLen(parsed['description']),
      };
    }
    case 'add_vendor_to_event_favorites': {
      const providerId = safeInt(parsed['provider_id'] ?? parsed['providerId']);
      const eventId = safeInt(parsed['event_id'] ?? parsed['eventId']);
      if (providerId === null || eventId === null) return null;
      return { provider_id: providerId, event_id: eventId, user_ref_present: parsed['user_id'] !== undefined };
    }
    case 'create_provider_review': {
      const providerId = safeInt(parsed['provider_id'] ?? parsed['providerId']);
      const rating = safeInt(parsed['rating']);
      if (providerId === null) return null;
      return {
        provider_id: providerId,
        rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
        comment_length: strLen(parsed['comment']),
        user_ref_present: parsed['user_id'] !== undefined,
      };
    }
    case 'guest_rsvp': {
      const guestId = safeInt(parsed['guest_id'] ?? parsed['guestId']);
      if (guestId === null) return null;
      return {
        action: safeEnum(parsed['action'], 24),
        guest_id: guestId,
        trusted_phone_present: parsed['trusted_phone_present'] === true,
        previous_state: safeEnum(parsed['previous_state'], 24),
      };
    }
    case 'lookup_rsvp_invitations':
    case 'lookup_guest_events_by_phone':
      return { trusted_phone_present: parsed['trusted_phone_present'] === true };
    case 'get_guest_event_detail': {
      const eventId = safeInt(parsed['event_id'] ?? parsed['eventId']);
      if (eventId === null) return null;
      return { event_id: eventId, trusted_phone_present: parsed['trusted_phone_present'] === true };
    }
    case 'knowledge_base_search':
    case 'associated_event_lookup':
    case 'agent_api_purchase_lookup':
      return {
        kind: safeEnum(parsed['kind'], 48),
        status: safeEnum(parsed['status'], 48),
        request_present: parsed['request_id'] !== undefined || parsed['requestId'] !== undefined,
      };
    default:
      return null;
  }
}

function collectProviderIds(value: unknown, limit = 10): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const item of value) {
    if (ids.length >= limit) break;
    if (typeof item === 'number' && Number.isSafeInteger(item)) {
      ids.push(item);
      continue;
    }
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const id = record['id'] ?? record['providerId'] ?? record['provider_id'] ?? record['eventId'] ?? record['guestId'];
      if (typeof id === 'number' && Number.isSafeInteger(id)) ids.push(id);
    }
  }
  return ids;
}

function countArrayField(parsed: Record<string, unknown>): { count: number; ids: number[] } {
  const keys = ['providers', 'results', 'items', 'events', 'categories', 'locations', 'reviews', 'favorites', 'invitations', 'candidates'];
  for (const key of keys) {
    if (Array.isArray(parsed[key])) {
      const arr = parsed[key] as unknown[];
      return { count: arr.length, ids: collectProviderIds(arr) };
    }
  }
  return { count: 0, ids: [] };
}

function summarizeToolOutput(tool: string, parsed: Record<string, unknown>): Record<string, unknown> | null {
  switch (tool) {
    case 'list_categories':
    case 'list_locations':
    case 'search_providers_from_plan':
    case 'search_providers_by_keyword':
    case 'search_providers_by_category_location':
    case 'search_providers_by_query_intent':
    case 'get_relevant_providers':
    case 'get_related_providers':
    case 'get_event_vendor_context':
    case 'list_event_favorite_providers':
    case 'list_user_events_vendor_context': {
      const { count, ids } = countArrayField(parsed);
      const status = safeEnum(parsed['status'], 32);
      return { result_kind: 'collection', count, provider_ids: ids, ...(status ? { status } : {}) };
    }
    case 'get_provider_detail':
    case 'get_provider_detail_and_track_view': {
      const id = safeInt(parsed['id'] ?? parsed['providerId'] ?? parsed['provider_id']);
      return { result_kind: 'detail', found: id !== null, ...(id !== null ? { provider_id: id } : {}) };
    }
    case 'list_provider_reviews': {
      const { count } = countArrayField(parsed);
      return { result_kind: 'reviews', count, provider_id: safeInt(parsed['provider_id'] ?? parsed['providerId']) };
    }
    case 'create_quote_request': {
      const status = safeEnum(parsed['status'] ?? parsed['resultStatus'], 32) ?? 'unknown';
      const rawDate = parsed['eventDate'] ?? parsed['event_date'];
      const rawId = parsed['id'] ?? parsed['syntheticId'] ?? parsed['receiptId'];
      const idStr = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;
      return {
        result_kind: 'write',
        result_status: status,
        provider_id: safeInt(parsed['providerId'] ?? parsed['provider_id']),
        event_date: isFinishPlanDate(rawDate) ? rawDate : null,
        id_prefix: idStr ? idStr.slice(0, 8) : null,
        id_length: idStr ? Math.min(idStr.length, 200) : null,
        ...(parsed['error'] !== undefined ? { error_kind: classifyErrorKind(parsed['error']) } : {}),
      };
    }
    case 'add_vendor_to_event_favorites':
    case 'create_provider_review': {
      const status = safeEnum(parsed['status'] ?? parsed['resultStatus'], 32) ?? 'unknown';
      return {
        result_kind: 'write',
        result_status: status,
        provider_id: safeInt(parsed['providerId'] ?? parsed['provider_id']),
        ...(parsed['error'] !== undefined ? { error_kind: classifyErrorKind(parsed['error']) } : {}),
      };
    }
    case 'guest_rsvp': {
      const status = safeEnum(parsed['status'], 32);
      if (!status) return null;
      return {
        status,
        action: safeEnum(parsed['action'], 24),
        guest_id: safeInt(parsed['guest_id'] ?? parsed['guestId']),
      };
    }
    case 'lookup_rsvp_invitations': {
      const status = safeEnum(parsed['status'], 48);
      if (!status) return null;
      const inv = parsed['invitations'];
      return { status, invitation_count: Array.isArray(inv) ? inv.length : 0 };
    }
    case 'lookup_guest_events_by_phone': {
      const status = safeEnum(parsed['status'], 48);
      return status ? { status } : null;
    }
    case 'get_guest_event_detail': {
      const status = safeEnum(parsed['status'], 32);
      if (!status) return null;
      return {
        status,
        attendance_present: parsed['attendance_present'] === true,
        purchase_count: safeInt(parsed['purchase_count']),
      };
    }
    case 'knowledge_base_search':
    case 'associated_event_lookup':
    case 'agent_api_purchase_lookup': {
      const status = safeEnum(parsed['status'], 32);
      if (!status) return null;
      return { kind: safeEnum(parsed['kind'], 48), status };
    }
    default:
      return null;
  }
}
function projectFinishPlanInput(entry: Record<string, ArtifactJsonValue>): ArtifactJsonValue {
  if (entry['tool'] !== 'finish_plan' || typeof entry['input'] !== 'string') return '[omitted]';
  const parsed = parseTraceJson(entry['input']);
  const eventDate = parsed?.['event_date'];
  if (!isFinishPlanDate(eventDate)) return '[omitted]';
  return JSON.stringify({ event_date: eventDate });
}

function projectFinishPlanOutput(entry: Record<string, ArtifactJsonValue>): ArtifactJsonValue {
  if (entry['tool'] !== 'finish_plan' || typeof entry['output'] !== 'string') return '[omitted]';
  const parsed = parseTraceJson(entry['output']);
  if (!parsed) return '[omitted]';
  const status = parsed['status'];
  if (status !== 'success' && status !== 'partial' && status !== 'failed') return '[omitted]';
  const rawDate = parsed['eventDate'];
  const eventDate = isFinishPlanDate(rawDate) ? rawDate : null;
  const rawProviders: unknown = parsed['contacted_providers'];
  if (!Array.isArray(rawProviders)) return '[omitted]';
  const contactedProviders: ArtifactJsonValue[] = [];
  for (const item of rawProviders as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as unknown as Record<string, unknown>;
    const providerId: unknown = record['providerId'];
    const category: unknown = record['category'];
    const success: unknown = record['success'];
    if (typeof providerId !== 'number' || typeof category !== 'string' || typeof success !== 'boolean') continue;
    contactedProviders.push({
      providerId,
      category,
      success,
      ...(success ? {} : { error_kind: classifyErrorKind(record['error']) }),
    });
  }
  return JSON.stringify({ status, eventDate, contacted_providers: contactedProviders });
}

/** Projects a validated typed record without validating the redacted value again. */
export function projectSafeRecord<T extends Record<string, unknown>>(value: T): T {
  return redactArtifactRecord(value) as T;
}

/**
 * Projects a validated plan for explicit terminal diagnostics. The full plan is
 * retained only by the caller's in-process state, never by evaluator artifacts.
 */
export function projectSafePlan(plan: PlanSnapshot): PlanSnapshot {
  return {
    ...plan,
    contact_email: null,
    contact_phone: null,
    contact_phone_extension: null,
    contact_phone_number: null,
    user_auth: {
      ...plan.user_auth,
      email: null,
      token: null,
    },
    human_escalation: {
      ...plan.human_escalation,
      phone_number: null,
    },
  };
}

function projectValue(value: unknown, key?: string): ArtifactJsonValue {
  if (
    key !== undefined &&
    sensitiveKeyPattern.test(key) &&
    typeof value !== 'boolean'
  ) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => projectValue(entry));
  }
  if (isUnknownRecord(value)) {
    const output: { [key: string]: ArtifactJsonValue } = {};
    for (const [entryKey, entry] of Object.entries(value)) {
      if (entry === undefined) {
        continue;
      }
      output[entryKey] = projectValue(entry, entryKey);
    }
    return output;
  }
  return null;
}

function isRecord(value: ArtifactJsonValue): value is Record<string, ArtifactJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
