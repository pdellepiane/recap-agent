import { getConfig } from '../runtime/config';
import { HttpAgentConversationGateway } from '../runtime/agent-conversation-gateway';
import type { AgentGuestRsvpResult } from '../runtime/agent-conversation-gateway';
import {
  assertFixtureGatewayImplementsOperations,
  FixtureAgentConversationGateway,
  loadFixtureData,
  type FixtureCaseOperation,
  type FixtureLoadResult,
} from '../runtime/eval-fixture-gateway';

/**
 * Packet O1 — isolation before concurrency.
 *
 * One execution owns its setup context explicitly: setup returns a context
 * that teardown receives. The module-global isolation-context map is gone;
 * there is no cross-execution shared state in this module.
 *
 * Two backends:
 * - Fixture-backed setup initializes the same fixture world Lambda uses
 *   through a caller-supplied fixture gateway and never touches the real
 *   HTTP gateway. It performs zero writes: it verifies the world resolves,
 *   verifies the gateway implements every operation the case uses, and
 *   preserves the explicit (or freshly read) prior/target state for the
 *   teardown verification. Teardown re-reads the same guest/event evidence
 *   and writes nothing.
 * - Real-backend setup requires a known restorable prior state (explicit or
 *   a fresh same-guest/same-event backend read) and a verified setup write
 *   before a mutating test starts. Unavailable gateway, failed write,
 *   ambiguous identity, or inconclusive verification is a setup error, never
 *   a successful no-op. Teardown restores the prior and verifies the
 *   restoration with a fresh read; a failed cleanup is a teardown error so
 *   the runner can stop further external cases.
 *
 * A `pending` target never substitutes a declining write: pending performs
 * no setup write and no teardown write on either backend.
 */

export type RsvpIsolationTargetState = 'attending' | 'declining' | 'pending';

export type RsvpIsolationSetup = {
  guestId: number;
  eventName: string;
  phone: string;
  targetState: RsvpIsolationTargetState;
  priorState?: RsvpIsolationTargetState | null;
  fixtureScenario?: string | null;
};

export type RsvpIsolationTeardown = {
  guestId: number;
  eventName: string;
  phone: string;
  restore: boolean;
};

export type RsvpIsolationHooks = {
  setup?: RsvpIsolationSetup;
  teardown?: RsvpIsolationTeardown;
};

export type RsvpIsolationContext = {
  guestId: number;
  eventName: string;
  phone: string;
  priorState: RsvpIsolationTargetState | null;
  targetState: RsvpIsolationTargetState;
};

/**
 * Setup threw after a backend write may have happened. The runner forwards
 * the partial context to teardown for a best-effort restore instead of
 * abandoning a mutated backend.
 */
export class RsvpIsolationSetupError extends Error {
  readonly partialContext: RsvpIsolationContext | null;

  constructor(message: string, partialContext: RsvpIsolationContext | null = null) {
    super(message);
    this.name = 'RsvpIsolationSetupError';
    this.partialContext = partialContext;
  }
}

function parsePhone(phone: string): { extension: string; number: string } | null {
  const digits = phone.replace(/\D/gu, '');
  if (digits.length < 8) {
    return null;
  }
  if (phone.startsWith('+')) {
    const match = phone.match(/^\+(\d{1,3})(\d+)$/u);
    if (match) {
      return { extension: `+${match[1]}`, number: match[2] ?? '' };
    }
  }
  // Default to +51 for Peruvian numbers without explicit prefix
  if (digits.length === 11 && digits.startsWith('51')) {
    return { extension: '+51', number: digits.slice(2) };
  }
  if (digits.length === 9) {
    return { extension: '+51', number: digits };
  }
  return { extension: `+${digits.slice(0, 2)}`, number: digits.slice(2) };
}

function createGateway(): HttpAgentConversationGateway | null {
  const config = getConfig();
  const baseUrl = config.agentApi.baseUrl;
  const apiKey =
    process.env.SE_API_KEY ?? process.env.AGENT_API_KEY ?? process.env.CHANNEL_API_KEY ?? '';
  if (!baseUrl || baseUrl.length === 0) {
    return null;
  }
  if (!apiKey) {
    return null;
  }
  // Isolation writes are single-attempt by contract. Automatic transport
  // retries are disabled here; RSVP-specific read-back belongs to S11.
  return new HttpAgentConversationGateway({
    baseUrl,
    apiKey,
    timeoutMs: config.agentApi.timeoutMs,
    maxRetries: 0,
    messageLoggingEnabled: false,
  });
}

