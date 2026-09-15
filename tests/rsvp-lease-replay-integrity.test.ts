import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

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
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { DynamoRsvpEffectStore } from '../src/storage/dynamo-rsvp-effect-store';
import {
  InMemoryRsvpEffectStore,
  executeRsvpEffectVerified,
  type RsvpEffectIntentInput,
  type RsvpEffectLeaseContext,
  type RsvpEffectOperation,
  type RsvpEffectRecord,
  type RsvpEffectStore,
  type RsvpIntentSaveResult,
  type RsvpVerifiedEffect,
} from '../src/runtime/rsvp-effect-executor';

const OPERATION: RsvpEffectOperation = {
  conversationKey: 'whatsapp#user-lease',
  messageId: 'wamid-lease-1',
  guestId: 41,
  eventId: 205,
  action: 'attending',
  plusOneResponse: null,
  phoneExtension: '+51',
  phoneNumber: '973296571',
};

/** Spy store proving the executor-to-store path carries lease identity. */
class LeaseSpyStore implements RsvpEffectStore {
  intentLease: RsvpEffectLeaseContext | undefined | 'unset' = 'unset';
  resultLease: RsvpEffectLeaseContext | undefined | 'unset' = 'unset';
  private readonly inner = new InMemoryRsvpEffectStore();

  async loadByMessage(conversationKey: string, messageId: string): Promise<RsvpEffectRecord | null> {
    return this.inner.loadByMessage(conversationKey, messageId);
  }

  async saveIntent(
    intent: RsvpEffectIntentInput,
    leaseContext?: RsvpEffectLeaseContext,
  ): Promise<RsvpIntentSaveResult> {
    this.intentLease = leaseContext;
    return this.inner.saveIntent(intent);
  }

  async saveResult(
    conversationKey: string,
    messageId: string,
    operationHash: string,
    outcome: RsvpVerifiedEffect,
    leaseContext?: RsvpEffectLeaseContext,
  ): Promise<void> {
    this.resultLease = leaseContext;
    return this.inner.saveResult(conversationKey, messageId, operationHash, outcome);
  }
}

/** Minimal fake honoring conditional creates, hash guards and TURN_LOCK transactions. */
class FakeDocumentClient {
  readonly items = new Map<string, Record<string, unknown>>();
  readonly commands: string[] = [];

  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const name = command.constructor.name;
    this.commands.push(name);
    if (name === 'GetCommand') {
      const key = command.input.Key as { pk: string; sk: string };
      return { Item: this.items.get(`${key.pk}\n${key.sk}`) };
    }
    if (name === 'PutCommand') {
      const item = command.input.Item as Record<string, unknown>;
      const key = `${item.pk as string}\n${item.sk as string}`;
      const condition = command.input.ConditionExpression as string | undefined;
      if (condition?.includes('attribute_not_exists') && this.items.has(key)) {
        throw { name: 'ConditionalCheckFailedException' };
      }
      if (condition?.includes('operationHash')) {
        const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
        if (this.items.get(key)?.['operationHash'] !== values[':operation_hash']) {
          throw { name: 'ConditionalCheckFailedException' };
        }
      }
      this.items.set(key, item);
      return {};
    }
    if (name === 'TransactWriteCommand') {
      const transactItems = command.input.TransactItems as Array<Record<string, Record<string, unknown>>>;
      for (const entry of transactItems) {
        if (entry.ConditionCheck) {
          const check = entry.ConditionCheck;
          const key = check.Key as { pk: string; sk: string };
          const values = check.ExpressionAttributeValues as Record<string, unknown>;
          const stored = this.items.get(`${key.pk}\n${key.sk}`) as
            | { owner_id?: unknown; lease_until_ms?: unknown }
            | undefined;
          if (
            stored?.owner_id !== values[':owner_id'] ||
            typeof stored?.lease_until_ms !== 'number' ||
            (stored.lease_until_ms as number) <= (values[':now_ms'] as number)
          ) {
            throw { name: 'TransactionCanceledException' };
          }
        }
      }
      for (const entry of transactItems) {
        if (entry.Put) {
          const put = entry.Put;
          const item = put.Item as Record<string, unknown>;
          const key = `${item.pk as string}\n${item.sk as string}`;
          const condition = put.ConditionExpression as string | undefined;
          if (condition?.includes('attribute_not_exists') && this.items.has(key)) {
            throw { name: 'TransactionCanceledException' };
          }
          if (condition?.includes('operationHash')) {
            const values = put.ExpressionAttributeValues as Record<string, unknown>;
            if (this.items.get(key)?.['operationHash'] !== values[':operation_hash']) {
              throw { name: 'TransactionCanceledException' };
            }
          }
          this.items.set(key, item);
        }
      }
      return {};
    }
    throw new Error(`unsupported command ${name}`);
  }
}

