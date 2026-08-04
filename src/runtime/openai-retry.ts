import type {
  ModelRetryNormalizedError,
  RetryPolicy,
} from '@openai/agents';

const permanentErrorCodes = new Set([
  'insufficient_quota',
  'invalid_api_key',
  'authentication_error',
  'permission_denied',
  'invalid_request_error',
  'model_not_found',
  'billing_hard_limit_reached',
]);

export type OpenAiRetryClassification = {
  retryable: boolean;
  delayMs?: number;
  reason: string;
};

export function classifyOpenAiRetry(
  error: unknown,
  normalized?: Partial<ModelRetryNormalizedError>,
): OpenAiRetryClassification {
  const code = findStringField(error, ['code', 'errorCode', 'type']);
  if (code && permanentErrorCodes.has(code.toLowerCase())) {
    return { retryable: false, reason: `permanent_code:${code.toLowerCase()}` };
  }

  const statusCode =
    normalized?.statusCode ?? findNumberField(error, ['status', 'statusCode']);
  const delayMs =
    normalized?.retryAfterMs ?? readRetryAfterMs(error);
  const isNetworkError =
    normalized?.isNetworkError ?? isNetworkOrTimeoutError(error);

  if (isNetworkError) {
    return { retryable: true, delayMs, reason: 'transient_network' };
  }
  if (statusCode === 408) {
    return { retryable: true, delayMs, reason: 'transient_timeout' };
  }
  if (statusCode === 429) {
    return { retryable: true, delayMs, reason: 'transient_rate_limit' };
  }
  if (typeof statusCode === 'number' && statusCode >= 500) {
    return { retryable: true, delayMs, reason: 'transient_server' };
  }
  if (typeof statusCode === 'number' && statusCode >= 400) {
    return { retryable: false, reason: `permanent_http_${statusCode}` };
  }

  return { retryable: false, reason: 'unknown_non_retryable' };
}

export const openAiRetryPolicy: RetryPolicy = ({ error, normalized }) => {
  const classification = classifyOpenAiRetry(error, normalized);
  if (!classification.retryable) {
    return { retry: false, reason: classification.reason };
  }
  return {
    retry: true,
    delayMs: classification.delayMs,
    reason: classification.reason,
  };
};

export async function executeWithOpenAiRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maximumDelayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<{ value: T; attemptCount: number }> {
  const maxAttempts = options.maxAttempts ?? 4;
  const initialDelayMs = options.initialDelayMs ?? 1_000;
  const maximumDelayMs = options.maximumDelayMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { value: await operation(), attemptCount: attempt };
    } catch (error) {
      const classification = classifyOpenAiRetry(error);
      if (!classification.retryable || attempt === maxAttempts) {
        throw error;
      }
      const exponentialDelay = Math.min(
        initialDelayMs * 2 ** (attempt - 1),
        maximumDelayMs,
      );
      await sleep(classification.delayMs ?? exponentialDelay);
    }
  }

  throw new Error('OpenAI retry loop exhausted unexpectedly.');
}

function findStringField(
  value: unknown,
  keys: readonly string[],
  seen = new Set<object>(),
): string | undefined {
  if (!isRecord(value) || seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  for (const nested of Object.values(value)) {
    const candidate = findStringField(nested, keys, seen);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function findNumberField(
  value: unknown,
  keys: readonly string[],
  seen = new Set<object>(),
): number | undefined {
  if (!isRecord(value) || seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  for (const nested of Object.values(value)) {
    const candidate = findNumberField(nested, keys, seen);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

function readRetryAfterMs(error: unknown): number | undefined {
  const headers = findHeaders(error);
  if (!headers) {
    return undefined;
  }
  const milliseconds = readHeader(headers, 'retry-after-ms');
  if (milliseconds !== undefined) {
    const parsed = Number(milliseconds);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  const seconds = readHeader(headers, 'retry-after');
  if (seconds === undefined) {
    return undefined;
  }
  const parsedSeconds = Number(seconds);
  if (Number.isFinite(parsedSeconds) && parsedSeconds >= 0) {
    return parsedSeconds * 1_000;
  }
  const date = Date.parse(seconds);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function findHeaders(error: unknown): Headers | Record<string, unknown> | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  for (const key of ['headers', 'responseHeaders']) {
    const candidate = error[key];
    if (candidate instanceof Headers || isRecord(candidate)) {
      return candidate;
    }
  }
  return findHeaders(error.cause);
}

function readHeader(
  headers: Headers | Record<string, unknown>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );
  return typeof entry?.[1] === 'string' ? entry[1] : undefined;
}

function isNetworkOrTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : undefined;
  if (
    name === 'APIConnectionError' ||
    name === 'APIConnectionTimeoutError' ||
    name === 'FetchError' ||
    name === 'TimeoutError'
  ) {
    return true;
  }
  const code = findStringField(error, ['code']);
  return Boolean(code && [
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
  ].includes(code.toUpperCase()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
