import crypto from 'node:crypto';

import { parseInternationalPhone } from '../runtime/phone';

/**
 * Protected exact-payload capture for inbound channel HTTP failures.
 *
 * When a request fails before schema validation (invalid JSON, invalid
 * request shape), the validated identity (channel/user/message id) is
 * unavailable, so the failure cannot be joined to the sender's adapter HTTP
 * records. This module provides two join aids:
 *
 * - A cross-system correlation id, resolved without adapter cooperation:
 *   an explicit `x-recap-correlation-id` header wins when present;
 *   otherwise the channel-native `message_id` already on the request is
 *   used verbatim when it matches the opaque-id shape (or hashed when it
 *   does not), so retries of one inbound share one id; requests without
 *   any usable message identity fall back to the Lambda request id. Every
 *   response (including 400) carries the id in its headers and body, and
 *   every outcome logs it.
 * - A protected capture of the exact raw bytes: sha256 + byte length prove
 *   the exact payload, while the log carries only a structural skeleton,
 *   key inventory, and sha256 hashes of identity fields. No raw customer
 *   content, phone, message text, or credential ever reaches the log.
 *
 * Capture runs only on authenticated requests (after the Bearer [REDACTED] check),
 * so unauthenticated probes leave no payload-derived trace.
 */

export const CORRELATION_HEADER_NAME = 'x-recap-correlation-id';

export const CORRELATION_ID_MAX_LENGTH = 128;

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:~=-]+$/u;

export type CorrelationSource =
  | 'inbound_header'
  | 'native_message'
  | 'derived_message'
  | 'lambda_request';

export type RequestCorrelation = {
  correlationId: string;
  source: CorrelationSource;
};

export type ProtectedPayloadBodyParse =
  | 'json_object'
  | 'json_array'
  | 'json_scalar'
  | 'invalid_json'
  | 'empty';

export type ProtectedPayloadIdentityHashes = {
  /** Raw channel only when it matches a narrow token shape; otherwise omitted. */
  channel?: string;
  messageIdSha256?: string;
  userIdSha256?: string;
  contactPhoneSha256?: string;
  /** Phone parser outcome for the raw contact_phone value, e.g. valid|invalid:unsupported_country_code. */
  contactPhoneParse?: string;
};

export type ProtectedPayloadCapture = {
  bodyBytes: number;
  bodySha256: string;
  bodyParse: ProtectedPayloadBodyParse;
  /** Sorted `key:type` inventory of top-level object keys, bounded. */
  topLevelFields?: string[];
  /** Element count for top-level JSON arrays. */
  arrayLength?: number;
  /** Sorted unique element types for top-level JSON arrays, bounded. */
  arrayElementTypes?: string[];
  /**
   * Structural skeleton of the payload shape, bounded. Derived only from
   * key names, value types, and lengths; never contains raw values.
   */
  structureSkeleton: string;
  /** Hashed pre-validation identity fields for JSON objects, when present and bounded. */
  identityHashes?: ProtectedPayloadIdentityHashes;
};

export const PAYLOAD_SKELETON_MAX_LENGTH = 500;
export const PAYLOAD_TOP_LEVEL_FIELD_LIMIT = 32;
export const PAYLOAD_FIELD_KEY_MAX_LENGTH = 64;
const PAYLOAD_IDENTITY_VALUE_MAX_LENGTH = 256;
const CHANNEL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function readInboundCorrelationId(
  headers: Record<string, string | undefined>,
): string | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== CORRELATION_HEADER_NAME) {
      continue;
    }
    const trimmed = value?.trim() ?? '';
    if (
      trimmed.length === 0 ||
      trimmed.length > CORRELATION_ID_MAX_LENGTH ||
      !CORRELATION_ID_PATTERN.test(trimmed)
    ) {
      return null;
    }
    return trimmed;
  }
  return null;
}