export type RsvpIsolationGateway = Pick<HttpAgentConversationGateway, 'guestRsvp'>;

/** Minimal backend-read surface for the isolation prior read. */
export type RsvpIsolationReadGateway = Pick<
  HttpAgentConversationGateway,
  'getGuestEventsByPhone' | 'getEventDetail'
>;

/** Fixture read/write surface for fixture-backed setup/teardown verification. */
export type FixtureRsvpSetupGateway = RsvpIsolationReadGateway & RsvpIsolationGateway;

function normalizeIsolationEventName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

/**
 * willAttend precedence: the boolean decides attending/declining whenever
 * present, even when hasResponded is false. hasResponded is provenance only;
 * only an undecided record without a response is pending.
 */
export function attendanceToIsolationState(attendance: {
  willAttend: boolean | null;
  hasResponded: boolean;
} | null | undefined): RsvpIsolationTargetState | null {
  if (!attendance) {
    return null;
  }
  if (attendance.willAttend === true) {
    return 'attending';
  }
  if (attendance.willAttend === false) {
    return 'declining';
  }
  if (attendance.hasResponded === false) {
    return 'pending';
  }
  return null;
}

/**
 * Fresh backend read of the guest's current attendance for the isolated
 * event. Matches the setup event name uniquely among the phone-scoped
 * summaries, then reads its detail and keeps the state only when the
 * attendance record is bound to the setup guest. Any lookup failure,
 * ambiguous name match, or guest mismatch stays null so teardown never
 * assumes a prior decline.
 */
async function readCurrentRsvpState(
  setup: RsvpIsolationSetup,
  gateway: RsvpIsolationReadGateway | null,
): Promise<RsvpIsolationTargetState | null> {
  if (!gateway?.getGuestEventsByPhone || !gateway?.getEventDetail) {
    return null;
  }
  try {
    const phoneParts = parsePhone(setup.phone);
    if (!phoneParts) {
      return null;
    }
    const summaries = await gateway.getGuestEventsByPhone({
      phone_extension: phoneParts.extension,
      phone_number: phoneParts.number,
    });
    if (summaries.status !== 'success') {
      return null;
    }
    const wanted = normalizeIsolationEventName(setup.eventName);
    const matches = summaries.events.filter(
      (event) => normalizeIsolationEventName(event.name) === wanted,
    );
    if (matches.length !== 1) {
      return null;
    }
    const match = matches[0];
    if (!match) {
      return null;
    }
    const detail = await gateway.getEventDetail({
      eventId: match.eventId,
      phone: {
        phone_extension: phoneParts.extension,
        phone_number: phoneParts.number,
      },
    });
    if (detail.status !== 'success') {
      return null;
    }
    const attendance = detail.event.attendance ?? null;
    if (!attendance || attendance.guestId !== setup.guestId) {
      return null;
    }
    return attendanceToIsolationState(attendance);
  } catch {
    return null;
  }
}

function targetWillAttend(target: RsvpIsolationTargetState): boolean | null {
  if (target === 'attending') return true;
  if (target === 'declining') return false;
  return null;
}

/**
 * Accepts a setup/restore write result. `responded` must confirm the
 * requested attendance; `already_responded` defers to the fresh read-back
 * proof that follows. Anything else (multiple/no pending, phone mismatch,
 * failure) is ambiguous or failed and never counts as a verified write.
 */
function writeResultMatchesTarget(
  result: AgentGuestRsvpResult,
  target: RsvpIsolationTargetState,
): 'matched' | 'verify_by_read' | 'rejected' {
  if (result.status === 'responded') {
    const expected = targetWillAttend(target);
    if (expected === null || result.willAttend !== expected) {
      return 'rejected';
    }
    return 'matched';
  }
  if (result.status === 'already_responded') {
    return 'verify_by_read';
  }
  return 'rejected';
}

function describeWriteResult(result: AgentGuestRsvpResult): string {
  if (result.status === 'failed') return `failed: ${result.error}`;
  return result.status;
}

