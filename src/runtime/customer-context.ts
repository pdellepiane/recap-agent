import type {
  CartInformation,
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseInformation,
  PurchaseItem,
  PurchaseItemSourceAlternative,
  PurchaseItemSourceConflict,
  PurchaseSourceCoverage,
} from '../core/information';
import type { UserEventLookupResult, UserEventSummary } from './provider-gateway';
import { enrichmentVisitKey } from '../core/information';
import {
  creditFulfillmentPolicyForItems,
  mapItemFulfillment,
} from './purchase-disclosure-policy';

/**
 * L4 Customer operations context assembly.
 *
 * One typed snapshot built from authorized backend reads when entering
 * Customer operations. Independent reads overlap (the orchestrator runs
 * them through Promise.allSettled); each section carries its own load
 * status so an unrelated slow or failed optional lookup never blocks a
 * ready answer, while a failed required section stays visible as
 * unavailable/failed. The serialized profile retains every authorized fact
 * regardless of extraction choices.
 */

export const customerSectionStatusValues = [
  'not_requested',
  'loading',
  'ready',
  'empty',
  'not_found',
  'unavailable',
  'failed',
] as const;

export type CustomerSectionStatus =
  (typeof customerSectionStatusValues)[number];

export type CustomerSectionBase = {
  readonly status: CustomerSectionStatus;
  /** Which backend route produced this section (never a display name). */
  readonly source: string | null;
  readonly fetchedAt: string | null;
  /** Access scope that authorized the read (account, trusted phone, public). */
  readonly scope: string | null;
  readonly completeness: 'complete' | 'partial' | 'country_only' | null;
  /**
   * Pagination exhaustion: true only when the backend reported the last
   * page, false when truncated by a bound or continuation, null when the
   * route reports no pagination state. False forces partial completeness.
   */
  readonly paginationExhausted: boolean | null;
  /**
   * API-side history cap in backend terms, or null when undocumented.
   * Unknown stays null instead of claiming full history.
   */
  readonly historyLimit: string | null;
};

export type IdentityAccessSection = CustomerSectionBase & {
  readonly section: 'identity_access';
  readonly customerRef: string | null;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly authorizedScopes: readonly string[];
  readonly guestEventIds: readonly number[];
  readonly hostEventIds: readonly number[];
};

export type CurrentContextSection = CustomerSectionBase & {
  readonly section: 'current_context';
  readonly relevantEventIds: readonly (number | string)[];
  readonly relevantOrderIds: readonly string[];
  readonly pendingQuestion: string | null;
  readonly unresolvedCandidateOrderIds: readonly string[];
  readonly unresolvedCandidateEventIds: readonly (number | string)[];
};

export type PurchasesCartsSection = CustomerSectionBase & {
  readonly section: 'purchases_carts';
  /** One canonical record body per stable purchase identity and source. */
  readonly purchases: readonly PurchaseInformation[];
  readonly carts: readonly CartInformation[];
  /**
   * Per-source coverage for discovery expansions behind this section, in
   * stable source order. Absent when no leg reported coverage. Partial or
   * failed legs stay explicit here so ready facts never read as exhaustive.
   */
  readonly sourceCoverage?: readonly PurchaseSourceCoverage[];
};

/** Existing event records retain their guest/host, venue, moments and metadata fields. */
export type InvitationEventSummary = UserEventSummary;

export type InvitationsEventsSection = CustomerSectionBase & {
  readonly section: 'invitations_events';
  readonly invitations: readonly InvitationEventSummary[];
};

export type ActionOutcome = {
  readonly operation: string;
  readonly target: string;
  readonly receipt: 'confirmed' | 'failed' | 'unknown';
  readonly observedAt: string;
  readonly dedupeKey: string | null;
};

export type ActionOutcomesSection = CustomerSectionBase & {
  readonly section: 'action_outcomes';
  readonly outcomes: readonly ActionOutcome[];
};

export const addressKindValues = [
  'venue',
  'shipping',
  'billing',
  'incomplete',
] as const;

export type AddressKind = (typeof addressKindValues)[number];

export type CustomerAddress = {
  readonly kind: AddressKind;
  readonly source: string;
  readonly completeness: 'complete' | 'partial' | 'country_only';
  readonly street: string | null;
  readonly city: string | null;
  readonly country: string | null;
};

/**
 * An event country fallback is never a street, shipping or home address.
 * Country-only data stays `country_only` so the model asks instead of
 * presenting it as complete. Nothing is invented.
 */
export function classifyAddress(args: {
  readonly kind: Exclude<AddressKind, 'incomplete'>;
  readonly source: string;
  readonly street?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
}): CustomerAddress {
  const street = args.street?.trim() ? args.street.trim() : null;
  const city = args.city?.trim() ? args.city.trim() : null;
  const country = args.country?.trim() ? args.country.trim() : null;
  if (street !== null) {
    return {
      kind: args.kind,
      source: args.source,
      completeness: city !== null ? 'complete' : 'partial',
      street,
      city,
      country,
    };
  }
  if (country !== null) {
    return {
      kind: args.kind,
      source: args.source,
      completeness: 'country_only',
      street: null,
      city,
      country,
    };
  }
  return {
    kind: 'incomplete',
    source: args.source,
    completeness: 'country_only',
    street: null,
    city,
    country,
  };
}

export type CustomerContextSnapshot = {
  readonly identityAccess: IdentityAccessSection;
  readonly currentContext: CurrentContextSection;
  readonly purchasesCarts: PurchasesCartsSection;
  readonly invitationsEvents: InvitationsEventsSection;
  readonly actionOutcomes: ActionOutcomesSection;
  readonly timingsMs: Readonly<Record<string, number>>;
  /** Internal, turn-scoped instrumentation; omitted from model projections. */
  readonly readMetrics?: CustomerReadMetrics;
};

export type CustomerReadMetrics = {
  readonly totalReads: number;
  readonly peakConcurrency: number;
  readonly readsByOperation: Readonly<Record<string, number>>;
};

export type IdentityEvidence = {
  /** Backend customer reference (id, token hash, phone E.164). Never a name. */
  readonly customerRef: string | null;
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly authorizedScopes?: readonly string[];
  readonly scope: string | null;
  readonly source: string | null;
  readonly fetchedAt?: string | null;
  readonly guestEventIds?: readonly number[];
  readonly hostEventIds?: readonly number[];
};

export type CurrentContextEvidence = {
  readonly relevantEventIds?: readonly (number | string)[];
  readonly relevantOrderIds?: readonly string[];
  readonly pendingQuestion?: string | null;
  readonly unresolvedCandidateOrderIds?: readonly string[];
  readonly unresolvedCandidateEventIds?: readonly (number | string)[];
};

export type CustomerExecution = {
  readonly results: readonly InformationTaskResult[];
  readonly summaries: readonly InformationExecutionSummary[];
};

/**
 * Identity isolation key. Protected data is never keyed by display name
 * alone: a backend reference (account id, token hash or verified phone) is
 * required, otherwise null so caches cannot leak across identities.
 */
export function isolationScopeKey(identity: {
  readonly customerRef?: string | null;
  readonly displayName?: string | null;
}): string | null {
  const ref = identity.customerRef?.trim();
  if (ref) {
    return `customer:${ref}`;
  }
  return null;
}

function emptyBase(): Pick<
  CustomerSectionBase,
  'status' | 'source' | 'fetchedAt' | 'scope' | 'completeness' | 'paginationExhausted' | 'historyLimit'
> {
  return {
    status: 'not_requested',
    source: null,
    fetchedAt: null,
    scope: null,
    completeness: null,
    paginationExhausted: null,
    historyLimit: null,
  };
}

type PurchaseResult = Extract<InformationTaskResult, { kind: 'purchase' }>;
type EventResult = Extract<InformationTaskResult, { kind: 'associated_event' }>;

