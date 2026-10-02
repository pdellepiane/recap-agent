import type { InformationTaskResult } from '../core/information';

const commissionArticleUrls = new Set([
  'https://sinenvolturas.tawk.help/article/cuanto-cuesta',
  'https://sinenvolturas.tawk.help/article/cuanto-cuesta-invitados',
]);
const commissionArticleFiles = new Set([
  'cuanto-cuesta.md',
  'cuanto-cuesta-invitados.md',
]);

/** Source identity, not user wording, selects the commission reply contract. */
export function verifiedCommissionArticle(
  results: readonly InformationTaskResult[] | undefined,
): Extract<InformationTaskResult, { kind: 'faq'; status: 'completed' }> | null {
  for (const result of results ?? []) {
    if (
      result.kind === 'faq' && result.status === 'completed' &&
      result.evidence.length > 0 &&
      ((typeof result.citationUrl === 'string' &&
        commissionArticleUrls.has(result.citationUrl)) ||
        result.evidence.some((entry) => commissionArticleFiles.has(entry.filename)))
    ) {
      return result;
    }
  }
  return null;
}

type MonetaryUnit = 'PEN' | 'USD' | 'MXN' | 'PERCENT' | 'UNLABELED_DECIMAL';
export type CommissionNumericClaim = {
  readonly unit: MonetaryUnit;
  readonly value: string;
  readonly written: string;
};

function normalizeNumber(value: string): string {
  const cleaned = value.replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? String(parsed) : cleaned;
}

function numericClaims(text: string): CommissionNumericClaim[] {
  const claims: CommissionNumericClaim[] = [];
  const occupied: Array<[number, number]> = [];
  const patterns: Array<{ unit: MonetaryUnit; regex: RegExp; numberGroup: number }> = [
    { unit: 'PEN', regex: /S\/\.?\s*(\d+(?:[.,]\d{1,2})?)/giu, numberGroup: 1 },
    { unit: 'PEN', regex: /\bPEN\s*(\d+(?:[.,]\d{1,2})?)/giu, numberGroup: 1 },
    { unit: 'USD', regex: /(?:US\$|USD\s*|\$\s*)(\d+(?:[.,]\d{1,2})?)/giu, numberGroup: 1 },
    { unit: 'MXN', regex: /\bMXN\s*(\d+(?:[.,]\d{1,2})?)/giu, numberGroup: 1 },
    { unit: 'PEN', regex: /(\d+(?:[.,]\d{1,2})?)\s*(?:en\s+)?soles\b/giu, numberGroup: 1 },
    { unit: 'USD', regex: /(\d+(?:[.,]\d{1,2})?)\s*(?:en\s+)?(?:USD|d[oó]lares)\b/giu, numberGroup: 1 },
    { unit: 'MXN', regex: /(\d+(?:[.,]\d{1,2})?)\s*(?:en\s+)?pesos\b/giu, numberGroup: 1 },
    { unit: 'PEN', regex: /\bsoles\s*(\d+(?:[.,]\d{1,2})?)/giu, numberGroup: 1 },
    { unit: 'MXN', regex: /\bpesos\s*(\d+(?:[.,]\d{1,2})?)/giu, numberGroup: 1 },
    { unit: 'PERCENT', regex: /(\d+(?:[.,]\d{1,2})?)\s*%/giu, numberGroup: 1 },
    // A reply such as "recibirías 49.05" still asserts a precise amount even
    // without a currency marker; two decimal places distinguish it from dates.
    { unit: 'UNLABELED_DECIMAL', regex: /(?<![\p{L}\d./])(\d+[.,]\d{2})(?![\d%])/giu, numberGroup: 1 },
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some(([from, to]) => start < to && end > from)) continue;
      const number = match[pattern.numberGroup];
      if (number === undefined) continue;
      occupied.push([start, end]);
      claims.push({ unit: pattern.unit, value: normalizeNumber(number), written: match[0] });
    }
  }
  return claims;
}

/**
 * Reject unsupported numeric claims before delivery. The only allowed values
 * come from the retrieved commission article, the user's stated amount, or a
 * separately verified calculator quote. This does not turn any of those
 * numbers into a prewritten answer or authorize arithmetic between them.
 */
export function unsupportedCommissionNumericClaims(args: {
  readonly reply: string;
  readonly articleText: string;
  readonly userMessage: string;
  readonly verifiedCalculatorQuote?: string;
}): CommissionNumericClaim[] {
  const authorized = new Set(
    numericClaims([
      args.articleText,
      args.userMessage,
      args.verifiedCalculatorQuote ?? '',
    ].join('\n')).map((claim) => `${claim.unit}:${claim.value}`),
  );
  return numericClaims(args.reply).filter(
    (claim) => !authorized.has(`${claim.unit}:${claim.value}`),
  );
}
