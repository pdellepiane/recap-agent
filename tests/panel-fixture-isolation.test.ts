import { describe, expect, it, vi } from 'vitest';
import { EvalLoader } from '../src/evals/loader';
import { classifyEvalCaseLane } from '../src/evals/runner';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';

const ids = [
  'live_behavior.purchase_delia_status_by_phone',
  'live_behavior.rsvp_declined_state_offers_one_change',
  'live_behavior.rsvp_host_set_declining_consistent',
  'live_behavior.rsvp_missing_action_requires_explicit_decision',
  'live_behavior.rsvp_paolo_mariana_resolved_single',
  'live_feedback.token_seeded_selection_defer_close',
];

describe('previously blocked panel cases use isolated backend worlds', () => {
  it('requires fixture execution and no external RSVP setup for all six cases', async () => {
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
