import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

type AuthObservabilityContext = {
  lambdaRequestId: string | null;
  authFlowId: string | null;
  planId: string | null;
};

type AuthLogLevel = 'info' | 'error';

const contextStorage = new AsyncLocalStorage<AuthObservabilityContext>();

const secretFieldNames = new Set([
  'access_token',
  'authorization',
  'bearer_token',
  'cookie',
  'jwt',
  'one_time_password',
  'otp',
  'passcode',
  'password',
  'refresh_token',
  'set-cookie',
  'token',
  'verification_code',
  'x-agent-key',
]);

export type AuthSecretDescription = {
  redacted: true;
  kind: 'secret' | 'bearer' | 'jwt';
  length: number;
  sha256: string;
  jwt?: {
    algorithm: string | null;
    type: string | null;
    issuer: string | null;
    subject: string | null;
    audience: string | string[] | null;
    issued_at: number | null;
    expires_at: number | null;
  };
};

export function withRequestObservabilityContext<T>(
  lambdaRequestId: string,
  callback: () => T,
): T {
  return contextStorage.run({
    lambdaRequestId,
    authFlowId: null,
    planId: null,
  }, callback);
}

export function withAuthenticationFlowContext<T>(
  args: { authFlowId: string; planId: string },
  callback: () => T,
): T {
  const current = contextStorage.getStore();
  return contextStorage.run({
    lambdaRequestId: current?.lambdaRequestId ?? null,
    authFlowId: args.authFlowId,
    planId: args.planId,
  }, callback);
}

export function createAuthOperationId(): string {
  return crypto.randomUUID();
}

export function logAuthObservabilityEvent(
  level: AuthLogLevel,
  event: string,
  details: Record<string, unknown>,
): void {
  const context = contextStorage.getStore();
  const sanitizedDetails = sanitizeAuthLogValue(details) as Record<string, unknown>;
  const record = {
    event,
    observed_at: new Date().toISOString(),
    lambda_request_id: context?.lambdaRequestId ?? null,
    auth_flow_id: context?.authFlowId ?? null,
    plan_id: context?.planId ?? null,
    ...sanitizedDetails,
  };
  if (level === 'error') {
    console.error(record);
    return;
  }
  console.info(record);
}

/**
 * Keeps diagnostic payloads intact except for fields that are credentials.
 * Secret values retain stable fingerprints and useful shape metadata so two
 * exchanges can be correlated without writing replayable credentials to logs.
 */
export function sanitizeAuthLogValue(
  value: unknown,
  key?: string,
  path: string[] = [],
): unknown {
  const normalizedKey = key?.toLocaleLowerCase('en-US');
  const isRequestCode =
    normalizedKey === 'code' && path.includes('request_body');
  if (
    normalizedKey &&
    (secretFieldNames.has(normalizedKey) || isRequestCode)
  ) {
    return describeAuthSecret(value);
  }
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value === 'string' ? redactEmbeddedCredentials(value) : value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return value.description ?? 'symbol';
  }
  if (typeof value === 'function') {
    return `[function ${value.name || 'anonymous'}]`;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuthLogValue(entry, undefined, path));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeAuthLogValue(entryValue, entryKey, [...path, entryKey]),
      ]),
    );
  }
  return 'unknown';
}

function redactEmbeddedCredentials(value: string): string {
  return value
    .replace(/\bBearer\s+([^\s,;]+)/giu, (_match, secret: string) => {
      const fingerprint = crypto.createHash('sha256').update(secret).digest('hex');
      return `Bearer [redacted sha256=${fingerprint}]`;
    })
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, (secret) => {
      const fingerprint = crypto.createHash('sha256').update(secret).digest('hex');
      return `[redacted-jwt sha256=${fingerprint}]`;
    });
}

export function responseHeadersForAuthLog(headers: Headers | undefined): Record<string, unknown> {
  if (!headers) {
    return {};
  }
  const result: Record<string, unknown> = {};
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      result[key] = sanitizeAuthLogValue(value, key);
    });
    return result;
  }
  for (const key of [
    'content-type',
    'date',
    'retry-after',
    'set-cookie',
    'x-amzn-requestid',
    'x-request-id',
  ]) {
    const value = headers.get(key);
    if (value !== null) {
      result[key] = sanitizeAuthLogValue(value, key);
    }
  }
  return result;
}

function describeAuthSecret(value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    return {
      redacted: true,
      present: false,
    };
  }
  if (typeof value !== 'string') {
    return {
      redacted: true,
      present: true,
      value_type: Array.isArray(value) ? 'array' : typeof value,
    };
  }

  const bearerMatch = /^Bearer\s+(.+)$/iu.exec(value.trim());
  const secret = bearerMatch?.[1] ?? value;
  const jwt = describeJwt(secret);
  return {
    redacted: true,
    kind: jwt ? 'jwt' : bearerMatch ? 'bearer' : 'secret',
    length: secret.length,
    sha256: crypto.createHash('sha256').update(secret).digest('hex'),
    ...(jwt ? { jwt } : {}),
  } satisfies AuthSecretDescription;
}

function describeJwt(value: string): AuthSecretDescription['jwt'] | null {
  const parts = value.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const header = parseJwtPart(parts[0]);
  const payload = parseJwtPart(parts[1]);
  if (!header || !payload) {
    return null;
  }
  return {
    algorithm: readString(header.alg),
    type: readString(header.typ),
    issuer: readString(payload.iss),
    subject: readString(payload.sub),
    audience: readAudience(payload.aud),
    issued_at: readNumber(payload.iat),
    expires_at: readNumber(payload.exp),
  };
}

function parseJwtPart(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readAudience(value: unknown): string | string[] | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value;
  }
  return null;
}
