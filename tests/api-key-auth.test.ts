import { describe, expect, it } from 'vitest';

import { apiKeysMatch, readApiKeyHeader } from '../src/lambda/api-key-auth';

describe('Lambda channel API key authentication', () => {
  it('reads X-API-Key case-insensitively and validates the exact key', () => {
    const provided = readApiKeyHeader({ 'X-API-Key': '  channel-secret  ' });
    expect(provided).toBe('channel-secret');
    expect(apiKeysMatch(provided, 'channel-secret')).toBe(true);
  });

  it('rejects missing, empty, and incorrect keys', () => {
    expect(readApiKeyHeader({})).toBeNull();
    expect(readApiKeyHeader({ 'x-api-key': '   ' })).toBeNull();
    expect(apiKeysMatch(null, 'channel-secret')).toBe(false);
    expect(apiKeysMatch('wrong-secret', 'channel-secret')).toBe(false);
  });
});
