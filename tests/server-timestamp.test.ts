import { describe, expect, it } from 'vitest';

import { normalizeServerTimestamp } from '../src/core/server-timestamp';

describe('server timestamp normalization', () => {
  it('preserves server-provided date and datetime representations', () => {
    expect(normalizeServerTimestamp(' 2026-08-31 ')).toBe('2026-08-31');
    expect(normalizeServerTimestamp('2026-08-30 21:31:27')).toBe('2026-08-30 21:31:27');
    expect(normalizeServerTimestamp('2026-08-30T21:31:27.123')).toBe('2026-08-30T21:31:27.123');
    expect(normalizeServerTimestamp('2026-08-30T21:31:27-05:00')).toBe('2026-08-30T21:31:27-05:00');
    expect(normalizeServerTimestamp('2026-08-30T21:31:27+0500')).toBe('2026-08-30T21:31:27+0500');
    expect(normalizeServerTimestamp('10/10/2026')).toBe('10/10/2026');
    expect(normalizeServerTimestamp('10/10/2026 20:15')).toBe('10/10/2026 20:15');
    expect(normalizeServerTimestamp('10/10/2026 20:15:42')).toBe('10/10/2026 20:15:42');
  });

  it('rejects malformed or impossible calendar and offset values', () => {
    expect(normalizeServerTimestamp('2026-02-29')).toBeNull();
    expect(normalizeServerTimestamp('2024-02-29')).toBe('2024-02-29');
    expect(normalizeServerTimestamp('2026-08-31 24:00:00')).toBeNull();
    expect(normalizeServerTimestamp('2026-08-31 21:31:60')).toBeNull();
    expect(normalizeServerTimestamp('2026-08-31T21:31:27+24:00')).toBeNull();
    expect(normalizeServerTimestamp('not-a-timestamp')).toBeNull();
    expect(normalizeServerTimestamp('31/02/2026 20:15')).toBeNull();
    expect(normalizeServerTimestamp('10/10/2026 24:00')).toBeNull();
    expect(normalizeServerTimestamp(null)).toBeNull();
  });
});
