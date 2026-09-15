import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  setupRsvpIsolation,
  teardownRsvpIsolation,
} from '../src/evals/rsvp-isolation';

const SETUP = {
  guestId: 584353,
  eventName: 'Otra celebración prueba',
  phone: '+51973296571',
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ status: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function eventDetailData(willAttend: boolean): Record<string, unknown> {
  return {
    event: {
      event_id: 100,
      name: 'Otra celebración prueba',
      slug: 'otra-celebracion-prueba',
      with_time: false,
    },
    attendance: {
      guest_id: 584353,
      name: 'Invitado',
      has_responded: true,
      will_attend: willAttend,
      response_date: null,
    },
    purchases: [],
  };
}

function stubBackend(options: { detailWillAttend: boolean | 'follow-write' }): {
  calls: Array<{ method: string; path: string; body: unknown }>;
} {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let written: 'attending' | 'declining' | null = null;
  vi.stubEnv('SE_API_KEY', 'test-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const raw = String(url);
      const path = raw.replace(/^https?:\/\/[^/]+/u, '');
      const method = init?.method ?? 'GET';
      let body: unknown = null;
      try {
        body = init?.body ? (JSON.parse(init.body) as unknown) : null;
      } catch {
        body = null;
      }
      calls.push({ method, path, body });
      if (path.includes('/guest/rsvp')) {
        const action = (body as { action?: string } | null)?.action;
        written = action === 'attending' ? 'attending' : 'declining';
        return jsonResponse({
          will_attend: written === 'attending',
          guest_id: 584353,
          event_id: 100,
        });
      }
      if (path.includes('/guest/events')) {
        return jsonResponse({
          events: [
            {
              event_id: 100,
              name: 'Otra celebración prueba',
              slug: 'otra-celebracion-prueba',
              role: 'guest',
            },
          ],
        });
      }
      if (path.includes('/event?')) {
        const willAttend = options.detailWillAttend === 'follow-write'
          ? written === null || written === 'attending'
          : options.detailWillAttend;
        return jsonResponse(eventDetailData(willAttend));
      }
      throw new Error(`Unexpected backend path: ${path}`);
    }),
  );
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('rsvp isolation prior read and read-back verify', () => {
  it('reads the actual prior state, verifies the write, and restores the prior read', async () => {
    const { calls } = stubBackend({ detailWillAttend: 'follow-write' });
    // Backend starts attending (no write yet): the prior read observes it.
    const declining = await setupRsvpIsolation({
      setup: { ...SETUP, targetState: 'declining' },
    });
    // The prior read is the actual backend state (attending), never an
    // assumed decline.
    expect(declining?.priorState).toBe('attending');
    expect(declining?.targetState).toBe('declining');
    const writes = calls.filter((call) => call.path.includes('/guest/rsvp'));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ action: 'declining', guest_id: 584353 });
    // Read-back verify ran against a fresh read (no mismatch thrown).
    expect(calls.filter((call) => call.path.includes('/event?')).length).toBeGreaterThanOrEqual(2);

    await teardownRsvpIsolation(
      {
        setup: { ...SETUP, targetState: 'declining' },
        teardown: { ...SETUP, restore: true },
      },
      declining,
    );
    // Teardown restores the actual prior read (attending), not an assumed state.
    const allWrites = calls.filter((call) => call.path.includes('/guest/rsvp'));
    expect(allWrites).toHaveLength(2);
    expect(allWrites[1]?.body).toMatchObject({ action: 'attending', guest_id: 584353 });
  });

  it('errors setup when the read-back contradicts the written target', async () => {
    // Detail stays attending no matter what is written: read-back mismatch.
    stubBackend({ detailWillAttend: true });
    await expect(
      setupRsvpIsolation({ setup: { ...SETUP, targetState: 'declining' } }),
    ).rejects.toThrow('read-back mismatch');
  });

  it('performs no writes for a pending target even with a decided prior read', async () => {
    const { calls } = stubBackend({ detailWillAttend: true });
    const context = await setupRsvpIsolation({
      setup: { ...SETUP, targetState: 'pending' },
    });
    expect(calls.filter((call) => call.path.includes('/guest/rsvp'))).toHaveLength(0);
    await teardownRsvpIsolation(
      {
        setup: { ...SETUP, targetState: 'pending' },
        teardown: { ...SETUP, restore: true },
      },
      context,
    );
    expect(calls.filter((call) => call.path.includes('/guest/rsvp'))).toHaveLength(0);
  });
});
