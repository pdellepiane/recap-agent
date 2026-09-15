import type {
  CustomerCapability,
  PlanOwner,
  PlanSnapshot,
  PlanUpdate,
} from '../core/plan';
import { mergePlan, ownerValues } from '../core/plan';

/**
 * L4 persistent specialist ownership routing.
 *
 * Exactly three persistent owners: planning, faq, customer_assistance.
 * Customer assistance carries scoped capability slices (purchase, RSVP,
 * auth, support), never child agents or persistent subowners. All inputs
 * are typed domain evidence; no message text is inspected here, so routing
 * can never depend on keywords or exact-string matches.
 */

export type OwnerDomainSignals = {
  /** Typed planning work is the primary task (needs, search, selection, close). */
  readonly planningWork: boolean;
  /** Typed general-information work is the primary task (public FAQ/policy). */
  readonly faqWork: boolean;
  /** Typed customer-specific work (purchase, RSVP, auth, support follow-up). */
  readonly customerWork: boolean;
  /** Grounded identity/access exists for protected facts or effects. */
  readonly identityAccessGrounded: boolean;
  /** The model emitted an explicit protected-task request this turn. */
  readonly protectedTaskRequested: boolean;
};

export const emptyOwnerDomainSignals: OwnerDomainSignals = {
  planningWork: false,
  faqWork: false,
  customerWork: false,
  identityAccessGrounded: false,
  protectedTaskRequested: false,
};

export type CustomerCapabilitySignals = {
  readonly purchaseWork: boolean;
  readonly rsvpWork: boolean;
  readonly authWork: boolean;
  readonly supportWork: boolean;
};

export const emptyCustomerCapabilitySignals: CustomerCapabilitySignals = {
  purchaseWork: false,
  rsvpWork: false,
  authWork: false,
  supportWork: false,
};

export function isPlanOwner(value: unknown): value is PlanOwner {
  return (
    typeof value === 'string' &&
    (ownerValues as readonly string[]).includes(value)
  );
}

/**
 * Transient initial selection from typed domain signals. Established turns
 * keep their persisted owner; this only decides the first owner when the
 * plan has no meaningful ownership yet (fresh planning default with no
 * pending owner task). Priority is explicitness-safe: customer work wins
 * only with grounded identity when a protected task was requested,
 * otherwise FAQ wins over planning for general-information turns.
 */
export function resolveInitialOwner(
  signals: OwnerDomainSignals,
): PlanOwner {
  if (
    signals.customerWork &&
    (!signals.protectedTaskRequested || signals.identityAccessGrounded)
  ) {
    return 'customer_assistance';
  }
  if (signals.faqWork) {
    return 'faq';
  }
  return 'planning';
}

/**
 * Whether an established owner stays without a transfer. The current owner
 * keeps the turn when its domain still has work or when no other domain
 * shows work. A transfer is only proposed when another domain has work and
 * the current domain does not.
 */
export function resolveOwnerForTurn(args: {
  readonly currentOwner: PlanOwner;
  readonly signals: OwnerDomainSignals;
}): PlanOwner {
  const { currentOwner, signals } = args;
  const workFor = (owner: PlanOwner): boolean =>
    owner === 'planning'
      ? signals.planningWork
      : owner === 'faq'
        ? signals.faqWork
        : signals.customerWork;
  if (workFor(currentOwner)) {
    return currentOwner;
  }
  if (currentOwner === 'planning' && signals.faqWork) {
    return 'faq';
  }
  if (currentOwner === 'planning' && signals.customerWork) {
    return 'customer_assistance';
  }
  if (currentOwner === 'faq' && signals.customerWork) {
    return 'customer_assistance';
  }
  if (
    (currentOwner === 'faq' || currentOwner === 'customer_assistance') &&
    signals.planningWork
  ) {
    return 'planning';
  }
  if (currentOwner === 'customer_assistance' && signals.faqWork) {
    return 'faq';
  }
  return currentOwner;
}

export type OwnerTransferRequest = {
  readonly from: PlanOwner;
  readonly to: PlanOwner;
  /** Transfers already applied this turn. At most one is allowed. */
  readonly transfersThisTurn: number;
  /** FAQ to person-specific assistance needs grounded identity/access. */
  readonly identityAccessGrounded: boolean;
  /** Protected task explicitly requested (typed extraction evidence). */
  readonly protectedTaskRequested: boolean;
};

export type OwnerTransferResult =
  | {
      readonly transferred: true;
      readonly owner: PlanOwner;
      readonly transfersThisTurn: number;
      /** Paused owner to resume later; null when the source had no pending task. */
      readonly returnOwner: PlanOwner | null;
    }
  | {
      readonly transferred: false;
      readonly owner: PlanOwner;
      readonly transfersThisTurn: number;
      readonly reason:
        | 'same_owner'
        | 'transfer_budget_exhausted'
        | 'identity_access_not_grounded';
    };

/**
 * Single-transfer bound. The source stops and the recipient alone
 * replies/acts; a second same-turn transfer fails closed. FAQ to
 * person-specific assistance is gated on grounded identity/access before
 * protected facts or effects.
 */
export function applyOwnerTransfer(
  request: OwnerTransferRequest,
): OwnerTransferResult {
  if (request.from === request.to) {
    return {
      transferred: false,
      owner: request.from,
      transfersThisTurn: request.transfersThisTurn,
      reason: 'same_owner',
    };
  }
  if (request.transfersThisTurn >= 1) {
    return {
      transferred: false,
      owner: request.from,
      transfersThisTurn: request.transfersThisTurn,
      reason: 'transfer_budget_exhausted',
    };
  }
  if (
    request.from === 'faq' &&
    request.to === 'customer_assistance' &&
    request.protectedTaskRequested &&
    !request.identityAccessGrounded
  ) {
    return {
      transferred: false,
      owner: request.from,
      transfersThisTurn: request.transfersThisTurn,
      reason: 'identity_access_not_grounded',
    };
  }
  return {
    transferred: true,
    owner: request.to,
    transfersThisTurn: request.transfersThisTurn + 1,
    returnOwner: request.from,
  };
}