function leaseGateway(): Pick<AgentConversationGateway, 'guestRsvp' | 'getEventDetail'> {
  return {
    async guestRsvp(): Promise<AgentGuestRsvpResult> {
      return {
        status: 'responded',
        action: 'attending',
        willAttend: true,
        guestId: 41,
        eventId: 205,
        eventName: 'Matrimonio de Ana y Luis',
        eventDate: '2026-09-12',
        plusOne: null,
      };
    },
    async getEventDetail(): Promise<AgentEventDetailResult> {
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
            guestId: 41,
            name: 'Invitado',
            hasResponded: true,
            willAttend: true,
            responseDate: '2026-09-14T00:00:00.000Z',
          },
          purchases: [],
        },
      };
    },
  };
}

describe('RSVP lease and replay integrity', () => {
  it('executor-to-store path carries lease identity with fresh timestamps on intent and result', async () => {
    const spy = new LeaseSpyStore();
    const ticks: number[] = [];
    let nowMs = 1_000;
    const verification = await executeRsvpEffectVerified({
      operation: OPERATION,
      gateway: leaseGateway(),
      store: spy,
      dedupCoverage: 'native',
      validateLease: async () => true,
      leaseOwnerId: 'owner-1',
      now: () => {
        ticks.push(nowMs);
        const current = nowMs;
        nowMs += 50;
        return current;
      },
    });

    expect(verification.status).toBe('verified');
    expect(spy.intentLease).toMatchObject({ ownerId: 'owner-1' });
    expect(spy.resultLease).toMatchObject({ ownerId: 'owner-1' });
    const intentNow = (spy.intentLease as RsvpEffectLeaseContext).nowMs;
    const resultNow = (spy.resultLease as RsvpEffectLeaseContext).nowMs;
    expect(resultNow).toBeGreaterThan(intentNow);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  it('without a lease the executor still persists through plain conditional writes', async () => {
    const spy = new LeaseSpyStore();
    const verification = await executeRsvpEffectVerified({
      operation: OPERATION,
      gateway: leaseGateway(),
      store: spy,
      dedupCoverage: 'unavailable',
    });

    expect(verification.status).toBe('verified');
    expect(spy.intentLease).toBeUndefined();
    expect(spy.resultLease).toBeUndefined();
  });

  it('dynamo store conditions intent and result writes on the live TURN_LOCK', async () => {
    const fake = new FakeDocumentClient();
    const store = new DynamoRsvpEffectStore('plans-table', {
      documentClient: fake as unknown as DynamoDBDocumentClient,
    });
    fake.items.set(`${OPERATION.conversationKey}\nTURN_LOCK`, {
      owner_id: 'owner-1',
      lease_until_ms: 5_000,
    });
    const intent: RsvpEffectIntentInput = {
      conversationKey: OPERATION.conversationKey,
      messageId: OPERATION.messageId,
      operationHash: 'hash-lease-1',
      requested: {
        guestId: 41,
        eventId: 205,
        action: 'attending',
        plusOneResponse: null,
        phoneExtension: '+51',
        phoneNumber: '973296571',
      },
    };

    const saved = await store.saveIntent(intent, { ownerId: 'owner-1', nowMs: 1_000 });
    expect(saved.kind).toBe('created');
    expect(fake.commands).toContain('TransactWriteCommand');
    const stored = await store.loadByMessage(OPERATION.conversationKey, OPERATION.messageId);
    expect(stored?.status).toBe('intent');

    await expect(
      store.saveIntent(intent, { ownerId: 'intruder', nowMs: 1_000 }),
    ).rejects.toMatchObject({ name: 'TransactionCanceledException' });
  });

  it('restart after a host change performs no second write and never overwrites fresh state', async () => {
    const store = new InMemoryRsvpEffectStore();
    const gateway = new ReplayGateway(
      [{ status: 'responded', action: 'attending', willAttend: true, guestId: 41 }],
      [{ guestId: 41, willAttend: true }],
    );
    const providerEvents: UserEventLookupResult['events'] = [replayInvitation(null)];
    const firstRuntime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const first = twinService(firstRuntime, gateway, store, providerEvents);
    await first.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-replay-1'));
    expect(gateway.writes).toHaveLength(1);
    expect(firstRuntime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      event: { rsvp_state: 'attending' },
    });

    // Backend changes after the confirmed result: the host declines the guest.
    providerEvents[0] = replayInvitation(false);
    gateway.readScript.length = 0;
    const secondRuntime = new TwinRuntime([twinExtraction({ action: 'attending' })]);
    const second = twinService(secondRuntime, gateway, store, providerEvents);
    const result = await second.handleTurn(twinInbound('Confirmo mi asistencia', 'wamid-replay-1'));

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.reads).toBe(1);
    expect(secondRuntime.composeRequests[0]?.rsvpPhoneEvidence).toMatchObject({
      state: 'resolved_single',
      event: { rsvp_state: 'declining' },
    });
    const note = secondRuntime.composeRequests[0]?.errorMessage ?? '';
    expect(note).toContain('"replayed":true');
    expect(note).toContain('"fresh_read":false');
    expect(result.trace.tools_called).not.toContain('guest_rsvp');
    expect(result.trace.tools_called).not.toContain('get_guest_event_detail');
    const receipt = await store.loadByMessage('whatsapp#user-replay', 'wamid-replay-1');
    expect(receipt?.outcome?.observed).toMatchObject({ attendance: 'attending' });
  });
});

