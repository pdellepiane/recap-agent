import type {
  CartInformation,
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseInformation,
} from '../core/information';
import {
  enrichmentBounds,
  enrichmentVisitKey,
} from '../core/information';
import { eventMatches } from './event-matching';

/**
 * L4 Customer operations context assembly.
 *
 * One typed snapshot built from authorized backend reads when entering
 * Customer operations. Independent reads overlap (the orchestrator runs
 * them through Promise.allSettled); each section carries its own load
 * status so an unrelated slow or failed optional lookup never blocks a
 * ready answer, while a failed required section stays visible as
 * unavailable/failed. Only common references plus question-relevant detail
 * are projected to the model; the runtime snapshot may hold more fetched
 * data than the model ever sees.
 */

export const customerSectionStatusValues = [
  'not_requested',
  'loading',
  'ready',
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

export type PurchaseCartSummary = {
  readonly orderId: string;
  readonly eventId: number | string | null;
  readonly eventName: string | null;
  readonly paymentStatus: string | null;
  readonly grandTotal: number | null;
};

export type PurchasesCartsSection = CustomerSectionBase & {
  readonly section: 'purchases_carts';
  readonly purchases: readonly PurchaseCartSummary[];
  readonly carts: readonly CartInformation[];
  /** Full records stay runtime-only; only matched records project detail. */
  readonly detailedPurchases: readonly PurchaseInformation[];
};

export type InvitationEventSummary = {
  readonly eventId: number | string | null;
  readonly eventName: string | null;
  readonly role: 'guest' | 'host' | 'owner' | null;
  readonly rsvpState: 'pending' | 'attending' | 'declining' | 'unknown';
  /**
   * P3 fact parity: server event datetime (date + hour when the backend
   * provides time). Sparse: present only when the completed result reports
   * it, so event-fact answers read date/hour from the profile instead of a
   * second facts payload.
   */
  readonly eventDatetime?: string;
  readonly address: CustomerAddress | null;
};

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

/**
 * Venue parity: resolved moment locationDescription/locationReference maps
 * into the existing CustomerAddress.street. Moments are position-ordered; a
 * single venue moment keeps the plain `description, reference` form while
 * multiple venue moments keep labels (`first; Label: parts`) so ceremony
 * and reception never mix. One mapping, no new field, single serialization.
 * Nothing invented: null when no moment carries venue, country never used
 * as street.
 */
function resolveVenueStreet(event: {
  readonly detail?: {
    readonly moments?: readonly {
      readonly label?: string | null;
      readonly locationDescription?: string | null;
      readonly locationReference?: string | null;
      readonly position?: number | null;
    }[] | null;
  } | null;
}): string | null {
  const moments = event.detail?.moments ?? [];
  const ordered = [...moments].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const venueMoments = ordered.filter(
    (moment) =>
      (moment.locationDescription?.trim() ?? '') !== '' ||
      (moment.locationReference?.trim() ?? '') !== '',
  );
  if (venueMoments.length === 0) return null;
  const venueParts = (moment: (typeof venueMoments)[number]): string | null => {
    const parts = [
      moment.locationDescription?.trim() || null,
      moment.locationReference?.trim() || null,
    ].filter((part): part is string => part !== null && part !== '');
    if (parts.length === 0) return null;
    return parts.join(', ');
  };
  const firstMoment = venueMoments[0];
  if (firstMoment === undefined) return null;
  const first = venueParts(firstMoment);
  if (first === null) return null;
  if (venueMoments.length === 1) return first;
  const labeled = venueMoments.slice(1).map((moment) => {
    const parts = venueParts(moment);
    if (parts === null) return null;
    const label = moment.label?.trim() ? moment.label.trim() : null;
    return label !== null ? `${label}: ${parts}` : parts;
  }).filter((entry): entry is string => entry !== null);
  return labeled.length > 0 ? `${first}; ${labeled.join('; ')}` : first;
}

export type CustomerContextSnapshot = {
  readonly identityAccess: IdentityAccessSection;
  readonly currentContext: CurrentContextSection;
  readonly purchasesCarts: PurchasesCartsSection;
  readonly invitationsEvents: InvitationsEventsSection;
  readonly actionOutcomes: ActionOutcomesSection;
  readonly timingsMs: Readonly<Record<string, number>>;
};

export type IdentityEvidence = {
  /** Backend customer reference (id, token hash, phone E.164). Never a name. */
  readonly customerRef: string | null;
  readonly displayName?: string | null;
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

function statusForResult(
  result: InformationTaskResult | undefined,
  summary: InformationExecutionSummary | undefined,
): { status: CustomerSectionStatus; completeness: CustomerSectionBase['completeness'] } {
  if (!result || !summary) {
    return { status: 'not_requested', completeness: null };
  }
  if (result.status === 'completed') {
    if (summary.outcomeCode === 'completed_without_results') {
      return { status: 'not_found', completeness: null };
    }
    return {
      status: 'ready',
      completeness: summary.coverage === 'partial' || summary.coverage === 'inconsistent'
        ? 'partial'
        : 'complete',
    };
  }
  if (result.status === 'needs_input') {
    return { status: 'unavailable', completeness: null };
  }
  if (
    result.status === 'failed' &&
    result.failureKind === 'not_found' &&
    result.accessMethod !== undefined
  ) {
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
  const purchaseSummaries = purchaseResults.map((result) => summaryById.get(result.requestId));
  const eventSummaries = eventResults.map((result) => summaryById.get(result.requestId));

  const identityAccess: IdentityAccessSection = args.identity?.customerRef
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
      displayName: args.identity.displayName ?? null,
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
  // P1 canonical coalesce: duplicate route results for the same stable
  // orderId + compatible access scope merge without detail loss; cross-scope
  // duplicates stay explicit so cached broader access never masquerades as
  // current authorization. Failed routes contribute nothing here, so known
  // data assembled elsewhere is never erased by a failure.
  const coalescedDetailed = coalescePurchasesByStableId(
    purchaseResults.flatMap((result) =>
      result.status === 'completed'
        ? result.purchases.map((purchase) => ({
          purchase,
          accessMethod: result.accessMethod ?? null,
        }))
        : [],
    ),
  );
  const purchasesCarts: PurchasesCartsSection = purchaseResults.length === 0
    ? {
      section: 'purchases_carts',
      ...emptyBase(),
      purchases: [],
      carts: [],
      detailedPurchases: [],
    }
    : {
      section: 'purchases_carts',
      status: purchaseStatuses.some((entry) => entry.status === 'ready')
        ? 'ready'
        : worstStatus(purchaseStatuses.map((entry) => entry.status)),
      source: purchaseResults.length > 0 ? 'agent_api' : null,
      fetchedAt: args.nowIso,
      scope: args.identity?.scope ?? null,
      completeness: purchasePagination.paginationExhausted === false ||
        purchaseStatuses.some((entry) => entry.completeness === 'partial') ||
        (purchaseStatuses.some((entry) => entry.status === 'ready') &&
          purchaseStatuses.some((entry) => entry.status === 'failed' || entry.status === 'unavailable'))
        ? 'partial'
        : 'complete',
      paginationExhausted: purchasePagination.paginationExhausted,
      historyLimit: purchasePagination.historyLimit,
      purchases: coalescedDetailed.map((purchase) => ({
        orderId: purchase.orderId,
        eventId: purchase.eventId ?? null,
        eventName: purchase.eventName ?? null,
        paymentStatus: purchase.paymentStatus,
        grandTotal: purchase.grandTotal,
      })),
      carts: purchaseResults.flatMap((result) =>
        result.status === 'completed' ? (result.carts ?? []) : [],
      ),
      detailedPurchases: coalescedDetailed,
    };

  const eventStatuses = eventResults.map((result, index) =>
    statusForResult(result, eventSummaries[index]),
  );
  const eventPagination = paginationFor(eventSummaries);
  // P1 slot coalesce: stable (event + guest + scope) slots collapse
  // duplicate reads; same event with different guests keeps distinct slots.
  // Names never form a key, so cross-route name equality is not identity.
  const coalescedInvitations = coalesceInvitationsBySlot(
    eventResults.flatMap((result) =>
      result.status === 'completed'
        ? result.result.events.flatMap((event) => {
          if (event.eventId === null || event.eventId === undefined) return [];
          const invitation: InvitationEventSummary = {
            eventId: event.eventId,
            eventName: event.name,
            role: event.relation === 'guest' || event.relation === 'host' || event.relation === 'owner'
              ? event.relation
              : null,
            rsvpState: event.guestStatus === null || event.guestStatus === undefined
              ? 'unknown'
              : !event.guestStatus.hasResponded
                ? 'pending'
                : event.guestStatus.willAttend === true
                  ? 'attending'
                  : event.guestStatus.willAttend === false
                    ? 'declining'
                    : 'unknown',
            ...(event.datetime ? { eventDatetime: event.datetime } : {}),
            address: classifyAddress({
              kind: 'venue',
              source: 'event_detail',
              street: resolveVenueStreet(event),
              city: event.place,
              country: event.country,
            }),
          };
          return [{
            invitation,
            guestId: event.guestId ?? null,
            accessScope: result.accessMethod ?? args.identity?.scope ?? null,
          }];
        })
        : [],
    ),
  );
  const invitationsEvents: InvitationsEventsSection = eventResults.length === 0
    ? {
      section: 'invitations_events',
      ...emptyBase(),
      invitations: [],
    }
    : {
      section: 'invitations_events',
      status: eventStatuses.some((entry) => entry.status === 'ready')
        ? 'ready'
        : worstStatus(eventStatuses.map((entry) => entry.status)),
      source: 'agent_api',
      fetchedAt: args.nowIso,
      scope: args.identity?.scope ?? null,
      completeness: eventPagination.paginationExhausted === false ||
        (eventStatuses.some((entry) => entry.status === 'ready') &&
          eventStatuses.some((entry) => entry.status === 'failed' || entry.status === 'unavailable'))
        ? 'partial' : 'complete',
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
  if (statuses.every((status) => status === 'not_found')) {
    return 'not_found';
  }
  if (statuses.some((status) => status === 'ready')) {
    return 'ready';
  }
  return 'not_found';
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
    return status === 'ready' || status === 'not_found';
  });
}

export type CustomerProjectionFocus =
  | 'payment'
  | 'cart'
  | 'rsvp'
  | 'general';

export type CustomerProjectionQuery = {
  readonly focus: CustomerProjectionFocus;
  readonly relevantOrderIds?: readonly string[];
  readonly relevantEventIds?: readonly (number | string)[];
};

/**
 * S7 bounded-enrichment provenance. Records the linked-detail reads performed
 * before final owner composition (order -> gift detail, invitation/event ->
 * event detail) within the two-edge/four-read/deadline bound. Required
 * unavailable detail stays explicitly listed here so the reply stays honest;
 * optional failures never block ready facts. Single-copy, access-scoped.
 */
export type CustomerEnrichmentSummary = {
  readonly readsAttempted: number;
  readonly truncatedByBound: boolean;
  readonly unavailable: readonly string[];
  readonly failures: readonly { readonly target: string; readonly failureKind: string }[];
};

export type CustomerContextProjection = {
  readonly commonRefs: {
    readonly orderIds: readonly string[];
    readonly eventIds: readonly (number | string)[];
    readonly pendingQuestion: string | null;
  };
  /**
   * P3 compact candidate index. One lightweight summary per known
   * candidate (all authorized orders + invitations in stable snapshot
   * order), carrying only identifiers, names, dates and record state —
   * never amounts or venue detail. Full authorized detail for the
   * resolved/relevant records travels in purchases/detailedPurchases/
   * invitations below, so the model sees every candidate once without a
   * second facts payload. Null fields are omitted so noise never grows.
   */
  readonly candidates: readonly CompactCandidateSummary[];
  /**
   * P3 section availability. Retains the authoritative load state behind
   * the projection (ready, not_found, unavailable, failed, partial via
   * completeness) so "no other records" is never inferred from an
   * unrequested or failed source.
   */
  readonly sections: {
    readonly purchasesCarts: CustomerSectionStatus;
    readonly invitationsEvents: CustomerSectionStatus;
  };
  readonly purchases: readonly PurchaseCartSummary[];
  /** Carts are retained for later cart questions but excluded from payment focus. */
  readonly carts: readonly CartInformation[];
  readonly detailedPurchases: readonly PurchaseInformation[];
  readonly invitations: readonly InvitationEventSummary[];
  readonly actionOutcomes: readonly ActionOutcome[];
  /** Null/absent when no linked-detail enrichment ran on this turn. */
  readonly enrichment?: CustomerEnrichmentSummary | null;
};

/**
 * P3 compact candidate summary. Stable field order
 * (kind, orderId/eventId, eventName, eventDate, state); only set fields
 * are emitted so duplicate/null-value noise stays out of model input.
 * Amounts, venue detail and provenance travel only with the resolved
 * record detail, never here.
 */
export type CompactCandidateSummary = {
  readonly kind: 'order' | 'event';
  readonly orderId?: string;
  readonly eventId?: number | string;
  readonly eventName?: string;
  readonly eventDate?: string;
  readonly state?: string;
};

/**
 * P3 compact candidate index over the retained snapshot. Every known
 * authorized purchase and invitation appears once with identifiers, names,
 * dates and record state only (stable snapshot order, nulls omitted, no
 * amounts, no venue detail, no provenance). Full detail for the resolved
 * or relevant records is projected separately, so facts are serialized
 * once. No date cutoff: historical candidates stay listed.
 */
export function buildCompactCandidateSummaries(
  snapshot: CustomerContextSnapshot,
): CompactCandidateSummary[] {
  const candidates: CompactCandidateSummary[] = [];
  if (
    snapshot.purchasesCarts.status === 'ready' ||
    snapshot.purchasesCarts.status === 'not_found'
  ) {
    const detailByOrderId = new Map(
      snapshot.purchasesCarts.detailedPurchases.map((purchase) => [purchase.orderId, purchase] as const),
    );
    for (const purchase of snapshot.purchasesCarts.purchases) {
      const detail = detailByOrderId.get(purchase.orderId);
      const eventDate = detail?.eventDate ?? detail?.createdAt ?? null;
      candidates.push({
        kind: 'order',
        ...(purchase.orderId.trim().length > 0 ? { orderId: purchase.orderId } : {}),
        ...(purchase.eventName !== null && purchase.eventName.trim().length > 0
          ? { eventName: purchase.eventName }
          : {}),
        ...(eventDate ? { eventDate } : {}),
        ...(purchase.paymentStatus !== null && purchase.paymentStatus.trim().length > 0
          ? { state: purchase.paymentStatus }
          : {}),
      });
    }
  }
  if (
    snapshot.invitationsEvents.status === 'ready' ||
    snapshot.invitationsEvents.status === 'not_found'
  ) {
    for (const invitation of snapshot.invitationsEvents.invitations) {
      candidates.push({
        kind: 'event',
        ...(invitation.eventId !== null ? { eventId: invitation.eventId } : {}),
        ...(invitation.eventName !== null && invitation.eventName.trim().length > 0
          ? { eventName: invitation.eventName }
          : {}),
        ...(invitation.eventDatetime ? { eventDate: invitation.eventDatetime } : {}),
        ...(invitation.rsvpState !== 'unknown' ? { state: invitation.rsvpState } : {}),
      });
    }
  }
  return candidates;
}

/**
 * Minimum-disclosure projection: common references plus only the
 * question-relevant detail. Inactive sections stay absent. A payment
 * question never receives cart facts; a cart question never receives
 * payment details. No automatic first-record selection: without an
 * explicit target, candidates stay unresolved in current context.
 */
export function projectCustomerContext(
  snapshot: CustomerContextSnapshot,
  query: CustomerProjectionQuery,
  enrichment?: CustomerEnrichmentSummary | null,
): CustomerContextProjection {
  const relevantOrderIds = new Set(query.relevantOrderIds ?? []);
  const relevantEventIds = new Set(
    (query.relevantEventIds ?? []).map((id) => String(id)),
  );
  const hasTarget = relevantOrderIds.size > 0 || relevantEventIds.size > 0;

  const matchingPurchases = hasTarget
    ? snapshot.purchasesCarts.purchases.filter((purchase) =>
      relevantOrderIds.has(purchase.orderId),
    )
    : [];
  const matchingDetailed = hasTarget
    ? snapshot.purchasesCarts.detailedPurchases.filter((purchase) =>
      relevantOrderIds.has(purchase.orderId),
    )
    : [];
  const matchingInvitations = hasTarget
    ? snapshot.invitationsEvents.invitations.filter((invitation) =>
      invitation.eventId !== null && relevantEventIds.has(String(invitation.eventId)),
    )
    : [];

  const includePurchases = query.focus === 'payment' || query.focus === 'general';
  const includeCarts = query.focus === 'cart' || query.focus === 'general';
  const includeInvitations = query.focus === 'rsvp' || query.focus === 'general';

  const projectedInvitations = snapshot.invitationsEvents.status === 'ready' && includeInvitations
    ? matchingInvitations
    : [];
  // Attendance claims belong to the RSVP lane: outside an RSVP-focused
  // turn the projection keeps invitation identity (names, venues) but
  // withholds attendance state, so event-fact or thanks turns cannot
  // manufacture an unrequested attendance claim from a pending record.
  const invitations = query.focus === 'rsvp'
    ? projectedInvitations
    : projectedInvitations.map((invitation) => ({ ...invitation, rsvpState: 'unknown' as const }));

  // S2: internal transaction references never reach model-visible detail.
  // The runtime snapshot keeps the authorized record; the projection the
  // model reads carries no customerTransactionNumber, so a denied
  // transaction-reference disclosure cannot leak through model input.
  const modelVisibleDetailed = snapshot.purchasesCarts.status === 'ready' && includePurchases
    ? matchingDetailed.map(stripTransactionIdForModel)
    : [];

  return {
    commonRefs: {
      orderIds: snapshot.purchasesCarts.purchases.map((purchase) => purchase.orderId),
      eventIds: snapshot.invitationsEvents.invitations.flatMap((invitation) =>
        invitation.eventId === null ? [] : [invitation.eventId],
      ),
      pendingQuestion: snapshot.currentContext.pendingQuestion,
    },
    // P3: compact summaries of ALL candidates in stable snapshot order
    // (identifiers + names/dates/state only, nulls omitted, no amounts),
    // while purchases/detailedPurchases/invitations below keep only the
    // resolved/relevant full detail. Section availability is retained so
    // exhaustion is never claimed from an unrequested/failed source.
    candidates: buildCompactCandidateSummaries(snapshot),
    sections: {
      purchasesCarts: snapshot.purchasesCarts.status,
      invitationsEvents: snapshot.invitationsEvents.status,
    },
    purchases: snapshot.purchasesCarts.status === 'ready' && includePurchases
      ? matchingPurchases
      : [],
    carts: snapshot.purchasesCarts.status === 'ready' && includeCarts
      ? snapshot.purchasesCarts.carts
      : [],
    detailedPurchases: modelVisibleDetailed,
    invitations: snapshot.invitationsEvents.status === 'ready' && includeInvitations
      ? invitations
      : [],
    actionOutcomes: snapshot.actionOutcomes.status === 'ready'
      ? [...snapshot.actionOutcomes.outcomes]
      : [],
    enrichment: enrichment ?? null,
  };
}

/**
 * S2 model-visible transaction strip. The runtime snapshot retains the
 * authorized backend record; the projected copy the model reads never
 * carries customerTransactionNumber. Pure copy, single-copy sparse.
 */
export function stripTransactionIdForModel(purchase: PurchaseInformation): PurchaseInformation {
  if (purchase.customerTransactionNumber == null) return purchase;
  return { ...purchase, customerTransactionNumber: null };
}

/**
 * S7 bounded target selection for linked-detail enrichment. Only explicitly
 * relevant IDs that are also already known through authorized reads qualify:
 * a name or recency never authorizes a lookup. Ambiguous turns (no explicit
 * relevant ID) enrich nothing so the pending newest order is never
 * auto-selected. Fewer than the bound keeps every candidate discoverable;
 * beyond four reads the remainder stays discoverable through the same owner
 * later. No date cutoff: an explicit years-old target is retained. IDs whose
 * completed result already carries gift/event detail in this turn are
 * excluded so the same read is never re-issued.
 */
export function selectEnrichmentTargets(args: {
  readonly knownOrderIds: readonly string[];
  readonly knownEventIds: readonly (number | string)[];
  readonly relevantOrderIds: readonly string[];
  readonly relevantEventIds: readonly (number | string)[];
  /**
   * S7 same-turn reuse: IDs whose completed result already carries
   * gift/event detail (fetched through the detailed route earlier in this
   * turn) are excluded so enrichment never re-issues that read. Bounds,
   * old-target retention, no auto-select and no writes are unchanged.
   */
  readonly alreadyDetailedOrderIds?: readonly string[];
  readonly alreadyDetailedEventIds?: readonly (number | string)[];
}): { readonly orderIds: readonly string[]; readonly eventIds: readonly (number | string)[]; readonly truncatedByBound: boolean } {
  const knownOrders = new Set(args.knownOrderIds);
  const knownEvents = new Set(args.knownEventIds.map((id) => String(id)));
  const alreadyDetailedOrders = new Set(args.alreadyDetailedOrderIds ?? []);
  const alreadyDetailedEvents = new Set(
    (args.alreadyDetailedEventIds ?? []).map((id) => String(id)),
  );
  const explicitOrders = Array.from(new Set(args.relevantOrderIds)).filter((id) =>
    knownOrders.has(id) && !alreadyDetailedOrders.has(id),
  );
  const explicitEvents = Array.from(new Set(args.relevantEventIds.map((id) => String(id)))).filter(
    (id) => knownEvents.has(id) && !alreadyDetailedEvents.has(id),
  ).map((id) => args.relevantEventIds.find((original) => String(original) === id) ?? id);
  const combined: Array<{ kind: 'order' | 'event'; id: string | number }> = [
    ...explicitOrders.map((id) => ({ kind: 'order' as const, id })),
    ...explicitEvents.map((id) => ({ kind: 'event' as const, id })),
  ];
  const limited = combined.slice(0, enrichmentBounds.maxConcurrentReads);
  return {
    orderIds: limited.flatMap((entry) => entry.kind === 'order' ? [String(entry.id)] : []),
    eventIds: limited.flatMap((entry) => entry.kind === 'event' ? [entry.id] : []),
    truncatedByBound: combined.length > limited.length,
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
export type RankableCandidate = {
  readonly orderId: string;
  readonly eventName: string | null;
  readonly paymentStatus: string | null;
  readonly createdAt: string | null;
  readonly eventDate: string | null;
};

export type CandidateRelevanceSignals = {
  /** Explicit customer reference (order id or COD); authoritative when matched. */
  readonly explicitOrderId: string | null;
  /** Explicit event wording from the current turn; matched by name, never by age. */
  readonly explicitEventHint: string | null;
  readonly questionFocus: CustomerProjectionFocus;
};

/**
 * Semantic relevance ordering over the retained candidate index. Explicit
 * reference dominates, observed backend state informs, recency only breaks
 * ties: a years-old explicit target always outranks a newer pending order,
 * and a recent pending order plus voucher never proves identity on its own.
 * Nothing is dropped — every candidate stays retrievable for a focused read
 * or clarification, so there is no fixed newest-record choice and no hidden
 * old record. No keyword inference: the hint match reuses the shared event
 * name matcher and the focus arrives as typed extraction evidence.
 */
export function rankCandidatesByRelevance(
  candidates: readonly RankableCandidate[],
  signals: CandidateRelevanceSignals,
): RankableCandidate[] {
  const scored = candidates.map((candidate, index) => {
    let score = 0;
    if (
      signals.explicitOrderId !== null &&
      candidate.orderId === signals.explicitOrderId
    ) {
      score += 100;
    }
    if (
      signals.explicitEventHint !== null &&
      eventMatches(candidate.eventName, signals.explicitEventHint)
    ) {
      score += 50;
    }
    if (
      (signals.questionFocus === 'payment' || signals.questionFocus === 'general') &&
      candidate.paymentStatus?.trim().toLocaleLowerCase('en') === 'pending'
    ) {
      score += 10;
    }
    return { candidate, score, index };
  });
  return scored
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftTime = rankableTime(candidateTime(left.candidate));
      const rightTime = rankableTime(candidateTime(right.candidate));
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.candidate);
}

function candidateTime(candidate: RankableCandidate): string | null {
  return candidate.createdAt ?? candidate.eventDate;
}

function rankableTime(value: string | null): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
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
        detailedPurchases: [],
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
  if (left == null || right == null) return left === right;
  if (left === right) return true;
  const phoneFamily = new Set(['trusted_phone_purchase', 'trusted_phone_event_purchase']);
  return phoneFamily.has(left) && phoneFamily.has(right);
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
  const byOrderId = new Map<string, PurchaseInformation[]>();
  const scopeByOrderId = new Map<string, string | null>();
  const deferred: PurchaseInformation[] = [];
  for (const entry of entries) {
    const bucket = byOrderId.get(entry.purchase.orderId);
    if (!bucket) {
      byOrderId.set(entry.purchase.orderId, [entry.purchase]);
      scopeByOrderId.set(entry.purchase.orderId, entry.accessMethod);
      continue;
    }
    const bucketScope = scopeByOrderId.get(entry.purchase.orderId) ?? null;
    if (!purchaseScopesCompatible(bucketScope, entry.accessMethod)) {
      deferred.push(entry.purchase);
      continue;
    }
    bucket.push(entry.purchase);
  }
  const merged: PurchaseInformation[] = [];
  for (const group of byOrderId.values()) {
    const base = group[0];
    if (!base || group.length === 1) {
      if (base) merged.push(base);
      continue;
    }
    let canonical: PurchaseInformation = { ...base, items: [...base.items] };
    for (const incoming of group.slice(1)) {
      canonical = mergeTwoPurchases(canonical, incoming);
    }
    merged.push(canonical);
  }
  merged.push(...deferred);
  return merged;
}

function mergeTwoPurchases(
  current: PurchaseInformation,
  incoming: PurchaseInformation,
): PurchaseInformation {
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
    items: current.items.length > 0 ? current.items : incoming.items,
    payment: current.payment ?? incoming.payment,
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
  if (merged.paymentStatus === null || merged.grandTotal === null) {
    merged.amountDisclosure = null;
  }
  return merged;
}

type CoalescableInvitation = {
  readonly invitation: InvitationEventSummary;
  readonly guestId: number | string | null;
  readonly accessScope: string | null;
};

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
    if (entry.invitation.eventId === null) {
      continue;
    }
    const key = attendanceSlotKey(
      entry.invitation.eventId,
      entry.guestId,
      entry.accessScope ?? 'unknown',
    );
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, entry.invitation);
      continue;
    }
    const mergedDatetime = existing.eventDatetime ?? entry.invitation.eventDatetime;
    seen.set(key, {
      ...existing,
      ...(mergedDatetime ? { eventDatetime: mergedDatetime } : {}),
      address: existing.address ?? entry.invitation.address,
      rsvpState: existing.rsvpState !== 'unknown'
        ? existing.rsvpState
        : entry.invitation.rsvpState,
    });
  }
  return [...seen.values()];
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