function purchaseFromUserEventOrder(
  order: NonNullable<UserEventLookupResult['recentOrders']>[number],
  accessScope: string | null,
): PurchaseInformation | null {
  if (order.id === null) return null;
  return {
    orderId: String(order.id),
    recordSource: 'user_lookup',
    accessScope,
    eventId: order.eventId ?? null,
    currency: order.currency ?? null,
    currencySymbol: order.currencySymbol ?? null,
    customerTransactionNumber: order.incrementId,
    paymentStatus: order.paymentStatus,
    shippingStatus: order.shippingStatus,
    grandTotal: order.grandTotal,
    paymentMethod: order.paymentMethod,
    eventName: order.eventName ?? null,
    eventDate: order.eventDate ?? null,
    eventUrl: order.eventUrl ?? null,
    createdAt: order.createdAt,
    items: order.giftType
      ? [{ giftName: null, quantity: null, amount: null, rowTotal: null, type: order.giftType }]
      : [],
  };
}

function statusForResult(
  result: InformationTaskResult | undefined,
  summary: InformationExecutionSummary | undefined,
): { status: CustomerSectionStatus; completeness: CustomerSectionBase['completeness'] } {
  if (!result || !summary) {
    return { status: 'not_requested', completeness: null };
  }
  if (result.status === 'completed') {
    const hasFacts = result.kind === 'purchase'
      ? result.purchases.length > 0 || (result.carts?.length ?? 0) > 0
      : result.kind === 'associated_event'
        ? result.result.events.length > 0 || (result.result.recentOrders?.length ?? 0) > 0
        : result.evidence.length > 0;
    return {
      status: hasFacts ? 'ready' : 'empty',
      completeness: summary.coverage === 'partial' || summary.coverage === 'inconsistent'
        ? 'partial'
        : 'complete',
    };
  }
  if (result.status === 'needs_input') {
    return { status: 'unavailable', completeness: null };
  }
  if (result.status === 'failed' && result.failureKind === 'not_found') {
    // A scoped phone lookup that succeeded but found no association is an
    // authoritative absence, not a transport failure.
    return { status: 'not_found', completeness: null };
  }
  if (
    result.status === 'failed' &&
    (result.failureKind === 'not_configured' ||
      result.failureKind === 'route_unavailable' ||
      result.failureKind === 'unauthorized')
  ) {
    return { status: 'unavailable', completeness: null };
  }
  return { status: 'failed', completeness: null };
}

/**
 * Shared assembly over the existing orchestrator execution. Preserves
 * parallelism and independent failure: every requested section is derived
 * from its own settled result, so one failed optional lookup cannot poison
 * the others. `not_found` is only reported on a successful authoritative
 * read; timeouts and unrequested sections stay distinct.
 */
export function assembleCustomerContext(args: {
  readonly execution: CustomerExecution | null;
  readonly identity: IdentityEvidence | null;
  readonly currentContext: CurrentContextEvidence | null;
  readonly actionOutcomes?: readonly ActionOutcome[];
  readonly nowIso: string;
}): CustomerContextSnapshot {
  const results = args.execution?.results ?? [];
  const summaries = args.execution?.summaries ?? [];
  const summaryById = new Map(summaries.map((summary) => [summary.requestId, summary]));
  const purchaseResults = results.filter(
    (result): result is PurchaseResult => result.kind === 'purchase',
  );
  const eventResults = results.filter(
    (result): result is EventResult => result.kind === 'associated_event',
  );
  const authorizedUser = eventResults.find(
    (result) => result.status === 'completed' && result.result.user !== null,
  );
  const eventUser = authorizedUser?.status === 'completed' ? authorizedUser.result.user : null;
  const purchaseSummaries = purchaseResults.map((result) => summaryById.get(result.requestId));
  const eventSummaries = eventResults.map((result) => summaryById.get(result.requestId));

  const identityAccess: IdentityAccessSection = args.identity?.scope
    ? {
      section: 'identity_access',
      status: 'ready',
      source: args.identity.source,
      fetchedAt: args.identity.fetchedAt ?? args.nowIso,
      scope: args.identity.scope,
      completeness: 'complete',
      paginationExhausted: null,
      historyLimit: null,
      customerRef: args.identity.customerRef,
      displayName: args.identity.customerRef
        ? args.identity.displayName ?? eventUser?.fullName ?? null
        : null,
      email: args.identity.email ?? eventUser?.email ?? null,
      phone: args.identity.phone ?? eventUser?.fullPhone ?? null,
      authorizedScopes: args.identity.authorizedScopes ?? [args.identity.scope],
      guestEventIds: args.identity.guestEventIds ?? [],
      hostEventIds: args.identity.hostEventIds ?? [],
    }
    : {
      // R7 grounding: a display name without a backend customer reference
      // is never projected (prevents carina ANDREA&RODRIGO-class invented
      // names). Seed/summary facts with a ref stay usable.
      section: 'identity_access',
      ...emptyBase(),
      customerRef: null,
      displayName: null,
      email: null,
      phone: null,
      authorizedScopes: [],
      guestEventIds: [],
      hostEventIds: [],
    };

  const currentContext: CurrentContextSection = args.currentContext
    ? {
      section: 'current_context',
      status: 'ready',
      source: 'plan_domain_state',
      fetchedAt: args.nowIso,
      scope: args.identity?.scope ?? null,
      completeness: 'complete',
      paginationExhausted: null,
      historyLimit: null,
      relevantEventIds: args.currentContext.relevantEventIds ?? [],
      relevantOrderIds: args.currentContext.relevantOrderIds ?? [],
      pendingQuestion: args.currentContext.pendingQuestion ?? null,
      unresolvedCandidateOrderIds: args.currentContext.unresolvedCandidateOrderIds ?? [],
      unresolvedCandidateEventIds: args.currentContext.unresolvedCandidateEventIds ?? [],
    }
    : {
      section: 'current_context',
      ...emptyBase(),
      relevantEventIds: [],
      relevantOrderIds: [],
      pendingQuestion: null,
      unresolvedCandidateOrderIds: [],
      unresolvedCandidateEventIds: [],
    };

  const purchaseStatuses = purchaseResults.map((result, index) =>
    statusForResult(result, purchaseSummaries[index]),
  );
  const purchasePagination = paginationFor(purchaseSummaries);
  // Canonicalize only duplicate reads of the same source, scope, partition
  // and stable identity. Distinct roots with the same ID remain separate.
  const coalescedDetailed = coalescePurchasesByStableId(
    [
      ...purchaseResults.flatMap((result) =>
      result.status === 'completed'
        ? result.purchases.map((purchase) => {
          const rootSource = result.lookupResource ??
            (result.resource === 'orders' || result.resource === 'gift_purchases'
              ? result.resource
              : result.accessMethod === 'trusted_phone_event_purchase'
                ? 'event_detail'
                : undefined);
          return {
            purchase: {
              ...purchase,
              recordSource: purchase.recordSource ?? rootSource,
              accessScope: purchase.accessScope ?? result.accessMethod ?? null,
            },
            accessMethod: result.accessMethod ?? null,
          };
        })
        : [],
      ),
      ...eventResults.flatMap((result) =>
        result.status === 'completed'
          ? (result.result.recentOrders ?? []).flatMap((order) => {
            const purchase = purchaseFromUserEventOrder(
              order,
              result.accessMethod ?? null,
            );
            return purchase ? [{ purchase, accessMethod: result.accessMethod ?? null }] : [];
          })
          : [],
      ),
    ],
  );
  const purchaseFactCount = coalescedDetailed.length + purchaseResults.reduce(
    (count, result) => count + (result.status === 'completed' ? (result.carts ?? []).length : 0),
    0,
  );
  const sourceCoverage = purchaseResults.flatMap((result) =>
    result.status === 'completed' || result.status === 'failed'
      ? result.sourceCoverage ?? []
      : [],
  );
  const purchaseCompleteness = sectionCompleteness({
    statuses: purchaseStatuses.map((entry) => entry.status),
    factsAvailable: purchaseFactCount > 0,
    paginationExhausted: purchasePagination.paginationExhausted,
    sourceComplete: sourceCoverage.length > 0
      ? sourceCoverage.every((entry) => entry.status === 'completed' || entry.status === 'empty')
      : null,
  });
  const purchasesCarts: PurchasesCartsSection = purchaseResults.length === 0
    ? {
      section: 'purchases_carts',
      ...emptyBase(),
      purchases: [],
      carts: [],
    }
    : {
      section: 'purchases_carts',
      status: purchaseStatuses.some((entry) => entry.status === 'ready')
        ? 'ready'
        : worstStatus(purchaseStatuses.map((entry) => entry.status)),
      source: purchaseResults.length > 0 ? 'agent_api' : null,
      fetchedAt: args.nowIso,
      scope: args.identity?.scope ?? null,
      completeness: purchaseCompleteness,
      paginationExhausted: purchasePagination.paginationExhausted,
      historyLimit: purchasePagination.historyLimit,
      purchases: coalescedDetailed,
      carts: purchaseResults.flatMap((result) =>
        result.status === 'completed' ? (result.carts ?? []) : [],
      ),
      ...collectedPurchaseSourceCoverage(purchaseResults),
    };

  const eventStatuses = eventResults.map((result, index) =>
    statusForResult(result, eventSummaries[index]),
  );
  const eventPagination = paginationFor(eventSummaries);
  // Purchase-only turns carry their shared guest-event root through the
  // existing purchase result (linkedEvents, mapped with the same event
  // mapping below): no fabricated request, no second mapper. Distinct
  // events/guests never merge by name/date — slots stay keyed by stable
  // event + guest + scope.
  const linkedEventEntries = purchaseResults.flatMap((result) =>
    result.status === 'completed' && result.linkedEvents
      ? [{
        lookup: result.linkedEvents,
        accessMethod: result.accessMethod ?? null,
        failures: result.linkedEventFailures ?? [],
        truncated: result.linkedEventsTruncated ?? false,
      } as const]
      : [],
  );
  const linkedHasPartial = linkedEventEntries.some((entry) =>
    entry.truncated || entry.failures.length > 0,
  );
  // P1 slot coalesce: stable (event + guest + scope) slots collapse
  // duplicate reads; same event with different guests keeps distinct slots.
  // Names never form a key, so cross-route name equality is not identity.
  const coalescedInvitations = coalesceInvitationsBySlot([
    ...eventResults.flatMap((result) =>
      result.status === 'completed'
        ? invitationEntriesFromEventLookup(
          result.result,
          result.accessMethod ?? args.identity?.scope ?? null,
        )
        : [],
    ),
    ...linkedEventEntries.flatMap((entry) =>
      invitationEntriesFromEventLookup(
        entry.lookup,
        entry.accessMethod ?? args.identity?.scope ?? null,
      ),
    ),
  ]);
  const eventCompleteness = sectionCompleteness({
    statuses: [...eventStatuses.map((entry) => entry.status), ...(linkedHasPartial ? ['failed' as const] : [])],
    factsAvailable: coalescedInvitations.length > 0,
    paginationExhausted: eventPagination.paginationExhausted,
    sourceComplete: null,
  });
  const hasLinkedEvents = linkedEventEntries.length > 0;
  const invitationsEvents: InvitationsEventsSection = eventResults.length === 0 && !hasLinkedEvents
    ? {
      section: 'invitations_events',
      ...emptyBase(),
      invitations: [],
    }
    : {
      section: 'invitations_events',
      status: eventStatuses.some((entry) => entry.status === 'ready') || hasLinkedEvents
        ? 'ready'
        : worstStatus(eventStatuses.map((entry) => entry.status)),
      source: 'agent_api',
      fetchedAt: args.nowIso,
      scope: args.identity?.scope ?? null,
      completeness: eventCompleteness,
      paginationExhausted: eventPagination.paginationExhausted,
      historyLimit: eventPagination.historyLimit,
      invitations: coalescedInvitations,
    };

  const actionOutcomes: ActionOutcomesSection = {
    section: 'action_outcomes',
    status: (args.actionOutcomes ?? []).length > 0 ? 'ready' : 'not_requested',
    source: (args.actionOutcomes ?? []).length > 0 ? 'runtime_receipts' : null,
    fetchedAt: (args.actionOutcomes ?? []).length > 0 ? args.nowIso : null,
    scope: args.identity?.scope ?? null,
    completeness: 'complete',
    paginationExhausted: null,
    historyLimit: null,
    outcomes: args.actionOutcomes ?? [],
  };

  const timingsMs: Record<string, number> = {};
  for (const summary of summaries) {
    timingsMs[summary.requestId] = summary.durationMs;
  }

  return {
    identityAccess,
    currentContext,
    purchasesCarts,
    invitationsEvents,
    actionOutcomes,
    timingsMs,
  };
}