/**
 * Capability slice within Customer assistance. Switching purchase, RSVP,
 * auth or support slices is not a transfer: no churn, no unrelated task
 * context disclosure. Priority follows explicitness of typed work signals;
 * support is the default slice for general follow-ups.
 */
export function resolveCustomerCapability(
  signals: CustomerCapabilitySignals,
): Exclude<CustomerCapability, 'none'> {
  if (signals.authWork) {
    return 'auth';
  }
  if (signals.purchaseWork) {
    return 'purchase';
  }
  if (signals.rsvpWork) {
    return 'rsvp';
  }
  return 'support';
}

/** Protected capabilities need grounded identity/access before facts or effects. */
export function capabilityRequiresIdentityAccess(
  capability: CustomerCapability | null,
): boolean {
  return (
    capability === 'purchase' ||
    capability === 'rsvp' ||
    capability === 'auth'
  );
}

export type OwnerTurnUpdate = {
  readonly plan: PlanSnapshot;
  readonly owner: PlanOwner;
  readonly capability: CustomerCapability | null;
  readonly transferred: boolean;
  readonly transfersThisTurn: number;
};

/**
 * Persist ownership for the turn on the existing plan store. Reuses domain
 * state only; no second store. Capability is set only under Customer
 * assistance, pending question/task refs travel with the transfer packet,
 * and the paused owner is retained as the single return owner.
 */
export function applyOwnerForTurn(args: {
  readonly plan: PlanSnapshot;
  readonly signals: OwnerDomainSignals;
  readonly capabilitySignals: CustomerCapabilitySignals;
  readonly transfersThisTurn: number;
  readonly pendingQuestion?: string | null;
  readonly pendingTask?: string | null;
}): OwnerTurnUpdate {
  const currentOwner = isPlanOwner(args.plan.owner)
    ? args.plan.owner
    : 'planning';
  const desiredOwner = args.transfersThisTurn === 0 &&
    args.plan.owner_pending_task == null &&
    args.plan.owner_pending_question == null &&
    currentOwner === 'planning' &&
    !hasEstablishedOwnerWork(args.plan)
    ? resolveInitialOwner(args.signals)
    : resolveOwnerForTurn({ currentOwner, signals: args.signals });
  if (desiredOwner === currentOwner) {
    const capability = currentOwner === 'customer_assistance'
      ? resolveCustomerCapability(args.capabilitySignals)
      : null;
    const plan = capability === (args.plan.owner_capability ?? null) &&
      args.pendingQuestion === undefined &&
      args.pendingTask === undefined
      ? args.plan
      : mergePlan(args.plan, {
        owner: currentOwner,
        owner_capability: capability,
        ...(args.pendingQuestion !== undefined
          ? { owner_pending_question: args.pendingQuestion }
          : {}),
        ...(args.pendingTask !== undefined
          ? { owner_pending_task: args.pendingTask }
          : {}),
      });
    return {
      plan,
      owner: currentOwner,
      capability,
      transferred: false,
      transfersThisTurn: args.transfersThisTurn,
    };
  }
  const transfer = applyOwnerTransfer({
    from: currentOwner,
    to: desiredOwner,
    transfersThisTurn: args.transfersThisTurn,
    identityAccessGrounded: args.signals.identityAccessGrounded,
    protectedTaskRequested: args.signals.protectedTaskRequested,
  });
  if (!transfer.transferred) {
    return {
      plan: args.plan,
      owner: currentOwner,
      capability: args.plan.owner_capability ?? null,
      transferred: false,
      transfersThisTurn: transfer.transfersThisTurn,
    };
  }
  const capability = transfer.owner === 'customer_assistance'
    ? resolveCustomerCapability(args.capabilitySignals)
    : null;
  const update: PlanUpdate = {
    owner: transfer.owner,
    owner_capability: capability,
    owner_return: transfer.returnOwner,
  };
  if (args.pendingQuestion !== undefined) {
    update.owner_pending_question = args.pendingQuestion;
  }
  if (args.pendingTask !== undefined) {
    update.owner_pending_task = args.pendingTask;
  }
  return {
    plan: mergePlan(args.plan, update),
    owner: transfer.owner,
    capability,
    transferred: true,
    transfersThisTurn: transfer.transfersThisTurn,
  };
}

/**
 * Resume a paused owner on a later turn without losing its pending task.
 * Returns the plan with the return owner restored, or the plan unchanged
 * when there is nothing to resume.
 */
export function resumeReturnOwner(plan: PlanSnapshot): PlanSnapshot {
  const returnOwner = plan.owner_return;
  if (returnOwner === null || returnOwner === undefined) {
    return plan;
  }
  if (!isPlanOwner(returnOwner)) {
    return mergePlan(plan, { owner_return: null });
  }
  return mergePlan(plan, {
    owner: returnOwner,
    owner_return: null,
    owner_capability: returnOwner === 'customer_assistance'
      ? (plan.owner_capability ?? 'support')
      : null,
  });
}

function hasEstablishedOwnerWork(plan: PlanSnapshot): boolean {
  return (
    plan.information_state.pending_requests.length > 0 ||
    plan.information_state.last_completed_request != null ||
    plan.rsvp_state.status !== 'none' ||
    plan.rsvp_state.pending_action != null ||
    plan.owner_pending_question != null ||
    plan.owner_pending_task != null
  );
}
