import { describe, expect, it } from 'vitest';

import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import type {
  AgentEventDetailResult,
  AgentGuestRsvpResult,
} from '../src/runtime/agent-conversation-gateway';
import {
  InMemoryRsvpEffectStore,
  executeRsvpEffectVerified,
  type RsvpEffectOperation,
} from '../src/runtime/rsvp-effect-executor';

const PHONE = { phone_extension: '+51', phone_number: '973296571' };
const CONVERSATION = 'whatsapp#user-rsvp';

function operation(overrides?: Partial<RsvpEffectOperation>): RsvpEffectOperation {
  return {
    conversationKey: CONVERSATION,
    messageId: 'wamid.s11-op',
    guestId: 584353,
    eventId: 38331,
    action: 'attending',
    plusOneResponse: null,
    phoneExtension: PHONE.phone_extension,
    phoneNumber: PHONE.phone_number,
    ...overrides,
  };
}

function respondedAttending(overrides?: Partial<Extract<AgentGuestRsvpResult, { status: 'responded' }>>): AgentGuestRsvpResult {
  return {
    status: 'responded',
    action: 'attending',
    willAttend: true,
    guestId: 584353,
    eventId: 38331,
    eventName: 'Otra celebracion prueba',
    eventDate: '2026-08-19 05:00:00',
    ...overrides,
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

describe('S11 RSVP verified effect seam', () => {
  it('persists intent before execution and the verified receipt before reply with a single write and one fresh read', async () => {
    const events: string[] = [];
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    let reads = 0;
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        writes += 1;
        events.push('execute');
        return respondedAttending();
      },
      getEventDetail: async (): Promise<AgentEventDetailResult> => {
        reads += 1;
        events.push('read');
        return observedAttendingDetail();
      },
    };
    const outcome = await executeRsvpEffectVerified({
      operation: operation(),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(outcome.status).toBe('verified');
    expect(outcome.attendanceConfirmed).toBe(true);
    expect(outcome.successClaimAllowed).toBe(true);
    expect(outcome.effectApplied).toBe(true);
    expect(outcome.writeCount).toBe(1);
    expect(outcome.readCount).toBe(1);
    expect(outcome.freshRead).toBe(true);
    expect(outcome.replayed).toBe(false);
    expect(outcome.persistedBeforeReply).toBe(true);
    expect(outcome.requested.action).toBe('attending');
    expect(outcome.observed?.attendance).toBe('attending');
    expect(outcome.observed?.source).toBe('fresh_read');
    expect(outcome.companionConfirmed).toBe(false);
    expect(outcome.companionVerification).toBe('unavailable');
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    expect(events).toEqual(['execute', 'read']);
    const receipt = await store.loadByMessage(CONVERSATION, 'wamid.s11-op');
    expect(receipt?.status).toBe('complete');
    expect(receipt?.outcome?.persistedBeforeReply).toBe(true);
  });

  it('never retries a retryable failure automatically and stays unconfirmed without a success claim', async () => {
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
    const outcome = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-noretry' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    expect(outcome.status).toBe('unconfirmed');
    expect(outcome.successClaimAllowed).toBe(false);
    expect(outcome.persistence).toBe('unknown');
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
    const outcome = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-timeout' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    expect(outcome.status).toBe('observed_state');
    expect(outcome.observed?.attendance).toBe('attending');
    expect(outcome.observedWithoutAttribution).toBe(true);
    expect(outcome.successClaimAllowed).toBe(false);
  });

  it('timeout with unknown read stays unconfirmed without a success claim', async () => {
    const store = new InMemoryRsvpEffectStore();
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        throw new Error('timeout');
      },
      getEventDetail: async (): Promise<AgentEventDetailResult> => ({ status: 'not_found' }),
    };
    const outcome = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-unknown' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(outcome.status).toBe('unconfirmed');
    expect(outcome.observed).toBeNull();
    expect(outcome.successClaimAllowed).toBe(false);
    expect(outcome.failureReason).toBe('read_unavailable');
  });

  it('result save failure never claims success', async () => {
    const store = new InMemoryRsvpEffectStore();
    store.failNextResultSave();
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => respondedAttending(),
      getEventDetail: async (): Promise<AgentEventDetailResult> => observedAttendingDetail(),
    };
    const outcome = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-savefail' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(outcome.status).toBe('unconfirmed');
    expect(outcome.failureReason).toBe('result_save_failed');
    expect(outcome.successClaimAllowed).toBe(false);
    expect(outcome.persistedBeforeReply).toBe(false);
  });

  it('delivery retry replays the persisted receipt without rerunning the effect and never as a fresh read', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
        writes += 1;
        return respondedAttending();
      },
      getEventDetail: async (): Promise<AgentEventDetailResult> => observedAttendingDetail(),
    };
    const first = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-delivery' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(first.status).toBe('verified');
    const replayed = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-delivery' }),
      gateway: {
        guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
          writes += 1;
          return respondedAttending();
        },
        getEventDetail: async (): Promise<AgentEventDetailResult> => observedAttendingDetail(),
      },
      store,
      dedupCoverage: 'native',
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.freshRead).toBe(false);
    expect(replayed.observed?.attendance).toBe('attending');
    expect(writes).toBe(1);
  });

  it('unsupported backend performs no write and claims nothing', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    const outcome = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-unsupported' }),
      gateway: {
        capabilityDescriptor: { 'rsvp.response.write': { available: false } },
        guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
          writes += 1;
          return respondedAttending();
        },
      },
      store,
      dedupCoverage: 'native',
    });
    expect(writes).toBe(0);
    expect(outcome.status).toBe('no_write');
    expect(outcome.writeCount).toBe(0);
    expect(outcome.successClaimAllowed).toBe(false);
  });

  it('rejected lease blocks the write with no success claim', async () => {
    const store = new InMemoryRsvpEffectStore();
    let writes = 0;
    const outcome = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-fence' }),
      gateway: {
        guestRsvp: async (): Promise<AgentGuestRsvpResult> => {
          writes += 1;
          return respondedAttending();
        },
      },
      store,
      dedupCoverage: 'native',
      validateLease: async () => false,
    });
    expect(writes).toBe(0);
    expect(outcome.status).toBe('unconfirmed');
    expect(outcome.failureReason).toBe('lease_rejected');
    expect(outcome.successClaimAllowed).toBe(false);
  });

  it('rejects a mismatched returned guest id without trusting the echo', async () => {
    const store = new InMemoryRsvpEffectStore();
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => respondedAttending({ guestId: 999999 }),
      getEventDetail: async (): Promise<AgentEventDetailResult> => observedAttendingDetail(),
    };
    const outcome = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-guest-mismatch' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(outcome.status).toBe('unconfirmed');
    expect(outcome.failureReason).toBe('guest_mismatch');
    expect(outcome.mismatch).toMatchObject({ kind: 'guest_id', expected: '584353', returned: '999999' });
    expect(outcome.successClaimAllowed).toBe(false);
  });

  it('duplicate id with a different operation is a conflict, never an overwrite', async () => {
    const store = new InMemoryRsvpEffectStore();
    const gateway = {
      guestRsvp: async (): Promise<AgentGuestRsvpResult> => respondedAttending(),
      getEventDetail: async (): Promise<AgentEventDetailResult> => observedAttendingDetail(),
    };
    const first = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-conflict' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(first.status).toBe('verified');
    const second = await executeRsvpEffectVerified({
      operation: operation({ messageId: 'wamid.s11-conflict', action: 'declining' }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(second.status).toBe('unconfirmed');
    expect(second.failureReason).toBe('intent_conflict');
    const receipt = await store.loadByMessage(CONVERSATION, 'wamid.s11-conflict');
    expect(receipt?.outcome?.status).toBe('verified');
    expect(receipt?.requested.action).toBe('attending');
  });

  it('S02 fixture simulation verifies one attending write with receipt', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s02-rsvp-reversal', undefined, {
      runId: 'run-s11',
      caseId: 'case-s11-durability',
    });
    const store = new InMemoryRsvpEffectStore();
    const outcome = await executeRsvpEffectVerified({
      // Fixture world keys event and guest identity by 584353.
      operation: operation({ messageId: 'wamid.s11-fixture', eventId: 584353 }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(outcome.status).toBe('verified');
    expect(outcome.observed?.attendance).toBe('attending');
    expect(outcome.writeCount).toBe(1);
    expect(outcome.readCount).toBe(1);
    expect(gateway.getFixtureCallCount('rsvp.write')).toBe(1);
    expect(gateway.getRsvpAttendanceForTesting(584353)).toBe(true);
  });

  it('s11 live world reads declining then verifies one attending write with receipt', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s11-rsvp-durability-declining', undefined, {
      runId: 'run-s11-live',
      caseId: 'case-s11-durability-live',
    });
    const detail = await gateway.getEventDetail({
      eventId: 584353,
      phone_extension: '+51',
      phone_number: '973296571',
    });
    expect(detail.status).toBe('success');
    if (detail.status !== 'success') {
      throw new Error('s11 fixture detail must load');
    }
    expect(detail.event.attendance?.willAttend).toBe(false);
    const store = new InMemoryRsvpEffectStore();
    const outcome = await executeRsvpEffectVerified({
      // Fixture world keys event and guest identity by 584353.
      operation: operation({ messageId: 'wamid.s11-live-world', eventId: 584353 }),
      gateway,
      store,
      dedupCoverage: 'native',
    });
    expect(outcome.status).toBe('verified');
    expect(outcome.observed?.attendance).toBe('attending');
    expect(outcome.writeCount).toBe(1);
    expect(outcome.successClaimAllowed).toBe(true);
    expect(gateway.getFixtureCallCount('rsvp.write')).toBe(1);
    expect(gateway.getRsvpAttendanceForTesting(584353)).toBe(true);
  });
});
