/**
 * Validates timestamps supplied by the Agent API while preserving the server
 * representation. The API is the source of truth for timezone; this module
 * deliberately performs no Date construction or timezone arithmetic.
 */
export function normalizeServerTimestamp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed);
  if (dateMatch) {
    return isValidCalendarDate(
      Number(dateMatch[1]),
      Number(dateMatch[2]),
      Number(dateMatch[3]),
    )
      ? trimmed
      : null;
  }

  // The Agent API also returns already-localized event datetimes in this
  // representation. Validate the calendar and clock fields, but preserve the
  // server value exactly; the runtime must not infer or shift its timezone.
  const localizedDateTimeMatch = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/u.exec(trimmed);
  if (localizedDateTimeMatch) {
    const day = Number(localizedDateTimeMatch[1]);
    const month = Number(localizedDateTimeMatch[2]);
    const year = Number(localizedDateTimeMatch[3]);
    const hour = localizedDateTimeMatch[4] === undefined
      ? null
      : Number(localizedDateTimeMatch[4]);
    const minute = localizedDateTimeMatch[5] === undefined
      ? null
      : Number(localizedDateTimeMatch[5]);
    const second = localizedDateTimeMatch[6] === undefined
      ? null
      : Number(localizedDateTimeMatch[6]);
    if (
      !isValidCalendarDate(year, month, day) ||
      (hour !== null && hour > 23) ||
      (minute !== null && minute > 59) ||
      (second !== null && second > 59)
    ) {
      return null;
    }
    return trimmed;
  }

  const datetimeMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/u.exec(trimmed);
  if (!datetimeMatch) {
    return null;
  }

  const year = Number(datetimeMatch[1]);
  const month = Number(datetimeMatch[2]);
  const day = Number(datetimeMatch[3]);
  const hour = Number(datetimeMatch[4]);
  const minute = Number(datetimeMatch[5]);
  const second = Number(datetimeMatch[6]);
  if (
    !isValidCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const offset = datetimeMatch[8];
  if (offset && offset !== 'Z') {
    const offsetMatch = /^[+-](\d{2}):?(\d{2})$/u.exec(offset);
    if (!offsetMatch || Number(offsetMatch[1]) > 23 || Number(offsetMatch[2]) > 59) {
      return null;
    }
  }

  return trimmed;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}
