import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AgentConversationGateway,
  AgentConversationMessage,
  AgentEventDetailResult,
  AgentGatewayResult,
  AgentGuestEventsResult,
  AgentGuestRsvpInput,
  AgentGuestRsvpResult,
  AgentMessageLogInput,
} from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { InMemoryRsvpEffectStore } from '../src/runtime/rsvp-effect-executor';
import type { CurrentContextEvidence, IdentityEvidence } from '../src/runtime/customer-context';
import { unavailableCustomerContext } from './customer-context-test-utils';

/**
 * Packet B service-level twins: the actual AgentService.handleTurn path with
 * (a) accepted write + confirming read, (b) wrong guest returned,
 * (c) same event different guest in read, (d) attendance saved but companion
 * not saved, (e) read failure, (f) timeout with read observing requested
 * state, (g) duplicate inbound and restart after write before receipt.
 * Zero false success and at most one write in every case.
 */
describe('RSVP verified effect twins', () => {
  it('(a) accepted write plus confirming read yields a verified update with a persisted receipt', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    const result = await service.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-a'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    expect(result.trace.tools_called).toContain('guest_rsvp');
    expect(result.trace.tools_called).toContain('get_guest_event_detail');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { rsvp_state: 'attending', invitation_record: 'available' },
    });
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"verified"');
    expect(note).toContain('"requested_attendance_change_verified":true');
    expect(note).toContain('"persisted_before_reply":true');
    // A genuine verified update yields a model-written confirmation: the
    // stub stands in for the model; the runtime supplies facts only.
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-a');
    expect(receipt?.status).toBe('complete');
    expect(receipt?.requested).toMatchObject({ guestId: 41, eventId: 205, action: 'attending' });
    expect(receipt?.outcome?.observed).toMatchObject({ guestId: 41, eventId: 205, attendance: 'attending', source: 'fresh_read' });
    expect(receipt?.outcome?.successClaimAllowed).toBe(true);
    expect(receipt?.outcome?.writeCount).toBe(1);
  });

  it('(b) wrong guest returned is rejected without trusting the echo', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const gateway = new TwinGateway(
      [responded({ guestId: 999 })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    const result = await service.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-b'));

    expect(gateway.writes).toHaveLength(1);
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { rsvp_state: 'pending' },
    });
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"unconfirmed"');
    expect(note).toContain('"kind":"guest_id"');
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-b');
    expect(receipt?.outcome?.status).toBe('unconfirmed');
    expect(receipt?.outcome?.successClaimAllowed).toBe(false);
    expect(receipt?.outcome?.failureReason).toBe('guest_mismatch');
  });

  it('(c) same event different guest in read is a mismatch, never a confirmation', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ guestId: 42, willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    await service.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-c'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"unconfirmed"');
    expect(note).toContain('"read_status":"mismatch"');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      event: { rsvp_state: 'pending' },
    });
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-c');
    expect(receipt?.outcome?.successClaimAllowed).toBe(false);
  });

  it('(d) attendance saved but companion not saved verifies attendance without claiming the companion', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({
      action: 'attending',
      party: {
        scope: 'self_and_others',
        mentioned_names: ['María'],
        companion_count: 'one',
        plus_one_response: 'yes',
      },
    })]);
    const gateway = new TwinGateway(
      [responded({
        action: 'attending',
        willAttend: true,
        plusOne: { saved: false, response: 'yes', reason: 'not_eligible' },
      })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    await service.handleTurn(twinInbound('Confirmo y viene María', 'wamid-twin-d'));

    expect(gateway.writes).toHaveLength(1);
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"verified"');
    expect(note).toContain('"requested_attendance_change_verified":true');
    expect(note).toContain('"saved":false');
    expect(note).toContain('"verification":"unavailable"');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      event: { rsvp_state: 'attending' },
    });
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-d');
    expect(receipt?.outcome?.attendanceConfirmed).toBe(true);
    expect(receipt?.outcome?.companionConfirmed).toBe(false);
    expect(receipt?.outcome?.companionVerification).toBe('unavailable');
  });

  it('passes a saved companion write receipt without projecting a contradictory false confirmation', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({
      action: 'attending',
      party: {
        scope: 'self_and_others',
        mentioned_names: [],
        companion_count: 'one',
        plus_one_response: 'yes',
      },
    })]);
    const gateway = new TwinGateway(
      [responded({
        action: 'attending',
        willAttend: true,
        plusOne: { saved: true, response: 'yes', reason: null },
      })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    await service.handleTurn(twinInbound('Confirmo y vendrá mi acompañante', 'wamid-twin-companion-saved'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"companion":{"echo":{"saved":true,"response":"yes","reason":null}}');
    expect(note).not.toContain('"confirmed":false');
    expect(note).not.toContain('"verification":"unavailable"');
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-companion-saved');
    expect(receipt?.outcome?.plusOneEcho?.saved).toBe(true);
    expect(receipt?.outcome?.attendanceConfirmed).toBe(true);
  });

  it('(e) read failure stays unconfirmed with unknown persistence and unchanged evidence', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'declining' })]);
    const gateway = new TwinGateway(
      [responded({ action: 'declining', willAttend: false })],
      [new Error('detail unavailable')],
    );
    const service = twinService(runtime, gateway, store);

    await service.handleTurn(twinInbound('No podré asistir', 'wamid-twin-e'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"unconfirmed"');
    expect(note).toContain('"read_status":"unavailable"');
    expect(note).toContain('"persistence":"unknown"');
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      event: { rsvp_state: 'pending' },
    });
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-e');
    expect(receipt?.outcome?.successClaimAllowed).toBe(false);
  });

  it('(f) timeout with read observing requested state reports observed state without attribution and no retry', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const gateway = new TwinGateway(
      [new Error('rsvp write timeout after 3000ms')],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    await service.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-f'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"observed_state"');
    expect(note).toContain('"observed_without_attribution":true');
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-f');
    expect(receipt?.outcome?.successClaimAllowed).toBe(false);
    expect(receipt?.outcome?.observedWithoutAttribution).toBe(true);
  });

  it('(g) duplicate inbound replays the receipt with no second write and never as a fresh read', async () => {
    const store = new InMemoryRsvpEffectStore();
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true })],
    );
    const firstRuntime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const first = twinService(firstRuntime, gateway, store);
    await first.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-g'));

    // Restart: new service instance over the same durable store.
    const secondRuntime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const second = twinService(secondRuntime, gateway, store);
    await second.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-g'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    const note = secondRuntime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"replayed":true');
    expect(note).toContain('"fresh_read":false');
  });

  it('(h) explicit attendance plus a venue question yields one write and one combined reply', async () => {
    // A2: RSVP is work within the customer turn. The verified write and the
    // information read compose a single model-authored reply; the completed
    // action is carried into the information outcome, never re-run.
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({
      action: 'attending',
      informationRequests: [{
        kind: 'faq',
        query: '¿A qué hora es la recepción?',
      }],
    })]);
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store, {
      execute: async () => ({
        results: [{
          requestId: 'faq-1',
          kind: 'faq',
          status: 'completed',
          evidence: [{ fileId: 'venue-1', filename: 'venue.md', score: 0.9, text: 'La recepción es a las 19:00.' }],
        }],
        summaries: [{
          requestId: 'faq-1',
          kind: 'faq',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'q',
          evidence: [],
          resultCount: 1,
          durationMs: 40,
        }],
      }),
    });

    const result = await service.handleTurn(twinInbound('Confirmo mi asistencia. ¿A qué hora es?', 'wamid-twin-h'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const note = runtime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"verified"');
    expect(runtime.composeRequests[0]?.informationResults).toEqual([
      expect.objectContaining({ kind: 'faq', status: 'completed' }),
    ]);
    expect(runtime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { rsvp_state: 'attending' },
    });
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');
  });

  it('(g) restart after write before receipt recovers by read with no second write', async () => {
    const store = new InMemoryRsvpEffectStore();
    store.failNextResultSave();
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true }), readDetail({ willAttend: true })],
    );
    const firstRuntime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const first = twinService(firstRuntime, gateway, store);
    await first.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-g2'));
    expect(gateway.writes).toHaveLength(1);
    const firstReceipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-g2');
    expect(firstReceipt?.status).toBe('intent');

    // Restart: the interrupted intent reconciles by authoritative read.
    const secondRuntime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const second = twinService(secondRuntime, gateway, store);
    await second.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-g2'));

    expect(gateway.writes).toHaveLength(1);
    const note = secondRuntime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"observed_state"');
    const receipt = await store.loadByMessage('whatsapp#user-rsvp-twin', 'wamid-twin-g2');
    expect(receipt?.status).toBe('complete');
    expect(receipt?.outcome?.successClaimAllowed).toBe(false);
  });

  it('(i) authentication decline preempts before any RSVP effect runs', async () => {
    // Auth control routes straight to the information flow: the declined
    // terminal reply carries no RSVP facts because no RSVP effect completed
    // on this turn — nothing is invented, and no write runs.
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({
      action: 'attending',
      informationRequests: [{
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado de mi pago?',
        orderId: null,
        authAction: 'decline_authentication',
      }],
    })]);
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    const result = await service.handleTurn(twinInbound('Confirmo. No quiero dar mi correo', 'wamid-twin-i'));

    expect(gateway.writes).toHaveLength(0);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.rsvpPhoneEvidence).toBeUndefined();
    expect(request?.rsvpWorkCompleted).toBeUndefined();
    expect(request?.errorMessage).toBeNull();
    expect(request?.authenticationOutcome).toMatchObject({
      status: 'declined',
      reason: 'authentication_declined',
    });
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');
  });

  it('(j) completed write survives a phone-scoped miss without escalation as typed facts', async () => {
    // The event question misses on the trusted-phone scope; the miss no
    // longer escalates, but the verified RSVP write already ran: the
    // normal reply carries both the completed-action typed evidence and
    // the miss, with no terminal auth outcome.
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({
      action: 'attending',
      informationRequests: [{
        kind: 'associated_event',
        query: '¿Dónde es la recepción?',
        eventHint: null,
      }],
    })]);
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    const result = await service.handleTurn(twinInbound('Confirmo. ¿Dónde es la recepción?', 'wamid-twin-j'));

    expect(gateway.writes).toHaveLength(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { rsvp_state: 'attending', invitation_record: 'available' },
    });
    expect(request?.rsvpWorkCompleted).toBe(true);
    const note = request?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"verified"');
    expect(request?.authenticationOutcome ?? null).toBeNull();
    expect(request?.handoffOutcome ?? null).toBeNull();
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');
  });

  it('(k) multi-person handoff plus an information question carries the typed handoff outcome', async () => {
    // No RSVP effect ran, so there is no invitation evidence; the handoff
    // outcome still travels as a typed fact into the single combined reply,
    // never as a string-only note.
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({
      action: null,
      party: {
        scope: 'self_and_others',
        mentioned_names: ['María', 'José'],
        companion_count: 'multiple',
        plus_one_response: 'unknown',
      },
      informationRequests: [{
        kind: 'faq',
        query: '¿A qué hora es la recepción?',
      }],
    })]);
    const gateway = new TwinGateway([], []);
    const service = twinService(runtime, gateway, store, {
      execute: async () => ({
        results: [{
          requestId: 'faq-1',
          kind: 'faq',
          status: 'completed',
          evidence: [{ fileId: 'venue-1', filename: 'venue.md', score: 0.9, text: 'La recepción es a las 19:00.' }],
        }],
        summaries: [{
          requestId: 'faq-1',
          kind: 'faq',
          status: 'completed',
          source: 'agent_api',
          outcomeCode: 'completed_with_results',
          retryable: null,
          queryHash: 'q',
          evidence: [],
          resultCount: 1,
          durationMs: 40,
        }],
      }),
    });

    const result = await service.handleTurn(twinInbound('Confirmamos María y José. ¿A qué hora es?', 'wamid-twin-k'));

    expect(gateway.writes).toHaveLength(0);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.rsvpPhoneEvidence).toBeNull();
    expect(request?.rsvpWorkCompleted).toBe(true);
    expect(request?.handoffOutcome).toBe('handoff_requested');
    const note = request?.errorMessage ?? '';
    expect(note).toContain('"outcome":"rsvp_multi_person_handoff"');
    expect(note).toContain('"attendance_registered":false');
    expect(request?.informationResults).toEqual([
      expect.objectContaining({ kind: 'faq', status: 'completed' }),
    ]);
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');
  });

  it('(l) completed write survives an unrelated purchase-source failure as typed facts', async () => {
    // The purchase source fails, but that failure does not erase the
    // independently verified RSVP effect or turn it into a success claim for
    // the unavailable purchase.
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({
      action: 'attending',
      informationRequests: [{
        kind: 'purchase',
        resource: 'orders',
        query: 'Quiero dejar una dedicatoria en mi compra',
        orderId: null,
        authAction: 'none',
      }],
    })]);
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store, {
      execute: async () => ({
        results: [{
          requestId: 'information-1',
          kind: 'purchase',
          status: 'failed',
          retryable: true,
          failureKind: 'request_failed',
          message: 'No pude leer el detalle de la compra.',
        }],
        summaries: [{
          requestId: 'information-1',
          kind: 'purchase',
          status: 'failed',
          source: 'agent_api',
          outcomeCode: 'failed_retryable',
          retryable: true,
          queryHash: 'q',
          evidence: [],
          resultCount: 0,
          durationMs: 40,
        }],
      }),
    });

    const result = await service.handleTurn(twinInbound('Confirmo. Quiero dejar una dedicatoria', 'wamid-twin-l'));

    expect(gateway.writes).toHaveLength(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { rsvp_state: 'attending', invitation_record: 'available' },
    });
    expect(request?.rsvpWorkCompleted).toBe(true);
    const note = request?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"verified"');
    expect(note).toContain('"requested_attendance_change_verified":true');
    expect(request?.informationResults).toEqual([
      expect.objectContaining({
        kind: 'purchase',
        status: 'failed',
        failureKind: 'request_failed',
      }),
    ]);
    expect(request?.customerContext?.actionOutcomes).toContainEqual(expect.objectContaining({
      operation: 'rsvp.response.write',
      receipt: 'confirmed',
    }));
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');
  });
});

class TwinRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(private readonly extractions: ExtractionResult[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    const extraction = this.extractions.shift();
    if (!extraction) {
      throw new Error('No twin extraction queued.');
    }
    return extraction;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return {
      text: 'TWIN_MODEL_SENTINEL',
      structuredMessage: { type: 'generic', paragraphs_es: ['TWIN_MODEL_SENTINEL'] },
    };
  }
}

class TwinGateway implements AgentConversationGateway {
  readonly writes: AgentGuestRsvpInput[] = [];
  reads = 0;

  constructor(
    private readonly writeScript: Array<AgentGuestRsvpResult | Error>,
    private readonly readScript: Array<AgentEventDetailResult | Error>,
  ) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
  }

  async getRecentMessages(): Promise<{
    status: 'success';
    messages: AgentConversationMessage[];
  }> {
    return { status: 'success', messages: [] };
  }

  async requestHumanTakeover(): Promise<AgentGatewayResult> {
    return { status: 'success', message: 'Requested.' };
  }

  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> {
    return { status: 'failed', error: 'Unused.', retryable: false };
  }

  async updatePhone(): Promise<{ status: 'success' }> {
    return { status: 'success' };
  }

  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> {
    return { status: 'not_found' };
  }

  async getEventDetail(): Promise<AgentEventDetailResult> {
    this.reads += 1;
    const next = this.readScript.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next ?? { status: 'not_found' };
  }

  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    this.writes.push(input);
    const next = this.writeScript.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (!next) {
      throw new Error('No twin write result queued.');
    }
    return next;
  }
}