async function writeIsolationState(args: {
  setup: Pick<RsvpIsolationSetup, 'guestId' | 'phone'>;
  target: RsvpIsolationTargetState;
  guestRsvp: RsvpIsolationGateway['guestRsvp'];
  phase: 'setup' | 'teardown';
}): Promise<void> {
  if (args.target === 'pending') {
    throw new Error(`RSVP isolation ${args.phase} must never write a pending state.`);
  }
  const phoneParts = parsePhone(args.setup.phone);
  if (!phoneParts) {
    throw new Error(`Invalid phone for RSVP isolation ${args.phase}: ${args.setup.phone}`);
  }
  const action: 'attending' | 'declining' = args.target === 'attending' ? 'attending' : 'declining';
  const result = await args.guestRsvp({
    phone_extension: phoneParts.extension,
    phone_number: phoneParts.number,
    action,
    guest_id: args.setup.guestId,
  });
  const verdict = writeResultMatchesTarget(result, args.target);
  if (verdict === 'rejected') {
    throw new Error(`RSVP isolation ${args.phase} write was not confirmed (${describeWriteResult(result)}).`);
  }
}

/**
 * Fixture-backed setup. The caller supplies the fixture gateway for the
 * case's scenario (the same world Lambda uses); this function never creates
 * the real HTTP gateway, so zero real HTTP writes can occur. It verifies the
 * gateway implements every operation the case uses, establishes the prior
 * state from the explicit value or a fresh fixture read, and records the
 * target without writing: fixture scopes are throwaway (TTL expiry) and any
 * local write would pollute the case's own effect receipts.
 */
export async function setupFixtureRsvpIsolation(args: {
  setup: RsvpIsolationSetup;
  gateway: FixtureRsvpSetupGateway;
  requiredOperations?: readonly FixtureCaseOperation[];
}): Promise<RsvpIsolationContext | null> {
  const setup = args.setup;
  if (!setup) {
    return null;
  }
  assertFixtureGatewayImplementsOperations(args.gateway, [
    'guestRsvp',
    'getGuestEventsByPhone',
    'getEventDetail',
    ...(args.requiredOperations ?? []),
  ]);
  const context: RsvpIsolationContext = {
    guestId: setup.guestId,
    eventName: setup.eventName,
    phone: setup.phone,
    priorState: null,
    targetState: setup.targetState,
  };
  const explicitPrior = setup.priorState ?? null;
  const observedPrior = await readCurrentRsvpState(setup, args.gateway);
  if (explicitPrior !== null && observedPrior !== null && explicitPrior !== observedPrior) {
    throw new RsvpIsolationSetupError(
      `RSVP fixture setup prior mismatch for guest ${setup.guestId}: ` +
      `declared ${explicitPrior}, fixture world reads ${observedPrior}`,
      context,
    );
  }
  context.priorState = explicitPrior ?? observedPrior;
  return context;
}

/**
 * Fixture-backed teardown. Verifies the fixture world still reads the
 * setup-observed prior state with fresh same-guest/same-event evidence and
 * writes nothing: no restore write, no duplicate effect, no hidden cleanup.
 */
export async function teardownFixtureRsvpIsolation(args: {
  setup: RsvpIsolationSetup;
  teardown: RsvpIsolationTeardown | undefined;
  context: RsvpIsolationContext | null;
  gateway: FixtureRsvpSetupGateway;
}): Promise<void> {
  if (!args.teardown || !args.teardown.restore) {
    return;
  }
  if (!args.context) {
    throw new Error('RSVP fixture teardown requires the setup context; refusing an unverified cleanup.');
  }
  const stored = args.context;
  if (stored.targetState === 'pending') {
    return;
  }
  const restored = await readCurrentRsvpState(
    { guestId: stored.guestId, eventName: stored.eventName, phone: stored.phone, targetState: stored.targetState },
    args.gateway,
  );
  if (restored !== stored.priorState) {
    throw new Error(
      `RSVP fixture teardown verification failed for guest ${stored.guestId}: ` +
      `expected prior ${stored.priorState ?? 'unknown'}, fresh read is ${restored ?? 'unknown'}`,
    );
  }
}

/**
 * Packet O5 consolidation: one gateway constructor for fixture-backed case
 * setup and teardown. Resolves the scenario to the same loaded fixture
 * world Lambda uses and scopes the gateway to the case execution identity
 * (run/case). Unknown or malformed scenarios are setup errors, and the real
 * HTTP gateway is never constructed on this path.
 */
