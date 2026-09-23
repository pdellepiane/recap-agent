import type {
  RuntimeCapabilityAvailabilityReason,
  RuntimeCapabilityManifest,
  RuntimeOperationId,
} from './capability-manifest';

export const turnCapabilityStatuses = [
  'executable',
  'needs_input',
  'unsupported',
  'unavailable',
  'blocked',
  'already_completed',
] as const;

export type TurnCapabilityStatus = (typeof turnCapabilityStatuses)[number];

export type TurnResourceState = 'available' | 'missing' | 'unknown' | 'not_applicable';

export type TurnCapabilityInput = {
  readonly operation: RuntimeOperationId;
  readonly manifest: RuntimeCapabilityManifest;
  readonly gatewayAvailable?: boolean;
  readonly gatewayReason?: RuntimeCapabilityAvailabilityReason;
  readonly hasTrustedIdentity: boolean;
  readonly requiresIdentity: boolean;
  readonly resourceState: TurnResourceState;
  readonly isAuthorized: boolean;
  readonly remainingAttempts: number | null;
  readonly alreadyCompleted: boolean;
  readonly missingInput: readonly string[];
};

export type TurnCapabilityOutcome = {
  readonly status: TurnCapabilityStatus;
  readonly operation: RuntimeOperationId;
  readonly reason: RuntimeCapabilityAvailabilityReason;
  readonly requiredInput: readonly string[];
  readonly allowedNext: 'proceed' | 'clarify' | 'handoff_once' | 'none';
};

function staticDecision(
  available: boolean,
  reason: RuntimeCapabilityAvailabilityReason,
): TurnCapabilityStatus | null {
  if (reason === 'not_implemented' || reason === 'media_unavailable') return 'unsupported';
  if (!available) {
    if (reason === 'write_blocked') return 'blocked';
    return 'unavailable';
  }
  return null;
}

export function decideTurnCapability(input: TurnCapabilityInput): TurnCapabilityOutcome {
  const descriptor = input.manifest[input.operation];
  const staticStatus = staticDecision(descriptor.available, descriptor.reason);
  if (staticStatus === 'unsupported') {
    return {
      status: 'unsupported',
      operation: input.operation,
      reason: descriptor.reason,
      requiredInput: [],
      allowedNext: 'handoff_once',
    };
  }
  if (input.alreadyCompleted) {
    return {
      status: 'already_completed',
      operation: input.operation,
      reason: 'enabled',
      requiredInput: [],
      allowedNext: 'none',
    };
  }
  if (input.remainingAttempts !== null && input.remainingAttempts <= 0) {
    return {
      status: 'blocked',
      operation: input.operation,
      reason: 'attempts_exhausted',
      requiredInput: [],
      allowedNext: 'handoff_once',
    };
  }
  if (!input.isAuthorized) {
    return {
      status: 'blocked',
      operation: input.operation,
      reason: 'not_authorized',
      requiredInput: [],
      allowedNext: 'handoff_once',
    };
  }
  if (input.requiresIdentity && !input.hasTrustedIdentity) {
    return {
      status: 'blocked',
      operation: input.operation,
      reason: 'missing_identity',
      requiredInput: [],
      allowedNext: 'handoff_once',
    };
  }
  if (input.resourceState === 'unknown') {
    return {
      status: 'unavailable',
      operation: input.operation,
      reason: 'resource_unknown',
      requiredInput: [],
      allowedNext: 'handoff_once',
    };
  }
  if (input.resourceState === 'missing') {
    return {
      status: 'unavailable',
      operation: input.operation,
      reason: input.gatewayReason ?? 'gateway_unavailable',
      requiredInput: [],
      allowedNext: 'handoff_once',
    };
  }
  if (staticStatus !== null) {
    return {
      status: staticStatus,
      operation: input.operation,
      reason: descriptor.reason,
      requiredInput: [],
      allowedNext: staticStatus === 'blocked' ? 'handoff_once' : 'none',
    };
  }
  if (input.gatewayAvailable === false) {
    return {
      status: 'unavailable',
      operation: input.operation,
      reason: input.gatewayReason ?? 'gateway_unavailable',
      requiredInput: [],
      allowedNext: 'handoff_once',
    };
  }
  if (input.missingInput.length > 0) {
    return {
      status: 'needs_input',
      operation: input.operation,
      reason: 'enabled',
      requiredInput: input.missingInput,
      allowedNext: 'clarify',
    };
  }
  return {
    status: 'executable',
    operation: input.operation,
    reason: 'enabled',
    requiredInput: [],
    allowedNext: 'proceed',
  };
}

