import { z } from 'zod';

export const MAX_IMAGE_BYTES = 2_000_000;
export const MAX_IMAGE_URL_LENGTH = 2048;
const deliveryError = z.enum(['image_too_large', 'media_unavailable']);
const imageUrlSchema = z.object({ url: z.string().trim().min(1).max(MAX_IMAGE_URL_LENGTH) }).strict();
export const inboundImageSchema = z.union([
  z.object({ data: z.string().min(1), mime_type: z.string().max(128) }).strict(),
  imageUrlSchema,
  z.object({ error: deliveryError, mime_type: z.string().max(128) }).strict(),
]);
export type InboundImageWire = z.infer<typeof inboundImageSchema>;
export type InboundImageBase64 =
  { status: 'available'; source: 'base64'; data: string; mimeType: string; byteLength: number };
export type InboundImageUrl =
  { status: 'available'; source: 'url'; url: string; mimeType: null };
export type InboundImage =
  | InboundImageBase64
  | InboundImageUrl
  | { status: 'unavailable'; reason: 'image_too_large' | 'media_unavailable'; mimeType: string };

/**
 * Directly OpenAI-fetchable shape check (no network): https URL without
 * embedded credentials or literal private/local host. Signed URLs are
 * acceptable while valid; a webpage address is not an image URL.
 */
export function isDirectlyFetchableImageUrlShape(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0 || host === 'localhost' || host.endsWith('.local')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/u.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    return true;
  }
  if (host === '::1' || host === '[::1]') return false;
  return true;
}

/** Decode only in memory. Never include the supplied bytes in an error. */
export function normalizeInboundImage(image: InboundImageWire): InboundImage {
  const unavailable = (reason: 'image_too_large' | 'media_unavailable'): InboundImage =>
    ({ status: 'unavailable', reason, mimeType: 'mime_type' in image ? image.mime_type : 'image/unknown' });
  if ('error' in image) return unavailable(image.error);
  if ('url' in image) {
    if (!isDirectlyFetchableImageUrlShape(image.url)) return unavailable('media_unavailable');
    return { status: 'available', source: 'url', url: image.url, mimeType: null };
  }
  if (image.data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) return unavailable('image_too_large');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(image.data)) {
    return unavailable('media_unavailable');
  }
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) return unavailable('image_too_large');
  const jpeg = bytes.length > 4 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
    bytes.subarray(-2).equals(Buffer.from([255, 217]));
  const png = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(-8, -4).toString('ascii') === 'IEND';
  const webp = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const matches = (image.mime_type === 'image/jpeg' && jpeg) ||
    (image.mime_type === 'image/png' && png) || (image.mime_type === 'image/webp' && webp);
  if (!matches) return unavailable('media_unavailable');
  return { status: 'available', source: 'base64', data: image.data, mimeType: image.mime_type, byteLength: bytes.length };
}

/**
 * Decode an already-validated base64 image to bytes held only in memory.
 * Returns null unless the image normalized to available base64. Callers must
 * never log, persist, or embed the bytes in errors, traces, or plans; the
 * bytes travel only to the file-upload adapter.
 */
export function decodeValidatedBase64Bytes(image: InboundImage): Buffer | null {
  if (image.status !== 'available' || image.source !== 'base64') return null;
  try {
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}
