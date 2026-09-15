import { createHash } from 'node:crypto';

import type {
  AgentConversationGateway,
  AgentEventDetailResult,
  AgentGuestRsvpResult,
} from './agent-conversation-gateway';

/**
 * Packet B: the single RSVP effect executor used by the live service.
 *
 * A mutation is one tool operation: bind a typed intent, perform at most one
 * write, run one fresh authorized read-back, and persist the
 * requested-versus-observed receipt before the reply is composed. A
 * successful HTTP response alone never authorizes success wording.
 *
 * Durability tradeoff (explicit): a DynamoDB receipt cannot make the external
 * HTTP write atomic. After an interrupted intent with no result the executor
 * reconciles by authoritative read WITHOUT repeating the write; when the
 * read cannot settle the operation the outcome is unconfirmed. This favors
 * avoiding duplicate effects over automatic recovery.
 */

export type RsvpEffectAction = 'attending' | 'declining';
export type RsvpPlusOneResponse = 'yes' | 'no';

export type RsvpEffectOperation = {
  readonly conversationKey: string;
  readonly messageId: string;
  readonly guestId: number;
  readonly eventId: number | null;
  readonly action: RsvpEffectAction | null;
  readonly plusOneResponse: RsvpPlusOneResponse | null;
  readonly phoneExtension: string;
  readonly phoneNumber: string;
};

export type RsvpEffectRequestedFields = {
  readonly guestId: number;
  readonly eventId: number | null;
  readonly action: RsvpEffectAction | null;
  readonly plusOneResponse: RsvpPlusOneResponse | null;
  readonly phoneExtension: string;
  readonly phoneNumber: string;
};

export type RsvpEffectObservedFields = {
  readonly guestId: number | null;
  readonly eventId: number | null;
  readonly attendance: RsvpEffectAction | null;
  readonly hasResponded: boolean | null;
  readonly responseDate: string | null;
  /** Fresh read only; a write echo is never recorded as observed state. */
  readonly source: 'fresh_read';
};

export type RsvpVerifiedStatus =
  | 'verified'
  | 'observed_state'
  | 'unconfirmed'
  | 'no_write';

export type RsvpEffectRecordStatus = 'intent' | 'complete';

export type RsvpVerifiedEffect = {
  readonly status: RsvpVerifiedStatus;
  readonly requested: RsvpEffectRequestedFields;
  readonly observed: RsvpEffectObservedFields | null;
  /** Fresh read matches the requested attendance for the same guest+event. */
  readonly attendanceConfirmed: boolean;
  /**
   * Write-response echo for the companion decision, recorded as echo only.
   * The existing backend read (AgentGuestAttendance) exposes
   * guestId/hasResponded/willAttend/responseDate and no companion fields,
   * so companion persistence is unverifiable and never claimed confirmed.
   */
  readonly plusOneEcho: {
    readonly saved: boolean;
    readonly response: 'yes' | 'no' | null;
    readonly reason: string | null;
  } | null;
  /**
   * Always false: the existing backend read (AgentGuestAttendance) exposes
   * guestId/hasResponded/willAttend/responseDate and no companion fields,
   * so companion persistence is unverifiable and never claimed.
   */
  readonly companionConfirmed: boolean;
  readonly companionVerification: 'unavailable';
  /** True only for a genuinely verified update; replay never re-verifies. */
  readonly successClaimAllowed: boolean;
  /** False for already_responded confirmations: no change was applied. */
  readonly effectApplied: boolean;
  readonly observedWithoutAttribution: boolean;
  readonly writeCount: number;
  readonly readCount: number;
  readonly persistedBeforeReply: boolean;
  readonly replayed: boolean;
  readonly freshRead: boolean;
  readonly dedupCoverage: 'native' | 'unavailable';
  readonly readStatus: 'matched' | 'mismatch' | 'unavailable' | 'not_attempted';
  readonly mismatch: {
    readonly kind: 'guest_id' | 'event_id' | 'attendance';
    readonly expected: string;
    readonly returned: string;
  } | null;
  readonly gatewayStatus: AgentGuestRsvpResult['status'] | null;
  readonly failureReason:
    | 'guest_mismatch'
    | 'event_mismatch'
    | 'attendance_mismatch'
    | 'read_unavailable'
    | 'write_failed'
    | 'write_unsupported'
    | 'lease_rejected'
    | 'intent_conflict'
    | 'receipt_invalid'
    | 'result_save_failed'
    | 'intent_save_failed'
    | 'no_mutation_requested'
    | null;
  /** confirmed | observed | unknown | none. Unknown never claims failure. */
  readonly persistence: 'confirmed' | 'observed' | 'unknown' | 'none';
  readonly operationHash: string;
  readonly messageId: string;
  readonly conversationKey: string;
};

