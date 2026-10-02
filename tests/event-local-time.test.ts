import { describe, expect, it } from 'vitest';

import {
  describeEventLocalTime,
} from '../src/core/event-local-time';

describe('recorded event time', () => {
  it('preserves recorded dates and hours across timestamp shapes', () => {
    // Explicit-offset source hour wins even when the event has a zone.
    expect(describeEventLocalTime('2026-09-20T18:00:00.000Z', 'America/Lima')).toEqual({
      value: '2026-09-20T18:00:00.000Z',
      recorded_date: '2026-09-20',
      hour24: '18:00',
      timezone: 'America/Lima',
    });
    // The recorded date never rolls across midnight boundaries.
    expect(describeEventLocalTime('2026-09-21T00:00:00.000Z', 'America/Lima')).toMatchObject({
      recorded_date: '2026-09-21',
      hour24: '00:00',
      timezone: 'America/Lima',
    });
    // Offset-free wall values pass through without conversion.
    expect(describeEventLocalTime('2026-09-20 18:00:00', 'America/Lima')).toEqual({
      value: '2026-09-20 18:00:00',
      recorded_date: '2026-09-20',
      hour24: '18:00',
      timezone: 'America/Lima',
    });
    // Date-only values report no hour.
    expect(describeEventLocalTime('2026-09-20', 'America/Lima')).toMatchObject({
      hour24: 'unknown',
    });
    // Without a verified zone the explicit offset is preserved as UTC.
    expect(describeEventLocalTime('2026-09-20T18:00:00.000Z', null)).toMatchObject({
      hour24: '18:00',
      timezone: 'UTC',
    });
  });

  it('returns null for empty or hour-less input without throwing', () => {
    expect(describeEventLocalTime(null, 'America/Lima')).toBeNull();
    expect(describeEventLocalTime('   ', 'America/Lima')).toBeNull();
  });
});
