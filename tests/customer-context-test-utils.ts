import {
  assembleCustomerContext,
  type CurrentContextEvidence,
  type CustomerExecution,
  type CustomerContextSnapshot,
  type IdentityEvidence,
} from '../src/runtime/customer-context';
import type { InformationExecution } from '../src/runtime/information-orchestrator';

/** Explicitly unavailable profile for focused AgentService fakes without profile gateways. */
export function unavailableCustomerContext(args: {
  readonly identity: IdentityEvidence | null;
  readonly currentContext: CurrentContextEvidence | null;
  readonly nowIso?: string;
}): CustomerContextSnapshot {
  const base = assembleCustomerContext({
    execution: null,
    identity: args.identity,
    currentContext: args.currentContext,
    nowIso: args.nowIso ?? new Date().toISOString(),
  });
  return {
    ...base,
    identityAccess: args.identity
      ? base.identityAccess
      : { ...base.identityAccess, status: 'unavailable', source: 'authorization' },
    purchasesCarts: {
      ...base.purchasesCarts,
      status: 'unavailable',
      source: args.identity ? 'test_profile_gateway_not_configured' : 'authorization',
    },
    invitationsEvents: {
      ...base.invitationsEvents,
      status: 'unavailable',
      source: args.identity ? 'test_profile_gateway_not_configured' : 'authorization',
    },
    readMetrics: { totalReads: 0, peakConcurrency: 0, readsByOperation: {} },
  };
}

/** A fixture-backed gateway double that prepares roots before extraction. */
export function fixtureCustomerContextOrchestrator(execution: CustomerExecution): {
  prepareCustomerContext: (args: {
    readonly authentication: unknown;
    readonly trustedPhone: unknown;
    readonly identity: IdentityEvidence | null;
    readonly currentContext: CurrentContextEvidence | null;
    readonly deadlineMs: number | null;
  }) => Promise<CustomerContextSnapshot>;
  execute: () => Promise<InformationExecution>;
} {
  let snapshot: CustomerContextSnapshot | null = null;
  return {
    async prepareCustomerContext(args) {
      snapshot = (args.authentication !== null || args.trustedPhone !== null) &&
        (execution.results.length > 0 || execution.summaries.length > 0)
        ? assembleCustomerContext({
          execution,
          identity: args.identity,
          currentContext: args.currentContext,
          nowIso: new Date().toISOString(),
        })
        : unavailableCustomerContext(args);
      return snapshot;
    },
    async execute() {
      return {
        results: [...execution.results],
        summaries: [...execution.summaries],
        ...(snapshot ? { customerContext: snapshot } : {}),
      };
    },
  };
}
