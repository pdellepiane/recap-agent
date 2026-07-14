import crypto from 'node:crypto';

export function readApiKeyHeader(
  headers: Record<string, string | undefined>,
): string | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'x-api-key') {
      const trimmed = value?.trim();
      return trimmed || null;
    }
  }
  return null;
}

export function apiKeysMatch(provided: string | null, expected: string): boolean {
  if (!provided) {
    return false;
  }
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}