/**
 * Pagination/history provenance across the summaries behind one section.
 * Any unexhausted page forces partial; unknown stays null (never invented
 * as complete or incomplete). The first documented history cap is kept so
 * API-side limits stay explicit instead of implying full history.
 */
function paginationFor(
  summaries: readonly (InformationExecutionSummary | undefined)[],
): Pick<CustomerSectionBase, 'paginationExhausted' | 'historyLimit'> {
  let exhausted: boolean | null = null;
  let seen = false;
  let historyLimit: string | null = null;
  for (const summary of summaries) {
    if (!summary) {
      continue;
    }
    seen = true;
    if (summary.paginationExhausted === false) {
      exhausted = false;
    } else if (exhausted === null && summary.paginationExhausted === true) {
      exhausted = true;
    }
    if (historyLimit === null && summary.historyLimit) {
      historyLimit = summary.historyLimit;
    }
  }
  return { paginationExhausted: seen ? exhausted : null, historyLimit };
}

/**
 * Per-source coverage behind the purchases section. Collects every leg the
 * orchestrator reported (completed and failed alike), deduplicated by
 * source + childId in stable source order. Absent when no leg reported
 * coverage, so single-source turns serialize unchanged. Partial or failed
 * legs stay explicit so ready facts never read as exhaustive.
 */
function collectedPurchaseSourceCoverage(
  results: readonly InformationTaskResult[],
): { sourceCoverage?: readonly PurchaseSourceCoverage[] } {
  const seen = new Map<string, PurchaseSourceCoverage>();
  for (const result of results) {
    if (result.kind !== 'purchase') continue;
    const coverage = (result.status === 'completed' || result.status === 'failed')
      ? result.sourceCoverage ?? []
      : [];
    for (const entry of coverage) {
      const key = `${entry.source}:${entry.childId}`;
      if (!seen.has(key)) seen.set(key, entry);
    }
  }
  if (seen.size === 0) return {};
  const order: readonly string[] = ['orders', 'gift_purchases'];
  const sorted = [...seen.values()].sort((left, right) => {
    const leftIndex = order.indexOf(left.source);
    const rightIndex = order.indexOf(right.source);
    const leftRank = leftIndex < 0 ? order.length : leftIndex;
    const rightRank = rightIndex < 0 ? order.length : rightIndex;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.childId.localeCompare(right.childId);
  });
  return { sourceCoverage: sorted };
}

function worstStatus(statuses: readonly CustomerSectionStatus[]): CustomerSectionStatus {
  if (statuses.length === 0) {
    return 'not_requested';
  }
  if (statuses.some((status) => status === 'failed')) {
    return 'failed';
  }
  if (statuses.some((status) => status === 'unavailable')) {
    return 'unavailable';
  }
  if (statuses.some((status) => status === 'loading')) {
    return 'loading';
  }
  if (statuses.every((status) => status === 'empty')) {
    return 'empty';
  }
  if (statuses.every((status) => status === 'not_found')) {
    return 'not_found';
  }
  if (statuses.some((status) => status === 'ready')) {
    return 'ready';
  }
  return 'not_found';
}

