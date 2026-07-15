import { describe, expect, it } from 'vitest';

import {
  bearerTokensMatch,
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
    expect(bearerTokensMatch(authorization.token, 'channel-secret')).toBe(true);
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
    expect(bearerTokensMatch(null, 'channel-secret')).toBe(false);
    expect(bearerTokensMatch('wrong-secret', 'channel-secret')).toBe(false);
  });
});