export type RsvpEffectIntentInput = {
  readonly conversationKey: string;
  readonly messageId: string;
  readonly operationHash: string;
  readonly requested: RsvpEffectRequestedFields;
};

export type RsvpEffectRecord = {
  readonly conversationKey: string;
  readonly messageId: string;
  readonly operationHash: string;
  readonly requested: RsvpEffectRequestedFields;
  readonly status: RsvpEffectRecordStatus;
  readonly outcome: RsvpVerifiedEffect | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RsvpIntentSaveResult =
  | { readonly kind: 'created' }
  | { readonly kind: 'duplicate'; readonly existing: RsvpEffectRecord };

export class RsvpEffectConflictError extends Error {
  readonly code = 'rsvp_effect_conflict';

  constructor() {
    super('RSVP effect intent conflicts with a different persisted operation for the same message id.');
    this.name = 'RsvpEffectConflictError';
  }
}

export class RsvpEffectRecordInvalidError extends Error {
  readonly code = 'rsvp_effect_record_invalid';

  constructor() {
    super('RSVP effect receipt failed schema validation.');
    this.name = 'RsvpEffectRecordInvalidError';
  }
}

export interface RsvpEffectStore {
  loadByMessage(conversationKey: string, messageId: string): Promise<RsvpEffectRecord | null>;
  saveIntent(intent: RsvpEffectIntentInput, leaseContext?: RsvpEffectLeaseContext): Promise<RsvpIntentSaveResult>;
  saveResult(
    conversationKey: string,
    messageId: string,
    operationHash: string,
    outcome: RsvpVerifiedEffect,
    leaseContext?: RsvpEffectLeaseContext,
  ): Promise<void>;
}

/**
 * Lease identity for receipt writes. The owner identifies the caller-held
 * conversation turn lease; nowMs is computed fresh at each transaction
 * construction so the TURN_LOCK expiry check cannot run on a stale snapshot.
 */
export type RsvpEffectLeaseContext = {
  readonly ownerId: string;
  readonly nowMs: number;
};

/**
 * Deterministic test double. Production uses DynamoRsvpEffectStore on the
 * existing plans table; this class must never be installed as production
 * durability.
 */
export class InMemoryRsvpEffectStore implements RsvpEffectStore {
  private readonly records = new Map<string, RsvpEffectRecord>();
  private failNextResult = false;
  private failNextIntent = false;

  failNextResultSave(): void {
    this.failNextResult = true;
  }

  failNextIntentSave(): void {
    this.failNextIntent = true;
  }

  loadRecordSync(conversationKey: string, messageId: string): RsvpEffectRecord | null {
    return this.records.get(recordKey(conversationKey, messageId)) ?? null;
  }

  async loadByMessage(conversationKey: string, messageId: string): Promise<RsvpEffectRecord | null> {
    return this.loadRecordSync(conversationKey, messageId);
  }

  async saveIntent(intent: RsvpEffectIntentInput, _leaseContext?: RsvpEffectLeaseContext): Promise<RsvpIntentSaveResult> {
    void _leaseContext;
    if (this.failNextIntent) {
      this.failNextIntent = false;
      throw new Error('rsvp intent save failed');
    }
    const key = recordKey(intent.conversationKey, intent.messageId);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.operationHash !== intent.operationHash) {
        throw new RsvpEffectConflictError();
      }
      return { kind: 'duplicate', existing };
    }
    const now = new Date().toISOString();
    this.records.set(key, {
      conversationKey: intent.conversationKey,
      messageId: intent.messageId,
      operationHash: intent.operationHash,
      requested: intent.requested,
      status: 'intent',
      outcome: null,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: 'created' };
  }

  async saveResult(
    conversationKey: string,
    messageId: string,
    operationHash: string,
    outcome: RsvpVerifiedEffect,
    _leaseContext?: RsvpEffectLeaseContext,
  ): Promise<void> {
    void _leaseContext;
    if (this.failNextResult) {
      this.failNextResult = false;
      throw new Error('rsvp result save failed');
    }
    const key = recordKey(conversationKey, messageId);
    const existing = this.records.get(key);
    if (!existing) {
      throw new Error('rsvp result save without intent');
    }
    if (existing.operationHash !== operationHash) {
      throw new RsvpEffectConflictError();
    }
    this.records.set(key, {
      ...existing,
      status: 'complete',
      outcome,
      updatedAt: new Date().toISOString(),
    });
  }
}