function sectionCompleteness(args: {
  readonly statuses: readonly CustomerSectionStatus[];
  readonly factsAvailable: boolean;
  readonly paginationExhausted: boolean | null;
  readonly sourceComplete: boolean | null;
}): CustomerSectionBase['completeness'] {
  if (args.paginationExhausted === false) return 'partial';
  if (args.sourceComplete === false) return args.factsAvailable ? 'partial' : null;
  const unfinished = args.statuses.some((status) =>
    status === 'failed' || status === 'unavailable' || status === 'loading',
  );
  if (unfinished) return args.factsAvailable ? 'partial' : null;
  // A successful single response is not proof that the backend returned all
  // pages when its contract exposes no continuation metadata. Keep
  // completeness unknown until every paginated source explicitly exhausts.
  if (args.paginationExhausted === true) {
    return 'complete';
  }
  return null;
}

/** Required sections must be ready (or authoritative not_found) to answer. */
export function requiredSectionsReady(
  snapshot: CustomerContextSnapshot,
  required: readonly ('identity_access' | 'purchases_carts' | 'invitations_events')[],
): boolean {
  return required.every((section) => {
    const status = snapshot[
      section === 'identity_access'
        ? 'identityAccess'
        : section === 'purchases_carts'
          ? 'purchasesCarts'
          : 'invitationsEvents'
    ].status;
    return status === 'ready' || status === 'not_found' || status === 'empty';
  });
}

export type CustomerContextProjection = {
  readonly identityAccess: IdentityAccessSection;
  readonly currentContext: CurrentContextSection;
  /** One canonical customer record body per source and stable identity. */
  readonly purchases: readonly PurchaseInformation[];
  /** Carts ride the canonical profile as distinct records for later cart questions. */
  readonly carts: readonly CartInformation[];
  readonly invitations: readonly InvitationEventSummary[];
  readonly actionOutcomes: readonly ActionOutcome[];
  /** Availability and source completeness sit beside, never duplicate, records. */
  readonly coverage: CustomerContextCoverage;
};

export type CustomerContextCoverage = {
  readonly purchasesCarts: Pick<CustomerSectionBase,
    'status' | 'source' | 'fetchedAt' | 'scope' | 'completeness' | 'paginationExhausted' | 'historyLimit'> & {
      readonly sourceCoverage?: readonly PurchaseSourceCoverage[];
    };
  readonly invitationsEvents: Pick<CustomerSectionBase,
    'status' | 'source' | 'fetchedAt' | 'scope' | 'completeness' | 'paginationExhausted' | 'historyLimit'>;
};

/**
 * One canonical authorized customer profile. Request focus and entity hints
 * never select which already-authorized facts are serialized. Access
 * boundaries remain in force for internal customer transaction references.
 */
export function projectCustomerContext(
  snapshot: CustomerContextSnapshot,
): CustomerContextProjection {
  const purchases = snapshot.purchasesCarts.purchases.map((purchase) =>
    projectPurchaseForModel(purchase),
  );
  return {
    identityAccess: snapshot.identityAccess,
    currentContext: snapshot.currentContext,
    purchases,
    carts: [...snapshot.purchasesCarts.carts],
    invitations: [...snapshot.invitationsEvents.invitations],
    actionOutcomes: [...snapshot.actionOutcomes.outcomes],
    coverage: {
      purchasesCarts: {
        status: snapshot.purchasesCarts.status,
        source: snapshot.purchasesCarts.source,
        fetchedAt: snapshot.purchasesCarts.fetchedAt,
        scope: snapshot.purchasesCarts.scope,
        completeness: snapshot.purchasesCarts.completeness,
        paginationExhausted: snapshot.purchasesCarts.paginationExhausted,
        historyLimit: snapshot.purchasesCarts.historyLimit,
        ...(snapshot.purchasesCarts.sourceCoverage
          ? { sourceCoverage: snapshot.purchasesCarts.sourceCoverage }
          : {}),
      },
      invitationsEvents: {
        status: snapshot.invitationsEvents.status,
        source: snapshot.invitationsEvents.source,
        fetchedAt: snapshot.invitationsEvents.fetchedAt,
        scope: snapshot.invitationsEvents.scope,
        completeness: snapshot.invitationsEvents.completeness,
        paginationExhausted: snapshot.invitationsEvents.paginationExhausted,
        historyLimit: snapshot.invitationsEvents.historyLimit,
      },
    },
  };
}

/**
 * The customer-visible transaction reference is part of the authorized
 * purchase profile. Keeping it lets the extractor resolve a reference the
 * customer supplied against the actual record without a separate lookup or
 * guessing from event names. Internal payment IDs and operator notes remain
 * outside the model projection.
 */
export function projectPurchaseForModel(purchase: PurchaseInformation): PurchaseInformation {
  const {
    adminComment: _privateOperatorComment,
    payment,
    ...customerFacts
  } = purchase;
  void _privateOperatorComment;
  const safePayment = payment
    ? (() => {
      const {
        paymentId: _internalPaymentId,
        voucherImage: _privateVoucherLocation,
        ...paymentFacts
      } = payment;
      void _internalPaymentId;
      void _privateVoucherLocation;
      return paymentFacts;
    })()
    : payment;
  return {
    ...customerFacts,
    ...(payment !== undefined ? { payment: safePayment } : {}),
  };
}

/**
 * S7 inline expansion without another HTTP call. Fields already returned
 * inline (payment/items/venue/address) are projected as typed data: the
 * purchase keeps its authorized payment/items detail and the invitation keeps
 * its venue/country classification. Missing street is never a full address;
 * country-only stays country_only. Pure copy, single-copy sparse.
 */
export function expandInlinePurchaseDetail(purchase: PurchaseInformation): PurchaseInformation {
  return {
    ...purchase,
    items: [...purchase.items],
    payment: purchase.payment ? { ...purchase.payment } : purchase.payment,
  };
}

export function expandInlineEventAddress(address: CustomerAddress | null): CustomerAddress | null {
  return address ? { ...address } : null;
}

/**
 * S7 per-turn access-scoped visited/cache key. Operation (resource type),
 * identity authorization (scope) and entity ID scope every read so a public
 * fallback never collides with an authorized scoped read and cyclic
 * order -> event -> order links terminate. Name/recency never form a key.
 */
export function enrichmentScopeKey(scope: string, customerRef: string | null): string {
  const ref = customerRef?.trim();
  return ref ? `${scope}:${ref}` : scope;
}

export function enrichmentTargetKey(
  resourceType: 'order' | 'event' | 'invitation' | 'venue',
  stableId: string | number,
  accessScope: string,
): string {
  return enrichmentVisitKey(resourceType, stableId, accessScope);
}

export type RelevantTarget =
  | { readonly kind: 'target'; readonly orderId: string | null; readonly eventId: number | string | null }
  | { readonly kind: 'candidates'; readonly orderIds: readonly string[]; readonly eventIds: readonly (number | string)[] }
  | { readonly kind: 'none' };

/**
 * Two events or two purchases never resolve to the first record
 * automatically. An explicit relevant id wins; multiple records without
 * one stay candidates for a focused clarification.
 */
