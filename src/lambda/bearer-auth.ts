import crypto from 'node:crypto';

export type BearerAuthorization = {
  authorizationHeaderPresent: boolean;
  token: string | null;
};

export function readBearerAuthorization(
  headers: Record<string, string | undefined>,
): BearerAuthorization {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'authorization') {
      continue;
    }
    const trimmed = value?.trim() ?? '';
    const match = /^Bearer[\t ]+([^\s]+)$/iu.exec(trimmed);
    return {
      authorizationHeaderPresent: trimmed.length > 0,
      token: match?.[1] ?? null,
    };
  }
  return {
    authorizationHeaderPresent: false,
    token: null,
  };
}

export function bearerTokenMatchesAny(
  provided: string | null,
  expectedTokens: readonly string[],
): boolean {
  if (!provided) {
    return false;
  }
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  let matched = false;
  for (const expected of expectedTokens) {
    const expectedDigest = crypto.createHash('sha256').update(expected).digest();
    matched = crypto.timingSafeEqual(providedDigest, expectedDigest) || matched;
  }
  return matched;
}
