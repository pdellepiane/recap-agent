import { describe, expect, it } from 'vitest';

import { extractOtpCode } from '../src/runtime/otp-normalization';

describe('OTP normalization', () => {
  it('normalizes an unambiguous Spanish digit sequence', () => {
    expect(extractOtpCode('Uno cuatro siete cinco uno cinco')).toBe('147515');
  });

  it('extracts Spanish digit words from surrounding prose', () => {
    expect(extractOtpCode('Mi código es cero cuatro siete cinco uno cinco, gracias')).toBe(
      '047515',
    );
  });

  it('preserves a literal code', () => {
    expect(extractOtpCode('El código es 147515')).toBe('147515');
  });

  it.each(['147 515', '1 4 7 5 1 5', '147-515'])(
    'normalizes a safely separated six-digit code: %s',
    (value) => {
      expect(extractOtpCode(`El código es ${value}`)).toBe('147515');
    },
  );

  it.each(['1475', '14751599', 'abc147', '147515abc'])(
    'rejects a value that is not exactly six standalone digits: %s',
    (value) => {
      expect(extractOtpCode(value)).toBeNull();
    },
  );

  it('rejects two distinct OTP candidates instead of choosing one', () => {
    expect(extractOtpCode('Probé 147515 y luego 258626')).toBeNull();
  });

  it('does not reinterpret ordinary prose as a code', () => {
    expect(extractOtpCode('Tengo una consulta sobre el regalo')).toBeNull();
  });
});
