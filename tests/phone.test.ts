import { describe, expect, it } from 'vitest';

import {
  parseInternationalPhone,
  phoneParseResultSchema,
  splitInternationalPhone,
} from '../src/runtime/phone';

describe('phone parsing', () => {
  it('rejects incomplete Peru mobile numbers', () => {
    const result = parseInternationalPhone('+51 95477906');

    expect(result).toEqual({
      status: 'invalid',
      reason: 'invalid_length',
    });
  });

  it('accepts complete Peru mobile numbers and splits extension fields', () => {
    const result = parseInternationalPhone('+51 954779067');

    expect(result).toEqual({
      status: 'valid',
      digits: '51954779067',
      countryCode: '+51',
      nationalNumber: '954779067',
    });
  });

  it('accepts a complete supported international number without a plus sign', () => {
    expect(parseInternationalPhone('51954779071')).toEqual({
      status: 'valid',
      digits: '51954779071',
      countryCode: '+51',
      nationalNumber: '954779071',
    });
  });

  it('rejects local numbers without country code', () => {
    const result = parseInternationalPhone('954779067');

    expect(result).toEqual({
      status: 'invalid',
      reason: 'missing_country_code',
    });
  });

  it('validates parser results through the exported Zod schema', () => {
    const result = phoneParseResultSchema.parse(parseInternationalPhone('+52 5512345678'));

    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.countryCode).toBe('+52');
      expect(result.nationalNumber).toBe('5512345678');
    }
  });

  it('splits the webhook Peru fixture at the Agent API boundary', () => {
    expect(splitInternationalPhone('+51973296571')).toEqual({
      phone_extension: '+51',
      phone_number: '973296571',
    });
  });
});
