import { z } from 'zod';

import { decisionNodeSchema, type DecisionNode } from './decision-nodes';
import { eventTypeSchema, normalizeToEventType } from './event-type';
import { formatPriceLevel } from './price-level';
import { providerSummarySchema, type ProviderSummary } from './provider';
import {
  normalizeToProviderCategory,
  providerCategorySchema,
  type ProviderCategory,
} from './provider-category';
import { providerSubQueryResultSchema } from './provider-sub-query';
import {
  authRecoveryStateSchema,
  emptyAuthRecoveryState,
  informationStateSchema,
  mergeAuthRecoveryState,
  seedAuthRecoveryFromUserAuth,
  userAuthStateSchema,
  type AuthRecoveryState,
  type UserAuthState,
} from './information';
import { rsvpStateSchema, type RsvpState } from './rsvp';
import {
  MAX_IMAGE_ATTACHMENT_REFS,
  imageAttachmentRefSchema,
  mergeImageAttachmentRefs,
} from './image-attachments';

export const actionIntentValues = [
  'reset_plan',
  'elicitar_necesidades',
  'buscar_proveedores',
  'refinar_busqueda',
  'ver_opciones',
  'confirmar_proveedor',
  'modificar_plan_proveedores',
  'explicar_recomendacion',
  'detallar_proveedor',
  'retomar_plan',
  'cerrar',
  'pausar',
  'solicitar_humano',
  'responder_invitacion',
] as const;

export type ActionIntent = (typeof actionIntentValues)[number];
export const planIntentValues = actionIntentValues;
export type PlanIntent = ActionIntent;

export const guestRangeValues = [
  '1-20',
  '21-50',
  '51-100',
  '101-200',
  '201+',
  'unknown',
] as const;

export type GuestRange = (typeof guestRangeValues)[number];

export const planLifecycleValues = ['active', 'finished'] as const;

export type PlanLifecycleState = (typeof planLifecycleValues)[number];

/**
 * L4 persistent specialist ownership. Exactly three owners; the internal ID
 * for Customer operations stays `customer_assistance` while the user-facing
 * label is `Customer operations`. No fourth entry owner, no hidden subowner
 * agents. Capability slices inside Customer assistance (purchase/RSVP/auth/
 * support) are not persistent owners.
 */
export const ownerValues = ['planning', 'faq', 'customer_assistance'] as const;

export type PlanOwner = (typeof ownerValues)[number];

export const ownerSchema = z.enum(ownerValues);

export const ownerLabels: Record<PlanOwner, string> = {
  planning: 'Planning',
  faq: 'General information',
  customer_assistance: 'Customer operations',
};

/**
 * R2 latest-response fallback record. One record only, never a second
 * conversation database. It carries the latest successful rendered model
 * text (provenance included) so a later turn can recover answered-vs-pending
 * state when backend history lacks the current thread. Failed or suppressed
 * turns never write here, so a truncated/failed/suppressed record can never
 * mark a pending question answered. No image bytes, file IDs, URLs or
 * descriptions travel here: text only, bounded below. Strict shape rejects
 * any smuggled media keys by failing closed to null at the storage boundary.
 */
export const MAX_LAST_OUTBOUND_TEXT_BYTES = 4096;

export const lastOutboundContextSchema = z.object({
  message_id: z.string().trim().min(1).max(256),
  text: z.string().min(1).max(8192),
  text_truncated: z.boolean().default(false),
  recorded_at: z.string().datetime({ offset: true }),
  /**
   * Lambda response construction is never end-user receipt: the channel
   * supplies no acknowledgement, so the runtime only ever records
   * `constructed`. `confirmed` is reserved for a future acknowledged
   * delivery signal and must not be written from response construction.
   */
  delivery_evidence: z.enum(['constructed', 'confirmed']),
}).strict();

export type LastOutboundContext = z.infer<typeof lastOutboundContextSchema>;

/**
 * UTF-8-safe truncation at a valid character boundary (iterates code
 * points, so multi-byte sequences are never split). A truncated excerpt is
 * never proof that a particular question was answered; callers keep the
 * pending question until a full answer is confirmed by task state.
 */
export function truncateTextToUtf8Bytes(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return { text: value, truncated: false };
  }
  let bytes = 0;
  let end = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    end += char.length;
  }
  return { text: value.slice(0, end), truncated: true };
}

/**
 * Builds the fallback record from successful rendered model text only.
 * Returns null for blank text (failed/suppressed turns carry no text and
 * must never write here). No image bytes are accepted: this function only
 * sees rendered text.
 */
