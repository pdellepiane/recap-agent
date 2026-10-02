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

export const internationalPhonePartsSchema = z.object({
  phone_extension: z.string().regex(/^\+\d{1,3}$/),
  phone_number: z.string().regex(/^\d+$/),
});

export type InternationalPhoneParts = z.infer<
  typeof internationalPhonePartsSchema
>;

const PHONE_ALLOWED_CHARS_REGEX = /^\+?[\d\s().-]+$/;

type CountryRule = {
  code: string;
  nationalLength: number;
};

/**
 * Countries with exact national-length validation. These are the historically
 * supported countries, so they are also the only ones inferred from input
 * without an explicit `+` prefix. Every other assigned country code requires
 * the `+` form because prefix inference without it is ambiguous.
 */
const LEGACY_COUNTRY_RULES: CountryRule[] = [
  { code: '+52', nationalLength: 10 },
  { code: '+51', nationalLength: 9 },
  { code: '+1', nationalLength: 10 },
];

/**
 * ITU-T E.164 assigned country codes (digits without `+`), covering every
 * geographic zone plus the operational non-geographic service codes 800
 * (freephone), 808 (shared cost), and 888 (OCHA emergency relief). The
 * special-purpose codes 979 (premium rate) and 991 (service trial) are
 * intentionally excluded. The assignment space is prefix-free, so
 * longest-prefix matching is unambiguous.
 */
const ASSIGNED_COUNTRY_CODES: ReadonlySet<string> = new Set([
  '1',
  '20', '27',
  '211', '212', '213', '216', '218',
  '220', '221', '222', '223', '224', '225', '226', '227', '228', '229',
  '230', '231', '232', '233', '234', '235', '236', '237', '238', '239',
  '240', '241', '242', '243', '244', '245', '246', '247', '248', '249',
  '250', '251', '252', '253', '254', '255', '256', '257', '258',
  '260', '261', '262', '263', '264', '265', '266', '267', '268', '269',
  '290', '291', '297', '298', '299',
  '30', '31', '32', '33', '34', '36', '39',
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359',
  '370', '371', '372', '373', '374', '375', '376', '377', '378', '379',
  '380', '381', '382', '383', '385', '386', '387', '389',
  '420', '421', '423',
  '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '500', '501', '502', '503', '504', '505', '506', '507', '508', '509',
  '51', '52', '53', '54', '55', '56', '57', '58',
  '590', '591', '592', '593', '594', '595', '596', '597', '598', '599',
  '60', '61', '62', '63', '64', '65', '66',
  '670', '672', '673', '674', '675', '676', '677', '678', '679',
  '680', '681', '682', '683', '685', '686', '687', '688', '689',
  '690', '691', '692',
  '7',
  '800', '808', '81', '82', '84', '86', '880', '886', '888',
  '90', '91', '92', '93', '94', '95',
  '960', '961', '962', '963', '964', '965', '966', '967', '968',
  '970', '971', '972', '973', '974', '975', '976', '977',
  '98', '992', '993', '994', '995', '996', '998',
]);

function matchAssignedCountryCode(digits: string): string | null {
  for (const length of [3, 2, 1]) {
    const candidate = digits.slice(0, length);
    if (ASSIGNED_COUNTRY_CODES.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function parseInternationalPhone(value: string | null | undefined): PhoneParseResult {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return { status: 'invalid', reason: 'empty' };
  }

  if (!PHONE_ALLOWED_CHARS_REGEX.test(trimmed)) {
    return { status: 'invalid', reason: 'invalid_characters' };
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+')) {
    const legacyRule = LEGACY_COUNTRY_RULES.find((rule) =>
      digits.startsWith(rule.code.slice(1)),
    );
    if (!legacyRule) {
      return { status: 'invalid', reason: 'missing_country_code' };
    }
    const nationalNumber = digits.slice(legacyRule.code.length - 1);
    if (nationalNumber.length !== legacyRule.nationalLength) {
      return { status: 'invalid', reason: 'invalid_length' };
    }
    return {
      status: 'valid',
      digits,
      countryCode: legacyRule.code,
      nationalNumber,
    };
  }

  const countryDigits = matchAssignedCountryCode(digits);
  if (!countryDigits) {
    return { status: 'invalid', reason: 'unsupported_country_code' };
  }

  const nationalNumber = digits.slice(countryDigits.length);
  const legacyRule = LEGACY_COUNTRY_RULES.find(
    (rule) => rule.code === `+${countryDigits}`,
  );
  if (legacyRule) {
    if (nationalNumber.length !== legacyRule.nationalLength) {
      return { status: 'invalid', reason: 'invalid_length' };
    }
  } else if (digits.length < 7 || digits.length > 15) {
    return { status: 'invalid', reason: 'invalid_length' };
  }

  return {
    status: 'valid',
    digits,
    countryCode: `+${countryDigits}`,
    nationalNumber,
  };
}

export function splitInternationalPhone(
  value: string | null | undefined,
): InternationalPhoneParts | null {
  const parsed = parseInternationalPhone(value);
  if (parsed.status !== 'valid') {
    return null;
  }

  return {
    phone_extension: parsed.countryCode,
    phone_number: parsed.nationalNumber,
  };
}

/**
 * Split a stored plan phone value into Agent API parts.
 *
 * Stored `contact_phone` values use digits-only E.164 without `+` (for
 * example `51973296571`), while inbound wire values carry the `+` prefix.
 * Accept both forms and parse globally, so previously stored values keep
 * resolving unchanged (explicit and lossless: no stored value is rewritten
 * or re-inferred, and ownership still comes from the trusted channel
 * identity plus exact backend lookup).
 */
export function splitStoredInternationalPhone(
  value: string | null | undefined,
): InternationalPhoneParts | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('+')) {
    return splitInternationalPhone(trimmed);
  }
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  return splitInternationalPhone(`+${digits}`);
}