function recordKey(conversationKey: string, messageId: string): string {
  return `${conversationKey}\n${messageId}`;
}

export function createRsvpOperationHash(operation: RsvpEffectOperation): string {
  const canonical = JSON.stringify({
    conversationKey: operation.conversationKey,
    messageId: operation.messageId,
    guestId: operation.guestId,
    eventId: operation.eventId,
    action: operation.action,
    plusOneResponse: operation.plusOneResponse,
    phoneExtension: operation.phoneExtension,
    phoneNumber: operation.phoneNumber,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

type GatewaySeam = Pick<AgentConversationGateway, 'guestRsvp' | 'getEventDetail'> & {
  readonly capabilityDescriptor?: {
    readonly 'rsvp.response.write'?: { readonly available?: boolean };
  };
};

export type ExecuteRsvpEffectArgs = {
  readonly operation: RsvpEffectOperation;
  readonly gateway: GatewaySeam;
  readonly store: RsvpEffectStore;
  /** 'native' only when the inbound id is channel-native AND the store is durable. */
  readonly dedupCoverage: 'native' | 'unavailable';
  /** Fresh lease validation; called at intent, write, and result boundaries. */
  readonly validateLease?: () => Promise<boolean>;
  /** Caller-held turn lease owner; reaches the store as lease identity on intent/result writes. */
  readonly leaseOwnerId?: string;
  readonly now?: () => number;
};

/**
 * Lease seam for store writes. validateLease is the pre-mutation freshness
 * check; leaseOwnerId/now build the lease identity fresh at each transaction
 * construction so the TURN_LOCK condition never runs on a stale snapshot.
 */
export type RsvpLeaseSeam = {
  readonly validateLease?: () => Promise<boolean>;
  readonly leaseOwnerId?: string;
  readonly now?: () => number;
};

function leaseContextFor(seam: RsvpLeaseSeam | undefined): RsvpEffectLeaseContext | undefined {
  const ownerId = seam?.leaseOwnerId;
  if (!ownerId) {
    return undefined;
  }
  return { ownerId, nowMs: seam?.now?.() ?? Date.now() };
}

function seamFor(args: ExecuteRsvpEffectArgs): RsvpLeaseSeam {
  return { validateLease: args.validateLease, leaseOwnerId: args.leaseOwnerId, now: args.now };
}

function requestedFields(operation: RsvpEffectOperation): RsvpEffectRequestedFields {
  return {
    guestId: operation.guestId,
    eventId: operation.eventId,
    action: operation.action,
    plusOneResponse: operation.plusOneResponse,
    phoneExtension: operation.phoneExtension,
    phoneNumber: operation.phoneNumber,
  };
}

function baseEffect(args: {
  status: RsvpVerifiedStatus;
  operation: RsvpEffectOperation;
  operationHash: string;
  dedupCoverage: 'native' | 'unavailable';
  writeCount: number;
  readCount: number;
  gatewayStatus: AgentGuestRsvpResult['status'] | null;
}): RsvpVerifiedEffect {
  return {
    status: args.status,
    requested: requestedFields(args.operation),
    observed: null,
    attendanceConfirmed: false,
    plusOneEcho: null,
    companionConfirmed: false,
    companionVerification: 'unavailable',
    successClaimAllowed: false,
    effectApplied: false,
    observedWithoutAttribution: false,
    writeCount: args.writeCount,
    readCount: args.readCount,
    persistedBeforeReply: false,
    replayed: false,
    freshRead: false,
    dedupCoverage: args.dedupCoverage,
    readStatus: 'not_attempted',
    mismatch: null,
    gatewayStatus: args.gatewayStatus,
    failureReason: null,
    persistence: 'none',
    operationHash: args.operationHash,
    messageId: args.operation.messageId,
    conversationKey: args.operation.conversationKey,
  };
}

function isTimeoutLike(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('unknown') ||
    normalized.includes('abort') ||
    normalized.includes('econn');
}

async function leaseValid(validateLease: (() => Promise<boolean>) | undefined): Promise<boolean> {
  if (!validateLease) {
    return true;
  }
  try {
    return await validateLease();
  } catch {
    return false;
  }
}

/**
 * Single verified RSVP effect: at most one write, one fresh read-back, and a
 * persisted requested-versus-observed receipt before reply. Duplicate inbound
 * delivery consults the durable receipt and recovers by read, never by
 * another mutation. Replay surfaces the historical receipt as replayed with
 * freshRead false, never as a fresh backend read.
 */
export async function executeRsvpEffectVerified(args: ExecuteRsvpEffectArgs): Promise<RsvpVerifiedEffect> {
  const { operation, gateway, store, dedupCoverage } = args;
  const operationHash = createRsvpOperationHash(operation);

  if (operation.action === null && operation.plusOneResponse === null) {
    return {
      ...baseEffect({ status: 'no_write', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
      failureReason: 'no_mutation_requested',
    };
  }

  let existing: RsvpEffectRecord | null = null;
  try {
    existing = await store.loadByMessage(operation.conversationKey, operation.messageId);
  } catch {
    return {
      ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
      failureReason: 'receipt_invalid',
      persistence: 'unknown',
    };
  }
  if (existing && existing.operationHash !== operationHash) {
    // Duplicate id with a different operation: conflict, never overwrite
    // and never replayed as if it were the same request.
    return {
      ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
      failureReason: 'intent_conflict',
      persistence: 'unknown',
    };
  }
  if (existing?.outcome) {
    // Replay: historical receipt, never a fresh backend read.
    return { ...existing.outcome, replayed: true, freshRead: false, dedupCoverage };
  }

  if (!(await leaseValid(args.validateLease))) {
    return {
      ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
      failureReason: 'lease_rejected',
      persistence: 'unknown',
    };
  }

  if (existing) {
    // Interrupted intent with no result: reconcile by read, never rewrite.
    return recoverByRead({ operation, operationHash, gateway, store, dedupCoverage, leaseSeam: seamFor(args), writeCount: 0, gatewayStatus: null });
  }

  try {
    const saved = await store.saveIntent({
      conversationKey: operation.conversationKey,
      messageId: operation.messageId,
      operationHash,
      requested: requestedFields(operation),
    }, leaseContextFor(seamFor(args)));
    if (saved.kind === 'duplicate') {
      if (saved.existing.outcome) {
        return { ...saved.existing.outcome, replayed: true, freshRead: false, dedupCoverage };
      }
      return recoverByRead({ operation, operationHash, gateway, store, dedupCoverage, leaseSeam: seamFor(args), writeCount: 0, gatewayStatus: null });
    }
  } catch (error: unknown) {
    if (error instanceof RsvpEffectConflictError) {
      return {
        ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
        failureReason: 'intent_conflict',
        persistence: 'unknown',
      };
    }
    return {
      ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
      failureReason: 'intent_save_failed',
      persistence: 'unknown',
    };
  }

  const writeAvailable = gateway.capabilityDescriptor?.['rsvp.response.write']?.available ?? true;
  if (!gateway.guestRsvp || !writeAvailable) {
    return persistOutcome(store, {
      ...baseEffect({ status: 'no_write', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
      failureReason: 'write_unsupported',
    }, seamFor(args));
  }

  if (!(await leaseValid(args.validateLease))) {
    return {
      ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 0, readCount: 0, gatewayStatus: null }),
      failureReason: 'lease_rejected',
      persistence: 'unknown',
    };
  }

  let result: AgentGuestRsvpResult;
  try {
    result = await gateway.guestRsvp({
      phone_extension: operation.phoneExtension,
      phone_number: operation.phoneNumber,
      ...(operation.action ? { action: operation.action } : {}),
      guest_id: operation.guestId,
      ...(operation.plusOneResponse ? { plus_one_response: operation.plusOneResponse } : {}),
    });
  } catch {
    // Unknown write outcome: no retry; recover by authoritative read.
    return recoverByRead({ operation, operationHash, gateway, store, dedupCoverage, leaseSeam: seamFor(args), writeCount: 1, gatewayStatus: null });
  }

  if (result.status === 'responded' || result.status === 'already_responded') {
    const plusOne = result.status === 'responded' ? result.plusOne ?? null : null;
    const plusOneEcho = plusOne
      ? { saved: plusOne.saved, response: plusOne.response ?? null, reason: plusOne.reason ?? null }
      : null;
    const identityMismatch = findIdentityMismatch(operation, result);
    if (identityMismatch) {
      // Untrusted echo: still read back, but never verify from this echo.
      const read = await readBack({ operation, gateway });
      const outcome: RsvpVerifiedEffect = {
        ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 1, readCount: read.readCount, gatewayStatus: result.status }),
        plusOneEcho,
        readStatus: read.readStatus,
        observed: read.observed,
        mismatch: identityMismatch,
        failureReason: identityMismatch.kind === 'guest_id' ? 'guest_mismatch' : 'event_mismatch',
        persistence: 'unknown',
        freshRead: read.readStatus !== 'unavailable' && read.readCount > 0,
      };
      return persistOutcome(store, outcome, seamFor(args));
    }
    if (result.status === 'responded' && operation.action !== null) {
      const expected = operation.action === 'attending';
      if (result.willAttend === null || result.willAttend !== expected) {
        const read = await readBack({ operation, gateway });
        return persistOutcome(store, {
          ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 1, readCount: read.readCount, gatewayStatus: result.status }),
          plusOneEcho,
          readStatus: read.readStatus,
          observed: read.observed,
          failureReason: 'attendance_mismatch',
          persistence: 'unknown',
          freshRead: read.readCount > 0 && read.readStatus !== 'unavailable',
        }, seamFor(args));
      }
    }
    // Accepted echo with bound identity: verify by fresh read.
    return verifyByRead({
      operation, operationHash, gateway, store, dedupCoverage,
      leaseSeam: seamFor(args), writeCount: 1, gatewayStatus: result.status,
      effectApplied: result.status === 'responded',
      plusOneEcho,
    });
  }

  if (result.status === 'multiple_pending') {
    return persistOutcome(store, {
      ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 1, readCount: 0, gatewayStatus: result.status }),
      failureReason: 'write_failed',
      persistence: 'none',
    }, seamFor(args));
  }

  if (result.status === 'failed' && (result.retryable || isTimeoutLike(result.error))) {
    return recoverByRead({ operation, operationHash, gateway, store, dedupCoverage, leaseSeam: seamFor(args), writeCount: 1, gatewayStatus: result.status });
  }

  return persistOutcome(store, {
    ...baseEffect({ status: 'unconfirmed', operation, operationHash, dedupCoverage, writeCount: 1, readCount: 0, gatewayStatus: result.status }),
    failureReason: 'write_failed',
    persistence: result.status === 'failed' ? 'unknown' : 'none',
  }, seamFor(args));
}