export function buildLastOutboundContext(args: {
  messageId: string;
  text: string;
  recordedAt: string;
}): LastOutboundContext | null {
  const messageId = args.messageId.trim();
  if (messageId.length === 0 || args.text.length === 0) return null;
  const bounded = truncateTextToUtf8Bytes(args.text, MAX_LAST_OUTBOUND_TEXT_BYTES);
  if (bounded.text.length === 0) return null;
  return {
    message_id: messageId,
    text: bounded.text,
    text_truncated: bounded.truncated,
    recorded_at: args.recordedAt,
    delivery_evidence: 'constructed',
  };
}

export const customerCapabilityValues = [
  'purchase',
  'rsvp',
  'auth',
  'support',
  'none',
] as const;

export type CustomerCapability = (typeof customerCapabilityValues)[number];

export const humanEscalationStatusValues = ['none', 'requested'] as const;

export type HumanEscalationStatus = (typeof humanEscalationStatusValues)[number];

export type { UserAuthState, AuthRecoveryState };
export { emptyAuthRecoveryState, mergeAuthRecoveryState };

export const humanEscalationStateSchema = z.object({
  status: z.enum(humanEscalationStatusValues),
  requested_at: z.string().nullable(),
  phone_number: z.string().nullable(),
  last_error: z.string().nullable(),
});

export type HumanEscalationState = z.infer<typeof humanEscalationStateSchema>;

export const conversationHealthStatusValues = [
  'progressing',
  'uncertain',
  'stalled',
  'frustrated',
] as const;

export const conversationHealthReasonValues = [
  'normal_progress',
  'repeated_question',
  'repeated_correction',
  'unresolved_error',
  'circular_conversation',
  'explicit_frustration',
  'insufficient_context',
] as const;

export const humanHelpOfferStatusValues = ['none', 'offered', 'declined'] as const;

export const conversationHealthStateSchema = z.object({
  status: z.enum(conversationHealthStatusValues),
  reason: z.enum(conversationHealthReasonValues),
  consecutive_non_progress_turns: z.number().int().min(0),
  help_offer_status: z.enum(humanHelpOfferStatusValues),
  help_offered_at: z.string().nullable(),
  last_assessed_at: z.string().nullable(),
});

export type ConversationHealthState = z.infer<typeof conversationHealthStateSchema>;

export const providerNeedStatusValues = [
  'identified',
  'search_ready',
  'shortlisted',
  'selected',
  'deferred',
  'no_providers_available',
] as const;

export type ProviderNeedStatus = (typeof providerNeedStatusValues)[number];

export const providerNeedSchema = z.object({
  category: providerCategorySchema,
  status: z.enum(providerNeedStatusValues),
  preferences: z.array(z.string()),
  hard_constraints: z.array(z.string()),
  missing_fields: z.array(z.string()),
  recommended_provider_ids: z.array(z.number()),
  recommended_providers: z.array(providerSummarySchema),
  sub_query_results: z.array(providerSubQueryResultSchema).optional(),
  selected_provider_ids: z.array(z.number()),
  selected_provider_hints: z.array(z.string()),
});

export type ProviderNeed = z.infer<typeof providerNeedSchema>;