export function resolveRelevantTarget(args: {
  readonly orderIds: readonly string[];
  readonly eventIds: readonly (number | string)[];
  readonly relevantOrderIds?: readonly string[];
  readonly relevantEventIds?: readonly (number | string)[];
}): RelevantTarget {
  const orderMatch = (args.relevantOrderIds ?? []).find((id) =>
    args.orderIds.includes(id),
  ) ?? null;
  const eventMatch = (args.relevantEventIds ?? []).find((id) =>
    args.eventIds.map((eventId) => String(eventId)).includes(String(id)),
  ) ?? null;
  if (orderMatch !== null || eventMatch !== null) {
    return { kind: 'target', orderId: orderMatch, eventId: eventMatch };
  }
  if (args.orderIds.length === 1 && args.eventIds.length <= 1) {
    return {
      kind: 'target',
      orderId: args.orderIds[0] ?? null,
      eventId: args.eventIds[0] ?? null,
    };
  }
  if (args.orderIds.length === 0 && args.eventIds.length === 0) {
    return { kind: 'none' };
  }
  return { kind: 'candidates', orderIds: args.orderIds, eventIds: args.eventIds };
}

/**
 * R7 grounding: a display name is usable only when it traces to a scoped
 * record (backend customer reference present). Seed/summary facts with a
 * ref pass through; inventions without a ref read as null.
 */
export function groundedDisplayName(
  displayName: string | null | undefined,
  customerRef: string | null | undefined,
): string | null {
  if (!customerRef?.trim()) return null;
  const name = displayName?.trim();
  return name ? name : null;
}

/**
 * R7 Tia-Niur class: an explicit old target always wins over recency. Thin
 * typed wrapper over resolveRelevantTarget so tests and the reply path name
 * the invariant directly. Cross-event facts never bleed: only the matched
 * target projects detail.
 */
export function resolveExplicitTargetWins(args: {
  readonly orderIds: readonly string[];
  readonly eventIds: readonly (number | string)[];
  readonly relevantOrderIds?: readonly string[];
  readonly relevantEventIds?: readonly (number | string)[];
}): RelevantTarget {
  return resolveRelevantTarget(args);
}

/**
 * R7 name grounding: only names present in the scoped record set are
 * projectable. Anything else is an invention and must not enter the reply.
 */
export function isNameGrounded(
  name: string | null | undefined,
  scopedNames: ReadonlyArray<string | null | undefined>,
): boolean {
  const candidate = name?.trim().toLocaleLowerCase('es');
  if (!candidate) return false;
  return scopedNames.some(
    (scoped) => scoped?.trim().toLocaleLowerCase('es') === candidate,
  );
}
/**
 * After a confirmed effect, invalidate the affected section before the
 * model reports its outcome. A repeated acknowledgement finds the
 * confirmed receipt and implies no new action.
 */
export function invalidateSectionAfterWrite(
  snapshot: CustomerContextSnapshot,
  section: 'purchases_carts' | 'invitations_events',
): CustomerContextSnapshot {
  if (section === 'purchases_carts') {
    return {
      ...snapshot,
      purchasesCarts: {
        ...snapshot.purchasesCarts,
        status: 'loading',
        purchases: [],
        carts: [],
        sourceCoverage: undefined,
      },
    };
  }
  return {
    ...snapshot,
    invitationsEvents: {
      ...snapshot.invitationsEvents,
      status: 'loading',
      invitations: [],
    },
  };
}

export function recordActionOutcome(
  snapshot: CustomerContextSnapshot,
  outcome: ActionOutcome,
): CustomerContextSnapshot {
  if (
    outcome.dedupeKey !== null &&
    snapshot.actionOutcomes.outcomes.some((entry) => entry.dedupeKey === outcome.dedupeKey)
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    actionOutcomes: {
      ...snapshot.actionOutcomes,
      status: 'ready',
      source: 'runtime_receipts',
      outcomes: [...snapshot.actionOutcomes.outcomes, outcome],
    },
  };
}

export function hasConfirmedOutcome(
  snapshot: CustomerContextSnapshot,
  dedupeKey: string,
): boolean {
  return snapshot.actionOutcomes.outcomes.some(
    (outcome) => outcome.dedupeKey === dedupeKey && outcome.receipt === 'confirmed',
  );
}

/**
 * Packet P1 canonical profile helpers. One logical profile per turn, built
 * with existing types and orchestrator caches. Entry snapshot is created on
 * customer_assistance entry before reference resolution needs evidence;
 * every authorized lookup result (phone, account, purchase detail, event
 * detail) enriches the same snapshot. Pure public FAQ / planning-only turns
 * never prefetch customer data; the owner router is unchanged.
 */

/** True when every request is public FAQ: no customer prefetch allowed. */
export function isPurePublicFaqTurn(
  requests: readonly { kind: string }[],
): boolean {
  return requests.length > 0 &&
    requests.every((request) => request.kind === 'faq');
}

/**
 * Entry snapshot before reference resolution needs evidence. Carries
 * identity + current context only; purchases/invitations stay not_requested
 * until authorized reads enrich the same object through
 * mergeExecutionIntoSnapshot. Reused through resolution + reply.
 */
export function createEntryCustomerSnapshot(args: {
  readonly identity: IdentityEvidence | null;
  readonly currentContext: CurrentContextEvidence | null;
  readonly nowIso: string;
}): CustomerContextSnapshot {
  return assembleCustomerContext({
    execution: null,
    identity: args.identity,
    currentContext: args.currentContext,
    nowIso: args.nowIso,
  });
}

/**
 * Attendance slot key. Same event with different guests never shares a
 * slot: the guest id is part of the key, never the display name.
 */
export function attendanceSlotKey(
  eventId: number | string,
  guestId: number | string | null | undefined,
  accessScope: string,
): string {
  return `event:${String(eventId)}:guest:${guestId ?? 'unknown'}:scope:${accessScope}`;
}

/**
 * Scope compatibility for merge. Exact scope equality merges; the two
 * trusted-phone purchase families share one phone scope and merge. Any
 * other cross-scope pair (account vs phone, public vs scoped) never merges:
 * name equality alone is never identity. Authorization changes therefore
 * cannot reuse broader cached access through a merge.
 */
export function purchaseScopesCompatible(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

type CoalescablePurchase = {
  readonly purchase: PurchaseInformation;
  readonly accessMethod: string | null;
};

const CONFLICT_COMPARED_PURCHASE_FIELDS = [
  'paymentStatus',
  'grandTotal',
  'paymentMethod',
  'eventName',
  'eventDate',
  'customerTransactionNumber',
  'shippingStatus',
] as const;

function purchaseFieldValue(
  purchase: PurchaseInformation,
  field: (typeof CONFLICT_COMPARED_PURCHASE_FIELDS)[number],
): unknown {
  switch (field) {
    case 'paymentStatus': return purchase.paymentStatus;
    case 'grandTotal': return purchase.grandTotal;
    case 'paymentMethod': return purchase.paymentMethod;
    case 'eventName': return purchase.eventName;
    case 'eventDate': return purchase.eventDate;
    case 'customerTransactionNumber': return purchase.customerTransactionNumber ?? null;
    case 'shippingStatus': return purchase.shippingStatus;
  }
}

function isAuthoritativeValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Coalesce duplicate route results without detail loss. Same stable orderId
 * plus compatible access scope merges by filling missing fields
 * (authoritative detail supplies what summaries lack); conflicting fresh
 * records keep the conflict explicit by nulling the contested field instead
 * of picking a side. Incompatible scopes stay separate entries so a cached
 * broader read can never masquerade as current authorization.
 */
export function coalescePurchasesByStableId(
  entries: readonly CoalescablePurchase[],
): PurchaseInformation[] {
  const byIdentity = new Map<string, PurchaseInformation[]>();
  for (const entry of entries) {
    const source = entry.purchase.recordSource ?? 'unknown';
    const identity = JSON.stringify([
      entry.purchase.orderId,
      source,
      entry.purchase.partition ?? null,
      entry.purchase.accessScope ?? entry.accessMethod,
    ]);
    const bucket = byIdentity.get(identity) ?? [];
    if (bucket.some((purchase) => JSON.stringify(purchase) === JSON.stringify(entry.purchase))) {
      continue;
    }
    const current = bucket[0];
    if (current && bucket.length === 1) {
      const conflicts = conflictingPurchaseFacts(current, entry.purchase);
      if (conflicts.length === 0 || conflicts.every((field) => field === 'items')) {
        bucket[0] = mergeTwoPurchases(
          current,
          entry.purchase,
          { accessMethod: entry.accessMethod, scope: entry.purchase.accessScope ?? null },
          { accessMethod: entry.accessMethod, scope: entry.purchase.accessScope ?? null },
        );
      } else {
        bucket.push(entry.purchase);
      }
    } else {
      bucket.push(entry.purchase);
    }
    byIdentity.set(identity, bucket);
  }
  return [...byIdentity.values()].flat();
}

function conflictingPurchaseFacts(
  left: PurchaseInformation,
  right: PurchaseInformation,
): string[] {
  const excluded = new Set([
    'recordSource',
    'accessScope',
    'partition',
    'itemSourceConflict',
    'creditFulfillmentPolicy',
    'currencyConflict',
  ]);
  const conflicts: string[] = [];
  const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const field of fields) {
    if (excluded.has(field)) continue;
    const leftValue = (left as unknown as Record<string, unknown>)[field];
    const rightValue = (right as unknown as Record<string, unknown>)[field];
    if (field === 'items') {
      if (left.items.length > 0 && right.items.length > 0 &&
        itemListMultisetKey(left.items) !== itemListMultisetKey(right.items)) {
        conflicts.push(field);
      }
      continue;
    }
    if (isAuthoritativeValue(leftValue) && isAuthoritativeValue(rightValue) &&
      JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
      conflicts.push(field);
    }
  }
  return conflicts;
}

