import crypto from 'node:crypto';
import { z } from 'zod';

import { MAX_IMAGE_BYTES } from './inbound-image';

/**
 * Bounded image attachment references persisted on the event plan.
 * Discriminated file/url union with the linkage needed to project a stored
 * image later (inbound identity/order). Never bytes, base64, descriptions,
 * object-store keys, caller-supplied cross-conversation file IDs, or another
 * attachment database.
 *
 * - url: existing backend-pushed image link (linkage only, never downloaded).
 * - file: OpenAI Files reference for a validated base64 upload (purpose
 *   vision, one-day expiry). Identical bytes may share one file within a
 *   conversation, with distinct message linkage per delivery.
 */
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const urlAttachmentRefSchema = z.object({
  kind: z.literal('url').default('url'),
  url: z.string().trim().min(1).max(2048),
  messageId: z.string().trim().min(1).max(256),
  receivedAt: isoDateTimeSchema,
}).strict();

export const fileAttachmentRefSchema = z.object({
  kind: z.literal('file'),
  fileId: z.string().trim().min(1).max(256),
  expiresAt: isoDateTimeSchema,
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteLength: z.number().int().positive().max(MAX_IMAGE_BYTES),
  /** Conversation-scoped sha256 of the validated bytes, for upload reuse. */
  contentDigest: z.string().length(64),
  messageId: z.string().trim().min(1).max(256),
  receivedAt: isoDateTimeSchema,
}).strict();

function injectUrlKind(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ((record.kind === undefined || record.kind === null) && typeof record.url === 'string') {
      return { ...record, kind: 'url' };
    }
  }
  return value;
}

export const imageAttachmentRefSchema = z.preprocess(
  injectUrlKind,
  z.discriminatedUnion('kind', [urlAttachmentRefSchema, fileAttachmentRefSchema]),
);

export type UrlAttachmentRef = z.infer<typeof urlAttachmentRefSchema>;
export type FileAttachmentRef = z.infer<typeof fileAttachmentRefSchema>;
export type ImageAttachmentRef = UrlAttachmentRef | FileAttachmentRef;

export const MAX_IMAGE_ATTACHMENT_REFS = 5;
export const MAX_PROJECTED_IMAGE_URLS = 2;
/** At most two images ride a single model request (url or file refs). */
export const MAX_PROJECTED_IMAGE_ATTACHMENTS = 2;
/** Serialized refs must stay far below the plan item budget. */
export const MAX_IMAGE_ATTACHMENTS_JSON_BYTES = 16_384;
/** OpenAI Files expiry for vision uploads: created_at + 1 day (86400 s). */
export const IMAGE_FILE_EXPIRY_SECONDS = 86_400;

export function imageAttachmentsJsonBytes(refs: readonly ImageAttachmentRef[]): number {
  return Buffer.byteLength(JSON.stringify(refs), 'utf8');
}

