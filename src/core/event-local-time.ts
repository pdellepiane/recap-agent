/**
 * Describe the date and wall-clock time exactly as recorded by the source.
 * A verified event zone names the place and travels as the timezone; it
 * never changes the date or hour. Without a verified zone the explicit
 * offset is preserved, else the timezone is unknown.
 */

export type DescribedEventTime = {
  value: string;
  recorded_date: string;
  hour24: string;
  timezone: string;
};

export function describeEventLocalTime(
  value: string | null | undefined,
  eventTimeZone?: string | null,
): DescribedEventTime | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const stored = value.trim();
  const date = /^(\d{4}-\d{2}-\d{2})/u.exec(stored)?.[1] ?? 'unknown';
  const match = stored.match(/[T ](\d{2}):(\d{2})(?::(\d{2}))?/u);
  if (!match) return { value: stored, recorded_date: date, hour24: 'unknown', timezone: 'unknown' };
  const hour24 = `${match[1]}:${match[2]}`;
  const explicitOffset = /(Z|[+-]\d{2}:?\d{2})$/u.exec(stored)?.[1] ?? null;
  const normalizedOffset = explicitOffset === 'Z'
    ? 'UTC'
    : explicitOffset ? `UTC${explicitOffset.length === 5
      ? `${explicitOffset.slice(0, 3)}:${explicitOffset.slice(3)}`
      : explicitOffset}` : 'unknown';
  return {
    value: stored,
    recorded_date: date,
    hour24,
    timezone: eventTimeZone ?? (explicitOffset ? normalizedOffset : 'unknown'),
  };
}