type ItemSnapshotInput = {
  readonly items: readonly PurchaseItem[];
  readonly source: PurchaseInformation['recordSource'] | null;
  readonly accessMethod: string | null;
  readonly scope: string | null;
};

function itemRawTupleKey(item: PurchaseItem): string {
  return JSON.stringify([
    item.giftName ?? null,
    item.quantity ?? null,
    item.amount ?? null,
    item.rowTotal ?? null,
    item.type ?? null,
  ]);
}

function itemListMultisetKey(items: readonly PurchaseItem[]): string {
  return JSON.stringify(items.map(itemRawTupleKey).sort());
}

function withRecomputedFulfillment(items: readonly PurchaseItem[]): PurchaseItem[] {
  return items.map((item) => ({
    giftName: item.giftName ?? null,
    quantity: item.quantity ?? null,
    amount: item.amount ?? null,
    rowTotal: item.rowTotal ?? null,
    type: item.type ?? null,
    fulfillment: mapItemFulfillment(item.type),
  }));
}

/**
 * Canonical item resolution for repeated snapshots of the same order.
 * Array order is not line identity and names/amounts are not keys, so
 * lists are compared as multisets of raw line tuples (derived fulfillment
 * ignored): empty snapshots contribute nothing, equivalent lists collapse
 * to the first display order, and non-equivalent nonempty lists keep every
 * complete distinct list in a typed conflict with source/scope provenance
 * instead of pairing or enriching individual lines. Every alternative is
 * retained and carries its own source and authorization scope.
 */
export function resolveOrderItemSnapshots(
  snapshots: readonly ItemSnapshotInput[],
): {
  items: PurchaseItem[];
  itemSourceConflict: PurchaseItemSourceConflict | null;
} {
  const nonempty = snapshots.filter((snapshot) => snapshot.items.length > 0);
  if (nonempty.length === 0) {
    return { items: [], itemSourceConflict: null };
  }
  const firstKey = itemListMultisetKey(nonempty[0]?.items ?? []);
  const equivalent = nonempty.every(
    (snapshot) => itemListMultisetKey(snapshot.items) === firstKey,
  );
  if (equivalent) {
    return {
      items: withRecomputedFulfillment(nonempty[0]?.items ?? []),
      itemSourceConflict: null,
    };
  }
  const seen = new Map<string, PurchaseItemSourceAlternative>();
  for (const snapshot of nonempty) {
    const key = JSON.stringify([
      snapshot.source,
      snapshot.accessMethod,
      snapshot.scope,
      itemListMultisetKey(snapshot.items),
    ]);
    if (!seen.has(key)) {
      seen.set(key, {
        items: withRecomputedFulfillment(snapshot.items),
        source: snapshot.source,
        accessMethod: snapshot.accessMethod,
        scope: snapshot.scope,
      });
    }
  }
  const alternatives = [...seen.values()];
  return {
    items: [],
    itemSourceConflict: {
      alternatives,
      truncated: false,
    },
  };
}

function snapshotsOfPurchase(
  purchase: PurchaseInformation,
  provenance: { accessMethod: string | null; scope: string | null },
): ItemSnapshotInput[] {
  const snapshots: ItemSnapshotInput[] = [];
  // Carried conflict alternatives re-enter as snapshots so a later agreeing
  // list can never silently clear an earlier unresolved conflict.
  for (const alternative of purchase.itemSourceConflict?.alternatives ?? []) {
    snapshots.push({
      items: alternative.items,
      source: alternative.source ?? null,
      accessMethod: alternative.accessMethod,
      scope: alternative.scope,
    });
  }
  if (purchase.items.length > 0) {
    snapshots.push({
      items: purchase.items,
      source: purchase.recordSource ?? null,
      accessMethod: provenance.accessMethod,
      scope: provenance.scope,
    });
  }
  return snapshots;
}

function mergeTwoPurchases(
  current: PurchaseInformation,
  incoming: PurchaseInformation,
  currentProvenance: { accessMethod: string | null; scope: string | null } = {
    accessMethod: null,
    scope: null,
  },
  incomingProvenance: { accessMethod: string | null; scope: string | null } = {
    accessMethod: null,
    scope: null,
  },
): PurchaseInformation {
  const resolvedItems = resolveOrderItemSnapshots([
    ...snapshotsOfPurchase(current, currentProvenance),
    ...snapshotsOfPurchase(incoming, incomingProvenance),
  ]);
  // Truncation is monotonic: a prior merge that dropped alternatives keeps
  // the partial-coverage marker even when this merge's own window fits,
  // since no authoritative replacement contract clears it. Only a merge
  // that resolves to a single canonical list drops the conflict.
  const mergedConflict = resolvedItems.itemSourceConflict !== null
    ? {
      ...resolvedItems.itemSourceConflict,
      truncated: resolvedItems.itemSourceConflict.truncated ||
        current.itemSourceConflict?.truncated === true ||
        incoming.itemSourceConflict?.truncated === true,
    }
    : null;
  const merged: PurchaseInformation = {
    ...current,
    eventId: current.eventId ?? incoming.eventId ?? null,
    currency: current.currency ?? incoming.currency ?? null,
    currencySymbol: current.currencySymbol ?? incoming.currencySymbol ?? null,
    paymentStatus: current.paymentStatus ?? incoming.paymentStatus,
    shippingStatus: current.shippingStatus ?? incoming.shippingStatus,
    grandTotal: current.grandTotal ?? incoming.grandTotal,
    paymentMethod: current.paymentMethod ?? incoming.paymentMethod,
    eventName: current.eventName ?? incoming.eventName,
    eventDate: current.eventDate ?? incoming.eventDate,
    eventUrl: current.eventUrl ?? incoming.eventUrl,
    createdAt: current.createdAt ?? incoming.createdAt,
    items: resolvedItems.items,
    // Policy derives from the canonical list only. A conflicted order
    // carries no order-wide host-credit assertion, and a canonical list
    // without host_credit clears any stale carried policy. Absent keys stay
    // absent so conflict-free records serialize unchanged.
    ...(mergedConflict !== null
      ? { itemSourceConflict: mergedConflict, creditFulfillmentPolicy: undefined }
      : {
        itemSourceConflict: undefined,
        creditFulfillmentPolicy: creditFulfillmentPolicyForItems(resolvedItems.items),
      }),
    payment: current.payment ?? incoming.payment,
    paymentValidationExpectation:
      current.paymentValidationExpectation ?? incoming.paymentValidationExpectation,
    dedication: current.dedication ?? incoming.dedication,
    thanks: current.thanks ?? incoming.thanks,
    isThanked: current.isThanked ?? incoming.isThanked,
    customerTransactionNumber:
      current.customerTransactionNumber ?? incoming.customerTransactionNumber ?? null,
  };
  for (const field of CONFLICT_COMPARED_PURCHASE_FIELDS) {
    const left = purchaseFieldValue(current, field);
    const right = purchaseFieldValue(incoming, field);
    if (
      isAuthoritativeValue(left) && isAuthoritativeValue(right) &&
      JSON.stringify(left) !== JSON.stringify(right)
    ) {
      switch (field) {
        case 'paymentStatus': merged.paymentStatus = null; break;
        case 'grandTotal': merged.grandTotal = null; break;
        case 'paymentMethod': merged.paymentMethod = null; break;
        case 'eventName': merged.eventName = null; break;
        case 'eventDate': merged.eventDate = null; break;
        case 'customerTransactionNumber': merged.customerTransactionNumber = null; break;
        case 'shippingStatus': merged.shippingStatus = null; break;
      }
    }
  }
    return merged;
}

