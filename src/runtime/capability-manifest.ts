/**
 * Stable semantic operations exposed to the extractor and runtime policy.
 * Keep this order unchanged: it is part of the v1 manifest contract.
 */
export const runtimeOperationIds = [
  'faq.read',
  'event.association.read',
  'event.detail.read',
  'purchase.orders.read',
  'purchase.gift_detail.read',
  'rsvp.state.read',
  'rsvp.response.write',
  'provider.plan',
  'provider.search',
  'provider.quote.write',
  'auth.phone',
  'auth.email_otp',
  'human.takeover.write',
  'confirmation_document.send',
  'media.image.inspect',
  'payment_proof.verify',
  'purchase.modify',
  'refund_or_withdrawal.execute',
] as const;

export type RuntimeOperationId = (typeof runtimeOperationIds)[number];

export const runtimeCapabilityAvailabilityReasonValues = [
  'enabled',
  'feature_disabled',
  'gateway_unavailable',
  'write_blocked',
  'not_implemented',
  'media_unavailable',
] as const;

export type RuntimeCapabilityAvailabilityReason =
  (typeof runtimeCapabilityAvailabilityReasonValues)[number];

export type RuntimeCapabilityDescriptor = {
  readonly id: RuntimeOperationId;
  readonly available: boolean;
  readonly reason: RuntimeCapabilityAvailabilityReason;
};

/** The array is model/projectable data; keyed properties are runtime helpers. */
export type RuntimeCapabilityManifest = {
  readonly version: 'v1';
  readonly operations: readonly RuntimeCapabilityDescriptor[];
} & Readonly<Record<RuntimeOperationId, RuntimeCapabilityDescriptor>>;

export const runtimeToolOperationMap = {
  list_categories: 'provider.plan',
  get_category_by_slug: 'provider.plan',
  list_locations: 'provider.plan',
  search_providers_from_plan: 'provider.search',
  search_providers_by_keyword: 'provider.search',
  search_providers_by_category_location: 'provider.search',
  search_providers_by_query_intent: 'provider.search',
  get_relevant_providers: 'provider.search',
  get_provider_detail: 'provider.search',
  get_provider_detail_and_track_view: 'provider.search',
  get_related_providers: 'provider.search',
  list_provider_reviews: 'provider.search',
  get_event_vendor_context: 'provider.search',
  list_event_favorite_providers: 'provider.search',
  list_user_events_vendor_context: 'provider.search',
  create_quote_request: 'provider.quote.write',
  add_vendor_to_event_favorites: 'provider.plan',
  create_provider_review: 'provider.plan',
  finish_plan: 'provider.plan',
} as const satisfies Record<string, RuntimeOperationId>;

export type RuntimeToolName = keyof typeof runtimeToolOperationMap;

export const runtimeGatewayOperationMap = {
  getOrders: 'purchase.orders.read',
  getGiftPurchases: 'purchase.gift_detail.read',
  getGuestOrdersByPhone: 'purchase.orders.read',
  getGuestGiftPurchasesByPhone: 'purchase.gift_detail.read',
  authByPhone: 'auth.phone',
  getGuestEventsByPhone: 'event.association.read',
  getEventDetail: 'event.detail.read',
  updatePhone: 'auth.phone',
  guestRsvp: 'rsvp.response.write',
  requestHumanTakeover: 'human.takeover.write',
} as const satisfies Record<string, RuntimeOperationId>;

export const runtimeWriteOperationIds = [
  'rsvp.response.write',
  'provider.quote.write',
  'human.takeover.write',
] as const satisfies readonly RuntimeOperationId[];

const alwaysUnavailableReasons: Partial<
  Record<RuntimeOperationId, RuntimeCapabilityAvailabilityReason>
> = {
  'confirmation_document.send': 'not_implemented',
  'media.image.inspect': 'media_unavailable',
  'payment_proof.verify': 'not_implemented',
  'purchase.modify': 'not_implemented',
  'refund_or_withdrawal.execute': 'not_implemented',
};

export type RuntimeCapabilityFeatureFlags = {
  faq?: boolean;
  invitedEventLookup?: boolean;
  purchaseInformation?: boolean;
  rsvp?: boolean;
  providerPlanning?: boolean;
  providerSearch?: boolean;
  providerQuoteRequests?: boolean;
  phoneAuthentication?: boolean;
  emailOtp?: boolean;
  humanTakeover?: boolean;
};