function replayInvitation(willAttend: boolean | null): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest',
    guestId: 41,
    eventId: 205,
    slug: 'matrimonio-ana-luis',
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
    guestStatus: { hasResponded: false, willAttend, hasCouple: null, responseDate: null },
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
  };
}

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

class ReplayGateway implements AgentConversationGateway {
  readonly writes: AgentGuestRsvpInput[] = [];
  reads = 0;

  constructor(
    private readonly writeScript: Array<{ status: 'responded'; action: 'attending'; willAttend: boolean; guestId: number } | Error>,
    readonly readScript: Array<{ guestId: number; willAttend: boolean } | Error>,
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
    if (!next) {
      throw new Error('Unexpected verification read on replay.');
    }
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
          guestId: next.guestId,
          name: 'Invitado',
          hasResponded: true,
          willAttend: next.willAttend,
          responseDate: '2026-09-14T00:00:00.000Z',
        },
        purchases: [],
      },
    };
  }

  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    this.writes.push(input);
    const next = this.writeScript.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (!next) {
      throw new Error('Unexpected second write on replay.');
    }
    return {
      status: 'responded',
      action: next.action,
      willAttend: next.willAttend,
      guestId: next.guestId,
      eventId: 205,
      eventName: 'Matrimonio de Ana y Luis',
      eventDate: '2026-09-12',
      plusOne: null,
    };
  }
}

function twinExtraction(args: { action: 'attending' | 'declining' | null }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action,
    rsvpDecisionSource: 'current_message',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
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
    conversationSummary: 'La persona responde una invitacion.',
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
  invitations: UserEventLookupResult['events'],
): AgentService {
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

function twinInbound(text: string, messageId: string) {
  return {
    channel: 'whatsapp',
    externalUserId: 'user-replay',
    text,
    messageId,
    receivedAt: '2026-09-14T00:00:00.000Z',
    contactPhone: '+51973296571',
  };
}