type CoalescableInvitation = {
  readonly invitation: InvitationEventSummary;
  readonly guestId: number | string | null;
  readonly accessScope: string | null;
};

/**
 * Existing event-to-profile mapping: an event lookup (associated_event
 * result or purchase-linked root) becomes invitation slots keyed by stable
 * event + guest + scope. Single mapping for both sources; name/date never
 * form identity.
 */
function invitationEntriesFromEventLookup(
  lookup: UserEventLookupResult,
  accessScope: string | null,
): CoalescableInvitation[] {
  return lookup.events.map((event) => ({
    invitation: {
      ...event,
      orders: [],
      orderIds: event.orderIds ?? event.orders.flatMap((order) =>
        order.id === null ? [] : [String(order.id)],
      ),
      source: event.source ?? 'sinenvolturas_user_lookup',
      accessScope: event.accessScope ?? accessScope,
    },
    guestId: event.guestId ?? null,
    accessScope,
  }));
}

/**
 * Coalesce invitations by stable slot (event + guest + scope). Same event
 * with different guests keeps distinct slots; duplicate reads of the same
 * slot collapse to one without losing venue detail. Name equality never
 * forms a key.
 */
export function coalesceInvitationsBySlot(
  entries: readonly CoalescableInvitation[],
): InvitationEventSummary[] {
  const seen = new Map<string, InvitationEventSummary>();
  for (const entry of entries) {
    const stableSlot = entry.invitation.eventId === null
      ? `unkeyed:${seen.size}`
      : attendanceSlotKey(
        entry.invitation.eventId,
        entry.guestId,
        entry.accessScope ?? 'unknown',
      );
    // Exact duplicate reads of one stable slot collapse. Different source
    // facts for that same slot remain alternatives instead of overwriting
    // each other with a preferred-looking value.
    const key = `${stableSlot}:${JSON.stringify(entry.invitation)}`;
    if (!seen.has(key)) seen.set(key, entry.invitation);
  }
  return [...seen.values()];
}

/**
 * Join separately prepared authorization scopes without allowing a newly
 * granted scope to replace facts already read under another scope. This is
 * used when authentication is established after extraction (for example,
 * OTP verification): only the newly authorized roots are fetched, then both
 * profiles remain available to the reply.
 */
export function mergeCustomerContextSnapshots(
  base: CustomerContextSnapshot,
  additional: CustomerContextSnapshot,
): CustomerContextSnapshot {
  const scopes = [...new Set([
    ...base.identityAccess.authorizedScopes,
    ...additional.identityAccess.authorizedScopes,
  ])].sort();
  const identityScope = scopes.length > 1 ? scopes.join('+') : scopes[0] ?? null;
  const identityAccess: IdentityAccessSection = {
    ...mergeSectionBase(base.identityAccess, additional.identityAccess, true),
    section: 'identity_access',
    customerRef: additional.identityAccess.customerRef ?? base.identityAccess.customerRef,
    displayName: additional.identityAccess.displayName ?? base.identityAccess.displayName,
    email: additional.identityAccess.email ?? base.identityAccess.email,
    phone: additional.identityAccess.phone ?? base.identityAccess.phone,
    scope: identityScope,
    authorizedScopes: scopes,
    guestEventIds: [...new Set([
      ...base.identityAccess.guestEventIds,
      ...additional.identityAccess.guestEventIds,
    ])],
    hostEventIds: [...new Set([
      ...base.identityAccess.hostEventIds,
      ...additional.identityAccess.hostEventIds,
    ])],
  };
  const currentContext: CurrentContextSection = {
    ...mergeSectionBase(base.currentContext, additional.currentContext, false),
    section: 'current_context',
    relevantEventIds: [...new Set([
      ...base.currentContext.relevantEventIds,
      ...additional.currentContext.relevantEventIds,
    ])],
    relevantOrderIds: [...new Set([
      ...base.currentContext.relevantOrderIds,
      ...additional.currentContext.relevantOrderIds,
    ])],
    pendingQuestion: additional.currentContext.pendingQuestion ?? base.currentContext.pendingQuestion,
    unresolvedCandidateOrderIds: [...new Set([
      ...base.currentContext.unresolvedCandidateOrderIds,
      ...additional.currentContext.unresolvedCandidateOrderIds,
    ])],
    unresolvedCandidateEventIds: [...new Set([
      ...base.currentContext.unresolvedCandidateEventIds,
      ...additional.currentContext.unresolvedCandidateEventIds,
    ])],
  };
  const purchases = coalescePurchasesByStableId([
    ...base.purchasesCarts.purchases,
    ...additional.purchasesCarts.purchases,
  ].map((purchase) => ({ purchase, accessMethod: purchase.accessScope ?? null })));
  const carts = mergeDistinctRecords(
    base.purchasesCarts.carts,
    additional.purchasesCarts.carts,
    (cart) => `${cart.cartId}:${cart.accessScope ?? 'unknown'}`,
  );
  const purchaseCoverage = mergeDistinctRecords(
    base.purchasesCarts.sourceCoverage ?? [],
    additional.purchasesCarts.sourceCoverage ?? [],
    (coverage) => `${coverage.source}:${coverage.childId}:${JSON.stringify(coverage)}`,
  );
  const purchasesCarts: PurchasesCartsSection = {
    ...mergeSectionBase(base.purchasesCarts, additional.purchasesCarts, purchases.length + carts.length > 0),
    section: 'purchases_carts',
    purchases,
    carts,
    ...(purchaseCoverage.length > 0 ? { sourceCoverage: purchaseCoverage } : {}),
  };
  const invitations = coalesceInvitationsBySlot([
    ...base.invitationsEvents.invitations.map((invitation) => ({
      invitation,
      guestId: invitation.guestId,
      accessScope: invitation.accessScope ?? base.invitationsEvents.scope,
    })),
    ...additional.invitationsEvents.invitations.map((invitation) => ({
      invitation,
      guestId: invitation.guestId,
      accessScope: invitation.accessScope ?? additional.invitationsEvents.scope,
    })),
  ]);
  const invitationsEvents: InvitationsEventsSection = {
    ...mergeSectionBase(base.invitationsEvents, additional.invitationsEvents, invitations.length > 0),
    section: 'invitations_events',
    invitations,
  };
  const outcomes = mergeDistinctRecords(
    base.actionOutcomes.outcomes,
    additional.actionOutcomes.outcomes,
    (outcome) => outcome.dedupeKey ?? `${outcome.operation}:${outcome.target}:${outcome.observedAt}`,
  );
  const actionOutcomes: ActionOutcomesSection = {
    ...mergeSectionBase(base.actionOutcomes, additional.actionOutcomes, outcomes.length > 0),
    section: 'action_outcomes',
    outcomes,
  };
  const readMetrics = mergeReadMetrics(base.readMetrics, additional.readMetrics);
  return {
    identityAccess,
    currentContext,
    purchasesCarts,
    invitationsEvents,
    actionOutcomes,
    timingsMs: { ...base.timingsMs, ...additional.timingsMs },
    ...(readMetrics ? { readMetrics } : {}),
  };
}

