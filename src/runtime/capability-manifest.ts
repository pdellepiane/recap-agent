/**
 * The complete operation surface known by the runtime. Keep this list stable:
 * traces, capability projections, and evaluation fixtures use these ids.
 */
export const runtimeOperationIds = [
  'conversation.log.write',
  'conversation.history.read',
  'human.takeover.write',
  'faq.read',
  'event.association.read',
  'event.detail.read',
  'purchase.orders.read',
  'purchase.gifts.read',
  'purchase.status.read',
  'purchase.details.read',
  'account.phone.authenticate',
  'account.phone.update',
  'rsvp.write',
  'provider.catalog.read',
  'provider.search.read',
  'provider.detail.read',
  'provider.related.read',
  'provider.reviews.read',
  'provider.event-context.read',
  'provider.favorites.read',
  'provider.quote.write',
  'provider.favorite.write',
  'provider.review.write',
  'plan.finish.write',
] as const;

export type RuntimeOperationId = (typeof runtimeOperationIds)[number];

/** Maps concrete provider-tool names to the semantic capability they use. */
export const runtimeToolOperationMap = {
  list_categories: 'provider.catalog.read',
  get_category_by_slug: 'provider.catalog.read',
  list_locations: 'provider.catalog.read',
  search_providers_from_plan: 'provider.search.read',
  search_providers_by_keyword: 'provider.search.read',
  search_providers_by_category_location: 'provider.search.read',
  search_providers_by_query_intent: 'provider.search.read',
  get_relevant_providers: 'provider.search.read',
  get_provider_detail: 'provider.detail.read',
  get_provider_detail_and_track_view: 'provider.detail.read',
  get_related_providers: 'provider.related.read',
  list_provider_reviews: 'provider.reviews.read',
  get_event_vendor_context: 'provider.event-context.read',
  list_event_favorite_providers: 'provider.favorites.read',
  list_user_events_vendor_context: 'provider.event-context.read',
  create_quote_request: 'provider.quote.write',
  add_vendor_to_event_favorites: 'provider.favorite.write',
  create_provider_review: 'provider.review.write',
  finish_plan: 'plan.finish.write',
} as const satisfies Record<string, RuntimeOperationId>;

export type RuntimeToolName = keyof typeof runtimeToolOperationMap;

export const runtimeGatewayOperationMap = {
  logMessage: 'conversation.log.write',
  getRecentMessages: 'conversation.history.read',
  requestHumanTakeover: 'human.takeover.write',
  getOrders: 'purchase.orders.read',
  getGiftPurchases: 'purchase.gifts.read',
  getGuestOrdersByPhone: 'purchase.orders.read',
  getGuestGiftPurchasesByPhone: 'purchase.gifts.read',
  authByPhone: 'account.phone.authenticate',
  getGuestEventsByPhone: 'event.association.read',
  getEventDetail: 'event.detail.read',
  updatePhone: 'account.phone.update',
  guestRsvp: 'rsvp.write',
} as const satisfies Record<string, RuntimeOperationId>;

export const runtimeCapabilityAvailabilityReasonValues = [
  'available',
  'not_configured',
  'disabled',
  'development_write_blocked',
  'fixture_only',
  'unsupported',
] as const;

export type RuntimeCapabilityAvailabilityReason =
  (typeof runtimeCapabilityAvailabilityReasonValues)[number];

export type RuntimeCapabilityDescriptor = {
  readonly operation: RuntimeOperationId;
  readonly available: boolean;
  readonly reason: RuntimeCapabilityAvailabilityReason;
};

export type RuntimeCapabilityManifest = Readonly<
  Record<RuntimeOperationId, RuntimeCapabilityDescriptor>
>;

export type RuntimeCapabilityManifestOptions = {
  /** Whether the backing gateway is configured and may be called. */
  configured?: boolean;
  /** Explicit deployment environment; omitted for test doubles. */
  environment?: 'development' | 'production';
  /** Customer mutations are denied by default in development. */
  allowCustomerWrites?: boolean;
  /** A fixture is an isolated backend and can expose test-only operations. */
  fixture?: boolean;
  disabledOperations?: readonly RuntimeOperationId[];
};