export const planSchema = z.object({
  plan_id: z.string(),
  channel: z.string(),
  external_user_id: z.string(),
  conversation_id: z.string().nullable(),
  lifecycle_state: z.enum(planLifecycleValues).default('active'),
  contact_name: z.string().nullable().default(null),
  contact_email: z.string().nullable().default(null),
  contact_phone: z.string().nullable().default(null),
  contact_phone_extension: z.string().nullable().default(null),
  contact_phone_number: z.string().nullable().default(null),
  user_auth: userAuthStateSchema.default({
    status: 'none',
    email: null,
    token: null,
    token_expires_at: null,
    last_error: null,
    requested_at: null,
    failed_code_attempts: 0,
    otp_send_attempts: 0,
    otp_non_delivery_reports: 0,
    auth_method: null,
    awaiting_phone_confirmation: false,
  }),
  auth_recovery: authRecoveryStateSchema.default({
    sendAttempted: false,
    verificationAttempted: false,
    terminalReason: null,
    challengeEmail: null,
    challengeRequestedAt: null,
    preservedRequest: null,
  }),
  information_state: informationStateSchema.default({
    resume_node: null,
    pending_requests: [],
    selection_candidates: [],
  }),
  rsvp_state: rsvpStateSchema.default({
    status: 'none',
    pending_action: null,
    pending_plus_one_response: null,
    candidates: [],
    requested_at: null,
    selection_attempts: 0,
  }),
  human_escalation: humanEscalationStateSchema.default({
    status: 'none',
    requested_at: null,
    phone_number: null,
    last_error: null,
  }),
  human_help_receipt: z.object({
    dedupeKey: z.string(), inboundId: z.string(), phone: z.string(),
    outcome: z.enum(['handoff_requested', 'handoff_failed', 'outcome_unknown']),
    requested: z.boolean(), softPaused: z.boolean(), updatedAt: z.string(),
  }).nullable().optional(),
  conversation_health: conversationHealthStateSchema.default({
    status: 'uncertain',
    reason: 'insufficient_context',
    consecutive_non_progress_turns: 0,
    help_offer_status: 'none',
    help_offered_at: null,
    last_assessed_at: null,
  }),
  current_node: decisionNodeSchema,
  intent: z.enum(planIntentValues).nullable(),
  intent_confidence: z.number().min(0).max(1).nullable(),
  event_type: eventTypeSchema.nullable(),
  vendor_category: providerCategorySchema.nullable(),
  active_need_category: providerCategorySchema.nullable(),
  location: z.string().nullable(),
  budget_signal: z.string().nullable(),
  guest_range: z.enum(guestRangeValues).nullable(),
  preferences: z.array(z.string()),
  hard_constraints: z.array(z.string()),
  missing_fields: z.array(z.string()),
  provider_needs: z.array(providerNeedSchema),
  recommended_provider_ids: z.array(z.number()),
  recommended_providers: z.array(providerSummarySchema),
  selected_provider_ids: z.array(z.number()),
  selected_provider_hints: z.array(z.string()),
  assumptions: z.array(z.string()),
  conversation_summary: z.string(),
  last_user_goal: z.string().nullable(),
  open_questions: z.array(z.string()),
  image_attachments: z.array(imageAttachmentRefSchema).max(MAX_IMAGE_ATTACHMENT_REFS).default([]),
  owner: ownerSchema.default('planning'),
  owner_capability: z.enum(customerCapabilityValues).nullable().default(null),
  owner_pending_question: z.string().nullable().default(null),
  owner_pending_task: z.string().nullable().default(null),
  owner_return: ownerSchema.nullable().default(null),
  last_outbound_context: lastOutboundContextSchema.nullable().optional(),
  updated_at: z.string(),
});

export type PersistedPlan = z.infer<typeof planSchema>;

export type PlanSnapshot = PersistedPlan & { current_node: DecisionNode };

export type PlanUpdate = Partial<
  Omit<PersistedPlan, 'plan_id' | 'channel' | 'external_user_id' | 'user_auth' | 'rsvp_state' | 'auth_recovery'>
> & {
  user_auth?: Partial<UserAuthState>;
  rsvp_state?: Partial<RsvpState>;
  auth_recovery?: Partial<AuthRecoveryState>;
};

