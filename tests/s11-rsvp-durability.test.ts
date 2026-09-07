import { describe, expect, it } from 'vitest';

import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import type {
  AgentEventDetailResult,
  AgentGuestRsvpResult,
} from '../src/runtime/agent-conversation-gateway';
import { decideRsvpTurn } from '../src/runtime/rsvp-decision-policy';
import {
  InMemoryRsvpEffectStore,
  executeRsvpEffectDurably,
  renderRsvpDurableOutcomeEs,
  replayPersistedRsvpOutcome,
} from '../src/runtime/rsvp-effect-executor';

const PHONE = { phone_extension: '+51', phone_number: '973296571' };

function authorizedDecision() {
  return decideRsvpTurn({
    trusted: [{
      guestId: 584353,
      eventId: 38331,
      eventName: 'Otra celebracion prueba',
      eventDate: '2026-08-19 05:00:00',
      attendance: 'declining',
    }],
    semanticTitle: 'Otra celebracion prueba',
    hasExplicitDecision: true,
    decisionSource: 'current_message',
    requestedAction: 'attending',
    lookupFailed: false,
    alreadyOfferedKeys: [],
    explicitNoChange: false,
  });
}

function respondedAttending(): AgentGuestRsvpResult {
  return {
    status: 'responded',
    action: 'attending',
    willAttend: true,
    guestId: 584353,
    eventName: 'Otra celebracion prueba',
    eventDate: '2026-08-19 05:00:00',
  };
}

function observedAttendingDetail(): AgentEventDetailResult {
  return {
    status: 'success',
    event: {
      eventId: 38331,
      name: 'Otra celebracion prueba',
      slug: 'otra',
      url: null,
      datetime: '2026-08-19 05:00:00',
      type: null,
      typeDetail: null,
      stage: null,
      city: null,
      country: null,
      currency: null,
      withTime: true,
      timezone: null,
      celebrateds: [],
      moments: [],
      dresscode: null,
      commonAsked: [],
      contactInfo: [],
      attendance: {
        guestId: 584353,
        name: 'Invitado',
        hasResponded: true,
        willAttend: true,
        responseDate: '2026-08-20 15:00:00',
      },
      purchases: [],
    },
  };
}