function responded(args: {
  action?: 'attending' | 'declining' | null;
  willAttend?: boolean | null;
  guestId?: number;
  plusOne?: { saved: boolean; response: 'yes' | 'no' | null; reason: string | null } | null;
}): AgentGuestRsvpResult {
  return {
    status: 'responded',
    action: args.action ?? 'attending',
    willAttend: args.willAttend ?? true,
    guestId: args.guestId ?? 41,
    eventId: 205,
    eventName: 'Matrimonio de Ana y Luis',
    eventDate: '2026-09-12',
    plusOne: args.plusOne ?? null,
  };
}

function readDetail(args: { guestId?: number; willAttend?: boolean | null }): AgentEventDetailResult {
  return {
    status: 'success',
    event: {
      eventId: 205,
      name: 'Matrimonio de Ana y Luis',
      slug: 'matrimonio-ana-luis',
      url: null,
      datetime: '2026-09-12',
      type: null,
      typeDetail: null,
      stage: null,
      city: null,
      country: null,
      currency: null,
      withTime: false,
      timezone: null,
      celebrateds: [],
      moments: [],
      dresscode: null,
      commonAsked: [],
      contactInfo: [],
      attendance: {
        guestId: args.guestId ?? 41,
        name: 'Invitado',
        hasResponded: true,
        willAttend: args.willAttend ?? true,
        responseDate: '2026-08-13T15:00:00.000Z',
      },
      purchases: [],
    },
  };
}

