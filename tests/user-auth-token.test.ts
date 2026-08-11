import { describe, expect, it } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import { hasValidUserAuthToken } from '../src/runtime/agent-service';

describe('user authentication token validity', () => {
  it.each([
    ['missing expiry', null],
    ['malformed expiry', 'not-an-iso-date'],
    ['past expiry', '2020-01-01T00:00:00.000Z'],
  ])('fails closed for %s', (_label, tokenExpiresAt) => {
    const plan = createEmptyPlan({
      planId: 'auth-expiry-test',
      channel: 'whatsapp',
      externalUserId: 'auth-expiry-user',
    });
    plan.user_auth = {
      ...plan.user_auth,
      status: 'authenticated',
      token: 'jwt-canary',
      token_expires_at: tokenExpiresAt,
    };

    expect(hasValidUserAuthToken(plan)).toBe(false);
  });

  it('accepts only a future ISO expiry', () => {
    const plan = createEmptyPlan({
      planId: 'auth-expiry-valid',
      channel: 'whatsapp',
      externalUserId: 'auth-expiry-user',
    });
    plan.user_auth = {
      ...plan.user_auth,
      status: 'authenticated',
      token: 'jwt-canary',
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };

    expect(hasValidUserAuthToken(plan)).toBe(true);
  });
});