export type FixtureCaseGatewayScope = {
  runId: string;
  caseId: string;
};

export async function loadFixtureCaseWorld(scenario: string): Promise<FixtureLoadResult> {
  const loadResult = await loadFixtureData(scenario);
  if (loadResult.status !== 'loaded') {
    throw new RsvpIsolationSetupError(
      `RSVP fixture setup cannot resolve scenario "${scenario}": ${loadResult.error}`,
    );
  }
  return loadResult;
}

export function buildFixtureCaseGateway(
  scenario: string,
  loadResult: FixtureLoadResult,
  scope: FixtureCaseGatewayScope,
): FixtureAgentConversationGateway {
  return new FixtureAgentConversationGateway(scenario, loadResult, {
    runId: scope.runId,
    caseId: scope.caseId,
  });
}

/**
 * Caller-supplied-gateway seam (fixture-style, no backend reads). Setup
 * writes the non-pending target through the provided gateway and keeps the
 * explicit prior (or null when the caller declares none); teardown restores
 * a decided prior and writes nothing otherwise. No module-global state.
 */
export async function setupRsvpIsolationWithGateway(
  hooks: RsvpIsolationHooks,
  gateway: RsvpIsolationGateway | null,
): Promise<RsvpIsolationContext | null> {
  const setup = hooks.setup;
  if (!setup) {
    return null;
  }
  const context: RsvpIsolationContext = {
    guestId: setup.guestId,
    eventName: setup.eventName,
    phone: setup.phone,
    priorState: setup.priorState ?? null,
    targetState: setup.targetState,
  };
  if (setup.targetState === 'pending' || !gateway) {
    return context;
  }
  const phoneParts = parsePhone(setup.phone);
  if (!phoneParts) {
    throw new Error(`Invalid phone for RSVP isolation: ${setup.phone}`);
  }
  const action: 'attending' | 'declining' = setup.targetState === 'attending' ? 'attending' : 'declining';
  const result = await gateway.guestRsvp({
    phone_extension: phoneParts.extension,
    phone_number: phoneParts.number,
    action,
    guest_id: setup.guestId,
  });
  if (writeResultMatchesTarget(result, setup.targetState) === 'rejected') {
    throw new RsvpIsolationSetupError(
      `RSVP isolation setup failed: ${describeWriteResult(result)}`,
      context,
    );
  }
  return context;
}

export async function teardownRsvpIsolationWithGateway(
  hooks: RsvpIsolationHooks,
  context: RsvpIsolationContext | null,
  gateway: RsvpIsolationGateway | null,
): Promise<void> {
  const teardown = hooks.teardown;
  if (!teardown || !teardown.restore) {
    return;
  }
  if (!context) {
    throw new Error('RSVP isolation teardown requires the setup context; refusing an unverified cleanup.');
  }
  // A pending target performs no setup write, so teardown must write
  // nothing back even when a prior read exists.
  if (context.targetState === 'pending') {
    return;
  }
  const restoreState = context.priorState;
  if (!restoreState || restoreState === 'pending') {
    return;
  }
  if (!gateway) {
    throw new Error('RSVP isolation teardown cannot restore without a gateway.');
  }
  await writeIsolationState(
    { setup: context, target: restoreState, guestRsvp: gateway.guestRsvp, phase: 'teardown' },
  );
}

/**
 * Real-backend setup. Requires a known restorable prior state (explicit or
 * a fresh same-guest/same-event backend read) and a verified setup write
 * before a mutating test starts. Unavailable gateway, failed write,
 * ambiguous identity, or inconclusive verification is a setup error, never
 * a successful no-op. A pending target is explicitly non-mutating and needs
 * no gateway.
 */
