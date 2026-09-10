/** Start turn two only after observing turn one's real lock, then preserve input order. */
export async function runOverlappingTurns<T>(args: {
  first: () => Promise<T>;
  second: () => Promise<T>;
  firstLockIsHeld: () => Promise<boolean>;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<[T, T]> {
  let firstFinished = false;
  const first = args.first().finally(() => { firstFinished = true; });
  // Observe rejection immediately; the original result is still awaited below.
  void first.catch(() => undefined);
  let second: Promise<T> | undefined;
  try {
    const deadline = Date.now() + (args.timeoutMs ?? 10_000);
    while (!firstFinished && Date.now() < deadline) {
      if (await args.firstLockIsHeld()) {
        if (!firstFinished) second = args.second();
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, args.pollMs ?? 50));
    }
    if (!second) {
      // Preserve the request failure instead of misclassifying it as a lock flake.
      if (firstFinished) await first;
      throw new Error('Concurrency regression did not observe an active first-turn lock.');
    }
    // All work must settle even if one request fails; never leave mutations in flight.
    const results = await Promise.allSettled([first, second]);
    const [a, b] = results;
    if (a.status === 'rejected') throw a.reason;
    if (b.status === 'rejected') throw b.reason;
    return [a.value, b.value];
  } finally {
    await Promise.allSettled(second ? [first, second] : [first]);
  }
}

export function parseTurnCoordinationHeaders(headers: Headers | undefined): {
  wait_ms: number;
  attempts: number;
} | undefined {
  const wait = headers?.get('x-recap-turn-wait-ms');
  const attempts = headers?.get('x-recap-turn-acquire-attempts');
  if (!wait || !attempts || !/^\d+$/u.test(wait) || !/^\d+$/u.test(attempts)) return undefined;
  const parsed = { wait_ms: Number(wait), attempts: Number(attempts) };
  return Number.isSafeInteger(parsed.wait_ms) && Number.isSafeInteger(parsed.attempts)
    && parsed.attempts > 0 ? parsed : undefined;
}