function findIdentityMismatch(
  operation: RsvpEffectOperation,
  result: Extract<AgentGuestRsvpResult, { status: 'responded' | 'already_responded' }>,
): RsvpVerifiedEffect['mismatch'] {
  if (result.guestId !== null && result.guestId !== operation.guestId) {
    return {
      kind: 'guest_id',
      expected: String(operation.guestId),
      returned: String(result.guestId),
    };
  }
  const returnedEventId = 'eventId' in result ? result.eventId : null;
  if (
    operation.eventId !== null && returnedEventId !== null &&
    returnedEventId !== undefined && returnedEventId !== operation.eventId
  ) {
    return {
      kind: 'event_id',
      expected: String(operation.eventId),
      returned: String(returnedEventId),
    };
  }
  return null;
}

type ReadBackResult = {
  readCount: number;
  readStatus: RsvpVerifiedEffect['readStatus'];
  observed: RsvpEffectObservedFields | null;
};

async function readBack(args: {
  operation: RsvpEffectOperation;
  gateway: GatewaySeam;
}): Promise<ReadBackResult> {
  const { operation, gateway } = args;
  if (!gateway.getEventDetail || operation.eventId === null) {
    return { readCount: 0, readStatus: 'unavailable', observed: null };
  }
  let detail: AgentEventDetailResult;
  try {
    detail = await gateway.getEventDetail({
      eventId: operation.eventId,
      trustedPhone: {
        phone_extension: operation.phoneExtension,
        phone_number: operation.phoneNumber,
      },
    });
  } catch {
    return { readCount: 1, readStatus: 'unavailable', observed: null };
  }
  if (detail.status !== 'success') {
    return { readCount: 1, readStatus: 'unavailable', observed: null };
  }
  if (detail.event.eventId !== operation.eventId) {
    return { readCount: 1, readStatus: 'mismatch', observed: null };
  }
  const attendance = detail.event.attendance;
  if (!attendance || attendance.guestId !== operation.guestId) {
    return { readCount: 1, readStatus: 'mismatch', observed: null };
  }
  if (attendance.willAttend === null || attendance.willAttend === undefined) {
    return { readCount: 1, readStatus: 'unavailable', observed: null };
  }
  return {
    readCount: 1,
    readStatus: 'matched',
    observed: {
      guestId: attendance.guestId,
      eventId: detail.event.eventId,
      attendance: attendance.willAttend ? 'attending' : 'declining',
      hasResponded: attendance.hasResponded,
      responseDate: attendance.responseDate,
      source: 'fresh_read',
    },
  };
}

