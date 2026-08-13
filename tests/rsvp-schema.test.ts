import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan, planSchema } from '../src/core/plan';
import { deriveDynamicAgentPolicy } from '../src/runtime/dynamic-agent-policy';
import { resolveResumeNode } from '../src/core/decision-flow';
import { createDynamicExtractionSchema } from '../src/runtime/extraction-schemas';

describe('RSVP typed state and extraction', () => {
  it('persists a bounded event-selection state and preserves it through unrelated updates', () => {
    const plan = mergePlan(createEmptyPlan({
      planId: 'plan-rsvp',
      channel: 'whatsapp',
      externalUserId: 'user-rsvp',
    }), {
      current_node: 'responder_invitacion',
      rsvp_state: {
        status: 'awaiting_event_selection',
        pending_action: 'attending',
        candidates: [
          {
            guest_id: 41,
            event_name: 'Matrimonio de Ana y Luis',
            event_date: '2026-09-12',
          },
          {
            guest_id: 42,
            event_name: 'Cumpleaños de Marta',
            event_date: null,
          },
        ],
        requested_at: '2026-08-13T15:00:00.000Z',
        selection_attempts: 0,
      },
    });

    const updated = mergePlan(plan, { location: 'Miraflores' });

    expect(updated.rsvp_state).toEqual(plan.rsvp_state);
    expect(planSchema.parse(updated).rsvp_state.status).toBe(
      'awaiting_event_selection',
    );
    expect(resolveResumeNode(updated)).toBe('responder_invitacion');
  });

  it('offers RSVP in the base policy without requiring a provider plan', () => {
    const policy = deriveDynamicAgentPolicy(createEmptyPlan({
      planId: 'plan-rsvp-policy',
      channel: 'whatsapp',
      externalUserId: 'user-rsvp-policy',
    }));

    expect(policy.allowedActionIntents).toContain('responder_invitacion');
    expect(policy.allowedNextNodes).toContain('responder_invitacion');
  });

  it('includes RSVP evidence only in the RSVP-capable schema', () => {
    const baseCapabilities = {
      information: false,
      rsvp: false,
      providerPlanning: false,
      providerOperations: false,
      providerSelection: false,
      providerInspection: false,
      contact: false,
      close: false,
      pause: false,
    };
    const withoutRsvp = createDynamicExtractionSchema({
      allowedActionIntents: ['solicitar_humano'],
      capabilities: baseCapabilities,
    });
    const withRsvp = createDynamicExtractionSchema({
      allowedActionIntents: ['solicitar_humano', 'responder_invitacion'],
      capabilities: { ...baseCapabilities, rsvp: true },
    });

    expect(withoutRsvp.keyof().options).not.toContain('rsvpAction');
    expect(withRsvp.keyof().options).toEqual(expect.arrayContaining([
      'rsvpAction',
      'rsvpCandidateGuestId',
      'rsvpEventReference',
    ]));
    expect(withRsvp.parse({
      actionIntent: 'responder_invitacion',
      intentConfidence: 0.98,
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
      assumptions: [],
      conversationSummary: 'La persona confirma que asistirá.',
      rsvpAction: 'attending',
      rsvpCandidateGuestId: 41,
      rsvpEventReference: 'Matrimonio de Ana y Luis',
    })).toMatchObject({
      actionIntent: 'responder_invitacion',
      rsvpAction: 'attending',
      rsvpCandidateGuestId: 41,
    });
  });
});
