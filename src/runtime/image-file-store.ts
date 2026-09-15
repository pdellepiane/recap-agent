import OpenAI, { toFile } from 'openai';

import { IMAGE_FILE_EXPIRY_SECONDS } from '../core/image-attachments';

export const IMAGE_FILE_PURPOSE = 'vision' as const;

export type ImageFileUploadInput = {
  /** Validated image bytes held only in memory; never logged or persisted. */
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

export type ImageFileUploadResult = {
  fileId: string;
  /** ISO expiry: provider-returned expires_at when present, else created_at + 1 day. */
  expiresAt: string;
  byteLength: number;
};

/**
 * Typed file-upload failure. `retryable` distinguishes transport/rate-limit
 * failures (the turn may fail retryably) from validation/auth failures
 * (never relabeled as image unavailability downstream).
 */
export class ImageFileUploadError extends Error {
  readonly retryable: boolean;
  readonly causeName: string;

  constructor(message: string, options: { retryable: boolean; causeName: string }) {
    super(message);
    this.name = 'ImageFileUploadError';
    this.retryable = options.retryable;
    this.causeName = options.causeName;
  }
}

export class ImageFileDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageFileDeleteError';
  }
}

/**
 * Narrow typed adapter over the existing OpenAI project credentials. Uploads
 * in-memory decoded bytes with purpose vision and an explicit one-day
 * expiry. Produces no conversational prose. Callers await uploads and plan
 * writes; no unawaited background work. Raw bytes, file IDs, and provider
 * errors (which can echo input) never enter logs.
 *
 * Non-atomic window: a successful remote upload followed by a failed plan
 * save (or process death between the two) orphans the file until the
 * provider expiry reaps it. The caller attempts best-effort deletion after a
 * failed save and then fails truthfully; no distributed-transaction
 * machinery is built around this bounded orphan window.
 */
export interface ImageFileStore {
  uploadImage(input: ImageFileUploadInput): Promise<ImageFileUploadResult>;
  /** Best-effort orphan cleanup after an upload followed by a failed save. */
  deleteImage(fileId: string): Promise<void>;
}

function mimeExtension(mimeType: ImageFileUploadInput['mimeType']): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}

export function isImageFileUploadRetryable(error: unknown): boolean {
  if (error instanceof ImageFileUploadError) return error.retryable;
  return false;
}

export class OpenAiImageFileStore implements ImageFileStore {
  constructor(private readonly client: OpenAI) {}

  async uploadImage(input: ImageFileUploadInput): Promise<ImageFileUploadResult> {
    if (input.bytes.length === 0) {
      throw new ImageFileUploadError('Empty image bytes.', {
        retryable: false,
        causeName: 'validation',
      });
    }
    try {
      const file = await toFile(input.bytes, `inbound.${mimeExtension(input.mimeType)}`, {
        type: input.mimeType,
      });
      const created = await this.client.files.create({
        file,
        purpose: IMAGE_FILE_PURPOSE,
        expires_after: { anchor: 'created_at', seconds: IMAGE_FILE_EXPIRY_SECONDS },
      });
      // Trust the provider's returned expiry when present; the requested
      // created_at + expiry fallback applies only when it is absent. Every
      // returned field is validated before anything is persisted, and this
      // method never extends the expiry of an existing reference.
      const fileId = typeof created.id === 'string' ? created.id.trim() : '';
      if (fileId.length === 0 || fileId.length > 256) {
        throw new ImageFileUploadError('Image file upload returned an invalid file ID.', {
          retryable: false,
          causeName: 'validation',
        });
      }
      if (!Number.isFinite(created.created_at) || created.created_at <= 0) {
        throw new ImageFileUploadError('Image file upload returned an invalid creation time.', {
          retryable: false,
          causeName: 'validation',
        });
      }
      if (!Number.isFinite(created.bytes) || created.bytes <= 0) {
        throw new ImageFileUploadError('Image file upload returned an invalid file size.', {
          retryable: false,
          causeName: 'validation',
        });
      }
      let expiresAtMs: number;
      if (created.expires_at === undefined || created.expires_at === null) {
        expiresAtMs = created.created_at * 1000 + IMAGE_FILE_EXPIRY_SECONDS * 1000;
      } else {
        if (!Number.isFinite(created.expires_at) || created.expires_at <= created.created_at) {
          throw new ImageFileUploadError('Image file upload returned an invalid expiry time.', {
            retryable: false,
            causeName: 'validation',
          });
        }
        expiresAtMs = created.expires_at * 1000;
      }
      const expiresAt = new Date(expiresAtMs).toISOString();
      if (Number.isNaN(Date.parse(expiresAt))) {
        throw new ImageFileUploadError('Image file upload returned an invalid expiry time.', {
          retryable: false,
          causeName: 'validation',
        });
      }
      return { fileId, expiresAt, byteLength: created.bytes };
    } catch (error) {
      if (error instanceof ImageFileUploadError) throw error;
      const causeName = error instanceof Error ? error.name : 'unknown';
      throw new ImageFileUploadError('Image file upload failed.', {
        retryable: isRetryableProviderFailure(error),
        causeName,
      });
    }
  }

  async deleteImage(fileId: string): Promise<void> {
    try {
      await this.client.files.delete(fileId);
    } catch (error) {
      const causeName = error instanceof Error ? error.name : 'unknown';
      throw new ImageFileDeleteError(`Image file deletion failed (${causeName}).`);
    }
  }
}

function isRetryableProviderFailure(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.APIConnectionTimeoutError) {
    return true;
  }
  if (error instanceof OpenAI.RateLimitError) return true;
  if (error instanceof OpenAI.APIError) {
    return error.status === 408 || error.status === 409 || error.status === 425 ||
      (typeof error.status === 'number' && error.status >= 500);
  }
  return false;
}
