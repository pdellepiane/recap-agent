import { describe, expect, it } from 'vitest';

import {
  buildCloseSubmissionReceipt,
  parseFinishPlanTurnOutcome,
} from '../src/runtime/close-submission-summary';

const effect = {
  providerId: 101,
  category: 'Catering',
  status: 'confirmed',
  eventDate: '2026-10-18',
  receiptId: 'quote-101',
  attemptCount: 1,
};

describe('close submission evidence', () => {
  it('retains typed per-provider receipts and the explicit date', () => {
    const outcome = parseFinishPlanTurnOutcome(JSON.stringify({
      status: 'success',
      eventDate: '2026-10-18',
      contacted_providers: [{ providerId: 101, category: 'Catering', success: true }],
      effects: [effect],
    }));

    expect(outcome).toEqual({
      status: 'success',
      eventDate: '2026-10-18',
      providers: [effect],
      error: null,
    });
  });

  it.each([
    ['failed', 'failed'],
    ['unresolved', 'unresolved'],
  ] as const)('preserves a %s provider outcome without treating it as success', (status, expected) => {
    const receipt = buildCloseSubmissionReceipt([{
      tool: 'finish_plan',
      output: JSON.stringify({
        status: 'failed',
        eventDate: '2026-10-18',
        effects: [{ ...effect, status, receiptId: null }],
      }),
    }]);
    expect(receipt?.providers[0]?.status).toBe(expected);
    expect(receipt?.providers[0]?.receiptId).toBeNull();
  });

  it('represents validation failures as typed errors with no effect receipt', () => {
    expect(parseFinishPlanTurnOutcome(JSON.stringify({
      status: 'failed',
      error: 'missing_event_date',
      eventDate: null,
      effects: [],
    }))).toEqual({
      status: 'failed',
      eventDate: null,
      providers: [],
      error: 'missing_event_date',
    });
  });

  it('rejects invocation-shaped, unconfirmed, and malformed outcomes', () => {
    // Invocation-shaped output without actual effects.
    expect(parseFinishPlanTurnOutcome(JSON.stringify({
      status: 'success',
      eventDate: '2026-10-18',
      contacted_providers: [{ providerId: 101, category: 'Catering', success: true }],
    }))).toBeUndefined();
    // A success status whose effects are not confirmed.
    expect(parseFinishPlanTurnOutcome(JSON.stringify({
      status: 'success',
      eventDate: '2026-10-18',
      effects: [{ ...effect, status: 'failed', receiptId: null }],
    }))).toBeUndefined();
    // Malformed receipts and invalid dates.
    expect(parseFinishPlanTurnOutcome(JSON.stringify({
      status: 'success', eventDate: '2026-10-18', effects: [{ ...effect, attemptCount: 0 }],
    }))).toBeUndefined();
    expect(parseFinishPlanTurnOutcome(JSON.stringify({
      status: 'success', eventDate: '2026-13-40', effects: [effect],
    }))).toBeUndefined();
  });
});
