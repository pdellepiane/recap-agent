import { z } from 'zod';

export const validPhoneParseResultSchema = z.object({
  status: z.literal('valid'),
  digits: z.string().regex(/^\d{7,15}$/),
  countryCode: z.string().regex(/^\+\d{1,3}$/),
  nationalNumber: z.string().regex(/^\d+$/),
});

export const invalidPhoneParseResultSchema = z.object({
  status: z.literal('invalid'),
  reason: z.enum([
    'missing_country_code',
    'unsupported_country_code',
    'invalid_length',
    'invalid_characters',
    'empty',
  ]),
});

export const phoneParseResultSchema = z.discriminatedUnion('status', [
  validPhoneParseResultSchema,
  invalidPhoneParseResultSchema,
]);

export type PhoneParseResult = z.infer<typeof phoneParseResultSchema>;

const PHONE_ALLOWED_CHARS_REGEX = /^\+?[\d\s().-]+$/;

type CountryRule = {
  code: string;
  nationalLength: number;
};

const COUNTRY_RULES: CountryRule[] = [
  { code: '+52', nationalLength: 10 },
  { code: '+51', nationalLength: 9 },
  { code: '+1', nationalLength: 10 },
];

export function parseInternationalPhone(value: string | null | undefined): PhoneParseResult {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return { status: 'invalid', reason: 'empty' };
  }

  if (!PHONE_ALLOWED_CHARS_REGEX.test(trimmed)) {
    return { status: 'invalid', reason: 'invalid_characters' };
  }

  if (!trimmed.startsWith('+')) {
    return { status: 'invalid', reason: 'missing_country_code' };
  }

  const digits = trimmed.replace(/\D/g, '');
  const matchedRule = COUNTRY_RULES.find((rule) =>
    digits.startsWith(rule.code.slice(1)),
  );
  if (!matchedRule) {
    return { status: 'invalid', reason: 'unsupported_country_code' };
  }

  const countryDigits = matchedRule.code.slice(1);
  const nationalNumber = digits.slice(countryDigits.length);
  if (nationalNumber.length !== matchedRule.nationalLength) {
    return { status: 'invalid', reason: 'invalid_length' };
  }

  return {
    status: 'valid',
    digits,
    countryCode: matchedRule.code,
    nationalNumber,
  };
}
