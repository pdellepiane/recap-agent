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
  const literalMatches = text.match(/\b[A-Za-z0-9]{4,8}\b/gu) ?? [];
  const literal = literalMatches.find((match) => /\d/u.test(match));
  if (literal) {
    return literal;
  }

  const tokens = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .match(/\p{L}+/gu) ?? [];
  const digits = tokens.map((token) => spanishDigitWords.get(token) ?? null);
  if (digits.length < 4 || digits.length > 8 || digits.some((digit) => digit === null)) {
    return null;
  }
  return digits.join('');
}
