import { describe, expect, it } from 'vitest';

import { extractOtpCode } from '../src/runtime/otp-normalization';

describe('OTP normalization', () => {
  it('normalizes an unambiguous Spanish digit sequence', () => {
    expect(extractOtpCode('Uno cuatro siete cinco uno cinco')).toBe('147515');
  });

  it('preserves a literal code', () => {
    expect(extractOtpCode('El código es 147515')).toBe('147515');
  });

  it('does not reinterpret ordinary prose as a code', () => {
    expect(extractOtpCode('Tengo una consulta sobre el regalo')).toBeNull();
  });
});