/** Operations that issue a customer-visible or durable mutation. */
export const runtimeWriteOperationIds = [
  'conversation.log.write',
  'human.takeover.write',
  'account.phone.update',
  'rsvp.write',
  'provider.quote.write',
  'provider.favorite.write',
  'provider.review.write',
  'plan.finish.write',
] as const satisfies readonly RuntimeOperationId[];

const writeOperations = new Set<RuntimeOperationId>(runtimeWriteOperationIds);

export function buildRuntimeCapabilityManifest(
  options: RuntimeCapabilityManifestOptions = {},
): RuntimeCapabilityManifest {
  const configured = options.configured ?? true;
  const disabled = new Set(options.disabledOperations ?? []);
  const manifest = {} as Record<RuntimeOperationId, RuntimeCapabilityDescriptor>;

  for (const operation of runtimeOperationIds) {
    let available = configured;
    let reason: RuntimeCapabilityAvailabilityReason = configured
      ? 'available'
      : 'not_configured';

    if (disabled.has(operation)) {
      available = false;
      reason = 'disabled';
    } else if (
      available &&
      options.environment === 'development' &&
      writeOperations.has(operation) &&
      options.allowCustomerWrites !== true
    ) {
      available = false;
      reason = 'development_write_blocked';
    } else if (available && options.fixture === true) {
      reason = 'fixture_only';
    }

    manifest[operation] = { operation, available, reason };
  }

  return manifest;
}

export function isRuntimeOperationId(value: string): value is RuntimeOperationId {
  return (runtimeOperationIds as readonly string[]).includes(value);
}

export function capabilityForOperation(
  manifest: RuntimeCapabilityManifest,
  operation: RuntimeOperationId,
): RuntimeCapabilityDescriptor {
  return manifest[operation];
}

export type CapabilityDecision =
  | {
      readonly kind: 'supported';
      readonly operation: RuntimeOperationId;
    }
  | {
      readonly kind: 'unsupported';
      readonly operation: RuntimeOperationId | null;
      readonly reason: 'unavailable' | 'unsupported';
      readonly requiresHumanTakeover: true;
    }
  | {
      readonly kind: 'clarification';
      readonly topic: 'status' | 'document';
      readonly questionKey: 'ambiguous_status' | 'ambiguous_document';
      readonly requiresOneQuestion: true;
    };

export type RequestedOperation =
  | 'continue_support'
  | 'new_support_topic'
  | 'switch_to_planning'
  | 'switch_to_rsvp'
  | 'request_human_help'
  | 'clarify';

export function resolveCapabilityDecision(args: {
  requestedOperation: RequestedOperation | null | undefined;
  operation?: RuntimeOperationId | null;
  manifest: RuntimeCapabilityManifest;
  statusAmbiguous?: boolean;
  documentAmbiguous?: boolean;
}): CapabilityDecision {
  if (args.statusAmbiguous) {
    return {
      kind: 'clarification',
      topic: 'status',
      questionKey: 'ambiguous_status',
      requiresOneQuestion: true,
    };
  }
  if (args.documentAmbiguous) {
    return {
      kind: 'clarification',
      topic: 'document',
      questionKey: 'ambiguous_document',
      requiresOneQuestion: true,
    };
  }
  if (args.requestedOperation === 'clarify') {
    return {
      kind: 'clarification',
      topic: 'status',
      questionKey: 'ambiguous_status',
      requiresOneQuestion: true,
    };
  }

  const operation = args.operation ?? null;
  if (!operation) {
    return { kind: 'unsupported', operation: null, reason: 'unsupported', requiresHumanTakeover: true };
  }
  const descriptor = args.manifest[operation];
  if (descriptor?.available) {
    return { kind: 'supported', operation };
  }
  return {
    kind: 'unsupported',
    operation,
    reason: descriptor?.reason === 'unsupported' ? 'unsupported' : 'unavailable',
    requiresHumanTakeover: true,
  };
}
