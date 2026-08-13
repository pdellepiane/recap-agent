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
 * Projects trace diagnostics for terminal/assessment output. Tool payloads are
 * deliberately omitted rather than interpreted as free text or re-parsed.
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
                  input: '[omitted]'
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
                  output: '[omitted]'
                }
              : entry,
          ),
        }
      : {}),
  };
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
