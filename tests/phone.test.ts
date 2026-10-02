import { describe, expect, it } from 'vitest';

import {
  parseInternationalPhone,
  phoneParseResultSchema,
  splitInternationalPhone,
  splitStoredInternationalPhone,
} from '../src/runtime/phone';

describe('phone parsing', () => {
  it('rejects invalid numbers with typed reasons', () => {
    // Outside E.164 length bounds.
    expect(parseInternationalPhone('+51 95477906')).toEqual({
      status: 'invalid',
      reason: 'invalid_length',
    });
    expect(parseInternationalPhone('+961 12')).toEqual({
      status: 'invalid',
      reason: 'invalid_length',
    });
    expect(parseInternationalPhone('+44 12345678901234')).toEqual({
      status: 'invalid',
      reason: 'invalid_length',
    });
    // Without an explicit country code.
    expect(parseInternationalPhone('954779067')).toEqual({
      status: 'invalid',
      reason: 'missing_country_code',
    });
    expect(parseInternationalPhone('9613123456')).toEqual({
      status: 'invalid',
      reason: 'missing_country_code',
    });
    // Unassigned country codes keep the reason reachable.
    expect(parseInternationalPhone('+999 1234567')).toEqual({
      status: 'invalid',
      reason: 'unsupported_country_code',
    });
  });

  it('accepts valid numbers with longest-prefix country codes', () => {
    // Complete Peru mobile numbers with or without a plus sign.
    expect(parseInternationalPhone('+51 954779067')).toEqual({
      status: 'valid',
      digits: '51954779067',
      countryCode: '+51',
      nationalNumber: '954779067',
    });
    expect(parseInternationalPhone('51954779071')).toEqual({
      status: 'valid',
      digits: '51954779071',
      countryCode: '+51',
      nationalNumber: '954779071',
    });
    // Lebanese numbers with the +961 country code.
    expect(parseInternationalPhone('+961 3 123456')).toEqual({
      status: 'valid',
      digits: '9613123456',
      countryCode: '+961',
      nationalNumber: '3123456',
    });
    expect(splitInternationalPhone('+9613123456')).toEqual({
      phone_extension: '+961',
      phone_number: '3123456',
    });
    // NANP +1 670 disambiguated from Timor-Leste +670 by longest prefix.
    expect(parseInternationalPhone('+16702551234')).toEqual({
      status: 'valid',
      digits: '16702551234',
      countryCode: '+1',
      nationalNumber: '6702551234',
    });
    expect(parseInternationalPhone('+670 123456')).toEqual({
      status: 'valid',
      digits: '670123456',
      countryCode: '+670',
      nationalNumber: '123456',
    });
  });

  it('accepts assigned country codes across every world zone', () => {
    const cases: Array<[string, string, string]> = [
      ['+44 7911123456', '+44', '7911123456'],
      ['+49 15123456789', '+49', '15123456789'],
      ['+81 9012345678', '+81', '9012345678'],
      ['+91 9876543210', '+91', '9876543210'],
      ['+55 11987654321', '+55', '11987654321'],
      ['+27 821234567', '+27', '821234567'],
      ['+61 412345678', '+61', '412345678'],
      ['+971 501234567', '+971', '501234567'],
      ['+7 9161234567', '+7', '9161234567'],
      ['+1 2025551234', '+1', '2025551234'],
      ['+52 5512345678', '+52', '5512345678'],
    ];
    for (const [input, countryCode, nationalNumber] of cases) {
      const result = phoneParseResultSchema.parse(parseInternationalPhone(input));
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.countryCode).toBe(countryCode);
        expect(result.nationalNumber).toBe(nationalNumber);
      }
    }
  });

  it('splits extension and national parts across webhook and stored entry points', () => {
    // Webhook Peru fixture at the Agent API boundary.
    expect(splitInternationalPhone('+51973296571')).toEqual({
      phone_extension: '+51',
      phone_number: '973296571',
    });
    // Stored digits-only plan values for legacy and global countries.
    expect(splitStoredInternationalPhone('51973296571')).toEqual({
      phone_extension: '+51',
      phone_number: '973296571',
    });
    expect(splitStoredInternationalPhone('96170197268')).toEqual({
      phone_extension: '+961',
      phone_number: '70197268',
    });
    expect(splitStoredInternationalPhone('+96170197268')).toEqual({
      phone_extension: '+961',
      phone_number: '70197268',
    });
    // Unusable stored values return null without throwing.
    expect(splitStoredInternationalPhone(null)).toBeNull();
    expect(splitStoredInternationalPhone('   ')).toBeNull();
    expect(splitStoredInternationalPhone('no-digits-here!')).toBeNull();
    expect(splitStoredInternationalPhone('9991234567')).toBeNull();
  });
});