function mergeDistinctRecords<T>(
  left: readonly T[],
  right: readonly T[],
  identity: (record: T) => string,
): T[] {
  const records = new Map<string, T[]>();
  for (const record of [...left, ...right]) {
    const key = identity(record);
    const bucket = records.get(key) ?? [];
    if (!bucket.some((known) => JSON.stringify(known) === JSON.stringify(record))) {
      bucket.push(record);
    }
    records.set(key, bucket);
  }
  return [...records.values()].flat();
}

function mergeSectionBase<T extends CustomerSectionBase>(
  base: T,
  additional: T,
  factsAvailable: boolean,
): CustomerSectionBase {
  const statuses = [base.status, additional.status].filter((status) => status !== 'not_requested');
  const status = worstStatus(statuses);
  const paginationExhausted = base.paginationExhausted === false || additional.paginationExhausted === false
    ? false
    : base.paginationExhausted === true && additional.paginationExhausted === true
      ? true
      : null;
  const hasFailedSource = statuses.includes('failed') || statuses.includes('unavailable');
  const incomplete = base.completeness === 'partial' ||
    additional.completeness === 'partial' ||
    paginationExhausted === false ||
    (factsAvailable && hasFailedSource);
  const completeness: CustomerSectionBase['completeness'] = incomplete
    ? 'partial'
    : base.completeness === additional.completeness
      ? base.completeness
      : null;
  const sources = [...new Set([base.source, additional.source].filter((source): source is string => source !== null))];
  const scopes = [...new Set([base.scope, additional.scope].filter((scope): scope is string => scope !== null))];
  const historyLimits = [...new Set([base.historyLimit, additional.historyLimit].filter((limit): limit is string => limit !== null))];
  return {
    status,
    source: sources.length > 0 ? sources.join('+') : null,
    fetchedAt: [base.fetchedAt, additional.fetchedAt].filter((value): value is string => value !== null).sort().at(-1) ?? null,
    scope: scopes.length > 0 ? scopes.join('+') : null,
    completeness,
    paginationExhausted,
    historyLimit: historyLimits.length > 0 ? historyLimits.join('+') : null,
  };
}

function mergeReadMetrics(
  base: CustomerReadMetrics | undefined,
  additional: CustomerReadMetrics | undefined,
): CustomerReadMetrics | undefined {
  if (!base && !additional) return undefined;
  const readsByOperation: Record<string, number> = {};
  for (const metrics of [base, additional]) {
    for (const [operation, count] of Object.entries(metrics?.readsByOperation ?? {})) {
      readsByOperation[operation] = (readsByOperation[operation] ?? 0) + count;
    }
  }
  return {
    totalReads: (base?.totalReads ?? 0) + (additional?.totalReads ?? 0),
    peakConcurrency: Math.max(base?.peakConcurrency ?? 0, additional?.peakConcurrency ?? 0),
    readsByOperation,
  };
}

/**
 * Enrich an entry snapshot with a fresh execution without erasing known
 * data. Ready sections merge (coalesced by stable id + scope); failed or
 * unavailable routes preserve the base section and its provenance/fetchedAt.
 * Bounds keep partial completeness, never exhaustive claims.
 */
export function mergeExecutionIntoSnapshot(args: {
  readonly base: CustomerContextSnapshot;
  readonly execution: CustomerExecution | null;
  readonly identity: IdentityEvidence | null;
  readonly currentContext: CurrentContextEvidence | null;
  readonly nowIso: string;
}): CustomerContextSnapshot {
  if (!args.execution) {
    return args.base;
  }
  const fresh = assembleCustomerContext({
    execution: args.execution,
    identity: args.identity ?? {
      customerRef: args.base.identityAccess.customerRef,
      scope: args.base.identityAccess.scope,
      source: args.base.identityAccess.source,
      fetchedAt: args.base.identityAccess.fetchedAt,
    },
    currentContext: args.currentContext ?? {
      relevantEventIds: [...args.base.currentContext.relevantEventIds],
      relevantOrderIds: [...args.base.currentContext.relevantOrderIds],
      pendingQuestion: args.base.currentContext.pendingQuestion,
      unresolvedCandidateOrderIds: [...args.base.currentContext.unresolvedCandidateOrderIds],
      unresolvedCandidateEventIds: [...args.base.currentContext.unresolvedCandidateEventIds],
    },
    nowIso: args.nowIso,
  });
  const keepPurchases = fresh.purchasesCarts.status === 'failed' ||
    fresh.purchasesCarts.status === 'unavailable' ||
    fresh.purchasesCarts.status === 'not_requested' ||
    (fresh.purchasesCarts.status === 'not_found' && args.base.purchasesCarts.status === 'ready')
    ? args.base.purchasesCarts
    : fresh.purchasesCarts;
  const keepInvitations = fresh.invitationsEvents.status === 'failed' ||
    fresh.invitationsEvents.status === 'unavailable' ||
    fresh.invitationsEvents.status === 'not_requested' ||
    (fresh.invitationsEvents.status === 'not_found' && args.base.invitationsEvents.status === 'ready')
    ? args.base.invitationsEvents
    : fresh.invitationsEvents;
  return {
    identityAccess: args.base.identityAccess.status === 'ready'
      ? args.base.identityAccess
      : fresh.identityAccess,
    currentContext: fresh.currentContext.status === 'ready'
      ? fresh.currentContext
      : args.base.currentContext,
    purchasesCarts: keepPurchases,
    invitationsEvents: keepInvitations,
    actionOutcomes: fresh.actionOutcomes.status === 'ready'
      ? fresh.actionOutcomes
      : args.base.actionOutcomes,
    timingsMs: { ...args.base.timingsMs, ...fresh.timingsMs },
    ...(args.base.readMetrics ? { readMetrics: args.base.readMetrics } : {}),
  };
}

/**
 * Signed URLs are credentials in logs/traces: keep the host plus byte
 * counts, never path, query, fragment or raw links.
 */
export function redactSnapshotForLog(snapshot: CustomerContextSnapshot): Record<string, unknown> {
  return {
    identityAccess: {
      status: snapshot.identityAccess.status,
      scope: snapshot.identityAccess.scope,
      hasCustomerRef: snapshot.identityAccess.customerRef !== null,
      guestEventCount: snapshot.identityAccess.guestEventIds.length,
      hostEventCount: snapshot.identityAccess.hostEventIds.length,
    },
    currentContext: {
      status: snapshot.currentContext.status,
      relevantEventCount: snapshot.currentContext.relevantEventIds.length,
      relevantOrderCount: snapshot.currentContext.relevantOrderIds.length,
      hasPendingQuestion: snapshot.currentContext.pendingQuestion !== null,
    },
    purchasesCarts: {
      status: snapshot.purchasesCarts.status,
      purchaseCount: snapshot.purchasesCarts.purchases.length,
      cartCount: snapshot.purchasesCarts.carts.length,
    },
    invitationsEvents: {
      status: snapshot.invitationsEvents.status,
      invitationCount: snapshot.invitationsEvents.invitations.length,
    },
    actionOutcomes: {
      status: snapshot.actionOutcomes.status,
      outcomeCount: snapshot.actionOutcomes.outcomes.length,
      receipts: snapshot.actionOutcomes.outcomes.map((outcome) => outcome.receipt),
    },
    timings: { ...snapshot.timingsMs },
  };
}

export function redactCustomerUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/...[redacted]`;
  } catch {
    return '[invalid-url]';
  }
}
