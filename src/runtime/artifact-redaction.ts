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
 * Projects trace diagnostics for terminal/assessment output. Only finish_plan
 * carries an allowlisted debug subset; all other tool payloads stay omitted.
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
                  input: projectFinishPlanInput(entry),
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
                  output: projectFinishPlanOutput(entry),
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
