const spanishDigitWords = new Map<string, string>([
  ['cero', '0'],
  ['uno', '1'],
  ['una', '1'],
  ['dos', '2'],
  ['tres', '3'],
  ['cuatro', '4'],
  ['cinco', '5'],
  ['seis', '6'],
  ['siete', '7'],
  ['ocho', '8'],
  ['nueve', '9'],
]);

export function extractOtpCode(text: string): string | null {
  const candidates = new Set<string>();
  const literalMatches = text.match(
    /(?<![\p{L}\p{N}])(?:[0-9][\p{White_Space}-]?){5}[0-9](?![\p{L}\p{N}])/gu,
  ) ?? [];
  literalMatches.forEach((match) => {
    candidates.add(match.replace(/[^0-9]/gu, ''));
  });

  const wordTokens = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .match(/\p{L}+/gu) ?? [];

  let spokenDigits: string[] = [];
  const flushSpokenDigits = (): void => {
    if (spokenDigits.length === 6) {
      candidates.add(spokenDigits.join(''));
    }
    spokenDigits = [];
  };
  wordTokens.forEach((token) => {
    const digit = spanishDigitWords.get(token);
    if (digit === undefined) {
      flushSpokenDigits();
      return;
    }
    spokenDigits.push(digit);
  });
  flushSpokenDigits();

  if (candidates.size !== 1) {
    return null;
  }
  return [...candidates][0] ?? null;
}
