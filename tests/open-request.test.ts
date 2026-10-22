import { describe, expect, it } from 'vitest';

import {
  advanceOpenRequests,
  currentOpenRequest,
  nextOpenRequestState,
  OPEN_REQUEST_LIMIT,
  type OpenRequest,
} from '../src/core/open-request';

const NOW = '2026-10-22T12:00:00.000Z';
const LATER = '2026-10-22T12:05:00.000Z';

function record(overrides: Partial<OpenRequest> = {}): OpenRequest {
  return {
    key: 'msg-1',
    opening_text: 'Quiero la devolución de los 87 soles.',
    state: 'unresolved',
    since: NOW,
    turns: 1,
    ...overrides,
  };
}

describe('nextOpenRequestState', () => {
  it('keeps the record still on a pause and on a suppressed acknowledgement', () => {
    const base = { handoffConfirmed: false, requestSettled: true, unresolvedMoney: false };
    expect(nextOpenRequestState({ outcome: 'pause', ...base })).toBeNull();
    expect(nextOpenRequestState({ outcome: 'suppress_ack', ...base })).toBeNull();
    expect(nextOpenRequestState({ outcome: 'offer_human', ...base })).toBeNull();
  });

  it('records the real outcome of an escalation attempt', () => {
    expect(nextOpenRequestState({
      outcome: 'escalate',
      handoffConfirmed: true,
      requestSettled: false,
      unresolvedMoney: false,
    })).toBe('with_person');
    expect(nextOpenRequestState({
      outcome: 'escalate',
      handoffConfirmed: false,
      requestSettled: false,
      unresolvedMoney: false,
    })).toBe('unresolved');
  });

  it('settles a request only when the turn settled it and the money agrees', () => {
    expect(nextOpenRequestState({
      outcome: 'answer',
      handoffConfirmed: false,
      requestSettled: true,
      unresolvedMoney: false,
    })).toBe('answered');
    expect(nextOpenRequestState({
      outcome: 'answer',
      handoffConfirmed: false,
      requestSettled: false,
      unresolvedMoney: false,
    })).toBe('unresolved');
    expect(nextOpenRequestState({
      outcome: 'answer',
      handoffConfirmed: false,
      requestSettled: true,
      unresolvedMoney: true,
    })).toBe('unresolved');
  });

  it('marks a clarification as needing input', () => {
    expect(nextOpenRequestState({
      outcome: 'clarify',
      handoffConfirmed: false,
      requestSettled: false,
      unresolvedMoney: false,
    })).toBe('needs_input');
  });
});

describe('advanceOpenRequests', () => {
  it('opens a record for a new request instead of inheriting the parked one', () => {
    const previous = [record({ state: 'with_person' })];
    const next = advanceOpenRequests({
      previous,
      sameOpenRequest: false,
      openingText: 'A qué hora empieza el baby shower del 17?',
      nextState: 'answered',
      nowIso: LATER,
      openingKey: 'msg-2',
    });
    expect(next).toHaveLength(2);
    expect(next[0]?.state).toBe('with_person');
    expect(next[1]).toMatchObject({
      key: 'msg-2',
      state: 'answered',
      turns: 1,
      opening_text: 'A qué hora empieza el baby shower del 17?',
    });
  });

  it('counts the turns of the same request and restarts the state clock only on a change', () => {
    const previous = [record({ state: 'unresolved', since: NOW, turns: 1 })];
    const stillOpen = advanceOpenRequests({
      previous,
      sameOpenRequest: true,
      openingText: 'insisto',
      nextState: 'unresolved',
      nowIso: LATER,
      openingKey: 'msg-2',
    });
    expect(stillOpen[0]).toMatchObject({ state: 'unresolved', since: NOW, turns: 2 });

    const parked = advanceOpenRequests({
      previous,
      sameOpenRequest: true,
      openingText: 'insisto',
      nextState: 'with_person',
      nowIso: LATER,
      openingKey: 'msg-2',
    });
    expect(parked[0]).toMatchObject({ state: 'with_person', since: LATER, turns: 2 });
  });

  it('leaves the record untouched when the turn changed no state', () => {
    const previous = [record({ state: 'with_person' })];
    expect(advanceOpenRequests({
      previous,
      sameOpenRequest: true,
      openingText: 'nada',
      nextState: null,
      nowIso: LATER,
      openingKey: 'msg-2',
    })).toBe(previous);
    expect(advanceOpenRequests({
      previous,
      sameOpenRequest: false,
      openingText: 'nada',
      nextState: null,
      nowIso: LATER,
      openingKey: 'msg-2',
    })).toBe(previous);
  });

  it('keeps at most three records and never drops one that is with a person', () => {
    const previous: OpenRequest[] = [
      record({ key: 'a', state: 'with_person', opening_text: 'primera' }),
      record({ key: 'b', state: 'answered', opening_text: 'segunda' }),
      record({ key: 'c', state: 'answered', opening_text: 'tercera' }),
    ];
    const next = advanceOpenRequests({
      previous,
      sameOpenRequest: false,
      openingText: 'cuarta',
      nextState: 'answered',
      nowIso: LATER,
      openingKey: 'd',
    });
    expect(next).toHaveLength(OPEN_REQUEST_LIMIT);
    expect(next.map((entry) => entry.key)).toEqual(['a', 'c', 'd']);
  });

  it('bounds the opening text and keeps the current record last', () => {
    const next = advanceOpenRequests({
      previous: [],
      sameOpenRequest: false,
      openingText: 'x'.repeat(400),
      nextState: 'needs_input',
      nowIso: NOW,
      openingKey: 'msg-9',
    });
    expect(next[0]?.opening_text.length).toBeLessThanOrEqual(121);
    expect(next[0]?.opening_text.endsWith('…')).toBe(true);
    expect(currentOpenRequest(next)?.key).toBe('msg-9');
  });
});

describe('currentOpenRequest', () => {
  it('returns the most recent record or null', () => {
    expect(currentOpenRequest([])).toBeNull();
    expect(currentOpenRequest([record({ key: 'a' }), record({ key: 'b' })])?.key).toBe('b');
  });
});