function twinExtraction(args: {
  action: 'attending' | 'declining' | null;
  party?: {
    scope: 'self' | 'self_and_others';
    mentioned_names: string[];
    companion_count?: 'one' | 'multiple' | 'unknown';
    plus_one_response?: 'yes' | 'no' | 'unknown';
  } | null;
  informationRequests?: ExtractionResult['informationRequests'];
}): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: args.informationRequests ?? [],
    rsvpAction: args.action,
    rsvpDecisionSource: 'current_message',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: args.party ?? null,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null,
    vendorCategory: null,
    vendorCategories: [],
    activeNeedCategory: null,
    location: null,
    budgetSignal: null,
    guestRange: null,
    preferences: [],
    hardConstraints: [],
    assumptions: [],
    conversationSummary: 'La persona responde una invitación.',
    selectedProviderHints: [],
    selectedProviderReferences: [],
    closeAction: null,
    pauseRequested: false,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
  };
}

function twinService(
  runtime: AgentRuntime,
  gateway: AgentConversationGateway,
  effectStore: InMemoryRsvpEffectStore,
  informationOrchestrator?: { execute: () => Promise<{ results: unknown[]; summaries: unknown[] }> },
): AgentService {
  const invitations: UserEventLookupResult['events'] = [{
    relation: 'guest',
    guestId: 41,
    eventId: 205,
    slug: null,
    url: null,
    name: 'Matrimonio de Ana y Luis',
    place: null,
    type: null,
    datetime: '2026-09-12',
    stage: null,
    isVisible: null,
    isPublic: null,
    currency: null,
    country: null,
    guestStatus: { hasResponded: false, willAttend: null, hasCouple: null, responseDate: null },
    hostType: null,
    hostPermission: null,
    hostStatus: null,
    celebratedType: null,
    amountCollected: null,
    amountTransferred: null,
    transactionsCount: null,
    invitedGuestCount: null,
    confirmedGuestCount: null,
    orders: [],
  }];
  return new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: {
      async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        return {
          lookup: { email: null, phone: '973296571' },
          user: null,
          events: invitations,
          counts: {
            ownerEvents: 0,
            guestEvents: invitations.length,
            hostEvents: 0,
            celebratedEvents: 0,
            recentOrders: 0,
          },
        };
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    rsvpEffectStore: effectStore,
    ...(informationOrchestrator ? {
      informationOrchestrator: {
        ...informationOrchestrator,
        prepareCustomerContext: async (args: {
          identity: IdentityEvidence | null;
          currentContext: CurrentContextEvidence | null;
        }) => unavailableCustomerContext(args),
      } as never,
    } : {}),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
}

function twinInbound(text: string, messageId: string) {
  return {
    channel: 'whatsapp',
    externalUserId: 'user-rsvp-twin',
    text,
    messageId,
    receivedAt: '2026-08-13T15:00:00.000Z',
    contactPhone: '+51973296571',
  };
}

/**
 * Lane C: existing attendance versus this-turn effect. A confirmed-state turn
 * that performs no mutation must serialize current-state evidence with no
 * completed-work claim and no completed-effect receipt, while a fresh
 * verified write (or an attempted write the backend reports as already
 * responded) keeps its distinct receipt. No wording requirement: a natural
 * confirmed-attendance statement passes on the existing-state evidence.
 */
describe('RSVP existing-state versus this-turn-effect evidence', () => {
  function attendingTwinService(
    runtime: AgentRuntime,
    gateway: AgentConversationGateway,
    effectStore: InMemoryRsvpEffectStore,
  ): AgentService {
    const invitations: UserEventLookupResult['events'] = [{
      relation: 'guest',
      guestId: 41,
      eventId: 205,
      slug: null,
      url: null,
      name: 'Matrimonio de Ana y Luis',
      place: null,
      type: null,
      datetime: '2026-09-12',
      stage: null,
      isVisible: null,
      isPublic: null,
      currency: null,
      country: null,
      guestStatus: { hasResponded: true, willAttend: true, hasCouple: null, responseDate: '2026-08-13T15:00:00.000Z' },
      hostType: null,
      hostPermission: null,
      hostStatus: null,
      celebratedType: null,
      amountCollected: null,
      amountTransferred: null,
      transactionsCount: null,
      invitedGuestCount: null,
      confirmedGuestCount: null,
      orders: [],
    }];
    return new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: {
        async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
          return {
            lookup: { email: null, phone: '973296571' },
            user: null,
            events: invitations,
            counts: {
              ownerEvents: 0,
              guestEvents: invitations.length,
              hostEvents: 0,
              celebratedEvents: 0,
              recentOrders: 0,
            },
          };
        },
      } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      rsvpEffectStore: effectStore,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
  }

  function specRuntime(): OpenAiAgentRuntime {
    return new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {} as never,
    });
  }

  it('existing confirmed attendance without a write claims no completed work and no effect receipt', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const gateway = new TwinGateway([], []);
    const service = attendingTwinService(runtime, gateway, store);

    const result = await service.handleTurn(twinInbound('Gracias, confirmo asistencia', 'wamid-twin-existing'));

    expect(gateway.writes).toHaveLength(0);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { rsvp_state: 'attending', invitation_record: 'available' },
    });
    expect(request?.rsvpWorkCompleted).toBe(false);
    const note = request?.errorMessage ?? '';
    expect(note).toContain('"outcome":"current_state"');
    expect(note).toContain('"mutation_performed":false');
    expect(note).not.toContain('verification_status');
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');

    // The serialized model input keeps the existing state visible and
    // carries no completed-effect receipt for a turn that wrote nothing.
    if (!request) throw new Error('Missing compose request.');
    const spec = await specRuntime().buildReplyRequestSpec(request);
    expect(spec.input).toContain('rsvp_phone_evidence');
    expect(spec.input).toContain('attending');
    expect(spec.input).not.toContain('rsvp_completed_effect');
  });

  it('a fresh verified write keeps its applied-effect receipt as distinct this-turn evidence', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const gateway = new TwinGateway(
      [responded({ action: 'attending', willAttend: true })],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    const result = await service.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-fresh'));

    expect(gateway.writes).toHaveLength(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.rsvpWorkCompleted).toBe(true);
    const note = request?.errorMessage ?? '';
    expect(note).toContain('"verification_status":"verified"');
    expect(note).toContain('"effect_applied":true');
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');

    if (!request) throw new Error('Missing compose request.');
    const spec = await specRuntime().buildReplyRequestSpec(request);
    expect(spec.input).toContain('rsvp_completed_effect');
    expect(spec.input).toContain('"effect_applied": true');
    expect(spec.input).toContain('"gateway_status": "responded"');
  });

  it('an attempted write the backend reports as already responded stays unapplied existing state', async () => {
    const store = new InMemoryRsvpEffectStore();
    const runtime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const gateway = new TwinGateway(
      [{
        status: 'already_responded',
        currentAction: 'attending',
        requestedAction: 'attending',
        guestId: 41,
        eventId: 205,
        eventName: 'Matrimonio de Ana y Luis',
        eventDate: '2026-09-12',
      }],
      [readDetail({ willAttend: true })],
    );
    const service = twinService(runtime, gateway, store);

    const result = await service.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-twin-stale-write'));

    // The write was attempted, so the turn owns a receipt — but the receipt
    // proves no fresh application: existing state, not a new registration.
    expect(gateway.writes).toHaveLength(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.rsvpWorkCompleted).toBe(true);
    const note = request?.errorMessage ?? '';
    expect(note).toContain('"gateway_status":"already_responded"');
    expect(note).toContain('"effect_applied":false');
    expect(result.outbound.text).toBe('TWIN_MODEL_SENTINEL');

    if (!request) throw new Error('Missing compose request.');
    const spec = await specRuntime().buildReplyRequestSpec(request);
    expect(spec.input).toContain('rsvp_completed_effect');
    expect(spec.input).toContain('"effect_applied": false');
    expect(spec.input).toContain('"gateway_status": "already_responded"');
  });
});