export async function setupRsvpIsolation(hooks: RsvpIsolationHooks): Promise<RsvpIsolationContext | null> {
  const setup = hooks.setup;
  if (!setup) {
    return null;
  }
  if (setup.targetState === 'pending') {
    // Pending declares no decision: no setup write on any backend, so no
    // gateway is required. The prior is best-effort evidence only; teardown
    // still writes nothing for a pending target.
    const gateway = createGateway();
    const priorState = setup.priorState ?? await readCurrentRsvpState(setup, gateway);
    return {
      guestId: setup.guestId,
      eventName: setup.eventName,
      phone: setup.phone,
      priorState,
      targetState: setup.targetState,
    };
  }

  const gateway = createGateway();
  if (!gateway) {
    throw new RsvpIsolationSetupError(
      `RSVP isolation setup has no backend gateway for guest ${setup.guestId}; refusing a no-op setup.`,
    );
  }
  if (!parsePhone(setup.phone)) {
    throw new RsvpIsolationSetupError(`Invalid phone for RSVP isolation: ${setup.phone}`);
  }
  const explicitPrior = setup.priorState ?? null;
  const observedPrior = await readCurrentRsvpState(setup, gateway);
  if (explicitPrior !== null && observedPrior !== null && explicitPrior !== observedPrior) {
    throw new RsvpIsolationSetupError(
      `RSVP isolation setup prior mismatch for guest ${setup.guestId}: ` +
      `declared ${explicitPrior}, backend reads ${observedPrior}`,
    );
  }
  const priorState = explicitPrior ?? observedPrior;
  const context: RsvpIsolationContext = {
    guestId: setup.guestId,
    eventName: setup.eventName,
    phone: setup.phone,
    priorState,
    targetState: setup.targetState,
  };
  if (priorState !== 'attending' && priorState !== 'declining') {
    throw new RsvpIsolationSetupError(
      `RSVP isolation setup has no known restorable prior for guest ${setup.guestId} ` +
      `(prior is ${priorState ?? 'unknown'}); refusing to mutate before a restorable state is known.`,
      context,
    );
  }

  try {
    await writeIsolationState(
      { setup, target: setup.targetState, guestRsvp: gateway.guestRsvp.bind(gateway), phase: 'setup' },
    );
  } catch (error) {
    throw new RsvpIsolationSetupError(
      error instanceof Error ? error.message : String(error),
      context,
    );
  }

  // Read-back verify: the setup mutation must be observable on a fresh read.
  // A decided state contradicting the target, or an inconclusive read, is a
  // setup error — never a silent pass.
  const confirmed = await readCurrentRsvpState(setup, gateway);
  if (confirmed !== setup.targetState) {
    throw new RsvpIsolationSetupError(
      `RSVP isolation setup read-back mismatch for guest ${setup.guestId}: ` +
      `wrote ${setup.targetState}, read back ${confirmed ?? 'unknown'}`,
      context,
    );
  }

  return context;
}

/**
 * Real-backend teardown. Restores the setup-observed prior state and
 * verifies the restoration with a fresh same-guest/same-event read. A
 * failed cleanup is a teardown error; the runner stops further external
 * cases on it. Never restores a pending target (no setup write happened).
 */
export async function teardownRsvpIsolation(
  hooks: RsvpIsolationHooks,
  context: RsvpIsolationContext | null,
): Promise<void> {
  const teardown = hooks.teardown;
  if (!teardown || !teardown.restore) {
    return;
  }
  if (!context) {
    throw new Error('RSVP isolation teardown requires the setup context; refusing an unverified cleanup.');
  }

  // A pending target performs no setup write, so teardown must write
  // nothing back even when a prior read exists.
  if (context.targetState === 'pending') {
    return;
  }
  const restoreState = context.priorState;
  if (restoreState !== 'attending' && restoreState !== 'declining') {
    throw new Error(
      `RSVP isolation teardown has no restorable prior for guest ${context.guestId}; refusing an unverified cleanup.`,
    );
  }

  const gateway = createGateway();
  if (!gateway) {
    throw new Error(
      `RSVP isolation teardown cannot restore guest ${context.guestId} without a backend gateway.`,
    );
  }

  await writeIsolationState(
    { setup: context, target: restoreState, guestRsvp: gateway.guestRsvp.bind(gateway), phase: 'teardown' },
  );

  const restored = await readCurrentRsvpState(
    { guestId: context.guestId, eventName: context.eventName, phone: context.phone, targetState: context.targetState },
    gateway,
  );
  if (restored !== restoreState) {
    throw new Error(
      `RSVP isolation teardown verification failed for guest ${context.guestId}: ` +
      `restored ${restoreState}, fresh read is ${restored ?? 'unknown'}`,
    );
  }
}
