import { describe, expect, it, vi } from 'vitest';
import { EvalLoader } from '../src/evals/loader';
import { classifyEvalCaseLane } from '../src/evals/runner';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';

const ids = [
  'live_behavior.rsvp_host_set_declining_consistent',
  'live_behavior.rsvp_confirmed_state_is_reported',
];

describe('previously blocked panel cases use isolated backend worlds', () => {
  // 2026-09-30 condensation: the declined-state and missing-action threads
  // merged into s11_rsvp_durability_confirms_once, which performs a real
  // durability write and therefore uses RSVP setup by design.
  it('requires fixture execution and no external RSVP setup for all four cases', async () => {
    const catalog = await new EvalLoader('evals').loadCatalog();
    for (const id of ids) {
      const currentCase = catalog.cases.find((entry) => entry.id === id);
      expect(currentCase, id).toBeDefined();
      if (!currentCase) throw new Error(`Missing case ${id}`);
      expect(currentCase.rsvpIsolation, id).toBeUndefined();
      expect(classifyEvalCaseLane(currentCase).lane, id).toBe('parallel');
    }
  });

  it('serves attendance polarity from fixture data without network access', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    try {
      for (const [scenario, expected] of [
        ['rsvp-resolved-attending', true],
        ['rsvp-host-declining', false],
      ] as const) {
        const gateway = await FixtureAgentConversationGateway.create(scenario);
        const result = await gateway.getEventDetail({ eventId: 584353 });
        expect(result.status).toBe('success');
        if (result.status === 'success') {
          expect(result.event.attendance?.guestId).toBe(584353);
          expect(result.event.attendance?.willAttend).toBe(expected);
          if (!expected) expect(result.event.attendance?.hasResponded).toBe(false);
        }
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