export function normalizeRawPlan(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const plan = { ...(raw as Record<string, unknown>) };

  const normalizeField = (field: string): void => {
    if (typeof plan[field] === 'string') {
      plan[field] = normalizeToProviderCategory(plan[field]);
    }
  };

  normalizeField('vendor_category');
  normalizeField('active_need_category');

  if (typeof plan.event_type === 'string') {
    plan.event_type = normalizeToEventType(plan.event_type);
  }

  if (typeof plan.selected_provider_id === 'number' && !Array.isArray(plan.selected_provider_ids)) {
    plan.selected_provider_ids = [plan.selected_provider_id];
  }
  if (typeof plan.selected_provider_hint === 'string' && !Array.isArray(plan.selected_provider_hints)) {
    plan.selected_provider_hints = [plan.selected_provider_hint];
  }
  delete plan.selected_provider_id;
  delete plan.selected_provider_hint;

  if (Array.isArray(plan.provider_needs)) {
    const providerNeeds: unknown[] = plan.provider_needs;
    plan.provider_needs = providerNeeds.map((need) => {
      if (!need || typeof need !== 'object') {
        return need;
      }
      const needObj = { ...(need as Record<string, unknown>) };
      if (typeof needObj.category === 'string') {
        needObj.category = normalizeToProviderCategory(needObj.category);
      }
      if (typeof needObj.selected_provider_id === 'number' && !Array.isArray(needObj.selected_provider_ids)) {
        needObj.selected_provider_ids = [needObj.selected_provider_id];
      }
      if (typeof needObj.selected_provider_hint === 'string' && !Array.isArray(needObj.selected_provider_hints)) {
        needObj.selected_provider_hints = [needObj.selected_provider_hint];
      }
      if (!Array.isArray(needObj.sub_query_results)) {
        needObj.sub_query_results = [];
      }
      delete needObj.selected_provider_id;
      delete needObj.selected_provider_hint;
      return needObj;
    });
  }

  // Support anchors were a temporary persistence workaround. Strip them at
  // the storage boundary so old plans cannot revive that state after upgrade.
  if (plan.information_state && typeof plan.information_state === 'object') {
    const informationState = {
      ...(plan.information_state as Record<string, unknown>),
    };
    delete informationState.support_anchor;
    plan.information_state = informationState;
  }

  // L4 ownership: exactly three persistent owners. Unknown or legacy
  // owner values fall back to planning; capability is kept only under
  // Customer assistance, otherwise cleared. No second state store.
  if (
    typeof plan.owner !== 'string' ||
    !(ownerValues as readonly string[]).includes(plan.owner)
  ) {
    plan.owner = 'planning';
  }
  if (plan.owner !== 'customer_assistance') {
    plan.owner_capability = null;
  } else if (
    typeof plan.owner_capability !== 'string' ||
    !(customerCapabilityValues as readonly string[]).includes(plan.owner_capability)
  ) {
    plan.owner_capability = null;
  }
  if (
    plan.owner_return !== null &&
    plan.owner_return !== undefined &&
    (!(typeof plan.owner_return === 'string') ||
      !(ownerValues as readonly string[]).includes(plan.owner_return))
  ) {
    plan.owner_return = null;
  }
  if (
    plan.owner_pending_question !== null &&
    plan.owner_pending_question !== undefined &&
    typeof plan.owner_pending_question !== 'string'
  ) {
    plan.owner_pending_question = null;
  }
  if (
    plan.owner_pending_task !== null &&
    plan.owner_pending_task !== undefined &&
    typeof plan.owner_pending_task !== 'string'
  ) {
    plan.owner_pending_task = null;
  }

  // Latest-response fallback record only. Strict shape fails closed to null
  // so smuggled media keys (bytes, urls, file IDs) can never persist here.
  // Over-long text from older writers is re-truncated (never trusted as
  // proof that a question was answered); unparseable records are dropped.
  if (plan.last_outbound_context !== null && plan.last_outbound_context !== undefined) {
    const parsed = lastOutboundContextSchema.safeParse(plan.last_outbound_context);
    if (!parsed.success) {
      plan.last_outbound_context = null;
    } else if (
      Buffer.byteLength(parsed.data.text, 'utf8') > MAX_LAST_OUTBOUND_TEXT_BYTES
    ) {
      const bounded = truncateTextToUtf8Bytes(parsed.data.text, MAX_LAST_OUTBOUND_TEXT_BYTES);
      plan.last_outbound_context = {
        ...parsed.data,
        text: bounded.text,
        text_truncated: true,
      };
    } else {
      plan.last_outbound_context = parsed.data;
    }
  }

  // Attachment refs carry linkage only. Normalize legacy url-only refs to
  // the url kind, keep file refs with their linkage, and strip any other
  // legacy keys (bytes, descriptions, store keys). Cap so old plans stay
  // bounded. Expired file refs are pruned at projection time, not here, so
  // a reload still shows the stored (expired) state for resubmission logic.
  if (Array.isArray(plan.image_attachments)) {
    const refs: unknown[] = plan.image_attachments;
    plan.image_attachments = refs
      .map((ref) => {
        if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return ref;
        const record = ref as Record<string, unknown>;
        if (record.kind === 'file') {
          return {
            kind: 'file',
            fileId: record.fileId,
            expiresAt: record.expiresAt,
            mimeType: record.mimeType,
            byteLength: record.byteLength,
            contentDigest: record.contentDigest,
            messageId: record.messageId,
            receivedAt: record.receivedAt,
          };
        }
        return { kind: 'url', url: record.url, messageId: record.messageId, receivedAt: record.receivedAt };
      })
      .map((ref) => imageAttachmentRefSchema.safeParse(ref))
      .filter((parsed): parsed is typeof parsed & { success: true } => parsed.success)
      .map((parsed) => parsed.data)
      .slice(-MAX_IMAGE_ATTACHMENT_REFS);
  } else if (plan.image_attachments !== undefined) {
    delete plan.image_attachments;
  }

  // Seed typed auth_recovery once from legacy user_auth evidence, then merge
  // monotonically so an existing terminal record is never cleared.
  try {
    const rawAuth = plan.user_auth as Record<string, unknown> | undefined;
    const parsedRecovery = authRecoveryStateSchema.safeParse(plan.auth_recovery);
    const currentRecovery = parsedRecovery.success
      ? parsedRecovery.data
      : emptyAuthRecoveryState();
    if (rawAuth && typeof rawAuth === 'object') {
      const seed = seedAuthRecoveryFromUserAuth({
        status: typeof rawAuth.status === 'string' ? rawAuth.status : 'none',
        email: typeof rawAuth.email === 'string' ? rawAuth.email : null,
        requestedAt: typeof rawAuth.requested_at === 'string' ? rawAuth.requested_at : null,
        failedCodeAttempts: typeof rawAuth.failed_code_attempts === 'number' ? rawAuth.failed_code_attempts : 0,
        otpSendAttempts: typeof rawAuth.otp_send_attempts === 'number' ? rawAuth.otp_send_attempts : 0,
        otpNonDeliveryReports: typeof rawAuth.otp_non_delivery_reports === 'number' ? rawAuth.otp_non_delivery_reports : 0,
      });
      plan.auth_recovery = mergeAuthRecoveryState(currentRecovery, seed);
    } else if (!parsedRecovery.success) {
      plan.auth_recovery = currentRecovery;
    }
  } catch {
    // Keep raw plan when recovery seeding fails; schema validation reports it.
  }

  return plan;
}

