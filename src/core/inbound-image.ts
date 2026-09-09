import { z } from 'zod';

export const MAX_IMAGE_BYTES = 2_000_000;
const deliveryError = z.enum(['image_too_large', 'media_unavailable']);
export const inboundImageSchema = z.union([
  z.object({ data: z.string().min(1), mime_type: z.string().max(128) }).strict(),
  z.object({ error: deliveryError, mime_type: z.string().max(128) }).strict(),
]);
export type InboundImageWire = z.infer<typeof inboundImageSchema>;
export type InboundImage =
  | { status: 'available'; data: string; mimeType: string; byteLength: number }
  | { status: 'unavailable'; reason: 'image_too_large' | 'media_unavailable'; mimeType: string };

/** Decode only in memory. Never include the supplied bytes in an error. */
export function normalizeInboundImage(image: InboundImageWire): InboundImage {
  const unavailable = (reason: 'image_too_large' | 'media_unavailable'): InboundImage =>
    ({ status: 'unavailable', reason, mimeType: image.mime_type });
  if ('error' in image) return unavailable(image.error);
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
  return { status: 'available', data: image.data, mimeType: image.mime_type, byteLength: bytes.length };
}
