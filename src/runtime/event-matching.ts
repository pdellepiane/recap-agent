export const CANONICAL_CONJUNCTION = 'and';

const CONJUNCTION_TOKENS = new Set(['and', 'y', 'e']);

export function normalizeEventTokens(value: string): string[] {
  if (!value) {
    return [];
  }
  const folded = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es');
  const withConjunction = folded.replace(/&/gu, ' and ');
  const cleaned = withConjunction.replace(/[^a-z0-9]+/gu, ' ').trim();
  if (!cleaned) {
    return [];
  }
  const tokens = cleaned.split(/\s+/u);
  return tokens
    .map((token) => {
      if (CONJUNCTION_TOKENS.has(token)) {
        return CANONICAL_CONJUNCTION;
      }
      return token;
    })
    .filter((token) => token.length > 0);
}

export function normalizeEventNameForMatching(value: string): string {
  return normalizeEventTokens(value).join(' ');
}

export function areEventNamesEquivalent(a: string, b: string): boolean {
  return normalizeEventNameForMatching(a) === normalizeEventNameForMatching(b);
}

export function eventMatches(
  eventName: string | null | undefined,
  hint: string | null | undefined,
): boolean {
  if (!hint || hint.trim() === '') {
    return true;
  }
  if (!eventName) {
    return false;
  }
  const hintTokens = normalizeEventTokens(hint).filter(
    (token) => token !== CANONICAL_CONJUNCTION,
  );
  if (hintTokens.length === 0) {
    return false;
  }
  const eventTokens = normalizeEventTokens(eventName).filter(
    (token) => token !== CANONICAL_CONJUNCTION,
  );
  const eventSet = new Set(eventTokens);
  return hintTokens.every((token) => eventSet.has(token));
}