async function verifyByRead(args: {
  operation: RsvpEffectOperation;
  operationHash: string;
  gateway: GatewaySeam;
  store: RsvpEffectStore;
  dedupCoverage: 'native' | 'unavailable';
  leaseSeam: RsvpLeaseSeam;
  writeCount: number;
  gatewayStatus: AgentGuestRsvpResult['status'];
  effectApplied: boolean;
  plusOneEcho: RsvpVerifiedEffect['plusOneEcho'];
}): Promise<RsvpVerifiedEffect> {
  const read = await readBack({ operation: args.operation, gateway: args.gateway });
  if (read.readStatus !== 'matched' || !read.observed) {
    return persistOutcome(args.store, {
      ...baseEffect({
        status: 'unconfirmed', operation: args.operation, operationHash: args.operationHash,
        dedupCoverage: args.dedupCoverage, writeCount: args.writeCount, readCount: read.readCount,
        gatewayStatus: args.gatewayStatus,
      }),
      plusOneEcho: args.plusOneEcho,
      readStatus: read.readStatus,
      observed: read.observed,
      mismatch: read.readStatus === 'mismatch'
        ? { kind: 'guest_id', expected: String(args.operation.guestId), returned: 'unmatched_read' }
        : null,
      failureReason: read.readStatus === 'mismatch' ? 'guest_mismatch' : 'read_unavailable',
      persistence: 'unknown',
      freshRead: read.readCount > 0,
    }, args.leaseSeam);
  }
  if (args.operation.action !== null && read.observed.attendance !== args.operation.action) {
    // Observed profile state is preserved honestly; never rewritten from requested.
    return persistOutcome(args.store, {
      ...baseEffect({
        status: 'unconfirmed', operation: args.operation, operationHash: args.operationHash,
        dedupCoverage: args.dedupCoverage, writeCount: args.writeCount, readCount: read.readCount,
        gatewayStatus: args.gatewayStatus,
      }),
      plusOneEcho: args.plusOneEcho,
      readStatus: 'matched',
      observed: read.observed,
      mismatch: {
        kind: 'attendance',
        expected: args.operation.action,
        returned: read.observed.attendance ?? 'null',
      },
      failureReason: 'attendance_mismatch',
      persistence: 'observed',
      freshRead: true,
    }, args.leaseSeam);
  }
  const attendanceConfirmed = args.operation.action !== null;
  return persistOutcome(args.store, {
    ...baseEffect({
      status: args.operation.action !== null ? 'verified' : 'observed_state',
      operation: args.operation, operationHash: args.operationHash,
      dedupCoverage: args.dedupCoverage, writeCount: args.writeCount, readCount: read.readCount,
      gatewayStatus: args.gatewayStatus,
    }),
    plusOneEcho: args.plusOneEcho,
    readStatus: 'matched',
    observed: read.observed,
    attendanceConfirmed,
    effectApplied: args.effectApplied,
    successClaimAllowed: attendanceConfirmed,
    persistence: args.operation.action !== null ? 'confirmed' : 'observed',
    freshRead: true,
  }, args.leaseSeam);
}