export function createEmptyPlan(args: {
  planId: string;
  channel: string;
  externalUserId: string;
}): PlanSnapshot {
  return {
    plan_id: args.planId,
    channel: args.channel,
    external_user_id: args.externalUserId,
    conversation_id: null,
    lifecycle_state: 'active',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    contact_phone_extension: null,
    contact_phone_number: null,
    user_auth: {
      status: 'none',
      email: null,
      token: null,
      token_expires_at: null,
      last_error: null,
      requested_at: null,
      failed_code_attempts: 0,
      otp_send_attempts: 0,
      otp_non_delivery_reports: 0,
      auth_method: null,
      awaiting_phone_confirmation: false,
    },
    information_state: {
      resume_node: null,
      pending_requests: [],
      selection_candidates: [],
      last_completed_request: null,
    },
    rsvp_state: {
      status: 'none',
      pending_action: null,
      pending_plus_one_response: null,
      candidates: [],
      requested_at: null,
      selection_attempts: 0,
    },
    human_escalation: {
      status: 'none',
      requested_at: null,
      phone_number: null,
      last_error: null,
    },
    auth_recovery: emptyAuthRecoveryState(),
    conversation_health: {
      status: 'uncertain',
      reason: 'insufficient_context',
      consecutive_non_progress_turns: 0,
      help_offer_status: 'none',
      help_offered_at: null,
      last_assessed_at: null,
    },
    current_node: 'contacto_inicial',
    intent: null,
    intent_confidence: null,
    event_type: null,
    vendor_category: null,
    active_need_category: null,
    location: null,
    budget_signal: null,
    guest_range: null,
    preferences: [],
    hard_constraints: [],
    missing_fields: [],
    provider_needs: [],
    recommended_provider_ids: [],
    recommended_providers: [],
    selected_provider_ids: [],
    selected_provider_hints: [],
    assumptions: [],
    conversation_summary: '',
    last_user_goal: null,
    open_questions: [],
    image_attachments: [],
    owner: 'planning',
    owner_capability: null,
    owner_pending_question: null,
    owner_pending_task: null,
    owner_return: null,
    last_outbound_context: null,
    updated_at: new Date(0).toISOString(),
  };
}

