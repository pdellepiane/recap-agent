import { getConfig } from '../runtime/config';
import { HttpAgentConversationGateway } from '../runtime/agent-conversation-gateway';

export type RsvpIsolationTargetState = 'attending' | 'declining' | 'pending';

export type RsvpIsolationSetup = {
  guestId: number;
  eventName: string;
  phone: string;
  targetState: RsvpIsolationTargetState;
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

const isolationContexts = new Map<string, RsvpIsolationContext>();

function contextKey(guestId: number, eventName: string, phone: string): string {
  return `${guestId}::${eventName}::${phone}`;
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
  const apiKey = process.env.AGENT_API_KEY ?? process.env.CHANNEL_API_KEY ?? '';
  if (!baseUrl || baseUrl.length === 0) {
    return null;
  }
  if (!apiKey) {
    return null;
  }
  return new HttpAgentConversationGateway({
    baseUrl,
    apiKey,
    timeoutMs: config.agentApi.timeoutMs,
    maxRetries: config.agentApi.maxRetries,
    messageLoggingEnabled: false,
  });
}

async function queryCurrentRsvpState(setup: RsvpIsolationSetup): Promise<RsvpIsolationTargetState | null> {
  // Best-effort: try to infer prior by reading guest events, but do not fail isolation if unreadable.
  // For now, return null to indicate unknown prior; teardown will restore to a safe default (declining)
  // when prior is unknown and restore is requested. This keeps offline tests deterministic.
  void setup;
  return null;
}

export async function setupRsvpIsolation(hooks: RsvpIsolationHooks): Promise<RsvpIsolationContext | null> {
  const setup = hooks.setup;
  if (!setup) {
    return null;
  }
  const priorState = await queryCurrentRsvpState(setup);
  const key = contextKey(setup.guestId, setup.eventName, setup.phone);
  const context: RsvpIsolationContext = {
    guestId: setup.guestId,
    eventName: setup.eventName,
    phone: setup.phone,
    priorState,
    targetState: setup.targetState,
  };
  isolationContexts.set(key, context);

  if (setup.targetState === 'pending') {
    // Pending means no explicit decision; we set to declining then clear via backend if possible,
    // but for isolation we treat pending as declining to keep the “no explicit decision” semantic
    // while still having a deterministic backend record.
    // If backend supports clearing, the gateway call below will be skipped for pending.
    return context;
  }

  const gateway = createGateway();
  if (!gateway) {
    // In offline or misconfigured environments, treat setup as no-op but keep context for teardown ordering.
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

  if (result.status === 'failed' && result.retryable === false) {
    // Non-retryable failure should surface as setup error so the case is marked errored.
    throw new Error(`RSVP isolation setup failed: ${result.error}`);
  }

  return context;
}

export async function teardownRsvpIsolation(
  hooks: RsvpIsolationHooks,
  context: RsvpIsolationContext | null,
): Promise<void> {
  const teardown = hooks.teardown;
  if (!teardown || !teardown.restore) {
    return;
  }
  const key = context
    ? contextKey(context.guestId, context.eventName, context.phone)
    : contextKey(teardown.guestId, teardown.eventName, teardown.phone);
  const stored = context ?? isolationContexts.get(key) ?? null;
  if (!stored) {
    return;
  }

  const restoreState = stored.priorState ?? 'declining';
  if (restoreState === 'pending') {
    isolationContexts.delete(key);
    return;
  }

  const gateway = createGateway();
  if (!gateway) {
    isolationContexts.delete(key);
    return;
  }

  const phoneParts = parsePhone(stored.phone);
  if (!phoneParts) {
    isolationContexts.delete(key);
    throw new Error(`Invalid phone for RSVP teardown: ${stored.phone}`);
  }

  const action: 'attending' | 'declining' = restoreState === 'attending' ? 'attending' : 'declining';
  await gateway.guestRsvp({
    phone_extension: phoneParts.extension,
    phone_number: phoneParts.number,
    action,
    guest_id: stored.guestId,
  });
  isolationContexts.delete(key);
}

export function clearRsvpIsolationContextsForTesting(): void {
  isolationContexts.clear();
}

export function getRsvpIsolationContextForTesting(
  guestId: number,
  eventName: string,
  phone: string,
): RsvpIsolationContext | undefined {
  return isolationContexts.get(contextKey(guestId, eventName, phone));
}