async function recoverByRead(args: {
  operation: RsvpEffectOperation;
  operationHash: string;
  gateway: GatewaySeam;
  store: RsvpEffectStore;
  dedupCoverage: 'native' | 'unavailable';
  leaseSeam: RsvpLeaseSeam;
  writeCount: number;
  gatewayStatus: AgentGuestRsvpResult['status'] | null;
}): Promise<RsvpVerifiedEffect> {
  const read = await readBack({ operation: args.operation, gateway: args.gateway });
  if (
    read.readStatus === 'matched' && read.observed &&
    args.operation.action !== null && read.observed.attendance === args.operation.action
  ) {
    // The read observes the requested state but the write outcome is unknown:
    // report observed state without attributing it to this write.
    return persistOutcome(args.store, {
      ...baseEffect({
        status: 'observed_state', operation: args.operation, operationHash: args.operationHash,
        dedupCoverage: args.dedupCoverage, writeCount: args.writeCount, readCount: read.readCount,
        gatewayStatus: args.gatewayStatus,
      }),
      readStatus: 'matched',
      observed: read.observed,
      observedWithoutAttribution: true,
      persistence: 'observed',
      freshRead: true,
    }, args.leaseSeam);
  }
  return persistOutcome(args.store, {
    ...baseEffect({
      status: 'unconfirmed', operation: args.operation, operationHash: args.operationHash,
      dedupCoverage: args.dedupCoverage, writeCount: args.writeCount, readCount: read.readCount,
      gatewayStatus: args.gatewayStatus,
    }),
    readStatus: read.readStatus,
    observed: read.observed,
    failureReason: 'read_unavailable',
    persistence: args.writeCount > 0 ? 'unknown' : 'none',
    freshRead: read.readCount > 0,
  }, args.leaseSeam);
}

async function persistOutcome(
  store: RsvpEffectStore,
  outcome: RsvpVerifiedEffect,
  leaseSeam?: RsvpLeaseSeam,
): Promise<RsvpVerifiedEffect> {
  if (!(await leaseValid(leaseSeam?.validateLease))) {
    return {
      ...outcome,
      successClaimAllowed: false,
      persistedBeforeReply: false,
      failureReason: outcome.failureReason ?? 'lease_rejected',
    };
  }
  try {
    await store.saveResult(
      outcome.conversationKey,
      outcome.messageId,
      outcome.operationHash,
      { ...outcome, persistedBeforeReply: true },
      leaseContextFor(leaseSeam),
    );
    return { ...outcome, persistedBeforeReply: true };
  } catch {
    return {
      ...outcome,
      status: outcome.status === 'verified' ? 'unconfirmed' : outcome.status,
      successClaimAllowed: false,
      attendanceConfirmed: false,
      failureReason: 'result_save_failed',
      persistence: 'unknown',
      persistedBeforeReply: false,
    };
  }
}