export function isPlanFinished(
  plan: Pick<PersistedPlan, 'lifecycle_state'> | null | undefined,
): boolean {
  return plan?.lifecycle_state === 'finished';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function normalizeCategory(value: string | null | undefined): ProviderCategory | null {
  return normalizeToProviderCategory(value);
}

function mergeProviderNeed(
  current: ProviderNeed | null,
  update: Partial<ProviderNeed> & { category: string },
): ProviderNeed {
  const recommendedProviderIds =
    update.recommended_provider_ids ?? current?.recommended_provider_ids ?? [];
  const isExplicitSelectionClear =
    update.selected_provider_ids !== undefined &&
    update.selected_provider_ids.length === 0 &&
    update.selected_provider_hints !== undefined &&
    update.selected_provider_hints.length === 0;
  const selectedProviderIds = isExplicitSelectionClear
    ? []
    : Array.from(
        new Set([
          ...(current?.selected_provider_ids ?? []),
          ...(update.selected_provider_ids ?? []),
        ]),
      );
  const selectedProviderHints = isExplicitSelectionClear
    ? []
    : uniqueStrings([
        ...(current?.selected_provider_hints ?? []),
        ...(update.selected_provider_hints ?? []),
      ]);
  const recommendedProviders =
    update.recommended_providers ?? current?.recommended_providers ?? [];
  const subQueryResults =
    update.sub_query_results ?? current?.sub_query_results ?? [];

  let status = update.status ?? current?.status ?? 'identified';

  if (update.status) {
    // Explicit status update always wins
    status = update.status;
  } else if (selectedProviderIds.length > 0) {
    status = 'selected';
  } else if (current?.status === 'no_providers_available' && recommendedProviders.length === 0) {
    // Preserve terminal "no providers" status unless new results arrived
    status = 'no_providers_available';
  } else if (current?.status === 'deferred') {
    // Preserve deferred unless explicitly changed or selected
    status = 'deferred';
  } else if (recommendedProviders.length > 0 || recommendedProviderIds.length > 0) {
    status = 'shortlisted';
  } else if ((update.missing_fields ?? current?.missing_fields ?? []).length === 0) {
    status = 'search_ready';
  }

  return providerNeedSchema.parse({
    category: update.category,
    status,
    preferences: uniqueStrings([
      ...(current?.preferences ?? []),
      ...(update.preferences ?? []),
    ]),
    hard_constraints: uniqueStrings([
      ...(current?.hard_constraints ?? []),
      ...(update.hard_constraints ?? []),
    ]),
    missing_fields: update.missing_fields ?? current?.missing_fields ?? [],
    recommended_provider_ids: recommendedProviderIds,
    recommended_providers: recommendedProviders,
    sub_query_results: subQueryResults,
    selected_provider_ids: selectedProviderIds,
    selected_provider_hints: selectedProviderHints,
  });
}

function mergeProviderNeeds(
  current: ProviderNeed[],
  updates: ProviderNeed[],
): ProviderNeed[] {
  const map = new Map<string, ProviderNeed>();

  for (const need of current) {
    const key = normalizeCategory(need.category);
    if (!key) {
      continue;
    }

    map.set(key, providerNeedSchema.parse(need));
  }

  for (const update of updates) {
    const key = normalizeCategory(update.category);
    if (!key) {
      continue;
    }

    map.set(key, mergeProviderNeed(map.get(key) ?? null, update));
  }

  return Array.from(map.values());
}

function ensureActiveNeed(
  providerNeeds: ProviderNeed[],
  activeNeedCategory: string | null,
  fallbackCategory: string | null,
): { providerNeeds: ProviderNeed[]; activeNeedCategory: ProviderCategory | null } {
  const candidate =
    normalizeCategory(activeNeedCategory) ??
    normalizeCategory(fallbackCategory) ??
    providerNeeds[0]?.category ??
    null;

  if (!candidate) {
    return {
      providerNeeds,
      activeNeedCategory: null,
    };
  }

  const existing = providerNeeds.find(
    (need) => normalizeCategory(need.category) === candidate,
  );

  if (existing) {
    return {
      providerNeeds,
      activeNeedCategory: existing.category,
    };
  }

  const nextNeed = mergeProviderNeed(null, {
    category: candidate,
    missing_fields: [],
  });

  return {
    providerNeeds: [...providerNeeds, nextNeed],
    activeNeedCategory: nextNeed.category,
  };
}

function projectActiveNeed(
  providerNeeds: ProviderNeed[],
  activeNeedCategory: ProviderCategory | null,
): Partial<PersistedPlan> {
  const activeNeed =
    providerNeeds.find(
      (need) => normalizeCategory(need.category) === normalizeCategory(activeNeedCategory),
    ) ?? null;

  if (!activeNeed) {
    return {
      vendor_category: activeNeedCategory,
      recommended_provider_ids: [],
      recommended_providers: [],
      selected_provider_ids: [],
      selected_provider_hints: [],
    };
  }

  return {
    vendor_category: activeNeed.category,
    recommended_provider_ids: activeNeed.recommended_provider_ids,
    recommended_providers: activeNeed.recommended_providers,
    selected_provider_ids: activeNeed.selected_provider_ids,
    selected_provider_hints: activeNeed.selected_provider_hints,
  };
}

export function getActiveNeed(plan: Pick<PersistedPlan, 'provider_needs' | 'active_need_category'>): ProviderNeed | null {
  const activeCategory = normalizeCategory(plan.active_need_category);
  if (!activeCategory) {
    return plan.provider_needs[0] ?? null;
  }

  return (
    plan.provider_needs.find(
      (need) => normalizeCategory(need.category) === activeCategory,
    ) ?? null
  );
}

export function replaceProviderNeeds(
  plan: PlanSnapshot,
  providerNeeds: ProviderNeed[],
  activeNeedCategory: ProviderCategory | null,
): PlanSnapshot {
  const parsedNeeds = providerNeeds.map((need) => providerNeedSchema.parse(need));
  // Active focus never points at a deferred need. A requested deferred
  // category (or an absent one) falls back to the first non-deferred need;
  // when every need is deferred there is no active focus to keep.
  const requestedCategory = normalizeCategory(activeNeedCategory);
  const requestedNeed = parsedNeeds.find(
    (need) => normalizeCategory(need.category) === requestedCategory,
  );
  const fallbackCategory =
    normalizeCategory(parsedNeeds.find((need) => need.status !== 'deferred')?.category) ??
    null;
  const activeCategory = requestedNeed
    ? (requestedNeed.status === 'deferred' ? fallbackCategory : requestedCategory)
    : (requestedCategory ?? fallbackCategory);
  const activeProjection = projectActiveNeed(parsedNeeds, activeCategory);

  return planSchema.parse({
    ...plan,
    provider_needs: parsedNeeds,
    active_need_category: activeCategory,
    vendor_category: activeProjection.vendor_category ?? activeCategory,
    recommended_provider_ids: activeProjection.recommended_provider_ids ?? [],
    recommended_providers: activeProjection.recommended_providers ?? [],
    selected_provider_ids: activeProjection.selected_provider_ids ?? [],
    selected_provider_hints: activeProjection.selected_provider_hints ?? [],
    updated_at: new Date().toISOString(),
  }) as PlanSnapshot;
}

export function summarizeProviderNeeds(providerNeeds: ProviderNeed[]): string {
  if (providerNeeds.length === 0) {
    return 'No hay necesidades de proveedores registradas todavía.';
  }

  return providerNeeds
    .map((need, index) => {
      const selected = need.selected_provider_ids.length > 0
        ? `, proveedores elegidos ${need.selected_provider_ids.join(', ')}`
        : '';
      const unavailable = need.status === 'no_providers_available'
        ? ' (sin proveedores disponibles)'
        : '';
      return `${index + 1}. ${need.category} [${need.status}]${selected}${unavailable}`;
    })
    .join('\n');
}

export function mergePlan(plan: PlanSnapshot, update: PlanUpdate): PlanSnapshot {
  const mergedProviderNeeds = mergeProviderNeeds(
    plan.provider_needs ?? [],
    update.provider_needs ?? [],
  );
  const needsWithFallback =
    update.vendor_category && !mergedProviderNeeds.some(
      (need) =>
        normalizeCategory(need.category) === normalizeCategory(update.vendor_category),
    )
      ? [
          ...mergedProviderNeeds,
          mergeProviderNeed(null, {
            category: update.vendor_category,
            preferences: update.preferences ?? [],
            hard_constraints: update.hard_constraints ?? [],
            missing_fields: update.missing_fields ?? [],
            recommended_provider_ids: update.recommended_provider_ids ?? [],
            recommended_providers: update.recommended_providers ?? [],
            sub_query_results: update.provider_needs?.find(
              (need) => normalizeCategory(need.category) === normalizeCategory(update.vendor_category),
            )?.sub_query_results ?? [],
            selected_provider_ids: update.selected_provider_ids ?? [],
            selected_provider_hints: update.selected_provider_hints ?? [],
          }),
        ]
      : mergedProviderNeeds.map((need) =>
          normalizeCategory(need.category) === normalizeCategory(update.vendor_category)
            ? mergeProviderNeed(need, {
                category: need.category,
                preferences: update.preferences ?? [],
                hard_constraints: update.hard_constraints ?? [],
                missing_fields: update.missing_fields ?? need.missing_fields,
                recommended_provider_ids:
                  update.recommended_provider_ids ?? need.recommended_provider_ids,
                recommended_providers:
                  update.recommended_providers ?? need.recommended_providers,
                sub_query_results: update.provider_needs?.find(
                  (updatedNeed) => normalizeCategory(updatedNeed.category) === normalizeCategory(need.category),
                )?.sub_query_results ?? need.sub_query_results,
                selected_provider_ids:
                  update.selected_provider_ids ?? need.selected_provider_ids,
                selected_provider_hints:
                  update.selected_provider_hints ?? need.selected_provider_hints,
              })
            : need,
        );
  const activeNeedState = ensureActiveNeed(
    needsWithFallback,
    update.active_need_category ?? plan.active_need_category,
    update.vendor_category ?? plan.vendor_category,
  );
  const activeProjection = projectActiveNeed(
    activeNeedState.providerNeeds,
    activeNeedState.activeNeedCategory,
  );

  const { auth_recovery: authRecoveryUpdate, ...restUpdate } = update;
  const mergedAuthRecovery = authRecoveryUpdate
    ? mergeAuthRecoveryState(plan.auth_recovery ?? emptyAuthRecoveryState(), {
        ...emptyAuthRecoveryState(),
        ...authRecoveryUpdate,
      })
    : (plan.auth_recovery ?? emptyAuthRecoveryState());

  // L4 ownership coherence: a capability slice only lives under Customer
  // assistance. Leaving the owner clears a stale capability unless the same
  // update explicitly re-establishes Customer assistance with a capability.
  const nextOwner = restUpdate.owner ?? plan.owner;
  const nextCapability = restUpdate.owner_capability !== undefined
    ? restUpdate.owner_capability
    : plan.owner_capability;
  const coherentCapability = nextOwner === 'customer_assistance' ? nextCapability : null;

  const merged: PersistedPlan = {
    ...plan,
    ...restUpdate,
    owner_capability: coherentCapability,
    auth_recovery: mergedAuthRecovery,
    image_attachments: mergeImageAttachmentRefs(
      plan.image_attachments,
      update.image_attachments,
    ),
    user_auth: {
      ...plan.user_auth,
      ...(update.user_auth ?? {}),
    },
    rsvp_state: {
      ...plan.rsvp_state,
      ...(update.rsvp_state ?? {}),
    },
    preferences: uniqueStrings([...(plan.preferences ?? []), ...(update.preferences ?? [])]),
    hard_constraints: uniqueStrings([
      ...(plan.hard_constraints ?? []),
      ...(update.hard_constraints ?? []),
    ]),
    assumptions: uniqueStrings([...(plan.assumptions ?? []), ...(update.assumptions ?? [])]),
    missing_fields: update.missing_fields ?? plan.missing_fields ?? [],
    provider_needs: activeNeedState.providerNeeds,
    active_need_category: activeNeedState.activeNeedCategory,
    recommended_provider_ids: activeProjection.recommended_provider_ids ?? [],
    recommended_providers: activeProjection.recommended_providers ?? [],
    selected_provider_ids: activeProjection.selected_provider_ids ?? [],
    selected_provider_hints: activeProjection.selected_provider_hints ?? [],
    vendor_category: activeProjection.vendor_category ?? null,
    open_questions: uniqueStrings([
      ...(plan.open_questions ?? []),
      ...(update.open_questions ?? []),
    ]),
    updated_at: update.updated_at ?? new Date().toISOString(),
  };

  return planSchema.parse(merged) as PlanSnapshot;
}

export function summarizeRecommendedProviders(providers: ProviderSummary[]): string {
  if (providers.length === 0) {
    return 'No hay proveedores recomendados todavía.';
  }

  return providers
    .map((provider, index) => {
      const location = provider.location ?? 'ubicación no especificada';
      const category = provider.category ? ` [${provider.category}]` : '';
      const price = provider.priceLevel ? ` (${formatPriceLevel(provider.priceLevel)})` : '';
      const differentiators = [
        provider.promoBadge ?? provider.promoSummary ?? null,
        provider.serviceHighlights?.slice(0, 1).join(', ') || null,
        provider.descriptionSnippet,
      ].filter((value): value is string => Boolean(value));
      return `${index + 1}. ${provider.title}${category} | ubicación: ${location}${price}${differentiators.length > 0 ? ` | detalles: ${differentiators.join(' | ')}` : ''}`;
    })
    .join('\n');
}