describe('S11 RSVP effect durability seam', () => {
  it('persists intent before execution and result before reply with a single write', async () => {
    const events: string[] = [];
    const store = new InMemoryRsvpEffectStore(() => events.push('intent'), () => events.push('result'));
    let calls = 0;
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        calls += 1;
        events.push('execute');
        return respondedAttending();
      },
    };
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway,
      store,
      messageId: 'wamid.s11-order',
      intentId: 'intent-order-1',
    });
    expect(outcome.status).toBe('confirmed');
    expect(outcome.finalAttendance).toBe('attending');
    expect(outcome.attemptedEffectCount).toBe(1);
    expect(outcome.stateReadCount).toBe(0);
    expect(outcome.successClaimAllowed).toBe(true);
    expect(calls).toBe(1);
    expect(events).toEqual(['intent', 'execute', 'result']);
    expect(store.loadResultSync('intent-order-1')?.persistedBeforeReply).toBe(true);
  });

  it('never retries a retryable failure automatically and escalates without a success claim', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    let reads = 0;
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        writes += 1;
        return { status: 'failed', error: 'upstream 500', retryable: true };
      },
      getEventDetail: async (): Promise<AgentEventDetailResult> => {
        reads += 1;
        return { status: 'failed', error: 'detail unavailable', retryable: false };
      },
    };
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway,
      store,
      messageId: 'wamid.s11-noretry',
      intentId: 'intent-noretry-1',
      readEventId: 38331,
    });
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    expect(outcome.status).toBe('needs_help');
    expect(outcome.successClaimAllowed).toBe(false);
    expect(outcome.needsHumanHelp).toBe(true);
    expect(renderRsvpDurableOutcomeEs(outcome)).not.toMatch('confirmada');
  });

  it('on timeout uses one authorized state read and reports observed state without attribution', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    let reads = 0;
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        writes += 1;
        throw new Error('rsvp write timeout after 3000ms');
      },
      getEventDetail: async (): Promise<AgentEventDetailResult> => {
        reads += 1;
        return observedAttendingDetail();
      },
    };
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway,
      store,
      messageId: 'wamid.s11-timeout',
      intentId: 'intent-timeout-1',
      readEventId: 38331,
    });
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    expect(outcome.status).toBe('observed_state');
    expect(outcome.finalAttendance).toBe('attending');
    expect(outcome.observedWithoutAttribution).toBe(true);
    expect(outcome.successClaimAllowed).toBe(false);
    const text = renderRsvpDurableOutcomeEs(outcome);
    expect(text).toContain('figura');
    expect(text).not.toMatch('hemos confirmado|se ha registrado por esta solicitud');
  });

  it('timeout with unknown read escalates to human help without a success claim', async () => {
    const store = new InMemoryRsvpEffectStore();
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        throw new Error('timeout');
      },
      getEventDetail: async (): Promise<AgentEventDetailResult> => ({ status: 'not_found' }),
    };
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway,
      store,
      messageId: 'wamid.s11-unknown',
      intentId: 'intent-unknown-1',
      readEventId: 38331,
    });
    expect(outcome.status).toBe('needs_help');
    expect(outcome.finalAttendance).toBeNull();
    expect(outcome.successClaimAllowed).toBe(false);
    expect(outcome.needsHumanHelp).toBe(true);
  });

  it('save failure never claims success', async () => {
    const store = new InMemoryRsvpEffectStore();
    store.failNextResultSave();
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => respondedAttending(),
    };
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway,
      store,
      messageId: 'wamid.s11-savefail',
      intentId: 'intent-savefail-1',
    });
    expect(outcome.status).toBe('needs_help');
    expect(outcome.saveError).toBe('result_save_failed');
    expect(outcome.successClaimAllowed).toBe(false);
  });

  it('delivery retry replays the persisted outcome without rerunning the effect', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        writes += 1;
        return respondedAttending();
      },
    };
    const first = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway,
      store,
      messageId: 'wamid.s11-delivery',
      intentId: 'intent-delivery-1',
    });
    expect(first.status).toBe('confirmed');
    const replayed = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway: {
        guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
          writes += 1;
          return respondedAttending();
        },
      },
      store,
      messageId: 'wamid.s11-delivery',
      intentId: 'intent-delivery-2',
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.finalAttendance).toBe('attending');
    expect(writes).toBe(1);
    expect(replayPersistedRsvpOutcome(store, 'wamid.s11-delivery')?.finalAttendance).toBe('attending');
  });

  it('unsupported backend never claims success and performs no write', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway: {
        capabilityDescriptor: { 'rsvp.response.write': { available: false } },
        guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
          writes += 1;
          return respondedAttending();
        },
      },
      store,
      messageId: 'wamid.s11-unsupported',
      intentId: 'intent-unsupported-1',
    });
    expect(writes).toBe(0);
    expect(outcome.attemptedEffectCount).toBe(0);
    expect(outcome.successClaimAllowed).toBe(false);
    expect(outcome.needsHumanHelp).toBe(true);
  });

  it('expired lease fence blocks the write without a second lock store', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway: {
        guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
          writes += 1;
          return respondedAttending();
        },
      },
      store,
      messageId: 'wamid.s11-fence',
      intentId: 'intent-fence-1',
      lease: { currentOwnerId: 'owner-b', ownerId: 'owner-a', nowMs: 2000, expiresAtMs: 1000 },
    });
    expect(writes).toBe(0);
    expect(outcome.status).toBe('needs_help');
    expect(outcome.saveError).toBe('lease_fence_rejected');
  });

  it('S02 fixture simulation proves final attendance and single attempted effect', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s02-rsvp-reversal', undefined, {
      runId: 'run-s11',
      caseId: 'case-s11-durability',
    });
    const store = new InMemoryRsvpEffectStore();
    const outcome = await executeRsvpEffectDurably({
      decision: authorizedDecision(),
      phone: PHONE,
      gateway,
      store,
      messageId: 'wamid.s11-fixture',
      intentId: 'intent-fixture-1',
    });
    expect(outcome.status).toBe('confirmed');
    expect(outcome.finalAttendance).toBe('attending');
    expect(outcome.attemptedEffectCount).toBe(1);
    expect(gateway.getFixtureCallCount('rsvp.write')).toBe(1);
    expect(gateway.getRsvpAttendanceForTesting(584353)).toBe(true);
  });
});