export type TurnGatewayEffectResult =
  | { readonly status: 'success' }
  | { readonly status: 'failed'; readonly retryable: boolean }
  | { readonly status: 'unknown' }
  | { readonly status: 'blocked' }
  | { readonly status: 'not_found' };

export function recomputeTurnCapabilityAfterResult(args: {
  readonly preflight: TurnCapabilityOutcome;
  readonly gatewayResult: TurnGatewayEffectResult;
}): TurnCapabilityOutcome {
  if (args.preflight.status !== 'executable') return args.preflight;
  switch (args.gatewayResult.status) {
    case 'success':
      return args.preflight;
    case 'not_found':
    case 'unknown':
      return {
        status: 'unavailable',
        operation: args.preflight.operation,
        reason: 'gateway_unavailable',
        requiredInput: [],
        allowedNext: 'handoff_once',
      };
    case 'blocked':
      return {
        status: 'blocked',
        operation: args.preflight.operation,
        reason: 'not_authorized',
        requiredInput: [],
        allowedNext: 'handoff_once',
      };
    case 'failed':
      return {
        status: 'unavailable',
        operation: args.preflight.operation,
        reason: 'gateway_unavailable',
        requiredInput: [],
        allowedNext: 'handoff_once',
      };
  }
}

export function turnCapabilityChanged(
  previous: RuntimeCapabilityManifest,
  next: RuntimeCapabilityManifest,
  operation: RuntimeOperationId,
): boolean {
  const before = previous[operation];
  const after = next[operation];
  return before.available !== after.available || before.reason !== after.reason;
}

const domainOperationPrefixes: Record<string, readonly string[]> = {
  purchase: ['purchase.'],
  rsvp: ['rsvp.'],
  provider: ['provider.'],
  auth: ['auth.'],
  event: ['event.'],
  human: ['human.'],
  document: ['confirmation_document.', 'payment_proof.', 'media.'],
  refund: ['refund_or_withdrawal.', 'purchase.modify'],
};

/**
 * Single operation-to-domain mapping shared by extraction projection and
 * the reply module compiler. One prefix table owns the families so callers
 * never grow a second set of string-prefix checks.
 */
export function operationDomain(operation: string): string | null {
  for (const [domain, prefixes] of Object.entries(domainOperationPrefixes)) {
    if (prefixes.some((prefix) => operation.startsWith(prefix))) return domain;
  }
  return null;
}

export function projectExtractionOperations(args: {
  readonly requestedDomain: string | null;
  readonly candidateOperations: readonly RuntimeOperationId[];
}): readonly RuntimeOperationId[] {
  if (args.requestedDomain === null) return [];
  const prefixes = domainOperationPrefixes[args.requestedDomain] ?? [];
  const relevant = args.candidateOperations.filter((operation) =>
    prefixes.some((prefix) => operation.startsWith(prefix)),
  );
  return relevant.slice(0, 3);
}

export function projectReplyEvidence(args: {
  readonly outcome: TurnCapabilityOutcome;
  readonly verifiedFacts: readonly string[];
  readonly allowedNextSteps: readonly string[];
}): {
  readonly outcome: TurnCapabilityOutcome;
  readonly facts: readonly string[];
  readonly nextSteps: readonly string[];
} {
  return {
    outcome: args.outcome,
    facts: [...args.verifiedFacts],
    nextSteps: [...args.allowedNextSteps],
  };
}

export function buildBoundedCapabilityList(args: {
  readonly manifest: RuntimeCapabilityManifest;
  readonly hasTrustedIdentity: boolean;
}): readonly string[] {
  const lines: string[] = [];
  const supported = args.manifest.operations.filter((descriptor) => descriptor.available);
  const readable = supported.filter((descriptor) => descriptor.id.endsWith('.read') || descriptor.id === 'provider.plan' || descriptor.id === 'provider.search' || descriptor.id === 'faq.read');
  for (const descriptor of readable.slice(0, 6)) {
    const executableNow = args.hasTrustedIdentity || descriptor.id === 'faq.read';
    lines.push(`${descriptor.id}:${executableNow ? 'executable_now' : 'supported_needs_identity'}`);
  }
  return lines;
}

export function measureUtf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
