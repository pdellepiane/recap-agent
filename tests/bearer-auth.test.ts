import { describe, expect, it } from 'vitest';

import {
  bearerTokenMatchesAny,
  readBearerAuthorization,
} from '../src/lambda/bearer-auth';

describe('Lambda channel bearer authentication', () => {
  it('reads the standard Authorization header case-insensitively', () => {
    const authorization = readBearerAuthorization({
      Authorization: '  Bearer channel-secret  ',
    });
    expect(authorization).toEqual({
      authorizationHeaderPresent: true,
      token: 'channel-secret',
    });
    expect(bearerTokenMatchesAny(authorization.token, ['channel-secret'])).toBe(true);
  });

  it('accepts a case-insensitive Bearer scheme', () => {
    expect(readBearerAuthorization({ authorization: 'bearer channel-secret' })).toEqual({
      authorizationHeaderPresent: true,
      token: 'channel-secret',
    });
  });

  it('rejects missing, malformed, empty, and incorrect credentials', () => {
    expect(readBearerAuthorization({})).toEqual({
      authorizationHeaderPresent: false,
      token: null,
    });
    expect(readBearerAuthorization({ authorization: 'Basic abc' })).toEqual({
      authorizationHeaderPresent: true,
      token: null,
    });
    expect(readBearerAuthorization({ authorization: 'Bearer   ' })).toEqual({
      authorizationHeaderPresent: true,
      token: null,
    });
    expect(bearerTokenMatchesAny(null, ['channel-secret'])).toBe(false);
    expect(bearerTokenMatchesAny('wrong-secret', ['channel-secret'])).toBe(false);
  });

  it('accepts both current and previous rotation tokens', () => {
    const acceptedTokens = ['new-channel-secret', 'previous-channel-secret'];
    expect(bearerTokenMatchesAny('new-channel-secret', acceptedTokens)).toBe(true);
    expect(bearerTokenMatchesAny('previous-channel-secret', acceptedTokens)).toBe(true);
    expect(bearerTokenMatchesAny('unknown-channel-secret', acceptedTokens)).toBe(false);
  });
});