export type RuntimeCapabilityManifestOptions = {
  configured?: boolean;
  environment?: 'development' | 'production';
  allowCustomerWrites?: boolean;
  fixture?: boolean;
  disabledOperations?: readonly RuntimeOperationId[];
  featureFlags?: RuntimeCapabilityFeatureFlags;
};

function featureForOperation(
  operation: RuntimeOperationId,
  flags: RuntimeCapabilityFeatureFlags,
): boolean | undefined {
  switch (operation) {
    case 'faq.read': return flags.faq;
    case 'event.association.read': return flags.invitedEventLookup;
    case 'event.detail.read': return flags.invitedEventLookup;
    case 'purchase.orders.read': return flags.purchaseInformation;
    case 'purchase.gift_detail.read': return flags.purchaseInformation;
    case 'rsvp.state.read': return flags.rsvp;
    case 'rsvp.response.write': return flags.rsvp;
    case 'provider.plan': return flags.providerPlanning;
    case 'provider.search': return flags.providerSearch;
    case 'provider.quote.write': return flags.providerQuoteRequests;
    case 'auth.phone': return flags.phoneAuthentication;
    case 'auth.email_otp': return flags.emailOtp;
    case 'human.takeover.write': return flags.humanTakeover;
    default: return undefined;
  }
}

export function buildRuntimeCapabilityManifest(
  options: RuntimeCapabilityManifestOptions = {},
): RuntimeCapabilityManifest {
  const configured = options.configured ?? true;
  const disabled = new Set(options.disabledOperations ?? []);
  const flags = options.featureFlags ?? {};
  const byId = {} as Record<RuntimeOperationId, RuntimeCapabilityDescriptor>;

  for (const id of runtimeOperationIds) {
    const forcedReason = alwaysUnavailableReasons[id];
    let available = configured && forcedReason === undefined;
    let reason: RuntimeCapabilityAvailabilityReason = forcedReason ??
      (configured ? 'enabled' : 'gateway_unavailable');
    const featureEnabled = featureForOperation(id, flags);

    if (disabled.has(id) || featureEnabled === false) {
      available = false;
      reason = 'feature_disabled';
    } else if (available && featureEnabled === true) {
      reason = 'enabled';
    }
    if (
      available &&
      options.environment === 'development' &&
      runtimeWriteOperationIds.includes(id as (typeof runtimeWriteOperationIds)[number]) &&
      options.allowCustomerWrites !== true
    ) {
      available = false;
      reason = 'write_blocked';
    }
    byId[id] = { id, available, reason };
  }

  const operations = runtimeOperationIds.map((id) => byId[id]);
  return { version: 'v1', operations, ...byId };
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
  | { readonly status: 'not_applicable' }
  | { readonly status: 'supported'; readonly operation: RuntimeOperationId }
  | {
      readonly status: 'clarify';
      readonly candidateOperations: readonly RuntimeOperationId[];
      readonly questionKey: 'status_or_document' | 'status_or_proof_review' | 'type_missing';
    }
  | {
      readonly status: 'unsupported';
      readonly operation: RuntimeOperationId;
      readonly reason: RuntimeCapabilityAvailabilityReason;
      readonly humanTakeoverAvailable: boolean;
    };

export type RequestedOperation = RuntimeOperationId;

export function resolveCapabilityDecision(args: {
  requestedOperation: RuntimeOperationId | null | undefined;
  manifest: RuntimeCapabilityManifest;
  ambiguity?: {
    status: 'clear' | 'ambiguous';
    candidateOperations?: readonly RuntimeOperationId[];
    questionKey?: 'status_or_document' | 'status_or_proof_review' | 'type_missing';
  };
}): CapabilityDecision {
  if (args.ambiguity?.status === 'ambiguous') {
    const candidates = args.ambiguity.candidateOperations ?? [];
    if (candidates.length > 0) {
      return {
        status: 'clarify',
        candidateOperations: candidates,
        questionKey: args.ambiguity.questionKey ?? 'type_missing',
      };
    }
  }
  const operation = args.requestedOperation ?? null;
  if (operation === null) return { status: 'not_applicable' };
  const descriptor = args.manifest[operation];
  if (descriptor?.available) return { status: 'supported', operation };
  return {
    status: 'unsupported',
    operation,
    reason: descriptor?.reason ?? 'gateway_unavailable',
    humanTakeoverAvailable: args.manifest['human.takeover.write'].available,
  };
}