export function resolveRequestCorrelation(
  headers: Record<string, string | undefined>,
  requestId: string,
  rawBody?: string | null,
): RequestCorrelation {
  const inbound = readInboundCorrelationId(headers);
  if (inbound) {
    return { correlationId: inbound, source: 'inbound_header' };
  }
  // No adapter cooperation needed: the contract already requires the adapter
  // to send the channel-native message id, so derive a stable correlation
  // from it. Retries of the same inbound share one id; this value is a join
  // key only and is never trusted for authorization.
  const messageDerived = readMessageDerivedCorrelationId(rawBody);
  if (messageDerived) {
    return messageDerived;
  }
  return { correlationId: requestId, source: 'lambda_request' };
}

function readMessageDerivedCorrelationId(rawBody: string | null | undefined): RequestCorrelation | null {
  if (!rawBody) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const messageId = boundedString((parsed as Record<string, unknown>).message_id);
  if (!messageId) {
    return null;
  }
  if (messageId.length <= CORRELATION_ID_MAX_LENGTH && CORRELATION_ID_PATTERN.test(messageId)) {
    return { correlationId: messageId, source: 'native_message' };
  }
  return {
    correlationId: `auto-${sha256Hex(messageId).slice(0, 32)}`,
    source: 'derived_message',
  };
}

export function captureProtectedPayload(
  rawBody: string | undefined | null,
): ProtectedPayloadCapture | null {
  if (!rawBody) {
    return null;
  }
  const bodyBytes = Buffer.byteLength(rawBody, 'utf8');
  const bodySha256 = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return {
      bodyBytes,
      bodySha256,
      bodyParse: 'invalid_json',
      structureSkeleton: `unparseable{bytes:${bodyBytes}}`,
    };
  }
  if (Array.isArray(parsed)) {
    const elementTypes = sortedUnique(parsed.map(describeValueType).slice(0, 8));
    return {
      bodyBytes,
      bodySha256,
      bodyParse: 'json_array',
      arrayLength: parsed.length,
      arrayElementTypes: elementTypes,
      structureSkeleton: boundSkeleton(`array{length:${parsed.length},types:[${elementTypes.join(',')}]}`),
    };
  }
  if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const topLevelFields = keys
      .slice(0, PAYLOAD_TOP_LEVEL_FIELD_LIMIT)
      .map((key) => `${key.slice(0, PAYLOAD_FIELD_KEY_MAX_LENGTH)}:${describeValueType(record[key])}`);
    return {
      bodyBytes,
      bodySha256,
      bodyParse: 'json_object',
      topLevelFields,
      structureSkeleton: boundSkeleton(`object{keys:${keys.length},fields:[${topLevelFields.join(',')}]}`),
      ...optionalIdentityHashes(record),
    };
  }
  return {
    bodyBytes,
    bodySha256,
    bodyParse: 'json_scalar',
    structureSkeleton: `scalar:${describeValueType(parsed)}`,
  };
}

function optionalIdentityHashes(
  record: Record<string, unknown>,
): { identityHashes?: ProtectedPayloadIdentityHashes } {
  const identityHashes: ProtectedPayloadIdentityHashes = {};
  const channel = boundedString(record.channel);
  if (channel && CHANNEL_TOKEN_PATTERN.test(channel)) {
    identityHashes.channel = channel;
  }
  const messageId = boundedString(record.message_id);
  if (messageId) {
    identityHashes.messageIdSha256 = sha256Hex(messageId);
  }
  const userId = boundedString(record.user_id);
  if (userId) {
    identityHashes.userIdSha256 = sha256Hex(userId);
  }
  const contactPhone = boundedString(record.contact_phone);
  if (contactPhone) {
    identityHashes.contactPhoneSha256 = sha256Hex(contactPhone);
    const parsed = parseInternationalPhone(contactPhone);
    identityHashes.contactPhoneParse = parsed.status === 'valid'
      ? 'valid'
      : `invalid:${parsed.reason}`;
  }
  if (Object.keys(identityHashes).length === 0) {
    return {};
  }
  return { identityHashes };
}

function boundedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > PAYLOAD_IDENTITY_VALUE_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function describeValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'object') {
    return kind;
  }
  return 'unknown';
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function boundSkeleton(value: string): string {
  return value.slice(0, PAYLOAD_SKELETON_MAX_LENGTH);
}