/** Conversation-scoped digest of validated image bytes (upload reuse). */
export function contentDigestForBytes(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function refSortKey(ref: ImageAttachmentRef): string {
  return ref.kind === 'file' ? `file:${ref.fileId}` : `url:${ref.url}`;
}

function compareRecency(a: ImageAttachmentRef, b: ImageAttachmentRef): number {
  if (a.receivedAt < b.receivedAt) return -1;
  if (a.receivedAt > b.receivedAt) return 1;
  if (a.messageId < b.messageId) return -1;
  if (a.messageId > b.messageId) return 1;
  return 0;
}

/**
 * Idempotent append: duplicated delivery (same messageId + same file/url
 * identity) never duplicates the reference. Repeated identical bytes share
 * one file within a conversation but keep distinct message linkage. When at
 * capacity, a late event older than every stored ref is dropped so it cannot
 * evict newer context. Caller-supplied file IDs from another conversation
 * must never reach this function (see service ownership check).
 */
export function appendImageAttachmentRef(
  current: readonly ImageAttachmentRef[],
  incoming: unknown,
): ImageAttachmentRef[] {
  const parsed = imageAttachmentRefSchema.safeParse(incoming);
  if (!parsed.success) return [...current];
  const next = current.filter(
    (ref) => !(ref.messageId === parsed.data.messageId && refSortKey(ref) === refSortKey(parsed.data)),
  );
  next.push(parsed.data);
  next.sort(compareRecency);
  while (next.length > MAX_IMAGE_ATTACHMENT_REFS) {
    const incomingIndex = next.findIndex(
      (ref) => ref.messageId === parsed.data.messageId && refSortKey(ref) === refSortKey(parsed.data),
    );
    if (incomingIndex === 0) {
      // Late event older than stored context: drop the arrival, keep newer refs.
      next.splice(0, 1);
      break;
    }
    if (incomingIndex < 0) {
      next.shift();
      break;
    }
    next.shift();
  }
  if (imageAttachmentsJsonBytes(next) > MAX_IMAGE_ATTACHMENTS_JSON_BYTES) {
    return [...current];
  }
  return next;
}

export function mergeImageAttachmentRefs(
  current: readonly ImageAttachmentRef[] | undefined,
  update: readonly unknown[] | undefined,
): ImageAttachmentRef[] {
  let merged = [...(current ?? [])];
  for (const ref of update ?? []) {
    merged = appendImageAttachmentRef(merged, ref);
  }
  return merged;
}

/** True while the file reference is still usable (unexpired). */
export function isFileRefActive(ref: FileAttachmentRef, nowMs: number): boolean {
  const expiresMs = Date.parse(ref.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

/** Most recent active file ref sharing a content digest (upload reuse). */
export function findReusableFileRef(
  refs: readonly ImageAttachmentRef[],
  contentDigest: string,
  nowMs: number,
): FileAttachmentRef | null {
  const candidates = refs.filter(
    (ref): ref is FileAttachmentRef =>
      ref.kind === 'file' && ref.contentDigest === contentDigest && isFileRefActive(ref, nowMs),
  );
  candidates.sort((a, b) => -compareRecency(a, b));
  return candidates[0] ?? null;
}

/** Drop expired file refs; url refs carry no expiry and are kept. */
export function pruneExpiredFileRefs(
  refs: readonly ImageAttachmentRef[],
  nowMs: number,
): ImageAttachmentRef[] {
  return refs.filter((ref) => ref.kind === 'url' || isFileRefActive(ref, nowMs));
}

/** Most recent refs first, capped so later turns never resend every image. */
export function selectRecentImageAttachmentRefs(
  refs: readonly ImageAttachmentRef[],
  limit: number = MAX_PROJECTED_IMAGE_URLS,
): ImageAttachmentRef[] {
  return [...refs].sort((a, b) => -compareRecency(a, b)).slice(0, Math.max(0, limit));
}

/**
 * Active refs eligible for a follow-up model request: expired file refs are
 * excluded, the rest keep recency order, capped at two images per request.
 */
export function selectActiveImageAttachmentRefs(
  refs: readonly ImageAttachmentRef[],
  nowMs: number,
  limit: number = MAX_PROJECTED_IMAGE_ATTACHMENTS,
): ImageAttachmentRef[] {
  return selectRecentImageAttachmentRefs(pruneExpiredFileRefs(refs, nowMs), limit);
}

/**
 * Signed URLs are credentials: logs/traces keep only the host plus byte
 * counts, never path, query, fragment, or the raw link.
 */
export function redactImageUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/...[redacted]`;
  } catch {
    return '[invalid-url]';
  }
}

export function imageUrlFingerprint(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * File IDs are provider handles, never customer content: public traces keep
 * only a scoped fingerprint for correlation, never the raw ID.
 */
export function imageFileFingerprint(fileId: string): string {
  return crypto.createHash('sha256').update(`image-file:${fileId}`).digest('hex').slice(0, 16);
}

export function redactFileIdForLog(fileId: string): string {
  return `file:...[redacted:${imageFileFingerprint(fileId).slice(0, 8)}]`;
}
